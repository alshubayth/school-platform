-- تسريع صلاحيات قراءة الطلاب: الشرط القديم للمعلم (حسب تخصصاته) كان يفحص جداول متداخلة
-- لكل طالب ويتجاوز وقت الاستعلام، فيطلع للمعلم صفر طلاب. الآن صفوف المعلم تُحسب مرة وحدة.
-- (مطبّق على قاعدة البيانات)
create or replace function public.my_subject_grades() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ts.grade_level::text), '{}')
    from public.teacher_subjects ts
   where ts.teacher_id = auth.uid()
$$;
revoke execute on function public.my_subject_grades() from anon, public;
grant execute on function public.my_subject_grades() to authenticated;

alter policy teacher_own_grade_students_read on public.students
  using (school_id = (select public.my_school_id()) and (select public.my_subject_grades()) @> array[grade_level::text]);
alter policy teacher_schedule_students_read on public.students
  using (school_id = (select public.my_school_id()) and (select public.my_schedule_grades()) @> array[grade_level::text]);
alter policy "المدير والوكيل يديرون الطلاب" on public.students
  using ((select public.is_owner()) or ((select public.my_role()) in ('admin'::user_role, 'deputy'::user_role) and school_id = (select public.my_school_id())))
  with check ((select public.is_owner()) or ((select public.my_role()) in ('admin'::user_role, 'deputy'::user_role) and school_id = (select public.my_school_id())));
