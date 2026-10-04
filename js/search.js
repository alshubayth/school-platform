/* =========================================================================
 * البحث الشامل (Ctrl+K أو زر البحث أعلى الصفحة)
 * يبحث بالأقسام (حسب صلاحيات المستخدم)، وبالطلاب (الاسم أو رقم الهوية)، وبالموظفين.
 * الضغط على طالب أو موظف يفتح بطاقة مختصرة فيها بياناته واختصارات للأقسام المرتبطة به.
 * ========================================================================= */
import { sb, tiles, GROUPS, isTileAllowed, tileTitle, tileDesc, openTile, currentProfile, currentSchoolId, readScopedBySchool, gradeLabels } from './core.js';

let initialized = false;
let items = [];        // العناصر المعروضة حاليًا (للتنقل بالأسهم)
let activeIndex = -1;
let seq = 0;           // لتجاهل نتائج بحث قديمة وصلت متأخرة
let debounceTimer = null;

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function normAr(s) { return String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase(); }
function initials(name) { const p = String(name || '').trim().split(/\s+/); return (p[0] || '').charAt(0) + (p[1] ? ' ' + p[1].charAt(0) : ''); }
const role = () => (currentProfile ? (currentProfile.role === 'owner' ? 'admin' : currentProfile.role) : null);
const canSearchStudents = () => ['admin', 'deputy', 'teacher'].includes(role());
const canSearchEmployees = () => ['admin', 'deputy'].includes(role());
const allowed = (key) => { const t = tiles.find(x => x.key === key); return t && isTileAllowed(t) ? t : null; };

