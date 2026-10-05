-- =====================================================================
-- هوية كل مدرسة: الاسم المختصر، شعار المدرسة، والجهة التابعة لها (مع شعارها)
-- =====================================================================
-- 1) عمود branding بجدول المدارس (يُقرأ مع اسم المدرسة، ومنه صفحة أولياء الأمور تاخذ الشعار)
-- 2) دالة set_school_branding: المدير يعدّل هوية مدرسته فقط، والمالك أي مدرسة
-- 3) مدرسة المروج تاخذ هويتها الحالية (الاسم المختصر + الهيئة الملكية) فما يتغير شي
-- يتنفّذ كامل أو ما يتنفّذ شي. للتراجع: sql/branding_rollback.sql
-- =====================================================================
begin;

alter table public.schools add column if not exists branding jsonb not null default '{}'::jsonb;

create or replace function public.set_school_branding(p_school uuid, p_name text, p_branding jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_school is null then
    raise exception 'المدرسة غير محددة';
  end if;
  if not (public.is_owner() or (public.my_role() = 'admin'::user_role and p_school = public.my_school_id())) then
    raise exception 'غير مسموح: تعديل الهوية لمدير المدرسة فقط';
  end if;
  if p_branding is not null and jsonb_typeof(p_branding) <> 'object' then
    raise exception 'صيغة الهوية غير صحيحة';
  end if;
  if pg_column_size(p_branding) > 1500000 then
    raise exception 'حجم الشعارات كبير';
  end if;
  update public.schools
     set name = coalesce(nullif(btrim(p_name), ''), name),
         branding = coalesce(p_branding, '{}'::jsonb)
   where id = p_school;
end $$;

revoke all on function public.set_school_branding(uuid, text, jsonb) from public, anon;
grant execute on function public.set_school_branding(uuid, text, jsonb) to authenticated;

update public.schools
   set branding = '{"short_name": "مدرسة المروج", "authority": "rc"}'::jsonb
 where slug = 'al-murooj' and branding = '{}'::jsonb;

commit;
