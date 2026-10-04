-- جدول حفظ نماذج "الطباعة على النموذج المعتمد" (مواقع الحقول + صورة مصغرة للنموذج)
-- يُشغَّل مرة وحدة في Supabase (مشروع المنصة المدرسية) > SQL Editor. آمن لو انشغّل أكثر من مرة.
do $$
declare
  sid_type text;
begin
  select data_type into sid_type
  from information_schema.columns
  where table_schema = 'public' and column_name = 'school_id'
    and table_name in ('answer_keys', 'exam_reports', 'students')
  limit 1;

  execute format($f$
    create table if not exists public.overlay_layouts (
      id uuid primary key default gen_random_uuid(),
      school_id %s,
      name text not null,
      page_w numeric not null,
      page_h numeric not null,
      background text,
      fields jsonb not null default '{}'::jsonb,
      offset_x numeric not null default 0,
      offset_y numeric not null default 0,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )$f$, case when sid_type in ('integer', 'bigint') then sid_type else 'uuid' end);
end $$;

create index if not exists overlay_layouts_school_idx on public.overlay_layouts (school_id, updated_at desc);

alter table public.overlay_layouts enable row level security;

drop policy if exists "overlay_layouts_read" on public.overlay_layouts;
create policy "overlay_layouts_read" on public.overlay_layouts for select to authenticated using (true);

drop policy if exists "overlay_layouts_write" on public.overlay_layouts;
create policy "overlay_layouts_write" on public.overlay_layouts for all to authenticated using (true) with check (true);
