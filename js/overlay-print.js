/* =========================================================================
 * الطباعة على النموذج المعتمد (ورقة إجابة الاختبارات النهائية المطبوعة مسبقًا)
 *
 * 1) يرفع المستخدم ملف PDF للنموذج - نعرض صفحته الأولى كخلفية بنفس مقاسها الحقيقي بالمليمتر.
 * 2) يفعّل الحقول اللي يبيها (باركود رقم الهوية، الاسم، الصف، المادة، رقم الجلوس، ...) ويسحبها
 *    لمكانها فوق النموذج ويغيّر حجمها.
 * 3) يطبع/يحمّل PDF فيه البيانات فقط (بدون النموذج) - ورقة لكل طالب - عشان تنطبع فوق الأوراق
 *    المعتمدة المحمّلة بالطابعة. مع خيار "طباعة تجربة مع النموذج" وإزاحة عامة لضبط الطابعة.
 * التخطيط (مواقع الحقول + صورة مصغّرة للنموذج) ينحفظ بجدول overlay_layouts لإعادة استخدامه.
 * ========================================================================= */
import { sb, gradeLabels, currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';
import { loadPdfJs } from './lib-loader.js';
import { code128Svg, code128Modules, htmlPagesToPdf } from './answer-sheet.js';

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

// الحقول المتاحة: أبعاد مبدئية بالمليمتر وحجم خط بالـ pt
const FIELD_DEFS = [
  { key: 'barcode', label: 'الباركود (رقم الهوية)', w: 50, h: 15, barcode: true },
  { key: 'full_name', label: 'اسم الطالب', w: 75, h: 7, fs: 12 },
  { key: 'national_id', label: 'رقم الهوية', w: 35, h: 7, fs: 12 },
  { key: 'grade', label: 'الصف', w: 30, h: 7, fs: 11 },
  { key: 'section', label: 'الفصل', w: 15, h: 7, fs: 11 },
  { key: 'grade_section', label: 'الصف والفصل معًا', w: 40, h: 7, fs: 11 },
  { key: 'subject', label: 'المادة', w: 40, h: 7, fs: 11 },
  { key: 'exam_title', label: 'عنوان الاختبار', w: 60, h: 7, fs: 11 },
  { key: 'seat_number', label: 'رقم الجلوس', w: 25, h: 7, fs: 12, period: true },
  { key: 'committee', label: 'رقم اللجنة', w: 25, h: 7, fs: 12, period: true },
  { key: 'year', label: 'العام الدراسي', w: 30, h: 7, fs: 11 },
  { key: 'semester', label: 'الفصل الدراسي', w: 40, h: 7, fs: 11 },
  { key: 'custom', label: 'نص ثابت', w: 50, h: 7, fs: 11 },
];
const DEF = Object.fromEntries(FIELD_DEFS.map(d => [d.key, d]));

let layout = null;          // { id, name, page_w, page_h, background, fields:{key:{...}}, offset_x, offset_y }
let selectedKey = null;
let students = [], studentsLoaded = false;
let periods = [], assignments = new Map();   // student_id -> assignment (للفترة المختارة)
let savedLayouts = [];
let initialized = false;

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const r1 = v => Math.round(v * 10) / 10;
function status(msg, isErr = false) { const el = $('ov-status'); el.textContent = msg; el.style.color = isErr ? 'var(--danger)' : 'var(--slate)'; }
function tableMissing(err) { return /overlay_layouts|relation|does not exist|schema cache/i.test((err && err.message) || ''); }

/* ---------------- تحميل النموذج (PDF) ---------------- */
async function loadTemplatePdf(file) {
  status('جارٍ قراءة النموذج...');
  await loadPdfJs();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const pageW = vp1.width * 25.4 / 72, pageH = vp1.height * 25.4 / 72;
  const scale = 1100 / vp1.width;  // خلفية بعرض ~١١٠٠ بكسل تكفي للمحاذاة وحجمها خفيف للحفظ
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const background = canvas.toDataURL('image/jpeg', 0.7);
  const keepFields = layout && layout.fields ? layout.fields : null;
  layout = {
    id: layout ? layout.id : null,
    name: layout ? layout.name : file.name.replace(/\.pdf$/i, ''),
    page_w: r1(pageW), page_h: r1(pageH), background,
    fields: keepFields || defaultFields(pageW),
    offset_x: layout ? layout.offset_x || 0 : 0, offset_y: layout ? layout.offset_y || 0 : 0,
  };
  $('ov-name').value = layout.name;
  $('ov-offset-x').value = layout.offset_x; $('ov-offset-y').value = layout.offset_y;
  status(`تم تحميل النموذج (${Math.round(pageW)}×${Math.round(pageH)} مم) - فعّل الحقول واسحبها لمكانها`);
  renderAll();
}

function defaultFields(pageW) {
  // مبدئيًا: الاسم والهوية والباركود مفعّلة ومرصوصة أعلى الصفحة
  const f = {};
  FIELD_DEFS.forEach((d, i) => {
    f[d.key] = { on: ['barcode', 'full_name', 'national_id'].includes(d.key), x: Math.max(5, pageW - d.w - 15), y: 15 + i * 9, w: d.w, h: d.h, fs: d.fs || 11, bold: true, align: 'right', digits: true };
  });
  f.barcode.x = 15; f.barcode.y = 15;
  return f;
}

/* ---------------- بيانات الطلاب والفترات ---------------- */
async function loadStudentsAndPeriods() {
  if (studentsLoaded) return;
  const [st, pr] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('students').select('id, full_name, national_id, grade_level, class_section');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_periods').select('id, name, academic_year, semester');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('created_at', { ascending: false });
    }),
  ]);
  students = (st.data || []).filter(s => GRADES.includes(s.grade_level));
  periods = pr.data || [];
  studentsLoaded = true;
  $('ov-period').innerHTML = '<option value="">بدون (ما نحتاج رقم جلوس/لجنة)</option>' +
    periods.map(p => `<option value="${p.id}">${esc(p.name)}${p.academic_year ? ' — ' + esc(p.academic_year) : ''}</option>`).join('');
  refreshScope();
}

