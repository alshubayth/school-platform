/* =========================================================================
 * المناوبات (الإصدار الجديد)
 *
 * كل مناوبة = موقع (duty_posts) مربوط بوقت ثابت (الصباح، التعليق، الفسحة، الصلاة ١ و٢، الانصراف).
 * التوزيع أسبوعي ثابت (duty_plan): معلم واحد لكل موقع بكل يوم، يتكرر كل أسبوع.
 * الإدخال بطريقتين على نفس البيانات:
 *   • «التوزيع»: جدول المواقع × الأيام، تضغط الخانة وتختار المعلم (مع عدد مناوباته وتنبيه الحصة والتعارض)
 *   • «بالمعلم»: تختار المعلم ويطلع جدوله (الأوقات × الأيام) وتضغط الخانة وتختار الموقع
 * «المواقع»: إضافة/تسمية/إيقاف/ترتيب المواقع لكل وقت.
 * المعلم يشوف «مناوباتي» وجدول المدرسة للعرض فقط.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool, writeWithSchool, gradeLabels, loadPeriodTimes, periodTime, fmtClock, backToTiles } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isManager = () => currentProfile && ['admin', 'deputy', 'owner'].includes(currentProfile.role);
const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const pnorm = s => norm(s).split(' ').filter(w => w && !['بن', 'ابن', 'بنت'].includes(w)).join(' ');
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const LRI = s => '⁦' + s + '⁩';

export const DAYS = [['sunday', 'الأحد'], ['monday', 'الاثنين'], ['tuesday', 'الثلاثاء'], ['wednesday', 'الأربعاء'], ['thursday', 'الخميس']];
const DAY_LABEL = Object.fromEntries(DAYS);

/* ---------- الأوقات ---------- */
export const SLOTS = [
  { key: 'morning', title: 'الصباح', time: '06:45-07:30', c: '#2455A4', bg: '#EAF1FC' },
  { key: 'suspension', title: 'وقت التعليق', note: 'أيام الحر أو المطر — الطلاب في فصولهم', time: '07:00-07:30', c: '#0B7A8C', bg: '#E3F4F7' },
  { key: 'break', title: 'الفسحة', time: '09:45-10:15', c: '#B45F1E', bg: '#FDEFE3' },
  { key: 'prayer1', title: 'الصلاة — الجماعة الأولى', note: 'أول وثاني متوسط', time: '11:45-12:15', c: '#1F7A45', bg: '#E7F5EC' },
  { key: 'prayer2', title: 'الصلاة — الجماعة الثانية', note: 'ثالث متوسط', time: '12:30-13:00', c: '#5A3E9E', bg: '#EFEBFB' },
  { key: 'dismissal', title: 'الانصراف', note: 'لين تطلع الحافلات', time: '13:45-14:15', c: '#8A3A30', bg: '#FBEAE9' },
];
const SLOT = Object.fromEntries(SLOTS.map(s => [s.key, s]));
export function slotRange(key) {
  const s = SLOT[key]; if (!s) return null;
  const [a, b] = s.time.split('-');
  return { start: toMin(a), end: toMin(b), label: LRI(fmtClock(toMin(a)) + ' - ' + fmtClock(toMin(b))) };
}

const CORR = ['ممر الصف الأول', 'ممر الصف الثاني', 'ممر الصف الثالث', 'ممر الصالة الرياضية', 'ممر الإدارة'];
const DEFAULT_POSTS = {
  morning: ['تنظيم دخول الحافلات', 'استقبال الحافلات', 'تنظيم دخول الطلاب', 'المدخل الرئيسي', ...CORR],
  suspension: ['ممر الصف الأول', 'ممر الصف الثاني', 'ممر الصف الثالث'],
  break: ['المقصف جهة الثاني', 'المقصف جهة الثالث', 'جهة الصف الأول', 'جهة الصف الثاني', 'جهة الصف الثالث', 'وسط ساحة الطابور', ...CORR],
  prayer1: ['المصلى', ...CORR],
  prayer2: ['المصلى', ...CORR],
  dismissal: ['الحافلات', 'خلو الفصول — ممر الأول', 'خلو الفصول — ممر الثاني', 'خلو الفصول — ممر الثالث'],
};

/* ---------- الحالة ---------- */
const S = {
  posts: [], plan: [], teachers: [], sched: new Map(), tab: 'board', day: 'all', selTeacher: null,
  tFilter: '', tOnlyEmpty: false, missing: false, loaded: false,
};
const R = build => readScopedBySchool(sc => { let q = build(); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });

