import { sb, currentSchoolId, currentUserId, readScopedBySchool, writeWithSchool, academicWeekInfo, printOrgName, printLogo } from './core.js';

/* =========================================================================
 * الخطة التشغيلية - تبويب «المؤشرات»: مؤشرات الأداء المطلوبة من الإدارة للمدرسة
 * لكل مؤشر: نص المؤشر، ومقياس أو أكثر (القراءة الحالية، المستهدف، المتحقق)، واتجاهه
 * (الأعلى أفضل، الأقل أفضل، المحافظة)، وربطه ببرنامج الخطة: مسؤوله ومهامه وإنجازها.
 * القيم النسبية تُحفظ كسور (0.05) وتُعرض وتُدخل كنسب مئوية (5).
 * ========================================================================= */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = v => Math.round(v * 100) / 100;
const STATUS = {
  met: { label: 'متحقق', cls: 'met' },
  near: { label: 'قريب من المستهدف', cls: 'near' },
  behind: { label: 'دون المستهدف', cls: 'behind' },
  pending: { label: 'لم يُرصد بعد', cls: 'pending' },
};
const DIR_LABEL = { up: 'الأعلى أفضل', down: 'الأقل أفضل', keep: 'المحافظة على المستوى' };

let kpis = [], programs = [], owners = new Map(), taskStats = new Map();
const filt = { level: '', status: '', q: '' };

