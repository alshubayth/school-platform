/* =========================================================================
 * نافس: المعلم المشرف على مادة يدخل إجابات أسئلتها ومهارة كل سؤال من حسابه.
 * المدير يحدد في نموذج الإجابة مدى أسئلة كل مادة ومعلمها المشرف (answer_keys.parts)،
 * فيظهر النموذج هنا للمعلم، ويُحفظ جزؤه فقط (دالة nafes_part_save).
 * ========================================================================= */
import { sb, currentUserId } from './core.js';
import { fetchSavedKeys, SKILL_SUGGEST } from './answer-sheet.js';

const AR = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let box = null, mine = [];

export async function renderNafesAssignments(container) {
  box = container; if (!box) return;
  box.innerHTML = '';
  const { data } = await fetchSavedKeys();
  mine = (data || []).filter(k => Array.isArray(k.parts) && k.parts.some(p => p.teacher_id === currentUserId));
  if (!mine.length) return;
  draw();
}

function progress(k, p) {
  let a = 0, s = 0;
  for (let q = p.from - 1; q < p.to; q++) { if ((k.answers || [])[q] != null) a++; if ((k.skills || [])[q] && k.skills[q].k) s++; }
  return { a, s, t: p.to - p.from + 1 };
}

function draw() {
  box.innerHTML = `<div class="nf-as">
    <div class="nf-as-h"><b>نماذج نافس المسندة إليك</b><span>أدخل الإجابة الصحيحة ومهارة كل سؤال في مادتك</span></div>
    ${mine.map(k => k.parts.filter(p => p.teacher_id === currentUserId).map(p => { const g = progress(k, p); const done = g.a === g.t && g.s === g.t; return `
      <div class="nf-as-it${done ? ' done' : ''}">
        <div><b>${esc(k.title)}</b><span>${esc(p.s)} · الأسئلة ${p.from}–${p.to}</span></div>
        <span class="nf-pg">${done ? '✓ مكتمل' : `الإجابات ${g.a}/${g.t} · المهارات ${g.s}/${g.t}`}</span>
        <button type="button" class="btn-primary" data-k="${k.id}" data-from="${p.from}">${done ? 'مراجعة' : 'إدخال الإجابات والمهارات'}</button>
      </div>`; }).join('')).join('')}
  </div>`;
  box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => openEditor(mine.find(k => k.id === b.dataset.k), +b.dataset.from));
}

function openEditor(k, from) {
  const p = k.parts.find(x => x.teacher_id === currentUserId && +x.from === from);
  const answers = Array.from({ length: k.questions }, (_, i) => (k.answers || [])[i] ?? null);
  const skills = Array.from({ length: k.questions }, (_, i) => ((k.skills || [])[i] && k.skills[i].k ? { ...k.skills[i] } : null));
  const bank = [...new Set([...(SKILL_SUGGEST[p.s] || []), ...skills.filter(x => x && x.s === p.s).map(x => x.k)])];
  let back = document.getElementById('nf-back');
  if (!back) { back = document.createElement('div'); back.id = 'nf-back'; back.className = 'rp-back'; document.body.appendChild(back); }
  back.classList.remove('hidden');
  document.body.classList.add('db-noscroll');
  const close = () => { back.classList.add('hidden'); document.body.classList.remove('db-noscroll'); };
  const letters = AR.slice(0, k.choices || 4);
  const render = () => {
    let a = 0, s = 0; for (let q = p.from - 1; q < p.to; q++) { if (answers[q] != null) a++; if (skills[q]) s++; }
    const t = p.to - p.from + 1;
    back.innerHTML = `<div class="rp nf-ed" role="dialog" aria-modal="true" aria-label="إجابات ${esc(p.s)}">
      <div class="rp-h"><b>${esc(p.s)} · ${esc(k.title)}</b><button type="button" class="rp-ib" data-x aria-label="إغلاق">✕</button></div>
      <p class="rp-note">لكل سؤال: اضغط الإجابة الصحيحة واختر المهارة. الأسئلة ${p.from}–${p.to}.</p>
      <div class="nf-bulk"><span>تطبيق مهارة على الأسئلة المحددة:</span><select id="nf-bulk-sk"><option value="">اختر المهارة...</option>${bank.map(x => `<option>${esc(x)}</option>`).join('')}</select><button type="button" class="rp-btn sm ghost" id="nf-bulk-go">تطبيق</button></div>
      <div class="nf-rows">${Array.from({ length: t }, (_, i) => { const q = p.from - 1 + i; return `<div class="nf-row" data-q="${q}">
        <label class="nf-qn"><input type="checkbox" data-sel="${q}"><b>${q + 1}</b></label>
        <div class="nf-ch">${letters.map((l, c) => `<button type="button" class="${answers[q] === c ? 'on' : ''}" data-a="${c}">${l}</button>`).join('')}</div>
        <select data-s="${q}" class="${skills[q] ? '' : 'miss'}"><option value="">المهارة...</option>${bank.map(x => `<option${skills[q] && skills[q].k === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
      </div>`; }).join('')}</div>
      <div class="nf-foot"><span class="nf-pg${a === t && s === t ? ' ok' : ''}">الإجابات ${a}/${t} · المهارات ${s}/${t}</span><span class="rp-err" id="nf-err"></span><button type="button" class="rp-btn" id="nf-save">حفظ</button></div>
    </div>`;
    back.querySelector('[data-x]').onclick = close;
    back.querySelectorAll('.nf-row').forEach(row => {
      const q = +row.dataset.q;
      row.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { answers[q] = +b.dataset.a; render(); });
      row.querySelector('[data-s]').onchange = e => { skills[q] = e.target.value ? { s: p.s, k: e.target.value } : null; render(); };
    });
    back.querySelector('#nf-bulk-go').onclick = () => {
      const v = back.querySelector('#nf-bulk-sk').value; if (!v) return;
      const sel = [...back.querySelectorAll('[data-sel]:checked')].map(x => +x.dataset.sel);
      if (!sel.length) { back.querySelector('#nf-err').textContent = 'حدد الأسئلة أولًا من مربعات الأرقام'; return; }
      sel.forEach(q => { skills[q] = { s: p.s, k: v }; }); render();
    };
    back.querySelector('#nf-save').onclick = async () => {
      const btn = back.querySelector('#nf-save'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
      const { data, error } = await sb.rpc('nafes_part_save', { p_key: k.id, p_answers: answers, p_skills: skills });
      if (error || (data && data.error)) { back.querySelector('#nf-err').textContent = 'تعذر الحفظ: ' + ((data && data.error) || error.message); btn.disabled = false; btn.textContent = 'حفظ'; return; }
      k.answers = answers.slice(); k.skills = skills.slice();
      close(); draw();
    };
  };
  back.onclick = e => { if (e.target === back) close(); };
  render();
}
