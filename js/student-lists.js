/* =========================================================================
 * كشوف الطلاب: مصمم كشوف مرن (رصد، حضور، متابعة، أسماء وهويات...)
 *
 * المعلم يختار فصوله (من الجدول الدراسي) والإدارة أي فصل بالمدرسة، ويصمم الأعمدة (عنوان، عرض، نوع)
 * واتجاه الورقة والترويسة والتواقيع، ويطبع أو يحمّل PDF/Excel. التصاميم تنحفظ كقوالب، والإدارة تقدر
 * تشارك قالب مع كل المعلمين.
 * الصفحات مقسومة بالمليمتر (عدد الأسطر بكل صفحة محسوب) عشان الطباعة والـ PDF يطلعون نفس المعاينة.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool, writeWithSchool, gradeLabels, backToTiles, printOrgName, printLogo } from './core.js';
import { htmlPagesToPdf } from './answer-sheet.js';
import { loadXLSX } from './lib-loader.js';

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const isManager = () => currentProfile && ['admin', 'deputy', 'owner'].includes(currentProfile.role);

/* ---------- أنواع الأعمدة ---------- */
const COL_TYPES = {
  seq: { label: 'م (تسلسل)', title: 'م', w: 8 },
  name: { label: 'اسم الطالب', title: 'اسم الطالب', w: 0 },
  nid: { label: 'رقم الهوية', title: 'رقم الهوية', w: 26 },
  grade: { label: 'الصف', title: 'الصف', w: 20 },
  section: { label: 'الفصل', title: 'الفصل', w: 12 },
  mobile: { label: 'جوال ولي الأمر', title: 'جوال ولي الأمر', w: 26, manager: true },
  blank: { label: 'خانة فاضية', title: 'ملاحظات', w: 30 },
  score: { label: 'درجة (من ...)', title: 'الدرجة', w: 16, max: 10 },
  check: { label: 'مربع ✓', title: 'تم', w: 12 },
  multi: { label: 'أعمدة مقسومة', title: 'المتابعة', w: 9, n: 5, labels: '' },
};
const DATA_TYPES = ['seq', 'name', 'nid', 'grade', 'section', 'mobile'];
const SIGN_OPTS = ['المعلم', 'رائد النشاط', 'الموجه الطلابي', 'وكيل الشؤون التعليمية', 'وكيل شؤون الطلاب', 'مدير المدرسة'];

const col = (type, extra = {}) => ({ id: uid(), type, title: COL_TYPES[type].title, w: COL_TYPES[type].w, ...(type === 'score' ? { max: 10 } : {}), ...(type === 'multi' ? { n: 5, labels: '' } : {}), ...extra });

/* ---------- قوالب جاهزة ---------- */
const PRESETS = [
  { key: 'names', title: 'كشف بالأسماء والهوية', cfg: { orientation: 'portrait', cols: [col('seq'), col('name'), col('nid'), col('section')] } },
  { key: 'grades', title: 'كشف رصد درجات', cfg: { orientation: 'portrait', cols: [col('seq'), col('name'), col('score', { title: 'المشاركة', max: 10 }), col('score', { title: 'الواجبات', max: 10 }), col('score', { title: 'الاختبار القصير', max: 20, w: 18 }), col('score', { title: 'المجموع', max: 40, w: 18 })] } },
  { key: 'attendance', title: 'كشف حضور أسبوعي', cfg: { orientation: 'landscape', cols: [col('seq'), col('name'), col('multi', { title: 'الحضور', n: 5, labels: 'الأحد،الاثنين،الثلاثاء،الأربعاء،الخميس', w: 16 }), col('blank', { title: 'ملاحظات', w: 45 })] } },
  { key: 'follow', title: 'كشف متابعة', cfg: { orientation: 'landscape', cols: [col('seq'), col('name'), col('multi', { title: 'الأسابيع', n: 10, labels: '1،2،3،4،5،6،7،8،9،10', w: 11 }), col('blank', { title: 'ملاحظات', w: 40 })] } },
  { key: 'empty', title: 'كشف رصد فارغ', cfg: { orientation: 'landscape', cols: [col('seq'), col('name'), col('multi', { title: '', n: 12, labels: '', w: 12 })] } },
];

function defaultCfg() {
  return {
    title: 'كشف بأسماء الطلاب', subject: '', term: '', orientation: 'portrait', fontSize: 11, rowH: 7.5,
    sort: 'name', perSection: true, extraRows: 0, showLogo: true, showTeacher: true, zebra: true,
    signs: ['المعلم'], cols: [col('seq'), col('name'), col('nid'), col('section')],
  };
}

const S = {
  students: [], classes: [], subjectsByClass: new Map(), sel: new Set(), cfg: defaultCfg(),
  templates: [], tplId: null, loaded: false, tplError: null,
};

/* ---------- تحميل ---------- */
export async function loadStudentListsModule() {
  const back = $('back-to-tiles-sl');
  if (back && !back.dataset.bound) { back.dataset.bound = '1'; back.addEventListener('click', backToTiles); }
  const root = $('sl-root');
  root.innerHTML = '<div class="sl-empty">جارٍ التحميل...</div>';
  await Promise.all([loadStudentsAndClasses(), loadTemplates()]);
  if (!S.sel.size && S.classes.length) S.sel.add(keyOf(S.classes[0]));
  render();
}

