-- مفاتيح الإجابة: أسئلة صح وخطأ + فصول الاختبار
alter table public.answer_keys add column if not exists tf_count int not null default 0;
alter table public.answer_keys add column if not exists tf_first boolean not null default true;
alter table public.answer_keys add column if not exists sections jsonb;   -- null = كل فصول المرحلة
notify pgrst, 'reload schema';
select count(*) as cols_3 from information_schema.columns
where table_schema = 'public' and table_name = 'answer_keys' and column_name in ('tf_count', 'tf_first', 'sections');
