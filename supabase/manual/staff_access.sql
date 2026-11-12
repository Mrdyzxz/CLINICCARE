-- Run manually in the Supabase SQL Editor after reviewing existing policies.
-- This does not delete clinic records or Auth users. It disables legacy
-- Doctor/Patient profiles while preserving their role and foreign-key links.

begin;

do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'Expected public.profiles to exist; no changes were applied.';
    end if;

    if not exists (
        select 1
        from public.profiles
        where role = 'admin'
          and is_active is true
    ) then
        raise exception 'No active Admin profile exists. Create/activate an Admin before applying staff access policies.';
    end if;
end;
$$;

update public.profiles
set is_active = false
where role in ('doctor', 'patient')
  and is_active is distinct from false;

create or replace function public.is_clinic_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and is_active is true
          and role in ('admin', 'receptionist')
    );
$$;

create or replace function public.is_clinic_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and is_active is true
          and role = 'admin'
    );
$$;

alter function public.is_clinic_staff() owner to postgres;
alter function public.is_clinic_admin() owner to postgres;
revoke all on function public.is_clinic_staff() from public;
revoke all on function public.is_clinic_admin() from public;
grant execute on function public.is_clinic_staff() to anon, authenticated;
grant execute on function public.is_clinic_admin() to anon, authenticated;

create or replace function public.admin_update_staff_profile(
    p_target_id uuid,
    p_full_name text,
    p_phone text,
    p_role text,
    p_is_active boolean
)
returns table (id uuid, role text, is_active boolean)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
    v_actor_id uuid := auth.uid();
    v_target public.profiles%rowtype;
    v_locked_admin_id uuid;
    v_active_admin_count integer;
begin
    if v_actor_id is null then
        raise exception using errcode = '42501', message = 'An authenticated Admin is required.';
    end if;

    if p_target_id is null
        or p_full_name is null
        or btrim(p_full_name) = ''
        or p_phone is null
        or btrim(p_phone) = ''
        or p_role is null
        or p_role not in ('admin', 'receptionist')
        or p_is_active is null then
        raise exception using errcode = '22023', message = 'Invalid staff profile details.';
    end if;

    if not exists (
        select 1
        from public.profiles as actor
        where actor.id = v_actor_id
          and actor.role = 'admin'
          and actor.is_active is true
    ) then
        raise exception using errcode = '42501', message = 'Only an active Admin can update staff profiles.';
    end if;

    for v_locked_admin_id in
        select profile.id
        from public.profiles as profile
        where profile.role = 'admin'
          and profile.is_active is true
        order by profile.id
        for update
    loop
        null;
    end loop;

    if not exists (
        select 1
        from public.profiles as actor
        where actor.id = v_actor_id
          and actor.role = 'admin'
          and actor.is_active is true
    ) then
        raise exception using errcode = '42501', message = 'Only an active Admin can update staff profiles.';
    end if;

    select count(*)
    into v_active_admin_count
    from public.profiles as profile
    where profile.role = 'admin'
      and profile.is_active is true;

    select profile.*
    into v_target
    from public.profiles as profile
    where profile.id = p_target_id
    for update;

    if not found then
        raise exception using errcode = 'P0002', message = 'The target profile does not exist.';
    end if;

    if v_target.role = 'patient' then
        if v_target.is_active is not true or not exists (
            select 1
            from auth.users as auth_user
            where auth_user.id = p_target_id
              and auth_user.invited_at is not null
        ) then
            raise exception using errcode = '42501', message = 'Only a newly invited Patient profile can be promoted to staff.';
        end if;
    elsif v_target.role in ('admin', 'receptionist') then
        null;
    else
        raise exception using errcode = '42501', message = 'Legacy Doctor and Patient profiles cannot be converted to staff.';
    end if;

    if p_target_id = v_actor_id
        and (p_role <> 'admin' or p_is_active is not true) then
        raise exception using errcode = '23514', message = 'You cannot demote or deactivate your own Admin account.';
    end if;

    if v_target.role = 'admin'
        and v_target.is_active is true
        and (p_role <> 'admin' or p_is_active is not true)
        and v_active_admin_count <= 1 then
        raise exception using errcode = '23514', message = 'The last active Admin cannot be demoted or deactivated.';
    end if;

    update public.profiles as profile
    set full_name = btrim(p_full_name),
        phone = btrim(p_phone),
        role = p_role,
        is_active = p_is_active
    where profile.id = p_target_id;

    return query
    select profile.id, profile.role::text, profile.is_active
    from public.profiles as profile
    where profile.id = p_target_id;
