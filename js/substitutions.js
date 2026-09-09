/*
 * بدلاء اليوم: تعويض غياب المعلمين وتبديل الحصص - يعتمد كليًا على جدول الحصص الموجود
 * بالمنصة (class_schedules) كمصدر أساسي، ويسجل فقط "التغييرات" على تاريخ معيّن بجدول
 * daily_schedule_changes (بدون أي تعديل على الجدول الأصلي) - نفس الجدول يخدم حالتين:
 *   - تعويض غياب معلم: صف واحد يغيّر المعلم فقط ويبقي المادة كما هي
 *   - تبديل حصتين لنفس الفصل: صفّان يتبادلان المادة/المعلم بينهما (تُستخدم أيضًا لـ"نقل"
 *     حصة معلم غايب لوقت ثاني بنفس الفصل - عشان الفصل ما تضيع عليه حصته)
 * أي عملية تبديل تتحقق أول من عدم تعارضها مع حصص المعلمين الثانية بنفس الوقت قبل حفظها.
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

/* ---------- أدوات مشتركة: الوضع الفعلي لأي حصة، التحقق من التعارض، وتنفيذ التبديل ---------- */
// الوضع الفعلي (بعد أي تغييرات مسجّلة) لحصة معيّنة - المعلم والمادة اللي فعليًا يدرّسونها الآن
function effectiveAt(grade, section, period) {
  const base = scheduleCache.find(r => r.grade_level === grade && r.class_section === section && r.period_number === period);
  if (!base) return null;
  const override = changesCache.find(c => c.grade_level === grade && c.class_section === section && c.period_number === period);
  return {
    teacher: override ? override.teacher_name : base.teacher_name,
    subject: override ? (override.subject_name || base.subject_name) : base.subject_name,
  };
}
// هل عند هذا المعلم فصل ثاني (غير الفصل المستثنى) مجدول فعليًا بنفس الحصة؟ - تعارض يمنع التبديل
function findTeacherConflict(teacherName, period, excludeGrade, excludeSection) {
  const name = normalizeArText(teacherName);
  for (const r of scheduleCache.filter(x => x.period_number === period)) {
    if (r.grade_level === excludeGrade && r.class_section === excludeSection) continue;
    const eff = effectiveAt(r.grade_level, r.class_section, period);
    if (eff && normalizeArText(eff.teacher) === name) {
      return { grade: r.grade_level, section: r.class_section, subject: eff.subject };
    }
  }
  return null;
}
// يعيد تحميل daily_schedule_changes فقط (بعد أي كتابة) عشان الكاش يبقى محدّث أثناء سلسلة تبديلات متتالية
async function reloadChangesCache() {
  const { data } = await sb.from('daily_schedule_changes').select('*').eq('change_date', subDate).order('period_number');
  changesCache = data || [];
}
// يبدّل حصتين لنفس الفصل (المادة والمعلم يتبادلون) بعد التأكد إن ما فيه تعارض على أي معلم منقول
// عند وجود تعارض يرجع تفاصيله (مو مجرد رسالة) عشان الواجهة تقدر تفتح حل مباشر (تبديل متسلسل) بدل ما توقف بس
async function performClassSwap(grade, section, pA, pB) {
  const dayKey = dayKeyFromDate(subDate);
  if (!dayKey) return { ok: false, message: 'هذا اليوم إجازة أسبوعية - ما فيه جدول حصص' };
  if (!pA || !pB || pA === pB) return { ok: false, message: 'اختر حصتين مختلفتين' };
  const effA = effectiveAt(grade, section, pA);
  const effB = effectiveAt(grade, section, pB);
  if (!effA || !effB) return { ok: false, message: 'ما فيه حصة بهذا الفصل بإحدى الحصتين المختارتين حسب الجدول الدراسي' };

  const conflictForA = findTeacherConflict(effB.teacher, pA, grade, section); // effB.teacher راح يصير بالحصة pA
  if (conflictForA) {
    return { ok: false, conflict: { teacherName: effB.teacher, atPeriod: pA, blockingGrade: conflictForA.grade, blockingSection: conflictForA.section, blockingSubject: conflictForA.subject } };
  }
  const conflictForB = findTeacherConflict(effA.teacher, pB, grade, section); // effA.teacher راح يصير بالحصة pB
  if (conflictForB) {
    return { ok: false, conflict: { teacherName: effA.teacher, atPeriod: pB, blockingGrade: conflictForB.grade, blockingSection: conflictForB.section, blockingSubject: conflictForB.subject } };
  }

  const rows = [
    { change_date: subDate, day_of_week: dayKey, grade_level: grade, class_section: section, period_number: pA,
      teacher_name: effB.teacher, subject_name: effB.subject, reason: 'swap', note: `تبديل مع الحصة ${pB}`, created_by: currentUserId },
    { change_date: subDate, day_of_week: dayKey, grade_level: grade, class_section: section, period_number: pB,
      teacher_name: effA.teacher, subject_name: effA.subject, reason: 'swap', note: `تبديل مع الحصة ${pA}`, created_by: currentUserId },
  ];
  const { error } = await sb.from('daily_schedule_changes').upsert(rows, { onConflict: 'change_date,grade_level,class_section,period_number' });
  if (error) return { ok: false, message: 'تعذّر التبديل: ' + error.message };
  await reloadChangesCache();
  return { ok: true };
}

