/* =========================================================================
 * الاعتماد المدرسي: شواهد مؤشرات التقويم المدرسي
 * - المؤشرات (acc_indicators) مرتبة: المجال ← المعيار ← المؤشر، ولكل مؤشر مسؤول أو أكثر من فريق التميز.
 * - عضو الفريق يرفع شواهد مؤشراته (ملف أو رابط)، والمدير أو الوكيل يعتمدها أو يعيدها بملاحظة.
 * - الجاهزية: المؤشر مكتمل إذا كان له شاهد معتمد واحد على الأقل.
 * - «وضع الزيارة»: عرض نظيف للشواهد المعتمدة أمام فريق التقويم، وطباعة فهرس الشواهد.
 * ========================================================================= */
import { sb, currentSchoolId, currentUserId, currentProfile, isAdminOrDeputy, readScopedBySchool, writeWithSchool, printOrgName, printLogo } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUCKET = 'acc-evidence';
const DOMAINS = { 1: 'الإدارة المدرسية', 2: 'التعليم والتعلم', 3: 'نواتج التعلم', 4: 'البيئة المدرسية' };
const DCOL = { 1: '#2455A4', 2: '#0E93A8', 3: '#6249A6', 4: '#C27A1E' };
const ST = {
  done: { t: 'مكتمل', c: 'done' }, pending: { t: 'بانتظار المراجعة', c: 'pend' }, returned: { t: 'معاد للتعديل', c: 'ret' },
  empty: { t: 'لا توجد شواهد', c: 'empty' }, na: { t: 'لا ينطبق', c: 'na' },
};
const IC = {
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
};

