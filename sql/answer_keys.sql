-- جدول مفاتيح الإجابة المحفوظة (من بطاقة "ورقة إجابة للتصحيح الآلي")
-- يُشغَّل مرة وحدة في Supabase > SQL Editor. آمن لو انشغّل أكثر من مرة.
do $$
declare
  sid_type text;
begin
  -- نوع عمود school_id ينسخ من جدول موجود يستخدمه (عشان يتطابق مع باقي المنصة)، وإلا uuid
  select data_type into sid_type
  from information_schema.columns
  where table_schema = 'public' and column_name = 'school_id'
    and table_name in ('exam_reports', 'students', 'weekly_plans', 'classroom_visits')
  limit 1;

  execute format($f$
    create table if not exists public.answer_keys (
      id uuid primary key default gen_random_uuid(),
      school_id %s,
      title text not null,
      subject text,
      grade_level text,
      size text not null default 'A4',
      questions int not null check (questions >= 0),
      choices int not null check (choices between 2 and 6),
      lang text not null default 'ar',
      essay_total int not null default 0,
      answers jsonb not null default '[]'::jsonb,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )$f$, case when sid_type in ('integer', 'bigint') then sid_type else 'uuid' end);
end $$;

create index if not exists answer_keys_school_idx on public.answer_keys (school_id, created_at desc);

alter table public.answer_keys enable row level security;

drop policy if exists "answer_keys_read" on public.answer_keys;
create policy "answer_keys_read" on public.answer_keys for select to authenticated using (true);

drop policy if exists "answer_keys_write" on public.answer_keys;
create policy "answer_keys_write" on public.answer_keys for all to authenticated using (true) with check (true);
