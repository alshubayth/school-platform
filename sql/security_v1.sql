-- =====================================================================
-- تأمين الصلاحيات - الإصدار 1: عزل بيانات كل مدرسة عن المدارس الثانية
-- =====================================================================
-- الجرد بيّن إن أغلب الجداول محمية أصلًا حسب المدرسة. هذا الملف يسد الثغرات اللي لقيناها:
--   1) جداول مفتوحة لأي مستخدم مسجّل من أي مدرسة: answer_keys, overlay_layouts, school_settings
--   2) المدير/الوكيل في أي مدرسة يقدر يعدّل بيانات مدرسة ثانية في:
--      weekly_plans, weekly_admin_notes, weekly_plan_publish_settings, profiles
--   3) المدير في أي مدرسة يشوف/يعدّل زيارات صفية وبنود صرف مدارس ثانية:
--      classroom_visits, budget_expense_items
--   4) صلاحية "متابعة الخطة الأسبوعية" تكشف خطط وتخصصات كل المدارس:
--      weekly_plans, teacher_subjects
--   5) المعلم يقدر يعدّل خطة مدرسة ثانية لو عنده نفس المادة والمرحلة
-- + أي سجل جديد بدون school_id ياخذ مدرسة اللي أضافه تلقائيًا (trigger)
--
-- ما يغيّر: قراءة صفحة أولياء الأمور (الخطة المنشورة، الفترية، أرقام التواصل، الجدول) تبقى مثل ما هي.
-- يتنفّذ كامل أو ما يتنفّذ شي (transaction). للتراجع: sql/security_v1_rollback.sql
-- =====================================================================

begin;

-- أدوات مساعدة (الدالتين my_role و my_school_id موجودة أصلًا بقاعدتكم وتستخدمها السياسات الحالية)
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'owner'::user_role from public.profiles where id = auth.uid()), false) $$;

create or replace function public.same_school(row_school uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_owner() or (row_school is not distinct from public.my_school_id() and public.my_school_id() is not null) $$;

create or replace function public.is_school_staff(row_school uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_owner() or (public.my_role() in ('admin'::user_role, 'deputy'::user_role) and row_school is not distinct from public.my_school_id() and public.my_school_id() is not null) $$;

grant execute on function public.is_owner() to authenticated, anon;
grant execute on function public.same_school(uuid) to authenticated, anon;
grant execute on function public.is_school_staff(uuid) to authenticated, anon;

-- ---------------------------------------------------------------
-- 1) الجداول المفتوحة: مفاتيح الإجابة، نماذج الطباعة، إعدادات المدرسة
-- ---------------------------------------------------------------
drop policy if exists answer_keys_read on public.answer_keys;
drop policy if exists answer_keys_write on public.answer_keys;
create policy answer_keys_school_read on public.answer_keys for select to authenticated using (public.same_school(school_id));
create policy answer_keys_school_write on public.answer_keys for all to authenticated using (public.same_school(school_id)) with check (public.same_school(school_id));

drop policy if exists overlay_layouts_read on public.overlay_layouts;
drop policy if exists overlay_layouts_write on public.overlay_layouts;
create policy overlay_layouts_school_read on public.overlay_layouts for select to authenticated using (public.same_school(school_id));
create policy overlay_layouts_school_write on public.overlay_layouts for all to authenticated using (public.same_school(school_id)) with check (public.same_school(school_id));

drop policy if exists school_settings_read on public.school_settings;
drop policy if exists school_settings_write on public.school_settings;
create policy school_settings_school_read on public.school_settings for select to authenticated using (public.same_school(school_id));
create policy school_settings_staff_write on public.school_settings for all to authenticated using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));

-- ---------------------------------------------------------------
-- 2) الخطة الأسبوعية
-- ---------------------------------------------------------------
drop policy if exists "المدير والوكيل يديرون كل الخطة الأ" on public.weekly_plans;
drop policy if exists "المعلم يدير خطته حسب تخصصه فقط" on public.weekly_plans;
drop policy if exists weekly_plans_weekly_tracking_read on public.weekly_plans;
create policy weekly_plans_staff_manage on public.weekly_plans for all to authenticated
  using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));
create policy weekly_plans_teacher_manage on public.weekly_plans for all to authenticated
  using (exists (select 1 from public.teacher_subjects ts where ts.teacher_id = auth.uid() and ts.subject_id = weekly_plans.subject_id and ts.grade_level = weekly_plans.grade_level and ts.school_id is not distinct from weekly_plans.school_id))
  with check (exists (select 1 from public.teacher_subjects ts where ts.teacher_id = auth.uid() and ts.subject_id = weekly_plans.subject_id and ts.grade_level = weekly_plans.grade_level and ts.school_id is not distinct from weekly_plans.school_id));
create policy weekly_plans_tracking_read on public.weekly_plans for select to authenticated
  using (exists (select 1 from public.weekly_tracking_permissions w where w.profile_id = auth.uid() and w.school_id is not distinct from weekly_plans.school_id));
-- (قراءة أولياء الأمور العامة "الجميع يقرأون الخطة الأسبوعية..." تبقى كما هي)

drop policy if exists teacher_subjects_weekly_tracking_read on public.teacher_subjects;
create policy teacher_subjects_tracking_read on public.teacher_subjects for select to authenticated
  using (exists (select 1 from public.weekly_tracking_permissions w where w.profile_id = auth.uid() and w.school_id is not distinct from teacher_subjects.school_id));

