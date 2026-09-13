import { sb, currentProfile } from './core.js';
import { VOUCHER_LOGO_DATA_URI } from './budget.js';

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function initials(name) { return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join(''); }
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const ORG_NAME = 'مدرسة المروج';
const WEIGHT_TYPE_LABELS = { fixed: 'ثابت', per_period: 'نسبي - حصص', per_duty: 'نسبي - مناوبات' };

let employeesCache = [];
let criteriaCache = [];
let detailsAllCache = [];
let violationsCache = [];
let scheduleCache = [];
let dutyCache = [];
let settings = { academic_year: '' };
let detailEmployeeId = null;
let isAdmin = false;

export async function loadNotesModule() {
  isAdmin = currentProfile.role === 'admin';
  document.getElementById('eval-tab-overview').classList.toggle('hidden', !isAdmin);
  document.getElementById('eval-tab-settings').classList.toggle('hidden', !isAdmin);
  showEvalDetail(false);
  showEvalTab(isAdmin ? 'overview' : 'record');
  await refreshAll();
}

async function refreshAll() {
  const queries = [
    sb.from('employees').select('id, full_name, job_title, profile_id').order('full_name'),
    sb.from('perf_criteria').select('id, name, sort_order, weight').order('sort_order'),
    sb.from('perf_details').select('id, criterion_id, name, weight_type, weight_value, active').order('created_at'),
    sb.from('perf_settings').select('academic_year').eq('id', 1).maybeSingle(),
    sb.from('class_schedules').select('teacher_name'),
    sb.from('duty_roster').select('teacher_profile_id'),
  ];
  if (isAdmin) {
    queries.push(sb.from('perf_violations')
      .select('id, employee_id, criterion_id, detail_id, academic_year, occurred_date, content, computed_deduction, recorded_by, created_at, perf_criteria(name), perf_details(name), profiles:recorded_by(full_name)')
      .order('created_at', { ascending: false }));
  }
  const results = await Promise.all(queries);
  employeesCache = results[0].data || [];
  criteriaCache = results[1].data || [];
  detailsAllCache = results[2].data || [];
  settings = results[3].data || { academic_year: '' };
  scheduleCache = results[4].data || [];
  dutyCache = results[5].data || [];
  violationsCache = isAdmin ? (results[6] ? results[6].data || [] : []) : [];

  populateEmployeeSelect();
  populateCriterionSelect();
  const dateEl = document.getElementById('note-date');
  if (!dateEl.value) dateEl.value = todayIso();

  if (isAdmin) {
    renderStats();
    renderEmployeeList();
    document.getElementById('perf-year-input').value = settings.academic_year || '';
    renderNameCheckList();
    renderCriteriaSettings();
    if (detailEmployeeId) renderDetail(detailEmployeeId);
  }
}

/* ---------- حساب العبء (حصص/مناوبات) والخصم ---------- */
function periodCountForEmployee(emp) {
  if (!emp || !emp.full_name) return 0;
  return scheduleCache.filter(r => r.teacher_name === emp.full_name).length;
}
function dutyCountForEmployee(emp) {
  if (!emp || !emp.profile_id) return 0;
  return dutyCache.filter(r => r.teacher_profile_id === emp.profile_id).length;
}
function computeDeduction(detail, emp) {
  const base = Number(detail.weight_value) || 0;
  if (detail.weight_type === 'per_period') {
    const c = periodCountForEmployee(emp);
    return c > 0 ? base / c : base;
  }
  if (detail.weight_type === 'per_duty') {
    const c = dutyCountForEmployee(emp);
    return c > 0 ? base / c : base;
  }
  return base;
}

