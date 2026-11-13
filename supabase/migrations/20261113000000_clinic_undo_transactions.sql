-- Persistent, per-actor Undo history for patient, appointment, and queue rows.
-- Row triggers capture the existing PostgREST writes in the same transaction
-- as the business change, so the current frontend write paths remain atomic.
--
-- Snapshots may contain patient data. They are not directly readable or
-- writable by API roles; the history RPC returns metadata only.

begin;

do $$
declare
    v_required_column record;
    v_required_key record;
    v_required_foreign_key record;
    v_source_relation oid;
    v_source_attribute smallint;
    v_expected_foreign_key_count integer;
    v_source_foreign_key_count integer;
begin
    if to_regclass('public.patients') is null
        or to_regclass('public.appointments') is null
        or to_regclass('public.queue_entries') is null then
        raise exception 'Expected public.patients, public.appointments, and public.queue_entries.';
    end if;

    if to_regclass('public.profiles') is null
        or not exists (
            select 1
            from pg_catalog.pg_proc
            where oid = to_regprocedure('public.is_clinic_staff()')
              and prorettype = 'pg_catalog.bool'::regtype
        ) then
        raise exception 'Expected public.profiles and public.is_clinic_staff() returning boolean.';
    end if;

    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'role'
    ) or not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'is_active'
    ) then
        raise exception 'Expected profiles.role and profiles.is_active.';
    end if;

    if to_regclass('public.consultations') is null
        or not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'consultations'
              and column_name = 'id'
        )
        or not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'consultations'
              and column_name = 'patient_id'
        )
        or not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'consultations'
              and column_name = 'appointment_id'
        )
        or not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'consultations'
              and column_name = 'queue_entry_id'
        ) then
        raise exception 'Expected consultations.id, patient_id, appointment_id, and queue_entry_id for safe Undo reference checks.';
    end if;

    for v_required_column in
        select required.table_name, required.column_name
        from (values
            ('consultations', 'id'),
            ('consultations', 'appointment_id'),
            ('consultations', 'queue_entry_id'),
            ('consultations', 'patient_id'),
            ('appointments', 'id'),
            ('queue_entries', 'id'),
            ('patients', 'id')
        ) as required(table_name, column_name)
    loop
        if not exists (
            select 1
            from pg_catalog.pg_class as relation
            join pg_catalog.pg_namespace as relation_namespace
              on relation_namespace.oid = relation.relnamespace
            join pg_catalog.pg_attribute as column_definition
              on column_definition.attrelid = relation.oid
            where relation_namespace.nspname = 'public'
              and relation.relname = v_required_column.table_name
              and column_definition.attname = v_required_column.column_name
              and column_definition.attnum > 0
              and column_definition.attisdropped is false
              and column_definition.atttypid = 'pg_catalog.uuid'::regtype
        ) then
            raise exception 'Expected public.%.% to exist with PostgreSQL type uuid.',
                v_required_column.table_name,
                v_required_column.column_name;
        end if;
    end loop;

    for v_required_key in
        select required.table_name, required.column_name
        from (values
            ('consultations', 'id'),
            ('appointments', 'id'),
            ('queue_entries', 'id'),
            ('patients', 'id')
        ) as required(table_name, column_name)
    loop
        if not exists (
            select 1
            from pg_catalog.pg_class as relation
            join pg_catalog.pg_namespace as relation_namespace
              on relation_namespace.oid = relation.relnamespace
            join pg_catalog.pg_attribute as column_definition
              on column_definition.attrelid = relation.oid
            join pg_catalog.pg_constraint as key_constraint
              on key_constraint.conrelid = relation.oid
             and key_constraint.contype in ('p', 'u')
             and array_length(key_constraint.conkey, 1) = 1
             and key_constraint.conkey[1] = column_definition.attnum
            where relation_namespace.nspname = 'public'
              and relation.relname = v_required_key.table_name
              and column_definition.attname = v_required_key.column_name
              and column_definition.attnum > 0
              and column_definition.attisdropped is false
        ) then
            raise exception 'Expected public.%.% to have a single-column PRIMARY KEY or UNIQUE constraint.',
                v_required_key.table_name,
                v_required_key.column_name;
        end if;
    end loop;

    for v_required_foreign_key in
        select expected.source_table,
               expected.source_column,
               expected.target_table,
               expected.target_column,
               expected.delete_action,
               expected.delete_action_name
        from (values
            -- pg_constraint.confdeltype uses 'n' for SET NULL and 'r' for RESTRICT.
            ('consultations', 'appointment_id', 'appointments', 'id', 'n', 'SET NULL'),
            ('consultations', 'queue_entry_id', 'queue_entries', 'id', 'n', 'SET NULL'),
            ('consultations', 'patient_id', 'patients', 'id', 'r', 'RESTRICT'),
            ('queue_entries', 'appointment_id', 'appointments', 'id', 'n', 'SET NULL')
        ) as expected(
            source_table,
            source_column,
            target_table,
            target_column,
            delete_action,
            delete_action_name
        )
    loop
        v_source_relation := to_regclass(format('public.%I', v_required_foreign_key.source_table))::oid;

        select column_definition.attnum
        into v_source_attribute
        from pg_catalog.pg_attribute as column_definition
        where column_definition.attrelid = v_source_relation
          and column_definition.attname = v_required_foreign_key.source_column
          and column_definition.attnum > 0
          and column_definition.attisdropped is false;

        select count(*)
        into v_expected_foreign_key_count
        from pg_catalog.pg_constraint as foreign_key
        join pg_catalog.pg_attribute as source_column
          on source_column.attrelid = foreign_key.conrelid
         and source_column.attnum = foreign_key.conkey[1]
        join pg_catalog.pg_attribute as target_column
          on target_column.attrelid = foreign_key.confrelid
         and target_column.attnum = foreign_key.confkey[1]
        where foreign_key.contype = 'f'
          and foreign_key.conrelid = v_source_relation
          and foreign_key.confrelid = to_regclass(format('public.%I', v_required_foreign_key.target_table))::oid
          and array_length(foreign_key.conkey, 1) = 1
          and array_length(foreign_key.confkey, 1) = 1
          and source_column.attname = v_required_foreign_key.source_column
          and target_column.attname = v_required_foreign_key.target_column
          and foreign_key.confdeltype::text = v_required_foreign_key.delete_action
          and foreign_key.convalidated is true;

        select count(*)
        into v_source_foreign_key_count
        from pg_catalog.pg_constraint as foreign_key
        where foreign_key.contype = 'f'
          and foreign_key.conrelid = v_source_relation
          and v_source_attribute = any(foreign_key.conkey);

        if v_expected_foreign_key_count <> 1
            or v_source_foreign_key_count <> 1 then
            raise exception 'Expected exactly one validated foreign key public.%.% -> public.%.% ON DELETE %.',
                v_required_foreign_key.source_table,
                v_required_foreign_key.source_column,
                v_required_foreign_key.target_table,
                v_required_foreign_key.target_column,
                v_required_foreign_key.delete_action_name;
        end if;
    end loop;
