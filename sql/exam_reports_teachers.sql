-- تقارير الاختبارات للمعلمين:
--   • قراءة التقارير: انظر sql/exam_reports_teacher_scope.sql (المعلم يقرأ تقاريره وتقارير مواده وصفوفه فقط).
--     لا تُعِد هنا سياسة القراءة المفتوحة لكل طاقم المدرسة؛ كانت تسمح لأي معلم بقراءة درجات المدرسة كلها.
--   • المعلم ينشئ مفاتيح إجابة ويعدّل/يحذف مفاتيحه هو بس

drop policy if exists answer_keys_teacher_own on public.answer_keys;
create policy answer_keys_teacher_own on public.answer_keys for all to authenticated
  using (created_by = auth.uid() and public.is_staff_of(school_id))
  with check (created_by = auth.uid() and public.is_staff_of(school_id));

notify pgrst, 'reload schema';
