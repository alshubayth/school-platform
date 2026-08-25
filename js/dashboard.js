import { sb, currentUserId, currentProfile, isOpPlanMember, openTile } from './core.js';

function todayInfo() {
  const now = new Date();
  const jsDay = now.getDay();
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
  const dayKey = jsDay <= 4 ? dayKeys[jsDay] : null;
  const dateStr = now.toISOString().slice(0, 10);
  return { dayKey, dateStr };
}

function thisWeekSunday() {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return sunday.toISOString().slice(0, 10);
}

function statCard(label, value, color) {
  return `<div style="background:#fff; border:1px solid #ECEAE1; border-radius:12px; padding:14px;">
    <p style="font-size:11.5px; color:var(--slate); margin:0 0 4px;">${label}</p>
    <p style="font-family:'Tajawal'; font-weight:800; font-size:22px; color:${color || 'var(--ink)'}; margin:0;">${value}</p>
  </div>`;
}

function attentionItem(iconColorClass, iconSvg, text, onClick) {
  const div = document.createElement('div');
  div.className = 'emp-row';
  div.style.cursor = 'pointer';
  div.innerHTML = `
    <div class="ic-diamond ${iconColorClass}" style="width:32px; height:32px; border-radius:7px;">${iconSvg}</div>
    <div class="info" style="font-size:13px; color:var(--ink);">${text}</div>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--slate)" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>`;
  div.addEventListener('click', onClick);
  return div;
}

const icDanger = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="transform:rotate(-45deg)"><path d="M12 9v4M12 17h.01M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
const icGold = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="transform:rotate(-45deg)"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>';
const icPurple = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="transform:rotate(-45deg)"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>';
const icNavy = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="transform:rotate(-45deg)"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

export async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;
  container.innerHTML = '<div class="placeholder" style="padding:30px;"><p>جارٍ التحميل...</p></div>';

  if (currentProfile.role === 'admin' || currentProfile.role === 'deputy') {
    await renderAdminDashboard(container);
  } else if (currentProfile.role === 'teacher') {
    await renderTeacherDashboard(container);
  } else {
    container.innerHTML = '';
  }
}

