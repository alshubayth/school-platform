-- 2026-10-21 | نطاق قراءة تقارير الاختبارات (مُطبَّق على قاعدة البيانات)
-- المالك وإدارة المدرسة: كل تقارير مدرستهم. المعلم: تقاريره، وتقارير مواده في الصفوف التي يدرّسها فقط.
-- مواد المعلم وصفوفه من الجدول الدراسي (class_schedules) ومن المواد المسندة (teacher_subjects)،
-- ومطابقة أسماء المواد بنفس قواعد الواجهة (js/teacher-scope.js: normSubj / subjectMatches / gradeFromText).

create or replace function public.subj_norm(t text) returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(regexp_replace(w, '^(وال|بال|لل|ال)', ''), ' ' order by o), '')
  from regexp_split_to_table(trim(translate(lower(coalesce(t, '')), 'أإآةىًٌٍَُِّْـ', 'اااهي')), '\s+') with ordinality as x(w, o)
  where w <> ''
$$;

create or replace function public.subj_match(a text, b text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  x text := public.subj_norm(a);
  y text := public.subj_norm(b);
  generic text[] := array['لغه','دراسات','مهارات','تربيه','ماده','مقرر'];
  groups text[][] := array[
    array['رقميه','حاسب','حاسوب','تقنيه','',''],
    array['اسلاميه','قران','توحيد','فقه','حديث','تجويد'],
    array['لغتي','عربيه','','','',''],
    array['انجليزي','انجليزيه','english','','',''],
    array['اجتماعيات','اجتماعيه','','','',''],
    array['بدنيه','رياضه بدنيه','','','',''],
    array['فنيه','تربيه فنيه','','','',''],
    array['حياتيه','اسريه','','','','']];
  w text; i int; hx boolean; hy boolean;
begin
  if x = '' or y = '' then return false; end if;
  foreach w in array string_to_array(x, ' ') loop
    if length(w) >= 3 and not (w = any(generic)) and position(w in y) > 0 then return true; end if;
  end loop;
  foreach w in array string_to_array(y, ' ') loop
    if length(w) >= 3 and not (w = any(generic)) and position(w in x) > 0 then return true; end if;
  end loop;
  for i in 1 .. array_length(groups, 1) loop
    hx := false; hy := false;
    foreach w in array groups[i:i] loop
      if w <> '' and position(w in x) > 0 then hx := true; end if;
      if w <> '' and position(w in y) > 0 then hy := true; end if;
    end loop;
    if hx and hy then return true; end if;
  end loop;
  return false;
end $$;

create or replace function public.grade_from_text(t text) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(t,'') ~ '(first|اول|الأول|أول)' then 'first_intermediate'
    when coalesce(t,'') ~ '(second|ثاني|الثاني)' then 'second_intermediate'
    when coalesce(t,'') ~ '(third|ثالث|الثالث)' then 'third_intermediate'
  end
$$;

create or replace function public.can_read_exam_report(p_school uuid, p_created_by uuid, p_subject text, p_title text, p_grade text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role user_role; v_school uuid; v_name text;
  v_subjects text[]; v_grades text[]; g text;
begin
  if v_uid is null then return false; end if;
  select role, school_id, trim(coalesce(full_name, '')) into v_role, v_school, v_name from profiles where id = v_uid;
  if v_role = 'owner' then return true; end if;
  if v_school is null or p_school is distinct from v_school then return false; end if;
  if v_role in ('admin', 'deputy') then return true; end if;
  if v_role is distinct from 'teacher' then return false; end if;
  if p_created_by = v_uid then return true; end if;
  select array_agg(distinct subject_name) filter (where subject_name is not null),
         array_agg(distinct grade_level) filter (where grade_level is not null)
    into v_subjects, v_grades
  from (
    select cs.subject_name, cs.grade_level from class_schedules cs
     where cs.school_id = v_school and (cs.teacher_id = v_uid or (v_name <> '' and cs.teacher_name = v_name))
    union all
    select s.name, ts.grade_level::text from teacher_subjects ts join subjects s on s.id = ts.subject_id
     where ts.teacher_id = v_uid
  ) src;
  if v_subjects is null then return false; end if;
  if not exists (select 1 from unnest(v_subjects) s where public.subj_match(coalesce(nullif(p_subject, ''), p_title), s) or public.subj_match(p_title, s)) then
    return false;
  end if;
  g := coalesce(public.grade_from_text(p_grade), public.grade_from_text(p_title));
  return g is null or g = any(coalesce(v_grades, '{}'));
end $$;

revoke all on function public.can_read_exam_report(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.can_read_exam_report(uuid, uuid, text, text, text) to authenticated;

alter policy exam_reports_staff_read on public.exam_reports
  using ((select public.is_owner()) or public.can_read_exam_report(school_id, created_by, subject_name, title, grade_level));
