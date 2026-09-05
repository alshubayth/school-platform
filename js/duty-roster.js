import { sb, currentUserId, roleLabels, isAdminOrDeputy, backToTiles, setupCollapsible } from './core.js';

const dayLabels = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

let dutyTypesCache = [];
let teachersCache = [];

function todayInfo() {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sunday ... 6=Saturday
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
  const dayKey = jsDay <= 4 ? dayKeys[jsDay] : null; // null لو جمعة/سبت (عطلة)
  const dateStr = now.toISOString().slice(0, 10);
  return { dayKey, dateStr, jsDay };
}

function thisWeekSunday() {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return sunday.toISOString().slice(0, 10);
}

function formatDays(days) {
  const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
  if (sorted.length === 5 && dayOrder.every(d => sorted.includes(d))) return 'طوال الأسبوع';
  return sorted.map(d => dayLabels[d]).join('، ');
}

setupCollapsible('dt-toggle', 'dt-body', 'dt-chevron');
setupCollapsible('fixed-toggle', 'fixed-body', 'fixed-chevron');
setupCollapsible('weekly-toggle', 'weekly-body', 'weekly-chevron');

function dutyTypeLabel(t) { return t.location ? `${t.name} — ${t.location}` : t.name; }

export async function loadDutyRosterModule() {
  const [{ data: types }, { data: teachers }] = await Promise.all([
    sb.from('duty_types').select('id, name, location').order('name').order('location'),
    sb.from('profiles').select('id, full_name').eq('role', 'teacher'),
  ]);
  dutyTypesCache = (types || []).map(t => ({ ...t, displayLabel: dutyTypeLabel(t) }));
  teachersCache = teachers || [];

  populateSelect('fixed-teacher', teachersCache, 'full_name');
  populateSelect('weekly-teacher', teachersCache, 'full_name');

  document.getElementById('week-sunday-label').textContent = thisWeekSunday();

  const { dateStr } = todayInfo();
  document.getElementById('today-date-label').textContent = dateStr;

  await refreshDutyTypesList();
  await refreshFixedList();
  await refreshWeeklyList();
  await refreshTodayAttendance();
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
  const { error } = await sb.from('duty_types').insert({ name, location: location || null });
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
    await sb.from('duty_roster').insert(rows);
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

    const { error } = await sb.from('duty_roster').insert(payload);
    if (error) { errEl.textContent = 'تعذر الإضافة: ' + error.message; errEl.style.display = 'block'; return; }

    rowsWrap.innerHTML = '';
    if (prefix === 'fixed') { await refreshFixedList(); } else { await refreshWeeklyList(); }
    await refreshTodayAttendance();
  });
}

wireDutyRowsSection('fixed', 'fixed');
wireDutyRowsSection('weekly', 'weekly');

async function refreshFixedList() {
  const { data } = await sb.from('duty_roster')
    .select('id, teacher_profile_id, duty_type_id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)')
    .eq('kind', 'fixed');
  const groups = groupByTeacherAndType(data || []);
  renderGroupedList('fixed-list', groups, 'fixed', async () => { await refreshFixedList(); await refreshTodayAttendance(); });
}

/* ---------- المناوبون المتغيرون (هذا الأسبوع) ---------- */
async function refreshWeeklyList() {
  const { data } = await sb.from('duty_roster')
    .select('id, teacher_profile_id, duty_type_id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)')
    .eq('kind', 'weekly').eq('week_start_date', thisWeekSunday());
  const groups = groupByTeacherAndType(data || []);
  renderGroupedList('weekly-list', groups, 'weekly', async () => { await refreshWeeklyList(); await refreshTodayAttendance(); });
}

/* ---------- تسجيل حضور اليوم ---------- */
async function getTodayDutyEntries() {
  const { dayKey } = todayInfo();
  if (!dayKey) return [];

  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    sb.from('duty_roster').select('teacher_profile_id, duty_type_id, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)').eq('kind', 'fixed').eq('day_of_week', dayKey),
    sb.from('duty_roster').select('teacher_profile_id, duty_type_id, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name, location)').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday()),
  ]);
  return [...(fixed || []), ...(weekly || [])];
}

