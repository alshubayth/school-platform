-- تراجع: يرجّع سياسات الطلاب لنصها الأصلي من النسخة الاحتياطية (القيد الجديد على رقم الهوية + المدرسة يبقى)
do $$
declare b record;
begin
  for b in select * from public._policy_backup where tablename = 'students'
  loop
    if b.qual is not null then
      execute format('alter policy %I on public.students using (%s)', b.policyname, b.qual);
    end if;
    if b.with_check is not null then
      execute format('alter policy %I on public.students with check (%s)', b.policyname, b.with_check);
    end if;
  end loop;
end $$;
select policyname, qual from pg_policies where tablename = 'students';
