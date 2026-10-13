-- تسريع الصلاحيات (RLS) - مطبّق على قاعدة البيانات 2026-10-13
-- المشكلة: دوال الصلاحيات (is_staff_of / is_school_staff / same_school / my_role) كانت تنحسب لكل صف،
-- وبعض الشروط تفحص جداول متداخلة (teacher_subjects → weekly_tracking_permissions → profiles) لكل صف،
-- فاستعلام طلاب المعلم كان يتجاوز وقت الاستعلام (يطلع صفر طلاب) والخطة الأسبوعية تاخذ ١٧ ثانية.
-- الحل: نفس الشروط بالضبط لكن بصيغة (select ...) تنحسب مرة وحدة بكل استعلام، ودوال SECURITY DEFINER
-- ترجع صفوف/مواد المعلم كمصفوفة. تم التحقق إن عدد الصفوف لكل جدول هو نفسه قبل وبعد (معلم، مدير، زائر).
-- النسخة القديمة من السياسات محفوظة بجدول public._policy_backup_20261013

-- ١) كل سياسة فيها is_staff_of(school_id) / is_school_staff(school_id) / same_school(school_id)
--    استُبدلت (٤٢ سياسة بـ ٢٨ جدول) بالصيغ:
--    is_staff_of     → ((select is_owner()) or ((select my_role()) = any(array['admin','deputy','teacher']) and school_id = (select my_school_id())))
--    is_school_staff → ((select is_owner()) or ((select my_role()) = any(array['admin','deputy']) and school_id = (select my_school_id())))
--    same_school     → ((select is_owner()) or school_id = (select my_school_id()))

-- ٢) دوال مصفوفات المعلم
create or replace function public.my_subject_grades() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ts.grade_level::text), '{}') from public.teacher_subjects ts where ts.teacher_id = auth.uid() $$;
create or replace function public.my_subject_keys() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct coalesce(ts.school_id::text, '') || '|' || ts.subject_id::text || '|' || ts.grade_level::text), '{}')
    from public.teacher_subjects ts where ts.teacher_id = auth.uid() $$;
create or replace function public.my_tracking_schools() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct coalesce(w.school_id::text, '')), '{}') from public.weekly_tracking_permissions w where w.profile_id = auth.uid() $$;

-- ٣) السياسات المعدّلة يدويًا
alter policy teacher_own_grade_students_read on public.students
  using (school_id = (select public.my_school_id()) and (select public.my_subject_grades()) @> array[grade_level::text]);
alter policy teacher_schedule_students_read on public.students
  using (school_id = (select public.my_school_id()) and (select public.my_schedule_grades()) @> array[grade_level::text]);
alter policy weekly_plans_teacher_manage on public.weekly_plans
  using ((select public.my_subject_keys()) @> array[coalesce(school_id::text, '') || '|' || subject_id::text || '|' || grade_level::text])
  with check ((select public.my_subject_keys()) @> array[coalesce(school_id::text, '') || '|' || subject_id::text || '|' || grade_level::text]);
alter policy weekly_plans_tracking_read on public.weekly_plans using ((select public.my_tracking_schools()) @> array[coalesce(school_id::text, '')]);
alter policy teacher_subjects_tracking_read on public.teacher_subjects using ((select public.my_tracking_schools()) @> array[coalesce(school_id::text, '')]);
alter policy staff_profiles_directory_read on public.profiles
  using ((id = (select auth.uid())) or (select public.is_owner()) or (school_id = (select public.my_school_id())));
