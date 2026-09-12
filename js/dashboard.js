import { sb, currentUserId, currentProfile, isOpPlanMember, openTile, tiles, isTileAllowed, budgetTileTitle, budgetTileDesc, gradeLabels, GROUPS } from './core.js';

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function normalizeArText(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
function classLabel(grade, section) { return `${gradeLabels[grade] || grade} - الفصل ${section}`; }

// نفس أيام وحصص جدول الحصص بملف schedule.js - معرّفة هنا محليًا (بدل استيراد schedule.js)
// عشان نتفادى تنفيذ أحداثه الجانبية (ربط أزرار رجوع) بمجرد تحميل لوحة التحكم للجميع
const SCHEDULE_DAYS = [
  { key: 'sunday', label: 'الأحد' },
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
];
const SCHEDULE_PERIODS = [1, 2, 3, 4, 5, 6, 7];
// نفس عائلة الألوان التصنيفية الثابتة المستخدمة بداشبورد الخطة التشغيلية (--goal-1..6) - نلوّن
// بها فصول المعلم بالجدول الأسبوعي عشان تتناسق الألوان مع باقي المنصة، وتدور لو الفصول أكثر من 6
const CLASS_COLOR_VARS = ['--goal-1', '--goal-2', '--goal-3', '--goal-4', '--goal-5', '--goal-6'];
function classColorVar(i) { return `var(${CLASS_COLOR_VARS[i % CLASS_COLOR_VARS.length]})`; }

// الجدول الدراسي الأسبوعي الكامل لكل فصول المعلم - يظهر بالصفحة الرئيسية بمجرد فتح حسابه،
// كل فصل بلون ثابت مميز له عبر كل الجدول
async function renderMyWeeklyScheduleGrid() {
  const wrap = document.getElementById('dash-weekly-schedule');
  if (!wrap) return;
  const { data: rows } = await sb.from('class_schedules')
    .select('day_of_week, period_number, grade_level, class_section, subject_name, teacher_name');
  const myName = normalizeArText(currentProfile.full_name);
  const mine = (rows || []).filter(r => normalizeArText(r.teacher_name) === myName);
  if (mine.length === 0) { wrap.innerHTML = ''; return; }

  const classKeys = [];
  mine.forEach(r => {
    const k = r.grade_level + '::' + r.class_section;
    if (!classKeys.includes(k)) classKeys.push(k);
  });
  const colorByClass = new Map(classKeys.map((k, i) => [k, classColorVar(i)]));

  const cellMap = new Map();
  mine.forEach(r => cellMap.set(r.day_of_week + '-' + r.period_number, r));

  // الأيام صفوف والحصص أعمدة (بدل العكس) - أنسب لعرض الجوال وأقرب لشكل الجدول الورقي المعتاد.
  // الألوان بس (بدون مفتاح ألوان منفصل) - اسم الفصل مكتوب بالخلية نفسها فما يحتاج توضيح إضافي.
  const gridHtml = `
    <div style="overflow-x:auto;">
      <table class="weekly-sched-table">
        <thead><tr><th></th>${SCHEDULE_PERIODS.map(p => `<th>${p}</th>`).join('')}</tr></thead>
        <tbody>
          ${SCHEDULE_DAYS.map(d => `
            <tr>
              <td class="wp-day">${d.label}</td>
              ${SCHEDULE_PERIODS.map(p => {
                const r = cellMap.get(d.key + '-' + p);
                if (!r) return `<td class="wp-cell wp-empty"></td>`;
                const k = r.grade_level + '::' + r.class_section;
                const color = colorByClass.get(k);
                return `<td class="wp-cell" style="--cell-color:${color};">
                  <div class="wp-subject">${esc(r.subject_name || '-')}</div>
                  <div class="wp-class">${esc(classLabel(r.grade_level, r.class_section))}</div>
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  wrap.innerHTML = `
    <p style="font-family:'Tajawal'; font-weight:700; font-size:13px; margin:0 0 8px;">جدولك الدراسي الأسبوعي</p>
    ${gridHtml}`;
}

// جدول اليوم الخاص بالمعلم كما يظهر بصفحته الرئيسية: يقارن جدوله الأصلي بأي تغييرات
// (تعويض غياب أو تبديل حصص) مسجّلة بـ daily_schedule_changes لنفس التاريخ، ويبرز أي فرق
async function loadMyTodayScheduleLines(dayKey, dateStr) {
  const myName = normalizeArText(currentProfile.full_name);
  const [{ data: baselineRows }, { data: changeRows }] = await Promise.all([
    sb.from('class_schedules').select('*').eq('day_of_week', dayKey),
    sb.from('daily_schedule_changes').select('*').eq('change_date', dateStr),
  ]);
  const baseline = baselineRows || [];
  const changes = changeRows || [];
  const findChange = (r) => changes.find(c => c.grade_level === r.grade_level && c.class_section === r.class_section && c.period_number === r.period_number);

  const myBaseline = baseline.filter(r => normalizeArText(r.teacher_name) === myName);
  const myEffective = [];
  baseline.forEach(r => {
    const change = findChange(r);
    const effTeacher = normalizeArText(change ? change.teacher_name : r.teacher_name);
    if (effTeacher === myName) {
      myEffective.push({
        period: r.period_number, grade: r.grade_level, section: r.class_section,
        subject: change ? (change.subject_name || r.subject_name) : r.subject_name,
        isChange: !!change, note: change ? change.note : null,
      });
    }
  });
  if (myBaseline.length === 0 && myEffective.length === 0) return null; // ما له جدول تدريس بهذا اليوم أصلًا

  const lostSlots = [];
  myBaseline.forEach(r => {
    const change = findChange(r);
    if (change && normalizeArText(change.teacher_name) !== myName) {
      lostSlots.push({ period: r.period_number, grade: r.grade_level, section: r.class_section, subject: r.subject_name, newTeacher: change.teacher_name });
    }
  });

  const consumed = new Set();
  const lines = [];
  lostSlots.forEach(ls => {
    const moved = myEffective.find(e => e.isChange && e.grade === ls.grade && e.section === ls.section
      && normalizeArText(e.subject) === normalizeArText(ls.subject) && e.period !== ls.period && !consumed.has(e.period));
    if (moved) {
      consumed.add(moved.period);
      lines.push({ sortKey: Math.min(ls.period, moved.period), highlighted: true,
        html: `الحصة ${ls.period} — ${esc(classLabel(ls.grade, ls.section))} — ${esc(ls.subject || '-')}: <strong>تبديل إلى الحصة ${moved.period}</strong>` });
    } else {
      lines.push({ sortKey: ls.period, highlighted: true,
        html: `الحصة ${ls.period} — ${esc(classLabel(ls.grade, ls.section))} — ${esc(ls.subject || '-')}: يدرّسها الآن <strong>${esc(ls.newTeacher)}</strong> بدلاً عنك` });
    }
  });
  myEffective.forEach(e => {
    if (consumed.has(e.period)) return;
    if (e.isChange) {
      lines.push({ sortKey: e.period, highlighted: true,
        html: `الحصة ${e.period} — ${esc(classLabel(e.grade, e.section))}: <strong>${esc(e.subject || 'أشغال')}</strong> — بديل${e.note ? ' (' + esc(e.note) + ')' : ''}` });
    } else {
      lines.push({ sortKey: e.period, highlighted: false,
        html: `الحصة ${e.period} — ${esc(classLabel(e.grade, e.section))} — ${esc(e.subject || '-')}` });
    }
  });
  lines.sort((a, b) => a.sortKey - b.sortKey);
  return lines;
}

async function renderMyScheduleWidget(container, dayKey, dateStr) {
  if (!dayKey) return;
  const lines = await loadMyTodayScheduleLines(dayKey, dateStr);
  if (lines === null) return; // ما له حصص بالجدول الدراسي - ما نعرض الودجت
  const wrap = document.getElementById('dash-my-schedule');
  if (!wrap) return;
  const bodyHtml = lines.length === 0
    ? '<div class="placeholder" style="padding:16px;"><p>ما عندك حصص اليوم</p></div>'
    : lines.map(l => `<div style="padding:10px 12px; border-radius:8px; margin-bottom:6px; font-size:13px; ${l.highlighted ? 'background:#FDEDEC; color:var(--danger); font-weight:600;' : 'background:#fff; border:1px solid #ECEAE1; color:var(--ink);'}">${l.html}</div>`).join('');
  wrap.innerHTML = `<p style="font-family:'Tajawal'; font-weight:700; font-size:14px; margin:0 0 10px;">جدولك اليوم</p>${bodyHtml}`;
}

function renderSectionTilesGrid() {
  const grid = document.getElementById('dash-sections-grid');
  if (!grid) return;
  grid.innerHTML = '';
  GROUPS.forEach(g => {
    const groupTiles = tiles.filter(t => t.group === g.key && isTileAllowed(t));
    if (!groupTiles.length) return;

    const heading = document.createElement('p');
    heading.className = 'tiles-group-label';
    heading.textContent = g.title;
    grid.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'tiles';
    groupTiles.forEach(t => {
      const title = t.key === 'budget' ? budgetTileTitle() : t.title;
      const desc = t.key === 'budget' ? budgetTileDesc() : t.desc;
      const div = document.createElement('div');
      div.className = 'tile';
      div.innerHTML = `
        <div class="ic-diamond ${t.color}" style="margin-bottom:14px;">${t.icon}</div>
        <h3>${title}</h3>
        <p>${desc}</p>
        <span class="arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg></span>`;
      div.addEventListener('click', () => openTile(t.key, title));
      row.appendChild(div);
    });
    grid.appendChild(row);
  });
}

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

