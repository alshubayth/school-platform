-- تراجع: يشيل شرط المدرسة اللي انضاف على سياسات الطلاب (القيد الجديد على رقم الهوية + المدرسة يبقى)
do $$
declare p record; suffix text := ' and public.same_school(school_id)';
begin
  for p in select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'students'
  loop
    if p.qual like '%same_school(school_id)%' then
      execute format('alter policy %I on public.students using (%s)', p.policyname,
        regexp_replace(p.qual, '\s*AND\s+same_school\(school_id\)\s*\)?\s*$', '', 'i'));
    end if;
    if p.with_check like '%same_school(school_id)%' then
      execute format('alter policy %I on public.students with check (%s)', p.policyname,
        regexp_replace(p.with_check, '\s*AND\s+same_school\(school_id\)\s*\)?\s*$', '', 'i'));
    end if;
  end loop;
end $$;
select policyname, qual from pg_policies where tablename = 'students';
