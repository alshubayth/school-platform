import { sb, currentUserId, currentProfile, gradeLabels,
         isOpPlanMember, setOpPlanMember, setupCollapsible,
         currentSchoolId, readScopedBySchool, writeWithSchool, academicWeekInfo } from './core.js';
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

/* ---------- تبويبات لوحة المدير: المتابعة / الإعدادات / اعتماد المهام ---------- */
const OPPLAN_TABS = ['dashboard', 'employees', 'approvals', 'settings'];
function showOpPlanTab(tab) {
  if (!OPPLAN_TABS.includes(tab)) tab = 'dashboard';
  OPPLAN_TABS.forEach(t => {
    const tabBtn = document.getElementById(`opplan-tab-${t}`);
    const panel = document.getElementById(`opplan-panel-${t}`);
    if (tabBtn) tabBtn.classList.toggle('active', t === tab);
    if (panel) panel.classList.toggle('hidden', t !== tab);
  });
}
OPPLAN_TABS.forEach(t => onEl(`opplan-tab-${t}`, 'click', () => showOpPlanTab(t)));

export async function loadOpPlanModule() {
  document.getElementById('opplan-admin-view').classList.add('hidden');
  document.getElementById('opplan-employee-view').classList.add('hidden');
  document.getElementById('opplan-not-member').classList.add('hidden');

  // لوحة الإدارة (الأهداف/البرامج/الاعتمادات) للمدير فقط - الوكيل، مثل المعلم تمامًا، يدخل
  // بصفحته الشخصية كموظف مشارك لو انسندت له برامج بالخطة (وإلا يشوف رسالة "مو مشارك")
  if (currentProfile.role === 'admin') {
    document.getElementById('opplan-subtitle').textContent = 'إدارة الأهداف والبرامج ومراجعة الاعتمادات';
    document.getElementById('opplan-admin-view').classList.remove('hidden');
    showOpPlanTab('dashboard');
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
    readScopedBySchool(scoped => {
      let q = sb.from('strategic_goals').select('id, title');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('operational_objectives').select('id, title, strategic_goal_id');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('programs').select('id, title, operational_objective_id, department, school_indicator, plan_code, applies_to_intermediate');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    (async () => {
      // كل مدرسة لها صف إعدادات خاص فيها الآن (school_id)، بدل صف واحد مشترك (id = 1) بين
      // كل المدارس. لو المدرسة ما عندها صف بعد (مدرسة جديدة)، نستخدم القيمة الافتراضية بهدوء.
      if (!currentSchoolId) return sb.from('op_plan_settings').select('current_semester').eq('id', 1).maybeSingle();
      const res = await sb.from('op_plan_settings').select('current_semester').eq('school_id', currentSchoolId).maybeSingle();
      if (res.error) return sb.from('op_plan_settings').select('current_semester').eq('id', 1).maybeSingle();
      return res;
    })(),
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

  // كل الموظفين (لإضافة مشاركين جدد من تبويب "الموظفين")
  const { data: allStaff } = await readScopedBySchool(scoped => {
    let q = sb.from('profiles').select('id, full_name, role').in('role', ['teacher','deputy']);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  opeStaff = (allStaff || []).slice().sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ar'));

  // قوائم الهدف العام والتشغيلي
  const goalSelect = document.getElementById('oo-goal');
  goalSelect.innerHTML = '';
  goalsCache.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.title; goalSelect.appendChild(o); });

  const objSelect = document.getElementById('pr-objective');
  objSelect.innerHTML = '';
  objectivesCache.forEach(o2 => { const o = document.createElement('option'); o.value = o2.id; o.textContent = o2.title; objSelect.appendChild(o); });

  renderProgramManageList();

  await refreshOpEmployees();
  await renderOpPlanGuide();
}

onEl('opplan-semester-select', 'change', async (e) => {
  const val = e.target.value;
  if (currentSchoolId) {
    const { error } = await sb.from('op_plan_settings')
      .upsert({ school_id: currentSchoolId, current_semester: val, updated_by: currentUserId }, { onConflict: 'school_id' });
    if (error) await sb.from('op_plan_settings').update({ current_semester: val, updated_by: currentUserId }).eq('id', 1);
  } else {
    await sb.from('op_plan_settings').update({ current_semester: val, updated_by: currentUserId }).eq('id', 1);
  }
  currentSemester = val;
});

// فلتر داشبورد المدير: هدف استراتيجي/تشغيلي مختار حاليًا (null = بدون فلتر) - يُطبّق على شبكة
// البرامج بالأسفل فقط
let opGuideFilterGoalId = null;
let opGuideFilterObjId = null;

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
    readScopedBySchool(scoped => {
      let q = sb.from('op_tasks').select('id, program_id, plan_status');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('op_task_completions').select('id, task_id, status');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
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
      const isActive = opGuideFilterGoalId === g.goal.id;
      return `
        <div class="op-goal-card ${isActive ? 'active' : ''}" style="--goal-color:${color};" data-goal-id="${g.goal.id}">
          <div class="gtitle"><span class="goal-dot"></span><h5>${esc(g.goal.title)}</h5></div>
          <div class="gmeta">${g.objIds.size} ${g.objIds.size === 1 ? 'هدف تشغيلي' : 'أهداف تشغيلية'} · ${g.programs.length} ${g.programs.length === 1 ? 'برنامج متابَع' : 'برامج متابَعة'}</div>
          <div class="gring">
            <span class="gpct">${g.pct}%</span>
            <div class="op-bar-track"><div class="op-bar-fill" style="width:${g.pct}%; background:${statusBarColor(st.cls)};"></div></div>
          </div>
        </div>`;
    }).join('');

    goalsEl.querySelectorAll('.op-goal-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.goalId;
        opGuideFilterGoalId = (opGuideFilterGoalId === id) ? null : id;
        opGuideFilterObjId = null;
        renderOpPlanGuide();
      });
    });

    if (legendEl) {
      legendEl.innerHTML = goalCards.map(g => `
        <div class="op-legend-item"><span class="op-legend-dot" style="background:${goalColorVar(g.goal.title)};"></span>${esc(g.goal.title)}</div>
      `).join('');
    }
  }

  /* ---- 2ب) شرائح فلترة الأهداف التشغيلية (تظهر بعد اختيار هدف استراتيجي) ---- */
  const objectivesEl = document.getElementById('opplan-guide-objectives');
  if (objectivesEl) {
    if (opGuideFilterGoalId) {
      const objMap = new Map();
      programStats.forEach(s => {
        if (!s.goal || s.goal.id !== opGuideFilterGoalId || !s.obj) return;
        if (!objMap.has(s.obj.id)) objMap.set(s.obj.id, { obj: s.obj, count: 0 });
        objMap.get(s.obj.id).count++;
      });
      const chips = Array.from(objMap.values()).sort((a, b) => a.obj.title.localeCompare(b.obj.title, 'ar'));
      const goalColor = goalColorVar((goalById.get(opGuideFilterGoalId) || {}).title);
      if (chips.length > 0) {
        objectivesEl.innerHTML = chips.map(c => `
          <span class="op-filter-chip ${opGuideFilterObjId === c.obj.id ? 'active' : ''}" data-obj-id="${c.obj.id}" style="--goal-color:${goalColor};">${esc(c.obj.title)} (${c.count})</span>
        `).join('');
        objectivesEl.classList.remove('hidden');
        objectivesEl.querySelectorAll('.op-filter-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const id = chip.dataset.objId;
            opGuideFilterObjId = (opGuideFilterObjId === id) ? null : id;
            renderOpPlanGuide();
          });
        });
      } else {
        objectivesEl.innerHTML = '';
        objectivesEl.classList.add('hidden');
      }
    } else {
      objectivesEl.innerHTML = '';
      objectivesEl.classList.add('hidden');
    }
  }

  /* ---- شارة الفلتر النشط فوق شبكة البرامج ---- */
  const filterBadgeEl = document.getElementById('opplan-filter-badge');
  if (filterBadgeEl) {
    if (opGuideFilterGoalId) {
      const goalTitle = (goalById.get(opGuideFilterGoalId) || {}).title || '';
      const objTitle = opGuideFilterObjId ? (objById.get(opGuideFilterObjId) || {}).title : null;
      filterBadgeEl.textContent = `مفلترة: ${goalTitle}${objTitle ? ' ← ' + objTitle : ''}  ✕`;
      filterBadgeEl.classList.remove('hidden');
      filterBadgeEl.onclick = () => { opGuideFilterGoalId = null; opGuideFilterObjId = null; renderOpPlanGuide(); };
    } else {
      filterBadgeEl.classList.add('hidden');
      filterBadgeEl.onclick = null;
    }
  }

  renderOpPlanCharts(goalCards, programStats);

  /* ---- 3) شبكة البرامج (مفلترة حسب الهدف الاستراتيجي/التشغيلي المختار، إن وُجد) ---- */
  const filteredStats = programStats.filter(s => {
    if (opGuideFilterGoalId && (!s.goal || s.goal.id !== opGuideFilterGoalId)) return false;
    if (opGuideFilterObjId && (!s.obj || s.obj.id !== opGuideFilterObjId)) return false;
    return true;
  });
  const sorted = filteredStats.slice().sort((a, b) => (a.program.plan_code || '').localeCompare(b.program.plan_code || '', 'en', { numeric: true }));

  if (sorted.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px; grid-column:1/-1;"><p>لا توجد برامج ضمن هذا الفلتر</p></div>';
    return;
  }

  container.innerHTML = sorted.map(s => {
    const { program: p, obj, goal, myTasksCount, pct } = s;
    const st = statusInfo(myTasksCount, pct);
    const color = goal ? goalColorVar(goal.title) : 'var(--meadow)';
    return `
      <div class="op-program-card" style="--goal-color:${color};" data-program-id="${p.id}" title="${esc(goal ? goal.title : '')}${obj ? ' ← ' + esc(obj.title) : ''}">
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

  container.querySelectorAll('.op-program-card').forEach(card => {
    card.addEventListener('click', () => openProgramTasksView(card.dataset.programId));
  });
}

/* ---------- عرض مهام برنامج (قراءة فقط) - يفتح لما تضغط على بطاقة برنامج بالداشبورد ---------- */
async function openProgramTasksView(programId) {
  const overlay = document.getElementById('opplan-program-overlay');
  const titleEl = document.getElementById('opplan-program-overlay-title');
  const subEl = document.getElementById('opplan-program-overlay-sub');
  const bodyEl = document.getElementById('opplan-program-overlay-body');
  if (!overlay) return;

  const program = programsCache.find(p => p.id === programId);
  if (!program) return;
  const obj = objectivesCache.find(o => o.id === program.operational_objective_id);
  const goal = obj ? goalsCache.find(g => g.id === obj.strategic_goal_id) : null;

  titleEl.textContent = program.title;
  subEl.textContent = [goal ? goal.title : null, obj ? obj.title : null].filter(Boolean).join(' ← ') || '';
  bodyEl.innerHTML = '<p style="font-size:12px; color:var(--slate);">جارٍ التحميل...</p>';
  overlay.classList.remove('hidden');

  const { data: tasks } = await readScopedBySchool(scoped => {
    let q = sb.from('op_tasks')
      .select('id, title, duration_type, week_number, semester, plan_status, employee_profile_id, profiles!op_tasks_employee_profile_id_fkey(full_name)')
      .eq('program_id', programId)
      .order('week_number', { ascending: true });
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

  if (!tasks || tasks.length === 0) {
    bodyEl.innerHTML = '<p style="font-size:12px; color:var(--slate);">ما فيه مهام مدخلة لهذا البرنامج بعد.</p>';
    return;
  }

  const { data: completions } = await readScopedBySchool(scoped => {
    let q = sb.from('op_task_completions')
      .select('task_id, status, period_label')
      .in('task_id', tasks.map(t => t.id));
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  const completionsByTask = new Map();
  (completions || []).forEach(c => {
    if (!completionsByTask.has(c.task_id)) completionsByTask.set(c.task_id, []);
    completionsByTask.get(c.task_id).push(c);
  });

  const statusLabel = { approved: 'معتمدة', rejected: 'مرفوضة', pending: 'بانتظار الاعتماد' };
  const statusColor = { approved: 'var(--status-good)', rejected: 'var(--status-bad)', pending: 'var(--status-idle)' };

  bodyEl.innerHTML = `
    ${program.department || program.school_indicator ? `
      <div style="background:var(--sand); border-radius:8px; padding:9px 12px; margin-bottom:12px; font-size:12px; color:#444; line-height:1.6;">
        ${program.department ? `<strong>القسم المسؤول:</strong> ${esc(program.department)}<br>` : ''}
        ${program.school_indicator ? `<span style="white-space:pre-line;">${esc(program.school_indicator)}</span>` : ''}
      </div>` : ''}
    <div class="myprog-existing">
      ${tasks.map(t => {
        const label = t.duration_type === 'single_week' ? 'أسبوع ' + t.week_number : (durationLabels[t.duration_type] || t.duration_type);
        const empName = t.profiles ? t.profiles.full_name : '-';
        const comps = completionsByTask.get(t.id) || [];
        const compSummary = t.duration_type === 'single_week'
          ? (comps.length > 0
              ? `<span style="font-size:10.5px; color:${statusColor[comps[0].status] || 'var(--status-idle)'};">${statusLabel[comps[0].status] || comps[0].status}</span>`
              : '<span style="font-size:10.5px; color:var(--status-idle);">لم يُنجز بعد</span>')
          : (comps.length > 0
              ? `<span style="font-size:10.5px; color:var(--slate);">${comps.filter(c => c.status === 'approved').length} من ${comps.length} إنجاز معتمد</span>`
              : '<span style="font-size:10.5px; color:var(--status-idle);">لا إنجاز مسجل بعد</span>');
        return `
        <div class="row" style="flex-wrap:wrap;">
          <span style="flex-shrink:0; font-weight:700; color:var(--slate); width:74px;">${esc(label)}</span>
          <span style="flex:1; min-width:140px;">${esc(t.title)}</span>
          <span style="flex-shrink:0; font-size:10.5px; color:${statusColor[t.plan_status] || 'var(--status-idle)'};">${statusLabel[t.plan_status] || t.plan_status}</span>
          ${compSummary}
          <span style="flex-basis:100%; font-size:10.5px; color:var(--slate);">بواسطة ${esc(empName)}</span>
        </div>`;
      }).join('')}
    </div>`;
}

onEl('opplan-program-overlay-close', 'click', () => {
  document.getElementById('opplan-program-overlay').classList.add('hidden');
});

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

onEl('og-add', 'click', async () => {
  const title = document.getElementById('og-title').value.trim();
  if (!title) return;
  await writeWithSchool(extra => sb.from('strategic_goals').insert({ title, ...extra }));
  document.getElementById('og-title').value = '';
  await loadOpPlanAdminData();
});
onEl('oo-add', 'click', async () => {
  const title = document.getElementById('oo-title').value.trim();
  const goalId = document.getElementById('oo-goal').value;
  if (!title || !goalId) return;
  await writeWithSchool(extra => sb.from('operational_objectives').insert({ title, strategic_goal_id: goalId, ...extra }));
  document.getElementById('oo-title').value = '';
  await loadOpPlanAdminData();
});
onEl('pr-add', 'click', async () => {
  const title = document.getElementById('pr-title').value.trim();
  const objId = document.getElementById('pr-objective').value;
  if (!title || !objId) return;
  await writeWithSchool(extra => sb.from('programs').insert({ title, operational_objective_id: objId, ...extra }));
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

/* =====================================================================
   تبويب "الموظفين" + "اعتماد المهام": متابعة كل مشارك بالخطة (برامجه، مهامه بالأسابيع،
   إنجازه، المتأخر، واللي ينتظر اعتماد المدير) - كلها من نفس جداول المهام بتحميل واحد
   ===================================================================== */
let opeStaff = [], opeMembers = [], opeAssign = [], opeTasks = [], opeComps = [];
let opeTaskById = new Map(), opeCompsByTask = new Map();
let opeSearch = '', opeSort = 'attention', opeOpenId = null, opeAssignOpen = false, opeAssignQ = '';
let opeAssignChecked = new Set();

// أسبوع الفصل الحالي (الترقيم يرجع لـ1 كل فصل بالخطة) - من تقويم المدرسة؛ وقت الإجازة نأخذ آخر أسبوع دراسة
function opCurrentSemWeek() {
  const info = academicWeekInfo();
  let w = info.current || (info.beforeStart ? 1 : Math.max(1, (info.next || 2) - 1));
  if (w > WEEKS_PER_SEMESTER) w -= WEEKS_PER_SEMESTER;
  return Math.min(Math.max(w, 1), WEEKS_PER_SEMESTER);
}

function arN(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

// تحميل كل الصفوف حتى لو تعدّت حد الألف صف بالاستعلام الواحد
async function opFetchAll(table, cols) {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from(table).select(cols).order('id', { ascending: true }).range(from, from + 999);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) { console.error('opplan fetch', table, error); break; }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function refreshOpEmployees() {
  const [members, assigns, tasks, comps] = await Promise.all([
    opFetchAll('operational_plan_members', 'id, profile_id, profiles!operational_plan_members_profile_id_fkey(full_name)'),
    opFetchAll('program_assignments', 'id, program_id, profile_id, tasks_entry_complete'),
    opFetchAll('op_tasks', 'id, title, description, program_id, employee_profile_id, plan_status, plan_review_note, duration_type, week_number, semester'),
    opFetchAll('op_task_completions', 'id, task_id, status, period_label, review_note'),
  ]);
  opeMembers = members.map(m => ({ id: m.id, pid: m.profile_id, name: (m.profiles && m.profiles.full_name) || (opeStaff.find(s => s.id === m.profile_id) || {}).full_name || '-' }));
  opeAssign = assigns; opeTasks = tasks; opeComps = comps;
  opeTaskById = new Map(tasks.map(t => [t.id, t]));
  opeCompsByTask = new Map();
  comps.forEach(c => { if (!opeCompsByTask.has(c.task_id)) opeCompsByTask.set(c.task_id, []); opeCompsByTask.get(c.task_id).push(c); });
  renderOpEmployees();
  renderOpApprovals();
  if (opeOpenId) renderOpeDrawer();
}

function opeProgram(id) { return allProgramsCache.find(p => p.id === id) || programsCache.find(p => p.id === id) || null; }
function opeName(pid) {
  const m = opeMembers.find(x => x.pid === pid); if (m) return m.name;
  const s = opeStaff.find(x => x.id === pid); return s ? s.full_name : '-';
}
function opeInitials(name) { return String(name || '؟').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join(' '); }

// حالة مهمة واحدة من وجهة نظر المدير
function opeTaskState(t, curW) {
  const comps = opeCompsByTask.get(t.id) || [];
  if (t.plan_status === 'pending') return { cls: 'wait', label: 'بانتظار اعتماد الإضافة' };
  if (t.plan_status === 'rejected') return { cls: 'bad', label: 'مرفوضة' };
  const okN = comps.filter(c => c.status === 'approved').length;
  const pendN = comps.filter(c => c.status === 'pending').length;
  if (t.duration_type !== 'single_week') {
    if (pendN) return { cls: 'wait', label: `إنجاز بانتظار اعتمادك` };
    return okN ? { cls: 'ok', label: `${arN(okN, 'إنجاز معتمد', 'إنجازان معتمدان', 'إنجازات معتمدة', 'إنجازًا معتمدًا')}`, done: true } : { cls: 'idle', label: 'متكررة - لا إنجاز بعد' };
  }
  if (okN) return { cls: 'ok', label: 'منجزة ✓', done: true };
  if (pendN) return { cls: 'wait', label: 'إنجاز بانتظار اعتمادك' };
  if (t.semester === currentSemester && t.week_number < curW) return { cls: 'bad', label: comps.length ? 'أُرجعت - متأخرة' : 'متأخرة', late: true };
  if (t.semester === currentSemester && t.week_number === curW) return { cls: 'now', label: 'هذا الأسبوع' };
  return { cls: 'idle', label: 'قادمة' };
}

function opeStats(pid) {
  const curW = opCurrentSemWeek();
  const tasks = opeTasks.filter(t => t.employee_profile_id === pid);
  const assigns = opeAssign.filter(a => a.profile_id === pid);
  const approved = tasks.filter(t => t.plan_status === 'approved');
  const done = approved.filter(t => (opeCompsByTask.get(t.id) || []).some(c => c.status === 'approved')).length;
  const late = approved.filter(t => opeTaskState(t, curW).late).length;
  const pendPlan = tasks.filter(t => t.plan_status === 'pending');
  const pendComp = opeComps.filter(c => c.status === 'pending' && (opeTaskById.get(c.task_id) || {}).employee_profile_id === pid);
  const entryDone = assigns.filter(a => a.tasks_entry_complete).length;
  const pct = approved.length ? Math.round(done / approved.length * 100) : 0;
  let stage;
  if (!assigns.length) stage = { cls: 'idle', label: 'بدون برامج مسندة' };
  else if (!tasks.length) stage = { cls: 'bad', label: 'ما بدأ إدخال المهام' };
  else if (entryDone < assigns.length) stage = { cls: 'warn', label: `أنهى إدخال ${entryDone} من ${assigns.length} برامج` };
  else stage = { cls: 'ok', label: 'أنهى إدخال مهامه' };
  return { tasks, assigns, approved, done, late, pendPlan, pendComp, pending: pendPlan.length + pendComp.length, pct, stage };
}

function renderOpEmployees() {
  const list = document.getElementById('ope-list');
  if (!list) return;
  // قائمة الإضافة: الموظفين غير المشاركين
  const addSel = document.getElementById('ope-add-select');
  const memberIds = new Set(opeMembers.map(m => m.pid));
  const avail = opeStaff.filter(s => !memberIds.has(s.id));
  addSel.innerHTML = avail.length ? '<option value="">اختر موظفًا لإضافته...</option>' + avail.map(s => `<option value="${s.id}">${esc(s.full_name)}${s.role === 'deputy' ? ' (وكيل)' : ''}</option>`).join('') : '<option value="">كل الموظفين مضافين</option>';

  const rows = opeMembers.map(m => ({ m, st: opeStats(m.pid) }));
  const totalApproved = rows.reduce((s, r) => s + r.st.approved.length, 0);
  const totalDone = rows.reduce((s, r) => s + r.st.done, 0);
  const totalLate = rows.reduce((s, r) => s + r.st.late, 0);
  const totalPend = rows.reduce((s, r) => s + r.st.pending, 0);
  const notStarted = rows.filter(r => r.st.assigns.length && !r.st.tasks.length).length;
  document.getElementById('ope-stats').innerHTML = `
    <span class="ds ds-all"><b>${rows.length}</b> مشارك</span>
    <span class="ds ds-present"><b>${totalApproved ? Math.round(totalDone / totalApproved * 100) : 0}%</b> إنجاز عام</span>
    <span class="ds ${totalPend ? 'ds-late' : ''}"><b>${totalPend}</b> بانتظار اعتمادك</span>
    <span class="ds ${totalLate ? 'ds-absent' : ''}"><b>${totalLate}</b> مهمة متأخرة</span>
    ${notStarted ? `<span class="ds ds-absent"><b>${notStarted}</b> ما بدأ الإدخال</span>` : ''}`;

  const q = opeSearch;
  let shown = rows.filter(r => !q || r.m.name.includes(q));
  const att = r => (r.st.pending ? 1000 : 0) + r.st.late * 10 + (r.st.assigns.length && !r.st.tasks.length ? 5 : 0);
  if (opeSort === 'name') shown.sort((a, b) => a.m.name.localeCompare(b.m.name, 'ar'));
  else if (opeSort === 'low') shown.sort((a, b) => a.st.pct - b.st.pct || a.m.name.localeCompare(b.m.name, 'ar'));
  else shown.sort((a, b) => att(b) - att(a) || a.st.pct - b.st.pct || a.m.name.localeCompare(b.m.name, 'ar'));

  if (!rows.length) { list.innerHTML = '<div class="ex-empty"><b>ما فيه مشاركين بالخطة بعد</b><span>أضف الموظفين من الأعلى ثم أسند لكل واحد برامجه</span></div>'; return; }
  if (!shown.length) { list.innerHTML = '<div class="ex-empty"><b>ما فيه نتائج</b></div>'; return; }
  list.innerHTML = shown.map(({ m, st }) => `
    <button type="button" class="ope-card" data-pid="${m.pid}">
      <span class="cvt-av">${esc(opeInitials(m.name))}</span>
      <div class="ope-main">
        <b>${esc(m.name)}</b>
        <div class="ope-meta">
          <span>${st.assigns.length ? arN(st.assigns.length, 'برنامج واحد', 'برنامجان', 'برامج', 'برنامجًا') : 'بدون برامج'}</span>
          <span class="ope-stage ${st.stage.cls}">${esc(st.stage.label)}</span>
        </div>
        <div class="ope-bar"><i style="width:${st.pct}%"></i></div>
      </div>
      <div class="ope-side">
        <span class="ope-pct">${st.approved.length ? st.pct + '%' : '-'}</span>
        <span class="ope-sub">${st.approved.length ? `${st.done} من ${st.approved.length}` : 'لا مهام معتمدة'}</span>
        <div class="ope-flags">
          ${st.pending ? `<span class="ope-flag wait">${st.pending} بانتظارك</span>` : ''}
          ${st.late ? `<span class="ope-flag late">${st.late} متأخرة</span>` : ''}
        </div>
      </div>
    </button>`).join('');
  list.querySelectorAll('.ope-card').forEach(c => c.addEventListener('click', () => openOpeDrawer(c.dataset.pid)));
}

onEl('ope-search', 'input', e => { opeSearch = e.target.value.trim(); renderOpEmployees(); });
onEl('ope-sort', 'change', e => { opeSort = e.target.value; renderOpEmployees(); });
onEl('ope-add-btn', 'click', async () => {
  const sel = document.getElementById('ope-add-select');
  const pid = sel.value; if (!pid) return;
  const { error } = await writeWithSchool(extra => sb.from('operational_plan_members').insert({ profile_id: pid, added_by: currentUserId, ...extra }));
  if (error) { alert(error.message.includes('duplicate') ? 'هذا الموظف مضاف مسبقًا للخطة' : 'تعذر الإضافة: ' + error.message); return; }
  await refreshOpEmployees();
  opeAssignOpen = true; // نفتح له إسناد البرامج مباشرة
  openOpeDrawer(pid, true);
});

/* ---------- لوحة الموظف ---------- */
function openOpeDrawer(pid, keepAssign = false) {
  opeOpenId = pid;
  if (!keepAssign) opeAssignOpen = false;
  opeAssignQ = '';
  opeAssignChecked = new Set(opeAssign.filter(a => a.profile_id === pid).map(a => a.program_id));
  const d = document.getElementById('ope-drawer');
  d.classList.remove('hidden'); d.setAttribute('aria-hidden', 'false');
  renderOpeDrawer();
}
function closeOpeDrawer() {
  opeOpenId = null;
  const d = document.getElementById('ope-drawer');
  d.classList.add('hidden'); d.setAttribute('aria-hidden', 'true');
}
onEl('ope-d-close', 'click', closeOpeDrawer);
onEl('ope-drawer', 'click', e => { if (e.target.id === 'ope-drawer') closeOpeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && opeOpenId) closeOpeDrawer(); });

function opeTaskWhen(t) {
  if (t.duration_type === 'single_week') return `أسبوع ${t.week_number}${t.semester && t.semester !== currentSemester ? ' · ' + (durationLabels[t.semester] || '') : ''}`;
  return durationLabels[t.duration_type] || t.duration_type;
}
function opeProgLabel(p) { return p ? `${p.plan_code ? esc(p.plan_code) + ' · ' : ''}${esc(p.title)}` : 'بدون برنامج'; }

function renderOpeDrawer() {
  const pid = opeOpenId; if (!pid) return;
  const member = opeMembers.find(m => m.pid === pid);
  const name = opeName(pid);
  const st = opeStats(pid);
  const curW = opCurrentSemWeek();
  document.getElementById('ope-d-name').textContent = name;
  document.getElementById('ope-d-sub').textContent = member ? `${st.stage.label} · الأسبوع ${curW} من ${durationLabels[currentSemester] || ''}` : 'غير مشارك بالخطة';
  const body = document.getElementById('ope-d-body');

  const kpis = `
    <div class="ope-kpis">
      <div><b>${st.approved.length ? st.pct + '%' : '-'}</b><span>نسبة الإنجاز</span></div>
      <div><b>${st.done}/${st.approved.length}</b><span>منجزة من المعتمدة</span></div>
      <div class="${st.late ? 'bad' : ''}"><b>${st.late}</b><span>متأخرة</span></div>
      <div class="${st.pending ? 'wait' : ''}"><b>${st.pending}</b><span>بانتظار اعتمادك</span></div>
    </div>`;

  // معلّقات تنتظر المدير
  let pendingHtml = '';
  if (st.pending) {
    const items = [
      ...st.pendPlan.map(t => ({ kind: 'plan', id: t.id, title: t.title, sub: `إضافة مهمة · ${opeTaskWhen(t)}`, prog: opeProgram(t.program_id) })),
      ...st.pendComp.map(c => { const t = opeTaskById.get(c.task_id) || {}; return { kind: 'comp', id: c.id, title: t.title || '-', sub: `إنجاز · ${c.period_label || ''}`, prog: opeProgram(t.program_id) }; }),
    ];
    pendingHtml = `
      <section class="ope-sec">
        <div class="ope-sec-h"><h4>بانتظار اعتمادك</h4><button type="button" class="btn-primary ope-approve-all" data-pid="${pid}">اعتماد الكل (${items.length})</button></div>
        ${items.map(i => opeApprovalRow(i)).join('')}
      </section>`;
  }

  // البرامج ومهامها
  const byProg = new Map();
  st.assigns.forEach(a => byProg.set(a.program_id, { assign: a, tasks: [] }));
  st.tasks.forEach(t => { const k = t.program_id || '__none__'; if (!byProg.has(k)) byProg.set(k, { assign: null, tasks: [] }); byProg.get(k).tasks.push(t); });
  const progBlocks = [...byProg.entries()].sort((a, b) => String((opeProgram(a[0]) || {}).plan_code || 'zz').localeCompare(String((opeProgram(b[0]) || {}).plan_code || 'zz'), 'en', { numeric: true })).map(([progId, g]) => {
    const p = opeProgram(progId);
    const appr = g.tasks.filter(t => t.plan_status === 'approved');
    const dn = appr.filter(t => (opeCompsByTask.get(t.id) || []).some(c => c.status === 'approved')).length;
    const pct = appr.length ? Math.round(dn / appr.length * 100) : 0;
    const tasks = g.tasks.slice().sort((a, b) => (a.duration_type === 'single_week' ? 0 : 1) - (b.duration_type === 'single_week' ? 0 : 1) || String(a.semester || '').localeCompare(String(b.semester || '')) || (a.week_number || 0) - (b.week_number || 0));
    const entry = g.assign ? (g.assign.tasks_entry_complete ? '<span class="ope-stage ok">أنهى الإدخال</span>' : (g.tasks.length ? '<span class="ope-stage warn">يُدخل المهام</span>' : '<span class="ope-stage bad">ما دخّل مهام</span>')) : '<span class="ope-stage idle">غير مسند حاليًا</span>';
    return `
      <div class="ope-prog">
        <div class="ope-prog-h">
          <div class="ope-prog-t"><b>${opeProgLabel(p)}</b>${entry}</div>
          <span class="ope-prog-pct">${appr.length ? pct + '%' : ''}</span>
          ${g.assign ? `<button type="button" class="ope-unassign" data-aid="${g.assign.id}" data-n="${g.tasks.length}" title="إلغاء إسناد البرنامج" aria-label="إلغاء الإسناد">✕</button>` : ''}
        </div>
        ${appr.length ? `<div class="ope-bar thin"><i style="width:${pct}%"></i></div>` : ''}
        ${tasks.length ? `<div class="ope-tasks">${tasks.map(t => { const s = opeTaskState(t, curW); return `
          <div class="ope-task">
            <span class="ope-when">${esc(opeTaskWhen(t))}</span>
            <span class="ope-tt">${esc(t.title)}${t.plan_status === 'rejected' && t.plan_review_note ? `<small>سبب الرفض: ${esc(t.plan_review_note)}</small>` : ''}</span>
            <span class="ope-st ${s.cls}">${esc(s.label)}</span>
          </div>`; }).join('')}</div>` : ''}
      </div>`;
  }).join('');

  // إسناد البرامج
  let assignHtml = '';
  if (opeAssignOpen && member) {
    const q = opeAssignQ;
    const goalById = new Map(goalsCache.map(g => [g.id, g]));
    const objById = new Map(objectivesCache.map(o => [o.id, o]));
    const others = new Map();
    opeAssign.forEach(a => { if (a.profile_id === pid) return; if (!others.has(a.program_id)) others.set(a.program_id, []); others.get(a.program_id).push(opeName(a.profile_id)); });
    const groups = new Map();
    programsCache.filter(p => !q || p.title.includes(q) || (p.plan_code || '').includes(q)).forEach(p => {
      const obj = objById.get(p.operational_objective_id); const goal = obj ? goalById.get(obj.strategic_goal_id) : null;
      const k = goal ? goal.title : 'بدون هدف'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p);
    });
    assignHtml = `
      <section class="ope-sec ope-assign">
        <div class="ope-sec-h"><h4>إسناد البرامج</h4><span class="ope-hint">${opeAssignChecked.size} محدد</span></div>
        <input type="search" class="cv-search" id="ope-assign-q" placeholder="بحث باسم البرنامج أو رمزه" value="${esc(q)}" />
        <div class="opa-checklist ope-assign-list">
          ${groups.size ? [...groups.entries()].map(([gt, ps]) => `<div class="opa-goal-heading">${esc(gt)}</div>${ps.map(p => `
            <label class="opa-item"><input type="checkbox" data-prog="${p.id}" ${opeAssignChecked.has(p.id) ? 'checked' : ''} />
              ${p.plan_code ? `<span class="code">${esc(p.plan_code)}</span>` : ''}<span>${esc(p.title)}</span>
              ${others.get(p.id) ? `<span class="opa-assigned-to">مسند لـ: ${esc(others.get(p.id).join('، '))}</span>` : ''}
            </label>`).join('')}`).join('') : '<p class="ope-hint" style="padding:10px;">لا نتائج</p>'}
        </div>
        <div class="ope-assign-actions">
          <button type="button" class="btn-primary" id="ope-assign-save">حفظ الإسناد</button>
          <button type="button" class="ope-link" id="ope-assign-cancel">إلغاء</button>
          <span class="error-msg" id="ope-assign-err" style="margin:0;"></span>
        </div>
      </section>`;
  }

  body.innerHTML = kpis + pendingHtml + assignHtml + `
    <section class="ope-sec">
      <div class="ope-sec-h"><h4>البرامج والمهام</h4>${member && !opeAssignOpen ? '<button type="button" class="ope-link strong" id="ope-assign-open">+ إسناد برامج</button>' : ''}</div>
      ${progBlocks || '<div class="ex-empty"><b>ما فيه برامج مسندة</b><span>اضغط "إسناد برامج" وحدد برامجه</span></div>'}
    </section>
    ${member ? `<button type="button" class="ope-link danger" id="ope-remove-member">إزالة ${esc(name)} من الخطة</button>` : ''}`;

  wireApprovalButtons(body);
  const allBtn = body.querySelector('.ope-approve-all');
  if (allBtn) allBtn.addEventListener('click', () => opApproveAll(pid, allBtn));
  body.querySelectorAll('.ope-unassign').forEach(b => b.addEventListener('click', async () => {
    const n = Number(b.dataset.n);
    if (!confirm(n ? `إلغاء إسناد البرنامج؟ مهامه المدخلة (${n}) تبقى محفوظة بس الموظف ما يقدر يضيف عليه مهام جديدة.` : 'إلغاء إسناد هذا البرنامج؟')) return;
    const { error } = await sb.from('program_assignments').delete().eq('id', b.dataset.aid);
    if (error) { alert('تعذر الإلغاء: ' + error.message); return; }
    await refreshOpEmployees();
  }));
  const openBtn = body.querySelector('#ope-assign-open');
  if (openBtn) openBtn.addEventListener('click', () => { opeAssignOpen = true; opeAssignChecked = new Set(st.assigns.map(a => a.program_id)); renderOpeDrawer(); body.querySelector('#ope-assign-q')?.focus(); });
  const qEl = body.querySelector('#ope-assign-q');
  if (qEl) qEl.addEventListener('input', () => { opeAssignQ = qEl.value.trim(); const pos = qEl.selectionStart; renderOpeDrawer(); const n = document.getElementById('ope-assign-q'); n.focus(); n.setSelectionRange(pos, pos); });
  body.querySelectorAll('.ope-assign-list input[data-prog]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) opeAssignChecked.add(cb.dataset.prog); else opeAssignChecked.delete(cb.dataset.prog);
    const h = body.querySelector('.ope-assign .ope-hint'); if (h) h.textContent = `${opeAssignChecked.size} محدد`;
  }));
  body.querySelector('#ope-assign-cancel')?.addEventListener('click', () => { opeAssignOpen = false; renderOpeDrawer(); });
  body.querySelector('#ope-assign-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const current = new Set(st.assigns.map(a => a.program_id));
    const toAdd = [...opeAssignChecked].filter(id => !current.has(id));
    const toRemove = st.assigns.filter(a => !opeAssignChecked.has(a.program_id));
    const errs = [];
    if (toAdd.length) {
      const { error } = await writeWithSchool(extra => sb.from('program_assignments').insert(toAdd.map(program_id => ({ program_id, profile_id: pid, assigned_by: currentUserId, ...extra }))));
      if (error) errs.push(error.message);
    }
    if (toRemove.length) {
      const { error } = await sb.from('program_assignments').delete().in('id', toRemove.map(a => a.id));
      if (error) errs.push(error.message);
    }
    btn.disabled = false;
    if (errs.length) { const el = document.getElementById('ope-assign-err'); el.textContent = 'تعذر حفظ بعض التغييرات: ' + errs.join(' | '); el.style.display = 'block'; await refreshOpEmployees(); return; }
    opeAssignOpen = false;
    await refreshOpEmployees();
  });
  body.querySelector('#ope-remove-member')?.addEventListener('click', async () => {
    if (!confirm(`إزالة ${name} من الخطة التشغيلية؟ ما يقدر يدخل صفحة الخطة بعدها، ومهامه المدخلة تبقى محفوظة.`)) return;
    const { error } = await sb.from('operational_plan_members').delete().eq('id', member.id);
    if (error) { alert('تعذرت الإزالة: ' + error.message); return; }
    closeOpeDrawer();
    await refreshOpEmployees();
  });
}

/* ---------- الاعتماد (مشترك بين لوحة الموظف وتبويب الاعتماد) ---------- */
function opeApprovalRow(i) {
  return `
    <div class="ope-appr" data-kind="${i.kind}" data-id="${i.id}">
      <div class="ope-appr-main">
        <b>${esc(i.title)}</b>
        <span>${esc(i.sub)}${i.prog ? ' · ' + opeProgLabel(i.prog) : ''}${i.who ? ' · ' + esc(i.who) : ''}</span>
        ${i.desc ? `<small>${esc(i.desc)}</small>` : ''}
      </div>
      <div class="ope-appr-btns">
        <button type="button" class="ope-ok" title="اعتماد">✓ اعتماد</button>
        <button type="button" class="ope-no" title="${i.kind === 'plan' ? 'رفض' : 'إرجاع'}">${i.kind === 'plan' ? 'رفض' : 'إرجاع'}</button>
      </div>
    </div>`;
}

async function opAfterReview() {
  await refreshOpEmployees();
  renderOpPlanGuide();
}

function wireApprovalButtons(root) {
  root.querySelectorAll('.ope-appr').forEach(row => {
    const { kind, id } = row.dataset;
    row.querySelector('.ope-ok').addEventListener('click', async () => {
      row.classList.add('busy');
      const { error } = kind === 'plan'
        ? await sb.from('op_tasks').update({ plan_status: 'approved' }).eq('id', id)
        : await sb.from('op_task_completions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: currentUserId }).eq('id', id);
      if (error) { row.classList.remove('busy'); alert('تعذر الاعتماد: ' + error.message); return; }
      await opAfterReview();
    });
    row.querySelector('.ope-no').addEventListener('click', async () => {
      const note = prompt(kind === 'plan' ? 'سبب الرفض (اختياري):' : 'ملاحظة الإرجاع (اختياري):');
      if (note === null) return;
      row.classList.add('busy');
      const { error } = kind === 'plan'
        ? await sb.from('op_tasks').update({ plan_status: 'rejected', plan_review_note: note }).eq('id', id)
        : await sb.from('op_task_completions').update({ status: 'rejected', review_note: note, reviewed_at: new Date().toISOString(), reviewed_by: currentUserId }).eq('id', id);
      if (error) { row.classList.remove('busy'); alert('تعذر الحفظ: ' + error.message); return; }
      await opAfterReview();
    });
  });
}

async function opApproveAll(pid, btn) {
  const st = opeStats(pid);
  const n = st.pendPlan.length + st.pendComp.length;
  if (!n || !confirm(`اعتماد كل المعلّق لـ${opeName(pid)} (${n})؟`)) return;
  btn.disabled = true;
  const errs = [];
  if (st.pendPlan.length) {
    const { error } = await sb.from('op_tasks').update({ plan_status: 'approved' }).in('id', st.pendPlan.map(t => t.id));
    if (error) errs.push(error.message);
  }
  if (st.pendComp.length) {
    const { error } = await sb.from('op_task_completions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: currentUserId }).in('id', st.pendComp.map(c => c.id));
    if (error) errs.push(error.message);
  }
  btn.disabled = false;
  if (errs.length) alert('تعذر اعتماد بعض العناصر: ' + errs.join(' | '));
  await opAfterReview();
}

// تبويب "اعتماد المهام": مجمّع حسب الموظف، مع "اعتماد الكل" لكل موظف
function renderOpApprovals() {
  const pendPlan = opeTasks.filter(t => t.plan_status === 'pending');
  const pendComp = opeComps.filter(c => c.status === 'pending');
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('opplan-stat-pending-plan', pendPlan.length);
  setTxt('opplan-stat-pending-completion', pendComp.length);
  const total = opeComps.length, ok = opeComps.filter(c => c.status === 'approved').length;
  setTxt('opplan-stat-rate', total ? Math.round(ok / total * 100) + '%' : '-');
  const cnt = document.getElementById('opplan-approvals-cnt');
  if (cnt) { cnt.textContent = pendPlan.length + pendComp.length || ''; cnt.classList.toggle('hidden', !(pendPlan.length + pendComp.length)); }

  const byEmp = new Map();
  const push = (pid, item) => { if (!byEmp.has(pid)) byEmp.set(pid, []); byEmp.get(pid).push(item); };
  pendPlan.forEach(t => push(t.employee_profile_id, { kind: 'plan', id: t.id, title: t.title, desc: t.description, sub: `إضافة مهمة · ${opeTaskWhen(t)}`, prog: opeProgram(t.program_id) }));
  pendComp.forEach(c => { const t = opeTaskById.get(c.task_id) || {}; push(t.employee_profile_id, { kind: 'comp', id: c.id, title: t.title || '-', sub: `إنجاز · ${c.period_label || ''}`, prog: opeProgram(t.program_id) }); });

  const planList = document.getElementById('opplan-pending-plan-list');
  const compList = document.getElementById('opplan-pending-completion-list');
  if (!planList) return;
  if (compList) compList.innerHTML = '';
  if (!byEmp.size) { planList.innerHTML = '<div class="ex-empty"><b>ما فيه شي ينتظر اعتمادك</b><span>أي مهمة جديدة أو إنجاز يسجله الموظفين بيطلع هنا</span></div>'; return; }
  planList.innerHTML = [...byEmp.entries()].sort((a, b) => b[1].length - a[1].length).map(([pid, items]) => `
    <section class="ope-sec ope-appr-group">
      <div class="ope-sec-h">
        <button type="button" class="ope-who" data-pid="${pid}"><span class="cvt-av">${esc(opeInitials(opeName(pid)))}</span><b>${esc(opeName(pid))}</b><span class="ope-hint">${items.length} معلّق</span></button>
        <button type="button" class="btn-primary ope-approve-all" data-pid="${pid}">اعتماد الكل (${items.length})</button>
      </div>
      ${items.map(i => opeApprovalRow(i)).join('')}
    </section>`).join('');
  wireApprovalButtons(planList);
  planList.querySelectorAll('.ope-approve-all').forEach(b => b.addEventListener('click', () => opApproveAll(b.dataset.pid, b)));
  planList.querySelectorAll('.ope-who').forEach(b => b.addEventListener('click', () => openOpeDrawer(b.dataset.pid)));
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
  // برنامج لحالة "لم يبدأ" بما إن كل مهامه المُدخلة صارت محذوفة — كل هذا مقيّد بمدرسة المدير
  // الحالي فقط (currentSchoolId) عشان ما يمسح بيانات مدارس ثانية بالخطأ
  let q1 = sb.from('op_task_completions').delete().not('id', 'is', null);
  let q2 = sb.from('op_tasks').delete().not('id', 'is', null);
  let q3 = sb.from('program_assignments').update({ tasks_entry_complete: false }).not('id', 'is', null);
  if (currentSchoolId) {
    q1 = q1.eq('school_id', currentSchoolId);
    q2 = q2.eq('school_id', currentSchoolId);
    q3 = q3.eq('school_id', currentSchoolId);
  }
  const { error: err1 } = await q1;
  const { error: err2 } = await q2;
  const { error: err3 } = await q3;

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

let opWeekInitialized = false;
async function loadOpPlanEmployeeData() {
  await refreshStructureCaches();
  // يفتح الموظف على أسبوع الدراسة الحالي بدل الأسبوع 1 دايمًا
  if (!opWeekInitialized) { opPlanWeek = opCurrentSemWeek(); opWeekInitialized = true; }
  await loadMyProgramAssignments();
  await refreshMyTasks();
}

/* ---------- "برامجي المسندة": الموظف يفتح كل برنامج مسند له ويدخل مهامه على مدار
   الأسابيع دفعة وحدة، بدل ما يختار الهدف العام/التشغيلي/البرنامج يدويًا لكل مهمة على حدة ---------- */
let myProgAssignments = [];

async function loadMyProgramAssignments() {
  const { data: assigned } = await readScopedBySchool(scoped => {
    let q = sb.from('program_assignments')
      .select('id, program_id, tasks_entry_complete, programs(id, title, plan_code, department, school_indicator, operational_objective_id)')
      .eq('profile_id', currentUserId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
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
  const { data: myTasks } = await readScopedBySchool(scoped => {
    let q = sb.from('op_tasks').select('id, program_id').eq('employee_profile_id', currentUserId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
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
  const { data: existing } = await readScopedBySchool(scoped => {
    let q = sb.from('op_tasks')
      .select('id, title, duration_type, week_number, plan_status')
      .eq('employee_profile_id', currentUserId).eq('program_id', program.id)
      .or(`and(duration_type.eq.single_week,semester.eq.${currentSemester}),duration_type.neq.single_week`)
      .order('week_number', { ascending: true });
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

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
    const { error } = await writeWithSchool(extra => sb.from('op_tasks').insert(payloads.map(p => ({ ...p, ...extra }))));
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

        const { error } = await writeWithSchool(extra => sb.from('op_tasks').insert({ ...payload, ...extra }));
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
  const { data: tasks } = await readScopedBySchool(scoped => {
    let q = sb.from('op_tasks')
      .select('id, title, description, duration_type, week_number, plan_status, plan_review_note')
      .eq('employee_profile_id', currentUserId)
      .or(`and(duration_type.eq.single_week,semester.eq.${currentSemester},week_number.eq.${opPlanWeek}),duration_type.neq.single_week`);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

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
      const { data: comp } = await readScopedBySchool(scoped => {
        let q = sb.from('op_task_completions').select('id, status').eq('task_id', t.id).eq('period_label', 'الأسبوع ' + opPlanWeek);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q.maybeSingle();
      });
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
        await writeWithSchool(extra => sb.from('op_task_completions').insert({ task_id: t.id, period_label: 'الأسبوع ' + opPlanWeek, period_date: null, ...extra }));
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
