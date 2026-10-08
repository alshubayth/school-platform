-- المناوبات (الإصدار الجديد): مواقع المناوبة + التوزيع الأسبوعي + تغييرات يوم محدد + تسجيل الحضور + أيام التعليق
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير اختر Run anyway) - آمن لو انشغّل أكثر من مرة
-- الجداول القديمة (duty_types / duty_roster / duty_attendance) ما تنحذف ولا تتغير.
--   • القراءة: كل موظفي المدرسة (المعلم يشوف جدول المناوبات)
--   • الكتابة: المدير والوكيل بس

-- مواقع المناوبة: كل موقع مربوط بوقت (slot)
--   morning = الصباح، suspension = وقت التعليق، break = الفسحة، prayer1/prayer2 = الصلاة، dismissal = الانصراف
create table if not exists public.duty_posts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  slot text not null,
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists duty_posts_school_idx on public.duty_posts (school_id, slot, sort);

-- التوزيع الأسبوعي الثابت: معلم واحد لكل موقع بكل يوم
create table if not exists public.duty_plan (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  post_id uuid not null references public.duty_posts(id) on delete cascade,
  day_of_week text not null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (post_id, day_of_week)
);
create index if not exists duty_plan_school_idx on public.duty_plan (school_id, day_of_week);
create index if not exists duty_plan_teacher_idx on public.duty_plan (teacher_id);

-- تغيير ليوم محدد (بديل أو إلغاء) بدون ما يتأثر الجدول الأسبوعي. teacher_id = null يعني ما فيه مناوب هاليوم
create table if not exists public.duty_overrides (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  post_id uuid not null references public.duty_posts(id) on delete cascade,
  duty_date date not null,
  teacher_id uuid references public.profiles(id) on delete cascade,
  original_teacher_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (post_id, duty_date)
);
create index if not exists duty_overrides_school_idx on public.duty_overrides (school_id, duty_date);

-- تسجيل الحضور: حاضر / متأخر / غائب
create table if not exists public.duty_marks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  post_id uuid not null references public.duty_posts(id) on delete cascade,
  duty_date date not null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('present', 'late', 'absent')),
  late_minutes int,
  marked_by uuid default auth.uid(),
  marked_at timestamptz not null default now(),
  unique (post_id, duty_date, teacher_id)
);
create index if not exists duty_marks_school_idx on public.duty_marks (school_id, duty_date);

-- أيام التعليق (حر/مطر/رطوبة): تظهر فيها مناوبات الممرات بدل ساحة الطابور
create table if not exists public.duty_suspensions (
  school_id uuid not null,
  duty_date date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (school_id, duty_date)
);

do $$
declare t text;
begin
  foreach t in array array['duty_posts', 'duty_plan', 'duty_overrides', 'duty_marks', 'duty_suspensions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff_of(school_id))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id))', t || '_write', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('duty_posts', 'duty_plan', 'duty_overrides', 'duty_marks', 'duty_suspensions')) as tables_ok,
  (select count(*) from pg_policies where tablename in ('duty_posts', 'duty_plan', 'duty_overrides', 'duty_marks', 'duty_suspensions')) as policies;
