import { sb, currentUserId, currentProfile, isOpPlanMember, openTile, tiles, isTileAllowed, budgetTileTitle, budgetTileDesc, gradeLabels, GROUPS, currentSchoolId, readScopedBySchool, groupTilesFor, tileTitle } from './core.js';

/* ===== قراءة weekly_plans مقيّدة بمدرسة الحساب (نفس منطق js/weekly-plan.js) ===== */
async function readWeeklyPlansScoped(weekNumber) {
  let q = sb.from('weekly_plans').select('subject_id, grade_level').eq('week_number', weekNumber);
  if (currentSchoolId) q = q.eq('school_id', currentSchoolId);
  let res = await q;
  if (res.error && currentSchoolId) {
    res = await sb.from('weekly_plans').select('subject_id, grade_level').eq('week_number', weekNumber);
  }
  return res;
}

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
  const { data: rows } = await readScopedBySchool(scoped => {
    let q = sb.from('class_schedules')
      .select('day_of_week, period_number, grade_level, class_section, subject_name, teacher_name');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
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

  wrap.innerHTML = `<div class="home-card" style="margin-top:16px;"><h3>جدولك الدراسي الأسبوعي</h3>${gridHtml}</div>`;
}

// جدول اليوم الخاص بالمعلم كما يظهر بصفحته الرئيسية: يقارن جدوله الأصلي بأي تغييرات
// (تعويض غياب أو تبديل حصص) مسجّلة بـ daily_schedule_changes لنفس التاريخ، ويبرز أي فرق
async function loadMyTodayScheduleLines(dayKey, dateStr) {
  const myName = normalizeArText(currentProfile.full_name);
  const [{ data: baselineRows }, { data: changeRows }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('class_schedules').select('*').eq('day_of_week', dayKey);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('daily_schedule_changes').select('*').eq('change_date', dateStr);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
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
    ? '<div style="font-size:13.5px; color:var(--slate);">ما عندك حصص اليوم</div>'
    : lines.map(l => `<div style="padding:10px 12px; border-radius:10px; font-size:13.5px; ${l.highlighted ? 'background:#FDEDEC; color:#9B2F28; font-weight:600;' : 'background:var(--sand); color:var(--ink);'}">${l.html}</div>`).join('');
  wrap.innerHTML = `<div class="home-card"><h3>جدولك اليوم</h3>${bodyHtml}</div>`;
  const hero = document.getElementById('day-hero-count');
  if (hero) {
    const n = lines.length;
    hero.textContent = n ? `عندك ${n} ${n === 1 ? 'حصة' : n === 2 ? 'حصتين' : n <= 10 ? 'حصص' : 'حصة'} اليوم` : 'ما عندك حصص اليوم';
  }
}

/* بطاقات مساحات العمل أسفل الرئيسية: كل مساحة بأقسامها المسموحة للمستخدم */
const WS_COLORS = { students: ['#E3F4F7', '#0B6E7E'], teachers: ['#EFEBFB', '#5A3E9E'], exams: ['#FDEFE3', '#A4501A'], admin: ['#EAF1FC', '#2455A4'] };
function renderSectionTilesGrid() {
  const grid = document.getElementById('dash-sections-grid');
  if (!grid) return;
  grid.innerHTML = GROUPS.map(g => {
    const list = groupTilesFor(g.key);
    if (!list.length) return '';
    const [bg, fg] = WS_COLORS[g.key] || ['var(--sand)', 'var(--ink)'];
    return `<div class="ws-card">
      <div class="ws-head"><span class="ws-ic" style="background:${bg}; color:${fg};">${g.icon}</span>${g.title}</div>
      <div class="ws-links">${list.map(t => `<a href="#/${t.key}" data-key="${t.key}">${esc(tileTitle(t))}</a>`).join('')}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('a[data-key]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    const t = tiles.find(x => x.key === a.dataset.key);
    openTile(a.dataset.key, t ? tileTitle(t) : '');
  }));
}

/* ترحيب + اختصارات سريعة حسب الدور */
const QUICK_ACTIONS = {
  admin: [['visits', 'زيارة صفية'], ['substitutes', 'بدلاء اليوم'], ['weekly-tracking', 'متابعة الخطط'], ['exams', 'الاختبارات واللجان'], ['exam-reports', 'تقارير الاختبارات']],
  // المعلم: "خطتي الأسبوعية" و"بدلاء اليوم" موجودة أصلًا كأزرار بكرت «يومك» - ما نكررها هنا
  teacher: [['duty', 'مناوبتي'], ['visits', 'زياراتي الصفية'], ['tracking', 'متابعة الاختبارات']],
};
function renderHomeHeader() {
  const now = new Date();
  const first = String(currentProfile.full_name || '').trim().split(/\s+/)[0] || '';
  const role = currentProfile.role;
  const hero = document.querySelector('#tiles-view .home-hero');
  if (hero) hero.classList.toggle('hero-centered', role === 'deputy');
  const g = document.getElementById('home-greeting');
  const dateStr = now.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sub = document.getElementById('home-sub');
  if (role === 'admin') {
    if (g) g.textContent = 'لوحة القيادة';
    if (sub) sub.textContent = `${dateStr}${first ? ' · مرحبًا ' + first : ''}`;
  } else if (role === 'deputy') {
    if (g) g.textContent = 'وش تبي تسوي اليوم؟';
    if (sub) sub.textContent = `${now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير'}${first ? '، ' + first : ''} · ${dateStr}`;
  } else {
    if (g) g.textContent = `${now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير'}${first ? '، ' + first : ''}`;
    if (sub) sub.textContent = dateStr;
  }
  // الوكيل: بحث كبير بوسط الصفحة (من اتجاه «مساحات العمل»)
  const big = document.getElementById('home-bigsearch');
  if (big) {
    big.innerHTML = role === 'deputy'
      ? `<button type="button" class="big-search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span>اكتب اسم طالب، أو معلم، أو قسم...</span><kbd>Ctrl K</kbd></button>`
      : '';
    const b = big.querySelector('.big-search');
    if (b) b.addEventListener('click', async () => { const m = await import('./search.js'); m.openSearch(); });
  }
  const q = document.getElementById('home-quick');
  if (!q) return;
  q.classList.toggle('quick-centered', role === 'deputy');
  const qRole = role === 'deputy' ? 'admin' : role;
  const list = (QUICK_ACTIONS[qRole] || []).map(([key, label]) => ({ t: tiles.find(x => x.key === key), label })).filter(x => x.t && isTileAllowed(x.t));
  q.innerHTML = list.map(x => `<button type="button" class="quick-chip" data-key="${x.t.key}">${x.t.icon}${esc(x.label)}</button>`).join('');
  q.querySelectorAll('.quick-chip').forEach(b => b.addEventListener('click', () => {
    const t = tiles.find(x => x.key === b.dataset.key);
    openTile(b.dataset.key, t ? tileTitle(t) : '');
  }));
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

function kpi(label, value, note = '', barPct = null, color = '') {
  return `<div class="kpi"><span class="k-label">${label}</span><span class="k-value"${color ? ` style="color:${color};"` : ''}>${value}</span>${barPct != null ? `<div class="k-bar"><div style="width:${Math.max(0, Math.min(100, barPct))}%;"></div></div>` : ''}${note ? `<span class="k-note">${note}</span>` : ''}</div>`;
}

// عنصر "يحتاج قرارك": شريط لون للأهمية + نص + زر يفتح القسم مباشرة
const ATTN_COLORS = { high: '#C0453D', mid: '#E07A34', low: '#2455A4' };
function attentionItem(sectionKey, text, opts = {}) {
  const t = tiles.find(x => x.key === sectionKey);
  const div = document.createElement('div');
  div.className = 'attn';
  div.innerHTML = `
    <span class="bar" style="background:${ATTN_COLORS[opts.level || 'mid']};"></span>
    <div class="txt"><b>${text}</b><span>${t ? esc(tileTitle(t)) : ''}${opts.note ? ' · ' + opts.note : ''}</span></div>
    <button type="button" class="${opts.primary ? '' : 'ghost'}">${opts.action || 'فتح'}</button>`;
  div.querySelector('button').addEventListener('click', () => openTile(sectionKey, t ? tileTitle(t) : ''));
  return div;
}

export async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;
  renderHomeHeader();
  renderSectionTilesGrid();
  container.innerHTML = '<div class="kpi-grid">' + '<div class="kpi" style="min-height:92px; background:#EEF1F6; border-color:transparent;"></div>'.repeat(4) + '</div>';

  // كل دور له شكل: المدير ← لوحة القيادة المكثفة، الوكيل ← نظرة عامة مع بحث كبير واختصارات، المعلم ← «يومك»
  if (currentProfile.role === 'admin' || currentProfile.role === 'deputy') {
    const weeklyWrap = document.getElementById('dash-weekly-schedule');
    if (weeklyWrap) weeklyWrap.innerHTML = ''; // الجدول الأسبوعي الملوّن خاص بالمعلم فقط
    if (currentProfile.role === 'admin') await renderCommandDashboard(container);
    else await renderAdminDashboard(container);
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
    readScopedBySchool(scoped => {
      let q = sb.from('employees').select('id', { count: 'exact', head: true });
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('employees').select('id', { count: 'exact', head: true }).not('profile_id', 'is', null);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('op_task_completions').select('status');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('op_tasks').select('id').eq('plan_status', 'pending');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('op_task_completions').select('id').eq('status', 'pending');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    sb.from('subjects').select('id'), // المواد الدراسية مشتركة بين كل المدارس عن قصد (منهج رسمي موحّد)
    readWeeklyPlansScoped(1),
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
  let dutyTodayTotal = 0;
  if (dayKey) {
    const [{ data: fixed }, { data: weekly }, { data: attendance }] = await Promise.all([
      readScopedBySchool(scoped => {
        let q = sb.from('duty_roster').select('teacher_profile_id, duty_type_id').eq('kind', 'fixed').eq('day_of_week', dayKey);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      }),
      readScopedBySchool(scoped => {
        let q = sb.from('duty_roster').select('teacher_profile_id, duty_type_id').eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday());
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      }),
      readScopedBySchool(scoped => {
        let q = sb.from('duty_attendance').select('teacher_profile_id, duty_type_id').eq('duty_date', dateStr);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      }),
    ]);
    const todayEntries = [...(fixed || []), ...(weekly || [])];
    dutyTodayTotal = todayEntries.length;
    const recordedSet = new Set((attendance || []).map(a => a.teacher_profile_id + '_' + a.duty_type_id));
    dutyMissingCount = todayEntries.filter(e => !recordedSet.has(e.teacher_profile_id + '_' + e.duty_type_id)).length;
  }

  const unlinkedCount = (employeesCount || 0) - (linkedCount || 0);
  const totalDutyToday = dayKey ? dutyTodayTotal : 0;

  container.innerHTML = `
    <div class="kpi-grid">
      ${kpi('إنجاز الخطة التشغيلية', completionRate + '%', `${approvedCompletions} من ${totalCompletions} معتمدة`, completionRate)}
      ${kpi('بانتظار اعتمادك', pendingApprovals, 'بالخطة التشغيلية', null, pendingApprovals ? '#A4501A' : '')}
      ${kpi('مواد ناقصة هذا الأسبوع', missingCount, 'بالخطة الأسبوعية', null, missingCount ? '#9B2F28' : '')}
      ${kpi('الموظفين', employeesCount ?? 0, unlinkedCount > 0 ? `${unlinkedCount} بدون حساب دخول` : 'كلهم بحسابات دخول')}
    </div>
    <div class="home-cols">
      <section class="home-card" style="flex:3 1 420px;"><h3>يحتاج قرارك</h3><div id="dash-attention-list" style="display:flex; flex-direction:column; gap:8px;"></div></section>
      <section class="home-card" style="flex:2 1 300px;"><h3>اليوم في المدرسة</h3><div id="dash-today" style="display:flex; flex-direction:column; gap:2px;"><div style="font-size:13px; color:var(--slate);">جارٍ التحميل...</div></div></section>
    </div>`;

  const attentionList = document.getElementById('dash-attention-list');
  let anyAttention = false;

  if (pendingApprovals > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('plan', `${pendingApprovals} مهام/إنجازات بالخطة التشغيلية بانتظار اعتمادك`, { level: 'high', action: 'مراجعة', primary: true }));
  }
  if (missingCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('weekly-tracking', `${missingCount} مادة لسا ما دخّل لها المعلمون خطة هذا الأسبوع`, { level: 'mid', action: 'عرض الناقص' }));
  }
  if (dutyMissingCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('duty', `${dutyMissingCount} من مناوبي اليوم لسا ما سجّلت حضورهم`, { level: 'mid', action: 'تسجيل الحضور' }));
  }
  if (unlinkedCount > 0) {
    anyAttention = true;
    attentionList.appendChild(attentionItem('portal', `${unlinkedCount} موظف بدون حساب دخول مربوط`, { level: 'low', action: 'ربط الحسابات' }));
  }
  if (!anyAttention) {
    attentionList.innerHTML = '<div style="font-size:13.5px; color:var(--slate); padding:6px 0;">كل شي محدّث، ما فيه شي يحتاج قرارك حاليًا.</div>';
  }
  renderTodayCard(dayKey, dateStr, totalDutyToday, dutyMissingCount);
}

/* "اليوم في المدرسة": المناوبات، تغييرات الجدول، الاختبار الفتري القادم، زيارات الشهر */
async function renderTodayCard(dayKey, dateStr, dutyTotal, dutyMissing) {
  const box = document.getElementById('dash-today');
  if (!box) return;
  const monthStart = dateStr.slice(0, 8) + '01';
  const [{ data: changes }, { data: coverage }, { data: visits }] = await Promise.all([
    dayKey ? readScopedBySchool(scoped => {
      let q = sb.from('daily_schedule_changes').select('id').eq('change_date', dateStr);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }) : Promise.resolve({ data: [] }),
    readScopedBySchool(scoped => {
      let q = sb.from('subject_exam_coverage').select('subject_name, grade_level, exam_date').gte('exam_date', dateStr);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('classroom_visits').select('id').gte('visit_date', monthStart);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);
  const row = (label, text, key, linkText) => {
    const t = key ? tiles.find(x => x.key === key) : null;
    const link = t && isTileAllowed(t) ? ` <button type="button" data-key="${key}">${linkText}</button>` : '';
    return `<div class="today-row"><span class="t">${label}</span><span>${text}${link}</span></div>`;
  };
  let html = '';
  if (!dayKey) html += row('اليوم', 'إجازة نهاية الأسبوع');
  else {
    html += row('المناوبات', dutyTotal ? `${dutyTotal} مناوبة اليوم${dutyMissing ? ` · ${dutyMissing} بدون تسجيل حضور` : ' · كلها مسجّلة'}` : 'ما فيه مناوبات مسجلة لليوم', 'duty', 'فتح');
    const nChanges = (changes || []).length;
    html += row('الجدول', nChanges ? `${nChanges} تغيير على حصص اليوم (انتظار/تبديل)` : 'ما فيه تغييرات على جدول اليوم', 'substitutes', nChanges ? 'عرض' : 'توزيع بدلاء');
  }
  const next = (coverage || []).filter(r => r.exam_date).sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];
  if (next) {
    const d = new Date(next.exam_date + 'T00:00:00');
    const days = Math.round((d - new Date(dateStr + 'T00:00:00')) / 86400000);
    html += row('الفترية', `${esc(next.subject_name)} · ${esc(gradeLabels[next.grade_level] || '')} · ${days === 0 ? 'اليوم' : days === 1 ? 'بكرة' : `بعد ${days} أيام`}`, 'schedule', 'الجدول');
  }
  html += row('الزيارات', `${(visits || []).length} زيارة صفية هذا الشهر`, 'visits', '+ زيارة');
  box.innerHTML = html;
  box.querySelectorAll('button[data-key]').forEach(b => b.addEventListener('click', () => {
    const t = tiles.find(x => x.key === b.dataset.key);
    openTile(b.dataset.key, t ? tileTitle(t) : '');
  }));
}

async function renderTeacherDashboard(container) {
  const { data: assignments } = await sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)').eq('teacher_id', currentUserId);
  const { data: weeklyPlansThisWeek } = await readWeeklyPlansScoped(1);
  const enteredSet = new Set((weeklyPlansThisWeek || []).map(p => p.subject_id + '_' + p.grade_level));

  const missingAssignments = (assignments || []).filter(a => !enteredSet.has(a.subject_id + '_' + a.grade_level));

  let opPlanPendingCount = 0;
  if (isOpPlanMember) {
    const { data: myPending } = await sb.from('op_tasks').select('id').eq('employee_profile_id', currentUserId).eq('plan_status', 'pending');
    opPlanPendingCount = (myPending || []).length;
  }

  container.innerHTML = `
    <div class="day-hero">
      <span class="dh-label">يومك</span>
      <span class="dh-big" id="day-hero-count">جدول اليوم</span>
      <div class="dh-actions" id="day-hero-actions"></div>
    </div>
    <div class="home-cols">
      <div id="dash-my-schedule" style="flex:3 1 380px; min-width:0;"></div>
      <section class="home-card" style="flex:2 1 300px;"><h3>مهامي</h3><div id="dash-attention-list" style="display:flex; flex-direction:column; gap:8px;"></div></section>
    </div>`;
  const heroActions = document.getElementById('day-hero-actions');
  [['weekly', 'خطتي الأسبوعية', ''], ['substitutes', 'بدلاء اليوم', 'alt']].forEach(([key, label, cls]) => {
    const t = tiles.find(x => x.key === key);
    if (!t || !isTileAllowed(t)) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label;
    b.addEventListener('click', () => openTile(key, tileTitle(t)));
    heroActions.appendChild(b);
  });
  renderMyWeeklyScheduleGrid();
  const { dayKey, dateStr } = todayInfo();
  renderMyScheduleWidget(container, dayKey, dateStr);

  const list = document.getElementById('dash-attention-list');
  let any = false;

  if (missingAssignments.length > 0) {
    any = true;
    const names = missingAssignments.map(a => a.subjects ? a.subjects.name : '').filter(Boolean).join('، ');
    list.appendChild(attentionItem('weekly', `لسا ما سلّمت خطة هذا الأسبوع لـ: ${names}`, { level: 'high', action: 'تسليم الخطة', primary: true }));
  } else if ((assignments || []).length > 0) {
    any = true;
    const t = tiles.find(x => x.key === 'weekly');
    const okDiv = document.createElement('div');
    okDiv.className = 'attn';
    okDiv.innerHTML = `<span class="bar" style="background:#2E9155;"></span><div class="txt"><b>خطتك الأسبوعية مسلّمة لكل موادك</b><span>${t ? esc(tileTitle(t)) : ''}</span></div>`;
    list.appendChild(okDiv);
  }

  if (opPlanPendingCount > 0) {
    any = true;
    list.appendChild(attentionItem('plan', `${opPlanPendingCount} مهمة أضفتها بالخطة التشغيلية بانتظار اعتماد المدير`, { level: 'low' }));
  }

  if (!any) {
    list.innerHTML = '<div style="font-size:13.5px; color:var(--slate); padding:6px 0;">ما عندك مهام معلّقة حاليًا.</div>';
  }
}


/* =========================================================================
 * لوحة القيادة المكثفة (المدير): مؤشرات مع مقارنة، رفع الخطط حسب المادة والمرحلة،
 * تنبيهات، تنفيذ الخطة التشغيلية أسبوع بأسبوع، واليوم في المدرسة.
 * ========================================================================= */
const GRADE_KEYS = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const GRADE_SHORT = { first_intermediate: 'أول', second_intermediate: 'ثاني', third_intermediate: 'ثالث' };

function trend(cur, prev) {
  if (prev == null) return '';
  if (cur > prev) return `<span style="color:#1F6A3C;">▲ ${cur - prev} عن الشهر الماضي</span>`;
  if (cur < prev) return `<span style="color:#9B2F28;">▼ ${prev - cur} عن الشهر الماضي</span>`;
  return 'مثل الشهر الماضي';
}

async function renderCommandDashboard(container) {
  const { dayKey, dateStr } = todayInfo();
  const monthStart = dateStr.slice(0, 8) + '01';
  const lm = new Date(dateStr + 'T00:00:00'); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);
  const lastMonthStart = lm.toISOString().slice(0, 10);
  const scoped = (table, cols, build) => readScopedBySchool(sc => {
    let q = sb.from(table).select(cols);
    if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return build ? build(q) : q;
  });

  const [
    { data: completions }, { data: pendingTasks }, { data: subjects }, { data: assignments },
    { data: plans }, { data: visits }, { data: reports },
  ] = await Promise.all([
    scoped('op_task_completions', 'status, period_label'),
    scoped('op_tasks', 'id', q => q.eq('plan_status', 'pending')),
    sb.from('subjects').select('id, name'),
    sb.from('teacher_subjects').select('subject_id, grade_level'),
    readWeeklyPlansScoped(1),
    scoped('classroom_visits', 'id, visit_date', q => q.gte('visit_date', lastMonthStart)),
    scoped('exam_reports', 'title, stats, created_at', q => q.order('created_at', { ascending: false }).limit(1)),
  ]);

  const comp = completions || [];
  const approved = comp.filter(c => c.status === 'approved').length;
  const pendingComp = comp.filter(c => c.status === 'pending').length;
  const pendingApprovals = (pendingTasks || []).length + pendingComp;
  const opRate = comp.length ? Math.round(approved / comp.length * 100) : 0;

  // الخانات المتوقعة: (مادة، مرحلة) لها معلم مسند - ولو ما فيه إسناد نعتبر كل المواد بكل المراحل
  const expected = new Set((assignments || []).map(a => a.subject_id + '_' + a.grade_level));
  const useAll = expected.size === 0;
  const entered = new Set((plans || []).map(p => p.subject_id + '_' + p.grade_level));
  const subjRows = (subjects || []).map(sj => {
    const cells = GRADE_KEYS.map(g => {
      const k = sj.id + '_' + g;
      const exp = useAll || expected.has(k);
      return { exp, done: exp && entered.has(k) };
    });
    const exp = cells.filter(c => c.exp).length, done = cells.filter(c => c.done).length;
    return { name: sj.name, cells, exp, done, pct: exp ? Math.round(done / exp * 100) : null };
  }).filter(r => r.exp > 0).sort((a, b) => (a.pct - b.pct) || a.name.localeCompare(b.name, 'ar'));
  const expTotal = subjRows.reduce((a, r) => a + r.exp, 0), doneTotal = subjRows.reduce((a, r) => a + r.done, 0);
  const plansPct = expTotal ? Math.round(doneTotal / expTotal * 100) : 0;

  const vThis = (visits || []).filter(v => v.visit_date >= monthStart).length;
  const vLast = (visits || []).filter(v => v.visit_date < monthStart).length;
  const lastReport = (reports || [])[0];
  const examPct = lastReport && lastReport.stats && lastReport.stats.meanPct != null ? Math.round(lastReport.stats.meanPct) : null;

  // تنفيذ الخطة التشغيلية لكل أسبوع (من تسمية الفترة "الأسبوع N")
  const byWeek = new Map();
  comp.forEach(c => {
    const m = String(c.period_label || '').match(/(\d+)/);
    if (!m) return;
    const w = +m[1];
    if (!byWeek.has(w)) byWeek.set(w, { total: 0, ok: 0 });
    const e = byWeek.get(w); e.total++; if (c.status === 'approved') e.ok++;
  });
  const weeks = [...byWeek.keys()].sort((a, b) => a - b).slice(-8);

  container.innerHTML = `
    <div class="kpi-grid">
      ${kpi('رفع الخطط الأسبوعية', plansPct + '%', `${doneTotal} من ${expTotal} خانة (مادة × مرحلة)`, plansPct)}
      ${kpi('إنجاز الخطة التشغيلية', opRate + '%', `${approved} من ${comp.length} معتمدة`, opRate)}
      ${kpi('بانتظار اعتمادك', pendingApprovals, 'بالخطة التشغيلية', null, pendingApprovals ? '#A4501A' : '')}
      ${kpi('الزيارات الصفية هذا الشهر', vThis, trend(vThis, vLast))}
      ${kpi('متوسط آخر اختبار', examPct != null ? examPct + '%' : '—', lastReport ? esc(lastReport.title) : 'ما فيه تقارير اختبارات بعد')}
    </div>
    <div class="home-cols">
      <section class="home-card" style="flex:3 1 460px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><h3>رفع الخطط الأسبوعية حسب المادة</h3><button type="button" class="cmd-link" data-key="weekly-tracking">التفاصيل</button></div>
        ${subjRows.length ? `<div style="overflow-x:auto;"><table class="cmd-table">
          <thead><tr><th class="al-r">المادة</th>${GRADE_KEYS.map(g => `<th>${GRADE_SHORT[g]}</th>`).join('')}<th style="width:32%;">النسبة</th></tr></thead>
          <tbody>${subjRows.map(r => `<tr>
            <td class="al-r" style="font-weight:600;">${esc(r.name)}</td>
            ${r.cells.map(c => `<td>${!c.exp ? '<span style="color:#C3CAD6;">·</span>' : c.done ? '<span class="ok" aria-label="مرفوعة">✓</span>' : '<span class="miss" aria-label="ناقصة">—</span>'}</td>`).join('')}
            <td><div class="cmd-bar"><div style="width:${r.pct}%;"></div></div></td></tr>`).join('')}</tbody></table></div>`
          : '<div style="font-size:13.5px; color:var(--slate);">ما فيه مواد مسندة للمعلمين بعد</div>'}
      </section>
      <section class="home-card cmd-alerts" style="flex:2 1 300px;"><h3>يحتاج قرارك</h3><div id="dash-attention-list" style="display:flex; flex-direction:column; gap:8px;"></div></section>
    </div>
    <div class="home-cols" style="margin-top:16px;">
      <section class="home-card" style="flex:3 1 460px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><h3>تنفيذ الخطة التشغيلية أسبوعيًا</h3><button type="button" class="cmd-link" data-key="plan">الخطة التشغيلية</button></div>
        ${weeks.length ? `<div class="cmd-chart" role="img" aria-label="نسبة الإنجاز المعتمد لكل أسبوع">${weeks.map(w => {
          const e = byWeek.get(w); const pct = e.total ? Math.round(e.ok / e.total * 100) : 0;
          return `<div class="cc-col"><span class="cc-val">${pct}%</span><div class="cc-bar" style="height:${Math.max(4, pct)}%;" title="${e.ok} من ${e.total}"></div><span class="cc-lbl">أ${w}</span></div>`;
        }).join('')}</div><div style="font-size:12px; color:var(--slate);">نسبة المهام المعتمد إنجازها من المسجّلة لكل أسبوع</div>`
          : '<div style="font-size:13.5px; color:var(--slate);">ما فيه إنجازات مسجّلة بالخطة التشغيلية بعد</div>'}
      </section>
      <section class="home-card" style="flex:2 1 300px;"><h3>اليوم في المدرسة</h3><div id="dash-today" style="display:flex; flex-direction:column; gap:2px;"><div style="font-size:13px; color:var(--slate);">جارٍ التحميل...</div></div></section>
    </div>`;

  container.querySelectorAll('.cmd-link').forEach(b => b.addEventListener('click', () => {
    const t = tiles.find(x => x.key === b.dataset.key);
    if (t && isTileAllowed(t)) openTile(t.key, tileTitle(t));
  }));

  // التنبيهات + اليوم: نفس بيانات النظرة العامة
  const list = document.getElementById('dash-attention-list');
  const missing = expTotal - doneTotal;
  let any = false;
  if (pendingApprovals > 0) { any = true; list.appendChild(attentionItem('plan', `${pendingApprovals} بانتظار اعتمادك بالخطة التشغيلية`, { level: 'high', action: 'مراجعة', primary: true })); }
  if (missing > 0) { any = true; list.appendChild(attentionItem('weekly-tracking', `${missing} ${missing >= 3 && missing <= 10 ? 'خطط أسبوعية' : 'خطة أسبوعية'} لم تُرفع`, { level: 'mid', action: 'عرض' })); }

  let dutyTotal = 0, dutyMissing = 0;
  if (dayKey) {
    const [{ data: fixed }, { data: weekly }, { data: att }] = await Promise.all([
      scoped('duty_roster', 'teacher_profile_id, duty_type_id', q => q.eq('kind', 'fixed').eq('day_of_week', dayKey)),
      scoped('duty_roster', 'teacher_profile_id, duty_type_id', q => q.eq('kind', 'weekly').eq('day_of_week', dayKey).eq('week_start_date', thisWeekSunday())),
      scoped('duty_attendance', 'teacher_profile_id, duty_type_id', q => q.eq('duty_date', dateStr)),
    ]);
    const entries = [...(fixed || []), ...(weekly || [])];
    const rec = new Set((att || []).map(a => a.teacher_profile_id + '_' + a.duty_type_id));
    dutyTotal = entries.length;
    dutyMissing = entries.filter(e => !rec.has(e.teacher_profile_id + '_' + e.duty_type_id)).length;
    if (dutyMissing > 0) { any = true; list.appendChild(attentionItem('duty', `${dutyMissing} من مناوبي اليوم بدون تسجيل حضور`, { level: 'mid', action: 'تسجيل' })); }
  }
  if (!any) list.innerHTML = '<div style="font-size:13.5px; color:var(--slate); padding:6px 0;">كل شي محدّث، ما فيه شي يحتاج قرارك حاليًا.</div>';
  renderTodayCard(dayKey, dateStr, dutyTotal, dutyMissing);
}
