import { sb, currentUserId, currentProfile, isAdminOrDeputy, gradeLabels, backToTiles } from './core.js';

document.getElementById('back-to-tiles-10').addEventListener('click', backToTiles);

const EXAM_STAGES = [
  { num: 1, label: 'تصدير الأسئلة', actor: 'responsible' },
  { num: 2, label: 'طباعة وتغليف الأسئلة', actor: 'responsible' },
  { num: 3, label: 'تسليم المظاريف (الوكيل)', actor: 'admin_deputy' },
  { num: 4, label: 'استلام الأوراق (الكنترول)', actor: 'kontrol' },
  { num: 5, label: 'فتح المظاريف', actor: 'responsible' },
  { num: 6, label: 'جاري الاختبار', actor: 'auto' },
  { num: 7, label: 'انتهاء الاختبار (استلام من المراقب)', actor: 'kontrol' },
  { num: 8, label: 'تصحيح المقالي', actor: 'responsible' },
  { num: 9, label: 'استلام أوراق التصحيح (الكنترول)', actor: 'kontrol' },
  { num: 10, label: 'التصحيح الآلي', actor: 'kontrol' },
  { num: 11, label: 'المراجعة والتدقيق', actor: 'tadqeeq' },
  { num: 12, label: 'إغلاق المادة', actor: 'kontrol' },
];

let trackingPeriodId = null;
let staffCache = [];
let subjectsCache = [];
let kontrolIds = [];
let tadqeeqIds = [];
let periodsCache = [];

export async function loadExamTrackingTile() {
  const { data } = await sb.from('exam_periods').select('id, name').order('created_at', { ascending: false });
  periodsCache = data || [];
  const select = document.getElementById('tracking-period-select');
  select.innerHTML = '<option value="">اختر فترة الاختبار...</option>';
  periodsCache.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; select.appendChild(o); });
  document.getElementById('tracking-content').classList.add('hidden');
}

document.getElementById('tracking-period-select').addEventListener('change', async (e) => {
  const periodId = e.target.value;
  const content = document.getElementById('tracking-content');
  if (!periodId) { content.classList.add('hidden'); return; }
  content.classList.remove('hidden');
  await initExamTracking(periodId);
});

async function initExamTracking(periodId) {
  trackingPeriodId = periodId;
  document.getElementById('exam-tracking-list').innerHTML = '';

  if (staffCache.length === 0) {
    const { data } = await sb.from('profiles').select('id, full_name, role').in('role', ['teacher', 'admin', 'deputy']).order('full_name');
    staffCache = data || [];
  }
  if (subjectsCache.length === 0) {
    const { data } = await sb.from('subjects').select('id, name').order('name');
    subjectsCache = data || [];
    const subSelect = document.getElementById('exam-track-subject');
    subSelect.innerHTML = '';
    subjectsCache.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; subSelect.appendChild(o); });
    const teacherSelect = document.getElementById('exam-track-teacher');
    teacherSelect.innerHTML = '';
    staffCache.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.full_name; teacherSelect.appendChild(o); });
  }

  await refreshTeams();
  await refreshAssignments();
}

/* ---------- فرق الكنترول والتدقيق ---------- */
async function refreshTeams() {
  const { data } = await sb.from('exam_period_teams').select('team_type, member_id').eq('period_id', trackingPeriodId);
  kontrolIds = (data || []).filter(r => r.team_type === 'kontrol').map(r => r.member_id);
  tadqeeqIds = (data || []).filter(r => r.team_type === 'tadqeeq').map(r => r.member_id);

  const kontrolList = document.getElementById('exam-kontrol-list');
  const tadqeeqList = document.getElementById('exam-tadqeeq-list');
  kontrolList.innerHTML = '';
  tadqeeqList.innerHTML = '';

  staffCache.forEach(p => {
    const rowK = document.createElement('label');
    rowK.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 2px; cursor:pointer;';
    rowK.innerHTML = `<input type="checkbox" class="kontrol-check" value="${p.id}" style="width:auto; margin:0;" ${kontrolIds.includes(p.id) ? 'checked' : ''}/> ${p.full_name}`;
    kontrolList.appendChild(rowK);

    const rowT = document.createElement('label');
    rowT.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 2px; cursor:pointer;';
    rowT.innerHTML = `<input type="checkbox" class="tadqeeq-check" value="${p.id}" style="width:auto; margin:0;" ${tadqeeqIds.includes(p.id) ? 'checked' : ''}/> ${p.full_name}`;
    tadqeeqList.appendChild(rowT);
  });
}

