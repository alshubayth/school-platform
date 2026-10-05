-- فحص ملف الهوية + تحديث ذاكرة واجهة قاعدة البيانات
notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'schools' and column_name = 'branding') as branding_column,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_school_branding') as save_function,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_owner') as is_owner_function,
  (select has_function_privilege('authenticated', 'public.set_school_branding(uuid, text, jsonb)', 'execute')) as can_execute,
  (select role::text from public.profiles where id = (select id from public.profiles where role in ('admin','owner') order by role limit 1)) as sample_role,
  (select branding::text from public.schools where slug = 'al-murooj') as murooj_branding;
