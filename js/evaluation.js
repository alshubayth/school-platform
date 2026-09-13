import { sb, currentProfile } from './core.js';

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function initials(name) { return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join(''); }

const NOTE_TYPE_LABELS = { positive: 'إيجابية', negative: 'سلبية', neutral: 'محايدة' };
const NOTE_TYPE_STYLE = {
  positive: { bg: 'var(--green-light)', fg: 'var(--green)' },
  negative: { bg: 'var(--danger-light)', fg: 'var(--danger)' },
  neutral: { bg: 'var(--sand)', fg: 'var(--slate)' },
};

let employeesCache = [];
let indicatorsAllCache = [];   // كل المؤشرات (بما فيها المعطّلة) - نحتاجها لحساب الدرجات القديمة بدقة
let indicatorsActiveCache = []; // المفعّلة فقط - تُستخدم بنموذج تسجيل الملاحظة
let notesCache = [];
let detailEmployeeId = null;

export async function loadNotesModule() {
  const isAdmin = currentProfile.role === 'admin';
  document.getElementById('eval-tab-settings').classList.toggle('hidden', !isAdmin);
  showEvalDetail(false);
  showEvalTab('overview');
  await refreshAll();
}

async function refreshAll() {
  const [{ data: employees }, { data: indicators }, { data: notes }] = await Promise.all([
    sb.from('employees').select('id, full_name, job_title').order('full_name'),
    sb.from('indicators').select('id, name, weight, active').order('created_at', { ascending: true }),
    sb.from('notes')
      .select('id, employee_id, indicator_id, note_type, score, content, recorded_by, created_at, indicators(name), profiles:recorded_by(full_name)')
      .order('created_at', { ascending: false }),
  ]);
  employeesCache = employees || [];
  indicatorsAllCache = indicators || [];
  indicatorsActiveCache = indicatorsAllCache.filter(i => i.active !== false);
  notesCache = notes || [];

  populateEmployeeSelect();
  populateIndicatorSelect();
  renderStats();
  renderEmployeeList();
  if (currentProfile.role === 'admin') renderIndicatorsSettings();
  if (detailEmployeeId) renderDetail(detailEmployeeId);
}

/* ---------- حساب الدرجة النهائية وتفصيل المؤشرات لكل موظف ---------- */
function employeeStats(employeeId) {
  const indicatorById = new Map(indicatorsAllCache.map(i => [i.id, i]));
  const empNotes = notesCache.filter(n => n.employee_id === employeeId);
  const scoredByIndicator = new Map();
  empNotes.forEach(n => {
    if ((n.note_type === 'positive' || n.note_type === 'negative') && n.score != null && n.indicator_id) {
      if (!scoredByIndicator.has(n.indicator_id)) scoredByIndicator.set(n.indicator_id, []);
      scoredByIndicator.get(n.indicator_id).push(n.score);
    }
  });
  const breakdown = Array.from(scoredByIndicator.entries()).map(([indId, scores]) => {
    const ind = indicatorById.get(indId);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { id: indId, name: ind ? ind.name : 'مؤشر محذوف', weight: ind ? Number(ind.weight) || 1 : 1, avg, count: scores.length };
  }).sort((a, b) => b.weight - a.weight);
  const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
  const finalScore = totalWeight > 0 ? breakdown.reduce((s, b) => s + b.avg * b.weight, 0) / totalWeight : null;
  return { totalNotes: empNotes.length, breakdown, finalScore, notes: empNotes };
}

