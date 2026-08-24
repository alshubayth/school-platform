import { sb, currentUserId, isAdminOrDeputy, gradeLabels,
         isOpPlanMember, setOpPlanMember, setupCollapsible } from './core.js';

/* ================= الخطة التشغيلية ================= */
let opPlanWeek = 1;
let goalsCache = [], objectivesCache = [], programsCache = [];

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
    sb.from('programs').select('id, title, operational_objective_id'),
  ]);
  goalsCache = goals || [];
  objectivesCache = objectives || [];
  programsCache = programs || [];
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
}

document.getElementById('opm-add-member').addEventListener('click', async () => {
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

document.getElementById('og-add').addEventListener('click', async () => {
  const title = document.getElementById('og-title').value.trim();
  if (!title) return;
  await sb.from('strategic_goals').insert({ title });
  document.getElementById('og-title').value = '';
  await loadOpPlanAdminData();
});
document.getElementById('oo-add').addEventListener('click', async () => {
  const title = document.getElementById('oo-title').value.trim();
  const goalId = document.getElementById('oo-goal').value;
  if (!title || !goalId) return;
  await sb.from('operational_objectives').insert({ title, strategic_goal_id: goalId });
  document.getElementById('oo-title').value = '';
  await loadOpPlanAdminData();
});
document.getElementById('pr-add').addEventListener('click', async () => {
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
      const o = document.createElement('option'); o.value = p.id; o.textContent = p.title; progSelect.appendChild(o);
    });
  }

  goalSelect.addEventListener('change', refreshObjectivesForGoal);
  document.getElementById('opt-objective').addEventListener('change', refreshProgramsForObjective);
  refreshObjectivesForGoal();

  document.getElementById('opplan-week-label').textContent = 'الأسبوع ' + opPlanWeek;
  await refreshMyTasks();
}

document.getElementById('opt-duration').addEventListener('change', (e) => {
  const val = e.target.value;
  document.getElementById('opt-week-wrap').classList.toggle('hidden', val !== 'single_week');
  document.getElementById('opt-recurrence-wrap').classList.toggle('hidden', val === 'single_week');
});

document.getElementById('opt-submit').addEventListener('click', async () => {
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
document.getElementById('opt-download-template').addEventListener('click', () => {
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

document.getElementById('opt-excel-upload').addEventListener('click', async () => {
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

document.getElementById('opplan-week-prev').addEventListener('click', () => { if (opPlanWeek > 1) { opPlanWeek--; document.getElementById('opplan-week-label').textContent = 'الأسبوع ' + opPlanWeek; refreshMyTasks(); } });
document.getElementById('opplan-week-next').addEventListener('click', () => { if (opPlanWeek < 40) { opPlanWeek++; document.getElementById('opplan-week-label').textContent = 'الأسبوع ' + opPlanWeek; refreshMyTasks(); } });

async function refreshMyTasks() {
  const { data: tasks } = await sb.from('op_tasks')
    .select('id, title, description, duration_type, week_number, plan_status, plan_review_note')
    .eq('employee_profile_id', currentUserId)
    .or(`week_number.eq.${opPlanWeek},duration_type.neq.single_week`);

  const list = document.getElementById('opplan-my-tasks');
  list.innerHTML = '';

  if (!tasks || tasks.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:24px;"><p>لا توجد مهام لهذا الأسبوع</p></div>';
    return;
  }

  for (const t of tasks) {
    let completionForWeek = null;
    if (t.plan_status === 'approved') {
      const { data: comp } = await sb.from('op_task_completions').select('id, status').eq('task_id', t.id).eq('period_label', 'الأسبوع ' + opPlanWeek).maybeSingle();
      completionForWeek = comp;
    }

    const card = document.createElement('div');
    card.className = 'form-card';
    let statusBadge = '';
    if (t.plan_status === 'pending') statusBadge = '<span style="font-size:11.5px; background:#F1EFE8; color:var(--slate); padding:3px 10px; border-radius:20px;">بانتظار اعتماد الإضافة</span>';
    else if (t.plan_status === 'rejected') statusBadge = `<span style="font-size:11.5px; background:var(--danger-light); color:var(--danger); padding:3px 10px; border-radius:20px;">مرفوضة${t.plan_review_note ? ': ' + t.plan_review_note : ''}</span>`;
    else if (completionForWeek && completionForWeek.status === 'pending') statusBadge = '<span style="font-size:11.5px; background:#F1EFE8; color:var(--slate); padding:3px 10px; border-radius:20px;">بانتظار اعتماد الإنجاز</span>';
    else if (completionForWeek && completionForWeek.status === 'approved') statusBadge = '<span style="font-size:11.5px; background:var(--meadow-light); color:var(--meadow); padding:3px 10px; border-radius:20px;">منجزة ومعتمدة</span>';
    else if (completionForWeek && completionForWeek.status === 'rejected') statusBadge = '<span style="font-size:11.5px; background:var(--danger-light); color:var(--danger); padding:3px 10px; border-radius:20px;">أُرجعت، أعد التنفيذ</span>';

    card.innerHTML = `
      <p style="margin:0 0 4px;"><strong>${t.title}</strong></p>
      <p style="margin:0 0 10px; font-size:13px; color:var(--slate);">${durationLabels[t.duration_type]} — ${t.description || ''}</p>
      <div style="display:flex; align-items:center; gap:10px;">${statusBadge}</div>`;

    if (t.plan_status === 'approved' && (!completionForWeek || completionForWeek.status === 'rejected')) {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.style.cssText = 'width:auto; padding:8px 16px; margin-top:10px;';
      btn.textContent = 'تم التنفيذ';
      btn.addEventListener('click', async () => {
        await sb.from('op_task_completions').insert({ task_id: t.id, period_label: 'الأسبوع ' + opPlanWeek, period_date: null });
        await refreshMyTasks();
      });
      card.appendChild(btn);
    }
    list.appendChild(card);
  }
}
