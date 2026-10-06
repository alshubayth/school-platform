-- ملفات الإنجاز: قراءة إكسل «قارئ ملفات الإنجاز» من ون درايف وعرض اكتمال ملف كل معلم
-- شغّله مرة وحدة في Supabase SQL Editor (لو طلع تحذير RLS اختر Run anyway)

-- 1) رابط ملف الإكسل لكل مدرسة
create table if not exists public.achv_sources (
  school_id uuid primary key references public.schools(id) on delete cascade,
  xlsx_url text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 2) آخر قراءة للملف (الصفوف + قواعد البنود)
create table if not exists public.achv_snapshots (
  school_id uuid primary key references public.schools(id) on delete cascade,
  rows jsonb not null default '[]'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  fetched_by uuid references public.profiles(id) on delete set null
);

-- 3) ربط اسم مجلد المعلم بحسابه في المنصة
create table if not exists public.achv_teacher_map (
  school_id uuid not null references public.schools(id) on delete cascade,
  folder_name text not null,
  profile_id uuid references public.profiles(id) on delete cascade,
  primary key (school_id, folder_name)
);

alter table public.achv_sources enable row level security;
alter table public.achv_snapshots enable row level security;
alter table public.achv_teacher_map enable row level security;

-- المدير والوكيل (والمالك) فقط يقرون ويعدلون
drop policy if exists achv_sources_mgr on public.achv_sources;
create policy achv_sources_mgr on public.achv_sources for all to authenticated
  using (public.notice_can_manage(school_id)) with check (public.notice_can_manage(school_id));
drop policy if exists achv_snapshots_mgr on public.achv_snapshots;
create policy achv_snapshots_mgr on public.achv_snapshots for all to authenticated
  using (public.notice_can_manage(school_id)) with check (public.notice_can_manage(school_id));
drop policy if exists achv_map_mgr on public.achv_teacher_map;
create policy achv_map_mgr on public.achv_teacher_map for all to authenticated
  using (public.notice_can_manage(school_id)) with check (public.notice_can_manage(school_id));

-- المعلم يشوف صفوف ملفه هو بس (حسب الربط) + قواعد البنود
create or replace function public.achv_my() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; v_folders text[]; v_snap public.achv_snapshots;
begin
  v_school := (select school_id from public.profiles where id = auth.uid());
  if v_school is null then return null; end if;
  v_folders := (select array_agg(folder_name) from public.achv_teacher_map
                 where school_id = v_school and profile_id = auth.uid());
  if v_folders is null then return jsonb_build_object('linked', false); end if;
  v_snap := (select s from public.achv_snapshots s where s.school_id = v_school);
  if v_snap.school_id is null then return jsonb_build_object('linked', true, 'rows', '[]'::jsonb, 'rules', '[]'::jsonb); end if;
  return jsonb_build_object(
    'linked', true, 'folders', to_jsonb(v_folders), 'rules', v_snap.rules, 'fetched_at', v_snap.fetched_at,
    'rows', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_snap.rows) r
                       where r->>'teacher' = any(v_folders)), '[]'::jsonb));
end $$;
revoke all on function public.achv_my() from public, anon;
grant execute on function public.achv_my() to authenticated;

-- 4) تفعيل القسم لكل المدارس
insert into public.school_modules (school_id, module_key, enabled)
select id, 'achievements', true from public.schools
on conflict (school_id, module_key) do nothing;

notify pgrst, 'reload schema';

select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'achv_%') as tables_3,
       (select count(*) from public.school_modules where module_key = 'achievements') as schools_enabled;
