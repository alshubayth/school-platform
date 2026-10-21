-- 2026-10-21 | حد المقالي في تقرير الاختبار يتبع مفتاح الإجابة المرتبط به (مُطبَّق على قاعدة البيانات)
-- السبب: تعديل «درجة المقالي» في المفتاح لم يكن ينعكس على التقارير المرفوعة قبله، فتُقصّ درجات المقالي بصمت.

create or replace function public.report_key_id(rd jsonb, kid uuid) returns uuid
language sql immutable set search_path = public as $$
  select coalesce(kid,
    case when coalesce(rd->'models'->>'keyId', '') ~* '^[0-9a-f-]{36}$' then (rd->'models'->>'keyId')::uuid end,
    case when coalesce(rd->>'keyId', '') ~* '^[0-9a-f-]{36}$' then (rd->>'keyId')::uuid end)
$$;

-- عند حفظ تقرير مرتبط بمفتاح فيه مقالي: يؤخذ حد المقالي من المفتاح
create or replace function public.trg_report_essay_from_key() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total int;
begin
  if new.raw_data is null or jsonb_typeof(new.raw_data->'students') is distinct from 'array' then return new; end if;
  select k.essay_total into v_total from answer_keys k
   where k.id = public.report_key_id(new.raw_data, new.key_id) and k.school_id is not distinct from new.school_id;
  if coalesce(v_total, 0) > 0 and exists (select 1 from jsonb_array_elements(new.raw_data->'students') s where jsonb_typeof(s->'essay') = 'number') then
    new.raw_data := jsonb_set(jsonb_set(new.raw_data, '{essayMax}', to_jsonb(v_total)), '{hasEssay}', 'true'::jsonb);
  end if;
  return new;
end $$;

create or replace trigger trg_report_essay_from_key before insert or update of raw_data, key_id on public.exam_reports
  for each row execute function public.trg_report_essay_from_key();

-- عند تعديل حد المقالي في المفتاح: تُحدَّث التقارير المرتبطة به في نفس المدرسة
create or replace function public.trg_key_essay_to_reports() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.essay_total, 0) > 0 and new.essay_total is distinct from old.essay_total then
    update exam_reports r set raw_data = jsonb_set(r.raw_data, '{essayMax}', to_jsonb(new.essay_total))
     where public.report_key_id(r.raw_data, r.key_id) = new.id
       and r.school_id is not distinct from new.school_id
       and jsonb_typeof(r.raw_data->'students') = 'array'
       and exists (select 1 from jsonb_array_elements(r.raw_data->'students') s where jsonb_typeof(s->'essay') = 'number');
  end if;
  return new;
end $$;

create or replace trigger trg_key_essay_to_reports after update of essay_total on public.answer_keys
  for each row execute function public.trg_key_essay_to_reports();

revoke all on function public.trg_report_essay_from_key() from public, anon, authenticated;
revoke all on function public.trg_key_essay_to_reports() from public, anon, authenticated;