async function loadData() {
  const [posts, plan, teachers] = await Promise.all([
    R(() => sb.from('duty_posts').select('id, slot, name, sort, active').order('sort')),
    R(() => sb.from('duty_plan').select('id, post_id, day_of_week, teacher_id')),
    R(() => sb.from('profiles').select('id, full_name, role').eq('role', 'teacher')),
  ]);
  if (posts.error) { S.missing = true; return; }
  S.missing = false;
  S.posts = (posts.data || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  S.plan = plan.data || [];
  S.teachers = (teachers.data || []).filter(t => t.full_name).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  if (!S.posts.length && isManager()) { await seedPosts(); }
  await loadPeriodTimes();
  await loadScheduleMap();
}

async function seedPosts(onlyMissing = false) {
  const rows = [];
  SLOTS.forEach(s => DEFAULT_POSTS[s.key].forEach((name, i) => {
    if (onlyMissing && S.posts.some(p => p.slot === s.key && norm(p.name) === norm(name))) return;
    rows.push({ slot: s.key, name, sort: (SLOTS.indexOf(s) + 1) * 100 + i, active: true });
  }));
  if (!rows.length) return 0;
  const { data, error } = await writeWithSchool(extra => sb.from('duty_posts').insert(rows.map(r => ({ ...r, ...extra }))).select('id, slot, name, sort, active'));
  if (!error && data) S.posts = [...S.posts, ...data].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return rows.length;
}

// حصص كل معلم: Map(teacherId -> [{day, period, grade}])
async function loadScheduleMap() {
  S.sched = new Map();
  let r = await R(() => sb.from('class_schedules').select('day_of_week, period_number, grade_level, teacher_name, teacher_id'));
  if (r.error) r = await R(() => sb.from('class_schedules').select('day_of_week, period_number, grade_level, teacher_name'));
  const rows = r.data || [];
  const byName = new Map();
  S.teachers.forEach(t => { const k = pnorm(t.full_name); byName.set(k, byName.has(k) ? null : t.id); });
  const fl = n => { const w = pnorm(n).split(' '); return w[0] + '|' + w[w.length - 1]; };
  const byFL = new Map();
  S.teachers.forEach(t => { const k = fl(t.full_name); byFL.set(k, byFL.has(k) ? null : t.id); });
  const ids = new Set(S.teachers.map(t => t.id));
  rows.forEach(row => {
    let id = row.teacher_id && ids.has(row.teacher_id) ? row.teacher_id : null;
    if (!id && row.teacher_name) id = byName.get(pnorm(row.teacher_name)) || byFL.get(fl(row.teacher_name)) || null;
    if (!id) return;
    if (!S.sched.has(id)) S.sched.set(id, []);
    S.sched.get(id).push({ day: row.day_of_week, period: row.period_number, grade: row.grade_level });
  });
}

/* ---------- حسابات ---------- */
const postById = id => S.posts.find(p => p.id === id);
const teacherById = id => S.teachers.find(t => t.id === id);
const activePosts = slot => S.posts.filter(p => p.slot === slot && p.active);
const cellOf = (postId, day) => S.plan.find(x => x.post_id === postId && x.day_of_week === day);
const loadOf = tid => S.plan.filter(x => x.teacher_id === tid && postById(x.post_id)).length;
const shortName = n => { const w = String(n || '').trim().split(/\s+/).filter(x => !['بن', 'ابن'].includes(x)); return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' '); };
// حصص المعلم اللي تتقاطع مع وقت المناوبة
function periodClash(tid, day, slot) {
  const r = slotRange(slot); if (!r) return [];
  return (S.sched.get(tid) || []).filter(p => {
    if (p.day !== day) return false;
    const t = periodTime(p.grade, p.period);
    return t && t.start < r.end && r.start < t.end;
  });
}
// مناوبة ثانية بنفس الوقت ونفس اليوم
function busyElsewhere(tid, day, slot, exceptPost) {
  return S.plan.find(x => x.teacher_id === tid && x.day_of_week === day && x.post_id !== exceptPost && (postById(x.post_id) || {}).slot === slot);
}
const clashText = cl => cl.map(p => `حصة ${p.period}${p.grade ? ' ' + (gradeLabels[p.grade] || '') : ''}`).join('، ');

/* ---------- الكتابة ---------- */
async function assign(postId, days, teacherId) {
  const rows = days.map(d => ({ post_id: postId, day_of_week: d, teacher_id: teacherId, updated_at: new Date().toISOString() }));
  const { error } = await writeWithSchool(extra => sb.from('duty_plan').upsert(rows.map(r => ({ ...r, ...extra })), { onConflict: 'post_id,day_of_week' }));
  if (error) { toast('ما انحفظ: ' + error.message, true); return false; }
  days.forEach(d => {
    const c = cellOf(postId, d);
    if (c) c.teacher_id = teacherId; else S.plan.push({ id: 'tmp' + Math.random(), post_id: postId, day_of_week: d, teacher_id: teacherId });
  });
  return true;
}
async function unassign(postId, days) {
  const { error } = await sb.from('duty_plan').delete().eq('post_id', postId).in('day_of_week', days);
  if (error) { toast('ما انحذف: ' + error.message, true); return false; }
  S.plan = S.plan.filter(x => !(x.post_id === postId && days.includes(x.day_of_week)));
  return true;
}