/* ---------- القيم ---------- */
function fmtVal(v, unit) {
  if (v == null || v === '') return '—';
  if (!isNum(v)) return esc(v);
  if (unit === 'pct') return `${round(v * 100)}%`;
  return String(round(v));
}
const toInput = (v, unit) => (v == null ? '' : isNum(v) && unit === 'pct' ? String(round(v * 100)) : String(v));
function fromInput(s, unit) {
  const t = String(s || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').replace('%', '').trim();
  if (!t) return null;
  if (unit === 'text') return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return unit === 'pct' ? n / 100 : n;
}

function measureStatus(m, dir) {
  if (m.achieved == null || m.achieved === '') return 'pending';
  if (!isNum(m.target) || !isNum(m.achieved)) {
    if (m.unit === 'text' || dir === 'keep') return String(m.achieved).trim() === String(m.target).trim() ? 'met' : 'behind';
    return 'pending';
  }
  const a = m.achieved, t = m.target;
  if (dir === 'down') return a <= t ? 'met' : a <= Math.max(t * 1.25, t + 1) ? 'near' : 'behind';
  if (t <= 0) return 'met';
  const r = a / t;
  return r >= 1 ? 'met' : r >= 0.8 ? 'near' : 'behind';
}
function measureProgress(m, dir) {
  if (!isNum(m.achieved) || !isNum(m.target)) return measureStatus(m, dir) === 'met' ? 100 : 0;
  if (dir === 'down') return m.achieved <= m.target ? 100 : Math.max(0, Math.round((m.target / m.achieved) * 100));
  return m.target <= 0 ? 100 : Math.min(100, Math.round((m.achieved / m.target) * 100));
}
function kpiStatus(k) {
  const st = (k.measures || []).map(m => measureStatus(m, k.direction));
  if (!st.length || st.every(s => s === 'pending')) return 'pending';
  const rec = st.filter(s => s !== 'pending');
  return rec.includes('behind') ? 'behind' : rec.includes('near') || rec.length < st.length ? 'near' : 'met';
}

/* ---------- التحميل ---------- */
export async function loadOpKpis() {
  const box = $('op-kpis');
  if (!box) return;
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  try {
    const scoped = (table, cols) => readScopedBySchool(sc => { let q = sb.from(table).select(cols); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
    const [k, p, a, t, c] = await Promise.all([
      scoped('op_kpis', '*'), scoped('programs', 'id, title'), scoped('program_assignments', 'program_id, profile_id'),
      scoped('op_tasks', 'id, program_id, week_number, duration_type, recurrence, plan_status'), scoped('op_task_completions', 'task_id, status'),
    ]);
    if (k.error) throw k.error;
    kpis = (k.data || []).sort((x, y) => (x.level === y.level ? 0 : x.level === 'main' ? -1 : 1) || x.sort - y.sort);
    programs = (p.data || []).sort((x, y) => x.title.localeCompare(y.title, 'ar'));
    const ids = [...new Set((a.data || []).map(x => x.profile_id))];
    const names = new Map();
    if (ids.length) {
      const { data } = await sb.from('profiles').select('id, full_name').in('id', ids);
      (data || []).forEach(x => names.set(x.id, x.full_name));
    }
    owners = new Map();
    (a.data || []).forEach(x => { if (!owners.has(x.program_id)) owners.set(x.program_id, []); if (names.get(x.profile_id)) owners.get(x.program_id).push(names.get(x.profile_id)); });
    // إنجاز مهام كل برنامج: المعتمد، والمتأخر (مهمة أسبوع مضى بلا إنجاز معتمد)
    const done = new Set((c.data || []).filter(x => x.status === 'approved').map(x => x.task_id));
    const wk = academicWeekInfo();
    const curW = wk.current || (wk.next ? wk.next - 1 : 0);
    taskStats = new Map();
    (t.data || []).forEach(x => {
      if (!taskStats.has(x.program_id)) taskStats.set(x.program_id, { total: 0, done: 0, late: 0 });
      const s = taskStats.get(x.program_id);
      s.total++;
      if (done.has(x.id)) s.done++;
      else if (x.duration_type === 'single_week' && x.week_number && x.week_number < curW) s.late++;
    });
  } catch (e) {
    box.innerHTML = `<p class="sp-none">تعذر تحميل المؤشرات: ${esc(e.message || e)}</p>`;
    return;
  }
  render();
}

/* ---------- العرض ---------- */
function render() {
  const box = $('op-kpis');
  const counts = { met: 0, near: 0, behind: 0, pending: 0 };
  kpis.forEach(k => counts[kpiStatus(k)]++);
  box.innerHTML = `
    <div class="kp-head">
      <div><h4>مؤشرات الأداء المطلوب تحقيقها</h4><p>القراءة الحالية والمستهدف والمتحقق لكل مؤشر، وربطه ببرنامجه في الخطة ومهامه.</p></div>
      <div class="kp-acts">
        <button type="button" class="tx-btn ghost sm" id="kp-print">طباعة التقرير</button>
        <button type="button" class="tx-btn primary sm" id="kp-add">＋ مؤشر جديد</button>
      </div>
    </div>
    <div class="kp-tiles">
      <button type="button" data-st="" class="${!filt.status ? 'on' : ''}"><b>${kpis.length}</b><span>كل المؤشرات</span></button>
      ${Object.entries(STATUS).map(([k, s]) => `<button type="button" data-st="${k}" class="${s.cls}${filt.status === k ? ' on' : ''}"><b>${counts[k]}</b><span>${s.label}</span></button>`).join('')}
    </div>
    <div class="kp-filters">
      <div class="sp-seg">${[['', 'الكل'], ['main', 'الرئيسة'], ['sub', 'الفرعية']].map(([v, l]) => `<button type="button" data-lv="${v}" class="${filt.level === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="sp-search kp-search"><input type="search" id="kp-q" placeholder="ابحث عن مؤشر أو برنامج" value="${esc(filt.q)}" /></label>
    </div>
    <div id="kp-list"></div>`;
  box.querySelectorAll('.kp-tiles button').forEach(b => b.onclick = () => { filt.status = b.dataset.st; render(); });
  box.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { filt.level = b.dataset.lv; render(); });
  $('kp-q').oninput = e => { filt.q = e.target.value; renderList(); };
  $('kp-add').onclick = () => openEditor(null);
  $('kp-print').onclick = () => printReport();
  renderList();
}

function renderList() {
  const q = filt.q.trim();
  const list = kpis.filter(k => (!filt.level || k.level === filt.level) && (!filt.status || kpiStatus(k) === filt.status)
    && (!q || [k.title, k.school_target, programTitle(k.program_id)].join(' ').includes(q)));
  const groups = [['main', 'المؤشرات الرئيسة'], ['sub', 'المؤشرات الفرعية']].map(([lv, t]) => [t, list.filter(k => k.level === lv)]).filter(([, l]) => l.length);
  $('kp-list').innerHTML = groups.length ? groups.map(([t, l]) => `<h5 class="kp-group">${t} <small>${l.length}</small></h5><div class="kp-grid">${l.map(cardHtml).join('')}</div>`).join('')
    : '<p class="sp-none">لا توجد مؤشرات مطابقة</p>';
  $('kp-list').querySelectorAll('.kp-ach').forEach(inp => {
    inp.addEventListener('change', () => saveAchieved(inp));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  $('kp-list').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(kpis.find(k => k.id === b.dataset.edit)));
  $('kp-list').querySelectorAll('.kp-more').forEach(b => b.onclick = () => b.closest('.kp-target').classList.toggle('open'));
}

const programTitle = id => (programs.find(p => p.id === id) || {}).title || '';

function cardHtml(k) {
  const st = STATUS[kpiStatus(k)];
  const ms = k.measures || [];
  const ts = k.program_id ? taskStats.get(k.program_id) : null;
  const who = k.program_id ? (owners.get(k.program_id) || []) : [];
  return `<article class="kp-card ${st.cls}">
    <div class="kp-card-h">
      <span class="kp-lv">${k.level === 'main' ? 'رئيس' : 'فرعي'}</span>
      <h6>${esc(k.title)}</h6>
      <span class="kp-st ${st.cls}">${st.label}</span>
    </div>
    ${k.school_target ? `<div class="kp-target"><p>${esc(k.school_target)}</p>${k.school_target.length > 110 ? '<button type="button" class="kp-more">المزيد</button>' : ''}</div>` : ''}
    <table class="kp-m"><thead><tr><th></th><th>الحالي</th><th>المستهدف</th><th>المتحقق</th><th></th></tr></thead><tbody>
      ${ms.map((m, i) => { const s = measureStatus(m, k.direction); const pr = measureProgress(m, k.direction); return `<tr>
        <th>${esc(m.label || 'القيمة')}</th>
        <td>${m.baseline == null ? `<small>${esc(m.baseline_note || '—')}</small>` : fmtVal(m.baseline, m.unit)}</td>
        <td><b>${fmtVal(m.target, m.unit)}</b></td>
        <td><span class="kp-in"><input class="kp-ach" data-id="${k.id}" data-i="${i}" inputmode="${m.unit === 'text' ? 'text' : 'decimal'}" value="${esc(toInput(m.achieved, m.unit))}" placeholder="—" aria-label="المتحقق: ${esc(m.label || k.title)}" />${m.unit === 'pct' ? '<i>%</i>' : ''}</span></td>
        <td class="kp-bar-td"><span class="kp-bar ${STATUS[s].cls}"><i style="width:${s === 'pending' ? 0 : Math.max(4, pr)}%"></i></span></td>
      </tr>`; }).join('')}
    </tbody></table>
    <div class="kp-foot">
      ${k.program_id ? `<span class="kp-prog" title="البرنامج المرتبط في الخطة">▣ ${esc(programTitle(k.program_id))}</span>
        <span class="kp-who">${who.length ? esc(who.join('، ')) : '<em>بلا مسؤول</em>'}</span>
        <span class="kp-tasks">${ts ? `المهام ${ts.total} · المنجز ${ts.done}${ts.late ? ` · <b>متأخرة ${ts.late}</b>` : ''}` : '<em>لا توجد مهام</em>'}</span>`
        : '<span class="kp-prog none">غير مرتبط ببرنامج</span>'}
      <span class="kp-dir">${DIR_LABEL[k.direction] || ''}</span>
      <button type="button" class="kp-edit" data-edit="${k.id}" aria-label="تعديل المؤشر">تعديل</button>
    </div>
    ${k.note ? `<p class="kp-note">${esc(k.note)}</p>` : ''}
  </article>`;
}

async function saveAchieved(inp) {
  const k = kpis.find(x => x.id === inp.dataset.id);
  const i = +inp.dataset.i;
  const ms = (k.measures || []).map(m => ({ ...m }));
  ms[i].achieved = fromInput(inp.value, ms[i].unit);
  inp.disabled = true;
  const { error } = await sb.from('op_kpis').update({ measures: ms, updated_by: currentUserId, updated_at: new Date().toISOString() }).eq('id', k.id);
  inp.disabled = false;
  if (error) { alert('تعذر حفظ المتحقق: ' + error.message); return; }
  k.measures = ms;
  // تحديث البطاقة فقط مع إبقاء التركيز على الحقل التالي
  const card = inp.closest('.kp-card');
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(k);
  const fresh = tmp.firstElementChild;
  card.replaceWith(fresh);
  fresh.classList.add('saved');
  fresh.querySelectorAll('.kp-ach').forEach(x => { x.addEventListener('change', () => saveAchieved(x)); x.addEventListener('keydown', e => { if (e.key === 'Enter') x.blur(); }); });
  fresh.querySelector('[data-edit]').onclick = () => openEditor(k);
  const more = fresh.querySelector('.kp-more'); if (more) more.onclick = () => more.closest('.kp-target').classList.toggle('open');
  const counts = { met: 0, near: 0, behind: 0, pending: 0 };
  kpis.forEach(x => counts[kpiStatus(x)]++);
  document.querySelectorAll('.kp-tiles button[data-st]').forEach(b => { if (b.dataset.st) b.querySelector('b').textContent = counts[b.dataset.st]; });
}

/* ---------- إضافة وتعديل مؤشر ---------- */
function openEditor(k) {
  const isNew = !k;
  const d = k ? JSON.parse(JSON.stringify(k)) : { level: 'sub', title: '', school_target: '', direction: 'up', measures: [{ label: '', unit: 'num', baseline: null, target: null, achieved: null }], program_id: null, note: '' };
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  const mRow = (m, i) => `<div class="kp-ed-m" data-i="${i}">
    <input class="m-label" placeholder="اسم المقياس (اختياري)" value="${esc(m.label || '')}" />
    <select class="m-unit"><option value="num"${m.unit === 'num' ? ' selected' : ''}>عدد</option><option value="pct"${m.unit === 'pct' ? ' selected' : ''}>نسبة %</option><option value="text"${m.unit === 'text' ? ' selected' : ''}>نص</option></select>
    <input class="m-base" placeholder="الحالي" value="${esc(m.baseline == null ? (m.baseline_note || '') : toInput(m.baseline, m.unit))}" />
    <input class="m-target" placeholder="المستهدف" value="${esc(toInput(m.target, m.unit))}" />
    <button type="button" class="m-del" aria-label="حذف المقياس">✕</button>
  </div>`;
  back.innerHTML = `<div class="er-abs kp-ed" role="dialog" aria-modal="true" aria-label="${isNew ? 'مؤشر جديد' : 'تعديل المؤشر'}">
    <div class="er-abs-h"><div><b>${isNew ? 'مؤشر جديد' : 'تعديل المؤشر'}</b><span>${isNew ? '' : esc(k.title)}</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body">
      <label class="kp-f">اسم المؤشر<input id="kp-e-title" value="${esc(d.title)}" /></label>
      <label class="kp-f">نص المؤشر المطلوب من الإدارة<textarea id="kp-e-target" rows="3">${esc(d.school_target || '')}</textarea></label>
      <div class="kp-f2">
        <label class="kp-f">النوع<select id="kp-e-level"><option value="main"${d.level === 'main' ? ' selected' : ''}>رئيس</option><option value="sub"${d.level === 'sub' ? ' selected' : ''}>فرعي</option></select></label>
        <label class="kp-f">الاتجاه<select id="kp-e-dir">${Object.entries(DIR_LABEL).map(([v, l]) => `<option value="${v}"${d.direction === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="kp-f">البرنامج المرتبط في الخطة<select id="kp-e-prog"><option value="">غير مرتبط</option>${programs.map(p => `<option value="${p.id}"${d.program_id === p.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
      <div class="kp-f">المقاييس <small>(القيمة الحالية والمستهدف، والمتحقق يُرصد من البطاقة)</small>
        <div class="kp-ed-mh"><span>اسم المقياس</span><span>النوع</span><span>القراءة الحالية</span><span>المستهدف</span><span></span></div>
        <div id="kp-e-ms">${(d.measures || []).map(mRow).join('')}</div>
        <button type="button" class="text-action-btn" id="kp-e-addm">＋ إضافة مقياس</button>
      </div>
      <label class="kp-f">ملاحظة<input id="kp-e-note" value="${esc(d.note || '')}" placeholder="اختياري" /></label>
      <div class="error-msg" id="kp-e-err"></div>
    </div>
    <div class="er-man-foot">
      <button type="button" class="btn-primary" id="kp-e-save">حفظ</button>
      ${isNew ? '' : '<button type="button" class="text-action-btn kp-e-del" id="kp-e-del">حذف المؤشر</button>'}
      <button type="button" class="text-action-btn" id="kp-e-cancel">إلغاء</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('.er-abs-x').onclick = close;
  $('kp-e-cancel').onclick = close;
  back.addEventListener('click', e => { if (e.target === back) close(); });
  const wireDel = () => back.querySelectorAll('.m-del').forEach(b => b.onclick = () => { if (back.querySelectorAll('.kp-ed-m').length > 1) b.closest('.kp-ed-m').remove(); });
  wireDel();
  $('kp-e-addm').onclick = () => { $('kp-e-ms').insertAdjacentHTML('beforeend', mRow({ label: '', unit: 'num' }, back.querySelectorAll('.kp-ed-m').length)); wireDel(); };
  $('kp-e-save').onclick = async () => {
    const err = $('kp-e-err');
    const title = $('kp-e-title').value.trim();
    if (!title) { err.textContent = 'اكتب اسم المؤشر'; err.style.display = 'block'; return; }
    const old = d.measures || [];
    const measures = [...back.querySelectorAll('.kp-ed-m')].map((row, i) => {
      const unit = row.querySelector('.m-unit').value;
      const prev = old[+row.dataset.i] || {};
      const bRaw = row.querySelector('.m-base').value.trim();
      const b = fromInput(bRaw, unit);
      const m = { label: row.querySelector('.m-label').value.trim(), unit, baseline: isNum(b) || unit === 'text' ? b : null, target: fromInput(row.querySelector('.m-target').value, unit), achieved: prev.unit === unit ? prev.achieved ?? null : null };
      if (bRaw && !isNum(b) && unit !== 'text') m.baseline_note = bRaw;
      return m;
    });
    const row = { title, school_target: $('kp-e-target').value.trim() || null, level: $('kp-e-level').value, direction: $('kp-e-dir').value,
      program_id: $('kp-e-prog').value || null, note: $('kp-e-note').value.trim() || null, measures, updated_by: currentUserId, updated_at: new Date().toISOString() };
    $('kp-e-save').disabled = true;
    const res = isNew
      ? await writeWithSchool(extra => sb.from('op_kpis').insert({ ...row, academic_year: (kpis[0] && kpis[0].academic_year) || null, sort: Math.max(0, ...kpis.map(x => x.sort)) + 1, ...extra }))
      : await sb.from('op_kpis').update(row).eq('id', k.id);
    $('kp-e-save').disabled = false;
    if (res.error) { err.textContent = 'تعذر الحفظ: ' + res.error.message; err.style.display = 'block'; return; }
    close();
    loadOpKpis();
  };
  const del = $('kp-e-del');
  if (del) del.onclick = async () => {
    if (!confirm(`حذف المؤشر «${k.title}»؟`)) return;
    const { error } = await sb.from('op_kpis').delete().eq('id', k.id);
    if (error) { alert('تعذر الحذف: ' + error.message); return; }
    close();
    loadOpKpis();
  };
}

/* ---------- الطباعة ---------- */
function printReport() {
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة لطباعة التقرير'); return; }
  const logo = printLogo();
  const counts = { met: 0, near: 0, behind: 0, pending: 0 };
  kpis.forEach(k => counts[kpiStatus(k)]++);
  const rows = lv => kpis.filter(k => k.level === lv).map((k, idx) => {
    const ms = k.measures || [];
    return ms.map((m, i) => `<tr>${i === 0 ? `<td rowspan="${ms.length}">${idx + 1}</td><td rowspan="${ms.length}" class="n"><b>${esc(k.title)}</b><div class="t">${esc(k.school_target || '')}</div></td>` : ''}
      <td>${esc(m.label || '')}</td><td>${m.baseline == null ? esc(m.baseline_note || '—') : fmtVal(m.baseline, m.unit)}</td><td>${fmtVal(m.target, m.unit)}</td><td><b>${fmtVal(m.achieved, m.unit)}</b></td>
      ${i === 0 ? `<td rowspan="${ms.length}" class="s ${kpiStatus(k)}">${STATUS[kpiStatus(k)].label}</td><td rowspan="${ms.length}">${esc(programTitle(k.program_id))}${k.program_id && (owners.get(k.program_id) || []).length ? `<div class="t">${esc(owners.get(k.program_id).join('، '))}</div>` : ''}</td>` : ''}</tr>`).join('');
  }).join('');
  const table = (t, lv) => `<h3>${t}</h3><table><thead><tr><th>#</th><th>المؤشر</th><th>المقياس</th><th>الحالي</th><th>المستهدف</th><th>المتحقق</th><th>الحالة</th><th>البرنامج والمسؤول</th></tr></thead><tbody>${rows(lv)}</tbody></table>`;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير مؤشرات الأداء</title>
  <style>body{font-family:Tahoma,Arial,sans-serif;margin:22px;color:#152238;font-size:11.5px}.hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #152238;padding-bottom:10px;margin-bottom:12px}
  .hd img{height:54px}h1{font-size:18px;margin:0 0 3px}h3{font-size:14px;margin:16px 0 6px}.sub{color:#555;font-size:12px}
  .kp{display:flex;gap:8px;margin:8px 0}.kp div{flex:1;border:1px solid #d6dbe4;border-radius:8px;padding:7px;text-align:center;color:#555;font-size:11px}.kp b{display:block;font-size:17px;color:#152238}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #c9ced8;padding:5px;text-align:center;vertical-align:middle}th{background:#152238;color:#fff}td.n{text-align:right}.t{color:#666;font-size:10.5px;margin-top:2px}
  td.s.met{color:#1F6A3C;font-weight:bold}td.s.near{color:#A4501A;font-weight:bold}td.s.behind{color:#A63A33;font-weight:bold}td.s.pending{color:#777}
  tr{break-inside:avoid}.sig{display:flex;justify-content:space-between;margin-top:30px}</style></head><body>
  <div class="hd">${logo ? `<img src="${esc(logo)}">` : ''}<div><h1>تقرير مؤشرات الأداء</h1><div class="sub">${esc(printOrgName())}${kpis[0] && kpis[0].academic_year ? ` · العام الدراسي ${esc(kpis[0].academic_year)}هـ` : ''}</div></div></div>
  <div class="kp"><div><b>${kpis.length}</b>مؤشرًا</div><div><b>${counts.met}</b>متحقق</div><div><b>${counts.near}</b>قريب من المستهدف</div><div><b>${counts.behind}</b>دون المستهدف</div><div><b>${counts.pending}</b>لم يُرصد بعد</div></div>
  ${table('المؤشرات الرئيسة', 'main')}${table('المؤشرات الفرعية', 'sub')}
  <div class="sig"><span>وكيل الشؤون التعليمية: ..................</span><span>مدير المدرسة: ..................</span></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
