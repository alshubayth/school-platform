import { sb, currentUserId, gradeLabels, backToTiles } from './core.js';
import { VOUCHER_LOGO_DATA_URI } from './budget.js';

document.getElementById('back-to-tiles-12').addEventListener('click', backToTiles);

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function onEl(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) { console.warn('student-followups: عنصر مفقود بالصفحة', id); return; }
  el.addEventListener(event, handler);
}

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const ORG_NAME = 'مدرسة المروج';

const TYPE_LABELS = { note: 'ملاحظة', participation: 'مشاركة', exam: 'اختبار', deduction: 'خصم' };
const TYPE_BADGE = { note: 'badge-gray', participation: 'badge-meadow', exam: 'badge-gold', deduction: 'badge-danger' };

let sfGrade = 'first_intermediate';
let sfSection = null;
let sfDate = todayIso();
let studentsCache = [];
let sfSearchTerm = '';

let sfoGrade = 'first_intermediate';
let sfoSection = null;
let sfoStudentsCache = [];
let sfoFollowupsCache = [];
let sfoSearchTerm = '';
let sfDetailStudentId = null;

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
function avg(nums) { return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null; }

/* ---------- تبويبات القسم: نظرة عامة / تسجيل ---------- */
const SF_TABS = ['overview', 'record'];
function showSfTab(tab) {
  if (!SF_TABS.includes(tab)) tab = 'overview';
  SF_TABS.forEach(t => {
    document.getElementById(`sf-tab-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`sf-panel-${t}`)?.classList.toggle('hidden', t !== tab);
  });
}
SF_TABS.forEach(t => onEl(`sf-tab-${t}`, 'click', () => showSfTab(t)));

export async function loadStudentFollowupsModule() {
  showSfTab('overview');
  showSfDetail(false);
  renderGradeTabs();
  renderOverviewGradeTabs();
  document.getElementById('sf-date').value = sfDate;
  await Promise.all([refreshSectionOptions(), refreshOverviewSectionOptions()]);
}

onEl('sf-date', 'change', (e) => { sfDate = e.target.value || todayIso(); });

/* ================= تبويب: تسجيل ================= */
function renderGradeTabs() {
  const wrap = document.getElementById('sf-grade-tabs');
  wrap.innerHTML = '';
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (g === sfGrade ? ' active' : '');
    btn.textContent = gradeLabels[g];
    btn.addEventListener('click', () => {
      sfGrade = g;
      sfSection = null;
      renderGradeTabs();
      refreshSectionOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshSectionOptions() {
  const sectionSelect = document.getElementById('sf-section-select');
  sectionSelect.innerHTML = '<option value="">جارٍ التحميل...</option>';
  document.getElementById('sf-students-list').innerHTML = '';

  const { data } = await sb.from('students').select('class_section').eq('grade_level', sfGrade);
  const sections = [...new Set((data || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);

  if (sections.length === 0) {
    sectionSelect.innerHTML = '<option value="">ما فيه طلاب مسجلين لهذه المرحلة بعد</option>';
    return;
  }
  sectionSelect.innerHTML = '<option value="">اختر الفصل</option>' +
    sections.map(n => `<option value="${n}">الفصل ${n}</option>`).join('');
  sectionSelect.onchange = () => {
    sfSection = sectionSelect.value ? parseInt(sectionSelect.value) : null;
    renderStudentsList();
  };
}

onEl('sf-search', 'input', (e) => {
  sfSearchTerm = e.target.value.trim();
  renderFilteredStudentRows();
});

async function renderStudentsList() {
  const container = document.getElementById('sf-students-list');
  if (!sfSection) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  const { data } = await sb.from('students').select('id, full_name, national_id')
    .eq('grade_level', sfGrade).eq('class_section', sfSection).order('full_name');
  studentsCache = data || [];
  renderFilteredStudentRows();
}

function renderFilteredStudentRows() {
  const container = document.getElementById('sf-students-list');
  if (!sfSection) { container.innerHTML = ''; return; }
  if (studentsCache.length === 0) {
    container.innerHTML = '<div class="placeholder"><p>ما فيه طلاب مسجلين بهذا الفصل</p></div>';
    return;
  }
  const term = sfSearchTerm.trim();
  const filtered = term ? studentsCache.filter(s => (s.full_name || '').includes(term)) : studentsCache;
  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = '<div class="placeholder"><p>ما فيه طالب بهذا الاسم بالفصل</p></div>';
    return;
  }
  filtered.forEach(st => container.appendChild(buildStudentRow(st)));
}

function buildStudentRow(student) {
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.marginBottom = '10px';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;';
  head.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <div class="avatar-circle" style="width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex-shrink:0; background:var(--meadow-light); color:var(--meadow);">${(student.full_name || '؟').trim().charAt(0)}</div>
      <span style="font-weight:700; font-size:14px;">${esc(student.full_name)}</span>
    </div>
    <span class="text-action-btn sf-toggle-log" style="width:auto; background:transparent; color:var(--teal); font-size:12.5px; cursor:pointer;">عرض السجل</span>`;
  card.appendChild(head);

  const entryRow = document.createElement('div');
  entryRow.style.cssText = 'display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:8px; align-items:end;';
  entryRow.innerHTML = `
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">ملاحظة</label>
      <div style="display:flex; gap:6px;">
        <input type="text" class="sf-note-input" placeholder="اكتب ملاحظة..." style="margin:0;" />
        <button class="sf-add-btn" data-type="note" style="width:auto; padding:9px 12px; background:var(--sand); color:var(--ink);">+</button>
      </div>
    </div>
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">مشاركة</label>
      <div style="display:flex; gap:6px;">
        <input type="number" class="sf-score-input" data-type="participation" placeholder="0" style="margin:0;" />
        <button class="sf-add-btn" data-type="participation" style="width:auto; padding:9px 12px; background:var(--meadow-light); color:var(--meadow);">+</button>
      </div>
    </div>
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">اختبار</label>
      <div style="display:flex; gap:6px;">
        <input type="number" class="sf-score-input" data-type="exam" placeholder="0" style="margin:0;" />
        <button class="sf-add-btn" data-type="exam" style="width:auto; padding:9px 12px; background:var(--gold-light); color:var(--gold);">+</button>
      </div>
    </div>
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">خصم</label>
      <div style="display:flex; gap:6px;">
        <input type="number" class="sf-score-input" data-type="deduction" placeholder="0" style="margin:0;" />
        <button class="sf-add-btn" data-type="deduction" style="width:auto; padding:9px 12px; background:var(--danger-light); color:var(--danger);">+</button>
      </div>
    </div>`;
  card.appendChild(entryRow);

  const errEl = document.createElement('div');
  errEl.className = 'error-msg';
  errEl.style.marginTop = '10px';
  card.appendChild(errEl);

  const logWrap = document.createElement('div');
  logWrap.className = 'sf-log-wrap hidden';
  logWrap.style.cssText = 'border-top:1px solid #ECEAE1; margin-top:12px; padding-top:12px;';
  card.appendChild(logWrap);

  card.querySelectorAll('.sf-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      const type = btn.dataset.type;
      let noteText = null, score = null;
      if (type === 'note') {
        const input = card.querySelector('.sf-note-input');
        noteText = input.value.trim();
        if (!noteText) { errEl.textContent = 'اكتب نص الملاحظة أولًا'; errEl.style.display = 'block'; return; }
      } else {
        const input = card.querySelector(`.sf-score-input[data-type="${type}"]`);
        if (input.value === '') { errEl.textContent = 'أدخل قيمة أولًا'; errEl.style.display = 'block'; return; }
        score = parseFloat(input.value);
      }

      const { error } = await sb.from('student_followups').insert({
        student_id: student.id, grade_level: sfGrade, class_section: sfSection,
        record_date: sfDate, type, note_text: noteText, score,
        created_by: currentUserId,
      });
      if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

      if (type === 'note') { card.querySelector('.sf-note-input').value = ''; }
      else { card.querySelector(`.sf-score-input[data-type="${type}"]`).value = ''; }

      if (!logWrap.classList.contains('hidden')) await renderLog(logWrap, student.id);
    });
  });

  const toggleBtn = head.querySelector('.sf-toggle-log');
  toggleBtn.addEventListener('click', async () => {
    const isHidden = logWrap.classList.contains('hidden');
    if (isHidden) {
      logWrap.classList.remove('hidden');
      toggleBtn.textContent = 'إخفاء السجل';
      await renderLog(logWrap, student.id);
    } else {
      logWrap.classList.add('hidden');
      toggleBtn.textContent = 'عرض السجل';
    }
  });

  return card;
}