export function openSearch() {
  $('search-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const input = $('search-input');
  input.value = '';
  renderQuery('');
  setTimeout(() => input.focus(), 10);
}
export function closeSearch() {
  $('search-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---------- عرض النتائج ---------- */
function sectionMatches(q) {
  const nq = normAr(q);
  return tiles.filter(t => isTileAllowed(t)).map(t => {
    const g = GROUPS.find(x => x.key === t.group);
    const hay = normAr(`${tileTitle(t)} ${tileDesc(t)} ${g ? g.title : ''}`);
    return { t, g, hit: !nq || hay.includes(nq), starts: normAr(tileTitle(t)).startsWith(nq) };
  }).filter(x => x.hit).sort((a, b) => b.starts - a.starts);
}

function renderList(groups, emptyMsg) {
  const box = $('search-results');
  items = [];
  let html = '';
  groups.forEach(g => {
    if (!g.rows.length) return;
    html += `<div class="search-group-label">${g.label}</div>`;
    g.rows.forEach(r => {
      const i = items.length;
      items.push(r);
      html += `<button type="button" class="search-item" role="option" data-i="${i}">
        <span class="si-ic">${r.icon}</span>
        <span class="si-main"><span class="si-title">${esc(r.title)}</span>${r.sub ? `<span class="si-sub">${esc(r.sub)}</span>` : ''}</span>
      </button>`;
    });
  });
  box.innerHTML = html || `<div class="search-empty">${emptyMsg}</div>`;
  setActive(items.length ? 0 : -1);
}

function setActive(i) {
  activeIndex = i;
  $('search-results').querySelectorAll('.search-item').forEach(el => {
    const on = +el.dataset.i === i;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

function sectionRows(q, limit) {
  return sectionMatches(q).slice(0, limit).map(({ t, g }) => ({
    kind: 'section', title: tileTitle(t), sub: g ? g.title + ' · ' + tileDesc(t) : tileDesc(t), icon: t.icon,
    run: () => { closeSearch(); openTile(t.key, tileTitle(t)); },
  }));
}

async function renderQuery(q) {
  const mySeq = ++seq;
  q = q.trim();
  if (!q) {
    renderList([{ label: 'الأقسام', rows: sectionRows('', 30) }], '');
    return;
  }
  const secRows = sectionRows(q, 6);
  renderList([{ label: 'الأقسام', rows: secRows }], 'جارٍ البحث...');
  if (q.replace(/\s/g, '').length < 2) return;

  const safe = q.replace(/[%,()*\\]/g, ' ').trim();
  const [stu, emp] = await Promise.all([
    canSearchStudents() ? readScopedBySchool(scoped => {
      let qq = sb.from('students').select('id, full_name, national_id, grade_level, class_section')
        .or(`full_name.ilike.%${safe}%,national_id.ilike.%${safe}%`);
      if (scoped && currentSchoolId) qq = qq.eq('school_id', currentSchoolId);
      return qq.limit(8);
    }) : Promise.resolve({ data: [] }),
    canSearchEmployees() ? readScopedBySchool(scoped => {
      let qq = sb.from('employees').select('id, full_name, job_title, profile_id').ilike('full_name', `%${safe}%`);
      if (scoped && currentSchoolId) qq = qq.eq('school_id', currentSchoolId);
      return qq.limit(6);
    }) : Promise.resolve({ data: [] }),
  ]);
  if (mySeq !== seq) return; // وصل بحث أحدث
  const stuRows = (stu.data || []).map(s => ({
    kind: 'student', title: s.full_name, icon: esc(initials(s.full_name)),
    sub: `${gradeLabels[s.grade_level] || ''}${s.class_section ? ' · فصل ' + s.class_section : ''} · ${s.national_id || ''}`,
    run: () => showStudentCard(s),
  }));
  const empRows = (emp.data || []).map(e => ({
    kind: 'employee', title: e.full_name, icon: esc(initials(e.full_name)), sub: e.job_title || 'موظف',
    run: () => showEmployeeCard(e),
  }));
  renderList([
    { label: 'الأقسام', rows: secRows },
    { label: 'الطلاب', rows: stuRows },
    { label: 'الموظفين', rows: empRows },
  ], `ما لقيت نتائج لـ «${esc(q)}»`);
}

/* ---------- بطاقات مختصرة ---------- */
function actionButtons(keys) {
  return keys.map(k => allowed(k)).filter(Boolean)
    .map(t => `<button type="button" class="btn-secondary sc-go" data-key="${t.key}" style="width:auto; padding:9px 14px;">${esc(tileTitle(t))}</button>`).join('');
}
function wireCard(box) {
  box.querySelector('.sc-back').addEventListener('click', () => renderQuery($('search-input').value));
  box.querySelectorAll('.sc-go').forEach(b => b.addEventListener('click', () => {
    const t = allowed(b.dataset.key);
    if (t) { closeSearch(); openTile(t.key, tileTitle(t)); }
  }));
  items = []; activeIndex = -1;
}

async function showStudentCard(s) {
  const box = $('search-results');
  box.innerHTML = `<div class="search-card">
    <button type="button" class="text-action-btn sc-back" style="align-self:flex-start; width:auto; padding:4px 8px;">→ رجوع للنتائج</button>
    <div class="sc-head">
      <span class="si-ic" style="width:52px; height:52px; border-radius:50%; background:var(--meadow-dark); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:17px;">${esc(initials(s.full_name))}</span>
      <div><div style="font-size:18px; font-weight:800;">${esc(s.full_name)}</div>
      <div style="font-size:13px; color:var(--slate);">${esc(gradeLabels[s.grade_level] || '')}${s.class_section ? ' · فصل ' + s.class_section : ''} · <span dir="ltr">${esc(s.national_id || '')}</span></div></div>
    </div>
    <div id="sc-extra" style="font-size:13.5px; color:var(--slate);">جارٍ تحميل بيانات اللجنة...</div>
    <div class="sc-actions">${actionButtons(['followups', 'weekly', 'exams'])}</div>
  </div>`;
  wireCard(box);
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_assignments').select('committee_number, seat_number, is_special, exam_periods(name, created_at)').eq('student_id', s.id);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  const extra = $('sc-extra');
  if (!extra) return;
  const list = (data || []).filter(a => a.exam_periods).sort((a, b) => String(b.exam_periods.created_at || '').localeCompare(String(a.exam_periods.created_at || '')));
  const a = list[0];
  extra.innerHTML = a
    ? `<span style="display:inline-block; background:var(--gold-light); color:#8A4515; border-radius:99px; padding:5px 12px; font-weight:700;">${a.is_special ? 'اللجنة الخاصة' : 'لجنة ' + esc(a.committee_number)} · رقم الجلوس ${esc(a.seat_number)}</span> <span>— ${esc(a.exam_periods.name)}</span>`
    : 'ما له توزيع على لجان اختبار حاليًا';
}

function showEmployeeCard(e) {
  const box = $('search-results');
  box.innerHTML = `<div class="search-card">
    <button type="button" class="text-action-btn sc-back" style="align-self:flex-start; width:auto; padding:4px 8px;">→ رجوع للنتائج</button>
    <div class="sc-head">
      <span class="si-ic" style="width:52px; height:52px; border-radius:50%; background:var(--purple); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:17px;">${esc(initials(e.full_name))}</span>
      <div><div style="font-size:18px; font-weight:800;">${esc(e.full_name)}</div>
      <div style="font-size:13px; color:var(--slate);">${esc(e.job_title || 'موظف')}${e.profile_id ? '' : ' · بدون حساب دخول'}</div></div>
    </div>
    <div class="sc-actions">${actionButtons(['notes', 'visits', 'duty', 'portal'])}</div>
  </div>`;
  wireCard(box);
}

/* ---------- التهيئة ---------- */
export function initGlobalSearch() {
  if (initialized) return;
  initialized = true;
  $('search-open-btn').addEventListener('click', openSearch);
  $('search-modal').addEventListener('click', (e) => { if (e.target === $('search-modal')) closeSearch(); });
  $('search-input').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const v = e.target.value;
    debounceTimer = setTimeout(() => renderQuery(v), 220);
  });
  $('search-results').addEventListener('click', (e) => {
    const el = e.target.closest('.search-item');
    if (el && items[+el.dataset.i]) items[+el.dataset.i].run();
  });
  document.addEventListener('keydown', (e) => {
    const open = !$('search-modal').classList.contains('hidden');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
      if (document.getElementById('dashboard-screen').classList.contains('hidden')) return;
      e.preventDefault();
      open ? closeSearch() : openSearch();
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActive((activeIndex + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((activeIndex - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) { e.preventDefault(); items[activeIndex].run(); }
  });
}
