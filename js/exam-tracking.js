import { sb, currentUserId, currentProfile, isAdminOrDeputy, gradeLabels, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool, setSubRoute } from './core.js';

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
let assignmentsCache = [];
let logsByAssignment = {};
let absenceCounts = {};
let filterMode = 'active';
let gradeFilter = '';
let drawerAssignment = null;

const ACTOR_LABEL = { responsible: 'المعلم المسؤول', admin_deputy: 'الوكيل', kontrol: 'الكنترول', tadqeeq: 'التدقيق', auto: 'تلقائي' };
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export async function loadExamTrackingTile(sub = null) {
  closeDrawer();
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_periods').select('id, name, created_at');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('created_at', { ascending: false });
  });
  periodsCache = data || [];
  const admin = isAdminOrDeputy();
  document.getElementById('tr-setup-toggle').classList.toggle('hidden', !admin);
  document.getElementById('tr-no-periods').classList.toggle('hidden', periodsCache.length > 0);
  document.getElementById('tracking-content').classList.add('hidden');
  if (!periodsCache.length) { document.getElementById('tracking-period-chips').innerHTML = ''; return; }
  const pick = periodsCache.find(p => String(p.id) === String(sub)) || periodsCache[0];
  renderPeriodChips(pick.id);
  await selectTrackingPeriod(pick.id, true);
}

