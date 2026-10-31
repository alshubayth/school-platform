/* =========================================================================
 * الاعتماد المدرسي: جاهزية التقويم الخارجي
 * - المؤشرات (acc_indicators) مرتبة: المجال ← المعيار ← المؤشر.
 * - لكل مؤشر مسؤولون بدرجات (أول/ثانٍ/ثالث)، أفرادًا أو فرقًا (acc_groups)، ومعه قائمة الشواهد المطلوبة ودليل شرحه.
 * - سلسلة الاعتماد: جامع الشواهد يرفع ← قائد المجال يراجع ويعتمد ← المدير يعتمد نهائيًا (acc_review).
 * - كل شاهد يرتبط ببند من الشواهد المطلوبة، ويُصنَّف بتدرّجه: تخطيط ← تنفيذ ← متابعة ← أثر.
 * - المسؤول يحدّد حالة إنجاز مؤشره، والخطة الزمنية بمراحلها الثماني محفوظة في acc_settings.phases.
 * ========================================================================= */
import { sb, currentSchoolId, currentUserId, currentProfile, isAdminOrDeputy, readScopedBySchool, writeWithSchool, printOrgName, printLogo } from './core.js';
import { ACC_GUIDE } from './acc-guide.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUCKET = 'acc-evidence';
const DOMAINS = { 1: 'الإدارة المدرسية', 2: 'التعليم والتعلم', 3: 'نواتج التعلم', 4: 'البيئة المدرسية' };
const DCOL = { 1: '#2455A4', 2: '#0E93A8', 3: '#6249A6', 4: '#C27A1E' };
const ST = {
  done: { t: 'مكتمل', c: 'done' }, partial: { t: 'مكتمل جزئيًا', c: 'part' }, pending: { t: 'قيد المراجعة', c: 'pend' }, returned: { t: 'معاد للتعديل', c: 'ret' },
  empty: { t: 'لا توجد شواهد', c: 'empty' }, na: { t: 'لا ينطبق', c: 'na' },
};
const EVST = {
  submitted: { t: 'بانتظار قائد المجال', c: 'pend', n: 0 }, reviewed: { t: 'بانتظار اعتماد المدير', c: 'pend', n: 1 }, verified: { t: 'بانتظار اعتماد المدير', c: 'pend', n: 1 },
  approved: { t: 'معتمد نهائيًا', c: 'done', n: 3 }, returned: { t: 'معاد للتعديل', c: 'ret', n: -1 },
};
const PROG = { not_started: 'لم يبدأ', in_progress: 'جارٍ', done: 'مكتمل', revise: 'يحتاج تعديل' };
const STAGES = { plan: ['التخطيط', 'خطة أو إجراء واضح'], exec: ['التنفيذ', 'دليل على تنفيذ الخطة'], follow: ['المتابعة', 'محضر أو سجل أو تقرير متابعة'], impact: ['الأثر', 'مقارنة قبل/بعد أو إحصاءات أو استبانة'] };
const RANK = { 1: 'المسؤول الأول', 2: 'المسؤول الثاني', 3: 'المسؤول الثالث' };
const RSHORT = { 1: 'أول', 2: 'ثانٍ', 3: 'ثالث' };
const HVERB = { reviewed: 'اعتمده قائد المجال', verified: 'اعتمده قائد المجال', approved: 'اعتمده نهائيًا', returned: 'أعاده' };
const LV_ACT = { 1: 'اعتماد قائد المجال', 3: 'اعتماد نهائي' };
const IC = {
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2c2.9.3 5 2.6 5 5.8"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.3"/><circle cx="4.5" cy="12" r="1.3"/><circle cx="4.5" cy="18" r="1.3"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
};

let D = { inds: [], evs: [], staff: [], visit: null, leads: [], groups: [], roles: {}, phases: [] };
let V = { tab: 'list', domain: 0, filter: 'all', q: '', open: null, mine: false, member: null, dtab: 'req' };
const mgr = () => isAdminOrDeputy() || (currentProfile && currentProfile.role === 'owner');
const R = build => readScopedBySchool(sc => { let q = build(); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
const nameOf = id => (D.staff.find(p => p.id === id) || {}).full_name || '—';
const short = n => { const w = String(n || '').trim().split(/\s+/).filter(x => !['بن', 'ابن'].includes(x)); return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' '); };
const initial = id => esc(String(nameOf(id)).trim().charAt(0));
const evsOf = ind => D.evs.filter(e => e.indicator_id === ind.id);
const isPend = e => ['submitted', 'reviewed', 'verified'].includes(e.status);

/* ---------- الدليل والشواهد المطلوبة: ما تعدّله المدرسة يتقدّم على الدليل الافتراضي ---------- */
const guideOf = i => { const g = i.guide && Object.keys(i.guide).length ? i.guide : (ACC_GUIDE[i.code] || {}); return g; };
const reqOf = i => (Array.isArray(i.req_ev) && i.req_ev.length ? i.req_ev : ((ACC_GUIDE[i.code] || {}).ev || []));
const coveredOf = i => { const s = new Set(); evsOf(i).forEach(e => { if (e.status === 'approved' && e.req_idx != null) s.add(e.req_idx); }); return s; };
function coverage(i) { const n = reqOf(i).length; return n ? coveredOf(i).size / n : (evsOf(i).some(e => e.status === 'approved') ? 1 : 0); }

function statusOf(ind) {
  if (ind.not_applicable) return 'na';
  const ev = evsOf(ind);
  if (!ev.length) return 'empty';
  if (coverage(ind) >= 1) return 'done';
  if (ev.some(isPend)) return 'pending';
  if (ev.some(e => e.status === 'returned')) return 'returned';
  if (ev.some(e => e.status === 'approved')) return 'partial';
  return 'empty';
}

/* ---------- المسؤوليات: درجات، أفراد وفرق، ومسؤول المجال أو المعيار ---------- */
const stdKey = i => i.domain_no + '|' + i.standard;
const leadOf = (scope, key) => (D.leads.find(l => l.scope === scope && l.scope_key === String(key)) || {}).owner_ids || [];
const domainOwners = i => leadOf('domain', i.domain_no);
const stdOwners = i => leadOf('standard', stdKey(i));
const groupById = id => D.groups.find(g => g.id === id);
const teachers = () => D.staff.filter(p => p.role === 'teacher').map(p => p.id);
const groupMembers = g => g ? (g.everyone ? teachers() : (g.member_ids || [])) : [];
const asgOf = i => { const a = Array.isArray(i.assignees) ? i.assignees : []; const legacy = (i.owner_ids || []).filter(id => !a.some(x => x.k === 'u' && x.id === id)).map(id => ({ k: 'u', id, r: 1 })); return [...a, ...legacy]; };
const asgUsers = i => [...new Set(asgOf(i).flatMap(a => a.k === 'u' ? [a.id] : groupMembers(groupById(a.id))))];
const effOwners = i => [...new Set([...domainOwners(i), ...stdOwners(i), ...asgUsers(i)])];
const isMine = ind => effOwners(ind).includes(currentUserId);
const canUpload = ind => mgr() || isMine(ind);
const myDomains = () => [1, 2, 3, 4].filter(d => leadOf('domain', d).includes(currentUserId));
const isLead = i => domainOwners(i).includes(currentUserId);
const canAssign = i => mgr() || isLead(i);
const viewOf = () => mgr() ? 'admin' : myDomains().length ? 'lead' : 'member';
function rankOf(i, uid) {
  let r = null;
  asgOf(i).forEach(a => { if ((a.k === 'u' && a.id === uid) || (a.k === 'g' && groupMembers(groupById(a.id)).includes(uid))) r = r == null ? a.r : Math.min(r, a.r); });
  return r;
}
const asgLabel = a => a.k === 'u' ? short(nameOf(a.id)) : ((groupById(a.id) || {}).name || 'فريق محذوف');
const roleIds = k => (D.roles && Array.isArray(D.roles[k])) ? D.roles[k] : [];
// مستوى المراجعة (مطابق لـ acc_review_level في القاعدة)
function myLevel(d) {
  if (currentProfile && currentProfile.role === 'owner') return 3;
  if (roleIds('principal').includes(currentUserId) || (mgr() && !roleIds('principal').length)) return 3;
  if (leadOf('domain', d).includes(currentUserId)) return 1;
  return 0;
}
const canAct = e => { const i = D.inds.find(x => x.id === e.indicator_id); const lv = i ? myLevel(i.domain_no) : 0, n = EVST[e.status] ? EVST[e.status].n : -1; return lv > 0 && n >= 0 && n < 3 && lv > n; };

function toast(msg, bad) {
  let t = $('ac-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ac-toast'; t.className = 'ac-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove('show'), 3200);
}

export async function loadAccreditationModule() {
  const box = $('acc-container');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const [inds, evs, staff, set, leads, groups] = await Promise.all([
    R(() => sb.from('acc_indicators').select('*').order('sort')),
    R(() => sb.from('acc_evidence').select('*').order('created_at')),
    R(() => sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher']).order('full_name')),
    R(() => sb.from('acc_settings').select('visit_date, roles, phases')),
    R(() => sb.from('acc_leads').select('*')),
    R(() => sb.from('acc_groups').select('*').order('sort')),
  ]);
  if (inds.error) { box.innerHTML = `<div class="ac-empty">تعذر تحميل المؤشرات: ${esc(inds.error.message)}</div>`; return; }
  const st = (set.data || [])[0] || {};
  D = { inds: inds.data || [], evs: evs.data || [], staff: (staff.data || []).filter(p => p.full_name), visit: st.visit_date || null, leads: leads.data || [], groups: groups.data || [], roles: st.roles || {}, phases: Array.isArray(st.phases) ? st.phases : [] };
  if (!mgr()) { V.mine = true; V.tab = viewOf() === 'lead' ? (V.tab === 'me' ? 'me' : 'dom') : 'me'; }
  render();
}

async function saveSettings(patch) {
  const { error } = await writeWithSchool(extra => sb.from('acc_settings').upsert({ ...patch, updated_at: new Date().toISOString(), ...extra }, { onConflict: 'school_id' }));
  if (error) { toast('تعذر الحفظ: ' + error.message, true); return false; }
  return true;
}

/* ---------- الواجهة: «مدار الجاهزية» ---------- */
const SCOL = { done: '#2FC1B2', partial: '#9BE0D5', pending: '#6FA4F2', returned: '#F2A65A', empty: 'rgba(255,255,255,.22)', na: 'rgba(255,255,255,.08)' };
const daysLeft = () => { if (!D.visit) return null; const t = new Date(D.visit + 'T00:00:00'), n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 864e5); };
const arDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' }) : '';

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

function readiness() {
  const app = D.inds.filter(i => !i.not_applicable);
  const tot = app.reduce((s, i) => s + coverage(i), 0);
  return { app, pct: app.length ? Math.round(tot / app.length * 100) : 0, done: app.filter(i => statusOf(i) === 'done').length };
}

function render() {
  if (viewOf() !== 'admin') return renderLite();
  const box = $('acc-container');
  const { app, pct, done } = readiness();
  const cnt = s => app.filter(i => statusOf(i) === s).length;
  const queue = D.evs.filter(canAct).length;
  const noOwner = D.inds.filter(i => !i.not_applicable && !effOwners(i).length).length;
  const dl = daysLeft();
  const tabs = [['list', IC.list, 'المؤشرات'], ['me', IC.user, 'صفحتي'], ['team', IC.team, 'الأدوار والفرق'], ['plan', IC.flag, 'الخطة الزمنية']];
  box.innerHTML = `<div class="ac">
    <header class="ac-sky">
      <div class="ac-stars" aria-hidden="true"></div>
      <div class="ac-sky-t">
        <span class="ac-kicker">التقويم المدرسي · جاهزية التقويم الخارجي</span>
        <h3>مدار الجاهزية</h3>
        <p>كل نقطة مؤشر يدور في مدار مجاله، ويضيء كلما اكتملت شواهده المطلوبة واعتُمدت.</p>
        <div class="ac-count">
          ${D.visit ? `<div class="ac-days${dl != null && dl <= 7 ? ' soon' : ''}"><b>${dl > 0 ? dl : dl === 0 ? 'اليوم' : '—'}</b><span>${dl > 0 ? (dl === 1 ? 'يوم على الزيارة' : dl === 2 ? 'يومان على الزيارة' : 'يومًا على الزيارة') : dl === 0 ? 'موعد الزيارة' : 'انتهى الموعد'}</span><small>${esc(arDate(D.visit))}</small></div>` : (mgr() ? '<div class="ac-days empty"><b>؟</b><span>حدّد موعد زيارة فريق التقويم</span></div>' : '')}
          ${mgr() ? `<label class="ac-date" title="موعد الزيارة">${IC.cal}<span>موعد الزيارة</span><input type="date" id="ac-visit-date" value="${D.visit || ''}"></label>` : ''}
        </div>
        <div class="ac-legend">${[['done', 'مكتمل'], ['partial', 'جزئي'], ['pending', 'قيد المراجعة'], ['returned', 'معاد'], ['empty', 'بلا شواهد']].map(([k, t]) => `<button type="button" data-f="${k}" class="${V.filter === k ? 'on' : ''}"><i style="background:${SCOL[k]}"></i>${t}<b>${cnt(k)}</b></button>`).join('')}</div>
        <div class="ac-sky-a">
          <button type="button" class="ac-btn glow" id="ac-visit">${IC.eye}وضع الزيارة</button>
          <button type="button" class="ac-btn light" id="ac-print">${IC.print}الطباعة</button>
        </div>
      </div>
      <div class="ac-orbit">
        ${orbitSvg()}
        <div class="ac-core"><b data-count="${pct}">0</b><span>%</span><small>جاهزية الشواهد</small><em>${done} من ${app.length} مكتمل</em></div>
      </div>
    </header>
    ${queue || (mgr() && noOwner) ? `<div class="ac-alerts">${queue ? `<button type="button" id="ac-goq">${queue} ${queue === 1 ? 'شاهد ينتظر' : 'شواهد تنتظر'} اعتمادك ←</button>` : ''}${mgr() && noOwner ? `<button type="button" id="ac-assign2">${noOwner} مؤشرًا بلا مسؤول، وزّعها ←</button>` : ''}</div>` : ''}
    <div class="ac-planets">${[1, 2, 3, 4].map(d => {
      const ii = D.inds.filter(i => i.domain_no === d && !i.not_applicable);
      const p = ii.length ? ii.reduce((s, i) => s + coverage(i), 0) / ii.length : 0, dn = ii.filter(i => statusOf(i) === 'done').length, C = 2 * Math.PI * 26;
      return `<button type="button" class="ac-planet${V.domain === d ? ' on' : ''}" data-dom="${d}" style="--c:${DCOL[d]}">
        <span class="pr"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="bg"/><circle cx="30" cy="30" r="26" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"/></svg><i>${d}</i></span>
        <span class="pt"><b>${DOMAINS[d]}</b><small>${dn} من ${ii.length} مكتمل${leadOf('domain', d).length ? ' · ' + esc(short(nameOf(leadOf('domain', d)[0]))) : ''}</small></span><span class="pp">${Math.round(p * 100)}%</span></button>`;
    }).join('')}</div>
    <nav class="ac-tabs" role="tablist">${tabs.map(([k, ic, t]) => `<button type="button" role="tab" data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${ic}<span>${t}</span>${k === 'me' && queue ? `<em>${queue}</em>` : ''}</button>`).join('')}</nav>
    <div id="ac-pane"></div>
  </div>
  <aside class="ac-drawer${V.open ? ' open' : ''}" id="ac-drawer" aria-hidden="${V.open ? 'false' : 'true'}"></aside>
  <div class="ac-scrim${V.open ? ' open' : ''}" id="ac-scrim"></div>`;
  box.querySelectorAll('[data-dom]').forEach(b => b.onclick = () => { V.domain = V.domain === +b.dataset.dom ? 0 : +b.dataset.dom; V.tab = 'list'; render(); });
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { V.filter = V.filter === b.dataset.f ? 'all' : b.dataset.f; V.tab = 'list'; render(); $('ac-pane').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { V.tab = b.dataset.tab; box.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); renderPane(); });
  box.querySelectorAll('.orb-dot').forEach(c => c.onclick = () => openDrawer(c.dataset.ind));
  $('ac-visit').onclick = openVisit;
  $('ac-print').onclick = openPrintMenu;
  $('ac-scrim').onclick = () => openDrawer(null);
  const gq = $('ac-goq'); if (gq) gq.onclick = () => { V.tab = 'me'; render(); setTimeout(() => { const q = $('ac-queue'); if (q) q.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); };
  const asg2 = $('ac-assign2'); if (asg2) asg2.onclick = openAssign;
  const vd = $('ac-visit-date');
  if (vd) vd.onchange = async () => { const v = vd.value || null; if (await saveSettings({ visit_date: v })) { D.visit = v; render(); toast('حُفظ موعد الزيارة ✓'); } };
  box.querySelectorAll('[data-count]').forEach(el => { const to = +el.dataset.count, t0 = performance.now(); const st = n => { const p = Math.min(1, (n - t0) / 1100), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(st); }; requestAnimationFrame(st); });
  renderPane();
  if (V.open) drawDrawer();
}
function renderPane() { ({ list: renderListTab, me: renderMe, team: renderTeam, plan: renderPlan, dom: renderDomain }[V.tab] || renderListTab)(); }

/* ---------- واجهة المعلم وقائد المجال: ما يخصه فقط ---------- */
function renderLite() {
  const box = $('acc-container'), lead = viewOf() === 'lead', doms = myDomains();
  const queue = D.evs.filter(canAct).length;
  const ii = lead ? D.inds.filter(i => doms.includes(i.domain_no) && !i.not_applicable) : D.inds.filter(i => isMine(i) && !i.not_applicable);
  const pct = ii.length ? Math.round(ii.reduce((s, i) => s + coverage(i), 0) / ii.length * 100) : 0;
  const dl = daysLeft();
  if (!lead) V.tab = 'me';
  box.innerHTML = `<div class="ac">
    <header class="ac-lite">
      <div class="ac-stars" aria-hidden="true"></div>
      <div class="t"><span class="ac-kicker">التقويم المدرسي · جاهزية التقويم الخارجي</span>
        <h3>${lead ? 'قائد مجال ' + doms.map(d => DOMAINS[d]).join(' و') : 'مؤشراتي في التقويم المدرسي'}</h3>
        <p>${lead ? 'أسند مؤشرات مجالك لزملائك، وراجع شواهدهم واعتمدها قبل أن تصل للمدير.' : 'ارفع شواهد مؤشراتك مرتبطة ببنودها، ويعتمدها قائد المجال ثم المدير.'}</p>
        ${D.visit && dl != null && dl >= 0 ? `<span class="ac-lite-d">${IC.cal}${dl === 0 ? 'الزيارة اليوم' : `${dl} ${dl === 1 ? 'يوم' : dl === 2 ? 'يومان' : 'يومًا'} على الزيارة`} · ${esc(arDate(D.visit))}</span>` : ''}</div>
      <div class="ac-me-ring" style="--p:${pct}"><b>${pct}%</b><small>${lead ? 'جاهزية المجال' : 'جاهزية مؤشراتي'}</small></div>
    </header>
    ${lead ? `<nav class="ac-tabs" role="tablist">${[['dom', IC.list, 'مؤشرات المجال'], ['me', IC.user, 'مؤشراتي']].map(([k, ic, t]) => `<button type="button" role="tab" data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${ic}<span>${t}</span>${k === 'dom' && queue ? `<em>${queue}</em>` : ''}</button>`).join('')}</nav>` : ''}
    <div id="ac-pane"></div>
  </div>
  <aside class="ac-drawer${V.open ? ' open' : ''}" id="ac-drawer" aria-hidden="${V.open ? 'false' : 'true'}"></aside>
  <div class="ac-scrim${V.open ? ' open' : ''}" id="ac-scrim"></div>`;
  box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { V.tab = b.dataset.tab; box.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); renderPane(); });
  $('ac-scrim').onclick = () => openDrawer(null);
  renderPane();
  if (V.open) drawDrawer();
}