end;
$$;

-- This row serializes all tracked writes and Undo requests from one actor.
-- The row lock is acquired before row-level DML triggers assign sequence
-- numbers, giving each actor a durable and deterministic LIFO order.
create table public.clinic_undo_actor_state (
    actor_id uuid primary key,
    last_sequence bigint not null default 0 check (last_sequence >= 0)
);

create table public.clinic_undo_transactions (
    operation_id uuid primary key default gen_random_uuid(),
    actor_id uuid not null,
    actor_sequence bigint not null check (actor_sequence > 0),
    database_transaction_id bigint not null,
    entity_type text not null
        check (entity_type in ('patients', 'appointments', 'queue_entries')),
    operation_type text not null
        check (operation_type in ('create', 'update', 'delete', 'cancel', 'status_update', 'requeue')),
    record_id uuid not null,
    before_snapshot jsonb,
    after_snapshot jsonb,
    created_at timestamptz not null default clock_timestamp(),
    is_undone boolean not null default false,
    undone_at timestamptz,
    constraint clinic_undo_transactions_actor_sequence_key
        unique (actor_id, actor_sequence),
    constraint clinic_undo_transactions_undone_state_check
        check (
            (is_undone and undone_at is not null)
            or (not is_undone and undone_at is null)
        )
);

create index clinic_undo_transactions_actor_top_idx
    on public.clinic_undo_transactions (actor_id, actor_sequence desc)
    where is_undone is false;

create index clinic_undo_transactions_actor_transaction_idx
    on public.clinic_undo_transactions (
        actor_id, database_transaction_id, entity_type, operation_type, record_id
    )
    where is_undone is false;

-- Undo suppression is transaction-local and server-controlled. It prevents
-- the inverse DML from becoming a new, immediately undoable transaction.
create table public.clinic_undo_context (
    backend_pid integer not null,
    actor_id uuid not null,
    operation_id uuid not null,
    primary key (backend_pid, actor_id)
);

-- A BEFORE DELETE trigger stages only links cleared by the corresponding
-- referential action. The AFTER DELETE ledger trigger moves them to the
-- operation-keyed sidecar in the same transaction.
create table public.clinic_undo_consultation_link_staging (
    backend_pid integer not null,
    database_transaction_id bigint not null,
    actor_id uuid not null,
    entity_type text not null
        check (entity_type in ('appointments', 'queue_entries')),
    record_id uuid not null,
    operation_id uuid not null,
    consultation_id uuid not null,
    relationship_column text not null
        check (relationship_column in ('appointment_id', 'queue_entry_id')),
    linked_record_id uuid not null,
    primary key (operation_id, consultation_id, relationship_column)
);

create index clinic_undo_consultation_link_staging_match_idx
    on public.clinic_undo_consultation_link_staging (
        backend_pid, database_transaction_id, actor_id, entity_type, record_id
    );

create table public.clinic_undo_consultation_links (
    operation_id uuid not null
        references public.clinic_undo_transactions (operation_id) on delete cascade,
    consultation_id uuid not null,
    relationship_column text not null
        check (relationship_column in ('appointment_id', 'queue_entry_id')),
    linked_record_id uuid not null,
    primary key (operation_id, consultation_id, relationship_column)
);

alter table public.clinic_undo_actor_state enable row level security;
alter table public.clinic_undo_transactions enable row level security;
alter table public.clinic_undo_context enable row level security;
alter table public.clinic_undo_consultation_link_staging enable row level security;
alter table public.clinic_undo_consultation_links enable row level security;

revoke all on table public.clinic_undo_actor_state from public, anon, authenticated;
revoke all on table public.clinic_undo_transactions from public, anon, authenticated;
revoke all on table public.clinic_undo_context from public, anon, authenticated;
revoke all on table public.clinic_undo_consultation_link_staging from public, anon, authenticated;
revoke all on table public.clinic_undo_consultation_links from public, anon, authenticated;