async function renderAdminDashboard(container) {
  const [
    { count: employeesCount },
    { count: linkedCount },
    { data: completions },
    { data: pendingTasks },
    { data: pendingCompletions },
    { data: allSubjects },
    { data: weeklyPlansThisWeek },
  ] = await Promise.all([
    sb.from('employees').select('id', { count: 'exact', head: true }),
    sb.from('employees').select('id', { count: 'exact', head: true }).not('profile_id', 'is', null),
    sb.from('op_task_completions').select('status'),
    sb.from('op_tasks').select('id').eq('plan_status', 'pending'),
    sb.from('op_task_completions').select('id').eq('status', 'pending'),
    sb.from('subjects').select('id'),
    sb.from('weekly_plans').select('subject_id, grade_level').eq('week_number', 1),
  ]);

  const totalCompletions = (completions || []).length;
  const approvedCompletions = (completions || []).filter(c => c.status === 'approved').length;
  const completionRate = totalCompletions ? Math.round((approvedCompletions / totalCompletions) * 100) : 0;

  const pendingApprovals = (pendingTasks || []).length + (pendingCompletions || []).length;

  const totalPossible = (allSubjects || []).length * 3;
  const enteredSet = new Set((weeklyPlansThisWeek || []).map(p => p.subject_id + '_' + p.grade_level));
  const missingCount = Math.max(totalPossible - enteredSet.size, 0);

  const { dayKey, dateStr } = todayInfo();
  let dutyMissingCount = 0;
  if (dayKey) {
    const [{ data: fixed }, { data: weekly }, { data: attendance }] = await Promise.all([
      sb.from('duty_roster').select('teacher_profile_id, duty_type_id').eq('kind', 'fixed').eq('day_of_week', dayKey),
      sb.from('duty_roster').select('teacher_profile_id, duty_type_id').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday()),
      sb.from('duty_attendance').select('teacher_profile_id, duty_type_id').eq('duty_date', dateStr),
    ]);
    const todayEntries = [...(fixed || []), ...(weekly || [])];
    const recordedSet = new Set((attendance || []).map(a => a.teacher_profile_id + '_' + a.duty_type_id));
    dutyMissingCount = todayEntries.filter(e => !recordedSet.has(e.teacher_profile_id + '_' + e.duty_type_id)).length;
  }

  const unlinkedCount = (employeesCount || 0) - (linkedCount || 0);

  container.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:22px;">
      ${statCard('إجمالي الموظفين', employeesCount ?? 0)}
      ${statCard('إنجاز الخطة التشغيلية', completionRate + '%', 'var(--teal)')}
      ${statCard('بانتظار الاعتماد', pendingApprovals, pendingApprovals ? 'var(--gold)' : 'var(--ink)')}
      ${statCard('مواد ناقصة هذا الأسبوع', missingCount, missingCount ? 'var(--danger)' : 'var(--ink)')}
    </div>
    <p style="font-family:'Tajawal'; font-weight:700; font-size:14px; margin:0 0 10px;">يحتاج انتباهك</p>
    <div id="dash-attention-list"></div>`;

  const attentionList = document.getElementById('dash-attention-list');
  let anyAttention = false;

  if (missingCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('diamond-navy', icDanger, `${missingCount} مادة لسا ما دخّل لها المعلمون خطة هذا الأسبوع`, () => openTile('weekly-tracking')));
  }
  if (pendingApprovals > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('diamond-gold', icGold, `${pendingApprovals} مهام/إنجازات بالخطة التشغيلية بانتظار اعتمادك`, () => openTile('plan')));
  }
  if (unlinkedCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('diamond-purple', icPurple, `${unlinkedCount} موظف بدون حساب دخول مربوط`, () => openTile('portal')));
  }
  if (dutyMissingCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('diamond-navy', icNavy, `${dutyMissingCount} من مناوبي اليوم لسا ما سجّلت حضورهم`, () => openTile('duty')));
  }
  if (!anyAttention) {
    attentionList.innerHTML = '<div class="placeholder" style="padding:20px;"><p>كل شي محدّث، ما فيه شي يحتاج انتباهك حاليًا 🎉</p></div>';
  }
}

async function renderTeacherDashboard(container) {
  const { data: assignments } = await sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)').eq('teacher_id', currentUserId);
  const { data: weeklyPlansThisWeek } = await sb.from('weekly_plans').select('subject_id, grade_level').eq('week_number', 1);
  const enteredSet = new Set((weeklyPlansThisWeek || []).map(p => p.subject_id + '_' + p.grade_level));

  const missingAssignments = (assignments || []).filter(a => !enteredSet.has(a.subject_id + '_' + a.grade_level));

  let opPlanPendingCount = 0;
  if (isOpPlanMember) {
    const { data: myPending } = await sb.from('op_tasks').select('id').eq('employee_profile_id', currentUserId).eq('plan_status', 'pending');
    opPlanPendingCount = (myPending || []).length;
  }

  container.innerHTML = `<div id="dash-attention-list"></div>`;
  const list = document.getElementById('dash-attention-list');
  let any = false;

  if (missingAssignments.length > 0) {
    any = true;
    const names = missingAssignments.map(a => a.subjects ? a.subjects.name : '').filter(Boolean).join('، ');
    list.appendChild(attentionItem('diamond-navy', icDanger, `لسا ما سلّمت خطة هذا الأسبوع لـ: ${names}`, () => openTile('weekly')));
  } else if ((assignments || []).length > 0) {
    any = true;
    const okDiv = document.createElement('div');
    okDiv.className = 'emp-row';
    okDiv.innerHTML = `<div class="ic-diamond diamond-teal" style="width:32px; height:32px; border-radius:7px;">${icGold}</div><div class="info" style="font-size:13px; color:var(--ink);">خطتك الأسبوعية مسلّمة لكل موادك 🎉</div>`;
    list.appendChild(okDiv);
  }

  if (opPlanPendingCount > 0) {
    any = true;
    list.appendChild(attentionItem('diamond-gold', icGold, `${opPlanPendingCount} مهمة أضفتها بالخطة التشغيلية بانتظار اعتماد المدير`, () => openTile('plan')));
  }

  if (!any) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه شي يحتاج انتباهك حاليًا</p></div>';
  }
}
