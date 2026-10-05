-- =====================================================================
-- التنبيهات للموظفين: تنبيه / طلب اجتماع / استبيان سريع
-- المدير والوكيل يرسلون، والموظف يشوف تنبيهاته بالجرس ويرد (بدون رد / رد مكتوب / خيارات)
-- الكتابة كلها عبر دوال محمية، والقراءة بالصلاحيات: كل موظف تنبيهاته، والإدارة تنبيهات مدرستها
-- =====================================================================
create table if not exists public.staff_notices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 150),
  body text not null default '' check (length(body) <= 3000),
  meeting_at timestamptz,
  location text check (length(location) <= 150),
  response_type text not null default 'none' check (response_type in ('none', 'text', 'choice')),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists staff_notices_school_idx on public.staff_notices (school_id, created_at desc);

create table if not exists public.staff_notice_recipients (
  notice_id uuid not null references public.staff_notices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  response_text text check (length(response_text) <= 1000),
  response_choice integer,
  responded_at timestamptz,
  primary key (notice_id, profile_id)
);
create index if not exists staff_notice_recipients_profile_idx on public.staff_notice_recipients (profile_id);

alter table public.staff_notices enable row level security;
alter table public.staff_notice_recipients enable row level security;

-- مستلم التنبيه (security definer عشان ما تتداخل سياسات الجدولين)
create or replace function public.is_notice_recipient(p_notice uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_notice_recipients where notice_id = p_notice and profile_id = auth.uid())
$$;
create or replace function public.notice_school(p_notice uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.staff_notices where id = p_notice
$$;
grant execute on function public.is_notice_recipient(uuid) to authenticated;
grant execute on function public.notice_school(uuid) to authenticated;

drop policy if exists staff_notices_read on public.staff_notices;
create policy staff_notices_read on public.staff_notices for select to authenticated
  using (public.is_school_staff(school_id) or public.is_notice_recipient(id));
drop policy if exists staff_notices_delete on public.staff_notices;
create policy staff_notices_delete on public.staff_notices for delete to authenticated
  using (public.is_school_staff(school_id));

drop policy if exists staff_notice_recipients_read on public.staff_notice_recipients;
create policy staff_notice_recipients_read on public.staff_notice_recipients for select to authenticated
  using (profile_id = auth.uid() or public.is_school_staff(public.notice_school(notice_id)));

-- ---------- إرسال ----------
create or replace function public.notice_send(p_title text, p_body text, p_meeting_at timestamptz, p_location text,
  p_response_type text, p_options jsonb, p_recipients uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.my_school_id(); v_id uuid; v_n int;
begin
  if auth.uid() is null or v_school is null or not public.is_school_staff(v_school) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if p_response_type not in ('none', 'text', 'choice') then raise exception 'bad response type'; end if;
  if p_response_type = 'choice' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 6) then
    raise exception 'choices must be 2-6';
  end if;
  insert into public.staff_notices (school_id, sender_id, title, body, meeting_at, location, response_type, options)
  values (v_school, auth.uid(), left(trim(p_title), 150), left(coalesce(p_body, ''), 3000), p_meeting_at,
          nullif(left(trim(coalesce(p_location, '')), 150), ''), p_response_type,
          case when p_response_type = 'choice' then p_options else '[]'::jsonb end)
  returning id into v_id;
  -- المستلمين: موظفين نفس المدرسة فقط
  insert into public.staff_notice_recipients (notice_id, profile_id)
  select v_id, p.id from public.profiles p
   where p.id = any(p_recipients) and p.school_id = v_school and p.role::text in ('admin', 'deputy', 'teacher')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no recipients'; end if;
  if to_regprocedure('public.push_emit(jsonb, text, interval)') is not null then
    perform public.push_emit(jsonb_build_object('type', 'notice', 'school_id', v_school, 'notice_id', v_id));
  end if;
  return v_id;
end $$;

-- ---------- قراءة ورد المستلم ----------
create or replace function public.notice_mark_read(p_notice uuid) returns void
language sql security definer set search_path = public as $$
  update public.staff_notice_recipients set read_at = coalesce(read_at, now())
   where notice_id = p_notice and profile_id = auth.uid()
$$;

create or replace function public.notice_respond(p_notice uuid, p_text text, p_choice integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare n public.staff_notices;
begin
  select * into n from public.staff_notices where id = p_notice;
  if n.id is null or n.response_type = 'none' then return false; end if;
  if n.response_type = 'choice' and (p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(n.options)) then return false; end if;
  if n.response_type = 'text' and coalesce(trim(p_text), '') = '' then return false; end if;
  update public.staff_notice_recipients
     set response_text = case when n.response_type = 'text' then left(trim(p_text), 1000) else null end,
         response_choice = case when n.response_type = 'choice' then p_choice else null end,
         responded_at = now(), read_at = coalesce(read_at, now())
   where notice_id = p_notice and profile_id = auth.uid();
  return found;
end $$;

-- ---------- تذكير اللي ما ردّوا (أو ما اطلعوا لو التنبيه بدون رد) ----------
create or replace function public.notice_remind(p_notice uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n public.staff_notices; v_ids uuid[];
begin
  select * into n from public.staff_notices where id = p_notice;
  if n.id is null or not public.is_school_staff(n.school_id) then return -1; end if;
  select array_agg(profile_id) into v_ids from public.staff_notice_recipients
   where notice_id = p_notice and (case when n.response_type = 'none' then read_at is null else responded_at is null end);
  if v_ids is null then return 0; end if;
  if to_regprocedure('public.push_emit(jsonb, text, interval)') is not null then
    perform public.push_emit(jsonb_build_object('type', 'notice', 'school_id', n.school_id, 'notice_id', n.id,
      'reminder', true, 'profile_ids', to_jsonb(v_ids)), 'remind:' || n.id, interval '10 minutes');
  end if;
  return coalesce(array_length(v_ids, 1), 0);
end $$;

revoke all on function public.notice_send(text, text, timestamptz, text, text, jsonb, uuid[]) from public, anon;
revoke all on function public.notice_mark_read(uuid) from public, anon;
revoke all on function public.notice_respond(uuid, text, integer) from public, anon;
revoke all on function public.notice_remind(uuid) from public, anon;
grant execute on function public.notice_send(text, text, timestamptz, text, text, jsonb, uuid[]) to authenticated;
grant execute on function public.notice_mark_read(uuid) to authenticated;
grant execute on function public.notice_respond(uuid, text, integer) to authenticated;
grant execute on function public.notice_remind(uuid) to authenticated;

-- تحقق: tables = 2، functions = 6، policies = 3
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('staff_notices', 'staff_notice_recipients')) as tables,
  (select count(*) from pg_proc where proname in ('notice_send', 'notice_mark_read', 'notice_respond', 'notice_remind', 'is_notice_recipient', 'notice_school')) as functions,
  (select count(*) from pg_policies where tablename in ('staff_notices', 'staff_notice_recipients')) as policies;
