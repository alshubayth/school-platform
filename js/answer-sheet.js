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
import { sb, gradeLabels, currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';

const ORG_NAME = 'مدرسة المروج المتوسطة';
const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const EN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

/* ---------- أبعاد كل ورقة طالب (بالمليمتر) ----------
 * "A4L2" = ورقة A4 بالعرض فيها ورقتين A5 (طالبين) تُقص من النص - كل نصف نسخة طبق الأصل من ورقة A5،
 * فنفس قالب Remark الخاص بـ A5 يقرأ الأنصاف بعد القص. */
const SHEET = {
  A4: {
    w: 210, h: 297, side: 14, mark: 6, markInset: 7,
    headTop: 13, headH: 22, logoH: 14, titleSize: 15, subSize: 10,
    barcodeW: 60, barModule: 0.38, barH: 11,
    infoTop: 39, infoRowH: 8, infoSize: 10, infoLabelW: 21,
    instrTop: 58, instrH: 8, instrSize: 8.5,
    answersTop: 70, answersBottom: 281, colHeadH: 5.5,
    minRowH: 7, maxRowH: 9.5, pitch: 7, bubble: 5.2, numW: 9, colPad: 2, colGap: 5,
    letterSize: 7, numSize: 9.5, footerSize: 7.5,
    // وضع "مع أسئلة مقالية": اختيار متعدد ٣ أعمدة × ١٠ فوق، والباقي للمقالي
    compactRowH: 7.4, essayGap: 5, essayTitleH: 7, essayStripH: 8.5, essayLineGap: 8, essayMinH: 30, essayBoxGap: 3,
  },
  A5: {
    w: 148, h: 210, side: 9, mark: 5, markInset: 5,
    headTop: 9, headH: 17, logoH: 11, titleSize: 12, subSize: 8,
    barcodeW: 48, barModule: 0.33, barH: 8.5,
    infoTop: 29.5, infoRowH: 6.5, infoSize: 8, infoLabelW: 16,
    instrTop: 45, instrH: 6.5, instrSize: 7,
    answersTop: 55, answersBottom: 196, colHeadH: 4.5,
    minRowH: 6.2, maxRowH: 8.5, pitch: 6.2, bubble: 4.6, numW: 7.5, colPad: 1.5, colGap: 3.5,
    letterSize: 6, numSize: 8, footerSize: 6.5,
    compactRowH: 6.3, essayGap: 3.5, essayTitleH: 5.5, essayStripH: 7, essayLineGap: 6.5, essayMinH: 22, essayBoxGap: 2,
  },
};
const ESSAY_MAX_TOTAL = 40;   // أقصى درجة للجزء المقالي
const ESSAY_SINGLE_ROW_MAX = 10; // لحد ١٠: صف واحد 0..الدرجة، وفوقها صفّين (عشرات + آحاد)
const COMPACT_ROWS = 10, COMPACT_MAX_COLS = 3;
// حجم الصفحة المطبوعة + أي قالب ورقة طالب تحتويه
export const PAGE = {
  A4: { w: 210, h: 297, sheet: 'A4', perPage: 1, pdfFormat: 'a4', orientation: 'portrait', label: 'A4' },
  A5: { w: 148, h: 210, sheet: 'A5', perPage: 1, pdfFormat: 'a5', orientation: 'portrait', label: 'A5' },
  A4L2: { w: 297, h: 210, sheet: 'A5', perPage: 2, pdfFormat: 'a4', orientation: 'landscape', label: 'A4 بالعرض (طالبين)' },
};

/* ---------- حساب توزيع الأسئلة على الأعمدة ----------
 * بدون مقالي: الأعمدة تعبّي طول الورقة (حد ٢٠ سؤال للعمود).
 * مع مقالي: الاختيار من متعدد ثابت بأعمدة ١٠ أسئلة (حد ٣ أعمدة) أعلى الورقة، وتحته منطقة المقالي
 * مقسومة بالتساوي على الأسئلة المقالية. */
export function computeLayout({ size, questions, choices, essayTotal = 0 }) {
  const P = SHEET[PAGE[size].sheet];
  const availW = P.w - 2 * P.side;
  const colW = P.numW + choices * P.pitch + 2 * P.colPad;
  const maxColsW = Math.max(1, Math.floor((availW + P.colGap) / (colW + P.colGap)));
  const spread = (cols) => {
    const gap = cols > 1 ? Math.min(P.colGap * 3, (availW - cols * colW) / (cols - 1)) : 0;
    const blockW = cols * colW + (cols - 1) * gap;
    return { gap, offset: (availW - blockW) / 2 };
  };

  if (essayTotal) {
    const maxCols = Math.min(COMPACT_MAX_COLS, maxColsW);
    const maxQuestions = maxCols * COMPACT_ROWS;
    if (questions > maxQuestions) return { ok: false, maxQuestions, error: `مع الجزء المقالي: أقصى الاختيار من متعدد ${maxQuestions} سؤال (${maxCols} أعمدة × ${COMPACT_ROWS})` };
    if (!(essayTotal >= 1 && essayTotal <= ESSAY_MAX_TOTAL)) return { ok: false, maxQuestions, error: `درجة الجزء المقالي لازم تكون من 1 إلى ${ESSAY_MAX_TOTAL}` };
    const cols = questions ? Math.ceil(questions / COMPACT_ROWS) : 0;
    const rows = questions ? Math.min(COMPACT_ROWS, questions) : 0;
    const rowH = P.compactRowH;
    const mcqBottom = questions ? P.answersTop + P.colHeadH + rows * rowH + 1 : P.answersTop - P.essayGap;
    const essayTop = mcqBottom + P.essayGap;
    const twoRows = essayTotal > ESSAY_SINGLE_ROW_MAX;
    const stripH = twoRows ? P.essayStripH * 1.9 : P.essayStripH;
    const essayBoxH = P.answersBottom - essayTop;
    if (essayBoxH < P.essayMinH) return { ok: false, maxQuestions, error: 'ما بقى مساحة كافية للجزء المقالي - قلّل عدد أسئلة الاختيار من متعدد' };
    return { ok: true, P, mode: 'essay', cols, rows, rowH, colW, ...spread(cols || 1), maxQuestions, essayTop, essayBoxH, twoRows, stripH };
  }

  const availH = P.answersBottom - P.answersTop - P.colHeadH;
  const maxRows = Math.floor(availH / P.minRowH);
  const maxQuestions = maxColsW * maxRows;
  if (questions > maxQuestions) {
    return { ok: false, maxQuestions, error: `أقصى عدد أسئلة لهذا الحجم بـ${choices} خيارات هو ${maxQuestions} سؤال` };
  }
  // أعمدة بحد أقصى ٢٠ سؤال (أوضح للطالب)، موزعة بالتساوي، والمسافة بين الأسطر تتمدد لتعبّي الطول المتاح
  let cols = Math.min(maxColsW, Math.max(1, Math.ceil(questions / Math.min(maxRows, 20))));
  const rows = Math.ceil(questions / cols);
  cols = Math.ceil(questions / rows);
  const rowH = Math.min(P.maxRowH, availH / rows);
  return { ok: true, P, mode: 'normal', cols, rows, rowH, colW, ...spread(cols), maxQuestions };
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

const C128_QUIET = 10;
// عرض كل خط/فراغ بالترتيب (يبدأ بخط) + إجمالي الوحدات مع المنطقة الهادئة
export function code128Modules(text) {
  const modules = [];
  code128Values(text).forEach(v => { for (const d of C128[v]) modules.push(parseInt(d, 10)); });
  return { modules, totalModules: modules.reduce((a, b) => a + b, 0) + 2 * C128_QUIET };
}

// يرجّع SVG بعرض/ارتفاع بالمليمتر (مع منطقة هادئة ١٠ وحدات بكل جهة)
export function code128Svg(text, moduleMm, heightMm) {
  const { modules, totalModules } = code128Modules(text);
  const quiet = C128_QUIET;
  let x = quiet, rects = '';
  modules.forEach((w, i) => {
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="1"/>`;
    x += w;
  });
  const wMm = totalModules * moduleMm;
  return { wMm, svg: `<svg class="as-bc" data-code="${escHtml(text)}" xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${heightMm}mm" viewBox="0 0 ${totalModules} 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block"><rect x="0" y="0" width="${totalModules}" height="1" fill="#fff"/><g fill="#000">${rects}</g></svg>` };
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
  .as-cell { position:absolute; border:0.25mm solid #000; display:flex; align-items:center; padding:0 1.8mm; white-space:nowrap; overflow:hidden; }
  .as-cell.lbl { background:#e9e9e9; font-weight:700; justify-content:center; padding:0 1mm; }
  .as-cell.val { font-weight:700; }
  .as-bubble { position:absolute; border:0.3mm solid #000; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#a0a0a0; font-weight:700; line-height:1; }
  .as-bubble.fill { background:#000 !important; color:#000; }
  .as-num { position:absolute; font-weight:700; display:flex; align-items:center; justify-content:center; }
  .as-instr { position:absolute; display:flex; align-items:center; justify-content:center; gap:2.5mm; border:0.25mm solid #000; border-radius:1.5mm; padding:0 2.5mm; white-space:nowrap; }
  .as-ex { display:inline-block; border:0.3mm solid #000; border-radius:50%; vertical-align:middle; text-align:center; }
  .as-ex.fill { background:#000; }
  .as-colbox { position:absolute; border:0.3mm solid #000; border-radius:1.5mm; }
  .as-colhead { position:absolute; background:#e9e9e9; border-bottom:0.25mm solid #000; }
  .as-colhead span { position:absolute; top:0; bottom:0; display:flex; align-items:center; justify-content:center; font-weight:700; }
  .as-sep5 { position:absolute; height:0; border-top:0.2mm solid #bdbdbd; }
  .as-essay-title { position:absolute; display:flex; align-items:center; font-weight:700; border-bottom:0.3mm solid #000; }
  .as-essay-box { position:absolute; border:0.3mm solid #000; border-radius:1.5mm; overflow:hidden; }
  .as-essay-strip { position:absolute; background:#e9e9e9; border-bottom:0.25mm solid #000; }
  .as-essay-strip .q { position:absolute; top:0; bottom:0; display:flex; align-items:center; font-weight:700; white-space:nowrap; }
  .as-essay-line { position:absolute; height:0; border-top:0.2mm dotted #9a9a9a; }
  .as-cut { position:absolute; top:0; bottom:0; width:0; border-left:0.3mm dashed #888; }
  .as-cut span { position:absolute; left:-2.2mm; font-size:9pt; color:#666; }
`;

/* يرسم ورقة طالب واحدة (بأبعاد قالب SHEET) مزاحة أفقيًا بـ ox داخل الصفحة. student اختياري */
function buildSheetBody(opts, student, logoSrc, ox) {
  const { size, questions, choices, lang, title, subject } = opts;
  const essayTotal = opts.essayTotal || 0;
  const L = computeLayout({ size, questions, choices, essayTotal });
  if (!L.ok) throw new Error(L.error);
  const P = L.P;
  const rtl = lang !== 'en';
  const letters = (rtl ? AR_LETTERS : EN_LETTERS).slice(0, choices);
  const mm = v => `${Math.round(v * 100) / 100}mm`;
  // إحداثي "منطقي" (من بداية القراءة) ← إحداثي فعلي من يسار الصفحة حسب اتجاه اللغة
  const X = (fromStart, width) => ox + (rtl ? P.w - fromStart - width : fromStart);
  const innerW = P.w - 2 * P.side;
  let h = '';

  // علامات الزوايا (لضبط محاذاة الورقة الممسوحة في Remark)
  [[P.markInset, P.markInset], [P.w - P.markInset - P.mark, P.markInset], [P.markInset, P.h - P.markInset - P.mark], [P.w - P.markInset - P.mark, P.h - P.markInset - P.mark]]
    .forEach(([x, y]) => { h += `<div class="as-mark" style="left:${mm(ox + x)}; top:${mm(y)}; width:${mm(P.mark)}; height:${mm(P.mark)};"></div>`; });

  // الترويسة: شعار | عنوان | باركود
  const logoW = P.logoH * 2.6;
  if (logoSrc) h += `<img class="as-abs" src="${logoSrc}" style="left:${mm(X(P.side, logoW))}; top:${mm(P.headTop + (P.headH - P.logoH) / 2)}; height:${mm(P.logoH)}; width:${mm(logoW)}; object-fit:contain; object-position:${rtl ? 'right' : 'left'} center;" />`;
  const titleW = innerW - logoW - P.barcodeW - 4;
  h += `<div class="as-abs as-title" style="left:${mm(X(P.side + logoW + 2, titleW))}; top:${mm(P.headTop)}; width:${mm(titleW)}; height:${mm(P.headH)}; display:flex; flex-direction:column; justify-content:center;">
    <div style="font-size:${P.titleSize}pt;">${rtl ? 'ورقة الإجابة' : 'Answer Sheet'}</div>
    <div style="font-size:${P.subSize}pt;">${escHtml(ORG_NAME)}</div>
    ${title ? `<div style="font-size:${P.subSize}pt; font-weight:400;">${escHtml(title)}</div>` : ''}
  </div>`;
  h += `<div class="as-abs as-box" style="left:${mm(X(P.w - P.side - P.barcodeW, P.barcodeW))}; top:${mm(P.headTop)}; width:${mm(P.barcodeW)}; height:${mm(P.headH)}; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.8mm;">`;
  if (student && student.national_id) {
    const bc = code128Svg(String(student.national_id).trim(), P.barModule, P.barH);
    h += bc.svg + `<div style="font-size:${P.infoSize - 0.5}pt; font-family:'Courier New',monospace; font-weight:700; letter-spacing:0.6mm; direction:ltr;">${escHtml(student.national_id)}</div>`;
  } else {
    h += `<div style="font-size:${P.infoSize - 1}pt; color:#888; text-align:center;">${rtl ? 'مكان الباركود' : 'Barcode'}</div>`;
  }
  h += `</div>`;

  // جدول بيانات الطالب (سطرين): خانة عنوان مظللة + خانة قيمة
  const g = student ? (gradeLabels[student.grade_level] || '') : '';
  const sec = student && student.class_section ? String(student.class_section) : '';
  const cells = rtl
    ? [[['اسم الطالب', student ? student.full_name : '', 0.66], ['رقم الهوية', student ? student.national_id : '', 0.34]],
       [['الصف', g, 0.3], ['الفصل', sec, 0.18], ['المادة', subject || '', 0.52]]]
    : [[['Name', student ? student.full_name : '', 0.66], ['ID', student ? student.national_id : '', 0.34]],
       [['Grade', g, 0.3], ['Class', sec, 0.18], ['Subject', subject || '', 0.52]]];
  cells.forEach((row, ri) => {
    let off = 0;
    const y = P.infoTop + ri * P.infoRowH;
    row.forEach(([label, value, frac]) => {
      const w = innerW * frac;
      h += `<div class="as-cell lbl" dir="${rtl ? 'rtl' : 'ltr'}" style="left:${mm(X(P.side + off, P.infoLabelW))}; top:${mm(y)}; width:${mm(P.infoLabelW)}; height:${mm(P.infoRowH)}; font-size:${P.infoSize}pt;">${label}</div>`;
      h += `<div class="as-cell val" style="left:${mm(X(P.side + off + P.infoLabelW, w - P.infoLabelW))}; top:${mm(y)}; width:${mm(w - P.infoLabelW)}; height:${mm(P.infoRowH)}; font-size:${P.infoSize}pt; direction:${rtl ? 'rtl' : 'ltr'};">${escHtml(value || '')}</div>`;
      off += w;
    });
  });

  // تعليمات التظليل
  const ex = P.bubble * 0.78;
  const exStyle = `width:${mm(ex)}; height:${mm(ex)}; line-height:${mm(ex)}; font-size:${P.instrSize - 1.5}pt;`;
  h += `<div class="as-instr" style="left:${mm(ox + P.side)}; top:${mm(P.instrTop)}; width:${mm(innerW)}; height:${mm(P.instrH)}; font-size:${P.instrSize}pt;" dir="${rtl ? 'rtl' : 'ltr'}">
    ${rtl
      ? `<span>ظلّل دائرة واحدة لكل سؤال تظليلًا كاملًا</span>
         <span>صحيح <span class="as-ex fill" style="${exStyle}"></span></span>
         <span>خطأ <span class="as-ex" style="${exStyle}">✓</span> <span class="as-ex" style="${exStyle}">✗</span></span>`
      : `<span>Fill ONE circle completely per question</span>
         <span>Correct <span class="as-ex fill" style="${exStyle}"></span></span>
         <span>Wrong <span class="as-ex" style="${exStyle}">✓</span> <span class="as-ex" style="${exStyle}">✗</span></span>`}
  </div>`;

  // شبكة الإجابات: كل عمود داخل إطار، فوقه شريط حروف الخيارات، وخط خفيف كل ٥ أسئلة
  const gridTop = P.answersTop;
  const rowsTop = gridTop + P.colHeadH;
  for (let c = 0; c < (questions ? L.cols : 0); c++) {
    const colStart = L.offset + c * (L.colW + L.gap);
    const rowsInCol = Math.min(L.rows, questions - c * L.rows);
    if (rowsInCol <= 0) break;
    const boxH = P.colHeadH + L.rows * L.rowH + 1;
    h += `<div class="as-colbox" style="left:${mm(X(P.side + colStart, L.colW))}; top:${mm(gridTop)}; width:${mm(L.colW)}; height:${mm(boxH)};"></div>`;
    h += `<div class="as-colhead" style="left:${mm(X(P.side + colStart, L.colW) + 0.3)}; top:${mm(gridTop + 0.3)}; width:${mm(L.colW - 0.6)}; height:${mm(P.colHeadH - 0.3)}; font-size:${P.letterSize + 0.5}pt;">`;
    letters.forEach((letter, i) => {
      const bx = P.colPad + P.numW + i * P.pitch;
      const left = rtl ? L.colW - bx - P.pitch : bx;
      h += `<span style="left:${mm(left - 0.3)}; width:${mm(P.pitch)};">${letter}</span>`;
    });
    h += `</div>`;
    for (let r = 0; r < rowsInCol; r++) {
      const q = c * L.rows + r + 1;
      const yTop = rowsTop + r * L.rowH;
      const yMid = yTop + L.rowH / 2;
      if (r > 0 && r % 5 === 0) h += `<div class="as-sep5" style="left:${mm(X(P.side + colStart + 1, L.colW - 2))}; top:${mm(yTop)}; width:${mm(L.colW - 2)};"></div>`;
      h += `<div class="as-num" style="left:${mm(X(P.side + colStart + P.colPad, P.numW))}; top:${mm(yTop)}; width:${mm(P.numW)}; height:${mm(L.rowH)}; font-size:${P.numSize}pt; direction:ltr;">${q}</div>`;
      letters.forEach((letter, i) => {
        const bx = P.side + colStart + P.colPad + P.numW + i * P.pitch + (P.pitch - P.bubble) / 2;
        const filled = opts.keyFill && opts.keyFill[q - 1] === i;
        h += `<div class="as-bubble${filled ? ' fill' : ''}" style="left:${mm(X(bx, P.bubble))}; top:${mm(yMid - P.bubble / 2)}; width:${mm(P.bubble)}; height:${mm(P.bubble)}; font-size:${P.letterSize}pt;">${letter}</div>`;
      });
    }
  }

  // الجزء المقالي: إطار واحد للكتابة، وبأعلاه شريط للمعلم يظلل فيه مجموع درجة المقالي.
  // لحد ١٠ درجات: صف فقاعات واحد 0..المجموع. فوق ١٠: صفّين (عشرات 0..n و آحاد 0..9)
  // يقرأهم Remark ويجمعهم (العشرات × ١٠ + الآحاد).
  if (essayTotal) {
    const top = L.essayTop;
    const dirA = `dir="${rtl ? 'rtl' : 'ltr'}"`;
    h += `<div class="as-essay-box" style="left:${mm(ox + P.side)}; top:${mm(top)}; width:${mm(innerW)}; height:${mm(L.essayBoxH)};"></div>`;
    h += `<div class="as-essay-strip" style="left:${mm(ox + P.side + 0.3)}; top:${mm(top + 0.3)}; width:${mm(innerW - 0.6)}; height:${mm(L.stripH - 0.3)};"></div>`;
    const titleW = 46;
    h += `<div class="as-essay-strip" ${dirA} style="background:none; border:0; left:${mm(X(P.side + 2.5, titleW))}; top:${mm(top)}; width:${mm(titleW)}; height:${mm(L.stripH)};"><span class="q" style="${rtl ? 'right' : 'left'}:0; font-size:${P.infoSize}pt;">${rtl ? 'الجزء المقالي' : 'Written part'}&nbsp;<span style="font-weight:400; margin-inline-start:1mm;">${rtl ? `(من ${essayTotal})` : `(/${essayTotal})`}</span></span></div>`;

    const rowsSpec = L.twoRows
      ? [{ label: rtl ? 'العشرات' : 'Tens', values: Array.from({ length: Math.floor(essayTotal / 10) + 1 }, (_, i) => i * 10) },
         { label: rtl ? 'الآحاد' : 'Units', values: Array.from({ length: 10 }, (_, i) => i) }]
      : [{ label: '', values: Array.from({ length: essayTotal + 1 }, (_, i) => i) }];
    const maxN = Math.max(...rowsSpec.map(r => r.values.length));
    const scoresW = maxN * P.pitch;
    const startOff = innerW - scoresW - 2;
    const rowLblW = L.twoRows ? 14 : 0;
    const lblW = 24;
    h += `<div class="as-essay-strip" ${dirA} style="background:none; border:0; left:${mm(X(P.side + startOff - rowLblW - lblW, lblW))}; top:${mm(top)}; width:${mm(lblW)}; height:${mm(L.stripH)};"><span class="q" style="${rtl ? 'left' : 'right'}:1mm; font-size:${P.instrSize}pt;">${rtl ? 'المجموع (للمعلم):' : 'Total (teacher):'}</span></div>`;
    rowsSpec.forEach((row, ri) => {
      const yMid = top + (L.stripH / rowsSpec.length) * (ri + 0.5);
      if (row.label) {
        h += `<div class="as-essay-strip" ${dirA} style="background:none; border:0; left:${mm(X(P.side + startOff - rowLblW, rowLblW))}; top:${mm(yMid - 2.5)}; width:${mm(rowLblW)}; height:5mm;"><span class="q" style="${rtl ? 'left' : 'right'}:1mm; font-size:${P.instrSize - 0.5}pt; font-weight:400;">${row.label}</span></div>`;
      }
      // ورقة النموذج: يُظلَّل المجموع الكامل (الدرجة القصوى) - صف العشرات بعشرات الدرجة والآحاد بآحادها
      const fillVal = opts.keyFill ? (L.twoRows ? (ri === 0 ? Math.floor(essayTotal / 10) * 10 : essayTotal % 10) : essayTotal) : null;
      row.values.forEach((v, i) => {
        const bx = P.side + startOff + i * P.pitch + (P.pitch - P.bubble) / 2;
        h += `<div class="as-bubble${fillVal === v ? ' fill' : ''}" style="left:${mm(X(bx, P.bubble))}; top:${mm(yMid - P.bubble / 2)}; width:${mm(P.bubble)}; height:${mm(P.bubble)}; font-size:${P.letterSize - (String(v).length > 1 ? 1 : 0)}pt; background:#fff;">${v}</div>`;
      });
    });
    for (let y = top + L.stripH + P.essayLineGap; y < top + L.essayBoxH - 2; y += P.essayLineGap) {
      h += `<div class="as-essay-line" style="left:${mm(ox + P.side + 3)}; top:${mm(y)}; width:${mm(innerW - 6)};"></div>`;
    }
  }

  // تذييل: إعدادات القالب (عشان تعرف أي قالب Remark يقرأ هذي الورقة)
  const cfgParts = [PAGE[size].sheet, `${questions} ${rtl ? 'سؤال' : 'Q'}`, `${choices} ${rtl ? 'خيارات' : 'choices'}`];
  if (essayTotal) cfgParts.push(`${rtl ? 'مقالي' : 'Written'} ${essayTotal}`);
  cfgParts.push(rtl ? 'عربي' : 'EN');
  const cfg = cfgParts.map(t => `<bdi>${escHtml(t)}</bdi>`).join(' · ');
  h += `<div class="as-abs" dir="${rtl ? 'rtl' : 'ltr'}" style="left:${mm(ox + P.side + P.mark)}; width:${mm(innerW - 2 * P.mark)}; top:${mm(P.h - P.markInset - P.mark + 0.5)}; text-align:center; font-size:${P.footerSize}pt; color:#555;">${cfg}</div>`;
  return h;
}

/* صفحة مطبوعة واحدة: تحتوي ورقة طالب (A4/A5) أو ورقتين متجاورتين (A4 بالعرض) */
export function buildPrintPage(opts, studentsOnPage, logoSrc) {
  const pg = PAGE[opts.size];
  const S = SHEET[pg.sheet];
  const rtl = opts.lang !== 'en';
  let h = `<div class="as-page" style="width:${pg.w}mm; height:${pg.h}mm;">`;
  for (let i = 0; i < pg.perPage; i++) {
    // الورقة الأولى بجهة بداية القراءة (يمين للعربي)
    const slot = rtl ? pg.perPage - 1 - i : i;
    const student = studentsOnPage[i];
    if (studentsOnPage.length && student === undefined) continue; // آخر صفحة بعدد فردي
    h += buildSheetBody(opts, student || null, logoSrc, slot * S.w);
  }
  if (pg.perPage === 2) h += `<div class="as-cut" style="left:${S.w}mm;"><span style="top:3mm;">✂</span><span style="bottom:3mm;">✂</span></div>`;
  return h + `</div>`;
}

// توافق مع الاستدعاءات السابقة
export function buildSheetPage(opts, student, logoSrc) { return buildPrintPage(opts, student ? [student] : [], logoSrc); }

/* =========================================================================
 * واجهة المستخدم (داخل قسم تقارير الاختبارات)
 * ========================================================================= */
let asStudents = [];        // كل طلاب المدرسة (تُحمَّل مرة وحدة)
let asStudentsLoaded = false;
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
    essayTotal: $('as-essay-on').checked ? (parseInt($('as-essay-total').value, 10) || 0) : 0,
  };
}

function updateLimitHint() {
  const o = readOptions();
  const L = computeLayout({ size: o.size, questions: Math.max(o.essayTotal ? 0 : 1, o.questions), choices: o.choices, essayTotal: o.essayTotal || 0 });
  const hint = $('as-limit-hint');
  hint.textContent = o.essayTotal
    ? `مع الأسئلة المقالية: الاختيار من متعدد بأعمدة ١٠ أسئلة، أقصاه ${L.maxQuestions} سؤال`
    : `أقصى عدد للأسئلة بهذي الإعدادات: ${L.maxQuestions}`;
  hint.style.color = o.questions > L.maxQuestions ? 'var(--danger)' : 'var(--slate)';
}

/* ترتيب الطلاب: المرحلة (أول ← ثالث) ثم الفصل (١، ٢، ٣...) ثم الاسم أبجديًا */
function sortStudents(list) {
  return list.slice().sort((a, b) =>
    (GRADES.indexOf(a.grade_level) - GRADES.indexOf(b.grade_level)) ||
    ((a.class_section || 0) - (b.class_section || 0)) ||
    String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ar'));
}

async function loadAllStudents() {
  if (asStudentsLoaded) return;
  setStatus('جارٍ تحميل الطلاب...');
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('students').select('full_name, national_id, grade_level, class_section');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  if (error) { setStatus('تعذر تحميل الطلاب: ' + error.message, true); return; }
  asStudents = sortStudents((data || []).filter(s => GRADES.includes(s.grade_level)));
  asStudentsLoaded = true;
  setStatus('');
}

function refreshScopeControls() {
  const scope = $('as-scope').value;
  $('as-grade-wrap').classList.toggle('hidden', scope === 'school');
  $('as-section-wrap').classList.toggle('hidden', scope !== 'class');
  if (scope === 'class') {
    const grade = $('as-grade').value;
    const prev = $('as-section').value;
    const secs = [...new Set(asStudents.filter(s => s.grade_level === grade).map(s => s.class_section || 0))].sort((a, b) => a - b);
    $('as-section').innerHTML = secs.length
      ? secs.map(n => `<option value="${n}">${n ? `${gradeLabels[grade] || ''} ${n}` : 'بدون فصل'}</option>`).join('')
      : '<option value="">لا يوجد فصول</option>';
    if (secs.map(String).includes(prev)) $('as-section').value = prev;
  }
  const n = selectedStudents().length;
  $('as-scope-count').textContent = asStudentsLoaded
    ? (n ? `عدد الطلاب: ${n}${PAGE[$('as-size').value].perPage === 2 ? ` (${Math.ceil(n / 2)} صفحة A4)` : ''}` : 'لا يوجد طلاب بهذا الاختيار (يُستوردون من قسم الاختبارات)')
    : '';
}

function selectedStudents() {
  const scope = $('as-scope').value;
  if (scope === 'school') return asStudents;
  const grade = $('as-grade').value;
  if (scope === 'grade') return asStudents.filter(s => s.grade_level === grade);
  const sec = parseInt($('as-section').value, 10);
  return asStudents.filter(s => s.grade_level === grade && (s.class_section || 0) === sec);
}

function logoUrl() { return new URL('logo-rc.png', window.location.href).href; }

/* يقسّم الطلاب على الصفحات. لورقة "طالبين بالصفحة": ترتيب "قص ورتّب" - النصف الأول من القائمة
 * على الأنصاف اليمنى بالترتيب، والنصف الثاني على الأنصاف اليسرى؛ فبعد القص تحط رزمة الأنصاف
 * اليسرى تحت رزمة اليمنى ويصير الترتيب كامل متسلسل (أول١ ثم أول٢ ... ثم ثاني١ ...). */
function paginate(students, perPage) {
  if (perPage === 1) return students.map(s => [s]);
  const half = Math.ceil(students.length / 2);
  const pages = [];
  for (let i = 0; i < half; i++) {
    const pair = [students[i]];
    if (students[half + i]) pair.push(students[half + i]);
    pages.push(pair);
  }
  return pages;
}

function buildAllPages() {
  const o = readOptions();
  if ((!o.questions || o.questions < 1) && !o.essayTotal) throw new Error('حدد عدد الأسئلة');
  const L = computeLayout({ size: o.size, questions: o.questions, choices: o.choices, essayTotal: o.essayTotal });
  if (!L.ok) throw new Error(L.error);
  const pg = PAGE[o.size];
  if (o.withBarcode) {
    const studs = selectedStudents();
    if (studs.length === 0) throw new Error('ما فيه طلاب بالاختيار الحالي');
    const bad = studs.filter(s => !/^[\x20-\x7E]+$/.test(String(s.national_id || '').trim()));
    if (bad.length) throw new Error(`فيه ${bad.length} طالب رقم هويته فاضي أو غير صالح للباركود (مثال: ${bad[0].full_name})`);
    const pages = paginate(studs, pg.perPage);
    return { o, pg, sheets: studs.length, count: pages.length, html: pages.map(ps => buildPrintPage(o, ps, logoUrl())).join('') };
  }
  return { o, pg, sheets: pg.perPage, count: 1, html: buildPrintPage(o, [], logoUrl()) };
}

function setStatus(msg, isErr = false) {
  const el = $('as-status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--slate)';
}

function renderPreview() {
  try {
    const o = readOptions();
    if (!o.questions && !o.essayTotal) { $('as-preview').innerHTML = ''; return; }
    const pg = PAGE[o.size];
    let studs = [];
    if (o.withBarcode) {
      const sel = selectedStudents();
      studs = sel.length ? paginate(sel, pg.perPage)[0]
        : [{ full_name: 'اسم الطالب', national_id: '1234567890', grade_level: 'first_intermediate', class_section: 1 }];
    }
    const page = buildPrintPage(o, studs, logoUrl());
    const box = $('as-preview');
    const pxW = pg.w * 3.7795, pxH = pg.h * 3.7795;
    const scale = Math.min(1, (box.clientWidth || 360) / pxW);
    box.innerHTML = `<div dir="ltr" style="width:${pxW * scale}px; height:${pxH * scale}px; overflow:hidden; border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 14px rgba(16,23,40,0.08); margin:0 auto; background:#fff;">
      <iframe title="معاينة ورقة الإجابة" style="width:${pxW}px; height:${pxH}px; border:0; transform:scale(${scale}); transform-origin:0 0; display:block;"></iframe></div>`;
    const idoc = box.querySelector('iframe').contentDocument;
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:${pg.w}mm; overflow:hidden;} ${SHEET_STYLES}</style></head><body>${page}</body></html>`);
    idoc.close();
    if (!$('as-status').style.color.includes('danger')) setStatus('');
  } catch (e) {
    $('as-preview').innerHTML = '';
    setStatus(e.message, true);
  }
}

/* ================= مفتاح الإجابة (ورقة النموذج) =================
 * المعلم يحدد الإجابة الصحيحة لكل سؤال، ونطبع له "ورقة نموذج": نفس الورقة بالضبط، الإجابات الصحيحة
 * مظللة، ورقم الهوية 0000000000. يمسحها مع أوراق الطلاب، وملف Remark يطلع فيه صف بهوية أصفار -
 * وقسم تقارير الاختبارات يتعرف عليه تلقائيًا كمفتاح إجابة ويستبعده من الطلاب. */
const KEY_ID = '0000000000';
let keyAnswers = []; // لكل سؤال: رقم الخيار الصحيح (0 = أ) أو null

function renderKeyGrid() {
  const o = readOptions();
  const n = Math.max(0, o.questions);
  keyAnswers = Array.from({ length: n }, (_, i) => (keyAnswers[i] != null && keyAnswers[i] < o.choices ? keyAnswers[i] : null));
  const letters = (o.lang === 'en' ? EN_LETTERS : AR_LETTERS).slice(0, o.choices);
  const grid = $('as-key-grid');
  if (!n) { grid.innerHTML = '<span style="font-size:12px; color:var(--slate);">ما فيه أسئلة اختيار من متعدد</span>'; updateKeyStatus(); return; }
  grid.innerHTML = keyAnswers.map((sel, q) => `
    <div class="as-key-q" style="display:flex; align-items:center; gap:4px; background:#fff; border:1px solid var(--border); border-radius:9px; padding:4px 6px;">
      <b style="min-width:20px; font-size:12px; text-align:center;">${q + 1}</b>
      ${letters.map((l, c) => `<button type="button" class="as-key-btn" data-q="${q}" data-c="${c}" style="width:26px; height:26px; border-radius:50%; border:1.5px solid ${sel === c ? 'var(--meadow)' : '#C9CED8'}; background:${sel === c ? 'var(--meadow)' : '#fff'}; color:${sel === c ? '#fff' : 'var(--ink)'}; font-size:12px; font-weight:700; padding:0; cursor:pointer;">${l}</button>`).join('')}
    </div>`).join('');
  updateKeyStatus();
}

function updateKeyStatus() {
  const missing = keyAnswers.filter(v => v == null).length;
  const el = $('as-key-status');
  el.style.color = 'var(--slate)';
  el.textContent = keyAnswers.length
    ? (missing ? `باقي ${missing} سؤال بدون إجابة` : `المفتاح مكتمل (${keyAnswers.length} سؤال) ✓`)
    : '';
}

/* ---------- حفظ المفتاح بالمنصة (جدول answer_keys) ----------
 * Remark يستبعد ورقة النموذج من ملف الإكسل، فالمفتاح لازم ينحفظ هنا عشان قسم التقارير
 * يطبقه تلقائيًا لما يُرفع ملف النتائج. */
let currentKeyId = null;   // لو المستخدم حمّل مفتاح محفوظ: الحفظ يحدّثه بدل ما يضيف جديد
let savedKeys = [];

function keyStatusMsg(msg, isErr = false) {
  const el = $('as-key-status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--slate)';
}

export async function fetchSavedKeys() {
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('answer_keys').select('id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, updated_at');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('updated_at', { ascending: false });
  });
  if (error) {
    const missing = /answer_keys|relation|does not exist|schema cache/i.test(error.message || '');
    return { data: [], error: missing ? 'جدول المفاتيح غير موجود بقاعدة البيانات بعد - شغّل أمر SQL الخاص به في Supabase' : error.message };
  }
  return { data: data || [], error: null };
}

async function refreshSavedKeysList() {
  const sel = $('as-saved-keys');
  const res = await fetchSavedKeys();
  savedKeys = res.data;
  if (res.error) { sel.innerHTML = '<option value="">—</option>'; keyStatusMsg(res.error, true); return; }
  sel.innerHTML = `<option value="">${savedKeys.length ? `المفاتيح المحفوظة (${savedKeys.length})` : 'لا توجد مفاتيح محفوظة'}</option>` +
    savedKeys.map(k => `<option value="${k.id}"${k.id === currentKeyId ? ' selected' : ''}>${escHtml(k.title)} — ${k.questions} سؤال${k.essay_total ? ` + مقالي ${k.essay_total}` : ''}</option>`).join('');
  $('as-key-load-btn').disabled = $('as-key-delete-btn').disabled = !sel.value;
}

async function saveKey() {
  const o = readOptions();
  if (!o.title) { keyStatusMsg('اكتب عنوان الاختبار فوق (يظهر بقائمة المفاتيح وبالتقارير)', true); $('as-title').focus(); return; }
  if (!o.questions && !o.essayTotal) { keyStatusMsg('حدد عدد الأسئلة', true); return; }
  const missing = keyAnswers.filter(v => v == null).length;
  if (missing) { keyStatusMsg(`باقي ${missing} سؤال بدون إجابة - كمّل المفتاح قبل الحفظ`, true); return; }
  const row = {
    title: o.title, subject: o.subject || null,
    grade_level: $('as-barcode').checked && $('as-scope').value !== 'school' ? $('as-grade').value : null,
    size: o.size, questions: o.questions, choices: o.choices, lang: o.lang,
    essay_total: o.essayTotal || 0, answers: keyAnswers.slice(),
    updated_at: new Date().toISOString(),
  };
  $('as-key-save-btn').disabled = true;
  keyStatusMsg('جارٍ الحفظ...');
  let res;
  if (currentKeyId) res = await sb.from('answer_keys').update(row).eq('id', currentKeyId).select('id').single();
  else res = await writeWithSchool(extra => sb.from('answer_keys').insert({ ...row, ...extra }).select('id').single());
  $('as-key-save-btn').disabled = false;
  if (res.error) {
    const missingTbl = /answer_keys|relation|does not exist|schema cache/i.test(res.error.message || '');
    keyStatusMsg(missingTbl ? 'جدول المفاتيح غير موجود بقاعدة البيانات بعد - شغّل أمر SQL الخاص به في Supabase' : 'تعذر الحفظ: ' + res.error.message, true);
    return;
  }
  currentKeyId = res.data.id;
  await refreshSavedKeysList();
  keyStatusMsg(`تم حفظ المفتاح "${o.title}" ✓ - لما ترفع ملف Remark بالتقارير ينطبق تلقائيًا`);
}

function loadKeyIntoForm(k) {
  $('as-title').value = k.title || '';
  $('as-subject').value = k.subject || '';
  $('as-size').value = k.size || 'A4';
  $('as-questions').value = k.questions;
  $('as-choices').value = String(k.choices);
  $('as-lang').value = k.lang || 'ar';
  $('as-essay-on').checked = !!k.essay_total;
  $('as-essay-total-wrap').classList.toggle('hidden', !k.essay_total);
  if (k.essay_total) $('as-essay-total').value = k.essay_total;
  keyAnswers = Array.isArray(k.answers) ? k.answers.slice() : [];
  currentKeyId = k.id;
}

function buildKeyPages() {
  const o = readOptions();
  if ((!o.questions || o.questions < 1) && !o.essayTotal) throw new Error('حدد عدد الأسئلة');
  const L = computeLayout({ size: o.size, questions: o.questions, choices: o.choices, essayTotal: o.essayTotal });
  if (!L.ok) throw new Error(L.error);
  const missing = keyAnswers.map((v, i) => (v == null ? i + 1 : null)).filter(Boolean);
  if (missing.length) throw new Error(`حدد الإجابة الصحيحة لكل الأسئلة - الناقصة: ${missing.slice(0, 12).join('، ')}${missing.length > 12 ? '...' : ''}`);
  const pg = PAGE[o.size];
  const keyStudent = { full_name: o.lang === 'en' ? 'ANSWER KEY' : 'نموذج الإجابة (المفتاح)', national_id: KEY_ID, grade_level: o.withBarcode && $('as-scope').value !== 'school' ? $('as-grade').value : '', class_section: null };
  const opts = { ...o, keyFill: keyAnswers.slice() };
  return { o: opts, pg, sheets: 1, count: 1, html: buildPrintPage(opts, [keyStudent], logoUrl()), isKey: true };
}

function printSheets(builtOverride) {
  let built = builtOverride;
  if (!built) { try { built = buildAllPages(); } catch (e) { setStatus(e.message, true); return; } }
  const { pg } = built;
  const win = window.open('', '_blank');
  if (!win) { setStatus('اسمح بفتح النوافذ المنبثقة للطباعة', true); return; }
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>${escHtml(built.o.title || 'ورقة الإجابة')}</title>
    <style>@page { size:${pg.w}mm ${pg.h}mm; margin:0; } html,body{width:${pg.w}mm;} ${SHEET_STYLES}</style></head><body>${built.html}</body></html>`);
  win.document.close();
  const go = () => { win.focus(); win.print(); };
  Promise.all([...win.document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(go, 200));
  setStatus(built.isKey
    ? 'ورقة النموذج جاهزة للطباعة - امسحها مع أوراق الطلاب (مرة وحدة بس).'
    : `جاهز للطباعة: ${built.count} صفحة${pg.perPage === 2 ? ` (${built.sheets} ورقة طالب بعد القص)` : ''}. اطبع بالحجم الفعلي 100% وبدون رؤوس وتذييلات.`);
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

function scopeFileLabel() {
  if (!$('as-barcode').checked) return '';
  const scope = $('as-scope').value;
  if (scope === 'school') return ' - المدرسة كاملة';
  const g = gradeLabels[$('as-grade').value] || '';
  return scope === 'grade' ? ` - ${g}` : ` - ${g} ${$('as-section').value}`;
}

async function downloadPdf(builtOverride) {
  let built = builtOverride;
  if (!built) { try { built = buildAllPages(); } catch (e) { setStatus(e.message, true); return; } }
  const { pg } = built;
  const btns = [$('as-print-btn'), $('as-pdf-btn'), $('as-key-print-btn'), $('as-key-pdf-btn')];
  btns.forEach(b => { b.disabled = true; });
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed; top:0; left:0; width:${pg.w}mm; height:${pg.h}mm; border:0; opacity:0; pointer-events:none; z-index:-9999;`;
  document.body.appendChild(iframe);
  try {
    if (!window.html2canvas) await loadLib('html2canvas');
    if (!window.jspdf) await loadLib('jspdf');
    const idoc = iframe.contentDocument;
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:${pg.w}mm;} ${SHEET_STYLES}</style></head><body>${built.html}</body></html>`);
    idoc.close();
    await Promise.all([...idoc.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: pg.pdfFormat, orientation: pg.orientation, compress: true });
    const pages = [...idoc.querySelectorAll('.as-page')];
    for (let i = 0; i < pages.length; i++) {
      setStatus(`جارٍ تجهيز الصفحة ${i + 1} من ${pages.length}...`);
      // الباركود يُرسم بالـ PDF كخطوط متجهة (vector) بدل ما يكون جزء من الصورة - الصورة تنعّم حواف
      // الخطوط الرفيعة وتصعّب قراءتها بالسكانر. نخفيه وقت التصوير ونرسمه بعدين بنفس موقعه بالضبط.
      const pageRect = pages[i].getBoundingClientRect();
      const pxPerMm = pageRect.width / pg.w;
      const bcs = [...pages[i].querySelectorAll('svg.as-bc')].map(svg => {
        const r = svg.getBoundingClientRect();
        svg.style.visibility = 'hidden';
        return { code: svg.dataset.code, x: (r.left - pageRect.left) / pxPerMm, y: (r.top - pageRect.top) / pxPerMm, w: r.width / pxPerMm, h: r.height / pxPerMm };
      });
      const canvas = await window.html2canvas(pages[i], { scale: 3, backgroundColor: '#ffffff', useCORS: true, windowWidth: pages[i].scrollWidth, windowHeight: pages[i].scrollHeight });
      if (i > 0) pdf.addPage(pg.pdfFormat, pg.orientation);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pg.w, pg.h, undefined, 'FAST');
      pdf.setFillColor(0, 0, 0);
      bcs.forEach(bc => {
        const { modules, totalModules } = code128Modules(bc.code);
        const unit = bc.w / totalModules;
        let x = bc.x + C128_QUIET * unit;
        modules.forEach((m, k) => { if (k % 2 === 0) pdf.rect(x, bc.y, m * unit, bc.h, 'F'); x += m * unit; });
      });
    }
    const base = ((built.o.title || 'ورقة الإجابة') + (built.isKey ? ' - نموذج الإجابة' : scopeFileLabel())).replace(/[\\/:*?"<>|]+/g, ' ').trim();
    pdf.save(`${base}.pdf`);
    setStatus(`تم تحميل ${pages.length} صفحة${pg.perPage === 2 ? ` (${built.sheets} ورقة طالب)` : ''} ✓`);
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

  const refresh = () => { updateLimitHint(); refreshScopeControls(); renderPreview(); };
  ['as-size', 'as-questions', 'as-choices', 'as-lang', 'as-title', 'as-subject'].forEach(id => {
    $(id).addEventListener('input', refresh);
    $(id).addEventListener('change', refresh);
  });
  $('as-essay-on').addEventListener('change', () => { $('as-essay-total-wrap').classList.toggle('hidden', !$('as-essay-on').checked); refresh(); });
  $('as-essay-total').addEventListener('input', refresh);
  $('as-barcode').addEventListener('change', async () => {
    const on = $('as-barcode').checked;
    $('as-barcode-opts').classList.toggle('hidden', !on);
    if (on) await loadAllStudents();
    refresh();
  });
  ['as-scope', 'as-grade', 'as-section'].forEach(id => $(id).addEventListener('change', refresh));
  $('as-print-btn').addEventListener('click', () => printSheets());
  $('as-pdf-btn').addEventListener('click', () => downloadPdf());
  $('as-key-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.as-key-btn');
    if (!b) return;
    const q = +b.dataset.q, c = +b.dataset.c;
    keyAnswers[q] = keyAnswers[q] === c ? null : c;
    renderKeyGrid();
  });
  const keyAction = (fn) => () => {
    let built;
    try { built = buildKeyPages(); } catch (e) { const el = $('as-key-status'); el.textContent = e.message; el.style.color = 'var(--danger)'; return; }
    fn(built);
  };
  $('as-key-print-btn').addEventListener('click', keyAction(printSheets));
  $('as-key-pdf-btn').addEventListener('click', keyAction(downloadPdf));
  $('as-key-clear-btn').addEventListener('click', () => { keyAnswers = []; currentKeyId = null; $('as-saved-keys').value = ''; renderKeyGrid(); });
  $('as-key-save-btn').addEventListener('click', saveKey);
  $('as-saved-keys').addEventListener('change', () => { $('as-key-load-btn').disabled = $('as-key-delete-btn').disabled = !$('as-saved-keys').value; });
  $('as-key-load-btn').addEventListener('click', () => {
    const k = savedKeys.find(x => x.id === $('as-saved-keys').value);
    if (!k) return;
    loadKeyIntoForm(k);
    refresh(); renderKeyGrid();
    keyStatusMsg(`تم تحميل "${k.title}" - أي تعديل وحفظ يحدّث نفس المفتاح`);
  });
  $('as-key-delete-btn').addEventListener('click', async () => {
    const k = savedKeys.find(x => x.id === $('as-saved-keys').value);
    if (!k || !confirm(`حذف المفتاح "${k.title}" نهائيًا؟`)) return;
    const { error } = await sb.from('answer_keys').delete().eq('id', k.id);
    if (error) { keyStatusMsg('تعذر الحذف: ' + error.message, true); return; }
    if (currentKeyId === k.id) currentKeyId = null;
    await refreshSavedKeysList();
    keyStatusMsg('تم حذف المفتاح');
  });
  ['as-questions', 'as-choices', 'as-lang'].forEach(id => $(id).addEventListener('input', renderKeyGrid));
  ['as-choices', 'as-lang'].forEach(id => $(id).addEventListener('change', renderKeyGrid));
  $('as-toggle-btn').addEventListener('click', () => {
    const open = $('as-body').classList.toggle('hidden') === false;
    $('as-toggle-btn').textContent = open ? 'إخفاء' : 'تصميم ورقة';
    if (open) { refresh(); renderKeyGrid(); refreshSavedKeysList(); }
  });
  updateLimitHint();
}
