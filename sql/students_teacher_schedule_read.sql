-- المعلم يقرأ طلاب الصفوف اللي يدرّسها بالجدول الدراسي (إضافة على قراءة صفوف تخصصاته)
create policy teacher_schedule_students_read on public.students for select to authenticated using (
  same_school(school_id) and exists (
    select 1 from public.class_schedules cs
     where cs.school_id is not distinct from students.school_id
       and cs.grade_level::text = students.grade_level::text
       and (cs.teacher_id = auth.uid() or cs.teacher_name = (select p.full_name from public.profiles p where p.id = auth.uid()))
  )
);
create index if not exists class_schedules_teacher_grade_idx on public.class_schedules (teacher_id, grade_level);
notify pgrst, 'reload schema';
