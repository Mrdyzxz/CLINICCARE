-- Adds directory-owned doctor contact details without changing existing
-- doctor IDs, doctor codes, department links, or profile foreign keys.
begin;

alter table public.doctors
    add column if not exists full_name text,
    add column if not exists email text,
    add column if not exists phone text,
    add column if not exists license_number text;

alter table public.doctors
    alter column profile_id drop not null;

-- Preserve existing linked doctors' names and phone numbers where available.
-- profiles intentionally has no email column; existing emails remain null.
update public.doctors as doctor
set
    full_name = coalesce(doctor.full_name, profile.full_name),
    phone = coalesce(doctor.phone, profile.phone)
from public.profiles as profile
where doctor.profile_id = profile.id
  and (doctor.full_name is null or doctor.phone is null);

commit;
