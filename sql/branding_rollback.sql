-- التراجع عن sql/branding.sql
begin;
drop function if exists public.set_school_branding(uuid, text, jsonb);
alter table public.schools drop column if exists branding;
commit;