let D = { inds: [], evs: [], staff: [] };
let V = { domain: 0, filter: 'all', q: '', open: null, mine: false };
const mgr = () => isAdminOrDeputy() || (currentProfile && currentProfile.role === 'owner');
const R = build => readScopedBySchool(sc => { let q = build(); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
const nameOf = id => (D.staff.find(p => p.id === id) || {}).full_name || '—';
const short = n => { const w = String(n || '').trim().split(/\s+/).filter(x => !['بن', 'ابن'].includes(x)); return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' '); };
const evsOf = ind => D.evs.filter(e => e.indicator_id === ind.id);
function statusOf(ind) {
  if (ind.not_applicable) return 'na';
  const ev = evsOf(ind);
  if (ev.some(e => e.status === 'approved')) return 'done';
  if (ev.some(e => e.status === 'submitted')) return 'pending';
  if (ev.some(e => e.status === 'returned')) return 'returned';
  return 'empty';
}
const isMine = ind => (ind.owner_ids || []).includes(currentUserId);
const canUpload = ind => mgr() || isMine(ind);

function toast(msg, bad) {
  let t = $('ac-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ac-toast'; t.className = 'ac-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove('show'), 3200);
}

export async function loadAccreditationModule() {
  const box = $('acc-container');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const [inds, evs, staff] = await Promise.all([
    R(() => sb.from('acc_indicators').select('*').order('sort')),
    R(() => sb.from('acc_evidence').select('*').order('created_at')),
    R(() => sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher']).order('full_name')),
  ]);
  if (inds.error) { box.innerHTML = `<div class="ac-empty">تعذر تحميل المؤشرات: ${esc(inds.error.message)}</div>`; return; }
  D = { inds: inds.data || [], evs: evs.data || [], staff: (staff.data || []).filter(p => p.full_name) };
  if (!mgr()) V.mine = true;
  render();
}

/* ---------- الواجهة ---------- */
function render() {
  const box = $('acc-container');
  const app = D.inds.filter(i => !i.not_applicable);
  const done = app.filter(i => statusOf(i) === 'done').length;
  const pct = app.length ? Math.round(done / app.length * 100) : 0;
  const pend = D.evs.filter(e => e.status === 'submitted').length;
  const noOwner = D.inds.filter(i => !i.not_applicable && !(i.owner_ids || []).length).length;
  const mineN = D.inds.filter(isMine).length;
  const R2 = 52, C = 2 * Math.PI * R2;
  box.innerHTML = `<div class="ac">
    <header class="ac-hero">
      <div class="ac-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R2}" class="bg"/><circle cx="60" cy="60" r="${R2}" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/></svg><b>${pct}%</b><span>الجاهزية</span></div>
      <div class="ac-hero-t">
        <h3>الاعتماد المدرسي</h3>
        <p>شواهد مؤشرات التقويم المدرسي لزيارة فريق التقويم الخارجي</p>
        <div class="ac-stats">
          <span><b>${done}</b> من ${app.length} مؤشرًا مكتمل</span>
          <span><b>${D.evs.length}</b> شاهدًا مرفوعًا</span>
          ${mgr() ? `<span class="${pend ? 'warn' : ''}"><b>${pend}</b> بانتظار المراجعة</span>` : ''}
          ${mgr() && noOwner ? `<span class="warn"><b>${noOwner}</b> مؤشرًا بلا مسؤول</span>` : ''}
          ${mineN ? `<span><b>${mineN}</b> مسندة إليك</span>` : ''}
        </div>
      </div>
      <div class="ac-hero-a">
        <button type="button" class="ac-btn light" id="ac-visit">${IC.eye}وضع الزيارة</button>
        <button type="button" class="ac-btn light" id="ac-print">${IC.print}فهرس الشواهد</button>
      </div>
    </header>
    <div class="ac-domains">${[1, 2, 3, 4].map(d => {
      const ii = D.inds.filter(i => i.domain_no === d && !i.not_applicable);
      const dn = ii.filter(i => statusOf(i) === 'done').length, p = ii.length ? Math.round(dn / ii.length * 100) : 0;
      return `<button type="button" class="ac-dom${V.domain === d ? ' on' : ''}" data-dom="${d}" style="--c:${DCOL[d]}"><span class="n">${d}</span><b>${DOMAINS[d]}</b><small>${dn} من ${ii.length} مؤشرًا</small><i><em style="width:${p}%"></em></i><span class="p">${p}%</span></button>`;
    }).join('')}</div>
    <div class="ac-tools">
      <div class="ac-chips">${[['all', 'الكل'], ['empty', 'بلا شواهد'], ['pending', 'بانتظار المراجعة'], ['returned', 'معاد للتعديل'], ['done', 'مكتمل']].map(([k, t]) => `<button type="button" data-f="${k}" class="${V.filter === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <label class="ac-mine"><input type="checkbox" id="ac-mine"${V.mine ? ' checked' : ''}> مؤشراتي فقط</label>
      <input type="search" id="ac-q" class="ac-q" placeholder="ابحث في المؤشرات..." value="${esc(V.q)}">
    </div>
    <div id="ac-list"></div>
  </div>`;
  box.querySelectorAll('[data-dom]').forEach(b => b.onclick = () => { V.domain = V.domain === +b.dataset.dom ? 0 : +b.dataset.dom; render(); });
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { V.filter = b.dataset.f; render(); });
  $('ac-mine').onchange = e => { V.mine = e.target.checked; renderList(); };
  $('ac-q').oninput = e => { V.q = e.target.value; renderList(); };
  $('ac-visit').onclick = openVisit;
  $('ac-print').onclick = printIndex;
  renderList();
}

function renderList() {
  const el = $('ac-list');
  const q = V.q.trim();
  const list = D.inds.filter(i => (!V.domain || i.domain_no === V.domain)
    && (V.filter === 'all' || statusOf(i) === V.filter)
    && (!V.mine || isMine(i))
    && (!q || i.text.includes(q) || i.code.includes(q) || i.standard.includes(q)));
  if (!list.length) { el.innerHTML = `<div class="ac-empty">${V.mine && !D.inds.some(isMine) ? 'لا توجد مؤشرات مسندة إليك' : 'لا توجد مؤشرات مطابقة'}</div>`; return; }
  const groups = [];
  list.forEach(i => { let g = groups.find(x => x.std === i.standard && x.d === i.domain_no); if (!g) { g = { std: i.standard, d: i.domain_no, items: [] }; groups.push(g); } g.items.push(i); });
  el.innerHTML = groups.map(g => {
    const all = D.inds.filter(i => i.standard === g.std && i.domain_no === g.d && !i.not_applicable);
    const dn = all.filter(i => statusOf(i) === 'done').length;
    return `<section class="ac-std" style="--c:${DCOL[g.d]}">
      <header><span class="dom">${DOMAINS[g.d]}</span><b>${esc(g.std)}</b><span class="cnt">${dn}/${all.length}</span></header>
      ${g.items.map(rowHtml).join('')}
    </section>`;
  }).join('');
  el.querySelectorAll('.ac-ind > .ac-row').forEach(r => r.onclick = () => { const id = r.parentElement.dataset.id; V.open = V.open === id ? null : id; renderList(); if (V.open) setTimeout(() => { const x = el.querySelector(`.ac-ind[data-id="${V.open}"]`); if (x) x.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30); });
  el.querySelectorAll('.ac-ind.open').forEach(wireDetail);
}

function rowHtml(i) {
  const s = ST[statusOf(i)], ev = evsOf(i), open = V.open === i.id;
  const owners = i.owner_ids || [];
  return `<div class="ac-ind${open ? ' open' : ''}${i.not_applicable ? ' na' : ''}" data-id="${i.id}">
    <div class="ac-row" role="button" tabindex="0">
      <span class="code">${esc(i.code)}</span>
      <div class="txt"><b>${esc(i.text)}${i.star ? ' <i class="star" title="مؤشر مميز بعلامة (*) في الإطار">*</i>' : ''}</b>
        <span class="own">${owners.length ? owners.map(o => `<em${o === currentUserId ? ' class="me"' : ''}>${esc(short(nameOf(o)))}</em>`).join('') : (i.not_applicable ? '' : '<em class="none">بلا مسؤول</em>')}</span></div>
      <span class="evn" title="عدد الشواهد">${ev.length}</span>
      <span class="ac-st ${s.c}">${s.t}</span>
    </div>
    ${open ? detailHtml(i) : ''}
  </div>`;
}

function detailHtml(i) {
  const ev = evsOf(i);
  const owners = i.owner_ids || [];
  return `<div class="ac-det">
    ${mgr() ? `<div class="ac-admin">
      <div class="ac-owners"><span>المسؤولون:</span>${owners.map(o => `<button type="button" class="ac-own" data-rm="${o}">${esc(nameOf(o))} ✕</button>`).join('')}
        <select data-add><option value="">＋ إسناد إلى...</option>${D.staff.filter(p => !owners.includes(p.id)).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select></div>
      <label class="ac-na"><input type="checkbox" data-na${i.not_applicable ? ' checked' : ''}> لا ينطبق على المدرسة</label>
    </div>` : ''}
    <div class="ac-evs">${ev.length ? ev.map(e => evHtml(e)).join('') : '<div class="ac-none">لم يُرفع شاهد لهذا المؤشر بعد.</div>'}</div>
    ${canUpload(i) && !i.not_applicable ? `<form class="ac-add" data-add-ev>
      <div class="ac-seg"><button type="button" data-k="file" class="on">${IC.up}ملف أو صورة</button><button type="button" data-k="link">${IC.link}رابط</button></div>
      <input type="text" name="title" placeholder="عنوان الشاهد (مثل: محضر اجتماع مجلس المدرسة)" maxlength="160">
      <textarea name="desc" rows="2" placeholder="وصف مختصر (اختياري)" maxlength="500"></textarea>
      <label class="ac-drop" data-pane="file"><input type="file" name="files" multiple hidden><span>${IC.up}<b>اختر الملفات</b><small>PDF أو صور أو ملفات Office، حتى ٢٥ ميجابايت للملف</small></span></label>
      <input type="url" name="url" data-pane="link" class="hidden" placeholder="https://..." dir="ltr">
      <div class="ac-add-f"><span class="ac-err"></span><button type="submit" class="ac-btn">رفع الشاهد</button></div>
    </form>` : ''}
  </div>`;
}

function evHtml(e) {
  const isImg = /\.(png|jpe?g|gif|webp|heic)$/i.test(e.file_name || '');
  const st = e.status === 'approved' ? ['done', 'معتمد'] : e.status === 'returned' ? ['ret', 'معاد للتعديل'] : ['pend', 'بانتظار المراجعة'];
  const mine = e.uploaded_by === currentUserId;
  const d = new Date(e.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
  return `<div class="ac-ev" data-ev="${e.id}">
    <span class="ic">${e.kind === 'link' ? IC.link : isImg ? IC.img : IC.file}</span>
    <div class="ac-ev-t"><b>${esc(e.title)}</b>${e.description ? `<small>${esc(e.description)}</small>` : ''}
      <span>${esc(short(nameOf(e.uploaded_by)))} · ${d}${e.file_name ? ' · ' + esc(e.file_name) : ''}</span>
      ${e.status === 'returned' && e.review_note ? `<span class="note">ملاحظة المراجعة: ${esc(e.review_note)}</span>` : ''}</div>
    <span class="ac-st ${st[0]}">${st[1]}</span>
    <div class="ac-ev-a">
      <button type="button" class="ac-mini" data-open>فتح</button>
      ${mgr() && e.status !== 'approved' ? '<button type="button" class="ac-mini ok" data-ok>اعتماد</button>' : ''}
      ${mgr() && e.status !== 'returned' ? '<button type="button" class="ac-mini warn" data-ret>إعادة</button>' : ''}
      ${mgr() || (mine && e.status !== 'approved') ? '<button type="button" class="ac-mini del" data-del>حذف</button>' : ''}
    </div>
  </div>`;
}

function wireDetail(box) {
  const ind = D.inds.find(i => i.id === box.dataset.id);
  const saveInd = async patch => {
    const { error } = await sb.from('acc_indicators').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', ind.id);
    if (error) { toast('تعذر الحفظ: ' + error.message, true); return false; }
    Object.assign(ind, patch); return true;
  };
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (await saveInd({ owner_ids: ind.owner_ids.filter(x => x !== b.dataset.rm) })) render(); });
  const add = box.querySelector('[data-add]');
  if (add) add.onchange = async () => { if (!add.value) return; if (await saveInd({ owner_ids: [...(ind.owner_ids || []), add.value] })) { toast('أُسند المؤشر ✓'); render(); } };
  const na = box.querySelector('[data-na]');
  if (na) na.onchange = async () => { if (await saveInd({ not_applicable: na.checked })) render(); };

  box.querySelectorAll('.ac-ev').forEach(row => {
    const e = D.evs.find(x => x.id === row.dataset.ev);
    row.querySelector('[data-open]').onclick = () => openEvidence(e);
    const ok = row.querySelector('[data-ok]');
    if (ok) ok.onclick = () => review(e, 'approved');
    const ret = row.querySelector('[data-ret]');
    if (ret) ret.onclick = () => { const n = prompt('ملاحظة لصاحب الشاهد (سبب الإعادة):', e.review_note || ''); if (n !== null) review(e, 'returned', n.trim()); };
    const del = row.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!confirm(`حذف الشاهد «${e.title}»؟`)) return;
      if (e.storage_path) await sb.storage.from(BUCKET).remove([e.storage_path]);
      const { error } = await sb.from('acc_evidence').delete().eq('id', e.id);
      if (error) { toast('تعذر الحذف: ' + error.message, true); return; }
      D.evs = D.evs.filter(x => x.id !== e.id); render(); toast('حُذف الشاهد');
    };
  });

  const form = box.querySelector('[data-add-ev]');
  if (!form) return;
  let kind = 'file';
  form.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    kind = b.dataset.k;
    form.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b));
    form.querySelector('[data-pane="file"]').classList.toggle('hidden', kind !== 'file');
    form.querySelector('[data-pane="link"]').classList.toggle('hidden', kind !== 'link');
  });
  const fin = form.querySelector('input[type=file]');
  fin.onchange = () => {
    const n = fin.files.length;
    form.querySelector('.ac-drop b').textContent = n ? (n === 1 ? fin.files[0].name : `${n} ملفات`) : 'اختر الملفات';
    const t = form.querySelector('[name=title]');
    if (n === 1 && !t.value) t.value = fin.files[0].name.replace(/\.[^.]+$/, '');
  };
  form.onsubmit = async ev => {
    ev.preventDefault();
    const err = form.querySelector('.ac-err'); err.textContent = '';
    const fld = n => form.querySelector(`[name=${n}]`);
    const title = fld('title').value.trim(), desc = fld('desc').value.trim();
    const btn = form.querySelector('[type=submit]');
    const base = { indicator_id: ind.id, description: desc || null, uploaded_by: currentUserId, status: mgr() ? 'approved' : 'submitted', ...(mgr() ? { reviewed_by: currentUserId, reviewed_at: new Date().toISOString() } : {}) };
    if (kind === 'link') {
      const url = fld('url').value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { err.textContent = 'أدخل رابطًا صحيحًا يبدأ بـ https://'; return; }
      if (!title) { err.textContent = 'اكتب عنوان الشاهد'; return; }
      btn.disabled = true;
      const { data, error } = await writeWithSchool(extra => sb.from('acc_evidence').insert({ ...base, title, kind: 'link', url, ...extra }).select('*').single());
      btn.disabled = false;
      if (error) { err.textContent = 'تعذر الحفظ: ' + error.message; return; }
      D.evs.push(data); render(); toast('أُضيف الشاهد ✓'); return;
    }
    const files = [...fin.files];
    if (!files.length) { err.textContent = 'اختر ملفًا واحدًا على الأقل'; return; }
    const big = files.find(f => f.size > 25 * 1024 * 1024);
    if (big) { err.textContent = `الملف «${big.name}» أكبر من ٢٥ ميجابايت`; return; }
    btn.disabled = true;
    let okN = 0;
    for (const [k, f] of files.entries()) {
      btn.textContent = files.length > 1 ? `جارٍ الرفع ${k + 1} من ${files.length}` : 'جارٍ الرفع...';
      const ext = (f.name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || 'bin';
      const path = `${currentSchoolId}/${ind.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext.toLowerCase()}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { err.textContent = `تعذر رفع «${f.name}»: ${up.error.message}`; continue; }
      const t = files.length > 1 ? (title ? `${title} (${k + 1})` : f.name.replace(/\.[^.]+$/, '')) : (title || f.name.replace(/\.[^.]+$/, ''));
      const { data, error } = await writeWithSchool(extra => sb.from('acc_evidence').insert({ ...base, title: t, kind: 'file', storage_path: path, file_name: f.name, file_size: f.size, ...extra }).select('*').single());
      if (error) { err.textContent = 'تعذر الحفظ: ' + error.message; await sb.storage.from(BUCKET).remove([path]); continue; }
      D.evs.push(data); okN++;
    }
    btn.disabled = false; btn.textContent = 'رفع الشاهد';
    if (okN) { render(); toast(okN === 1 ? 'رُفع الشاهد ✓' : `رُفع ${okN} شواهد ✓`); }
  };
}

async function review(e, status, note = null) {
  const patch = { status, review_note: status === 'returned' ? (note || null) : null, reviewed_by: currentUserId, reviewed_at: new Date().toISOString() };
  const { error } = await sb.from('acc_evidence').update(patch).eq('id', e.id);
  if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
  Object.assign(e, patch); render(); toast(status === 'approved' ? 'اعتُمد الشاهد ✓' : 'أُعيد الشاهد لصاحبه');
}

async function openEvidence(e) {
  if (e.kind === 'link') { window.open(e.url, '_blank', 'noopener'); return; }
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(e.storage_path, 900);
  if (error || !data) { if (w) w.close(); toast('تعذر فتح الملف', true); return; }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
}

/* ---------- وضع الزيارة: الشواهد المعتمدة مرتبة بالمؤشرات ---------- */
function openVisit() {
  let back = $('ac-visit-ov');
  if (!back) { back = document.createElement('div'); back.id = 'ac-visit-ov'; back.className = 'ac-visit'; document.body.appendChild(back); }
  document.body.classList.add('db-noscroll');
  const app = D.inds.filter(i => !i.not_applicable);
  let dom = 1;
  const draw = () => {
    const ii = app.filter(i => i.domain_no === dom);
    const stds = [...new Set(ii.map(i => i.standard))];
    back.innerHTML = `<div class="ac-vh">
        <div><b>شواهد التقويم المدرسي</b><span>${esc(printOrgName())}</span></div>
        <button type="button" class="ac-vx" aria-label="إغلاق">✕</button>
      </div>
      <nav class="ac-vtabs">${[1, 2, 3, 4].map(d => `<button type="button" data-d="${d}" class="${d === dom ? 'on' : ''}" style="--c:${DCOL[d]}"><span>${d}</span>${DOMAINS[d]}</button>`).join('')}</nav>
      <div class="ac-vbody">${stds.map(s => `<section><h4 style="--c:${DCOL[dom]}">${esc(s)}</h4>${ii.filter(i => i.standard === s).map(i => {
        const ev = evsOf(i).filter(e => e.status === 'approved');
        return `<div class="ac-vi"><div class="ac-vi-h"><span class="code">${esc(i.code)}</span><b>${esc(i.text)}</b></div>
          ${ev.length ? `<div class="ac-vev">${ev.map(e => `<button type="button" data-ev="${e.id}">${e.kind === 'link' ? IC.link : IC.file}<span>${esc(e.title)}</span></button>`).join('')}</div>` : '<div class="ac-vnone">لا توجد شواهد معتمدة</div>'}</div>`;
      }).join('')}</section>`).join('')}</div>`;
    back.querySelector('.ac-vx').onclick = () => { back.remove(); document.body.classList.remove('db-noscroll'); };
    back.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { dom = +b.dataset.d; draw(); back.querySelector('.ac-vbody').scrollTop = 0; });
    back.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => openEvidence(D.evs.find(e => e.id === b.dataset.ev)));
  };
  draw();
}

