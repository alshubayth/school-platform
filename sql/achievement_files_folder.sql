-- ملفات الإنجاز: مصدر جديد = مجلد ون درايف مباشرة (تقرؤه إضافة مُدار في المتصفح) - طُبّق على قاعدة البيانات
alter table public.achv_sources alter column xlsx_url drop not null;
alter table public.achv_sources add column if not exists folder_url text;
alter table public.achv_snapshots add column if not exists source text not null default 'excel';
alter table public.achv_snapshots add column if not exists viewer text;
alter table public.achv_snapshots add column if not exists root text;
-- achv_my() صارت ترجع source و viewer و root (لروابط عرض الملفات للمعلم)
