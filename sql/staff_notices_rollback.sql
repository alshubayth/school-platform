-- تراجع: حذف التنبيهات (الجداول وكل محتواها)
drop function if exists public.notice_send(text, text, timestamptz, text, text, jsonb, uuid[]), public.notice_mark_read(uuid),
  public.notice_respond(uuid, text, integer), public.notice_remind(uuid);
drop table if exists public.staff_notice_recipients, public.staff_notices;
drop function if exists public.is_notice_recipient(uuid), public.notice_school(uuid);