/* صفحة قائد المجال: كل مؤشر وأمامه المسندون إليه، والشواهد التي تنتظر اعتماده */
function renderDomain() {
  const pane = $('ac-pane'), doms = myDomains();
  const queue = D.evs.filter(canAct);
  const picker = i => { const a = asgOf(i);
    return `<select class="ac-pick" data-dadd="${i.id}"><option value="">＋ إسناد</option><optgroup label="الأشخاص">${D.staff.filter(p => !a.some(x => x.k === 'u' && x.id === p.id)).map(p => `<option value="u:${p.id}">${esc(p.full_name)}</option>`).join('')}</optgroup>${D.groups.length ? `<optgroup label="الفرق">${D.groups.filter(g => !a.some(x => x.k === 'g' && x.id === g.id)).map(g => `<option value="g:${g.id}">${esc(g.name)}</option>`).join('')}</optgroup>` : ''}</select>`; };
  pane.innerHTML = `<div class="ac-dom">
    ${queue.length ? `<section class="ac-queue" id="ac-queue"><header><b>تنتظر اعتمادك</b><span>${queue.length} ${queue.length === 1 ? 'شاهد' : 'شواهد'}، افتح المؤشر ثم اعتمد الشاهد أو أعده بملاحظة</span></header>${queue.map(queueRow).join('')}</section>` : '<div class="ac-allok">لا توجد شواهد تنتظر اعتمادك ✓</div>'}
    ${doms.map(d => {
      const ii = D.inds.filter(i => i.domain_no === d);
      const stds = [...new Set(ii.map(i => i.standard))];
      const un = ii.filter(i => !i.not_applicable && !asgOf(i).length).length;
      return `<section class="ac-dsec" style="--c:${DCOL[d]}">
        <header><span class="n">${d}</span><div><b>${DOMAINS[d]}</b><small>${ii.length} مؤشرًا${un ? ` · <em>${un} بلا مسؤول</em>` : ''}</small></div></header>
        ${stds.map(st => `<div class="ac-dstd"><h5>${esc(st)}</h5>${ii.filter(i => i.standard === st).map(i => {
          const s = statusOf(i), req = reqOf(i), cov = coveredOf(i), a = asgOf(i), pend = evsOf(i).filter(isPend).length;
          return `<div class="ac-drow ${s}${i.not_applicable ? ' na' : ''}">
            <button type="button" class="ac-drow-t" data-open="${i.id}"><span class="code">${esc(i.code)}</span><span class="txt">${esc(i.text)}</span>
              <span class="ac-drow-m"><span class="ac-st ${ST[s].c}">${ST[s].t}</span>${req.length && !i.not_applicable ? `<span class="ac-reqbar">${req.map((_, k) => `<i class="${cov.has(k) ? 'on' : ''}"></i>`).join('')}<small>${cov.size}/${req.length}</small></span>` : ''}${pend ? `<em class="pend">${pend} بانتظار الاعتماد</em>` : ''}</span></button>
            <div class="ac-drow-a"><span class="lbl">المسؤولون</span>${i.not_applicable ? '<span class="ac-dim">لا ينطبق</span>' : `${a.map((x, k) => `<span class="ac-rp sm${x.k === 'g' ? ' g' : ''}"><b>${esc(asgLabel(x))}</b><button type="button" class="x" data-drm="${i.id}" data-k="${k}" aria-label="إزالة">✕</button></span>`).join('') || '<span class="ac-dim warn">لم يُسند بعد</span>'}${picker(i)}`}</div>
          </div>`;
        }).join('')}</div>`).join('')}
      </section>`;
    }).join('')}
  </div>`;
  pane.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openDrawer(b.dataset.open));
  pane.querySelectorAll('[data-qopen]').forEach(b => b.onclick = () => openDrawer(b.dataset.qopen));
  pane.querySelectorAll('[data-dadd]').forEach(sel => sel.onchange = async () => { if (!sel.value) return; const i = D.inds.find(x => x.id === sel.dataset.dadd); const [k, id] = sel.value.split(':'); if (await setAssignees(i, [...asgOf(i), { k, id, r: 1 }])) { toast('أُسند المؤشر ✓'); renderDomain(); } });
  pane.querySelectorAll('[data-drm]').forEach(b => b.onclick = async () => { const i = D.inds.find(x => x.id === b.dataset.drm); const a = asgOf(i).slice(); a.splice(+b.dataset.k, 1); if (await setAssignees(i, a)) renderDomain(); });
}
async function setAssignees(i, next) {
  const { data, error } = await sb.rpc('acc_set_assignees', { p_ind: i.id, p_assignees: next });
  if (error) { toast('تعذر الحفظ: ' + error.message, true); return false; }
  i.assignees = Array.isArray(data) ? data : next; i.owner_ids = []; return true;
}


