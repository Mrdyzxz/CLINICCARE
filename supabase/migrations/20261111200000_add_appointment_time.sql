-- Adds an optional appointment time without changing existing appointment rows.
alter table public.appointments
    add column if not exists appointment_time time;
