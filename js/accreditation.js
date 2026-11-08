/* =========================================================================
 * الاعتماد المدرسي (حقيبة التميّز للتقويم الخارجي)
 * الأدوار:
 *  - مسؤول المؤشر (واحد لكل مؤشر، acc_indicators.owner_id) ومن يُسند إليهم الرفع (uploader_ids).
 *  - قائد المجال (acc_leads) يراجع مؤشرات مجاله ويغيّر مسؤوليها.
 *  - المدير (acc_settings.roles.principal) يعتمد نهائيًا ويغيّر أي مسؤول.
 * مسار الشاهد: مسودة ← إرسال للمراجعة (يتقفل المؤشر) ← قائد المجال ← المدير ← معتمد.
 *  الإرجاع بملاحظة إلزامية، والشاهد المشترك يُرفع مرة ويظهر في المؤشرين (linked_ids).
 * الجاهزية بالمراحل: مرسل ربع، معتمد من القائد نصف، معتمد نهائيًا كامل.
 * محتوى البطاقات من حقيبة التميّز (acc-booklet.js) ما لم تُحفظ بطاقة مخصصة في acc_indicators.card.
 * ========================================================================= */
import { sb, currentSchoolId, currentUserId, currentProfile, readScopedBySchool, writeWithSchool } from './core.js';
import { BOOKLET_CARDS, LEVELS, EVIDENCE_TEST, FORMS } from './acc-booklet.js';
import { ACC_GUIDE } from './acc-guide.js';
import { initForms, libraryHtml, bindLibrary, openFormEditor, printForm, downloadPdf, uploadSigned, FORM_DEFS } from './acc-forms.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUCKET = 'acc-evidence';
const DOMAINS = { 1: 'الإدارة المدرسية', 2: 'التعليم والتعلم', 3: 'نواتج التعلم', 4: 'البيئة المدرسية' };
const DORD = { 1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع' };
const DCOL = { 1: '#2455A4', 2: '#0E8FA3', 3: '#6A4BB0', 4: '#C47A1C' };
const OTHER = '__other__';
// حالة الشاهد
const EV = {
  draft: { t: 'مسودة', c: 'draft', w: 0 },
  submitted: { t: 'بانتظار قائد المجال', c: 'wait', w: 0.25 },
  reviewed: { t: 'بانتظار اعتماد المدير', c: 'wait2', w: 0.5 },
  verified: { t: 'بانتظار اعتماد المدير', c: 'wait2', w: 0.5 },
  approved: { t: 'معتمد نهائيًا', c: 'ok', w: 1 },
  returned: { t: 'معاد للتعديل', c: 'ret', w: 0 },
};
// حالة المؤشر (الأولوية بالترتيب)
const IST = {
  returned: { t: 'معاد للتعديل', c: 'ret' }, submitted: { t: 'عند قائد المجال', c: 'wait' }, reviewed: { t: 'عند المدير', c: 'wait2' },
  draft: { t: 'مسودة لم تُرسل', c: 'draft' }, approved: { t: 'معتمد', c: 'ok' }, empty: { t: 'لم يبدأ', c: 'empty' }, na: { t: 'لا ينطبق', c: 'na' },
};

let D = null;
let V = { tab: null, dom: null, ind: null, filter: 'all' };

/* ---------- البيانات والصلاحيات ---------- */
const R = build => readScopedBySchool(sc => { let q = build(); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
const person = id => D.people.get(id);
const nameOf = id => (person(id) || {}).full_name || '—';
const short = n => { const w = String(n || '').trim().split(/\s+/).filter(x => !['بن', 'ابن'].includes(x)); return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' '); };
const sname = id => short(nameOf(id));
const cardOf = i => (i.card && Object.keys(i.card).length ? i.card : BOOKLET_CARDS[i.code] || {});
const indByCode = c => D.inds.find(i => i.code === c);
const leadOf = d => { const l = D.leads.find(x => x.scope === 'domain' && String(x.scope_key) === String(d)); return l && l.owner_ids && l.owner_ids[0] || null; };
const principals = () => (D.roles && Array.isArray(D.roles.principal) ? D.roles.principal : []);
const isPrincipal = () => currentProfile.role === 'owner' || principals().includes(currentUserId) || (currentProfile.role === 'admin' && !principals().length);
const myLeadDomains = () => [1, 2, 3, 4].filter(d => leadOf(d) === currentUserId);
const isLeadOf = d => leadOf(d) === currentUserId;
const canUpload = i => i.owner_id === currentUserId || (i.uploader_ids || []).includes(currentUserId);
const canAssign = i => isPrincipal() || isLeadOf(i.domain_no);
const applicable = () => D.inds.filter(i => !i.not_applicable);
const myInds = () => applicable().filter(canUpload);
const evOf = i => D.evs.filter(e => e.indicator_id === i.id || (e.linked_ids || []).includes(i.id));
const canReview = (e, i = D.inds.find(x => x.id === e.indicator_id)) => !!i && ((e.status === 'submitted' && isLeadOf(i.domain_no)) || (['reviewed', 'verified'].includes(e.status) && isPrincipal()));

function statusOf(i) {
  if (i.not_applicable) return 'na';
  const s = new Set(evOf(i).map(e => e.status));
  if (s.has('returned')) return 'returned';
  if (s.has('submitted')) return 'submitted';
  if (s.has('reviewed') || s.has('verified')) return 'reviewed';
  if (s.has('draft')) return 'draft';
  if (s.has('approved')) return 'approved';
  return 'empty';
}
const scoreOf = i => evOf(i).reduce((m, e) => Math.max(m, (EV[e.status] || {}).w || 0), 0);
const pctOf = list => (list.length ? Math.round(list.reduce((a, i) => a + scoreOf(i), 0) / list.length * 1000) / 10 : 0);
const levelOf = p => LEVELS.find(l => p >= l.min) || LEVELS[LEVELS.length - 1];
const LVCOL = { 'التميّز': '#1F8A55', 'التقدّم': '#2455A4', 'الانطلاق': '#B07A3A', 'التهيئة': '#B83A3A' };

/* ---------- واجهة عامة ---------- */
function toast(msg, bad) {
  let t = $('acx-toast');
  if (!t) { t = document.createElement('div'); t.id = 'acx-toast'; t.className = 'acx-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove('show'), 3200);
}
function ring(p, size = 108, color = '#fff', track = 'rgba(255,255,255,.18)', label = '') {
  const r = size / 2 - 8, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p));
  return `<div class="acx-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="8"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><b>${Math.round(v)}<small>%</small></b>${label ? `<span>${esc(label)}</span>` : ''}</div>`;
}
const chip = st => `<span class="acx-st ${IST[st].c}">${IST[st].t}</span>`;
const evChip = e => `<span class="acx-st ${EV[e.status] ? EV[e.status].c : 'empty'}">${EV[e.status] ? EV[e.status].t : esc(e.status)}</span>`;
function modal(html, cls = '') {
  const m = document.createElement('div'); m.className = 'acx-modal';
  m.innerHTML = `<div class="acx-modal-b ${cls}" role="dialog">${html}</div>`;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-x]')) m.remove(); };
  document.body.appendChild(m);
  return m;
}
const daysTo = d => (d ? Math.ceil((new Date(d + 'T07:00:00') - Date.now()) / 86400000) : null);