const keyOf = c => c.grade + '|' + c.section;
const secNum = v => (v == null || v === '' ? 0 : Number(v));

async function loadStudentsAndClasses() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('students').select('full_name, national_id, grade_level, class_section, mobile');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  let studs = data || [];
  if (!data) {   // لو عمود الجوال غير متاح
    const r2 = await readScopedBySchool(scoped => {
      let q = sb.from('students').select('full_name, national_id, grade_level, class_section');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    studs = r2.data || [];
  }
  S.students = studs.filter(s => GRADES.includes(s.grade_level));
  const all = new Map();
  S.students.forEach(s => { const c = { grade: s.grade_level, section: secNum(s.class_section) }; all.set(keyOf(c), c); });
  S.subjectsByClass = new Map();
  if (isManager()) {
    S.classes = [...all.values()];
  } else {
    // المعلم: فصوله من الجدول الدراسي (اسمه بالجدول = اسم حسابه)، وإلا صفوف تخصصاته كاملة
    const name = (currentProfile && currentProfile.full_name || '').trim();
    let mine = [];
    if (name) {
      const { data: rows } = await readScopedBySchool(scoped => {
        let q = sb.from('class_schedules').select('grade_level, class_section, subject_name').eq('teacher_name', name);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      });
      (rows || []).forEach(r => {
        const c = { grade: r.grade_level, section: secNum(r.class_section) };
        const k = keyOf(c);
        if (!all.has(k)) return;
        if (!mine.some(m => keyOf(m) === k)) mine.push(c);
        if (r.subject_name) addSubj(c, r.subject_name);
      });
    }
    if (!mine.length) {
      const { data: ts } = await sb.from('teacher_subjects').select('grade_level').eq('teacher_id', currentUserId);
      const grades = new Set((ts || []).map(t => t.grade_level));
      mine = [...all.values()].filter(c => grades.has(c.grade));
    }
    S.classes = mine;
  }
  S.classes.sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade) || a.section - b.section);
  const valid = new Set(S.classes.map(keyOf));
  [...S.sel].forEach(k => { if (!valid.has(k)) S.sel.delete(k); });
}
function addSubj(c, s) {
  const k = keyOf(c);
  if (!S.subjectsByClass.has(k)) S.subjectsByClass.set(k, new Set());
  S.subjectsByClass.get(k).add(s);
}

async function loadTemplates() {
  S.tplError = null;
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('student_list_templates').select('id, title, config, shared, owner_id, updated_at');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('updated_at', { ascending: false });
  });
  if (error) { S.templates = []; S.tplError = /student_list_templates|schema cache|does not exist|relation/i.test(error.message || '') ? 'حفظ القوالب يحتاج تشغيل ملف sql/student_lists.sql' : error.message; return; }
  S.templates = data || [];
}

