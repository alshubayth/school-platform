-- مراجعة الصلاحيات (٢): إقفال الثغرات اللي طلعت في مراجعة سياسات RLS
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير اختر Run anyway)

-- 0) دالة مساعدة: موظف في المدرسة (مدير/وكيل/معلم) - تستبعد حساب ولي الأمر
create or replace function public.is_staff_of(row_school uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_owner() or (public.my_role() in ('admin'::user_role, 'deputy'::user_role, 'teacher'::user_role)
          and row_school is not distinct from public.my_school_id() and public.my_school_id() is not null) $$;
grant execute on function public.is_staff_of(uuid) to authenticated, anon;

-- 1) مفاتيح الإجابة ونماذج الطباعة: للمدير والوكيل فقط (كانت مفتوحة لأي حساب بالمدرسة)
drop policy if exists answer_keys_school_write on public.answer_keys;
drop policy if exists answer_keys_school_read on public.answer_keys;
drop policy if exists answer_keys_managers on public.answer_keys;
create policy answer_keys_managers on public.answer_keys for all to authenticated
  using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));

drop policy if exists overlay_layouts_school_write on public.overlay_layouts;
drop policy if exists overlay_layouts_school_read on public.overlay_layouts;
drop policy if exists overlay_layouts_managers on public.overlay_layouts;
create policy overlay_layouts_managers on public.overlay_layouts for all to authenticated
  using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));

-- 2) غياب الطلاب وسجل ورقة الإجابة بالاختبارات: الموظفين فقط (كان يشمل ولي الأمر)
drop policy if exists staff_write_absences on public.exam_student_absences;
drop policy if exists staff_read_absences on public.exam_student_absences;
drop policy if exists exam_absences_staff on public.exam_student_absences;
create policy exam_absences_staff on public.exam_student_absences for all to authenticated
  using (public.is_staff_of(school_id)) with check (public.is_staff_of(school_id));

drop policy if exists staff_insert_stage_log on public.exam_stage_log;
drop policy if exists staff_read_stage_log on public.exam_stage_log;
drop policy if exists exam_stage_log_staff_insert on public.exam_stage_log;
create policy exam_stage_log_staff_insert on public.exam_stage_log for insert to authenticated
  with check (public.is_staff_of(school_id));
drop policy if exists exam_stage_log_staff_read on public.exam_stage_log;
create policy exam_stage_log_staff_read on public.exam_stage_log for select to authenticated
  using (public.is_staff_of(school_id));

-- 3) قراءة بيانات العمل الداخلية (المناوبة، فرق الاختبارات، البرامج، الأهداف...): الموظفين فقط
do $$
declare tbl text; r record;
begin
  foreach tbl in array array['duty_attendance', 'duty_roster', 'duty_types', 'exam_period_teams', 'exam_subject_assignments',
                             'operational_objectives', 'programs', 'strategic_goals', 'op_plan_settings'] loop
    if to_regclass('public.' || tbl) is null then continue; end if;
    for r in select policyname from pg_policies
              where schemaname = 'public' and tablename = tbl and cmd = 'SELECT' and qual not ilike '%admin%' loop
      execute format('drop policy %I on public.%I', r.policyname, tbl);
    end loop;
    execute format('drop policy if exists %I on public.%I', tbl || '_staff_read', tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff_of(school_id))', tbl || '_staff_read', tbl);
  end loop;
end $$;

-- 4) الخطة الأسبوعية للعامة: المنشورة فقط (كانت كل الخطط مقروءة حتى قبل النشر)
drop policy if exists "الجميع يقرأون الخطة الأسبوعية بدون تسجيل دخول" on public.weekly_plans;
do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'weekly_plans' and cmd = 'SELECT' and qual = 'true' loop
    execute format('drop policy %I on public.weekly_plans', r.policyname);
  end loop;
end $$;
drop policy if exists weekly_plans_published_read on public.weekly_plans;
create policy weekly_plans_published_read on public.weekly_plans for select to anon, authenticated
  using (
    public.is_staff_of(school_id)
    or exists (select 1 from public.weekly_plan_publish_settings s
                where s.week_number = weekly_plans.week_number and s.is_published
                  and s.school_id is not distinct from weekly_plans.school_id)
  );

-- 5) الأدوار: تغيير دور حساب أو نقله لمدرسة ثانية للمدير (أو المالك) فقط - الوكيل ما يقدر يرقّي نفسه
create or replace function public.guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- عمليات الخادم (مفتاح الخدمة)
  if new.role is distinct from old.role or new.school_id is distinct from old.school_id then
    if public.is_owner() then return new; end if;
    if public.my_role() = 'admin'::user_role
       and old.school_id is not distinct from public.my_school_id()
       and new.school_id is not distinct from old.school_id
       and new.role <> 'owner'::user_role then
      return new;
    end if;
    raise exception 'تغيير الدور مسموح لمدير المدرسة فقط';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_role on public.profiles;
create trigger trg_guard_profile_role before update on public.profiles
  for each row execute function public.guard_profile_role();

notify pgrst, 'reload schema';

-- فحص: لازم يطلع 1 لكل عمود
select
  (select count(*) from pg_policies where tablename = 'answer_keys' and policyname = 'answer_keys_managers') as answer_keys,
  (select count(*) from pg_policies where tablename = 'exam_student_absences' and policyname = 'exam_absences_staff') as exam_absences,
  (select count(*) from pg_policies where tablename = 'duty_roster' and policyname = 'duty_roster_staff_read') as duty_read,
  (select count(*) from pg_policies where tablename = 'weekly_plans' and policyname = 'weekly_plans_published_read') as weekly_public,
  (select count(*) from pg_trigger where tgname = 'trg_guard_profile_role') as role_guard;
