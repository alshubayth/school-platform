-- الاختبار بنموذجين: إجابات النموذج ب + نموذج كل طالب (برقم هويته) مع مفتاح الإجابة
alter table public.answer_keys add column if not exists models jsonb;
alter table public.answer_keys add column if not exists model_map jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
-- تأكيد: المفروض يطلع 2
select count(*) as new_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'answer_keys' and column_name in ('models', 'model_map');
