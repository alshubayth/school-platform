import { sb, currentUserId, isAdminOrDeputy, gradeLabels,
         isOpPlanMember, setOpPlanMember, setupCollapsible } from './core.js';
import { loadXLSX } from './lib-loader.js';

/* ================= الخطة التشغيلية ================= */
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
// نفس فكرة الحماية بـ setupCollapsible بملف core.js: لو عنصر بالصفحة مفقود (نسخة index.html
// ما تحدّثت مع هذا الملف) نتجاهل ربط الحدث بهدوء بدل ما نرمي خطأ يوقف تحميل باقي الوحدة كاملة.
function onEl(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) { console.warn('operational-plan: عنصر مفقود بالصفحة', id); return; }
  el.addEventListener(event, handler);
}

let opPlanWeek = 1;
let goalsCache = [], objectivesCache = [], programsCache = [];
let totalProgramsCount = 0; // إجمالي البرامج الرسمية بدون فلترة (43) - للمقارنة بالإحصائية فقط

// تحميل مكتبة Chart.js عند الحاجة بس (نفس أسلوب budget.js) - أرسم الرسوم البيانية فقط
// لو نجح التحميل، وإلا نكتفي بالبطاقات والأشرطة بهدوء بدون كسر باقي الصفحة
let chartLibPromise = null;
function loadChartLib() {
  if (window.Chart) return Promise.resolve();
  if (chartLibPromise) return chartLibPromise;
  chartLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload = resolve;
    s.onerror = () => { chartLibPromise = null; reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')); };
    document.head.appendChild(s);
  });
  return chartLibPromise;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
// يقسّم عنوان الهدف الطويل لأسطر قصيرة (كلمتين بالسطر) عشان يتقرأ تحت أعمدة الرسم البياني
function wrapGoalLabel(title) {
  const words = (title || '').trim().split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += 2) lines.push(words.slice(i, i + 2).join(' '));
  return lines;
}
let goalsBarChartInstance = null;
let statusDonutChartInstance = null;

// ترتيب الأهداف الاستراتيجية الستة الرسمية ثابت (بنفس ترتيب زرعها بقاعدة البيانات) - نستخدمه
// لتلوين كل هدف بلون تصنيفي ثابت (--goal-1..6 بملف styles.css) بدل ما يتغير اللون حسب ترتيب
// وصول البيانات من قاعدة البيانات (اللي مو مضمون ترتيبه)
const GOAL_TITLE_ORDER = [
  'تمكين الطلاب من المعارف والمهارات والقيم اللازمة لاحتياجات سوق العمل المستقبلية',
  'تطوير قدرات الكوادر التعليمية',
  'تحقيق التميز على المستوى المحلي والدولي',
  'تهيئة بيئة تعليمية نموذجية محفزة للإبداع والابتكار',
  'تعزيز الشراكة المجتمعية بما يحقق التنمية المستدامة',
  'تحقيق الاستدامة المالية في منظومة التعليم العام',
];
function goalColorVar(goalTitle) {
  const idx = GOAL_TITLE_ORDER.indexOf((goalTitle || '').trim());
  const slot = idx >= 0 ? idx + 1 : 1;
  return `var(--goal-${slot})`;
}

export async function loadOpPlanModule() {
  document.getElementById('opplan-admin-view').classList.add('hidden');
  document.getElementById('opplan-employee-view').classList.add('hidden');
  document.getElementById('opplan-not-member').classList.add('hidden');

  if (isAdminOrDeputy()) {
    document.getElementById('opplan-subtitle').textContent = 'إدارة الأهداف والبرامج ومراجعة الاعتمادات';
    document.getElementById('opplan-admin-view').classList.remove('hidden');
    await loadOpPlanAdminData();
  } else {
    const { data: membership } = await sb.from('operational_plan_members').select('id').eq('profile_id', currentUserId).maybeSingle();
    setOpPlanMember(!!membership);
    if (isOpPlanMember) {
      document.getElementById('opplan-subtitle').textContent = 'مهامك ضمن الخطة التشغيلية';
      document.getElementById('opplan-employee-view').classList.remove('hidden');
      await loadOpPlanEmployeeData();
    } else {
      document.getElementById('opplan-not-member').classList.remove('hidden');
    }
  }
}

/* ---------- بيانات الهيكل (مشتركة) ---------- */
async function refreshStructureCaches() {
  const [{ data: goals }, { data: objectives }, { data: programs }] = await Promise.all([
    sb.from('strategic_goals').select('id, title'),
    sb.from('operational_objectives').select('id, title, strategic_goal_id'),
    sb.from('programs').select('id, title, operational_objective_id, department, school_indicator, plan_code, applies_to_intermediate'),
  ]);
  goalsCache = goals || [];
  objectivesCache = objectives || [];
  const allPrograms = programs || [];
  totalProgramsCount = allPrograms.length;
  // نعرض وندوّر بس البرامج المتعلقة بمرحلة المتوسط - العمود قد ما يكون موجود لبرامج مضافة يدويًا
  // قبل هذا التحديث (تُعامل null/undefined كـ "تنطبق" افتراضيًا، مو كاستبعاد)
  programsCache = allPrograms.filter(p => p.applies_to_intermediate !== false);
}

