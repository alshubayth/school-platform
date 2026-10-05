-- إشعارات جدول اليوم بعد الاعتماد فقط (بدل إشعار مع كل تعديل)
-- 1) إيقاف إشعار كل خانة لحظة التعديل
drop trigger if exists push_schedule_change on public.daily_schedule_changes;

-- 2) زر «اعتماد وإشعار المعلمين»: إشعار واحد لكل معلم بكل حصصه المتغيرة في اليوم
--    المعلم اللي ما تغيّر شي بحصصه من آخر اعتماد ما يوصله إشعار ثاني
create or replace function public.push_notify_schedule(p_date date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.my_school_id(); r record; n integer := 0; v_key text;
begin
  if auth.uid() is null or v_school is null then return -1; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'deputy', 'owner')) then return -1; end if;
  for r in
    select trim(teacher_name) as teacher,
           jsonb_agg(jsonb_build_object('period', period_number, 'grade', grade_level, 'section', class_section,
                     'subject', subject_name, 'reason', reason) order by period_number) as items,
           md5(string_agg(period_number || '|' || grade_level || '|' || class_section || '|' || coalesce(subject_name, ''), ',' order by period_number, grade_level, class_section)) as sig
      from public.daily_schedule_changes
     where school_id = v_school and change_date = p_date and coalesce(trim(teacher_name), '') <> ''
     group by trim(teacher_name)
  loop
    v_key := 'schday:' || v_school || ':' || p_date || ':' || r.teacher || ':' || r.sig;
    if exists (select 1 from public.push_dedupe where key = v_key) then continue; end if;
    perform public.push_emit(jsonb_build_object('type', 'schedule_day', 'school_id', v_school, 'teacher_name', r.teacher,
      'change_date', p_date, 'items', r.items), v_key, interval '2 days');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.push_notify_schedule(date) from public, anon;
grant execute on function public.push_notify_schedule(date) to authenticated;

-- push_emit كان يحذف سجلات منع التكرار الأقدم من يوم - نخليها 3 أيام عشان اعتماد جدول بكرة ما يتكرر
create or replace function public.push_emit(p_event jsonb, p_dedupe text default null, p_window interval default interval '10 minutes')
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if p_dedupe is not null then
    delete from public.push_dedupe where at < now() - interval '3 days';
    if exists (select 1 from public.push_dedupe where key = p_dedupe and at > now() - p_window) then return; end if;
    insert into public.push_dedupe (key, at) values (p_dedupe, now()) on conflict (key) do update set at = now();
  end if;
  select value into v_url from public.push_config where key = 'url';
  select value into v_secret from public.push_config where key = 'secret';
  if v_url is null or v_secret is null or v_secret = '__PUSH_SECRET__' then return; end if;
  perform net.http_post(url := v_url, body := p_event,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret));
exception when others then
  raise warning 'push_emit failed: %', sqlerrm;
end $$;
revoke all on function public.push_emit(jsonb, text, interval) from public, anon, authenticated;

-- تحقق: old_trigger = 0، fn = 1
select (select count(*) from pg_trigger where tgname = 'push_schedule_change') as old_trigger,
       (select count(*) from pg_proc where proname = 'push_notify_schedule') as fn;
