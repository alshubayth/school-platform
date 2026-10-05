-- الطلاب حسب المدرسة:
-- 1) كل مدرسة لها سجل خاص للطالب (رقم الهوية + المدرسة) - الطالب المنتقل ترفعه المدرسة الجديدة عادي
-- 2) صلاحيات الطلاب الحالية تنقيّد بمدرسة المستخدم (قبلها مدير أي مدرسة يقدر يشوف ويعدّل طلاب كل المدارس)
--    نضيف شرط المدرسة على السياسات الموجودة بدون ما نغيّر باقي شروطها
begin;

-- (0) طلاب بدون مدرسة مسجّلة كانوا بيختفون بعد تقييد الصلاحيات - لو المنصة فيها مدرسة وحدة بس نربطهم فيها
do $$
begin
  if (select count(*) from public.schools) = 1 then
    update public.students set school_id = (select id from public.schools limit 1) where school_id is null;
  end if;
end $$;

-- (1) قيد التكرار: من رقم الهوية لحاله إلى رقم الهوية + المدرسة
create unique index if not exists students_school_national_uniq
  on public.students (school_id, national_id) nulls not distinct;

do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.students'::regclass and con.contype = 'u'
       and (select array_agg(a.attname::text) from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = any(con.conkey)) = array['national_id']
  loop
    execute format('alter table public.students drop constraint %I', c.conname);
  end loop;
  for c in
    select i.indexrelid::regclass::text as iname from pg_index i
     where i.indrelid = 'public.students'::regclass and i.indisunique and not i.indisprimary
       and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
       and (select array_agg(a.attname::text) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])) = array['national_id']
  loop
    execute format('drop index %s', c.iname);
  end loop;
end $$;

-- (2) نسخة احتياطية من السياسات الأصلية (للتراجع الدقيق)، ثم إضافة شرط المدرسة عليها
create table if not exists public._policy_backup (
  tablename text, policyname text, qual text, with_check text, saved_at timestamptz default now(),
  primary key (tablename, policyname)
);
alter table public._policy_backup enable row level security;
insert into public._policy_backup (tablename, policyname, qual, with_check)
  select tablename, policyname, qual, with_check from pg_policies
   where schemaname = 'public' and tablename = 'students'
     and position('same_school' in coalesce(qual, '') || coalesce(with_check, '')) = 0
on conflict (tablename, policyname) do nothing;

do $$
declare p record; newq text; newc text;
begin
  for p in select policyname, qual, with_check from pg_policies
            where schemaname = 'public' and tablename = 'students'
  loop
    if p.qual is not null and position('same_school' in p.qual) = 0 then
      newq := format('(%s) and public.same_school(school_id)', p.qual);
      execute format('alter policy %I on public.students using (%s)', p.policyname, newq);
    end if;
    if p.with_check is not null and position('same_school' in p.with_check) = 0 then
      newc := format('(%s) and public.same_school(school_id)', p.with_check);
      execute format('alter policy %I on public.students with check (%s)', p.policyname, newc);
    end if;
  end loop;
end $$;

commit;

-- تحقق: policies_scoped = policies_total، new_key = 1، old_key = 0، no_school = 0
select
  (select count(*) from public.students where school_id is null) as no_school,
  (select count(*) from pg_policies where tablename = 'students') as policies_total,
  (select count(*) from pg_policies where tablename = 'students' and position('same_school' in coalesce(qual, '')) > 0) as policies_scoped,
  (select count(*) from pg_indexes where tablename = 'students' and indexname = 'students_school_national_uniq') as new_key,
  (select count(*) from pg_index i where i.indrelid = 'public.students'::regclass and i.indisunique
     and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])) = array['national_id']) as old_key;