document.getElementById('exam-teams-save').addEventListener('click', async () => {
  const checkedKontrol = Array.from(document.querySelectorAll('.kontrol-check:checked')).map(c => c.value);
  const checkedTadqeeq = Array.from(document.querySelectorAll('.tadqeeq-check:checked')).map(c => c.value);

  await sb.from('exam_period_teams').delete().eq('period_id', trackingPeriodId).eq('team_type', 'kontrol');
  await sb.from('exam_period_teams').delete().eq('period_id', trackingPeriodId).eq('team_type', 'tadqeeq');

  const rows = [
    ...checkedKontrol.map(id => ({ period_id: trackingPeriodId, team_type: 'kontrol', member_id: id })),
    ...checkedTadqeeq.map(id => ({ period_id: trackingPeriodId, team_type: 'tadqeeq', member_id: id })),
  ];
  if (rows.length > 0) await sb.from('exam_period_teams').insert(rows);

  kontrolIds = checkedKontrol;
  tadqeeqIds = checkedTadqeeq;

  const successEl = document.getElementById('exam-teams-success');
  successEl.style.display = 'block';
  setTimeout(() => { successEl.style.display = 'none'; }, 2000);
  await refreshAssignments();
});

/* ---------- إضافة مادة ومسؤول ---------- */
document.getElementById('exam-track-add-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('exam-track-add-error');
  errEl.style.display = 'none';
  const grade = document.getElementById('exam-track-grade').value;
  const subjectId = document.getElementById('exam-track-subject').value;
  const teacherId = document.getElementById('exam-track-teacher').value;

  if (!subjectId || !teacherId) { errEl.textContent = 'اختر المادة والمعلم المسؤول'; errEl.style.display = 'block'; return; }

  const { error } = await sb.from('exam_subject_assignments').insert({
    period_id: trackingPeriodId, subject_id: subjectId, grade_level: grade, responsible_teacher_id: teacherId,
  });
  if (error) {
    errEl.textContent = error.message.includes('duplicate') ? 'هذي المادة/المرحلة مضافة مسبقًا لهذه الفترة' : 'تعذرت الإضافة: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  await refreshAssignments();
});

/* ---------- قائمة المواد وسير المراحل ---------- */
function stagePrereqMet(stageNum, logs) {
  if (stageNum === 1) return true;
  if (stageNum === 7) {
    const s5 = logs.find(l => l.stage_number === 5);
    if (!s5) return false;
    return (Date.now() - new Date(s5.completed_at).getTime()) >= 25 * 60 * 1000;
  }
  return logs.some(l => l.stage_number === stageNum - 1);
}

function canApproveStage(stage, assignment) {
  if (stage.actor === 'responsible') return currentUserId === assignment.responsible_teacher_id;
  if (stage.actor === 'admin_deputy') return isAdminOrDeputy();
  if (stage.actor === 'kontrol') return kontrolIds.includes(currentUserId) || isAdminOrDeputy();
  if (stage.actor === 'tadqeeq') return tadqeeqIds.includes(currentUserId) || isAdminOrDeputy();
  return false;
}

