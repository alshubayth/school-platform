-- ملفات الإنجاز: مراجعة الوكيل لكل ملف (اعتماد/رفض) + إعدادات البنود في school_settings (key = 'achv_rules')
-- طُبّق على قاعدة البيانات
create table if not exists public.achv_file_reviews (
  school_id uuid not null references public.schools(id) on delete cascade,
  path text not null,                         -- مسار الملف نسبةً إلى مجلد العام
  status text not null check (status in ('approved','rejected')),
  note text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  primary key (school_id, path)
);
alter table public.achv_file_reviews enable row level security;
drop policy if exists achv_reviews_mgr on public.achv_file_reviews;
create policy achv_reviews_mgr on public.achv_file_reviews for all to authenticated
  using (public.notice_can_manage(school_id)) with check (public.notice_can_manage(school_id));
-- achv_my(): ترجع rules من achv_rules إن وُجدت، و basis (الافتراضي approved)، و reviews لملفات المعلم فقط
