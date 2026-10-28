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
import { sb, gradeLabels, currentProfile, currentUserId, currentSchoolId, readScopedBySchool, writeWithSchool, printOrgName, printLogo } from './core.js';

const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const EN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

/* ---------- المهارات ----------
 * كل سؤال (بترتيب النموذج أ) يرتبط بمهارة: { s: المادة, k: المهارة }، ويُحلَّل الاختبار بها في التقارير.
 * «نافس»: اختبار تجريبي يجمع الرياضيات والعلوم ولغتي، فلكل سؤال مادته ومهارته.
 * القوائم مقترحات قابلة للتعديل، ويمكن كتابة أي مهارة أخرى. */
export const NAFES = 'نافس';
export const NAFES_SUBJECTS = ['الرياضيات', 'العلوم', 'لغتي'];
export const SKILL_SUGGEST = {
  'الرياضيات': ['الأعداد والعمليات عليها', 'البيانات والاحتمالات', 'الجبر', 'الهندسة والقياس'],
  'العلوم': ['العلوم الفيزيائية والكيميائية', 'علم الأرض والفلك', 'علوم الحياة'],
  'لغتي': ['استيعاب المقروء', 'دلالات الألفاظ'],
};
// نافس: ٦٠ فقرة، ٢٠ لكل مادة، ويجتاز المادة من حقق ١٥ فأعلى، ويجتاز الاختبار من اجتاز المواد كلها
export const NAFES_DEFAULT = { questions: 60, passScore: 15 };
let keySkills = [];   // لكل سؤال: { s, k } أو null
let keyParts = [];    // نافس: [{ s, from, to, teacher_id }] - معلم مشرف لكل مادة يدخل إجابات أسئلتها ومهاراتها
let staffList = null; // المعلمون (لاختيار المشرف)

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
// نوع كل سؤال: 'tf' (صح وخطأ - فقاعتين) أو 'mcq'. أسئلة الصح والخطأ من ضمن عدد الأسئلة، بأولها أو بآخرها
export function itemKinds({ questions, tf = 0, tfFirst = true }) {
  const n = Math.max(0, questions | 0), t = Math.max(0, Math.min(n, tf | 0));
  return Array.from({ length: n }, (_, q) => ((tfFirst ? q < t : q >= n - t) ? 'tf' : 'mcq'));
}
export function choicesOf(opts, q) { return itemKinds(opts)[q] === 'tf' ? 2 : opts.choices; }
export const TF_LETTERS = { ar: ['✓', '✗'], en: ['✓', '✗'] };