function nameOf(userId) {
  const p = staffCache.find(s => s.id === userId);
  return p ? p.full_name : '-';
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ar-SA', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function refreshAssignments() {
  const { data: assignments } = await sb.from('exam_subject_assignments')
    .select('id, subject_id, grade_level, responsible_teacher_id, subjects(name)')
    .eq('period_id', trackingPeriodId).order('created_at', { ascending: true });

  const container = document.getElementById('exam-tracking-list');
  container.innerHTML = '';
  if (!assignments || assignments.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه مواد مضافة لهذه الفترة بعد</p></div>';
    return;
  }

  const assignmentIds = assignments.map(a => a.id);
  const { data: allLogs } = await sb.from('exam_stage_log').select('assignment_id, stage_number, completed_by, completed_at').in('assignment_id', assignmentIds);
  const logsByAssignment = {};
  (allLogs || []).forEach(l => {
    if (!logsByAssignment[l.assignment_id]) logsByAssignment[l.assignment_id] = [];
    logsByAssignment[l.assignment_id].push(l);
  });

  assignments.forEach(a => {
    const logs = logsByAssignment[a.id] || [];
    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '12px';

    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:11.5px; background:var(--sand); color:var(--slate); padding:3px 10px; border-radius:20px;';
    badge.textContent = `${logs.length}/12 مرحلة`;

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;';
    titleRow.innerHTML = `<h4 style="margin:0;">${a.subjects ? a.subjects.name : ''} — ${gradeLabels[a.grade_level] || ''}</h4>`;
    titleRow.appendChild(badge);

    const teacherP = document.createElement('p');
    teacherP.style.cssText = 'font-size:12.5px; color:var(--slate); margin:0 0 10px;';
    teacherP.textContent = 'المعلم المسؤول: ' + nameOf(a.responsible_teacher_id);

    const toggleBtn = document.createElement('span');
    toggleBtn.className = 'text-action-btn';
    toggleBtn.textContent = 'عرض السير والغياب';

    const detail = document.createElement('div');
    detail.className = 'track-detail hidden';
    detail.style.marginTop = '14px';

    card.appendChild(titleRow);
    card.appendChild(teacherP);
    card.appendChild(toggleBtn);
    card.appendChild(detail);

    toggleBtn.addEventListener('click', async () => {
      const isHidden = detail.classList.contains('hidden');
      if (isHidden) {
        detail.classList.remove('hidden');
        toggleBtn.textContent = 'إخفاء';
        renderStageTracker(detail, a, logs, badge);
        await renderAbsenceSection(detail, a);
      } else {
        detail.classList.add('hidden');
        toggleBtn.textContent = 'عرض السير والغياب';
      }
    });

    container.appendChild(card);
  });
}

function renderStageTracker(container, assignment, logs, badge) {
  let stageWrap = container.querySelector('.stage-tracker-wrap');
  if (!stageWrap) {
    stageWrap = document.createElement('div');
    stageWrap.className = 'stage-tracker-wrap';
    stageWrap.style.cssText = 'border-top:1px solid #ECEAE1; padding-top:12px; margin-bottom:16px;';
    container.appendChild(stageWrap);
  }
  stageWrap.innerHTML = '';

  EXAM_STAGES.forEach(stage => {
    const log = logs.find(l => l.stage_number === stage.num);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #F3F1E9;';

    let rightHtml = '';
    if (log) {
      rightHtml = `<span class="badge badge-meadow">تم — ${nameOf(log.completed_by)} · ${formatDateTime(log.completed_at)}</span>`;
    } else if (stage.actor === 'auto') {
      const s5 = logs.find(l => l.stage_number === 5);
      const active = s5 && (Date.now() - new Date(s5.completed_at).getTime()) >= 25 * 60 * 1000;
      rightHtml = active
        ? '<span class="badge badge-gold">جاري الآن (تلقائي)</span>'
        : '<span class="badge badge-gray">لم يبدأ بعد</span>';
    } else {
      const prereqMet = stagePrereqMet(stage.num, logs);
      const canApprove = canApproveStage(stage, assignment);
      if (!prereqMet) {
        rightHtml = '<span class="badge badge-gray">بانتظار المرحلة السابقة</span>';
      } else if (canApprove) {
        rightHtml = `<button class="text-action-btn stage-approve-btn" data-stage="${stage.num}">اعتماد</button>`;
      } else {
        rightHtml = '<span class="badge badge-gray">بانتظار الاعتماد</span>';
      }
    }

    row.innerHTML = `<span style="font-size:13.5px; color:var(--ink);">${stage.num}. ${stage.label}</span>${rightHtml}`;
    stageWrap.appendChild(row);
  });

  stageWrap.querySelectorAll('.stage-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stageNum = parseInt(btn.dataset.stage);
      const { error } = await sb.from('exam_stage_log').insert({
        assignment_id: assignment.id, stage_number: stageNum, completed_by: currentUserId,
      });
      if (error) { alert('تعذر اعتماد المرحلة: ' + error.message); return; }

      const { data: freshLogs } = await sb.from('exam_stage_log')
        .select('assignment_id, stage_number, completed_by, completed_at').eq('assignment_id', assignment.id);
      const newLogs = freshLogs || [];
      if (badge) badge.textContent = `${newLogs.length}/12 مرحلة`;
      renderStageTracker(container, assignment, newLogs, badge);
    });
  });
}

