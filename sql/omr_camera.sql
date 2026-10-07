-- التصحيح بكاميرا الجوال (مساند للسكانر/Remark)
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير اختر Run anyway) - آمن لو انشغّل أكثر من مرة
--   • المعلم يصحح ويشوف تقاريره هو بس (اللي صححها)، والمدير/الوكيل يشوفون الكل ومن صحح
--   • المعلم يقرأ مفاتيح الإجابة لمدرسته (عشان يصحح بالجوال) بدون ما يقدر يعدّلها

-- 1) تقارير الاختبارات: مصدر التقرير + المفتاح المستخدم
alter table public.exam_reports add column if not exists source text not null default 'remark';
alter table public.exam_reports add column if not exists key_id uuid;
create index if not exists exam_reports_key_idx on public.exam_reports (key_id, created_by);

-- 2) الأوراق المصححة بالكاميرا (ورقة لكل طالب بكل تقرير)
do $$
declare rid_type text; sid_type text;
begin
  select data_type into rid_type from information_schema.columns where table_schema = 'public' and table_name = 'exam_reports' and column_name = 'id';
  select data_type into sid_type from information_schema.columns where table_schema = 'public' and table_name = 'exam_reports' and column_name = 'school_id';
  execute format($f$
    create table if not exists public.exam_scans (
      id uuid primary key default gen_random_uuid(),
      school_id %s,
      report_id %s not null references public.exam_reports(id) on delete cascade,
      key_id uuid,
      national_id text not null,
      student_name text,
      grade_level text,
      class_section text,
      model text,
      answers jsonb not null default '[]'::jsonb,
      essay numeric,
      score numeric,
      flags jsonb,
      scanned_by uuid default auth.uid() references public.profiles(id) on delete set null,
      scanned_at timestamptz not null default now(),
      unique (report_id, national_id)
    )$f$, coalesce(sid_type, 'uuid'), coalesce(rid_type, 'uuid'));
end $$;
create index if not exists exam_scans_report_idx on public.exam_scans (report_id);
alter table public.exam_scans enable row level security;
grant select, insert, update, delete on public.exam_scans to authenticated;

-- 3) الصلاحيات
-- التقارير: المعلم يدير تقاريره هو بس (سياسة المدير/الوكيل الحالية تبقى كما هي)
drop policy if exists exam_reports_teacher_own on public.exam_reports;
create policy exam_reports_teacher_own on public.exam_reports for all to authenticated
  using (created_by = auth.uid() and public.is_staff_of(school_id))
  with check (created_by = auth.uid() and public.is_staff_of(school_id));

-- الأوراق: المدير/الوكيل الكل، والمعلم أوراقه بتقاريره هو
drop policy if exists exam_scans_access on public.exam_scans;
create policy exam_scans_access on public.exam_scans for all to authenticated
  using (public.is_school_staff(school_id) or (scanned_by = auth.uid() and public.is_staff_of(school_id)))
  with check (public.is_staff_of(school_id)
              and (scanned_by = auth.uid() or public.is_school_staff(school_id))
              and exists (select 1 from public.exam_reports r where r.id = exam_scans.report_id));

-- مفاتيح الإجابة: قراءة فقط للمعلمين (التعديل يبقى للمدير/الوكيل)
drop policy if exists answer_keys_read on public.answer_keys;    -- سياسات قديمة مفتوحة (لو باقية)
drop policy if exists answer_keys_write on public.answer_keys;
drop policy if exists answer_keys_staff_read on public.answer_keys;
create policy answer_keys_staff_read on public.answer_keys for select to authenticated
  using (public.is_staff_of(school_id));

notify pgrst, 'reload schema';

-- فحص: لازم يطلع 1 لكل عمود
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'exam_scans') as scans_table,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'exam_reports' and column_name = 'source') as source_col,
  (select count(*) from pg_policies where tablename = 'exam_reports' and policyname = 'exam_reports_teacher_own') as teacher_policy,
  (select count(*) from pg_policies where tablename = 'answer_keys' and policyname = 'answer_keys_staff_read') as keys_read;
