import { sb, currentUserId, currentProfile, roleLabels, isAdminOrDeputy, backToTiles, setupCollapsible, currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';
import { loadXLSX } from './lib-loader.js';

// كل قراءة محصورة بمدرسة المستخدم (مع رجوع بدون الفلتر لو الجدول ما فيه school_id)
function R(build, single = false) {
  return readScopedBySchool(scoped => {
    let q = build();
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return single ? q.maybeSingle() : q;
  });
}
// إضافة سجلات مع مدرسة المستخدم
function W(table, rows, selectCols) {
  return writeWithSchool(extra => {
    const payload = Array.isArray(rows) ? rows.map(r => ({ ...r, ...extra })) : { ...rows, ...extra };
    const q = sb.from(table).insert(payload);
    return selectCols ? q.select(selectCols) : q;
  });
}

const dayLabels = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

let dutyTypesCache = [];
let teachersCache = [];

function todayInfo() {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sunday ... 6=Saturday
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
  const dayKey = jsDay <= 4 ? dayKeys[jsDay] : null; // null لو جمعة/سبت (عطلة)
  const dateStr = localIso(now); // التاريخ المحلي (toISOString يرجّع تاريخ أمس قبل الساعة 3 الفجر بتوقيت السعودية)
  return { dayKey, dateStr, jsDay };
}

function localIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function thisWeekSunday() {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return localIso(sunday);
}

function formatDays(days) {
  const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
  if (sorted.length === 5 && dayOrder.every(d => sorted.includes(d))) return 'طوال الأسبوع';
  return sorted.map(d => dayLabels[d]).join('، ');
}

setupCollapsible('dt-toggle', 'dt-body', 'dt-chevron');
setupCollapsible('duty-import-toggle', 'duty-import-body', 'duty-import-chevron');
setupCollapsible('fixed-toggle', 'fixed-body', 'fixed-chevron');
setupCollapsible('weekly-toggle', 'weekly-body', 'weekly-chevron');

function dutyTypeLabel(t) { return t.location ? `${t.name} — ${t.location}` : t.name; }
function normalizeArText(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

export async function loadDutyRosterModule() {
  if (!isAdminOrDeputy()) {
    document.getElementById('duty-admin-view').classList.add('hidden');
    document.getElementById('duty-teacher-view').classList.remove('hidden');
    await loadMyDutyView();
    return;
  }
  document.getElementById('duty-teacher-view').classList.add('hidden');
  document.getElementById('duty-admin-view').classList.remove('hidden');

  const [{ data: types }, { data: teachers }] = await Promise.all([
    R(() => sb.from('duty_types').select('id, name, location').order('name').order('location')),
    R(() => sb.from('profiles').select('id, full_name').eq('role', 'teacher')),
  ]);
  dutyTypesCache = (types || []).map(t => ({ ...t, displayLabel: dutyTypeLabel(t) }));
  teachersCache = teachers || [];

  populateSelect('fixed-teacher', teachersCache, 'full_name');
  populateSelect('weekly-teacher', teachersCache, 'full_name');

  document.getElementById('week-sunday-label').textContent = thisWeekSunday();

  const { dayKey } = todayInfo();
  document.getElementById('today-date-label').textContent = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }) + (dayKey ? '' : ' · إجازة نهاية الأسبوع');
  const sun = new Date(thisWeekSunday() + 'T00:00:00'); const thu = new Date(sun); thu.setDate(sun.getDate() + 4);
  const f = d => d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' });
  document.getElementById('duty-week-range').textContent = `من الأحد ${f(sun)} إلى الخميس ${f(thu)}`;

  await refreshDutyTypesList();
  await Promise.all([refreshFixedList(), refreshWeeklyList()]);
  await Promise.all([refreshTodayAttendance(), renderWeekGrid()]);
}

/* ---------- إعداد المناوبات (مخفي افتراضيًا) ---------- */
document.getElementById('duty-setup-toggle').addEventListener('click', () => {
  const box = document.getElementById('duty-setup');
  const open = box.classList.toggle('hidden') === false;
  document.getElementById('duty-setup-toggle').textContent = open ? 'إخفاء الإعداد' : 'إعداد المناوبات';
});
document.querySelectorAll('#duty-setup-tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#duty-setup-tabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('#duty-setup .duty-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.pane));
}));

