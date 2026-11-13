#!/usr/bin/env bash
set -Eeuo pipefail

migration_path="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/supabase/migrations/20261113000000_clinic_undo_transactions.sql"
temp_dir="$(mktemp -d)"
test_databases=()
created_database=""

export PGHOST=127.0.0.1
export PGHOSTADDR=127.0.0.1
export PGPORT=5432
export PGUSER=postgres
unset PGDATABASE PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_URL SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY || true

cleanup() {
    local database
    for database in "${test_databases[@]}"; do
        dropdb --if-exists --maintenance-db=postgres "$database" >/dev/null 2>&1 || true
    done
    rm -rf "$temp_dir"
}
trap cleanup EXIT

if [[ ! -f "$migration_path" ]]; then
    echo "Migration file not found: $migration_path" >&2
    exit 1
fi

psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname=postgres --command='SELECT version();'

psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname=postgres <<'SQL'
DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'CREATE ROLE anon NOLOGIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'CREATE ROLE authenticated NOLOGIN';
    END IF;
END;
$roles$;
SQL

make_database() {
    local scenario="$1"
    local database="clinic_undo_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-0}_${scenario}_${BASHPID}"
    database="${database:0:60}"
    createdb --template=template0 --owner=postgres "$database"
    test_databases+=("$database")
    created_database="$database"
}

make_fixture() {
    local database="$1"
    local scenario="$2"
    local consultation_id_definition="uuid PRIMARY KEY"
    local appointment_delete_action="SET NULL"
    local queue_fk_mode="validated"

    case "$scenario" in
        wrong_uuid)
            consultation_id_definition="text PRIMARY KEY"
            ;;
        missing_key)
            consultation_id_definition="uuid NOT NULL"
            ;;
        missing_fk)
            queue_fk_mode="missing"
            ;;
        unvalidated_fk)
            queue_fk_mode="not_valid"
            ;;
        wrong_delete_action)
            appointment_delete_action="RESTRICT"
            ;;
        valid)
            ;;
        *)
            echo "Unknown fixture scenario: $scenario" >&2
            return 1
            ;;
    esac

    psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" \
        --set=consultation_id_definition="$consultation_id_definition" \
        --set=appointment_delete_action="$appointment_delete_action" <<'SQL'
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
    SELECT NULL::uuid;
$function$;

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY,
    role text NOT NULL,
    is_active boolean NOT NULL
);
CREATE FUNCTION public.is_clinic_staff()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
    SELECT false;
$function$;

CREATE TABLE public.departments (
    id uuid PRIMARY KEY,
    name text
);
CREATE TABLE public.doctors (
    id uuid PRIMARY KEY,
    department_id uuid REFERENCES public.departments(id) ON DELETE RESTRICT,
    full_name text,
    email text,
    phone text,
    license_number text
);
CREATE TABLE public.patients (
    id uuid PRIMARY KEY,
    patient_code text,
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name text,
    email text,
    phone text,
    gender text,
    birth_date date,
    address text,
    status text,
    created_at timestamptz
);
CREATE TABLE public.appointments (
    id uuid PRIMARY KEY,
    appointment_code text,
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
    appointment_date timestamptz NOT NULL,
    reason text,
    status text NOT NULL,
    notes text,
    created_at timestamptz,
    appointment_time time
);
CREATE TABLE public.queue_entries (
    id uuid PRIMARY KEY,
    queue_number text,
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
    appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
    queue_date date NOT NULL,
    priority text NOT NULL,
    status text NOT NULL,
    called_at timestamptz,
    created_at timestamptz
);
CREATE TABLE public.consultations (
    id :consultation_id_definition,
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
    appointment_id uuid,
    queue_entry_id uuid
);
ALTER TABLE public.consultations
    ADD CONSTRAINT fixture_consultations_appointment_fk
    FOREIGN KEY (appointment_id)
    REFERENCES public.appointments(id)
    ON DELETE :appointment_delete_action;
SQL

    case "$queue_fk_mode" in
        validated)
            psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" <<'SQL'
ALTER TABLE public.consultations
    ADD CONSTRAINT fixture_consultations_queue_entry_fk
    FOREIGN KEY (queue_entry_id)
    REFERENCES public.queue_entries(id)
    ON DELETE SET NULL;
SQL
            ;;
        not_valid)
            psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" <<'SQL'
ALTER TABLE public.consultations
    ADD CONSTRAINT fixture_consultations_queue_entry_fk
    FOREIGN KEY (queue_entry_id)
    REFERENCES public.queue_entries(id)
    ON DELETE SET NULL
    NOT VALID;
SQL
            ;;
        missing)
            ;;
    esac
}

