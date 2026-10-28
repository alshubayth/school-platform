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
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
};

let D = { inds: [], evs: [], staff: [], visit: null };
let V = { domain: 0, filter: 'all', q: '', open: null, mine: false, member: null };
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
  const [inds, evs, staff, set] = await Promise.all([
    R(() => sb.from('acc_indicators').select('*').order('sort')),
    R(() => sb.from('acc_evidence').select('*').order('created_at')),
    R(() => sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher']).order('full_name')),
    R(() => sb.from('acc_settings').select('visit_date')),
  ]);
  if (inds.error) { box.innerHTML = `<div class="ac-empty">تعذر تحميل المؤشرات: ${esc(inds.error.message)}</div>`; return; }
  D = { inds: inds.data || [], evs: evs.data || [], staff: (staff.data || []).filter(p => p.full_name), visit: ((set.data || [])[0] || {}).visit_date || null };
  if (!mgr()) V.mine = true;
  render();
}

/* ---------- الواجهة: «مدار الجاهزية» ----------
 * كل مؤشر نقطة تدور في مدار مجاله (٤ مدارات)، ولونها حالته، والمركز نسبة الجاهزية. */
const SCOL = { done: '#2FC1B2', pending: '#6FA4F2', returned: '#F2A65A', empty: 'rgba(255,255,255,.22)', na: 'rgba(255,255,255,.08)' };
const daysLeft = () => { if (!D.visit) return null; const t = new Date(D.visit + 'T00:00:00'), n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 864e5); };
const arDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

function orbitSvg() {
  const cx = 210, cy = 210, radii = { 1: 86, 2: 122, 3: 158, 4: 194 };
  let rings = '', dots = '';
  [1, 2, 3, 4].forEach(d => {
    const ii = D.inds.filter(i => i.domain_no === d), r = radii[d], n = ii.length || 1;
    rings += `<circle class="orb-ring" cx="${cx}" cy="${cy}" r="${r}" style="--c:${DCOL[d]}"/>`;
    dots += `<g class="orb-g orb-${d}" style="transform-origin:${cx}px ${cy}px">${ii.map((i, k) => {
      const a = (k / n) * Math.PI * 2 + d * 0.6, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), s = statusOf(i);
      return `<circle class="orb-dot ${s}${V.open === i.id ? ' on' : ''}" data-ind="${i.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s === 'done' ? 7 : 6}" fill="${SCOL[s]}" style="animation-delay:${(0.4 + k * 0.03 + d * 0.15).toFixed(2)}s"><title>${esc(i.code)} · ${esc(ST[s].t)}</title></circle>`;
    }).join('')}</g>`;
  });
  return `<svg class="orbit" viewBox="0 0 420 420" role="img" aria-label="مدار الجاهزية">${rings}${dots}</svg>`;
}

function teamHtml() {
  const ids = [...new Set(D.inds.flatMap(i => i.owner_ids || []))];
  if (!ids.length) return '';
  const rows = ids.map(id => {
    const mine = D.inds.filter(i => (i.owner_ids || []).includes(id) && !i.not_applicable);
    const dn = mine.filter(i => statusOf(i) === 'done').length;
    return { id, n: mine.length, dn, p: mine.length ? dn / mine.length : 0 };
  }).sort((a, b) => b.p - a.p || b.n - a.n);
  return `<section class="ac-team"><header><b>فريق التميز</b><span>إنجاز كل عضو في مؤشراته</span></header><div class="ac-team-row">${rows.map((r, k) => {
    const C = 2 * Math.PI * 21;
    return `<button type="button" class="ac-mem${r.id === currentUserId ? ' me' : ''}${V.member === r.id ? ' on' : ''}" data-mem="${r.id}" style="animation-delay:${(k * 0.05).toFixed(2)}s">
      <span class="ring"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="21" class="bg"/><circle cx="25" cy="25" r="21" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - r.p)}"/></svg><i>${esc(String(nameOf(r.id)).trim().charAt(0))}</i></span>
      <b>${esc(short(nameOf(r.id)))}</b><small>${r.dn}/${r.n}</small></button>`;
  }).join('')}</div></section>`;
}

