/* =========================================================================
 * مولّد ورقة الإجابة للتصحيح الآلي (Remark Office OMR)
 *
 * المبدأ الأهم: كل الأوراق بنفس الإعدادات (عدد الأسئلة/الخيارات/الحجم/اللغة) تطلع بنفس المواقع
 * بالضبط (بالمليمتر)، عشان يكفي تعريف "قالب" واحد ببرنامج Remark ويقرأ كل النسخ.
 * لذا كل العناصر مرسومة بمواقع مطلقة (position:absolute) بوحدة mm، وما يتغيّر بين ورقة وثانية
 * إلا النص المكتوب (اسم الطالب وبياناته) وقيمة الباركود - موقع الباركود وحجمه ثابتين.
 *
 * الباركود: Code 128 لرقم هوية الطالب (أرقام فقط) - نولّده هنا مباشرة كـ SVG (بدون مكتبات خارجية)
 * عشان يطلع حاد بالطباعة. ترميز Code C (رقمين بكل رمز) لو عدد الأرقام زوجي، وإلا Code B.
 * ========================================================================= */
import { sb, gradeLabels, currentSchoolId, readScopedBySchool } from './core.js';

const ORG_NAME = 'مدرسة المروج المتوسطة';
const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const EN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

/* ---------- أبعاد كل حجم ورقة (بالمليمتر) ---------- */
const PAPER = {
  A4: {
    w: 210, h: 297, side: 15, mark: 6, markInset: 7,
    headTop: 14, logoH: 15, titleSize: 15, subSize: 10.5,
    barcodeW: 62, barcodeH: 21, barModule: 0.38, barH: 11,
    infoTop: 38, infoRowH: 8.5, infoSize: 10.5,
    instrTop: 59, instrH: 9, instrSize: 9,
    answersTop: 74, answersBottom: 282,
    rowH: 7.2, pitch: 7, bubble: 5.2, numW: 9, colGap: 6, letterSize: 7, numSize: 9.5,
    footerSize: 7.5,
  },
  A5: {
    w: 148, h: 210, side: 10, mark: 5, markInset: 5,
    headTop: 9, logoH: 11, titleSize: 12, subSize: 8.5,
    barcodeW: 50, barcodeH: 17, barModule: 0.33, barH: 9,
    infoTop: 28, infoRowH: 7, infoSize: 8.5,
    instrTop: 44, instrH: 7.5, instrSize: 7.5,
    answersTop: 56, answersBottom: 199,
    rowH: 6.4, pitch: 6.2, bubble: 4.6, numW: 7.5, colGap: 4.5, letterSize: 6, numSize: 8,
    footerSize: 6.5,
  },
};

/* ---------- حساب توزيع الأسئلة على الأعمدة ---------- */
export function computeLayout({ size, questions, choices }) {
  const P = PAPER[size];
  const availW = P.w - 2 * P.side;
  const availH = P.answersBottom - P.answersTop;
  const colW = P.numW + choices * P.pitch + P.colGap;
  const maxCols = Math.max(1, Math.floor((availW + P.colGap) / colW));
  const maxRows = Math.floor(availH / P.rowH);
  const maxQuestions = maxCols * maxRows;
  if (questions > maxQuestions) {
    return { ok: false, maxQuestions, error: `أقصى عدد أسئلة لورقة ${size} بـ${choices} خيارات هو ${maxQuestions} سؤال` };
  }
  // نفضّل أعمدة بحد أقصى ٢٥ سؤال (أوضح للطالب)، ونوزّع بالتساوي قدر الإمكان
  let cols = Math.min(maxCols, Math.max(1, Math.ceil(questions / Math.min(maxRows, 25))));
  const rows = Math.ceil(questions / cols);
  cols = Math.ceil(questions / rows);
  // نوسّط مجموعة الأعمدة أفقيًا داخل المساحة المتاحة
  const blockW = cols * colW - P.colGap;
  const offset = (availW - blockW) / 2;
  return { ok: true, P, cols, rows, colW, offset, maxQuestions };
}

/* ---------- Code 128 ---------- */
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export function code128Values(text) {
  const s = String(text);
  let codes;
  if (/^\d+$/.test(s) && s.length % 2 === 0 && s.length >= 2) {
    codes = [105]; // Start C
    for (let i = 0; i < s.length; i += 2) codes.push(parseInt(s.substr(i, 2), 10));
  } else {
    codes = [104]; // Start B
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error('الباركود يدعم أرقام وحروف إنجليزية فقط');
      codes.push(c - 32);
    }
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes;
}