function renderPeriodChips(activeId) {
  const box = document.getElementById('tracking-period-chips');
  box.innerHTML = periodsCache.map(p => `<button type="button" role="tab" data-id="${p.id}" class="${String(p.id) === String(activeId) ? 'active' : ''}">${esc(p.name)}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    box.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    selectTrackingPeriod(b.dataset.id);
  }));
}

async function selectTrackingPeriod(periodId, fromLoad = false) {
  document.getElementById('tracking-content').classList.remove('hidden');
  setSubRoute(periodId, fromLoad);
  await initExamTracking(periodId);
}

document.getElementById('tr-setup-toggle').addEventListener('click', () => {
  const box = document.getElementById('tr-setup');
  const open = box.classList.toggle('hidden') === false;
  document.getElementById('tr-setup-toggle').textContent = open ? 'إخفاء الإعداد' : 'إعداد الفترة';
});
document.querySelectorAll('#tr-filter button').forEach(b => b.addEventListener('click', () => { filterMode = b.dataset.f; renderBoard(); }));
document.querySelectorAll('#tr-grade-filter button').forEach(b => b.addEventListener('click', () => { gradeFilter = b.dataset.g; renderBoard(); }));

async function initExamTracking(periodId) {
  trackingPeriodId = periodId;
  document.getElementById('exam-tracking-list').innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';

  if (staffCache.length === 0) {
    const { data } = await readScopedBySchool(scoped => {
      let q = sb.from('profiles').select('id, full_name, role').in('role', ['teacher', 'admin', 'deputy']);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('full_name');
    });
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
  await refreshAssignments(true);
}

/* ---------- فرق الكنترول والتدقيق ---------- */
async function refreshTeams() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_period_teams').select('team_type, member_id').eq('period_id', trackingPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
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
  if (rows.length > 0) await writeWithSchool(extra => sb.from('exam_period_teams').insert(rows.map(r => ({ ...r, ...extra }))));

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

  const { error } = await writeWithSchool(extra => sb.from('exam_subject_assignments').insert({
    period_id: trackingPeriodId, subject_id: subjectId, grade_level: grade, responsible_teacher_id: teacherId,
    ...extra,
  }));
  if (error) {
    errEl.textContent = error.message.includes('duplicate') ? 'هذي المادة/المرحلة مضافة مسبقًا لهذه الفترة' : 'تعذرت الإضافة: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  await refreshAssignments();
});

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
  return d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function respName(a) { const n = nameOf(a.responsible_teacher_id); return n && n !== '-' ? n : 'المعلم المسؤول'; }

/* حالة المادة: كم مرحلة انتهت، والمرحلة الحالية، وهل الاعتماد عليّ */
function assignmentState(a) {
  const logs = logsByAssignment[a.id] || [];
  const s5 = logs.find(l => l.stage_number === 5);
  const autoActive = !!(s5 && (Date.now() - new Date(s5.completed_at).getTime()) >= 25 * 60 * 1000);
  const doneSet = new Set(logs.map(l => l.stage_number));
  if (autoActive) doneSet.add(6);
  const current = EXAM_STAGES.find(st => !doneSet.has(st.num)) || null;
  const closed = doneSet.has(12);
  const mine = !!(current && current.actor !== 'auto' && stagePrereqMet(current.num, logs) && canApproveStage(current, a));
  return { logs, doneSet, current, closed, mine, done: doneSet.size };
}

async function refreshAssignments(resetFilter = false) {
  const { data: assignments } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_subject_assignments')
      .select('id, subject_id, grade_level, responsible_teacher_id, subjects(name)')
      .eq('period_id', trackingPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('created_at', { ascending: true });
  });
  assignmentsCache = assignments || [];
  logsByAssignment = {};
  absenceCounts = {};
  if (assignmentsCache.length) {
    const ids = assignmentsCache.map(a => a.id);
    const [{ data: allLogs }, { data: abs }] = await Promise.all([
      readScopedBySchool(scoped => {
        let q = sb.from('exam_stage_log').select('assignment_id, stage_number, completed_by, completed_at').in('assignment_id', ids);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      }),
      readScopedBySchool(scoped => {
        let q = sb.from('exam_student_absences').select('assignment_id').in('assignment_id', ids);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      }),
    ]);
    (allLogs || []).forEach(l => { (logsByAssignment[l.assignment_id] = logsByAssignment[l.assignment_id] || []).push(l); });
    (abs || []).forEach(r => { absenceCounts[r.assignment_id] = (absenceCounts[r.assignment_id] || 0) + 1; });
  }
  if (resetFilter) {
    const anyMine = assignmentsCache.some(a => assignmentState(a).mine);
    filterMode = anyMine ? 'mine' : 'active';
  }
  renderBoard();
}

function renderBoard() {
  document.querySelectorAll('#tr-filter button').forEach(b => b.classList.toggle('active', b.dataset.f === filterMode));
  document.querySelectorAll('#tr-grade-filter button').forEach(b => b.classList.toggle('active', b.dataset.g === gradeFilter));
  const all = assignmentsCache.filter(a => !gradeFilter || a.grade_level === gradeFilter).map(a => ({ a, st: assignmentState(a) }));
  const counts = { all: all.length, mine: all.filter(x => x.st.mine).length, closed: all.filter(x => x.st.closed).length };
  counts.active = counts.all - counts.closed;
  document.querySelectorAll('#tr-filter .tr-cnt').forEach(el => { const n = counts[el.dataset.c]; el.textContent = n ? n : ''; });

  // المؤشرات
  const totalAll = assignmentsCache.length;
  const states = assignmentsCache.map(a => assignmentState(a));
  const closedAll = states.filter(s => s.closed).length;
  const mineAll = states.filter(s => s.mine).length;
  const absAll = Object.values(absenceCounts).reduce((x, y) => x + y, 0);
  const pct = totalAll ? Math.round(states.reduce((x, s) => x + s.done, 0) / (totalAll * 12) * 100) : 0;
  const k = (label, value, note = '', color = '', bar = null) => `<div class="kpi"><span class="k-label">${label}</span><span class="k-value"${color ? ` style="color:${color};"` : ''}>${value}</span>${bar != null ? `<div class="k-bar"><div style="width:${bar}%;"></div></div>` : ''}${note ? `<span class="k-note">${note}</span>` : ''}</div>`;
  document.getElementById('tr-kpis').innerHTML = totalAll ? [
    k('سير الفترة', pct + '%', `${totalAll} مادة`, '', pct),
    k('تحتاج إجراءك', mineAll, mineAll ? 'اضغط «تحتاج إجرائي»' : 'ما عليك شي حاليًا', mineAll ? '#C0453D' : ''),
    k('مواد مغلقة', `${closedAll} / ${totalAll}`, 'وصلت المرحلة 12'),
    k('غياب مسجّل', absAll, 'طالب في كل المواد'),
  ].join('') : '';

  const list = document.getElementById('exam-tracking-list');
  if (!assignmentsCache.length) {
    list.innerHTML = `<div class="ex-empty"><b>ما فيه مواد مضافة لهذي الفترة</b><span>${isAdminOrDeputy() ? 'اضغط «إعداد الفترة» وأضف كل مادة ومعلمها المسؤول.' : 'المدير أو الوكيل يضيف المواد من «إعداد الفترة».'}</span></div>`;
    return;
  }
  let rows = all;
  if (filterMode === 'mine') rows = rows.filter(x => x.st.mine);
  else if (filterMode === 'active') rows = rows.filter(x => !x.st.closed);
  else if (filterMode === 'closed') rows = rows.filter(x => x.st.closed);
  rows.sort((x, y) => (y.st.mine - x.st.mine) || (x.st.done - y.st.done) || String(x.a.subjects ? x.a.subjects.name : '').localeCompare(String(y.a.subjects ? y.a.subjects.name : ''), 'ar'));
  if (!rows.length) {
    const msg = { mine: 'ما فيه مراحل بانتظار اعتمادك الحين', active: 'كل المواد مغلقة', closed: 'ما فيه مواد مغلقة بعد', all: 'ما فيه مواد' }[filterMode];
    list.innerHTML = `<div class="ex-empty"><b>${msg}</b></div>`;
    return;
  }
  list.innerHTML = rows.map(({ a, st }) => {
    const cur = st.current;
    const curTxt = st.closed ? 'مغلقة' : cur ? `${cur.num}. ${cur.label}` : '';
    const who = st.closed ? '' : cur ? (cur.actor === 'responsible' ? respName(a) : ACTOR_LABEL[cur.actor]) : '';
    const abs = absenceCounts[a.id] || 0;
    return `<button type="button" class="tr-card ${st.mine ? 'is-mine' : ''} ${st.closed ? 'is-closed' : ''}" data-id="${a.id}">
      <span class="trc-top">
        <span class="trc-title"><b>${esc(a.subjects ? a.subjects.name : '')}</b><span>${esc(gradeLabels[a.grade_level] || '')} · ${esc(respName(a))}</span></span>
        ${st.mine ? '<span class="trc-mine">دورك</span>' : st.closed ? '<span class="trc-closed">مغلقة</span>' : `<span class="trc-num">${st.done}/12</span>`}
      </span>
      <span class="trc-bar">${EXAM_STAGES.map(s => `<i class="${st.doneSet.has(s.num) ? 'on' : cur && cur.num === s.num ? 'cur' : ''}" title="${s.num}. ${esc(s.label)}"></i>`).join('')}</span>
      <span class="trc-now">${st.closed ? 'تمت كل المراحل' : `<b>${esc(curTxt)}</b>${who ? ` · بانتظار ${esc(who)}` : ''}`}${abs ? ` <span class="trc-abs">غياب ${abs}</span>` : ''}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.tr-card').forEach(c => c.addEventListener('click', () => openDrawer(c.dataset.id)));
}

/* ---------- لوحة التفاصيل ---------- */
function openDrawer(id, tab = 'stages') {
  const a = assignmentsCache.find(x => String(x.id) === String(id));
  if (!a) return;
  drawerAssignment = a;
  document.getElementById('trd-title').textContent = `${a.subjects ? a.subjects.name : ''} — ${gradeLabels[a.grade_level] || ''}`;
  document.getElementById('trd-sub').textContent = 'المعلم المسؤول: ' + respName(a);
  const abs = absenceCounts[a.id] || 0;
  document.getElementById('trd-abs-cnt').textContent = abs ? abs : '';
  const d = document.getElementById('tr-drawer');
  d.classList.remove('hidden'); d.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setDrawerTab(tab);
  setTimeout(() => document.getElementById('trd-close').focus(), 20);
}
function closeDrawer() {
  const d = document.getElementById('tr-drawer');
  if (!d || d.classList.contains('hidden')) return;
  d.classList.add('hidden'); d.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  drawerAssignment = null;
}
function setDrawerTab(tab) {
  document.querySelectorAll('#trd-tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === tab));
  document.getElementById('trd-stages').classList.toggle('hidden', tab !== 'stages');
  document.getElementById('trd-absence').classList.toggle('hidden', tab !== 'absence');
  if (tab === 'stages') renderStageTracker(document.getElementById('trd-stages'), drawerAssignment);
  else renderAbsenceSection(document.getElementById('trd-absence'), drawerAssignment);
}
document.querySelectorAll('#trd-tabs button').forEach(b => b.addEventListener('click', () => drawerAssignment && setDrawerTab(b.dataset.t)));
document.getElementById('trd-close').addEventListener('click', closeDrawer);
document.getElementById('tr-drawer').addEventListener('click', (e) => { if (e.target.id === 'tr-drawer') closeDrawer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

function renderStageTracker(container, assignment) {
  const st = assignmentState(assignment);
  const logs = st.logs;
  container.innerHTML = `<ol class="trd-steps">${EXAM_STAGES.map(stage => {
    const log = logs.find(l => l.stage_number === stage.num);
    const done = st.doneSet.has(stage.num);
    const isCur = st.current && st.current.num === stage.num;
    let right = '';
    if (log) right = `<span class="trs-meta">${esc(nameOf(log.completed_by))} · ${formatDateTime(log.completed_at)}</span>`;
    else if (stage.actor === 'auto') right = done ? '<span class="trs-meta">بدأ تلقائيًا بعد ٢٥ دقيقة من فتح المظاريف</span>' : '<span class="trs-meta">يبدأ تلقائيًا بعد ٢٥ دقيقة من فتح المظاريف</span>';
    else if (!stagePrereqMet(stage.num, logs)) right = isCur && stage.num === 7 ? '<span class="trs-meta">متاحة بعد ٢٥ دقيقة من فتح المظاريف</span>' : '';
    else if (canApproveStage(stage, assignment)) right = `<button type="button" class="btn-primary stage-approve-btn" data-stage="${stage.num}">اعتماد</button>`;
    else right = '<span class="trs-meta">بانتظار الاعتماد</span>';
    const actor = stage.actor === 'responsible' ? respName(assignment) : ACTOR_LABEL[stage.actor];
    return `<li class="trs ${done ? 'done' : ''} ${isCur ? 'cur' : ''}">
      <span class="trs-dot">${done ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' : stage.num}</span>
      <span class="trs-main"><b>${esc(stage.label)}</b><span>${esc(actor)}</span></span>
      <span class="trs-right">${right}</span>
    </li>`;
  }).join('')}</ol>`;

  container.querySelectorAll('.stage-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const stageNum = parseInt(btn.dataset.stage);
      const { error } = await writeWithSchool(extra => sb.from('exam_stage_log').insert({
        assignment_id: assignment.id, stage_number: stageNum, completed_by: currentUserId,
        ...extra,
      }));
      if (error) { btn.disabled = false; alert('تعذر اعتماد المرحلة: ' + error.message); return; }
      const { data: freshLogs } = await readScopedBySchool(scoped => {
        let q = sb.from('exam_stage_log')
          .select('assignment_id, stage_number, completed_by, completed_at').eq('assignment_id', assignment.id);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      });
      logsByAssignment[assignment.id] = freshLogs || [];
      renderStageTracker(container, assignment);
      renderBoard();
    });
  });
}

async function renderAbsenceSection(container, assignment) {
  container.innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';
  const [{ data: assignedStudents }, { data: absences }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_assignments').select('student_id, committee_number, seat_number, is_special, students(full_name, national_id, grade_level)')
        .eq('period_id', trackingPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_student_absences').select('student_id').eq('assignment_id', assignment.id);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);
  if (drawerAssignment !== assignment) return;
  const absentIds = new Set((absences || []).map(a => a.student_id));
  const filtered = (assignedStudents || []).filter(r => r.students && r.students.grade_level === assignment.grade_level);
  filtered.sort((x, y) => (x.is_special - y.is_special) || ((x.committee_number || 0) - (y.committee_number || 0)) || ((x.seat_number || 0) - (y.seat_number || 0)));
  if (!filtered.length) {
    container.innerHTML = '<div class="ex-empty"><b>ما فيه طلاب موزعين من هذي المرحلة</b><span>ولّد التوزيع من قسم «الاختبارات» أول.</span></div>';
    return;
  }
  const groups = new Map();
  filtered.forEach(r => { const key = r.is_special ? 'اللجنة الخاصة' : 'لجنة ' + r.committee_number; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
  container.innerHTML = `
    <div class="tra-bar">
      <input type="search" class="tra-search" placeholder="ابحث باسم الطالب أو رقم الجلوس" />
      <span class="tra-count"></span>
    </div>
    <div class="tra-list">${[...groups.entries()].map(([g, rows]) => `
      <div class="tra-group"><div class="tra-gl">${esc(g)} <span>${rows.length}</span></div>
      ${rows.map(r => `<label class="tra-row" data-q="${esc((r.students.full_name || '') + ' ' + (r.seat_number || ''))}">
        <input type="checkbox" class="absence-check" value="${r.student_id}" ${absentIds.has(r.student_id) ? 'checked' : ''} />
        <span class="tra-name">${esc(r.students.full_name)}</span>
        <span class="tra-seat">${r.seat_number ?? ''}</span>
      </label>`).join('')}</div>`).join('')}
    </div>
    <div class="tra-actions"><button type="button" class="btn-primary tra-save" style="width:auto; padding:10px 20px;">حفظ الغياب</button><span class="tra-msg"></span></div>`;
  const countEl = container.querySelector('.tra-count');
  const updateCount = () => {
    const n = container.querySelectorAll('.absence-check:checked').length;
    countEl.textContent = n ? `${n} غائب من ${filtered.length}` : `كلهم حاضرين (${filtered.length})`;
    countEl.style.color = n ? 'var(--danger)' : '#1F6A3C';
    container.querySelectorAll('.tra-row').forEach(r => r.classList.toggle('absent', r.querySelector('input').checked));
  };
  updateCount();
  container.querySelectorAll('.absence-check').forEach(c => c.addEventListener('change', updateCount));
  container.querySelector('.tra-search').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    container.querySelectorAll('.tra-row').forEach(r => { r.style.display = !q || r.dataset.q.includes(q) ? '' : 'none'; });
  });
  container.querySelector('.tra-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const checkedIds = Array.from(container.querySelectorAll('.absence-check:checked')).map(c => c.value);
    await sb.from('exam_student_absences').delete().eq('assignment_id', assignment.id);
    if (checkedIds.length > 0) {
      const rows = checkedIds.map(sid => ({ assignment_id: assignment.id, student_id: sid, recorded_by: currentUserId }));
      await writeWithSchool(extra => sb.from('exam_student_absences').insert(rows.map(r => ({ ...r, ...extra }))));
    }
    btn.disabled = false;
    absenceCounts[assignment.id] = checkedIds.length;
    document.getElementById('trd-abs-cnt').textContent = checkedIds.length || '';
    const msg = container.querySelector('.tra-msg'); msg.textContent = 'تم حفظ الغياب'; setTimeout(() => { msg.textContent = ''; }, 2000);
    renderBoard();
  });
}
