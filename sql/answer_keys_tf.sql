-- ورقة الإجابة: أسئلة صح وخطأ (عددها من ضمن الأسئلة، وبأولها أو بآخرها)
alter table public.answer_keys add column if not exists tf_count int not null default 0;
alter table public.answer_keys add column if not exists tf_first boolean not null default true;
notify pgrst, 'reload schema';
select count(*) as cols_2 from information_schema.columns
where table_schema = 'public' and table_name = 'answer_keys' and column_name in ('tf_count', 'tf_first');
