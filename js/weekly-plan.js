import { sb, currentUserId, currentProfile, isAdminOrDeputy, isStaff, gradeLabels } from './core.js';

/* ===== تقييد نموذج الخطة الأسبوعية للمعلم حسب تخصصه ===== */
let teacherAssignments = [];
async function loadTeacherAssignments() {
  const { data } = await sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)').eq('teacher_id', currentUserId);
  teacherAssignments = data || [];
}

function restrictWeeklyFormForTeacher() {
  const gradeSelect = document.getElementById('weekly-grade');
  const subSelect = document.getElementById('weekly-subject');
  const allowedGrades = [...new Set(teacherAssignments.map(a => a.grade_level))];

  if (teacherAssignments.length === 0) {
    document.getElementById('weekly-form-card').innerHTML = '<p style="color:var(--slate); font-size:13px;">ما عندك تخصيص مادة/مرحلة بعد. راجع المدير عشان يضيفك من "إدارة الصلاحيات".</p>';
    return;
  }

  gradeSelect.innerHTML = '';
  allowedGrades.forEach(g => { const o=document.createElement('option'); o.value=g; o.textContent=gradeLabels[g]; gradeSelect.appendChild(o); });

function refreshSubjectsForGrade() {
    const grade = gradeSelect.value;
    subSelect.innerHTML = '';
    teacherAssignments.filter(a => a.grade_level === grade).forEach(a => {
      const o = document.createElement('option'); o.value = a.subject_id; o.textContent = a.subjects ? a.subjects.name : ''; subSelect.appendChild(o);
    });
    loadFormForCurrentSelection();
  }
  gradeSelect.addEventListener('change', () => { refreshSubjectsForGrade(); refreshWeeklyList(); });
  subSelect.addEventListener('change', loadFormForCurrentSelection);
  refreshSubjectsForGrade();
}

/* ===== دعم أكثر من درس بنفس خطة المادة ===== */
function addLessonRow(value = '') {
  const container = document.getElementById('weekly-lessons-container');
  const row = document.createElement('div');
  row.className = 'lesson-row';
  row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; margin-bottom:10px;';
  row.innerHTML = `
    <textarea class="weekly-lesson-input" placeholder="الدرس" rows="2" style="flex:1; margin-bottom:0;"></textarea>
    <button type="button" class="lesson-remove-btn text-action-btn" style="color:var(--danger) !important; white-space:nowrap;">حذف</button>`;
  row.querySelector('.weekly-lesson-input').value = value;
  row.querySelector('.lesson-remove-btn').addEventListener('click', () => {
    row.remove();
    const c = document.getElementById('weekly-lessons-container');
    if (c.children.length === 0) addLessonRow('');
  });
  document.getElementById('weekly-lessons-container').appendChild(row);
}

function renderLessonInputs(lessons) {
  const container = document.getElementById('weekly-lessons-container');
  container.innerHTML = '';
  const list = (lessons && lessons.length > 0) ? lessons : [''];
  list.forEach(val => addLessonRow(val));
}

function collectLessons() {
  return Array.from(document.querySelectorAll('.weekly-lesson-input'))
    .map(t => t.value.trim())
    .filter(v => v.length > 0);
}

document.getElementById('weekly-add-lesson-btn').addEventListener('click', () => addLessonRow(''));

/* تحميل خطة المعلم الحالية (إن وُجدت) للمادة/المرحلة/الأسبوع المحددين، للتعديل بدل الإدخال من الصفر */
async function loadFormForCurrentSelection() {
  if (currentProfile.role !== 'teacher') return;
  const subjectId = document.getElementById('weekly-subject').value;
  const grade = document.getElementById('weekly-grade').value;
  const titleEl = document.getElementById('weekly-form-title');
  if (!subjectId || !grade) { renderLessonInputs(['']); return; }

  const { data: existing } = await sb.from('weekly_plans')
    .select('lessons, performance_tasks, homework, has_test')
    .eq('subject_id', subjectId).eq('grade_level', grade).eq('week_number', currentWeek).maybeSingle();

  if (existing) {
    renderLessonInputs(existing.lessons || []);
    document.getElementById('weekly-tasks').value = existing.performance_tasks || '';
    document.getElementById('weekly-homework').value = existing.homework || '';
    document.getElementById('weekly-has-test').checked = !!existing.has_test;
    titleEl.textContent = 'تحديث خطة المادة لهذا الأسبوع';
  } else {
    renderLessonInputs(['']);
    document.getElementById('weekly-tasks').value = '';
    document.getElementById('weekly-homework').value = '';
    document.getElementById('weekly-has-test').checked = false;
    titleEl.textContent = 'إضافة خطة المادة لهذا الأسبوع';
  }
}

let currentWeek = 1;
let subjectsCache = [];

export async function loadWeeklyModule() {
  document.getElementById('weekly-form-card').classList.toggle('hidden', !isStaff());
  document.getElementById('weekly-admin-note-card').classList.toggle('hidden', !isAdminOrDeputy());
  document.getElementById('week-label').textContent = 'الأسبوع ' + currentWeek;

  if (currentProfile.role === 'teacher') {
    document.getElementById('weekly-form-card').classList.remove('hidden');
    await loadTeacherAssignments();
    restrictWeeklyFormForTeacher();
  } else if (subjectsCache.length === 0) {
    const { data: subjects } = await sb.from('subjects').select('id, name').order('name');
    subjectsCache = subjects || [];
    const subSelect = document.getElementById('weekly-subject');
    subSelect.innerHTML = '';
    subjectsCache.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; subSelect.appendChild(o); });
    renderLessonInputs(['']);
  }

  if (isAdminOrDeputy()) await loadWeeklyAdminNote();
  await refreshWeeklyList();
}