async function renderLog(logWrap, studentId) {
  logWrap.innerHTML = '<p style="font-size:12.5px; color:var(--slate);">جارٍ التحميل...</p>';
  const { data } = await sb.from('student_followups')
    .select('id, record_date, type, note_text, score')
    .eq('student_id', studentId).order('record_date', { ascending: false }).order('created_at', { ascending: false });

  const rows = data || [];
  if (rows.length === 0) {
    logWrap.innerHTML = '<p style="font-size:12.5px; color:var(--slate); margin:0;">ما فيه سجلات لهذا الطالب بعد</p>';
    return;
  }

  logWrap.innerHTML = '';
  rows.forEach(r => logWrap.appendChild(buildLogLine(r, () => renderLog(logWrap, studentId))));
}

function buildLogLine(r, onDeleted) {
  const line = document.createElement('div');
  line.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #F3F1E9; font-size:12.5px;';
  const valueText = r.type === 'note' ? (r.note_text || '') : String(r.score ?? '');
  line.innerHTML = `
    <span style="display:flex; align-items:center; gap:8px; min-width:0;">
      <span class="badge ${TYPE_BADGE[r.type] || 'badge-gray'}">${TYPE_LABELS[r.type] || r.type}</span>
      <span style="color:var(--slate); flex-shrink:0;">${formatDate(r.record_date)}</span>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(valueText)}</span>
    </span>
    <button class="sf-delete-btn" data-id="${r.id}" style="width:auto; background:transparent; color:var(--danger); padding:2px 6px; font-size:14px; flex-shrink:0;">×</button>`;
  line.querySelector('.sf-delete-btn').addEventListener('click', async () => {
    if (!confirm('حذف هذا السجل؟')) return;
    await sb.from('student_followups').delete().eq('id', r.id);
    await onDeleted();
  });
  return line;
}

