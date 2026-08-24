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
  }
  gradeSelect.addEventListener('change', () => { refreshSubjectsForGrade(); refreshWeeklyList(); });
  refreshSubjectsForGrade();
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
  const lesson = document.getElementById('weekly-lesson').value.trim();
  if (!lesson) { errEl.textContent = 'اكتب الدرس على الأقل'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const { data: userData } = await sb.auth.getUser();
  const payload = {
    subject_id: document.getElementById('weekly-subject').value,
    grade_level: document.getElementById('weekly-grade').value,
    week_number: currentWeek,
    lesson: lesson,
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

  document.getElementById('weekly-lesson').value = '';
  document.getElementById('weekly-tasks').value = '';
  document.getElementById('weekly-homework').value = '';
  document.getElementById('weekly-has-test').checked = false;
  await refreshWeeklyList();
});

async function refreshWeeklyList() {
  const grade = document.getElementById('weekly-grade').value;
  const { data: plans } = await sb.from('weekly_plans')
    .select('id, lesson, performance_tasks, homework, has_test, subjects(name)')
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
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <h4 style="color:var(--meadow); margin:0; display:flex; align-items:center;">${p.subjects ? p.subjects.name : ''}${testBadge}</h4>
        <button class="weekly-delete-btn" style="width:auto; background:var(--danger-light); color:var(--danger);" data-id="${p.id}">حذف</button>
      </div>
      <p style="margin:0 0 6px;"><strong>الدرس:</strong> ${p.lesson || '-'}</p>
      <p style="margin:0 0 6px;"><strong>المهام الأدائية:</strong> ${p.performance_tasks || '-'}</p>
      <p style="margin:0;"><strong>الواجبات:</strong> ${p.homework || '-'}</p>`;
    card.querySelector('.weekly-delete-btn').addEventListener('click', async () => {
      if (!confirm(`متأكد تبي تحذف خطة "${p.subjects ? p.subjects.name : 'هذه المادة'}" لهذا الأسبوع؟`)) return;
      const { error } = await sb.from('weekly_plans').delete().eq('id', p.id);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      await refreshWeeklyList();
    });
    list.appendChild(card);
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
