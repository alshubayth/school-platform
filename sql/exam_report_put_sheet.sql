-- إضافة/استبدال ورقة طالب واحدة بتقرير (للمعلم على تقارير الإدارة كمان) بدون صلاحية تعديل كامل التقرير
create or replace function public.exam_report_put_sheet(p_report uuid, p_student jsonb, p_stats jsonb)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_school uuid; v_list jsonb; v_n integer;
begin
  select school_id, coalesce(raw_data->'students', '[]'::jsonb) into v_school, v_list from public.exam_reports where id = p_report;
  if not found then raise exception 'التقرير غير موجود'; end if;
  if not public.is_staff_of(v_school) then raise exception 'ما عندك صلاحية على هذا التقرير'; end if;
  if coalesce(p_student->>'id', '') = '' then raise exception 'رقم هوية الطالب مطلوب'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_list from jsonb_array_elements(v_list) x where x->>'id' is distinct from p_student->>'id';
  v_list := v_list || jsonb_build_array(p_student);
  v_n := jsonb_array_length(v_list);
  update public.exam_reports
     set raw_data = jsonb_set(coalesce(raw_data, '{}'::jsonb), '{students}', v_list),
         stats = coalesce(p_stats, stats), students_count = v_n
   where id = p_report;
  return v_n;
end $fn$;
grant execute on function public.exam_report_put_sheet(uuid, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
