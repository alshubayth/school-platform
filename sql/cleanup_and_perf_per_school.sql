-- (1) معايير تقييم الأداء: كل مدرسة لها نسختها الخاصة
-- (2) حذف الجداول والعروض القديمة اللي ما تنستخدم
-- شغّله مرة وحدة في Supabase SQL Editor - آمن لو انعاد

-- ========== (1) معايير لكل مدرسة ==========
alter table public.perf_criteria add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.perf_details  add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.perf_settings add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.perf_settings drop constraint if exists perf_settings_singleton;
alter table public.perf_criteria drop constraint if exists perf_criteria_name_key;
create sequence if not exists public.perf_settings_id_seq owned by public.perf_settings.id;
select setval('public.perf_settings_id_seq', greatest((select coalesce(max(id), 1) from public.perf_settings), 1));
alter table public.perf_settings alter column id set default nextval('public.perf_settings_id_seq');

create or replace function public.perf_seed_school(p_school uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare src uuid; c record; nid uuid;
begin
  if exists (select 1 from perf_criteria where school_id = p_school) then return; end if;
  select school_id into src from perf_criteria where school_id is not null and school_id <> p_school group by school_id order by count(*) desc limit 1;
  for c in select * from perf_criteria where school_id is not distinct from src order by sort_order loop
    insert into perf_criteria(name, sort_order, weight, created_at, school_id) values (c.name, c.sort_order, c.weight, now(), p_school) returning id into nid;
    insert into perf_details(criterion_id, name, weight_type, weight_value, active, created_at, school_id)
      select nid, name, weight_type, weight_value, active, now(), p_school from perf_details where criterion_id = c.id;
  end loop;
  if not exists (select 1 from perf_settings where school_id = p_school) then
    insert into perf_settings(academic_year, school_id) select academic_year, p_school from perf_settings where school_id is not distinct from src limit 1;
    if not found then insert into perf_settings(academic_year, school_id) values ('', p_school); end if;
  end if;
end $fn$;
revoke execute on function public.perf_seed_school(uuid) from anon, authenticated, public;

do $$
declare first uuid; s record;
begin
  select id into first from public.schools order by created_at nulls last, id limit 1;
  update public.perf_criteria set school_id = first where school_id is null;
  update public.perf_details  set school_id = first where school_id is null;
  update public.perf_settings set school_id = first where school_id is null;
  for s in select id from public.schools where id <> first loop perform public.perf_seed_school(s.id); end loop;
end $$;

create unique index if not exists perf_criteria_school_name_uq on public.perf_criteria(school_id, name);
create unique index if not exists perf_settings_school_uq on public.perf_settings(school_id);

create or replace function public.perf_seed_new_school() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin perform public.perf_seed_school(new.id); return new; end $fn$;
drop trigger if exists perf_seed_new_school_trg on public.schools;
create trigger perf_seed_new_school_trg after insert on public.schools for each row execute function public.perf_seed_new_school();

create or replace function public.perf_details_school() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.school_id is null then select school_id into new.school_id from perf_criteria where id = new.criterion_id; end if;
  return new;
end $fn$;
drop trigger if exists perf_details_school_trg on public.perf_details;
create trigger perf_details_school_trg before insert on public.perf_details for each row execute function public.perf_details_school();

alter policy perf_criteria_staff_read  on public.perf_criteria using (public.is_school_staff(school_id));
alter policy perf_criteria_admin_write on public.perf_criteria using (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id())) with check (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id()));
alter policy perf_details_staff_read   on public.perf_details  using (public.is_school_staff(school_id));
alter policy perf_details_admin_write  on public.perf_details  using (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id())) with check (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id()));
alter policy perf_settings_staff_read  on public.perf_settings using (public.is_school_staff(school_id));
alter policy perf_settings_admin_write on public.perf_settings using (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id())) with check (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id()));
drop policy if exists perf_settings_admin_insert on public.perf_settings;
create policy perf_settings_admin_insert on public.perf_settings for insert to authenticated
  with check (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id()));

-- ========== (2) حذف القديم غير المستخدم ==========
drop view if exists public.employee_evaluations;
drop view if exists public.weekly_progress;
drop table if exists public.tasks;
drop table if exists public.weeks;
drop table if exists public.operational_plan;
drop table if exists public.notes;
drop table if exists public.indicators;
drop table if exists public.duty_attendance;
drop table if exists public.duty_roster;
drop table if exists public.duty_types;
drop table if exists public._policy_backup;
do $$ begin drop type if exists public.duty_status_type; exception when dependent_objects_still_exist then null; end $$;
do $$ begin drop type if exists public.duty_kind; exception when dependent_objects_still_exist then null; end $$;

notify pgrst, 'reload schema';

select
  (select count(distinct school_id) from public.perf_criteria) as schools_with_criteria,
  (select count(*) from public.perf_criteria where school_id is null) as criteria_without_school,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('tasks','weeks','operational_plan','notes','indicators','duty_attendance','duty_roster','duty_types','_policy_backup','employee_evaluations','weekly_progress')) as old_left;
