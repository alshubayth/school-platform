-- إصلاح صلاحية إرسال التنبيهات: التحقق من دور الحساب مباشرة، ومالك النظام يرسل باسم المدرسة المفتوحة عنده
create or replace function public.notice_can_manage(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p_school is not null
       and (p.role::text = 'owner' or (p.role::text in ('admin', 'deputy') and p.school_id = p_school))
  )
$$;
grant execute on function public.notice_can_manage(uuid) to authenticated;

drop policy if exists staff_notices_read on public.staff_notices;
create policy staff_notices_read on public.staff_notices for select to authenticated
  using (public.notice_can_manage(school_id) or public.is_notice_recipient(id));
drop policy if exists staff_notices_delete on public.staff_notices;
create policy staff_notices_delete on public.staff_notices for delete to authenticated
  using (public.notice_can_manage(school_id));
drop policy if exists staff_notice_recipients_read on public.staff_notice_recipients;
create policy staff_notice_recipients_read on public.staff_notice_recipients for select to authenticated
  using (profile_id = auth.uid() or public.notice_can_manage(public.notice_school(notice_id)));

drop function if exists public.notice_send(text, text, timestamptz, text, text, jsonb, uuid[]);
create or replace function public.notice_send(p_title text, p_body text, p_meeting_at timestamptz, p_location text,
  p_response_type text, p_options jsonb, p_recipients uuid[], p_school uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_id uuid; v_n int;
begin
  select case when role::text = 'owner' then coalesce(p_school, school_id) else school_id end into v_school
    from public.profiles where id = auth.uid();
  if auth.uid() is null or v_school is null or not public.notice_can_manage(v_school) then raise exception 'not allowed'; end if;
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
revoke all on function public.notice_send(text, text, timestamptz, text, text, jsonb, uuid[], uuid) from public, anon;
grant execute on function public.notice_send(text, text, timestamptz, text, text, jsonb, uuid[], uuid) to authenticated;

create or replace function public.notice_remind(p_notice uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n public.staff_notices; v_ids uuid[];
begin
  select * into n from public.staff_notices where id = p_notice;
  if n.id is null or not public.notice_can_manage(n.school_id) then return -1; end if;
  select array_agg(profile_id) into v_ids from public.staff_notice_recipients
   where notice_id = p_notice and (case when n.response_type = 'none' then read_at is null else responded_at is null end);
  if v_ids is null then return 0; end if;
  if to_regprocedure('public.push_emit(jsonb, text, interval)') is not null then
    perform public.push_emit(jsonb_build_object('type', 'notice', 'school_id', n.school_id, 'notice_id', n.id,
      'reminder', true, 'profile_ids', to_jsonb(v_ids)), 'remind:' || n.id, interval '10 minutes');
  end if;
  return coalesce(array_length(v_ids, 1), 0);
end $$;

-- تحقق بحسابك: can_send لازم true
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'mahdial-shubith@live.com'), 'role', 'authenticated')::text, true);
select (select role::text from public.profiles where id = auth.uid()) as my_role,
       (select school_id is not null from public.profiles where id = auth.uid()) as has_school,
       public.notice_can_manage(coalesce((select school_id from public.profiles where id = auth.uid()), (select id from public.schools limit 1))) as can_send;
rollback;