function attentionItem(sectionKey, text) {
  const t = tiles.find(x => x.key === sectionKey);
  const div = document.createElement('div');
  div.className = 'emp-row';
  div.style.cursor = 'pointer';
  div.innerHTML = `
    <div class="ic-diamond ${t ? t.color : 'diamond-navy'}" style="width:34px; height:34px; border-radius:8px;">${t ? t.icon : ''}</div>
    <div class="info" style="font-size:13px; color:var(--ink);">${text}</div>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--slate)" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>`;
  div.addEventListener('click', () => openTile(sectionKey));
  return div;
}

export async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;
  renderSectionTilesGrid();
  container.innerHTML = '<div class="placeholder" style="padding:30px;"><p>جارٍ التحميل...</p></div>';

  if (currentProfile.role === 'admin' || currentProfile.role === 'deputy') {
    const weeklyWrap = document.getElementById('dash-weekly-schedule');
    if (weeklyWrap) weeklyWrap.innerHTML = ''; // الجدول الأسبوعي الملوّن خاص بالمعلم فقط
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
    attentionList.appendChild(attentionItem('weekly-tracking', `${missingCount} مادة لسا ما دخّل لها المعلمون خطة هذا الأسبوع`));
  }
  if (pendingApprovals > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('plan', `${pendingApprovals} مهام/إنجازات بالخطة التشغيلية بانتظار اعتمادك`));
  }
  if (unlinkedCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('portal', `${unlinkedCount} موظف بدون حساب دخول مربوط`));
  }
  if (dutyMissingCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('duty', `${dutyMissingCount} من مناوبي اليوم لسا ما سجّلت حضورهم`));
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

  container.innerHTML = `<div id="dash-my-schedule" style="margin-bottom:22px;"></div><div id="dash-attention-list"></div>`;
  renderMyWeeklyScheduleGrid();
  const { dayKey, dateStr } = todayInfo();
  renderMyScheduleWidget(container, dayKey, dateStr);

  const list = document.getElementById('dash-attention-list');
  let any = false;

  if (missingAssignments.length > 0) {
    any = true;
    const names = missingAssignments.map(a => a.subjects ? a.subjects.name : '').filter(Boolean).join('، ');
    list.appendChild(attentionItem('weekly', `لسا ما سلّمت خطة هذا الأسبوع لـ: ${names}`));
  } else if ((assignments || []).length > 0) {
    any = true;
    const t = tiles.find(x => x.key === 'weekly');
    const okDiv = document.createElement('div');
    okDiv.className = 'emp-row';
    okDiv.innerHTML = `<div class="ic-diamond ${t ? t.color : 'diamond-teal'}" style="width:34px; height:34px; border-radius:8px;">${t ? t.icon : ''}</div><div class="info" style="font-size:13px; color:var(--ink);">خطتك الأسبوعية مسلّمة لكل موادك 🎉</div>`;
    list.appendChild(okDiv);
  }

  if (opPlanPendingCount > 0) {
    any = true;
    list.appendChild(attentionItem('plan', `${opPlanPendingCount} مهمة أضفتها بالخطة التشغيلية بانتظار اعتماد المدير`));
  }

  if (!any) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه شي يحتاج انتباهك حاليًا</p></div>';
  }
}
