import { sb } from './core.js';

let employeesCache = [];
export async function loadNotesModule() {
  const [{ data: employees }, { data: indicators }] = await Promise.all([
    sb.from('employees').select('id, full_name, job_title'),
    sb.from('indicators').select('id, name, weight'),
  ]);
  employeesCache = employees || [];
  const empSelect = document.getElementById('note-employee');
  empSelect.innerHTML = '';
  employeesCache.forEach(e => { const o=document.createElement('option'); o.value=e.id; o.textContent=e.full_name; empSelect.appendChild(o); });
  const indSelect = document.getElementById('note-indicator');
  indSelect.innerHTML = '';
  (indicators||[]).forEach(i => { const o=document.createElement('option'); o.value=i.id; o.textContent=i.name; indSelect.appendChild(o); });
  if (!indicators || indicators.length === 0) {
    document.getElementById('add-note-form').innerHTML = '<p style="color:var(--slate);font-size:13px">لا توجد مؤشرات مضافة بعد. أضف صفوف في جدول indicators من Table Editor أولاً.</p>';
  }
  await refreshEvaluations();
}

document.getElementById('note-submit').addEventListener('click', async () => {
  const text = document.getElementById('note-text').value.trim();
  const errEl = document.getElementById('note-error');
  if (!text) { errEl.textContent = 'اكتب نص الملاحظة أولاً'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('notes').insert({
    employee_id: document.getElementById('note-employee').value,
    indicator_id: document.getElementById('note-indicator').value,
    recorded_by: userData.user.id,
    note_type: document.getElementById('note-type').value,
    score: parseInt(document.getElementById('note-score').value),
    content: text,
  });
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }
  document.getElementById('note-text').value = '';
  await refreshEvaluations();
});

function ringSVG(score){
  const pct = score ? Math.min(score/5,1) : 0;
  const r = 16, circ = 2*Math.PI*r;
  const color = !score ? '#D8D5C8' : score>=4 ? '#1D8FA6' : score>=2.5 ? '#E8763A' : '#B3413A';
  return `<svg width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="#ECEAE1" stroke-width="4"/>
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="4"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ*(1-pct)}" stroke-linecap="round"
      transform="rotate(-90 20 20)"/>
  </svg>`;
}

async function refreshEvaluations() {
  const { data: evals } = await sb.from('employee_evaluations').select('*');
  const list = document.getElementById('employee-list');
  list.innerHTML = '';
  let totalNotes = 0, best = { name: '-', score: 0 };
  (evals || []).forEach(e => {
    totalNotes += e.total_notes || 0;
    if (e.final_score && e.final_score > best.score) best = { name: e.full_name, score: e.final_score };
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div><div class="name">${e.full_name}</div><div class="title">${e.job_title || ''} · ${e.total_notes || 0} ملاحظة</div></div>
      <div class="ring-wrap">${ringSVG(e.final_score)}<span class="ring-score">${e.final_score ?? '-'}</span></div>`;
    list.appendChild(row);
  });
  document.getElementById('stat-emp-count').textContent = employeesCache.length;
  document.getElementById('stat-notes-count').textContent = totalNotes;
  document.getElementById('stat-top').textContent = best.score ? best.name.split(' ')[0] : '-';
}