/* ---------- تبويب المؤشرات ---------- */
function renderListTab() {
  const pane = $('ac-pane');
  pane.innerHTML = `<div class="ac-tools">
      <div class="ac-search">${IC.search}<input type="search" id="ac-q" placeholder="ابحث برقم المؤشر أو نصه أو اسم المسؤول..." value="${esc(V.q)}"></div>
      ${mgr() ? `<button type="button" class="ac-assign-btn" id="ac-assign">${IC.team}توزيع المسؤوليات</button>` : ''}
      <label class="ac-switch"><input type="checkbox" id="ac-mine"${V.mine ? ' checked' : ''}><span></span>مؤشراتي فقط</label>
      ${V.filter !== 'all' || V.domain || V.member ? `<button type="button" class="ac-clear" id="ac-clear">${V.member ? esc(short(nameOf(V.member))) + ' · ' : ''}مسح التصفية ✕</button>` : ''}
    </div>
    <div id="ac-list"></div>`;
  $('ac-mine').onchange = e => { V.mine = e.target.checked; renderList(); };
  $('ac-q').oninput = e => { V.q = e.target.value; renderList(); };
  const cl = $('ac-clear'); if (cl) cl.onclick = () => { V.filter = 'all'; V.domain = 0; V.member = null; render(); };
  const asg = $('ac-assign'); if (asg) asg.onclick = openAssign;
  renderList();
}

function renderList() {
  const el = $('ac-list'); if (!el) return;
  const q = V.q.trim();
  const list = D.inds.filter(i => (!V.domain || i.domain_no === V.domain)
    && (V.filter === 'all' || (V.filter === 'noowner' ? !i.not_applicable && !effOwners(i).length : statusOf(i) === V.filter))
    && (!V.mine || isMine(i))
    && (!V.member || effOwners(i).includes(V.member))
    && (!q || i.text.includes(q) || i.code.includes(q) || i.standard.includes(q) || asgOf(i).some(a => asgLabel(a).includes(q))));
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
  const s = statusOf(i), req = reqOf(i), cov = coveredOf(i), a = asgOf(i);
  return `<button type="button" class="ac-card ${s}${V.open === i.id ? ' on' : ''}${isMine(i) ? ' mine' : ''}" data-id="${i.id}">
    <span class="top"><span class="code">${esc(i.code)}</span>${i.star ? '<i class="star" title="مؤشر أساسي (*) خاص بالمدارس الأهلية والعالمية">★</i>' : ''}<span class="ac-st ${ST[s].c}">${ST[s].t}</span></span>
    <span class="txt">${esc(i.text)}</span>
    ${req.length && !i.not_applicable ? `<span class="ac-reqbar" title="الشواهد المطلوبة المعتمدة">${req.map((_, k) => `<i class="${cov.has(k) ? 'on' : ''}"></i>`).join('')}<small>${cov.size}/${req.length}</small></span>` : ''}
    <span class="bot">
      <span class="ac-asg-mini">${a.length ? a.slice(0, 3).map(x => `<em class="${x.k === 'g' ? 'g' : ''}" title="${esc(asgLabel(x))}">${esc(asgLabel(x))}</em>`).join('') + (a.length > 3 ? `<em class="more">+${a.length - 3}</em>` : '') : (i.not_applicable ? '' : '<em class="none">بلا مسؤول</em>')}</span>
      ${(() => { const p = evsOf(i).filter(isPend).length; return p ? `<span class="ac-prog-mini p-in_progress">${p} بانتظار الاعتماد</span>` : ''; })()}
    </span>
  </button>`;
}

/* ---------- صفحتي: مؤشراتي بدرجاتها + الشواهد التي تنتظر إجرائي ---------- */
function renderMe() {
  const pane = $('ac-pane');
  const mine = D.inds.filter(i => isMine(i) && !i.not_applicable);
  const direct = mine.filter(i => asgUsers(i).includes(currentUserId)), viaLead = mine.filter(i => !asgUsers(i).includes(currentUserId));
  const queue = D.evs.filter(canAct).sort((a, b) => (EVST[b.status].n - EVST[a.status].n) || String(a.created_at).localeCompare(b.created_at));
  const myEvs = D.evs.filter(e => e.uploaded_by === currentUserId);
  const ret = myEvs.filter(e => e.status === 'returned');
  const pct = mine.length ? Math.round(mine.reduce((s, i) => s + coverage(i), 0) / mine.length * 100) : 0;
  const roles = [];
  if (roleIds('principal').includes(currentUserId)) roles.push('مدير المدرسة (الاعتماد النهائي)');
  [1, 2, 3, 4].forEach(d => { if (leadOf('domain', d).includes(currentUserId)) roles.push('قائد مجال ' + DOMAINS[d]); });
  pane.innerHTML = `<div class="ac-me">
    <section class="ac-me-hero">
      <div class="ac-me-av">${initial(currentUserId)}</div>
      <div class="ac-me-t"><span>صفحة المسؤول</span><b>${esc(nameOf(currentUserId))}</b>
        <div class="ac-me-chips"><em>${direct.length} ${direct.length === 1 ? 'مؤشر مسند إليّ' : 'مؤشرات مسندة إليّ'}</em>${roles.map(r => `<em class="role">${esc(r)}</em>`).join('')}</div></div>
      <div class="ac-me-ring" style="--p:${pct}"><b>${pct}%</b><small>شواهدي المطلوبة</small></div>
    </section>
    ${queue.length && viewOf() !== 'lead' ? `<section class="ac-queue" id="ac-queue"><header><b>بانتظار إجرائك</b><span>${queue.length} ${queue.length === 1 ? 'شاهد ينتظر' : 'شواهد تنتظر'} اعتمادك</span></header>${queue.map(e => queueRow(e)).join('')}</section>` : ''}
    ${ret.length ? `<section class="ac-queue ret"><header><b>شواهد أُعيدت إليك</b><span>عدّلها ثم أعد إرسالها</span></header>${ret.map(e => queueRow(e)).join('')}</section>` : ''}
    ${direct.length ? `<section class="ac-me-sec"><h4><i class="r1"></i>المؤشرات المسندة إليّ<small>${direct.length}</small></h4><div class="ac-cards">${direct.map(cardHtml).join('')}</div></section>` : ''}
    ${viaLead.length && viewOf() === 'admin' ? `<section class="ac-me-sec"><h4><i></i>ضمن مسؤولية المجال أو المعيار<small>${viaLead.length}</small></h4><div class="ac-cards">${viaLead.map(cardHtml).join('')}</div></section>` : ''}
    ${direct.length || (viaLead.length && viewOf() === 'admin') ? ''
      : `<div class="ac-empty">${viewOf() === 'lead' ? 'لم تُسند إليك مؤشرات بعينها؛ مؤشرات مجالك في تبويب «مؤشرات المجال».' : 'لا توجد مؤشرات مسندة إليك بعد. يسندها قائد المجال.'}</div>`}
  </div>`;
  pane.querySelectorAll('.ac-card').forEach(c => c.onclick = () => openDrawer(c.dataset.id));
  pane.querySelectorAll('[data-qopen]').forEach(b => b.onclick = () => { V.dtab = 'req'; openDrawer(b.dataset.qopen); });
}
function queueRow(e) {
  const i = D.inds.find(x => x.id === e.indicator_id) || {};
  const req = reqOf(i)[e.req_idx];
  return `<button type="button" class="ac-qrow" data-qopen="${i.id}" style="--c:${DCOL[i.domain_no] || '#2455A4'}">
    <span class="code">${esc(i.code || '')}</span>
    <span class="t"><b>${esc(e.title)}</b><small>${req ? 'البند: ' + esc(req) : esc(i.text || '')}</small></span>
    ${chainDots(e)}<span class="ac-st ${EVST[e.status].c}">${EVST[e.status].t}</span></button>`;
}
function chainDots(e) {
  const n = EVST[e.status] ? EVST[e.status].n : -1;
  const lit = n >= 3 ? 3 : n + 1;
  return `<span class="ac-chaind${n < 0 ? ' ret' : ''}" title="رفع ← اعتماد قائد المجال ← اعتماد المدير">${['رفع', 'قائد المجال', 'المدير'].map((t, k) => `<i class="${n >= 0 && lit > k ? 'on' : ''}" title="${t}"></i>`).join('')}</span>`;
}