alter table public.clinic_undo_actor_state owner to postgres;
alter table public.clinic_undo_transactions owner to postgres;
alter table public.clinic_undo_context owner to postgres;
alter table public.clinic_undo_consultation_link_staging owner to postgres;
alter table public.clinic_undo_consultation_links owner to postgres;

comment on table public.clinic_undo_transactions is
    'Private, append-oriented Undo ledger. before_snapshot and after_snapshot can contain patient data.';
comment on table public.clinic_undo_actor_state is
    'Private per-actor serialization row and monotonic Undo sequence.';
comment on table public.clinic_undo_context is
    'Private transaction-local marker used to suppress Undo-trigger recursion.';
comment on table public.clinic_undo_consultation_link_staging is
    'Private transaction-local staging for consultation links affected by appointment or queue deletion.';
comment on table public.clinic_undo_consultation_links is
    'Private consultation FK values associated with the exact parent DELETE Undo operation.';

create function public.clinic_undo_authorized_actor()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := auth.uid();
begin
    if v_actor_id is null or not public.is_clinic_staff() then
        return null;
    end if;

    if not exists (
        select 1
        from public.profiles as profile
        where profile.id = v_actor_id
          and profile.is_active is true
          and profile.role::text in ('admin', 'receptionist')
    ) then
        return null;
    end if;

    return v_actor_id;
end;
$$;

create function public.lock_clinic_undo_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid;
begin
    v_actor_id := public.clinic_undo_authorized_actor();
    if v_actor_id is null then
        return null;
    end if;

    if exists (
        select 1
        from public.clinic_undo_context as context
        where context.backend_pid = pg_backend_pid()
          and context.actor_id = v_actor_id
    ) then
        return null;
    end if;

    insert into public.clinic_undo_actor_state (actor_id, last_sequence)
    values (v_actor_id, 0)
    on conflict (actor_id) do nothing;

    perform 1
    from public.clinic_undo_actor_state as actor_state
    where actor_state.actor_id = v_actor_id
    for update;

    return null;
end;
$$;

create function public.stage_clinic_undo_consultation_links()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid;
    v_operation_id uuid;
    v_database_transaction_id bigint;
    v_relationship_column text;
    v_consultation record;
begin
    v_actor_id := public.clinic_undo_authorized_actor();
    if v_actor_id is null then
        return old;
    end if;

    if exists (
        select 1
        from public.clinic_undo_context as context
        where context.backend_pid = pg_backend_pid()
          and context.actor_id = v_actor_id
    ) then
        return old;
    end if;

    v_operation_id := gen_random_uuid();
    v_database_transaction_id := txid_current();

    if tg_table_name = 'appointments' then
        v_relationship_column := 'appointment_id';
        for v_consultation in
            select consultation.id as consultation_id,
                   consultation.appointment_id as linked_record_id
            from public.consultations as consultation
            where consultation.appointment_id = old.id
            order by consultation.id
            for update
        loop
            insert into public.clinic_undo_consultation_link_staging (
                backend_pid,
                database_transaction_id,
                actor_id,
                entity_type,
                record_id,
                operation_id,
                consultation_id,
                relationship_column,
                linked_record_id
            )
            values (
                pg_backend_pid(),
                v_database_transaction_id,
                v_actor_id,
                tg_table_name,
                old.id,
                v_operation_id,
                v_consultation.consultation_id,
                v_relationship_column,
                v_consultation.linked_record_id
            );
        end loop;
    elsif tg_table_name = 'queue_entries' then
        v_relationship_column := 'queue_entry_id';
        for v_consultation in
            select consultation.id as consultation_id,
                   consultation.queue_entry_id as linked_record_id
            from public.consultations as consultation
            where consultation.queue_entry_id = old.id
            order by consultation.id
            for update
        loop
            insert into public.clinic_undo_consultation_link_staging (
                backend_pid,
                database_transaction_id,
                actor_id,
                entity_type,
                record_id,
                operation_id,
                consultation_id,
                relationship_column,
                linked_record_id
            )
            values (
                pg_backend_pid(),
                v_database_transaction_id,
                v_actor_id,
                tg_table_name,
                old.id,
                v_operation_id,
                v_consultation.consultation_id,
                v_relationship_column,
                v_consultation.linked_record_id
            );
        end loop;
    else
        raise exception 'Consultation links can only be staged for appointment or queue-entry deletion.';
    end if;

    return old;
end;
$$;

create function public.capture_clinic_undo_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid;
    v_before jsonb;
    v_after jsonb;
    v_entity_type text := tg_table_name;
    v_operation_type text;
    v_record_id uuid;
    v_actor_sequence bigint;
    v_database_transaction_id bigint;
    v_operation_id uuid;
    v_staged_operation_id uuid;
    v_transferred_count integer;
    v_staged_count integer;
