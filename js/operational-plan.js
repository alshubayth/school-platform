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
let goalsCache = [], objectivesCache = [], programsCache = [], allProgramsCache = [];
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
// عدد أسابيع الفصل الدراسي الواحد بمدرستنا (فصلين × 19 أسبوع لكل واحد) - الترقيم يرجع لـ1 من
// جديد كل فصل، فـ"أسبوع 5" لازم يترافق دايمًا مع تحديد الفصل (currentSemester) لما يكون النوع
// "أسبوع محدد"، وإلا يتلخبط أسبوع الفصل الأول مع نظيره بالفصل الثاني
const WEEKS_PER_SEMESTER = 19;
let currentSemester = 'semester_1';

async function refreshStructureCaches() {
  const [{ data: goals }, { data: objectives }, { data: programs }, { data: settings }] = await Promise.all([
    sb.from('strategic_goals').select('id, title'),
    sb.from('operational_objectives').select('id, title, strategic_goal_id'),
    sb.from('programs').select('id, title, operational_objective_id, department, school_indicator, plan_code, applies_to_intermediate'),
    sb.from('op_plan_settings').select('current_semester').eq('id', 1).maybeSingle(),
  ]);
  goalsCache = goals || [];
  objectivesCache = objectives || [];
  const allPrograms = programs || [];
  totalProgramsCount = allPrograms.length;
  allProgramsCache = allPrograms; // بدون فلترة المرحلة - تُستخدم بقائمة إدارة/حذف البرامج
  // نعرض وندوّر بس البرامج المتعلقة بمرحلة المتوسط - العمود قد ما يكون موجود لبرامج مضافة يدويًا
  // قبل هذا التحديث (تُعامل null/undefined كـ "تنطبق" افتراضيًا، مو كاستبعاد)
  programsCache = allPrograms.filter(p => p.applies_to_intermediate !== false);
  currentSemester = (settings && settings.current_semester) || 'semester_1';
}

/* ---------- شاشة المدير ---------- */
async function loadOpPlanAdminData() {
  await refreshStructureCaches();

  const semSel = document.getElementById('opplan-semester-select');
  if (semSel) semSel.value = currentSemester;

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

  renderProgramManageList();

  await refreshMembersList();
  await loadProgramAssignAdmin();
  await refreshOpPlanApprovals();
  await renderOpPlanGuide();
}

onEl('opplan-semester-select', 'change', async (e) => {
  const val = e.target.value;
  await sb.from('op_plan_settings').update({ current_semester: val, updated_by: currentUserId }).eq('id', 1);
  currentSemester = val;
});

/* ---------- إسناد البرامج للمشاركين (لوحة المدير) ----------
   بدل ما كل موظف يختار الهدف العام/التشغيلي/البرنامج يدويًا لكل مهمة (تعب مع 44 برنامج)،
   المدير يسند مسبقًا كل موظف بالبرامج الخاصة فيه، وبعدها الموظف بصفحته يفتح برنامجه المسند
   مباشرة ويدخل مهامه الأسبوعية بدون أي اختيار متكرر */
let opaMembersCache = [];
let opaCurrentAssignments = new Set();

async function loadProgramAssignAdmin() {
  const sel = document.getElementById('opa-employee');
  if (!sel) return;
  const { data: members } = await sb.from('operational_plan_members')
    .select('profile_id, profiles!operational_plan_members_profile_id_fkey(id, full_name)');
  opaMembersCache = (members || []).map(m => ({ id: m.profile_id, full_name: m.profiles ? m.profiles.full_name : '-' }));

  const prevVal = sel.value;
  sel.innerHTML = '';
  if (opaMembersCache.length === 0) {
    sel.innerHTML = '<option value="">أضف مشاركين بالخطة أولاً</option>';
    document.getElementById('opa-checklist').innerHTML = '';
    return;
  }
  opaMembersCache.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.full_name; sel.appendChild(o); });
  if (prevVal && opaMembersCache.some(m => m.id === prevVal)) sel.value = prevVal;
  await renderOpaChecklist();
}

