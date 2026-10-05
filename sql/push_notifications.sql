-- =====================================================================
-- إشعارات الجوال (Web Push)
-- 1) جدول الاشتراكات (محمي بالكامل: الكتابة عبر دوال، والقراءة لخادم الإرسال فقط)
-- 2) دوال الاشتراك لولي الأمر (بدون دخول) وللموظف (مسجّل دخول)
-- 3) Triggers ترسل الحدث لخادم الإرسال على Vercel عبر pg_net - وأي خطأ فيها ما يوقف حفظ المستخدم
-- قبل التشغيل: استبدل __PUSH_SECRET__ بالقيمة السرية نفسها اللي بإعدادات Vercel
-- =====================================================================
create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id bigserial primary key,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  audience text not null check (audience in ('parent', 'staff')),
  profile_id uuid references public.profiles(id) on delete cascade,
  targets jsonb not null default '[]'::jsonb,   -- ولي الأمر: [{"grade":"first_intermediate","section":2}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint, audience)
);
alter table public.push_subscriptions enable row level security;
-- بدون سياسات: لا أحد يقرأ أو يكتب مباشرة (فقط الدوال تحت + مفتاح الخادم)

-- إعدادات الإرسال (رابط الخادم والقيمة السرية) - محمية بدون سياسات
create table if not exists public.push_config (key text primary key, value text not null);
alter table public.push_config enable row level security;
insert into public.push_config (key, value) values
  ('url', 'https://school-platform-theta-eight.vercel.app/api/push'),
  ('secret', '__PUSH_SECRET__')
on conflict (key) do update set value = excluded.value;

-- منع تكرار نفس الإشعار خلال فترة قصيرة (حفظ متكرر لنفس الشي)
create table if not exists public.push_dedupe (key text primary key, at timestamptz not null default now());
alter table public.push_dedupe enable row level security;

-- ---------- الاشتراك ----------
create or replace function public.push_subscribe_parent(p_school_slug text, p_endpoint text, p_p256dh text, p_auth text, p_targets jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_school uuid;
begin
  if p_endpoint is null or length(p_endpoint) > 1000 or p_endpoint not like 'https://%' then return false; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) > 10 then return false; end if;
  select id into v_school from public.schools where slug = p_school_slug;
  if v_school is null then return false; end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, school_id, audience, targets)
  values (p_endpoint, left(p_p256dh, 200), left(p_auth, 100), v_school, 'parent', p_targets)
  on conflict (endpoint, audience) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, school_id = excluded.school_id,
        targets = excluded.targets, updated_at = now();
  return true;
end $$;

create or replace function public.push_subscribe_staff(p_endpoint text, p_p256dh text, p_auth text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.my_school_id();
begin
  if auth.uid() is null or v_school is null then return false; end if;
  if p_endpoint is null or length(p_endpoint) > 1000 or p_endpoint not like 'https://%' then return false; end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, school_id, audience, profile_id)
  values (p_endpoint, left(p_p256dh, 200), left(p_auth, 100), v_school, 'staff', auth.uid())
  on conflict (endpoint, audience) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, school_id = excluded.school_id,
        profile_id = excluded.profile_id, updated_at = now();
  return true;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text, p_audience text)
returns boolean language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and audience = p_audience returning true
$$;

revoke all on function public.push_subscribe_parent(text, text, text, text, jsonb) from public;
revoke all on function public.push_subscribe_staff(text, text, text) from public;
revoke all on function public.push_unsubscribe(text, text) from public;
grant execute on function public.push_subscribe_parent(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.push_subscribe_staff(text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text, text) to anon, authenticated;

-- ---------- إرسال حدث لخادم الإرسال ----------
create or replace function public.push_emit(p_event jsonb, p_dedupe text default null, p_window interval default interval '10 minutes')
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if p_dedupe is not null then
    delete from public.push_dedupe where at < now() - interval '1 day';
    if exists (select 1 from public.push_dedupe where key = p_dedupe and at > now() - p_window) then return; end if;
    insert into public.push_dedupe (key, at) values (p_dedupe, now()) on conflict (key) do update set at = now();
  end if;
  select value into v_url from public.push_config where key = 'url';
  select value into v_secret from public.push_config where key = 'secret';
  if v_url is null or v_secret is null or v_secret = '__PUSH_SECRET__' then return; end if;
  perform net.http_post(url := v_url, body := p_event,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret));