make_rollback_copy() {
    local output_path="$1"
    awk '
        tolower($0) ~ /^[[:space:]]*commit;[[:space:]]*$/ {
            commit_count++
            next
        }
        { print }
        END {
            if (commit_count != 1) {
                exit 1
            }
        }
    ' "$migration_path" > "$output_path"

    cat >> "$output_path" <<'SQL'
DO $validation$
DECLARE
    v_trigger_count integer;
    v_table_name text;
    v_rls_enabled boolean;
BEGIN
    IF to_regclass('public.clinic_undo_transactions') IS NULL
        OR to_regclass('public.clinic_undo_consultation_link_staging') IS NULL
        OR to_regclass('public.clinic_undo_consultation_links') IS NULL THEN
        RAISE EXCEPTION 'Expected Undo ledger and consultation link tables were not created.';
    END IF;

    SELECT count(*)
    INTO v_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_definition
    WHERE trigger_definition.tgname::text = ANY (ARRAY[
        'clinic_undo_lock_actor',
        'clinic_undo_capture_patient',
        'clinic_undo_lock_appointment_actor',
        'clinic_undo_stage_appointment_consultation_links',
        'clinic_undo_capture_appointment',
        'clinic_undo_lock_queue_actor',
        'clinic_undo_stage_queue_consultation_links',
        'clinic_undo_capture_queue_entry'
    ])
      AND trigger_definition.tgisinternal IS FALSE;

    IF v_trigger_count <> 8 THEN
        RAISE EXCEPTION 'Expected eight Undo triggers, found %.', v_trigger_count;
    END IF;

    FOREACH v_table_name IN ARRAY ARRAY[
        'public.clinic_undo_consultation_link_staging',
        'public.clinic_undo_consultation_links'
    ]
    LOOP
        SELECT relation.relrowsecurity
        INTO v_rls_enabled
        FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = to_regclass(v_table_name);

        IF v_rls_enabled IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'RLS is not enabled on %.', v_table_name;
        END IF;

        IF has_table_privilege('anon', v_table_name, 'SELECT')
            OR has_table_privilege('authenticated', v_table_name, 'SELECT') THEN
            RAISE EXCEPTION 'API role can read private table %.', v_table_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid = 'public.stage_clinic_undo_consultation_links()'::regprocedure
          AND proc.provolatile = 'v'
          AND proc.prosecdef IS TRUE
    ) THEN
        RAISE EXCEPTION 'Staging trigger function volatility/security attributes are incorrect.';
    END IF;
END;
$validation$;
ROLLBACK;
SQL
}

rollback_migration="$temp_dir/clinic_undo_rollback.sql"
make_rollback_copy "$rollback_migration"

run_valid_scenario() {
    local database
    make_database valid
    database="$created_database"
    make_fixture "$database" valid
    psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" --file="$rollback_migration"
    echo "PASS: valid preflight and full migration DDL (rolled back)"
}

run_invalid_scenario() {
    local scenario="$1"
    local expected_message="$2"
    local database
    local log_path="$temp_dir/${scenario}.log"
    local remaining_objects

    make_database "$scenario"
    database="$created_database"
    make_fixture "$database" "$scenario"

    if psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$database" \
        --file="$rollback_migration" >"$log_path" 2>&1; then
        cat "$log_path"
        echo "FAIL: $scenario preflight unexpectedly passed" >&2
        return 1
    fi

    if ! grep --fixed-strings --quiet "$expected_message" "$log_path"; then
        cat "$log_path"
        echo "FAIL: $scenario failed for an unexpected reason" >&2
        return 1
    fi

    remaining_objects="$(
        psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
            --dbname="$database" \
            --command="SELECT concat_ws(',', to_regclass('public.clinic_undo_transactions'), to_regclass('public.clinic_undo_consultation_links'));"
    )"
    if [[ -n "$remaining_objects" ]]; then
        echo "FAIL: $scenario left Undo objects behind after preflight failure: $remaining_objects" >&2
        return 1
    fi

    echo "PASS: $scenario rejected with expected preflight error and no Undo objects"
}

run_valid_scenario
run_invalid_scenario wrong_uuid \
    'Expected public.consultations.id to exist with PostgreSQL type uuid.'
run_invalid_scenario missing_key \
    'Expected public.consultations.id to have a single-column PRIMARY KEY or UNIQUE constraint.'
run_invalid_scenario missing_fk \
    'Expected exactly one validated foreign key public.consultations.queue_entry_id -> public.queue_entries.id ON DELETE SET NULL.'
run_invalid_scenario unvalidated_fk \
    'Expected exactly one validated foreign key public.consultations.queue_entry_id -> public.queue_entries.id ON DELETE SET NULL.'
run_invalid_scenario wrong_delete_action \
    'Expected exactly one validated foreign key public.consultations.appointment_id -> public.appointments.id ON DELETE SET NULL.'