/* ---------- الواجهة ---------- */
function render() {
  const root = $('sl-root');
  if (!S.classes.length) {
    root.innerHTML = `<div class="ex-empty"><b>ما فيه فصول متاحة لك</b><span>${isManager() ? 'استورد الطلاب من الإعدادات أولًا.' : 'فصولك تُعرف من الجدول الدراسي (اسمك بالجدول) أو من تخصصاتك - راجع الإدارة.'}</span></div>`;
    return;
  }
  root.innerHTML = `
  <div class="sl-wrap">
    <aside class="sl-side">
      <section class="sl-box">
        <h5>القالب</h5>
        <div class="sl-presets">${PRESETS.map(p => `<button type="button" class="sl-chip" data-preset="${p.key}">${esc(p.title)}</button>`).join('')}</div>
        <div class="sl-row">
          <select id="sl-tpl"><option value="">قوالبي المحفوظة${S.templates.length ? ` (${S.templates.length})` : ''}</option>${S.templates.map(t => `<option value="${t.id}"${t.id === S.tplId ? ' selected' : ''}>${esc(t.title)}${t.shared ? ' · مشترك' : ''}${t.owner_id !== currentUserId ? ' (من الإدارة)' : ''}</option>`).join('')}</select>
          <button type="button" class="text-action-btn" id="sl-tpl-del" title="حذف القالب"${canEditTpl() ? '' : ' disabled'}>حذف</button>
        </div>
        ${S.tplError ? `<p class="sl-note bad">${esc(S.tplError)}</p>` : ''}
      </section>

      <section class="sl-box">
        <h5>الطلاب</h5>
        <div class="sl-classes">${GRADES.filter(g => S.classes.some(c => c.grade === g)).map(g => `
          <div class="sl-grade"><label class="sl-gl"><input type="checkbox" data-grade="${g}"> ${esc(gradeLabels[g])}</label>
            <div class="sl-secs">${S.classes.filter(c => c.grade === g).map(c => `<label class="sl-sec${S.sel.has(keyOf(c)) ? ' on' : ''}"><input type="checkbox" data-k="${keyOf(c)}"${S.sel.has(keyOf(c)) ? ' checked' : ''}>${c.section || 'بدون'}</label>`).join('')}</div>
          </div>`).join('')}</div>
        <div class="sl-grid2">
          <label>الترتيب<select id="sl-sort"><option value="name">بالاسم</option><option value="nid">برقم الهوية</option><option value="section">بالفصل ثم الاسم</option></select></label>
          <label>التقسيم<select id="sl-per"><option value="1">كل فصل بصفحة مستقلة</option><option value="0">كلهم بكشف واحد</option></select></label>
          <label>أسطر فاضية زيادة<input type="number" id="sl-extra" min="0" max="40"></label>
        </div>
        <p class="sl-note" id="sl-count"></p>
      </section>

      <section class="sl-box">
        <h5>الأعمدة</h5>
        <div id="sl-cols"></div>
        <div class="sl-row">
          <select id="sl-add-type">${Object.entries(COL_TYPES).filter(([k, t]) => !t.manager || isManager()).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select>
          <button type="button" class="btn-secondary" id="sl-add">+ عمود</button>
        </div>
        <p class="sl-note">العرض بالمليمتر. عمود الاسم ياخذ المساحة الباقية. «أعمدة مقسومة»: اكتب عناوينها مفصولة بفاصلة (مثل: الأحد،الاثنين) أو خلها فاضية.</p>
      </section>

      <section class="sl-box">
        <h5>الورقة والترويسة</h5>
        <div class="sl-seg" id="sl-orient"><button type="button" data-o="portrait">طولي ▯</button><button type="button" data-o="landscape">عرضي ▭</button></div>
        <label>عنوان الكشف<input type="text" id="sl-title"></label>
        <div class="sl-grid2">
          <label>المادة<input type="text" id="sl-subject" placeholder="${S.subjectsByClass.size ? 'تلقائي من الجدول' : 'اختياري'}"></label>
          <label>الفصل الدراسي / ملاحظة<input type="text" id="sl-term" placeholder="مثال: الفصل الدراسي الأول ١٤٤٨هـ"></label>
          <label>حجم الخط<input type="number" id="sl-font" min="7" max="16" step="0.5"></label>
          <label>ارتفاع السطر (مم)<input type="number" id="sl-rowh" min="4.5" max="16" step="0.5"></label>
        </div>
        <div class="sl-checks">
          <label><input type="checkbox" id="sl-logo"> شعار واسم المدرسة</label>
          <label><input type="checkbox" id="sl-teacher"> اسم المعلم بالترويسة</label>
          <label><input type="checkbox" id="sl-zebra"> تظليل الأسطر بالتناوب</label>
        </div>
        <div class="sl-lbl">التواقيع أسفل الصفحة</div>
        <div class="sl-signs">${SIGN_OPTS.map(s => `<label class="sl-chip-chk"><input type="checkbox" data-sign="${esc(s)}"> ${esc(s)}</label>`).join('')}</div>
      </section>

      <section class="sl-box sl-actions">
        <button type="button" class="btn-primary" id="sl-print">🖨 طباعة</button>
        <button type="button" class="btn-secondary" id="sl-pdf">PDF</button>
        <button type="button" class="btn-secondary" id="sl-xlsx">Excel</button>
        <div class="sl-save">
          <input type="text" id="sl-tpl-name" placeholder="اسم القالب للحفظ">
          ${isManager() ? '<label class="sl-share"><input type="checkbox" id="sl-tpl-shared"> مشترك مع المعلمين</label>' : ''}
          <button type="button" class="btn-secondary" id="sl-save">حفظ القالب</button>
        </div>
        <p class="sl-note" id="sl-status"></p>
      </section>
    </aside>
    <div class="sl-preview-wrap">
      <div class="sl-prev-head"><b>معاينة</b><span id="sl-pages"></span></div>
      <div id="sl-preview"></div>
    </div>
  </div>`;
  bind();
  fillForm();
  update();
}

function canEditTpl() {
  const t = S.templates.find(x => x.id === S.tplId);
  return !!t && (t.owner_id === currentUserId || (t.shared && isManager()));
}

function fillForm() {
  const c = S.cfg;
  $('sl-sort').value = c.sort; $('sl-per').value = c.perSection ? '1' : '0'; $('sl-extra').value = c.extraRows;
  $('sl-title').value = c.title; $('sl-subject').value = c.subject || ''; $('sl-term').value = c.term || '';
  $('sl-font').value = c.fontSize; $('sl-rowh').value = c.rowH;
  $('sl-logo').checked = c.showLogo; $('sl-teacher').checked = c.showTeacher; $('sl-zebra').checked = c.zebra;
  document.querySelectorAll('#sl-orient button').forEach(b => b.classList.toggle('active', b.dataset.o === c.orientation));
  document.querySelectorAll('[data-sign]').forEach(i => { i.checked = c.signs.includes(i.dataset.sign); i.closest('label').classList.toggle('on', i.checked); });
  const t = S.templates.find(x => x.id === S.tplId);
  $('sl-tpl-name').value = t ? t.title : '';
  if ($('sl-tpl-shared')) $('sl-tpl-shared').checked = !!(t && t.shared);
  renderCols();
  syncGradeBoxes();
}