/* ---------- تبويبات القسم: نظرة عامة / تسجيل ملاحظة / الإعدادات ---------- */
const EVAL_TABS = ['overview', 'record', 'settings'];
function showEvalTab(tab) {
  if (!EVAL_TABS.includes(tab)) tab = 'overview';
  EVAL_TABS.forEach(t => {
    document.getElementById(`eval-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`eval-panel-${t}`).classList.toggle('hidden', t !== tab);
  });
}
EVAL_TABS.forEach(t => {
  document.getElementById(`eval-tab-${t}`).addEventListener('click', () => showEvalTab(t));
});

/* ---------- بطاقات الإحصائيات ---------- */
const STAT_ICON_STYLE = {
  employees: { bg: 'var(--meadow-light)', fg: 'var(--meadow)', path: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>' },
  notes: { bg: 'var(--teal-light)', fg: 'var(--teal)', path: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 10h8M8 14h6"/>' },
  top: { bg: 'var(--gold-light)', fg: 'var(--gold)', path: '<path d="M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-4z"/>' },
};
function statCard(label, value, sub, icon) {
  const style = STAT_ICON_STYLE[icon];
  return `<div class="stat-card bud-stat">
    <div class="icon-chip" style="background:${style.bg}; color:${style.fg};">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${style.path}</svg>
    </div>
    <div class="body">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div style="font-size:11px; color:var(--slate); margin-top:4px; font-weight:600;">${sub}</div>` : ''}
    </div>
  </div>`;
}

function renderStats() {
  const statsEl = document.getElementById('eval-stats');
  let best = { name: '-', score: -1 };
  employeesCache.forEach(e => {
    const { finalScore } = employeeStats(e.id);
    if (finalScore != null && finalScore > best.score) best = { name: e.full_name, score: finalScore };
  });
  statsEl.innerHTML = [
    statCard('عدد الموظفين', employeesCache.length, null, 'employees'),
    statCard('إجمالي الملاحظات', notesCache.length, null, 'notes'),
    statCard('أعلى تقييم', best.score >= 0 ? best.name.split(' ')[0] : '-', best.score >= 0 ? `${best.score.toFixed(1)} / 5` : null, 'top'),
  ].join('');
}

/* ---------- قائمة الموظفين (نظرة عامة) ---------- */
function ringSVG(score) {
  const pct = score ? Math.min(score / 5, 1) : 0;
  const r = 16, circ = 2 * Math.PI * r;
  const color = !score ? '#D8D5C8' : score >= 4 ? '#1D8FA6' : score >= 2.5 ? '#E8763A' : '#B3413A';
  return `<svg width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="#ECEAE1" stroke-width="4"/>
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="4"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}" stroke-linecap="round"
      transform="rotate(-90 20 20)"/>
  </svg>`;
}

function renderEmployeeList() {
  const list = document.getElementById('eval-employee-list');
  if (employeesCache.length === 0) {
    list.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px;">لا يوجد موظفون مضافون بعد. أضفهم من قسم "بوابة الموظفين" أولاً.</p>';
    return;
  }
  list.innerHTML = employeesCache.map(e => {
    const { finalScore, totalNotes } = employeeStats(e.id);
    return `<div class="emp-row" data-employee-id="${e.id}" style="cursor:pointer;">
      <div class="avatar-circle">${esc(initials(e.full_name))}</div>
      <div class="info"><div class="name">${esc(e.full_name)}</div><div class="title">${esc(e.job_title || '')} · ${totalNotes} ملاحظة</div></div>
      <div class="ring-wrap">${ringSVG(finalScore)}<span class="ring-score">${finalScore != null ? finalScore.toFixed(1) : '-'}</span></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.emp-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.employeeId));
  });
}

/* ---------- تقرير المعلم (تفصيل) ---------- */
function showEvalDetail(show) {
  document.getElementById('eval-overview-list-view').classList.toggle('hidden', show);
  document.getElementById('eval-detail-view').classList.toggle('hidden', !show);
  if (!show) detailEmployeeId = null;
}
document.getElementById('eval-detail-back').addEventListener('click', () => showEvalDetail(false));

function openDetail(employeeId) {
  detailEmployeeId = employeeId;
  showEvalDetail(true);
  renderDetail(employeeId);
}

function renderDetail(employeeId) {
  const emp = employeesCache.find(e => e.id === employeeId);
  if (!emp) { showEvalDetail(false); return; }
  const { finalScore, breakdown, notes } = employeeStats(employeeId);

  document.getElementById('eval-detail-avatar').textContent = initials(emp.full_name);
  document.getElementById('eval-detail-name').textContent = emp.full_name;
  document.getElementById('eval-detail-title').textContent = emp.job_title || '';
  document.getElementById('eval-detail-ring').innerHTML = `${ringSVG(finalScore)}<span class="ring-score">${finalScore != null ? finalScore.toFixed(1) : '-'}</span>`;

  const breakdownEl = document.getElementById('eval-detail-breakdown');
  if (breakdown.length === 0) {
    breakdownEl.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px 0;">لا توجد ملاحظات مقيَّمة (إيجابية/سلبية) على هذا المعلم بعد.</p>';
  } else {
    breakdownEl.innerHTML = breakdown.map(b => {
      const pct = Math.min(b.avg / 5, 1) * 100;
      const color = b.avg >= 4 ? 'var(--green)' : b.avg >= 2.5 ? 'var(--gold)' : 'var(--danger)';
      return `<div class="eval-breakdown-row">
        <div class="eb-name">${esc(b.name)} <span style="color:var(--slate); font-weight:400;">(${b.count})</span></div>
        <div class="eb-bar-wrap"><div class="eb-bar" style="width:${pct}%; background:${color};"></div></div>
        <div class="eb-score">${b.avg.toFixed(1)}</div>
      </div>`;
    }).join('');
  }

  const notesEl = document.getElementById('eval-detail-notes');
  if (notes.length === 0) {
    notesEl.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px 0;">لا توجد ملاحظات مسجلة بعد.</p>';
  } else {
    notesEl.innerHTML = notes.map(n => {
      const style = NOTE_TYPE_STYLE[n.note_type] || NOTE_TYPE_STYLE.neutral;
      const indName = n.indicators ? n.indicators.name : null;
      const recBy = n.profiles ? n.profiles.full_name : null;
      const date = n.created_at ? new Date(n.created_at).toLocaleDateString('ar-SA') : '';
      const metaParts = [indName, recBy ? `بواسطة ${recBy}` : null, date].filter(Boolean);
      return `<div class="eval-note-row">
        <span class="eval-note-badge" style="background:${style.bg}; color:${style.fg};">${NOTE_TYPE_LABELS[n.note_type] || n.note_type}</span>
        <div class="eval-note-body">
          <div class="eval-note-content">${esc(n.content)}</div>
          <div class="eval-note-meta">${metaParts.map(esc).join(' · ')}</div>
        </div>
        ${n.score != null ? `<div class="eval-note-score" style="color:${style.fg};">${n.score}</div>` : ''}
        <button class="eval-note-delete" data-note-id="${n.id}" title="حذف الملاحظة">×</button>
      </div>`;
    }).join('');
    notesEl.querySelectorAll('.eval-note-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteNote(btn.dataset.noteId));
    });
  }
}

async function deleteNote(noteId) {
  if (!confirm('حذف هذه الملاحظة؟')) return;
  const { error } = await sb.from('notes').delete().eq('id', noteId);
  if (error) { alert('تعذر الحذف: ' + error.message); return; }
  await refreshAll();
}

/* ---------- نموذج تسجيل ملاحظة ---------- */
function populateEmployeeSelect() {
  const sel = document.getElementById('note-employee');
  const prevVal = sel.value;
  sel.innerHTML = '';
  employeesCache.forEach(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.full_name; sel.appendChild(o); });
  if (prevVal && employeesCache.some(e => e.id === prevVal)) sel.value = prevVal;
}

function populateIndicatorSelect() {
  const sel = document.getElementById('note-indicator');
  const prevVal = sel.value;
  if (indicatorsActiveCache.length === 0) {
    sel.innerHTML = '<option value="">لا توجد مؤشرات مفعّلة بعد</option>';
    return;
  }
  sel.innerHTML = '';
  indicatorsActiveCache.forEach(i => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.name; sel.appendChild(o); });
  if (prevVal && indicatorsActiveCache.some(i => i.id === prevVal)) sel.value = prevVal;
}

document.getElementById('note-type').addEventListener('change', () => {
  const isNeutral = document.getElementById('note-type').value === 'neutral';
  document.getElementById('note-scored-row').classList.toggle('hidden', isNeutral);
});

document.getElementById('note-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('note-error');
  const employeeId = document.getElementById('note-employee').value;
  const noteType = document.getElementById('note-type').value;
  const text = document.getElementById('note-text').value.trim();

  if (!employeeId) { errEl.textContent = 'أضف موظفًا أولاً من قسم بوابة الموظفين'; errEl.style.display = 'block'; return; }
  if (!text) { errEl.textContent = 'اكتب نص الملاحظة أولاً'; errEl.style.display = 'block'; return; }

  const isNeutral = noteType === 'neutral';
  const indicatorId = isNeutral ? null : (document.getElementById('note-indicator').value || null);
  if (!isNeutral && !indicatorId) { errEl.textContent = 'اختر المؤشر المرتبط بالملاحظة (أو أضف مؤشرًا من الإعدادات أولاً)'; errEl.style.display = 'block'; return; }

  errEl.style.display = 'none';
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('notes').insert({
    employee_id: employeeId,
    indicator_id: indicatorId,
    recorded_by: userData.user.id,
    note_type: noteType,
    score: isNeutral ? null : parseInt(document.getElementById('note-score').value),
    content: text,
  });
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }
  document.getElementById('note-text').value = '';
  await refreshAll();
});

/* ---------- الإعدادات: إدارة المؤشرات (للمدير فقط) ---------- */
function renderIndicatorsSettings() {
  const list = document.getElementById('eval-indicators-list');
  if (indicatorsAllCache.length === 0) {
    list.innerHTML = '<p style="font-size:12px; color:var(--slate); padding:10px 4px;">لا توجد مؤشرات بعد. أضف أول مؤشر بالأسفل.</p>';
    return;
  }
  list.innerHTML = indicatorsAllCache.map(ind => `
    <div class="eval-indicator-row ${ind.active === false ? 'inactive' : ''}">
      <div class="ei-name">${esc(ind.name)}</div>
      <div class="ei-weight">الوزن: ${ind.weight}</div>
      <div class="ei-actions">
        <button class="ei-toggle-btn" data-id="${ind.id}" data-active="${ind.active !== false}">${ind.active === false ? 'تفعيل' : 'تعطيل'}</button>
        <button class="ei-delete-btn" data-id="${ind.id}">حذف</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.ei-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === 'true';
      const { error } = await sb.from('indicators').update({ active: !active }).eq('id', btn.dataset.id);
      if (error) { alert('تعذر التحديث: ' + error.message); return; }
      await refreshAll();
    });
  });
  list.querySelectorAll('.ei-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const hasNotes = notesCache.some(n => n.indicator_id === btn.dataset.id);
      const msg = hasNotes
        ? 'هذا المؤشر مرتبط بملاحظات مسجلة سابقًا. حذفه سيفصل تلك الملاحظات عنه (تبقى الملاحظات نفسها، لكن بدون مؤشر ولن تُحتسب ضمن الدرجة النهائية بعد الحذف). تعطيله بدل حذفه أسلم غالبًا. متابعة الحذف؟'
        : 'حذف هذا المؤشر؟';
      if (!confirm(msg)) return;
      const { error } = await sb.from('indicators').delete().eq('id', btn.dataset.id);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      await refreshAll();
    });
  });
}

document.getElementById('eval-add-indicator-btn').addEventListener('click', async () => {
  const nameEl = document.getElementById('eval-new-indicator-name');
  const weightEl = document.getElementById('eval-new-indicator-weight');
  const errEl = document.getElementById('eval-indicator-error');
  const name = nameEl.value.trim();
  const weight = parseFloat(weightEl.value);

  if (!name) { errEl.textContent = 'اكتب اسم المؤشر'; errEl.style.display = 'block'; return; }
  if (!weight || weight <= 0) { errEl.textContent = 'اكتب وزن أكبر من صفر'; errEl.style.display = 'block'; return; }

  errEl.style.display = 'none';
  const { error } = await sb.from('indicators').insert({ name, weight, active: true });
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }
  nameEl.value = '';
  weightEl.value = '1';
  await refreshAll();
});
