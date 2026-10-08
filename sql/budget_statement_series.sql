-- الميزانية: ترقيم بيانات الصرف بتسلسلين منفصلين (المقصف / الميزانية: السلفة + المدور + أخرى)
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير اختر Run anyway) - آمن لو انشغّل أكثر من مرة
--   • الرقم الجديد = أكبر رقم موجود بنفس التسلسل + 1 (لو حذفت آخر بيان، رقمه يرجع ينستخدم)
--   • تغيير جهة الصرف من المقصف لغيره (أو العكس) قبل الاعتماد يعطي البيان رقم جديد بالتسلسل الثاني
--   • تقدر تعدّل الرقم يدويًا بشرط ما يكون مستخدم بنفس التسلسل
--   • الأرقام الحالية ما تتغير (فيه تحت استعلام اختياري لإعادة ترقيم القديمة لو تبي)

-- 1) نشيل الترقيم التلقائي القديم (تسلسل/قيمة افتراضية/قيد فريد على الرقم لحاله/تريقر قديم)
do $$
declare r record; att smallint;
begin
  select attnum into att from pg_attribute
   where attrelid = 'public.budget_expense_requests'::regclass and attname = 'statement_number';

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_expense_requests'
              and column_name = 'statement_number' and is_identity = 'YES') then
    execute 'alter table public.budget_expense_requests alter column statement_number drop identity if exists';
  end if;
  execute 'alter table public.budget_expense_requests alter column statement_number drop default';

  -- قيود فريدة تشمل الرقم (لوحده أو مع المدرسة) - تنبدل بقيد التسلسل الجديد
  for r in select con.conname from pg_constraint con
            where con.conrelid = 'public.budget_expense_requests'::regclass and con.contype = 'u' and att = any (con.conkey)
  loop
    execute format('alter table public.budget_expense_requests drop constraint %I', r.conname);
  end loop;
  for r in select i.relname from pg_index x join pg_class i on i.oid = x.indexrelid
            where x.indrelid = 'public.budget_expense_requests'::regclass and x.indisunique and not x.indisprimary
              and att = any (x.indkey::smallint[]) and i.relname <> 'budget_expense_requests_stmt_series_uq'
  loop
    execute format('drop index if exists public.%I', r.relname);
  end loop;

  -- أي تريقر قديم يعبّي الرقم (غير تريقرنا)
  for r in select t.tgname from pg_trigger t
            where t.tgrelid = 'public.budget_expense_requests'::regclass and not t.tgisinternal
              and t.tgname <> 'budget_statement_no_trg'
              and pg_get_functiondef(t.tgfoid) ilike '%statement_number%'
  loop
    execute format('drop trigger if exists %I on public.budget_expense_requests', r.tgname);
  end loop;
end $$;

-- 2) عمود التسلسل (يتحدد تلقائيًا من جهة الصرف)
alter table public.budget_expense_requests
  add column if not exists statement_series text
  generated always as (case when funding_source = 'المقصف' then 'canteen' else 'main' end) stored;

-- 3) الترقيم: عند الإضافة، وعند تغيير جهة الصرف لتسلسل ثاني، وفحص الرقم لو انعدّل يدويًا
create or replace function public.budget_statement_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s_new text := case when new.funding_source = 'المقصف' then 'canteen' else 'main' end;
  s_old text;
begin
  perform pg_advisory_xact_lock(hashtext('budget_stmt:' || coalesce(new.school_id::text, '-') || ':' || s_new));
  if tg_op = 'INSERT' then
    select coalesce(max(statement_number), 0) + 1 into new.statement_number
      from public.budget_expense_requests
     where school_id is not distinct from new.school_id
       and (case when funding_source = 'المقصف' then 'canteen' else 'main' end) = s_new;
    return new;
  end if;

  s_old := case when old.funding_source = 'المقصف' then 'canteen' else 'main' end;
  if s_old <> s_new and new.statement_number is not distinct from old.statement_number then
    -- انتقل لتسلسل ثاني بدون ما يحدد رقم: ياخذ التالي بالتسلسل الجديد
    select coalesce(max(statement_number), 0) + 1 into new.statement_number
      from public.budget_expense_requests
     where school_id is not distinct from new.school_id and id <> new.id
       and (case when funding_source = 'المقصف' then 'canteen' else 'main' end) = s_new;
  elsif new.statement_number is distinct from old.statement_number or s_old <> s_new then
    if new.statement_number is null or new.statement_number < 1 then
      raise exception 'رقم البيان لازم يكون رقم موجب';
    end if;
    if exists (select 1 from public.budget_expense_requests
                where school_id is not distinct from new.school_id and id <> new.id
                  and statement_number = new.statement_number
                  and (case when funding_source = 'المقصف' then 'canteen' else 'main' end) = s_new) then
      raise exception 'رقم البيان % مستخدم في نفس التسلسل', new.statement_number;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists budget_statement_no_trg on public.budget_expense_requests;
create trigger budget_statement_no_trg
  before insert or update of statement_number, funding_source on public.budget_expense_requests
  for each row execute function public.budget_statement_no();

-- 4) قيد فريد لكل مدرسة + تسلسل (ينضاف بس لو ما فيه تكرار حالي)
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'budget_expense_requests_stmt_series_uq')
     and not exists (select 1 from public.budget_expense_requests where statement_number is not null
                      group by school_id, statement_series, statement_number having count(*) > 1) then
    create unique index budget_expense_requests_stmt_series_uq
      on public.budget_expense_requests (school_id, statement_series, statement_number);
  end if;
end $$;

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.columns where table_name = 'budget_expense_requests' and column_name = 'statement_series') as series_col,
  (select count(*) from pg_trigger where tgname = 'budget_statement_no_trg') as trigger_ok,
  (select count(*) from pg_indexes where indexname = 'budget_expense_requests_stmt_series_uq') as unique_ok,
  (select max(statement_number) from public.budget_expense_requests where statement_series = 'canteen') as last_canteen,
  (select max(statement_number) from public.budget_expense_requests where statement_series = 'main') as last_main;

-- =====================================================================
-- (اختياري) إعادة ترقيم البيانات الحالية من 1 لكل تسلسل حسب تاريخ الإنشاء
-- لا تشغّله لو فيه سندات مطبوعة وتبي أرقامها تبقى مثل ما هي.
-- =====================================================================
-- do $$
-- declare r record;
-- begin
--   alter table public.budget_expense_requests disable trigger budget_statement_no_trg;
--   drop index if exists public.budget_expense_requests_stmt_series_uq;
--   for r in select id, row_number() over (partition by school_id, statement_series order by created_at, statement_number) as n
--              from public.budget_expense_requests loop
--     update public.budget_expense_requests set statement_number = r.n where id = r.id;
--   end loop;
--   create unique index budget_expense_requests_stmt_series_uq on public.budget_expense_requests (school_id, statement_series, statement_number);
--   alter table public.budget_expense_requests enable trigger budget_statement_no_trg;
-- end $$;