/* ---------- حساب تقرير الموظف من المخالفات المخزَّنة (السنة الدراسية الحالية فقط) ---------- */
function employeeStats(employeeId) {
  const empViolations = violationsCache.filter(v => v.employee_id === employeeId && v.academic_year === settings.academic_year);
  const byCriterion = new Map();
  empViolations.forEach(v => {
    byCriterion.set(v.criterion_id, (byCriterion.get(v.criterion_id) || 0) + Number(v.computed_deduction));
  });
  const breakdown = criteriaCache.map(c => {
    const deducted = byCriterion.get(c.id) || 0;
    const score = Math.max(0, 5 - deducted);
    const count = empViolations.filter(v => v.criterion_id === c.id).length;
    return { id: c.id, name: c.name, weight: Number(c.weight) || 1, score, deducted, count };
  });
  const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
  const finalScore = totalWeight > 0 ? breakdown.reduce((s, b) => s + b.score * b.weight, 0) / totalWeight : null;
  return { finalScore, breakdown, violations: empViolations };
}

function bandLabel(score) {
  if (score == null) return '-';
  if (score >= 4.5) return 'متفوق';
  if (score >= 4) return 'جدير بالثناء';
  if (score >= 3) return 'حقق الهدف';
  if (score >= 2) return 'مرضي';
  return 'قابل للتحسين';
}
function bandColor(score) {
  if (score == null) return '#6B7684';
  if (score >= 4.5) return '#2E9155';
  if (score >= 4) return '#0E93A8';
  if (score >= 3) return '#2455A4';
  if (score >= 2) return '#E07A34';
  return '#C0453D';
}
function bandBg(score) {
  if (score == null) return '#F3F6FB';
  if (score >= 4.5) return '#E7F5EC';
  if (score >= 4) return '#E3F4F7';
  if (score >= 3) return '#EAF1FC';
  if (score >= 2) return '#FDEFE3';
  return '#FBEAE9';
}

/* ---------- تبويبات القسم ---------- */
const EVAL_TABS = ['overview', 'record', 'settings'];
function showEvalTab(tab) {
  if (!EVAL_TABS.includes(tab)) tab = 'record';
  EVAL_TABS.forEach(t => {
    document.getElementById(`eval-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`eval-panel-${t}`).classList.toggle('hidden', t !== tab);
  });
}
EVAL_TABS.forEach(t => {
  document.getElementById(`eval-tab-${t}`).addEventListener('click', () => showEvalTab(t));
});

/* ---------- بطاقات الإحصائيات ---------- */
const STAT_ICON_STYLE = {
  employees: { bg: 'var(--meadow-light)', fg: 'var(--meadow)', path: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>' },
  notes: { bg: 'var(--teal-light)', fg: 'var(--teal)', path: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 10h8M8 14h6"/>' },
  top: { bg: 'var(--gold-light)', fg: 'var(--gold)', path: '<path d="M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-4z"/>' },
};
function statCard(label, value, sub, icon) {
  const style = STAT_ICON_STYLE[icon];
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

function renderStats() {
  const statsEl = document.getElementById('eval-stats');
  let best = { name: '-', score: -1 };
  let totalViolations = 0;
  employeesCache.forEach(e => {
    const { finalScore, violations } = employeeStats(e.id);
    totalViolations += violations.length;
    if (finalScore != null && finalScore > best.score) best = { name: e.full_name, score: finalScore };
  });
  statsEl.innerHTML = [
    statCard('عدد الموظفين', employeesCache.length, null, 'employees'),
    statCard('مخالفات السنة الحالية', totalViolations, settings.academic_year ? `السنة: ${settings.academic_year}` : null, 'notes'),
    statCard('أعلى تقييم', best.score >= 0 ? best.name.split(' ')[0] : '-', best.score >= 0 ? `${best.score.toFixed(1)} / 5 · ${bandLabel(best.score)}` : null, 'top'),
  ].join('');
}

/* ---------- قائمة الموظفين ---------- */
function ringSVG(score) {
  const pct = score ? Math.min(score / 5, 1) : 0;
  const r = 16, circ = 2 * Math.PI * r;
  const color = !score ? '#D8D5C8' : score >= 4 ? '#1D8FA6' : score >= 2.5 ? '#E8763A' : '#B3413A';
  return `<svg width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="#ECEAE1" stroke-width="4"/>
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="4"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}" stroke-linecap="round"
      transform="rotate(-90 20 20)"/>
  </svg>`;
}

function renderEmployeeList() {
  const list = document.getElementById('eval-employee-list');
  if (employeesCache.length === 0) {
    list.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px;">لا يوجد موظفون مضافون بعد. أضفهم من قسم "بوابة الموظفين" أولاً.</p>';
    return;
  }
  list.innerHTML = employeesCache.map(e => {
    const { finalScore, violations } = employeeStats(e.id);
    return `<div class="emp-row" data-employee-id="${e.id}" style="cursor:pointer;">
      <div class="avatar-circle">${esc(initials(e.full_name))}</div>
      <div class="info"><div class="name">${esc(e.full_name)}</div><div class="title">${esc(e.job_title || '')} · ${violations.length} مخالفة</div></div>
      <div class="ring-wrap">${ringSVG(finalScore)}<span class="ring-score">${finalScore != null ? finalScore.toFixed(1) : '-'}</span></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.emp-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.employeeId));
  });
}