/* ---------- شاشة المدير ---------- */
async function loadOpPlanAdminData() {
  await refreshStructureCaches();

  // قائمة المشاركين المتاحين للإضافة
  const { data: allStaff } = await sb.from('profiles').select('id, full_name').in('role', ['teacher','deputy']);
  const empSelect = document.getElementById('opm-employee');
  empSelect.innerHTML = '';
  (allStaff || []).forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.full_name; empSelect.appendChild(o); });

  // قوائم الهدف العام والتشغيلي
  const goalSelect = document.getElementById('oo-goal');
  goalSelect.innerHTML = '';
  goalsCache.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.title; goalSelect.appendChild(o); });

  const objSelect = document.getElementById('pr-objective');
  objSelect.innerHTML = '';
  objectivesCache.forEach(o2 => { const o = document.createElement('option'); o.value = o2.id; o.textContent = o2.title; objSelect.appendChild(o); });

  await refreshMembersList();
  await refreshOpPlanApprovals();
  await renderOpPlanGuide();
}

/* ---------- دليل الخطة الرسمية: داشبورد متابعة تنفيذ مدرستنا (مرحلة المتوسط فقط) ---------- */
// نسبة التنفيذ لكل برنامج = عدد مهامه الأسبوعية (op_tasks) المعتمدة واللي لها إنجاز معتمد، من
// إجمالي مهامه الأسبوعية المعتمدة - محسوبة تلقائيًا من نفس بيانات المهام الأسبوعية الموجودة،
// بدل ما يحتاج أحد يسجّل نسبة يدويًا لكل برنامج
function statusInfo(myTasksCount, pct) {
  if (myTasksCount === 0) return { cls: 'idle', icon: '○', label: 'لم يبدأ' };
  if (pct >= 70) return { cls: 'good', icon: '✓', label: pct + '%' };
  if (pct >= 30) return { cls: 'warn', icon: '◐', label: pct + '%' };
  return { cls: 'bad', icon: '!', label: pct + '%' };
}
function statusBarColor(cls) {
  return cls === 'good' ? 'var(--status-good)' : cls === 'warn' ? 'var(--status-warn)' : cls === 'bad' ? 'var(--status-bad)' : 'var(--status-idle)';
}