/* ---------- الأدوار والفرق ---------- */
function renderTeam() {
  const pane = $('ac-pane'), M = mgr();
  const picker = (ids, attr) => `${ids.map(o => `<button type="button" class="ac-chip"${M ? ` data-rmrole="${attr}" data-id="${o}"` : ''}>${esc(short(nameOf(o)))}${M ? '<i>✕</i>' : ''}</button>`).join('') || '<span class="ac-dim">لم يُحدَّد بعد</span>'}
    ${M ? `<select class="ac-pick" data-addrole="${attr}"><option value="">＋ إضافة</option>${D.staff.filter(p => !ids.includes(p.id)).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select>` : ''}`;
  const ids = [...new Set(D.inds.flatMap(effOwners))];
  const rows = ids.map(id => {
    const mine = D.inds.filter(i => effOwners(i).includes(id) && !i.not_applicable);
    const p = mine.length ? mine.reduce((s, i) => s + coverage(i), 0) / mine.length : 0;
    return { id, n: mine.length, p };
  }).sort((a, b) => b.n - a.n);
  pane.innerHTML = `<div class="ac-teamtab">
    <section class="ac-chain">
      <header><b>سلسلة الاعتماد</b><span>يمر كل شاهد بقائد المجال ثم المدير، حتى لا تتراكم شواهد غير مرتبطة فعليًا بالمؤشر.</span></header>
      <ol>${[['قائد المجال يسند', 'يحدد المسؤولين عن كل مؤشر في مجاله'], ['المسؤول يرفع', 'يرفع الشاهد ويربطه ببنده'], ['قائد المجال', 'يراجع الشاهد ويعتمده أو يعيده'], ['مدير المدرسة', 'الاعتماد النهائي']].map(([t, s], k) => `<li style="animation-delay:${(k * 0.07).toFixed(2)}s"><span>${k + 1}</span><b>${t}</b><small>${s}</small></li>`).join('')}</ol>
    </section>
    <section class="ac-roles">
      <div class="ac-role wide"><span class="ic">${IC.star}</span><div><b>مدير المدرسة (قائد فريق التقويم)</b><small>الاعتماد النهائي للشواهد بعد اعتماد قائد المجال، وله وحده إعادة الشاهد المعتمد نهائيًا</small><div class="ac-asg-c">${picker(roleIds('principal'), 'principal')}</div></div></div>
      ${[1, 2, 3, 4].map(d => `<div class="ac-role dom" style="--c:${DCOL[d]}"><span class="ic n">${d}</span><div><b>${DOMAINS[d]}</b>
        <small>قائد المجال: يراجع شواهد المجال ويعتمدها قبل المدير</small><div class="ac-asg-c">${M ? `${leadOf('domain', d).map(o => `<button type="button" class="ac-chip" data-rmlead="${d}" data-id="${o}">${esc(short(nameOf(o)))}<i>✕</i></button>`).join('')}<select class="ac-pick" data-addlead="${d}"><option value="">＋ إضافة</option>${D.staff.filter(p => !leadOf('domain', d).includes(p.id)).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select>` : (leadOf('domain', d).map(o => `<span class="ac-chip">${esc(short(nameOf(o)))}</span>`).join('') || '<span class="ac-dim">لم يُحدَّد</span>')}</div>
        </div></div>`).join('')}
    </section>
    <section class="ac-groups">
      <header><b>الفرق والمجموعات</b><span>يُسند المؤشر إلى فريق كامل، وكل عضو فيه يرى المؤشر ويرفع شواهده.</span>${M ? '<button type="button" class="ac-mini ok" id="ac-newg">＋ فريق جديد</button>' : ''}</header>
      <div class="ac-gcards">${D.groups.map(g => {
        const used = D.inds.filter(i => asgOf(i).some(a => a.k === 'g' && a.id === g.id)).length;
        const mem = g.everyone ? [] : (g.member_ids || []);
        return `<div class="ac-gcard" data-g="${g.id}"><div class="h"><b>${esc(g.name)}</b><small>${used} ${used === 1 ? 'مؤشر' : 'مؤشرات'}</small>${M ? '<button type="button" class="ac-dx sm" data-gdel title="حذف الفريق">✕</button>' : ''}</div>
          ${g.everyone ? '<div class="ac-gall">جميع معلمي المدرسة</div>' : `<div class="ac-asg-c">${mem.map(o => `<button type="button" class="ac-chip"${M ? ` data-gm="${o}"` : ''}>${esc(short(nameOf(o)))}${M ? '<i>✕</i>' : ''}</button>`).join('') || '<span class="ac-dim warn">لا أعضاء بعد، أضفهم ليروا المؤشرات</span>'}
            ${M ? `<select class="ac-pick" data-gadd><option value="">＋ عضو</option>${D.staff.filter(p => !mem.includes(p.id)).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select>` : ''}</div>`}
          ${M ? `<label class="ac-gev"><input type="checkbox" data-gevery${g.everyone ? ' checked' : ''}> يشمل جميع المعلمين</label>` : ''}</div>`;
      }).join('') || '<div class="ac-dim">لا توجد فرق.</div>'}</div>
    </section>
    <section class="ac-team"><header><b>إنجاز المسؤولين</b><span>نسبة الشواهد المطلوبة المعتمدة في مؤشرات كل مسؤول، اضغط الاسم لعرض مؤشراته</span></header><div class="ac-team-row">${rows.map((r, k) => {
      const C = 2 * Math.PI * 21;
      return `<button type="button" class="ac-mem${r.id === currentUserId ? ' me' : ''}" data-mem="${r.id}" style="animation-delay:${(k * 0.04).toFixed(2)}s">
        <span class="ring"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="21" class="bg"/><circle cx="25" cy="25" r="21" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - r.p)}"/></svg><i>${initial(r.id)}</i></span>
        <b>${esc(short(nameOf(r.id)))}</b><small>${r.n} ${r.n === 1 ? 'مؤشر' : 'مؤشرات'}</small></button>`;
    }).join('')}</div></section>
  </div>`;
  pane.querySelectorAll('[data-mem]').forEach(b => b.onclick = () => { V.member = b.dataset.mem; V.tab = 'list'; V.mine = false; render(); });
  if (!M) return;
  const setRole = async (attr, fn) => {
    const roles = JSON.parse(JSON.stringify(D.roles || {}));
    roles[attr] = fn(roles[attr] || []);
    if (await saveSettings({ roles })) { D.roles = roles; toast('حُفظ ✓'); renderTeam(); }
  };
  pane.querySelectorAll('[data-addrole]').forEach(s => s.onchange = () => { if (s.value) setRole(s.dataset.addrole, a => [...a, s.value]); });
  pane.querySelectorAll('[data-rmrole]').forEach(b => b.onclick = () => setRole(b.dataset.rmrole, a => a.filter(x => x !== b.dataset.id)));
  const setLead = async (d, fn) => {
    const cur = D.leads.find(l => l.scope === 'domain' && l.scope_key === String(d));
    const next = fn(cur ? cur.owner_ids : []);
    const { data, error } = await writeWithSchool(extra => sb.from('acc_leads').upsert({ scope: 'domain', scope_key: String(d), owner_ids: next, updated_at: new Date().toISOString(), ...extra }, { onConflict: 'school_id,scope,scope_key' }).select('*').single());
    if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
    D.leads = [...D.leads.filter(l => !(l.scope === 'domain' && l.scope_key === String(d))), data]; toast('حُفظ ✓'); renderTeam();
  };
  pane.querySelectorAll('[data-addlead]').forEach(s => s.onchange = () => { if (s.value) setLead(s.dataset.addlead, a => [...a, s.value]); });
  pane.querySelectorAll('[data-rmlead]').forEach(b => b.onclick = () => setLead(b.dataset.rmlead, a => a.filter(x => x !== b.dataset.id)));
  const saveG = async (g, patch) => {
    const { error } = await sb.from('acc_groups').update(patch).eq('id', g.id);
    if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
    Object.assign(g, patch); toast('حُفظ ✓'); renderTeam();
  };
  pane.querySelectorAll('.ac-gcard').forEach(card => {
    const g = groupById(card.dataset.g);
    const add = card.querySelector('[data-gadd]'); if (add) add.onchange = () => { if (add.value) saveG(g, { member_ids: [...(g.member_ids || []), add.value] }); };
    card.querySelectorAll('[data-gm]').forEach(b => b.onclick = () => saveG(g, { member_ids: (g.member_ids || []).filter(x => x !== b.dataset.gm) }));
    const ev = card.querySelector('[data-gevery]'); if (ev) ev.onchange = () => saveG(g, { everyone: ev.checked });
    const del = card.querySelector('[data-gdel]'); if (del) del.onclick = async () => {
      const used = D.inds.filter(i => asgOf(i).some(a => a.k === 'g' && a.id === g.id));
      if (!confirm(`حذف فريق «${g.name}»؟${used.length ? `\nسيُزال من ${used.length} مؤشرات مسند إليها.` : ''}`)) return;
      for (const i of used) { const next = (i.assignees || []).filter(a => !(a.k === 'g' && a.id === g.id)); await sb.from('acc_indicators').update({ assignees: next }).eq('id', i.id); i.assignees = next; }
      const { error } = await sb.from('acc_groups').delete().eq('id', g.id);
      if (error) { toast('تعذر الحذف: ' + error.message, true); return; }
      D.groups = D.groups.filter(x => x.id !== g.id); toast('حُذف الفريق'); renderTeam();
    };
  });
  const ng = $('ac-newg'); if (ng) ng.onclick = async () => {
    const n = (prompt('اسم الفريق (مثل: معلمو الاجتماعيات، لجنة الاختبارات):') || '').trim(); if (!n) return;
    const { data, error } = await writeWithSchool(extra => sb.from('acc_groups').insert({ name: n, sort: D.groups.length, ...extra }).select('*').single());
    if (error) { toast(/duplicate|unique/i.test(error.message) ? 'يوجد فريق بهذا الاسم' : 'تعذر الحفظ: ' + error.message, true); return; }
    D.groups.push(data); renderTeam();
  };
}

/* ---------- الخطة الزمنية: المراحل الثماني ---------- */
const PHST = { todo: 'لم تبدأ', doing: 'جارية', done: 'منجزة' };
function renderPlan() {
  const pane = $('ac-pane'), M = mgr(), ph = D.phases;
  const dn = ph.filter(p => p.st === 'done').length;
  const dates = ph.flatMap(p => [p.from, p.to]).filter(Boolean).sort();
  const total = dates.length >= 2 ? Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 864e5) + 1 : null;
  const today = new Date().toISOString().slice(0, 10);
  pane.innerHTML = `<div class="ac-plan">
    <section class="ac-plan-h">
      <div><span>من</span><b>${dates.length ? esc(shortDate(dates[0])) : '—'}</b></div>
      <div><span>إلى</span><b>${dates.length ? esc(shortDate(dates[dates.length - 1])) : '—'}</b></div>
      <div><span>المدة الإجمالية</span><b>${total ? total + ' يومًا' : '—'}</b></div>
      <div class="pr"><span>المراحل المنجزة</span><b>${dn} من ${ph.length}</b><i style="--p:${ph.length ? dn / ph.length * 100 : 0}%"></i></div>
    </section>
    ${!dates.length && M ? '<div class="ac-note">التواريخ لم تُعتمد بعد؛ تُكتب بعد الاتفاق عليها في اجتماع فريق التقويم.</div>' : ''}
    <ol class="ac-phases">${ph.map((p, k) => {
      const late = p.st !== 'done' && p.to && p.to < today, now = p.from && p.to && p.from <= today && today <= p.to;
      return `<li class="ac-ph ${p.st || 'todo'}${late ? ' late' : ''}${now ? ' now' : ''}" data-k="${k}" style="animation-delay:${(k * 0.05).toFixed(2)}s">
        <span class="n">${p.st === 'done' ? IC.check : k + 1}</span>
        <div class="b">
          <div class="t">${M ? `<input class="ac-in t" data-f="t" value="${esc(p.t)}">` : `<b>${esc(p.t)}</b>`}${late ? '<em class="late">متأخرة</em>' : now ? '<em class="now">الآن</em>' : ''}</div>
          <div class="m"><span><i>المسؤول</i>${M ? `<input class="ac-in" data-f="owner" value="${esc(p.owner || '')}">` : esc(p.owner || '—')}</span><span><i>المخرج المطلوب</i>${M ? `<input class="ac-in" data-f="out" value="${esc(p.out || '')}">` : esc(p.out || '—')}</span></div>
          <div class="d">${M ? `<label>من <input type="date" data-f="from" value="${p.from || ''}"></label><label>إلى <input type="date" data-f="to" value="${p.to || ''}"></label>` : `<span>${p.from ? esc(shortDate(p.from)) : '…'} ← ${p.to ? esc(shortDate(p.to)) : '…'}</span>`}
            ${p.from && p.to ? `<small>${Math.round((new Date(p.to) - new Date(p.from)) / 864e5) + 1} يومًا</small>` : ''}
            <div class="ac-phst">${Object.entries(PHST).map(([v, t]) => M ? `<button type="button" data-st="${v}" class="${(p.st || 'todo') === v ? 'on ' + v : ''}">${t}</button>` : ((p.st || 'todo') === v ? `<span class="on ${v}">${t}</span>` : '')).join('')}</div>
            ${M ? '<button type="button" class="ac-dx sm" data-phdel title="حذف المرحلة">✕</button>' : ''}</div>
        </div></li>`;
    }).join('')}</ol>
    ${M ? '<button type="button" class="ac-mini" id="ac-phadd">＋ إضافة مرحلة</button>' : ''}
  </div>`;
  if (!M) return;
  const save = async () => { if (await saveSettings({ phases: D.phases })) { toast('حُفظت الخطة ✓'); renderPlan(); } };
  pane.querySelectorAll('.ac-ph').forEach(li => {
    const p = D.phases[+li.dataset.k];
    li.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => { p[inp.dataset.f] = inp.value || null; save(); });
    li.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { p.st = b.dataset.st; save(); });
    li.querySelector('[data-phdel]').onclick = () => { if (confirm(`حذف مرحلة «${p.t}»؟`)) { D.phases.splice(+li.dataset.k, 1); save(); } };
  });
  $('ac-phadd').onclick = () => { D.phases.push({ t: 'مرحلة جديدة', owner: '', out: '', st: 'todo' }); save(); };
}

/* ---------- درج المؤشر ---------- */
function openDrawer(id) {
  if (id !== V.open) V.gedit = false;
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
  const req = reqOf(i), cov = coveredOf(i);
  dr.innerHTML = `<div class="ac-dh">
      <button type="button" class="ac-dx" aria-label="إغلاق">✕</button>
      <span class="crumb">${DOMAINS[i.domain_no]} · ${esc(i.standard)}</span>
      <div class="ac-dh-t"><span class="code">${esc(i.code)}</span><span class="ac-st ${ST[s].c}">${ST[s].t}</span>${req.length ? `<span class="ac-dcov">${cov.size}/${req.length} شواهد مطلوبة معتمدة</span>` : ''}</div>
      <h4>${esc(i.text)}${i.star ? ' <i class="star">★</i>' : ''}</h4>
    </div>
    ${respHtml(i)}
    <div class="ac-det">${V.gedit ? guideHtml(i) : `<details class="ac-gd"${V.gopen ? ' open' : ''}><summary>${IC.book}<span><b>شرح المؤشر والنصيحة العملية</b><small>ماذا يعني المؤشر؟ وبماذا أبدأ؟ وما الشاهد الأقوى؟</small></span></summary>${guideHtml(i)}</details>${reqHtml(i)}`}</div>`;
  dr.querySelector('.ac-dx').onclick = () => openDrawer(null);
  const gd = dr.querySelector('.ac-gd'); if (gd) gd.ontoggle = () => { V.gopen = gd.open; };
  wireResp(dr, i);
  wireDetail(dr, i);
}
// إعادة الرسم مع إبقاء الدرج مفتوحًا
function refresh() { render(); }

function respHtml(i) {
  const a = asgOf(i), M = canAssign(i);
  const lead = domainOwners(i), std = stdOwners(i), pr = roleIds('principal');
  return `<div class="ac-resp">
    <div class="ac-resp-row">${a.map((x, k) => `<span class="ac-rp r${x.r}${x.k === 'g' ? ' g' : ''}${x.k === 'u' && x.id === currentUserId ? ' me' : ''}">
        <span><b>${esc(asgLabel(x))}</b>${x.k === 'g' ? `<small>${(() => { const g = groupById(x.id); return g ? (g.everyone ? 'جميع المعلمين' : `${(g.member_ids || []).length} أعضاء`) : ''; })()}</small>` : ''}</span>
        ${M ? `<button type="button" class="x" data-rmasg="${k}" aria-label="إزالة">✕</button>` : ''}</span>`).join('') || '<span class="ac-dim warn">لم يُسند المؤشر لأحد بعد</span>'}
      ${M ? `<select class="ac-pick" data-addasg><option value="">＋ إسناد</option><optgroup label="الأشخاص">${D.staff.filter(p => !a.some(x => x.k === 'u' && x.id === p.id)).map(p => `<option value="u:${p.id}">${esc(p.full_name)}</option>`).join('')}</optgroup><optgroup label="الفرق">${D.groups.filter(g => !a.some(x => x.k === 'g' && x.id === g.id)).map(g => `<option value="g:${g.id}">${esc(g.name)}</option>`).join('')}</optgroup></select>` : ''}
    </div>
    ${lead.length || std.length || pr.length ? `<div class="ac-inh">${[['قائد المجال', lead], ['مسؤول المعيار', std], ['الاعتماد النهائي', pr]].filter(x => x[1].length).map(([t, ids]) => `<span><i>${t}</i>${ids.map(o => `<b${o === currentUserId ? ' class="me"' : ''}>${esc(short(nameOf(o)))}</b>`).join('')}</span>`).join('')}</div>` : ''}
    ${mgr() ? `<label class="ac-na"><input type="checkbox" data-na${i.not_applicable ? ' checked' : ''}> لا ينطبق على المدرسة${i.star ? ' (مؤشرات (*) خاصة بالمدارس الأهلية والعالمية)' : ''}</label>` : ''}
  </div>`;
}
function wireResp(box, i) {
  const save = async next => { if (await setAssignees(i, next)) refresh(); };
  const cur = () => asgOf(i).map(x => ({ ...x }));
  box.querySelectorAll('[data-rmasg]').forEach(b => b.onclick = () => { const a = cur(); a.splice(+b.dataset.rmasg, 1); save(a); });
  const add = box.querySelector('[data-addasg]');
  if (add) add.onchange = () => { if (!add.value) return; const [k, id] = add.value.split(':'); const a = cur(); a.push({ k, id, r: 1 }); save(a); toast('أُسند المؤشر ✓'); };
  const na = box.querySelector('[data-na]');
  if (na) na.onchange = async () => { const { error } = await sb.from('acc_indicators').update({ not_applicable: na.checked }).eq('id', i.id); if (error) { toast('تعذر الحفظ: ' + error.message, true); return; } i.not_applicable = na.checked; refresh(); };
}