/* ---------- تقرير المعلم ---------- */
function showEvalDetail(show) {
  document.getElementById('eval-overview-list-view').classList.toggle('hidden', show);
  document.getElementById('eval-detail-view').classList.toggle('hidden', !show);
  if (!show) detailEmployeeId = null;
}
document.getElementById('eval-detail-back').addEventListener('click', () => showEvalDetail(false));

function openDetail(employeeId) {
  detailEmployeeId = employeeId;
  showEvalDetail(true);
  renderDetail(employeeId);
}

function renderDetail(employeeId) {
  const emp = employeesCache.find(e => e.id === employeeId);
  if (!emp) { showEvalDetail(false); return; }
  const { finalScore, breakdown, violations } = employeeStats(employeeId);

  document.getElementById('eval-detail-avatar').textContent = initials(emp.full_name);
  document.getElementById('eval-detail-name').textContent = emp.full_name;
  document.getElementById('eval-detail-title').textContent = emp.job_title || '';
  document.getElementById('eval-detail-ring').innerHTML = `${ringSVG(finalScore)}<span class="ring-score">${finalScore != null ? finalScore.toFixed(1) : '-'}</span>`;
  document.getElementById('eval-detail-band').innerHTML = finalScore != null
    ? `<span class="eval-note-badge" style="background:${bandBg(finalScore)}; color:${bandColor(finalScore)};">${bandLabel(finalScore)}</span>`
    : '';

  const breakdownEl = document.getElementById('eval-detail-breakdown');
  breakdownEl.innerHTML = breakdown.map(b => {
    const pct = Math.min(b.score / 5, 1) * 100;
    return `<div class="eval-breakdown-row">
      <div class="eb-name">${esc(b.name)} <span style="color:var(--slate); font-weight:400;">(${b.count})</span></div>
      <div class="eb-bar-wrap"><div class="eb-bar" style="width:${pct}%; background:${bandColor(b.score)};"></div></div>
      <div class="eb-score">${b.score.toFixed(2)}</div>
    </div>`;
  }).join('');

  const notesEl = document.getElementById('eval-detail-notes');
  if (violations.length === 0) {
    notesEl.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px 0;">لا توجد مخالفات مسجلة لهذا المعلم بالسنة الدراسية الحالية.</p>';
  } else {
    notesEl.innerHTML = violations.map(v => {
      const critName = v.perf_criteria ? v.perf_criteria.name : null;
      const detName = v.perf_details ? v.perf_details.name : null;
      const recBy = v.profiles ? v.profiles.full_name : null;
      const date = v.occurred_date ? new Date(v.occurred_date).toLocaleDateString('ar-SA') : '';
      const metaParts = [critName, detName, recBy ? `بواسطة ${recBy}` : null, date].filter(Boolean);
      return `<div class="eval-note-row">
        <span class="eval-note-badge" style="background:var(--danger-light); color:var(--danger);">-${Number(v.computed_deduction).toFixed(2)}</span>
        <div class="eval-note-body">
          <div class="eval-note-content">${v.content ? esc(v.content) : '<span style="color:var(--slate);">بدون تفاصيل إضافية</span>'}</div>
          <div class="eval-note-meta">${metaParts.map(esc).join(' · ')}</div>
        </div>
        <button class="eval-note-delete" data-note-id="${v.id}" title="حذف المخالفة">×</button>
      </div>`;
    }).join('');
    notesEl.querySelectorAll('.eval-note-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteViolation(btn.dataset.noteId));
    });
  }
}

