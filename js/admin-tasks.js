import { sb, currentUserId, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';

/* ===== المهام الإدارية: كالندر بسيط للمدير/الوكيل - يتنقل بين الأسابيع، كل أسبوع فيه مهام
 * مع مسؤول تنفيذ وحالة (نفذ/لم ينفذ بعد) وتصنيف أولوية (مصفوفة أيزنهاور) وملاحظة اختيارية ===== */

let atWeek = 1;
let staffCache = [];

const PRIORITY_LABELS = {
  important_urgent: { label: 'هام وعاجل', badge: 'badge-danger' },
  important_not_urgent: { label: 'هام وغير عاجل', badge: 'badge-gold' },
  urgent_not_important: { label: 'عاجل وغير هام', badge: 'badge-purple' },
  not_important_not_urgent: { label: 'غير هام وغير عاجل', badge: 'badge-gray' },
};

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

export async function loadAdminTasksModule() {
  await loadStaffOptions();
  document.getElementById('at-week-label').textContent = 'الأسبوع ' + atWeek;
  await refreshTasksList();
}

async function loadStaffOptions() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('profiles').select('id, full_name').in('role', ['admin', 'deputy', 'teacher']).order('full_name');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  staffCache = data || [];
  const sel = document.getElementById('at-responsible');
  sel.innerHTML = staffCache.map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')
    + '<option value="__other__">أخرى...</option>';
}

document.getElementById('at-responsible').addEventListener('change', (e) => {
  document.getElementById('at-responsible-other').style.display = e.target.value === '__other__' ? '' : 'none';
});

document.getElementById('at-week-prev').addEventListener('click', () => {
  if (atWeek > 1) { atWeek--; loadAdminTasksModule(); }
});
document.getElementById('at-week-next').addEventListener('click', () => {
  if (atWeek < 40) { atWeek++; loadAdminTasksModule(); }
});

document.getElementById('at-add-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('at-error');
  errEl.style.display = 'none';

  const title = document.getElementById('at-title').value.trim();
  const respSel = document.getElementById('at-responsible').value;
  const respOther = document.getElementById('at-responsible-other').value.trim();
  const priority = document.getElementById('at-priority').value;
  const note = document.getElementById('at-note').value.trim();

  if (!title) { errEl.textContent = 'اكتب المهمة أولاً'; errEl.style.display = 'block'; return; }
  if (!respSel) { errEl.textContent = 'اختر مسؤول التنفيذ'; errEl.style.display = 'block'; return; }
  if (respSel === '__other__' && !respOther) { errEl.textContent = 'اكتب اسم مسؤول التنفيذ'; errEl.style.display = 'block'; return; }

  const row = {
    week_number: atWeek,
    title,
    responsible_profile_id: respSel === '__other__' ? null : respSel,
    responsible_other: respSel === '__other__' ? respOther : null,
    priority,
    status: 'pending',
    note: note || null,
    created_by: currentUserId,
  };

  const { error } = await writeWithSchool(extra => sb.from('admin_weekly_tasks').insert({ ...row, ...extra }));
  if (error) {
    errEl.textContent = 'حدث خطأ: ' + error.message;
    errEl.style.display = 'block';
    return;
  }

  document.getElementById('at-title').value = '';
  document.getElementById('at-note').value = '';
  document.getElementById('at-responsible-other').value = '';
  document.getElementById('at-responsible-other').style.display = 'none';
  document.getElementById('at-responsible').value = staffCache[0] ? staffCache[0].id : '__other__';

  await refreshTasksList();
});

async function refreshTasksList() {
  const list = document.getElementById('at-tasks-list');
  list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  const { data: tasks, error } = await readScopedBySchool(scoped => {
    let q = sb.from('admin_weekly_tasks')
      .select('id, title, responsible_profile_id, responsible_other, priority, status, note, profiles(full_name)')
      .eq('week_number', atWeek)
      .order('created_at', { ascending: true });
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

  if (error) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>تعذّر تحميل المهام</p></div>';
    return;
  }

  if (!tasks || tasks.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه مهام مضافة لهذا الأسبوع بعد</p></div>';
    return;
  }

  list.innerHTML = '';
  tasks.forEach(t => {
    const pr = PRIORITY_LABELS[t.priority] || PRIORITY_LABELS.not_important_not_urgent;
    const responsibleName = t.responsible_profile_id ? (t.profiles ? t.profiles.full_name : '-') : t.responsible_other;
    const isDone = t.status === 'done';

    const card = document.createElement('div');
    card.className = `at-task-card pr-${t.priority}${isDone ? ' status-done' : ''}`;
    card.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:10px;">
        <div style="flex:1; min-width:0;">
          <h6>${esc(t.title)}</h6>
          <p class="meta">مسؤول التنفيذ: ${esc(responsibleName || '-')}</p>
        </div>
        <button class="at-delete-btn" title="حذف المهمة">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
        </button>
      </div>
      <div class="badge-row">
        <span class="badge ${pr.badge}">${pr.label}</span>
        <span class="badge ${isDone ? 'badge-green' : 'badge-gray'} at-status-btn">${isDone ? '✓ نفذ' : 'لم ينفذ بعد'}</span>
      </div>
      ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}`;

    card.querySelector('.at-status-btn').addEventListener('click', async () => {
      await sb.from('admin_weekly_tasks').update({ status: isDone ? 'pending' : 'done' }).eq('id', t.id);
      await refreshTasksList();
    });
    card.querySelector('.at-delete-btn').addEventListener('click', async () => {
      await sb.from('admin_weekly_tasks').delete().eq('id', t.id);
      await refreshTasksList();
    });

    list.appendChild(card);
  });
}

document.getElementById('back-to-tiles-20').addEventListener('click', backToTiles);