async function renderOpaChecklist() {
  const sel = document.getElementById('opa-employee');
  const list = document.getElementById('opa-checklist');
  if (!sel || !list) return;
  if (!sel.value) { list.innerHTML = ''; return; }
  const { data: assigned } = await sb.from('program_assignments').select('program_id').eq('profile_id', sel.value);
  opaCurrentAssignments = new Set((assigned || []).map(a => a.program_id));
  buildOpaChecklistDom();
}

function buildOpaChecklistDom() {
  const list = document.getElementById('opa-checklist');
  if (!list) return;
  const q = (document.getElementById('opa-search')?.value || '').trim();
  const goalById = new Map(goalsCache.map(g => [g.id, g]));
  const objById = new Map(objectivesCache.map(o => [o.id, o]));
  const byGoal = new Map();
  programsCache
    .filter(p => !q || p.title.includes(q) || (p.plan_code || '').includes(q))
    .forEach(p => {
      const obj = objById.get(p.operational_objective_id);
      const goal = obj ? goalById.get(obj.strategic_goal_id) : null;
      const key = goal ? goal.title : 'بدون هدف';
      if (!byGoal.has(key)) byGoal.set(key, []);
      byGoal.get(key).push(p);
    });
  if (byGoal.size === 0) { list.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px;">لا نتائج</p>'; return; }
  list.innerHTML = Array.from(byGoal.entries()).map(([goalTitle, progs]) => `
    <div class="opa-goal-heading">${esc(goalTitle)}</div>
    ${progs.map(p => `
      <label class="opa-item">
        <input type="checkbox" data-program-id="${p.id}" ${opaCurrentAssignments.has(p.id) ? 'checked' : ''} />
        ${p.plan_code ? `<span class="code">${esc(p.plan_code)}</span>` : ''}
        <span>${esc(p.title)}</span>
      </label>`).join('')}
  `).join('');
}

onEl('opa-employee', 'change', renderOpaChecklist);
onEl('opa-search', 'input', buildOpaChecklistDom);

onEl('opa-save', 'click', async () => {
  const sel = document.getElementById('opa-employee');
  const msgEl = document.getElementById('opa-save-msg');
  if (!sel || !sel.value) return;
  const profileId = sel.value;
  const checked = new Set(Array.from(document.querySelectorAll('#opa-checklist input[type=checkbox]:checked')).map(cb => cb.dataset.programId));
  const toAdd = Array.from(checked).filter(id => !opaCurrentAssignments.has(id));
  const toRemove = Array.from(opaCurrentAssignments).filter(id => !checked.has(id));

  if (toAdd.length > 0) {
    await sb.from('program_assignments').insert(toAdd.map(programId => ({ program_id: programId, profile_id: profileId, assigned_by: currentUserId })));
  }
  for (const programId of toRemove) {
    await sb.from('program_assignments').delete().eq('program_id', programId).eq('profile_id', profileId);
  }
  opaCurrentAssignments = checked;
  if (msgEl) { msgEl.style.display = 'inline'; setTimeout(() => { msgEl.style.display = 'none'; }, 2000); }
});

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
  await loadProgramAssignAdmin();
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
      await loadProgramAssignAdmin();
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

/* ---------- حذف برنامج (سواء مضاف يدويًا أو من البرامج الرسمية المستوردة) ---------- */
function renderProgramManageList() {
  const list = document.getElementById('pr-manage-list');
  if (!list) return;
  const q = (document.getElementById('pr-manage-search')?.value || '').trim();
  const objById = new Map(objectivesCache.map(o => [o.id, o]));
  const filtered = allProgramsCache.filter(p => !q || p.title.includes(q) || (p.plan_code || '').includes(q));
  if (filtered.length === 0) {
    list.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px;">لا نتائج</p>';
    return;
  }
  list.innerHTML = filtered.map(p => {
    const obj = objById.get(p.operational_objective_id);
    return `
      <div class="pr-manage-row" data-program-id="${p.id}">
        <div style="flex:1; min-width:0;">
          ${p.plan_code ? `<span class="code">${esc(p.plan_code)}</span> ` : ''}<span>${esc(p.title)}</span>
          ${obj ? `<div style="font-size:10.5px; color:var(--slate); margin-top:2px;">${esc(obj.title)}</div>` : ''}
        </div>
        <button type="button" class="pr-delete-btn" title="حذف البرنامج" data-program-id="${p.id}" data-program-title="${esc(p.title)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
        </button>
      </div>`;
  }).join('');

  list.querySelectorAll('.pr-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProgramFlow(btn.dataset.programId, btn.dataset.programTitle));
  });
}
onEl('pr-manage-search', 'input', renderProgramManageList);