/* ---------- فهرس الشواهد (طباعة) ---------- */
function printIndex() {
  const logo = printLogo();
  const rows = D.inds.map(i => {
    const ev = evsOf(i).filter(e => e.status === 'approved');
    return `<tr class="${i.not_applicable ? 'na' : ''}"><td class="c">${esc(i.code)}</td><td>${esc(i.text)}</td><td>${i.not_applicable ? 'لا ينطبق' : ev.length ? ev.map((e, k) => `${k + 1}. ${esc(e.title)}`).join('<br>') : '<span class="miss">لا توجد شواهد معتمدة</span>'}</td><td class="c">${i.not_applicable ? '—' : ev.length}</td><td>${(i.owner_ids || []).map(o => esc(short(nameOf(o)))).join('، ')}</td></tr>`;
  });
  let html = '', last = null, lastStd = null;
  D.inds.forEach((i, k) => {
    if (i.domain_no !== last) { html += `<tr class="dom"><td colspan="5">المجال ${i.domain_no}: ${DOMAINS[i.domain_no]}</td></tr>`; last = i.domain_no; lastStd = null; }
    if (i.standard !== lastStd) { html += `<tr class="std"><td colspan="5">${esc(i.standard)}</td></tr>`; lastStd = i.standard; }
    html += rows[k];
  });
  const app = D.inds.filter(i => !i.not_applicable), done = app.filter(i => statusOf(i) === 'done').length;
  const doc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فهرس شواهد التقويم المدرسي</title><style>
    @page{ size:A4; margin:12mm; } body{ font-family:Tahoma,sans-serif; color:#14233A; font-size:11px; margin:0; }
    .hd{ display:flex; align-items:center; gap:12px; border-bottom:2px solid #0F2447; padding-bottom:8px; margin-bottom:10px; } .hd img{ height:46px; }
    .hd h1{ margin:0; font-size:16px; } .hd p{ margin:2px 0 0; color:#5B6B80; }
    table{ width:100%; border-collapse:collapse; } th,td{ border:1px solid #D5DCE6; padding:5px 6px; vertical-align:top; text-align:right; }
    th{ background:#0F2447; color:#fff; font-size:11px; } td.c{ text-align:center; white-space:nowrap; }
    tr.dom td{ background:#E9EEF6; font-weight:700; font-size:12.5px; } tr.std td{ background:#F6F8FB; font-weight:700; color:#2455A4; }
    tr.na td{ color:#9AA3AF; } .miss{ color:#B2382F; } tr{ break-inside:avoid; }
    *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  </style></head><body>
  <div class="hd">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div><h1>فهرس شواهد التقويم المدرسي</h1><p>${esc(printOrgName())} · المؤشرات المكتملة ${done} من ${app.length}</p></div></div>
  <table><thead><tr><th>الرمز</th><th>المؤشر</th><th>الشواهد المعتمدة</th><th>العدد</th><th>المسؤول</th></tr></thead><tbody>${html}</tbody></table>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة'); return; }
  w.document.open(); w.document.write(doc); w.document.close();
}
