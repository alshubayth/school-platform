-- خطة أسبوعية وحدة لكل مادة/صف/أسبوع بكل مدرسة
-- 1) حذف النسخ المكررة الموجودة: نبقي أحدث نسخة (آخر ما حفظه المعلم) ونحذف الأقدم
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'weekly_plans' and column_name = 'created_at') then
    delete from public.weekly_plans a using public.weekly_plans b
     where a.school_id is not distinct from b.school_id
       and a.subject_id = b.subject_id and a.grade_level = b.grade_level and a.week_number = b.week_number
       and (coalesce(a.created_at, '-infinity'::timestamptz), a.ctid) < (coalesce(b.created_at, '-infinity'::timestamptz), b.ctid);
  else
    delete from public.weekly_plans a using public.weekly_plans b
     where a.school_id is not distinct from b.school_id
       and a.subject_id = b.subject_id and a.grade_level = b.grade_level and a.week_number = b.week_number
       and a.ctid < b.ctid;
  end if;
end $$;

-- 2) قيد يمنع التكرار نهائيًا من قاعدة البيانات نفسها
create unique index if not exists weekly_plans_one_per_week
  on public.weekly_plans (school_id, subject_id, grade_level, week_number) nulls not distinct;

-- 3) تحقق: المكرر لازم 0، والقيد 1
select
  (select count(*) from (select 1 from public.weekly_plans
     group by school_id, subject_id, grade_level, week_number having count(*) > 1) d) as duplicates_left,
  (select count(*) from pg_indexes where tablename = 'weekly_plans' and indexname = 'weekly_plans_one_per_week') as unique_index;

-- للتراجع عن القيد (النسخ المحذوفة ما ترجع):
-- drop index if exists public.weekly_plans_one_per_week;