drop policy if exists "المدير والوكيل يديرون ملاحظة الإد" on public.weekly_admin_notes;
drop policy if exists weekly_admin_notes_staff_write on public.weekly_admin_notes;
create policy weekly_admin_notes_staff_manage on public.weekly_admin_notes for all to authenticated
  using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));

drop policy if exists admin_deputy_write_publish_settings on public.weekly_plan_publish_settings;
create policy weekly_publish_staff_manage on public.weekly_plan_publish_settings for all to authenticated
  using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));

-- ---------------------------------------------------------------
-- 3) الحسابات: المدير/الوكيل يشوف ويعدّل حسابات مدرسته فقط، وما يقدر يرفع أحد لـ"مالك"
-- ---------------------------------------------------------------
drop policy if exists "المدير والوكيل يعدلون أدوار المست" on public.profiles;
drop policy if exists "المدير والوكيل يرون كل الحسابات" on public.profiles;
create policy profiles_staff_update on public.profiles for update to authenticated
  using (public.is_school_staff(school_id))
  with check (public.is_owner() or (public.is_school_staff(school_id) and role <> 'owner'::user_role));
-- (القراءة: سياسة staff_profiles_directory_read الحالية تعطي كل مستخدم حسابات مدرسته فقط)

-- ---------------------------------------------------------------
-- 4) الزيارات الصفية: نفس الصلاحيات الحالية بس داخل المدرسة
-- ---------------------------------------------------------------
drop policy if exists classroom_visits_select on public.classroom_visits;
drop policy if exists classroom_visits_update on public.classroom_visits;
drop policy if exists classroom_visits_delete on public.classroom_visits;
drop policy if exists classroom_visits_insert on public.classroom_visits;
create policy classroom_visits_select on public.classroom_visits for select to authenticated using (
  public.is_owner()
  or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id())
  or visitor_id = auth.uid()
  or (published = true and public.my_role() = 'teacher'::user_role and school_id is not distinct from public.my_school_id()
      and (teacher_profile_id = auth.uid() or (teacher_profile_id is null and teacher_name = (select p.full_name from public.profiles p where p.id = auth.uid()))))
);
create policy classroom_visits_update on public.classroom_visits for update to authenticated
  using (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id()) or visitor_id = auth.uid())
  with check (public.is_owner() or (school_id is not distinct from public.my_school_id() and (public.my_role() = 'admin'::user_role or visitor_id = auth.uid())));
create policy classroom_visits_delete on public.classroom_visits for delete to authenticated
  using (public.is_owner() or (public.my_role() = 'admin'::user_role and school_id is not distinct from public.my_school_id()) or visitor_id = auth.uid());
create policy classroom_visits_insert on public.classroom_visits for insert to authenticated
  with check (visitor_id = auth.uid() and (public.is_owner() or (public.my_role() in ('admin'::user_role, 'deputy'::user_role) and school_id is not distinct from public.my_school_id())));

-- ---------------------------------------------------------------
-- 5) بنود طلبات الصرف (ما فيها school_id - تاخذ مدرسة الطلب نفسه)
-- ---------------------------------------------------------------
drop policy if exists budget_expense_items_read on public.budget_expense_items;
drop policy if exists budget_expense_items_insert on public.budget_expense_items;
drop policy if exists budget_expense_items_delete on public.budget_expense_items;
create policy budget_expense_items_read on public.budget_expense_items for select to authenticated using (
  exists (select 1 from public.budget_expense_requests r where r.id = budget_expense_items.request_id and (
    public.is_owner()
    or (public.my_role() = 'admin'::user_role and r.school_id is not distinct from public.my_school_id())
    or exists (select 1 from public.budget_permissions bp where bp.profile_id = auth.uid() and bp.level = 'full' and bp.school_id is not distinct from r.school_id)
    or r.requested_by = auth.uid())));
create policy budget_expense_items_insert on public.budget_expense_items for insert to authenticated with check (
  exists (select 1 from public.budget_expense_requests r where r.id = budget_expense_items.request_id and (
    public.is_owner()
    or (public.my_role() = 'admin'::user_role and r.school_id is not distinct from public.my_school_id())
    or exists (select 1 from public.budget_permissions bp where bp.profile_id = auth.uid() and bp.level = 'full' and bp.school_id is not distinct from r.school_id)
    or r.requested_by = auth.uid())));
create policy budget_expense_items_delete on public.budget_expense_items for delete to authenticated using (
  exists (select 1 from public.budget_expense_requests r where r.id = budget_expense_items.request_id and (
    public.is_owner()
    or (public.my_role() = 'admin'::user_role and r.school_id is not distinct from public.my_school_id())
    or exists (select 1 from public.budget_permissions bp where bp.profile_id = auth.uid() and bp.level = 'full' and bp.school_id is not distinct from r.school_id))));

-- ---------------------------------------------------------------
-- 6) أي سجل جديد بدون school_id ياخذ مدرسة اللي أضافه تلقائيًا
-- ---------------------------------------------------------------
create or replace function public.fill_school_id() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.school_id is null then
    new.school_id := public.my_school_id();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'school_id' and c.table_name not in ('profiles', 'schools')
  loop
    execute format('drop trigger if exists trg_fill_school_id on public.%I', t);
    execute format('create trigger trg_fill_school_id before insert on public.%I for each row execute function public.fill_school_id()', t);
  end loop;
end $$;

commit;
