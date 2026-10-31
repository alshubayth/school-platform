import { sb, currentSchoolId, currentUserId, currentProfile, isAdminOrDeputy, attFollowLevel, readScopedBySchool, writeWithSchool, gradeLabels, loadPeriodTimes, periodTime, fmtClock, printOrgName } from './core.js';

/* =========================================================================
 * تحضير الطلاب
 * - المعلم: «حصصي اليوم» من الجدول المدرسي، أو أي فصل آخر. يضغط على بطاقة الطالب للتبديل
 *   (حاضر ← غائب ← متأخر) ثم يحفظ. كل حصة لها تحضير واحد لكل فصل.
 * - المدير والوكيل: «متابعة اليوم» = الغائبون (مع خط الحصص لكل طالب) ورسائل أولياء الأمور،
 *   ومتابعة التحضير لكل فصل وحصة. الرسائل تُرسل عبر تقنيات من قاعدة البيانات.
 * الجداول: attendance_sessions / attendance_marks / attendance_messages
 * ========================================================================= */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const SHORT = { first_intermediate: 'أول', second_intermediate: 'ثاني', third_intermediate: 'ثالث' };
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const ORDER = ['present', 'absent', 'late'];
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoOf(new Date());
const shiftIso = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
const dateLong = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const clsName = (g, s) => `${SHORT[g] || gradeLabels[g] || g} ${s}`;
const timeTxt = (g, p) => { const t = periodTime(g, p); return t ? `${fmtClock(t.start)} – ${fmtClock(t.end)}` : ''; };
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const initials = n => { const w = String(n || '').split(/\s+/).filter(x => x && x !== 'بن'); return (w[0] ? w[0][0] : '') + (w.length > 1 ? w[w.length - 1].replace(/^ال(?=.{2})/, '')[0] : ''); };
const DEFAULT_TEMPLATE = 'ولي أمر الطالب {الاسم}، نفيدكم بغياب ابنكم عن المدرسة اليوم {اليوم} {التاريخ}. {المدرسة}';
const IC = {
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M4 20h16"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
};

const st = {
  tab: 'take', date: todayIso(), view: 'pick', period: 1, grade: '', section: '',
  classes: [], students: [], marks: new Map(), saved: new Map(), session: null, q: '',
  mySlots: [], done: new Map(),
};
const canFollow = () => isAdminOrDeputy() || !!attFollowLevel;
const canSend = () => isAdminOrDeputy() || attFollowLevel === 'send';
const dirty = () => { if (st.marks.size !== st.saved.size) return true; for (const [k, v] of st.marks) if (st.saved.get(k) !== v) return true; return false; };