// يحاول تنفيذ تبديل، ولو صادف تعارض يعرض بنفس المكان حل مباشر (اختيار حصة ثانية لنقل المعلم المتعارض)
// بدل ما يوقف بس - ولو الحل نفسه صادف تعارض ثاني يفتح حل متداخل، وهكذا لين تنحل السلسلة كاملة
async function attemptSwapWithResolution(container, grade, section, pA, pB, onDone) {
  const result = await performClassSwap(grade, section, pA, pB);
  if (result.ok) { container.innerHTML = ''; await onDone(); return; }
  if (!result.conflict) {
    container.innerHTML = `<p style="color:var(--danger); font-size:12px; margin:6px 0 0;">${esc(result.message || 'خطأ غير متوقع')}</p>`;
    return;
  }
  const c = result.conflict;
  const periods = [1, 2, 3, 4, 5, 6, 7].filter(p => p !== c.atPeriod);
  container.innerHTML = `
    <div style="background:#FDEDEC; border-radius:8px; padding:10px 12px; margin-top:8px;">
      <p style="margin:0 0 8px; font-size:12.5px; color:var(--danger);">⚠ ${esc(c.teacherName)} عنده أصلاً حصة "${esc(c.blockingSubject || '-')}" بفصل ${esc(classLabel(c.blockingGrade, c.blockingSection))} بالحصة ${c.atPeriod} — انقلها إلى:</p>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <select class="nested-period-select" style="margin:0; width:auto;"><option value="">اختر الحصة...</option>${periods.map(p => `<option value="${p}">الحصة ${p}</option>`).join('')}</select>
        <button type="button" class="btn-primary nested-confirm-btn" style="width:auto; padding:6px 14px;">تأكيد</button>
      </div>
      <div class="nested-sub-container"></div>
    </div>`;
  container.querySelector('.nested-confirm-btn').addEventListener('click', async () => {
    const target = Number(container.querySelector('.nested-period-select').value);
    if (!target) return;
    const subContainer = container.querySelector('.nested-sub-container');
    await attemptSwapWithResolution(subContainer, c.blockingGrade, c.blockingSection, c.atPeriod, target, async () => {
      // انحل هذا التعارض - نعيد محاولة التبديل الأصلي (ممكن يظهر تعارض ثاني فيفتح حل جديد بنفس الطريقة)
      await attemptSwapWithResolution(container, grade, section, pA, pB, onDone);
    });
  });
}

