import { sb, currentSchoolId, currentUserId, currentProfile, isAdminOrDeputy, readScopedBySchool, writeWithSchool, gradeLabels, loadPeriodTimes, periodTime, fmtClock, printOrgName } from './core.js';

/* =========================================================================
 * تحضير الطلاب: المعلم يختار الحصة والفصل، ويحدد الغائب والمتأخر، ويحفظ.
 * - كل حصة لها تحضير واحد لكل فصل (attendance_sessions)، والغائب والمتأخر في attendance_marks.
 * - المعلم يحضّر أي فصل، وتظهر له «حصصي اليوم» من الجدول المدرسي للوصول السريع.
 * - الوكيل والمدير: «غياب اليوم» = ما حُضّر من الحصص، والغائبون، واعتماد رسائل أولياء الأمور
 *   (attendance_messages)، وتُرسل عبر خدمة الرسائل بعد ربطها.
 * ========================================================================= */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const SHORT = { first_intermediate: 'أول', second_intermediate: 'ثاني', third_intermediate: 'ثالث' };
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoOf(new Date());
const dayName = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const clsName = (g, s) => `${SHORT[g] || gradeLabels[g] || g} ${s}`;
// وقت الحصة نصًا: «من 9:00 إلى 9:45» (يُقرأ صحيحًا داخل القوائم المنسدلة)
const timeTxt = (g, p) => { const t = periodTime(g, p); return t ? `من ${fmtClock(t.start)} إلى ${fmtClock(t.end)}` : ''; };
const DEFAULT_TEMPLATE = 'ولي أمر الطالب {الاسم}، نفيدكم بغياب ابنكم عن المدرسة اليوم {اليوم} {التاريخ}. {المدرسة}';

const st = {
  tab: 'take', date: todayIso(), period: 1, grade: '', section: '',
  classes: [], students: [], marks: new Map(), session: null, dirty: false,
  mySlots: [], doneKeys: new Set(),
};

export async function loadAttendanceModule() {
  const box = $('att-container');
  box.innerHTML = shellHtml();
  wireShell();
  await loadPeriodTimes();
  const { data } = await sb.rpc('attendance_classes', { p_school: currentSchoolId || null });
  st.classes = data || [];
  st.period = currentPeriod();
  await refreshMySlots();
  if (!st.grade) { const slot = st.mySlots.find(s => s.period === st.period) || null; if (slot) { st.grade = slot.grade; st.section = String(slot.section); } }
  renderTakeControls();
  await loadClass();
}

function shellHtml() {
  return `<div class="att-page">
    <div class="att-head">
      <div><h3>تحضير الطلاب</h3><p>اختر الحصة والفصل، وحدد الغائب والمتأخر، ثم احفظ.</p></div>
      ${isAdminOrDeputy() ? `<div class="sp-seg" role="tablist"><button type="button" data-tab="take" class="on">التحضير</button><button type="button" data-tab="day">غياب اليوم والرسائل</button></div>` : ''}
    </div>
    <div id="att-take"></div>
    <div id="att-day" class="hidden"></div>
    <div id="att-toast" class="tx-toast hidden" role="status"></div>
  </div>`;
}
function wireShell() {
  document.querySelectorAll('.att-head [data-tab]').forEach(b => b.onclick = async () => {
    if (st.tab === 'take' && st.dirty && !confirm('لم يُحفظ التحضير الحالي، هل تريد المتابعة؟')) return;
    st.tab = b.dataset.tab;
    document.querySelectorAll('.att-head [data-tab]').forEach(x => x.classList.toggle('on', x === b));
    $('att-take').classList.toggle('hidden', st.tab !== 'take');
    $('att-day').classList.toggle('hidden', st.tab !== 'day');
    if (st.tab === 'day') await renderDay();
  });
}
let toastT = null;
function toast(msg, type = 'ok') {
  const el = $('att-toast'); if (!el) return;
  clearTimeout(toastT); el.className = 'tx-toast ' + type; el.textContent = msg; el.classList.remove('hidden');
  toastT = setTimeout(() => el.classList.add('hidden'), 5000);
}

// الحصة الحالية حسب أوقات الحصص (أو الأولى قبل بداية اليوم)
function currentPeriod() {
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  for (const p of PERIODS) { const t = periodTime('', p); if (t && m < t.end) return p; }
  return 7;
}

