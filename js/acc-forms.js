/* =========================================================================
 * محرّك نماذج الاعتماد: مكتبة النماذج، التعبئة الإلكترونية على ترويسة الهيئة الملكية،
 * الحسابات التلقائية، الطباعة وتنزيل PDF، الحفظ في مؤشر، ورفع النسخة الموقعة توقيعًا حيًا.
 * المسودات في acc_form_docs، والشاهد في acc_evidence (kind=form، sign_state: pending ← signed).
 * ========================================================================= */
import { FORM_DEFS, FORM_GROUPS, N } from './acc-forms-defs.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCHOOL = 'متوسطة المروج';
const YEAR = '1448هـ';
const LIBS = { html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' };
const loadLib = k => new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIBS[k]; s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل مكتبة ' + k)); document.head.appendChild(s); });
const hijri = v => { if (!v) return ''; try { return new Date(v + 'T12:00:00').toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' }).replace(/\s*هـ$/, '') + 'هـ'; } catch { return v; } };
const colKey = k => 'c' + k;

let X = null; // سياق الوحدة الأم (sb, D, ...)
export function initForms(ctx) { X = ctx; }

/* =================== الحسابات =================== */
function tblRows(b, d) {
  const n = b.rows ? b.rows.length : Math.max(b.n || 1, (d[b.id] || []).length);
  if (!Array.isArray(d[b.id])) d[b.id] = [];
  while (d[b.id].length < n) d[b.id].push({});
  return d[b.id];
}
function mxCell(b, d) {
  const m = d[b.id] || [];
  const cell = (r, c) => {
    const col = b.cols[c], row = b.rows[r];
    if (col.auto) { const v = col.auto(d, r, cell); if (v != null) return v; }
    if (row.auto) return row.auto(d, c, cell);
    return (m[r] || [])[c] ?? '';
  };
  return cell;
}
const isAutoMx = (b, r, c, d) => (b.cols[c].auto && b.cols[c].auto(d, r, mxCell(b, d)) != null) || !!b.rows[r].auto;
const labelOf = (s, d) => { if (!s) return ''; if (s[0] !== '@') return s; const [k, f] = s.slice(1).split('|'); return d[k] || f; };

/* =================== الرسم =================== */
function fieldHtml(f, d, edit, ctx) {
  const [l, k, t = '', o] = f;
  let v = '';
  if (t === 'fx') return `<div class="acf-fx">${esc(o)}</div>`;
  if (t === 'auto') return `<div class="acf-auto" data-fa="${k}">${esc(o(d) || '')}</div>`;
  if (t === 'ind') {
    const i = d.ind ? (X.D.inds.find(x => x.id === d.ind)) : null;
    if (!edit) return `<div class="acf-v">${i ? `<bdi dir="ltr">${esc(i.code)}</bdi> ${esc(i.text)}` : esc(d.ind_text || '')}</div>`;
    const list = X.D.inds.filter(x => !x.not_applicable);
    const pri = list.filter(x => (X.cardOf(x).forms || []).includes(ctx.no));
    const opt = x => `<option value="${x.id}" ${x.id === d.ind ? 'selected' : ''}>${esc(x.code)} — ${esc(x.text.slice(0, 70))}</option>`;
    return `<select class="acf-in" data-b="h:ind"><option value="">— اختر المؤشر —</option>${pri.length ? `<optgroup label="مؤشرات يستخدمها هذا النموذج">${pri.map(opt).join('')}</optgroup>` : ''}<optgroup label="جميع المؤشرات">${list.filter(x => !pri.includes(x)).map(opt).join('')}</optgroup></select>`;
  }
  if (t === 'c' || t === 'r') {
    const cur = t === 'c' ? (Array.isArray(d[k]) ? d[k] : []) : d[k];
    return `<div class="acf-opts">${o.map(x => { const on = t === 'c' ? cur.includes(x) : cur === x;
      return edit ? `<button type="button" class="acf-op ${on ? 'on' : ''}" data-op="${t}:${k}" data-v="${esc(x)}"><i></i>${esc(x)}</button>` : `<span class="acf-op ${on ? 'on' : ''}"><i></i>${esc(x)}</span>`; }).join('')}</div>`;
  }
  v = d[k] ?? '';
  if (!edit) return `<div class="acf-v">${esc(t === 'd' ? hijri(v) : v)}</div>`;
  return `<input class="acf-in" data-b="h:${k}" ${t === 'd' ? 'type="date"' : t === 'n' ? 'inputmode="decimal"' : ''} value="${esc(v)}">`;
}
function fieldGrid(rowsDef, d, edit, ctx, first) {
  const rows = first ? [[['المدرسة', '_s', 'fx', SCHOOL], ['العام الدراسي', '_y', 'fx', YEAR]], ...rowsDef] : rowsDef;
  return `<div class="acf-grid">${rows.map(r => `<div class="acf-gr ${r.length === 1 ? 'one' : ''}">${r.map(f => `<div class="acf-gc ${f[0] ? '' : 'nolab'}">${f[0] ? `<label>${esc(f[0])}</label>` : ''}${fieldHtml(f, d, edit, ctx)}</div>`).join('')}</div>`).join('')}</div>`;
}
function cellHtml(b, col, ci, r, ri, edit) {
  const k = colKey(ci), v = r[k] ?? '';
  switch (col.t) {
    case 'fx': { const row = b.rows[ri]; return `<td class="fx">${esc(Array.isArray(row) ? row[col.i || 0] : row)}</td>`; }
    case 'sig': return `<td class="sig">${edit ? '<span>يوقَّع ورقيًا</span>' : ''}</td>`;
    case 'auto': return `<td class="auto" data-ta="${b.id}:${ri}:${ci}">${esc(col.f(r) ?? '')}</td>`;
    case 'pick': { const on = String(r._p ?? '') === String(col.v); return `<td class="pk">${edit ? `<button type="button" class="acf-box ${on ? 'on' : ''}" data-pick="${b.id}:${ri}" data-v="${esc(col.v)}" aria-label="${esc(col.l)}"></button>` : `<span class="acf-box ${on ? 'on' : ''}"></span>`}</td>`; }
    case 'chk': { const on = !!r[k]; return `<td class="pk">${edit ? `<button type="button" class="acf-box ${on ? 'on' : ''}" data-chk="${b.id}:${ri}:${k}" aria-label="${esc(col.l)}"></button>` : `<span class="acf-box ${on ? 'on' : ''}"></span>`}</td>`; }
    case 'sel': return edit ? `<td><select class="acf-in" data-b="t:${b.id}:${ri}:${k}"><option value=""></option>${col.o.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>` : `<td>${esc(v)}</td>`;
    case 'd': return edit ? `<td><input class="acf-in" type="date" data-b="t:${b.id}:${ri}:${k}" value="${esc(v)}"></td>` : `<td class="nw">${esc(hijri(v))}</td>`;
    case 'n': return edit ? `<td><input class="acf-in c" inputmode="decimal" data-b="t:${b.id}:${ri}:${k}" value="${esc(v)}"></td>` : `<td class="c">${esc(v)}</td>`;
    default: return edit ? `<td><textarea class="acf-in" rows="1" data-b="t:${b.id}:${ri}:${k}">${esc(v)}</textarea></td>` : `<td>${esc(v).replace(/\n/g, '<br>')}</td>`;
  }
}
function tblHtml(b, d, edit) {
  const rows = tblRows(b, d);
  const W = b.cols.reduce((s, c) => s + (c.w || 2), 0) + (b.num ? 0.45 : 0);
  const minW = Math.max(520, Math.round(W * 78));
  const total = b.total ? `<tr class="tot">${b.num ? '<td></td>' : ''}${b.cols.map((c, ci) => ci === 0 ? `<td class="fx">${esc(b.total)}</td>` : `<td class="auto" data-tt="${b.id}:${ci}">${esc(colTotal(b, rows, ci))}</td>`).join('')}</tr>` : '';
  return `<div class="acf-tw"><table class="acf-t" style="--minw:${minW}px"><colgroup>${b.num ? `<col style="width:${(0.45 / W * 100).toFixed(2)}%">` : ''}${b.cols.map(c => `<col style="width:${((c.w || 2) / W * 100).toFixed(2)}%">`).join('')}</colgroup>
    <thead><tr>${b.num ? '<th>م</th>' : ''}${b.cols.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, ri) => `<tr>${b.num ? `<td class="no">${ri + 1}</td>` : ''}${b.cols.map((c, ci) => cellHtml(b, c, ci, r, ri, edit)).join('')}</tr>`).join('')}${total}</tbody></table></div>
    ${edit && !b.rows ? `<button type="button" class="acf-addrow" data-addrow="${b.id}">+ إضافة صف</button>` : ''}`;
}
function colTotal(b, rows, ci) {
  const c = b.cols[ci]; if (!(c.sum || c.t === 'auto')) return '';
  const v = rows.map(r => N(c.t === 'auto' ? c.f(r) : r[colKey(ci)])).filter(Number.isFinite);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) * 10) / 10 : '';
}
function mxHtml(b, d, edit) {
  if (!Array.isArray(d[b.id])) d[b.id] = [];
  const m = d[b.id], cell = mxCell(b, d);
  return `<div class="acf-tw"><table class="acf-t mx" style="--minw:${Math.max(480, (b.cols.length + 1.6) * 110)}px"><thead><tr><th class="lab">البيان</th>${b.cols.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr></thead>
    <tbody>${b.rows.map((r, ri) => `<tr><td class="fx">${esc(r.l)}</td>${b.cols.map((c, ci) => isAutoMx(b, ri, ci, d) ? `<td class="auto" data-ma="${b.id}:${ri}:${ci}">${esc(cell(ri, ci))}</td>` : edit ? `<td><input class="acf-in c" inputmode="decimal" data-b="m:${b.id}:${ri}:${ci}" value="${esc((m[ri] || [])[ci] ?? '')}"></td>` : `<td class="c">${esc((m[ri] || [])[ci] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function chartSvg(b, d) {
  const rows = (d[b.src] || []).map(r => ({ l: String(r[colKey(b.lab)] || '').trim(), a: N(r[colKey(b.a)]), b: N(r[colKey(b.b)]) })).filter(r => r.l && Number.isFinite(r.a) && Number.isFinite(r.b));
  if (!rows.length) return '';
  const max = Math.max(...rows.flatMap(r => [r.a, r.b]), 1);
  const W = 680, rowH = 38, top = 6, lw = 220, H = top + rows.length * rowH + 4, bw = W - lw - 60;
  const la = labelOf(b.la, d), lb = labelOf(b.lb, d);
  const bar = (y, v, c) => { const w = Math.max(2, v / max * bw), x = W - lw - 10 - w; return `<rect x="${x}" y="${y}" width="${w}" height="13" rx="3" fill="${c}"/><text x="${x - 6}" y="${y + 11}" font-size="11" fill="#33415c" text-anchor="end">${v}</text>`; };
  return `<div class="acf-legend"><span><i style="background:#9BB0D6"></i>${esc(la)}</span><span><i style="background:#1B9E6E"></i>${esc(lb)}</span></div><svg viewBox="0 0 ${W} ${H}" class="acf-chart" xmlns="http://www.w3.org/2000/svg" direction="ltr" style="direction:ltr">
    ${rows.map((r, i) => { const y = top + i * rowH; return `<text x="${W - 6}" y="${y + 20}" font-size="12.5" text-anchor="start" fill="#1B2F74" direction="rtl">${esc(r.l.length > 32 ? r.l.slice(0, 31) + '…' : r.l)}</text>${bar(y + 2, r.a, '#9BB0D6')}${bar(y + 17, r.b, '#1B9E6E')}`; }).join('')}
    <line x1="${W - lw - 10}" y1="2" x2="${W - lw - 10}" y2="${H - 2}" stroke="#C9D3E6"/></svg>`;
}
function blockHtml(b, i, d, edit, ctx) {
  switch (b.k) {
    case 'h': return `<h4 class="acf-h">${esc(b.t)}${b.s ? ` <small>— ${esc(b.s)}</small>` : ''}</h4>`;
    case 'f': return fieldGrid(b.rows, d, edit, ctx, false);
    case 'tbl': return tblHtml(b, d, edit);
    case 'mx': return mxHtml(b, d, edit);
    case 'para': return `<p class="acf-para ${b.cls || ''}" ${b.t.includes('{') ? `data-pt="${i}"` : ''}>${paraText(b, d)}</p>`;
    case 'note': return `<p class="acf-note">${esc(b.t)}</p>`;
    case 'area': return `<div class="acf-area"><label>${esc(b.t)}</label>${edit ? `<textarea class="acf-in" rows="${b.h || 3}" data-b="h:${b.id}">${esc(d[b.id] || '')}</textarea>` : `<div class="acf-av" style="min-height:${(b.h || 3) * 22}px">${esc(d[b.id] || '').replace(/\n/g, '<br>')}</div>`}</div>`;
    case 'cols': return `<div class="acf-cols n${b.items.length}">${b.items.map((x, k) => `<div class="acf-area ${b.tone ? 't-' + b.tone[k] : ''}"><label>${esc(x.t)}</label>${edit ? `<textarea class="acf-in" rows="${b.h || 3}" data-b="h:${x.id}">${esc(d[x.id] || '')}</textarea>` : `<div class="acf-av" style="min-height:${(b.h || 3) * 22}px">${esc(d[x.id] || '').replace(/\n/g, '<br>')}</div>`}</div>`).join('')}</div>`;
    case 'static': return `<div class="acf-tw"><table class="acf-t st"><caption>${esc(b.t)}</caption><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, k) => `<td class="${k ? 'c' : 'fx'}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'chart': { const s = chartSvg(b, d); return `<div class="acf-chartw" data-chart="${i}">${s || (edit ? '<p class="acf-hint">📊 يُرسم المخطط تلقائيًا عند إدخال القيم في الجدول أعلاه.</p>' : '')}</div>`; }
    case 'photo': { const ph = Array.isArray(d[b.id]) ? d[b.id] : [];
      if (!edit && !ph.length) return '';
      return `<div class="acf-area"><label>${esc(b.t)}</label><div class="acf-photos">${ph.map((p, k) => `<figure><img src="${p}" alt="">${edit ? `<button type="button" data-rmph="${b.id}:${k}" aria-label="حذف">✕</button>` : ''}</figure>`).join('')}
        ${edit && ph.length < (b.n || 4) ? `<label class="acf-addph"><input type="file" accept="image/*" multiple data-addph="${b.id}" data-max="${b.n || 4}"><span>📷 إضافة صورة</span></label>` : ''}</div></div>`; }
    default: return '';
  }
}
const paraText = (b, d) => esc(b.t).replace(/\{(\w+)\}/g, (_, k) => d[k] ? `<b>${esc(d[k])}</b>` : '<span class="acf-blank"></span>');
function signsHtml(def, d, edit) {
  const s = d._sign || {};
  return `<div class="acf-signs n${def.s.length}">${def.s.map((t, k) => `<div class="acf-sign"><header>${esc(t)}</header>
    <div><span>الاسم:</span>${edit ? `<input class="acf-in" data-b="s:${k}" value="${esc(s[k] ?? '')}">` : `<b>${esc(s[k] || '')}</b>`}</div>
    <div><span>التوقيع:</span><b></b></div><div><span>التاريخ:</span><b class="dt">/ &nbsp; / ${YEAR}</b></div></div>`).join('')}</div>`;
}
export function paperHtml(no, d, edit) {
  const def = FORM_DEFS[no], ctx = { no };
  return `<article class="acf-paper ${edit ? 'edit' : 'print'}" data-form="${no}">
    <header class="acf-lh"><img src="/logo-rc-t.png" alt="الهيئة الملكية للجبيل وينبع"></header>
    <div class="acf-title"><span class="acf-no" dir="ltr">ن${no}</span><div><h3>${esc(def.t)}</h3><p>${esc(def.d)}</p><em>يستخدمه: ${esc(def.u)}</em></div>${def.secret ? '<b class="acf-secret">سري</b>' : ''}</div>
    ${fieldGrid(def.h, d, edit, ctx, true)}
    ${def.b.map((b, i) => `<section class="acf-blk">${blockHtml(b, i, d, edit, ctx)}</section>`).join('')}
    ${signsHtml(def, d, edit)}
    <footer class="acf-ft"><span>منصة مدار · نماذج حقيبة التميّز</span><span>ن${no}</span></footer>
  </article>`;
}

/* =================== التحديث التلقائي =================== */
function refreshAuto(root, no, d) {
  const def = FORM_DEFS[no];
  const all = [...def.h.flat(), ...def.b.filter(b => b.k === 'f').flatMap(b => b.rows.flat())];
  root.querySelectorAll('[data-fa]').forEach(el => { const f = all.find(x => x[1] === el.dataset.fa); if (f) el.textContent = f[3](d) || ''; });
  root.querySelectorAll('[data-ta]').forEach(el => { const [id, ri, ci] = el.dataset.ta.split(':'); const b = def.b.find(x => x.id === id); el.textContent = b.cols[+ci].f((d[id] || [])[+ri] || {}) ?? ''; });
  root.querySelectorAll('[data-tt]').forEach(el => { const [id, ci] = el.dataset.tt.split(':'); const b = def.b.find(x => x.id === id); el.textContent = colTotal(b, d[id] || [], +ci); });
  root.querySelectorAll('[data-ma]').forEach(el => { const [id, ri, ci] = el.dataset.ma.split(':'); const b = def.b.find(x => x.k === 'mx' && x.id === id); el.textContent = mxCell(b, d)(+ri, +ci) ?? ''; });
  root.querySelectorAll('[data-chart]').forEach(el => { const b = def.b[+el.dataset.chart]; const s = chartSvg(b, d); el.innerHTML = s || '<p class="acf-hint">📊 يُرسم المخطط تلقائيًا عند إدخال القيم في الجدول أعلاه.</p>'; });
  root.querySelectorAll('[data-pt]').forEach(el => { el.innerHTML = paraText(def.b[+el.dataset.pt], d); });
}

/* =================== الصور =================== */
async function compressImg(f, max = 1100, q = 0.78) {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', q);
}

/* =================== المحرّر =================== */
const defaultsFor = (no, ind) => {
  const def = FORM_DEFS[no], me = X.nameOf(X.currentUserId);
  const d = { _sign: {} };
  const keys = [...def.h.flat(), ...def.b.filter(b => b.k === 'f').flatMap(b => b.rows.flat())].map(f => f[1]);
  ['resp', 'by', 'coord', 'coun'].forEach(k => { if (keys.includes(k)) d[k] = me; });
  if (keys.includes('ind') && ind) d.ind = ind.id;
  const pr = (X.D.roles && X.D.roles.principal || [])[0];
  def.s.forEach((t, k) => { if (/قائد المدرسة/.test(t) && pr) d._sign[k] = X.nameOf(pr); else if (k === 0 && !/ولي الأمر|الجهة|الزائر/.test(t)) d._sign[k] = me; });
  return d;
};
const docName = (no, d) => { const def = FORM_DEFS[no]; const k = ['name', 'body', 'topic', 'title', 'doc', 'team', 'org', 'subj', 'teacher', 'student', 'period', 'month']; const v = k.map(x => d[x]).find(x => x && String(x).trim()); return def.t + (v ? ' — ' + String(v).trim().slice(0, 60) : ''); };

export function openFormEditor({ no, doc = null, ind = null, onClose }) {
  const def = FORM_DEFS[no]; if (!def) return;
  const st = { no, id: doc ? doc.id : null, d: doc ? structuredClone(doc.data || {}) : defaultsFor(no, ind), ind: doc ? doc.indicator_id : (ind && ind.id) || null, dirty: false, saving: null, tm: null };
  const ev = st.id ? X.D.evs.find(e => e.form_doc === st.id) : null;
  const locked = ev && !['draft', 'returned'].includes(ev.status);
  const wrap = document.createElement('div'); wrap.className = 'acf-ed';
  wrap.innerHTML = `<div class="acf-bar"><button type="button" class="acf-b ghost" data-close>→ رجوع</button><div class="acf-bt"><b>ن${no} · ${esc(def.t)}</b><small id="acf-state">${st.id ? 'محفوظ' : 'مسودة جديدة — تُحفظ تلقائيًا'}</small></div>
    <div class="acf-acts"><button type="button" class="acf-b ghost" data-print title="طباعة">🖨<span> طباعة</span></button><button type="button" class="acf-b ghost" data-pdf title="تنزيل PDF">⬇<span> PDF</span></button>
    ${ev ? `<span class="acf-linked">مرتبط بالمؤشر ${esc((X.D.inds.find(i => i.id === ev.indicator_id) || {}).code || '')}</span>` : '<button type="button" class="acf-b" data-toind>📌 حفظ في مؤشر</button>'}</div></div>
    ${locked ? '<div class="acf-lockmsg">🔒 هذا النموذج مرسل للمراجعة؛ يمكنك الاطلاع والطباعة فقط.</div>' : ''}
    <div class="acf-stage">${paperHtml(no, st.d, !locked)}</div>`;
  document.body.appendChild(wrap); document.documentElement.classList.add('acf-open');
  const paper = () => wrap.querySelector('.acf-paper');
  const state = t => { const s = wrap.querySelector('#acf-state'); if (s) s.textContent = t; };
  const save = async () => {
    clearTimeout(st.tm); if (!st.dirty || locked) return st.id;
    if (st.saving) { await st.saving; if (!st.dirty) return st.id; }
    st.dirty = false; state('جارٍ الحفظ…');
    st.saving = (async () => {
      const row = { form_no: no, title: docName(no, st.d), data: st.d, indicator_id: st.d.ind || st.ind || null, updated_at: new Date().toISOString() };
      if (st.id) { const { error } = await X.sb.from('acc_form_docs').update(row).eq('id', st.id); if (error) { st.dirty = true; state('تعذر الحفظ'); X.toast('تعذر حفظ النموذج: ' + error.message, true); return; } }
      else { const { data, error } = await X.writeWithSchool(extra => X.sb.from('acc_form_docs').insert({ ...row, created_by: X.currentUserId, ...extra }).select().single()); if (error) { st.dirty = true; state('تعذر الحفظ'); X.toast('تعذر حفظ النموذج: ' + error.message, true); return; } st.id = data.id; X.D.formDocs = [data, ...(X.D.formDocs || [])]; }
      const fd = (X.D.formDocs || []).find(x => x.id === st.id); if (fd) Object.assign(fd, row);
      state('محفوظ ✓ ' + new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' }));
    })();
    await st.saving; st.saving = null; return st.id;
  };
  const touch = () => { st.dirty = true; state('تعديلات غير محفوظة…'); clearTimeout(st.tm); st.tm = setTimeout(save, 1200); refreshAuto(paper(), no, st.d); };
  const redraw = () => { const y = wrap.querySelector('.acf-stage').scrollTop; wrap.querySelector('.acf-stage').innerHTML = paperHtml(no, st.d, !locked); wrap.querySelector('.acf-stage').scrollTop = y; autosize(); };
  const autosize = () => wrap.querySelectorAll('textarea.acf-in').forEach(t => { if (t.closest('td')) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; } });
  autosize();

  wrap.addEventListener('input', e => {
    const el = e.target.closest('[data-b]'); if (!el) return;
    const [kind, a, b, c] = el.dataset.b.split(':');
    if (kind === 'h') st.d[a] = el.value;
    else if (kind === 't') { st.d[a] = st.d[a] || []; (st.d[a][+b] = st.d[a][+b] || {})[c] = el.value; }
    else if (kind === 'm') { st.d[a] = st.d[a] || []; (st.d[a][+b] = st.d[a][+b] || [])[+c] = el.value; }
    else if (kind === 's') (st.d._sign = st.d._sign || {})[a] = el.value;
    if (el.tagName === 'TEXTAREA' && el.closest('td')) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    touch();
  });
  wrap.addEventListener('change', e => { if (e.target.matches('select[data-b], input[type=date][data-b]')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  wrap.addEventListener('click', async e => {
    const t = e.target.closest('button, [data-close]'); if (!t) return;
    if (t.dataset.op) { const [ty, k] = t.dataset.op.split(':'), v = t.dataset.v;
      if (ty === 'c') { const a = new Set(Array.isArray(st.d[k]) ? st.d[k] : []); a.has(v) ? a.delete(v) : a.add(v); st.d[k] = [...a]; t.classList.toggle('on'); }
      else { st.d[k] = st.d[k] === v ? '' : v; t.parentElement.querySelectorAll('.acf-op').forEach(x => x.classList.toggle('on', x === t && st.d[k] === v)); }
      touch(); return; }
    if (t.dataset.pick) { const [id, ri] = t.dataset.pick.split(':'); const r = (st.d[id] = st.d[id] || [])[+ri] = st.d[id][+ri] || {}; r._p = String(r._p) === t.dataset.v ? null : (isNaN(+t.dataset.v) ? t.dataset.v : +t.dataset.v);
      t.closest('tr').querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', String(r._p) === x.dataset.v)); touch(); return; }
    if (t.dataset.chk) { const [id, ri, k] = t.dataset.chk.split(':'); const r = (st.d[id] = st.d[id] || [])[+ri] = st.d[id][+ri] || {}; r[k] = !r[k]; t.classList.toggle('on', r[k]); touch(); return; }
    if (t.dataset.addrow) { const b = FORM_DEFS[no].b.find(x => x.id === t.dataset.addrow); tblRows(b, st.d).push({}); redraw(); touch(); return; }
    if (t.dataset.rmph) { const [id, k] = t.dataset.rmph.split(':'); st.d[id].splice(+k, 1); redraw(); touch(); return; }
    if (t.hasAttribute('data-close')) { await save(); close(); return; }
    if (t.hasAttribute('data-print')) { await save(); printForm(no, st.d); return; }
    if (t.hasAttribute('data-pdf')) { t.disabled = true; try { await save(); await downloadPdf(no, st.d); } catch (er) { X.toast(er.message || 'تعذر إنشاء الملف', true); } t.disabled = false; return; }
    if (t.hasAttribute('data-toind')) { st.dirty = true; const id = await save(); if (!id) return; pickIndicator(no, st, () => { close(); }); }
  });
  wrap.addEventListener('change', async e => {
    const inp = e.target.closest('[data-addph]'); if (!inp) return;
    const id = inp.dataset.addph, max = +inp.dataset.max;
    st.d[id] = Array.isArray(st.d[id]) ? st.d[id] : [];
    for (const f of [...inp.files].slice(0, max - st.d[id].length)) { try { st.d[id].push(await compressImg(f)); } catch { X.toast('تعذر قراءة الصورة', true); } }
    redraw(); touch();
  });
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.acx-modal')) save().then(close); };
  const close = () => { document.removeEventListener('keydown', onKey); if (!wrap.isConnected) return; wrap.remove(); document.documentElement.classList.remove('acf-open'); if (onClose) onClose(); };
  document.addEventListener('keydown', onKey);
}

/* =================== الحفظ في مؤشر =================== */
function pickIndicator(no, st, done) {
  const mine = X.D.inds.filter(i => !i.not_applicable && X.canUpload(i));
  const uses = mine.filter(i => (X.cardOf(i).forms || []).includes(no));
  const others = mine.filter(i => !uses.includes(i));
  const pre = st.d.ind;
  const row = i => `<button type="button" class="acf-pi ${i.locked ? 'dis' : ''} ${i.id === pre ? 'pre' : ''}" data-pi="${i.id}" ${i.locked ? 'disabled' : ''}><span class="acx-code">${esc(i.code)}</span><b>${esc(i.text)}</b>${i.locked ? '<small>🔒 مرسل للمراجعة</small>' : i.id === pre ? '<small>المؤشر المرتبط في النموذج</small>' : ''}</button>`;
  const m = X.modal(`<header><b>حفظ النموذج في مؤشر</b><button type="button" class="acx-x" data-x>✕</button></header>
    <p class="acx-muted">يُضاف النموذج إلى شواهد المؤشر بحالة <b>«بانتظار التوقيع»</b>: اطبعه، ووقّعه توقيعًا حيًا، ثم صوّره وارفعه من صفحة المؤشر. لا يمكن إرسال المؤشر للمراجعة قبل رفع النسخة الموقعة.</p>
    ${mine.length ? `${uses.length ? `<h5 class="acf-ph">مؤشراتك التي تستخدم هذا النموذج</h5><div class="acf-pl">${uses.map(row).join('')}</div>` : '<p class="acx-muted">لا يوجد من مؤشراتك ما يستخدم هذا النموذج في الحقيبة.</p>'}
    ${others.length ? `<details class="acf-more"><summary>مؤشراتك الأخرى (${others.length})</summary><div class="acf-pl">${others.map(row).join('')}</div></details>` : ''}` : '<div class="acx-empty sm">لا توجد مؤشرات مسندة إليك. يمكنك طباعة النموذج أو تنزيله PDF.</div>'}`, 'wide');
  m.querySelectorAll('[data-pi]').forEach(b => b.onclick = async () => {
    const i = X.D.inds.find(x => x.id === b.dataset.pi); b.disabled = true;
    const title = docName(no, st.d);
    const { data, error } = await X.writeWithSchool(extra => X.sb.from('acc_evidence').insert({ indicator_id: i.id, uploaded_by: X.currentUserId, status: 'draft', kind: 'form', form_no: no, sign_state: 'pending', form_doc: st.id, ev_label: title, title, linked_ids: [], ...extra }).select().single());
    if (error) { b.disabled = false; X.toast('تعذر الحفظ: ' + error.message, true); return; }
    await X.sb.from('acc_form_docs').update({ indicator_id: i.id }).eq('id', st.id);
    X.D.evs.push(data);
    m.remove(); X.toast('حُفظ النموذج في المؤشر ' + i.code + ' — بانتظار رفع النسخة الموقعة');
    done(); X.openIndicator(i.id);
  });
}

/* =================== الطباعة و PDF =================== */
export function printForm(no, d) {
  let root = document.getElementById('acf-print-root');
  if (!root) { root = document.createElement('div'); root.id = 'acf-print-root'; document.body.appendChild(root); }
  root.innerHTML = paperHtml(no, d, false);
  document.documentElement.classList.add('acf-printing');
  const done = () => { document.documentElement.classList.remove('acf-printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const imgs = [...root.querySelectorAll('img')];
  Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => { window.print(); setTimeout(() => { if (!matchMedia('print').matches) done(); }, 1500); }, 60));
}
export async function downloadPdf(no, d, name) {
  if (!window.html2canvas) await loadLib('html2canvas');
  if (!window.jspdf) await loadLib('jspdf');
  X.toast('جارٍ إنشاء ملف PDF…');
  const host = document.createElement('div'); host.className = 'acf-pdfhost';
  host.innerHTML = paperHtml(no, d, false); document.body.appendChild(host);
  try {
    const el = host.firstElementChild;
    await Promise.all([...el.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const W = el.offsetWidth, pageH = Math.round(W * 297 / 210), base = el.getBoundingClientRect().top;
    // نقاط القطع: نهايات الصفوف والكتل
    const cuts = [...el.querySelectorAll('tr, .acf-blk, .acf-gr, .acf-title, .acf-signs, .acf-area, figure, .acf-para, .acf-h')].map(n => Math.round(n.getBoundingClientRect().bottom - base)).sort((a, b) => a - b);
    const total = el.scrollHeight, margin = 28, pages = [];
    let y = 0;
    while (y < total - 4) {
      const lim = y + pageH - margin * 2;
      if (lim >= total) { pages.push([y, total]); break; }
      const c = cuts.filter(v => v > y + 120 && v <= lim).pop() || lim;
      pages.push([y, c]); y = c;
    }
    const scale = 2;
    const canvas = await window.html2canvas(el, { scale, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: W });
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight(), k = PW / W;
    pages.forEach(([a, b], idx) => {
      if (idx) pdf.addPage();
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = Math.round((b - a) * scale);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(canvas, 0, Math.round(a * scale), canvas.width, c.height, 0, 0, canvas.width, c.height);
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, idx ? margin * k : 0, PW, (b - a) * k);
      if (pages.length > 1) { pdf.setFontSize(9); pdf.setTextColor(140); pdf.text(`${idx + 1} / ${pages.length}`, PW / 2, PH - 14, { align: 'center' }); }
    });
    pdf.save((name || `ن${no} ${docName(no, d)}`).replace(/[\\/:*?"<>|]/g, '-').slice(0, 90) + '.pdf');
  } finally { host.remove(); }
}

/* =================== رفع النسخة الموقعة =================== */
export function uploadSigned(e, after) {
  let pages = []; // {url, file}
  const m = X.modal('', 'wide');
  const draw = () => {
    m.querySelector('.acx-modal-b').innerHTML = `<header><b>رفع النسخة الموقعة</b><button type="button" class="acx-x" data-x>✕</button></header>
      <p class="acx-muted">«${esc(e.ev_label || e.title)}» — صوّر كل صفحة موقعة بالجوال (يمكن عدة صفحات)، وستُدمج في ملف PDF واحد. أو ارفع ملف PDF جاهزًا.</p>
      <div class="acf-scan">${pages.map((p, k) => `<figure>${p.pdf ? '<span class="pdf">PDF</span>' : `<img src="${p.url}" alt="">`}<figcaption>صفحة ${k + 1}</figcaption><div>${k ? `<button type="button" data-up="${k}" title="تقديم">▲</button>` : ''}<button type="button" data-rm="${k}" title="حذف">✕</button></div></figure>`).join('')}
        <label class="acf-scanadd"><input type="file" accept="image/*" capture="environment" data-cam><span>📷<b>تصوير صفحة</b></span></label>
        <label class="acf-scanadd alt"><input type="file" accept="image/*,application/pdf" multiple data-files><span>🗂<b>من الملفات</b></span></label></div>
      <footer><span class="acx-err"></span><button type="button" class="acx-btn" data-go ${pages.length ? '' : 'disabled'}>⬆ رفع ${pages.length > 1 ? pages.length + ' صفحات' : ''}</button></footer>`;
    const add = async fl => { for (const f of fl) { if (f.type === 'application/pdf') { pages = [{ pdf: true, file: f }]; break; } try { pages.push({ url: await compressImg(f, 1800, 0.85) }); } catch { X.toast('تعذر قراءة الصورة', true); } } draw(); };
    m.querySelector('[data-cam]').onchange = ev => add([...ev.target.files]);
    m.querySelector('[data-files]').onchange = ev => add([...ev.target.files]);
    m.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pages.splice(+b.dataset.rm, 1); draw(); });
    m.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const k = +b.dataset.up; [pages[k - 1], pages[k]] = [pages[k], pages[k - 1]]; draw(); });
    m.querySelector('[data-go]').onclick = async ev => {
      const btn = ev.target; btn.disabled = true; btn.textContent = 'جارٍ التجهيز…';
      try {
        let blob;
        if (pages[0] && pages[0].pdf) blob = pages[0].file;
        else {
          if (!window.jspdf) await loadLib('jspdf');
          const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
          const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight();
          for (const [k, p] of pages.entries()) {
            if (k) pdf.addPage();
            const im = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = p.url; });
            const s = Math.min((PW - 24) / im.width, (PH - 24) / im.height); const w = im.width * s, h = im.height * s;
            pdf.addImage(p.url, 'JPEG', (PW - w) / 2, (PH - h) / 2, w, h);
          }
          blob = pdf.output('blob');
        }
        if (blob.size > 25 * 1024 * 1024) throw new Error('الملف أكبر من 25 م.ب');
        btn.textContent = 'جارٍ الرفع…';
        const path = `${X.currentSchoolId}/${e.indicator_id}/${Date.now()}-signed-${Math.random().toString(36).slice(2, 7)}.pdf`;
        const up = await X.sb.storage.from(X.BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false });
        if (up.error) throw new Error(up.error.message);
        const fname = (e.ev_label || e.title || 'نموذج').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + ' (موقّع).pdf';
        const { data, error } = await X.sb.from('acc_evidence').update({ kind: 'file', storage_path: path, file_name: fname, file_size: blob.size, sign_state: 'signed' }).eq('id', e.id).select().single();
        if (error) { await X.sb.storage.from(X.BUCKET).remove([path]); throw new Error(error.message); }
        if (e.storage_path) await X.sb.storage.from(X.BUCKET).remove([e.storage_path]);
        Object.assign(e, data); m.remove(); X.toast('رُفعت النسخة الموقعة ✓'); if (after) after();
      } catch (er) { btn.disabled = false; btn.textContent = '⬆ رفع'; m.querySelector('.acx-err').textContent = er.message || 'تعذر الرفع'; }
    };
  };
  draw();
}

/* =================== مكتبة النماذج =================== */
export function libraryHtml(q = '') {
  const myForms = new Set(X.D.inds.filter(i => !i.not_applicable && X.canUpload(i)).flatMap(i => X.cardOf(i).forms || []));
  const docs = (X.D.formDocs || []).filter(x => x.created_by === X.currentUserId);
  const match = n => !q || FORM_DEFS[n].t.includes(q) || FORM_DEFS[n].d.includes(q) || ('ن' + n) === q;
  const card = n => { const f = FORM_DEFS[n]; const c = docs.filter(x => x.form_no === n).length;
    return `<button type="button" class="acf-card ${myForms.has(n) ? 'mine' : ''}" data-newform="${n}"><span class="acf-cn" dir="ltr">ن${n}</span><b>${esc(f.t)}</b><small>${esc(f.d)}</small>
      <em>${myForms.has(n) ? '<i class="tag">في مؤشراتك</i>' : ''}${c ? `<i class="tag d">${c} ${c === 1 ? 'مسودة' : 'مسودات'}</i>` : ''}</em></button>`; };
  const evState = id => { const e = X.D.evs.find(x => x.form_doc === id); if (!e) return '<i class="st">مسودة</i>'; const i = X.D.inds.find(x => x.id === e.indicator_id); return e.sign_state === 'pending' ? `<i class="st wait">بانتظار التوقيع · ${esc(i ? i.code : '')}</i>` : `<i class="st ok">في المؤشر ${esc(i ? i.code : '')}</i>`; };
  return `<div class="acf-lib">
    <div class="acf-libhead"><div><h3>مكتبة النماذج</h3><p>26 نموذجًا رسميًا من حقيبة التميّز على ترويسة الهيئة الملكية: عبّئ إلكترونيًا، والحسابات تلقائية، ثم اطبع ووقّع توقيعًا حيًا وارفع النسخة الموقعة إلى المؤشر.</p></div>
      <input type="search" class="acx-in" id="acf-q" placeholder="ابحث عن نموذج…" value="${esc(q)}"></div>
    <ol class="acf-steps"><li><b>عبّئ</b><span>إلكترونيًا مع الحفظ التلقائي</span></li><li><b>احفظ في مؤشر</b><span>يظهر بانتظار التوقيع</span></li><li><b>اطبع ووقّع</b><span>توقيع حي بالقلم</span></li><li><b>صوّر وارفع</b><span>تُدمج الصفحات PDF</span></li></ol>
    ${docs.length && !q ? `<section class="acf-sec"><h4>نماذجي <i>${docs.length}</i></h4><div class="acf-docs">${docs.map(x => `<div class="acf-doc"><button type="button" data-opendoc="${x.id}"><span class="acf-cn sm" dir="ltr">ن${x.form_no}</span><b>${esc(x.title || FORM_DEFS[x.form_no].t)}</b><small>${new Date(x.updated_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })} ${evState(x.id)}</small></button>${X.D.evs.some(e => e.form_doc === x.id) ? '' : `<button type="button" class="del" data-deldoc="${x.id}" title="حذف">🗑</button>`}</div>`).join('')}</div></section>` : ''}
    ${FORM_GROUPS.map(g => { const ns = g.n.filter(match); return ns.length ? `<section class="acf-sec"><h4>${esc(g.t)}</h4><div class="acf-cards">${ns.map(card).join('')}</div></section>` : ''; }).join('') || '<div class="acx-empty sm">لا يوجد نموذج بهذا الاسم</div>'}
  </div>`;
}
export function bindLibrary(box, rerender) {
  const q = box.querySelector('#acf-q');
  if (q) q.oninput = () => { const v = q.value.trim(), pos = q.selectionStart; rerender(v); const n = document.getElementById('acf-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  box.querySelectorAll('[data-newform]').forEach(b => b.onclick = () => openFormEditor({ no: +b.dataset.newform, onClose: () => rerender() }));
  box.querySelectorAll('[data-opendoc]').forEach(b => b.onclick = () => { const doc = X.D.formDocs.find(x => x.id === b.dataset.opendoc); openFormEditor({ no: doc.form_no, doc, onClose: () => rerender() }); });
  box.querySelectorAll('[data-deldoc]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف هذا النموذج نهائيًا؟')) return;
    const { error } = await X.sb.from('acc_form_docs').delete().eq('id', b.dataset.deldoc);
    if (error) { X.toast('تعذر الحذف: ' + error.message, true); return; }
    X.D.formDocs = X.D.formDocs.filter(x => x.id !== b.dataset.deldoc); rerender();
  });
}
export { FORM_DEFS };