function toast(msg, bad) {
  let t = $('db-toast');
  if (!t) { t = document.createElement('div'); t.id = 'db-toast'; t.className = 'db-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove('show'), 2600);
}

/* =========================================================================
 * الواجهة
 * ========================================================================= */
let root = null;
export async function loadDutyBoardModule() {
  root = $('db-root');
  if (!root) return;
  const back = $('back-to-tiles-8');
  if (back && !back.dataset.wired) { back.dataset.wired = '1'; back.addEventListener('click', backToTiles); }
  root.innerHTML = '<div class="db-loading">جاري التحميل...</div>';
  await loadData();
  if (S.missing) {
    root.innerHTML = `<div class="db-empty"><b>قسم المناوبات الجديد يحتاج تجهيز قاعدة البيانات</b><span>${isManager() ? 'شغّل الملف sql/duty_v2.sql في Supabase مرة وحدة ثم حدّث الصفحة.' : 'تواصل مع الإدارة.'}</span></div>`;
    return;
  }
  if (!S.loaded) { S.day = window.innerWidth < 700 ? (todayKey() || 'sunday') : 'all'; S.loaded = true; }
  if (!isManager()) S.tab = S.tab === 'board' ? 'mine' : S.tab;
  render();
}
const todayKey = () => (DAYS[new Date().getDay()] || [])[0] || null;

function render() {
  const mgr = isManager();
  const tabs = mgr
    ? [['board', 'التوزيع'], ['teacher', 'بالمعلم'], ['posts', 'المواقع']]
    : [['mine', 'مناوباتي'], ['board', 'جدول المدرسة']];
  root.innerHTML = `
    <div class="db">
      <div class="db-top">
        <div class="db-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="db-tab${S.tab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        ${mgr ? '<div class="db-sub">جدول أسبوعي ثابت يتكرر كل أسبوع</div>' : ''}
      </div>
      ${mgr && S.tab !== 'posts' ? fairnessHtml() : ''}
      <div id="db-body"></div>
    </div>`;
  root.querySelectorAll('.db-tab').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); });
  const fb = root.querySelector('.db-fair-empty');
  if (fb) fb.onclick = () => { S.tab = 'teacher'; S.tOnlyEmpty = true; S.selTeacher = null; render(); };
  const body = $('db-body');
  if (S.tab === 'board') renderBoard(body, !mgr);
  else if (S.tab === 'teacher') renderTeacherTab(body);
  else if (S.tab === 'posts') renderPostsTab(body);
  else renderMine(body);
}

/* ---------- شريط العدالة ---------- */
function fairnessHtml() {
  const loads = S.teachers.map(t => loadOf(t.id));
  const withDuty = loads.filter(n => n > 0);
  const empty = S.teachers.length - withDuty.length;
  const avg = withDuty.length ? (withDuty.reduce((a, b) => a + b, 0) / S.teachers.length) : 0;
  const max = loads.length ? Math.max(...loads) : 0;
  let cells = 0, filled = 0;
  SLOTS.forEach(s => activePosts(s.key).forEach(p => DAYS.forEach(([d]) => { cells++; if (cellOf(p.id, d)) filled++; })));
  const pct = cells ? Math.round(filled / cells * 100) : 0;
  return `<div class="db-fair">
    <div class="db-fair-item"><b>${filled}<small>/${cells}</small></b><span>خانة معبّأة</span><i class="db-bar"><i style="width:${pct}%"></i></i></div>
    <div class="db-fair-item"><b>${avg.toFixed(1)}</b><span>متوسط المناوبات للمعلم</span></div>
    <div class="db-fair-item"><b>${max}</b><span>أعلى عدد عند معلم</span></div>
    <button type="button" class="db-fair-item db-fair-empty${empty ? ' warn' : ''}"><b>${empty}</b><span>${empty ? 'معلم بدون مناوبة ←' : 'كل المعلمين عندهم مناوبات'}</span></button>
  </div>`;
}

/* ---------- تبويب التوزيع (الجدول) ---------- */
function dayChips(cur, withAll = true) {
  const all = withAll ? [['all', 'كل الأيام'], ...DAYS] : DAYS;
  return `<div class="db-daybar">${all.map(([k, l]) => `<button type="button" class="db-chip${cur === k ? ' on' : ''}${k === todayKey() ? ' today' : ''}" data-day="${k}">${l}</button>`).join('')}</div>`;
}