async function onPeriodChange() {
  const id = $('ov-period').value;
  assignments = new Map();
  const p = periods.find(x => x.id === id);
  if (p) {
    const { data } = await readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_assignments').select('student_id, committee_number, seat_number, is_special').eq('period_id', id);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    (data || []).forEach(a => assignments.set(a.student_id, a));
    if (!$('ov-year').value && p.academic_year) $('ov-year').value = p.academic_year;
    if (!$('ov-semester').value && p.semester) $('ov-semester').value = p.semester;
  }
  $('ov-order').querySelector('option[value="committee"]').disabled = !p;
  if (!p && $('ov-order').value === 'committee') $('ov-order').value = 'class';
  refreshScope(); renderStage();
}

function refreshScope() {
  const scope = $('ov-scope').value;
  $('ov-grade-wrap').classList.toggle('hidden', scope === 'school');
  $('ov-section-wrap').classList.toggle('hidden', scope !== 'class');
  if (scope === 'class') {
    const g = $('ov-grade').value, prev = $('ov-section').value;
    const secs = [...new Set(students.filter(s => s.grade_level === g).map(s => s.class_section || 0))].sort((a, b) => a - b);
    $('ov-section').innerHTML = secs.length ? secs.map(n => `<option value="${n}">${esc(gradeLabels[g] || '')} ${n}</option>`).join('') : '<option value="">لا يوجد فصول</option>';
    if (secs.map(String).includes(prev)) $('ov-section').value = prev;
  }
  const n = selectedStudents().length;
  $('ov-count').textContent = studentsLoaded ? (n ? `عدد الأوراق: ${n}` : 'لا يوجد طلاب بهذا الاختيار') : '';
}

function selectedStudents() {
  const scope = $('ov-scope').value, g = $('ov-grade').value;
  let list = students;
  if (scope === 'grade') list = list.filter(s => s.grade_level === g);
  if (scope === 'class') { const sec = parseInt($('ov-section').value, 10); list = list.filter(s => s.grade_level === g && (s.class_section || 0) === sec); }
  if ($('ov-period').value && $('ov-only-period').checked) list = list.filter(s => assignments.has(s.id));
  const byClass = (a, b) => (GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level)) || ((a.class_section || 0) - (b.class_section || 0)) || String(a.full_name).localeCompare(String(b.full_name), 'ar');
  if ($('ov-order').value === 'committee' && assignments.size) {
    const key = s => { const a = assignments.get(s.id); return a ? [a.is_special ? 1e6 : a.committee_number, a.seat_number || 0] : [2e6, 0]; };
    return list.slice().sort((a, b) => { const ka = key(a), kb = key(b); return (ka[0] - kb[0]) || (ka[1] - kb[1]) || byClass(a, b); });
  }
  return list.slice().sort(byClass);
}