end;
$$;

alter function public.admin_update_staff_profile(uuid, text, text, text, boolean) owner to postgres;
revoke all on function public.admin_update_staff_profile(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_staff_profile(uuid, text, text, text, boolean) to authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'patients',
        'doctors',
        'appointments',
        'queue_entries',
        'consultations'
    ]
    loop
        execute format('alter table public.%I enable row level security', table_name);
        execute format('drop policy if exists clinic_staff_access on public.%I', table_name);
        execute format('drop policy if exists clinic_staff_access_guard on public.%I', table_name);
        execute format(
            'create policy clinic_staff_access on public.%I as permissive for all to authenticated using (public.is_clinic_staff()) with check (public.is_clinic_staff())',
            table_name
        );
        execute format(
            'create policy clinic_staff_access_guard on public.%I as restrictive for all to public using (public.is_clinic_staff()) with check (public.is_clinic_staff())',
            table_name
        );
    end loop;
end;
$$;

alter table public.profiles enable row level security;
drop policy if exists clinic_profiles_staff_read on public.profiles;
drop policy if exists clinic_profiles_staff_read_guard on public.profiles;
drop policy if exists clinic_profiles_admin_insert on public.profiles;
drop policy if exists clinic_profiles_admin_insert_guard on public.profiles;
drop policy if exists clinic_profiles_admin_update on public.profiles;
drop policy if exists clinic_profiles_admin_update_guard on public.profiles;
drop policy if exists clinic_profiles_admin_delete on public.profiles;
drop policy if exists clinic_profiles_admin_delete_guard on public.profiles;
drop policy if exists clinic_profiles_no_direct_insert on public.profiles;
drop policy if exists clinic_profiles_no_direct_update on public.profiles;
drop policy if exists clinic_profiles_no_direct_delete on public.profiles;

create policy clinic_profiles_staff_read_guard on public.profiles
    as restrictive for select to public
    using (public.is_clinic_staff());
create policy clinic_profiles_no_direct_insert on public.profiles
    as restrictive for insert to public
    with check (false);
create policy clinic_profiles_no_direct_update on public.profiles
    as restrictive for update to public
    using (false)
    with check (false);
create policy clinic_profiles_no_direct_delete on public.profiles
    as restrictive for delete to public
    using (false);

alter table public.departments enable row level security;
drop policy if exists "Staff manages departments" on public.departments;
drop policy if exists clinic_departments_staff_read on public.departments;
drop policy if exists clinic_departments_staff_read_guard on public.departments;
drop policy if exists clinic_departments_admin_insert on public.departments;
drop policy if exists clinic_departments_admin_insert_guard on public.departments;
drop policy if exists clinic_departments_admin_update on public.departments;
drop policy if exists clinic_departments_admin_update_guard on public.departments;
drop policy if exists clinic_departments_admin_delete on public.departments;
drop policy if exists clinic_departments_admin_delete_guard on public.departments;
drop policy if exists clinic_departments_staff_insert on public.departments;
drop policy if exists clinic_departments_staff_insert_guard on public.departments;
drop policy if exists clinic_departments_staff_update on public.departments;
drop policy if exists clinic_departments_staff_update_guard on public.departments;
drop policy if exists clinic_departments_staff_delete on public.departments;
drop policy if exists clinic_departments_staff_delete_guard on public.departments;

create policy clinic_departments_staff_read on public.departments
    as permissive for select to authenticated
    using (public.is_clinic_staff());
create policy clinic_departments_staff_read_guard on public.departments
    as restrictive for select to public
    using (public.is_clinic_staff());
create policy clinic_departments_staff_insert on public.departments
    as permissive for insert to authenticated
    with check (public.is_clinic_staff());
create policy clinic_departments_staff_insert_guard on public.departments
    as restrictive for insert to public
    with check (public.is_clinic_staff());
create policy clinic_departments_staff_update on public.departments
    as permissive for update to authenticated
    using (public.is_clinic_staff())
    with check (public.is_clinic_staff());
create policy clinic_departments_staff_update_guard on public.departments
    as restrictive for update to public
    using (public.is_clinic_staff())
    with check (public.is_clinic_staff());
create policy clinic_departments_staff_delete on public.departments
    as permissive for delete to authenticated
    using (public.is_clinic_staff());
create policy clinic_departments_staff_delete_guard on public.departments
    as restrictive for delete to public
    using (public.is_clinic_staff());

commit;