async function deleteViolation(id) {
  if (!confirm('حذف هذه المخالفة؟')) return;
  const { error } = await sb.from('perf_violations').delete().eq('id', id);
  if (error) { alert('تعذر الحذف: ' + error.message); return; }
  await refreshAll();
}

/* ---------- بطاقة الأداء (طباعة PDF) ---------- */
document.getElementById('eval-print-card-btn').addEventListener('click', () => {
  if (detailEmployeeId) printPerformanceCard(detailEmployeeId);
});

function printPerformanceCard(employeeId) {
  const emp = employeesCache.find(e => e.id === employeeId);
  if (!emp) return;
  const { finalScore, breakdown, violations } = employeeStats(employeeId);
  const logoHtml = VOUCHER_LOGO_DATA_URI ? `<img src="${VOUCHER_LOGO_DATA_URI}" alt="شعار" style="height:54px;" />` : '';

  const rowsHtml = breakdown.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="text-align:right;">${esc(b.name)}</td>
      <td>${b.weight}</td>
      <td>${b.score.toFixed(2)}</td>
      <td>${b.count}</td>
    </tr>`).join('');

  const violationsHtml = violations.length === 0
    ? '<tr><td colspan="5" style="color:#999;">لا توجد مخالفات مسجلة</td></tr>'
    : violations.map(v => `
      <tr>
        <td>${v.occurred_date ? new Date(v.occurred_date).toLocaleDateString('ar-SA') : '-'}</td>
        <td style="text-align:right;">${esc(v.perf_criteria ? v.perf_criteria.name : '-')}</td>
        <td style="text-align:right;">${esc(v.perf_details ? v.perf_details.name : '-')}</td>
        <td style="text-align:right;">${esc(v.content || '-')}</td>
        <td>-${Number(v.computed_deduction).toFixed(2)}</td>
      </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>بطاقة أداء - ${esc(emp.full_name)}</title>
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
  .band-badge { display:inline-block; padding:4px 14px; border-radius:20px; font-weight:700; font-size:13px; }
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
        <h1>بطاقة أداء الموظف</h1>
        <p>${esc(ORG_NAME)}</p>
      </div>
      <div style="width:54px;"></div>
    </div>

    <table class="meta">
      <tr><td class="label">اسم المعلم</td><td>${esc(emp.full_name)}</td><td class="label">الوظيفة</td><td>${esc(emp.job_title || '-')}</td></tr>
      <tr><td class="label">السنة الدراسية</td><td>${esc(settings.academic_year || '-')}</td><td class="label">تاريخ الطباعة</td><td>${new Date().toLocaleDateString('ar-SA')}</td></tr>
      <tr><td class="label">الدرجة النهائية</td><td>${finalScore != null ? finalScore.toFixed(2) + ' / 5' : '-'}</td><td class="label">التصنيف</td><td><span class="band-badge" style="background:${bandBg(finalScore)}; color:${bandColor(finalScore)};">${bandLabel(finalScore)}</span></td></tr>
    </table>

    <h3>تفصيل المعايير</h3>
    <table class="grid">
      <thead><tr><th style="width:32px;">م</th><th>المعيار</th><th style="width:60px;">الوزن</th><th style="width:70px;">الدرجة</th><th style="width:90px;">عدد المخالفات</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <h3>سجل المخالفات</h3>
    <table class="grid">
      <thead><tr><th style="width:90px;">التاريخ</th><th>المعيار</th><th>البند</th><th>التفاصيل</th><th style="width:60px;">الخصم</th></tr></thead>
      <tbody>${violationsHtml}</tbody>
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

/* ---------- نموذج تسجيل مخالفة ---------- */
function populateEmployeeSelect() {
  const sel = document.getElementById('note-employee');
  const prevVal = sel.value;
  sel.innerHTML = '';
  employeesCache.forEach(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.full_name; sel.appendChild(o); });
  if (prevVal && employeesCache.some(e => e.id === prevVal)) sel.value = prevVal;
}