export function computeLayout({ size, questions, choices, essayTotal = 0, tf = 0, tfFirst = true }) {
  const P = SHEET[PAGE[size].sheet];
  const availW = P.w - 2 * P.side;
  const colW = P.numW + choices * P.pitch + 2 * P.colPad;
  const maxColsW = Math.max(1, Math.floor((availW + P.colGap) / (colW + P.colGap)));
  const spread = (cols) => {
    const gap = cols > 1 ? Math.min(P.colGap * 3, (availW - cols * colW) / (cols - 1)) : 0;
    const blockW = cols * colW + (cols - 1) * gap;
    return { gap, offset: (availW - blockW) / 2 };
  };
  // أعمدة متجانسة (بدون صح وخطأ): نفس المواقع القديمة بالضبط عشان قوالب Remark الحالية ما تتأثر
  const uniform = (L) => {
    L.colsList = [];
    for (let c = 0; c < L.cols; c++) {
      const count = Math.min(L.rows, questions - c * L.rows);
      if (count <= 0) break;
      L.colsList.push({ kind: 'mcq', start: c * L.rows, count, x: L.offset + c * (L.colW + L.gap), w: L.colW, nChoices: choices });
    }
    return L;
  };
  const t = Math.max(0, Math.min(questions, tf | 0));
  const m = questions - t;
  const tfW = P.numW + 2 * P.pitch + 2 * P.colPad;
  // أعمدة مختلطة: أعمدة الصح والخطأ (أضيق) ثم الاختيار من متعدد (أو العكس)، بنفس عدد الأسطر
  const mixed = (rowsCap) => {
    let r = Math.max(1, Math.min(rowsCap, Math.max(t, m)));
    const tc = t ? Math.ceil(t / r) : 0, mc = m ? Math.ceil(m / r) : 0;
    r = Math.max(tc ? Math.ceil(t / tc) : 0, mc ? Math.ceil(m / mc) : 0);
    const specs = [];
    const pushKind = (kind, total, ncols, start) => { for (let c = 0; c < ncols; c++) specs.push({ kind, start: start + c * r, count: Math.min(r, total - c * r), w: kind === 'tf' ? tfW : colW, nChoices: kind === 'tf' ? 2 : choices }); };
    if (tfFirst) { pushKind('tf', t, tc, 0); pushKind('mcq', m, mc, t); } else { pushKind('mcq', m, mc, 0); pushKind('tf', t, tc, m); }
    const sumW = specs.reduce((a, c) => a + c.w, 0);
    const n = specs.length;
    if (sumW + (n - 1) * P.colGap > availW + 0.01) return null;
    const gap = n > 1 ? Math.min(P.colGap * 3, (availW - sumW) / (n - 1)) : 0;
    let x = (availW - sumW - (n - 1) * gap) / 2;
    specs.forEach(c => { c.x = x; x += c.w + gap; });
    return { rows: r, colsList: specs, cols: n };
  };

  if (essayTotal) {
    const maxCols = Math.min(COMPACT_MAX_COLS, maxColsW);
    const maxQuestions = maxCols * COMPACT_ROWS;
    if (!(essayTotal >= 1 && essayTotal <= ESSAY_MAX_TOTAL)) return { ok: false, maxQuestions, error: `يجب أن تكون درجة الجزء المقالي من 1 إلى ${ESSAY_MAX_TOTAL}` };
    let cols, rows, extra;
    if (t) {
      const mx = questions ? mixed(COMPACT_ROWS) : { rows: 0, colsList: [], cols: 0 };
      if (!mx) return { ok: false, maxQuestions, error: `مع الجزء المقالي: لا تتسع أعلى الورقة للأسئلة - قلّل عددها` };
      cols = mx.cols; rows = mx.rows; extra = { colsList: mx.colsList, gap: 0, offset: 0 };
    } else {
      if (questions > maxQuestions) return { ok: false, maxQuestions, error: `مع الجزء المقالي: أقصى الاختيار من متعدد ${maxQuestions} سؤال (${maxCols} أعمدة × ${COMPACT_ROWS})` };
      cols = questions ? Math.ceil(questions / COMPACT_ROWS) : 0;
      rows = questions ? Math.min(COMPACT_ROWS, questions) : 0;
    }
    const rowH = P.compactRowH;
    const mcqBottom = questions ? P.answersTop + P.colHeadH + rows * rowH + 1 : P.answersTop - P.essayGap;
    const essayTop = mcqBottom + P.essayGap;
    const twoRows = essayTotal > ESSAY_SINGLE_ROW_MAX;
    const stripH = twoRows ? P.essayStripH * 1.9 : P.essayStripH;
    const essayBoxH = P.answersBottom - essayTop;
    if (essayBoxH < P.essayMinH) return { ok: false, maxQuestions, error: 'لم تبقَ مساحة كافية للجزء المقالي - قلّل عدد أسئلة الاختيار من متعدد' };
    const L = { ok: true, P, mode: 'essay', cols, rows, rowH, colW, ...spread(cols || 1), maxQuestions, essayTop, essayBoxH, twoRows, stripH };
    return extra ? { ...L, ...extra } : uniform(L);
  }

  const availH = P.answersBottom - P.answersTop - P.colHeadH;
  const maxRows = Math.floor(availH / P.minRowH);
  const maxQuestions = maxColsW * maxRows;
  if (t) {
    const mx = mixed(Math.min(maxRows, 20)) || mixed(maxRows);
    if (!mx) return { ok: false, maxQuestions, error: `لا تتسع الورقة بهذا الحجم للأسئلة - قلّل عددها أو عدد الخيارات` };
    const rowH = Math.min(P.maxRowH, availH / mx.rows);
    return { ok: true, P, mode: 'normal', cols: mx.cols, rows: mx.rows, rowH, colW, gap: 0, offset: 0, maxQuestions, colsList: mx.colsList };
  }
  if (questions > maxQuestions) {
    return { ok: false, maxQuestions, error: `أقصى عدد أسئلة لهذا الحجم بـ${choices} خيارات هو ${maxQuestions} سؤال` };
  }
  // أعمدة بحد أقصى ٢٠ سؤال (أوضح للطالب)، موزعة بالتساوي، والمسافة بين الأسطر تتمدد لتعبّي الطول المتاح
  let cols = Math.min(maxColsW, Math.max(1, Math.ceil(questions / Math.min(maxRows, 20))));
  const rows = Math.ceil(questions / cols);
  cols = Math.ceil(questions / rows);
  const rowH = Math.min(P.maxRowH, availH / rows);
  return uniform({ ok: true, P, mode: 'normal', cols, rows, rowH, colW, ...spread(cols), maxQuestions });
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

/* ---------- مواقع عناصر الورقة (للتصحيح بالكاميرا) ----------
 * نفس معادلات buildSheetBody بالضبط، وترجع مراكز العناصر بالمليمتر من الزاوية اليسرى العليا لورقة الطالب
 * (بدون إزاحة ox). opts: { size, questions, choices, lang, essayTotal, modelsOn, modelBubble } */
export function sheetGeometry(opts) {
  const { size, questions, choices } = opts;
  const essayTotal = opts.essayTotal || 0;
  const L = computeLayout({ size, questions, choices, essayTotal, tf: opts.tf || 0, tfFirst: opts.tfFirst !== false });
  if (!L.ok) throw new Error(L.error);
  const P = L.P;
  const rtl = opts.lang !== 'en';
  const X = (fromStart, width) => (rtl ? P.w - fromStart - width : fromStart);
  const cx = (fromStart, width) => X(fromStart, width) + width / 2;
  const innerW = P.w - 2 * P.side;
  const g = { w: P.w, h: P.h, bubble: P.bubble, pitch: P.pitch, mark: P.mark, rowH: L.rowH };
  const m = P.markInset + P.mark / 2;
  g.marks = [[m, m], [P.w - m, m], [m, P.h - m], [P.w - m, P.h - m]]; // TL TR BL BR
  g.barcode = { x: X(P.w - P.side - P.barcodeW, P.barcodeW), y: P.headTop, w: P.barcodeW, h: P.headH };
  // فقاعات النموذج (أ، ب)
  g.model = null;
  if (opts.modelsOn && opts.modelBubble) {
    const u = P.infoLabelW / 21;
    const bubblesW = 2 * P.bubble + P.bubble * 0.9 + 3 * u;
    const row2 = [[12.5 * u, 23 * u], [13 * u, 8 * u], [13 * u, null], [15 * u, Math.max(18 * u, bubblesW)]];
    const fixed = row2.reduce((a, c) => a + c[0] + (c[1] || 0), 0);
    const flexW = Math.max(10, innerW - fixed);
    let off = 0;
    for (let i = 0; i < 3; i++) off += row2[i][0] + (row2[i][1] == null ? flexW : row2[i][1]);
    const vx = P.side + off + row2[3][0], vw = row2[3][1];
    const gap = P.bubble * 0.9, totalW = 2 * P.bubble + gap;
    const y = P.infoTop + P.infoRowH * 1.5;
    g.model = [0, 1].map(bi => [cx(vx + (vw - totalW) / 2 + bi * (P.bubble + gap), P.bubble), y]);
  }
  // فقاعات الأسئلة: g.items[q][c] = [x, y] (سؤال الصح والخطأ فيه فقاعتين)
  g.items = [];
  const rowsTop = P.answersTop + P.colHeadH;
  (L.colsList || []).forEach(col => {
    for (let r = 0; r < col.count; r++) {
      const yMid = rowsTop + r * L.rowH + L.rowH / 2;
      g.items[col.start + r] = Array.from({ length: col.nChoices }, (_, i) => [cx(P.side + col.x + P.colPad + P.numW + i * P.pitch + (P.pitch - P.bubble) / 2, P.bubble), yMid]);
    }
  });
  // فقاعات درجة المقالي: g.essay = [{ values, pts }] (صف واحد، أو عشرات + آحاد)
  g.essay = null;
  if (essayTotal) {
    const top = L.essayTop;
    const rowsSpec = L.twoRows
      ? [Array.from({ length: Math.floor(essayTotal / 10) + 1 }, (_, i) => i * 10), Array.from({ length: 10 }, (_, i) => i)]
      : [Array.from({ length: essayTotal + 1 }, (_, i) => i)];
    const maxN = Math.max(...rowsSpec.map(r => r.length));
    const startOff = innerW - maxN * P.pitch - 2;
    g.essay = rowsSpec.map((values, ri) => {
      const yMid = top + (L.stripH / rowsSpec.length) * (ri + 0.5);
      return { values, pts: values.map((_, i) => [cx(P.side + startOff + i * P.pitch + (P.pitch - P.bubble) / 2, P.bubble), yMid]) };
    });
  }
  return g;
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
  const L = computeLayout({ size, questions, choices, essayTotal, tf: opts.tf || 0, tfFirst: opts.tfFirst !== false });
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
    <div style="font-size:${P.subSize}pt;">${escHtml(printOrgName())}</div>
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
  // الاختبار بنموذجين: خانة "النموذج" بخط كبير عشان المعلم يعطي الطالب ورقة الأسئلة الصحيحة
  const model = opts.modelsOn ? (student && student.model ? student.model : '') : null;
  const modelEn = m => (m === 'أ' ? 'A' : m === 'ب' ? 'B' : '');
  // كل خانة: [العنوان، القيمة، عرض العنوان، عرض القيمة (null = يأخذ الباقي)، نموذج؟] - العروض بوحدة تتناسب مع حجم الورقة
  // (عرض العنوان حسب طول الكلمة، والقيمة حسب محتواها: رقم الفصل صغير، الاسم والمادة ياخذون المتبقي)
  const u = P.infoLabelW / 21;
  const bubblesW = 2 * P.bubble + P.bubble * 0.9 + 3 * u;
  const L1 = rtl ? ['الصف', 'الفصل', 'المادة', 'النموذج', 'اسم الطالب', 'رقم الهوية'] : ['Grade', 'Class', 'Subject', 'Form', 'Name', 'ID'];
  const row2 = [[L1[0], g, 12.5 * u, 23 * u], [L1[1], sec, 13 * u, 8 * u], [L1[2], subject || '', 13 * u, null]];
  if (model !== null) row2.push([L1[3], rtl ? model : modelEn(model), 15 * u, Math.max(18 * u, opts.modelBubble ? bubblesW : 0), true]);
  const cells = [[[L1[4], student ? student.full_name : '', 22 * u, null], [L1[5], student ? student.national_id : '', 20 * u, 30 * u]], row2];
  cells.forEach((row, ri) => {
    const fixed = row.reduce((a, c) => a + c[2] + (c[3] || 0), 0);
    const flexN = row.filter(c => c[3] == null).length || 1;
    const flexW = Math.max(10, (innerW - fixed) / flexN);
    let off = 0;
    const y = P.infoTop + ri * P.infoRowH;
    row.forEach(([label, value, lw, vwFixed, big]) => {
      const vw = vwFixed == null ? flexW : vwFixed;
      h += `<div class="as-cell lbl" dir="${rtl ? 'rtl' : 'ltr'}" style="left:${mm(X(P.side + off, lw))}; top:${mm(y)}; width:${mm(lw)}; height:${mm(P.infoRowH)}; font-size:${P.infoSize}pt;">${label}</div>`;
      const vx = P.side + off + lw;
      if (big && opts.modelBubble) {
        // الطالب يظلّل نموذجه: فقاعتين (أ ثم ب من بداية القراءة) في منتصف الخانة يقرأها Remark
        h += `<div class="as-cell val" style="left:${mm(X(vx, vw))}; top:${mm(y)}; width:${mm(vw)}; height:${mm(P.infoRowH)};"></div>`;
        const gap = P.bubble * 0.9, totalW = 2 * P.bubble + gap;
        const fillM = student && student.model ? student.model : null;
        [rtl ? 'أ' : 'A', rtl ? 'ب' : 'B'].forEach((l, bi) => {
          const bx = vx + (vw - totalW) / 2 + bi * (P.bubble + gap);
          const filled = fillM && ((bi === 0 && fillM === 'أ') || (bi === 1 && fillM === 'ب'));
          h += `<div class="as-bubble${filled ? ' fill' : ''}" style="left:${mm(X(bx, P.bubble))}; top:${mm(y + (P.infoRowH - P.bubble) / 2)}; width:${mm(P.bubble)}; height:${mm(P.bubble)}; font-size:${P.letterSize}pt; background:#fff;">${l}</div>`;
        });
      } else {
        const small = vw < 12 * u;
        h += `<div class="as-cell val" style="left:${mm(X(vx, vw))}; top:${mm(y)}; width:${mm(vw)}; height:${mm(P.infoRowH)}; font-size:${big ? P.infoSize + 5 : P.infoSize}pt;${big || small ? ' justify-content:center; text-align:center;' : ''}${big ? ' font-weight:900;' : ''}${small ? ' padding:0 0.5mm;' : ''} direction:${rtl ? 'rtl' : 'ltr'};">${escHtml(value || '')}</div>`;
      }
      off += lw + vw;
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
  // (أعمدة الصح والخطأ فيها فقاعتين ص/خ)
  const gridTop = P.answersTop;
  const rowsTop = gridTop + P.colHeadH;
  const tfL = TF_LETTERS[rtl ? 'ar' : 'en'];
  (L.colsList || []).forEach(col => {
    const colStart = col.x, cw = col.w;
    const lets = col.kind === 'tf' ? tfL : letters;
    const boxH = P.colHeadH + L.rows * L.rowH + 1;
    h += `<div class="as-colbox" style="left:${mm(X(P.side + colStart, cw))}; top:${mm(gridTop)}; width:${mm(cw)}; height:${mm(boxH)};"></div>`;
    h += `<div class="as-colhead" style="left:${mm(X(P.side + colStart, cw) + 0.3)}; top:${mm(gridTop + 0.3)}; width:${mm(cw - 0.6)}; height:${mm(P.colHeadH - 0.3)}; font-size:${P.letterSize + 0.5}pt;">`;
    lets.forEach((letter, i) => {
      const bx = P.colPad + P.numW + i * P.pitch;
      const left = rtl ? cw - bx - P.pitch : bx;
      h += `<span style="left:${mm(left - 0.3)}; width:${mm(P.pitch)};">${letter}</span>`;
    });
    h += `</div>`;
    for (let r = 0; r < col.count; r++) {
      const q = col.start + r + 1;
      const yTop = rowsTop + r * L.rowH;
      const yMid = yTop + L.rowH / 2;
      if (r > 0 && r % 5 === 0) h += `<div class="as-sep5" style="left:${mm(X(P.side + colStart + 1, cw - 2))}; top:${mm(yTop)}; width:${mm(cw - 2)};"></div>`;
      h += `<div class="as-num" style="left:${mm(X(P.side + colStart + P.colPad, P.numW))}; top:${mm(yTop)}; width:${mm(P.numW)}; height:${mm(L.rowH)}; font-size:${P.numSize}pt; direction:ltr;">${q}</div>`;
      lets.forEach((letter, i) => {
        const bx = P.side + colStart + P.colPad + P.numW + i * P.pitch + (P.pitch - P.bubble) / 2;
        const kf = opts.keyFill && opts.keyFill[q - 1];
        const filled = Array.isArray(kf) ? kf.includes(i) : kf === i;
        h += `<div class="as-bubble${filled ? ' fill' : ''}" style="left:${mm(X(bx, P.bubble))}; top:${mm(yMid - P.bubble / 2)}; width:${mm(P.bubble)}; height:${mm(P.bubble)}; font-size:${P.letterSize}pt;">${letter}</div>`;
      });
    }
  });

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
  if (opts.tf) cfgParts.push(`${rtl ? 'صح وخطأ' : 'T/F'} ${opts.tf}${opts.tfFirst === false ? (rtl ? ' (آخر)' : ' (last)') : ''}`);
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
    modelsOn: $('as-models-on').checked,
    modelBubble: $('as-models-on').checked && $('as-models-assign').value === 'bubble',
    tf: Math.max(0, Math.min(parseInt($('as-questions').value, 10) || 0, parseInt(($('as-tf') || {}).value, 10) || 0)),
    tfFirst: !$('as-tf-pos') || $('as-tf-pos').value !== 'last',
  };
}

function updateLimitHint() {
  const o = readOptions();
  const L = computeLayout({ size: o.size, questions: Math.max(o.essayTotal ? 0 : 1, o.questions), choices: o.choices, essayTotal: o.essayTotal || 0, tf: o.tf, tfFirst: o.tfFirst });
  const hint = $('as-limit-hint');
  hint.textContent = o.essayTotal
    ? `مع الأسئلة المقالية: الاختيار من متعدد بأعمدة ١٠ أسئلة، أقصاه ${L.maxQuestions} سؤال`
    : `أقصى عدد للأسئلة بهذه الإعدادات: ${L.maxQuestions}`;
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
      : '<option value="">لا توجد فصول</option>';
    if (secs.map(String).includes(prev)) $('as-section').value = prev;
  }
  const n = selectedStudents().length;
  $('as-scope-count').textContent = asStudentsLoaded
    ? (n ? `عدد الطلاب: ${n}${PAGE[$('as-size').value].perPage === 2 ? ` (${Math.ceil(n / 2)} صفحة A4)` : ''}` : 'لا يوجد طلاب بهذا الاختيار (يُستوردون من الإعدادات ← الطلاب)')
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

function logoUrl() { return printLogo(); }

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
  const L = computeLayout({ size: o.size, questions: o.questions, choices: o.choices, essayTotal: o.essayTotal, tf: o.tf, tfFirst: o.tfFirst });
  if (!L.ok) throw new Error(L.error);
  const pg = PAGE[o.size];
  if (o.withBarcode) {
    const studs = selectedStudents();
    if (studs.length === 0) throw new Error('لا يوجد طلاب في الاختيار الحالي');
    const bad = studs.filter(s => !/^[\x20-\x7E]+$/.test(String(s.national_id || '').trim()));
    if (bad.length) throw new Error(`فيه ${bad.length} طالب رقم هويته فارغ أو غير صالح للباركود (مثال: ${bad[0].full_name})`);
    let list = studs;
    if (o.modelsOn && !o.modelBubble) { ensureAssignments(studs); list = studs.map(st => ({ ...st, model: modelMap[String(st.national_id).trim()] || MODEL_A })); }
    const pages = paginate(list, pg.perPage);
    return { o, pg, sheets: studs.length, count: pages.length, html: pages.map(ps => buildPrintPage(o, ps, logoUrl())).join(''), modelsStudents: o.modelsOn && !o.modelBubble ? list : null };
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
let keyAnswers = []; // لكل سؤال: رقم الخيار الصحيح (0 = أ) أو null - النموذج أ (أو الوحيد)
let keyPoints = [];  // درجة كل سؤال (بترتيب النموذج أ) - تُستخدم لما يكون «تحديد درجة لكل سؤال» مفعّلًا
function pointsOn() { const el = $('as-points-on'); return !!(el && el.checked); }
const ptVal = v => (Number.isFinite(+v) && +v >= 0 ? +v : 1);
const fmtPt = v => String(Math.round(v * 100) / 100);

/* ---------- الاختبار بنموذجين ----------
 * keyAnswersB: إجابات النموذج ب. orderB (لو الأسئلة نفسها بترتيب مختلف): orderB[i] = رقم السؤال
 * المقابل بالنموذج أ (من صفر) لسؤال النموذج ب رقم i. modelMap: رقم هوية الطالب ← نموذجه. */
const MODEL_A = 'أ', MODEL_B = 'ب';
let activeModel = MODEL_A;
let keyAnswersB = [];
let orderB = [];
let modelMap = {};
function modelsOn() { return $('as-models-on').checked; }
function modelMode() { return $('as-models-mode').value; }

function fitArr(arr, n, max) {
  const ok = v => v != null && (max == null || v < max);
  return Array.from({ length: n }, (_, i) => {
    const v = arr[i];
    if (!Array.isArray(v)) return ok(v) ? v : null;
    const f = v.filter(ok);   // سؤال بأكثر من إجابة صحيحة
    return f.length > 1 ? f : (f.length ? f[0] : null);
  });
}

function renderKeyGrid() {
  const o = readOptions();
  const n = Math.max(0, o.questions);
  // سؤال الصح والخطأ: خيارين بس
  const kinds = itemKinds(o);
  const fitK = arr => fitArr(arr, n, o.choices).map((v, i) => (kinds[i] === 'tf' ? fitArr([v], 1, 2)[0] : v));
  keyAnswers = fitK(keyAnswers);
  keyAnswersB = fitK(keyAnswersB);
  orderB = fitArr(orderB, n, n);
  keyPoints = Array.from({ length: n }, (_, i) => ptVal(keyPoints[i] == null ? 1 : keyPoints[i]));
  keySkills = Array.from({ length: n }, (_, i) => (keySkills[i] && keySkills[i].k ? keySkills[i] : null));
  const skOn = skillsOn();
  renderSkillsBox(n);
  const pOn = pointsOn();
  if ($('as-points-opts')) {
    $('as-points-opts').classList.toggle('hidden', !pOn);
    const total = keyPoints.reduce((a, b) => a + b, 0) + (o.essayTotal || 0);
    $('as-points-sum').textContent = pOn ? `الدرجة الكاملة: ${fmtPt(total)}${o.essayTotal ? ` (منها المقالي ${o.essayTotal})` : ''}` : '';
  }
  const on = modelsOn();
  $('as-models-opts').classList.toggle('hidden', !on);
  const assign = $('as-models-assign').value;
  $('as-assign-tabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.a === assign));
  $('as-assign-hint').textContent = assign === 'bubble'
    ? 'بخانة "النموذج" بالورقة فقاعتين (أ) و(ب) يظلّلها الطالب، والمنصة تقرأها من ملف Remark. المدرسة توزّع أوراق الأسئلة بطريقتها.'
    : 'المنصة توزّع النموذجين بالتناوب داخل كل فصل وتكتب نموذج كل طالب على ورقته.';
  if (!on) activeModel = MODEL_A;
  $('as-model-tabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.m === activeModel));
  const missA = keyAnswers.filter(v => v == null).length, missB = keyAnswersB.filter(v => v == null).length;
  $('as-model-cnt-a').textContent = n ? (missA ? missA : '✓') : '';
  $('as-model-cnt-b').textContent = n ? (missB ? missB : '✓') : '';
  const ordering = on && activeModel === MODEL_B && modelMode() === 'order';
  $('as-models-hint').textContent = !on ? '' : ordering
    ? 'لكل سؤال في النموذج ب: اضغط إجابته، واختر رقمه المقابل في النموذج أ (ليجمع تحليل الأسئلة السؤال نفسه من النموذجين).'
    : modelMode() === 'different' ? 'كل نموذج يتحلّل لحاله بالتقارير، والدرجات والترتيب للكل مع بعض.' : 'أدخل إجابة كل نموذج من تبويبه.';
  const arr = activeModel === MODEL_B ? keyAnswersB : keyAnswers;
  const letters = (o.lang === 'en' ? EN_LETTERS : AR_LETTERS).slice(0, o.choices);
  const grid = $('as-key-grid');
  if (!n) { grid.innerHTML = '<span style="font-size:12px; color:var(--slate);">لا توجد أسئلة اختيار من متعدد</span>'; updateKeyStatus(); return; }
  grid.innerHTML = arr.map((sel, q) => `
    <div class="as-key-q" style="display:flex; align-items:center; gap:4px; background:#fff; border:1px solid var(--border); border-radius:9px; padding:4px 6px;">
      <b class="as-qn${skOn && activeModel === MODEL_A ? ' pick' : ''}" data-qn="${q}" style="min-width:20px; font-size:12px; text-align:center;" ${skOn && activeModel === MODEL_A ? `title="${escHtml(keySkills[q] ? (keySkills[q].s && isNafes() ? keySkills[q].s + ' · ' : '') + keySkills[q].k : 'بدون مهارة')}"` : ''}>${q + 1}${skOn && activeModel === MODEL_A ? `<i class="as-qdot${keySkills[q] ? ' on' : ''}" style="${keySkills[q] ? `background:${skColor(keySkills[q])}` : ''}"></i>` : ''}</b>
      ${(kinds[q] === 'tf' ? TF_LETTERS[o.lang === 'en' ? 'en' : 'ar'] : letters).map((l, c, _a, on = Array.isArray(sel) ? sel.includes(c) : sel === c) => `<button type="button" class="as-key-btn" data-q="${q}" data-c="${c}" style="width:26px; height:26px; border-radius:50%; border:1.5px solid ${on ? 'var(--meadow)' : '#C9CED8'}; background:${on ? 'var(--meadow)' : '#fff'}; color:${on ? '#fff' : 'var(--ink)'}; font-size:12px; font-weight:700; padding:0; cursor:pointer;">${l}</button>`).join('')}
      ${pOn && activeModel === MODEL_A ? `<input type="number" class="as-pt" data-q="${q}" min="0" step="0.25" value="${fmtPt(keyPoints[q])}" aria-label="درجة السؤال ${q + 1}" title="درجة السؤال" autocomplete="off" />` : ''}
      ${ordering ? `<select class="as-ord" data-q="${q}" aria-label="رقم السؤال المقابل بالنموذج أ" title="رقمه بالنموذج أ"><option value="">=أ؟</option>${Array.from({ length: n }, (_, j) => `<option value="${j}"${orderB[q] === j ? ' selected' : ''}>أ${j + 1}</option>`).join('')}</select>` : ''}
    </div>`).join('');
  updateKeyStatus();
}

function keyProblems() {
  const n = keyAnswers.length;
  const missA = keyAnswers.filter(v => v == null).length;
  if (!modelsOn()) return missA ? `باقي ${missA} سؤال بدون إجابة` : null;
  const missB = keyAnswersB.filter(v => v == null).length;
  if (missA) return `النموذج أ: باقي ${missA} سؤال بدون إجابة`;
  if (missB) return `النموذج ب: باقي ${missB} سؤال بدون إجابة`;
  if (modelMode() === 'order') {
    if (orderB.some(v => v == null)) return `النموذج ب: باقي ${orderB.filter(v => v == null).length} سؤال لم تحدد رقمه المقابل في النموذج أ`;
    if (new Set(orderB).size !== n) return 'النموذج ب: يوجد رقم سؤال من النموذج أ مكرر في المقابلة';
  }
  return null;
}

function updateKeyStatus() {
  const el = $('as-key-status');
  el.style.color = 'var(--slate)';
  if (!keyAnswers.length) { el.textContent = ''; return; }
  const p = keyProblems();
  el.textContent = p || (modelsOn() ? `المفتاح مكتمل للنموذجين (${keyAnswers.length} سؤال) ✓` : `المفتاح مكتمل (${keyAnswers.length} سؤال) ✓`);
}

/* توزيع النموذجين: بالتناوب حسب ترتيب الطلاب داخل كل فصل (أ، ب، أ، ب...) فالجار ياخذ نموذج ثاني.
 * الطالب اللي له نموذج محفوظ يبقى عليه، إلا لو ضغط المعلم "إعادة التوزيع". */
function ensureAssignments(studs, force = false) {
  const groups = new Map();
  sortStudents(asStudents).forEach(st => {
    const k = st.grade_level + '|' + (st.class_section || 0);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(st);
  });
  const wanted = new Set(studs.map(st => String(st.national_id).trim()));
  groups.forEach(list => list.forEach((st, i) => {
    const id = String(st.national_id).trim();
    if (!wanted.has(id)) return;
    if (force || !modelMap[id]) modelMap[id] = i % 2 === 0 ? MODEL_A : MODEL_B;
  }));
}

function renderDistribution() {
  const box = $('as-dist');
  const show = modelsOn() && $('as-models-assign').value === 'auto' && $('as-barcode').checked && asStudentsLoaded;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const studs = selectedStudents();
  ensureAssignments(studs);
  const a = studs.filter(st => modelMap[String(st.national_id).trim()] !== MODEL_B).length;
  $('as-dist-sum').textContent = `نموذج أ: ${a} · نموذج ب: ${studs.length - a}`;
  const list = $('as-dist-list');
  if (list.classList.contains('hidden')) return;
  list.innerHTML = studs.map(st => {
    const id = String(st.national_id).trim();
    const m = modelMap[id] || MODEL_A;
    return `<div class="as-dist-row"><span>${escHtml(st.full_name)}</span><small>${escHtml((gradeLabels[st.grade_level] || '').replace(' متوسط', ''))} ${st.class_section || ''}</small>
      <button type="button" class="as-dist-m ${m === MODEL_B ? 'b' : 'a'}" data-id="${escHtml(id)}" title="اضغط للتبديل">${m}</button></div>`;
  }).join('') || '<span class="as-models-hint">لا يوجد طلاب</span>';
}

// يحفظ نموذج كل طالب مع المفتاح المحفوظ (بعد الطباعة)
async function persistModelMap() {
  if (!currentKeyId) return;
  const { error } = await sb.from('answer_keys').update({ model_map: modelMap, updated_at: new Date().toISOString() }).eq('id', currentKeyId);
  if (error) { setStatus('طُبعت الأوراق، لكن تعذّر حفظ نموذج كل طالب: ' + error.message, true); return; }
  const k = savedKeys.find(x => x.id === currentKeyId);
  if (k) k.model_map = { ...modelMap };
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

const isTeacherRole = () => !!(currentProfile && currentProfile.role === 'teacher');
export async function fetchSavedKeys() {
  // نجرب الأعمدة الأحدث أول، ولو قاعدة البيانات أقدم نرجع للأعمدة اللي قبلها
  const colsets = [
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, tf_count, tf_first, sections, created_by, points, skills, exam_kind, parts, pass_pct, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, tf_count, tf_first, sections, created_by, points, skills, exam_kind, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, tf_count, tf_first, sections, created_by, points, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, tf_count, tf_first, sections, created_by, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, tf_count, tf_first, sections, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, tf_count, tf_first, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, models, model_map, updated_at',
    'id, title, subject, grade_level, size, questions, choices, lang, essay_total, answers, updated_at',
  ];
  let last = null;
  for (const cols of colsets) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('answer_keys').select(cols);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('updated_at', { ascending: false });
    });
    if (!error) return { data: data || [], error: null };
    last = error;
    if (!/points|skills|exam_kind|parts|pass_pct|tf_count|tf_first|sections|models|model_map|column/i.test(error.message || '')) break;
  }
  const missing = /answer_keys|relation|does not exist|schema cache/i.test((last && last.message) || '');
  return { data: [], error: missing ? 'جدول المفاتيح غير موجود بقاعدة البيانات بعد - شغّل أمر SQL الخاص به في Supabase' : (last && last.message) };
}

async function refreshSavedKeysList() {
  const sel = $('as-saved-keys');
  const res = await fetchSavedKeys();
  savedKeys = res.data;
  if (res.error) { sel.innerHTML = '<option value="">—</option>'; keyStatusMsg(res.error, true); return; }
  sel.innerHTML = `<option value="">${savedKeys.length ? `المفاتيح المحفوظة (${savedKeys.length})` : 'لا توجد مفاتيح محفوظة'}</option>` +
    savedKeys.map(k => `<option value="${k.id}"${k.id === currentKeyId ? ' selected' : ''}>${escHtml(k.title)} — ${k.questions} سؤال${k.essay_total ? ` + مقالي ${k.essay_total}` : ''}</option>`).join('');
  $('as-key-load-btn').disabled = $('as-key-delete-btn').disabled = !sel.value;
  updateCurLabel();
}

async function saveKey() {
  const o = readOptions();
  if (!o.subject) { keyStatusMsg('اختر المادة بالخطوة ١ (يُكتب منها عنوان الاختبار)', true); return; }
  if (!keyClassChosen()) { keyStatusMsg('حدد المرحلة بالخطوة ١ قبل حفظ المفتاح (أو جميع المراحل)', true); return; }
  if (!o.questions && !o.essayTotal) { keyStatusMsg('حدد عدد الأسئلة', true); return; }
  const prob = keyProblems();
  // نافس: يُحفظ النموذج ناقصًا، ويكمل كل معلم مشرف إجابات مادته من حسابه
  if (prob && !(isNafes() && keyParts.some(p => p.teacher_id))) { keyStatusMsg(prob + ' - يُرجى إكمال المفتاح قبل الحفظ', true); return; }
  if (isNafes()) { const bad = partsProblem(o.questions); if (bad) { keyStatusMsg(bad, true); return; } }
  const row = {
    title: o.title, subject: o.subject || null,
    grade_level: keyGrade() || null,
    size: o.size, questions: o.questions, choices: o.choices, lang: o.lang,
    essay_total: o.essayTotal || 0, answers: keyAnswers.slice(),
    updated_at: new Date().toISOString(),
  };
  if (o.tf || (currentKeyId && (savedKeys.find(k => k.id === currentKeyId) || {}).tf_count)) { row.tf_count = o.tf; row.tf_first = o.tfFirst; }
  const prevKey = currentKeyId ? (savedKeys.find(k => k.id === currentKeyId) || {}) : {};
  if (skillsOn() && keySkills.some(Boolean)) row.skills = keySkills.map(x => (x ? { s: x.s || o.subject, k: x.k } : null));
  else if (prevKey.skills) row.skills = null;
  if (isNafes()) { row.exam_kind = 'nafes'; row.parts = keyParts.map(p => ({ s: p.s, from: p.from, to: p.to, teacher_id: p.teacher_id || null })); if (!prevKey.pass_pct) row.pass_pct = Math.round(NAFES_DEFAULT.passScore / Math.max(1, Math.round(o.questions / NAFES_SUBJECTS.length)) * 10000) / 100; }
  else if (prevKey.exam_kind) { row.exam_kind = null; row.parts = null; }
  const hadPoints = currentKeyId && (savedKeys.find(k => k.id === currentKeyId) || {}).points;
  if (pointsOn() && keyPoints.some(v => v !== 1)) row.points = keyPoints.slice();
  else if (hadPoints) row.points = null;
  // sections: { grades: [...] | null (الكل), classes: [أرقام الفصول] | null } - للمرحلة الوحدة grade_level كمان
  const scope = keyGrades === null ? { grades: null, classes: null } : { grades: keyGrades.slice(), classes: keyGrade() ? keySections : null };
  if (keyGrades === null || keyGrades.length !== 1 || keySections || (currentKeyId && (savedKeys.find(k => k.id === currentKeyId) || {}).sections)) row.sections = scope;
  if (o.modelsOn) {
    row.models = { mode: modelMode(), assign: $('as-models-assign').value, answers_b: keyAnswersB.slice(), order_b: modelMode() === 'order' ? orderB.slice() : null };
    row.model_map = modelMap;
  } else if (currentKeyId && (savedKeys.find(k => k.id === currentKeyId) || {}).models) {
    row.models = null;
  }
  $('as-key-save-btn').disabled = true;
  keyStatusMsg('جارٍ الحفظ...');
  let res;
  // المعلم ما يعدّل مفتاح غيره: ينحفظ كنسخة له
  const curKey = currentKeyId ? savedKeys.find(k => k.id === currentKeyId) : null;
  const notMine = !!(curKey && isTeacherRole() && curKey.created_by && curKey.created_by !== currentUserId);
  if (notMine) currentKeyId = null;
  if (currentKeyId) res = await sb.from('answer_keys').update(row).eq('id', currentKeyId).select('id').single();
  else res = await writeWithSchool(extra => sb.from('answer_keys').insert({ ...row, ...extra }).select('id').single());
  $('as-key-save-btn').disabled = false;
  if (res.error) {
    const msg = res.error.message || '';
    if (/skills|exam_kind|parts|pass_pct/i.test(msg)) { keyStatusMsg('ربط المهارات يحتاج تحديث قاعدة البيانات - تواصل مع الدعم الفني', true); return; }
    if (/points/i.test(msg)) { keyStatusMsg('درجات الأسئلة تحتاج تحديث قاعدة البيانات - تواصل مع الدعم الفني', true); return; }
    if (/tf_count|tf_first|sections/i.test(msg)) { keyStatusMsg('أسئلة الصح والخطأ تحتاج تشغيل ملف sql/answer_keys_tf.sql في قاعدة البيانات أولًا', true); return; }
    const missingCols = /models|model_map/i.test(msg);
    const missingTbl = /answer_keys|relation|does not exist|schema cache/i.test(msg);
    keyStatusMsg(missingCols ? 'ميزة النموذجين تحتاج تشغيل ملف sql/exam_models.sql في قاعدة البيانات أولًا' : missingTbl ? 'جدول المفاتيح غير موجود بقاعدة البيانات بعد - شغّل أمر SQL الخاص به في Supabase' : 'تعذر الحفظ: ' + msg, true);
    return;
  }
  currentKeyId = res.data.id;
  setStatus('');
  await refreshSavedKeysList();
  updateCurLabel();
  keyStatusMsg(notMine ? `المفتاح الأصلي من الإدارة، فانحفظ "${o.title}" كنسخة خاصة فيك ✓` : `تم حفظ المفتاح "${o.title}" ✓ - يُطبَّق تلقائيًا عند رفع ملف Remark في التقارير`);
  // التقارير المحفوظة المرتبطة بهذا المفتاح تُعاد تصحيحها بالنسخة الجديدة
  if (!notMine) {
    try {
      const { regradeReportsForKey } = await import('./exam-reports.js');
      const n = await regradeReportsForKey({ ...row, id: currentKeyId });
      if (n) keyStatusMsg(`تم حفظ المفتاح "${o.title}" ✓ وأُعيد تصحيح ${n === 1 ? 'التقرير المرتبط به' : n === 2 ? 'التقريرين المرتبطين به' : n + ' تقارير مرتبطة به'}`);
    } catch (e) { console.error('regradeReportsForKey', e); }
  }
}

function loadKeyIntoForm(k) {
  // أول شيء: ربط النموذج بالمفتاح المختار، حتى لو تعثّر تعبئة أي حقل لاحقًا لا يُحفظ التعديل على مفتاح سابق
  currentKeyId = k.id;
  $('as-title').value = k.title || '';
  setSubject(k.subject || '');
  $('as-size').value = k.size || 'A4';
  $('as-questions').value = k.questions;
  $('as-choices').value = String(k.choices);
  $('as-lang').value = k.lang || 'ar';
  $('as-essay-on').checked = !!k.essay_total;
  $('as-essay-total-wrap').classList.toggle('hidden', !k.essay_total);
  if (k.essay_total) $('as-essay-total').value = k.essay_total;
  if ($('as-tf')) { $('as-tf').value = k.tf_count || 0; $('as-tf-pos').value = k.tf_first === false ? 'last' : 'first'; }
  if ($('as-mcq')) $('as-mcq').value = Math.max(0, (k.questions || 0) - (k.tf_count || 0));
  if ($('as-key-grades')) {
    const sc = k.sections && typeof k.sections === 'object' && !Array.isArray(k.sections) ? k.sections : null;
    keyGrades = sc ? (sc.grades === null ? null : (sc.grades || [])) : (k.grade_level ? [k.grade_level] : []);
    keySections = sc && Array.isArray(sc.classes) && sc.classes.length ? sc.classes.slice() : (Array.isArray(k.sections) && k.sections.length ? k.sections.slice() : null);
    renderKeyGrades(); loadAllStudents().then(renderKeySecs);
  }
  updateKeyTitle();
  updateQSum();
  keyAnswers = Array.isArray(k.answers) ? k.answers.slice() : [];
  keySkills = Array.isArray(k.skills) ? k.skills.map(x => (x && x.k ? { s: x.s || '', k: x.k } : null)) : [];
  if ($('as-skills-on')) $('as-skills-on').checked = keySkills.some(Boolean) || k.exam_kind === 'nafes';
  keyParts = Array.isArray(k.parts) ? k.parts.map(p => ({ s: p.s, from: +p.from, to: +p.to, teacher_id: p.teacher_id || '' })) : [];
  keyPoints = Array.isArray(k.points) ? k.points.map(ptVal) : [];
  if ($('as-points-on')) $('as-points-on').checked = Array.isArray(k.points) && k.points.length > 0;
  const m = k.models && k.models.mode ? k.models : null;
  $('as-models-on').checked = !!m;
  if (m) { $('as-models-mode').value = m.mode; $('as-models-assign').value = m.assign === 'bubble' ? 'bubble' : 'auto'; }
  keyAnswersB = m && Array.isArray(m.answers_b) ? m.answers_b.slice() : [];
  if ($('as-multi-on')) $('as-multi-on').checked = [...keyAnswers, ...keyAnswersB].some(Array.isArray);
  orderB = m && Array.isArray(m.order_b) ? m.order_b.slice() : [];
  modelMap = k.model_map && typeof k.model_map === 'object' ? { ...k.model_map } : {};
  activeModel = MODEL_A;
  currentKeyId = k.id;
  updateCurLabel();
}

// شريط «تعمل على»: اختبار جديد أو تعديل اختبار محفوظ
function updateCurLabel() {
  const el = $('as-cur-label'); if (!el) return;
  const k = currentKeyId ? savedKeys.find(x => x.id === currentKeyId) : null;
  el.innerHTML = k ? `تعديل: <b>${escHtml(k.title)}</b> <small>(الحفظ يحدّث هذا الاختبار)</small>` : 'اختبار جديد <small>(الحفظ ينشئ اختبارًا جديدًا)</small>';
  $('as-cur').classList.toggle('editing', !!k);
}

// يبدأ اختبارًا جديدًا: يفرّغ كل الحقول والإجابات ويفصل الارتباط بالمفتاح المحفوظ
function resetKeyForm() {
  $('as-title').value = ''; $('as-subject').value = '';
  $('as-questions').value = 20; $('as-mcq').value = 20; $('as-tf').value = 0; $('as-tf-pos').value = 'first';
  $('as-choices').value = '4'; $('as-lang').value = 'ar';
  $('as-essay-on').checked = false; $('as-essay-total-wrap').classList.add('hidden');
  $('as-models-on').checked = false; $('as-models-mode').value = 'choices'; $('as-models-assign').value = 'auto';
  if ($('as-points-on')) $('as-points-on').checked = false;
  if ($('as-multi-on')) $('as-multi-on').checked = false;
  keyAnswers = []; keyAnswersB = []; orderB = []; modelMap = {}; keyPoints = []; keySkills = []; keyParts = []; activeModel = MODEL_A;
  if ($('as-skills-on')) $('as-skills-on').checked = false;
  currentKeyId = null;
  keyGrades = []; keySections = null;
  $('as-saved-keys').value = ''; $('as-key-load-btn').disabled = $('as-key-delete-btn').disabled = true;
  renderKeyGrades(); if ($('as-key-secs-wrap')) $('as-key-secs-wrap').classList.add('hidden');
  updateQSum(); renderKeyGrid(); updateCurLabel();
  keyStatusMsg('');
  showStep(1);
}

function buildKeyPages() {
  const o = readOptions();
  if ((!o.questions || o.questions < 1) && !o.essayTotal) throw new Error('حدد عدد الأسئلة');
  const L = computeLayout({ size: o.size, questions: o.questions, choices: o.choices, essayTotal: o.essayTotal, tf: o.tf, tfFirst: o.tfFirst });
  if (!L.ok) throw new Error(L.error);
  const missing = keyAnswers.map((v, i) => (v == null ? i + 1 : null)).filter(Boolean);
  if (missing.length) throw new Error(`حدد الإجابة الصحيحة لكل الأسئلة - الناقصة: ${missing.slice(0, 12).join('، ')}${missing.length > 12 ? '...' : ''}`);
  const prob = keyProblems();
  if (prob) throw new Error(prob);
  const pg = PAGE[o.size];
  const keyStudent = { full_name: o.lang === 'en' ? 'ANSWER KEY' : 'نموذج الإجابة (المفتاح)', national_id: KEY_ID, grade_level: o.withBarcode && $('as-scope').value !== 'school' ? $('as-grade').value : '', class_section: null };
  if (o.modelsOn) {
    const optsA = { ...o, keyFill: keyAnswers.slice() }, optsB = { ...o, keyFill: keyAnswersB.slice() };
    const html = buildPrintPage(optsA, [{ ...keyStudent, model: MODEL_A }], logoUrl()) + buildPrintPage(optsB, [{ ...keyStudent, model: MODEL_B }], logoUrl());
    return { o: optsA, pg, sheets: 2, count: 2, html, isKey: true };
  }
  const opts = { ...o, keyFill: keyAnswers.slice() };
  return { o: opts, pg, sheets: 1, count: 1, html: buildPrintPage(opts, [keyStudent], logoUrl()), isKey: true };
}

// النموذجين: لازم المفتاح محفوظ قبل طباعة أوراق الطلاب، عشان ينحفظ معه نموذج كل طالب
function modelsGuard() {
  const o = readOptions();
  if (!o.modelsOn || o.modelBubble) return null;
  if (!o.withBarcode) return 'يتطلب الاختبار بنموذجين "باركود باسم الطالب"، لتتعرّف المنصة على نموذج كل طالب أثناء التصحيح';
  if (!currentKeyId) return 'احفظ مفتاح الإجابة للنموذجين أولًا، وبعدها اطبع الأوراق (يُحفظ نموذج كل طالب مع المفتاح)';
  return null;
}

function printSheets(builtOverride) {
  let built = builtOverride;
  if (!built) {
    const g = modelsGuard(); if (g) { setStatus(g, true); return; }
    try { built = buildAllPages(); } catch (e) { setStatus(e.message, true); return; }
  }
  const { pg } = built;
  const win = window.open('', '_blank');
  if (!win) { setStatus('اسمح بفتح النوافذ المنبثقة للطباعة', true); return; }
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>${escHtml(built.o.title || 'ورقة الإجابة')}</title>
    <style>@page { size:${pg.w}mm ${pg.h}mm; margin:0; } html,body{width:${pg.w}mm;} ${SHEET_STYLES}</style></head><body>${built.html}</body></html>`);
  win.document.close();
  if (built.modelsStudents) persistModelMap();
  const go = () => { win.focus(); win.print(); };
  Promise.all([...win.document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(go, 200));
  setStatus(built.isKey
    ? 'ورقة النموذج جاهزة للطباعة - امسحها ضوئيًا مع أوراق الطلاب (مرة واحدة فقط).'
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

/* يحوّل صفحات HTML (كل صفحة عنصر بالكلاس pageSelector وبأبعاد w×h مم) لملف PDF:
 * كل صفحة تُصوَّر كصورة، والباركود يُرسم فوقها كخطوط متجهة حادة (أوضح بالسكانر).
 * مستخدمة هنا ومن "الطباعة على النموذج المعتمد". */
export async function htmlPagesToPdf({ html, styles, w, h, pageSelector, filename, onStatus = () => {} }) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed; top:0; left:0; width:${w}mm; height:${h}mm; border:0; opacity:0; pointer-events:none; z-index:-9999;`;
  document.body.appendChild(iframe);
  try {
    if (!window.html2canvas) await loadLib('html2canvas');
    if (!window.jspdf) await loadLib('jspdf');
    const idoc = iframe.contentDocument;
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:${w}mm;} ${styles}</style></head><body>${html}</body></html>`);
    idoc.close();
    await Promise.all([...idoc.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const { jsPDF } = window.jspdf;
    const orientation = w > h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ unit: 'mm', format: [w, h], orientation, compress: true });
    const pages = [...idoc.querySelectorAll(pageSelector)];
    // نصوّر كل صفحة وهي لحالها بالمستند: html2canvas ينسخ المستند كامل مع كل صفحة، فلو بقت كل
    // الصفحات موجودة يصير الوقت يتضاعف مع عددها (مئات الصفحات = بطء شديد)
    const anchors = pages.map(pg => { const c = idoc.createComment('p'); pg.replaceWith(c); return c; });
    const t0 = Date.now();
    for (let i = 0; i < pages.length; i++) {
      const left = i > 2 ? Math.round((Date.now() - t0) / i * (pages.length - i) / 1000) : null;
      onStatus(`جارٍ تجهيز الصفحة ${i + 1} من ${pages.length}${left != null ? ` · باقي تقريبًا ${left > 90 ? Math.round(left / 60) + ' دقيقة' : left + ' ثانية'}` : ''}...`);
      anchors[i].replaceWith(pages[i]);
      await new Promise(r => setTimeout(r, 0)); // نخلي الصفحة تتنفس (ما تعلق)
      const pageRect = pages[i].getBoundingClientRect();
      const pxPerMm = pageRect.width / w;
      const bcs = [...pages[i].querySelectorAll('svg.as-bc')].map(svg => {
        const r = svg.getBoundingClientRect();
        svg.style.visibility = 'hidden';
        return { code: svg.dataset.code, x: (r.left - pageRect.left) / pxPerMm, y: (r.top - pageRect.top) / pxPerMm, w: r.width / pxPerMm, h: r.height / pxPerMm };
      });
      const canvas = await window.html2canvas(pages[i], { scale: pages.length > 40 ? 2 : 3, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: pages[i].scrollWidth, windowHeight: pages[i].scrollHeight });
      if (i > 0) pdf.addPage([w, h], orientation);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, w, h, undefined, 'FAST');
      canvas.width = canvas.height = 0; // تحرير الذاكرة
      pages[i].remove();
      pdf.setFillColor(0, 0, 0);
      bcs.forEach(bc => {
        const { modules, totalModules } = code128Modules(bc.code);
        const unit = bc.w / totalModules;
        let x = bc.x + C128_QUIET * unit;
        modules.forEach((m, k) => { if (k % 2 === 0) pdf.rect(x, bc.y, m * unit, bc.h, 'F'); x += m * unit; });
      });
    }
    pdf.save(filename);
    return pages.length;
  } finally {
    iframe.remove();
  }
}

async function downloadPdf(builtOverride) {
  let built = builtOverride;
  if (!built) {
    const g = modelsGuard(); if (g) { setStatus(g, true); return; }
    try { built = buildAllPages(); } catch (e) { setStatus(e.message, true); return; }
  }
  if (built.modelsStudents) persistModelMap();
  const { pg } = built;
  const btns = [$('as-print-btn'), $('as-pdf-btn'), $('as-key-print-btn'), $('as-key-pdf-btn')];
  btns.forEach(b => { b.disabled = true; });
  try {
    const base = ((built.o.title || 'ورقة الإجابة') + (built.isKey ? ' - نموذج الإجابة' : scopeFileLabel())).replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const n = await htmlPagesToPdf({ html: built.html, styles: SHEET_STYLES, w: pg.w, h: pg.h, pageSelector: '.as-page', filename: `${base}.pdf`, onStatus: m => setStatus(m) });
    setStatus(`تم تحميل ${n} صفحة${pg.perPage === 2 ? ` (${built.sheets} ورقة طالب)` : ''} ✓`);
  } catch (e) {
    console.error(e);
    setStatus('تعذر إنشاء PDF: ' + (e.message || e), true);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

/* ---------- مرحلة وفصول الاختبار (تنحفظ مع المفتاح) ---------- */
let keySections = null;   // null = كل فصول المرحلة، أو مصفوفة أرقام الفصول (لما تكون مرحلة وحدة)
let keyGrades = [];       // [] = ما اختار، null = جميع المراحل، أو مصفوفة مراحل
// المادة من قائمة موحّدة، والعنوان يُكتب تلقائيًا: «اختبار الرياضيات - أول متوسط»
let erMod = null;
async function fillSubjectSelect() {
  const sel = $('as-subject');
  if (!sel || sel.options.length > 1) return;
  try {
    erMod = erMod || await import('./exam-reports.js');
    (await erMod.loadSubjectNames()).filter(n => n !== NAFES).forEach(n => sel.add(new Option(n, n)));
    sel.add(new Option('نافس (رياضيات، علوم، لغتي)', NAFES), 1);
  } catch (e) { console.error('subjects', e); }
}
function setSubject(v) {
  const sel = $('as-subject');
  const c = v && erMod ? erMod.canonSubject(v) : (v || '');
  if (c && ![...sel.options].some(o => o.value === c)) sel.add(new Option(c === NAFES ? 'نافس (رياضيات، علوم، لغتي)' : c, c));
  sel.value = c;
  updateKeyTitle();
}
function updateKeyTitle() {
  const sj = $('as-subject').value;
  const g = keyGrade();
  const name = sj === NAFES ? 'نافس التجريبي' : sj;
  $('as-title').value = sj ? `اختبار ${name}${g ? ' - ' + (gradeLabels[g] || g) : ''}` : '';
  // نافس: ربط المهارات أساسي، ولكل سؤال مادته
  if (sj === NAFES && $('as-skills-on') && !$('as-skills-on').checked) $('as-skills-on').checked = true;
  // نافس: ٦٠ فقرة اختيار من متعدد افتراضيًا
  if (sj === NAFES && !currentKeyId && num('as-questions') === 20 && !num('as-tf')) {
    $('as-questions').value = NAFES_DEFAULT.questions; $('as-mcq').value = NAFES_DEFAULT.questions; $('as-choices').value = '4'; updateQSum();
  }
}
function keyGrade() { return Array.isArray(keyGrades) && keyGrades.length === 1 ? keyGrades[0] : ''; }
const keyClassChosen = () => keyGrades === null || keyGrades.length > 0;
function renderKeyGrades() {
  const box = $('as-key-grades'); if (!box) return;
  const all = keyGrades === null;
  box.innerHTML = `<label class="as-ks${all ? ' on' : ''}"><input type="checkbox" data-kg="all"${all ? ' checked' : ''}>جميع المراحل</label>` +
    GRADES.map(g => { const on = !all && keyGrades.includes(g); return `<label class="as-ks${on ? ' on' : ''}"><input type="checkbox" data-kg="${g}"${on ? ' checked' : ''}>${gradeLabels[g] || g}</label>`; }).join('');
  box.querySelectorAll('[data-kg]').forEach(cb => cb.addEventListener('change', async () => {
    if (cb.dataset.kg === 'all') keyGrades = cb.checked ? null : [];
    else {
      const cur = new Set(keyGrades || []);
      if (cb.checked) cur.add(cb.dataset.kg); else cur.delete(cb.dataset.kg);
      keyGrades = cur.size === GRADES.length ? null : GRADES.filter(g => cur.has(g));
    }
    keySections = null;
    if ($('as-step-msg')) $('as-step-msg').textContent = '';
    renderKeyGrades();
    updateKeyTitle();
    await loadAllStudents();
    renderKeySecs(); applyKeyClassToPrint();
  }));
}
function renderKeySecs() {
  const box = $('as-key-secs'); if (!box) return;
  const g = keyGrade();
  $('as-key-secs-wrap').classList.toggle('hidden', !g);
  if (!g) { keySections = null; return; }
  const secs = [...new Set(asStudents.filter(st => st.grade_level === g).map(st => st.class_section || 0))].sort((a, b) => a - b);
  if (!secs.length) { box.innerHTML = '<span class="as-muted">كل فصول المرحلة</span>'; keySections = null; return; }
  if (keySections) keySections = keySections.filter(n => secs.includes(n));
  if (keySections && !keySections.length) keySections = null;
  box.innerHTML = `<label class="as-ks${keySections ? '' : ' on'}"><input type="checkbox" data-ks="all"${keySections ? '' : ' checked'}>كل الفصول</label>` +
    secs.map(n => `<label class="as-ks${keySections && keySections.includes(n) ? ' on' : ''}"><input type="checkbox" data-ks="${n}"${keySections && keySections.includes(n) ? ' checked' : ''}>${n || 'بدون'}</label>`).join('');
  box.querySelectorAll('[data-ks]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.dataset.ks === 'all') keySections = null;
    else {
      const n = +cb.dataset.ks;
      const cur = new Set(keySections || []);
      if (cb.checked) cur.add(n); else cur.delete(n);
      keySections = cur.size && cur.size < secs.length ? [...cur].sort((a, b) => a - b) : null;
    }
    renderKeySecs(); applyKeyClassToPrint();
  }));
}
// خطوة الطباعة تاخذ نفس المرحلة/الفصل تلقائيًا
function applyKeyClassToPrint() {
  if (!$('as-grade') || !keyClassChosen()) return;
  const g = keyGrade();
  if (!g) { $('as-scope').value = 'school'; refreshScopeControls(); renderDistribution(); renderPreview(); return; }
  $('as-grade').value = g;
  if (keySections && keySections.length === 1) { $('as-scope').value = 'class'; refreshScopeControls(); $('as-section').value = String(keySections[0]); }
  else $('as-scope').value = 'grade';
  refreshScopeControls(); renderDistribution(); renderPreview();
}

/* ---------- خطوات التصميم: البيانات ← الأسئلة ← الإجابات ← الطباعة ← التصدير ---------- */
let asStep = 1;
const num = id => Math.max(0, parseInt(($(id) || {}).value, 10) || 0);
// عدد الأسئلة = اختيار من متعدد + صح وخطأ: أي خانة تتغيّر نعدّل الباقي عشان يبقى المجموع صحيح
function syncCounts(src) {
  let total = num('as-questions'), mcq = num('as-mcq'), tf = num('as-tf');
  if (src === 'total') { tf = Math.min(tf, total); mcq = total - tf; }
  else if (src === 'mcq') { if (mcq > total) { total = mcq + tf; } else tf = total - mcq; }
  else if (src === 'tf') { if (tf > total) { total = tf + mcq; } else mcq = total - tf; }
  $('as-questions').value = total; $('as-mcq').value = mcq; $('as-tf').value = tf;
  updateQSum();
}
function updateQSum() {
  const el = $('as-q-sum'); if (!el) return;
  const total = num('as-questions'), mcq = num('as-mcq'), tf = num('as-tf');
  const essay = $('as-essay-on').checked ? num('as-essay-total') : 0;
  const parts = [];
  if (mcq) parts.push(`${mcq} اختيار من متعدد`);
  if (tf) parts.push(`${tf} صح وخطأ`);
  const ok = mcq + tf === total;
  el.innerHTML = `${parts.length ? parts.join(' + ') + ` = <b>${total} سؤال</b>` : 'لا توجد أسئلة موضوعية'}${essay ? ` · ومقالي من <b>${essay}</b>` : ''}${ok ? '' : ' <span style="color:var(--danger);">(المجموع غير مطابق)</span>'}`;
  el.classList.toggle('bad', !ok);
  if ($('as-tf-pos')) $('as-tf-pos').closest('label').style.opacity = tf ? '1' : '0.5';
}
function stepError(n) {
  if (n === 1 && !keyClassChosen()) return 'حدد المرحلة (أو جميع المراحل)';
  if (n === 2) {
    const o = readOptions();
    if (!o.questions && !o.essayTotal) return 'حدد عدد الأسئلة';
    if (num('as-mcq') + num('as-tf') !== o.questions) return 'يجب أن يساوي مجموع الاختيار من متعدد والصح والخطأ عدد الأسئلة';
    const L = computeLayout({ size: o.size, questions: o.questions, choices: o.choices, essayTotal: o.essayTotal, tf: o.tf, tfFirst: o.tfFirst });
    if (!L.ok) return L.error;
  }
  return null;
}
function showStep(n) {
  asStep = Math.max(1, Math.min(5, n));
  document.querySelectorAll('#as-body .as-step').forEach(el => el.classList.toggle('hidden', +el.dataset.step !== asStep));
  document.querySelectorAll('#as-steps button').forEach(b => { const k = +b.dataset.step; b.classList.toggle('active', k === asStep); b.classList.toggle('done', k < asStep); });
  $('as-prev').style.visibility = asStep === 1 ? 'hidden' : 'visible';
  $('as-next').style.visibility = asStep === 5 ? 'hidden' : 'visible';
  $('as-step-msg').textContent = '';
  if (asStep === 3) renderKeyGrid();
  if (asStep === 5) {
    const o = readOptions();
    const n2 = o.withBarcode ? selectedStudents().length : 0;
    $('as-exp-sum').textContent = o.withBarcode ? `${n2} ورقة باسم الطالب${PAGE[o.size].perPage === 2 ? ` (${Math.ceil(n2 / 2)} صفحة A4)` : ''}` : 'ورقة فارغة بدون أسماء - اطبع العدد الذي تحتاجه';
  }
}
function goStep(n) {
  // الانتقال لقدّام يمر على تحقق الخطوات اللي بالطريق
  for (let k = asStep; k < n; k++) { const e = stepError(k); if (e) { showStep(k); $('as-step-msg').textContent = e; return; } }
  showStep(n);
}

export function initAnswerSheetCard() {
  if (asInitialized) { renderPreview(); return; }
  asInitialized = true;
  document.querySelectorAll('#as-steps button').forEach(b => b.addEventListener('click', () => goStep(+b.dataset.step)));
  $('as-next').addEventListener('click', () => goStep(asStep + 1));
  $('as-prev').addEventListener('click', () => showStep(asStep - 1));
  $('as-questions').addEventListener('input', () => syncCounts('total'));
  $('as-mcq').addEventListener('input', () => syncCounts('mcq'));
  $('as-tf').addEventListener('input', () => syncCounts('tf'));
  $('as-essay-total').addEventListener('input', updateQSum);
  $('as-essay-on').addEventListener('change', updateQSum);
  renderKeyGrades();
  fillSubjectSelect();
  $('as-subject').addEventListener('change', updateKeyTitle);
  initSkillsBox();
  showStep(1); updateQSum();
  $('as-grade').innerHTML = GRADES.map(g => `<option value="${g}">${gradeLabels[g] || g}</option>`).join('');

  const refresh = () => { updateLimitHint(); refreshScopeControls(); renderDistribution(); renderPreview(); };
  ['as-size', 'as-questions', 'as-mcq', 'as-choices', 'as-lang', 'as-title', 'as-subject', 'as-tf', 'as-tf-pos'].forEach(id => {
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
    const arr = activeModel === MODEL_B ? keyAnswersB : keyAnswers;
    const cur = arr[q];
    if ($('as-multi-on') && $('as-multi-on').checked && cur != null) {
      // أكثر من إجابة: الضغط يضيف الحرف أو يزيله
      const set = new Set(Array.isArray(cur) ? cur : [cur]);
      if (set.has(c)) set.delete(c); else set.add(c);
      const v = [...set].sort((a, b) => a - b);
      arr[q] = v.length > 1 ? v : (v.length ? v[0] : null);
    } else {
      arr[q] = cur === c ? null : c;
    }
    renderKeyGrid();
  });
  $('as-key-grid').addEventListener('change', (e) => {
    const sel = e.target.closest('.as-ord');
    if (!sel) return;
    orderB[+sel.dataset.q] = sel.value === '' ? null : +sel.value;
    renderKeyGrid();
  });
  $('as-models-on').addEventListener('change', async () => {
    if ($('as-models-on').checked && $('as-models-assign').value === 'auto' && !$('as-barcode').checked) {
      $('as-barcode').checked = true;
      $('as-barcode-opts').classList.remove('hidden');
      await loadAllStudents();
    }
    renderKeyGrid(); refresh();
  });
  $('as-models-mode').addEventListener('change', renderKeyGrid);
  const setAssign = (v) => { $('as-models-assign').value = v; renderKeyGrid(); refresh(); };
  $('as-models-assign').addEventListener('change', () => { renderKeyGrid(); refresh(); });
  $('as-assign-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setAssign(b.dataset.a)));
  $('as-dist-bubble').addEventListener('click', () => setAssign('bubble'));
  $('as-model-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { activeModel = b.dataset.m; renderKeyGrid(); }));
  $('as-dist-auto').addEventListener('click', () => {
    if (!confirm('إعادة توزيع النموذجين بالتناوب لكل الطلاب المختارين؟ أي تعديل يدوي عليهم بيتغيّر.')) return;
    ensureAssignments(selectedStudents(), true); renderDistribution(); renderPreview();
  });
  $('as-dist-toggle').addEventListener('click', () => {
    const l = $('as-dist-list'); const open = l.classList.toggle('hidden') === false;
    $('as-dist-toggle').textContent = open ? 'إخفاء الطلاب' : 'عرض الطلاب';
    renderDistribution();
  });
  $('as-dist-list').addEventListener('click', (e) => {
    const b = e.target.closest('.as-dist-m'); if (!b) return;
    modelMap[b.dataset.id] = modelMap[b.dataset.id] === MODEL_B ? MODEL_A : MODEL_B;
    renderDistribution(); renderPreview();
  });
  const keyAction = (fn) => () => {
    let built;
    try { built = buildKeyPages(); } catch (e) { const el = $('as-key-status'); el.textContent = e.message; el.style.color = 'var(--danger)'; return; }
    fn(built);
  };
  $('as-key-print-btn').addEventListener('click', keyAction(printSheets));
  $('as-key-pdf-btn').addEventListener('click', keyAction(downloadPdf));
  $('as-key-clear-btn').addEventListener('click', () => { keyAnswers = []; keyAnswersB = []; orderB = []; activeModel = MODEL_A; renderKeyGrid(); renderDistribution(); });
  $('as-key-save-btn').addEventListener('click', saveKey);
  $('as-key-new-btn').addEventListener('click', () => { resetKeyForm(); refresh(); });
  $('as-points-on').addEventListener('change', renderKeyGrid);
  $('as-points-apply').addEventListener('click', () => { const v = ptVal($('as-points-all').value); keyPoints = keyPoints.map(() => v); renderKeyGrid(); });
  $('as-key-grid').addEventListener('input', (e) => {
    const inp = e.target.closest('.as-pt'); if (!inp) return;
    keyPoints[+inp.dataset.q] = ptVal(inp.value);
    const o = readOptions(); const total = keyPoints.reduce((a, b) => a + b, 0) + (o.essayTotal || 0);
    $('as-points-sum').textContent = `الدرجة الكاملة: ${fmtPt(total)}${o.essayTotal ? ` (منها المقالي ${o.essayTotal})` : ''}`;
  });
  $('as-saved-keys').addEventListener('change', () => { $('as-key-load-btn').disabled = $('as-key-delete-btn').disabled = !$('as-saved-keys').value; });
  $('as-key-load-btn').addEventListener('click', () => {
    const k = savedKeys.find(x => x.id === $('as-saved-keys').value);
    if (!k) return;
    loadKeyIntoForm(k);
    if (k.models && k.models.mode && k.models.assign !== 'bubble' && !$('as-barcode').checked) { $('as-barcode').checked = true; $('as-barcode-opts').classList.remove('hidden'); loadAllStudents().then(refresh); }
    refresh(); renderKeyGrid();
    keyStatusMsg(`تم فتح "${k.title}" للتعديل - الحفظ يحدّث هذا الاختبار. لإنشاء اختبار آخر اضغط «＋ اختبار جديد»`);
  });
  $('as-key-delete-btn').addEventListener('click', async () => {
    const k = savedKeys.find(x => x.id === $('as-saved-keys').value);
    if (!k) return;
    if (isTeacherRole() && k.created_by && k.created_by !== currentUserId) { keyStatusMsg('هذا المفتاح من الإدارة - يمكنك حذف مفاتيحك فقط', true); return; }
    if (!confirm(`حذف المفتاح "${k.title}" نهائيًا؟`)) return;
    const { error } = await sb.from('answer_keys').delete().eq('id', k.id);
    if (error) { keyStatusMsg('تعذر الحذف: ' + error.message, true); return; }
    if (currentKeyId === k.id) currentKeyId = null;
    await refreshSavedKeysList();
    updateCurLabel();
    keyStatusMsg('تم حذف المفتاح');
  });
  ['as-questions', 'as-mcq', 'as-choices', 'as-lang', 'as-tf'].forEach(id => $(id).addEventListener('input', renderKeyGrid));
  ['as-choices', 'as-lang', 'as-tf-pos'].forEach(id => $(id).addEventListener('change', renderKeyGrid));
  $('as-toggle-btn').addEventListener('click', () => {
    const open = $('as-body').classList.toggle('hidden') === false;
    $('as-toggle-btn').textContent = open ? 'إخفاء' : 'تصميم ورقة';
    if (open) { refresh(); renderKeyGrid(); refreshSavedKeysList(); }
  });
  updateLimitHint();
  updateCurLabel();
}


/* ---------- واجهة ربط الأسئلة بالمهارات ---------- */
function isNafes() { const el = $('as-subject'); return !!(el && el.value === NAFES); }
function skillsOn() { const el = $('as-skills-on'); return isNafes() || !!(el && el.checked); }
const SK_COLORS = ['#2455A4', '#1F7A45', '#B45F1E', '#5A3E9E', '#0B7A8C', '#8A3A30', '#2E6FB7', '#A4501A', '#3F6B2A', '#7A2E6B'];
function skKey(x) { return (x.s || '') + '|' + x.k; }
function skColor(x) {
  const keys = [...new Set(keySkills.filter(Boolean).map(skKey))];
  return SK_COLORS[Math.max(0, keys.indexOf(skKey(x))) % SK_COLORS.length];
}
function partOf(q1) { return keyParts.find(p => q1 >= p.from && q1 <= p.to) || null; }
function skSubject() {
  if (!isNafes()) return $('as-subject').value || '';
  const p = partOf(parseInt($('as-sk-from').value, 10) || 1);
  return p ? p.s : ($('as-sk-subj').value || NAFES_SUBJECTS[0]);
}
function defaultParts(n) {
  const per = Math.floor(n / NAFES_SUBJECTS.length) || 1;
  return NAFES_SUBJECTS.map((s, i) => ({ s, from: i * per + 1, to: i === NAFES_SUBJECTS.length - 1 ? n : (i + 1) * per, teacher_id: '' }));
}
function partsProblem(n) {
  const seen = new Array(n + 1).fill(0);
  for (const p of keyParts) { if (!(p.from >= 1 && p.to <= n && p.from <= p.to)) return `مدى أسئلة ${p.s} غير صحيح`; for (let q = p.from; q <= p.to; q++) seen[q]++; }
  if (seen.slice(1).some(v => v > 1)) return 'يوجد تداخل بين أسئلة المواد في أجزاء الاختبار';
  return null;
}
async function loadStaff() {
  if (staffList) return staffList;
  const { data } = await readScopedBySchool(scoped => { let q = sb.from('profiles').select('id, full_name, role').in('role', ['teacher', 'deputy', 'admin']); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q.order('full_name'); });
  staffList = (data || []).filter(p => p.full_name);
  return staffList;
}
function renderParts(n) {
  const box = $('as-parts'); if (!box) return;
  box.classList.toggle('hidden', !isNafes());
  if (!isNafes()) return;
  if (!keyParts.length || keyParts.some(p => p.to > n)) keyParts = defaultParts(n).map((p, i) => ({ ...p, teacher_id: (keyParts[i] || {}).teacher_id || '' }));
  const staff = staffList || [];
  const prog = p => { let a = 0, k = 0; for (let q = p.from - 1; q < p.to; q++) { if (keyAnswers[q] != null) a++; if (keySkills[q]) k++; } const t = p.to - p.from + 1; return `<span class="as-pp${a === t && k === t ? ' ok' : ''}">الإجابات ${a}/${t} · المهارات ${k}/${t}</span>`; };
  box.innerHTML = `<div class="as-parts-h"><b>أجزاء الاختبار والمعلم المشرف</b><small>يظهر لكل معلم مشرف النموذج في حسابه، فيدخل إجابات أسئلة مادته ومهاراتها.</small></div>
    ${keyParts.map((p, i) => `<div class="as-part" data-i="${i}"><b>${escHtml(p.s)}</b>
      <span>من</span><input type="number" data-f="from" min="1" max="${n}" value="${p.from}"><span>إلى</span><input type="number" data-f="to" min="1" max="${n}" value="${p.to}">
      <select data-f="teacher_id"><option value="">المعلم المشرف...</option>${staff.map(t => `<option value="${t.id}"${t.id === p.teacher_id ? ' selected' : ''}>${escHtml(t.full_name)}</option>`).join('')}</select>
      ${prog(p)}</div>`).join('')}`;
  box.querySelectorAll('.as-part').forEach(row => row.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
    const p = keyParts[+row.dataset.i];
    p[inp.dataset.f] = inp.dataset.f === 'teacher_id' ? inp.value : Math.max(1, Math.min(n, parseInt(inp.value, 10) || 1));
    // مهارات أسئلة الجزء تأخذ مادته
    for (let q = p.from - 1; q < p.to; q++) if (keySkills[q] && keySkills[q].s !== p.s) keySkills[q] = null;
    renderKeyGrid();
  }));
  if (!staffList) loadStaff().then(() => renderParts(n));
}
function fillSkillList() {
  const sj = skSubject();
  const used = keySkills.filter(x => x && (!isNafes() || x.s === sj)).map(x => x.k);
  const base = SKILL_SUGGEST[sj] || SKILL_SUGGEST[Object.keys(SKILL_SUGGEST).find(k => sj.includes(k.replace('ال', ''))) || ''] || [];
  $('as-sk-dl').innerHTML = [...new Set([...used, ...base])].map(k => `<option value="${escHtml(k)}"></option>`).join('');
}
function renderSkillsBox(n) {
  const box = $('as-skills-opts'); if (!box) return;
  const on = skillsOn();
  if (isNafes()) $('as-skills-on').checked = true;
  $('as-skills-on').disabled = isNafes();
  box.classList.toggle('hidden', !on);
  if (!on) return;
  renderParts(n);
  const subjSel = $('as-sk-subj');
  subjSel.classList.toggle('hidden', true);
  if (isNafes() && !subjSel.options.length) subjSel.innerHTML = NAFES_SUBJECTS.map(x => `<option>${x}</option>`).join('');
  $('as-sk-from').max = $('as-sk-to').max = String(Math.max(1, n));
  fillSkillList();
  // ملخص: كل مهارة وأرقام أسئلتها
  const groups = new Map();
  keySkills.forEach((x, q) => { if (!x) return; const k = skKey(x); if (!groups.has(k)) groups.set(k, { x, qs: [] }); groups.get(k).qs.push(q + 1); });
  const ranges = qs => qs.reduce((a, q) => { const l = a[a.length - 1]; if (l && q === l[1] + 1) l[1] = q; else a.push([q, q]); return a; }, []).map(([a, b]) => (a === b ? a : `${a}-${b}`)).join('، ');
  const missing = keySkills.map((x, q) => (x ? null : q + 1)).filter(Boolean);
  const list = [...groups.values()].sort((a, b) => (a.x.s || '').localeCompare(b.x.s || '', 'ar') || a.qs[0] - b.qs[0]);
  $('as-sk-sum').innerHTML = (list.length ? list.map(g => `<div class="as-sk-row"><i style="background:${skColor(g.x)}"></i><b>${isNafes() && g.x.s ? `<span class="as-sk-s">${escHtml(g.x.s)}</span>` : ''}${escHtml(g.x.k)}</b><span>${g.qs.length === 1 ? 'سؤال واحد' : g.qs.length === 2 ? 'سؤالان' : g.qs.length + (g.qs.length <= 10 ? ' أسئلة' : ' سؤالًا')}: ${ranges(g.qs)}</span></div>`).join('') : '')
    + (n ? `<div class="as-sk-row miss${missing.length ? '' : ' ok'}"><i></i><b>${missing.length ? `${missing.length} بدون مهارة` : 'كل الأسئلة مرتبطة بمهارة ✓'}</b>${missing.length ? `<span>${ranges(missing)}</span>` : ''}</div>` : '');
}
function initSkillsBox() {
  if (!$('as-skills-on')) return;
  $('as-skills-on').addEventListener('change', () => renderKeyGrid());
  $('as-sk-subj').addEventListener('change', () => { fillSkillList(); $('as-sk-name').value = ''; });
  const apply = clear => {
    const n = keyAnswers.length; if (!n) return;
    let a = Math.max(1, Math.min(n, parseInt($('as-sk-from').value, 10) || 1)), b = Math.max(1, Math.min(n, parseInt($('as-sk-to').value, 10) || a));
    if (b < a) [a, b] = [b, a];
    const k = $('as-sk-name').value.trim();
    if (!clear && !k) { $('as-sk-name').focus(); return; }
    if (isNafes() && partOf(a) !== partOf(b)) { keyStatusMsg('المدى المحدد يشمل أسئلة من أكثر من مادة، حدد أسئلة مادة واحدة', true); return; }
    for (let q = a - 1; q < b; q++) keySkills[q] = clear ? null : { s: skSubject(), k };
    // المدى التالي يبدأ بعد آخر سؤال
    if (!clear && b < n) { $('as-sk-from').value = b + 1; $('as-sk-to').value = b + 1; }
    renderKeyGrid();
  };
  $('as-sk-from').addEventListener('change', fillSkillList);
  $('as-sk-apply').addEventListener('click', () => apply(false));
  $('as-sk-clear').addEventListener('click', () => apply(true));
  $('as-sk-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(false); } });
  // الضغط على رقم سؤال: أول ضغطة تحدد البداية، والثانية النهاية
  let anchor = null;
  $('as-key-grid').addEventListener('click', e => {
    const b = e.target.closest('.as-qn.pick'); if (!b) return;
    const q = +b.dataset.qn + 1;
    if (anchor == null || e.shiftKey === false && +$('as-sk-from').value !== +$('as-sk-to').value) anchor = null;
    if (anchor == null) { anchor = q; $('as-sk-from').value = q; $('as-sk-to').value = q; }
    else { $('as-sk-from').value = Math.min(anchor, q); $('as-sk-to').value = Math.max(anchor, q); anchor = null; }
    const x = keySkills[q - 1];
    if (x) { if (isNafes() && x.s) $('as-sk-subj').value = x.s; fillSkillList(); $('as-sk-name').value = x.k; }
    $('as-key-grid').querySelectorAll('.as-qn').forEach(el => { const v = +el.dataset.qn + 1; el.classList.toggle('sel', v >= +$('as-sk-from').value && v <= +$('as-sk-to').value); });
    fillSkillList(); if (!x) $('as-sk-name').value = '';
    $('as-sk-name').focus();
  });
}