function ladderHtml(i) {
  const ev = evsOf(i);
  return `<div class="ac-ladder" title="يُفضَّل أن يكون الشاهد متدرجًا">${Object.entries(STAGES).map(([k, [t, s]], n) => {
    const ap = ev.some(e => e.stage === k && e.status === 'approved'), any = ev.some(e => e.stage === k && e.status !== 'returned');
    return `<span class="${ap ? 'on' : any ? 'half' : ''}"><i>${ap ? IC.check : n + 1}</i><b>${t}</b><small>${s}</small></span>`;
  }).join('')}</div>`;
}

function reqHtml(i) {
  const req = reqOf(i), ev = evsOf(i), up = canUpload(i) && !i.not_applicable;
  const other = ev.filter(e => e.req_idx == null || e.req_idx >= req.length);
  return `<div class="ac-sub">الشواهد المطلوبة</div>
    <div class="ac-req">${req.map((t, k) => {
      const my = ev.filter(e => e.req_idx === k), ok = my.some(e => e.status === 'approved'), pend = my.some(isPend), ret = my.length && my.every(e => e.status === 'returned');
      return `<div class="ac-ri${ok ? ' ok' : pend ? ' pend' : ret ? ' ret' : ''}">
        <div class="h"><span class="ck">${ok ? IC.check : k + 1}</span><b>${esc(t)}</b>${up ? `<button type="button" class="ac-mini" data-upfor="${k}">${IC.up}رفع</button>` : ''}</div>
        ${my.length ? `<div class="ac-evs">${my.map(evHtml).join('')}</div>` : ''}
      </div>`;
    }).join('') || '<div class="ac-none">لا توجد قائمة شواهد مطلوبة لهذا المؤشر.</div>'}</div>
    ${other.length ? `<div class="ac-sub">شواهد أخرى غير مرتبطة ببند</div><div class="ac-evs">${other.map(evHtml).join('')}</div>` : ''}
    ${up ? uploadForm(i) : ''}`;
}
function allEvHtml(i) {
  const ev = evsOf(i);
  return `<div class="ac-evs">${ev.length ? ev.map(evHtml).join('') : '<div class="ac-none">لم يُرفع شاهد لهذا المؤشر بعد.</div>'}</div>${canUpload(i) && !i.not_applicable ? uploadForm(i) : ''}`;
}
function guideHtml(i) {
  const g = guideOf(i), M = mgr();
  if (V.gedit && M) {
    const f = (k, t, rows = 2) => `<label class="ac-gf"><span>${t}</span><textarea data-g="${k}" rows="${rows}">${esc(g[k] || '')}</textarea></label>`;
    return `<form class="ac-gedit" data-gform>${f('meaning', 'ماذا يعني المؤشر؟', 4)}
      <label class="ac-gf"><span>الشواهد المطلوبة (بند في كل سطر)</span><textarea data-req rows="7">${esc(reqOf(i).join('\n'))}</textarea><small>تغيير ترتيب البنود يغيّر ربط الشواهد المرفوعة بها؛ أضف البنود الجديدة في آخر القائمة.</small></label>
      ${f('start', 'ابدأ بـ')}${f('quality', 'لرفع الجودة')}${f('avoid', 'تجنّب')}${f('best', 'الشاهد الأقوى')}
      <div class="ac-add-f"><button type="button" class="ac-mini" data-gcancel>إلغاء</button>${ACC_GUIDE[i.code] ? '<button type="button" class="ac-mini warn" data-greset>استعادة الدليل الأصلي</button>' : ''}<button type="submit" class="ac-btn">حفظ</button></div></form>`;
  }
  return `<div class="ac-guide">
    ${g.meaning ? `<section><h5>${IC.book}ماذا يعني المؤشر؟</h5><p>${esc(g.meaning)}</p></section>` : '<div class="ac-none">لا يوجد شرح لهذا المؤشر.</div>'}
    ${g.start || g.quality || g.avoid ? `<section class="tip"><h5>نصيحة عملية</h5><ul>${g.start ? `<li><b>ابدأ بـ:</b> ${esc(g.start)}</li>` : ''}${g.quality ? `<li><b>لرفع الجودة:</b> ${esc(g.quality)}</li>` : ''}${g.avoid ? `<li class="avoid"><b>تجنّب:</b> ${esc(g.avoid)}</li>` : ''}</ul></section>` : ''}
    ${g.best ? `<section class="best">${IC.star}<div><small>الشاهد الأقوى</small><b>${esc(g.best)}</b></div></section>` : ''}
    ${g.note ? `<section class="warn">⚠ ${esc(g.note)}</section>` : ''}
    <section class="rule"><b>قاعدة الشواهد:</b> ليس المطلوب أكبر عدد من الملفات، بل شاهد قوي، حديث، واضح، مرتبط بالمؤشر، ويثبت التطبيق والنتيجة.</section>
    ${M ? '<button type="button" class="ac-mini" data-gedit>تعديل الدليل والشواهد المطلوبة</button>' : ''}
  </div>`;
}

function evHtml(e) {
  const isImg = /\.(png|jpe?g|gif|webp|heic)$/i.test(e.file_name || '');
  const st = EVST[e.status] || EVST.submitted;
  const mine = e.uploaded_by === currentUserId;
  const i = D.inds.find(x => x.id === e.indicator_id) || {};
  const lv = myLevel(i.domain_no), n = st.n;
  const d = new Date(e.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
  const hist = Array.isArray(e.history) ? e.history : [];
  return `<div class="ac-ev" data-ev="${e.id}">
    <span class="ic">${e.kind === 'link' ? IC.link : isImg ? IC.img : IC.file}</span>
    <div class="ac-ev-t"><b>${esc(e.title)}</b>${e.description ? `<small>${esc(e.description)}</small>` : ''}
      <span>${esc(short(nameOf(e.uploaded_by)))} · ${d}${e.stage ? ` · <em class="stg">${STAGES[e.stage][0]}</em>` : ''}</span>
      ${e.status === 'returned' && e.review_note ? `<span class="note">ملاحظة المراجعة: ${esc(e.review_note)}</span>` : ''}
      ${hist.length ? `<span class="hist">${hist.slice(-3).map(h => `${HVERB[h.to] || ''} ${esc(short(nameOf(h.by)))}`).join(' ← ')}</span>` : ''}</div>
    ${chainDots(e)}<span class="ac-st ${st.c}">${st.t}</span>
    <div class="ac-ev-a">
      <button type="button" class="ac-mini" data-open>فتح</button>
      ${lv > n && n >= 0 && n < 3 ? `<button type="button" class="ac-mini ok" data-adv>${LV_ACT[lv]} ✓</button>` : ''}
      ${lv > 0 && n >= 0 && (n < 3 ? lv > n : lv === 3) ? '<button type="button" class="ac-mini warn" data-ret>إعادة</button>' : ''}
      ${mine && e.status === 'returned' ? '<button type="button" class="ac-mini ok" data-resub>إعادة الإرسال</button>' : ''}
      ${mgr() || (mine && e.status !== 'approved') ? '<button type="button" class="ac-mini del" data-del>حذف</button>' : ''}
    </div>
  </div>`;
}

function uploadForm(i) {
  const req = reqOf(i);
  return `<form class="ac-add" data-add-ev id="ac-upform">
    <div class="ac-add-h"><b>${IC.up}رفع شاهد</b></div>
    ${req.length ? `<label class="ac-gf"><span>البند المرتبط من الشواهد المطلوبة</span><select name="req"><option value="">— غير مرتبط ببند —</option>${req.map((t, k) => `<option value="${k}">${k + 1}. ${esc(t.length > 80 ? t.slice(0, 80) + '…' : t)}</option>`).join('')}</select></label>` : ''}
    <div class="ac-seg"><button type="button" data-k="file" class="on">${IC.up}ملف أو صورة</button><button type="button" data-k="link">${IC.link}رابط</button></div>
    <input type="text" name="title" placeholder="عنوان الشاهد (مثل: محضر اجتماع مجلس المدرسة)" maxlength="160">
    <textarea name="desc" rows="2" placeholder="وصف مختصر (اختياري)" maxlength="500"></textarea>
    <label class="ac-drop" data-pane="file"><input type="file" name="files" multiple hidden><span>${IC.up}<b>اختر الملفات أو اسحبها هنا</b><small>PDF أو صور أو ملفات Office، حتى ٢٥ ميجابايت للملف. الصور الكبيرة تُصغَّر تلقائيًا</small></span></label>
    <input type="url" name="url" data-pane="link" class="hidden" placeholder="https://..." dir="ltr">
    <div class="ac-add-f"><span class="ac-err"></span><button type="submit" class="ac-btn">رفع الشاهد</button></div>
  </form>`;
}

function wireDetail(box, ind) {
  box.querySelectorAll('.ac-ev').forEach(row => {
    const e = D.evs.find(x => x.id === row.dataset.ev);
    row.querySelector('[data-open]').onclick = () => openEvidence(e);
    const adv = row.querySelector('[data-adv]'); if (adv) adv.onclick = () => review(e, 'advance');
    const ret = row.querySelector('[data-ret]'); if (ret) ret.onclick = () => { const n = prompt('ملاحظة لصاحب الشاهد (سبب الإعادة):', e.review_note || ''); if (n !== null) review(e, 'return', n.trim()); };
    const rs = row.querySelector('[data-resub]'); if (rs) rs.onclick = async () => {
      const { error } = await sb.from('acc_evidence').update({ status: 'submitted' }).eq('id', e.id);
      if (error) { toast('تعذر الإرسال: ' + error.message, true); return; }
      e.status = 'submitted'; toast('أُعيد إرسال الشاهد للمراجعة ✓'); refresh();
    };
    const del = row.querySelector('[data-del]'); if (del) del.onclick = async () => {
      if (!confirm(`حذف الشاهد «${e.title}»؟`)) return;
      if (e.storage_path) await sb.storage.from(BUCKET).remove([e.storage_path]);
      const { error } = await sb.from('acc_evidence').delete().eq('id', e.id);
      if (error) { toast('تعذر الحذف: ' + error.message, true); return; }
      D.evs = D.evs.filter(x => x.id !== e.id); refresh(); toast('حُذف الشاهد');
    };
  });
  // الدليل
  const ge = box.querySelector('[data-gedit]'); if (ge) ge.onclick = () => { V.gedit = true; drawDrawer(); };
  const gf = box.querySelector('[data-gform]');
  if (gf) {
    gf.querySelector('[data-gcancel]').onclick = () => { V.gedit = false; drawDrawer(); };
    const rs = gf.querySelector('[data-greset]'); if (rs) rs.onclick = async () => {
      if (!confirm('استعادة الشرح والشواهد المطلوبة من الدليل الأصلي؟')) return;
      const { error } = await sb.from('acc_indicators').update({ guide: {}, req_ev: [] }).eq('id', ind.id);
      if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
      ind.guide = {}; ind.req_ev = []; V.gedit = false; refresh(); toast('استُعيد الدليل الأصلي');
    };
    gf.onsubmit = async ev => {
      ev.preventDefault();
      const guide = {}; gf.querySelectorAll('[data-g]').forEach(t => { const v = t.value.trim(); if (v) guide[t.dataset.g] = v; });
      const base = ACC_GUIDE[ind.code] || {}; if (base.note) guide.note = base.note;
      const req_ev = gf.querySelector('[data-req]').value.split('\n').map(s => s.trim()).filter(Boolean);
      const { error } = await sb.from('acc_indicators').update({ guide, req_ev, updated_at: new Date().toISOString() }).eq('id', ind.id);
      if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
      ind.guide = guide; ind.req_ev = req_ev; V.gedit = false; refresh(); toast('حُفظ الدليل ✓');
    };
  }
  const form = box.querySelector('[data-add-ev]');
  box.querySelectorAll('[data-upfor]').forEach(b => b.onclick = () => {
    if (!form) return; const sel = form.querySelector('[name=req]'); if (sel) sel.value = b.dataset.upfor;
    form.classList.add('flash'); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => form.classList.remove('flash'), 1200);
    const t = form.querySelector('[name=title]'); if (t && !t.value) t.value = reqOf(ind)[+b.dataset.upfor].replace(/\.$/, '');
  });
  if (!form) return;
  let kind = 'file', stage = null;
  form.querySelectorAll('[data-stg]').forEach(b => b.onclick = () => { stage = stage === b.dataset.stg ? null : b.dataset.stg; form.querySelectorAll('[data-stg]').forEach(x => x.classList.toggle('on', x.dataset.stg === stage)); });
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
    const reqSel = fld('req'), req_idx = reqSel && reqSel.value !== '' ? +reqSel.value : null;
    const btn = form.querySelector('[type=submit]');
    const base = { indicator_id: ind.id, description: desc || null, uploaded_by: currentUserId, status: 'submitted', req_idx, stage };
    const lv = myLevel(ind.domain_no);
    const after = async row => { // من يملك مستوى مراجعة يمرّر شاهده حتى مستواه مباشرة
      if (lv > 0) { const { data } = await sb.rpc('acc_review', { p_ev: row.id, p_action: 'advance', p_note: null }); if (data) return data; }
      return row;
    };
    if (kind === 'link') {
      const url = fld('url').value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { err.textContent = 'أدخل رابطًا صحيحًا يبدأ بـ https://'; return; }
      if (!title) { err.textContent = 'اكتب عنوان الشاهد'; return; }
      btn.disabled = true;
      const { data, error } = await writeWithSchool(extra => sb.from('acc_evidence').insert({ ...base, title, kind: 'link', url, ...extra }).select('*').single());
      btn.disabled = false;
      if (error) { err.textContent = 'تعذر الحفظ: ' + error.message; return; }
      D.evs.push(await after(data)); refresh(); toast('أُضيف الشاهد ✓'); return;
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
      D.evs.push(await after(data)); okN++;
    }
    btn.disabled = false; btn.textContent = 'رفع الشاهد';
    if (okN) { refresh(); toast(okN === 1 ? 'رُفع الشاهد ✓' : `رُفع ${okN} شواهد ✓`); }
  };
}