/* ---------- جدول الأسبوع: أنواع المناوبات × الأيام ---------- */
async function renderWeekGrid() {
  const box = document.getElementById('duty-week-grid');
  if (!box) return;
  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    R(() => sb.from('duty_roster').select('teacher_profile_id, duty_type_id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)').eq('kind', 'fixed')),
    R(() => sb.from('duty_roster').select('teacher_profile_id, duty_type_id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)').eq('kind', 'weekly').eq('week_start_date', thisWeekSunday())),
  ]);
  const rows = [...(fixed || []).map(r => ({ ...r, kind: 'fixed' })), ...(weekly || []).map(r => ({ ...r, kind: 'weekly' }))];
  const types = new Map(dutyTypesCache.map(t => [t.id, { label: t.displayLabel, name: t.name, cells: {} }]));
  rows.forEach(r => {
    if (!types.has(r.duty_type_id)) types.set(r.duty_type_id, { label: r.duty_types ? dutyTypeLabel(r.duty_types) : '-', name: r.duty_types ? r.duty_types.name : '', cells: {} });
    const t = types.get(r.duty_type_id);
    (t.cells[r.day_of_week] = t.cells[r.day_of_week] || []).push(r);
  });
  const list = [...types.values()].filter(t => Object.keys(t.cells).length);
  if (!list.length) { box.innerHTML = '<div class="ex-empty"><b>ما فيه مناوبات مسجّلة</b><span>اضغط «إعداد المناوبات» وأضف الأنواع والمناوبين، أو استوردهم من إكسل.</span></div>'; return; }
  const { dayKey } = todayInfo();
  const firstName = n => String(n || '-').trim().split(/\s+/).slice(0, 2).join(' ');
  box.innerHTML = `<div class="dw-scroll"><table class="dw-table">
    <thead><tr><th>المناوبة</th>${dayOrder.map(d => `<th class="${d === dayKey ? 'today' : ''}">${dayLabels[d]}${d === dayKey ? ' <span>اليوم</span>' : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.map(t => {
      const cat = dutyCategory(t.name);
      return `<tr><th><span class="dw-type"><span class="ic-diamond ${DUTY_COLORS[cat]}">${DUTY_ICONS[cat]}</span>${esc(t.label)}</span></th>${dayOrder.map(d => `<td class="${d === dayKey ? 'today' : ''}">${(t.cells[d] || []).map(r => `<span class="dw-name ${r.kind}" title="${r.kind === 'weekly' ? 'متغيّر لهذا الأسبوع' : 'ثابت'}">${esc(firstName(r.profiles ? r.profiles.full_name : '-'))}</span>`).join('') || '<span class="dw-empty">—</span>'}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>
    <div class="dw-legend"><span class="dw-name fixed">ثابت</span><span class="dw-name weekly">متغيّر لهذا الأسبوع</span></div>`;
}

/* ---------- عرض المعلم لمناوباته الخاصة (للقراءة فقط) — بطاقات بأيقونات حسب نوع المناوبة ---------- */
const DUTY_ICONS = {
  morning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2v4"/><path d="M4.9 8.9l1.4 1.4"/><path d="M2 17h2"/><path d="M20 17h2"/><path d="M17.7 10.3l1.4-1.4"/><path d="M6 17a6 6 0 0 1 12 0"/><path d="M2 21h20"/></svg>',
  recess: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5"/></svg>',
  prayer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.2 3.2h-4.4L12 2z"/><path d="M5 21v-6.5A7 7 0 0 1 19 14.5V21"/><path d="M3 21h18"/><path d="M9.5 21v-4a2.5 2.5 0 0 1 5 0v4"/></svg>',
  bus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="11" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="18.5" r="1.6"/><circle cx="16.5" cy="18.5" r="1.6"/><path d="M6 8h3M6 13.5h.01M18 13.5h.01"/></svg>',
  corners: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7.5" height="7.5" rx="1.2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2"/></svg>',
  default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
function dutyCategory(name) {
  const n = String(name || '');
  if (n.includes('صباح')) return 'morning';
  if (n.includes('فسحة')) return 'recess';
  if (n.includes('مصلى') || n.includes('صلاة')) return 'prayer';
  if (n.includes('حافلات') || n.includes('باص')) return 'bus';
  if (n.includes('أركان') || n.includes('اركان')) return 'corners';
  return 'default';
}
const DUTY_COLORS = { morning: 'diamond-gold', recess: 'diamond-teal', prayer: 'diamond-navy', bus: 'diamond-purple', corners: 'diamond-green', default: 'diamond-navy' };

function renderMyDutyGroup(containerId, rows, emptyMsg) {
  const list = document.getElementById(containerId);
  list.innerHTML = '';
  if (!rows || rows.length === 0) {
    list.innerHTML = `<div class="placeholder" style="padding:20px;"><p>${emptyMsg}</p></div>`;
    return;
  }
  // تجميع حسب نوع المناوبة عشان تظهر أيامها مع بعض
  const byType = new Map();
  rows.forEach(r => {
    const key = r.duty_type_id;
    if (!byType.has(key)) byType.set(key, { name: r.duty_types ? r.duty_types.name : '', location: r.duty_types ? r.duty_types.location : '', days: [] });
    byType.get(key).days.push(r.day_of_week);
  });

  const grid = document.createElement('div');
  grid.className = 'duty-card-grid';
  byType.forEach(g => {
    const cat = dutyCategory(g.name);
    const card = document.createElement('div');
    card.className = 'duty-card';
    card.innerHTML = `
      <div class="ic-diamond ${DUTY_COLORS[cat]}">${DUTY_ICONS[cat]}</div>
      <div class="name">${g.name}</div>
      ${g.location ? `<div class="loc">${g.location}</div>` : ''}
      <div class="days">${[...g.days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)).map(d => `<span class="day-chip">${dayLabels[d]}</span>`).join('')}</div>`;
    grid.appendChild(card);
  });
  list.appendChild(grid);
}

async function loadMyDutyView() {
  document.getElementById('my-duty-week-label').textContent = thisWeekSunday();
  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    R(() => sb.from('duty_roster').select('duty_type_id, day_of_week, duty_types(name, location)').eq('kind', 'fixed').eq('teacher_profile_id', currentUserId)),
    R(() => sb.from('duty_roster').select('duty_type_id, day_of_week, duty_types(name, location)').eq('kind', 'weekly').eq('week_start_date', thisWeekSunday()).eq('teacher_profile_id', currentUserId)),
  ]);
  renderMyDutyGroup('my-duty-fixed-list', fixed, 'لا توجد لديك مناوبات ثابتة حاليًا');
  renderMyDutyGroup('my-duty-weekly-list', weekly, 'لا توجد لديك مناوبات مسندة لهذا الأسبوع');
}

function populateSelect(id, items, labelKey) {
  populateSelectEl(document.getElementById(id), items, labelKey);
}

function populateSelectEl(sel, items, labelKey) {
  sel.innerHTML = '';
  if (items.length === 0) {
    sel.innerHTML = '<option value="">لا توجد بيانات بعد</option>';
    return;
  }
  items.forEach(item => {
    const o = document.createElement('option');
    o.value = item.id;
    o.textContent = item[labelKey];
    sel.appendChild(o);
  });
}

/* ---------- أنواع المناوبة ---------- */
document.getElementById('dt-name-select').addEventListener('change', (e) => {
  const otherInput = document.getElementById('dt-name-other');
  otherInput.style.display = e.target.value === '__other__' ? '' : 'none';
});

document.getElementById('dt-add').addEventListener('click', async () => {
  const sel = document.getElementById('dt-name-select').value;
  const name = sel === '__other__' ? document.getElementById('dt-name-other').value.trim() : sel;
  const location = document.getElementById('dt-location').value.trim();
  if (!name) { alert('اختر المناوبة الرئيسية (أو اكتب اسمها لو "نوع آخر")'); return; }
  const { error } = await W('duty_types', { name, location: location || null });
  if (error) { alert('تعذر الإضافة: ' + error.message); return; }
  document.getElementById('dt-name-select').value = '';
  document.getElementById('dt-name-other').value = '';
  document.getElementById('dt-name-other').style.display = 'none';
  document.getElementById('dt-location').value = '';
  await loadDutyRosterModule();
});

async function refreshDutyTypesList() {
  const list = document.getElementById('dt-list');
  list.innerHTML = '';

  // تجميع الأنواع حسب المناوبة الرئيسية (name) عشان تظهر مواقعها الفرعية مع بعض تحت عنوان واحد
  const byMain = new Map();
  dutyTypesCache.forEach(t => {
    if (!byMain.has(t.name)) byMain.set(t.name, []);
    byMain.get(t.name).push(t);
  });

  byMain.forEach((items, mainName) => {
    const group = document.createElement('div');
    group.style.cssText = 'margin-bottom:12px;';
    group.innerHTML = `<div style="font-size:13px; font-weight:700; color:var(--navy); margin-bottom:6px;">${mainName}</div>
      <div class="dt-chips" style="display:flex; flex-wrap:wrap; gap:8px;"></div>`;
    const chipsWrap = group.querySelector('.dt-chips');

    items.forEach(t => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex; align-items:center; gap:8px; background:var(--sand); border:1px solid #ECEAE1; border-radius:20px; padding:6px 8px 6px 14px;';
      chip.innerHTML = `
        <span style="font-size:13.5px; font-weight:500;">${t.location || mainName}</span>
        <button data-id="${t.id}" style="width:auto; padding:5px !important; background:transparent; color:var(--danger); display:flex; align-items:center; justify-content:center; border-radius:50%;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
        </button>`;
      chip.querySelector('button').addEventListener('click', async () => {
        await sb.from('duty_types').delete().eq('id', t.id);
        await loadDutyRosterModule();
      });
      chipsWrap.appendChild(chip);
    });

    list.appendChild(group);
  });
}

/* ---------- استيراد المناوبات من ملف إكسل ---------- */
const IMPORT_DAY_COLS = [
  { key: 'sunday', label: 'الأحد' },
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
];

document.getElementById('duty-template-btn').addEventListener('click', async () => {
  await loadXLSX();
  const header = ['اسم الموظف', 'المناوبة الرئيسية', 'التفصيل (الموقع أو الحصة)', 'نوع الجدولة (ثابت / متغيّر)', ...IMPORT_DAY_COLS.map(d => d.label)];
  const sample1 = ['مثال: اسم المعلم هنا', 'مناوبة الصباح', 'حافلات', 'ثابت', '✓', '✓', '✓', '✓', '✓'];
  const sample2 = ['مثال: اسم المعلم هنا', 'مناوبة الفسحة', 'نقطة بيع', 'متغيّر', '✓', '', '✓', '', ''];
  const rows = [header, sample1, sample2];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 20 }, { wch: 26 }, { wch: 22 }, ...IMPORT_DAY_COLS.map(() => ({ wch: 8 }))];

  const notesRows = [
    ['ملاحظات:'],
    ['- اسم الموظف لازم يطابق اسم حسابه المسجل بالنظام بالضبط.'],
    ['- المناوبة الرئيسية: مناوبة الصباح / مناوبة الفسحة / مناوبة المصلى / مناوبة الحافلات / مناوبة الأركان — أو أي اسم آخر، بينشئه النظام تلقائيًا لو غير موجود.'],
    ['- التفصيل اختياري (موقع أو حصة)، اتركه فاضي لو ما ينطبق.'],
    ['- نوع الجدولة: اكتب "ثابت" لو تتكرر كل أسبوع تلقائيًا، أو "متغيّر" لو خاصة بأسبوع هذا الأسبوع بس.'],
    ['- حط أي علامة (✓ أو نعم أو 1) بعمود اليوم اللي فيه المناوبة، واتركه فاضي لو ما ينطبق.'],
    ['- كل صف = موظف واحد + مناوبة واحدة. لو نفس الموظف له أكثر من مناوبة، كرر اسمه بصف جديد.'],
    ['- احذف صفوف الأمثلة قبل الرفع.'],
  ];
  const notesWs = XLSX.utils.aoa_to_sheet(notesRows);
  notesWs['!cols'] = [{ wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المناوبات');
  XLSX.utils.book_append_sheet(wb, notesWs, 'تعليمات');
  XLSX.writeFile(wb, 'نموذج_استيراد_المناوبات.xlsx');
});

function isTruthyCell(v) {
  const s = normalizeArText(v).toLowerCase();
  return s !== '' && s !== '0' && s !== 'لا' && s !== 'no' && s !== 'false';
}

document.getElementById('duty-import-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('duty-import-file');
  const errEl = document.getElementById('duty-import-error');
  const summaryEl = document.getElementById('duty-import-summary');
  errEl.style.display = 'none';
  summaryEl.innerHTML = '';
  const file = fileInput.files[0];
  if (!file) { errEl.textContent = 'اختر ملف إكسل أولاً'; errEl.style.display = 'block'; return; }

  await loadXLSX();
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheetName = wb.SheetNames.find(n => n !== 'تعليمات') || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

      let headerIdx = -1, colIdx = {};
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const idx = row.findIndex(c => String(c).includes('اسم') && (String(c).includes('موظف') || String(c).includes('معلم')));
        if (idx !== -1) {
          headerIdx = i;
          row.forEach((cell, ci) => {
            const c = String(cell).trim();
            if (!c) return;
            if (c.includes('اسم')) colIdx.name = ci;
            else if (c.includes('رئيسي')) colIdx.mainType = ci;
            else if (c.includes('تفصيل') || c.includes('موقع')) colIdx.location = ci;
            else if (c.includes('جدولة') || c.includes('ثابت') || c.includes('متغي')) colIdx.kind = ci;
            else {
              const dayCol = IMPORT_DAY_COLS.find(d => c.includes(d.label));
              if (dayCol) colIdx[dayCol.key] = ci;
            }
          });
          break;
        }
      }
      if (headerIdx === -1 || colIdx.mainType === undefined) {
        errEl.textContent = 'ما لقيت أعمدة الملف المتوقعة، حمّل النموذج وتأكد من عدم تغيير أسماء الأعمدة';
        errEl.style.display = 'block';
        return;
      }

      const teacherByName = new Map(teachersCache.map(t => [normalizeArText(t.full_name), t]));
      const newTypeKey = (name, location) => normalizeArText(name) + '|' + normalizeArText(location);
      const typeByKey = new Map(dutyTypesCache.map(t => [newTypeKey(t.name, t.location), t]));
      const typesToCreate = new Map(); // key -> {name, location}
      const parsedRows = [];
      const skipped = [];

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const nameRaw = row[colIdx.name];
        const mainTypeRaw = row[colIdx.mainType];
        if (!normalizeArText(nameRaw) && !normalizeArText(mainTypeRaw)) continue; // صف فاضي

        const teacherName = normalizeArText(nameRaw);
        const teacher = teacherByName.get(teacherName);
        if (!teacher) { skipped.push(`الصف ${i + 1}: اسم الموظف "${teacherName}" غير مطابق لأي حساب معلم`); continue; }

        const mainType = normalizeArText(mainTypeRaw);
        if (!mainType) { skipped.push(`الصف ${i + 1}: المناوبة الرئيسية فاضية`); continue; }
        const location = colIdx.location !== undefined ? normalizeArText(row[colIdx.location]) : '';

        const kindRaw = colIdx.kind !== undefined ? normalizeArText(row[colIdx.kind]) : '';
        let kind = null;
        if (kindRaw.includes('ثابت')) kind = 'fixed';
        else if (kindRaw.includes('متغي') || kindRaw.includes('أسبوع')) kind = 'weekly';
        if (!kind) { skipped.push(`الصف ${i + 1}: نوع الجدولة غير مفهوم ("${kindRaw}") — اكتب "ثابت" أو "متغيّر"`); continue; }

        const days = IMPORT_DAY_COLS.filter(d => colIdx[d.key] !== undefined && isTruthyCell(row[colIdx[d.key]])).map(d => d.key);
        if (days.length === 0) { skipped.push(`الصف ${i + 1}: ما فيه أي يوم محدد`); continue; }

        const key = newTypeKey(mainType, location);
        if (!typeByKey.has(key) && !typesToCreate.has(key)) typesToCreate.set(key, { name: mainType, location: location || null });

        parsedRows.push({ teacherId: teacher.id, typeKey: key, kind, days });
      }

      if (parsedRows.length === 0) {
        errEl.style.whiteSpace = 'pre-line';
        errEl.textContent = 'ما لقيت أي صف صالح للاستيراد. الأسباب:\n' + skipped.slice(0, 10).join('\n');
        errEl.style.display = 'block';
        return;
      }

      // إنشاء أنواع المناوبات الناقصة أولاً
      if (typesToCreate.size > 0) {
        const { data: createdTypes, error: typesErr } = await W('duty_types', Array.from(typesToCreate.values()), 'id, name, location');
        if (typesErr) { errEl.textContent = 'تعذر إنشاء أنواع المناوبات الجديدة: ' + typesErr.message; errEl.style.display = 'block'; return; }
        (createdTypes || []).forEach(t => typeByKey.set(newTypeKey(t.name, t.location), t));
      }

      const dutyRosterPayload = [];
      parsedRows.forEach(r => {
        const type = typeByKey.get(r.typeKey);
        if (!type) return;
        r.days.forEach(d => dutyRosterPayload.push({
          teacher_profile_id: r.teacherId, duty_type_id: type.id, kind: r.kind, day_of_week: d, created_by: currentUserId,
          week_start_date: r.kind === 'weekly' ? thisWeekSunday() : null,
        }));
      });

      const { error: insertErr } = await W('duty_roster', dutyRosterPayload);
      if (insertErr) { errEl.textContent = 'تعذر استيراد المناوبات: ' + insertErr.message; errEl.style.display = 'block'; return; }

      summaryEl.innerHTML = `
        <div style="color:var(--meadow); font-weight:700;">تم استيراد ${dutyRosterPayload.length} تعيين مناوبة (${parsedRows.length} صف) بنجاح${typesToCreate.size ? `، وأُنشئ ${typesToCreate.size} نوع مناوبة جديد` : ''}.</div>
        ${skipped.length ? `<div style="color:var(--danger); margin-top:6px;">تم تجاهل ${skipped.length} صف:<br>${skipped.slice(0, 15).map(s => esc(s)).join('<br>')}</div>` : ''}
      `;
      fileInput.value = '';
      await loadDutyRosterModule();
    } catch (err) {
      errEl.textContent = 'تعذرت قراءة الملف: ' + err.message;
      errEl.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
});

/* ---------- أداة مشتركة: تجميع الصفوف حسب المعلم + نوع المناوبة ---------- */
function groupByTeacherAndType(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const key = r.teacher_profile_id + '_' + r.duty_type_id;
    if (!groups.has(key)) {
      groups.set(key, {
        teacherId: r.teacher_profile_id,
        dutyTypeId: r.duty_type_id,
        teacherName: r.profiles ? r.profiles.full_name : '-',
        dutyTypeName: r.duty_types ? dutyTypeLabel(r.duty_types) : '',
        days: [],
        rowIds: {}, // day_of_week -> row id (للحذف الدقيق)
      });
    }
    const g = groups.get(key);
    g.days.push(r.day_of_week);
    g.rowIds[r.day_of_week] = r.id;
  });
  return Array.from(groups.values());
}

function renderGroupedList(containerId, groups, kind, onChanged) {
  const list = document.getElementById(containerId);
  list.innerHTML = '';
  if (groups.length === 0) {
    list.innerHTML = `<div class="placeholder" style="padding:20px;"><p>${kind === 'fixed' ? 'لا يوجد مناوبون ثابتون بعد' : 'ما فيه مناوبون متغيرون مضافون لهذا الأسبوع بعد'}</p></div>`;
    return;
  }

  groups.forEach(g => {
    const initials = (g.teacherName || '؟').trim().split(' ').slice(0, 2).map(w => w.charAt(0)).join('');
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.style.flexWrap = 'wrap';
    row.innerHTML = `
      <div class="avatar-circle">${initials}</div>
      <div class="info"><div class="name">${g.teacherName}</div>
      <div class="title">${g.dutyTypeName} · ${formatDays(g.days)}</div></div>
      <button class="edit-btn text-action-btn">تحرير</button>
      <div class="edit-panel hidden" style="width:100%; margin-top:12px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;"></div>`;

    const editBtn = row.querySelector('.edit-btn');
    const panel = row.querySelector('.edit-panel');

    editBtn.addEventListener('click', () => {
      const isHidden = panel.classList.contains('hidden');
      if (isHidden) {
        panel.innerHTML = dayOrder.map(d => `
          <label style="display:flex; align-items:center; gap:5px; font-size:13px;">
            <input type="checkbox" class="day-check" value="${d}" ${g.days.includes(d) ? 'checked' : ''} style="width:auto;" />
            ${dayLabels[d]}
          </label>`).join('') + `<button class="save-days-btn" style="width:auto; background:var(--meadow); color:#fff;">حفظ</button>`;

        panel.querySelector('.save-days-btn').addEventListener('click', async () => {
          const checked = Array.from(panel.querySelectorAll('.day-check:checked')).map(c => c.value);
          await applyDaysChange(g, checked, kind);
          await onChanged();
        });
      }
      panel.classList.toggle('hidden');
    });

    list.appendChild(row);
  });
}

async function applyDaysChange(group, newDays, kind) {
  const toAdd = newDays.filter(d => !group.days.includes(d));
  const toRemove = group.days.filter(d => !newDays.includes(d));

  if (toRemove.length > 0) {
    const idsToDelete = toRemove.map(d => group.rowIds[d]).filter(Boolean);
    if (idsToDelete.length > 0) await sb.from('duty_roster').delete().in('id', idsToDelete);
  }
  if (toAdd.length > 0) {
    const rows = toAdd.map(d => ({
      teacher_profile_id: group.teacherId, duty_type_id: group.dutyTypeId, kind,
      day_of_week: d, created_by: currentUserId,
      week_start_date: kind === 'weekly' ? thisWeekSunday() : null,
    }));
    await W('duty_roster', rows);
  }
}

/* ---------- أداة مشتركة: صف "نوع مناوبة + أيامه" يُضاف بعدد حر لكل موظف قبل الحفظ ---------- */
function createDayCheckboxes() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-top:8px;';
  const days = [['sunday', 'الأحد'], ['monday', 'الاثنين'], ['tuesday', 'الثلاثاء'], ['wednesday', 'الأربعاء'], ['thursday', 'الخميس']];
  wrap.innerHTML = `
    <label style="display:flex; align-items:center; gap:5px; font-size:12.5px; font-weight:700;">
      <input type="checkbox" class="row-day-all" style="width:auto;" /> كل الأيام
    </label>
    ${days.map(([v, l]) => `<label style="display:flex; align-items:center; gap:5px; font-size:12.5px;">
      <input type="checkbox" class="row-day-check" value="${v}" style="width:auto;" /> ${l}
    </label>`).join('')}
  `;
  const allBox = wrap.querySelector('.row-day-all');
  const dayBoxes = () => Array.from(wrap.querySelectorAll('.row-day-check'));
  allBox.addEventListener('change', () => dayBoxes().forEach(b => { b.checked = allBox.checked; }));
  dayBoxes().forEach(b => b.addEventListener('change', () => { allBox.checked = dayBoxes().every(x => x.checked); }));
  return { wrap, getChecked: () => dayBoxes().filter(b => b.checked).map(b => b.value) };
}

function createDutyRow() {
  const row = document.createElement('div');
  row.className = 'duty-add-row';
  row.style.cssText = 'padding:12px; background:var(--sand); border:1px solid #ECEAE1; border-radius:12px;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px;';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'row-duty-type';
  typeSelect.style.flex = '1';
  populateSelectEl(typeSelect, dutyTypesCache, 'displayLabel');

  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'حذف المناوبة';
  removeBtn.style.cssText = 'width:auto; padding:6px 12px; background:transparent; color:var(--danger); flex-shrink:0;';
  removeBtn.addEventListener('click', () => row.remove());

  header.appendChild(typeSelect);
  header.appendChild(removeBtn);

  const { wrap: dayWrap, getChecked } = createDayCheckboxes();

  row.appendChild(header);
  row.appendChild(dayWrap);
  row._getData = () => ({ dutyTypeId: typeSelect.value, days: getChecked() });
  return row;
}

function wireDutyRowsSection(prefix, kind) {
  const teacherSel = document.getElementById(prefix + '-teacher');
  const rowsWrap = document.getElementById(prefix + '-rows');
  const addRowBtn = document.getElementById(prefix + '-add-row');
  const saveBtn = document.getElementById(prefix + '-add');
  const errEl = document.getElementById(prefix + '-error');

  addRowBtn.addEventListener('click', () => {
    if (dutyTypesCache.length === 0) { alert('أضف نوع مناوبة أولاً من الأعلى'); return; }
    rowsWrap.appendChild(createDutyRow());
  });

  saveBtn.addEventListener('click', async () => {
    errEl.style.display = 'none';
    const teacherId = teacherSel.value;
    if (!teacherId) { errEl.textContent = 'اختر الموظف أولاً'; errEl.style.display = 'block'; return; }

    const rowEls = Array.from(rowsWrap.querySelectorAll('.duty-add-row'));
    if (rowEls.length === 0) { errEl.textContent = 'أضف مناوبة واحدة على الأقل لهذا الموظف'; errEl.style.display = 'block'; return; }

    const payload = [];
    for (const rowEl of rowEls) {
      const { dutyTypeId, days } = rowEl._getData();
      if (!dutyTypeId) { errEl.textContent = 'اختر نوع المناوبة لكل صف مضاف'; errEl.style.display = 'block'; return; }
      if (days.length === 0) { errEl.textContent = 'اختر يوم واحد على الأقل (أو "كل الأيام") لكل صف مضاف'; errEl.style.display = 'block'; return; }
      days.forEach(d => payload.push({
        teacher_profile_id: teacherId, duty_type_id: dutyTypeId, kind, day_of_week: d, created_by: currentUserId,
        week_start_date: kind === 'weekly' ? thisWeekSunday() : null,
      }));
    }

    const { error } = await W('duty_roster', payload);
    if (error) { errEl.textContent = 'تعذر الإضافة: ' + error.message; errEl.style.display = 'block'; return; }

    rowsWrap.innerHTML = '';
    if (prefix === 'fixed') { await refreshFixedList(); } else { await refreshWeeklyList(); }
    await refreshTodayAttendance();
    renderWeekGrid();
  });
}

wireDutyRowsSection('fixed', 'fixed');
wireDutyRowsSection('weekly', 'weekly');

async function refreshFixedList() {
  const { data } = await R(() => sb.from('duty_roster')
    .select('id, teacher_profile_id, duty_type_id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)')
    .eq('kind', 'fixed'));
  const groups = groupByTeacherAndType(data || []);
  renderGroupedList('fixed-list', groups, 'fixed', async () => { await refreshFixedList(); await refreshTodayAttendance(); renderWeekGrid(); });
}

/* ---------- المناوبون المتغيرون (هذا الأسبوع) ---------- */
async function refreshWeeklyList() {
  const { data } = await R(() => sb.from('duty_roster')
    .select('id, teacher_profile_id, duty_type_id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)')
    .eq('kind', 'weekly').eq('week_start_date', thisWeekSunday()));
  const groups = groupByTeacherAndType(data || []);
  renderGroupedList('weekly-list', groups, 'weekly', async () => { await refreshWeeklyList(); await refreshTodayAttendance(); renderWeekGrid(); });
}

/* ---------- تسجيل حضور اليوم ---------- */
async function getTodayDutyEntries() {
  const { dayKey } = todayInfo();
  if (!dayKey) return [];

  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    R(() => sb.from('duty_roster').select('teacher_profile_id, duty_type_id, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)').eq('kind', 'fixed').eq('day_of_week', dayKey)),
    R(() => sb.from('duty_roster').select('teacher_profile_id, duty_type_id, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday())),
  ]);
  return [...(fixed || []), ...(weekly || [])];
}

let todayEntriesCache = [];
let todayAttendanceMap = new Map();
async function refreshTodayAttendance() {
  const container = document.getElementById('today-duty-list');
  const stats = document.getElementById('duty-stats');
  const markAll = document.getElementById('duty-mark-all');
  container.innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';

  const { dayKey, dateStr } = todayInfo();
  if (!dayKey) {
    stats.innerHTML = ''; markAll.classList.add('hidden');
    container.innerHTML = '<div class="ex-empty"><b>اليوم إجازة نهاية الأسبوع</b><span>ما فيه مناوبات.</span></div>';
    return;
  }
  const entries = await getTodayDutyEntries();
  todayEntriesCache = entries;
  if (entries.length === 0) {
    stats.innerHTML = ''; markAll.classList.add('hidden');
    container.innerHTML = '<div class="ex-empty"><b>ما فيه مناوبين مسجلين لليوم</b><span>أضفهم من «إعداد المناوبات».</span></div>';
    return;
  }
  const { data: existingAttendance } = await R(() => sb.from('duty_attendance').select('teacher_profile_id, duty_type_id, status, late_minutes').eq('duty_date', dateStr));
  todayAttendanceMap = new Map((existingAttendance || []).map(a => [a.teacher_profile_id + '_' + a.duty_type_id, a]));
  renderTodayRows();
}

function renderTodayRows() {
  const container = document.getElementById('today-duty-list');
  const stats = document.getElementById('duty-stats');
  const { dateStr } = todayInfo();
  const entries = [...todayEntriesCache].sort((x, y) => String(x.duty_types ? dutyTypeLabel(x.duty_types) : '').localeCompare(String(y.duty_types ? dutyTypeLabel(y.duty_types) : ''), 'ar'));
  const count = { present: 0, late: 0, absent: 0, none: 0 };
  entries.forEach(e => { const a = todayAttendanceMap.get(e.teacher_profile_id + '_' + e.duty_type_id); count[a ? a.status : 'none']++; });
  stats.innerHTML = `
    <span class="ds ds-all"><b>${entries.length}</b> مناوب اليوم</span>
    <span class="ds ds-present"><b>${count.present}</b> حاضر</span>
    <span class="ds ds-late"><b>${count.late}</b> متأخر</span>
    <span class="ds ds-absent"><b>${count.absent}</b> غائب</span>
    <span class="ds ds-none"><b>${count.none}</b> بدون تسجيل</span>`;
  document.getElementById('duty-mark-all').classList.toggle('hidden', count.none === 0);

  container.innerHTML = entries.map((e, i) => {
    const a = todayAttendanceMap.get(e.teacher_profile_id + '_' + e.duty_type_id);
    const st = a ? a.status : '';
    const name = e.profiles ? e.profiles.full_name : '-';
    const cat = dutyCategory(e.duty_types ? e.duty_types.name : '');
    return `<div class="duty-row st-${st || 'none'}" data-i="${i}">
      <span class="ic-diamond ${DUTY_COLORS[cat]} dr-ic">${DUTY_ICONS[cat]}</span>
      <span class="dr-main"><b>${esc(name)}</b><span>${esc(e.duty_types ? dutyTypeLabel(e.duty_types) : '')}</span></span>
      <span class="dr-late hidden"><input type="number" min="1" class="dr-late-min" placeholder="دقائق" value="${a && a.late_minutes ? a.late_minutes : ''}" /><button type="button" class="dr-late-save">حفظ</button></span>
      <span class="dr-seg" role="group" aria-label="حالة ${esc(name)}">
        <button type="button" data-s="present" class="${st === 'present' ? 'on' : ''}">حاضر</button>
        <button type="button" data-s="late" class="${st === 'late' ? 'on' : ''}">متأخر${st === 'late' && a.late_minutes ? ` (${a.late_minutes} د)` : ''}</button>
        <button type="button" data-s="absent" class="${st === 'absent' ? 'on' : ''}">غائب</button>
      </span>
    </div>`;
  }).join('');

  const save = async (e, status, minutes) => {
    const ok = await saveDutyStatus(e.teacher_profile_id, e.duty_type_id, dateStr, status, minutes, e.duty_types ? dutyTypeLabel(e.duty_types) : '');
    if (!ok) { renderTodayRows(); return; }
    todayAttendanceMap.set(e.teacher_profile_id + '_' + e.duty_type_id, { teacher_profile_id: e.teacher_profile_id, duty_type_id: e.duty_type_id, status, late_minutes: minutes });
    renderTodayRows();
  };
  container.querySelectorAll('.duty-row').forEach(row => {
    const e = entries[+row.dataset.i];
    row.querySelectorAll('.dr-seg button').forEach(btn => btn.addEventListener('click', async () => {
      if (btn.dataset.s === 'late') {
        row.querySelector('.dr-late').classList.remove('hidden');
        row.querySelector('.dr-late-min').focus();
        return;
      }
      btn.disabled = true;
      await save(e, btn.dataset.s, null);
    }));
    const lateSave = async () => {
      const m = parseInt(row.querySelector('.dr-late-min').value) || 0;
      if (!m) { row.querySelector('.dr-late-min').focus(); return; }
      await save(e, 'late', m);
    };
    row.querySelector('.dr-late-save').addEventListener('click', lateSave);
    row.querySelector('.dr-late-min').addEventListener('keydown', ev => { if (ev.key === 'Enter') lateSave(); });
  });
}

document.getElementById('duty-mark-all').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const { dateStr } = todayInfo();
  const pending = todayEntriesCache.filter(e => !todayAttendanceMap.has(e.teacher_profile_id + '_' + e.duty_type_id));
  if (!pending.length) return;
  if (!confirm(`تسجيل ${pending.length} مناوب بدون تسجيل كـ«حاضر»؟`)) return;
  btn.disabled = true;
  for (const e of pending) {
    if (!(await saveDutyStatus(e.teacher_profile_id, e.duty_type_id, dateStr, 'present', null, ''))) break;
    todayAttendanceMap.set(e.teacher_profile_id + '_' + e.duty_type_id, { status: 'present' });
  }
  btn.disabled = false;
  renderTodayRows();
});

async function saveDutyStatus(teacherId, dutyTypeId, dateStr, status, lateMinutes, dutyTypeName) {
  const { data: existing } = await R(() => sb.from('duty_attendance').select('id').eq('teacher_profile_id', teacherId).eq('duty_type_id', dutyTypeId).eq('duty_date', dateStr), true);

  const { error } = await sb.from('duty_attendance').upsert({
    teacher_profile_id: teacherId, duty_type_id: dutyTypeId, duty_date: dateStr, status, late_minutes: lateMinutes, marked_by: currentUserId, marked_at: new Date().toISOString(),
  }, { onConflict: 'teacher_profile_id,duty_type_id,duty_date' });

  if (error) { alert('تعذر الحفظ: ' + error.message); return false; }

  // نسجل ملاحظة تلقائية فقط أول مرة تُسجَّل الحالة (مو عند كل تعديل لاحق) ولو غياب أو تأخر
  if (!existing && (status === 'absent' || status === 'late')) {
    const { data: emp } = await sb.from('employees').select('id').eq('profile_id', teacherId).maybeSingle();
    if (emp) {
      const label = status === 'absent' ? 'غياب' : `تأخر ${lateMinutes} دقيقة`;
      await sb.from('notes').insert({
        employee_id: emp.id,
        indicator_id: null,
        recorded_by: currentUserId,
        note_type: 'negative',
        score: 1,
        content: `${label} عن المناوبة (${dutyTypeName}) بتاريخ ${dateStr}`,
      });
    }
  }
  return true;
}

/* ---------- بانر "اليوم عندك مناوبة" بالصفحة الرئيسية ---------- */
export async function renderMyDutyBanner() {
  const banner = document.getElementById('my-duty-banner');
  if (!banner) return;
  banner.innerHTML = '';

  const { dayKey } = todayInfo();
  if (!dayKey) return;

  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    R(() => sb.from('duty_roster').select('duty_type_id, duty_types(name, location)').eq('kind', 'fixed').eq('day_of_week', dayKey).eq('teacher_profile_id', currentUserId)),
    R(() => sb.from('duty_roster').select('duty_type_id, duty_types(name, location)').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday()).eq('teacher_profile_id', currentUserId)),
  ]);
  const myDuties = [...(fixed || []), ...(weekly || [])];
  if (myDuties.length === 0) return;

  const names = myDuties.map(d => d.duty_types ? dutyTypeLabel(d.duty_types) : '').filter(Boolean).join('، ');
  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; background:var(--gold-light); border:1px solid #F0C9A6; border-radius:14px; padding:14px 18px; margin-bottom:16px;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C56A2E" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span style="font-size:14px; color:var(--ink);"><strong>اليوم عندك مناوبة:</strong> ${names}</span>
    </div>`;
}

document.getElementById('back-to-tiles-8').addEventListener('click', backToTiles);