function renderCols() {
  const box = $('sl-cols');
  box.innerHTML = S.cfg.cols.map((c, i) => {
    const T = COL_TYPES[c.type] || COL_TYPES.blank;
    return `<div class="sl-col" data-i="${i}">
      <div class="sl-col-top">
        <span class="sl-col-type">${esc(T.label)}</span>
        <span class="sl-col-btns">
          <button type="button" data-act="up" title="لفوق"${i === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" data-act="down" title="لتحت"${i === S.cfg.cols.length - 1 ? ' disabled' : ''}>▼</button>
          <button type="button" data-act="del" title="حذف" class="del">✕</button>
        </span>
      </div>
      <div class="sl-col-f">
        <input type="text" data-f="title" value="${esc(c.title)}" placeholder="العنوان">
        ${c.type === 'name' ? '<span class="sl-auto">عرض تلقائي</span>' : `<label class="sl-w">${c.type === 'multi' ? 'عرض الخانة' : 'العرض'}<input type="number" data-f="w" min="4" max="150" step="1" value="${c.w}"></label>`}
        ${c.type === 'score' ? `<label class="sl-w">من<input type="number" data-f="max" min="1" max="1000" value="${c.max}"></label>` : ''}
        ${c.type === 'multi' ? `<label class="sl-w">العدد<input type="number" data-f="n" min="1" max="31" value="${c.n}"></label><input type="text" data-f="labels" class="sl-labels" value="${esc(c.labels || '')}" placeholder="عناوين الخانات (اختياري)">` : ''}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.sl-col').forEach(el => {
    const i = +el.dataset.i;
    el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
      const f = inp.dataset.f;
      S.cfg.cols[i][f] = ['w', 'max', 'n'].includes(f) ? Number(inp.value) || 0 : inp.value;
      update();
    }));
    el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const cols = S.cfg.cols;
      if (b.dataset.act === 'del') cols.splice(i, 1);
      if (b.dataset.act === 'up' && i > 0) [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
      if (b.dataset.act === 'down' && i < cols.length - 1) [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]];
      renderCols(); update();
    }));
  });
}

function syncGradeBoxes() {
  document.querySelectorAll('[data-grade]').forEach(g => {
    const ks = S.classes.filter(c => c.grade === g.dataset.grade).map(keyOf);
    const n = ks.filter(k => S.sel.has(k)).length;
    g.checked = n === ks.length; g.indeterminate = n > 0 && n < ks.length;
  });
  document.querySelectorAll('[data-k]').forEach(i => { i.checked = S.sel.has(i.dataset.k); i.closest('label').classList.toggle('on', i.checked); });
}

function bind() {
  const c = S.cfg;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const p = PRESETS.find(x => x.key === b.dataset.preset);
    const keep = { subject: S.cfg.subject, term: S.cfg.term, signs: S.cfg.signs, sort: S.cfg.sort, perSection: S.cfg.perSection };
    S.cfg = { ...defaultCfg(), ...keep, title: p.title, ...JSON.parse(JSON.stringify(p.cfg)) };
    S.cfg.cols.forEach(cc => { cc.id = uid(); });
    S.tplId = null; $('sl-tpl').value = '';
    fillForm(); update();
  }));
  on('sl-tpl', 'change', e => {
    const t = S.templates.find(x => x.id === e.target.value);
    S.tplId = t ? t.id : null;
    if (t) S.cfg = { ...defaultCfg(), ...JSON.parse(JSON.stringify(t.config || {})) };
    $('sl-tpl-del').disabled = !canEditTpl();
    fillForm(); update();
  });
  on('sl-tpl-del', 'click', async () => {
    const t = S.templates.find(x => x.id === S.tplId);
    if (!t || !confirm(`حذف القالب «${t.title}»؟`)) return;
    const { error } = await sb.from('student_list_templates').delete().eq('id', t.id);
    if (error) { status('تعذر الحذف: ' + error.message, true); return; }
    S.tplId = null; await loadTemplates(); render();
  });
  document.querySelectorAll('[data-grade]').forEach(g => g.addEventListener('change', () => {
    S.classes.filter(x => x.grade === g.dataset.grade).forEach(x => { if (g.checked) S.sel.add(keyOf(x)); else S.sel.delete(keyOf(x)); });
    syncGradeBoxes(); update();
  }));
  document.querySelectorAll('[data-k]').forEach(i => i.addEventListener('change', () => {
    if (i.checked) S.sel.add(i.dataset.k); else S.sel.delete(i.dataset.k);
    syncGradeBoxes(); update();
  }));
  on('sl-sort', 'change', e => { c.sort = e.target.value; update(); });
  on('sl-per', 'change', e => { c.perSection = e.target.value === '1'; update(); });
  on('sl-extra', 'input', e => { c.extraRows = Math.max(0, Math.min(40, Number(e.target.value) || 0)); update(); });
  on('sl-title', 'input', e => { c.title = e.target.value; update(); });
  on('sl-subject', 'input', e => { c.subject = e.target.value; update(); });
  on('sl-term', 'input', e => { c.term = e.target.value; update(); });
  on('sl-font', 'input', e => { c.fontSize = Math.max(7, Math.min(16, Number(e.target.value) || 11)); update(); });
  on('sl-rowh', 'input', e => { c.rowH = Math.max(4.5, Math.min(16, Number(e.target.value) || 7.5)); update(); });
  on('sl-logo', 'change', e => { c.showLogo = e.target.checked; update(); });
  on('sl-teacher', 'change', e => { c.showTeacher = e.target.checked; update(); });
  on('sl-zebra', 'change', e => { c.zebra = e.target.checked; update(); });
  document.querySelectorAll('#sl-orient button').forEach(b => b.addEventListener('click', () => {
    c.orientation = b.dataset.o;
    document.querySelectorAll('#sl-orient button').forEach(x => x.classList.toggle('active', x === b));
    update();
  }));
  document.querySelectorAll('[data-sign]').forEach(i => i.addEventListener('change', () => {
    const s = i.dataset.sign;
    c.signs = SIGN_OPTS.filter(x => (x === s ? i.checked : c.signs.includes(x)));
    i.closest('label').classList.toggle('on', i.checked);
    update();
  }));
  on('sl-add', 'click', () => { S.cfg.cols.push(col($('sl-add-type').value)); renderCols(); update(); });
  on('sl-print', 'click', doPrint);
  on('sl-pdf', 'click', doPdf);
  on('sl-xlsx', 'click', doXlsx);
  on('sl-save', 'click', saveTemplate);
  if (!window.__slResize) { window.__slResize = true; window.addEventListener('resize', schedulePreview); }
}

function status(msg, bad = false) { const el = $('sl-status'); if (el) { el.textContent = msg; el.classList.toggle('bad', bad); } }

/* ---------- البيانات: مجموعات (فصل أو الكل) ---------- */
function groups() {
  const c = S.cfg;
  const chosen = S.classes.filter(x => S.sel.has(keyOf(x)));
  const keySet = new Set(chosen.map(keyOf));
  const studs = S.students.filter(s => keySet.has(s.grade_level + '|' + secNum(s.class_section)));
  const cmp = {
    name: (a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ar'),
    nid: (a, b) => String(a.national_id || '').localeCompare(String(b.national_id || '')),
    section: (a, b) => GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level) || secNum(a.class_section) - secNum(b.class_section) || String(a.full_name).localeCompare(String(b.full_name), 'ar'),
  }[c.sort] || ((a, b) => 0);
  if (c.perSection) {
    return chosen.map(cl => ({ cls: cl, students: studs.filter(s => s.grade_level === cl.grade && secNum(s.class_section) === cl.section).sort(cmp) }));
  }
  return [{ cls: null, classes: chosen, students: studs.sort(cmp) }];
}

function subjectFor(g) {
  if (S.cfg.subject) return S.cfg.subject;
  const ks = g.cls ? [keyOf(g.cls)] : (g.classes || []).map(keyOf);
  const set = new Set();
  ks.forEach(k => (S.subjectsByClass.get(k) || []).forEach(s => set.add(s)));
  return [...set].join('، ');
}

/* ---------- الإخراج: صفحات بالمليمتر ---------- */
const PAGE = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };
const M = 10;   // هامش الصفحة

function layoutCols() {
  const c = S.cfg;
  const pg = PAGE[c.orientation];
  const avail = pg.w - 2 * M;
  const cols = c.cols.filter(x => COL_TYPES[x.type]);
  const widthOf = x => (x.type === 'multi' ? Math.max(1, x.n | 0) * Math.max(4, x.w || 9) : Math.max(4, x.w || 10));
  const flex = cols.filter(x => x.type === 'name');
  let fixed = cols.filter(x => x.type !== 'name').reduce((s, x) => s + widthOf(x), 0);
  const minFlex = flex.length ? 38 * flex.length : 0;
  let scale = 1;
  if (fixed + minFlex > avail) scale = (avail - minFlex) / fixed;
  const flexW = flex.length ? (avail - fixed * scale) / flex.length : 0;
  const out = cols.map(x => ({ ...x, mm: x.type === 'name' ? flexW : widthOf(x) * scale }));
  // لو ما فيه عمود اسم والمجموع أقل من العرض: نوسّع بالتناسب
  const tot = out.reduce((s, x) => s + x.mm, 0);
  if (!flex.length && tot < avail) out.forEach(x => { x.mm *= avail / tot; });
  return { cols: out, avail, scaled: scale < 1 };
}

function headerHeight() { return S.cfg.showLogo ? 30 : 20; }
function footerHeight() { return (S.cfg.signs.length ? 16 : 0) + 6; }

function buildPages() {
  const c = S.cfg;
  const pg = PAGE[c.orientation];
  const L = layoutCols();
  const hasMulti = L.cols.some(x => x.type === 'multi');
  const headH = c.rowH * (hasMulti ? 2 : 1.3);
  const bodyH = pg.h - 2 * M - headerHeight() - footerHeight() - headH;
  const perPage = Math.max(3, Math.floor(bodyH / c.rowH));
  const pages = [];
  groups().forEach(g => {
    const rows = g.students.map(s => s);
    for (let i = 0; i < c.extraRows; i++) rows.push(null);
    const n = Math.max(1, Math.ceil(rows.length / perPage));
    for (let p = 0; p < n; p++) pages.push({ g, rows: rows.slice(p * perPage, (p + 1) * perPage), start: p * perPage, pageNo: p + 1, pages: n });
  });
  const html = pages.map(p => pageHtml(p, L, headH)).join('');
  return { html, count: pages.length, pg, scaled: L.scaled, students: groups().reduce((s, g) => s + g.students.length, 0) };
}

function cellValue(x, s, idx) {
  if (!s) return x.type === 'seq' ? '' : '';
  switch (x.type) {
    case 'seq': return String(idx + 1);
    case 'name': return esc(s.full_name);
    case 'nid': return `<span dir="ltr">${esc(s.national_id || '')}</span>`;
    case 'grade': return esc((gradeLabels[s.grade_level] || '').replace(' متوسط', ''));
    case 'section': return esc(s.class_section != null ? s.class_section : '');
    case 'mobile': return `<span dir="ltr">${esc(s.mobile || '')}</span>`;
    default: return '';
  }
}

function pageHtml(p, L, headH) {
  const c = S.cfg;
  const pg = PAGE[c.orientation];
  const mm = v => `${Math.round(v * 100) / 100}mm`;
  const g = p.g;
  const hasMulti = L.cols.some(x => x.type === 'multi');
  const info = [];
  if (g.cls) info.push(`الصف: <b>${esc(gradeLabels[g.cls.grade] || '')}</b>`, `الفصل: <b>${esc(g.cls.section || '-')}</b>`);
  else if (g.classes && g.classes.length) {
    const gs = [...new Set(g.classes.map(x => x.grade))];
    info.push(gs.length === 1 ? `الصف: <b>${esc(gradeLabels[gs[0]])}</b> · الفصول: <b>${esc(g.classes.map(x => x.section).join('، '))}</b>` : `<b>${g.classes.length}</b> فصول`);
  }
  const subj = subjectFor(g);
  if (subj) info.push(`المادة: <b>${esc(subj)}</b>`);
  if (c.showTeacher && currentProfile && currentProfile.role === 'teacher') info.push(`المعلم: <b>${esc(currentProfile.full_name)}</b>`);
  info.push(`عدد الطلاب: <b>${g.students.length}</b>`);
  const logo = printLogo();
  let h = `<div class="sl-page" style="width:${pg.w}mm; height:${pg.h}mm; padding:${M}mm; font-size:${c.fontSize}pt;">`;
  h += `<div class="sl-hd" style="height:${mm(headerHeight())};">`;
  if (c.showLogo) {
    h += `<div class="sl-hd-top"><div class="sl-org">${esc(printOrgName())}</div>${logo ? `<img src="${logo}" alt="">` : ''}<div class="sl-hd-side">${c.term ? esc(c.term) : ''}</div></div>`;
  }
  h += `<div class="sl-ttl">${esc(c.title || 'كشف')}</div>`;
  h += `<div class="sl-info">${info.join('<span class="sep">·</span>')}${!c.showLogo && c.term ? `<span class="sep">·</span>${esc(c.term)}` : ''}</div>`;
  h += `</div>`;

  // الجدول
  h += `<table class="sl-tb" style="width:${mm(L.avail)};"><colgroup>`;
  L.cols.forEach(x => {
    if (x.type === 'multi') for (let i = 0; i < (x.n | 0); i++) h += `<col style="width:${mm(x.mm / (x.n | 0))}">`;
    else h += `<col style="width:${mm(x.mm)}">`;
  });
  h += `</colgroup><thead>`;
  const hdr = x => `${esc(x.title)}${x.type === 'score' ? `<small>من ${esc(x.max)}</small>` : ''}`;
  if (hasMulti) {
    h += `<tr style="height:${mm(headH / 2)}">`;
    L.cols.forEach(x => {
      if (x.type === 'multi') h += `<th colspan="${x.n | 0}">${esc(x.title)}</th>`;
      else h += `<th rowspan="2">${hdr(x)}</th>`;
    });
    h += `</tr><tr style="height:${mm(headH / 2)}">`;
    L.cols.filter(x => x.type === 'multi').forEach(x => {
      const labels = String(x.labels || '').split(/[,،]/).map(s => s.trim());
      for (let i = 0; i < (x.n | 0); i++) h += `<th class="sub">${esc(labels[i] || '')}</th>`;
    });
    h += `</tr>`;
  } else {
    h += `<tr style="height:${mm(headH)}">${L.cols.map(x => `<th>${hdr(x)}</th>`).join('')}</tr>`;
  }
  h += `</thead><tbody>`;
  p.rows.forEach((s, i) => {
    const idx = p.start + i;
    h += `<tr style="height:${mm(c.rowH)}"${c.zebra && idx % 2 ? ' class="z"' : ''}>`;
    L.cols.forEach(x => {
      if (x.type === 'multi') { for (let k = 0; k < (x.n | 0); k++) h += '<td></td>'; return; }
      const v = cellValue(x, s, idx);
      const cls = x.type === 'name' ? 'nm' : x.type === 'check' ? 'ck' : '';
      h += `<td class="${cls}">${x.type === 'check' ? '<span class="box"></span>' : v}</td>`;
    });
    h += `</tr>`;
  });
  h += `</tbody></table>`;

  // التذييل
  h += `<div class="sl-ft" style="height:${mm(footerHeight())};">`;
  if (c.signs.length) h += `<div class="sl-signs-row">${c.signs.map(s => `<div class="sl-sign"><span>${esc(s)}</span><i></i>${s === 'المعلم' && currentProfile && currentProfile.role === 'teacher' ? `<em>${esc(currentProfile.full_name)}</em>` : ''}</div>`).join('')}</div>`;
  h += `<div class="sl-pno">${p.pages > 1 ? `صفحة ${p.pageNo} من ${p.pages}` : ''}</div>`;
  h += `</div></div>`;
  return h;
}

const SL_STYLES = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { background:#fff; font-family:'Tahoma','Arial',sans-serif; color:#000; direction:rtl; }
  .sl-page { position:relative; overflow:hidden; background:#fff; display:flex; flex-direction:column; page-break-after:always; break-after:page; }
  .sl-page:last-child { page-break-after:auto; break-after:auto; }
  .sl-hd { display:flex; flex-direction:column; justify-content:flex-end; gap:1.2mm; padding-bottom:2mm; }
  .sl-hd-top { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:4mm; }
  .sl-hd-top img { height:12mm; max-width:40mm; object-fit:contain; }
  .sl-org { font-weight:700; font-size:1em; }
  .sl-hd-side { text-align:left; font-size:0.85em; color:#333; }
  .sl-ttl { text-align:center; font-weight:800; font-size:1.35em; }
  .sl-info { text-align:center; font-size:0.9em; color:#222; }
  .sl-info .sep { margin:0 2.5mm; color:#999; }
  .sl-tb { border-collapse:collapse; table-layout:fixed; }
  .sl-tb th, .sl-tb td { border:0.25mm solid #000; text-align:center; vertical-align:middle; padding:0 1mm; overflow:hidden; white-space:nowrap; }
  .sl-tb th { background:#e8e8e8; font-weight:700; font-size:0.92em; line-height:1.15; white-space:normal; }
  .sl-tb th small { display:block; font-weight:400; font-size:0.78em; color:#333; }
  .sl-tb th.sub { font-size:0.78em; font-weight:600; }
  .sl-tb td.nm { text-align:right; padding-right:2mm; text-overflow:ellipsis; }
  .sl-tb tr.z td { background:#f4f4f4; }
  .sl-tb .box { display:inline-block; width:3.2mm; height:3.2mm; border:0.25mm solid #000; vertical-align:middle; }
  .sl-ft { margin-top:auto; display:flex; flex-direction:column; justify-content:flex-end; }
  .sl-signs-row { display:flex; justify-content:space-around; gap:6mm; }
  .sl-sign { display:flex; flex-direction:column; align-items:center; gap:1mm; font-size:0.9em; font-weight:700; min-width:35mm; }
  .sl-sign i { display:block; width:38mm; border-bottom:0.25mm dotted #000; height:6mm; }
  .sl-sign em { font-style:normal; font-weight:400; font-size:0.85em; }
  .sl-pno { text-align:center; font-size:0.75em; color:#555; height:5mm; line-height:5mm; }
`;

/* ---------- المعاينة ---------- */
let prevTimer = null;
function update() { schedulePreview(); }
function schedulePreview() { clearTimeout(prevTimer); prevTimer = setTimeout(renderPreview, 120); }

function renderPreview() {
  const box = $('sl-preview');
  if (!box) return;
  const total = S.students.filter(s => S.sel.has(s.grade_level + '|' + secNum(s.class_section))).length;
  $('sl-count').textContent = S.sel.size ? `${S.sel.size} فصل · ${total} طالب` : 'اختر فصل واحد على الأقل';
  if (!S.sel.size) { box.innerHTML = ''; $('sl-pages').textContent = ''; return; }
  const b = buildPages();
  $('sl-pages').textContent = `${b.count} صفحة${b.scaled ? ' · الأعمدة أعرض من الورقة فصغّرناها - جرّب الورقة العرضية' : ''}`;
  // نعرض أول صفحة (وثانية لو موجودة) بحجم يناسب العرض
  const pxW = b.pg.w * 3.7795, pxH = b.pg.h * 3.7795;
  const scale = Math.min(1, (box.clientWidth || 600) / pxW);
  box.innerHTML = `<div class="sl-frame" dir="ltr" style="width:${pxW * scale}px; height:${pxH * scale}px;"><iframe title="معاينة الكشف" style="width:${pxW}px; height:${pxH}px; transform:scale(${scale}); transform-origin:0 0;"></iframe></div>`;
  const firstPage = b.html.split('<div class="sl-page"').filter(Boolean)[0];
  const d = box.querySelector('iframe').contentDocument;
  d.open();
  d.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>html,body{width:${b.pg.w}mm; overflow:hidden;} ${SL_STYLES}</style></head><body><div class="sl-page"${firstPage}</body></html>`);
  d.close();
}

/* ---------- طباعة / PDF / Excel ---------- */
function fileBase() {
  const chosen = S.classes.filter(x => S.sel.has(keyOf(x)));
  const part = chosen.length === 1 ? `${gradeLabels[chosen[0].grade] || ''} ${chosen[0].section}` : `${chosen.length} فصول`;
  return `${(S.cfg.title || 'كشف').replace(/[\\/:*?"<>|]/g, '')} - ${part}`;
}

function doPrint() {
  if (!S.sel.size) { status('اختر فصل واحد على الأقل', true); return; }
  const b = buildPages();
  const win = window.open('', '_blank');
  if (!win) { status('اسمح بفتح النوافذ المنبثقة للطباعة', true); return; }
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(fileBase())}</title>
    <style>@page { size:${b.pg.w}mm ${b.pg.h}mm; margin:0; } html,body{width:${b.pg.w}mm;} ${SL_STYLES}</style></head><body>${b.html}</body></html>`);
  win.document.close();
  const go = () => { win.focus(); win.print(); };
  Promise.all([...win.document.images].map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })))).then(() => setTimeout(go, 200));
  status(`جاهز للطباعة: ${b.count} صفحة. اطبع بالحجم الفعلي 100% وبدون رؤوس وتذييلات.`);
}

async function doPdf() {
  if (!S.sel.size) { status('اختر فصل واحد على الأقل', true); return; }
  const b = buildPages();
  const btn = $('sl-pdf'); btn.disabled = true;
  try {
    await htmlPagesToPdf({ html: b.html, styles: SL_STYLES, w: b.pg.w, h: b.pg.h, pageSelector: '.sl-page', filename: fileBase() + '.pdf', onStatus: m => status(m) });
    status(`تم تحميل ملف PDF (${b.count} صفحة) ✓`);
  } catch (e) { status('تعذر إنشاء PDF: ' + (e.message || e), true); }
  btn.disabled = false;
}

async function doXlsx() {
  if (!S.sel.size) { status('اختر فصل واحد على الأقل', true); return; }
  try { await loadXLSX(); } catch (e) { status('تعذر تحميل مكتبة Excel', true); return; }
  const L = layoutCols();
  const wb = XLSX.utils.book_new();
  const used = new Set();
  groups().forEach(g => {
    const head1 = [], head2 = [], merges = [];
    const hasMulti = L.cols.some(x => x.type === 'multi');
    let ci = 0;
    L.cols.forEach(x => {
      if (x.type === 'multi') {
        const labels = String(x.labels || '').split(/[,،]/).map(s => s.trim());
        for (let i = 0; i < (x.n | 0); i++) { head1.push(i === 0 ? x.title : ''); head2.push(labels[i] || ''); }
        if ((x.n | 0) > 1) merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + (x.n | 0) - 1 } });
        ci += x.n | 0;
      } else {
        head1.push(x.type === 'score' ? `${x.title} (من ${x.max})` : x.title); head2.push('');
        if (hasMulti) merges.push({ s: { r: 0, c: ci }, e: { r: 1, c: ci } });
        ci++;
      }
    });
    const rows = [head1];
    if (hasMulti) rows.push(head2);
    const list = g.students.concat(Array(S.cfg.extraRows).fill(null));
    list.forEach((s, idx) => {
      const r = [];
      L.cols.forEach(x => {
        if (x.type === 'multi') { for (let i = 0; i < (x.n | 0); i++) r.push(''); return; }
        if (!s) { r.push(x.type === 'seq' ? '' : ''); return; }
        r.push({ seq: idx + 1, name: s.full_name, nid: s.national_id || '', grade: gradeLabels[s.grade_level] || '', section: s.class_section ?? '', mobile: s.mobile || '' }[x.type] ?? '');
      });
      rows.push(r);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;
    ws['!cols'] = L.cols.flatMap(x => (x.type === 'multi' ? Array(x.n | 0).fill({ wch: Math.max(4, Math.round(x.mm / (x.n | 0) / 2)) }) : [{ wch: Math.max(4, Math.round(x.mm / 2)) }]));
    ws['!views'] = [{ RTL: true }];
    let name = g.cls ? `${(gradeLabels[g.cls.grade] || '').replace(' متوسط', '')} ${g.cls.section}` : 'الكشف';
    name = name.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'ورقة';
    let n2 = name, k = 2;
    while (used.has(n2)) n2 = (name.slice(0, 28) + ' ' + k++);
    used.add(n2);
    XLSX.utils.book_append_sheet(wb, ws, n2);
  });
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.writeFile(wb, fileBase() + '.xlsx');
  status('تم تحميل ملف Excel ✓');
}

/* ---------- حفظ القالب ---------- */
async function saveTemplate() {
  const title = $('sl-tpl-name').value.trim() || S.cfg.title.trim();
  if (!title) { status('اكتب اسم للقالب', true); return; }
  const shared = !!($('sl-tpl-shared') && $('sl-tpl-shared').checked);
  const cur = S.templates.find(x => x.id === S.tplId);
  const row = { title, config: S.cfg, shared, updated_at: new Date().toISOString() };
  let res;
  if (cur && canEditTpl() && cur.title === title) res = await sb.from('student_list_templates').update(row).eq('id', cur.id).select('id').single();
  else res = await writeWithSchool(extra => sb.from('student_list_templates').insert({ ...row, owner_id: currentUserId, ...extra }).select('id').single());
  if (res.error) {
    status(/student_list_templates|schema cache|does not exist|relation/i.test(res.error.message || '') ? 'حفظ القوالب يحتاج تشغيل ملف sql/student_lists.sql' : 'تعذر الحفظ: ' + res.error.message, true);
    return;
  }
  S.tplId = res.data.id;
  await loadTemplates();
  const keepSel = new Set(S.sel);
  render();
  S.sel = keepSel; syncGradeBoxes();
  status(`تم حفظ القالب «${title}» ✓${shared ? ' (مشترك مع المعلمين)' : ''}`);
}