function populateCriterionSelect() {
  const sel = document.getElementById('note-criterion');
  const prevVal = sel.value;
  sel.innerHTML = '';
  criteriaCache.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
  if (prevVal && criteriaCache.some(c => c.id === prevVal)) sel.value = prevVal;
  populateDetailSelect();
}

function populateDetailSelect() {
  const critId = document.getElementById('note-criterion').value;
  const sel = document.getElementById('note-detail');
  const prevVal = sel.value;
  const activeDetails = detailsAllCache.filter(d => d.criterion_id === critId && d.active !== false);
  if (activeDetails.length === 0) {
    sel.innerHTML = '<option value="">لا توجد بنود مفعّلة لهذا المعيار</option>';
  } else {
    sel.innerHTML = activeDetails.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    if (prevVal && activeDetails.some(d => d.id === prevVal)) sel.value = prevVal;
  }
  updateDeductionPreview();
}

document.getElementById('note-criterion').addEventListener('change', populateDetailSelect);
document.getElementById('note-employee').addEventListener('change', updateDeductionPreview);
document.getElementById('note-detail').addEventListener('change', updateDeductionPreview);

function updateDeductionPreview() {
  const previewEl = document.getElementById('note-deduction-preview');
  const emp = employeesCache.find(e => e.id === document.getElementById('note-employee').value);
  const detail = detailsAllCache.find(d => d.id === document.getElementById('note-detail').value);
  if (!emp || !detail) { previewEl.textContent = ''; return; }
  const deduction = computeDeduction(detail, emp);
  let extra = '';
  if (detail.weight_type === 'per_period') extra = ` (عدد حصص المعلم بالجدول الدراسي: ${periodCountForEmployee(emp)})`;
  if (detail.weight_type === 'per_duty') extra = ` (عدد مناوبات المعلم: ${dutyCountForEmployee(emp)})`;
  previewEl.textContent = `الخصم المحتسب من رصيد هذا المعيار: ${deduction.toFixed(3)}${extra}`;
}

document.getElementById('note-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('note-error');
  const successEl = document.getElementById('note-success-msg');
  successEl.style.display = 'none';

  const employeeId = document.getElementById('note-employee').value;
  const criterionId = document.getElementById('note-criterion').value;
  const detailId = document.getElementById('note-detail').value;
  const occurredDate = document.getElementById('note-date').value || todayIso();
  const content = document.getElementById('note-text').value.trim();

  if (!employeeId) { errEl.textContent = 'أضف موظفًا أولاً من قسم بوابة الموظفين'; errEl.style.display = 'block'; return; }
  if (!criterionId) { errEl.textContent = 'اختر معيارًا'; errEl.style.display = 'block'; return; }
  if (!detailId) { errEl.textContent = 'اختر بندًا (أو أضف بنود لهذا المعيار من الإعدادات)'; errEl.style.display = 'block'; return; }

  const emp = employeesCache.find(e => e.id === employeeId);
  const detail = detailsAllCache.find(d => d.id === detailId);
  const deduction = computeDeduction(detail, emp);

  errEl.style.display = 'none';
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('perf_violations').insert({
    employee_id: employeeId,
    criterion_id: criterionId,
    detail_id: detailId,
    academic_year: settings.academic_year || '',
    occurred_date: occurredDate,
    content,
    computed_deduction: deduction,
    recorded_by: userData.user.id,
  });
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('note-text').value = '';
  successEl.style.display = 'inline';
  setTimeout(() => { successEl.style.display = 'none'; }, 2500);
  await refreshAll();
});

