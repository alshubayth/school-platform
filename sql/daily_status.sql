-- جدول اليوم والبدلاء: نوع حالة المعلم لليوم (غائب / مستأذن من حصة / متأخر لين حصة)
alter table public.daily_teacher_absences add column if not exists kind text not null default 'absent';
alter table public.daily_teacher_absences add column if not exists from_period int;