/* ---------- تعيين بديل لكل حصة (بنفس الحصة أو بعد نقلها لحصة ثانية) ---------- */
// كل الحصص اللي لسا معلمها الفعلي (بعد أي تغييرات) هو نفس المعلم الغايب - يعني تحتاج بديل
function periodsNeedingCoverageFor(absentName) {
  const name = normalizeArText(absentName);
  const results = [];
  for (let period = 1; period <= 7; period++) {
    scheduleCache.filter(r => r.period_number === period).forEach(r => {
      const eff = effectiveAt(r.grade_level, r.class_section, period);
      if (eff && normalizeArText(eff.teacher) === name) {
        const override = changesCache.find(c => c.grade_level === r.grade_level && c.class_section === r.class_section && c.period_number === period);
        results.push({
          grade: r.grade_level, section: r.class_section, period, subject: eff.subject,
          relocatedNote: override && override.reason === 'swap' ? override.note : null,
        });
      }
    });
  }
  return results.sort((a, b) => a.period - b.period);
}

function availableTeachersAtPeriod(period) {
  const busy = new Set();
  scheduleCache.filter(r => r.period_number === period).forEach(r => {
    const eff = effectiveAt(r.grade_level, r.class_section, period);
    if (eff) busy.add(normalizeArText(eff.teacher));
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
    const periods = periodsNeedingCoverageFor(name);

    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '10px';
    const rowsHtml = periods.length === 0
      ? '<p style="font-size:12.5px; color:var(--teal);">كل حصص هذا المعلم اليوم معوّضة ✓</p>'
      : periods.map(p => {
          const label = `الحصة ${p.period} — ${esc(classLabel(p.grade, p.section))} — ${esc(p.subject || '-')}`;
          const options = availableTeachersAtPeriod(p.period);
          const optionsHtml = options.length === 0
            ? '<option value="">لا يوجد معلم متاح بهذي الحصة</option>'
            : '<option value="">اختر البديل...</option>' + options.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
          const otherPeriods = [1, 2, 3, 4, 5, 6, 7].filter(x => x !== p.period);
          return `<div class="sub-period-row" data-grade="${p.grade}" data-section="${p.section}" data-period="${p.period}" data-subject="${esc(p.subject || '')}" data-absent="${esc(name)}" style="border-bottom:1px solid #ECEAE1; padding:10px 0;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div class="info" style="font-size:13px; flex:1; min-width:220px;">${label}${p.relocatedNote ? `<br><span style="color:var(--slate); font-size:11.5px;">(${esc(p.relocatedNote)})</span>` : ''}</div>
              <select class="sub-cover-select" style="margin:0; width:auto; min-width:160px;">${optionsHtml}</select>
              <button type="button" class="btn-primary sub-assign-btn" style="width:auto; padding:7px 14px;">تعيين</button>
              <button type="button" class="sub-relocate-toggle-btn" style="border:1px solid var(--slate); background:none; color:var(--slate); border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">نقل لحصة ثانية بنفس الفصل</button>
            </div>
            <div class="sub-relocate-panel hidden" style="margin-top:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <select class="sub-relocate-period" style="margin:0; width:auto;">
                <option value="">انقلها إلى الحصة...</option>
                ${otherPeriods.map(x => `<option value="${x}">الحصة ${x}</option>`).join('')}
              </select>
              <button type="button" class="btn-primary sub-relocate-confirm-btn" style="width:auto; padding:6px 14px; background:var(--slate);">تأكيد النقل</button>
            </div>
            <div class="sub-relocate-resolution" style="width:100%;"></div>
          </div>`;
        }).join('');

    card.innerHTML = `<h4 style="margin-bottom:6px;">${esc(a.teacher_name)}</h4>${rowsHtml}`;
    list.appendChild(card);
  });

  list.querySelectorAll('.sub-period-row').forEach(rowEl => {
    rowEl.querySelector('.sub-assign-btn').addEventListener('click', async () => {
      const sel = rowEl.querySelector('.sub-cover-select');
      const teacherName = sel.value;
      if (!teacherName) return;
      const dayKey = dayKeyFromDate(subDate);
      const { error } = await sb.from('daily_schedule_changes').upsert({
        change_date: subDate, day_of_week: dayKey,
        grade_level: rowEl.dataset.grade, class_section: Number(rowEl.dataset.section), period_number: Number(rowEl.dataset.period),
        teacher_name: teacherName, subject_name: rowEl.dataset.subject || null,
        reason: 'substitute', note: `بديل عن ${rowEl.dataset.absent}`, created_by: currentUserId,
      }, { onConflict: 'change_date,grade_level,class_section,period_number' });
      if (!error) await refreshForDate();
    });
    rowEl.querySelector('.sub-relocate-toggle-btn').addEventListener('click', () => {
      rowEl.querySelector('.sub-relocate-panel').classList.toggle('hidden');
    });
    rowEl.querySelector('.sub-relocate-confirm-btn').addEventListener('click', async () => {
      const periodSel = rowEl.querySelector('.sub-relocate-period');
      const resolutionEl = rowEl.querySelector('.sub-relocate-resolution');
      const targetPeriod = Number(periodSel.value);
      if (!targetPeriod) { resolutionEl.innerHTML = '<p style="color:var(--danger); font-size:12px; margin:6px 0 0;">اختر الحصة الهدف</p>'; return; }
      await attemptSwapWithResolution(resolutionEl, rowEl.dataset.grade, Number(rowEl.dataset.section), Number(rowEl.dataset.period), targetPeriod, refreshForDate);
    });
  });
}

