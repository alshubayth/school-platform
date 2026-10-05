-- تراجع عن sql/security_v1.sql: يرجّع السياسات مثل ما كانت قبل التأمين بالضبط (مولّد من الجرد)
begin;

drop policy if exists answer_keys_school_read on public.answer_keys;
drop policy if exists answer_keys_school_write on public.answer_keys;
drop policy if exists overlay_layouts_school_read on public.overlay_layouts;
drop policy if exists overlay_layouts_school_write on public.overlay_layouts;
drop policy if exists school_settings_school_read on public.school_settings;
drop policy if exists school_settings_staff_write on public.school_settings;
drop policy if exists weekly_plans_staff_manage on public.weekly_plans;
drop policy if exists weekly_plans_teacher_manage on public.weekly_plans;
drop policy if exists weekly_plans_tracking_read on public.weekly_plans;
drop policy if exists teacher_subjects_tracking_read on public.teacher_subjects;
drop policy if exists weekly_admin_notes_staff_manage on public.weekly_admin_notes;
drop policy if exists weekly_publish_staff_manage on public.weekly_plan_publish_settings;
drop policy if exists profiles_staff_update on public.profiles;
drop policy if exists classroom_visits_select on public.classroom_visits;
drop policy if exists classroom_visits_update on public.classroom_visits;
drop policy if exists classroom_visits_delete on public.classroom_visits;
drop policy if exists classroom_visits_insert on public.classroom_visits;
drop policy if exists budget_expense_items_read on public.budget_expense_items;
drop policy if exists budget_expense_items_insert on public.budget_expense_items;
drop policy if exists budget_expense_items_delete on public.budget_expense_items;

create policy "answer_keys_read" on public.answer_keys for select to authenticated
  using (true);
create policy "answer_keys_write" on public.answer_keys for all to authenticated
  using (true)
  with check (true);
create policy "overlay_layouts_read" on public.overlay_layouts for select to authenticated
  using (true);
create policy "overlay_layouts_write" on public.overlay_layouts for all to authenticated
  using (true)
  with check (true);
create policy "school_settings_read" on public.school_settings for select to authenticated
  using (true);
create policy "school_settings_write" on public.school_settings for all to authenticated
  using (true)
  with check (true);
create policy "المدير والوكيل يديرون كل الخطة الأ" on public.weekly_plans for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'deputy'::user_role, 'owner'::user_role]))))));
create policy "المعلم يدير خطته حسب تخصصه فقط" on public.weekly_plans for all to public
  using ((EXISTS ( SELECT 1
   FROM teacher_subjects ts
  WHERE ((ts.teacher_id = auth.uid()) AND (ts.subject_id = weekly_plans.subject_id) AND (ts.grade_level = weekly_plans.grade_level)))));
create policy "weekly_plans_weekly_tracking_read" on public.weekly_plans for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM weekly_tracking_permissions wtp
  WHERE (wtp.profile_id = auth.uid()))));
create policy "teacher_subjects_weekly_tracking_read" on public.teacher_subjects for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM weekly_tracking_permissions wtp
  WHERE (wtp.profile_id = auth.uid()))));
create policy "المدير والوكيل يديرون ملاحظة الإد" on public.weekly_admin_notes for all to public
  using (is_admin_or_deputy());
create policy "weekly_admin_notes_staff_write" on public.weekly_admin_notes for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'deputy'::user_role, 'owner'::user_role]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'deputy'::user_role, 'owner'::user_role]))))));
create policy "admin_deputy_write_publish_settings" on public.weekly_plan_publish_settings for all to public
  using (is_admin_or_deputy())
  with check (is_admin_or_deputy());
create policy "المدير والوكيل يعدلون أدوار المست" on public.profiles for update to public
  using (is_admin_or_deputy());
create policy "المدير والوكيل يرون كل الحسابات" on public.profiles for select to public
  using (is_admin_or_deputy());
create policy "classroom_visits_select" on public.classroom_visits for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (visitor_id = auth.uid()) OR ((published = true) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'teacher'::user_role) AND ((p.id = classroom_visits.teacher_profile_id) OR ((classroom_visits.teacher_profile_id IS NULL) AND (p.full_name = classroom_visits.teacher_name)))))))));
create policy "classroom_visits_update" on public.classroom_visits for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (visitor_id = auth.uid())))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (visitor_id = auth.uid())));
create policy "classroom_visits_delete" on public.classroom_visits for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (visitor_id = auth.uid())));
create policy "classroom_visits_insert" on public.classroom_visits for insert to authenticated
  with check (((visitor_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'deputy'::user_role, 'owner'::user_role])))))));
create policy "budget_expense_items_read" on public.budget_expense_items for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM budget_expense_requests r
  WHERE ((r.id = budget_expense_items.request_id) AND ((EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (EXISTS ( SELECT 1
           FROM budget_permissions bp
          WHERE ((bp.profile_id = auth.uid()) AND (bp.level = 'full'::text)))) OR (r.requested_by = auth.uid()))))));
create policy "budget_expense_items_insert" on public.budget_expense_items for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM budget_expense_requests r
  WHERE ((r.id = budget_expense_items.request_id) AND ((EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (EXISTS ( SELECT 1
           FROM budget_permissions bp
          WHERE ((bp.profile_id = auth.uid()) AND (bp.level = 'full'::text)))) OR (r.requested_by = auth.uid()))))));
create policy "budget_expense_items_delete" on public.budget_expense_items for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM budget_expense_requests r
  WHERE ((r.id = budget_expense_items.request_id) AND ((EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role]))))) OR (EXISTS ( SELECT 1
           FROM budget_permissions bp
          WHERE ((bp.profile_id = auth.uid()) AND (bp.level = 'full'::text)))))))));

do $$
declare t text;
begin
  for t in select event_object_table from information_schema.triggers where trigger_schema = 'public' and trigger_name = 'trg_fill_school_id' loop
    execute format('drop trigger if exists trg_fill_school_id on public.%I', t);
  end loop;
end $$;
drop function if exists public.fill_school_id();
drop function if exists public.is_school_staff(uuid);
drop function if exists public.same_school(uuid);
-- is_owner تبقى: دالة حفظ هوية المدرسة (branding.sql) تعتمد عليها

commit;