/* ---------- التحميل ---------- */
export async function loadAccreditationModule() {
  const box = $('acc-container');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const [inds, evs, staff, set, leads, fdocs] = await Promise.all([
    R(() => sb.from('acc_indicators').select('*').order('sort')),
    R(() => sb.from('acc_evidence').select('*').order('created_at')),
    R(() => sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher']).order('full_name')),
    R(() => sb.from('acc_settings').select('visit_date, roles')),
    R(() => sb.from('acc_leads').select('*')),
    R(() => sb.from('acc_form_docs').select('*').order('updated_at', { ascending: false })),
  ]);
  if (inds.error) { box.innerHTML = `<div class="acx-empty">تعذر تحميل المؤشرات: ${esc(inds.error.message)}</div>`; return; }
  const st = (set.data || [])[0] || {};
  D = { inds: inds.data || [], evs: evs.data || [], people: new Map((staff.data || []).filter(p => p.full_name).map(p => [p.id, p])), visit: st.visit_date || null, roles: st.roles || {}, leads: leads.data || [], formDocs: (fdocs && fdocs.data) || [] };
  initForms(FX);
  const tabs = tabsFor();
  if (!V.tab || !tabs.some(t => t[0] === V.tab)) V.tab = tabs[0] ? tabs[0][0] : 'mine';
  if (V.tab === 'domain' && !V.dom) V.dom = myLeadDomains()[0] || 1;
  render();
}
function tabsFor() {
  const t = [];
  if (isPrincipal()) t.push(['overview', 'المتابعة']);
  if (myLeadDomains().length) t.push(['domain', myLeadDomains().length > 1 ? 'مجالاتي' : 'مجالي']);
  if (myInds().length || !t.length) t.push(['mine', 'مؤشراتي']);
  t.push(['forms', '📄 النماذج']);
  return t;
}

function render() {
  const box = $('acc-container');
  if (V.ind) { const i = D.inds.find(x => x.id === V.ind); if (i) { box.innerHTML = indicatorPage(i); bindIndicator(i); window.scrollTo({ top: 0 }); return; } V.ind = null; }
  const tabs = tabsFor();
  const body = V.tab === 'forms' ? libraryHtml(V.fq || '') : V.tab === 'overview' ? overview() : V.tab === 'domain' ? domainPage(V.dom || myLeadDomains()[0] || 1) : minePage();
  box.innerHTML = `<div class="acx">${hero()}
    ${tabs.length > 1 ? `<nav class="acx-tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${l}${k === 'overview' && pendingFor('principal').length ? `<i>${pendingFor('principal').length}</i>` : k === 'domain' && pendingFor('lead').length ? `<i>${pendingFor('lead').length}</i>` : ''}</button>`).join('')}</nav>` : ''}
    <div class="acx-body">${body}</div></div>`;
  bindList(box);
  if (V.tab === 'forms') bindLibrary(box, q => { if (q != null) V.fq = q; render(); });
}
// سياق محرك النماذج
const FX = {
  sb, get D() { return D; }, get currentUserId() { return currentUserId; }, get currentSchoolId() { return currentSchoolId; },
  toast, modal, nameOf: id => nameOf(id), canUpload: i => canUpload(i), cardOf: i => cardOf(i), writeWithSchool, BUCKET,
  openIndicator: id => { V.ind = id; render(); },
};
const formDoc = e => (e && e.form_doc ? D.formDocs.find(x => x.id === e.form_doc) : null);
async function ensureDoc(e) {
  let d = formDoc(e); if (d || !e.form_doc) return d;
  const { data } = await sb.from('acc_form_docs').select('*').eq('id', e.form_doc).maybeSingle();
  if (data) D.formDocs.push(data); return data;
}

/* ---------- الترويسة ---------- */
function hero() {
  const scope = V.tab === 'overview' ? applicable() : V.tab === 'domain' ? applicable().filter(i => i.domain_no === (V.dom || myLeadDomains()[0])) : myInds();
  const p = pctOf(scope), lv = levelOf(p);
  const days = daysTo(D.visit);
  const label = V.tab === 'overview' ? 'جاهزية المدرسة' : V.tab === 'domain' ? 'جاهزية المجال' : 'جاهزيتك';
  return `<header class="acx-hero">
    <div class="acx-hero-t"><span class="acx-kicker">التقويم المدرسي · الدورة الثانية</span><h2>الاعتماد المدرسي</h2>
      <p>${V.tab === 'overview' ? `${applicable().length} مؤشرًا · ${D.evs.length} شاهدًا مرفوعًا` : V.tab === 'domain' ? `المجال ${DORD[V.dom || myLeadDomains()[0]]}: ${DOMAINS[V.dom || myLeadDomains()[0]]}` : `${scope.length} ${scope.length === 1 ? 'مؤشر مسند إليك' : 'مؤشرات مسندة إليك'}`}</p>
      <div class="acx-lv"><span style="--c:${LVCOL[lv.t]}">مستوى ${lv.t}</span><em>المستهدف: التميّز 90% فأعلى</em></div>
    </div>
    ${ring(p, 116, '#7CE0B5', 'rgba(255,255,255,.16)', label)}
    <div class="acx-visit ${days != null && days <= 14 && days >= 0 ? 'soon' : ''}">
      ${days == null ? '<b>—</b><span>موعد الزيارة لم يُحدد</span>' : days >= 0 ? `<b>${days}</b><span>${days === 1 ? 'يوم' : 'يومًا'} على الزيارة</span><small>${esc(D.visit)}</small>` : `<b>✓</b><span>تمت الزيارة</span><small>${esc(D.visit)}</small>`}
      ${isPrincipal() ? '<button type="button" id="acx-visit-edit">تعديل الموعد</button>' : ''}
    </div>
  </header>`;
}

/* ---------- مؤشراتي ---------- */
function indRow(i, opts = {}) {
  const st = statusOf(i), n = evOf(i).length, c = cardOf(i);
  const pend = opts.pending ? evOf(i).filter(e => canReview(e)).length : 0;
  return `<button type="button" class="acx-row s-${IST[st].c}" data-ind="${i.id}">
    <span class="acx-code" style="--dc:${DCOL[i.domain_no]}">${esc(i.code)}</span>
    <span class="acx-row-t"><b>${esc(i.text)}</b><small>${opts.owner ? `<em>${esc(sname(i.owner_id))}${(i.uploader_ids || []).length ? ` + ${i.uploader_ids.length}` : ''}</em> · ` : ''}${n ? `${n} ${n === 1 ? 'شاهد' : n === 2 ? 'شاهدان' : 'شواهد'}` : 'لا توجد شواهد'}${c.group ? ' · مؤشر المعلمين' : ''}</small></span>
    ${pend ? `<span class="acx-pend">${pend} للمراجعة</span>` : ''}
    ${chip(st)}
    <span class="acx-mini"><i style="width:${scoreOf(i) * 100}%"></i></span>
  </button>`;
}
function minePage() {
  const list = myInds();
  if (!list.length) return `<div class="acx-empty"><b>لا توجد مؤشرات مسندة إليك</b><span>يسند قائد المجال المؤشرات، وستظهر هنا حين تُسند إليك.</span></div>`;
  const ret = list.filter(i => statusOf(i) === 'returned');
  return `${ret.length ? `<div class="acx-alert ret">↩ لديك ${ret.length === 1 ? 'مؤشر معاد للتعديل' : ret.length + ' مؤشرات معادة للتعديل'}، افتحه واطّلع على الملاحظة.</div>` : ''}
    ${[1, 2, 3, 4].map(d => { const ii = list.filter(i => i.domain_no === d); if (!ii.length) return ''; const n = ii.reduce((a, i) => a + evOf(i).length, 0);
      return `<section class="acx-dom" style="--dc:${DCOL[d]}"><header><span class="acx-dn">${d}</span><div><b>المجال ${DORD[d]}: ${DOMAINS[d]}</b><small>${ii.length} ${ii.length === 1 ? 'مؤشر' : 'مؤشرات'} · ${n} ${n === 1 ? 'شاهد' : 'شواهد'}</small></div><em>${Math.round(pctOf(ii))}%</em></header>${ii.map(i => indRow(i)).join('')}</section>`; }).join('')}`;
}

/* ---------- صفحة المجال (القائد والمدير) ---------- */
const pendingFor = who => D.evs.filter(e => { const i = D.inds.find(x => x.id === e.indicator_id); return i && (who === 'lead' ? e.status === 'submitted' && isLeadOf(i.domain_no) : ['reviewed', 'verified'].includes(e.status) && isPrincipal()); });
function domainPage(d) {
  const ii = applicable().filter(i => i.domain_no === d);
  const myDoms = myLeadDomains();
  const pend = ii.filter(i => evOf(i).some(e => canReview(e)));
  const F = { all: () => true, pend: i => pend.includes(i), empty: i => statusOf(i) === 'empty', ret: i => statusOf(i) === 'returned', ok: i => statusOf(i) === 'approved' };
  const shown = ii.filter(F[V.filter] || F.all);
  const back = V.tab === 'overview';
  return `${back ? '<button type="button" class="acx-back" data-back-overview>→ رجوع للمتابعة</button>' : ''}
    ${!back && myDoms.length > 1 ? `<div class="acx-chips">${myDoms.map(x => `<button type="button" data-dom="${x}" class="${x === d ? 'on' : ''}">المجال ${DORD[x]}</button>`).join('')}</div>` : ''}
    <section class="acx-domhead" style="--dc:${DCOL[d]}"><span class="acx-dn big">${d}</span><div><b>المجال ${DORD[d]}: ${DOMAINS[d]}</b><small>قائد المجال: ${esc(nameOf(leadOf(d)))} · ${ii.length} مؤشرًا</small></div>${ring(pctOf(ii), 72, DCOL[d], '#E9EEF5')}</section>
    ${pend.length ? `<div class="acx-alert wait">🔔 بانتظار ${isLeadOf(d) ? 'مراجعتك' : 'اعتمادك'}: ${pend.length} ${pend.length === 1 ? 'مؤشر' : 'مؤشرات'}</div>` : ''}
    <div class="acx-chips">${[['all', 'الكل', ii.length], ['pend', isLeadOf(d) ? 'بانتظار مراجعتك' : 'بانتظار اعتمادك', pend.length], ['empty', 'لم يبدأ', ii.filter(F.empty).length], ['ret', 'معاد', ii.filter(F.ret).length], ['ok', 'معتمد', ii.filter(F.ok).length]].map(([k, l, n]) => `<button type="button" data-filter="${k}" class="${V.filter === k ? 'on' : ''}">${l} <i>${n}</i></button>`).join('')}</div>
    <div class="acx-list">${shown.map(i => `<div class="acx-rowwrap">${indRow(i, { owner: true, pending: true })}${canAssign(i) ? `<button type="button" class="acx-mini-btn" data-assign="${i.id}" title="تغيير المسؤول">تغيير</button>` : ''}</div>`).join('') || '<div class="acx-empty">لا توجد مؤشرات في هذا التصنيف</div>'}</div>`;
}

/* ---------- المتابعة (المدير) ---------- */
function overview() {
  const all = applicable();
  const pend = pendingFor('principal');
  const pendInds = [...new Set(pend.map(e => e.indicator_id))].map(id => D.inds.find(i => i.id === id)).filter(Boolean);
  const owners = [...new Set(all.map(i => i.owner_id).filter(Boolean))].map(id => ({ id, ii: all.filter(i => i.owner_id === id) })).sort((a, b) => b.ii.length - a.ii.length);
  const cnt = st => all.filter(i => statusOf(i) === st).length;
  return `<div class="acx-stats">${[['approved', 'معتمد'], ['reviewed', 'عند المدير'], ['submitted', 'عند قادة المجالات'], ['draft', 'مسودات'], ['returned', 'معاد'], ['empty', 'لم يبدأ']].map(([k, l]) => `<div class="acx-stat ${IST[k].c}"><b>${cnt(k)}</b><span>${l}</span></div>`).join('')}</div>
    ${pendInds.length ? `<section class="acx-card"><h3>🔔 بانتظار اعتمادك النهائي <i>${pend.length} ${pend.length === 1 ? 'شاهد' : 'شواهد'}</i></h3><div class="acx-list">${pendInds.map(i => indRow(i, { owner: true, pending: true })).join('')}</div></section>` : ''}
    <div class="acx-doms">${[1, 2, 3, 4].map(d => { const ii = all.filter(i => i.domain_no === d); const p = pctOf(ii);
      return `<button type="button" class="acx-domcard" data-open-dom="${d}" style="--dc:${DCOL[d]}"><span class="acx-dn">${d}</span><b>${DOMAINS[d]}</b><small>قائد المجال: ${esc(sname(leadOf(d)))}</small>
        <div class="acx-dc-bar"><i style="width:${p}%"></i></div><div class="acx-dc-n"><em>${Math.round(p)}%</em><span>${ii.filter(i => statusOf(i) === 'approved').length} معتمد من ${ii.length}</span>${ii.filter(i => statusOf(i) === 'empty').length ? `<span class="warn">${ii.filter(i => statusOf(i) === 'empty').length} لم يبدأ</span>` : ''}</div></button>`; }).join('')}</div>
    <section class="acx-card"><h3>المسؤولون</h3><div class="acx-owners">${owners.map(o => { const p = pctOf(o.ii), ret = o.ii.filter(i => statusOf(i) === 'returned').length, emp = o.ii.filter(i => statusOf(i) === 'empty').length;
      return `<div class="acx-owner"><span class="acx-av">${esc(nameOf(o.id).trim().charAt(0))}</span><div><b>${esc(nameOf(o.id))}</b><small>${o.ii.length} ${o.ii.length === 1 ? 'مؤشر' : 'مؤشرات'}${emp ? ` · <em class="warn">${emp} لم يبدأ</em>` : ''}${ret ? ` · <em class="ret">${ret} معاد</em>` : ''}</small></div><div class="acx-ob"><i style="width:${p}%"></i></div><em>${Math.round(p)}%</em></div>`; }).join('')}</div></section>`;
}

function bindList(box) {
  box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { V.tab = b.dataset.tab; V.filter = 'all'; if (V.tab === 'domain') V.dom = myLeadDomains()[0]; render(); });
  box.querySelectorAll('[data-ind]').forEach(b => b.onclick = () => { V.ind = b.dataset.ind; render(); });
  box.querySelectorAll('[data-dom]').forEach(b => b.onclick = () => { V.dom = +b.dataset.dom; V.filter = 'all'; render(); });
  box.querySelectorAll('[data-open-dom]').forEach(b => b.onclick = () => { V.dom = +b.dataset.openDom; V.filter = 'all'; V.domFromOverview = true; renderDomainFromOverview(); });
  box.querySelectorAll('[data-back-overview]').forEach(b => b.onclick = () => { V.domFromOverview = false; render(); });
  box.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { V.filter = b.dataset.filter; V.domFromOverview ? renderDomainFromOverview() : render(); });
  box.querySelectorAll('[data-assign]').forEach(b => b.onclick = e => { e.stopPropagation(); openAssign(D.inds.find(i => i.id === b.dataset.assign)); });
  const ve = $('acx-visit-edit'); if (ve) ve.onclick = editVisit;
}
const rerender = () => (V.domFromOverview && !V.ind ? renderDomainFromOverview() : render());
// المدير يفتح صفحة مجال من بطاقته دون مغادرة تبويب المتابعة
function renderDomainFromOverview() {
  const box = $('acc-container');
  box.innerHTML = `<div class="acx">${hero()}<nav class="acx-tabs">${tabsFor().map(([k, l]) => `<button type="button" data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav><div class="acx-body">${domainPage(V.dom)}</div></div>`;
  bindList(box);
}

/* ---------- صفحة المؤشر ---------- */
function indicatorPage(i) {
  const c = cardOf(i), st = statusOf(i), evs = evOf(i);
  const up = canUpload(i), drafts = evs.filter(e => e.status === 'draft' && e.indicator_id === i.id);
  const pendSign = drafts.filter(e => e.sign_state === 'pending');
  const returned = evs.filter(e => e.status === 'returned');
  const reviewable = evs.filter(e => canReview(e, i));
  // ما أرسله المستخدم ولم يتخذ عليه المراجع إجراءً بعد ← يمكن استرجاعه للتعديل
  const recallable = up ? evs.filter(e => e.indicator_id === i.id && ['submitted', 'reviewed'].includes(e.status) && (() => { const hs = e.history || [], h = hs[hs.length - 1]; return (!h && e.status === 'submitted') || (h && h.by === currentUserId && h.to === e.status); })()) : [];
  const opts = evOptions(i);
  return `<div class="acx acx-ip">
    <button type="button" class="acx-back" id="acx-back">→ رجوع</button>
    <header class="acx-ih" style="--dc:${DCOL[i.domain_no]}">
      <div class="acx-ih-top"><span class="acx-code big">${esc(i.code)}</span><span class="acx-crumb">المجال ${DORD[i.domain_no]}: ${DOMAINS[i.domain_no]} · ${esc(i.standard || '')}</span>${chip(st)}</div>
      <h2>${esc(i.text)}</h2>
      <div class="acx-ih-meta"><span>المسؤول: <b>${esc(nameOf(i.owner_id))}</b>${c.group ? ` <em>(مؤشر ${esc(c.group)})</em>` : ''}</span>${(i.uploader_ids || []).length ? `<span>مكلّفون بالرفع: ${i.uploader_ids.map(u => esc(sname(u))).join('، ')}</span>` : ''}
        <span class="acx-ih-btns">${canAssign(i) ? '<button type="button" class="acx-ghost" id="acx-assign">تغيير المسؤول</button>' : ''}<button type="button" class="acx-info" id="acx-info" title="شرح المؤشر والشواهد المقترحة">!</button></span></div>
    </header>
    ${i.locked || recallable.length ? `<div class="acx-alert wait acx-recall"><div>${i.locked ? `🔒 المؤشر مرسل لقائد المجال للمراجعة، ولا يمكن إضافة شواهد أو تعديلها حتى تنتهي المراجعة.` : `📤 أُرسلت شواهدك إلى المدير للاعتماد.`}${recallable.length ? `<small>اكتشفت خطأً؟ يمكنك التراجع عن الإرسال ما دامت المراجعة لم تبدأ، ثم التعديل وإعادة الإرسال.</small>` : ''}</div>${recallable.length ? `<button type="button" class="acx-ghost" id="acx-recall">↶ تراجع عن الإرسال (${recallable.length})</button>` : ''}</div>` : ''}
    ${returned.length ? `<div class="acx-alert ret"><b>↩ ${returned.length === 1 ? 'شاهد معاد للتعديل' : returned.length + ' شواهد معادة للتعديل'}</b>${returned.map(e => `<div class="acx-note"><b>${esc(e.ev_label || e.title)}:</b> ${esc(e.review_note || '')} <small>— ${esc(sname(e.reviewed_by))}</small></div>`).join('')}<small>احذف الشاهد المعاد وارفع بديله، ثم أرسل المؤشر للمراجعة.</small></div>` : ''}
    <section class="acx-card"><h3>الشواهد <i>${evs.length}</i>${reviewable.length > 1 ? `<button type="button" class="acx-ok-all" id="acx-ok-all">✓ اعتماد الكل (${reviewable.length})</button>` : ''}</h3>
      <div class="acx-evs">${evs.map(e => evItem(e, i)).join('') || '<div class="acx-empty sm">لا توجد شواهد بعد</div>'}</div>
      ${up && !i.locked ? `<form class="acx-up" id="acx-up">
        <div class="acx-up-row"><select name="lbl" required><option value="">اختر نوع الشاهد…</option>
          ${opts.map((o, k) => `<option value="${k}">${esc(o.t)}${o.shared ? ` (مشترك مع ${esc(sname(o.shared.owner))})` : ''}</option>`).join('')}<option value="${OTHER}">شاهد آخر…</option></select>
          <input name="other" class="hidden" placeholder="اكتب اسم الشاهد" maxlength="120"></div>
        <div class="acx-up-row"><label class="acx-file"><input type="file" name="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"><span id="acx-file-t">📎 اختر الملف أو اسحبه هنا</span></label>
          <button type="button" class="acx-ghost sm" id="acx-link-t">أو رابط</button><input name="url" class="hidden" placeholder="https://" dir="ltr"></div>
        <div class="acx-up-f"><span class="acx-err"></span><button type="submit" class="acx-btn">رفع الشاهد</button></div>
      </form>
      ${(c.forms || []).length ? `<div class="acf-quick"><span>📄 أو عبّئ نموذجًا من الحقيبة:</span>${c.forms.map(n => `<button type="button" data-qform="${n}"><i dir="ltr">ن${n}</i>${esc(FORM_DEFS[n] ? FORM_DEFS[n].t : FORMS[n - 1] || '')}</button>`).join('')}</div>` : ''}
      <div class="acx-send ${pendSign.length ? 'blocked' : ''}"><div><b>${pendSign.length ? `✍ ${pendSign.length === 1 ? 'نموذج بانتظار' : pendSign.length + ' نماذج بانتظار'} رفع النسخة الموقعة` : drafts.length ? `${drafts.length} ${drafts.length === 1 ? 'شاهد جاهز' : 'شواهد جاهزة'} للإرسال` : 'ارفع شواهدك ثم أرسلها للمراجعة'}</b><small>${pendSign.length ? 'اطبع النموذج ووقّعه توقيعًا حيًا ثم ارفع صورته؛ بعدها يمكن الإرسال.' : `بعد الإرسال يتقفل المؤشر حتى يراجعه ${isLeadOf(i.domain_no) && i.owner_id === currentUserId ? 'المدير' : 'قائد المجال'}.`}</small></div>
        <button type="button" class="acx-btn send" id="acx-send" ${drafts.length && !pendSign.length ? '' : 'disabled'}>✓ اعتماد وإرسال للمراجعة</button></div>` : ''}
    </section>
  </div>`;
}
// خيارات القائمة: الشواهد المطلوبة، ثم الشواهد المشتركة
function evOptions(i) {
  const c = cardOf(i);
  const o = (c.ev || []).map(t => ({ t }));
  (c.shared || []).forEach(s => { const p = indByCode(s.with); if (p) o.push({ t: s.t, shared: { ind: p.id, code: s.with, owner: p.owner_id } }); });
  return o;
}
function evItem(e, i) {
  const linked = e.indicator_id !== i.id;
  const src = linked ? D.inds.find(x => x.id === e.indicator_id) : null;
  const mine = canUpload(i) && !linked && ['draft', 'returned'].includes(e.status);
  const ext = e.form_no ? 'ن' + e.form_no : e.kind === 'link' ? '🔗' : ((e.file_name || '').match(/\.([a-z0-9]+)$/i) || [, '📄'])[1].toUpperCase().slice(0, 4);
  const pend = e.sign_state === 'pending';
  const formBtns = e.form_no && e.form_doc ? `${pend || mine ? `<button type="button" class="fm" data-f-print="${e.id}" title="طباعة النموذج">🖨</button>` : ''}<button type="button" class="fm" data-f-edit="${e.id}" title="${mine ? 'تعديل النسخة الإلكترونية' : 'عرض النسخة الإلكترونية'}">${mine ? '✎' : '👁'}</button>${mine ? `<button type="button" class="fm sign ${pend ? 'need' : ''}" data-f-sign="${e.id}" title="رفع النسخة الموقعة">📷${pend ? ' رفع الموقّع' : ''}</button>` : ''}` : '';
  return `<div class="acx-ev ${EV[e.status] ? EV[e.status].c : ''}">
    <button type="button" class="acx-ev-i" data-open-ev="${e.id}" title="فتح">${esc(ext)}</button>
    <div class="acx-ev-t"><b>${esc(e.ev_label || e.title)}</b><small>${esc(e.kind === 'link' ? 'رابط' : e.kind === 'form' ? 'نموذج إلكتروني' : e.file_name || '')}${e.form_no && e.sign_state === 'signed' ? ' · ✍ موقّع' : ''} · ${esc(sname(e.uploaded_by))} · ${new Date(e.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })}${linked ? ` · <em>مشترك من المؤشر ${esc(src ? src.code : '')}</em>` : (e.linked_ids || []).length ? ` · <em>مشترك مع ${(e.linked_ids || []).map(id => esc((D.inds.find(x => x.id === id) || {}).code || '')).join('، ')}</em>` : ''}</small>
      ${e.status === 'returned' && e.review_note ? `<div class="acx-ev-note">↩ ${esc(e.review_note)}</div>` : ''}</div>
    ${pend && e.status === 'draft' ? '<span class="acx-st sign">بانتظار التوقيع</span>' : evChip(e)}
    <div class="acx-ev-a">${formBtns}${canReview(e, i) && !linked ? `<button type="button" class="ok" data-rev="${e.id}" data-act="advance">✓ ${['reviewed', 'verified'].includes(e.status) ? 'اعتماد نهائي' : 'اعتماد'}</button><button type="button" class="ret" data-rev="${e.id}" data-act="return">↩ إرجاع</button>` : ''}
      ${mine ? `<button type="button" class="del" data-del-ev="${e.id}" title="حذف">🗑</button>` : ''}</div>
  </div>`;
}

function bindIndicator(i) {
  $('acx-back').onclick = () => { V.ind = null; rerender(); };
  $('acx-info').onclick = () => openInfo(i);
  const as = $('acx-assign'); if (as) as.onclick = () => openAssign(i);
  document.querySelectorAll('[data-open-ev]').forEach(b => b.onclick = () => openEvidence(D.evs.find(e => e.id === b.dataset.openEv)));
  document.querySelectorAll('[data-del-ev]').forEach(b => b.onclick = () => delEvidence(D.evs.find(e => e.id === b.dataset.delEv)));
  document.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => reviewAction(D.evs.find(e => e.id === b.dataset.rev), b.dataset.act));
  const all = $('acx-ok-all'); if (all) all.onclick = async () => {
    const list = evOf(i).filter(e => canReview(e, i) && e.indicator_id === i.id);
    if (!confirm(`اعتماد ${list.length} شواهد؟`)) return;
    for (const e of list) { const { data, error } = await sb.rpc('acc_review', { p_ev: e.id, p_action: 'advance', p_note: null }); if (error) { toast(error.message, true); break; } Object.assign(e, data); }
    await refreshInd(i); toast('اعتُمدت الشواهد ✓');
  };
  const send = $('acx-send'); if (send) send.onclick = async () => {
    const n = evOf(i).filter(e => e.status === 'draft' && e.indicator_id === i.id).length;
    if (!confirm(`إرسال ${n === 1 ? 'شاهد واحد' : n + ' شواهد'} للمراجعة؟ سيتقفل المؤشر حتى تنتهي المراجعة.`)) return;
    send.disabled = true;
    const { error } = await sb.rpc('acc_submit', { p_ind: i.id });
    if (error) { send.disabled = false; toast(error.message, true); return; }
    await refreshInd(i); toast('أُرسل المؤشر للمراجعة ✓');
  };
  const rc = $('acx-recall'); if (rc) rc.onclick = async () => {
    if (!confirm('التراجع عن إرسال الشواهد؟ ستعود مسودات يمكنك تعديلها أو حذفها، ثم إعادة إرسالها للمراجعة.')) return;
    rc.disabled = true;
    const { data, error } = await sb.rpc('acc_recall', { p_ind: i.id });
    if (error) { rc.disabled = false; toast(error.message, true); await refreshInd(i); return; }
    await refreshInd(i); toast(`أُعيد ${data === 1 ? 'شاهد واحد' : data + ' شواهد'} إلى المسودات — عدّل ثم أرسل من جديد ✓`);
  };
  const form = $('acx-up'); if (form) bindUpload(form, i);
  document.querySelectorAll('[data-qform]').forEach(b => b.onclick = () => openFormEditor({ no: +b.dataset.qform, ind: i, onClose: () => rerender() }));
  const evBy = id => D.evs.find(e => e.id === id);
  document.querySelectorAll('[data-f-print]').forEach(b => b.onclick = async () => { const d = await ensureDoc(evBy(b.dataset.fPrint)); if (d) printForm(d.form_no, d.data); else toast('تعذر العثور على النسخة الإلكترونية', true); });
  document.querySelectorAll('[data-f-edit]').forEach(b => b.onclick = async () => { const d = await ensureDoc(evBy(b.dataset.fEdit)); if (d) openFormEditor({ no: d.form_no, doc: d, onClose: () => rerender() }); else toast('تعذر العثور على النسخة الإلكترونية', true); });
  document.querySelectorAll('[data-f-sign]').forEach(b => b.onclick = () => uploadSigned(evBy(b.dataset.fSign), () => refreshInd(i)));
}
async function refreshInd(i) {
  const [{ data: ind }, { data: evs }] = await Promise.all([
    sb.from('acc_indicators').select('*').eq('id', i.id).single(),
    sb.from('acc_evidence').select('*').or(`indicator_id.eq.${i.id},linked_ids.cs.{${i.id}}`),
  ]);
  if (ind) Object.assign(i, ind);
  if (evs) { const ids = new Set(evs.map(e => e.id)); D.evs = D.evs.filter(e => e.indicator_id !== i.id && !ids.has(e.id)).concat(evs); }
  rerender();
}

function bindUpload(form, i) {
  const sel = form.querySelector('[name=lbl]'), other = form.querySelector('[name=other]'), url = form.querySelector('[name=url]'), fin = form.querySelector('[name=file]'), ft = $('acx-file-t'), err = form.querySelector('.acx-err');
  let picked = [];
  sel.onchange = () => { other.classList.toggle('hidden', sel.value !== OTHER); if (sel.value === OTHER) other.focus(); };
  $('acx-link-t').onclick = () => { url.classList.toggle('hidden'); if (!url.classList.contains('hidden')) url.focus(); };
  const setPicked = fl => { picked = [...fl]; ft.textContent = picked.length ? (picked.length === 1 ? '📎 ' + picked[0].name : `📎 ${picked.length} ملفات`) : '📎 اختر الملف أو اسحبه هنا'; };
  fin.onchange = () => setPicked(fin.files);
  const lab = form.querySelector('.acx-file');
  ['dragenter', 'dragover'].forEach(ev => lab.addEventListener(ev, e => { e.preventDefault(); lab.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => lab.addEventListener(ev, e => { e.preventDefault(); lab.classList.remove('over'); }));
  lab.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) setPicked(e.dataTransfer.files); });
  form.onsubmit = async ev => {
    ev.preventDefault(); err.textContent = '';
    if (!sel.value) { err.textContent = 'اختر نوع الشاهد'; return; }
    const opt = sel.value === OTHER ? { t: other.value.trim() } : evOptions(i)[+sel.value];
    if (!opt || !opt.t) { err.textContent = 'اكتب اسم الشاهد'; return; }
    const u = url.value.trim();
    if (!picked.length && !u) { err.textContent = 'اختر ملفًا أو أدخل رابطًا'; return; }
    if (u && !/^https?:\/\/\S+$/i.test(u)) { err.textContent = 'أدخل رابطًا صحيحًا يبدأ بـ https://'; return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    const base = { indicator_id: i.id, uploaded_by: currentUserId, status: 'draft', ev_label: opt.t, title: opt.t, linked_ids: opt.shared ? [opt.shared.ind] : [] };
    let ok = 0;
    if (u) {
      const { error } = await writeWithSchool(extra => sb.from('acc_evidence').insert({ ...base, kind: 'link', url: u, ...extra }));
      if (error) err.textContent = 'تعذر الحفظ: ' + error.message; else ok++;
    }
    for (const [k, f0] of picked.entries()) {
      btn.textContent = picked.length > 1 ? `جارٍ الرفع ${k + 1} من ${picked.length}` : 'جارٍ الرفع...';
      const f = await shrinkImage(f0);
      if (f.size > 25 * 1024 * 1024) { err.textContent = `«${f.name}» أكبر من 25 م.ب`; continue; }
      const ext = (f.name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || 'bin';
      const path = `${currentSchoolId}/${i.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext.toLowerCase()}`;
      const upr = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (upr.error) { err.textContent = `تعذر رفع «${f.name}»: ${upr.error.message}`; continue; }
      const { error } = await writeWithSchool(extra => sb.from('acc_evidence').insert({ ...base, kind: 'file', storage_path: path, file_name: f.name, file_size: f.size, ...extra }));
      if (error) { err.textContent = 'تعذر الحفظ: ' + error.message; await sb.storage.from(BUCKET).remove([path]); continue; }
      ok++;
    }
    btn.disabled = false; btn.textContent = 'رفع الشاهد';
    if (ok) { await refreshInd(i); toast(ok === 1 ? 'رُفع الشاهد مسودةً ✓' : `رُفع ${ok} شواهد ✓`); }
  };
}
async function shrinkImage(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 700 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}
async function delEvidence(e) {
  if (!e || !confirm('حذف هذا الشاهد؟')) return;
  if (e.storage_path) await sb.storage.from(BUCKET).remove([e.storage_path]);
  const { error } = await sb.from('acc_evidence').delete().eq('id', e.id);
  if (error) { toast('تعذر الحذف: ' + error.message, true); return; }
  D.evs = D.evs.filter(x => x.id !== e.id); rerender();
}
async function openEvidence(e) {
  if (!e) return;
  if (e.kind === 'link') { window.open(e.url, '_blank', 'noopener'); return; }
  if (!e.storage_path && e.form_doc) { const d = await ensureDoc(e); if (d) openFormEditor({ no: d.form_no, doc: d, onClose: () => rerender() }); return; }
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(e.storage_path, 900);
  if (error || !data) { if (w) w.close(); toast('تعذر فتح الملف', true); return; }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
}
function reviewAction(e, act) {
  if (act === 'advance') return doReview(e, 'advance');
  const m = modal(`<header><b>إرجاع الشاهد للتعديل</b><button type="button" class="acx-x" data-x>✕</button></header>
    <p class="acx-muted">«${esc(e.ev_label || e.title)}» — اكتب ما المطلوب تعديله بوضوح، وستظهر الملاحظة للمسؤول${['reviewed', 'verified'].includes(e.status) ? ' ولقائد المجال' : ''}.</p>
    <textarea id="acx-note" rows="4" placeholder="مثال: الشاهد وصفي بلا أرقام، أضف نسبة قبل وبعد البرنامج"></textarea>
    <footer><span class="acx-err"></span><button type="button" class="acx-btn ret" id="acx-note-ok">↩ إرجاع بالملاحظة</button></footer>`);
  const ta = m.querySelector('#acx-note'); ta.focus();
  m.querySelector('#acx-note-ok').onclick = async () => {
    if (!ta.value.trim()) { m.querySelector('.acx-err').textContent = 'الملاحظة إلزامية'; return; }
    m.remove(); doReview(e, 'return', ta.value.trim());
  };
}
async function doReview(e, act, note = null) {
  const { data, error } = await sb.rpc('acc_review', { p_ev: e.id, p_action: act, p_note: note });
  if (error) { toast(error.message, true); return; }
  Object.assign(e, data || {});
  const i = D.inds.find(x => x.id === e.indicator_id);
  await refreshInd(i);
  toast(act === 'return' ? 'أُعيد الشاهد للمسؤول' : e.status === 'approved' ? 'اعتُمد الشاهد نهائيًا ✓' : 'اعتُمد الشاهد وانتقل للمدير ✓');
}

/* ---------- شرح المؤشر (!) ---------- */
function openInfo(i) {
  const c = cardOf(i), g = ACC_GUIDE[i.code] || {};
  const m = modal(`<header><span class="acx-code" style="--dc:${DCOL[i.domain_no]}">${esc(i.code)}</span><b>${esc(i.text)}</b><button type="button" class="acx-x" data-x>✕</button></header>
    <div class="acx-info-b">
      ${g.meaning ? `<section><h4>معنى المؤشر</h4><p>${esc(g.meaning)}</p></section>` : ''}
      <section><h4>الشواهد المقترحة</h4><ul class="acx-ul">${(c.ev || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
      ${c.best ? `<section class="best"><h4>مستوى التميّز</h4><p>${esc(c.best)}</p></section>` : ''}
      ${c.drop ? `<section class="drop"><h4>يُسقط الدرجة</h4><p>${esc(c.drop)}</p></section>` : ''}
      ${c.q ? `<section class="q"><h4>السؤال المتوقع ${c.who ? `<span>يُسأل: ${esc(c.who)}</span>` : ''}</h4><p>${esc(c.q)}</p></section>` : ''}
      ${(c.shared || []).length ? `<section class="sh"><h4>شواهد مشتركة <span>تُرفع مرة واحدة وتظهر في المؤشرين</span></h4><ul class="acx-ul">${c.shared.map(s => { const p = indByCode(s.with); return `<li><b>${esc(s.t)}</b> — مع ${esc(p ? nameOf(p.owner_id) : '')} (<bdi dir="ltr">${esc(s.with)}</bdi>)</li>`; }).join('')}</ul></section>` : ''}
      ${(c.forms || []).length ? `<section><h4>النماذج المساعدة</h4><div class="acx-forms">${c.forms.map(n => `<button type="button" data-info-form="${n}">ن${n} ${esc(FORMS[n - 1] || '')}</button>`).join('')}</div></section>` : ''}
      <section class="test"><h4>اختبار الشاهد قبل رفعه</h4><ul class="acx-ul check">${EVIDENCE_TEST.map(t => `<li>${esc(t)}</li>`).join('')}</ul><p class="acx-muted">معادلة الشاهد المتميز: تخطيط ← تنفيذ ← متابعة ← أثر. شاهدان أو ثلاثة قوية أفضل من عشرة ضعيفة.</p></section>
    </div>`, 'wide');
  m.querySelectorAll('[data-info-form]').forEach(b => b.onclick = () => { m.remove(); openFormEditor({ no: +b.dataset.infoForm, ind: i, onClose: () => rerender() }); });
}

/* ---------- الإسناد ---------- */
function openAssign(i) {
  if (!i) return;
  let owner = i.owner_id, ups = new Set(i.uploader_ids || []), q = '';
  const people = [...D.people.values()];
  const m = modal('', 'wide');
  const draw = () => {
    const list = people.filter(p => !q || p.full_name.includes(q));
    m.querySelector('.acx-modal-b').innerHTML = `<header><span class="acx-code" style="--dc:${DCOL[i.domain_no]}">${esc(i.code)}</span><b>إسناد المؤشر</b><button type="button" class="acx-x" data-x>✕</button></header>
      <p class="acx-muted">${esc(i.text)}</p>
      <div class="acx-asg-sum"><div><small>المسؤول</small><b>${owner ? esc(nameOf(owner)) : '—'}</b></div><div><small>مكلّفون بالرفع</small><b>${ups.size ? [...ups].map(u => esc(sname(u))).join('، ') : 'لا أحد'}</b></div></div>
      <input type="search" class="acx-in" id="acx-q" placeholder="ابحث باسم المنسوب" value="${esc(q)}">
      <div class="acx-people">${list.map(p => `<div class="acx-person ${p.id === owner ? 'own' : ups.has(p.id) ? 'up' : ''}"><span class="acx-av">${esc(p.full_name.trim().charAt(0))}</span><b>${esc(p.full_name)}</b>
        <button type="button" data-own="${p.id}" class="${p.id === owner ? 'on' : ''}">${p.id === owner ? '✓ المسؤول' : 'مسؤول'}</button>
        <button type="button" data-up="${p.id}" class="${ups.has(p.id) ? 'on' : ''}" ${p.id === owner ? 'disabled' : ''}>${ups.has(p.id) ? '✓ يرفع' : '+ يرفع'}</button></div>`).join('')}</div>
      <footer><span class="acx-muted">المسؤول يتابع المؤشر وتُحسب عليه جاهزيته، والمكلّف بالرفع يرفع الشواهد فقط.</span><button type="button" class="acx-btn" id="acx-asg-save">حفظ الإسناد</button></footer>`;
    const qi = m.querySelector('#acx-q'); qi.oninput = () => { q = qi.value.trim(); const pos = qi.selectionStart; draw(); const n = m.querySelector('#acx-q'); n.focus(); n.setSelectionRange(pos, pos); };
    m.querySelectorAll('[data-own]').forEach(b => b.onclick = () => { owner = b.dataset.own; ups.delete(owner); draw(); });
    m.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { ups.has(b.dataset.up) ? ups.delete(b.dataset.up) : ups.add(b.dataset.up); draw(); });
    m.querySelector('#acx-asg-save').onclick = async () => {
      const { data, error } = await sb.rpc('acc_assign', { p_ind: i.id, p_owner: owner, p_uploaders: [...ups] });
      if (error) { toast(error.message, true); return; }
      Object.assign(i, data); m.remove(); toast('حُفظ الإسناد ✓');
      rerender();
    };
  };
  draw();
}

/* ---------- موعد الزيارة ---------- */
function editVisit() {
  const m = modal(`<header><b>موعد زيارة التقويم الخارجي</b><button type="button" class="acx-x" data-x>✕</button></header>
    <input type="date" class="acx-in" id="acx-vd" value="${esc(D.visit || '')}">
    <footer><button type="button" class="acx-ghost" id="acx-vd-clear">إلغاء الموعد</button><button type="button" class="acx-btn" id="acx-vd-save">حفظ</button></footer>`);
  const save = async v => {
    const { error } = await writeWithSchool(extra => sb.from('acc_settings').upsert({ visit_date: v, updated_at: new Date().toISOString(), ...extra }, { onConflict: 'school_id' }));
    if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
    D.visit = v; m.remove(); rerender(); toast('حُفظ موعد الزيارة ✓');
  };
  m.querySelector('#acx-vd-save').onclick = () => save(m.querySelector('#acx-vd').value || null);
  m.querySelector('#acx-vd-clear').onclick = () => save(null);
}
