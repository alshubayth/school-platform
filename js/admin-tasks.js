import { sb, currentUserId, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';

/* ===== المهام الإدارية: لوحة مصفوفة أيزنهاور أسبوعية للمدير/الوكيل - شريط أسابيع أفقي
 * (نفس نمط "مهامي الأسبوعية" بالخطة التشغيلية)، وعرض المهام كأربع أرباع ملوّنة حسب الأولوية
 * بدل قائمة نصية طويلة ===== */

const WEEKS_TOTAL = 40;
let atWeek = 1;
let selectedPriority = 'important_urgent';
let staffCache = [];

const PRIORITY_ORDER = ['important_urgent', 'important_not_urgent', 'urgent_not_important', 'not_important_not_urgent'];
const PRIORITY_LABELS = {
  important_urgent: 'هام وعاجل',
  important_not_urgent: 'هام وغير عاجل',
  urgent_not_important: 'عاجل وغير هام',
  not_important_not_urgent: 'غير هام وغير عاجل',
};

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

export async function loadAdminTasksModule() {
  await loadStaffOptions();
  renderWeekStrip();
  renderPriorityGrid();
  await refreshBoard();
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

/* ---------- شريط الأسابيع الأفقي ---------- */
function renderWeekStrip() {
  const strip = document.getElementById('at-week-strip');
  strip.innerHTML = '';
  for (let w = 1; w <= WEEKS_TOTAL; w++) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'at-week-pill' + (w === atWeek ? ' active' : '');
    pill.textContent = String(w);
    pill.title = 'الأسبوع ' + w;
    pill.addEventListener('click', () => {
      if (w === atWeek) return;
      atWeek = w;
      renderWeekStrip();
      refreshBoard();
    });
    strip.appendChild(pill);
  }
  const activePill = strip.querySelector('.at-week-pill.active');
  if (activePill) activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

/* ---------- منتقي الأولوية (مربعات مصفوفة أيزنهاور) ---------- */
function renderPriorityGrid() {
  const grid = document.getElementById('at-priority-grid');
  grid.querySelectorAll('.at-priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pr === selectedPriority);
    btn.onclick = () => {
      selectedPriority = btn.dataset.pr;
      renderPriorityGrid();
    };
  });
}

/* ---------- إضافة مهمة ---------- */
document.getElementById('at-add-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('at-error');
  errEl.style.display = 'none';

  const title = document.getElementById('at-title').value.trim();
  const respSel = document.getElementById('at-responsible').value;
  const respOther = document.getElementById('at-responsible-other').value.trim();
  const note = document.getElementById('at-note').value.trim();

  if (!title) { errEl.textContent = 'اكتب المهمة أولاً'; errEl.style.display = 'block'; return; }
  if (!respSel) { errEl.textContent = 'اختر مسؤول التنفيذ'; errEl.style.display = 'block'; return; }
  if (respSel === '__other__' && !respOther) { errEl.textContent = 'اكتب اسم مسؤول التنفيذ'; errEl.style.display = 'block'; return; }

  const row = {
    week_number: atWeek,
    title,
    responsible_profile_id: respSel === '__other__' ? null : respSel,
    responsible_other: respSel === '__other__' ? respOther : null,
    priority: selectedPriority,
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

  await refreshBoard();
});

/* ---------- لوحة الأرباع الأربعة ---------- */
async function refreshBoard() {
  const board = document.getElementById('at-board');
  board.innerHTML = '<div class="placeholder" style="padding:20px; grid-column:1/-1;"><p>جارٍ التحميل...</p></div>';

  const { data: tasks, error } = await readScopedBySchool(scoped => {
    let q = sb.from('admin_weekly_tasks')
      .select('id, title, responsible_profile_id, responsible_other, priority, status, note, profiles(full_name)')
      .eq('week_number', atWeek)
      .order('created_at', { ascending: true });
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

  if (error) {
    board.innerHTML = '<div class="placeholder" style="padding:20px; grid-column:1/-1;"><p>تعذّر تحميل المهام</p></div>';
    return;
  }

  const rows = tasks || [];
  document.getElementById('at-stat-total').textContent = rows.length;
  document.getElementById('at-stat-done').textContent = rows.filter(t => t.status === 'done').length;
  document.getElementById('at-stat-pending').textContent = rows.filter(t => t.status !== 'done').length;

  board.innerHTML = '';
  PRIORITY_ORDER.forEach(pr => {
    const quad = document.createElement('div');
    quad.className = `at-quad q-${pr}`;
    const prTasks = rows.filter(t => t.priority === pr);
    quad.innerHTML = `
      <div class="at-quad-head"><span class="dot"></span><span>${PRIORITY_LABELS[pr]}</span><span class="count">${prTasks.length}</span></div>
      <div class="at-quad-body"></div>`;
    const body = quad.querySelector('.at-quad-body');
    if (prTasks.length === 0) {
      body.innerHTML = '<div class="at-quad-empty">ما فيه مهام هنا</div>';
    } else {
      prTasks.forEach(t => body.appendChild(buildTaskCard(t)));
    }
    board.appendChild(quad);
  });
}

function buildTaskCard(t) {
  const responsibleName = t.responsible_profile_id ? (t.profiles ? t.profiles.full_name : '-') : t.responsible_other;
  const isDone = t.status === 'done';

  const card = document.createElement('div');
  card.className = `at-task-card pr-${t.priority}${isDone ? ' status-done' : ''}`;
  card.innerHTML = `
    <h6>${esc(t.title)}</h6>
    <p class="meta">مسؤول التنفيذ: ${esc(responsibleName || '-')}</p>
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
    <div class="foot-row">
      <button class="at-status-toggle ${isDone ? 'done' : 'pending'}">${isDone ? '✓ نفذ' : 'لم ينفذ بعد'}</button>
      <button class="at-delete-btn" title="حذف المهمة">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`;

  card.querySelector('.at-status-toggle').addEventListener('click', async () => {
    await sb.from('admin_weekly_tasks').update({ status: isDone ? 'pending' : 'done' }).eq('id', t.id);
    await refreshBoard();
  });
  card.querySelector('.at-delete-btn').addEventListener('click', async () => {
    await sb.from('admin_weekly_tasks').delete().eq('id', t.id);
    await refreshBoard();
  });

  return card;
}

document.getElementById('back-to-tiles-20').addEventListener('click', backToTiles);
