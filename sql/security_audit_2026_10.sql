-- فحص الأمان (2026-10-12) - انطبق على قاعدة البيانات
-- 1) العروض تحترم صلاحيات الجداول، وما تنقرأ بدون تسجيل دخول
alter view public.employee_evaluations set (security_invoker = on);
alter view public.weekly_progress set (security_invoker = on);
revoke all on public.employee_evaluations, public.weekly_progress from anon;

-- 2) طلب الصرف ينضاف "بانتظار الاعتماد" بس (إلا المدير/المالك/صلاحية كاملة)، وبنود الطلب ما تنضاف بعد اعتماده
alter policy budget_expense_requests_insert on public.budget_expense_requests with check (
  (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'::user_role))
  or (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'::user_role and not (p.school_id is distinct from budget_expense_requests.school_id)))
  or (exists (select 1 from budget_permissions bp where bp.profile_id = auth.uid() and bp.level = 'full' and not (bp.school_id is distinct from budget_expense_requests.school_id)))
  or (status = 'pending' and confirmed_by is null and confirmed_at is null and (
        (exists (select 1 from budget_permissions bp where bp.profile_id = auth.uid() and not (bp.school_id is distinct from budget_expense_requests.school_id)))
     or (requested_by = auth.uid() and beneficiary_name = (select p.full_name from profiles p where p.id = auth.uid())
         and exists (select 1 from profiles p where p.id = auth.uid() and p.role = any (array['deputy'::user_role, 'teacher'::user_role]) and not (p.school_id is distinct from budget_expense_requests.school_id))))));
alter policy budget_expense_items_insert on public.budget_expense_items with check (
  exists (select 1 from budget_expense_requests r where r.id = budget_expense_items.request_id and (
    is_owner()
    or (my_role() = 'admin'::user_role and not (r.school_id is distinct from my_school_id()))
    or exists (select 1 from budget_permissions bp where bp.profile_id = auth.uid() and bp.level = 'full' and not (bp.school_id is distinct from r.school_id))
    or (r.requested_by = auth.uid() and r.status = 'pending'))));

-- 3) إضافة ورقة طالب لتقرير: صاحب التقرير أو الإدارة، أو معلم لطالب من صفوفه (انظر الدالة بالقاعدة)
-- 4) دوال ما تنستدعى بدون تسجيل دخول
revoke execute on function public.budget_compact_series(uuid, text) from anon, authenticated, public;
-- (+ exam_report_put_sheet, my_schedule_grades, achv_my, budget_open_funding_batches, mark_visits_seen,
--    notice_*, push_notify_schedule, push_subscribe_staff, set_school_branding: للمسجلين فقط)
