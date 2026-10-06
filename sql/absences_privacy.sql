-- خصوصية غياب واستئذان المعلمين: يشوفه ويعدّله المدير والوكيل (والمالك) فقط
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'daily_teacher_absences' loop
    execute format('drop policy %I on public.daily_teacher_absences', r.policyname);
  end loop;
end $$;

alter table public.daily_teacher_absences enable row level security;

create policy absences_managers on public.daily_teacher_absences for all to authenticated
  using (
    public.notice_can_manage(school_id)
    or (school_id is null and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('owner', 'admin', 'deputy')))
  )
  with check (
    public.notice_can_manage(school_id)
    or (school_id is null and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('owner', 'admin', 'deputy')))
  );

notify pgrst, 'reload schema';

select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'daily_teacher_absences';
