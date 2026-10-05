-- صفحة أولياء الأمور: السماح بقراءة التقويم الدراسي فقط (لتواريخ الأسابيع وتحديد الأسبوع الحالي)
-- الزائر بدون تسجيل دخول يقرأ مفتاح academic_calendar بس، وباقي إعدادات المدرسة تبقى محمية
drop policy if exists school_settings_public_calendar on public.school_settings;
create policy school_settings_public_calendar on public.school_settings
  for select to anon using (key = 'academic_calendar');

-- تحقق: لازم يطلع 1
select count(*) as parent_calendar_policy from pg_policies
 where tablename = 'school_settings' and policyname = 'school_settings_public_calendar';

-- للتراجع:
-- drop policy if exists school_settings_public_calendar on public.school_settings;