/* ---------- تبديل حصتين لنفس الفصل (أداة عامة، مو مرتبطة بغياب معيّن) ---------- */
document.getElementById('sub-swap-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('sub-swap-error');
  const successEl = document.getElementById('sub-swap-success');
  const resolutionEl = document.getElementById('sub-swap-resolution');
  errEl.style.display = 'none';
  successEl.style.display = 'none';
  if (resolutionEl) resolutionEl.innerHTML = '';

  const grade = document.getElementById('sub-swap-grade').value;
  const section = Number(document.getElementById('sub-swap-section').value);
  const pA = Number(document.getElementById('sub-swap-period-a').value);
  const pB = Number(document.getElementById('sub-swap-period-b').value);

  if (!grade || !section || !pA || !pB) { errEl.textContent = 'اختر الفصل والحصتين أولاً'; errEl.style.display = 'block'; return; }
  await attemptSwapWithResolution(resolutionEl, grade, section, pA, pB, async () => {
    successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display = 'none'; }, 3000);
    await refreshForDate();
  });
});

/* ---------- بدلاء اليوم (لكل الموظفين) ---------- */
function findSwapPartner(row) {
  if (row.reason !== 'swap') return null;
  const m = /تبديل مع الحصة (\d+)/.exec(row.note || '');
  if (!m) return null;
  const period = Number(m[1]);
  return changesCache.find(c => c.grade_level === row.grade_level && c.class_section === row.class_section && c.period_number === period && c.id !== row.id) || null;
}
// تصنيف الصف للتقرير: "أشغال" = معلم بديل مكان معلم غائب، "تبديل" = تبادل حصتين
function changeTypeLabel(reason) {
  return reason === 'swap' ? 'تبديل' : 'أشغال';
}