/* ---------- الإعدادات: السنة الدراسية ---------- */
document.getElementById('perf-year-save').addEventListener('click', async () => {
  const errEl = document.getElementById('perf-year-error');
  const value = document.getElementById('perf-year-input').value.trim();
  if (!value) { errEl.textContent = 'اكتب السنة الدراسية'; errEl.style.display = 'block'; return; }
  if (value !== settings.academic_year) {
    if (!confirm(`تغيير السنة الدراسية إلى "${value}" يبدأ رصيد كل المعايير من جديد (٥ لكل معيار) لكل الموظفين. متابعة؟`)) return;
  }
  errEl.style.display = 'none';
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('perf_settings').update({ academic_year: value, updated_by: userData.user.id, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }
  await refreshAll();
});

/* ---------- الإعدادات: تحقق تطابق الأسماء ---------- */
function renderNameCheckList() {
  const el = document.getElementById('perf-name-check-list');
  if (employeesCache.length === 0) {
    el.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px;">لا يوجد موظفون بعد.</p>';
    return;
  }
  el.innerHTML = employeesCache.map(e => {
    const count = periodCountForEmployee(e);
    return `<div class="eval-indicator-row ${count === 0 ? 'inactive' : ''}">
      <div class="ei-name">${esc(e.full_name)}</div>
      <div class="ei-weight">${count > 0 ? `${count} حصة أسبوعيًا` : '⚠ لا يوجد تطابق بجدول الحصص'}</div>
    </div>`;
  }).join('');
}

/* ---------- الإعدادات: المعايير وبنودها ---------- */
function renderCriteriaSettings() {
  const container = document.getElementById('perf-criteria-list');
  const openIds = new Set(Array.from(container.querySelectorAll('details[open]')).map(d => d.dataset.critId));

  if (criteriaCache.length === 0) {
    container.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px;">لا توجد معايير محمّلة - تأكد إنك شغّلت ملف SQL الخاص بهذا القسم أولاً.</p>';
    return;
  }

  container.innerHTML = criteriaCache.map(c => {
    const details = detailsAllCache.filter(d => d.criterion_id === c.id);
    return `<details class="bud-section-card" data-crit-id="${c.id}" style="padding:16px 4px; margin-bottom:10px;">
      <summary style="cursor:pointer; font-weight:700; font-size:13.5px; display:flex; align-items:center; gap:10px;">
        <span style="flex:1;">${esc(c.name)}</span>
        <span style="font-size:11.5px; color:var(--slate); font-weight:400;">${details.length} بند · وزن ${c.weight}</span>
      </summary>
      <div style="padding-top:12px;">
        <div class="form-row" style="align-items:center;">
          <label style="font-size:12.5px; color:var(--slate); white-space:nowrap; align-self:center;">وزن هذا المعيار بالدرجة النهائية:</label>
          <input type="number" class="perf-crit-weight-input" data-crit-id="${c.id}" value="${c.weight}" min="0.1" step="0.1" style="max-width:100px;" />
          <button class="text-action-btn perf-crit-weight-save" data-crit-id="${c.id}" type="button">حفظ الوزن</button>
        </div>
        <div style="margin-top:10px;">
          ${details.length === 0
            ? '<p style="font-size:12px; color:var(--slate); padding:6px 0;">لا توجد بنود بعد.</p>'
            : details.map(d => `
              <div class="eval-indicator-row ${d.active === false ? 'inactive' : ''}">
                <div class="ei-name">${esc(d.name)} <span class="eval-note-badge" style="background:var(--sand); color:var(--slate); margin-inline-start:6px;">${WEIGHT_TYPE_LABELS[d.weight_type] || d.weight_type}</span></div>
                <div class="ei-weight">القيمة: ${d.weight_value}</div>
                <div class="ei-actions">
                  <button class="ei-toggle-btn" data-detail-id="${d.id}" data-active="${d.active !== false}" type="button">${d.active === false ? 'تفعيل' : 'تعطيل'}</button>
                  <button class="ei-delete-btn" data-detail-id="${d.id}" type="button">حذف</button>
                </div>
              </div>`).join('')}
        </div>
        <div class="form-row" style="margin-top:12px;">
          <input type="text" class="perf-new-detail-name" data-crit-id="${c.id}" placeholder="اسم البند الجديد" />
          <select class="perf-new-detail-type" data-crit-id="${c.id}">
            <option value="fixed">وزن ثابت</option>
            <option value="per_period">نسبي لعدد الحصص</option>
            <option value="per_duty">نسبي لعدد المناوبات</option>
          </select>
          <input type="number" class="perf-new-detail-value" data-crit-id="${c.id}" placeholder="القيمة" min="0.01" step="0.01" value="0.1" style="max-width:100px;" />
          <button class="btn-primary perf-add-detail-btn" data-crit-id="${c.id}" type="button" style="white-space:nowrap;">+ إضافة</button>
        </div>
        <div class="error-msg perf-detail-error" data-crit-id="${c.id}" style="display:none;"></div>
      </div>
    </details>`;
  }).join('');

  container.querySelectorAll('details[data-crit-id]').forEach(d => {
    if (openIds.has(d.dataset.critId)) d.open = true;
  });

  container.querySelectorAll('.perf-crit-weight-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const critId = btn.dataset.critId;
      const input = container.querySelector(`.perf-crit-weight-input[data-crit-id="${critId}"]`);
      const weight = parseFloat(input.value);
      if (!weight || weight <= 0) { alert('اكتب وزن أكبر من صفر'); return; }
      const { error } = await sb.from('perf_criteria').update({ weight }).eq('id', critId);
      if (error) { alert('تعذر الحفظ: ' + error.message); return; }
      await refreshAll();
    });
  });

  container.querySelectorAll('.ei-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === 'true';
      const { error } = await sb.from('perf_details').update({ active: !active }).eq('id', btn.dataset.detailId);
      if (error) { alert('تعذر التحديث: ' + error.message); return; }
      await refreshAll();
    });
  });

  container.querySelectorAll('.ei-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const hasViolations = violationsCache.some(v => v.detail_id === btn.dataset.detailId);
      const msg = hasViolations
        ? 'هذا البند مرتبط بمخالفات مسجلة سابقًا. حذفه سيفصل تلك المخالفات عنه (تبقى محفوظة بخصمها الأصلي وقت تسجيلها). تعطيله بدل حذفه أسلم غالبًا. متابعة الحذف؟'
        : 'حذف هذا البند؟';
      if (!confirm(msg)) return;
      const { error } = await sb.from('perf_details').delete().eq('id', btn.dataset.detailId);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      await refreshAll();
    });
  });

  container.querySelectorAll('.perf-add-detail-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const critId = btn.dataset.critId;
      const nameInput = container.querySelector(`.perf-new-detail-name[data-crit-id="${critId}"]`);
      const typeSelect = container.querySelector(`.perf-new-detail-type[data-crit-id="${critId}"]`);
      const valueInput = container.querySelector(`.perf-new-detail-value[data-crit-id="${critId}"]`);
      const errEl = container.querySelector(`.perf-detail-error[data-crit-id="${critId}"]`);
      const name = nameInput.value.trim();
      const weightValue = parseFloat(valueInput.value);
      if (!name) { errEl.textContent = 'اكتب اسم البند'; errEl.style.display = 'block'; return; }
      if (!weightValue || weightValue <= 0) { errEl.textContent = 'اكتب قيمة أكبر من صفر'; errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';
      const { error } = await sb.from('perf_details').insert({ criterion_id: critId, name, weight_type: typeSelect.value, weight_value: weightValue, active: true });
      if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }
      await refreshAll();
    });
  });
}
