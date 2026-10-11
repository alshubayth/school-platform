-- نوع الاختبار بالتقارير: تشخيصي (الافتراضي) أو فتري
alter table public.exam_reports add column if not exists exam_type text not null default 'diagnostic';
notify pgrst, 'reload schema';
select count(*) filter (where exam_type = 'diagnostic') as diagnostic, count(*) filter (where exam_type = 'periodic') as periodic from public.exam_reports;