exception when others then
  raise warning 'push_emit failed: %', sqlerrm;  -- ما نوقف حفظ المستخدم أبدًا
end $$;
revoke all on function public.push_emit(jsonb, text, interval) from public, anon, authenticated;

-- ---------- 1) نشر الخطة الأسبوعية ----------
create or replace function public.push_trg_plan_published() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published is true and (tg_op = 'INSERT' or old.is_published is distinct from true) then
    perform public.push_emit(jsonb_build_object('type', 'plan_published', 'school_id', new.school_id,
      'week_number', new.week_number), 'plan:' || coalesce(new.school_id::text, '') || ':' || new.week_number, interval '6 hours');
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_plan_published on public.weekly_plan_publish_settings;
create trigger push_plan_published after insert or update on public.weekly_plan_publish_settings
  for each row execute function public.push_trg_plan_published();

-- ---------- 2) جدول الاختبارات الفترية (نشر أو تعديل بعد النشر) ----------
create or replace function public.push_trg_exams_published() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published is true and (tg_op = 'INSERT' or old.is_published is distinct from true) then
    perform public.push_emit(jsonb_build_object('type', 'exams_published', 'school_id', new.school_id,
      'grade_level', new.grade_level), 'exams:' || coalesce(new.school_id::text, '') || ':' || new.grade_level, interval '30 minutes');
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_exams_published on public.exam_coverage_publish_settings;
create trigger push_exams_published after insert or update on public.exam_coverage_publish_settings
  for each row execute function public.push_trg_exams_published();

create or replace function public.push_trg_exams_updated() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct n.school_id, n.grade_level from newrows n
           join public.exam_coverage_publish_settings p
             on p.grade_level = n.grade_level and p.school_id is not distinct from n.school_id and p.is_published is true
  loop
    perform public.push_emit(jsonb_build_object('type', 'exams_updated', 'school_id', r.school_id, 'grade_level', r.grade_level),
      'exams:' || coalesce(r.school_id::text, '') || ':' || r.grade_level, interval '30 minutes');
  end loop;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_exams_updated_ins on public.subject_exam_coverage;
drop trigger if exists push_exams_updated_upd on public.subject_exam_coverage;
create trigger push_exams_updated_ins after insert on public.subject_exam_coverage
  referencing new table as newrows for each statement execute function public.push_trg_exams_updated();
create trigger push_exams_updated_upd after update on public.subject_exam_coverage
  referencing new table as newrows for each statement execute function public.push_trg_exams_updated();

-- ---------- 3) حصة انتظار / تغيير بجدول اليوم ----------
create or replace function public.push_trg_schedule_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(new.teacher_name), '') <> ''
     and (tg_op = 'INSERT' or old.teacher_name is distinct from new.teacher_name)
     and new.change_date >= (now() at time zone 'Asia/Riyadh')::date then
    perform public.push_emit(jsonb_build_object('type', 'schedule_change', 'school_id', new.school_id,
      'teacher_name', new.teacher_name, 'change_date', new.change_date, 'period_number', new.period_number,
      'grade_level', new.grade_level, 'class_section', new.class_section, 'subject_name', new.subject_name, 'reason', new.reason),
      'sch:' || coalesce(new.school_id::text, '') || ':' || new.change_date || ':' || new.period_number || ':' || new.grade_level || ':' || new.class_section || ':' || new.teacher_name,
      interval '30 minutes');
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_schedule_change on public.daily_schedule_changes;
create trigger push_schedule_change after insert or update on public.daily_schedule_changes
  for each row execute function public.push_trg_schedule_change();

