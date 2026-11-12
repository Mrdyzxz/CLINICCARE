-- Preserve existing queue numbers while allowing formatted values such as
-- Q-2026-001. This migration is safe to re-run if the column is already text.
begin;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'queue_entries'
          and column_name = 'queue_number'
          and data_type <> 'text'
    ) then
        alter table public.queue_entries
            alter column queue_number type text
            using queue_number::text;
    end if;
end
$$;

commit;