function fieldValue(key, s) {
  const a = s ? assignments.get(s.id) : null;
  const g = s ? (gradeLabels[s.grade_level] || '') : '';
  switch (key) {
    case 'full_name': return s ? s.full_name : 'اسم الطالب';
    case 'national_id': return s ? s.national_id : '1234567890';
    case 'grade': return s ? g : 'أول متوسط';
    case 'section': return s ? (s.class_section || '') : '1';
    case 'grade_section': return s ? `${g} ${s.class_section || ''}`.trim() : 'أول متوسط 1';
    case 'subject': return $('ov-subject').value.trim() || (s ? '' : 'المادة');
    case 'exam_title': return $('ov-title').value.trim() || (s ? '' : 'عنوان الاختبار');
    case 'seat_number': return a ? (a.seat_number ?? '') : (s ? '' : '101');
    case 'committee': return a ? (a.is_special ? 'خاصة' : a.committee_number) : (s ? '' : '3');
    case 'year': return $('ov-year').value.trim() || (s ? '' : '1447هـ');
    case 'semester': return $('ov-semester').value.trim() || (s ? '' : 'الفصل الدراسي الأول');
    case 'custom': return $('ov-custom').value.trim() || (s ? '' : 'نص ثابت');
    default: return '';
  }
}

/* ---------------- رسم حقل (للمعاينة والإخراج) ---------------- */
function fieldHtml(key, f, s, dx = 0, dy = 0, mmUnit = 'mm') {
  const u = v => `${Math.round(v * 100) / 100}${mmUnit}`;
  const box = `left:${u(f.x + dx)}; top:${u(f.y + dy)}; width:${u(f.w)}; height:${u(f.h)};`;
  if (DEF[key].barcode) {
    const id = String(s ? s.national_id : '1234567890').trim();
    if (!/^[\x20-\x7E]+$/.test(id)) return '';
    const digitsH = f.digits ? Math.min(3.6, f.h * 0.3) : 0;
    const { totalModules } = code128Modules(id);
    const bc = code128Svg(id, f.w / totalModules, f.h - digitsH);
    const svg = mmUnit === 'mm' ? bc.svg : bc.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="' + (100 * (f.h - digitsH) / f.h) + '%"');
    return `<div class="ov-f" style="${box} flex-direction:column; justify-content:flex-start;">${svg}${f.digits ? `<div style="font-family:'Courier New',monospace; font-weight:700; font-size:${Math.max(6, digitsH * 2.2)}pt; line-height:1; direction:ltr; letter-spacing:0.4mm;">${esc(id)}</div>` : ''}</div>`;
  }
  const just = { right: 'flex-start', center: 'center', left: 'flex-end' }[f.align] || 'flex-start';
  return `<div class="ov-f" dir="rtl" style="${box} justify-content:${just}; font-size:${f.fs}pt; font-weight:${f.bold ? 700 : 400};">${esc(fieldValue(key, s))}</div>`;
}