// يرجّع SVG بعرض/ارتفاع بالمليمتر (مع منطقة هادئة ١٠ وحدات بكل جهة)
export function code128Svg(text, moduleMm, heightMm) {
  const modules = [];
  code128Values(text).forEach(v => { for (const d of C128[v]) modules.push(parseInt(d, 10)); });
  const quiet = 10;
  const totalModules = modules.reduce((a, b) => a + b, 0) + 2 * quiet;
  let x = quiet, rects = '';
  modules.forEach((w, i) => {
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="1"/>`;
    x += w;
  });
  const wMm = totalModules * moduleMm;
  return { wMm, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${heightMm}mm" viewBox="0 0 ${totalModules} 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block"><rect x="0" y="0" width="${totalModules}" height="1" fill="#fff"/><g fill="#000">${rects}</g></svg>` };
}

/* ---------- رسم الورقة ---------- */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const SHEET_STYLES = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { background:#fff; font-family:'Tahoma','Arial',sans-serif; color:#000; }
  .as-page { position:relative; overflow:hidden; background:#fff; page-break-after:always; break-after:page; }
  .as-page:last-child { page-break-after:auto; break-after:auto; }
  .as-abs { position:absolute; }
  .as-mark { position:absolute; background:#000; }
  .as-title { text-align:center; font-weight:700; line-height:1.35; }
  .as-box { border:0.3mm solid #000; border-radius:1.5mm; }
  .as-field { position:absolute; display:flex; align-items:flex-end; gap:1.5mm; white-space:nowrap; }
  .as-field b { font-weight:700; }
  .as-field .val { flex:1; border-bottom:0.25mm solid #000; padding:0 1.5mm 0.6mm; font-weight:700; overflow:hidden; text-overflow:clip; }
  .as-bubble { position:absolute; border:0.3mm solid #000; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#9a9a9a; font-weight:700; line-height:1; }
  .as-num { position:absolute; font-weight:700; display:flex; align-items:center; }
  .as-instr { position:absolute; display:flex; align-items:center; gap:2.5mm; background:#f1f1f1; border-radius:1.5mm; padding:0 3mm; }
  .as-ex { display:inline-block; border:0.3mm solid #000; border-radius:50%; vertical-align:middle; }
  .as-ex.fill { background:#000; }
  .as-rule { position:absolute; height:0; border-top:0.3mm solid #000; }
  .as-colsep { position:absolute; width:0; border-left:0.2mm dashed #b5b5b5; }
`;

/* يرجّع HTML صفحة واحدة. student اختياري: لو موجود يُطبع باركود رقم هويته وبياناته */
export function buildSheetPage(opts, student, logoSrc) {
  const { size, questions, choices, lang, title, subject } = opts;
  const L = computeLayout({ size, questions, choices });
  if (!L.ok) throw new Error(L.error);
  const P = L.P;
  const rtl = lang !== 'en';
  const letters = (rtl ? AR_LETTERS : EN_LETTERS).slice(0, choices);
  const mm = v => `${Math.round(v * 100) / 100}mm`;
  // يحوّل إحداثي x "منطقي" (من بداية القراءة) لإحداثي فعلي من اليسار حسب اتجاه اللغة
  const X = (fromStart, width) => rtl ? P.w - fromStart - width : fromStart;

  let h = `<div class="as-page" dir="${rtl ? 'rtl' : 'ltr'}" style="width:${mm(P.w)}; height:${mm(P.h)};">`;

  // علامات الزوايا الأربع (تساعد Remark على ضبط محاذاة الورقة الممسوحة)
  [[P.markInset, P.markInset], [P.w - P.markInset - P.mark, P.markInset], [P.markInset, P.h - P.markInset - P.mark], [P.w - P.markInset - P.mark, P.h - P.markInset - P.mark]]
    .forEach(([x, y]) => { h += `<div class="as-mark" style="left:${mm(x)}; top:${mm(y)}; width:${mm(P.mark)}; height:${mm(P.mark)};"></div>`; });

  // الترويسة: الشعار (جهة البداية) - العنوان (وسط) - مربع الباركود (جهة النهاية)
  const logoW = P.logoH * 2.6;
  if (logoSrc) h += `<img class="as-abs" src="${logoSrc}" style="left:${mm(X(P.side, logoW))}; top:${mm(P.headTop)}; height:${mm(P.logoH)}; width:${mm(logoW)}; object-fit:contain; object-position:${rtl ? 'right' : 'left'} center;" />`;
  const titleW = P.w - 2 * P.side - logoW - P.barcodeW - 6;
  h += `<div class="as-abs as-title" style="left:${mm(X(P.side + logoW + 3, titleW))}; top:${mm(P.headTop - 1)}; width:${mm(titleW)};">
    <div style="font-size:${P.titleSize}pt;">${rtl ? 'ورقة الإجابة' : 'Answer Sheet'}</div>
    <div style="font-size:${P.subSize}pt;">${escHtml(ORG_NAME)}</div>
    ${title ? `<div style="font-size:${P.subSize}pt; font-weight:400;">${escHtml(title)}</div>` : ''}
  </div>`;
  const bcX = X(P.w - P.side - P.barcodeW, P.barcodeW);
  h += `<div class="as-abs as-box" style="left:${mm(bcX)}; top:${mm(P.headTop - 1)}; width:${mm(P.barcodeW)}; height:${mm(P.barcodeH)}; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.8mm;">`;
  if (student && student.national_id) {
    const bc = code128Svg(String(student.national_id).trim(), P.barModule, P.barH);
    h += bc.svg + `<div style="font-size:${P.infoSize - 1}pt; font-family:'Courier New',monospace; font-weight:700; letter-spacing:0.6mm; direction:ltr;">${escHtml(student.national_id)}</div>`;
  } else {
    h += `<div style="font-size:${P.infoSize - 1.5}pt; color:#777; text-align:center;">${rtl ? 'مكان الباركود' : 'Barcode'}</div>`;
  }
  h += `</div>`;

  // بيانات الطالب (سطرين)
  const g = student ? (gradeLabels[student.grade_level] || '') : '';
  const infoW = P.w - 2 * P.side;
  const field = (label, value, startOff, width, row) => {
    h += `<div class="as-field" style="left:${mm(X(P.side + startOff, width))}; top:${mm(P.infoTop + row * P.infoRowH)}; width:${mm(width)}; height:${mm(P.infoRowH - 1.5)}; font-size:${P.infoSize}pt;"><b>${label}</b><span class="val">${escHtml(value || '')}</span></div>`;
  };
  const gap = 4;
  if (rtl) {
    field('اسم الطالب:', student ? student.full_name : '', 0, infoW * 0.62 - gap, 0);
    field('رقم الهوية:', student ? student.national_id : '', infoW * 0.62, infoW * 0.38, 0);
    field('الصف:', g, 0, infoW * 0.3 - gap, 1);
    field('الفصل:', student && student.class_section ? String(student.class_section) : '', infoW * 0.3, infoW * 0.18 - gap, 1);
    field('المادة:', subject || '', infoW * 0.48, infoW * 0.52, 1);
  } else {
    field('Name:', student ? student.full_name : '', 0, infoW * 0.62 - gap, 0);
    field('ID:', student ? student.national_id : '', infoW * 0.62, infoW * 0.38, 0);
    field('Grade:', g, 0, infoW * 0.3 - gap, 1);
    field('Class:', student && student.class_section ? String(student.class_section) : '', infoW * 0.3, infoW * 0.18 - gap, 1);
    field('Subject:', subject || '', infoW * 0.48, infoW * 0.52, 1);
  }

  // تعليمات التظليل مع مثال صحيح وخاطئ
  const ex = P.bubble * 0.8;
  h += `<div class="as-instr" style="left:${mm(P.side)}; top:${mm(P.instrTop)}; width:${mm(infoW)}; height:${mm(P.instrH)}; font-size:${P.instrSize}pt;">
    ${rtl
      ? `<span>ظلّل دائرة واحدة فقط لكل سؤال تظليلًا كاملًا بقلم رصاص أو أسود</span>
         <span>الصحيح: <span class="as-ex fill" style="width:${mm(ex)}; height:${mm(ex)};"></span></span>
         <span>الخطأ: <span class="as-ex" style="width:${mm(ex)}; height:${mm(ex)}; text-align:center; line-height:${mm(ex)}; font-size:${P.instrSize - 1}pt;">✓</span> <span class="as-ex" style="width:${mm(ex)}; height:${mm(ex)}; text-align:center; line-height:${mm(ex)}; font-size:${P.instrSize - 1}pt;">✗</span></span>
         <span>لا تكتب في مكان الباركود</span>`
      : `<span>Fill ONE circle completely per question with a pencil or black pen</span>
         <span>Correct: <span class="as-ex fill" style="width:${mm(ex)}; height:${mm(ex)};"></span></span>
         <span>Do not write on the barcode</span>`}
  </div>`;
  h += `<div class="as-rule" style="left:${mm(P.side)}; top:${mm(P.answersTop - 3.5)}; width:${mm(infoW)};"></div>`;

  // شبكة الإجابات
  for (let c = 0; c < L.cols; c++) {
    const colStart = L.offset + c * L.colW;
    if (c > 0) {
      const sepFrom = colStart - P.colGap / 2;
      h += `<div class="as-colsep" style="left:${mm(rtl ? P.w - P.side - sepFrom : P.side + sepFrom)}; top:${mm(P.answersTop - 1)}; height:${mm(L.rows * P.rowH)};"></div>`;
    }
    for (let r = 0; r < L.rows; r++) {
      const q = c * L.rows + r + 1;
      if (q > questions) break;
      const yMid = P.answersTop + r * P.rowH + P.rowH / 2;
      h += `<div class="as-num" style="left:${mm(X(P.side + colStart, P.numW))}; top:${mm(yMid - P.rowH / 2)}; width:${mm(P.numW)}; height:${mm(P.rowH)}; justify-content:${rtl ? 'flex-start' : 'flex-end'}; padding-${rtl ? 'right' : 'left'}:0; font-size:${P.numSize}pt; direction:ltr;">${q}</div>`;
      letters.forEach((letter, i) => {
        const bx = P.side + colStart + P.numW + i * P.pitch + (P.pitch - P.bubble) / 2;
        h += `<div class="as-bubble" style="left:${mm(X(bx, P.bubble))}; top:${mm(yMid - P.bubble / 2)}; width:${mm(P.bubble)}; height:${mm(P.bubble)}; font-size:${P.letterSize}pt;">${letter}</div>`;
      });
    }
  }

  // تذييل: الإعدادات (عشان تعرف أي قالب Remark تستخدم لهذي الورقة)
  const cfgParts = [size, `${questions} ${rtl ? 'سؤال' : 'Q'}`, `${choices} ${rtl ? 'خيارات' : 'choices'}`, rtl ? 'عربي' : 'EN'];
  const cfg = cfgParts.map(t => `<bdi>${escHtml(t)}</bdi>`).join(' · ');
  h += `<div class="as-abs" style="left:${mm(P.side + P.mark)}; width:${mm(infoW - 2 * P.mark)}; top:${mm(P.h - P.markInset - P.mark + 0.5)}; text-align:center; font-size:${P.footerSize}pt; color:#555;">${cfg}</div>`;

  h += `</div>`;
  return h;
}

/* =========================================================================
 * واجهة المستخدم (داخل قسم تقارير الاختبارات)
 * ========================================================================= */
let asStudents = [];
let asInitialized = false;

function $(id) { return document.getElementById(id); }

function readOptions() {
  return {
    size: $('as-size').value,
    questions: parseInt($('as-questions').value, 10) || 0,
    choices: parseInt($('as-choices').value, 10) || 4,
    lang: $('as-lang').value,
    title: $('as-title').value.trim(),
    subject: $('as-subject').value.trim(),
    withBarcode: $('as-barcode').checked,
  };
}

function updateLimitHint() {
  const o = readOptions();
  const L = computeLayout({ size: o.size, questions: Math.max(1, o.questions), choices: o.choices });
  const hint = $('as-limit-hint');
  hint.textContent = `أقصى عدد للأسئلة بهذي الإعدادات: ${L.maxQuestions}`;
  hint.style.color = o.questions > L.maxQuestions ? 'var(--danger)' : 'var(--slate)';
}

async function loadStudentsForGrade() {
  const grade = $('as-grade').value;
  const list = $('as-sections');
  list.innerHTML = '<span style="font-size:12px; color:var(--slate);">جارٍ التحميل...</span>';
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('students').select('full_name, national_id, grade_level, class_section').eq('grade_level', grade);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  if (error) { list.innerHTML = `<span class="error-msg" style="display:block;">تعذر تحميل الطلاب: ${escHtml(error.message)}</span>`; asStudents = []; return; }
  asStudents = data || [];
  const sections = [...new Set(asStudents.map(s => s.class_section || 0))].sort((a, b) => a - b);
  if (sections.length === 0) {
    list.innerHTML = '<span style="font-size:12px; color:var(--slate);">لا يوجد طلاب مسجلين لهذي المرحلة (يُستوردون من قسم الاختبارات)</span>';
    return;
  }
  list.innerHTML = sections.map(n => {
    const count = asStudents.filter(s => (s.class_section || 0) === n).length;
    return `<label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
      <input type="checkbox" class="as-section-cb" value="${n}" checked style="width:auto; margin:0;" />
      ${n ? `الفصل ${n}` : 'بدون فصل'} <span style="color:var(--slate); font-size:11.5px;">(${count})</span></label>`;
  }).join('');
}

function selectedStudents() {
  const secs = [...document.querySelectorAll('.as-section-cb:checked')].map(c => parseInt(c.value, 10));
  return asStudents
    .filter(s => secs.includes(s.class_section || 0))
    .sort((a, b) => ((a.class_section || 0) - (b.class_section || 0)) || String(a.full_name).localeCompare(String(b.full_name), 'ar'));
}

function logoUrl() { return new URL('logo-rc.png', window.location.href).href; }

function buildAllPages() {
  const o = readOptions();
  if (!o.questions || o.questions < 1) throw new Error('حدد عدد الأسئلة');
  const L = computeLayout({ size: o.size, questions: o.questions, choices: o.choices });
  if (!L.ok) throw new Error(L.error);
  if (o.withBarcode) {
    const studs = selectedStudents();
    if (studs.length === 0) throw new Error('اختر فصل واحد على الأقل فيه طلاب');
    const bad = studs.filter(s => !/^[\x20-\x7E]+$/.test(String(s.national_id || '').trim()));
    if (bad.length) throw new Error(`فيه ${bad.length} طالب رقم هويته فاضي أو غير صالح للباركود (مثال: ${bad[0].full_name})`);
    return { o, count: studs.length, html: studs.map(s => buildSheetPage(o, s, logoUrl())).join('') };
  }
  return { o, count: 1, html: buildSheetPage(o, null, logoUrl()) };
}

function setStatus(msg, isErr = false) {
  const el = $('as-status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--slate)';
}

function renderPreview() {
  try {
    const o = readOptions();
    if (!o.questions) { $('as-preview').innerHTML = ''; return; }
    let student = null;
    if (o.withBarcode) student = selectedStudents()[0] || { full_name: 'اسم الطالب', national_id: '1234567890', grade_level: $('as-grade').value, class_section: 1 };
    const page = buildSheetPage(o, student, logoUrl());
    const P = PAPER[o.size];
    const box = $('as-preview');
    const pxW = P.w * 3.7795, pxH = P.h * 3.7795;
    const scale = Math.min(1, (box.clientWidth || 360) / pxW);
    box.innerHTML = `<div dir="ltr" style="width:${pxW * scale}px; height:${pxH * scale}px; overflow:hidden; border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 14px rgba(16,23,40,0.08); margin:0 auto; background:#fff;">
      <iframe title="معاينة ورقة الإجابة" style="width:${pxW}px; height:${pxH}px; border:0; transform:scale(${scale}); transform-origin:0 0; display:block;"></iframe></div>`;
    const idoc = box.querySelector('iframe').contentDocument;
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:${P.w}mm; overflow:hidden;} ${SHEET_STYLES}</style></head><body>${page}</body></html>`);
    idoc.close();
    setStatus('');
  } catch (e) {
    $('as-preview').innerHTML = '';
    setStatus(e.message, true);
  }
}

function printSheets() {
  let built;
  try { built = buildAllPages(); } catch (e) { setStatus(e.message, true); return; }
  const P = PAPER[built.o.size];
  const win = window.open('', '_blank');
  if (!win) { setStatus('اسمح بفتح النوافذ المنبثقة للطباعة', true); return; }
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>ورقة الإجابة${built.o.title ? ' - ' + escHtml(built.o.title) : ''}</title>
    <style>@page { size:${built.o.size} portrait; margin:0; } html,body{width:${P.w}mm;} ${SHEET_STYLES}</style></head><body>${built.html}</body></html>`);
  win.document.close();
  const go = () => { win.focus(); win.print(); };
  const imgs = [...win.document.images];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(go, 200));
  setStatus(`جاهز للطباعة: ${built.count} ورقة. تأكد بإعدادات الطباعة: الحجم الفعلي (100%) وبدون رؤوس وتذييلات.`);
}

/* ---------- تحميل PDF (صورة عالية الدقة لكل صفحة) ---------- */
const PDF_LIBS = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};
const libPromises = {};
function loadLib(key) {
  if (libPromises[key]) return libPromises[key];
  libPromises[key] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = PDF_LIBS[key];
    el.onload = resolve;
    el.onerror = () => { delete libPromises[key]; reject(new Error('تعذر تحميل مكتبة PDF، تأكد من الاتصال بالإنترنت')); };
    document.head.appendChild(el);
  });
  return libPromises[key];
}

async function downloadPdf() {
  let built;
  try { built = buildAllPages(); } catch (e) { setStatus(e.message, true); return; }
  const btns = [$('as-print-btn'), $('as-pdf-btn')];
  btns.forEach(b => { b.disabled = true; });
  const P = PAPER[built.o.size];
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed; top:0; left:0; width:${P.w}mm; height:${P.h}mm; border:0; opacity:0; pointer-events:none; z-index:-9999;`;
  document.body.appendChild(iframe);
  try {
    if (!window.html2canvas) await loadLib('html2canvas');
    if (!window.jspdf) await loadLib('jspdf');
    const idoc = iframe.contentDocument;
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:${P.w}mm;} ${SHEET_STYLES}</style></head><body>${built.html}</body></html>`);
    idoc.close();
    await Promise.all([...idoc.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: built.o.size.toLowerCase(), orientation: 'portrait', compress: true });
    const pages = [...idoc.querySelectorAll('.as-page')];
    for (let i = 0; i < pages.length; i++) {
      setStatus(`جارٍ تجهيز الورقة ${i + 1} من ${pages.length}...`);
      const canvas = await window.html2canvas(pages[i], { scale: 3, backgroundColor: '#ffffff', useCORS: true, windowWidth: pages[i].scrollWidth, windowHeight: pages[i].scrollHeight });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, P.w, P.h, undefined, 'FAST');
    }
    const base = (built.o.title || 'ورقة الإجابة').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    pdf.save(`${base}.pdf`);
    setStatus(`تم تحميل ${pages.length} ورقة ✓`);
  } catch (e) {
    console.error(e);
    setStatus('تعذر إنشاء PDF: ' + (e.message || e), true);
  } finally {
    iframe.remove();
    btns.forEach(b => { b.disabled = false; });
  }
}

export function initAnswerSheetCard() {
  if (asInitialized) { renderPreview(); return; }
  asInitialized = true;
  $('as-grade').innerHTML = GRADES.map(g => `<option value="${g}">${gradeLabels[g] || g}</option>`).join('');

  ['as-size', 'as-questions', 'as-choices', 'as-lang', 'as-title', 'as-subject'].forEach(id => {
    $(id).addEventListener('input', () => { updateLimitHint(); renderPreview(); });
    $(id).addEventListener('change', () => { updateLimitHint(); renderPreview(); });
  });
  $('as-barcode').addEventListener('change', async () => {
    const on = $('as-barcode').checked;
    $('as-barcode-opts').classList.toggle('hidden', !on);
    if (on && asStudents.length === 0) await loadStudentsForGrade();
    renderPreview();
  });
  $('as-grade').addEventListener('change', async () => { await loadStudentsForGrade(); renderPreview(); });
  $('as-sections').addEventListener('change', renderPreview);
  $('as-print-btn').addEventListener('click', printSheets);
  $('as-pdf-btn').addEventListener('click', downloadPdf);
  $('as-toggle-btn').addEventListener('click', () => {
    const body = $('as-body');
    const open = body.classList.toggle('hidden') === false;
    $('as-toggle-btn').textContent = open ? 'إخفاء' : 'تصميم ورقة';
    if (open) { updateLimitHint(); renderPreview(); }
  });
  updateLimitHint();
}