-- ---------- 4) الخطة التشغيلية: طلبات تنتظر الاعتماد ----------
create or replace function public.push_trg_op_tasks_pending() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select school_id, employee_profile_id, count(*) as n from newrows
           where plan_status = 'pending' group by school_id, employee_profile_id
  loop
    perform public.push_emit(jsonb_build_object('type', 'op_pending', 'kind', 'plan', 'school_id', r.school_id,
      'profile_id', r.employee_profile_id, 'count', r.n));
  end loop;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_op_tasks_pending on public.op_tasks;
create trigger push_op_tasks_pending after insert on public.op_tasks
  referencing new table as newrows for each statement execute function public.push_trg_op_tasks_pending();

create or replace function public.push_trg_op_comp_pending() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select t.school_id, t.employee_profile_id, count(*) as n
             from newrows c join public.op_tasks t on t.id = c.task_id
            where coalesce(c.status, 'pending') = 'pending' group by t.school_id, t.employee_profile_id
  loop
    perform public.push_emit(jsonb_build_object('type', 'op_pending', 'kind', 'completion', 'school_id', r.school_id,
      'profile_id', r.employee_profile_id, 'count', r.n));
  end loop;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_op_comp_pending on public.op_task_completions;
create trigger push_op_comp_pending after insert on public.op_task_completions
  referencing new table as newrows for each statement execute function public.push_trg_op_comp_pending();

-- ---------- 5) الخطة التشغيلية: نتيجة الاعتماد لصاحب المهمة ----------
create or replace function public.push_trg_op_tasks_reviewed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select n.school_id, n.employee_profile_id,
                  count(*) filter (where n.plan_status = 'approved') as ok,
                  count(*) filter (where n.plan_status = 'rejected') as bad,
                  min(n.title) as title
             from newrows n join oldrows o on o.id = n.id
            where n.plan_status in ('approved', 'rejected') and o.plan_status is distinct from n.plan_status
            group by n.school_id, n.employee_profile_id
  loop
    perform public.push_emit(jsonb_build_object('type', 'op_reviewed', 'kind', 'plan', 'school_id', r.school_id,
      'profile_id', r.employee_profile_id, 'approved', r.ok, 'rejected', r.bad, 'title', r.title));
  end loop;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_op_tasks_reviewed on public.op_tasks;
create trigger push_op_tasks_reviewed after update on public.op_tasks
  referencing old table as oldrows new table as newrows for each statement execute function public.push_trg_op_tasks_reviewed();

create or replace function public.push_trg_op_comp_reviewed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select t.school_id, t.employee_profile_id,
                  count(*) filter (where n.status = 'approved') as ok,
                  count(*) filter (where n.status = 'rejected') as bad,
                  min(t.title) as title
             from newrows n join oldrows o on o.id = n.id join public.op_tasks t on t.id = n.task_id
            where n.status in ('approved', 'rejected') and o.status is distinct from n.status
            group by t.school_id, t.employee_profile_id
  loop
    perform public.push_emit(jsonb_build_object('type', 'op_reviewed', 'kind', 'completion', 'school_id', r.school_id,
      'profile_id', r.employee_profile_id, 'approved', r.ok, 'rejected', r.bad, 'title', r.title));
  end loop;
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_op_comp_reviewed on public.op_task_completions;
create trigger push_op_comp_reviewed after update on public.op_task_completions
  referencing old table as oldrows new table as newrows for each statement execute function public.push_trg_op_comp_reviewed();

-- تحقق: tables = 3، triggers = 9، secret_set = true
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('push_subscriptions', 'push_config', 'push_dedupe')) as tables,
  (select count(*) from pg_trigger where tgname like 'push\_%' and not tgisinternal) as triggers,
  (select value <> '__PUSH_SECRET__' from public.push_config where key = 'secret') as secret_set;