async function renderOpPlanGuide() {
  const statsEl = document.getElementById('opplan-guide-stats');
  const goalsEl = document.getElementById('opplan-guide-goals');
  const legendEl = document.getElementById('opplan-guide-legend');
  const container = document.getElementById('opplan-guide-list');
  if (!container) return;
  container.innerHTML = '<p style="font-size:12.5px; color:var(--slate);">جارٍ التحميل...</p>';
  if (statsEl) statsEl.innerHTML = '';
  if (goalsEl) goalsEl.innerHTML = '';
  if (legendEl) legendEl.innerHTML = '';

  if (programsCache.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه برامج رسمية مضافة بعد</p></div>';
    return;
  }

  const [{ data: allTasks }, { data: allCompletions }] = await Promise.all([
    sb.from('op_tasks').select('id, program_id, plan_status'),
    sb.from('op_task_completions').select('id, task_id, status'),
  ]);

  const tasksByProgram = new Map();
  (allTasks || []).forEach(t => {
    if (!t.program_id) return;
    if (!tasksByProgram.has(t.program_id)) tasksByProgram.set(t.program_id, []);
    tasksByProgram.get(t.program_id).push(t);
  });
  const completionsByTask = new Map();
  (allCompletions || []).forEach(c => {
    if (!completionsByTask.has(c.task_id)) completionsByTask.set(c.task_id, []);
    completionsByTask.get(c.task_id).push(c);
  });

  const objById = new Map(objectivesCache.map(o => [o.id, o]));
  const goalById = new Map(goalsCache.map(g => [g.id, g]));

  // نحسب نسبة كل برنامج مرة وحدة ونعيد استخدامها بالإحصائيات وبطاقات الأهداف وبطاقات البرامج
  const programStats = programsCache.map(p => {
    const obj = objById.get(p.operational_objective_id);
    const goal = obj ? goalById.get(obj.strategic_goal_id) : null;
    const myTasks = tasksByProgram.get(p.id) || [];
    const approvedTasks = myTasks.filter(t => t.plan_status === 'approved');
    const doneCount = approvedTasks.filter(t => (completionsByTask.get(t.id) || []).some(c => c.status === 'approved')).length;
    const pct = approvedTasks.length ? Math.round((doneCount / approvedTasks.length) * 100) : 0;
    return { program: p, obj, goal, myTasksCount: myTasks.length, approvedCount: approvedTasks.length, doneCount, pct };
  });

  const scopeNoteEl = document.getElementById('opplan-scope-note');
  if (scopeNoteEl) {
    const hiddenCount = totalProgramsCount - programsCache.length;
    if (hiddenCount > 0) {
      scopeNoteEl.textContent = `المعروض هنا برامج المرحلة المتوسطة فقط — أُخفيت ${hiddenCount} ${hiddenCount === 1 ? 'برنامج خاص' : 'برامج خاصة'} بالابتدائي والثانوي`;
      scopeNoteEl.classList.remove('hidden');
    } else {
      scopeNoteEl.classList.add('hidden');
    }
  }

  /* ---- 1) بطاقات الإحصائيات العلوية ---- */
  if (statsEl) {
    const started = programStats.filter(s => s.myTasksCount > 0);
    const avgPct = started.length ? Math.round(started.reduce((sum, s) => sum + s.pct, 0) / started.length) : 0;
    const inProgress = programStats.filter(s => s.myTasksCount > 0 && s.pct < 100).length;
    const activeGoals = new Set(programStats.filter(s => s.goal).map(s => s.goal.id)).size;
    statsEl.innerHTML = `
      <div class="op-stat-tile" style="--op-accent:var(--meadow);">
        <div class="lbl">البرامج المتابَعة</div>
        <div class="val">${programsCache.length}</div>
        <div class="sub">${totalProgramsCount > programsCache.length ? `من أصل ${totalProgramsCount} برنامج رسمي (${totalProgramsCount - programsCache.length} خاصة بمرحلة ثانية)` : 'كل البرامج الرسمية'}</div>
      </div>
      <div class="op-stat-tile" style="--op-accent:var(--status-good);">
        <div class="lbl">متوسط نسبة الإنجاز</div>
        <div class="val">${avgPct}%</div>
        <div class="sub">عبر البرامج اللي بدأ العمل عليها</div>
      </div>
      <div class="op-stat-tile" style="--op-accent:var(--gold);">
        <div class="lbl">قيد التنفيذ الآن</div>
        <div class="val">${inProgress}</div>
        <div class="sub">برنامج له مهام أسبوعية معتمدة</div>
      </div>
      <div class="op-stat-tile" style="--op-accent:var(--purple);">
        <div class="lbl">الأهداف الاستراتيجية</div>
        <div class="val">${activeGoals}</div>
        <div class="sub">${objectivesCache.length} هدف تشغيلي تحتها</div>
      </div>`;
  }

  /* ---- 2) بطاقات الأهداف الاستراتيجية (تقدم مجمّع) ---- */
  const byGoal = new Map();
  programStats.forEach(s => {
    if (!s.goal) return;
    if (!byGoal.has(s.goal.id)) byGoal.set(s.goal.id, { goal: s.goal, objIds: new Set(), programs: [] });
    const g = byGoal.get(s.goal.id);
    if (s.obj) g.objIds.add(s.obj.id);
    g.programs.push(s);
  });
  const goalCards = Array.from(byGoal.values())
    .map(g => {
      const started = g.programs.filter(s => s.myTasksCount > 0);
      const pct = started.length ? Math.round(started.reduce((sum, s) => sum + s.pct, 0) / started.length) : 0;
      return { ...g, startedCount: started.length, pct };
    })
    .sort((a, b) => GOAL_TITLE_ORDER.indexOf(a.goal.title) - GOAL_TITLE_ORDER.indexOf(b.goal.title));

  if (goalsEl) {
    goalsEl.innerHTML = goalCards.map(g => {
      const st = statusInfo(g.startedCount, g.pct);
      const color = goalColorVar(g.goal.title);
      return `
        <div class="op-goal-card" style="--goal-color:${color};">
          <div class="gtitle"><span class="goal-dot"></span><h5>${esc(g.goal.title)}</h5></div>
          <div class="gmeta">${g.objIds.size} ${g.objIds.size === 1 ? 'هدف تشغيلي' : 'أهداف تشغيلية'} · ${g.programs.length} ${g.programs.length === 1 ? 'برنامج متابَع' : 'برامج متابَعة'}</div>
          <div class="gring">
            <span class="gpct">${g.pct}%</span>
            <div class="op-bar-track"><div class="op-bar-fill" style="width:${g.pct}%; background:${statusBarColor(st.cls)};"></div></div>
          </div>
        </div>`;
    }).join('');

    if (legendEl) {
      legendEl.innerHTML = goalCards.map(g => `
        <div class="op-legend-item"><span class="op-legend-dot" style="background:${goalColorVar(g.goal.title)};"></span>${esc(g.goal.title)}</div>
      `).join('');
    }
  }

  renderOpPlanCharts(goalCards, programStats);

  /* ---- 3) شبكة البرامج ---- */
  const sorted = programStats.slice().sort((a, b) => (a.program.plan_code || '').localeCompare(b.program.plan_code || '', 'en', { numeric: true }));

  container.innerHTML = sorted.map(s => {
    const { program: p, obj, goal, myTasksCount, pct } = s;
    const st = statusInfo(myTasksCount, pct);
    const color = goal ? goalColorVar(goal.title) : 'var(--meadow)';
    return `
      <div class="op-program-card" style="--goal-color:${color};" title="${esc(goal ? goal.title : '')}${obj ? ' ← ' + esc(obj.title) : ''}">
        <div class="phead">
          ${p.plan_code ? `<span class="op-plan-code">${esc(p.plan_code)}</span>` : '<span></span>'}
          <span class="op-status-chip ${st.cls}">${st.icon} ${st.label}</span>
        </div>
        <h5>${esc(p.title)}</h5>
        ${p.department ? `<div class="op-program-dept">${esc(p.department)}</div>` : ''}
        <div class="op-program-progress">
          <span class="ppct">${pct}%</span>
          <div class="op-bar-track"><div class="op-bar-fill" style="width:${pct}%; background:${statusBarColor(st.cls)};"></div></div>
        </div>
        ${p.school_indicator ? `<p style="margin:8px 0 0; font-size:11px; color:#444; white-space:pre-line;">${esc(p.school_indicator)}</p>` : ''}
      </div>`;
  }).join('');
}

