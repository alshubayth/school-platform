import { sb, currentUserId, roleLabels, isAdminOrDeputy, backToTiles } from './core.js';

const dayLabels = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
const statusLabels = { present: 'حاضر', absent: 'غائب', late: 'متأخر' };

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

export async function loadDutyRosterModule() {
  const [{ data: types }, { data: teachers }] = await Promise.all([
    sb.from('duty_types').select('id, name').order('name'),
    sb.from('profiles').select('id, full_name').eq('role', 'teacher'),
  ]);
  dutyTypesCache = types || [];
  teachersCache = teachers || [];

  populateSelect('fixed-teacher', teachersCache, 'full_name');
  populateSelect('fixed-duty-type', dutyTypesCache, 'name');
  populateSelect('weekly-teacher', teachersCache, 'full_name');
  populateSelect('weekly-duty-type', dutyTypesCache, 'name');

  document.getElementById('week-sunday-label').textContent = thisWeekSunday();

  const { dateStr } = todayInfo();
  document.getElementById('today-date-label').textContent = dateStr;

  await refreshDutyTypesList();
  await refreshFixedList();
  await refreshWeeklyList();
  await refreshTodayAttendance();
}

function populateSelect(id, items, labelKey) {
  const sel = document.getElementById(id);
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
document.getElementById('dt-add').addEventListener('click', async () => {
  const name = document.getElementById('dt-name').value.trim();
  if (!name) return;
  const { error } = await sb.from('duty_types').insert({ name });
  if (error) { alert('تعذر الإضافة: ' + error.message); return; }
  document.getElementById('dt-name').value = '';
  await loadDutyRosterModule();
});

async function refreshDutyTypesList() {
  const list = document.getElementById('dt-list');
  list.innerHTML = '';
  dutyTypesCache.forEach(t => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:flex; align-items:center; gap:8px; background:var(--sand); border:1px solid #ECEAE1; border-radius:20px; padding:6px 8px 6px 14px;';
    chip.innerHTML = `
      <span style="font-size:13.5px; font-weight:500;">${t.name}</span>
      <button data-id="${t.id}" style="width:auto; padding:5px !important; background:transparent; color:var(--danger); display:flex; align-items:center; justify-content:center; border-radius:50%;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      await sb.from('duty_types').delete().eq('id', t.id);
      await loadDutyRosterModule();
    });
    list.appendChild(chip);
  });
}

/* ---------- المناوبون الثابتون ---------- */
document.getElementById('fixed-add').addEventListener('click', async () => {
  const teacherId = document.getElementById('fixed-teacher').value;
  const dutyTypeId = document.getElementById('fixed-duty-type').value;
  const day = document.getElementById('fixed-day').value;
  const errEl = document.getElementById('fixed-error');
  errEl.style.display = 'none';
  if (!teacherId || !dutyTypeId) {
    errEl.textContent = 'أضف معلمًا ونوع مناوبة أولاً';
    errEl.style.display = 'block';
    return;
  }

  const daysToAdd = day === 'all_week' ? ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'] : [day];
  const rows = daysToAdd.map(d => ({
    teacher_profile_id: teacherId, duty_type_id: dutyTypeId, kind: 'fixed', day_of_week: d, created_by: currentUserId,
  }));

  const { error } = await sb.from('duty_roster').insert(rows);
  if (error) { errEl.textContent = 'تعذر الإضافة: ' + error.message; errEl.style.display = 'block'; return; }
  await refreshFixedList();
  await refreshTodayAttendance();
});

async function refreshFixedList() {
  const { data } = await sb.from('duty_roster')
    .select('id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name)')
    .eq('kind', 'fixed');
  const list = document.getElementById('fixed-list');
  list.innerHTML = '';
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>لا يوجد مناوبون ثابتون بعد</p></div>';
    return;
  }
  data.forEach(r => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div><div class="name">${r.profiles ? r.profiles.full_name : '-'}</div>
      <div class="title">${r.duty_types ? r.duty_types.name : ''} · ${dayLabels[r.day_of_week]}</div></div>
      <button class="logout-icon" style="color:var(--danger);" data-id="${r.id}">حذف</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await sb.from('duty_roster').delete().eq('id', r.id);
      await refreshFixedList();
      await refreshTodayAttendance();
    });
    list.appendChild(row);
  });
}

/* ---------- المناوبون المتغيرون (هذا الأسبوع) ---------- */
document.getElementById('weekly-add').addEventListener('click', async () => {
  const teacherId = document.getElementById('weekly-teacher').value;
  const dutyTypeId = document.getElementById('weekly-duty-type').value;
  const day = document.getElementById('weekly-day').value;
  const errEl = document.getElementById('weekly-error');
  errEl.style.display = 'none';
  if (!teacherId || !dutyTypeId) {
    errEl.textContent = 'أضف معلمًا ونوع مناوبة أولاً';
    errEl.style.display = 'block';
    return;
  }
  const { error } = await sb.from('duty_roster').insert({
    teacher_profile_id: teacherId, duty_type_id: dutyTypeId, kind: 'weekly',
    day_of_week: day, week_start_date: thisWeekSunday(), created_by: currentUserId,
  });
  if (error) { errEl.textContent = 'تعذر الإضافة: ' + error.message; errEl.style.display = 'block'; return; }
  await refreshWeeklyList();
  await refreshTodayAttendance();
});

async function refreshWeeklyList() {
  const { data } = await sb.from('duty_roster')
    .select('id, day_of_week, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name)')
    .eq('kind', 'weekly').eq('week_start_date', thisWeekSunday());
  const list = document.getElementById('weekly-list');
  list.innerHTML = '';
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه مناوبون متغيرون مضافون لهذا الأسبوع بعد</p></div>';
    return;
  }
  data.forEach(r => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div><div class="name">${r.profiles ? r.profiles.full_name : '-'}</div>
      <div class="title">${r.duty_types ? r.duty_types.name : ''} · ${dayLabels[r.day_of_week]}</div></div>
      <button class="logout-icon" style="color:var(--danger);" data-id="${r.id}">حذف</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await sb.from('duty_roster').delete().eq('id', r.id);
      await refreshWeeklyList();
      await refreshTodayAttendance();
    });
    list.appendChild(row);
  });
}

/* ---------- تسجيل حضور اليوم ---------- */
async function getTodayDutyEntries() {
  const { dayKey } = todayInfo();
  if (!dayKey) return [];

  const [{ data: fixed }, { data: weekly }] = await Promise.all([
    sb.from('duty_roster').select('teacher_profile_id, duty_type_id, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name)').eq('kind', 'fixed').eq('day_of_week', dayKey),
    sb.from('duty_roster').select('teacher_profile_id, duty_type_id, profiles!duty_roster_teacher_profile_id_fkey(full_name), duty_types(name)').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday()),
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

  const { data: existingAttendance } = await sb.from('duty_attendance').select('teacher_profile_id, duty_type_id, status').eq('duty_date', dateStr);
  const attendanceMap = new Map((existingAttendance || []).map(a => [a.teacher_profile_id + '_' + a.duty_type_id, a.status]));

  container.innerHTML = '';
  entries.forEach(e => {
    const key = e.teacher_profile_id + '_' + e.duty_type_id;
    const currentStatus = attendanceMap.get(key) || '';

    const row = document.createElement('div');
    row.className = 'form-card';
    row.style.marginBottom = '10px';
    row.innerHTML = `
      <p style="margin:0 0 10px;"><strong>${e.profiles ? e.profiles.full_name : '-'}</strong> — ${e.duty_types ? e.duty_types.name : ''}</p>
      <select class="status-select">
        <option value="">اختر الحالة</option>
        <option value="present" ${currentStatus === 'present' ? 'selected' : ''}>حاضر</option>
        <option value="absent" ${currentStatus === 'absent' ? 'selected' : ''}>غائب</option>
        <option value="late" ${currentStatus === 'late' ? 'selected' : ''}>متأخر</option>
      </select>
      <button class="save-status-btn" style="width:auto;">حفظ الحالة</button>`;

    row.querySelector('.save-status-btn').addEventListener('click', async () => {
      const status = row.querySelector('.status-select').value;
      if (!status) { alert('اختر الحالة أولاً'); return; }
      await saveDutyStatus(e.teacher_profile_id, e.duty_type_id, dateStr, status, e.profiles ? e.profiles.full_name : '', e.duty_types ? e.duty_types.name : '');
      await refreshTodayAttendance();
    });
    container.appendChild(row);
  });
}

async function saveDutyStatus(teacherId, dutyTypeId, dateStr, status, teacherName, dutyTypeName) {
  const { data: existing } = await sb.from('duty_attendance').select('id').eq('teacher_profile_id', teacherId).eq('duty_type_id', dutyTypeId).eq('duty_date', dateStr).maybeSingle();

  const { error } = await sb.from('duty_attendance').upsert({
    teacher_profile_id: teacherId, duty_type_id: dutyTypeId, duty_date: dateStr, status, marked_by: currentUserId, marked_at: new Date().toISOString(),
  }, { onConflict: 'teacher_profile_id,duty_type_id,duty_date' });

  if (error) { alert('تعذر الحفظ: ' + error.message); return; }

  // نسجل ملاحظة تلقائية فقط أول مرة تُسجَّل الحالة (مو عند كل تعديل لاحق) ولو غياب أو تأخر
  if (!existing && (status === 'absent' || status === 'late')) {
    const { data: emp } = await sb.from('employees').select('id').eq('profile_id', teacherId).maybeSingle();
    if (emp) {
      const label = status === 'absent' ? 'غياب' : 'تأخر';
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
    sb.from('duty_roster').select('duty_type_id, duty_types(name)').eq('kind', 'fixed').eq('day_of_week', dayKey).eq('teacher_profile_id', currentUserId),
    sb.from('duty_roster').select('duty_type_id, duty_types(name)').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday()).eq('teacher_profile_id', currentUserId),
  ]);
  const myDuties = [...(fixed || []), ...(weekly || [])];
  if (myDuties.length === 0) return;

  const names = myDuties.map(d => d.duty_types ? d.duty_types.name : '').filter(Boolean).join('، ');
  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; background:var(--gold-light); border:1px solid #F0C9A6; border-radius:14px; padding:14px 18px; margin-bottom:16px;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C56A2E" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span style="font-size:14px; color:var(--ink);"><strong>اليوم عندك مناوبة:</strong> ${names}</span>
    </div>`;
}

document.getElementById('back-to-tiles-8').addEventListener('click', backToTiles);