begin
    v_actor_id := public.clinic_undo_authorized_actor();
    if v_actor_id is null then
        return null;
    end if;

    if exists (
        select 1
        from public.clinic_undo_context as context
        where context.backend_pid = pg_backend_pid()
          and context.actor_id = v_actor_id
    ) then
        return null;
    end if;

    if tg_op = 'INSERT' then
        v_after := to_jsonb(new);
        v_operation_type := 'create';
    elsif tg_op = 'DELETE' then
        v_before := to_jsonb(old);
        v_operation_type := 'delete';
    else
        v_before := to_jsonb(old);
        v_after := to_jsonb(new);

        if v_before is not distinct from v_after then
            return null;
        end if;

        if v_entity_type = 'appointments' then
            if old.status is distinct from new.status
                and new.status = 'Cancelled' then
                v_operation_type := 'cancel';
            else
                v_operation_type := 'update';
            end if;
        elsif v_entity_type = 'queue_entries' then
            if old.status is distinct from new.status then
                if new.status = 'Waiting'
                    and (
                        old.queue_date is distinct from new.queue_date
                        or old.created_at is distinct from new.created_at
                    ) then
                    v_operation_type := 'requeue';
                else
                    v_operation_type := 'status_update';
                end if;
            else
                v_operation_type := 'update';
            end if;
        else
            v_operation_type := 'update';
        end if;
    end if;

    v_record_id := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
    v_database_transaction_id := txid_current();

    if tg_op = 'DELETE'
        and v_entity_type in ('appointments', 'queue_entries') then
        select staging.operation_id
        into v_staged_operation_id
        from public.clinic_undo_consultation_link_staging as staging
        where staging.backend_pid = pg_backend_pid()
          and staging.database_transaction_id = v_database_transaction_id
          and staging.actor_id = v_actor_id
          and staging.entity_type = v_entity_type
          and staging.record_id = v_record_id
        limit 1
        for update;
    end if;

    update public.clinic_undo_actor_state as actor_state
    set last_sequence = actor_state.last_sequence + 1
    where actor_state.actor_id = v_actor_id
    returning actor_state.last_sequence into v_actor_sequence;

    if not found then
        raise exception 'Undo actor sequence was not initialized.';
    end if;

    insert into public.clinic_undo_transactions (
        operation_id,
        actor_id,
        actor_sequence,
        entity_type,
        operation_type,
        record_id,
        database_transaction_id,
        before_snapshot,
        after_snapshot
    )
    values (
        coalesce(v_staged_operation_id, gen_random_uuid()),
        v_actor_id,
        v_actor_sequence,
        v_entity_type,
        v_operation_type,
        v_record_id,
        v_database_transaction_id,
        v_before,
        v_after
    )
    returning operation_id into v_operation_id;

    if v_staged_operation_id is not null then
        insert into public.clinic_undo_consultation_links (
            operation_id,
            consultation_id,
            relationship_column,
            linked_record_id
        )
        select
            v_operation_id,
            staging.consultation_id,
            staging.relationship_column,
            staging.linked_record_id
        from public.clinic_undo_consultation_link_staging as staging
        where staging.backend_pid = pg_backend_pid()
          and staging.database_transaction_id = v_database_transaction_id
          and staging.actor_id = v_actor_id
          and staging.entity_type = v_entity_type
          and staging.record_id = v_record_id
          and staging.operation_id = v_staged_operation_id;

        get diagnostics v_transferred_count = row_count;
        if v_transferred_count < 1 then
            raise exception 'Staged consultation links could not be associated with the Undo operation.';
        end if;

        delete from public.clinic_undo_consultation_link_staging as staging
        where staging.backend_pid = pg_backend_pid()
          and staging.database_transaction_id = v_database_transaction_id
          and staging.actor_id = v_actor_id
          and staging.entity_type = v_entity_type
          and staging.record_id = v_record_id
          and staging.operation_id = v_staged_operation_id;

        get diagnostics v_staged_count = row_count;
        if v_staged_count <> v_transferred_count then
            raise exception 'Staged consultation links were not completely transferred.';
        end if;
    end if;

    return null;
end;
$$;

alter function public.clinic_undo_authorized_actor() owner to postgres;
alter function public.lock_clinic_undo_actor() owner to postgres;
alter function public.stage_clinic_undo_consultation_links() owner to postgres;
alter function public.capture_clinic_undo_transaction() owner to postgres;
revoke all on function public.clinic_undo_authorized_actor() from public, anon, authenticated;
revoke all on function public.lock_clinic_undo_actor() from public, anon, authenticated;
revoke all on function public.stage_clinic_undo_consultation_links() from public, anon, authenticated;
revoke all on function public.capture_clinic_undo_transaction() from public, anon, authenticated;

create trigger clinic_undo_lock_actor
before insert or update or delete on public.patients
for each statement execute function public.lock_clinic_undo_actor();

create trigger clinic_undo_capture_patient
after insert or update or delete on public.patients
for each row execute function public.capture_clinic_undo_transaction();

create trigger clinic_undo_lock_appointment_actor
before insert or update or delete on public.appointments
for each statement execute function public.lock_clinic_undo_actor();

create trigger clinic_undo_stage_appointment_consultation_links
before delete on public.appointments
for each row execute function public.stage_clinic_undo_consultation_links();

create trigger clinic_undo_capture_appointment
after insert or update or delete on public.appointments
for each row execute function public.capture_clinic_undo_transaction();

create trigger clinic_undo_lock_queue_actor
before insert or update or delete on public.queue_entries
for each statement execute function public.lock_clinic_undo_actor();

create trigger clinic_undo_stage_queue_consultation_links
before delete on public.queue_entries
for each row execute function public.stage_clinic_undo_consultation_links();

create trigger clinic_undo_capture_queue_entry
after insert or update or delete on public.queue_entries
for each row execute function public.capture_clinic_undo_transaction();

