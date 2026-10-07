-- السماح لمدير/وكيل المدرسة بإضافة مادة جديدة لقائمة المواد (مثل: المهارات الحياتية والأسرية)
-- قائمة المواد مشتركة بين المدارس: الإضافة فقط (بدون تعديل أو حذف) عشان ما تتأثر مدرسة ثانية
drop policy if exists subjects_staff_insert on public.subjects;
create policy subjects_staff_insert on public.subjects for insert to authenticated
  with check (public.is_school_staff(public.my_school_id()));
grant insert on public.subjects to authenticated;

-- وتنضاف المهارات الحياتية مباشرة لو مو موجودة
insert into public.subjects (name)
select 'المهارات الحياتية والأسرية'
where not exists (select 1 from public.subjects where name like '%حياتية%');

notify pgrst, 'reload schema';
select id, name from public.subjects order by name;
