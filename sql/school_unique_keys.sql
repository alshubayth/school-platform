-- فصل قيود عدم التكرار حسب المدرسة: قبلها كانت القيود على (الصف، الأسبوع) مثلًا بدون المدرسة،
-- فلو مدرستين حفظوا نفس الصف ونفس الأسبوع يتصادمون. هنا نضيف قيد جديد يشمل school_id ونشيل القديم.
-- الجداول: تعليمات الإدارة، نشر الخطة الأسبوعية، جدول الحصص، تغييرات الجدول اليومي (الانتظار)
do $$
declare
  t record; c record;
begin
  for t in select * from (values
    ('weekly_admin_notes',           array['grade_level','week_number'],                                   'school_id, grade_level, week_number'),
    ('weekly_plan_publish_settings', array['week_number'],                                                 'school_id, week_number'),
    ('class_schedules',              array['grade_level','class_section','day_of_week','period_number'],  'school_id, grade_level, class_section, day_of_week, period_number'),
    ('daily_schedule_changes',       array['change_date','grade_level','class_section','period_number'],  'school_id, change_date, grade_level, class_section, period_number')
  ) v(tbl, oldcols, newcols)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice 'skip %: table not found', t.tbl; continue;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tbl and column_name = 'school_id') then
      raise notice 'skip %: no school_id column', t.tbl; continue;
    end if;

    -- 1) القيد الجديد (يشمل المدرسة)
    execute format('create unique index if not exists %I on public.%I (%s) nulls not distinct', t.tbl || '_school_uniq', t.tbl, t.newcols);

    -- 2) حذف القيود القديمة (unique أو primary key) اللي أعمدتها بالضبط الأعمدة القديمة
    for c in
      select con.conname from pg_constraint con
       where con.conrelid = ('public.' || t.tbl)::regclass and con.contype in ('u', 'p')
         and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
               where a.attrelid = con.conrelid and a.attnum = any(con.conkey))
           = (select array_agg(x order by x) from unnest(t.oldcols) x)
    loop
      execute format('alter table public.%I drop constraint %I', t.tbl, c.conname);
    end loop;

    -- 3) حذف الفهارس الفريدة القديمة المستقلة (اللي مو تابعة لقيد)
    for c in
      select i.indexrelid::regclass::text as iname from pg_index i
       where i.indrelid = ('public.' || t.tbl)::regclass and i.indisunique
         and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
         and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
               where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[]))
           = (select array_agg(x order by x) from unnest(t.oldcols) x)
    loop
      execute format('drop index %s', c.iname);
    end loop;
  end loop;
end $$;

-- تحقق: كل جدول لازم يكون عنده school_uniq = 1 و old_left = 0
select t.tbl,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = t.tbl and indexname = t.tbl || '_school_uniq') as school_uniq,
  (select count(*) from pg_index i
     where i.indrelid = to_regclass('public.' || t.tbl) and i.indisunique
       and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[]))
         = (select array_agg(x order by x) from unnest(t.oldcols) x)) as old_left
from (values
  ('weekly_admin_notes', array['grade_level','week_number']),
  ('weekly_plan_publish_settings', array['week_number']),
  ('class_schedules', array['grade_level','class_section','day_of_week','period_number']),
  ('daily_schedule_changes', array['change_date','grade_level','class_section','period_number'])
) t(tbl, oldcols);
