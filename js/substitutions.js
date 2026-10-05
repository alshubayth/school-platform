/*
 * جدول اليوم والبدلاء: لوحة مرنة لجدول يوم كامل (كل الفصول × الحصص).
 * - المصدر الأساسي: جدول الحصص class_schedules (ما يتعدّل أبدًا).
 * - كل تغيير على تاريخ معيّن ينحفظ كـ"خانة بديلة" في daily_schedule_changes
 *   (تاريخ + فصل + حصة ← معلم + مادة + ملاحظة)، فالتغييرات مستقلة عن بعض وبأي ترتيب.
 * - حالات المعلمين لليوم (غائب / مستأذن من حصة / متأخر لين حصة) في daily_teacher_absences.
 * - المنصة ما تمنع أي حركة؛ تنبّه بس: معلم غير موجود، أو معلم في مكانين بنفس الحصة.
 */
import { sb, currentUserId, currentProfile, isAdminOrDeputy, gradeLabels, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool, upsertSchoolKey, conflictOpt } from './core.js';

document.getElementById('back-to-tiles-15').addEventListener('click', backToTiles);

const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const GRADE_ORDER = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const GRADE_SHORT = { first_intermediate: 'أول', second_intermediate: 'ثاني', third_intermediate: 'ثالث' };
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
const KIND_LABEL = { absent: 'غائب', leave: 'مستأذن', late: 'متأخر' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function norm(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
function shortName(n) { const p = norm(n).split(' '); return p.slice(0, 2).join(' '); }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function todayIso() { return isoOf(new Date()); }
function dayKeyFromDate(iso) { const j = new Date(iso + 'T00:00:00').getDay(); return j <= 4 ? DAY_KEYS[j] : null; }
function classLabel(g, s) { return `${GRADE_SHORT[g] || gradeLabels[g] || g} ${s}`; }
const keyOf = (g, s, p) => `${g}|${s}|${p}`;
const $ = id => document.getElementById(id);

let subDate = todayIso();
let schedule = [];          // صفوف class_schedules ليوم التاريخ المختار
let baseMap = new Map();    // key -> صف الجدول الأساسي
let changes = new Map();    // key -> صف daily_schedule_changes
let statuses = [];          // daily_teacher_absences لهذا التاريخ
let classes = [];           // [{grade, section}]
let allTeachers = [];       // كل أسماء المعلمين من الجدول
let weekSubs = new Map();   // اسم المعلم -> عدد حصص الانتظار هذا الأسبوع
let selectedKey = null;
let swapFrom = null;        // key الخانة اللي ننتظر نبدّلها مع خانة ثانية
let undoStack = [];
let statusColumnsOk = true;

export async function loadSubstitutionsModule() {
  const manage = isAdminOrDeputy();
  $('dd-actions').classList.toggle('hidden', !manage);
  $('dd-side').classList.toggle('hidden', !manage);
  document.querySelector('#substitutes-module .dd-layout').classList.toggle('single', !manage);
  $('dd-hint').classList.toggle('hidden', !manage);
  $('sub-date').value = subDate;
  if (!allTeachers.length) await loadAllTeachers();
  await refreshForDate();
}

async function loadAllTeachers() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('class_schedules').select('teacher_name, grade_level, class_section');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  allTeachers = [...new Set((data || []).map(r => norm(r.teacher_name)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const seen = new Set();
  classes = [];
  (data || []).forEach(r => { const k = r.grade_level + '|' + r.class_section; if (!seen.has(k)) { seen.add(k); classes.push({ grade: r.grade_level, section: r.class_section }); } });
  classes.sort((a, b) => (GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade)) || (a.section - b.section));
}

/* ---------- التاريخ ---------- */
$('sub-date').addEventListener('change', (e) => { subDate = e.target.value || todayIso(); undoStack = []; refreshForDate(); });
function shiftDay(dir) {
  const d = new Date(subDate + 'T00:00:00');
  do { d.setDate(d.getDate() + dir); } while (d.getDay() > 4);
  subDate = isoOf(d); $('sub-date').value = subDate; undoStack = []; refreshForDate();
}
$('dd-prev').addEventListener('click', () => shiftDay(-1));
$('dd-next').addEventListener('click', () => shiftDay(1));

async function refreshForDate() {
  selectedKey = null; swapFrom = null; updateSwapBar(); markDirty(false);
  const dk = dayKeyFromDate(subDate);
  $('dd-dayname').textContent = new Date(subDate + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
  if (!dk) {
    schedule = []; baseMap = new Map(); changes = new Map(); statuses = [];
    $('dd-grid').innerHTML = '<tbody><tr><td class="dd-off">هذا اليوم إجازة أسبوعية، ما فيه جدول حصص</td></tr></tbody>';
    $('dd-stats').innerHTML = '';
    renderStatusList(); renderCellPanel(); renderMine();
    return;
  }
  const sun = new Date(subDate + 'T00:00:00'); sun.setDate(sun.getDate() - sun.getDay());
  const thu = new Date(sun); thu.setDate(sun.getDate() + 4);
  const [{ data: sched }, { data: chg }, { data: abs }, { data: wk }] = await Promise.all([
    readScopedBySchool(scoped => { let q = sb.from('class_schedules').select('*').eq('day_of_week', dk); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
    readScopedBySchool(scoped => { let q = sb.from('daily_schedule_changes').select('*').eq('change_date', subDate); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
    readScopedBySchool(scoped => { let q = sb.from('daily_teacher_absences').select('*').eq('absence_date', subDate); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q.order('created_at'); }),
    readScopedBySchool(scoped => { let q = sb.from('daily_schedule_changes').select('teacher_name, change_date, reason').gte('change_date', isoOf(sun)).lte('change_date', isoOf(thu)); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
  ]);
  schedule = sched || [];
  baseMap = new Map(schedule.map(r => [keyOf(r.grade_level, r.class_section, r.period_number), r]));
  changes = new Map((chg || []).map(r => [keyOf(r.grade_level, r.class_section, r.period_number), r]));
  statuses = abs || [];
  weekSubs = new Map();
  (wk || []).filter(r => r.reason === 'substitute' && norm(r.teacher_name)).forEach(r => { const n = norm(r.teacher_name); weekSubs.set(n, (weekSubs.get(n) || 0) + 1); });
  renderAll();
}

/* ---------- الوضع الفعلي لكل خانة ---------- */
function effective(key) {
  const base = baseMap.get(key);
  const ch = changes.get(key);
  if (ch) {
    const t = norm(ch.teacher_name);
    return { teacher: t, subject: ch.subject_name || (base ? base.subject_name : ''), note: ch.note || '', changed: true, free: !t, base };
  }
  if (base) return { teacher: norm(base.teacher_name), subject: base.subject_name || '', note: '', changed: false, free: false, base };
  return null;
}
// هل المعلم موجود في هذي الحصة حسب حالته اليوم؟
function teacherOut(name, p) {
  const n = norm(name);
  if (!n) return null;
  for (const s of statuses) {
    if (norm(s.teacher_name) !== n) continue;
    const kind = s.kind || 'absent';
    const fp = Number(s.from_period) || 0;
    if (kind === 'absent') return 'غائب';
    if (kind === 'leave' && fp && p >= fp) return 'مستأذن';
    if (kind === 'late' && fp && p <= fp) return 'متأخر';
  }
  return null;
}
// المعلمين اللي عندهم أكثر من خانة بنفس الحصة
function conflictsByPeriod() {
  const res = new Map();
  PERIODS.forEach(p => {
    const count = new Map();
    classes.forEach(c => { const e = effective(keyOf(c.grade, c.section, p)); if (e && e.teacher) count.set(e.teacher, (count.get(e.teacher) || 0) + 1); });
    res.set(p, new Set([...count.entries()].filter(([, n]) => n > 1).map(([t]) => t)));
  });
  return res;
}
function busyAt(p) {
  const set = new Set();
  classes.forEach(c => { const e = effective(keyOf(c.grade, c.section, p)); if (e && e.teacher) set.add(e.teacher); });
  return set;
}
function freeTeachersAt(p) {
  const busy = busyAt(p);
  return allTeachers.filter(t => !busy.has(t) && !teacherOut(t, p))
    .map(t => ({ name: t, week: weekSubs.get(t) || 0, today: PERIODS.filter(pp => busyAt(pp).has(t)).length }))
    .sort((a, b) => (a.week - b.week) || (a.today - b.today) || a.name.localeCompare(b.name, 'ar'));
}

/* ---------- العرض ---------- */
function renderAll() { renderGrid(); renderStats(); renderStatusList(); renderCellPanel(); renderMine(); }

function renderGrid() {
  const manage = isAdminOrDeputy();
  const conf = conflictsByPeriod();
  const me = norm(currentProfile.full_name);
  const head = `<thead><tr><th class="dd-corner">الفصل</th>${PERIODS.map(p => `<th>${p}</th>`).join('')}</tr></thead>`;
  let lastGrade = null;
  const body = classes.map(c => {
    const sep = c.grade !== lastGrade ? ' dd-grade-start' : ''; lastGrade = c.grade;
    return `<tr class="${sep}"><th class="dd-cls">${esc(classLabel(c.grade, c.section))}</th>${PERIODS.map(p => {
      const k = keyOf(c.grade, c.section, p);
      const e = effective(k);
      if (!e) return `<td class="dd-cell dd-none" data-k="${k}" ${manage ? 'tabindex="0"' : ''}></td>`;
      const out = !e.free && teacherOut(e.teacher, p);
      const cls = ['dd-cell', e.changed ? 'is-changed' : '', e.free ? 'is-free' : '', out ? 'is-out' : '', !e.free && conf.get(p).has(e.teacher) ? 'is-conflict' : '', k === selectedKey ? 'is-selected' : '', k === swapFrom ? 'is-swapfrom' : '', !manage && me && e.teacher === me ? 'is-mine' : ''].filter(Boolean).join(' ');
      return `<td class="${cls}" data-k="${k}" ${manage ? 'draggable="true" tabindex="0"' : ''} title="${esc((e.subject || '') + (e.teacher ? ' · ' + e.teacher : '') + (e.note ? ' · ' + e.note : '') + (out ? ' · ' + out : ''))}">
        <span class="dc-sub">${esc(e.free ? (e.note || 'فراغ') : (e.subject || ''))}</span>
        <span class="dc-t">${esc(e.free ? '' : shortName(e.teacher))}</span>
        ${out ? `<span class="dc-flag">${out}</span>` : ''}
      </td>`;
    }).join('')}</tr>`;
  }).join('');
  $('dd-grid').innerHTML = classes.length ? head + '<tbody>' + body + '</tbody>' : '<tbody><tr><td class="dd-off">ما فيه جدول حصص بالمنصة. أضفه من قسم «الجدول الدراسي» أول.</td></tr></tbody>';
  if (manage) wireGrid();
}

function renderStats() {
  const conf = conflictsByPeriod();
  let affected = 0, unresolved = 0, conflicts = 0;
  classes.forEach(c => PERIODS.forEach(p => {
    const k = keyOf(c.grade, c.section, p);
    const base = baseMap.get(k);
    if (base && teacherOut(base.teacher_name, p)) affected++;
    const e = effective(k);
    if (e && !e.free && teacherOut(e.teacher, p)) unresolved++;
  }));
  PERIODS.forEach(p => { conflicts += conf.get(p).size; });
  const nChanges = changes.size;
  $('dd-stats').innerHTML = `
    <span class="ds ds-all"><b>${statuses.length}</b> حالة اليوم</span>
    <span class="ds ds-late"><b>${affected}</b> حصة متأثرة</span>
    <span class="ds ${unresolved ? 'ds-absent' : 'ds-present'}"><b>${unresolved}</b> ${unresolved ? 'تحتاج حل' : 'كلها محلولة'}</span>
    ${conflicts ? `<span class="ds ds-absent"><b>${conflicts}</b> ${conflicts === 1 ? 'معلم في مكانين' : 'تعارض'}</span>` : ''}
    <span class="ds"><b>${nChanges}</b> خانة متغيّرة</span>`;
}

function renderStatusList() {
  const list = $('dd-status-list');
  if (!list) return;
  const sel = $('dd-st-teacher');
  const has = new Set(statuses.map(s => norm(s.teacher_name)));
  sel.innerHTML = '<option value="">اختر المعلم...</option>' + allTeachers.filter(t => !has.has(t)).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  list.innerHTML = statuses.length ? statuses.map(s => {
    const kind = s.kind || 'absent';
    const lessons = PERIODS.filter(p => teacherOut(s.teacher_name, p) && classes.some(c => { const b = baseMap.get(keyOf(c.grade, c.section, p)); return b && norm(b.teacher_name) === norm(s.teacher_name); })).length;
    const txt = kind === 'absent' ? 'غائب اليوم' : kind === 'leave' ? `مستأذن من الحصة ${s.from_period}` : `متأخر لين الحصة ${s.from_period}`;
    return `<div class="dd-st st-${kind}"><span class="dd-st-main"><b>${esc(s.teacher_name)}</b><span>${txt}${lessons ? ` · ${lessons} ${lessons <= 2 ? 'حصة' : lessons <= 10 ? 'حصص' : 'حصة'} متأثرة` : ''}</span></span><button type="button" data-id="${s.id}" aria-label="حذف">✕</button></div>`;
  }).join('') : '<p class="dd-empty-panel">ما فيه غياب أو استئذان مسجّل لهذا اليوم.</p>';
  list.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', async () => {
    await sb.from('daily_teacher_absences').delete().eq('id', b.dataset.id);
    statuses = statuses.filter(s => String(s.id) !== String(b.dataset.id));
    renderAll();
  }));
}

$('dd-st-kind').addEventListener('change', () => $('dd-st-period').classList.toggle('hidden', $('dd-st-kind').value === 'absent'));
$('dd-st-add').addEventListener('click', async () => {
  const err = $('dd-st-error'); err.style.display = 'none';
  if (!dayKeyFromDate(subDate)) return;
  const name = $('dd-st-teacher').value;
  const kind = $('dd-st-kind').value;
  const fp = kind === 'absent' ? null : parseInt($('dd-st-period').value);
  if (!name) { err.textContent = 'اختر المعلم'; err.style.display = 'block'; return; }
  let row = { absence_date: subDate, teacher_name: name, created_by: currentUserId };
  if (statusColumnsOk) row = { ...row, kind, from_period: fp };
  let res = await writeWithSchool(extra => sb.from('daily_teacher_absences').insert({ ...row, ...extra }).select('*').single());
  if (res.error && /kind|from_period|column/i.test(res.error.message || '')) {
    statusColumnsOk = false;
    if (kind !== 'absent') { err.textContent = 'تسجيل الاستئذان والتأخير يحتاج تشغيل ملف sql/daily_status.sql مرة وحدة. سجّلته الحين كغياب.'; err.style.display = 'block'; }
    res = await writeWithSchool(extra => sb.from('daily_teacher_absences').insert({ absence_date: subDate, teacher_name: name, created_by: currentUserId, ...extra }).select('*').single());
  }
  if (res.error) { err.textContent = 'تعذّرت الإضافة: ' + res.error.message; err.style.display = 'block'; return; }
  statuses.push(res.data || { ...row, id: 'tmp' + Date.now() });
  renderAll();
});

/* ---------- لوحة الخانة المختارة ---------- */
function renderCellPanel() {
  const panel = $('dd-cell-panel');
  if (!panel) return;
  const card = $('dd-cell-card');
  if (!selectedKey) {
    card.classList.remove('sheet-open');
    panel.innerHTML = '<p class="dd-empty-panel">اضغط أي خانة في الجدول عشان تشوف خياراتها والمعلمين الفاضيين في حصتها.</p>';
    return;
  }
  card.classList.add('sheet-open');
  const [g, sec, pStr] = selectedKey.split('|'); const p = +pStr;
  const e = effective(selectedKey);
  const base = baseMap.get(selectedKey);
  const out = e && !e.free && teacherOut(e.teacher, p);
  const conf = e && !e.free && conflictsByPeriod().get(p).has(e.teacher);
  const free = freeTeachersAt(p);
  panel.innerHTML = `
    <div class="dcp-head">
      <div><b>${esc(classLabel(g, sec))} · الحصة ${p}</b>
      <span>${e ? (e.free ? esc(e.note || 'فراغ') : `${esc(e.subject)} · ${esc(e.teacher)}`) : 'ما فيه حصة'}</span>
      ${e && e.changed && base ? `<span class="dcp-base">الأصل: ${esc(base.subject_name)} · ${esc(norm(base.teacher_name))}</span>` : ''}</div>
      <button type="button" class="dcp-close" id="dcp-close" aria-label="إغلاق">✕</button>
    </div>
    ${out ? `<div class="dcp-warn">${esc(e.teacher)} ${out} في هذي الحصة</div>` : ''}
    ${conf ? `<div class="dcp-warn">${esc(e.teacher)} عنده خانة ثانية في نفس الحصة</div>` : ''}
    <div class="dcp-actions">
      <button type="button" class="btn-primary" id="dcp-swap">تبديل مع خانة ثانية…</button>
      ${e && !e.free ? '<button type="button" class="btn-secondary" id="dcp-free">فراغ / نشاط</button>' : ''}
      ${e && e.changed ? '<button type="button" class="btn-secondary" id="dcp-revert">رجّعها للأصل</button>' : ''}
    </div>
    <label class="dcp-note">ملاحظة على الخانة<input type="text" id="dcp-note-input" value="${esc(e && e.changed ? e.note : '')}" placeholder="مثال: نشاط في المصادر" /></label>
    <h5>الفاضيين في الحصة ${p} <span>(الأقل انتظار هذا الأسبوع أول)</span></h5>
    <div class="dcp-free">${free.length ? free.map(f => `<button type="button" class="dcp-t" draggable="true" data-t="${esc(f.name)}"><b>${esc(f.name)}</b><span>${f.today} ${f.today <= 2 ? 'حصة' : 'حصص'} اليوم · ${f.week} انتظار هذا الأسبوع</span></button>`).join('') : '<p class="dd-empty-panel">ما فيه معلم فاضي في هذي الحصة.</p>'}</div>`;
  $('dcp-close').addEventListener('click', () => { selectedKey = null; renderGrid(); renderCellPanel(); });
  $('dcp-swap').addEventListener('click', () => { swapFrom = selectedKey; selectedKey = null; updateSwapBar(); renderGrid(); renderCellPanel(); });
  const fr = $('dcp-free'); if (fr) fr.addEventListener('click', () => setFree(selectedKey));
  const rv = $('dcp-revert'); if (rv) rv.addEventListener('click', () => revertCell(selectedKey));
  $('dcp-note-input').addEventListener('change', (ev) => setNote(selectedKey, ev.target.value.trim()));
  panel.querySelectorAll('.dcp-t').forEach(b => {
    b.addEventListener('click', () => assignTeacher(selectedKey, b.dataset.t));
    b.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/teacher', b.dataset.t); ev.dataTransfer.effectAllowed = 'copy'; });
  });
}

function updateSwapBar() {
  const bar = $('dd-swapbar');
  if (!bar) return;
  if (!swapFrom) { bar.classList.add('hidden'); return; }
  const [g, s, p] = swapFrom.split('|');
  $('dd-swapbar-text').textContent = `اختر الخانة اللي تبي تبدّلها مع ${classLabel(g, s)} · الحصة ${p} (أي فصل وأي حصة)`;
  bar.classList.remove('hidden');
}
$('dd-swap-cancel').addEventListener('click', () => { swapFrom = null; updateSwapBar(); renderGrid(); });

/* ---------- التفاعل مع الجدول: ضغط، سحب وإفلات، لوحة مفاتيح ---------- */
function wireGrid() {
  const grid = $('dd-grid');
  grid.querySelectorAll('td.dd-cell').forEach(td => {
    const k = td.dataset.k;
    td.addEventListener('click', () => onCellClick(k));
    td.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onCellClick(k); } });
    td.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/cell', k); ev.dataTransfer.effectAllowed = 'move'; td.classList.add('is-dragging'); });
    td.addEventListener('dragend', () => td.classList.remove('is-dragging'));
    td.addEventListener('dragover', (ev) => { ev.preventDefault(); td.classList.add('is-over'); });
    td.addEventListener('dragleave', () => td.classList.remove('is-over'));
    td.addEventListener('drop', (ev) => {
      ev.preventDefault(); td.classList.remove('is-over');
      const from = ev.dataTransfer.getData('text/cell');
      const teacher = ev.dataTransfer.getData('text/teacher');
      if (from && from !== k) swapCells(from, k);
      else if (teacher) assignTeacher(k, teacher);
    });
  });
}
function onCellClick(k) {
  if (swapFrom) {
    const from = swapFrom; swapFrom = null; updateSwapBar();
    if (from !== k) { swapCells(from, k); return; }
  }
  selectedKey = selectedKey === k ? null : k;
  renderGrid(); renderCellPanel();
}

/* ---------- حفظ التغييرات (مع تراجع) ---------- */
function splitKey(k) { const [g, s, p] = k.split('|'); return { grade_level: g, class_section: isNaN(+s) ? s : +s, period_number: +p }; }
function contentEqualsBase(k, teacher, subject) {
  const b = baseMap.get(k);
  return b && norm(b.teacher_name) === norm(teacher) && (b.subject_name || '') === (subject || '');
}
// يكتب حالة خانة جديدة: null = يرجع للأصل (يحذف التغيير)
async function writeCell(k, content) {
  const where = splitKey(k);
  if (!content || (contentEqualsBase(k, content.teacher, content.subject) && !content.note)) {
    if (changes.has(k)) {
      const { error } = await sb.from('daily_schedule_changes').delete().eq('change_date', subDate).eq('grade_level', where.grade_level).eq('class_section', where.class_section).eq('period_number', where.period_number);
      if (error) throw error;
      changes.delete(k);
    }
    return;
  }
  const row = {
    change_date: subDate, day_of_week: dayKeyFromDate(subDate), ...where,
    teacher_name: content.teacher || '', subject_name: content.subject || null,
    reason: content.reason || 'swap', note: content.note || null, created_by: currentUserId,
  };
  const { data, error } = await writeWithSchool(extra => upsertSchoolKey(k => sb.from('daily_schedule_changes').upsert({ ...row, ...extra }, conflictOpt(k)).select('*').single(),
    'school_id,change_date,grade_level,class_section,period_number', 'change_date,grade_level,class_section,period_number'));
  if (error) throw error;
  changes.set(k, data || row);
}
async function applyOps(ops, label) {
  // ops: [{k, content}] - نحفظ الوضع السابق للتراجع
  const before = ops.map(o => ({ k: o.k, row: changes.has(o.k) ? { ...changes.get(o.k) } : null }));
  try {
    for (const o of ops) await writeCell(o.k, o.content);
    undoStack.push({ before, label });
    $('dd-undo').disabled = false;
    markDirty(true);
    flash(label + ' — اضغط «اعتماد» لإشعار المعلمين');
  } catch (e) {
    flash('تعذّر الحفظ: ' + (e.message || e), true);
  }
  renderAll();
}
function contentOf(k) {
  const e = effective(k);
  if (!e) return null;
  return { teacher: e.teacher, subject: e.subject, note: e.changed ? e.note : '' };
}
async function swapCells(a, b) {
  const ca = contentOf(a), cb = contentOf(b);
  const [ga, sa, pa] = a.split('|'), [gb, sbb, pb] = b.split('|');
  const lbl = `تبديل ${classLabel(ga, sa)}/${pa} مع ${classLabel(gb, sbb)}/${pb}`;
  await applyOps([
    { k: a, content: cb ? { ...cb, reason: 'swap', note: cb.note || '' } : { teacher: '', subject: 'فراغ', reason: 'swap', note: 'فراغ' } },
    { k: b, content: ca ? { ...ca, reason: 'swap', note: ca.note || '' } : { teacher: '', subject: 'فراغ', reason: 'swap', note: 'فراغ' } },
  ], lbl);
  selectedKey = b;
  renderGrid(); renderCellPanel();
}
async function assignTeacher(k, teacher) {
  const e = effective(k);
  const prev = e && !e.free ? e.teacher : '';
  const subject = e && !e.free ? e.subject : (baseMap.get(k) ? baseMap.get(k).subject_name : 'انتظار');
  await applyOps([{ k, content: { teacher, subject, reason: 'substitute', note: prev ? `بديل عن ${prev}` : 'انتظار' } }], `${teacher} صار في ${classLabel(...k.split('|').slice(0, 2))} / الحصة ${k.split('|')[2]}`);
  const n = norm(teacher); weekSubs.set(n, (weekSubs.get(n) || 0) + 1);
  renderCellPanel();
}
async function setFree(k) {
  await applyOps([{ k, content: { teacher: '', subject: 'فراغ', reason: 'substitute', note: $('dcp-note-input') && $('dcp-note-input').value.trim() || 'فراغ' } }], 'صارت الخانة فراغ');
}
async function revertCell(k) { await applyOps([{ k, content: null }], 'رجعت الخانة للأصل'); }
async function setNote(k, note) {
  const c = contentOf(k);
  if (!c) return;
  await applyOps([{ k, content: { ...c, reason: changes.get(k) ? changes.get(k).reason : 'swap', note } }], 'انحفظت الملاحظة');
}

$('dd-undo').addEventListener('click', async () => {
  const last = undoStack.pop();
  if (!last) return;
  try {
    for (const b of last.before) {
      if (!b.row) await writeCell(b.k, null);
      else {
        const { data, error } = await writeWithSchool(extra => upsertSchoolKey(k => sb.from('daily_schedule_changes').upsert({ ...stripMeta(b.row), ...extra }, conflictOpt(k)).select('*').single(),
          'school_id,change_date,grade_level,class_section,period_number', 'change_date,grade_level,class_section,period_number'));
        if (error) throw error;
        changes.set(b.k, data || b.row);
      }
    }
    markDirty(undoStack.length > 0);
    flash('تم التراجع: ' + last.label);
  } catch (e) { flash('تعذّر التراجع: ' + (e.message || e), true); }
  $('dd-undo').disabled = !undoStack.length;
  renderAll();
});
function stripMeta(r) { const { id, created_at, updated_at, school_id, ...rest } = r; return rest; }

$('dd-reset').addEventListener('click', async () => {
  if (!changes.size) { flash('ما فيه تغييرات على هذا اليوم'); return; }
  if (!confirm(`ترجيع جدول ${$('dd-dayname').textContent} للأصل؟ ينحذف ${changes.size} تغيير.`)) return;
  const { error } = await sb.from('daily_schedule_changes').delete().eq('change_date', subDate);
  if (error) { flash('تعذّر: ' + error.message, true); return; }
  changes = new Map(); undoStack = []; $('dd-undo').disabled = true;
  flash('رجع اليوم للجدول الأساسي');
  renderAll();
});

let flashTimer = null;
/* ===== اعتماد جدول اليوم وإشعار المعلمين (التعديلات تنحفظ فورًا لكن الإشعار ما يطلع إلا بالاعتماد) ===== */
function markDirty(on) { const b = $('dd-approve'); if (b) b.classList.toggle('dirty', !!on); }
$('dd-approve').addEventListener('click', async () => {
  const b = $('dd-approve');
  b.disabled = true;
  try {
    const { data, error } = await sb.rpc('push_notify_schedule', { p_date: subDate });
    if (error) throw error;
    markDirty(false);
    if (data === -1) flash('الاعتماد للمدير والوكيل فقط', true);
    else if (data > 0) flash('تم الاعتماد وإرسال الإشعار ' + (data === 1 ? 'لمعلم واحد' : data === 2 ? 'لمعلمَين' : `لـ ${data} معلمين`));
    else flash('تم الاعتماد. ما فيه تغييرات جديدة تحتاج إشعار');
  } catch (e) {
    flash('تعذّر الاعتماد: ' + (e.message || e), true);
  } finally { b.disabled = false; }
});

function flash(msg, bad = false) {
  const el = $('dd-msg');
  el.textContent = msg; el.classList.toggle('bad', bad); el.classList.remove('hidden');
  clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}
document.addEventListener('keydown', (e) => {
  if ($('substitutes-module').classList.contains('hidden')) return;
  if (e.key === 'Escape' && (swapFrom || selectedKey)) { swapFrom = null; selectedKey = null; updateSwapBar(); renderGrid(); renderCellPanel(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !$('dd-undo').disabled && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('dd-undo').click(); }
});

/* ---------- ملخص التغييرات: للطباعة والواتساب ---------- */
function changeList() {
  const rows = [];
  changes.forEach((ch, k) => {
    const [g, s, p] = k.split('|');
    const base = baseMap.get(k);
    rows.push({ g, s, p: +p, cls: classLabel(g, s), from: base ? `${base.subject_name} · ${norm(base.teacher_name)}` : '—', to: norm(ch.teacher_name) ? `${ch.subject_name || ''} · ${norm(ch.teacher_name)}` : (ch.note || 'فراغ'), teacher: norm(ch.teacher_name), note: ch.note || '' });
  });
  return rows.sort((a, b) => (a.p - b.p) || (GRADE_ORDER.indexOf(a.g) - GRADE_ORDER.indexOf(b.g)) || (a.s - b.s));
}
$('dd-copy').addEventListener('click', async () => {
  const rows = changeList();
  const day = $('dd-dayname').textContent;
  let text = `تغييرات جدول ${day}\n`;
  if (statuses.length) text += '\n' + statuses.map(s => `• ${s.teacher_name}: ${(s.kind || 'absent') === 'absent' ? 'غائب' : (s.kind === 'leave' ? 'مستأذن من الحصة ' + s.from_period : 'متأخر لين الحصة ' + s.from_period)}`).join('\n') + '\n';
  const byT = new Map();
  rows.filter(r => r.teacher).forEach(r => { if (!byT.has(r.teacher)) byT.set(r.teacher, []); byT.get(r.teacher).push(r); });
  byT.forEach((list, t) => { text += `\nأ. ${t}:\n` + list.map(r => `  - الحصة ${r.p} · ${r.cls} (${r.to.split(' · ')[0]})${r.note ? ' — ' + r.note : ''}`).join('\n'); });
  const frees = rows.filter(r => !r.teacher);
  if (frees.length) text += '\n\nفراغ:\n' + frees.map(r => `  - الحصة ${r.p} · ${r.cls}${r.note && r.note !== 'فراغ' ? ' — ' + r.note : ''}`).join('\n');
  if (!rows.length) text += '\nما فيه تغييرات على الجدول.';
  try { await navigator.clipboard.writeText(text); flash('انسخ الملخص، الصقه في الواتساب'); }
  catch { prompt('انسخ النص:', text); }
});
$('dd-print').addEventListener('click', () => {
  const day = $('dd-dayname').textContent;
  const rows = changeList();
  const conf = conflictsByPeriod();
  const grid = `<table class="g"><thead><tr><th>الفصل</th>${PERIODS.map(p => `<th>${p}</th>`).join('')}</tr></thead><tbody>${classes.map(c => `<tr><th>${esc(classLabel(c.grade, c.section))}</th>${PERIODS.map(p => {
    const k = keyOf(c.grade, c.section, p); const e = effective(k);
    if (!e) return '<td></td>';
    return `<td class="${e.changed ? 'ch' : ''}">${e.free ? esc(e.note || 'فراغ') : `<b>${esc(e.subject)}</b><br>${esc(shortName(e.teacher))}${conf.get(p).has(e.teacher) ? ' ⚠' : ''}`}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
  const list = rows.length ? `<table class="l"><thead><tr><th>الحصة</th><th>الفصل</th><th>الأصل</th><th>اليوم</th><th>ملاحظة</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.p}</td><td>${esc(r.cls)}</td><td>${esc(r.from)}</td><td><b>${esc(r.to)}</b></td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table>` : '<p>ما فيه تغييرات.</p>';
  const st = statuses.length ? `<p class="st">${statuses.map(s => `${esc(s.teacher_name)} (${(s.kind || 'absent') === 'absent' ? 'غائب' : s.kind === 'leave' ? 'مستأذن من ' + s.from_period : 'متأخر لين ' + s.from_period})`).join(' · ')}</p>` : '';
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>جدول ${esc(day)}</title><style>
    @page{ size:A4 landscape; margin:10mm; } body{ font-family:Tahoma, Arial, sans-serif; color:#111; }
    h1{ font-size:18px; margin:0 0 4px; } .st{ font-size:12px; margin:0 0 8px; }
    table{ border-collapse:collapse; width:100%; } th, td{ border:1px solid #999; padding:4px; text-align:center; font-size:11px; }
    table.g td.ch{ background:#E6EFFC; } table.l{ margin-top:10px; page-break-before:auto; } table.l td{ text-align:right; }
    thead th{ background:#EEF1F6; }
  </style></head><body><h1>جدول ${esc(day)}</h1>${st}${grid}<h1 style="margin-top:12px;">التغييرات</h1>${list}<script>window.onload=()=>window.print();<\/script></body></html>`);
  w.document.close();
});

/* ---------- المعلم: تغييراتي اليوم ---------- */
function renderMine() {
  const box = $('dd-mine');
  if (!box) return;
  if (isAdminOrDeputy()) { box.classList.add('hidden'); return; }
  const me = norm(currentProfile.full_name);
  const rows = changeList().filter(r => r.teacher === me || (baseMap.get(keyOf(r.g, r.s, r.p)) && norm(baseMap.get(keyOf(r.g, r.s, r.p)).teacher_name) === me));
  box.classList.remove('hidden');
  box.innerHTML = `<h4 class="dd-mine-h">تغييراتي اليوم</h4>${rows.length ? rows.map(r => `<div class="dd-mine-row"><b>الحصة ${r.p} · ${esc(r.cls)}</b><span>${r.teacher === me ? `عليك: ${esc(r.to.split(' · ')[0])}` : `حصتك راحت لـ ${esc(r.to)}`}${r.note ? ' — ' + esc(r.note) : ''}</span></div>`).join('') : '<p class="dd-empty-panel">ما عليك تغييرات في هذا اليوم. حصصك مميزة في الجدول.</p>'}`;
}