function renderTodayList() {
  const list = document.getElementById('sub-today-list');
  if (!dayKeyFromDate(subDate)) return; // renderNoSchoolDay already handled the message
  if (changesCache.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه تغييرات على الجدول بهذا التاريخ</p></div>';
    return;
  }
  const canManage = isAdminOrDeputy();
  const sorted = changesCache.slice().sort((a, b) => a.period_number - b.period_number);
  list.innerHTML = `<div style="overflow-x:auto;">
    <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
      <thead><tr style="background:var(--sand);">
        <th style="padding:7px 8px; text-align:right;">الحصة</th>
        <th style="padding:7px 8px; text-align:right;">الفصل</th>
        <th style="padding:7px 8px; text-align:right;">المادة</th>
        <th style="padding:7px 8px; text-align:right;">المعلم الحالي</th>
        <th style="padding:7px 8px; text-align:right;">النوع</th>
        <th style="padding:7px 8px; text-align:right;">ملاحظة</th>
        ${canManage ? '<th></th>' : ''}
      </tr></thead>
      <tbody>${sorted.map(c => `
        <tr style="border-bottom:1px solid #ECEAE1;">
          <td style="padding:7px 8px; text-align:center;">${c.period_number}</td>
          <td style="padding:7px 8px;">${esc(classLabel(c.grade_level, c.class_section))}</td>
          <td style="padding:7px 8px;">${esc(c.subject_name || '-')}</td>
          <td style="padding:7px 8px; font-weight:700;">${esc(c.teacher_name)}</td>
          <td style="padding:7px 8px;"><span style="background:${c.reason === 'swap' ? '#EAF4FB' : '#FDF3E3'}; color:${c.reason === 'swap' ? '#2C6E9B' : '#9A6B1E'}; border-radius:6px; padding:2px 8px; font-size:11.5px; font-weight:700;">${changeTypeLabel(c.reason)}</span></td>
          <td style="padding:7px 8px; color:var(--slate);">${esc(c.note || '-')}</td>
          ${canManage ? `<td style="padding:7px 8px; text-align:center;"><button type="button" class="sub-cancel-change-btn" data-id="${c.id}" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:12px;">إلغاء</button></td>` : ''}
        </tr>`).join('')}</tbody>
    </table>
  </div>`;

  if (canManage) {
    list.querySelectorAll('.sub-cancel-change-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = changesCache.find(c => c.id === btn.dataset.id);
        if (!row) return;
        const partner = findSwapPartner(row);
        await sb.from('daily_schedule_changes').delete().eq('id', row.id);
        if (partner) await sb.from('daily_schedule_changes').delete().eq('id', partner.id);
        await refreshForDate();
      });
    });
  }
}

/* ---------- طباعة تقرير بدلاء اليوم ---------- */
document.getElementById('sub-print-btn').addEventListener('click', () => {
  if (changesCache.length === 0) { alert('ما فيه تغييرات على الجدول بهذا التاريخ لطباعتها'); return; }
  const sorted = changesCache.slice().sort((a, b) => a.period_number - b.period_number);
  const rowsHtml = sorted.map(c => `
    <tr>
      <td>${c.period_number}</td>
      <td>${esc(classLabel(c.grade_level, c.class_section))}</td>
      <td>${esc(c.subject_name || '-')}</td>
      <td>${esc(c.teacher_name)}</td>
      <td class="type-${c.reason === 'swap' ? 'swap' : 'sub'}">${changeTypeLabel(c.reason)}</td>
      <td>${esc(c.note || '-')}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير بدلاء اليوم - ${esc(subDate)}</title>
<style>
  body { font-family: Tahoma, Arial, sans-serif; padding: 24px; color: #222; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .sub-date { color: #555; font-size: 13px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: right; }
  th { background: #EFEAE0; }
  td.type-sub { color: #9A6B1E; font-weight: 700; }
  td.type-swap { color: #2C6E9B; font-weight: 700; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>تقرير بدلاء اليوم</h1>
  <div class="sub-date">التاريخ: ${esc(subDate)}</div>
  <table>
    <thead><tr><th>الحصة</th><th>الفصل</th><th>المادة</th><th>المعلم الحالي</th><th>النوع</th><th>ملاحظة</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('المتصفح منع فتح نافذة الطباعة - يرجى السماح بالنوافذ المنبثقة'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
});