function render() {
  const box = $('acc-container');
  const app = D.inds.filter(i => !i.not_applicable);
  const cnt = s => app.filter(i => statusOf(i) === s).length;
  const done = cnt('done');
  const pct = app.length ? Math.round(done / app.length * 100) : 0;
  const pend = D.evs.filter(e => e.status === 'submitted').length;
  const noOwner = D.inds.filter(i => !i.not_applicable && !(i.owner_ids || []).length).length;
  const dl = daysLeft();
  box.innerHTML = `<div class="ac">
    <header class="ac-sky">
      <div class="ac-stars" aria-hidden="true"></div>
      <div class="ac-sky-t">
        <span class="ac-kicker">التقويم المدرسي · فريق التميز</span>
        <h3>مدار الجاهزية</h3>
        <p>كل نقطة مؤشر يدور في مدار مجاله، وتضيء حين يكتمل بشاهد معتمد.</p>
        <div class="ac-count">
          ${D.visit ? `<div class="ac-days${dl != null && dl <= 7 ? ' soon' : ''}"><b>${dl > 0 ? dl : dl === 0 ? 'اليوم' : '—'}</b><span>${dl > 0 ? (dl === 1 ? 'يوم على الزيارة' : dl === 2 ? 'يومان على الزيارة' : 'يومًا على الزيارة') : dl === 0 ? 'موعد الزيارة' : 'انتهى الموعد'}</span><small>${esc(arDate(D.visit))}</small></div>` : (mgr() ? '<div class="ac-days empty"><b>؟</b><span>حدّد موعد زيارة فريق التقويم</span></div>' : '')}
          ${mgr() ? `<label class="ac-date" title="موعد الزيارة">${IC.cal}<span>موعد الزيارة</span><input type="date" id="ac-visit-date" value="${D.visit || ''}"></label>` : ''}
        </div>
        <div class="ac-legend">${[['done', 'مكتمل'], ['pending', 'بانتظار المراجعة'], ['returned', 'معاد للتعديل'], ['empty', 'بلا شواهد']].map(([k, t]) => `<button type="button" data-f="${k}" class="${V.filter === k ? 'on' : ''}"><i style="background:${SCOL[k]}"></i>${t}<b>${cnt(k)}</b></button>`).join('')}</div>
        <div class="ac-sky-a">
          <button type="button" class="ac-btn glow" id="ac-visit">${IC.eye}وضع الزيارة</button>
          <button type="button" class="ac-btn light" id="ac-print">${IC.print}فهرس الشواهد</button>
        </div>
      </div>
      <div class="ac-orbit">
        ${orbitSvg()}
        <div class="ac-core"><b data-count="${pct}">0</b><span>%</span><small>جاهزية المدرسة</small><em>${done} من ${app.length}</em></div>
      </div>
    </header>
    ${mgr() && (pend || noOwner) ? `<div class="ac-alerts">${pend ? `<button type="button" data-f="pending">${pend} ${pend === 1 ? 'شاهد ينتظر' : 'شواهد تنتظر'} مراجعتك ←</button>` : ''}${noOwner ? `<button type="button" data-f="noowner">${noOwner} مؤشرًا بلا مسؤول ←</button>` : ''}</div>` : ''}
    <div class="ac-planets">${[1, 2, 3, 4].map(d => {
      const ii = D.inds.filter(i => i.domain_no === d && !i.not_applicable);
      const dn = ii.filter(i => statusOf(i) === 'done').length, p = ii.length ? dn / ii.length : 0, C = 2 * Math.PI * 26;
      return `<button type="button" class="ac-planet${V.domain === d ? ' on' : ''}" data-dom="${d}" style="--c:${DCOL[d]}">
        <span class="pr"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="bg"/><circle cx="30" cy="30" r="26" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"/></svg><i>${d}</i></span>
        <span class="pt"><b>${DOMAINS[d]}</b><small>${dn} من ${ii.length} مكتمل</small></span><span class="pp">${Math.round(p * 100)}%</span></button>`;
    }).join('')}</div>
    ${teamHtml()}
    <div class="ac-tools">
      <div class="ac-search">${IC.search}<input type="search" id="ac-q" placeholder="ابحث برقم المؤشر أو نصه..." value="${esc(V.q)}"></div>
      <label class="ac-switch"><input type="checkbox" id="ac-mine"${V.mine ? ' checked' : ''}><span></span>مؤشراتي فقط</label>
      ${V.filter !== 'all' || V.domain || V.member ? '<button type="button" class="ac-clear" id="ac-clear">مسح التصفية ✕</button>' : ''}
    </div>
    <div id="ac-list"></div>
  </div>
  <aside class="ac-drawer${V.open ? ' open' : ''}" id="ac-drawer" aria-hidden="${V.open ? 'false' : 'true'}"></aside>
  <div class="ac-scrim${V.open ? ' open' : ''}" id="ac-scrim"></div>`;
  box.querySelectorAll('[data-dom]').forEach(b => b.onclick = () => { V.domain = V.domain === +b.dataset.dom ? 0 : +b.dataset.dom; render(); });
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { V.filter = V.filter === b.dataset.f ? 'all' : b.dataset.f; render(); $('ac-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  box.querySelectorAll('[data-mem]').forEach(b => b.onclick = () => { V.member = V.member === b.dataset.mem ? null : b.dataset.mem; render(); });
  box.querySelectorAll('.orb-dot').forEach(c => c.onclick = () => openDrawer(c.dataset.ind));
  $('ac-mine').onchange = e => { V.mine = e.target.checked; renderList(); };
  $('ac-q').oninput = e => { V.q = e.target.value; renderList(); };
  const cl = $('ac-clear'); if (cl) cl.onclick = () => { V.filter = 'all'; V.domain = 0; V.member = null; render(); };
  $('ac-visit').onclick = openVisit;
  $('ac-print').onclick = printIndex;
  $('ac-scrim').onclick = () => openDrawer(null);
  const vd = $('ac-visit-date');
  if (vd) vd.onchange = async () => {
    const v = vd.value || null;
    const { error } = await writeWithSchool(extra => sb.from('acc_settings').upsert({ visit_date: v, updated_at: new Date().toISOString(), ...extra }, { onConflict: 'school_id' }));
    if (error) { toast('تعذر حفظ الموعد: ' + error.message, true); return; }
    D.visit = v; render(); toast('حُفظ موعد الزيارة ✓');
  };
  box.querySelectorAll('[data-count]').forEach(el => { const to = +el.dataset.count, t0 = performance.now(); const st = n => { const p = Math.min(1, (n - t0) / 1100), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(st); }; requestAnimationFrame(st); });
  renderList();
  if (V.open) drawDrawer();
}

function renderList() {
  const el = $('ac-list');
  const q = V.q.trim();
  const list = D.inds.filter(i => (!V.domain || i.domain_no === V.domain)
    && (V.filter === 'all' || (V.filter === 'noowner' ? !i.not_applicable && !(i.owner_ids || []).length : statusOf(i) === V.filter))
    && (!V.mine || isMine(i))
    && (!V.member || (i.owner_ids || []).includes(V.member))
    && (!q || i.text.includes(q) || i.code.includes(q) || i.standard.includes(q)));
  if (!list.length) { el.innerHTML = `<div class="ac-empty">${V.mine && !D.inds.some(isMine) ? 'لا توجد مؤشرات مسندة إليك' : 'لا توجد مؤشرات مطابقة'}</div>`; return; }
  const groups = [];
  list.forEach(i => { let g = groups.find(x => x.std === i.standard && x.d === i.domain_no); if (!g) { g = { std: i.standard, d: i.domain_no, items: [] }; groups.push(g); } g.items.push(i); });
  el.innerHTML = groups.map((g, gi) => {
    const all = D.inds.filter(i => i.standard === g.std && i.domain_no === g.d && !i.not_applicable);
    const dn = all.filter(i => statusOf(i) === 'done').length;
    return `<section class="ac-std" style="--c:${DCOL[g.d]};animation-delay:${(gi * 0.06).toFixed(2)}s">
      <header><span class="dom">${g.d}</span><b>${esc(g.std)}</b><span class="seg">${all.map(i => `<i class="${statusOf(i)}"></i>`).join('')}</span><span class="cnt">${dn}/${all.length}</span></header>
      <div class="ac-cards">${g.items.map(cardHtml).join('')}</div>
    </section>`;
  }).join('');
  el.querySelectorAll('.ac-card').forEach(c => c.onclick = () => openDrawer(c.dataset.id));
}

function cardHtml(i) {
  const s = statusOf(i), ev = evsOf(i), owners = i.owner_ids || [];
  const ap = ev.filter(e => e.status === 'approved').length;
  return `<button type="button" class="ac-card ${s}${V.open === i.id ? ' on' : ''}${isMine(i) ? ' mine' : ''}" data-id="${i.id}">
    <span class="top"><span class="code">${esc(i.code)}</span>${i.star ? '<i class="star" title="مؤشر مميز بعلامة (*) في الإطار">★</i>' : ''}<span class="ac-st ${ST[s].c}">${ST[s].t}</span></span>
    <span class="txt">${esc(i.text)}</span>
    <span class="bot">
      <span class="own">${owners.length ? owners.slice(0, 3).map(o => `<em title="${esc(nameOf(o))}"${o === currentUserId ? ' class="me"' : ''}>${esc(String(nameOf(o)).trim().charAt(0))}</em>`).join('') + (owners.length > 3 ? `<em>+${owners.length - 3}</em>` : '') : (i.not_applicable ? '' : '<em class="none" title="بلا مسؤول">؟</em>')}</span>
      <span class="evc">${ev.length ? `${IC.file}${ap}/${ev.length}` : 'لا شواهد'}</span>
    </span>
  </button>`;
}

function openDrawer(id) {
  V.open = id;
  document.querySelectorAll('.orb-dot.on, .ac-card.on').forEach(x => x.classList.remove('on'));
  if (id) document.querySelectorAll(`[data-ind="${id}"], .ac-card[data-id="${id}"]`).forEach(x => x.classList.add('on'));
  $('ac-drawer').classList.toggle('open', !!id);
  $('ac-scrim').classList.toggle('open', !!id);
  $('ac-drawer').setAttribute('aria-hidden', id ? 'false' : 'true');
  document.body.classList.toggle('ac-lock', !!id);
  if (id) drawDrawer();
}
function drawDrawer() {
  const i = D.inds.find(x => x.id === V.open); if (!i) return;
  const dr = $('ac-drawer'), s = statusOf(i);
  dr.dataset.id = i.id;
  dr.style.setProperty('--c', DCOL[i.domain_no]);
  dr.innerHTML = `<div class="ac-dh">
      <button type="button" class="ac-dx" aria-label="إغلاق">✕</button>
      <span class="crumb">${DOMAINS[i.domain_no]} · ${esc(i.standard)}</span>
      <div class="ac-dh-t"><span class="code">${esc(i.code)}</span><span class="ac-st ${ST[s].c}">${ST[s].t}</span></div>
      <h4>${esc(i.text)}${i.star ? ' <i class="star">★</i>' : ''}</h4>
    </div>${detailHtml(i)}`;
  dr.querySelector('.ac-dx').onclick = () => openDrawer(null);
  wireDetail(dr);
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
      <label class="ac-drop" data-pane="file"><input type="file" name="files" multiple hidden><span>${IC.up}<b>اختر الملفات أو اسحبها هنا</b><small>PDF أو صور أو ملفات Office، حتى ٢٥ ميجابايت للملف. الصور الكبيرة تُصغَّر تلقائيًا</small></span></label>
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
  const drop = form.querySelector('.ac-drop');
  let picked = [];
  const setPicked = fs => {
    picked = [...fs];
    const n = picked.length;
    drop.querySelector('b').textContent = n ? (n === 1 ? picked[0].name : `${n} ملفات`) : 'اختر الملفات أو اسحبها هنا';
    drop.classList.toggle('has', !!n);
    const t = form.querySelector('[name=title]');
    if (n === 1 && !t.value) t.value = picked[0].name.replace(/\.[^.]+$/, '');
  };
  fin.onchange = () => setPicked(fin.files);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) setPicked(e.dataTransfer.files); });
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
    const files = [];
    for (const f of picked) files.push(await shrinkImage(f));
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

/* الصور الكبيرة تُصغَّر قبل الرفع (أقصى بُعد ٢٢٠٠ بكسل) لتوفير المساحة */
async function shrinkImage(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 700 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) { return f; }
}
