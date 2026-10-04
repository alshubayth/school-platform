-- إعدادات المدرسة العامة (مثل التقويم الدراسي: بداية الأسبوع الأول وأسابيع الإجازة)
-- يُشغَّل مرة وحدة في Supabase (مشروع المنصة المدرسية) > SQL Editor. آمن لو انشغّل أكثر من مرة.
do $$
declare
  sid_type text;
begin
  select data_type into sid_type
  from information_schema.columns
  where table_schema = 'public' and column_name = 'school_id'
    and table_name in ('answer_keys', 'exam_reports', 'students', 'weekly_plans')
  limit 1;

  execute format($f$
    create table if not exists public.school_settings (
      id uuid primary key default gen_random_uuid(),
      school_id %s,
      key text not null,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      constraint school_settings_school_key unique nulls not distinct (school_id, key)
    )$f$, case when sid_type in ('integer', 'bigint') then sid_type else 'uuid' end);
end $$;

alter table public.school_settings enable row level security;

drop policy if exists "school_settings_read" on public.school_settings;
create policy "school_settings_read" on public.school_settings for select to authenticated using (true);

drop policy if exists "school_settings_write" on public.school_settings;
create policy "school_settings_write" on public.school_settings for all to authenticated using (true) with check (true);
