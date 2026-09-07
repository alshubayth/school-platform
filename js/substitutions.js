/*
 * بدلاء اليوم: تعويض غياب المعلمين وتبديل الحصص - يعتمد كليًا على جدول الحصص الموجود
 * بالمنصة (class_schedules) كمصدر أساسي، ويسجل فقط "التغييرات" على تاريخ معيّن بجدول
 * daily_schedule_changes (بدون أي تعديل على الجدول الأصلي) - نفس الجدول يخدم حالتين:
 *   - تعويض غياب معلم: صف واحد يغيّر المعلم فقط ويبقي المادة كما هي
 *   - تبديل حصتين لنفس الفصل: صفّان يتبادلان المادة/المعلم بينهما
 */
import { sb, currentUserId, currentProfile, isAdminOrDeputy, gradeLabels, backToTiles } from './core.js';

document.getElementById('back-to-tiles-15').addEventListener('click', backToTiles);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function normalizeArText(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function classLabel(grade, section) { return `${gradeLabels[grade] || grade} - الفصل ${section}`; }
// الجمعة/السبت إجازة أسبوعية - ما فيه جدول حصص لهما
function dayKeyFromDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const jsDay = d.getDay(); // 0=أحد .. 6=سبت
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
  return jsDay <= 4 ? dayKeys[jsDay] : null;
}

let subDate = todayIso();
let scheduleCache = [];   // class_schedules لنفس يوم الأسبوع للتاريخ المختار (كل الفصول)
let absencesCache = [];   // daily_teacher_absences لهذا التاريخ
let changesCache = [];    // daily_schedule_changes لهذا التاريخ
let allTeacherNames = [];
let sectionsByGrade = {};

export async function loadSubstitutionsModule() {
  const canManage = isAdminOrDeputy();
  document.getElementById('sub-admin-panel').classList.toggle('hidden', !canManage);
  document.getElementById('sub-date').value = subDate;

  if (allTeacherNames.length === 0) await loadAllTeacherNames();
  if (canManage) await populateSwapSectionSelect();

  await refreshForDate();
}

async function loadAllTeacherNames() {
  const { data } = await sb.from('class_schedules').select('teacher_name');
  const set = new Set((data || []).map(r => normalizeArText(r.teacher_name)).filter(Boolean));
  allTeacherNames = [...set].sort((a, b) => a.localeCompare(b, 'ar'));
}

async function loadSectionsForGrade(grade) {
  if (sectionsByGrade[grade]) return sectionsByGrade[grade];
  const { data } = await sb.from('class_schedules').select('class_section').eq('grade_level', grade);
  const secs = [...new Set((data || []).map(r => r.class_section))].sort((a, b) => a - b);
  sectionsByGrade[grade] = secs;
  return secs;
}
async function populateSwapSectionSelect() {
  const grade = document.getElementById('sub-swap-grade').value;
  const secs = await loadSectionsForGrade(grade);
  document.getElementById('sub-swap-section').innerHTML = secs.map(s => `<option value="${s}">الفصل ${s}</option>`).join('');
}
document.getElementById('sub-swap-grade').addEventListener('change', populateSwapSectionSelect);

document.getElementById('sub-date').addEventListener('change', async (e) => {
  subDate = e.target.value || todayIso();
  await refreshForDate();
});

async function refreshForDate() {
  const dayKey = dayKeyFromDate(subDate);
  if (!dayKey) {
    scheduleCache = []; absencesCache = []; changesCache = [];
    renderNoSchoolDay();
    return;
  }
  const [{ data: schedRows }, { data: absRows }, { data: changeRows }] = await Promise.all([
    sb.from('class_schedules').select('*').eq('day_of_week', dayKey),
    sb.from('daily_teacher_absences').select('*').eq('absence_date', subDate).order('created_at'),
    sb.from('daily_schedule_changes').select('*').eq('change_date', subDate).order('period_number'),
  ]);
  scheduleCache = schedRows || [];
  absencesCache = absRows || [];
  changesCache = changeRows || [];

  if (isAdminOrDeputy()) {
    populateAbsenceTeacherSelect();
    renderAbsenceList();
    renderCoverageList();
  }
  renderTodayList();
}

function renderNoSchoolDay() {
  document.getElementById('sub-today-list').innerHTML = '<div class="placeholder" style="padding:20px;"><p>هذا اليوم إجازة أسبوعية (جمعة/سبت) - ما فيه جدول حصص</p></div>';
  if (isAdminOrDeputy()) {
    document.getElementById('sub-absence-list').innerHTML = '';
    document.getElementById('sub-coverage-wrap').classList.add('hidden');
  }
}