async function deleteProgramFlow(programId, programTitle) {
  const [{ count: taskCount }, { count: assignCount }] = await Promise.all([
    sb.from('op_tasks').select('id', { count: 'exact', head: true }).eq('program_id', programId),
    sb.from('program_assignments').select('id', { count: 'exact', head: true }).eq('program_id', programId),
  ]);

  let warning = `هل تريد حذف برنامج "${programTitle}"؟`;
  if ((taskCount || 0) > 0 || (assignCount || 0) > 0) {
    warning += `\n\nتنبيه: فيه ${taskCount || 0} مهمة مُدخلة و${assignCount || 0} إسناد مرتبط بهذا البرنامج - راح تنحذف كلها معه ولا يمكن التراجع.`;
  }
  if (!confirm(warning)) return;

  if ((taskCount || 0) > 0) {
    await sb.from('op_task_completions').delete().in('task_id',
      (await sb.from('op_tasks').select('id').eq('program_id', programId)).data?.map(t => t.id) || []);
    await sb.from('op_tasks').delete().eq('program_id', programId);
  }
  if ((assignCount || 0) > 0) {
    await sb.from('program_assignments').delete().eq('program_id', programId);
  }
  const { error } = await sb.from('programs').delete().eq('id', programId);
  if (error) { alert('تعذّر حذف البرنامج: ' + error.message); return; }

  await loadOpPlanAdminData();
}

const durationLabels = { single_week: 'أسبوع محدد', semester_1: 'الفصل الأول', semester_2: 'الفصل الثاني', full_year: 'طوال العام' };