async function renderAbsenceSection(container, assignment) {
  const absenceWrap = document.createElement('div');
  absenceWrap.style.cssText = 'border-top:1px solid #ECEAE1; padding-top:12px;';
  absenceWrap.innerHTML = '<h4 style="margin:0 0 10px;">تسجيل غياب الطلاب</h4><div class="absence-list" style="max-height:260px; overflow-y:auto;"></div>';
  container.appendChild(absenceWrap);

  const [{ data: assignedStudents }, { data: absences }] = await Promise.all([
    sb.from('exam_committee_assignments').select('student_id, committee_number, seat_number, is_special, students(full_name, national_id, grade_level)')
      .eq('period_id', trackingPeriodId),
    sb.from('exam_student_absences').select('student_id').eq('assignment_id', assignment.id),
  ]);

  const absentIds = new Set((absences || []).map(a => a.student_id));
  const filtered = (assignedStudents || []).filter(r => r.students && r.students.grade_level === assignment.grade_level);
  filtered.sort((x, y) => (x.seat_number || 0) - (y.seat_number || 0));

  const listEl = absenceWrap.querySelector('.absence-list');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="placeholder" style="padding:14px;"><p>ما فيه طلاب مسكّنين بهذي المرحلة لهذه الفترة</p></div>';
  } else {
    filtered.forEach(r => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 4px; border-bottom:1px solid #F3F1E9; cursor:pointer; font-size:13px;';
      row.innerHTML = `
        <input type="checkbox" class="absence-check" value="${r.student_id}" style="width:auto; margin:0;" ${absentIds.has(r.student_id) ? 'checked' : ''} />
        <span>${r.students.full_name}</span>
        <span style="color:var(--slate); font-size:11.5px; margin-right:auto;">${r.is_special ? 'خاصة' : 'لجنة' + r.committee_number} · جلوس ${r.seat_number}</span>`;
      listEl.appendChild(row);
    });
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.style.cssText = 'width:auto; padding:10px 18px; margin-top:10px;';
  saveBtn.textContent = 'حفظ الغياب';
  saveBtn.addEventListener('click', async () => {
    const checkedIds = Array.from(absenceWrap.querySelectorAll('.absence-check:checked')).map(c => c.value);
    await sb.from('exam_student_absences').delete().eq('assignment_id', assignment.id);
    if (checkedIds.length > 0) {
      const rows = checkedIds.map(sid => ({ assignment_id: assignment.id, student_id: sid, recorded_by: currentUserId }));
      await sb.from('exam_student_absences').insert(rows);
    }
    alert('تم حفظ الغياب');
  });
  absenceWrap.appendChild(saveBtn);
}
