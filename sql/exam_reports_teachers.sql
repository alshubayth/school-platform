-- تقارير الاختبارات للمعلمين:
--   • المعلم يقرأ تقارير مدرسته (والمنصة تعرض له تقارير مواده وصفوفه + تقاريره هو)
--   • المعلم ينشئ مفاتيح إجابة ويعدّل/يحذف مفاتيحه هو بس
drop policy if exists exam_reports_staff_read on public.exam_reports;
create policy exam_reports_staff_read on public.exam_reports for select to authenticated
  using (public.is_staff_of(school_id));

drop policy if exists answer_keys_teacher_own on public.answer_keys;
create policy answer_keys_teacher_own on public.answer_keys for all to authenticated
  using (created_by = auth.uid() and public.is_staff_of(school_id))
  with check (created_by = auth.uid() and public.is_staff_of(school_id));

notify pgrst, 'reload schema';