/* ---------- الدخول ---------- */
export async function loadAttendanceModule() {
  const box = $('att-container');
  box.innerHTML = `<div class="av">
    <header class="av-hero">
      <div class="av-hero-t"><h3>تحضير الطلاب</h3><span id="av-hero-date"></span></div>
      <div class="av-hero-r">
        <div class="av-datenav" aria-label="اليوم">
          <button type="button" id="av-d-prev" aria-label="اليوم السابق">${IC.prev}</button>
          <label class="av-d-lbl"><span id="av-d-txt"></span><input type="date" id="av-d-in" max="${todayIso()}" aria-label="اختيار التاريخ" /></label>
          <button type="button" id="av-d-next" aria-label="اليوم التالي">${IC.next}</button>
        </div>
        ${canFollow() ? `<div class="av-tabs" role="tablist"><button type="button" data-tab="take" class="on">التحضير</button><button type="button" data-tab="day">متابعة اليوم</button></div>` : ''}
        ${isAdminOrDeputy() ? `<button type="button" class="av-permbtn" id="av-perms" title="صلاحيات متابعة الغياب">${IC.lock}صلاحيات المتابعة</button>` : ''}
      </div>
    </header>
    <section id="av-take"></section>
    <section id="av-day" class="hidden"></section>
    <div id="av-toast" class="av-toast hidden" role="status"></div>
  </div>`;
  document.querySelectorAll('.av-tabs [data-tab]').forEach(b => b.onclick = async () => {
    if (st.tab === b.dataset.tab) return;
    if (st.tab === 'take' && st.view === 'class' && dirty() && !confirm('لم يُحفظ التحضير الحالي، هل تريد المتابعة؟')) return;
    st.tab = b.dataset.tab;
    document.querySelectorAll('.av-tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b));
    $('av-take').classList.toggle('hidden', st.tab !== 'take');
    $('av-day').classList.toggle('hidden', st.tab !== 'day');
    if (st.tab === 'day') renderDay(); else { await refreshMySlots(); renderTake(); }
  });
  const pb = $('av-perms'); if (pb) pb.onclick = openFollowPerms;
  $('av-day').classList.toggle('av-nosend', !canSend());
  $('av-d-prev').onclick = () => setDate(shiftIso(st.date, -1));
  $('av-d-next').onclick = () => { if (st.date < todayIso()) setDate(shiftIso(st.date, 1)); };
  $('av-d-in').onchange = e => setDate(e.target.value || todayIso());
  paintDate();
  await loadPeriodTimes();
  const { data } = await sb.rpc('attendance_classes', { p_school: currentSchoolId || null });
  st.classes = data || [];
  st.period = currentPeriod();
  await refreshMySlots();
  renderTake();
}

function paintDate() {
  $('av-d-txt').textContent = st.date === todayIso() ? `اليوم · ${dateLong(st.date)}` : dateLong(st.date);
  $('av-d-in').value = st.date;
  $('av-d-next').disabled = st.date >= todayIso();
  $('av-hero-date').textContent = st.date === todayIso() ? 'حدد الغائب والمتأخر في حصتك، وتصل الإدارة النتيجة مباشرة' : 'تعرض تحضير يوم سابق، ويمكن تعديله';
}
async function setDate(iso) {
  if (iso > todayIso()) iso = todayIso();
  if (st.view === 'class' && dirty() && !confirm('لم يُحفظ التحضير الحالي، هل تريد المتابعة؟')) { paintDate(); return; }
  st.date = iso; st.view = 'pick';
  paintDate();
  if (st.tab === 'day') renderDay(); else { await refreshMySlots(); renderTake(); }
}

let toastT = null;
function toast(msg, type = 'ok') {
  const el = $('av-toast'); if (!el) return;
  clearTimeout(toastT); el.className = 'av-toast ' + type; el.textContent = msg;
  toastT = setTimeout(() => el.classList.add('hidden'), 4200);
}

function currentPeriod() {
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  for (const p of PERIODS) { const t = periodTime('', p); if (t && m < t.end) return p; }
  return 7;
}

async function refreshMySlots() {
  const day = DAY_KEYS[new Date(st.date + 'T00:00:00').getDay()];
  const [{ data: sched }, { data: sess }] = await Promise.all([
    readScopedBySchool(sc => { let q = sb.from('class_schedules').select('period_number, grade_level, class_section, subject_name').eq('teacher_id', currentUserId).eq('day_of_week', day); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
    readScopedBySchool(sc => { let q = sb.from('attendance_sessions').select('period, grade_level, class_section, absent_count, late_count, teacher_name').eq('att_date', st.date); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
  ]);
  st.mySlots = (sched || []).map(r => ({ period: r.period_number, grade: r.grade_level, section: String(r.class_section), subject: r.subject_name })).sort((a, b) => a.period - b.period);
  st.done = new Map((sess || []).map(s => [`${s.period}|${s.grade_level}|${s.class_section}`, s]));
}

/* ---------- التحضير: اختيار الحصة ---------- */
function renderTake() { if (st.view === 'class') renderClass(); else renderPick(); }

function renderPick() {
  const box = $('av-take');
  const isToday = st.date === todayIso();
  const nowP = isToday ? currentPeriod() : 0;
  const pending = st.mySlots.filter(s => !st.done.has(`${s.period}|${s.grade}|${s.section}`));
  const next = isToday ? pending.find(s => s.period >= nowP) || pending[0] : pending[0];
  const grades = GRADES.filter(g => st.classes.some(c => c.grade_level === g));
  const g = st.grade && grades.includes(st.grade) ? st.grade : grades[0] || '';
  box.innerHTML = `
    ${st.mySlots.length ? `
    ${next ? `<button type="button" class="av-next" data-p="${next.period}" data-g="${next.grade}" data-s="${next.section}">
      <span class="av-next-p"><small>الحصة</small><b>${next.period}</b></span>
      <span class="av-next-m"><small>${next.period === nowP ? 'حصتك الآن' : 'حصتك القادمة'}</small><b>${esc(gradeLabels[next.grade])} · فصل ${esc(next.section)}</b><span>${esc(next.subject || '')}${timeTxt(next.grade, next.period) ? ' · ' + timeTxt(next.grade, next.period) : ''}</span></span>
      <span class="av-next-go">ابدأ التحضير ${IC.next}</span>
    </button>` : `<div class="av-alldone">${IC.check}<b>حضّرت كل حصصك ${isToday ? 'اليوم' : 'في هذا اليوم'}</b></div>`}
    <div class="av-card">
      <div class="av-card-h"><b>حصصي ${isToday ? 'اليوم' : ''}</b><span>${plural(st.mySlots.length - pending.length, 'حصة واحدة حُضّرت', 'حصتان حُضّرتا', 'حصص حُضّرت', 'حصة حُضّرت')} من ${st.mySlots.length}</span></div>
      <ol class="av-slots">${st.mySlots.map(s => {
        const d = st.done.get(`${s.period}|${s.grade}|${s.section}`);
        const state = d ? 'done' : isToday && s.period === nowP ? 'now' : isToday && s.period < nowP ? 'late' : 'later';
        return `<li><button type="button" class="av-slot ${state}" data-p="${s.period}" data-g="${s.grade}" data-s="${s.section}">
          <span class="av-slot-n">${s.period}</span>
          <span class="av-slot-m"><b>${esc(clsName(s.grade, s.section))}</b><small>${esc(s.subject || '')}${timeTxt(s.grade, s.period) ? ' · ' + timeTxt(s.grade, s.period) : ''}</small></span>
          <span class="av-chip ${state}">${d ? (d.absent_count ? `غائب ${d.absent_count}` : 'لا غياب') : state === 'now' ? 'الآن' : state === 'late' ? 'لم تُحضَّر' : 'لاحقًا'}</span>
        </button></li>`;
      }).join('')}</ol>
    </div>` : `<div class="av-card av-noslots">لا توجد لك حصص في الجدول ${isToday ? 'اليوم' : 'في هذا اليوم'}، ويمكنك تحضير أي فصل من الأسفل.</div>`}
    <div class="av-card">
      <div class="av-card-h"><b>${st.mySlots.length ? 'فصل آخر' : 'اختر الفصل'}</b><span>للانتظار أو التحضير بدل زميل</span></div>
      <div class="av-pick-row"><span class="av-lbl">الحصة</span><div class="av-pchips">${PERIODS.map(p => `<button type="button" data-pp="${p}" class="${p === st.period ? 'on' : ''}">${p}</button>`).join('')}</div></div>
      <div class="av-pick-row"><span class="av-lbl">المرحلة</span><div class="av-seg">${grades.map(x => `<button type="button" data-gg="${x}" class="${x === g ? 'on' : ''}">${esc(gradeLabels[x])}</button>`).join('')}</div></div>
      <div class="av-secs">${st.classes.filter(c => c.grade_level === g).map(c => {
        const d = st.done.get(`${st.period}|${g}|${c.class_section}`);
        return `<button type="button" class="av-sec${d ? ' done' : ''}" data-p="${st.period}" data-g="${g}" data-s="${c.class_section}"><b>${esc(clsName(g, c.class_section))}</b><small>${c.students} طالبًا${d ? ' · ✓' : ''}</small></button>`;
      }).join('')}</div>
    </div>`;
  box.querySelectorAll('[data-p][data-g][data-s]').forEach(b => b.onclick = () => openClass(+b.dataset.p, b.dataset.g, b.dataset.s));
  box.querySelectorAll('[data-pp]').forEach(b => b.onclick = () => { st.period = +b.dataset.pp; st.grade = g; renderPick(); });
  box.querySelectorAll('[data-gg]').forEach(b => b.onclick = () => { st.grade = b.dataset.gg; renderPick(); });
}

/* ---------- التحضير: الفصل ---------- */
async function openClass(p, g, s) {
  st.period = p; st.grade = g; st.section = String(s); st.view = 'class'; st.q = '';
  st.marks = new Map(); st.saved = new Map(); st.session = null; st.students = [];
  const box = $('av-take');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const [{ data: studs, error }, { data: sess }] = await Promise.all([
    sb.rpc('attendance_class_students', { p_grade: g, p_section: Number(s), p_school: currentSchoolId || null }),
    readScopedBySchool(sc => { let q = sb.from('attendance_sessions').select('*').eq('att_date', st.date).eq('period', p).eq('grade_level', g).eq('class_section', Number(s)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q.maybeSingle(); }),
  ]);
  if (error) { box.innerHTML = `<div class="av-card av-noslots">تعذر تحميل الطلاب: ${esc(error.message)}</div>`; return; }
  st.students = studs || [];
  st.session = sess || null;
  if (st.session) {
    const { data: mk } = await sb.from('attendance_marks').select('student_id, status').eq('session_id', st.session.id);
    (mk || []).forEach(m => { st.marks.set(m.student_id, m.status); st.saved.set(m.student_id, m.status); });
  }
  renderClass();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function counts() {
  let a = 0, l = 0;
  st.marks.forEach(v => { if (v === 'absent') a++; else if (v === 'late') l++; });
  return { a, l, p: st.students.length - a - l };
}

function renderClass() {
  const box = $('av-take');
  const slot = st.mySlots.find(x => x.period === st.period && x.grade === st.grade && x.section === st.section);
  const c = counts();
  box.innerHTML = `
    <div class="av-class">
      <div class="av-class-h">
        <button type="button" class="av-back" id="av-back">${IC.back}<span>الحصص</span></button>
        <div class="av-class-t"><b>${esc(gradeLabels[st.grade])} · فصل ${esc(st.section)}</b>
          <span>الحصة ${st.period}${slot && slot.subject ? ' · ' + esc(slot.subject) : ''}${timeTxt(st.grade, st.period) ? ' · ' + timeTxt(st.grade, st.period) : ''}</span></div>
        <span class="av-saved-badge${st.session ? ' on' : ''}" id="av-saved">${st.session ? `${IC.check} حُضّرت${st.session.teacher_name && st.session.teacher_id !== currentUserId ? ' بواسطة ' + esc(st.session.teacher_name.split(' ')[0]) : ''}` : 'لم تُحضَّر'}</span>
      </div>
      <div class="av-stats">
        <span class="p"><b id="av-c-p">${c.p}</b>حاضر</span>
        <span class="a"><b id="av-c-a">${c.a}</b>غائب</span>
        <span class="l"><b id="av-c-l">${c.l}</b>متأخر</span>
      </div>
      <div class="av-tools">
        <label class="av-search">${IC.search}<input type="search" id="av-q" placeholder="ابحث عن طالب" autocomplete="off" /></label>
        <button type="button" class="av-reset" id="av-reset">الجميع حاضر</button>
      </div>
      <p class="av-hint">اضغط على الطالب للتبديل: <i class="p">حاضر</i> ← <i class="a">غائب</i> ← <i class="l">متأخر</i></p>
      ${st.students.length ? `<div class="av-grid" id="av-grid">${st.students.map((s, i) => cardHtml(s, i)).join('')}</div>` : '<div class="av-card av-noslots">لا يوجد طلاب في هذا الفصل</div>'}
    </div>
    <div class="av-savebar" id="av-savebar">
      <span id="av-sum"></span>
      <button type="button" class="av-save-btn" id="av-save"></button>
    </div>`;
  $('av-back').onclick = async () => { if (dirty() && !confirm('لم يُحفظ التحضير الحالي، هل تريد الرجوع؟')) return; st.view = 'pick'; await refreshMySlots(); renderPick(); };
  $('av-q').oninput = e => { st.q = e.target.value.trim(); box.querySelectorAll('.av-stu').forEach(el => { el.classList.toggle('hidden', !!st.q && !el.dataset.name.includes(st.q)); }); };
  $('av-reset').onclick = () => { [...st.marks.keys()].forEach(id => setMark(id, 'present')); };
  box.querySelectorAll('.av-stu').forEach(el => el.onclick = () => { const id = el.dataset.id; const cur = st.marks.get(id) || 'present'; setMark(id, ORDER[(ORDER.indexOf(cur) + 1) % 3]); });
  $('av-save').onclick = saveAttendance;
  paintSaveBar();
}

function cardHtml(s, i) {
  const m = st.marks.get(s.id) || 'present';
  return `<button type="button" class="av-stu ${m}" data-id="${s.id}" data-name="${esc(s.full_name)}" aria-label="${esc(s.full_name)}">
    <span class="av-av">${esc(initials(s.full_name))}</span>
    <span class="av-nm"><b>${esc(s.full_name)}</b><small>${i + 1}</small></span>
    <span class="av-st">${m === 'absent' ? IC.x + 'غائب' : m === 'late' ? IC.clock + 'متأخر' : IC.check + 'حاضر'}</span>
  </button>`;
}

function setMark(id, v) {
  if (v === 'present') st.marks.delete(id); else st.marks.set(id, v);
  const el = document.querySelector(`.av-stu[data-id="${id}"]`);
  if (el) { const s = st.students.find(x => x.id === id); const i = st.students.indexOf(s); const tmp = document.createElement('div'); tmp.innerHTML = cardHtml(s, i); const n = tmp.firstElementChild; n.classList.toggle('hidden', el.classList.contains('hidden')); n.classList.add('pop'); n.onclick = el.onclick; el.replaceWith(n); }
  const c = counts();
  $('av-c-p').textContent = c.p; $('av-c-a').textContent = c.a; $('av-c-l').textContent = c.l;
  paintSaveBar();
}

function paintSaveBar() {
  const c = counts(), d = dirty();
  $('av-sum').innerHTML = c.a || c.l ? `<b class="a">${plural(c.a, 'غائب واحد', 'غائبان', 'غائبين', 'غائبًا')}</b>${c.l ? ` · <b class="l">${plural(c.l, 'متأخر واحد', 'متأخران', 'متأخرين', 'متأخرًا')}</b>` : ''}` : 'لا يوجد غياب';
  const btn = $('av-save');
  btn.disabled = !!st.session && !d;
  btn.className = 'av-save-btn' + (!!st.session && !d ? ' done' : '');
  btn.innerHTML = st.session && !d ? `${IC.check} محفوظ` : st.session ? 'حفظ التعديل' : 'حفظ التحضير';
  $('av-savebar').classList.toggle('dirty', d || !st.session);
}

async function saveAttendance() {
  const btn = $('av-save');
  btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
  try {
    const c = counts();
    const slot = st.mySlots.find(s => s.period === st.period && s.grade === st.grade && s.section === st.section);
    const row = { att_date: st.date, period: st.period, grade_level: st.grade, class_section: Number(st.section), teacher_id: currentUserId,
      teacher_name: currentProfile.full_name || null, subject_name: slot ? slot.subject : (st.session && st.session.subject_name) || null,
      absent_count: c.a, late_count: c.l, updated_at: new Date().toISOString() };
    let sid = st.session && st.session.id;
    if (sid) {
      const { error } = await sb.from('attendance_sessions').update(row).eq('id', sid);
      if (error) throw error;
      const { error: e2 } = await sb.from('attendance_marks').delete().eq('session_id', sid);
      if (e2) throw e2;
    } else {
      const { data, error } = await writeWithSchool(extra => sb.from('attendance_sessions').insert({ ...row, ...extra }).select('*').single());
      if (error) {
        if (/duplicate|unique/i.test(error.message || '')) { toast('سبق تحضير هذه الحصة من جهاز آخر، أُعيد تحميلها', 'err'); await openClass(st.period, st.grade, st.section); return; }
        throw error;
      }
      sid = data.id; st.session = data;
    }
    const marks = [...st.marks.entries()].map(([student_id, status]) => ({ session_id: sid, student_id, status, att_date: st.date, period: st.period }));
    if (marks.length) {
      const { error } = await writeWithSchool(extra => sb.from('attendance_marks').insert(marks.map(m => ({ ...m, ...extra }))));
      if (error) throw error;
    }
    st.session = { ...st.session, ...row, id: sid };
    st.saved = new Map(st.marks);
    st.done.set(`${st.period}|${st.grade}|${st.section}`, { ...row });
    const sb2 = $('av-saved'); if (sb2) { sb2.classList.add('on'); sb2.innerHTML = `${IC.check} حُضّرت`; }
    paintSaveBar();
    toast(`✓ حُفظ تحضير ${clsName(st.grade, st.section)} · ${c.a ? plural(c.a, 'غائب واحد', 'غائبان', 'غائبين', 'غائبًا') : 'لا يوجد غياب'}`);
  } catch (e) {
    toast('تعذر الحفظ: ' + (e.message || e), 'err');
    paintSaveBar();
  }
}

/* ---------- متابعة اليوم (المدير والوكيل) ---------- */
let dayData = null;
const MIN_TAKEN = 2;   // أقل عدد حصص محضّرة لفصل الطالب قبل تحديد رسالته تلقائيًا
const dv = { sub: 'abs', filter: 'all', sel: new Set(), rp: 0 };

async function renderDay() {
  const box = $('av-day');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const date = st.date;
  const day = DAY_KEYS[new Date(date + 'T00:00:00').getDay()];
  const scoped = (t, cols, f) => readScopedBySchool(sc => { let q = f(sb.from(t).select(cols)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
  try { await syncSms(date); } catch { /* */ }
  const [{ data: sess }, { data: marks }, { data: msgs }, { data: sched }] = await Promise.all([
    scoped('attendance_sessions', '*', q => q.eq('att_date', date)),
    scoped('attendance_marks', 'student_id, status, period', q => q.eq('att_date', date)),
    scoped('attendance_messages', 'student_id, status, error, sent_at, body', q => q.eq('att_date', date)),
    scoped('class_schedules', 'period_number, grade_level, class_section, teacher_name, subject_name', q => q.eq('day_of_week', day)),
  ]);
  const ids = [...new Set((marks || []).map(m => m.student_id))];
  const studs = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('students').select('id, full_name, grade_level, class_section, mobile').in('id', ids.slice(i, i + 200));
    studs.push(...(data || []));
  }
  const sById = new Map(studs.map(s => [s.id, s]));
  const sessBy = new Map((sess || []).map(s => [`${s.period}|${s.grade_level}|${s.class_section}`, s]));
  const msgBy = new Map((msgs || []).map(m => [m.student_id, m]));
  const per = new Map();
  (marks || []).forEach(m => { if (!per.has(m.student_id)) per.set(m.student_id, new Map()); per.get(m.student_id).set(m.period, m.status); });
  const rows = [...per.entries()].map(([id, mp]) => {
    const s = sById.get(id) || { id, full_name: '—' };
    const taken = PERIODS.filter(p => sessBy.has(`${p}|${s.grade_level}|${s.class_section}`));
    const abs = [...mp].filter(([, v]) => v === 'absent').map(([p]) => p), late = [...mp].filter(([, v]) => v === 'late').map(([p]) => p);
    const m0 = msgBy.get(id) || null;
    // رسالة أُلغيت لأن الغياب أُلغي قبل إرسالها: لا تمنع إرسال رسالة جديدة إن عاد الطالب غائبًا
    return { ...s, mp, taken, abs, late, full: abs.length > 0 && abs.length >= taken.length, msg: m0 && m0.status !== 'cancelled' ? m0 : null, cancelled: !!(m0 && m0.status === 'cancelled') };
  }).sort((a, b) => GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level) || a.class_section - b.class_section || b.abs.length - a.abs.length || String(a.full_name).localeCompare(String(b.full_name), 'ar'));
  const expected = (sched || []).map(r => ({ ...r, key: `${r.period_number}|${r.grade_level}|${r.class_section}` }));
  const missing = expected.filter(r => !sessBy.has(r.key) && (date < todayIso() || (periodTime(r.grade_level, r.period_number) || { end: 0 }).end <= new Date().getHours() * 60 + new Date().getMinutes()));
  dayData = { date, rows, sess: sess || [], sessBy, expected, missing };
  // لا يُحدَّد تلقائيًا من حُضّرت له حصة واحدة فقط (قد يكون متأخرًا وصل بعد الحصة الأولى)
  dv.sel = new Set(rows.filter(r => r.full && r.taken.length >= MIN_TAKEN && !r.msg && r.mobile).map(r => r.id));
  const absent = rows.filter(r => r.abs.length);
  const sentN = rows.filter(r => r.msg && r.msg.status === 'sent').length;
  const doneN = (sess || []).length, expN = new Set(expected.map(r => r.key)).size;
  const pct = expN ? Math.min(100, Math.round((doneN / expN) * 100)) : 0;
  box.innerHTML = `
    <div class="av-kpis">
      <div class="av-kpi"><span class="av-ring" style="--p:${pct}"><b>${pct}%</b></span><div><b>${doneN}<small> / ${expN || '—'}</small></b><span>حصة حُضّرت</span></div></div>
      <div class="av-kpi a"><div><b>${absent.length}</b><span>طالبًا غاب حصة أو أكثر</span></div></div>
      <div class="av-kpi f"><div><b>${absent.filter(r => r.full).length}</b><span>غائب كل الحصص المحضّرة</span></div></div>
      <div class="av-kpi s"><div><b>${sentN}</b><span>رسالة أُرسلت</span></div></div>
    </div>
    <div class="av-subtabs" role="tablist">
      <button type="button" data-sub="abs" class="${dv.sub === 'abs' ? 'on' : ''}">${IC.msg}الغائبون والرسائل <i>${absent.length}</i></button>
      <button type="button" data-sub="round" class="${dv.sub === 'round' ? 'on' : ''}">${IC.check}جولة الفصول</button>
      <button type="button" data-sub="log" class="${dv.sub === 'log' ? 'on' : ''}">${IC.clock}سجل الرسائل</button>
      <button type="button" data-sub="track" class="${dv.sub === 'track' ? 'on' : ''}">${IC.grid}متابعة التحضير${missing.length ? ` <i class="warn">${missing.length}</i>` : ''}</button>
    </div>
    <div id="av-sub"></div>`;
  box.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => {
    const from = dv.sub; dv.sub = b.dataset.sub;
    // العودة من جولة الفصول أو المتابعة: تُحمَّل البيانات من جديد حتى لا تُعرض حالة قديمة
    if (dv.sub === 'abs' && from !== 'abs') { renderDay(); return; }
    box.querySelectorAll('[data-sub]').forEach(x => x.classList.toggle('on', x === b)); renderSub();
  });
  renderSub();
}

function renderSub() { if (dv.sub === 'track') renderTrack(); else if (dv.sub === 'round') renderRound(); else if (dv.sub === 'log') renderLog(); else renderAbsent(); }

function dotsHtml(r) {
  return `<span class="av-dots" aria-hidden="true">${PERIODS.map(p => { const v = r.mp.get(p); const t = r.taken.includes(p); return `<i class="${v === 'absent' ? 'a' : v === 'late' ? 'l' : t ? 'p' : ''}" title="الحصة ${p}: ${v === 'absent' ? 'غائب' : v === 'late' ? 'متأخر' : t ? 'حاضر' : 'لم تُحضَّر'}">${p}</i>`; }).join('')}</span>`;
}
const msgPill = r => (r.cancelled && !r.msg ? '<span class="av-ms cancelled" title="لم تُرسل لأن الغياب أُلغي قبل الإرسال">أُلغيت قبل الإرسال</span>' : r.msg ? `<span class="av-ms ${r.msg.status}" title="${esc(r.msg.error || '')}">${r.msg.status === 'sent' ? 'أُرسلت ✓' : r.msg.status === 'failed' ? 'تعذر الإرسال' : r.msg.status === 'sending' ? 'جارٍ الإرسال' : 'بانتظار الإرسال'}</span>` : !r.mobile ? '<span class="av-ms failed">بلا جوال</span>' : '');

function renderAbsent() {
  const box = $('av-sub');
  const all = dayData.rows.filter(r => r.abs.length || r.late.length);
  const F = { all: () => true, full: r => r.full, part: r => r.abs.length && !r.full, late: r => r.late.length && !r.abs.length };
  const list = all.filter(F[dv.filter] || F.all);
  const cnt = k => all.filter(F[k]).length;
  const groups = new Map();
  list.forEach(r => { const k = clsName(r.grade_level, r.class_section); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const pendingN = dayData.rows.filter(r => r.msg && r.msg.status === 'pending').length;
  const failedN = dayData.rows.filter(r => r.msg && r.msg.status === 'failed' && r.mobile).length;
  box.innerHTML = `
    ${all.length ? `
    <div class="av-filters">${[['all', 'الكل'], ['full', 'غياب كامل'], ['part', 'غياب جزئي'], ['late', 'متأخرون']].map(([k, l]) => `<button type="button" data-f="${k}" class="${dv.filter === k ? 'on' : ''}">${l} <i>${cnt(k)}</i></button>`).join('')}</div>
    ${pendingN || failedN ? `<div class="av-banner">${pendingN ? `<span>${plural(pendingN, 'رسالة معتمدة', 'رسالتان معتمدتان', 'رسائل معتمدة', 'رسالة معتمدة')} لم تُرسل بعد</span><button type="button" id="av-send-pending">إرسالها الآن</button>` : ''}${failedN ? `<span>${plural(failedN, 'رسالة تعذر إرسالها', 'رسالتان تعذر إرسالهما', 'رسائل تعذر إرسالها', 'رسالة تعذر إرسالها')}</span><button type="button" id="av-retry">إعادة المحاولة</button>` : ''}</div>` : ''}
    <div class="av-abs">${[...groups.entries()].map(([k, rs]) => `
      <div class="av-grp"><div class="av-grp-h"><b>${esc(k)}</b><span>${plural(rs.length, 'طالب واحد', 'طالبان', 'طلاب', 'طالبًا')}</span></div>
      <ul>${rs.map(r => { const can = !r.msg && r.mobile && r.abs.length; return `<li class="${dv.sel.has(r.id) ? 'sel' : ''}${can ? '' : ' nosel'}" data-id="${r.id}">
        <span class="av-ck">${can ? `<input type="checkbox" data-id="${r.id}" ${dv.sel.has(r.id) ? 'checked' : ''} aria-label="تحديد ${esc(r.full_name)}" />` : ''}</span>
        <span class="av-abs-m"><b>${esc(r.full_name)}</b><small>${r.full && r.taken.length < MIN_TAKEN ? `<span class="av-one">غائب الحصة ${r.abs[0]} فقط (الوحيدة المحضّرة)، قد يكون متأخرًا</span>` : r.full ? `غائب كل الحصص المحضّرة` : r.abs.length ? `غائب ${plural(r.abs.length, 'حصة واحدة', 'حصتين', 'حصص', 'حصة')} من ${r.taken.length}` : `متأخر ${plural(r.late.length, 'حصة واحدة', 'حصتين', 'حصص', 'حصة')}`}</small></span>
        ${dotsHtml(r)}
        ${msgPill(r)}
      </li>`; }).join('')}</ul></div>`).join('') || '<div class="av-card av-noslots">لا يوجد طلاب في هذا التصنيف</div>'}</div>
    <details class="av-card av-tplbox"><summary><b>نص رسالة ولي الأمر</b><span id="av-prev"></span></summary>
      <textarea id="av-tpl" rows="3">${esc(loadTpl())}</textarea>
      <div class="av-vars">${['{الاسم}', '{اليوم}', '{التاريخ}', '{المدرسة}'].map(v => `<button type="button" data-v="${v}">${v}</button>`).join('')}<button type="button" class="av-tpl-reset" id="av-tpl-reset">النص الافتراضي</button></div>
    </details>
    <p class="av-sms" id="av-sms"></p>
    <div class="av-actionbar${dv.sel.size ? ' show' : ''}" id="av-actbar"><span id="av-act-t"></span><button type="button" id="av-send">إرسال لأولياء الأمور</button></div>`
    : `<div class="av-card av-empty-day">${IC.check}<b>لا يوجد غياب مسجّل في هذا اليوم</b><span>${dayData.sess.length ? `حُضّرت ${plural(dayData.sess.length, 'حصة واحدة', 'حصتان', 'حصص', 'حصة')} بلا غياب` : 'لم تُحضَّر أي حصة بعد'}</span></div>`}`;
  if (!all.length) return;
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { dv.filter = b.dataset.f; renderAbsent(); });
  if (canSend()) box.querySelectorAll('.av-abs li:not(.nosel)').forEach(li => li.onclick = e => {
    const id = li.dataset.id; const cb = li.querySelector('input');
    if (e.target !== cb) cb.checked = !cb.checked;
    cb.checked ? dv.sel.add(id) : dv.sel.delete(id);
    li.classList.toggle('sel', cb.checked); paintAct();
  });
  const tpl = $('av-tpl');
  const prev = () => { const r = dayData.rows.find(x => dv.sel.has(x.id)) || dayData.rows[0]; $('av-prev').textContent = r ? bodyFor(r, tpl.value) : ''; };
  tpl.oninput = () => { saveTpl(tpl.value); prev(); };
  box.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { const p = tpl.selectionStart || tpl.value.length; tpl.value = tpl.value.slice(0, p) + b.dataset.v + tpl.value.slice(p); tpl.focus(); saveTpl(tpl.value); prev(); });
  $('av-tpl-reset').onclick = () => { tpl.value = DEFAULT_TEMPLATE; saveTpl(tpl.value); prev(); };
  prev();
  $('av-send').onclick = () => approveMessages([...dv.sel], tpl.value);
  const sp = $('av-send-pending'); if (sp) sp.onclick = async () => { sp.disabled = true; sp.textContent = 'جارٍ الإرسال...'; const r = await sendPending(dayData.date); toast(r.msg, r.ok ? 'ok' : 'err'); renderDay(); };
  const rt = $('av-retry'); if (rt) rt.onclick = async () => { rt.disabled = true; rt.textContent = 'جارٍ الإرسال...'; await retryFailed(); };
  paintAct();
  if (canSend()) smsStatusLine();
}
function paintAct() {
  const n = dv.sel.size, bar = $('av-actbar'); if (!bar) return;
  bar.classList.toggle('show', n > 0);
  $('av-act-t').textContent = n ? `${plural(n, 'طالب واحد محدد', 'طالبان محددان', 'طلاب محددون', 'طالبًا محددًا')}` : '';
  $('av-send').textContent = n ? `إرسال ${plural(n, 'رسالة واحدة', 'رسالتين', 'رسائل', 'رسالة')}` : 'إرسال لأولياء الأمور';
}

function renderTrack() {
  const box = $('av-sub');
  const { sessBy, expected, missing } = dayData;
  const expSet = new Set(expected.map(r => r.key));
  const classes = st.classes.slice().sort((a, b) => GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level) || a.class_section - b.class_section);
  box.innerHTML = `
    ${missing.length ? (() => {
      // الحصص المنتهية غير المحضّرة مجمّعة حسب المعلم
      const byT = new Map();
      missing.forEach(r => { const t = r.teacher_name || 'بدون معلم'; if (!byT.has(t)) byT.set(t, []); byT.get(t).push(r); });
      const list = [...byT.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ar'));
      return `<div class="av-card"><div class="av-card-h"><b>حصص انتهى وقتها ولم تُحضَّر</b><span>${plural(missing.length, 'حصة واحدة', 'حصتان', 'حصص', 'حصة')} · ${plural(list.length, 'معلم واحد', 'معلمان', 'معلمين', 'معلمًا')}</span></div>
      <ul class="av-miss">${list.map(([t, rs]) => `<li><span class="av-miss-n">${rs.length}</span><span class="av-miss-m"><b>${esc(t)}</b><span>${rs.sort((a, b) => a.period_number - b.period_number).map(r => `<i>ح${r.period_number} · ${esc(clsName(r.grade_level, r.class_section))}</i>`).join('')}</span></span></li>`).join('')}</ul></div>`;
    })()
      : `<div class="av-card av-empty-day small">${IC.check}<b>كل الحصص المنتهية حُضّرت</b></div>`}
    <div class="av-card">
      <div class="av-card-h"><b>خريطة التحضير</b><span class="av-legend"><i class="ok"></i>حُضّرت <i class="ab"></i>فيها غياب <i class="ms"></i>لم تُحضَّر</span></div>
      <div class="av-heat"><table><thead><tr><th></th>${PERIODS.map(p => `<th>${p}</th>`).join('')}</tr></thead><tbody>
      ${classes.map(c => `<tr><th>${esc(clsName(c.grade_level, c.class_section))}</th>${PERIODS.map(p => {
        const k = `${p}|${c.grade_level}|${c.class_section}`, s = sessBy.get(k);
        if (s) return `<td class="${s.absent_count ? 'ab' : 'ok'}" title="${esc(s.teacher_name || '')}">${s.absent_count || '✓'}</td>`;
        return expSet.has(k) ? '<td class="ms" title="لم تُحضَّر">·</td>' : '<td></td>';
      }).join('')}</tr>`).join('')}</tbody></table></div>
    </div>`;
}

/* ---------- الرسائل ---------- */
const TPL_KEY = 'att-sms-template';
const loadTpl = () => { try { return localStorage.getItem(TPL_KEY) || DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; } };
const saveTpl = v => { try { localStorage.setItem(TPL_KEY, v); } catch { /* */ } };
function bodyFor(r, tpl) {
  const dname = new Date(dayData.date + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
  const [yy, mm, dd] = dayData.date.split('-');
  const first = String(r.full_name || '').trim().split(/\s+/)[0] || '';
  return tpl.replace(/\{الاسم\}/g, first).replace(/\{اليوم\}/g, dname).replace(/\{التاريخ\}/g, `${Number(dd)}/${Number(mm)}/${yy}م`).replace(/\{المدرسة\}/g, printOrgName() || '');
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const SCH = () => ({ p_school: currentSchoolId || null });
async function syncSms(date) { const { data } = await sb.rpc('attendance_sms_sync', { p_date: date, ...SCH() }); return data || {}; }
async function ensureSender() {
  const { data: q } = await sb.rpc('sms_status_request', SCH());
  if (!q || q.configured === false) return { configured: false };
  if (q.error) return { error: q.error };
  for (let i = 0; i < 6; i++) {
    await wait(1500);
    const { data: r } = await sb.rpc('sms_status_result', { p_senders_req: q.senders_req, p_balance_req: q.balance_req });
    if (r && !r.pending) return r;
  }
  return { error: 'لم يصل رد من خدمة الرسائل، حاول مرة أخرى' };
}
async function sendPending(date) {
  try {
    let { data, error } = await sb.rpc('attendance_sms_send', { p_date: date, ...SCH() });
    if (!error && data && /المرسل/.test(data.error || '')) { await ensureSender(); ({ data, error } = await sb.rpc('attendance_sms_send', { p_date: date, ...SCH() })); }
    if (error) return { ok: false, msg: 'تعذر الإرسال: ' + error.message };
    if (data && data.configured === false) return { ok: false, msg: 'خدمة الرسائل غير مربوطة بعد' };
    if (data && data.error) return { ok: false, msg: 'تعذر الإرسال: ' + data.error };
    let res = {};
    for (let i = 0; i < 5; i++) { await wait(2000); res = await syncSms(date); if (!res.waiting) break; }
    const n = res.sent || 0, f = (res.failed || 0) + (data.invalid || 0), c = data.cancelled || 0;
    return { ok: !f && !res.waiting, msg: `✓ أُرسلت ${plural(n, 'رسالة واحدة', 'رسالتان', 'رسائل', 'رسالة')}${f ? `، وتعذر إرسال ${f}` : ''}${res.waiting ? `، و${res.waiting} جارٍ إرسالها` : ''}${c ? `، وأُلغيت ${c} لأن الغياب أُلغي قبل الإرسال` : ''}` };
  } catch (e) { return { ok: false, msg: 'تعذر الإرسال: ' + (e.message || e) }; }
}
async function retryFailed() {
  const ids = dayData.rows.filter(r => r.msg && r.msg.status === 'failed' && r.mobile).map(r => r.id);
  if (!ids.length) return;
  await sb.from('attendance_messages').update({ status: 'pending', error: null }).eq('att_date', dayData.date).in('student_id', ids).eq('status', 'failed');
  const r = await sendPending(dayData.date);
  toast(r.msg, r.ok ? 'ok' : 'err');
  renderDay();
}
async function smsStatusLine() {
  const el = $('av-sms'); if (!el) return;
  el.innerHTML = '<span class="av-ms pending">خدمة الرسائل</span> جارٍ الفحص...';
  try {
    const d = await ensureSender();
    if (!$('av-sms')) return;
    if (d.configured === false) { el.innerHTML = '<span class="av-ms failed">خدمة الرسائل غير مربوطة</span>'; return; }
    if (d.error) { el.innerHTML = `<span class="av-ms failed">خدمة الرسائل</span> ${esc(d.error)}`; return; }
    const bal = d.balance && d.balance.balance != null ? ` · الرصيد ${esc(Math.round(Number(d.balance.balance) * 100) / 100)} ${esc(d.balance.currency || '')}` : '';
    el.innerHTML = `<span class="av-ms sent">خدمة الرسائل مربوطة</span> المرسل ${esc(d.sender || '—')}${bal} · لا تُرسل رسالة ثانية للطالب نفسه في اليوم نفسه`;
  } catch { el.textContent = ''; }
}
async function approveMessages(ids, tpl) {
  if (!ids.length || !dayData) return;
  // ١) تحديث: إعادة تحميل التحضير من قاعدة البيانات وعرضه كما هو الآن
  const btn0 = $('av-send'); if (btn0) { btn0.disabled = true; btn0.textContent = 'جارٍ تحديث التحضير...'; }
  const picked = new Set(ids);
  const before = new Map(dayData.rows.map(r => [r.id, r.full_name]));
  await renderDay();
  if (dv.sub !== 'abs') return;
  // ٢) تحقق: يبقى من التحديد من ما زال غائبًا ولم تُرسل له رسالة
  const rows = dayData.rows.filter(r => picked.has(r.id) && r.abs.length && !r.msg && r.mobile);
  const changed = [...picked].filter(id => !rows.some(r => r.id === id)).map(id => {
    const r = dayData.rows.find(x => x.id === id);
    return { name: (r && r.full_name) || before.get(id) || '—', why: !r || !r.abs.length ? 'أُلغي غيابه' : r.msg ? 'أُرسلت له رسالة' : 'بلا جوال' };
  });
  dv.sel = new Set(rows.map(r => r.id));
  renderAbsent();
  if (!rows.length) { toast(changed.length ? 'لم يبقَ طالب غائب في التحديد بعد تحديث التحضير' : 'لا توجد رسائل للإرسال', 'err'); return; }
  const one = rows.filter(r => r.taken.length < MIN_TAKEN).map(r => r.full_name);
  const ex = changed.length ? `\n\nاستُبعد بعد التحديث ${plural(changed.length, 'طالب واحد', 'طالبان', 'طلاب', 'طالبًا')}:\n${changed.slice(0, 8).map(c => `• ${c.name} (${c.why})`).join('\n')}${changed.length > 8 ? '\n...' : ''}` : '';
  const warn = one.length ? `\n\nتنبيه: ${plural(one.length, 'طالب واحد', 'طالبان', 'طلاب', 'طالبًا')} حُضّرت لفصولهم حصة واحدة فقط، وقد يكونون متأخرين:\n${one.slice(0, 8).join('\n')}${one.length > 8 ? '\n...' : ''}` : '';
  // ٣) إرسال بعد التأكيد (وقاعدة البيانات تتحقق مرة أخيرة لحظة الإرسال)
  if (!confirm(`تم تحديث التحضير ✓\nإرسال رسالة غياب لأولياء أمور ${plural(rows.length, 'طالب واحد', 'طالبين', 'طلاب', 'طالبًا')}؟${ex}${warn}\n\nمثال:\n${bodyFor(rows[0], tpl)}`)) return;
 const btn = $('av-send'); btn.disabled = true; btn.textContent = 'جارٍ الإرسال...';
  const cIds = rows.filter(r => r.cancelled).map(r => r.id);
  if (cIds.length) await sb.from('attendance_messages').delete().eq('att_date', dayData.date).eq('status', 'cancelled').in('student_id', cIds);
  const payload = rows.map(r => ({ att_date: dayData.date, student_id: r.id, mobile: r.mobile, body: bodyFor(r, tpl), status: 'pending', approved_by: currentUserId }));
  const { error } = await writeWithSchool(extra => sb.from('attendance_messages').insert(payload.map(p => ({ ...p, ...extra }))));
  if (error && !/duplicate|unique/i.test(error.message || '')) { toast('تعذر الاعتماد: ' + error.message, 'err'); btn.disabled = false; paintAct(); return; }
  const r = await sendPending(dayData.date);
  toast(r.msg, r.ok ? 'ok' : 'err');
  renderDay();
}


/* ---------- جولة الفصول: الوكيل أو المرشد يختار الحصة، فتظهر الفصول تحت بعض بغائبيها ----------
 * لكل طالب غائب أو متأخر زر «حاضر» لتصحيح التحضير، ولكل فصل «إضافة غائب».
 * إن لم تكن الحصة محضّرة، تُنشأ بإضافة أول غائب باسم من أضافه. */
async function renderRound() {
  const box = $('av-sub');
  if (!dv.rp) dv.rp = st.date === todayIso() ? currentPeriod() : 1;
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const date = st.date, p = dv.rp;
  const day = DAY_KEYS[new Date(date + 'T00:00:00').getDay()];
  const scoped = (t, cols, f) => readScopedBySchool(sc => { let q = f(sb.from(t).select(cols)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
  const [{ data: sess }, { data: marks }, { data: sched }] = await Promise.all([
    scoped('attendance_sessions', '*', q => q.eq('att_date', date).eq('period', p)),
    scoped('attendance_marks', 'id, session_id, student_id, status', q => q.eq('att_date', date).eq('period', p)),
    scoped('class_schedules', 'grade_level, class_section, teacher_name, subject_name', q => q.eq('day_of_week', day).eq('period_number', p)),
  ]);
  const ids = [...new Set((marks || []).map(m => m.student_id))];
  const names = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('students').select('id, full_name').in('id', ids.slice(i, i + 200));
    (data || []).forEach(x => names.set(x.id, x.full_name));
  }
  const sessBy = new Map((sess || []).map(x => [`${x.grade_level}|${x.class_section}`, x]));
  const schedBy = new Map((sched || []).map(x => [`${x.grade_level}|${x.class_section}`, x]));
  const marksBy = new Map();
  (marks || []).forEach(m => { if (!marksBy.has(m.session_id)) marksBy.set(m.session_id, []); marksBy.get(m.session_id).push(m); });
  const classes = st.classes.slice().sort((a, b) => GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level) || a.class_section - b.class_section);
  const taken = classes.filter(c => sessBy.has(`${c.grade_level}|${c.class_section}`)).length;
  const absN = (marks || []).filter(m => m.status === 'absent').length;
  box.innerHTML = `
    <div class="av-card av-round-top">
      <div class="av-pick-row"><span class="av-lbl">الحصة</span><div class="av-pchips">${PERIODS.map(x => `<button type="button" data-rp="${x}" class="${x === p ? 'on' : ''}">${x}</button>`).join('')}</div>
        <span class="av-round-sum">${timeTxt('', p) ? timeTxt('', p) + ' · ' : ''}حُضّر ${taken} من ${classes.length} فصول · ${plural(absN, 'غائب واحد', 'غائبان', 'غائبين', 'غائبًا')}</span></div>
    </div>
    <div class="av-round">${classes.map(c => {
      const k = `${c.grade_level}|${c.class_section}`, ss = sessBy.get(k), sc = schedBy.get(k);
      const ms = ss ? (marksBy.get(ss.id) || []).slice().sort((a, b) => (a.status === b.status ? String(names.get(a.student_id)).localeCompare(String(names.get(b.student_id)), 'ar') : a.status === 'absent' ? -1 : 1)) : [];
      return `<div class="av-rc${ss ? '' : ' none'}" data-g="${c.grade_level}" data-s="${c.class_section}">
        <div class="av-rc-h">
          <span class="av-rc-n">${esc(clsName(c.grade_level, c.class_section))}</span>
          <span class="av-rc-t">${sc ? `${esc(sc.subject_name || '')}${sc.teacher_name ? ' · ' + esc(sc.teacher_name) : ''}` : '<em>لا توجد حصة في الجدول</em>'}</span>
          <span class="av-chip ${ss ? 'done' : 'late'}">${ss ? (ms.filter(m => m.status === 'absent').length ? `غائب ${ms.filter(m => m.status === 'absent').length}` : 'لا غياب') : 'لم تُحضَّر'}</span>
        </div>
        ${ms.length ? `<ul class="av-rc-list">${ms.map(m => `<li class="${m.status}">
          <span class="av-rc-s">${m.status === 'absent' ? 'غائب' : 'متأخر'}</span>
          <b>${esc(names.get(m.student_id) || '—')}</b>
          ${m.status === 'absent' ? `<button type="button" class="av-rc-late" data-mark="${m.id}" data-to="late">متأخر</button>` : ''}
          <button type="button" class="av-rc-ok" data-mark="${m.id}" data-to="present">${IC.check}حاضر</button>
        </li>`).join('')}</ul>` : ''}
        <div class="av-rc-add"><button type="button" class="av-rc-addbtn" data-add="${k}">＋ إضافة غائب</button></div>
      </div>`;
    }).join('')}</div>`;
  box.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { dv.rp = +b.dataset.rp; renderRound(); });
  box.querySelectorAll('[data-mark]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const m = (marks || []).find(x => x.id === b.dataset.mark);
    const r = b.dataset.to === 'present' ? await sb.from('attendance_marks').delete().eq('id', m.id) : await sb.from('attendance_marks').update({ status: b.dataset.to }).eq('id', m.id);
    if (r.error) { toast('تعذر التعديل: ' + r.error.message, 'err'); b.disabled = false; return; }
    await recountSession(m.session_id);
    toast(b.dataset.to === 'present' ? `✓ ${names.get(m.student_id) || 'الطالب'} حاضر` : '✓ تم التعديل إلى متأخر');
    renderRound();
  });
  box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openAddAbsence(b.closest('.av-rc'), b.dataset.add, sessBy.get(b.dataset.add), schedBy.get(b.dataset.add), new Set(((sessBy.get(b.dataset.add) && marksBy.get(sessBy.get(b.dataset.add).id)) || []).map(m => m.student_id))));
}

async function recountSession(sid) {
  const { data } = await sb.from('attendance_marks').select('status').eq('session_id', sid);
  const a = (data || []).filter(x => x.status === 'absent').length, l = (data || []).filter(x => x.status === 'late').length;
  await sb.from('attendance_sessions').update({ absent_count: a, late_count: l, updated_at: new Date().toISOString() }).eq('id', sid);
}

async function openAddAbsence(card, key, sess, sched, already) {
  const old = card.querySelector('.av-rc-pick'); if (old) { old.remove(); return; }
  const [g, s] = key.split('|');
  const wrap = document.createElement('div');
  wrap.className = 'av-rc-pick';
  wrap.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  card.appendChild(wrap);
  const { data: studs } = await sb.rpc('attendance_class_students', { p_grade: g, p_section: Number(s), p_school: currentSchoolId || null });
  const list = (studs || []).filter(x => !already.has(x.id));
  wrap.innerHTML = `<label class="av-search">${IC.search}<input type="search" placeholder="ابحث عن الطالب" autocomplete="off" /></label>
    <ul>${list.map(x => `<li data-n="${esc(x.full_name)}"><b>${esc(x.full_name)}</b><button type="button" class="av-rc-abs" data-sid="${x.id}" data-st="absent">غائب</button><button type="button" class="av-rc-late" data-sid="${x.id}" data-st="late">متأخر</button></li>`).join('') || '<li><span>كل طلاب الفصل مسجّلون</span></li>'}</ul>`;
  const inp = wrap.querySelector('input');
  inp.focus();
  inp.oninput = () => wrap.querySelectorAll('li[data-n]').forEach(li => li.classList.toggle('hidden', !!inp.value.trim() && !li.dataset.n.includes(inp.value.trim())));
  wrap.querySelectorAll('[data-sid]').forEach(b => b.onclick = async () => {
    wrap.querySelectorAll('button').forEach(x => { x.disabled = true; });
    let sid = sess && sess.id;
    if (!sid) {
      const row = { att_date: st.date, period: dv.rp, grade_level: g, class_section: Number(s), teacher_id: currentUserId, teacher_name: currentProfile.full_name || null, subject_name: sched ? sched.subject_name : null, absent_count: 0, late_count: 0 };
      let { data, error } = await writeWithSchool(extra => sb.from('attendance_sessions').insert({ ...row, ...extra }).select('id').single());
      if (error && /duplicate|unique/i.test(error.message || '')) {
        ({ data } = await readScopedBySchool(sc => { let q = sb.from('attendance_sessions').select('id').eq('att_date', st.date).eq('period', dv.rp).eq('grade_level', g).eq('class_section', Number(s)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q.maybeSingle(); }));
        error = null;
      }
      if (error || !data) { toast('تعذر الحفظ: ' + ((error && error.message) || ''), 'err'); renderRound(); return; }
      sid = data.id;
    }
    const { error } = await writeWithSchool(extra => sb.from('attendance_marks').insert({ session_id: sid, student_id: b.dataset.sid, status: b.dataset.st, att_date: st.date, period: dv.rp, ...extra }));
    if (error && !/duplicate|unique/i.test(error.message || '')) { toast('تعذر الحفظ: ' + error.message, 'err'); renderRound(); return; }
    await recountSession(sid);
    toast(`✓ أُضيف ${b.closest('li').dataset.n.split(' ')[0]} ${b.dataset.st === 'absent' ? 'غائبًا' : 'متأخرًا'}`);
    renderRound();
  });
}


/* ---------- صلاحيات متابعة الغياب: يمنحها المدير أو الوكيل لمعلم (مثل المرشد الطلابي) ---------- */
async function openFollowPerms() {
  let ov = $('av-perm-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'av-perm-ov'; ov.className = 'av-perm-ov'; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="av-perm" role="dialog" aria-label="صلاحيات متابعة الغياب"><div class="av-perm-h"><b>صلاحيات متابعة الغياب</b><button type="button" class="av-perm-x" aria-label="إغلاق">✕</button></div><div class="tx-loading"><span></span><span></span><span></span></div></div>`;
  ov.classList.remove('hidden');
  const close = () => ov.classList.add('hidden');
  ov.onclick = e => { if (e.target === ov) close(); };
  ov.querySelector('.av-perm-x').onclick = close;
  let tq = sb.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name');
  if (currentSchoolId) tq = tq.eq('school_id', currentSchoolId);
  let fq = sb.from('attendance_followers').select('id, profile_id, can_send');
  if (currentSchoolId) fq = fq.eq('school_id', currentSchoolId);
  const [{ data: teachers }, { data: fol, error }] = await Promise.all([tq, fq]);
  if (error) { ov.querySelector('.tx-loading').outerHTML = `<p class="av-perm-err">تعذر تحميل الصلاحيات: ${esc(error.message)}</p>`; return; }
  const nameOf = new Map((teachers || []).map(t => [t.id, t.full_name]));
  const granted = new Set((fol || []).map(f => f.profile_id));
  const avail = (teachers || []).filter(t => !granted.has(t.id));
  ov.querySelector('.av-perm').innerHTML = `
    <div class="av-perm-h"><b>صلاحيات متابعة الغياب</b><button type="button" class="av-perm-x" aria-label="إغلاق">✕</button></div>
    <p class="av-perm-d">تتيح للمعلم (مثل المرشد الطلابي) تبويب «متابعة اليوم»: عرض الغائبين وجولة الفصول وتعديل التحضير. ويمكن السماح له أيضًا باعتماد رسائل أولياء الأمور وإرسالها.</p>
    <div class="av-perm-add">
      <select id="av-perm-who">${avail.length ? avail.map(t => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('') : '<option value="">لا يوجد معلمون متاحون</option>'}</select>
      <label class="av-perm-chk"><input type="checkbox" id="av-perm-send" /> إرسال الرسائل</label>
      <button type="button" id="av-perm-addbtn"${avail.length ? '' : ' disabled'}>منح الصلاحية</button>
    </div>
    <ul class="av-perm-list">${(fol || []).length ? fol.map(f => `<li data-id="${f.id}">
      <b>${esc(nameOf.get(f.profile_id) || '—')}</b>
      <label class="av-perm-chk"><input type="checkbox" data-send ${f.can_send ? 'checked' : ''} /> إرسال الرسائل</label>
      <button type="button" class="av-perm-del" data-del>إلغاء</button></li>`).join('') : '<li class="empty">لم تُمنح الصلاحية لأحد بعد</li>'}</ul>`;
  ov.querySelector('.av-perm-x').onclick = close;
  const addBtn = $('av-perm-addbtn');
  addBtn.onclick = async () => {
    const pid = $('av-perm-who').value; if (!pid) return;
    addBtn.disabled = true;
    const { error: e } = await writeWithSchool(extra => sb.from('attendance_followers').insert({ profile_id: pid, can_send: $('av-perm-send').checked, granted_by: currentUserId, ...extra }));
    if (e) toast(/duplicate|unique/i.test(e.message) ? 'لدى هذا المعلم الصلاحية بالفعل' : 'تعذر منح الصلاحية: ' + e.message, 'err');
    else toast('✓ مُنحت الصلاحية، وتظهر للمعلم عند دخوله التالي');
    openFollowPerms();
  };
  ov.querySelectorAll('.av-perm-list li[data-id]').forEach(li => {
    li.querySelector('[data-send]').onchange = async e => {
      const { error: x } = await sb.from('attendance_followers').update({ can_send: e.target.checked }).eq('id', li.dataset.id);
      toast(x ? 'تعذر التعديل: ' + x.message : '✓ حُفظ التعديل', x ? 'err' : 'ok');
    };
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('هل تريد إلغاء صلاحية المتابعة لهذا المعلم؟')) return;
      const { error: x } = await sb.from('attendance_followers').delete().eq('id', li.dataset.id);
      if (x) toast('تعذر الإلغاء: ' + x.message, 'err');
      openFollowPerms();
    };
  });
}


/* ---------- سجل الرسائل: أرشيف رسائل الغياب بالتاريخ والوقت ---------- */
const LOG = { from: null, to: null, q: '', status: 'all', grade: '', data: null, open: null };
const MS_LABEL = { sent: 'أُرسلت', failed: 'تعذر الإرسال', cancelled: 'أُلغيت قبل الإرسال', pending: 'بانتظار الإرسال', sending: 'جارٍ الإرسال' };
const clockOf = ts => (ts ? new Date(ts).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' }) : '—');
async function loadLog() {
  const scoped = (t, cols, f) => readScopedBySchool(sc => { let q = f(sb.from(t).select(cols)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await scoped('attendance_messages', 'id, att_date, student_id, mobile, body, status, error, approved_by, approved_at, sent_at', q => q.gte('att_date', LOG.from).lte('att_date', LOG.to).order('att_date', { ascending: false }).range(from, from + 999));
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(out.map(m => m.student_id))], pids = [...new Set(out.map(m => m.approved_by).filter(Boolean))];
  const studs = new Map(), people = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('students').select('id, full_name, grade_level, class_section').in('id', ids.slice(i, i + 200));
    (data || []).forEach(x => studs.set(x.id, x));
  }
  if (pids.length) { const { data } = await sb.from('profiles').select('id, full_name').in('id', pids); (data || []).forEach(x => people.set(x.id, x.full_name)); }
  LOG.data = out.map(m => ({ ...m, st: studs.get(m.student_id) || { full_name: '—' }, by: people.get(m.approved_by) || '' }));
}
async function renderLog() {
  const box = $('av-sub');
  if (!LOG.to) { LOG.to = todayIso(); LOG.from = shiftIso(LOG.to, -30); }
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  try { await loadLog(); } catch (e) { box.innerHTML = `<div class="av-card av-noslots">تعذر تحميل السجل: ${esc(e.message || e)}</div>`; return; }
  drawLog();
}
function logFiltered() {
  const q = String(LOG.q || '').trim();
  return LOG.data.filter(m => (LOG.status === 'all' || m.status === LOG.status) && (!LOG.grade || m.st.grade_level === LOG.grade)
    && (!q || String(m.st.full_name).includes(q) || String(m.mobile || '').includes(q)));
}
function drawLog() {
  const box = $('av-sub');
  const all = LOG.data, list = logFiltered();
  const cnt = k => all.filter(m => m.status === k).length;
  const days = new Map();
  list.forEach(m => { if (!days.has(m.att_date)) days.set(m.att_date, []); days.get(m.att_date).push(m); });
  const maxDay = Math.max(1, ...[...days.values()].map(v => v.length));
  box.innerHTML = `<div class="ml">
    <div class="ml-top">
      <div class="ml-range"><label>من<input type="date" id="ml-from" value="${LOG.from}" max="${todayIso()}"></label><label>إلى<input type="date" id="ml-to" value="${LOG.to}" max="${todayIso()}"></label>
        <div class="ml-quick">${[[0, 'اليوم'], [7, '٧ أيام'], [30, '٣٠ يومًا'], [90, '٩٠ يومًا']].map(([n, t]) => `<button type="button" data-days="${n}">${t}</button>`).join('')}</div></div>
      <button type="button" class="ml-export" id="ml-csv">${IC.down || ''}تصدير Excel</button>
    </div>
    <div class="ml-stats">
      <button type="button" data-st="all" class="${LOG.status === 'all' ? 'on' : ''}"><b>${all.length}</b><span>كل الرسائل</span></button>
      <button type="button" data-st="sent" class="ok${LOG.status === 'sent' ? ' on' : ''}"><b>${cnt('sent')}</b><span>أُرسلت</span></button>
      <button type="button" data-st="failed" class="bad${LOG.status === 'failed' ? ' on' : ''}"><b>${cnt('failed')}</b><span>تعذر إرسالها</span></button>
      <button type="button" data-st="cancelled" class="mut${LOG.status === 'cancelled' ? ' on' : ''}"><b>${cnt('cancelled')}</b><span>أُلغيت قبل الإرسال</span></button>
    </div>
    <div class="ml-tools"><label class="av-search">${IC.search}<input type="search" id="ml-q" placeholder="ابحث باسم الطالب أو رقم الجوال" value="${esc(LOG.q)}"></label>
      <select id="ml-grade"><option value="">كل الصفوف</option>${GRADES.map(g => `<option value="${g}"${LOG.grade === g ? ' selected' : ''}>${esc(gradeLabels[g] || g)}</option>`).join('')}</select></div>
    ${days.size ? `<div class="ml-days">${[...days.entries()].map(([d, ms], di) => {
      const sent = ms.filter(m => m.status === 'sent').length;
      const batches = new Map(); ms.forEach(m => { const k = m.approved_at ? m.approved_at.slice(0, 16) : '—'; if (!batches.has(k)) batches.set(k, []); batches.get(k).push(m); });
      return `<section class="ml-day" style="animation-delay:${Math.min(di * 0.05, 0.6)}s">
        <header><span class="ml-dot"></span><div><b>${esc(dateLong(d))}</b><small>${d}</small></div><span class="ml-bar"><i style="width:${Math.round(ms.length / maxDay * 100)}%"></i></span><span class="ml-n">${plural(ms.length, 'رسالة واحدة', 'رسالتان', 'رسائل', 'رسالة')}${sent !== ms.length ? ` · أُرسل ${sent}` : ''}</span></header>
        ${[...batches.entries()].map(([k, bm]) => `<div class="ml-batch"><div class="ml-bh">${IC.clock}<b>${esc(clockOf(bm[0].approved_at))}</b><span>${esc(bm[0].by ? 'اعتمدها ' + bm[0].by : '')}</span><em>${plural(bm.length, 'رسالة واحدة', 'رسالتان', 'رسائل', 'رسالة')}</em></div>
          <ul>${bm.map(m => `<li class="${m.status}" data-id="${m.id}"><span class="ml-st ${m.status}">${esc(MS_LABEL[m.status] || m.status)}</span><b>${esc(m.st.full_name)}</b><small>${esc(clsName(m.st.grade_level, m.st.class_section))}</small><span class="ml-t">${m.sent_at ? 'وصلت ' + esc(clockOf(m.sent_at)) : ''}</span>
            ${LOG.open === m.id ? `<div class="ml-body"><p>${esc(m.body)}</p><span>الجوال: <bdi>${esc(m.mobile || '—')}</bdi>${m.error ? ` · ${esc(m.error)}` : ''}</span></div>` : ''}</li>`).join('')}</ul></div>`).join('')}
      </section>`;
    }).join('')}</div>` : '<div class="av-card av-noslots">لا توجد رسائل في هذه الفترة</div>'}
  </div>`;
  const reload = () => renderLog();
  $('ml-from').onchange = e => { LOG.from = e.target.value || LOG.from; if (LOG.from > LOG.to) LOG.to = LOG.from; reload(); };
  $('ml-to').onchange = e => { LOG.to = e.target.value || LOG.to; if (LOG.to < LOG.from) LOG.from = LOG.to; reload(); };
  box.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { LOG.to = todayIso(); LOG.from = shiftIso(LOG.to, -(+b.dataset.days)); reload(); });
  box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { LOG.status = b.dataset.st; drawLog(); });
  $('ml-grade').onchange = e => { LOG.grade = e.target.value; drawLog(); };
  const qi = $('ml-q'); qi.oninput = () => { LOG.q = qi.value; const pos = qi.selectionStart; drawLog(); const n = $('ml-q'); n.focus(); n.setSelectionRange(pos, pos); };
  box.querySelectorAll('.ml-day li').forEach(li => li.onclick = () => { LOG.open = LOG.open === li.dataset.id ? null : li.dataset.id; drawLog(); });
  $('ml-csv').onclick = () => {
    const rows = [['التاريخ', 'وقت الاعتماد', 'وقت الوصول', 'الطالب', 'الصف', 'الفصل', 'الجوال', 'الحالة', 'اعتمدها', 'نص الرسالة', 'ملاحظة']]
      .concat(logFiltered().map(m => [m.att_date, clockOf(m.approved_at), m.sent_at ? clockOf(m.sent_at) : '', m.st.full_name, gradeLabels[m.st.grade_level] || '', m.st.class_section || '', m.mobile || '', MS_LABEL[m.status] || m.status, m.by, m.body, m.error || '']));
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `سجل رسائل الغياب ${LOG.from} إلى ${LOG.to}.csv`; document.body.appendChild(a); a.click(); a.remove();
  };
}