/* ---------- غياب اليوم ---------- */
function populateAbsenceTeacherSelect() {
  const sel = document.getElementById('sub-absence-teacher-select');
  const absentSet = new Set(absencesCache.map(a => normalizeArText(a.teacher_name)));
  const options = allTeacherNames.filter(n => !absentSet.has(n));
  sel.innerHTML = '<option value="">اختر معلم...</option>' + options.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

function renderAbsenceList() {
  const wrap = document.getElementById('sub-absence-list');
  wrap.innerHTML = '';
  absencesCache.forEach(a => {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:var(--sand); border-radius:999px; padding:6px 12px; font-size:13px;';
    chip.innerHTML = `${esc(a.teacher_name)} <button type="button" data-id="${a.id}" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:14px; line-height:1;">✕</button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      await sb.from('daily_teacher_absences').delete().eq('id', a.id);
      await refreshForDate();
    });
    wrap.appendChild(chip);
  });
}

document.getElementById('sub-absence-add-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('sub-absence-error');
  errEl.style.display = 'none';
  const dayKey = dayKeyFromDate(subDate);
  if (!dayKey) { errEl.textContent = 'هذا اليوم إجازة أسبوعية - ما فيه جدول حصص'; errEl.style.display = 'block'; return; }
  const name = document.getElementById('sub-absence-teacher-select').value;
  if (!name) { errEl.textContent = 'اختر اسم المعلم أولاً'; errEl.style.display = 'block'; return; }
  const { error } = await sb.from('daily_teacher_absences').insert({
    absence_date: subDate, teacher_name: name, created_by: currentUserId,
  });
  if (error) { errEl.textContent = 'تعذّرت الإضافة: ' + error.message; errEl.style.display = 'block'; return; }
  await refreshForDate();
});

/* ---------- تعيين بديل لكل حصة ---------- */
function availableTeachersAtPeriod(period) {
  const busy = new Set();
  scheduleCache.filter(r => r.period_number === period).forEach(r => {
    const override = changesCache.find(c => c.grade_level === r.grade_level && c.class_section === r.class_section && c.period_number === period);
    busy.add(normalizeArText(override ? override.teacher_name : r.teacher_name));
  });
  const absentSet = new Set(absencesCache.map(a => normalizeArText(a.teacher_name)));
  return allTeacherNames.filter(n => !busy.has(n) && !absentSet.has(n));
}

function renderCoverageList() {
  const wrap = document.getElementById('sub-coverage-wrap');
  const list = document.getElementById('sub-coverage-list');
  if (absencesCache.length === 0) { wrap.classList.add('hidden'); list.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  list.innerHTML = '';

  absencesCache.forEach(a => {
    const name = normalizeArText(a.teacher_name);
    const periods = scheduleCache
      .filter(r => normalizeArText(r.teacher_name) === name)
      .sort((x, y) => x.period_number - y.period_number);

    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '10px';
    const rowsHtml = periods.length === 0
      ? '<p style="font-size:12.5px; color:var(--slate);">ما عنده حصص بهذا اليوم حسب الجدول الدراسي</p>'
      : periods.map(p => {
          const existing = changesCache.find(c => c.grade_level === p.grade_level && c.class_section === p.class_section && c.period_number === p.period_number);
          const label = `الحصة ${p.period_number} — ${esc(classLabel(p.grade_level, p.class_section))} — ${esc(p.subject_name || '-')}`;
          if (existing) {
            return `<div class="emp-row" style="align-items:center;">
              <div class="info" style="font-size:13px;">${label}<br><span style="color:var(--teal); font-weight:700;">البديل: ${esc(existing.teacher_name)}</span></div>
              <button type="button" class="sub-cancel-cover-btn" data-id="${existing.id}" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:12.5px;">إلغاء</button>
            </div>`;
          }
          const options = availableTeachersAtPeriod(p.period_number);
          const optionsHtml = options.length === 0
            ? '<option value="">لا يوجد معلم متاح بهذي الحصة</option>'
            : '<option value="">اختر البديل...</option>' + options.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
          return `<div class="emp-row" style="align-items:center; gap:8px;">
            <div class="info" style="font-size:13px; flex:1;">${label}</div>
            <select class="sub-cover-select" style="margin:0; width:auto; min-width:160px;"
              data-grade="${p.grade_level}" data-section="${p.class_section}" data-period="${p.period_number}"
              data-subject="${esc(p.subject_name || '')}" data-absent="${esc(name)}">${optionsHtml}</select>
            <button type="button" class="btn-primary sub-assign-btn" style="width:auto; padding:7px 14px;">تعيين</button>
          </div>`;
        }).join('');

    card.innerHTML = `<h4 style="margin-bottom:10px;">${esc(a.teacher_name)}</h4>${rowsHtml}`;
    list.appendChild(card);
  });

  list.querySelectorAll('.sub-assign-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sel = btn.previousElementSibling;
      const teacherName = sel.value;
      if (!teacherName) return;
      const dayKey = dayKeyFromDate(subDate);
      const { error } = await sb.from('daily_schedule_changes').upsert({
        change_date: subDate, day_of_week: dayKey,
        grade_level: sel.dataset.grade, class_section: Number(sel.dataset.section), period_number: Number(sel.dataset.period),
        teacher_name: teacherName, subject_name: sel.dataset.subject || null,
        reason: 'substitute', note: `بديل عن ${sel.dataset.absent}`, created_by: currentUserId,
      }, { onConflict: 'change_date,grade_level,class_section,period_number' });
      if (!error) await refreshForDate();
    });
  });
  list.querySelectorAll('.sub-cancel-cover-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sb.from('daily_schedule_changes').delete().eq('id', btn.dataset.id);
      await refreshForDate();
    });
  });
}

/* ---------- تبديل حصتين لنفس الفصل ---------- */
document.getElementById('sub-swap-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('sub-swap-error');
  const successEl = document.getElementById('sub-swap-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';

  const dayKey = dayKeyFromDate(subDate);
  if (!dayKey) { errEl.textContent = 'هذا اليوم إجازة أسبوعية - ما فيه جدول حصص'; errEl.style.display = 'block'; return; }

  const grade = document.getElementById('sub-swap-grade').value;
  const section = Number(document.getElementById('sub-swap-section').value);
  const pA = Number(document.getElementById('sub-swap-period-a').value);
  const pB = Number(document.getElementById('sub-swap-period-b').value);
  if (!pA || !pB) { errEl.textContent = 'اختر الحصتين المراد تبديلهما'; errEl.style.display = 'block'; return; }
  if (pA === pB) { errEl.textContent = 'اختر حصتين مختلفتين'; errEl.style.display = 'block'; return; }

  const baseA = scheduleCache.find(r => r.grade_level === grade && r.class_section === section && r.period_number === pA);
  const baseB = scheduleCache.find(r => r.grade_level === grade && r.class_section === section && r.period_number === pB);
  if (!baseA || !baseB) { errEl.textContent = 'ما فيه حصة بهذا الفصل بإحدى الحصتين المختارتين حسب الجدول الدراسي'; errEl.style.display = 'block'; return; }

  const overrideA = changesCache.find(c => c.grade_level === grade && c.class_section === section && c.period_number === pA);
  const overrideB = changesCache.find(c => c.grade_level === grade && c.class_section === section && c.period_number === pB);
  const effA = { teacher: overrideA ? overrideA.teacher_name : baseA.teacher_name, subject: overrideA ? overrideA.subject_name : baseA.subject_name };
  const effB = { teacher: overrideB ? overrideB.teacher_name : baseB.teacher_name, subject: overrideB ? overrideB.subject_name : baseB.subject_name };

  const rows = [
    { change_date: subDate, day_of_week: dayKey, grade_level: grade, class_section: section, period_number: pA,
      teacher_name: effB.teacher, subject_name: effB.subject, reason: 'swap', note: `تبديل مع الحصة ${pB}`, created_by: currentUserId },
    { change_date: subDate, day_of_week: dayKey, grade_level: grade, class_section: section, period_number: pB,
      teacher_name: effA.teacher, subject_name: effA.subject, reason: 'swap', note: `تبديل مع الحصة ${pA}`, created_by: currentUserId },
  ];
  const { error } = await sb.from('daily_schedule_changes').upsert(rows, { onConflict: 'change_date,grade_level,class_section,period_number' });
  if (error) { errEl.textContent = 'تعذّر التبديل: ' + error.message; errEl.style.display = 'block'; return; }

  successEl.style.display = 'block';
  setTimeout(() => { successEl.style.display = 'none'; }, 3000);
  await refreshForDate();
});

/* ---------- بدلاء اليوم (لكل الموظفين) ---------- */
function renderTodayList() {
  const list = document.getElementById('sub-today-list');
  if (!dayKeyFromDate(subDate)) return; // renderNoSchoolDay already handled the message
  if (changesCache.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه تغييرات على الجدول بهذا التاريخ</p></div>';
    return;
  }
  const sorted = changesCache.slice().sort((a, b) => a.period_number - b.period_number);
  list.innerHTML = `<div style="overflow-x:auto;">
    <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
      <thead><tr style="background:var(--sand);">
        <th style="padding:7px 8px; text-align:right;">الحصة</th>
        <th style="padding:7px 8px; text-align:right;">الفصل</th>
        <th style="padding:7px 8px; text-align:right;">المادة</th>
        <th style="padding:7px 8px; text-align:right;">المعلم الحالي</th>
        <th style="padding:7px 8px; text-align:right;">ملاحظة</th>
      </tr></thead>
      <tbody>${sorted.map(c => `
        <tr style="border-bottom:1px solid #ECEAE1;">
          <td style="padding:7px 8px; text-align:center;">${c.period_number}</td>
          <td style="padding:7px 8px;">${esc(classLabel(c.grade_level, c.class_section))}</td>
          <td style="padding:7px 8px;">${esc(c.subject_name || '-')}</td>
          <td style="padding:7px 8px; font-weight:700;">${esc(c.teacher_name)}</td>
          <td style="padding:7px 8px; color:var(--slate);">${esc(c.note || '-')}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}