/* ---- 4) رسمين تفاعليين (Chart.js): إنجاز كل هدف، وتوزيع حالة البرامج ---- */
async function renderOpPlanCharts(goalCards, programStats) {
  const barCanvas = document.getElementById('opplan-goals-bar-chart');
  const donutCanvas = document.getElementById('opplan-status-donut-chart');
  if (!barCanvas || !donutCanvas) return;
  try {
    await loadChartLib();
  } catch (e) {
    return; // ما فيه اتصال بالإنترنت أو فشل تحميل المكتبة - نكتفي بالبطاقات والأشرطة
  }

  const barLabels = goalCards.map(g => wrapGoalLabel(g.goal.title));
  const barData = goalCards.map(g => g.pct);
  const barColors = goalCards.map(g => cssVar(goalColorVar(g.goal.title).replace('var(', '').replace(')', '')));

  if (goalsBarChartInstance) goalsBarChartInstance.destroy();
  goalsBarChartInstance = new Chart(barCanvas, {
    type: 'bar',
    data: { labels: barLabels, datasets: [{ data: barData, backgroundColor: barColors, borderRadius: 6, maxBarThickness: 34 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + '% إنجاز' } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Tajawal', size: 10 } } },
        y: { beginAtZero: true, max: 100, grid: { color: '#EEF1F6' }, ticks: { font: { family: 'Tajawal', size: 9 }, callback: (v) => v + '%' } },
      },
    },
  });

  const statusGroups = { good: 0, warn: 0, bad: 0, idle: 0 };
  programStats.forEach(s => { statusGroups[statusInfo(s.myTasksCount, s.pct).cls]++; });
  const statusLabels = ['منجز (٧٠%+)', 'قيد التنفيذ', 'متأخر', 'لم يبدأ'];
  const statusKeys = ['good', 'warn', 'bad', 'idle'];
  const statusData = statusKeys.map(k => statusGroups[k]);
  const statusColors = statusKeys.map(k => cssVar(`--status-${k}`));

  if (statusDonutChartInstance) statusDonutChartInstance.destroy();
  statusDonutChartInstance = new Chart(donutCanvas, {
    type: 'doughnut',
    data: { labels: statusLabels, datasets: [{ data: statusData, backgroundColor: statusColors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } },
  });

  const totalEl = document.getElementById('opplan-donut-total');
  if (totalEl) totalEl.textContent = String(programStats.length);

  const legendWrap = document.getElementById('opplan-donut-legend');
  if (legendWrap) {
    legendWrap.innerHTML = '';
    statusLabels.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="sw" style="background:${statusColors[i]};"></span><span class="n">${esc(l)}</span><span class="v">${statusData[i]}</span>`;
      legendWrap.appendChild(row);
    });
  }
}

onEl('opm-add-member', 'click', async () => {
  const profileId = document.getElementById('opm-employee').value;
  const empName = document.getElementById('opm-employee').selectedOptions[0]?.textContent || '';
  if (!profileId) return;
  const { error } = await sb.from('operational_plan_members').insert({ profile_id: profileId, added_by: currentUserId });
  if (error) {
    alert(error.message.includes('duplicate') ? 'هذا الموظف مضاف مسبقًا للخطة' : 'تعذر الإضافة: ' + error.message);
    return;
  }
  alert(`تمت إضافة "${empName}" للخطة التشغيلية بنجاح`);
  await refreshMembersList();
});

async function refreshMembersList() {
  const { data, error } = await sb.from('operational_plan_members').select('id, profiles!operational_plan_members_profile_id_fkey(full_name)');
  if (error) { console.error('refreshMembersList error:', error); }
  const list = document.getElementById('opm-members-list');
  list.innerHTML = '';
  list.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px;';
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>لا يوجد مشاركون بعد</p></div>';
    return;
  }
  data.forEach(m => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:flex; align-items:center; gap:8px; background:var(--sand); border:1px solid #ECEAE1; border-radius:20px; padding:6px 8px 6px 14px;';
    chip.innerHTML = `
      <span style="font-size:13.5px; font-weight:500;">${m.profiles ? m.profiles.full_name : '-'}</span>
      <button data-id="${m.id}" title="إزالة من الخطة" style="width:auto; padding:5px !important; background:transparent; color:var(--danger); display:flex; align-items:center; justify-content:center; border-radius:50%;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      await sb.from('operational_plan_members').delete().eq('id', m.id);
      await refreshMembersList();
    });
    list.appendChild(chip);
  });
}

onEl('og-add', 'click', async () => {
  const title = document.getElementById('og-title').value.trim();
  if (!title) return;
  await sb.from('strategic_goals').insert({ title });
  document.getElementById('og-title').value = '';
  await loadOpPlanAdminData();
});
onEl('oo-add', 'click', async () => {
  const title = document.getElementById('oo-title').value.trim();
  const goalId = document.getElementById('oo-goal').value;
  if (!title || !goalId) return;
  await sb.from('operational_objectives').insert({ title, strategic_goal_id: goalId });
  document.getElementById('oo-title').value = '';
  await loadOpPlanAdminData();
});
onEl('pr-add', 'click', async () => {
  const title = document.getElementById('pr-title').value.trim();
  const objId = document.getElementById('pr-objective').value;
  if (!title || !objId) return;
  await sb.from('programs').insert({ title, operational_objective_id: objId });
  document.getElementById('pr-title').value = '';
  await loadOpPlanAdminData();
});

