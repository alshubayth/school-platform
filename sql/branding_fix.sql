-- إصلاح: دالة is_owner (اللي تستخدمها دالة حفظ الهوية) ناقصة بقاعدة البيانات
begin;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'owner'::user_role from public.profiles where id = auth.uid()), false) $$;
grant execute on function public.is_owner() to authenticated, anon;

-- اسم مدير مدرسة المروج (لو ما انحفظ قبل)
update public.schools
   set branding = branding || '{"principal_name": "منيف بن محمد النفيعي"}'::jsonb
 where slug = 'al-murooj' and not (branding ? 'principal_name');

commit;

notify pgrst, 'reload schema';

-- فحص: هل ملف الأمان security_v1 منفّذ؟ (كل القيم المفروض 1)
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_owner') as is_owner,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'same_school') as same_school,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_school_staff') as is_school_staff,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fill_school_id') as fill_school_id,
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'answer_keys_school_read') as answer_keys_policy,
  (select count(*) from pg_trigger where tgname = 'trg_fill_school_id') as school_triggers;