/* ---------- حصصي اليوم (من الجدول المدرسي) ---------- */
async function refreshMySlots() {
  st.mySlots = [];
  st.doneKeys = new Set();
  const day = DAY_KEYS[new Date(st.date + 'T00:00:00').getDay()];
  const [{ data: sched }, { data: sess }] = await Promise.all([
    readScopedBySchool(sc => { let q = sb.from('class_schedules').select('period_number, grade_level, class_section, subject_name').eq('teacher_id', currentUserId).eq('day_of_week', day); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
    readScopedBySchool(sc => { let q = sb.from('attendance_sessions').select('period, grade_level, class_section').eq('att_date', st.date); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
  ]);
  st.mySlots = (sched || []).map(r => ({ period: r.period_number, grade: r.grade_level, section: r.class_section, subject: r.subject_name })).sort((a, b) => a.period - b.period);
  (sess || []).forEach(s => st.doneKeys.add(`${s.period}|${s.grade_level}|${s.class_section}`));
}

/* ---------- التحضير ---------- */
function renderTakeControls() {
  const box = $('att-take');
  const sections = st.classes.filter(c => c.grade_level === st.grade).map(c => String(c.class_section));
  box.innerHTML = `
    ${st.mySlots.length ? `<div class="att-slots"><b>حصصي ${st.date === todayIso() ? 'اليوم' : 'في هذا اليوم'}</b><div>${st.mySlots.map(s => {
      const k = `${s.period}|${s.grade}|${s.section}`;
      const on = s.period === st.period && s.grade === st.grade && String(s.section) === st.section;
      return `<button type="button" class="att-slot${on ? ' on' : ''}${st.doneKeys.has(k) ? ' done' : ''}" data-p="${s.period}" data-g="${s.grade}" data-s="${s.section}">
        <i>الحصة ${s.period}</i><span>${esc(clsName(s.grade, s.section))}</span><small>${st.doneKeys.has(k) ? '✓ حُضّرت' : esc(s.subject || '')}</small></button>`;
    }).join('')}</div></div>` : ''}
    <div class="att-ctrl">
      <label>التاريخ<input type="date" id="att-date" value="${st.date}" max="${todayIso()}" /></label>
      <label>الحصة<select id="att-period">${PERIODS.map(p => `<option value="${p}"${p === st.period ? ' selected' : ''}>الحصة ${p}${timeTxt(st.grade, p) ? ' · ' + timeTxt(st.grade, p) : ''}</option>`).join('')}</select></label>
      <label>المرحلة<select id="att-grade"><option value="">اختر...</option>${GRADES.filter(g => st.classes.some(c => c.grade_level === g)).map(g => `<option value="${g}"${g === st.grade ? ' selected' : ''}>${gradeLabels[g]}</option>`).join('')}</select></label>
      <label>الفصل<select id="att-section"><option value="">اختر...</option>${sections.map(s => `<option value="${s}"${s === st.section ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
    </div>
    <div id="att-list"></div>`;
  const guard = () => !st.dirty || confirm('لم يُحفظ التحضير الحالي، هل تريد المتابعة؟');
  box.querySelectorAll('.att-slot').forEach(b => b.onclick = async () => {
    if (!guard()) return;
    st.period = +b.dataset.p; st.grade = b.dataset.g; st.section = b.dataset.s;
    renderTakeControls(); await loadClass();
  });
  $('att-date').onchange = async e => { if (!guard()) { e.target.value = st.date; return; } st.date = e.target.value || todayIso(); await refreshMySlots(); renderTakeControls(); await loadClass(); };
  $('att-period').onchange = async e => { if (!guard()) { e.target.value = st.period; return; } st.period = +e.target.value; renderTakeControls(); await loadClass(); };
  $('att-grade').onchange = async e => { if (!guard()) { e.target.value = st.grade; return; } st.grade = e.target.value; st.section = ''; renderTakeControls(); await loadClass(); };
  $('att-section').onchange = async e => { if (!guard()) { e.target.value = st.section; return; } st.section = e.target.value; renderTakeControls(); await loadClass(); };
}

async function loadClass() {
  const box = $('att-list');
  st.dirty = false; st.session = null; st.marks = new Map(); st.students = [];
  if (!st.grade || !st.section) { box.innerHTML = '<div class="att-empty">اختر المرحلة والفصل لعرض الطلاب</div>'; return; }
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const [{ data: studs, error }, { data: sess }] = await Promise.all([
    sb.rpc('attendance_class_students', { p_grade: st.grade, p_section: Number(st.section), p_school: currentSchoolId || null }),
    readScopedBySchool(sc => { let q = sb.from('attendance_sessions').select('*').eq('att_date', st.date).eq('period', st.period).eq('grade_level', st.grade).eq('class_section', Number(st.section)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q.maybeSingle(); }),
  ]);
  if (error) { box.innerHTML = `<div class="att-empty">تعذر تحميل الطلاب: ${esc(error.message)}</div>`; return; }
  st.students = studs || [];
  st.session = sess || null;
  if (st.session) {
    const { data: mk } = await sb.from('attendance_marks').select('student_id, status').eq('session_id', st.session.id);
    (mk || []).forEach(m => st.marks.set(m.student_id, m.status));
  }
  renderList();
}

function renderList() {
  const box = $('att-list');
  if (!st.students.length) { box.innerHTML = '<div class="att-empty">لا يوجد طلاب في هذا الفصل</div>'; return; }
  const n = st.students.length;
  const abs = [...st.marks.values()].filter(v => v === 'absent').length, late = [...st.marks.values()].filter(v => v === 'late').length;
  const tt = timeTxt(st.grade, st.period);
  box.innerHTML = `
    <div class="att-bar">
      <div class="att-bar-t"><b>${esc(gradeLabels[st.grade])} · فصل ${esc(st.section)} · الحصة ${st.period}</b>
        <span>${st.session ? `حُضّرت ${st.session.teacher_name ? 'بواسطة ' + esc(st.session.teacher_name) : ''} · آخر حفظ ${new Date(st.session.updated_at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}` : 'لم تُحضَّر بعد'}${tt ? ' · ' + tt : ''}</span></div>
      <div class="att-counts"><span class="p"><b>${n - abs - late}</b>حاضر</span><span class="a"><b>${abs}</b>غائب</span><span class="l"><b>${late}</b>متأخر</span></div>
    </div>
    <div class="att-tools"><button type="button" class="text-action-btn" id="att-all-present">الجميع حاضر</button><span>اضغط على اسم الطالب للتبديل: حاضر ← غائب ← متأخر</span></div>
    <ol class="att-students">${st.students.map((s, i) => { const m = st.marks.get(s.id) || 'present'; return `<li class="${m}" data-id="${s.id}">
      <span class="att-n">${i + 1}</span>
      <button type="button" class="att-name" data-cycle="${s.id}">${esc(s.full_name)}</button>
      <span class="att-seg" role="group" aria-label="حالة ${esc(s.full_name)}">
        <button type="button" data-set="present" class="${m === 'present' ? 'on' : ''}">حاضر</button>
        <button type="button" data-set="absent" class="${m === 'absent' ? 'on' : ''}">غائب</button>
        <button type="button" data-set="late" class="${m === 'late' ? 'on' : ''}">متأخر</button>
      </span></li>`; }).join('')}</ol>
    <div class="att-save"><button type="button" class="btn-primary" id="att-save">${st.session ? 'حفظ التعديل' : 'حفظ التحضير'}</button><span id="att-save-note">${st.dirty ? 'توجد تغييرات لم تُحفظ' : ''}</span></div>`;
  const setMark = (id, v) => {
    if (v === 'present') st.marks.delete(id); else st.marks.set(id, v);
    st.dirty = true;
    const li = box.querySelector(`li[data-id="${id}"]`);
    li.className = v;
    li.querySelectorAll('[data-set]').forEach(b => b.classList.toggle('on', b.dataset.set === v));
    const a = [...st.marks.values()].filter(x => x === 'absent').length, l = [...st.marks.values()].filter(x => x === 'late').length;
    box.querySelector('.att-counts .p b').textContent = n - a - l;
    box.querySelector('.att-counts .a b').textContent = a;
    box.querySelector('.att-counts .l b').textContent = l;
    $('att-save-note').textContent = 'توجد تغييرات لم تُحفظ';
  };
  box.querySelectorAll('[data-set]').forEach(b => b.onclick = () => setMark(b.closest('li').dataset.id, b.dataset.set));
  const order = ['present', 'absent', 'late'];
  box.querySelectorAll('[data-cycle]').forEach(b => b.onclick = () => { const id = b.dataset.cycle; const cur = st.marks.get(id) || 'present'; setMark(id, order[(order.indexOf(cur) + 1) % 3]); });
  $('att-all-present').onclick = () => { st.students.forEach(s => { if (st.marks.has(s.id)) setMark(s.id, 'present'); }); };
  $('att-save').onclick = saveAttendance;
}

async function saveAttendance() {
  const btn = $('att-save');
  btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
  try {
    const abs = [...st.marks.values()].filter(v => v === 'absent').length, late = [...st.marks.values()].filter(v => v === 'late').length;
    const slot = st.mySlots.find(s => s.period === st.period && s.grade === st.grade && String(s.section) === st.section);
    const row = { att_date: st.date, period: st.period, grade_level: st.grade, class_section: Number(st.section), teacher_id: currentUserId,
      teacher_name: currentProfile.full_name || null, subject_name: slot ? slot.subject : (st.session && st.session.subject_name) || null,
      absent_count: abs, late_count: late, updated_at: new Date().toISOString() };
    let sessionId = st.session && st.session.id;
    if (sessionId) {
      const { error } = await sb.from('attendance_sessions').update(row).eq('id', sessionId);
      if (error) throw error;
      const { error: e2 } = await sb.from('attendance_marks').delete().eq('session_id', sessionId);
      if (e2) throw e2;
    } else {
      const { data, error } = await writeWithSchool(extra => sb.from('attendance_sessions').insert({ ...row, ...extra }).select('*').single());
      if (error) {
        // حُضّر الفصل للتو من جهاز آخر: نحمّله ونعيد المحاولة كتعديل
        if (/duplicate|unique/i.test(error.message || '')) { toast('سبق تحضير هذه الحصة من جهاز آخر، أُعيد تحميلها', 'err'); await loadClass(); return; }
        throw error;
      }
      sessionId = data.id; st.session = data;
    }
    const marks = [...st.marks.entries()].map(([student_id, status]) => ({ session_id: sessionId, student_id, status, att_date: st.date, period: st.period }));
    if (marks.length) {
      const { error } = await writeWithSchool(extra => sb.from('attendance_marks').insert(marks.map(m => ({ ...m, ...extra }))));
      if (error) throw error;
    }
    st.dirty = false;
    st.doneKeys.add(`${st.period}|${st.grade}|${st.section}`);
    toast(`✓ حُفظ تحضير ${clsName(st.grade, st.section)} الحصة ${st.period}: ${abs ? `غائب ${abs}` : 'لا يوجد غائب'}${late ? `، متأخر ${late}` : ''}`);
    renderTakeControls();
    await loadClass();
  } catch (e) {
    toast('تعذر الحفظ: ' + (e.message || e), 'err');
    btn.disabled = false; btn.textContent = 'حفظ التحضير';
  }
}

/* ---------- غياب اليوم واعتماد الرسائل (المدير والوكيل) ---------- */
let dayData = null;
async function renderDay() {
  const box = $('att-day');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const date = st.date;
  const day = DAY_KEYS[new Date(date + 'T00:00:00').getDay()];
  const scoped = (t, cols, f) => readScopedBySchool(sc => { let q = f(sb.from(t).select(cols)); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
  try { await syncSms(date); } catch { /* */ }
  const [{ data: sess }, { data: marks }, { data: msgs }, { data: sched }] = await Promise.all([
    scoped('attendance_sessions', '*', q => q.eq('att_date', date)),
    scoped('attendance_marks', 'student_id, status, period, session_id', q => q.eq('att_date', date)),
    scoped('attendance_messages', 'student_id, status, error, sent_at', q => q.eq('att_date', date)),
    scoped('class_schedules', 'period_number, grade_level, class_section', q => q.eq('day_of_week', day)),
  ]);
  const ids = [...new Set((marks || []).map(m => m.student_id))];
  let studs = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('students').select('id, full_name, grade_level, class_section, mobile').in('id', ids.slice(i, i + 200));
    studs.push(...(data || []));
  }
  const sById = new Map(studs.map(s => [s.id, s]));
  const sessByClass = new Map();
  (sess || []).forEach(s => { const k = `${s.grade_level}|${s.class_section}`; if (!sessByClass.has(k)) sessByClass.set(k, []); sessByClass.get(k).push(s); });
  const msgBy = new Map((msgs || []).map(m => [m.student_id, m]));
  const byStu = new Map();
  (marks || []).forEach(m => { if (!byStu.has(m.student_id)) byStu.set(m.student_id, { abs: [], late: [] }); byStu.get(m.student_id)[m.status === 'absent' ? 'abs' : 'late'].push(m.period); });
  const rows = [...byStu.entries()].map(([id, v]) => {
    const s = sById.get(id) || { id, full_name: '—' };
    const done = (sessByClass.get(`${s.grade_level}|${s.class_section}`) || []).length;
    return { ...s, abs: v.abs.sort((a, b) => a - b), late: v.late.sort((a, b) => a - b), done, msg: msgBy.get(id) || null };
  }).sort((a, b) => GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level) || a.class_section - b.class_section || b.abs.length - a.abs.length || String(a.full_name).localeCompare(String(b.full_name), 'ar'));
  // الحصص المتوقعة من الجدول، مقابل ما حُضّر
  const expected = new Set((sched || []).map(r => `${r.period_number}|${r.grade_level}|${r.class_section}`));
  const doneSet = new Set((sess || []).map(s => `${s.period}|${s.grade_level}|${s.class_section}`));
  const classes = [...new Set([...st.classes.map(c => `${c.grade_level}|${c.class_section}`)])];
  dayData = { date, rows, sess: sess || [] };
  const absentRows = rows.filter(r => r.abs.length);
  const fullDay = r => r.abs.length && r.abs.length >= r.done;
  box.innerHTML = `
    <div class="att-ctrl"><label>التاريخ<input type="date" id="att-day-date" value="${date}" max="${todayIso()}" /></label><span class="att-dayname">${esc(dayName(date))}</span></div>
    <div class="kp-tiles att-tiles">
      <div><b>${doneSet.size}</b><span>حصة حُضّرت${expected.size ? ` من ${expected.size} في الجدول` : ''}</span></div>
      <div class="behind"><b>${absentRows.length}</b><span>طالبًا غاب حصة أو أكثر</span></div>
      <div class="near"><b>${absentRows.filter(fullDay).length}</b><span>غائب كل الحصص المحضّرة</span></div>
      <div class="met"><b>${rows.filter(r => r.msg).length}</b><span>رسالة معتمدة</span></div>
    </div>
    <details class="att-grid-wrap"${doneSet.size ? '' : ' open'}><summary>متابعة التحضير لكل فصل وحصة</summary>
      <div class="att-grid"><table><thead><tr><th>الفصل</th>${PERIODS.map(p => `<th>${p}</th>`).join('')}</tr></thead><tbody>
      ${classes.sort((a, b) => { const [ga, sa] = a.split('|'), [gb, sb2] = b.split('|'); return GRADES.indexOf(ga) - GRADES.indexOf(gb) || sa - sb2; }).map(k => { const [g, s] = k.split('|'); return `<tr><th>${esc(clsName(g, s))}</th>${PERIODS.map(p => {
        const key = `${p}|${g}|${s}`; const ss = (sess || []).find(x => x.period === p && x.grade_level === g && String(x.class_section) === s);
        return ss ? `<td class="ok" title="${esc(ss.teacher_name || '')}">${ss.absent_count ? ss.absent_count : '✓'}</td>` : expected.has(key) ? '<td class="miss" title="لم تُحضَّر">—</td>' : '<td></td>';
      }).join('')}</tr>`; }).join('')}</tbody></table>
      <p class="att-hint">✓ حُضّرت بلا غياب · الرقم = عدد الغائبين · — حصة في الجدول لم تُحضَّر بعد</p></div>
    </details>
    <div class="att-msg-card">
      <div class="att-msg-h"><b>الغائبون ورسائل أولياء الأمور</b><span>حدد الطلاب ثم اعتمد إرسال الرسائل</span></div>
      <label class="att-tpl">نص الرسالة<textarea id="att-tpl" rows="2">${esc(loadTpl())}</textarea><small>المتغيرات: {الاسم} {اليوم} {التاريخ} {المدرسة}</small></label>
      ${absentRows.length ? `<div class="att-msg-tools"><label><input type="checkbox" id="att-sel-all"> تحديد الكل</label><button type="button" class="text-action-btn" id="att-sel-full">تحديد الغائبين كل الحصص</button></div>
      <ul class="att-abs-list">${absentRows.map(r => `<li class="${r.msg ? 'sent' : ''}">
        <input type="checkbox" class="att-sel" data-id="${r.id}" ${r.msg ? 'disabled' : fullDay(r) ? 'checked' : ''} aria-label="تحديد ${esc(r.full_name)}" />
        <span class="att-abs-name"><b>${esc(r.full_name)}</b><small>${esc(clsName(r.grade_level, r.class_section))} · ${fullDay(r) ? `غائب كل الحصص المحضّرة (${r.abs.length})` : `غائب الحصة ${r.abs.join('، ')} من ${r.done} محضّرة`}${r.late.length ? ` · متأخر الحصة ${r.late.join('، ')}` : ''}</small></span>
        ${r.msg ? `<span class="att-ms ${r.msg.status}" title="${esc(r.msg.error || '')}">${r.msg.status === 'sent' ? 'أُرسلت' : r.msg.status === 'failed' ? 'تعذر الإرسال' : r.msg.status === 'sending' ? 'جارٍ الإرسال' : 'معتمدة، بانتظار الإرسال'}</span>` : r.mobile ? '' : '<span class="att-ms failed">لا يوجد جوال</span>'}
      </li>`).join('')}</ul>
      <div class="att-save"><button type="button" class="btn-primary" id="att-send">اعتماد الرسائل</button><span id="att-send-note"></span></div>`
      : '<p class="att-empty">لا يوجد غياب مسجّل في هذا اليوم.</p>'}
      ${rows.some(r => r.msg && r.msg.status === 'failed' && r.mobile) ? '<button type="button" class="text-action-btn att-retry" id="att-retry">إعادة إرسال الرسائل التي لم تُرسل</button>' : ''}
      <p class="att-hint" id="att-sms-status"></p>
      <p class="att-hint">لا تُرسل رسالة ثانية للطالب نفسه في اليوم نفسه.</p>
    </div>`;
  $('att-day-date').onchange = async e => { st.date = e.target.value || todayIso(); await refreshMySlots(); renderTakeControls(); await loadClass(); await renderDay(); };
  const tpl = $('att-tpl');
  tpl.onchange = () => saveTpl(tpl.value);
  const sels = () => [...box.querySelectorAll('.att-sel:not(:disabled)')];
  const syncSend = () => { const n = sels().filter(c => c.checked).length; const b = $('att-send'); if (b) { b.disabled = !n; b.textContent = n ? `اعتماد ${n === 1 ? 'رسالة واحدة' : n === 2 ? 'رسالتين' : n + (n <= 10 ? ' رسائل' : ' رسالة')}` : 'اعتماد الرسائل'; } };
  box.querySelectorAll('.att-sel').forEach(c => c.onchange = syncSend);
  const all = $('att-sel-all'); if (all) all.onchange = () => { sels().forEach(c => { c.checked = all.checked; }); syncSend(); };
  const full = $('att-sel-full'); if (full) full.onclick = () => { sels().forEach(c => { const r = rows.find(x => x.id === c.dataset.id); c.checked = !!(r && fullDay(r)); }); syncSend(); };
  const rt = $('att-retry'); if (rt) rt.onclick = async () => { rt.disabled = true; rt.textContent = 'جارٍ الإرسال...'; await retryFailed(); };
  smsStatusLine();
  const send = $('att-send'); if (send) send.onclick = () => approveMessages(sels().filter(c => c.checked).map(c => c.dataset.id), tpl.value);
  syncSend();
}

// الإرسال عبر خدمة تقنيات (دالة send-attendance-sms على الخادم)
// الإرسال عبر تقنيات من قاعدة البيانات (عنوان خروج ثابت): الطلب يُرسل ثم تُقرأ ردوده بعد ثوانٍ
const wait = ms => new Promise(r => setTimeout(r, ms));
const SCH = () => ({ p_school: currentSchoolId || null });
async function syncSms(date) {
  const { data } = await sb.rpc('attendance_sms_sync', { p_date: date, ...SCH() });
  return data || {};
}
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
    if (error) return { ok: false, msg: 'اعتُمدت الرسائل، وتعذر الإرسال: ' + error.message };
    if (data && data.configured === false) return { ok: false, msg: 'اعتُمدت الرسائل، وتُرسل بعد إضافة مفتاح تقنيات' };
    if (data && data.error) return { ok: false, msg: 'اعتُمدت الرسائل، وتعذر الإرسال: ' + data.error };
    let res = {};
    for (let i = 0; i < 5; i++) { await wait(2000); res = await syncSms(date); if (!res.waiting) break; }
    const n = res.sent || 0, f = (res.failed || 0) + (data.invalid || 0);
    return { ok: !f && !res.waiting, msg: `✓ أُرسلت ${n} ${n === 1 ? 'رسالة' : n <= 10 ? 'رسائل' : 'رسالة'}${f ? `، وتعذر إرسال ${f}` : ''}${res.waiting ? `، و${res.waiting} جارٍ إرسالها` : ''}` };
  } catch (e) { return { ok: false, msg: 'اعتُمدت الرسائل، وتعذر الإرسال: ' + (e.message || e) }; }
}
async function retryFailed() {
  if (!dayData) return;
  const ids = dayData.rows.filter(r => r.msg && r.msg.status === 'failed' && r.mobile).map(r => r.id);
  if (!ids.length) return;
  await sb.from('attendance_messages').update({ status: 'pending', error: null }).eq('att_date', dayData.date).in('student_id', ids).eq('status', 'failed');
  const r = await sendPending(dayData.date);
  toast(r.msg, r.ok ? 'ok' : 'err');
  await renderDay();
}
async function smsStatusLine() {
  const el = $('att-sms-status'); if (!el) return;
  el.innerHTML = '<span class="att-ms pending">خدمة الرسائل</span> جارٍ الفحص...';
  try {
    const data = await ensureSender();
    if (data.configured === false) { el.innerHTML = '<span class="att-ms failed">خدمة الرسائل غير مربوطة</span> أضف مفتاح تقنيات'; return; }
    if (data.error) { el.innerHTML = `<span class="att-ms failed">خدمة الرسائل</span> ${esc(data.error)}`; return; }
    const bal = data.balance && data.balance.balance != null ? ` · الرصيد ${esc(data.balance.balance)} ${esc(data.balance.currency || '')}` : '';
    el.innerHTML = `<span class="att-ms sent">خدمة الرسائل مربوطة</span> المرسل: ${esc(data.sender || '—')}${bal}`;
  } catch { el.textContent = ''; }
}

const TPL_KEY = 'att-sms-template';
const loadTpl = () => { try { return localStorage.getItem(TPL_KEY) || DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; } };
const saveTpl = v => { try { localStorage.setItem(TPL_KEY, v); } catch { /* */ } };

async function approveMessages(ids, tpl) {
  if (!ids.length || !dayData) return;
  const rows = dayData.rows.filter(r => ids.includes(r.id));
  const noPhone = rows.filter(r => !r.mobile).length;
  if (!confirm(`اعتماد رسائل غياب لأولياء أمور ${rows.length} ${rows.length <= 10 ? 'طلاب' : 'طالبًا'}؟${noPhone ? `\n(${noPhone} بلا رقم جوال ولن تصلهم رسالة)` : ''}`)) return;
  const btn = $('att-send'); btn.disabled = true; btn.textContent = 'جارٍ الاعتماد...';
  const dname = new Date(dayData.date + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
  const [yy, mm, dd] = dayData.date.split('-');
  const dtxt = `${Number(dd)}/${Number(mm)}/${yy}م`;
  const body = r => tpl.replace(/\{الاسم\}/g, r.full_name).replace(/\{اليوم\}/g, dname).replace(/\{التاريخ\}/g, dtxt).replace(/\{المدرسة\}/g, printOrgName() || '');
  const payload = rows.map(r => ({ att_date: dayData.date, student_id: r.id, mobile: r.mobile || null, body: body(r), status: r.mobile ? 'pending' : 'failed', error: r.mobile ? null : 'لا يوجد رقم جوال', approved_by: currentUserId }));
  const { error } = await writeWithSchool(extra => sb.from('attendance_messages').insert(payload.map(p => ({ ...p, ...extra }))));
  if (error && !/duplicate|unique/i.test(error.message || '')) { toast('تعذر الاعتماد: ' + error.message, 'err'); btn.disabled = false; btn.textContent = 'اعتماد الرسائل'; return; }
  btn.textContent = 'جارٍ الإرسال...';
  const r = await sendPending(dayData.date);
  toast(r.msg, r.ok ? 'ok' : 'err');
  await renderDay();
}