-- Return only metadata for the authenticated actor. Snapshot data remains
-- inaccessible through PostgREST and is read only inside the Undo RPC.
create function public.clinic_undo_history(p_limit integer default 25)
returns table (
    operation_id uuid,
    actor_sequence bigint,
    entity_type text,
    operation_type text,
    record_id uuid,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid;
begin
    v_actor_id := public.clinic_undo_authorized_actor();
    if v_actor_id is null then
        raise exception using errcode = '42501', message = 'Active clinic staff access is required.';
    end if;

    return query
    select
        undo_item.operation_id,
        undo_item.actor_sequence,
        undo_item.entity_type,
        undo_item.operation_type,
        undo_item.record_id,
        undo_item.created_at
    from public.clinic_undo_transactions as undo_item
    where undo_item.actor_id = v_actor_id
      and undo_item.is_undone is false
    order by undo_item.actor_sequence desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- Undo only the caller's newest active entry. The actor-state row serializes
-- concurrent writes and Undo requests; any error aborts the data change and
-- the ledger update together. The optional operation ID prevents stale UI
-- state from undoing a different top entry.
create function public.clinic_undo_latest(p_operation_id uuid default null)
returns table (
    operation_id uuid,
    actor_sequence bigint,
    entity_type text,
    operation_type text,
    record_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid;
    v_entry public.clinic_undo_transactions%rowtype;
    v_current jsonb;
    v_patient public.patients%rowtype;
    v_appointment public.appointments%rowtype;
    v_queue_entry public.queue_entries%rowtype;
    v_linked_entry public.clinic_undo_transactions%rowtype;
    v_consultation_link public.clinic_undo_consultation_links%rowtype;
    v_current_link uuid;
    v_requested_operation_id uuid;
    v_affected integer;
begin
    v_actor_id := public.clinic_undo_authorized_actor();
    if v_actor_id is null then
        raise exception using errcode = '42501', message = 'Active clinic staff access is required.';
    end if;

    insert into public.clinic_undo_actor_state (actor_id, last_sequence)
    values (v_actor_id, 0)
    on conflict (actor_id) do nothing;

    perform 1
    from public.clinic_undo_actor_state as actor_state
    where actor_state.actor_id = v_actor_id
    for update;

    select undo_item.*
    into v_entry
    from public.clinic_undo_transactions as undo_item
    where undo_item.actor_id = v_actor_id
      and undo_item.is_undone is false
    order by undo_item.actor_sequence desc
    limit 1
    for update;

    if not found then
        raise exception using errcode = 'P0002', message = 'There is no Undo transaction available.';
    end if;

    v_requested_operation_id := v_entry.operation_id;
    if p_operation_id is not null
        and p_operation_id is distinct from v_requested_operation_id then
        raise exception using errcode = '40001', message = 'The Undo history changed. Refresh it and try again.';
    end if;

    -- Deleting an appointment can SET NULL on queue_entries.appointment_id.
    -- If that row-level update is the newest ledger entry, treat it together
    -- with its parent appointment delete; the transaction ID ties both events
    -- to the same authenticated database transaction.
    if v_entry.entity_type = 'queue_entries'
        and v_entry.operation_type = 'update'
        and v_entry.before_snapshot ->> 'appointment_id' is not null
        and v_entry.after_snapshot ->> 'appointment_id' is null then
        select undo_item.*
        into v_linked_entry
        from public.clinic_undo_transactions as undo_item
        where undo_item.actor_id = v_actor_id
          and undo_item.database_transaction_id = v_entry.database_transaction_id
          and undo_item.entity_type = 'appointments'
          and undo_item.operation_type = 'delete'
          and undo_item.record_id = (v_entry.before_snapshot ->> 'appointment_id')::uuid
          and undo_item.is_undone is false
        order by undo_item.actor_sequence desc
        limit 1
        for update;

        if found then
            v_entry := v_linked_entry;
        end if;
    end if;

    insert into public.clinic_undo_context (backend_pid, actor_id, operation_id)
    values (pg_backend_pid(), v_actor_id, v_entry.operation_id);

    if v_entry.operation_type = 'create' then
        if v_entry.after_snapshot is null then
            raise exception 'The created record snapshot is missing.';
        end if;

        if v_entry.entity_type = 'patients' then
            select to_jsonb(patient)
            into v_current
            from public.patients as patient
            where patient.id = v_entry.record_id
            for update;
        elsif v_entry.entity_type = 'appointments' then
            select to_jsonb(appointment)
            into v_current
            from public.appointments as appointment
            where appointment.id = v_entry.record_id
            for update;
        elsif v_entry.entity_type = 'queue_entries' then
            select to_jsonb(queue_entry)
            into v_current
            from public.queue_entries as queue_entry
            where queue_entry.id = v_entry.record_id
            for update;
        else
            raise exception 'Unsupported Undo entity.';
        end if;

        if not found then
            raise exception using errcode = '40001', message = 'The created record no longer exists.';
        end if;
        if v_current is distinct from v_entry.after_snapshot then
            raise exception using errcode = '40001', message = 'The record changed after this transaction; Undo was not applied.';
        end if;

        -- Appointment deletion would SET NULL on a linked queue entry. Refuse
        -- rather than silently changing that relationship during Undo.
        if v_entry.entity_type = 'appointments'
            and (
                exists (
                    select 1
                    from public.queue_entries as queue_entry
                    where queue_entry.appointment_id = v_entry.record_id
                )
                or exists (
                    select 1
                    from public.consultations as consultation
                    where consultation.appointment_id = v_entry.record_id
                )
            ) then
            raise exception using errcode = '23503', message = 'The appointment is linked to another record and cannot be undone.';
        end if;

        if v_entry.entity_type = 'patients'
            and (
                exists (
                    select 1
                    from public.appointments as appointment
                    where appointment.patient_id = v_entry.record_id
                )
                or exists (
                    select 1
                    from public.queue_entries as queue_entry
                    where queue_entry.patient_id = v_entry.record_id
                )
                or exists (
                    select 1
                    from public.consultations as consultation
                    where consultation.patient_id = v_entry.record_id
                )
            ) then
            raise exception using errcode = '23503', message = 'The patient is linked to another record and cannot be undone.';
        end if;

        if v_entry.entity_type = 'queue_entries'
            and exists (
                select 1
                from public.consultations as consultation
                where consultation.queue_entry_id = v_entry.record_id
            ) then
            raise exception using errcode = '23503', message = 'The queue entry is linked to a consultation and cannot be undone.';
        end if;

        if v_entry.entity_type = 'patients' then
            delete from public.patients
            where id = v_entry.record_id;
        elsif v_entry.entity_type = 'appointments' then
            delete from public.appointments
            where id = v_entry.record_id;
        else
            delete from public.queue_entries
            where id = v_entry.record_id;
        end if;

        get diagnostics v_affected = row_count;
        if v_affected <> 1 then
            raise exception using errcode = '40001', message = 'The record could not be safely removed.';
        end if;
    elsif v_entry.operation_type in ('update', 'cancel', 'status_update', 'requeue') then
        if v_entry.before_snapshot is null or v_entry.after_snapshot is null then
            raise exception 'The update snapshots are incomplete.';
        end if;

        if v_entry.entity_type = 'patients' then
            select to_jsonb(patient)
            into v_current
            from public.patients as patient
            where patient.id = v_entry.record_id
            for update;
        elsif v_entry.entity_type = 'appointments' then
            select to_jsonb(appointment)
            into v_current
            from public.appointments as appointment
            where appointment.id = v_entry.record_id
            for update;
        elsif v_entry.entity_type = 'queue_entries' then
            select to_jsonb(queue_entry)
            into v_current
            from public.queue_entries as queue_entry
            where queue_entry.id = v_entry.record_id
            for update;
        else
            raise exception 'Unsupported Undo entity.';
        end if;

        if not found then
            raise exception using errcode = '40001', message = 'The updated record no longer exists.';
        end if;
        if v_current is distinct from v_entry.after_snapshot then
            raise exception using errcode = '40001', message = 'The record changed after this transaction; Undo was not applied.';
        end if;

        if v_entry.entity_type = 'patients' then
            v_patient := jsonb_populate_record(null::public.patients, v_entry.before_snapshot);
            if v_patient.id is distinct from v_entry.record_id then
                raise exception 'The patient snapshot has an unexpected ID.';
            end if;
            update public.patients as patient
            set id = v_patient.id,
                patient_code = v_patient.patient_code,
                user_id = v_patient.user_id,
                full_name = v_patient.full_name,
                email = v_patient.email,
                phone = v_patient.phone,
                gender = v_patient.gender,
                birth_date = v_patient.birth_date,
                address = v_patient.address,
                status = v_patient.status,
                created_at = v_patient.created_at
            where patient.id = v_entry.record_id;
        elsif v_entry.entity_type = 'appointments' then
            v_appointment := jsonb_populate_record(null::public.appointments, v_entry.before_snapshot);
            if v_appointment.id is distinct from v_entry.record_id then
                raise exception 'The appointment snapshot has an unexpected ID.';
            end if;
            update public.appointments as appointment
            set id = v_appointment.id,
                appointment_code = v_appointment.appointment_code,
                patient_id = v_appointment.patient_id,
                doctor_id = v_appointment.doctor_id,
                department_id = v_appointment.department_id,
                appointment_date = v_appointment.appointment_date,
                reason = v_appointment.reason,
                status = v_appointment.status,
                notes = v_appointment.notes,
                created_at = v_appointment.created_at,
                appointment_time = v_appointment.appointment_time
            where appointment.id = v_entry.record_id;
        else
            v_queue_entry := jsonb_populate_record(null::public.queue_entries, v_entry.before_snapshot);
            if v_queue_entry.id is distinct from v_entry.record_id then
                raise exception 'The queue snapshot has an unexpected ID.';
            end if;
            update public.queue_entries as queue_entry
            set id = v_queue_entry.id,
                queue_number = v_queue_entry.queue_number,
                patient_id = v_queue_entry.patient_id,
                doctor_id = v_queue_entry.doctor_id,
                department_id = v_queue_entry.department_id,
                appointment_id = v_queue_entry.appointment_id,
                queue_date = v_queue_entry.queue_date,
                priority = v_queue_entry.priority,
                status = v_queue_entry.status,
                called_at = v_queue_entry.called_at,
                created_at = v_queue_entry.created_at
            where queue_entry.id = v_entry.record_id;
        end if;

        get diagnostics v_affected = row_count;
        if v_affected <> 1 then
            raise exception using errcode = '40001', message = 'The record could not be safely restored.';
        end if;
    elsif v_entry.operation_type = 'delete' then
        if v_entry.before_snapshot is null then
            raise exception 'The deleted record snapshot is missing.';
        end if;

        if v_entry.entity_type = 'patients' then
            v_patient := jsonb_populate_record(null::public.patients, v_entry.before_snapshot);
            if v_patient.id is distinct from v_entry.record_id then
                raise exception 'The deleted patient snapshot has an unexpected ID.';
            end if;
            if v_patient.user_id is not null
                and not exists (
                    select 1
                    from public.profiles as profile
                    where profile.id = v_patient.user_id
                ) then
                raise exception using errcode = '23503', message = 'The patient profile no longer exists; the patient cannot be restored.';
            end if;

            insert into public.patients (
                id, patient_code, user_id, full_name, email, phone, gender,
                birth_date, address, status, created_at
            )
            values (
                v_patient.id, v_patient.patient_code, v_patient.user_id,
                v_patient.full_name, v_patient.email, v_patient.phone,
                v_patient.gender, v_patient.birth_date, v_patient.address,
                v_patient.status, v_patient.created_at
            );
        elsif v_entry.entity_type = 'appointments' then
            v_appointment := jsonb_populate_record(null::public.appointments, v_entry.before_snapshot);
            if v_appointment.id is distinct from v_entry.record_id then
                raise exception 'The deleted appointment snapshot has an unexpected ID.';
            end if;
            if not exists (
                select 1 from public.patients as patient
                where patient.id = v_appointment.patient_id
            ) or not exists (
                select 1 from public.doctors as doctor
                where doctor.id = v_appointment.doctor_id
            ) or not exists (
                select 1 from public.departments as department
                where department.id = v_appointment.department_id
            ) then
                raise exception using errcode = '23503', message = 'A referenced patient, doctor, or department no longer exists; the appointment cannot be restored.';
            end if;

            insert into public.appointments (
                id, appointment_code, patient_id, doctor_id, department_id,
                appointment_date, reason, status, notes, created_at, appointment_time
            )
            values (
                v_appointment.id, v_appointment.appointment_code, v_appointment.patient_id,
                v_appointment.doctor_id, v_appointment.department_id,
                v_appointment.appointment_date, v_appointment.reason, v_appointment.status,
                v_appointment.notes, v_appointment.created_at, v_appointment.appointment_time
            );

            for v_consultation_link in
                select consultation_link.*
                from public.clinic_undo_consultation_links as consultation_link
                where consultation_link.operation_id = v_entry.operation_id
                  and consultation_link.relationship_column = 'appointment_id'
                order by consultation_link.consultation_id
                for update
            loop
                if v_consultation_link.linked_record_id is distinct from v_entry.record_id then
                    raise exception 'A consultation appointment link has an unexpected target.';
                end if;

                select consultation.appointment_id
                into v_current_link
                from public.consultations as consultation
                where consultation.id = v_consultation_link.consultation_id
                for update;

                if not found or v_current_link is not null then
                    raise exception using errcode = '40001', message = 'A consultation is missing or its appointment link changed after deletion; Undo was not applied.';
                end if;

                update public.consultations as consultation
                set appointment_id = v_consultation_link.linked_record_id
                where consultation.id = v_consultation_link.consultation_id
                  and consultation.appointment_id is null;

                get diagnostics v_affected = row_count;
                if v_affected <> 1 then
                    raise exception using errcode = '40001', message = 'A consultation appointment link could not be safely restored.';
                end if;
            end loop;

            -- Restore queue links that the appointment DELETE changed through
            -- ON DELETE SET NULL. Only matching updates from this exact database
            -- transaction are grouped with the appointment deletion.
            for v_linked_entry in
                select undo_item.*
                from public.clinic_undo_transactions as undo_item
                where undo_item.actor_id = v_actor_id
                  and undo_item.database_transaction_id = v_entry.database_transaction_id
                  and undo_item.entity_type = 'queue_entries'
                  and undo_item.operation_type = 'update'
                  and undo_item.before_snapshot ->> 'appointment_id' = v_entry.record_id::text
                  and undo_item.after_snapshot ->> 'appointment_id' is null
                  and undo_item.is_undone is false
                order by undo_item.actor_sequence
                for update
            loop
                if v_linked_entry.before_snapshot is null
                    or v_linked_entry.after_snapshot is null then
                    raise exception 'A linked queue entry snapshot is incomplete.';
                end if;

                v_queue_entry := jsonb_populate_record(null::public.queue_entries, v_linked_entry.before_snapshot);
                if v_queue_entry.id is distinct from v_linked_entry.record_id
                    or v_queue_entry.appointment_id is distinct from v_entry.record_id then
                    raise exception 'A linked queue entry snapshot has an unexpected ID or appointment.';
                end if;

                select to_jsonb(queue_entry)
                into v_current
                from public.queue_entries as queue_entry
                where queue_entry.id = v_linked_entry.record_id
                for update;

                if not found or v_current is distinct from v_linked_entry.after_snapshot then
                    raise exception using errcode = '40001', message = 'A linked queue entry changed after the appointment was deleted; Undo was not applied.';
                end if;

                update public.queue_entries as queue_entry
                set id = v_queue_entry.id,
                    queue_number = v_queue_entry.queue_number,
                    patient_id = v_queue_entry.patient_id,
                    doctor_id = v_queue_entry.doctor_id,
                    department_id = v_queue_entry.department_id,
                    appointment_id = v_queue_entry.appointment_id,
                    queue_date = v_queue_entry.queue_date,
                    priority = v_queue_entry.priority,
                    status = v_queue_entry.status,
                    called_at = v_queue_entry.called_at,
                    created_at = v_queue_entry.created_at
                where queue_entry.id = v_linked_entry.record_id;

                get diagnostics v_affected = row_count;
                if v_affected <> 1 then
                    raise exception using errcode = '40001', message = 'A linked queue entry could not be safely restored.';
                end if;

                update public.clinic_undo_transactions as undo_item
                set is_undone = true,
                    undone_at = clock_timestamp()
                where undo_item.operation_id = v_linked_entry.operation_id
                  and undo_item.actor_id = v_actor_id
                  and undo_item.is_undone is false;

                get diagnostics v_affected = row_count;
                if v_affected <> 1 then
                    raise exception using errcode = '40001', message = 'The linked queue Undo history changed before restoration completed.';
                end if;
            end loop;
        elsif v_entry.entity_type = 'queue_entries' then
            v_queue_entry := jsonb_populate_record(null::public.queue_entries, v_entry.before_snapshot);
            if v_queue_entry.id is distinct from v_entry.record_id then
                raise exception 'The deleted queue entry snapshot has an unexpected ID.';
            end if;
            if not exists (
                select 1 from public.patients as patient
                where patient.id = v_queue_entry.patient_id
            ) or not exists (
                select 1 from public.doctors as doctor
                where doctor.id = v_queue_entry.doctor_id
            ) or not exists (
                select 1 from public.departments as department
                where department.id = v_queue_entry.department_id
            ) or (
                v_queue_entry.appointment_id is not null
                and not exists (
                    select 1 from public.appointments as appointment
                    where appointment.id = v_queue_entry.appointment_id
                )
            ) then
                raise exception using errcode = '23503', message = 'A referenced patient, doctor, department, or appointment no longer exists; the queue entry cannot be restored.';
            end if;

            insert into public.queue_entries (
                id, queue_number, patient_id, doctor_id, department_id,
                appointment_id, queue_date, priority, status, called_at, created_at
            )
            values (
                v_queue_entry.id, v_queue_entry.queue_number, v_queue_entry.patient_id,
                v_queue_entry.doctor_id, v_queue_entry.department_id,
                v_queue_entry.appointment_id, v_queue_entry.queue_date,
                v_queue_entry.priority, v_queue_entry.status,
                v_queue_entry.called_at, v_queue_entry.created_at
            );

            for v_consultation_link in
                select consultation_link.*
                from public.clinic_undo_consultation_links as consultation_link
                where consultation_link.operation_id = v_entry.operation_id
                  and consultation_link.relationship_column = 'queue_entry_id'
                order by consultation_link.consultation_id
                for update
            loop
                if v_consultation_link.linked_record_id is distinct from v_entry.record_id then
                    raise exception 'A consultation queue-entry link has an unexpected target.';
                end if;

                select consultation.queue_entry_id
                into v_current_link
                from public.consultations as consultation
                where consultation.id = v_consultation_link.consultation_id
                for update;

                if not found or v_current_link is not null then
                    raise exception using errcode = '40001', message = 'A consultation is missing or its queue-entry link changed after deletion; Undo was not applied.';
                end if;

                update public.consultations as consultation
                set queue_entry_id = v_consultation_link.linked_record_id
                where consultation.id = v_consultation_link.consultation_id
                  and consultation.queue_entry_id is null;

                get diagnostics v_affected = row_count;
                if v_affected <> 1 then
                    raise exception using errcode = '40001', message = 'A consultation queue-entry link could not be safely restored.';
                end if;
            end loop;
        else
            raise exception 'Unsupported Undo entity.';
        end if;
    else
        raise exception using errcode = '0A000', message = 'This transaction type cannot be undone.';
    end if;

    delete from public.clinic_undo_context as context
    where context.backend_pid = pg_backend_pid()
      and context.actor_id = v_actor_id
      and context.operation_id = v_entry.operation_id;

    update public.clinic_undo_transactions as undo_item
    set is_undone = true,
        undone_at = clock_timestamp()
    where undo_item.operation_id = v_entry.operation_id
      and undo_item.actor_id = v_actor_id
      and undo_item.is_undone is false;

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
        raise exception using errcode = '40001', message = 'Undo history changed before the operation could be completed.';
    end if;

    return query
    select
        v_entry.operation_id,
        v_entry.actor_sequence,
        v_entry.entity_type,
        v_entry.operation_type,
        v_entry.record_id;
end;
$$;

alter function public.clinic_undo_history(integer) owner to postgres;
alter function public.clinic_undo_latest(uuid) owner to postgres;

comment on function public.clinic_undo_history(integer) is
    'Returns only the authenticated active clinic staff actor''s un-undone transaction metadata; snapshots are never returned.';
comment on function public.clinic_undo_latest(uuid) is
    'SECURITY DEFINER is required for private snapshot access. It checks active clinic staff, actor ownership, LIFO order, and the exact post-operation row before applying an inverse.';

revoke all on function public.clinic_undo_history(integer) from public, anon, authenticated;
revoke all on function public.clinic_undo_latest(uuid) from public, anon, authenticated;
grant execute on function public.clinic_undo_history(integer) to authenticated;
grant execute on function public.clinic_undo_latest(uuid) to authenticated;

commit;