/* ================= تبويب: نظرة عامة ================= */
function renderOverviewGradeTabs() {
  const wrap = document.getElementById('sfo-grade-tabs');
  wrap.innerHTML = '';
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (g === sfoGrade ? ' active' : '');
    btn.textContent = gradeLabels[g];
    btn.addEventListener('click', () => {
      sfoGrade = g;
      sfoSection = null;
      renderOverviewGradeTabs();
      refreshOverviewSectionOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshOverviewSectionOptions() {
  const sectionSelect = document.getElementById('sfo-section-select');
  sectionSelect.innerHTML = '<option value="">جارٍ التحميل...</option>';
  document.getElementById('sfo-class-stats').innerHTML = '';
  document.getElementById('sfo-student-list').innerHTML = '';

  const { data } = await sb.from('students').select('class_section').eq('grade_level', sfoGrade);
  const sections = [...new Set((data || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);

  if (sections.length === 0) {
    sectionSelect.innerHTML = '<option value="">ما فيه طلاب مسجلين لهذه المرحلة بعد</option>';
    return;
  }
  sectionSelect.innerHTML = '<option value="">اختر الفصل</option>' +
    sections.map(n => `<option value="${n}">الفصل ${n}</option>`).join('');
  sectionSelect.onchange = () => {
    sfoSection = sectionSelect.value ? parseInt(sectionSelect.value) : null;
    loadOverviewClassData();
  };
}

onEl('sfo-search', 'input', (e) => {
  sfoSearchTerm = e.target.value.trim();
  renderOverviewStudentList();
});

async function loadOverviewClassData() {
  const statsEl = document.getElementById('sfo-class-stats');
  const listEl = document.getElementById('sfo-student-list');
  if (!sfoSection) { statsEl.innerHTML = ''; listEl.innerHTML = ''; return; }
  statsEl.innerHTML = '';
  listEl.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  const [{ data: students }, { data: followups }] = await Promise.all([
    sb.from('students').select('id, full_name').eq('grade_level', sfoGrade).eq('class_section', sfoSection).order('full_name'),
    sb.from('student_followups').select('id, student_id, type, score').eq('grade_level', sfoGrade).eq('class_section', sfoSection),
  ]);
  sfoStudentsCache = students || [];
  sfoFollowupsCache = followups || [];

  renderOverviewStats();
  renderOverviewStudentList();
}

const SFO_STAT_ICON = {
  students: { bg: 'var(--meadow-light)', fg: 'var(--meadow)', path: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>' },
  notes: { bg: 'var(--teal-light)', fg: 'var(--teal)', path: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 10h8M8 14h6"/>' },
  participation: { bg: 'var(--gold-light)', fg: 'var(--gold)', path: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  exam: { bg: 'var(--gold-light)', fg: 'var(--gold)', path: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>' },
  deduction: { bg: 'var(--danger-light)', fg: 'var(--danger)', path: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>' },
  top: { bg: 'var(--purple-light, #EFE8FB)', fg: 'var(--purple, #7A5CC2)', path: '<path d="M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-4z"/>' },
};
function sfoStatCard(label, value, sub, icon) {
  const style = SFO_STAT_ICON[icon];
  return `<div class="stat-card bud-stat">
    <div class="icon-chip" style="background:${style.bg}; color:${style.fg};">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${style.path}</svg>
    </div>
    <div class="body">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div style="font-size:11px; color:var(--slate); margin-top:4px; font-weight:600;">${sub}</div>` : ''}
    </div>
  </div>`;
}

function renderOverviewStats() {
  const statsEl = document.getElementById('sfo-class-stats');
  const notes = sfoFollowupsCache.filter(f => f.type === 'note');
  const participationScores = sfoFollowupsCache.filter(f => f.type === 'participation' && f.score != null).map(f => f.score);
  const examScores = sfoFollowupsCache.filter(f => f.type === 'exam' && f.score != null).map(f => f.score);
  const deductions = sfoFollowupsCache.filter(f => f.type === 'deduction');
  const deductionSum = deductions.reduce((s, f) => s + (f.score || 0), 0);

  const byStudentDeductions = new Map();
  deductions.forEach(f => byStudentDeductions.set(f.student_id, (byStudentDeductions.get(f.student_id) || 0) + 1));
  let topId = null, topCount = 0;
  byStudentDeductions.forEach((count, sid) => { if (count > topCount) { topCount = count; topId = sid; } });
  const topStudent = topId ? sfoStudentsCache.find(s => s.id === topId) : null;

  const avgP = avg(participationScores);
  const avgE = avg(examScores);

  statsEl.innerHTML = [
    sfoStatCard('عدد الطلاب', sfoStudentsCache.length, null, 'students'),
    sfoStatCard('ملاحظات مسجَّلة', notes.length, null, 'notes'),
    sfoStatCard('متوسط المشاركة', avgP != null ? avgP.toFixed(1) : '-', participationScores.length ? `${participationScores.length} درجة مسجَّلة` : null, 'participation'),
    sfoStatCard('متوسط الاختبارات', avgE != null ? avgE.toFixed(1) : '-', examScores.length ? `${examScores.length} درجة مسجَّلة` : null, 'exam'),
    sfoStatCard('عدد الخصومات', deductions.length, deductions.length ? `المجموع: ${deductionSum.toFixed(1)}` : null, 'deduction'),
    sfoStatCard('الأكثر خصومات', topStudent ? topStudent.full_name.split(' ')[0] : '-', topStudent ? `${topCount} خصم` : null, 'top'),
  ].join('');
}

function renderOverviewStudentList() {
  const listEl = document.getElementById('sfo-student-list');
  if (sfoStudentsCache.length === 0) {
    listEl.innerHTML = '<div class="placeholder"><p>ما فيه طلاب مسجلين بهذا الفصل</p></div>';
    return;
  }
  const term = sfoSearchTerm.trim();
  const filtered = term ? sfoStudentsCache.filter(s => (s.full_name || '').includes(term)) : sfoStudentsCache;
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="placeholder"><p>ما فيه طالب بهذا الاسم بالفصل</p></div>';
    return;
  }
  listEl.innerHTML = filtered.map(s => {
    const rows = sfoFollowupsCache.filter(f => f.student_id === s.id);
    const notesCount = rows.filter(f => f.type === 'note').length;
    const dedCount = rows.filter(f => f.type === 'deduction').length;
    const summary = rows.length === 0
      ? 'لا توجد سجلات بعد'
      : [notesCount ? `${notesCount} ملاحظة` : null, dedCount ? `${dedCount} خصم` : null].filter(Boolean).join(' · ') || `${rows.length} سجل`;
    return `<div class="emp-row" data-student-id="${s.id}" style="cursor:pointer;">
      <div class="avatar-circle">${esc((s.full_name || '؟').trim().charAt(0))}</div>
      <div class="info"><div class="name">${esc(s.full_name)}</div><div class="title">${summary}</div></div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.emp-row').forEach(row => {
    row.addEventListener('click', () => openStudentDetail(row.dataset.studentId));
  });
}

/* ---------- تقرير الطالب ---------- */
function showSfDetail(show) {
  document.getElementById('sf-overview-list-view')?.classList.toggle('hidden', show);
  document.getElementById('sf-detail-view')?.classList.toggle('hidden', !show);
  if (!show) sfDetailStudentId = null;
}
onEl('sf-detail-back', 'click', () => showSfDetail(false));

async function openStudentDetail(studentId) {
  sfDetailStudentId = studentId;
  showSfDetail(true);
  const detailStats = document.getElementById('sf-detail-stats');
  const detailLog = document.getElementById('sf-detail-log');
  detailStats.innerHTML = '';
  detailLog.innerHTML = '<p style="font-size:12.5px; color:var(--slate);">جارٍ التحميل...</p>';

  const student = sfoStudentsCache.find(s => s.id === studentId)
    || (await sb.from('students').select('id, full_name, grade_level, class_section').eq('id', studentId).maybeSingle()).data;
  if (!student) { showSfDetail(false); return; }

  document.getElementById('sf-detail-avatar').textContent = (student.full_name || '؟').trim().charAt(0);
  document.getElementById('sf-detail-name').textContent = student.full_name;
  document.getElementById('sf-detail-sub').textContent = `${gradeLabels[sfoGrade] || ''} — الفصل ${sfoSection ?? ''}`;

  const { data } = await sb.from('student_followups')
    .select('id, record_date, type, note_text, score')
    .eq('student_id', studentId).order('record_date', { ascending: false }).order('created_at', { ascending: false });
  const rows = data || [];

  renderDetailStats(rows);
  renderDetailLog(rows);
}

function renderDetailStats(rows) {
  const detailStats = document.getElementById('sf-detail-stats');
  const notes = rows.filter(r => r.type === 'note');
  const participationScores = rows.filter(r => r.type === 'participation' && r.score != null).map(r => r.score);
  const examScores = rows.filter(r => r.type === 'exam' && r.score != null).map(r => r.score);
  const deductions = rows.filter(r => r.type === 'deduction');
  const deductionSum = deductions.reduce((s, r) => s + (r.score || 0), 0);
  const avgP = avg(participationScores);
  const avgE = avg(examScores);

  detailStats.innerHTML = [
    sfoStatCard('ملاحظات', notes.length, null, 'notes'),
    sfoStatCard('متوسط المشاركة', avgP != null ? avgP.toFixed(1) : '-', participationScores.length ? `${participationScores.length} درجة` : null, 'participation'),
    sfoStatCard('متوسط الاختبارات', avgE != null ? avgE.toFixed(1) : '-', examScores.length ? `${examScores.length} درجة` : null, 'exam'),
    sfoStatCard('الخصومات', deductions.length, deductions.length ? `المجموع: ${deductionSum.toFixed(1)}` : null, 'deduction'),
  ].join('');
}

function renderDetailLog(rows) {
  const detailLog = document.getElementById('sf-detail-log');
  if (rows.length === 0) {
    detailLog.innerHTML = '<p style="font-size:12.5px; color:var(--slate); margin:0;">ما فيه سجلات لهذا الطالب بعد</p>';
    return;
  }
  detailLog.innerHTML = '';
  rows.forEach(r => detailLog.appendChild(buildLogLine(r, async () => {
    const { data } = await sb.from('student_followups')
      .select('id, record_date, type, note_text, score')
      .eq('student_id', sfDetailStudentId).order('record_date', { ascending: false }).order('created_at', { ascending: false });
    const fresh = data || [];
    renderDetailStats(fresh);
    renderDetailLog(fresh);
  })));
}

/* ---------- طباعة تقرير الطالب ---------- */
onEl('sf-detail-print-btn', 'click', () => {
  if (sfDetailStudentId) printStudentReport(sfDetailStudentId);
});

async function printStudentReport(studentId) {
  const student = sfoStudentsCache.find(s => s.id === studentId)
    || (await sb.from('students').select('id, full_name, grade_level, class_section').eq('id', studentId).maybeSingle()).data;
  if (!student) return;

  const { data } = await sb.from('student_followups')
    .select('id, record_date, type, note_text, score')
    .eq('student_id', studentId).order('record_date', { ascending: false }).order('created_at', { ascending: false });
  const rows = data || [];
  const notes = rows.filter(r => r.type === 'note');
  const participationScores = rows.filter(r => r.type === 'participation' && r.score != null).map(r => r.score);
  const examScores = rows.filter(r => r.type === 'exam' && r.score != null).map(r => r.score);
  const deductions = rows.filter(r => r.type === 'deduction');
  const avgP = avg(participationScores);
  const avgE = avg(examScores);

  const logoHtml = VOUCHER_LOGO_DATA_URI ? `<img src="${VOUCHER_LOGO_DATA_URI}" alt="شعار" style="height:54px;" />` : '';

  const rowsHtml = rows.length === 0 ? '<tr><td colspan="4" style="color:#999;">لا توجد سجلات</td></tr>' : rows.map(r => `
    <tr>
      <td>${formatDate(r.record_date)}</td>
      <td style="text-align:right;">${esc(TYPE_LABELS[r.type] || r.type)}</td>
      <td style="text-align:right;">${r.type === 'note' ? esc(r.note_text || '-') : '-'}</td>
      <td>${r.type !== 'note' ? esc(String(r.score ?? '-')) : '-'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير متابعة - ${esc(student.full_name)}</title>
<style>
  body { font-family: 'Tajawal', Arial, sans-serif; padding: 30px; color:#152238; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  .doc { max-width: 900px; margin: 0 auto; }
  .header { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #152238; padding-bottom:14px; margin-bottom:20px; }
  .header h1 { margin:0; font-size:20px; }
  .header p { margin:2px 0 0; font-size:12.5px; color:#6B7684; }
  table.meta { width:100%; border-collapse:collapse; margin-bottom:18px; }
  table.meta td { border:1px solid #ccc; padding:8px 10px; font-size:13px; }
  table.meta td.label { background:#f3f3f0; font-weight:bold; width:150px; }
  table.grid { width:100%; border-collapse:collapse; margin-bottom:20px; }
  table.grid th, table.grid td { border:1px solid #999; padding:6px 8px; font-size:12px; text-align:center; }
  table.grid th { background:#16233A; color:#fff; font-weight:600; }
  table.grid tbody tr:nth-child(even) { background:#f7f7f2; }
  h3 { font-size:14px; margin:18px 0 8px; }
  .footer-note { margin-top:24px; font-size:10.5px; color:#999; text-align:center; }
  @media print { body { padding:0; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="header">
      ${logoHtml}
      <div style="text-align:center; flex:1;">
        <h1>تقرير متابعة الطالب</h1>
        <p>${esc(ORG_NAME)}</p>
      </div>
      <div style="width:54px;"></div>
    </div>

    <table class="meta">
      <tr><td class="label">اسم الطالب</td><td>${esc(student.full_name)}</td><td class="label">المرحلة/الفصل</td><td>${esc(gradeLabels[student.grade_level] || sfoGrade)} — الفصل ${student.class_section ?? sfoSection ?? ''}</td></tr>
      <tr><td class="label">متوسط المشاركة</td><td>${avgP != null ? avgP.toFixed(1) : '-'}</td><td class="label">متوسط الاختبارات</td><td>${avgE != null ? avgE.toFixed(1) : '-'}</td></tr>
      <tr><td class="label">عدد الملاحظات</td><td>${notes.length}</td><td class="label">عدد الخصومات</td><td>${deductions.length}</td></tr>
      <tr><td class="label">تاريخ الطباعة</td><td colspan="3">${new Date().toLocaleDateString('ar-SA')}</td></tr>
    </table>

    <h3>السجل الكامل</h3>
    <table class="grid">
      <thead><tr><th style="width:100px;">التاريخ</th><th style="width:90px;">النوع</th><th>الملاحظة</th><th style="width:70px;">الدرجة</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="footer-note">تمت الطباعة من نظام إدارة المدرسة — ${new Date().toLocaleDateString('ar-SA')}</div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('يرجى السماح بفتح نافذة منبثقة للطباعة'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
