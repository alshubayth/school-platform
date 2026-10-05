import { academicWeekInfo, weekLabel, isNoPlanWeek, sb, gradeLabels, currentProfile, currentUserId, isAdminOrDeputy, currentSchoolId, writeWithSchool } from './core.js';

// افتراضيًا: الأسبوع القادم - نتابع خلال هذا الأسبوع مين دخّل خطته ومين لا
let wtWeek = null;

export async function loadWeeklyTrackingModule() {
  if (wtWeek == null) wtWeek = Math.min(40, academicWeekInfo().next);
  const canManagePerms = isAdminOrDeputy();
  document.getElementById('wt-perms-toggle').classList.toggle('hidden', !canManagePerms);
  if (!canManagePerms) document.getElementById('wt-perms-section').classList.add('hidden');
  if (canManagePerms) await loadPermsSection();

  document.getElementById('wt-week-label').textContent = weekLabel(wtWeek);
  await refreshWeeklyTracking();
}

/* ---------- صلاحية عرض القسم لمعلمين محددين (المدير/الوكيل) ---------- */
async function loadPermsSection() {
  // مقيّد بمدرسة الحساب الحالي - وإلا قائمة "إعطاء الصلاحية" تطلع معلمين من كل المدارس مع بعض
  let teachersQuery = sb.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name');
  if (currentSchoolId) teachersQuery = teachersQuery.eq('school_id', currentSchoolId);
  let permsQuery = sb.from('weekly_tracking_permissions').select('id, profile_id, profiles!weekly_tracking_permissions_profile_id_fkey(full_name)');
  if (currentSchoolId) permsQuery = permsQuery.eq('school_id', currentSchoolId);

  let [{ data: teachers, error: teachersError }, { data: perms, error: permsError }] = await Promise.all([
    teachersQuery,
    permsQuery,
  ]);
  if (teachersError && currentSchoolId) {
    ({ data: teachers } = await sb.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'));
  }
  if (permsError && currentSchoolId) {
    ({ data: perms, error: permsError } = await sb.from('weekly_tracking_permissions').select('id, profile_id, profiles!weekly_tracking_permissions_profile_id_fkey(full_name)'));
  }
  if (permsError) console.error('weekly_tracking_permissions fetch error:', permsError);

  const grantedIds = new Set((perms || []).map(p => p.profile_id));
  const empSelect = document.getElementById('wt-perm-employee');
  const available = (teachers || []).filter(t => !grantedIds.has(t.id));
  empSelect.innerHTML = available.length
    ? available.map(t => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('')
    : '<option value="">لا يوجد معلمون متاحون</option>';

  const list = document.getElementById('wt-perms-list');
  list.innerHTML = '';
  if (!perms || perms.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:16px;"><p>ما فيه معلمين عندهم صلاحية بعد</p></div>';
    return;
  }
  perms.forEach(p => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    const name = p.profiles ? p.profiles.full_name : '-';
    const initials = (name || '؟').trim().split(' ').slice(0, 2).map(w => w.charAt(0)).join('');
    row.innerHTML = `
      <div class="avatar-circle" style="background:var(--purple-light); color:var(--purple);">${esc(initials)}</div>
      <div class="info"><div class="name">${esc(name)}</div>
      <div class="title">يشوف متابعة الخطة الأسبوعية</div></div>
      <button class="logout-icon" data-id="${p.id}" title="إلغاء الصلاحية" style="color:var(--danger);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>`;
    row.querySelector('button').addEventListener('click', async (e) => {
      await sb.from('weekly_tracking_permissions').delete().eq('id', e.currentTarget.dataset.id);
      await loadPermsSection();
    });
    list.appendChild(row);
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

document.getElementById('wt-perm-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('wt-perm-error');
  errEl.style.display = 'none';
  const profileId = document.getElementById('wt-perm-employee').value;
  if (!profileId) { errEl.textContent = 'اختر معلم أولاً'; errEl.style.display = 'block'; return; }

  const { error } = await writeWithSchool(extra =>
    sb.from('weekly_tracking_permissions').insert({ profile_id: profileId, granted_by: currentUserId, ...extra }));
  if (error) {
    errEl.textContent = error.message.includes('duplicate') ? 'هذا المعلم عنده الصلاحية بالفعل' : 'حدث خطأ: ' + error.message;
    errEl.style.display = 'block';
    await loadPermsSection();
    return;
  }
  await loadPermsSection();
});

document.getElementById('wt-perms-toggle').addEventListener('click', () => {
  const sec = document.getElementById('wt-perms-section');
  const open = sec.classList.toggle('hidden') === false;
  document.getElementById('wt-perms-toggle').textContent = open ? 'إخفاء الصلاحيات' : 'صلاحيات العرض';
});
document.getElementById('wt-week-prev').addEventListener('click', () => { if (wtWeek > 1) { wtWeek--; loadWeeklyTrackingModule(); } });
document.getElementById('wt-week-next').addEventListener('click', () => { if (wtWeek < 40) { wtWeek++; loadWeeklyTrackingModule(); } });

const NO_TEACHER = 'مواد بدون معلم مسند';
let lastMissing = []; // [{teacher, subject, grade}]
async function refreshWeeklyTracking() {
  const container = document.getElementById('wt-grades-container');
  const stats = document.getElementById('wt-stats');
  const teachersBox = document.getElementById('wt-teachers');
  lastMissing = [];
  teachersBox.innerHTML = '';
  if (isNoPlanWeek(wtWeek)) {
    stats.innerHTML = '';
    container.innerHTML = `<div class="ex-empty"><b>الأسبوع ${wtWeek} بدون خطة أسبوعية</b><span>ما يُحسب فيه أي مادة ناقصة. تقدر تغيّر هذا من «ضبط التقويم» في لوحة القيادة.</span></div>`;
    return;
  }
  container.innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';

  // المواد المسندة فعليًا لكل مرحلة (من تخصيص المعلمين) بدل كل مواد المدرسة
  let wpQuery = sb.from('weekly_plans').select('grade_level, subject_id').eq('week_number', wtWeek);
  if (currentSchoolId) wpQuery = wpQuery.eq('school_id', currentSchoolId);
  let tsQuery = sb.from('teacher_subjects').select('subject_id, grade_level, teacher_id, subjects(name)');
  if (currentSchoolId) tsQuery = tsQuery.eq('school_id', currentSchoolId);
  let prQuery = sb.from('profiles').select('id, full_name');
  if (currentSchoolId) prQuery = prQuery.eq('school_id', currentSchoolId);
  let [{ data: assignments, error: tsError }, { data: enteredPlans, error: wpError }, { data: people }] = await Promise.all([tsQuery, wpQuery, prQuery]);
  if (tsError && currentSchoolId) ({ data: assignments } = await sb.from('teacher_subjects').select('subject_id, grade_level, teacher_id, subjects(name)'));
  if (wpError && currentSchoolId) ({ data: enteredPlans } = await sb.from('weekly_plans').select('grade_level, subject_id').eq('week_number', wtWeek));
  const nameOf = new Map((people || []).map(p => [p.id, p.full_name]));

  const grades = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  let totalAll = 0, doneAll = 0;
  const html = grades.map(grade => {
    const subjMap = new Map();
    (assignments || []).filter(a => a.grade_level === grade && a.subject_id).forEach(a => {
      if (!subjMap.has(a.subject_id)) subjMap.set(a.subject_id, { id: a.subject_id, name: a.subjects ? a.subjects.name : '', teachers: new Set() });
      if (a.teacher_id) subjMap.get(a.subject_id).teachers.add(nameOf.get(a.teacher_id) || '');
    });
    const subjects = [...subjMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const entered = new Set((enteredPlans || []).filter(p => p.grade_level === grade).map(p => p.subject_id));
    const done = subjects.filter(s => entered.has(s.id)).length;
    totalAll += subjects.length; doneAll += done;
    subjects.filter(s => !entered.has(s.id)).forEach(s => {
      const ts = [...s.teachers].filter(Boolean);
      (ts.length ? ts : [NO_TEACHER]).forEach(t => lastMissing.push({ teacher: t, subject: s.name, grade }));
    });
    const pct = subjects.length ? Math.round(done / subjects.length * 100) : 0;
    const chips = subjects.map(s => {
      const ok = entered.has(s.id);
      const t = [...s.teachers].filter(Boolean).map(n => n.split(' ').slice(0, 2).join(' ')).join('، ');
      return `<span class="wt-chip ${ok ? 'ok' : 'miss'}"><b>${ok ? '✓ ' : ''}${esc(s.name)}</b>${!ok && t ? `<span>${esc(t)}</span>` : ''}</span>`;
    }).join('');
    return `<div class="wt-grade">
      <div class="wt-gh"><b>${gradeLabels[grade]}</b><span class="wt-gcount ${subjects.length && done === subjects.length ? 'full' : ''}">${subjects.length ? `${done} من ${subjects.length}` : 'ما فيه مواد مسندة'}</span></div>
      ${subjects.length ? `<div class="cmd-bar"><div style="width:${pct}%; ${pct === 100 ? 'background:var(--status-good);' : ''}"></div></div>` : ''}
      <div class="wt-chips">${chips || '<span class="dd-empty-panel">أضف تخصصات المعلمين من «إدارة الصلاحيات» عشان تظهر المواد هنا.</span>'}</div>
    </div>`;
  }).join('');
  container.innerHTML = html;

  const missingTeachers = new Map();
  lastMissing.forEach(m => { if (!missingTeachers.has(m.teacher)) missingTeachers.set(m.teacher, []); missingTeachers.get(m.teacher).push(m); });
  const realTeachers = [...missingTeachers.keys()].filter(t => t !== NO_TEACHER).length;
  stats.innerHTML = `
    <span class="ds ${doneAll === totalAll && totalAll ? 'ds-present' : 'ds-all'}"><b>${doneAll}</b> من ${totalAll} خطة مسلّمة</span>
    <span class="ds ${totalAll - doneAll ? 'ds-absent' : 'ds-present'}"><b>${totalAll - doneAll}</b> ناقصة</span>
    <span class="ds ${realTeachers ? 'ds-late' : 'ds-present'}"><b>${realTeachers}</b> معلم ما سلّم</span>`;
  if (missingTeachers.size) {
    teachersBox.innerHTML = `<h3 class="duty-h" style="margin:24px 0 10px;">المعلمين اللي ما سلّموا</h3><div class="wt-tlist">${[...missingTeachers.entries()].sort((a, b) => b[1].length - a[1].length).map(([t, list]) => `
      <div class="wt-t"><span class="cvt-av">${esc(t.split(' ').slice(0, 2).map(w => w.charAt(0)).join(' '))}</span><span class="wt-t-main"><b>${esc(t)}</b><span>${list.map(m => `${esc(m.subject)} · ${esc((gradeLabels[m.grade] || '').replace(' متوسط', ''))}`).join(' — ')}</span></span><span class="wt-t-n">${list.length}</span></div>`).join('')}</div>`;
  }
}

document.getElementById('wt-copy').addEventListener('click', async () => {
  const label = document.getElementById('wt-week-label').textContent;
  const byT = new Map();
  lastMissing.forEach(m => { if (!byT.has(m.teacher)) byT.set(m.teacher, []); byT.get(m.teacher).push(m); });
  let text = `تذكير بتسليم الخطة الأسبوعية — ${label}\n`;
  if (!byT.size) text += '\nكل الخطط مسلّمة، شكرًا للجميع 🌷';
  else byT.forEach((list, t) => { text += `\n${t === NO_TEACHER ? '' : 'أ. '}${t}: ${list.map(m => `${m.subject} (${(gradeLabels[m.grade] || '').replace(' متوسط', '')})`).join('، ')}`; });
  const msg = document.getElementById('wt-msg');
  try { await navigator.clipboard.writeText(text); msg.textContent = 'انسخ التذكير، الصقه في قروب المعلمين'; }
  catch { prompt('انسخ النص:', text); msg.textContent = ''; }
  if (msg.textContent) { msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 2500); }
});
