-- الميزانية: إعادة ترتيب أرقام البيانات تلقائيًا (بعد sql/budget_statement_series.sql)
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير اختر Run anyway) - آمن لو انشغّل أكثر من مرة
--   • البيان اللي انصرف (أو انرفض) رقمه محجوز وما يتغير
--   • البيانات اللي بانتظار الاعتماد تترتب تلقائيًا بدون فراغات: لو انحذف بيان أو انتقل من المقصف
--     للمدور/السلفة (أو العكس)، اللي بعده بنفس التسلسل يرجعون رقم ويتعبّى الفراغ

-- ترتيب تسلسل: البيانات المعلّقة تاخذ أول الأرقام الفاضية بالترتيب (متخطية الأرقام المحجوزة)
create or replace function public.budget_compact_series(p_school uuid, p_series text) returns void
language plpgsql security definer set search_path = public as $fn$
declare r record; slot int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('budget_stmt:' || coalesce(p_school::text, '-') || ':' || p_series));
  for r in select id, statement_number from public.budget_expense_requests
            where school_id is not distinct from p_school and statement_series = p_series and status = 'pending'
            order by statement_number, created_at
  loop
    loop
      slot := slot + 1;
      exit when not exists (select 1 from public.budget_expense_requests
                             where school_id is not distinct from p_school and statement_series = p_series
                               and status <> 'pending' and statement_number = slot);
    end loop;
    if r.statement_number is distinct from slot then
      update public.budget_expense_requests set statement_number = slot where id = r.id;
    end if;
  end loop;
end $fn$;

-- بعد الحذف أو تغيير جهة الصرف لتسلسل ثاني: نرتب التسلسل القديم
create or replace function public.budget_after_stmt_change() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare s_old text := case when old.funding_source = 'المقصف' then 'canteen' else 'main' end;
begin
  if tg_op = 'DELETE' then
    if old.status = 'pending' then perform public.budget_compact_series(old.school_id, s_old); end if;
    return old;
  end if;
  if s_old <> (case when new.funding_source = 'المقصف' then 'canteen' else 'main' end) then
    perform public.budget_compact_series(old.school_id, s_old);
  end if;
  return new;
end $fn$;

drop trigger if exists budget_after_stmt_change_trg on public.budget_expense_requests;
create trigger budget_after_stmt_change_trg
  after delete or update of funding_source on public.budget_expense_requests
  for each row execute function public.budget_after_stmt_change();

-- الرقم بعد الصرف محجوز: ما ينعدّل يدويًا
create or replace function public.budget_stmt_lock() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if old.status is distinct from 'pending' and new.statement_number is distinct from old.statement_number then
    raise exception 'رقم البيان % محجوز لأن البيان انصرف أو انرفض', old.statement_number;
  end if;
  return new;
end $fn$;

drop trigger if exists budget_stmt_lock_trg on public.budget_expense_requests;
create trigger budget_stmt_lock_trg
  before update of statement_number on public.budget_expense_requests
  for each row execute function public.budget_stmt_lock();

-- نرتب التسلسلين الحين مرة وحدة
select public.budget_compact_series(s.school_id, s.statement_series)
  from (select distinct school_id, statement_series from public.budget_expense_requests) s;

notify pgrst, 'reload schema';

select statement_series, statement_number, status, funding_source, request_date
  from public.budget_expense_requests
 order by statement_series, statement_number;