async function review(e, action, note = null) {
  const { data, error } = await sb.rpc('acc_review', { p_ev: e.id, p_action: action, p_note: note });
  if (error) { toast(error.message, true); return; }
  Object.assign(e, data || {});
  refresh();
  toast(action === 'return' ? 'أُعيد الشاهد لصاحبه' : e.status === 'approved' ? 'اعتُمد الشاهد نهائيًا ✓' : `انتقل الشاهد: ${EVST[e.status].t} ✓`);
}

async function openEvidence(e) {
  if (e.kind === 'link') { window.open(e.url, '_blank', 'noopener'); return; }
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(e.storage_path, 900);
  if (error || !data) { if (w) w.close(); toast('تعذر فتح الملف', true); return; }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
}

/* ---------- وضع الزيارة: الشواهد المعتمدة مرتبة بالمؤشرات وبنودها ---------- */
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
          ${ev.length ? `<div class="ac-vev">${ev.map(e => `<button type="button" data-ev="${e.id}">${e.kind === 'link' ? IC.link : IC.file}<span>${esc(e.title)}</span>${e.stage ? `<em>${STAGES[e.stage][0]}</em>` : ''}</button>`).join('')}</div>` : '<div class="ac-vnone">لا توجد شواهد معتمدة</div>'}</div>`;
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
    const ev = evsOf(i).filter(e => e.status === 'approved'), req = reqOf(i), cov = coveredOf(i);
    const who = asgOf(i).map(a => esc(asgLabel(a))).join('<br>');
    return `<tr class="${i.not_applicable ? 'na' : ''}"><td class="c">${esc(i.code)}</td><td>${esc(i.text)}</td><td>${i.not_applicable ? 'لا ينطبق' : ev.length ? ev.map((e, k) => `${k + 1}. ${esc(e.title)}${e.req_idx != null && req[e.req_idx] ? ` <small>← بند ${e.req_idx + 1}</small>` : ''}`).join('<br>') : '<span class="miss">لا توجد شواهد معتمدة</span>'}</td><td class="c">${i.not_applicable ? '—' : `${cov.size}/${req.length}`}</td><td>${who}</td></tr>`;
  });
  let html = '', last = null, lastStd = null;
  D.inds.forEach((i, k) => {
    if (i.domain_no !== last) { html += `<tr class="dom"><td colspan="5">المجال ${i.domain_no}: ${DOMAINS[i.domain_no]}</td></tr>`; last = i.domain_no; lastStd = null; }
    if (i.standard !== lastStd) { html += `<tr class="std"><td colspan="5">${esc(i.standard)}</td></tr>`; lastStd = i.standard; }
    html += rows[k];
  });
  const { app, pct, done } = readiness();
  const doc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فهرس شواهد التقويم المدرسي</title><style>
    @page{ size:A4; margin:12mm; } body{ font-family:Tahoma,sans-serif; color:#14233A; font-size:11px; margin:0; }
    .hd{ display:flex; align-items:center; gap:12px; border-bottom:2px solid #0F2447; padding-bottom:8px; margin-bottom:10px; } .hd img{ height:46px; }
    .hd h1{ margin:0; font-size:16px; } .hd p{ margin:2px 0 0; color:#5B6B80; }
    table{ width:100%; border-collapse:collapse; } th,td{ border:1px solid #D5DCE6; padding:5px 6px; vertical-align:top; text-align:right; }
    th{ background:#0F2447; color:#fff; font-size:11px; } td.c{ text-align:center; white-space:nowrap; } small{ color:#5B6B80; }
    tr.dom td{ background:#E9EEF6; font-weight:700; font-size:12.5px; } tr.std td{ background:#F6F8FB; font-weight:700; color:#2455A4; }
    tr.na td{ color:#9AA3AF; } .miss{ color:#B2382F; } tr{ break-inside:avoid; }
    *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  </style></head><body>
  <div class="hd">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div><h1>فهرس شواهد التقويم المدرسي</h1><p>${esc(printOrgName())} · جاهزية الشواهد ${pct}% · المؤشرات المكتملة ${done} من ${app.length}</p></div></div>
  <table><thead><tr><th>الرمز</th><th>المؤشر</th><th>الشواهد المعتمدة</th><th>البنود</th><th>المسؤولون</th></tr></thead><tbody>${html}</tbody></table>
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

/* ---------- توزيع المسؤوليات: المجال، أو المعيار، أو المؤشر بدرجات وفرق ---------- */
function openAssign() {
  let back = $('ac-asg');
  if (!back) { back = document.createElement('div'); back.id = 'ac-asg'; back.className = 'ac-asg-back'; document.body.appendChild(back); }
  document.body.classList.add('ac-lock');
  const close = () => { back.remove(); document.body.classList.remove('ac-lock'); render(); };
  const chips = (ids, scope, key) => `${ids.map(o => `<button type="button" class="ac-chip" data-rm="${o}" data-scope="${scope}" data-key="${esc(key)}">${esc(short(nameOf(o)))}<i>✕</i></button>`).join('')}
    <select class="ac-pick" data-scope="${scope}" data-key="${esc(key)}"><option value="">＋ إضافة</option>${D.staff.filter(p => !ids.includes(p.id)).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select>`;
  const indChips = i => { const a = asgOf(i);
    return `${a.map((x, k) => `<span class="ac-rp sm${x.k === 'g' ? ' g' : ''}"><b>${esc(asgLabel(x))}</b><button type="button" class="x" data-irm="${i.id}" data-k="${k}">✕</button></span>`).join('')}
    <select class="ac-pick" data-iadd="${i.id}"><option value="">＋ إسناد</option><optgroup label="الفرق">${D.groups.filter(g => !a.some(x => x.k === 'g' && x.id === g.id)).map(g => `<option value="g:${g.id}">${esc(g.name)}</option>`).join('')}</optgroup><optgroup label="الأشخاص">${D.staff.filter(p => !a.some(x => x.k === 'u' && x.id === p.id)).map(p => `<option value="u:${p.id}">${esc(p.full_name)}</option>`).join('')}</optgroup></select>`; };
  const draw = () => {
    back.innerHTML = `<div class="ac-asg" role="dialog" aria-modal="true" aria-label="توزيع المسؤوليات">
      <div class="ac-asg-h"><div><b>توزيع المسؤوليات</b><span>حدّد قائد كل مجال، وأسند كل مؤشر لشخص أو أكثر أو لفريق. ويستطيع قائد المجال تعديل إسناد مؤشرات مجاله من صفحته.</span></div><button type="button" class="ac-dx" data-x>✕</button></div>
      <div class="ac-asg-b">${[1, 2, 3, 4].map(d => {
        const ii = D.inds.filter(i => i.domain_no === d);
        const stds = [...new Set(ii.map(i => i.standard))];
        const un = ii.filter(i => !i.not_applicable && !asgOf(i).length).length;
        return `<section class="ac-asg-d" style="--c:${DCOL[d]}">
          <header><span class="n">${d}</span><div><b>${DOMAINS[d]}</b><small>قائد المجال · ${ii.length} مؤشرًا${un ? ` · <em>${un} بلا مسؤول</em>` : ''}</small></div><div class="ac-asg-c">${chips(leadOf('domain', d), 'domain', String(d))}</div></header>
          ${stds.map(st => {
            const key = d + '|' + st, si = ii.filter(i => i.standard === st);
            const direct = si.filter(i => asgOf(i).length).length, open = V.asgOpen === key;
            return `<div class="ac-asg-s${open ? ' open' : ''}">
              <div class="row"><button type="button" class="tg" data-tg="${esc(key)}">${open ? '▾' : '◂'}</button><div class="t"><b>${esc(st)}</b><small>${si.length} مؤشرات · ${direct} مُسندة</small></div><div class="ac-asg-c">${chips(leadOf('standard', key), 'standard', key)}</div></div>
              ${open ? `<div class="ac-asg-i">${si.map(i => `<div class="row${i.not_applicable ? ' na' : ''}"><span class="code">${esc(i.code)}</span><div class="t"><span>${esc(i.text)}</span></div><div class="ac-asg-c">${i.not_applicable ? '<span class="ac-dim">لا ينطبق</span>' : indChips(i)}</div></div>`).join('')}</div>` : ''}
            </div>`;
          }).join('')}
        </section>`;
      }).join('')}</div>
    </div>`;
    back.querySelector('[data-x]').onclick = close;
    back.onclick = e => { if (e.target === back) close(); };
    back.querySelectorAll('[data-tg]').forEach(b => b.onclick = () => { V.asgOpen = V.asgOpen === b.dataset.tg ? null : b.dataset.tg; draw(); });
    back.querySelectorAll('.ac-pick[data-scope]').forEach(sel => sel.onchange = () => { if (sel.value) setOwners(sel.dataset.scope, sel.dataset.key, id => [...id, sel.value]); });
    back.querySelectorAll('.ac-chip[data-scope]').forEach(b => b.onclick = () => setOwners(b.dataset.scope, b.dataset.key, id => id.filter(x => x !== b.dataset.rm)));
    const cur = i => asgOf(i).map(x => ({ ...x }));
    const saveI = async (i, next) => { if (await setAssignees(i, next)) draw(); };
    back.querySelectorAll('[data-irm]').forEach(b => b.onclick = () => { const i = D.inds.find(x => x.id === b.dataset.irm); const a = cur(i); a.splice(+b.dataset.k, 1); saveI(i, a); });
    back.querySelectorAll('[data-iadd]').forEach(sel => sel.onchange = () => { if (!sel.value) return; const i = D.inds.find(x => x.id === sel.dataset.iadd); const [k, id] = sel.value.split(':'); const a = cur(i); a.push({ k, id, r: 1 }); saveI(i, a); });
  };
  const setOwners = async (scope, key, fn) => {
    const cur = D.leads.find(l => l.scope === scope && l.scope_key === key);
    const next = fn(cur ? cur.owner_ids : []);
    const { data, error } = await writeWithSchool(extra => sb.from('acc_leads').upsert({ scope, scope_key: key, owner_ids: next, updated_at: new Date().toISOString(), ...extra }, { onConflict: 'school_id,scope,scope_key' }).select('*').single());
    if (error) { toast('تعذر الحفظ: ' + error.message, true); return; }
    D.leads = [...D.leads.filter(l => !(l.scope === scope && l.scope_key === key)), data];
    toast('حُفظ التوزيع ✓'); draw();
  };
  draw();
}

/* ---------- الطباعة: دليل العمل، بطاقات المسؤولين، فهرس الشواهد ---------- */
function openPrintMenu() {
  let back = $('ac-pm');
  if (!back) { back = document.createElement('div'); back.id = 'ac-pm'; back.className = 'ac-asg-back'; document.body.appendChild(back); }
  document.body.classList.add('ac-lock');
  const close = () => { back.remove(); document.body.classList.remove('ac-lock'); };
  const { users, groups } = cardHolders();
  back.innerHTML = `<div class="ac-pm" role="dialog" aria-modal="true" aria-label="الطباعة">
    <div class="ac-asg-h"><div><b>الطباعة</b><span>اطبع ما يحتاجه الفريق ليعرف النظام ودوره فيه.</span></div><button type="button" class="ac-dx" data-x>✕</button></div>
    <div class="ac-pm-b">
      <button type="button" class="ac-pm-o" data-p="guide"><span class="ic">${IC.book}</span><span><b>دليل العمل والخطة</b><small>الهدف، والأدوار، وسلسلة الاعتماد، وآلية الرفع والاعتماد في مدار، وقاعدة الشواهد، والخطة الزمنية، وملخص التوزيع</small></span></button>
      <div class="ac-pm-o col"><div class="r"><span class="ic">${IC.user}</span><span><b>بطاقات المسؤولين</b><small>صفحة لكل مسؤول وفريق: مؤشراته، والمشاركون معه، والشواهد المطلوبة مع مربعات للتأشير</small></span></div>
        <div class="ac-pm-f"><select data-who><option value="all">الجميع (${users.length} مسؤولًا و${groups.length} فرق)</option><optgroup label="الأشخاص">${users.map(u => `<option value="u:${u}">${esc(nameOf(u))}</option>`).join('')}</optgroup><optgroup label="الفرق">${groups.map(g => `<option value="g:${g.id}">${esc(g.name)}</option>`).join('')}</optgroup></select><button type="button" class="ac-btn" data-p="cards">${IC.print}طباعة</button></div></div>
      <button type="button" class="ac-pm-o" data-p="index"><span class="ic">${IC.list}</span><span><b>فهرس الشواهد</b><small>الشواهد المعتمدة لكل مؤشر وبنوده ومسؤوليه، للزيارة</small></span></button>
    </div></div>`;
  back.querySelector('[data-x]').onclick = close;
  back.onclick = e => { if (e.target === back) close(); };
  back.querySelector('[data-p=guide]').onclick = () => { close(); printGuide(); };
  back.querySelector('[data-p=index]').onclick = () => { close(); printIndex(); };
  back.querySelector('[data-p=cards]').onclick = () => { const v = back.querySelector('[data-who]').value; close(); printCards(v); };
}

function cardHolders() {
  const n = {}, g = new Set();
  D.inds.forEach(i => { if (i.not_applicable) return; asgOf(i).forEach(a => { if (a.k === 'u') n[a.id] = (n[a.id] || 0) + (a.r === 1 ? 100 : 1); else g.add(a.id); }); });
  const users = Object.keys(n).sort((a, b) => n[b] - n[a]);
  return { users, groups: D.groups.filter(x => g.has(x.id)) };
}

const PRINT_CSS = `@page{ size:A4; margin:11mm 11mm 13mm; }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{ font-family:'Tajawal',Tahoma,sans-serif; color:#14233A; font-size:11.5px; margin:0; line-height:1.7; }
  .pg{ page-break-after:always; } .pg:last-child{ page-break-after:auto; }
  .hd{ display:flex; align-items:center; gap:12px; border-bottom:2px solid #0F2447; padding-bottom:7px; margin-bottom:12px; } .hd img{ height:44px; } .hd .t{ flex:1; }
  .hd small{ display:block; color:#5B6B80; font-size:10.5px; } .hd b{ font-size:15px; }
  h1{ margin:0; font-size:22px; } h2{ font-size:14.5px; margin:16px 0 8px; color:#0F2447; display:flex; align-items:center; gap:8px; }
  h2::before{ content:''; width:5px; height:17px; border-radius:3px; background:#2FC1B2; }
  table{ width:100%; border-collapse:collapse; } th,td{ border:1px solid #D5DCE6; padding:5px 7px; text-align:right; vertical-align:top; }
  th{ background:#0F2447; color:#fff; font-size:11px; } td.c, th.c{ text-align:center; } tr{ break-inside:avoid; }
  .muted{ color:#5B6B80; } .box{ border:1px solid #D5DCE6; border-radius:10px; padding:9px 12px; break-inside:avoid; }
  .chk{ display:inline-block; width:12px; height:12px; border:1.6px solid #5B6B80; border-radius:3px; vertical-align:middle; margin-inline-end:6px; position:relative; top:-1px; }
  .chk.on{ background:#2FC1B2; border-color:#2FC1B2; }
  .rk{ display:inline-block; font-size:10px; font-weight:800; border-radius:999px; padding:1px 8px; } .r1{ background:#0F2447; color:#fff; } .r2{ background:#2FC1B2; color:#fff; } .r3{ background:#DCE3EC; color:#0F2447; }`;
function printDoc(title, body, extraCss = '') {
  const doc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap">
    <style>${PRINT_CSS}${extraCss}</style></head><body>${body}
    <script>window.onload=()=>{ (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(()=>setTimeout(()=>window.print(),350)); };<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة'); return; }
  w.document.open(); w.document.write(doc); w.document.close();
}
const prHead = sub => { const logo = printLogo(); return `<div class="hd">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div class="t"><small>${esc(printOrgName())} · جاهزية التقويم الخارجي</small><b>${sub}</b></div></div>`; };

/* دليل العمل والخطة */
function printGuide() {
  const pr = roleIds('principal');
  const app = D.inds.filter(i => !i.not_applicable);
  const today = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  const leads = [1, 2, 3, 4].map(d => ({ d, ids: leadOf('domain', d), n: D.inds.filter(i => i.domain_no === d && !i.not_applicable).length, a: D.inds.filter(i => i.domain_no === d && !i.not_applicable && asgOf(i).length).length }));
  const { users, groups } = cardHolders();
  const urow = id => { const mine = app.filter(i => asgOf(i).some(a => a.k === 'u' && a.id === id)); return `<tr><td>${esc(nameOf(id))}</td><td class="c">${mine.length}</td><td>${mine.map(i => esc(i.code)).join('، ')}</td></tr>`; };
  const grow = g => { const mine = app.filter(i => asgOf(i).some(a => a.k === 'g' && a.id === g.id)); return `<tr><td>${esc(g.name)} <span class="muted">(${g.everyone ? 'جميع المعلمين' : (g.member_ids || []).map(m => short(nameOf(m))).join('، ') || 'لم يُحدَّد الأعضاء'})</span></td><td class="c">${mine.length}</td><td>${mine.map(i => esc(i.code)).join('، ')}</td></tr>`; };
  const steps = (list) => `<ol class="steps">${list.map(([t, s]) => `<li><b>${t}</b><span>${s}</span></li>`).join('')}</ol>`;
  const body = `
  <section class="pg">
    <div class="cover">
      ${printLogo() ? `<img src="${esc(printLogo())}" alt="">` : ''}
      <small>${esc(printOrgName())}</small>
      <h1>دليل العمل لجاهزية التقويم الخارجي</h1>
      <p>الخطة التنفيذية · الأدوار وسلسلة الاعتماد · آلية رفع الشواهد واعتمادها في منصة مدار</p>
      <div class="kpis"><div><b>${app.length}</b><span>مؤشرًا</span></div><div><b>4</b><span>مجالات</span></div><div><b>${users.length}</b><span>مسؤولًا</span></div><div><b>${groups.length}</b><span>فرق</span></div>${D.visit ? `<div><b>${esc(shortDate(D.visit))}</b><span>موعد الزيارة</span></div>` : ''}</div>
      <em>تاريخ الإخراج: ${esc(today)}</em>
    </div>
    <h2>الهدف العام</h2>
    <p>رفع جاهزية المدرسة للتقويم الخارجي من خلال بناء منظومة عمل منظمة تضمن:</p>
    <ol class="goals">${['توزيع مجالات ومؤشرات التقويم على فريق المدرسة.', 'تحديد مسؤول واضح عن كل مؤشر.', 'تحديد الشواهد المطلوبة لكل مؤشر.', 'رفع الشواهد إلكترونيًا في منصة مدار مرتبطة بمؤشراتها.', 'مراجعة الشواهد والتحقق من جودتها قبل اعتمادها.', 'اكتشاف الفجوات مبكرًا ومعالجتها.', 'تجهيز منسوبي المدرسة للمقابلات.', 'تجهيز البيئة الصفية والمدرسية للملاحظة.', 'بناء ملف متكامل يوضح أداء المدرسة بالأدلة والبيانات.'].map(t => `<li>${t}</li>`).join('')}</ol>
  </section>
  <section class="pg">
    ${prHead('الأدوار وسلسلة الاعتماد')}
    <h2>سلسلة الاعتماد</h2>
    <div class="chain">${[['قائد المجال يسند', 'يحدد المسؤولين عن كل مؤشر في مجاله'], ['المسؤول يرفع', 'يرفع الشاهد في مدار ويربطه ببنده من الشواهد المطلوبة'], ['قائد المجال', 'يراجع الشاهد: يعتمده أو يعيده بملاحظة'], ['مدير المدرسة', 'الاعتماد النهائي للشاهد']].map(([t, s], k) => `<div><i>${k + 1}</i><b>${t}</b><span>${s}</span></div>`).join('<em>←</em>')}</div>
    <p class="muted">لا يُحتسب الشاهد في جاهزية المؤشر إلا بعد اعتماده نهائيًا من المدير، ولا يكتمل المؤشر إلا باعتماد جميع بنود شواهده المطلوبة.</p>
    <h2>الهيكل التنظيمي</h2>
    <table><thead><tr><th>الدور</th><th>المكلّف</th><th>المهام</th></tr></thead><tbody>
      <tr><td><b>مدير المدرسة</b><br><span class="muted">قائد فريق التقويم</span></td><td>${pr.map(id => esc(nameOf(id))).join('<br>') || '—'}</td><td>الإشراف العام على الخطة، واعتماد التوزيع، ومتابعة نسب الإنجاز، وإزالة المعوقات، والاعتماد النهائي للشواهد، وقيادة الاجتماعات الدورية.</td></tr>
      ${leads.map(l => `<tr><td><b>قائد مجال: ${DOMAINS[l.d]}</b><br><span class="muted">${l.n} مؤشرًا</span></td><td>${l.ids.map(id => esc(nameOf(id))).join('<br>') || '<span class="muted">لم يُحدَّد</span>'}</td><td>إسناد مؤشرات المجال للمسؤولين وتعديل الإسناد، ومتابعة جميع مؤشرات المجال، ومراجعة شواهده واعتمادها أو إعادتها بملاحظة قبل رفعها للمدير.</td></tr>`).join('')}
      <tr><td><b>مسؤولو المؤشرات</b></td><td>حسب الإسناد</td><td>يظهر لكل مسؤول في حسابه المؤشرات المسندة إليه فقط، فيقرأ شرحها ويرفع شواهدها مرتبطة ببنودها، ويعدّل ما يُعاد إليه.</td></tr>
    </tbody></table>
    <h2>حالات الشاهد في مدار</h2>
    <table><tbody>
      <tr><td><b>بانتظار قائد المجال</b></td><td>رُفع الشاهد وينتظر مراجعة قائد المجال.</td></tr>
      <tr><td><b>بانتظار اعتماد المدير</b></td><td>اعتمده قائد المجال، وينتظر الاعتماد النهائي.</td></tr>
      <tr><td><b>معتمد نهائيًا</b></td><td>اعتمده المدير، ويُحتسب في جاهزية المؤشر ويظهر في وضع الزيارة.</td></tr>
      <tr><td><b>معاد للتعديل</b></td><td>أُعيد لصاحبه بملاحظة، فيعدّله ثم يضغط «إعادة الإرسال».</td></tr>
    </tbody></table>
  </section>
  <section class="pg">
    ${prHead('آلية الرفع والاعتماد في منصة مدار')}
    <h2>رفع الشاهد (لمسؤولي المؤشرات وجامعي الشواهد)</h2>
    ${steps([['ادخل صفحتك', 'من منصة مدار: الاعتماد المدرسي، وتظهر لك المؤشرات المسندة إليك فقط.'], ['افهم المؤشر', 'افتح المؤشر واقرأ «دليل المؤشر»: ماذا يعني، والنصيحة العملية، والشاهد الأقوى.'], ['ارفع لكل بند', 'في «الشواهد المطلوبة» اضغط «رفع» بجانب البند، فيرتبط الشاهد به مباشرة.'], ['أرفق الشاهد', 'اكتب عنوانًا واضحًا، ثم أرفق الملف أو الرابط.'], ['تابع شواهدك', 'الشاهد المعاد يظهر في «صفحتي» تحت «شواهد أُعيدت إليك»؛ عدّله ثم اضغط «إعادة الإرسال».']])}
    <h2>اعتماد الشاهد (لقادة المجالات والمدير)</h2>
    ${steps([['افتح قائمة الانتظار', 'قائد المجال يجد «تنتظر اعتمادك» في أعلى «مؤشرات المجال»، والمدير يجدها في «صفحتي».'], ['راجع الشاهد', 'افتحه وتحقق: هل هو مرتبط فعلًا بالبند؟ هل هو حديث وواضح ويثبت التطبيق والنتيجة؟'], ['اعتمد أو أعِد', 'قائد المجال يضغط «اعتماد قائد المجال»، والمدير يضغط «اعتماد نهائي». وعند النقص اضغط «إعادة» واكتب الملاحظة.']])}
    <h2>قاعدة مهمة جدًا للشواهد</h2>
    <div class="box">ليس المطلوب أكبر عدد من الملفات، بل شاهد <b>قوي، حديث، واضح، مرتبط بالمؤشر</b>، ويثبت التطبيق والنتيجة. ويُفضَّل أن يكون الشاهد متدرجًا:</div>
    <div class="ladder">${Object.entries(STAGES).map(([k, [t, s]], n) => `<div><i>${n + 1}</i><b>${t}</b><span>${s}</span></div>`).join('')}</div>
    <p class="muted">المرحلة الرابعة (الأثر والنتيجة) هي ما يميز الأحكام العليا في التقويم.</p>
  </section>
  <section class="pg">
    ${prHead('الخطة الزمنية وملخص التوزيع')}
    <h2>الجدول الزمني للتنفيذ</h2>
    <table><thead><tr><th class="c">م</th><th>المرحلة</th><th>المسؤول</th><th>المخرج المطلوب</th><th class="c">من</th><th class="c">إلى</th><th class="c">الحالة</th></tr></thead><tbody>
      ${D.phases.map((p, k) => `<tr><td class="c">${k + 1}</td><td><b>${esc(p.t)}</b></td><td>${esc(p.owner || '')}</td><td>${esc(p.out || '')}</td><td class="c">${p.from ? esc(shortDate(p.from)) : '…/…'}</td><td class="c">${p.to ? esc(shortDate(p.to)) : '…/…'}</td><td class="c">${PHST[p.st || 'todo']}</td></tr>`).join('')}
    </tbody></table>
    <h2>التوزيع على المجالات</h2>
    <table><thead><tr><th>المجال</th><th>قائد المجال</th><th class="c">المؤشرات</th><th class="c">أُسندت</th><th class="c">المتبقي</th></tr></thead><tbody>
      ${leads.map(l => `<tr><td><b>${DOMAINS[l.d]}</b></td><td>${l.ids.map(id => esc(short(nameOf(id)))).join('، ') || '—'}</td><td class="c">${l.n}</td><td class="c">${l.a}</td><td class="c">${l.n - l.a}</td></tr>`).join('')}
    </tbody></table>
    <h2>التوزيع على المسؤولين</h2>
    <table><thead><tr><th>المسؤول</th><th class="c">العدد</th><th>المؤشرات</th></tr></thead><tbody>${users.map(urow).join('')}${groups.map(grow).join('')}</tbody></table>
  </section>`;
  printDoc('دليل العمل لجاهزية التقويم الخارجي', body, `
    .cover{ text-align:center; padding:26mm 10mm 10mm; border-bottom:3px solid #0F2447; margin-bottom:8px; }
    .cover img{ height:70px; margin-bottom:8px; } .cover small{ display:block; color:#5B6B80; font-size:13px; } .cover h1{ font-size:27px; margin:6px 0; color:#0F2447; }
    .cover p{ color:#2455A4; font-size:13px; margin:0 0 16px; } .cover em{ display:block; font-style:normal; color:#5B6B80; margin-top:14px; }
    .kpis{ display:flex; justify-content:center; gap:10px; } .kpis div{ border:1px solid #D5DCE6; border-radius:12px; padding:8px 16px; min-width:84px; } .kpis b{ display:block; font-size:22px; color:#0F2447; } .kpis span{ color:#5B6B80; }
    .goals li{ margin-bottom:3px; font-size:12.5px; }
    .chain{ display:flex; align-items:stretch; gap:6px; } .chain > div{ flex:1; border:1px solid #D5DCE6; border-radius:12px; padding:9px; text-align:center; background:#F6F9FD; }
    .chain > div:last-child{ background:#E7F7F4; border-color:#9FD9CF; } .chain i{ display:inline-flex; width:24px; height:24px; border-radius:8px; background:#0F2447; color:#fff; font-style:normal; font-weight:800; align-items:center; justify-content:center; }
    .chain b{ display:block; font-size:13px; margin:4px 0 2px; } .chain span{ font-size:10.5px; color:#5B6B80; } .chain em{ align-self:center; font-style:normal; color:#2FC1B2; font-size:18px; font-weight:900; }
    .steps{ list-style:none; padding:0; margin:0; counter-reset:s; display:flex; flex-direction:column; gap:6px; }
    .steps li{ counter-increment:s; display:flex; gap:10px; align-items:flex-start; border:1px solid #E3E8EF; border-radius:10px; padding:7px 10px; break-inside:avoid; }
    .steps li::before{ content:counter(s); flex-shrink:0; width:24px; height:24px; border-radius:50%; background:#2FC1B2; color:#fff; font-weight:800; display:flex; align-items:center; justify-content:center; }
    .steps b{ min-width:110px; font-size:12.5px; } .steps span{ color:#33445C; }
    .ladder{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:8px; } .ladder div{ border:1px solid #D5DCE6; border-radius:10px; padding:8px; text-align:center; }
    .ladder i{ display:inline-flex; width:22px; height:22px; border-radius:50%; background:#0F2447; color:#fff; font-style:normal; font-weight:800; align-items:center; justify-content:center; } .ladder div:last-child i{ background:#2FC1B2; }
    .ladder b{ display:block; } .ladder span{ font-size:10.5px; color:#5B6B80; }`);
}

/* بطاقات المسؤولين: صفحة لكل مسؤول أو فريق */
function printCards(who) {
  const { users, groups } = cardHolders();
  const holders = who === 'all' ? [...users.map(id => ({ k: 'u', id })), ...groups.map(g => ({ k: 'g', id: g.id }))] : [{ k: who.split(':')[0], id: who.split(':')[1] }];
  const pr = roleIds('principal');
  const page = h => {
    const mine = D.inds.filter(i => !i.not_applicable && asgOf(i).some(a => a.k === h.k && a.id === h.id))
      .map(i => ({ i })).sort((a, b) => a.i.sort - b.i.sort);
    const name = h.k === 'u' ? nameOf(h.id) : (groupById(h.id) || {}).name;
    const g = h.k === 'g' ? groupById(h.id) : null;
    const roles = h.k === 'u' ? [...(pr.includes(h.id) ? ['مدير المدرسة · الاعتماد النهائي'] : []), ...[1, 2, 3, 4].filter(d => leadOf('domain', d).includes(h.id)).map(d => 'قائد مجال ' + DOMAINS[d])] : [];
    return `<section class="pg">
      ${prHead('بطاقة المسؤول')}
      <div class="who"><div><small>${h.k === 'g' ? 'فريق' : 'المسؤول'}</small><h1>${esc(name || '')}</h1>
        ${g ? `<p class="muted">${g.everyone ? 'جميع معلمي المدرسة' : 'الأعضاء: ' + ((g.member_ids || []).map(m => esc(short(nameOf(m)))).join('، ') || 'لم يُحدَّدوا بعد')}</p>` : ''}
        ${roles.length ? `<p class="roles">${roles.map(r => `<span>${esc(r)}</span>`).join('')}</p>` : ''}</div>
        <div class="cnt"><div><b>${mine.length}</b><span>${mine.length === 1 ? 'مؤشر' : 'مؤشرات'}</span></div></div></div>
      <div class="how">اقرأ الشواهد المطلوبة لكل مؤشر، وارفعها في <b>مدار ← الاعتماد المدرسي</b> مرتبطة ببنودها. يعتمد قائد المجال كل شاهد ثم يعتمده المدير نهائيًا.</div>
      ${mine.map(({ i }) => {
        const others = asgOf(i).filter(a => !(a.k === h.k && a.id === h.id));
        const cov = coveredOf(i), gd = guideOf(i), lead = domainOwners(i);
        return `<div class="card" style="--c:${DCOL[i.domain_no]}">
          <div class="top"><span class="code">${esc(i.code)}</span><span class="dom">${DOMAINS[i.domain_no]} · ${esc(i.standard)}</span></div>
          <b class="txt">${esc(i.text)}</b>
          <div class="meta"><span><i>المشاركون:</i> ${others.map(a => esc(asgLabel(a))).join('، ') || 'لا يوجد'}</span>${lead.length ? `<span><i>قائد المجال:</i> ${lead.map(id => esc(short(nameOf(id)))).join('، ')}</span>` : ''}</div>
          <div class="req"><i>الشواهد المطلوبة</i>${reqOf(i).map((t, k) => `<div><span class="chk${cov.has(k) ? ' on' : ''}"></span>${esc(t)}</div>`).join('')}</div>
          ${gd.best ? `<div class="best">★ الشاهد الأقوى: ${esc(gd.best)}</div>` : ''}
        </div>`;
      }).join('') || '<p class="muted">لا توجد مؤشرات مسندة.</p>'}
    </section>`;
  };
  printDoc('بطاقات المسؤولين', holders.map(page).join(''), `
    .who{ display:flex; align-items:center; gap:12px; background:linear-gradient(135deg,#13336A,#0C2147); color:#fff; border-radius:14px; padding:12px 16px; margin-bottom:8px; }
    .who > div:first-child{ flex:1; } .who small{ color:#BFD3F0; } .who h1{ font-size:21px; } .who .muted{ color:#BFD3F0; margin:2px 0 0; }
    .roles{ margin:4px 0 0; display:flex; gap:5px; flex-wrap:wrap; } .roles span{ background:rgba(242,196,107,.2); color:#F7D894; border-radius:999px; padding:0 9px; font-size:10.5px; font-weight:700; }
    .cnt{ display:flex; gap:6px; } .cnt div{ background:rgba(255,255,255,.1); border-radius:10px; padding:5px 10px; text-align:center; min-width:62px; } .cnt b{ display:block; font-size:19px; } .cnt span{ font-size:10px; }
    .how{ font-size:11px; background:#F2F7FD; border:1px dashed #BCD3EF; color:#1D4D7C; border-radius:10px; padding:6px 10px; margin-bottom:8px; }
    .card{ border:1px solid #D5DCE6; border-inline-start:4px solid var(--c); border-radius:10px; padding:8px 11px; margin-bottom:7px; break-inside:avoid; }
    .card .top{ display:flex; align-items:center; gap:8px; } .card .code{ font-weight:800; color:var(--c); direction:ltr; } .card .dom{ flex:1; color:#5B6B80; font-size:10.5px; }
    .card .txt{ display:block; font-size:12.5px; margin:2px 0 4px; } .card i{ font-style:normal; font-weight:800; color:#5B6B80; margin-inline-end:4px; }
    .card .meta{ display:flex; gap:14px; flex-wrap:wrap; font-size:10.5px; margin-bottom:4px; } .card .meta small{ color:#5B6B80; }
    .card .req{ font-size:11px; } .card .req > i{ display:block; color:#1F7A45; } .card .req div{ padding:1px 0; }
    .card .best{ font-size:10.5px; color:#8A5A0B; background:#FFF8E8; border-radius:6px; padding:2px 8px; margin-top:4px; }
    .card .st{ display:flex; gap:12px; align-items:center; font-size:10.5px; border-top:1px dashed #D5DCE6; margin-top:5px; padding-top:4px; }`);
}