async function refreshOpPlanApprovals() {
  const { data: pendingPlans, error: pendingPlansErr } = await sb.from('op_tasks')
    .select('id, title, description, duration_type, week_number, profiles!op_tasks_employee_profile_id_fkey(full_name), programs(title, plan_code)')
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
        ${t.programs ? `<p style="margin:0 0 4px; font-size:12px; color:var(--meadow); font-weight:700;">${t.programs.plan_code ? esc(t.programs.plan_code) + ' - ' : ''}${esc(t.programs.title)}</p>` : '<p style="margin:0 0 4px; font-size:12px; color:var(--slate);">بدون برنامج محدد</p>'}
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
    .select('id, period_label, status, op_tasks(title, profiles!op_tasks_employee_profile_id_fkey(full_name), programs(title, plan_code))')
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
      const prog = c.op_tasks ? c.op_tasks.programs : null;
      card.innerHTML = `
        <p style="margin:0 0 4px;"><strong>${c.op_tasks ? c.op_tasks.title : ''}</strong> — ${c.op_tasks && c.op_tasks.profiles ? c.op_tasks.profiles.full_name : ''} · ${c.period_label}</p>
        ${prog ? `<p style="margin:0 0 10px; font-size:12px; color:var(--meadow); font-weight:700;">${prog.plan_code ? esc(prog.plan_code) + ' - ' : ''}${esc(prog.title)}</p>` : '<p style="margin:0 0 10px; font-size:12px; color:var(--slate);">بدون برنامج محدد</p>'}
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

/* ---------- منطقة الخطر: إعادة تهيئة الخطة التشغيلية بالكامل (حذف كل المهام المُدخلة) ---------- */
onEl('opplan-reset-btn', 'click', () => {
  document.getElementById('opplan-reset-overlay').classList.remove('hidden');
});
onEl('opplan-reset-cancel', 'click', () => {
  document.getElementById('opplan-reset-overlay').classList.add('hidden');
});
onEl('opplan-reset-confirm', 'click', async () => {
  const btn = document.getElementById('opplan-reset-confirm');
  const errEl = document.getElementById('opplan-reset-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'جارٍ الحذف...';

  // نحذف الإنجازات الأسبوعية أولاً (مرتبطة بالمهام)، ثم المهام نفسها، ثم نرجّع كل إسناد
  // برنامج لحالة "لم يبدأ" بما إن كل مهامه المُدخلة صارت محذوفة
  const { error: err1 } = await sb.from('op_task_completions').delete().not('id', 'is', null);
  const { error: err2 } = await sb.from('op_tasks').delete().not('id', 'is', null);
  const { error: err3 } = await sb.from('program_assignments').update({ tasks_entry_complete: false }).not('id', 'is', null);

  btn.disabled = false;
  btn.textContent = originalText;

  const firstError = err1 || err2 || err3;
  if (firstError) {
    errEl.textContent = 'تعذّرت إعادة التهيئة بالكامل: ' + firstError.message;
    errEl.style.display = 'block';
    return;
  }

  document.getElementById('opplan-reset-overlay').classList.add('hidden');
  await loadOpPlanAdminData();
  alert('تمت إعادة تهيئة الخطة التشغيلية بنجاح — كل المهام المُدخلة انحذفت.');
});

/* ---------- شاشة الموظف المشارك ---------- */
setupCollapsible('opt-excel-toggle', 'opt-excel-body', 'opt-excel-chevron');

async function loadOpPlanEmployeeData() {
  await refreshStructureCaches();
  await loadMyProgramAssignments();
  await refreshMyTasks();
}

/* ---------- "برامجي المسندة": الموظف يفتح كل برنامج مسند له ويدخل مهامه على مدار
   الأسابيع دفعة وحدة، بدل ما يختار الهدف العام/التشغيلي/البرنامج يدويًا لكل مهمة على حدة ---------- */
let myProgAssignments = [];

async function loadMyProgramAssignments() {
  const { data: assigned } = await sb.from('program_assignments')
    .select('id, program_id, tasks_entry_complete, programs(id, title, plan_code, department, school_indicator, operational_objective_id)')
    .eq('profile_id', currentUserId);
  myProgAssignments = assigned || [];
  await renderMyProgramList();
}

async function renderMyProgramList() {
  const wrap = document.getElementById('myprog-list');
  if (!wrap) return;
  if (myProgAssignments.length === 0) {
    wrap.innerHTML = '<div class="placeholder" style="padding:24px;"><p>ما فيه برامج مسندة لك بعد — راجع المدير</p></div>';
    return;
  }

  // عدّاد المهام المدخلة فعليًا لكل برنامج (بدون فلترة بحالة الاعتماد - هذا للإدخال مو للاعتماد)
  const { data: myTasks } = await sb.from('op_tasks').select('id, program_id').eq('employee_profile_id', currentUserId);
  const countByProgram = new Map();
  (myTasks || []).forEach(t => { if (!t.program_id) return; countByProgram.set(t.program_id, (countByProgram.get(t.program_id) || 0) + 1); });

  const objById = new Map(objectivesCache.map(o => [o.id, o]));
  const goalById = new Map(goalsCache.map(g => [g.id, g]));

  wrap.innerHTML = '';
  myProgAssignments.forEach(a => {
    const prog = a.programs;
    if (!prog) return;
    const taskCount = countByProgram.get(prog.id) || 0;
    const status = a.tasks_entry_complete
      ? { cls: 'complete', label: 'اكتمل الإدخال ✓' }
      : (taskCount > 0 ? { cls: 'progress', label: 'قيد الإدخال' } : { cls: 'idle', label: 'لم يبدأ' });
    const obj = objById.get(prog.operational_objective_id);
    const goal = obj ? goalById.get(obj.strategic_goal_id) : null;

    const card = document.createElement('div');
    card.className = 'myprog-card';
    card.dataset.assignmentId = a.id;
    card.innerHTML = `
      <div class="mphead">
        <div style="flex:1;">
          <h5>${prog.plan_code ? esc(prog.plan_code) + ' - ' : ''}${esc(prog.title)}</h5>
          <p class="mpmeta">${goal ? esc(goal.title) : ''}${taskCount > 0 ? ' · ' + taskCount + (taskCount === 1 ? ' مهمة مدخلة' : ' مهام مدخلة') : ''}</p>
        </div>
        <span class="myprog-status ${status.cls}">${status.label}</span>
        <svg class="mpchevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:0.2s; flex-shrink:0;"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="myprog-body hidden"></div>`;
    card.querySelector('.mphead').addEventListener('click', () => {
      const body = card.querySelector('.myprog-body');
      if (body.classList.contains('hidden')) openProgramCardById(a.id);
      else { body.classList.add('hidden'); body.innerHTML = ''; const chev = card.querySelector('.mpchevron'); if (chev) chev.style.transform = ''; }
    });
    wrap.appendChild(card);
  });
}

// يفتح بطاقة برنامج معيّن (ويقفل أي بطاقة ثانية مفتوحة عشان ما تتزاحم الشاشة) - يُستخدم عند
// النقر يدويًا، وأيضًا للانتقال التلقائي للبرنامج التالي غير المكتمل بعد إنهاء برنامج
function openProgramCardById(assignmentId) {
  document.querySelectorAll('.myprog-card .myprog-body:not(.hidden)').forEach(b => {
    b.classList.add('hidden'); b.innerHTML = '';
    const chev = b.closest('.myprog-card')?.querySelector('.mpchevron');
    if (chev) chev.style.transform = '';
  });
  const card = document.querySelector(`.myprog-card[data-assignment-id="${assignmentId}"]`);
  const assignment = myProgAssignments.find(a => a.id === assignmentId);
  if (!card || !assignment || !assignment.programs) return;
  const body = card.querySelector('.myprog-body');
  const chevron = card.querySelector('.mpchevron');
  body.classList.remove('hidden');
  if (chevron) chevron.style.transform = 'rotate(180deg)';
  renderProgramEditor(body, assignment, assignment.programs);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openNextIncompleteProgram() {
  const next = myProgAssignments.find(a => !a.tasks_entry_complete);
  if (next) openProgramCardById(next.id);
}

async function renderProgramEditor(body, assignment, program) {
  body.innerHTML = '<p style="font-size:12px; color:var(--slate);">جارٍ التحميل...</p>';
  // نعرض مهام "أسبوع محدد" الخاصة بالفصل الحالي بس (أسابيع الفصل الثاني السابقة، إن وجدت،
  // ترقيمها منفصل تمامًا) + كل المهام المتكررة (فصل/سنة) بغض النظر عن الفصل
  const { data: existing } = await sb.from('op_tasks')
    .select('id, title, duration_type, week_number, plan_status')
    .eq('employee_profile_id', currentUserId).eq('program_id', program.id)
    .or(`and(duration_type.eq.single_week,semester.eq.${currentSemester}),duration_type.neq.single_week`)
    .order('week_number', { ascending: true });

  const statusLabel = { approved: 'معتمدة', rejected: 'مرفوضة', pending: 'بانتظار الاعتماد' };
  const statusColor = { approved: 'var(--status-good)', rejected: 'var(--status-bad)', pending: 'var(--status-idle)' };
  const existingHtml = (existing && existing.length > 0) ? `
    <div class="myprog-existing">
      ${existing.map(t => `
        <div class="row">
          <span style="flex-shrink:0; font-weight:700; color:var(--slate); width:74px;">${t.duration_type === 'single_week' ? 'أسبوع ' + t.week_number : durationLabels[t.duration_type]}</span>
          <span style="flex:1;">${esc(t.title)}</span>
          <span style="flex-shrink:0; font-size:10.5px; color:${statusColor[t.plan_status] || 'var(--status-idle)'};">${statusLabel[t.plan_status] || t.plan_status}</span>
        </div>`).join('')}
    </div>` : '<p style="font-size:12px; color:var(--slate); margin-bottom:10px;">ما فيه مهام مدخلة بعد لهذا البرنامج</p>';

  body.innerHTML = `
    ${program.department || program.school_indicator ? `
      <div style="background:var(--sand); border-radius:8px; padding:9px 12px; margin-bottom:12px; font-size:12px; color:#444; line-height:1.6;">
        ${program.department ? `<strong>القسم المسؤول:</strong> ${esc(program.department)}<br>` : ''}
        ${program.school_indicator ? `<span style="white-space:pre-line;">${esc(program.school_indicator)}</span>` : ''}
      </div>` : ''}
    ${existingHtml}
    <div class="mprows"></div>
    <button type="button" class="mp-add-row" style="width:auto; padding:8px 14px; background:var(--sand); color:var(--ink); font-size:12px;">+ إضافة أسبوع</button>
    <div class="error-msg mp-error"></div>
    <div class="myprog-actions">
      <button type="button" class="btn-primary mp-save" style="background:var(--slate);">حفظ ومتابعة الإدخال</button>
      <button type="button" class="btn-primary mp-finish">✓ حفظ وإنهاء هذا البرنامج</button>
    </div>`;

  const rowsWrap = body.querySelector('.mprows');
  function addRow() {
    const row = document.createElement('div');
    row.className = 'myprog-row';
    row.innerHTML = `
      <select class="mp-duration">
        <option value="single_week">أسبوع محدد</option>
        <option value="semester_1">الفصل الأول</option>
        <option value="semester_2">الفصل الثاني</option>
        <option value="full_year">طوال العام</option>
      </select>
      <input type="number" class="mp-week" placeholder="رقم الأسبوع (1-${WEEKS_PER_SEMESTER})" min="1" max="${WEEKS_PER_SEMESTER}" />
      <input type="text" class="mp-title" placeholder="عنوان المهمة" />
      <button type="button" class="mp-remove" title="حذف الصف">✕</button>`;
    row.querySelector('.mp-duration').addEventListener('change', (e) => {
      row.querySelector('.mp-week').style.display = e.target.value === 'single_week' ? '' : 'none';
    });
    row.querySelector('.mp-remove').addEventListener('click', () => row.remove());
    rowsWrap.appendChild(row);
  }
  addRow();
  body.querySelector('.mp-add-row').addEventListener('click', addRow);

  async function collectAndSave() {
    const errEl = body.querySelector('.mp-error');
    errEl.style.display = 'none';
    const rows = Array.from(rowsWrap.querySelectorAll('.myprog-row'));
    const payloads = [];
    for (const row of rows) {
      const title = row.querySelector('.mp-title').value.trim();
      if (!title) continue;
      const duration = row.querySelector('.mp-duration').value;
      const payload = {
        employee_profile_id: currentUserId, title, description: '', program_id: program.id,
        duration_type: duration, created_by: currentUserId,
      };
      if (duration === 'single_week') {
        const wk = parseInt(row.querySelector('.mp-week').value);
        if (!wk || wk < 1 || wk > WEEKS_PER_SEMESTER) { errEl.textContent = `حدد رقم أسبوع صحيح (1-${WEEKS_PER_SEMESTER}) للمهمة "${title}"`; errEl.style.display = 'block'; return false; }
        payload.week_number = wk;
        payload.semester = currentSemester;
      } else {
        payload.recurrence = 'weekly';
      }
      payloads.push(payload);
    }
    if (payloads.length === 0) return true;
    const { error } = await sb.from('op_tasks').insert(payloads);
    if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return false; }
    return true;
  }

  body.querySelector('.mp-save').addEventListener('click', async () => {
    const ok = await collectAndSave();
    if (ok) { await loadMyProgramAssignments(); openProgramCardById(assignment.id); }
  });

  body.querySelector('.mp-finish').addEventListener('click', async () => {
    const ok = await collectAndSave();
    if (!ok) return;
    await sb.from('program_assignments').update({ tasks_entry_complete: true }).eq('id', assignment.id);
    await loadMyProgramAssignments();
    openNextIncompleteProgram();
  });
}

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
          payload.semester = currentSemester;
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
  for (let w = 1; w <= WEEKS_PER_SEMESTER; w++) {
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
  // "أسبوع محدد" لازم يترافق بفلترة الفصل الحالي (الترقيم يرجع لـ1 كل فصل) - المهام المتكررة
  // (فصل/سنة) تطلع دايمًا بغض النظر عن الفصل الحالي
  const { data: tasks } = await sb.from('op_tasks')
    .select('id, title, description, duration_type, week_number, plan_status, plan_review_note')
    .eq('employee_profile_id', currentUserId)
    .or(`and(duration_type.eq.single_week,semester.eq.${currentSemester},week_number.eq.${opPlanWeek}),duration_type.neq.single_week`);

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