async function refreshTodayAttendance() {
  const container = document.getElementById('today-duty-list');
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  const { dayKey, dateStr } = todayInfo();
  if (!dayKey) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>اليوم عطلة نهاية أسبوع، لا توجد مناوبات</p></div>';
    return;
  }

  const entries = await getTodayDutyEntries();
  if (entries.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه مناوبين مسجلين لليوم</p></div>';
    return;
  }

  const { data: existingAttendance } = await sb.from('duty_attendance').select('teacher_profile_id, duty_type_id, status, late_minutes').eq('duty_date', dateStr);
  const attendanceMap = new Map((existingAttendance || []).map(a => [a.teacher_profile_id + '_' + a.duty_type_id, a]));

  container.innerHTML = '';
  entries.forEach(e => {
    const key = e.teacher_profile_id + '_' + e.duty_type_id;
    const existing = attendanceMap.get(key);
    const isAbsent = existing && existing.status === 'absent';
    const isLate = existing && existing.status === 'late';

    const row = document.createElement('div');
    row.className = 'form-card';
    row.style.marginBottom = '10px';
    row.innerHTML = `
      <p style="margin:0 0 10px;"><strong>${e.profiles ? e.profiles.full_name : '-'}</strong> — ${e.duty_types ? dutyTypeLabel(e.duty_types) : ''}
        ${existing ? `<span class="badge ${existing.status === 'present' ? 'badge-meadow' : existing.status === 'late' ? 'badge-gold' : 'badge-danger'}" style="margin-right:8px;">${existing.status === 'present' ? 'حاضر' : existing.status === 'absent' ? 'غائب' : 'متأخر ' + (existing.late_minutes || 0) + ' د'}</span>` : ''}
      </p>
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
        <label style="display:flex; align-items:center; gap:6px; font-size:13.5px;">
          <input type="checkbox" class="absent-check" style="width:auto;" ${isAbsent ? 'checked' : ''} /> غائب
        </label>
        <label style="display:flex; align-items:center; gap:6px; font-size:13.5px;">
          <input type="checkbox" class="late-check" style="width:auto;" ${isLate ? 'checked' : ''} /> متأخر
        </label>
        <span class="late-minutes-wrap" style="display:${isLate ? 'flex' : 'none'}; align-items:center; gap:6px;">
          <input type="number" class="late-minutes-input" min="1" placeholder="كم دقيقة" value="${existing && existing.late_minutes ? existing.late_minutes : ''}" style="width:100px; padding:8px;" />
        </span>
      </div>
      <button class="save-status-btn" style="width:auto;">حفظ الحالة</button>`;

    const absentCheck = row.querySelector('.absent-check');
    const lateCheck = row.querySelector('.late-check');
    const lateMinutesWrap = row.querySelector('.late-minutes-wrap');

    absentCheck.addEventListener('change', () => { if (absentCheck.checked) { lateCheck.checked = false; lateMinutesWrap.style.display = 'none'; } });
    lateCheck.addEventListener('change', () => {
      if (lateCheck.checked) { absentCheck.checked = false; lateMinutesWrap.style.display = 'flex'; }
      else { lateMinutesWrap.style.display = 'none'; }
    });

    row.querySelector('.save-status-btn').addEventListener('click', async () => {
      let status = 'present';
      let lateMinutes = null;
      if (absentCheck.checked) {
        status = 'absent';
      } else if (lateCheck.checked) {
        status = 'late';
        lateMinutes = parseInt(row.querySelector('.late-minutes-input').value) || null;
        if (!lateMinutes) { alert('اكتب عدد دقائق التأخير'); return; }
      }
      await saveDutyStatus(e.teacher_profile_id, e.duty_type_id, dateStr, status, lateMinutes, e.duty_types ? dutyTypeLabel(e.duty_types) : '');
      await refreshTodayAttendance();
    });
    container.appendChild(row);
  });
}

async function saveDutyStatus(teacherId, dutyTypeId, dateStr, status, lateMinutes, dutyTypeName) {
  const { data: existing } = await sb.from('duty_attendance').select('id').eq('teacher_profile_id', teacherId).eq('duty_type_id', dutyTypeId).eq('duty_date', dateStr).maybeSingle();

  const { error } = await sb.from('duty_attendance').upsert({
    teacher_profile_id: teacherId, duty_type_id: dutyTypeId, duty_date: dateStr, status, late_minutes: lateMinutes, marked_by: currentUserId, marked_at: new Date().toISOString(),
  }, { onConflict: 'teacher_profile_id,duty_type_id,duty_date' });

  if (error) { alert('تعذر الحفظ: ' + error.message); return; }

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
}

/* ---------- بانر "اليوم عندك مناوبة" بالصفحة الرئيسية ---------- */
export async function renderMyDutyBanner() {
  const banner = document.getElementById('my-duty-banner');
  if (!banner) return;
  banner.innerHTML = '';

  const { dayKey } = todayInfo();
  if (!dayKey) return;

  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    sb.from('duty_roster').select('duty_type_id, duty_types(name, location)').eq('kind', 'fixed').eq('day_of_week', dayKey).eq('teacher_profile_id', currentUserId),
    sb.from('duty_roster').select('duty_type_id, duty_types(name, location)').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday()).eq('teacher_profile_id', currentUserId),
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
