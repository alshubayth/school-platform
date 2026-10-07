-- كشوف الطلاب: قوالب الكشوف اللي يصممها المعلم أو الإدارة
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير اختر Run anyway) - آمن لو انشغّل أكثر من مرة
--   • كل واحد يدير قوالبه هو
--   • القالب "المشترك" يشوفه كل موظفي المدرسة (المعلم يقدر ينسخه ويعدّل نسخته)
--   • المدير/الوكيل يقدرون يحذفون أو يعدّلون القوالب المشتركة بمدرستهم

create table if not exists public.student_list_templates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null,
  config jsonb not null default '{}'::jsonb,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_list_templates_school_idx on public.student_list_templates (school_id, owner_id);
alter table public.student_list_templates enable row level security;
grant select, insert, update, delete on public.student_list_templates to authenticated;

drop policy if exists slt_read on public.student_list_templates;
create policy slt_read on public.student_list_templates for select to authenticated
  using (public.is_staff_of(school_id) and (owner_id = auth.uid() or shared or public.is_school_staff(school_id)));

drop policy if exists slt_write on public.student_list_templates;
create policy slt_write on public.student_list_templates for all to authenticated
  using (public.is_staff_of(school_id) and (owner_id = auth.uid() or (shared and public.is_school_staff(school_id))))
  with check (public.is_staff_of(school_id) and (owner_id = auth.uid() or public.is_school_staff(school_id)));

-- تفعيل القسم لكل المدارس
insert into public.school_modules (school_id, module_key, enabled)
select id, 'student-lists', true from public.schools
on conflict (school_id, module_key) do nothing;

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'student_list_templates') as templates_table,
  (select count(*) from public.school_modules where module_key = 'student-lists') as schools_enabled;