const OUT_STYLES = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { background:#fff; }
  .ov-page { position:relative; overflow:hidden; background:transparent; page-break-after:always; break-after:page; }
  .ov-page:last-child { page-break-after:auto; break-after:auto; }
  .ov-bg { position:absolute; left:0; top:0; width:100%; height:100%; }
  .ov-f { position:absolute; display:flex; align-items:center; white-space:nowrap; overflow:hidden; font-family:'Tahoma','Arial',sans-serif; color:#000; line-height:1.1; }
`;

function buildOutput(withBackground) {
  if (!layout) throw new Error('ارفع ملف النموذج أولًا');
  const on = FIELD_DEFS.filter(d => layout.fields[d.key] && layout.fields[d.key].on);
  if (!on.length) throw new Error('فعّل حقل واحد على الأقل');
  const list = selectedStudents();
  if (!list.length) throw new Error('ما فيه طلاب بالاختيار الحالي');
  if (on.some(d => d.barcode)) {
    const bad = list.filter(s => !/^[\x20-\x7E]+$/.test(String(s.national_id || '').trim()));
    if (bad.length) throw new Error(`فيه ${bad.length} طالب رقم هويته غير صالح للباركود (مثال: ${bad[0].full_name})`);
  }
  const dx = parseFloat($('ov-offset-x').value) || 0, dy = parseFloat($('ov-offset-y').value) || 0;
  const html = list.map(s => `<div class="ov-page" style="width:${layout.page_w}mm; height:${layout.page_h}mm;">${withBackground ? `<img class="ov-bg" src="${layout.background}" />` : ''}${on.map(d => fieldHtml(d.key, layout.fields[d.key], s, dx, dy)).join('')}</div>`).join('');
  return { html, count: list.length };
}

/* ---------------- المحرر (السحب والتحجيم) ---------------- */
function stageScale() { return $('ov-stage').clientWidth / layout.page_w; } // بكسل لكل مم

function renderStage() {
  const stage = $('ov-stage');
  if (!layout) { stage.innerHTML = '<div style="padding:40px 10px; text-align:center; color:var(--slate); font-size:13px;">ارفع ملف PDF للنموذج المعتمد</div>'; stage.style.height = ''; return; }
  const w = stage.clientWidth, sc = w / layout.page_w;
  stage.style.height = `${layout.page_h * sc}px`;
  const sample = selectedStudents()[0] || null;
  let h = `<style>#ov-stage .ov-f{position:absolute; display:flex; align-items:center; white-space:nowrap; overflow:hidden; font-family:'Tahoma','Arial',sans-serif; color:#000; line-height:1.1;}</style>`;
  h += layout.background ? `<img src="${layout.background}" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none; user-select:none;" draggable="false" />` : '';
  FIELD_DEFS.forEach(d => {
    const f = layout.fields[d.key];
    if (!f || !f.on) return;
    const sel = d.key === selectedKey;
    const inner = fieldHtml(d.key, { ...f, x: 0, y: 0 }, sample, 0, 0, 'px-scaled')
      .replace(/left:[^;]+; top:[^;]+; width:[^;]+; height:[^;]+;/, 'left:0; top:0; width:100%; height:100%;')
      .replace(/font-size:([\d.]+)pt/g, (m, v) => `font-size:${(parseFloat(v) * 0.3528 * sc).toFixed(2)}px`);
    h += `<div class="ov-box" data-key="${d.key}" style="position:absolute; left:${f.x * sc}px; top:${f.y * sc}px; width:${f.w * sc}px; height:${f.h * sc}px; outline:${sel ? '2px solid var(--danger)' : '1.5px dashed rgba(36,85,164,0.85)'}; background:${sel ? 'rgba(192,69,61,0.08)' : 'rgba(36,85,164,0.06)'}; cursor:move; touch-action:none;">
      <div style="position:absolute; inset:0; overflow:hidden; pointer-events:none;">${inner}</div>
      <div class="ov-handle" style="position:absolute; left:-5px; bottom:-5px; width:11px; height:11px; background:${sel ? 'var(--danger)' : 'var(--meadow)'}; border-radius:2px; cursor:nesw-resize;"></div>
    </div>`;
  });
  stage.innerHTML = h;
}

function renderFieldToggles() {
  const wrap = $('ov-fields');
  wrap.innerHTML = FIELD_DEFS.map(d => {
    const f = layout ? layout.fields[d.key] : null;
    return `<label style="display:flex; align-items:center; gap:6px; font-size:12.5px; cursor:pointer; ${d.period ? 'color:var(--slate);' : ''}">
      <input type="checkbox" class="ov-field-cb" value="${d.key}" ${f && f.on ? 'checked' : ''} ${layout ? '' : 'disabled'} style="width:auto; margin:0;" />
      ${d.label}${d.period ? ' <span style="font-size:10.5px;">(يحتاج فترة)</span>' : ''}</label>`;
  }).join('');
}

function renderProps() {
  const box = $('ov-props');
  const f = layout && selectedKey ? layout.fields[selectedKey] : null;
  if (!f) { box.innerHTML = '<span style="font-size:12px; color:var(--slate);">اضغط على أي حقل بالنموذج لتعديل حجمه وخطه. اسحبه لتحريكه، ومن المربع الصغير بزاويته تغيّر حجمه. أسهم الكيبورد تحرّكه ½ مم.</span>'; return; }
  const d = DEF[selectedKey];
  const num = (k, label, step = 0.5) => `<label style="font-size:11.5px; font-weight:700; display:flex; flex-direction:column; gap:2px;">${label}<input type="number" step="${step}" class="ov-prop" data-k="${k}" value="${r1(f[k])}" style="width:72px; margin:0; padding:6px 4px; text-align:center;" /></label>`;
  box.innerHTML = `<div style="font-weight:800; font-size:13px; margin-bottom:6px;">${d.label}</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end;">
      ${num('x', 'من اليسار (مم)')}${num('y', 'من الأعلى (مم)')}${num('w', 'العرض (مم)')}${num('h', 'الارتفاع (مم)')}
      ${d.barcode
        ? `<label style="font-size:12px; display:flex; align-items:center; gap:5px;"><input type="checkbox" class="ov-prop-cb" data-k="digits" ${f.digits ? 'checked' : ''} style="width:auto; margin:0;" />الرقم تحت الباركود</label>`
        : `${num('fs', 'الخط (pt)', 0.5)}
           <label style="font-size:12px; display:flex; align-items:center; gap:5px;"><input type="checkbox" class="ov-prop-cb" data-k="bold" ${f.bold ? 'checked' : ''} style="width:auto; margin:0;" />عريض</label>
           <label style="font-size:11.5px; font-weight:700; display:flex; flex-direction:column; gap:2px;">المحاذاة<select class="ov-prop-sel" data-k="align" style="margin:0; padding:6px;">${[['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']].map(([v, l]) => `<option value="${v}" ${f.align === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
    </div>`;
}

function renderAll() { renderFieldToggles(); renderStage(); renderProps(); }

function clampField(f) {
  f.w = Math.max(4, Math.min(f.w, layout.page_w)); f.h = Math.max(3, Math.min(f.h, layout.page_h));
  f.x = Math.max(0, Math.min(f.x, layout.page_w - f.w)); f.y = Math.max(0, Math.min(f.y, layout.page_h - f.h));
}

function setupStageInteractions() {
  const stage = $('ov-stage');
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    const boxEl = e.target.closest('.ov-box');
    if (!boxEl || !layout) { if (selectedKey) { selectedKey = null; renderStage(); renderProps(); } return; }
    const key = boxEl.dataset.key, f = layout.fields[key];
    selectedKey = key;
    drag = { key, mode: e.target.classList.contains('ov-handle') ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, f0: { ...f }, sc: stageScale() };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    renderStage(); renderProps();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const f = layout.fields[drag.key];
    const dxm = (e.clientX - drag.sx) / drag.sc, dym = (e.clientY - drag.sy) / drag.sc;
    if (drag.mode === 'move') { f.x = r1(drag.f0.x + dxm); f.y = r1(drag.f0.y + dym); }
    else { // المقبض بالزاوية السفلية اليسرى: يكبّر لليسار وللأسفل
      f.w = r1(drag.f0.w - dxm); f.x = r1(drag.f0.x + dxm); f.h = r1(drag.f0.h + dym);
      if (f.w < 4) { f.x -= 4 - f.w; f.w = 4; }
    }
    clampField(f);
    const el = stage.querySelector(`.ov-box[data-key="${drag.key}"]`);
    if (el) { const sc = drag.sc; el.style.left = `${f.x * sc}px`; el.style.top = `${f.y * sc}px`; el.style.width = `${f.w * sc}px`; el.style.height = `${f.h * sc}px`; }
  });
  const end = () => { if (drag) { drag = null; renderStage(); renderProps(); } };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  document.addEventListener('keydown', (e) => {
    if (!layout || !selectedKey || !$('ov-body') || $('ov-body').classList.contains('hidden')) return;
    if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    const step = e.shiftKey ? 2 : 0.5;
    const f = layout.fields[selectedKey];
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    f.x = r1(f.x + mv[0]); f.y = r1(f.y + mv[1]); clampField(f);
    renderStage(); renderProps();
  });
  window.addEventListener('resize', () => { if (layout && !$('ov-body').classList.contains('hidden')) renderStage(); });
}

/* ---------------- حفظ/تحميل التخطيطات ---------------- */
async function refreshLayouts() {
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('overlay_layouts').select('id, name, page_w, page_h, background, fields, offset_x, offset_y, updated_at');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('updated_at', { ascending: false });
  });
  const sel = $('ov-saved');
  if (error) { savedLayouts = []; sel.innerHTML = '<option value="">—</option>'; if (tableMissing(error)) status('جدول حفظ النماذج غير موجود بعد - شغّل أمر SQL الخاص به (تقدر تستخدم الميزة بدون حفظ)', true); return; }
  savedLayouts = data || [];
  sel.innerHTML = `<option value="">${savedLayouts.length ? `النماذج المحفوظة (${savedLayouts.length})` : 'لا توجد نماذج محفوظة'}</option>` +
    savedLayouts.map(l => `<option value="${l.id}" ${layout && layout.id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  $('ov-load-btn').disabled = $('ov-delete-btn').disabled = !sel.value;
}

async function saveLayout() {
  if (!layout) { status('ارفع ملف النموذج أولًا', true); return; }
  const name = $('ov-name').value.trim();
  if (!name) { status('اكتب اسم للنموذج', true); $('ov-name').focus(); return; }
  layout.name = name;
  layout.offset_x = parseFloat($('ov-offset-x').value) || 0;
  layout.offset_y = parseFloat($('ov-offset-y').value) || 0;
  const row = { name, page_w: layout.page_w, page_h: layout.page_h, background: layout.background, fields: layout.fields, offset_x: layout.offset_x, offset_y: layout.offset_y, updated_at: new Date().toISOString() };
  status('جارٍ الحفظ...');
  const res = layout.id
    ? await sb.from('overlay_layouts').update(row).eq('id', layout.id).select('id').single()
    : await writeWithSchool(extra => sb.from('overlay_layouts').insert({ ...row, ...extra }).select('id').single());
  if (res.error) { status(tableMissing(res.error) ? 'جدول حفظ النماذج غير موجود بعد - شغّل أمر SQL الخاص به في Supabase' : 'تعذر الحفظ: ' + res.error.message, true); return; }
  layout.id = res.data.id;
  await refreshLayouts();
  status(`تم حفظ النموذج "${name}" ✓`);
}

/* ---------------- الإخراج ---------------- */
function printOut(withBackground) {
  let out;
  try { out = buildOutput(withBackground); } catch (e) { status(e.message, true); return; }
  const win = window.open('', '_blank');
  if (!win) { status('اسمح بفتح النوافذ المنبثقة للطباعة', true); return; }
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>${esc(layout.name || 'بيانات النموذج')}</title>
    <style>@page { size:${layout.page_w}mm ${layout.page_h}mm; margin:0; } html,body{width:${layout.page_w}mm;} ${OUT_STYLES}</style></head><body>${out.html}</body></html>`);
  win.document.close();
  Promise.all([...win.document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })))
    .then(() => setTimeout(() => { win.focus(); win.print(); }, 200));
  status(withBackground
    ? `طباعة تجربة (${out.count} صفحة) مع النموذج - اطبع صفحة وحدة على ورق عادي وطابقها فوق النموذج الأصلي ضد الضوء`
    : `جاهز: ${out.count} ورقة - حمّل النماذج المعتمدة بالطابعة واطبع بالحجم الفعلي 100% وبدون رؤوس وتذييلات`);
}