function renderBoard(body, readOnly) {
  const days = S.day === 'all' ? DAYS : DAYS.filter(([k]) => k === S.day);
  const single = days.length === 1;
  const sections = SLOTS.map(s => {
    const posts = activePosts(s.key);
    if (!posts.length) return '';
    const r = slotRange(s.key);
    let fill = 0; posts.forEach(p => days.forEach(([d]) => { if (cellOf(p.id, d)) fill++; }));
    const total = posts.length * days.length;
    const rows = posts.map(p => `<tr><th class="db-post">${esc(p.name)}</th>${days.map(([d]) => {
      const c = cellOf(p.id, d);
      const t = c && teacherById(c.teacher_id);
      if (!c) return `<td><button type="button" class="db-cell empty" data-post="${p.id}" data-day="${d}" ${readOnly ? 'disabled' : ''} aria-label="إسناد ${esc(p.name)} يوم ${DAY_LABEL[d]}">${readOnly ? '—' : '＋'}</button></td>`;
      const cl = t ? periodClash(t.id, d, s.key) : [];
      const nm = t ? (single ? t.full_name : shortName(t.full_name)) : 'حساب محذوف';
      return `<td><button type="button" class="db-cell filled${cl.length ? ' clash' : ''}${c.teacher_id === currentUserId ? ' me' : ''}" data-post="${p.id}" data-day="${d}" ${readOnly ? 'disabled' : ''} title="${esc(t ? t.full_name : '')}${cl.length ? ' — عنده ' + esc(clashText(cl)) : ''}">${esc(nm)}${cl.length ? '<i class="db-dot" aria-hidden="true"></i>' : ''}</button></td>`;
    }).join('')}</tr>`).join('');
    return `<section class="db-slot" style="--c:${s.c};--bg:${s.bg}">
      <header class="db-slot-h"><span class="db-slot-t">${esc(s.title)}</span><span class="db-slot-time">${r.label}</span>${s.note ? `<span class="db-slot-note">${esc(s.note)}</span>` : ''}<span class="db-slot-count${fill === total ? ' full' : ''}">${fill}/${total}</span></header>
      <div class="db-twrap"><table class="db-table${single ? ' single' : ''}"><thead><tr><th>الموقع</th>${days.map(([d, l]) => `<th class="${d === todayKey() ? 'today' : ''}">${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
  }).join('');
  body.innerHTML = `${dayChips(S.day)}
    ${readOnly ? '' : '<div class="db-hint">اضغط أي خانة واختر المعلم. <span class="db-dot inline"></span> = المعلم عنده حصة بنفس الوقت.</div>'}
    ${sections || '<div class="db-empty">ما فيه مواقع مفعّلة. أضفها من تبويب «المواقع».</div>'}`;
  body.querySelectorAll('.db-daybar .db-chip').forEach(b => b.onclick = () => { S.day = b.dataset.day; renderBoard(body, readOnly); });
  if (!readOnly) body.querySelectorAll('.db-cell').forEach(b => b.onclick = () => openTeacherPicker(b.dataset.post, b.dataset.day));
}

/* ---------- نافذة سفلية عامة ---------- */
function openSheet(html, onMount) {
  closeSheet();
  const back = document.createElement('div');
  back.className = 'db-back'; back.id = 'db-sheet';
  back.innerHTML = `<div class="db-sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(back);
  document.body.classList.add('db-noscroll');
  back.addEventListener('click', e => { if (e.target === back) closeSheet(); });
  back.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
  const onKey = e => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey); back._onKey = onKey;
  requestAnimationFrame(() => back.classList.add('show'));
  onMount && onMount(back.querySelector('.db-sheet'));
}
function closeSheet() {
  const b = $('db-sheet'); if (!b) return;
  document.removeEventListener('keydown', b._onKey);
  b.remove(); document.body.classList.remove('db-noscroll');
}
function sheetDays(sel) {
  return `<div class="db-sh-days"><span>طبّق على:</span>${DAYS.map(([k, l]) => `<button type="button" class="db-chip sm${sel.has(k) ? ' on' : ''}" data-d="${k}" aria-pressed="${sel.has(k)}">${l}</button>`).join('')}<button type="button" class="db-chip sm ghost" data-d="*">كل الأيام</button></div>`;
}
function wireSheetDays(el, sel, onChange) {
  el.querySelectorAll('.db-sh-days .db-chip').forEach(b => b.onclick = () => {
    if (b.dataset.d === '*') { const all = sel.size === 5; sel.clear(); if (all) sel.add(b.closest('.db-sheet').dataset.day); else DAYS.forEach(([k]) => sel.add(k)); }
    else { if (sel.has(b.dataset.d) && sel.size > 1) sel.delete(b.dataset.d); else sel.add(b.dataset.d); }
    el.querySelectorAll('.db-sh-days .db-chip[data-d]').forEach(x => { if (x.dataset.d !== '*') { x.classList.toggle('on', sel.has(x.dataset.d)); x.setAttribute('aria-pressed', sel.has(x.dataset.d)); } });
    onChange();
  });
}

/* ---------- اختيار المعلم لخانة (موقع + يوم) ---------- */
function openTeacherPicker(postId, day) {
  const post = postById(postId); if (!post) return;
  const slot = SLOT[post.slot];
  const sel = new Set([day]);
  const cur = cellOf(postId, day);
  let q = '';
  openSheet(`
    <div class="db-sh-head" style="--c:${slot.c};--bg:${slot.bg}">
      <div><b>${esc(post.name)}</b><span>${esc(slot.title)} · ${slotRange(post.slot).label}</span></div>
      <button type="button" class="db-x" data-close aria-label="إغلاق">✕</button>
    </div>
    ${sheetDays(sel)}
    <input type="search" class="db-search" placeholder="ابحث عن معلم..." autocomplete="off">
    <div class="db-tlist" role="listbox"></div>
    ${cur ? `<div class="db-sh-foot"><button type="button" class="db-btn danger" data-act="clear">إزالة المناوب من الأيام المحددة</button></div>` : ''}`,
  el => {
    el.dataset.day = day;
    const list = el.querySelector('.db-tlist');
    const draw = () => {
      const days = DAYS.map(([k]) => k).filter(k => sel.has(k));
      const items = S.teachers.filter(t => !q || norm(t.full_name).includes(norm(q))).map(t => {
        const busy = days.map(d => [d, busyElsewhere(t.id, d, post.slot, postId)]).filter(x => x[1]);
        const clash = days.map(d => [d, periodClash(t.id, d, post.slot)]).filter(x => x[1].length);
        const isCur = days.every(d => (cellOf(postId, d) || {}).teacher_id === t.id);
        const rank = isCur ? 0 : busy.length === days.length ? 4 : busy.length ? 3 : clash.length ? 2 : 1;
        return { t, busy, clash, isCur, rank, load: loadOf(t.id) };
      }).sort((a, b) => a.rank - b.rank || a.load - b.load || a.t.full_name.localeCompare(b.t.full_name, 'ar'));
      const multi = days.length > 1;
      list.innerHTML = items.map(({ t, busy, clash, isCur, rank, load }) => {
        const tags = [];
        if (isCur) tags.push('<span class="db-tag cur">المناوب الحالي</span>');
        busy.forEach(([d, x]) => tags.push(`<span class="db-tag busy">مناوب في «${esc((postById(x.post_id) || {}).name || '')}»${multi ? ' ' + DAY_LABEL[d] : ''}</span>`));
        clash.forEach(([d, c]) => tags.push(`<span class="db-tag clash">عنده ${esc(clashText(c))}${multi ? ' ' + DAY_LABEL[d] : ''}</span>`));
        return `<button type="button" class="db-trow${isCur ? ' cur' : ''}" data-id="${t.id}" ${rank === 4 ? 'disabled' : ''} role="option">
          <span class="db-tname">${esc(t.full_name)}</span>
          <span class="db-load${load === 0 ? ' zero' : ''}" title="عدد مناوباته بالأسبوع">${load}</span>
          ${tags.length ? `<span class="db-tags">${tags.join('')}</span>` : ''}
        </button>`;
      }).join('') || '<div class="db-empty sm">ما فيه نتائج</div>';
      list.querySelectorAll('.db-trow').forEach(b => b.onclick = async () => {
        const tid = b.dataset.id;
        const okDays = days.filter(d => !busyElsewhere(tid, d, post.slot, postId));
        const skipped = days.filter(d => !okDays.includes(d));
        if (!okDays.length) return;
        b.disabled = true;
        if (await assign(postId, okDays, tid)) {
          closeSheet(); refresh();
          const t = teacherById(tid);
          toast(`${shortName(t.full_name)} ← ${post.name}${okDays.length > 1 ? ` (${okDays.length} أيام)` : ''}${skipped.length ? ` · ما انحط ${skipped.map(d => DAY_LABEL[d]).join('، ')} لأنه مناوب بموقع ثاني` : ''}`);
        } else b.disabled = false;
      });
    };
    wireSheetDays(el, sel, draw);
    const s = el.querySelector('.db-search');
    s.oninput = () => { q = s.value; draw(); };
    const clr = el.querySelector('[data-act="clear"]');
    if (clr) clr.onclick = async () => { const days = [...sel]; if (await unassign(postId, days)) { closeSheet(); refresh(); toast('تمت الإزالة'); } };
    draw();
    if (window.innerWidth > 700) s.focus();
  });
}

/* ---------- تبويب «بالمعلم» ---------- */
function renderTeacherTab(body) {
  const list = S.teachers.filter(t => (!S.tFilter || norm(t.full_name).includes(norm(S.tFilter))) && (!S.tOnlyEmpty || loadOf(t.id) === 0));
  if (S.selTeacher && !teacherById(S.selTeacher)) S.selTeacher = null;
  body.innerHTML = `<div class="db-tt">
    <aside class="db-tside">
      <input type="search" class="db-search" id="db-tq" placeholder="ابحث عن معلم..." value="${esc(S.tFilter)}" autocomplete="off">
      <label class="db-check"><input type="checkbox" id="db-tempty" ${S.tOnlyEmpty ? 'checked' : ''}> بدون مناوبات فقط</label>
      <div class="db-tside-list">${list.map(t => { const n = loadOf(t.id); return `<button type="button" class="db-tside-row${S.selTeacher === t.id ? ' on' : ''}" data-id="${t.id}"><span>${esc(t.full_name)}</span><span class="db-load${n === 0 ? ' zero' : ''}">${n}</span></button>`; }).join('') || '<div class="db-empty sm">ما فيه معلمين</div>'}</div>
    </aside>
    <div class="db-tmain" id="db-tmain"></div>
  </div>`;
  const tq = $('db-tq');
  tq.oninput = () => { S.tFilter = tq.value; const pos = tq.selectionStart; renderTeacherTab(body); const n = $('db-tq'); n.focus(); n.setSelectionRange(pos, pos); };
  $('db-tempty').onchange = e => { S.tOnlyEmpty = e.target.checked; renderTeacherTab(body); };
  body.querySelectorAll('.db-tside-row').forEach(b => b.onclick = () => {
    S.selTeacher = b.dataset.id; renderTeacherTab(body);
    if (window.innerWidth < 860) $('db-tmain').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  renderTeacherGrid($('db-tmain'));
}

function renderTeacherGrid(box) {
  const t = S.selTeacher && teacherById(S.selTeacher);
  if (!t) { box.innerHTML = '<div class="db-empty">اختر معلم من القائمة عشان تسند له مناوباته</div>'; return; }
  const slots = SLOTS.filter(s => activePosts(s.key).length);
  const n = loadOf(t.id);
  const periods = (S.sched.get(t.id) || []).length;
  box.innerHTML = `<div class="db-tcard">
    <div class="db-tcard-h"><div><b>${esc(t.full_name)}</b><span>${n} مناوبة بالأسبوع${periods ? ` · ${periods} حصة بالجدول` : ''}</span></div></div>
    <div class="db-twrap"><table class="db-table db-tgrid"><thead><tr><th>الوقت</th>${DAYS.map(([d, l]) => `<th class="${d === todayKey() ? 'today' : ''}">${l}</th>`).join('')}</tr></thead><tbody>
    ${slots.map(s => `<tr style="--c:${s.c};--bg:${s.bg}"><th class="db-post slot"><span>${esc(s.title)}</span><small>${slotRange(s.key).label}</small></th>${DAYS.map(([d]) => {
      const mine = S.plan.find(x => x.teacher_id === t.id && x.day_of_week === d && (postById(x.post_id) || {}).slot === s.key);
      const cl = periodClash(t.id, d, s.key);
      return `<td><button type="button" class="db-cell ${mine ? 'filled slotc' : 'empty'}${cl.length ? ' clash' : ''}" data-slot="${s.key}" data-day="${d}" title="${cl.length ? 'عنده ' + esc(clashText(cl)) : ''}">${mine ? esc(postById(mine.post_id).name) : (cl.length ? `<small class="db-cl">${esc(clashText(cl))}</small>` : '＋')}${mine && cl.length ? '<i class="db-dot" aria-hidden="true"></i>' : ''}</button></td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div>
  </div>`;
  box.querySelectorAll('.db-cell').forEach(b => b.onclick = () => openPostPicker(t.id, b.dataset.slot, b.dataset.day));
}

/* ---------- اختيار الموقع لمعلم (وقت + يوم) ---------- */
function openPostPicker(tid, slotKey, day) {
  const t = teacherById(tid); const slot = SLOT[slotKey];
  const sel = new Set([day]);
  const mineOn = d => S.plan.find(x => x.teacher_id === tid && x.day_of_week === d && (postById(x.post_id) || {}).slot === slotKey);
  openSheet(`
    <div class="db-sh-head" style="--c:${slot.c};--bg:${slot.bg}">
      <div><b>${esc(t.full_name)}</b><span>${esc(slot.title)} · ${slotRange(slotKey).label}</span></div>
      <button type="button" class="db-x" data-close aria-label="إغلاق">✕</button>
    </div>
    ${sheetDays(sel)}
    <div class="db-clash-note"></div>
    <div class="db-plist"></div>
    <div class="db-sh-foot"><button type="button" class="db-btn danger" data-act="clear" hidden>إزالة مناوبته بهالوقت</button></div>`,
  el => {
    el.dataset.day = day;
    const draw = () => {
      const days = DAYS.map(([k]) => k).filter(k => sel.has(k));
      const multi = days.length > 1;
      const cl = days.map(d => [d, periodClash(tid, d, slotKey)]).filter(x => x[1].length);
      el.querySelector('.db-clash-note').innerHTML = cl.length ? `<div class="db-warn">⚠ عنده ${cl.map(([d, c]) => esc(clashText(c)) + (multi ? ' ' + DAY_LABEL[d] : '')).join('، ')} بنفس الوقت</div>` : '';
      el.querySelector('.db-plist').innerHTML = activePosts(slotKey).map(p => {
        const holders = days.map(d => [d, cellOf(p.id, d)]).filter(([, c]) => c && c.teacher_id !== tid);
        const isMine = days.every(d => (cellOf(p.id, d) || {}).teacher_id === tid);
        const who = holders.length ? holders.map(([d, c]) => { const h = teacherById(c.teacher_id); return `${esc(shortName(h ? h.full_name : '—'))}${multi ? ' (' + DAY_LABEL[d] + ')' : ''}`; }).join('، ') : '';
        return `<button type="button" class="db-prow${isMine ? ' on' : ''}${holders.length ? ' taken' : ''}" data-post="${p.id}">
          <span class="db-pname">${esc(p.name)}</span>
          <span class="db-pwho">${isMine ? '✓ مسندة له' : holders.length ? 'بدل: ' + who : 'فاضية'}</span>
        </button>`;
      }).join('');
      el.querySelector('[data-act="clear"]').hidden = !days.some(d => mineOn(d));
      el.querySelectorAll('.db-prow').forEach(b => b.onclick = async () => {
        const pid = b.dataset.post;
        b.disabled = true;
        // نشيله من أي موقع ثاني بنفس الوقت بالأيام المحددة (معلم واحد = موقع واحد بكل وقت)
        for (const d of days) { const m = mineOn(d); if (m && m.post_id !== pid) await unassign(m.post_id, [d]); }
        if (await assign(pid, days, tid)) { closeSheet(); refresh(); toast(`${shortName(t.full_name)} ← ${postById(pid).name}${days.length > 1 ? ` (${days.length} أيام)` : ''}`); }
        else b.disabled = false;
      });
    };
    wireSheetDays(el, sel, draw);
    el.querySelector('[data-act="clear"]').onclick = async () => {
      const days = [...sel];
      for (const d of days) { const m = mineOn(d); if (m) await unassign(m.post_id, [d]); }
      closeSheet(); refresh(); toast('تمت الإزالة');
    };
    draw();
  });
}

function refresh() {
  // نعيد رسم التبويب الحالي مع الحفاظ على مكان التمرير
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

/* ---------- تبويب «المواقع» ---------- */
function renderPostsTab(body) {
  body.innerHTML = `<div class="db-hint">كل موقع مربوط بوقت. الموقع الموقوف ما يظهر بالجدول (وتبقى إسناداته محفوظة لو رجّعته).</div>
    ${SLOTS.map(s => {
      const posts = S.posts.filter(p => p.slot === s.key);
      return `<section class="db-slot" style="--c:${s.c};--bg:${s.bg}">
        <header class="db-slot-h"><span class="db-slot-t">${esc(s.title)}</span><span class="db-slot-time">${slotRange(s.key).label}</span>${s.note ? `<span class="db-slot-note">${esc(s.note)}</span>` : ''}</header>
        <div class="db-posts">${posts.map((p, i) => `<div class="db-pedit${p.active ? '' : ' off'}" data-id="${p.id}">
          <input type="text" value="${esc(p.name)}" aria-label="اسم الموقع">
          <label class="db-switch" title="${p.active ? 'مفعّل' : 'موقوف'}"><input type="checkbox" ${p.active ? 'checked' : ''}><span></span></label>
          <button type="button" class="db-ib" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="فوق">↑</button>
          <button type="button" class="db-ib" data-act="down" ${i === posts.length - 1 ? 'disabled' : ''} aria-label="تحت">↓</button>
          <button type="button" class="db-ib del" data-act="del" aria-label="حذف">🗑</button>
        </div>`).join('')}
          <form class="db-padd" data-slot="${s.key}"><input type="text" placeholder="＋ موقع جديد في ${esc(s.title)}" required><button type="submit" class="db-btn">إضافة</button></form>
        </div>
      </section>`;
    }).join('')}
    <div class="db-posts-foot"><button type="button" class="db-btn ghost" id="db-restore">إضافة المواقع الافتراضية الناقصة</button></div>`;

  body.querySelectorAll('.db-pedit').forEach(row => {
    const p = postById(row.dataset.id);
    const inp = row.querySelector('input[type=text]');
    inp.onchange = async () => {
      const name = inp.value.trim(); if (!name) { inp.value = p.name; return; }
      const { error } = await sb.from('duty_posts').update({ name }).eq('id', p.id);
      if (error) toast('ما انحفظ', true); else { p.name = name; toast('انحفظ الاسم'); }
    };
    row.querySelector('input[type=checkbox]').onchange = async e => {
      const { error } = await sb.from('duty_posts').update({ active: e.target.checked }).eq('id', p.id);
      if (error) { toast('ما انحفظ', true); e.target.checked = !e.target.checked; return; }
      p.active = e.target.checked; row.classList.toggle('off', !p.active);
    };
    row.querySelectorAll('[data-act=up],[data-act=down]').forEach(b => b.onclick = async () => {
      const list = S.posts.filter(x => x.slot === p.slot);
      const i = list.indexOf(p); const j = b.dataset.act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      const o = list[j];
      const a = p.sort, c = o.sort === a ? a + (j > i ? 1 : -1) : o.sort;
      p.sort = c; o.sort = a;
      await Promise.all([sb.from('duty_posts').update({ sort: p.sort }).eq('id', p.id), sb.from('duty_posts').update({ sort: o.sort }).eq('id', o.id)]);
      S.posts.sort((x, y) => (x.sort || 0) - (y.sort || 0));
      renderPostsTab(body);
    });
    const del = row.querySelector('[data-act=del]');
    del.onclick = async () => {
      const used = S.plan.filter(x => x.post_id === p.id).length;
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm'); del.textContent = used ? `حذف + ${used} إسناد؟` : 'متأكد؟';
        setTimeout(() => { if (del.isConnected) { del.classList.remove('confirm'); del.textContent = '🗑'; } }, 3500);
        return;
      }
      const { error } = await sb.from('duty_posts').delete().eq('id', p.id);
      if (error) { toast('ما انحذف', true); return; }
      S.posts = S.posts.filter(x => x.id !== p.id); S.plan = S.plan.filter(x => x.post_id !== p.id);
      renderPostsTab(body); toast('انحذف الموقع');
    };
  });
  body.querySelectorAll('.db-padd').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const inp = f.querySelector('input'); const name = inp.value.trim(); if (!name) return;
    const slot = f.dataset.slot;
    const maxSort = Math.max(0, ...S.posts.filter(p => p.slot === slot).map(p => p.sort || 0));
    const { data, error } = await writeWithSchool(extra => sb.from('duty_posts').insert({ slot, name, sort: maxSort + 1, active: true, ...extra }).select('id, slot, name, sort, active'));
    if (error) { toast('ما انضاف: ' + error.message, true); return; }
    S.posts.push(...(data || [])); S.posts.sort((x, y) => (x.sort || 0) - (y.sort || 0));
    renderPostsTab(body); toast('انضاف الموقع');
  });
  $('db-restore').onclick = async () => { const n = await seedPosts(true); renderPostsTab(body); toast(n ? `انضاف ${n} موقع` : 'كل المواقع الافتراضية موجودة'); };
}

/* ---------- المعلم: مناوباتي ---------- */
function renderMine(body) {
  const mine = S.plan.filter(x => x.teacher_id === currentUserId && postById(x.post_id) && postById(x.post_id).active);
  const tk = todayKey();
  if (!mine.length) { body.innerHTML = '<div class="db-empty">ما عندك مناوبات مسندة حاليًا</div>'; return; }
  body.innerHTML = `<div class="db-mine">${DAYS.map(([d, l]) => {
    const items = mine.filter(x => x.day_of_week === d).map(x => postById(x.post_id))
      .sort((a, b) => SLOTS.findIndex(s => s.key === a.slot) - SLOTS.findIndex(s => s.key === b.slot));
    return `<div class="db-mday${d === tk ? ' today' : ''}"><div class="db-mday-h">${l}${d === tk ? '<span>اليوم</span>' : ''}</div>
      ${items.length ? items.map(p => { const s = SLOT[p.slot]; return `<div class="db-mitem" style="--c:${s.c};--bg:${s.bg}"><span class="db-mtime">${slotRange(p.slot).label}</span><span><b>${esc(p.name)}</b><small>${esc(s.title)}${s.key === 'suspension' ? ' (أيام التعليق فقط)' : ''}</small></span></div>`; }).join('') : '<div class="db-mnone">—</div>'}
    </div>`;
  }).join('')}</div>`;
}

/* =========================================================================
 * للرئيسية
 * ========================================================================= */
// مناوبات المستخدم اليوم: [{ post, slot, range }]
export async function myDutiesToday() {
  const dk = todayKey(); if (!dk) return [];
  const { data, error } = await R(() => sb.from('duty_plan').select('post_id, day_of_week, teacher_id').eq('teacher_id', currentUserId).eq('day_of_week', dk));
  if (error || !data || !data.length) return [];
  const { data: posts } = await R(() => sb.from('duty_posts').select('id, slot, name, active').in('id', data.map(x => x.post_id)));
  return (posts || []).filter(p => p.active && p.slot !== 'suspension').map(p => ({ post: p.name, slot: p.slot, title: SLOT[p.slot] ? SLOT[p.slot].title : '', range: slotRange(p.slot) }))
    .sort((a, b) => (a.range ? a.range.start : 0) - (b.range ? b.range.start : 0));
}

export async function renderMyDutyBanner() {
  const banner = $('my-duty-banner');
  if (!banner) return;
  banner.innerHTML = '';
  let list = [];
  try { list = await myDutiesToday(); } catch (e) { return; }
  if (!list.length) return;
  banner.innerHTML = `<div class="db-banner"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
    <span><strong>اليوم عندك مناوبة:</strong> ${list.map(d => `${esc(d.post)} <small>(${esc(d.title)} ${d.range ? d.range.label : ''})</small>`).join('، ')}</span></div>`;
}

// للوحة الإدارة: عدد مناوبات اليوم (الحضور يجي بالمرحلة الثانية)
export async function todayDutySummary(dayKey) {
  if (!dayKey) return { total: 0, missing: 0 };
  const [{ data, error }, { data: posts }] = await Promise.all([
    R(() => sb.from('duty_plan').select('post_id').eq('day_of_week', dayKey)),
    R(() => sb.from('duty_posts').select('id, slot, active')),
  ]);
  if (error) return { total: 0, missing: 0 };
  const ok = new Set((posts || []).filter(p => p.active && p.slot !== 'suspension').map(p => p.id));
  return { total: (data || []).filter(x => ok.has(x.post_id)).length, missing: 0 };
}