const durationLabels = { single_week: 'أسبوع محدد', semester_1: 'الفصل الأول', semester_2: 'الفصل الثاني', full_year: 'طوال العام' };

async function refreshOpPlanApprovals() {
  const { data: pendingPlans, error: pendingPlansErr } = await sb.from('op_tasks')
    .select('id, title, description, duration_type, week_number, profiles!op_tasks_employee_profile_id_fkey(full_name)')
    .eq('plan_status', 'pending');
  if (pendingPlansErr) console.error('opplan pendingPlans error:', pendingPlansErr);

  const planList = document.getElementById('opplan-pending-plan-list');
  planList.innerHTML = '';
  document.getElementById('opplan-stat-pending-plan').textContent = (pendingPlans || []).length;

  if (!pendingPlans || pendingPlans.length === 0) {
    planList.innerHTML = '<div class="placeholder" style="padding:24px;"><p>لا توجد مهام بانتظار الاعتماد</p></div>';
  } else {
    pendingPlans.forEach(t => {
      const card = document.createElement('div');
      card.className = 'form-card';
      card.innerHTML = `
        <p style="margin:0 0 4px;"><strong>${t.title}</strong> — ${t.profiles ? t.profiles.full_name : ''}</p>
        <p style="margin:0 0 10px; font-size:13px; color:var(--slate);">${durationLabels[t.duration_type]}${t.week_number ? ' (الأسبوع ' + t.week_number + ')' : ''} — ${t.description || ''}</p>
        <div style="display:flex; gap:8px;">
          <button class="approve-btn" style="width:auto; padding:8px 16px; background:var(--meadow); color:#fff;">اعتماد</button>
          <button class="reject-btn" style="width:auto; padding:8px 16px; background:var(--danger-light); color:var(--danger);">رفض</button>
        </div>`;
      card.querySelector('.approve-btn').addEventListener('click', async () => {
        await sb.from('op_tasks').update({ plan_status: 'approved' }).eq('id', t.id);
        await refreshOpPlanApprovals();
      });
      card.querySelector('.reject-btn').addEventListener('click', async () => {
        const note = prompt('سبب الرفض (اختياري):') || '';
        await sb.from('op_tasks').update({ plan_status: 'rejected', plan_review_note: note }).eq('id', t.id);
        await refreshOpPlanApprovals();
      });
      planList.appendChild(card);
    });
  }

  const { data: pendingCompletions } = await sb.from('op_task_completions')
    .select('id, period_label, status, op_tasks(title, profiles!op_tasks_employee_profile_id_fkey(full_name))')
    .eq('status', 'pending');

  const compList = document.getElementById('opplan-pending-completion-list');
  compList.innerHTML = '';
  document.getElementById('opplan-stat-pending-completion').textContent = (pendingCompletions || []).length;

  if (!pendingCompletions || pendingCompletions.length === 0) {
    compList.innerHTML = '<div class="placeholder" style="padding:24px;"><p>لا توجد إنجازات بانتظار الاعتماد</p></div>';
  } else {
    pendingCompletions.forEach(c => {
      const card = document.createElement('div');
      card.className = 'form-card';
      card.innerHTML = `
        <p style="margin:0 0 10px;"><strong>${c.op_tasks ? c.op_tasks.title : ''}</strong> — ${c.op_tasks && c.op_tasks.profiles ? c.op_tasks.profiles.full_name : ''} · ${c.period_label}</p>
        <div style="display:flex; gap:8px;">
          <button class="approve-btn" style="width:auto; padding:8px 16px; background:var(--meadow); color:#fff;">اعتماد الإنجاز</button>
          <button class="reject-btn" style="width:auto; padding:8px 16px; background:var(--danger-light); color:var(--danger);">إرجاع</button>
        </div>`;
      card.querySelector('.approve-btn').addEventListener('click', async () => {
        await sb.from('op_task_completions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: currentUserId }).eq('id', c.id);
        await refreshOpPlanApprovals();
      });
      card.querySelector('.reject-btn').addEventListener('click', async () => {
        const note = prompt('ملاحظة الإرجاع (اختياري):') || '';
        await sb.from('op_task_completions').update({ status: 'rejected', review_note: note, reviewed_at: new Date().toISOString(), reviewed_by: currentUserId }).eq('id', c.id);
        await refreshOpPlanApprovals();
      });
      compList.appendChild(card);
    });
  }

  const { data: allCompletions } = await sb.from('op_task_completions').select('status');
  const total = (allCompletions || []).length;
  const approved = (allCompletions || []).filter(c => c.status === 'approved').length;
  document.getElementById('opplan-stat-rate').textContent = total ? Math.round((approved/total)*100) + '%' : '-';
}

/* ---------- شاشة الموظف المشارك ---------- */
setupCollapsible('opt-manual-toggle', 'opt-manual-body', 'opt-manual-chevron');
setupCollapsible('opt-excel-toggle', 'opt-excel-body', 'opt-excel-chevron');

async function loadOpPlanEmployeeData() {
  await refreshStructureCaches();

  const goalSelect = document.getElementById('opt-goal');
  goalSelect.innerHTML = '';
  if (goalsCache.length === 0) {
    goalSelect.innerHTML = '<option value="">لا توجد أهداف مضافة بعد، راجع المدير</option>';
  } else {
    goalsCache.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.title; goalSelect.appendChild(o); });
  }

  function refreshObjectivesForGoal() {
    const goalId = goalSelect.value;
    const objSelect = document.getElementById('opt-objective');
    objSelect.innerHTML = '';
    const filtered = objectivesCache.filter(o => o.strategic_goal_id === goalId);
    if (filtered.length === 0) {
      objSelect.innerHTML = '<option value="">لا توجد أهداف تشغيلية لهذا الهدف</option>';
    } else {
      filtered.forEach(o2 => { const o = document.createElement('option'); o.value = o2.id; o.textContent = o2.title; objSelect.appendChild(o); });
    }
    refreshProgramsForObjective();
  }

  function refreshProgramsForObjective() {
    const objId = document.getElementById('opt-objective').value;
    const progSelect = document.getElementById('opt-program');
    progSelect.innerHTML = '<option value="">بدون برنامج محدد</option>';
    programsCache.filter(p => p.operational_objective_id === objId).forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.plan_code ? `${p.plan_code} - ${p.title}` : p.title;
      progSelect.appendChild(o);
    });
    updateProgramInfo();
  }

  goalSelect.addEventListener('change', refreshObjectivesForGoal);
  document.getElementById('opt-objective').addEventListener('change', refreshProgramsForObjective);
  refreshObjectivesForGoal();

  await refreshMyTasks();
}