async function pdfOut() {
  let out;
  try { out = buildOutput(false); } catch (e) { status(e.message, true); return; }
  const btns = ['ov-print-btn', 'ov-pdf-btn', 'ov-test-btn'].map($);
  btns.forEach(b => { b.disabled = true; });
  try {
    const base = `${layout.name || 'بيانات النموذج'}${$('ov-subject').value.trim() ? ' - ' + $('ov-subject').value.trim() : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const n = await htmlPagesToPdf({ html: out.html, styles: OUT_STYLES, w: layout.page_w, h: layout.page_h, pageSelector: '.ov-page', filename: `${base}.pdf`, onStatus: m => status(m) });
    status(`تم تحميل ${n} ورقة ✓ - اطبعها على النماذج المعتمدة بالحجم الفعلي 100%`);
  } catch (e) {
    console.error(e);
    status('تعذر إنشاء PDF: ' + (e.message || e), true);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

/* ---------------- التهيئة ---------------- */
export function initOverlayCard() {
  if (initialized) return;
  initialized = true;
  $('ov-grade').innerHTML = GRADES.map(g => `<option value="${g}">${gradeLabels[g] || g}</option>`).join('');
  setupStageInteractions();

  $('ov-toggle-btn').addEventListener('click', async () => {
    const open = $('ov-body').classList.toggle('hidden') === false;
    $('ov-toggle-btn').textContent = open ? 'إخفاء' : 'فتح';
    if (open) { renderAll(); await loadStudentsAndPeriods(); refreshLayouts(); renderStage(); }
  });
  $('ov-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await loadTemplatePdf(file); } catch (err) { console.error(err); status('تعذر قراءة الملف: ' + (err.message || err), true); }
  });
  $('ov-fields').addEventListener('change', (e) => {
    const cb = e.target.closest('.ov-field-cb');
    if (!cb || !layout) return;
    layout.fields[cb.value].on = cb.checked;
    if (cb.checked) selectedKey = cb.value; else if (selectedKey === cb.value) selectedKey = null;
    renderStage(); renderProps();
  });
  $('ov-props').addEventListener('input', (e) => {
    if (!layout || !selectedKey) return;
    const f = layout.fields[selectedKey];
    const t = e.target;
    if (t.classList.contains('ov-prop')) { const v = parseFloat(t.value); if (!Number.isNaN(v)) { f[t.dataset.k] = v; if (t.dataset.k !== 'fs') clampField(f); } }
    else if (t.classList.contains('ov-prop-cb')) f[t.dataset.k] = t.checked;
    else if (t.classList.contains('ov-prop-sel')) f[t.dataset.k] = t.value;
    renderStage();
  });
  $('ov-props').addEventListener('change', (e) => { if (e.target.classList.contains('ov-prop-sel') || e.target.classList.contains('ov-prop-cb')) $('ov-props').dispatchEvent(new Event('input', { bubbles: true })); });
  ['ov-scope', 'ov-grade', 'ov-section', 'ov-order', 'ov-only-period'].forEach(id => $(id).addEventListener('change', () => { refreshScope(); renderStage(); }));
  $('ov-period').addEventListener('change', onPeriodChange);
  ['ov-subject', 'ov-title', 'ov-year', 'ov-semester', 'ov-custom'].forEach(id => $(id).addEventListener('input', renderStage));
  $('ov-print-btn').addEventListener('click', () => printOut(false));
  $('ov-test-btn').addEventListener('click', () => printOut(true));
  $('ov-pdf-btn').addEventListener('click', pdfOut);
  $('ov-save-btn').addEventListener('click', saveLayout);
  $('ov-saved').addEventListener('change', () => { $('ov-load-btn').disabled = $('ov-delete-btn').disabled = !$('ov-saved').value; });
  $('ov-load-btn').addEventListener('click', () => {
    const l = savedLayouts.find(x => x.id === $('ov-saved').value);
    if (!l) return;
    const fields = defaultFields(l.page_w);
    Object.keys(l.fields || {}).forEach(k => { if (fields[k]) fields[k] = { ...fields[k], ...l.fields[k] }; });
    layout = { ...l, fields };
    selectedKey = null;
    $('ov-name').value = l.name; $('ov-offset-x').value = l.offset_x || 0; $('ov-offset-y').value = l.offset_y || 0;
    renderAll();
    status(`تم تحميل "${l.name}" - أي تعديل وحفظ يحدّث نفس النموذج`);
  });
  $('ov-delete-btn').addEventListener('click', async () => {
    const l = savedLayouts.find(x => x.id === $('ov-saved').value);
    if (!l || !confirm(`حذف النموذج "${l.name}"؟`)) return;
    const { error } = await sb.from('overlay_layouts').delete().eq('id', l.id);
    if (error) { status('تعذر الحذف: ' + error.message, true); return; }
    if (layout && layout.id === l.id) layout.id = null;
    await refreshLayouts();
    status('تم حذف النموذج');
  });
}
