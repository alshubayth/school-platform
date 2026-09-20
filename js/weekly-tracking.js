import { sb, gradeLabels, currentProfile, currentUserId, isAdminOrDeputy, currentSchoolId, writeWithSchool } from './core.js';

let wtWeek = 1;

export async function loadWeeklyTrackingModule() {
  const canManagePerms = isAdminOrDeputy();
  document.getElementById('wt-perms-section').classList.toggle('hidden', !canManagePerms);
  if (canManagePerms) await loadPermsSection();

  document.getElementById('wt-week-label').textContent = 'الأسبوع ' + wtWeek;
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

document.getElementById('wt-week-prev').addEventListener('click', () => { if (wtWeek > 1) { wtWeek--; loadWeeklyTrackingModule(); } });
document.getElementById('wt-week-next').addEventListener('click', () => { if (wtWeek < 40) { wtWeek++; loadWeeklyTrackingModule(); } });

async function refreshWeeklyTracking() {
  const container = document.getElementById('wt-grades-container');
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  // نجيب المواد المسندة فعليًا لكل مرحلة (عن طريق تخصيص المعلمين) بدل كل مواد المدرسة،
  // عشان مادة مسندة لمرحلة وحدة بس (مثل التفكير الناقد لثالث متوسط) ما تظهر "ناقصة" بمرحلة ثانية أصلاً ما تُدرّس فيها.
  let wpQuery = sb.from('weekly_plans').select('grade_level, subject_id').eq('week_number', wtWeek);
  if (currentSchoolId) wpQuery = wpQuery.eq('school_id', currentSchoolId);
  let tsQuery = sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)');
  if (currentSchoolId) tsQuery = tsQuery.eq('school_id', currentSchoolId);
  let [{ data: assignments, error: tsError }, { data: enteredPlans, error: wpError }] = await Promise.all([
    tsQuery,
    wpQuery,
  ]);
  if (tsError && currentSchoolId) {
    ({ data: assignments } = await sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)'));
  }
  if (wpError && currentSchoolId) {
    ({ data: enteredPlans } = await sb.from('weekly_plans').select('grade_level, subject_id').eq('week_number', wtWeek));
  }

  container.innerHTML = '';
  const grades = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

  grades.forEach(grade => {
    const subjMap = new Map();
    (assignments || []).filter(a => a.grade_level === grade && a.subject_id).forEach(a => {
      if (!subjMap.has(a.subject_id)) subjMap.set(a.subject_id, a.subjects ? a.subjects.name : '');
    });
    const gradeSubjects = Array.from(subjMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const enteredIds = new Set((enteredPlans || []).filter(p => p.grade_level === grade).map(p => p.subject_id));
    const missingCount = gradeSubjects.filter(s => !enteredIds.has(s.id)).length;

    const chips = gradeSubjects.map(s => {
      const isEntered = enteredIds.has(s.id);
      const bg = isEntered ? 'var(--meadow-light)' : 'var(--danger-light)';
      const color = isEntered ? 'var(--meadow)' : 'var(--danger)';
      return `<span style="display:inline-block; font-size:12.5px; background:${bg}; color:${color}; padding:4px 12px; border-radius:20px; margin:0 4px 4px 0; font-weight:600;">${s.name}</span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'form-card';
    let statusText;
    if (gradeSubjects.length === 0) {
      statusText = '<span style="font-size:12px; color:var(--slate); font-weight:400;">لا توجد مواد مُسندة لهذه المرحلة بعد</span>';
    } else if (missingCount === 0) {
      statusText = '<span style="color:var(--meadow);">كل المواد مُدخلة لهذا الأسبوع 🎉</span>';
    } else {
      statusText = `<span style="font-size:12px; color:var(--slate); font-weight:400;">(${missingCount} مادة ناقصة من ${gradeSubjects.length})</span>`;
    }
    card.innerHTML = `
      <h4 style="margin-bottom:10px;">${gradeLabels[grade]} ${statusText}</h4>
      <div>${chips}</div>`;
    container.appendChild(card);
  });
}