async function loadWeeklyAdminNote() {
  const grade = document.getElementById('weekly-grade').value;
  const { data } = await sb.from('weekly_admin_notes').select('note').eq('grade_level', grade).eq('week_number', currentWeek).maybeSingle();
  document.getElementById('weekly-admin-note-text').value = data ? data.note : '';
  document.getElementById('weekly-admin-note-success').style.display = 'none';
}

document.getElementById('weekly-admin-note-save').addEventListener('click', async () => {
  const grade = document.getElementById('weekly-grade').value;
  const note = document.getElementById('weekly-admin-note-text').value.trim();
  const successEl = document.getElementById('weekly-admin-note-success');

  if (!note) {
    await sb.from('weekly_admin_notes').delete().eq('grade_level', grade).eq('week_number', currentWeek);
    successEl.textContent = 'تم حذف الملاحظة (الحقل فارغ).';
  } else {
    await sb.from('weekly_admin_notes').upsert(
      { grade_level: grade, week_number: currentWeek, note, created_by: currentUserId },
      { onConflict: 'grade_level,week_number' }
    );
    successEl.textContent = 'تم حفظ الملاحظة بنجاح.';
  }
  successEl.style.display = 'block';
});

document.getElementById('week-prev').addEventListener('click', () => { if (currentWeek > 1) { currentWeek--; loadWeeklyModule(); } });
document.getElementById('week-next').addEventListener('click', () => { if (currentWeek < 40) { currentWeek++; loadWeeklyModule(); } });
document.getElementById('weekly-grade').addEventListener('change', () => { refreshWeeklyList(); if (isAdminOrDeputy()) loadWeeklyAdminNote(); });

document.getElementById('weekly-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('weekly-error');
  const lessons = collectLessons();
  if (lessons.length === 0) { errEl.textContent = 'اكتب درس واحد على الأقل'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const { data: userData } = await sb.auth.getUser();
  const payload = {
    subject_id: document.getElementById('weekly-subject').value,
    grade_level: document.getElementById('weekly-grade').value,
    week_number: currentWeek,
    lessons: lessons,
    performance_tasks: document.getElementById('weekly-tasks').value.trim(),
    homework: document.getElementById('weekly-homework').value.trim(),
    has_test: document.getElementById('weekly-has-test').checked,
    created_by: userData.user.id,
  };

  // تحديث إذا موجودة خطة لنفس المادة/المرحلة/الأسبوع، وإلا إضافة جديدة
  const { data: existing } = await sb.from('weekly_plans').select('id')
    .eq('subject_id', payload.subject_id).eq('grade_level', payload.grade_level).eq('week_number', currentWeek).maybeSingle();

  let error;
  if (existing) {
    ({ error } = await sb.from('weekly_plans').update(payload).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('weekly_plans').insert(payload));
  }

  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('weekly-tasks').value = '';
  document.getElementById('weekly-homework').value = '';
  document.getElementById('weekly-has-test').checked = false;
  await loadFormForCurrentSelection();
  await refreshWeeklyList();
});

async function refreshWeeklyList() {
  const grade = document.getElementById('weekly-grade').value;
  const { data: plans } = await sb.from('weekly_plans')
    .select('id, lessons, performance_tasks, homework, has_test, subjects(name)')
    .eq('grade_level', grade).eq('week_number', currentWeek);

  const list = document.getElementById('weekly-list');
  list.innerHTML = '';

  if (!plans || plans.length === 0) {
    list.innerHTML = `<div class="placeholder" style="padding:30px;"><p>لا توجد خطة مُدخلة لـ${gradeLabels[grade]} في الأسبوع ${currentWeek} بعد.</p></div>`;
    return;
  }

  plans.forEach(p => {
    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '12px';
    const testBadge = p.has_test ? '<span style="font-size:11.5px; background:var(--danger-light); color:var(--danger); padding:3px 10px; border-radius:20px; font-weight:600; margin-right:8px;">يوجد اختبار</span>' : '';
    const lessonsList = (p.lessons && p.lessons.length > 0) ? p.lessons : [];
    const lessonsHtml = lessonsList.length > 1
      ? '<ul style="margin:4px 0 6px; padding-right:18px;">' + lessonsList.map(l => `<li>${l}</li>`).join('') + '</ul>'
      : `<p style="margin:0 0 6px;"><strong>الدرس:</strong> ${lessonsList[0] || '-'}</p>`;
    const deleteBtnHtml = isAdminOrDeputy()
      ? `<button class="weekly-delete-btn" style="width:auto; background:var(--danger-light); color:var(--danger);" data-id="${p.id}">حذف</button>`
      : '';
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <h4 style="color:var(--meadow); margin:0; display:flex; align-items:center;">${p.subjects ? p.subjects.name : ''}${testBadge}</h4>
        ${deleteBtnHtml}
      </div>
      ${lessonsHtml}
      <p style="margin:0 0 6px;"><strong>المهام الأدائية:</strong> ${p.performance_tasks || '-'}</p>
      <p style="margin:0;"><strong>الواجبات:</strong> ${p.homework || '-'}</p>`;
    const delBtn = card.querySelector('.weekly-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`متأكد تبي تحذف خطة "${p.subjects ? p.subjects.name : 'هذه المادة'}" لهذا الأسبوع؟`)) return;
        const { error } = await sb.from('weekly_plans').delete().eq('id', p.id);
        if (error) { alert('تعذر الحذف: ' + error.message); return; }
        await refreshWeeklyList();
      });
    }
    list.appendChild(card);
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
