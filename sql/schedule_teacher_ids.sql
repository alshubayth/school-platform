-- الجدول الدراسي: نحفظ حساب المعلم (teacher_id) ورقمه الوظيفي من ملف الجدول مع كل حصة
-- عشان الربط ما يعتمد على تطابق الأسماء (تخصصات المعلم، فصوله المسندة، كشوف الطلاب...)
alter table public.class_schedules add column if not exists teacher_id uuid references public.profiles(id) on delete set null;
alter table public.class_schedules add column if not exists teacher_code text;
create index if not exists class_schedules_teacher_idx on public.class_schedules (teacher_id);
notify pgrst, 'reload schema';
select count(*) filter (where column_name in ('teacher_id', 'teacher_code')) as cols_2
from information_schema.columns where table_schema = 'public' and table_name = 'class_schedules';