// يعرض القسم المسؤول والمؤشر المستهدف الرسمي للبرنامج المختار، عشان الموظف (مثلاً رائد
// النشاط) يعرف بالضبط إيش الهدف قبل ما يوزّع تنفيذه على مهام أسبوعية
function updateProgramInfo() {
  const infoEl = document.getElementById('opt-program-info');
  if (!infoEl) return;
  const progId = document.getElementById('opt-program').value;
  const prog = programsCache.find(p => p.id === progId);
  if (!prog || (!prog.department && !prog.school_indicator)) {
    infoEl.classList.add('hidden');
    infoEl.innerHTML = '';
    return;
  }
  infoEl.classList.remove('hidden');
  infoEl.innerHTML = `
    ${prog.department ? `<strong>القسم المسؤول:</strong> ${esc(prog.department)}<br>` : ''}
    ${prog.school_indicator ? `<span style="white-space:pre-line;">${esc(prog.school_indicator)}</span>` : ''}`;
}
onEl('opt-program', 'change', updateProgramInfo);

onEl('opt-duration', 'change', (e) => {
  const val = e.target.value;
  document.getElementById('opt-week-wrap').classList.toggle('hidden', val !== 'single_week');
  document.getElementById('opt-recurrence-wrap').classList.toggle('hidden', val === 'single_week');
});

