-- الزيارات الصفية: تسجيل وقت اطّلاع المعلم على الزيارة المنشورة له
-- (يظهر للمدير/الوكيل كحالة "اطّلع عليها المعلم")
alter table public.classroom_visits add column if not exists teacher_seen_at timestamptz;

-- المعلم يسجّل اطّلاعه عبر دالة محدودة (تحدّث هذا العمود فقط ولزياراته المنشورة فقط)
-- بدل ما نعطيه صلاحية تعديل كاملة على جدول الزيارات
create or replace function public.mark_visits_seen(visit_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.classroom_visits
     set teacher_seen_at = now()
   where id = any(visit_ids)
     and teacher_profile_id = auth.uid()
     and published = true
     and teacher_seen_at is null;
$$;

grant execute on function public.mark_visits_seen(uuid[]) to authenticated;
