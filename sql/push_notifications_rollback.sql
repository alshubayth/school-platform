-- تراجع: يوقف إشعارات الجوال (يحذف الـ triggers والدوال والجداول)
drop trigger if exists push_plan_published on public.weekly_plan_publish_settings;
drop trigger if exists push_exams_published on public.exam_coverage_publish_settings;
drop trigger if exists push_exams_updated_ins on public.subject_exam_coverage;
drop trigger if exists push_exams_updated_upd on public.subject_exam_coverage;
drop trigger if exists push_schedule_change on public.daily_schedule_changes;
drop trigger if exists push_op_tasks_pending on public.op_tasks;
drop trigger if exists push_op_comp_pending on public.op_task_completions;
drop trigger if exists push_op_tasks_reviewed on public.op_tasks;
drop trigger if exists push_op_comp_reviewed on public.op_task_completions;
drop function if exists public.push_trg_plan_published(), public.push_trg_exams_published(), public.push_trg_exams_updated(),
  public.push_trg_schedule_change(), public.push_trg_op_tasks_pending(), public.push_trg_op_comp_pending(),
  public.push_trg_op_tasks_reviewed(), public.push_trg_op_comp_reviewed();
drop function if exists public.push_emit(jsonb, text, interval);
drop function if exists public.push_subscribe_parent(text, text, text, text, jsonb), public.push_subscribe_staff(text, text, text), public.push_unsubscribe(text, text);
drop table if exists public.push_dedupe, public.push_config, public.push_subscriptions;