onEl('opt-submit', 'click', async () => {
  const title = document.getElementById('opt-title').value.trim();
  const errEl = document.getElementById('opt-error');
  if (!title) { errEl.textContent = 'اكتب عنوان المهمة'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const duration = document.getElementById('opt-duration').value;
  const payload = {
    employee_profile_id: currentUserId,
    title,
    description: document.getElementById('opt-desc').value.trim(),
    program_id: document.getElementById('opt-program').value || null,
    duration_type: duration,
    created_by: currentUserId,
  };
  if (duration === 'single_week') {
    payload.week_number = parseInt(document.getElementById('opt-week').value) || null;
  } else {
    payload.recurrence = document.getElementById('opt-recurrence').value;
  }

  const { error } = await sb.from('op_tasks').insert(payload);
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('opt-title').value = '';
  document.getElementById('opt-desc').value = '';
  document.getElementById('opt-week').value = '';
  await refreshMyTasks();
});

/* ---------- تنزيل نموذج إكسل فارغ ---------- */
onEl('opt-download-template', 'click', async () => {
  await loadXLSX();
  const headers = ['الهدف العام', 'الهدف التشغيلي', 'البرنامج', 'عنوان المهمة', 'الوصف', 'نوع المدة', 'رقم الأسبوع', 'التكرار'];
  const example = ['(مثال) رفع كفاءة العملية التعليمية', '(مثال) تطوير أداء المعلمين', '(مثال) برنامج التطوير المهني', 'إعداد الجدول الدراسي', 'وصف مختصر للمهمة', 'أسبوع محدد', '3', ''];
  const note = ['نوع المدة: اكتب بالضبط أحد هذه الخيارات → أسبوع محدد / الفصل الأول / الفصل الثاني / طوال العام', '', '', '', '', 'التكرار (لو المدة فصل أو عام): أسبوعي أو يومي — اتركه فاضي إذا أسبوع محدد', '', ''];
  const ws = XLSX.utils.aoa_to_sheet([headers, example, note]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المهام');
  XLSX.writeFile(wb, 'نموذج_مهام_الخطة_التشغيلية.xlsx');
});

/* ---------- رفع ملف إكسل ---------- */
const durationTextMap = { 'أسبوع محدد': 'single_week', 'الفصل الأول': 'semester_1', 'الفصل الدراسي الأول': 'semester_1', 'الفصل الثاني': 'semester_2', 'الفصل الدراسي الثاني': 'semester_2', 'طوال العام': 'full_year', 'طوال العام الدراسي': 'full_year' };

function resolveProgramId(goalTitle, objTitle, progTitle) {
  if (!progTitle) return null;
  const candidates = programsCache.filter(p => p.title.trim() === progTitle.trim());
  if (candidates.length === 0) return undefined; // لم يوجد
  if (candidates.length === 1) return candidates[0].id;
  // أكثر من برنامج بنفس الاسم: نحاول التمييز عبر الهدف التشغيلي/العام
  for (const c of candidates) {
    const obj = objectivesCache.find(o => o.id === c.operational_objective_id);
    if (!objTitle || (obj && obj.title.trim() === objTitle.trim())) {
      if (!goalTitle || !obj) return c.id;
      const goal = goalsCache.find(g => g.id === obj.strategic_goal_id);
      if (goal && goal.title.trim() === goalTitle.trim()) return c.id;
    }
  }
  return candidates[0].id;
}

onEl('opt-excel-upload', 'click', async () => {
  const fileInput = document.getElementById('opt-excel-file');
  const errEl = document.getElementById('opt-excel-error');
  const successEl = document.getElementById('opt-excel-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!fileInput.files || fileInput.files.length === 0) {
    errEl.textContent = 'اختر ملف إكسل أولاً';
    errEl.style.display = 'block';
    return;
  }

  await loadXLSX();
  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      let added = 0, skippedRows = [];

      for (const row of rows) {
        const title = (row['عنوان المهمة'] || '').toString().trim();
        if (!title) continue; // صف فارغ أو صف الملاحظات

        const goalTitle = (row['الهدف العام'] || '').toString().trim();
        const objTitle = (row['الهدف التشغيلي'] || '').toString().trim();
        const progTitle = (row['البرنامج'] || '').toString().trim();
        const durationText = (row['نوع المدة'] || 'أسبوع محدد').toString().trim();
        const weekNum = row['رقم الأسبوع'];
        const recurrenceText = (row['التكرار'] || 'أسبوعي').toString().trim();

        const durationType = durationTextMap[durationText] || 'single_week';
        const programId = resolveProgramId(goalTitle, objTitle, progTitle);

        if (progTitle && programId === undefined) {
          skippedRows.push(`"${title}" — البرنامج "${progTitle}" غير موجود`);
          continue;
        }

        const payload = {
          employee_profile_id: currentUserId,
          title,
          description: (row['الوصف'] || '').toString().trim(),
          program_id: programId || null,
          duration_type: durationType,
          created_by: currentUserId,
        };
        if (durationType === 'single_week') {
          payload.week_number = parseInt(weekNum) || null;
        } else {
          payload.recurrence = recurrenceText === 'يومي' ? 'daily' : 'weekly';
        }

        const { error } = await sb.from('op_tasks').insert(payload);
        if (error) { skippedRows.push(`"${title}" — ${error.message}`); continue; }
        added++;
      }

      if (added > 0) {
        successEl.textContent = `تمت إضافة ${added} مهمة بنجاح، بانتظار اعتماد المدير.`;
        successEl.style.display = 'block';
      }
      if (skippedRows.length > 0) {
        errEl.innerHTML = 'تم تجاوز بعض الصفوف:<br>' + skippedRows.join('<br>');
        errEl.style.display = 'block';
      }
      fileInput.value = '';
      await refreshMyTasks();
    } catch (err) {
      errEl.textContent = 'تعذر قراءة الملف: ' + err.message;
      errEl.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
});

// أيقونات صغيرة توضح نوع مدة المهمة بنظرة وحدة (بدل الاكتفاء بنص "طوال العام"/"أسبوع محدد")
const durationIcons = {
  single_week: '<path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/><path d="M9 16l2 2 4-4"/>',
  semester_1: '<path d="M4 4v16l8-4 8 4V4a1 1 0 00-1-1H5a1 1 0 00-1 1z"/>',
  semester_2: '<path d="M4 4v16l8-4 8 4V4a1 1 0 00-1-1H5a1 1 0 00-1 1z"/>',
  full_year: '<path d="M17.5 12a5.5 5.5 0 11-5.5-5.5"/><path d="M6.5 12a5.5 5.5 0 105.5-5.5"/><path d="M12 6.5V4M12 20v-2.5"/>',
};

function renderWeekStrip() {
  const strip = document.getElementById('opplan-week-strip');
  if (!strip) return;
  strip.innerHTML = '';
  for (let w = 1; w <= 40; w++) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'myop-week-pill' + (w === opPlanWeek ? ' active' : '');
    pill.textContent = String(w);
    pill.title = 'الأسبوع ' + w;
    pill.addEventListener('click', () => {
      if (w === opPlanWeek) return;
      opPlanWeek = w;
      renderWeekStrip();
      refreshMyTasks();
    });
    strip.appendChild(pill);
  }
  const activePill = strip.querySelector('.myop-week-pill.active');
  if (activePill) activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function setMyOpRing(doneCount, actionableCount) {
  const fill = document.getElementById('myop-ring-fill');
  const pctEl = document.getElementById('myop-ring-pct');
  const subEl = document.getElementById('myop-ring-sub');
  const weekLabelEl = document.getElementById('myop-ring-week-label');
  if (weekLabelEl) weekLabelEl.textContent = 'للأسبوع ' + opPlanWeek;
  if (!fill || !pctEl) return;
  const circumference = 2 * Math.PI * 27;
  const pct = actionableCount > 0 ? Math.round((doneCount / actionableCount) * 100) : 0;
  fill.style.strokeDasharray = `${circumference}`;
  fill.style.strokeDashoffset = `${circumference - (pct / 100) * circumference}`;
  fill.style.stroke = pct >= 100 ? 'var(--status-good)' : (pct > 0 ? 'var(--meadow)' : 'var(--sand)');
  pctEl.textContent = pct + '%';
  if (subEl) {
    subEl.textContent = actionableCount === 0
      ? 'لا توجد مهام تحتاج إجراء هذا الأسبوع'
      : `أنجزت ${doneCount} من ${actionableCount} مهمة تحتاج تنفيذ`;
  }
}

async function refreshMyTasks() {
  renderWeekStrip();
  const { data: tasks } = await sb.from('op_tasks')
    .select('id, title, description, duration_type, week_number, plan_status, plan_review_note')
    .eq('employee_profile_id', currentUserId)
    .or(`week_number.eq.${opPlanWeek},duration_type.neq.single_week`);

  const kanban = document.getElementById('opplan-my-tasks');
  kanban.innerHTML = '';

  if (!tasks || tasks.length === 0) {
    kanban.innerHTML = '<div class="placeholder" style="padding:24px; grid-column:1/-1;"><p>لا توجد مهام لهذا الأسبوع</p></div>';
    setMyOpRing(0, 0);
    return;
  }

  const withCompletions = await Promise.all(tasks.map(async (t) => {
    let completionForWeek = null;
    if (t.plan_status === 'approved') {
      const { data: comp } = await sb.from('op_task_completions').select('id, status').eq('task_id', t.id).eq('period_label', 'الأسبوع ' + opPlanWeek).maybeSingle();
      completionForWeek = comp;
    }
    return { t, completionForWeek };
  }));

  // نبني 3 أعمدة بصرية بدل قائمة نصية طويلة: يحتاج إجراء منك / بانتظار اعتماد المدير / منجزة ومعتمدة
  const needsAction = [], waitingApproval = [], done = [];
  withCompletions.forEach(({ t, completionForWeek }) => {
    if (completionForWeek && completionForWeek.status === 'approved') done.push({ t, completionForWeek });
    else if (t.plan_status === 'pending' || (completionForWeek && completionForWeek.status === 'pending')) waitingApproval.push({ t, completionForWeek });
    else needsAction.push({ t, completionForWeek });
  });

  setMyOpRing(done.length, needsAction.length + waitingApproval.length + done.length);

  function taskCard({ t, completionForWeek }, colKind) {
    const isOverdue = colKind === 'needs' && t.duration_type === 'single_week' && t.week_number < opPlanWeek;
    const card = document.createElement('div');
    card.className = 'myop-task-card' + (isOverdue ? ' overdue' : '');
    const durIcon = durationIcons[t.duration_type] || durationIcons.single_week;
    let extraBadge = '';
    if (t.plan_status === 'rejected') extraBadge = `<span class="myop-overdue-chip">مرفوضة${t.plan_review_note ? ': ' + esc(t.plan_review_note) : ''}</span>`;
    else if (completionForWeek && completionForWeek.status === 'rejected') extraBadge = '<span class="myop-overdue-chip">أُرجعت، أعد التنفيذ</span>';
    card.innerHTML = `
      <h6>${esc(t.title)}</h6>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
      <div class="badge-row">
        <span class="myop-duration-chip"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${durIcon}</svg>${durationLabels[t.duration_type]}</span>
        ${isOverdue ? '<span class="myop-overdue-chip">⚠ متأخرة</span>' : ''}
        ${extraBadge}
      </div>`;
    if (colKind === 'needs' && t.plan_status === 'approved') {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = 'تم التنفيذ';
      btn.addEventListener('click', async () => {
        await sb.from('op_task_completions').insert({ task_id: t.id, period_label: 'الأسبوع ' + opPlanWeek, period_date: null });
        await refreshMyTasks();
      });
      card.appendChild(btn);
    }
    return card;
  }

  function buildColumn(kind, title, items) {
    const col = document.createElement('div');
    col.className = 'op-kanban-col ' + kind;
    col.innerHTML = `<div class="colhead"><span class="dot"></span>${title}<span class="count">${items.length}</span></div>`;
    if (items.length === 0) {
      col.innerHTML += '<div class="op-kanban-empty">لا يوجد</div>';
    } else {
      items.forEach(item => col.appendChild(taskCard(item, kind)));
    }
    kanban.appendChild(col);
  }

  buildColumn('needs', 'يحتاج إجراء منك', needsAction);
  buildColumn('waiting', 'بانتظار اعتماد المدير', waitingApproval);
  buildColumn('done', 'منجزة ومعتمدة', done);
}
