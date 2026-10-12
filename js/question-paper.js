/* =========================================================================
 * ورقة الأسئلة مع التظليل (للتصحيح الآلي ببرنامج Remark)
 *
 * المعلم يكتب الأسئلة بالمنصة (اختيار من متعدد / صح وخطأ)، والمنصة تطبع لكل طالب ورقة
 * أسئلة خاصة فيه: ترتيب الأسئلة وترتيب الخيارات عشوائي ومربوط برقم هويته.
 *
 * التصميم الثابت (أهم شي للتصحيح الآلي): كل صفحة فيها ١٢ سطر بنفس الارتفاع بالضبط، والدوائر
 * يسار كل سطر بنفس المكان (٤ خانات: أ ب ج د من اليمين) - فقالب Remark واحد يقرأ كل الصفحات
 * وكل الطلاب وكل الاختبارات. الباركود بكل صفحة = "رقم الهوية-رقم الصفحة".
 *
 * التصحيح: لما يُرفع ملف Remark بتقارير الاختبارات، نجمع صفحات كل طالب ونرجّع إجاباته
 * لترتيب الأسئلة الأصلي (بخريطة الطالب المحفوظة perms)، ونصحح بمفتاح واحد.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool, writeWithSchool, gradeLabels, printOrgName, printLogo, ASSET_VERSION } from './core.js';
import { code128Svg } from './answer-sheet.js';

const AR = ['أ', 'ب', 'ج', 'د'];
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const SLOTS = 4;            // خانات الدوائر بكل سطر (ثابتة لكل الأسئلة)
const ROWS = 12;            // أسطر الأسئلة بكل صفحة (ثابتة)

/* ---------- أبعاد الصفحة (مم) - ثابتة لكل الأوراق ---------- */
const P = {
  w: 210, h: 297, side: 12, mark: 6, markInset: 7,
  headTop: 12, headH: 19, logoW: 34, barcodeW: 62, barModule: 0.3, barH: 10,
  infoTop: 33.5, infoH: 7.5,
  rowsTop: 45, rowsBottom: 280,
  numW: 7, pitch: 7.4, bubble: 5.6, zonePad: 1.5, gap: 3,
};
P.rowH = (P.rowsBottom - P.rowsTop) / ROWS;
P.zoneW = P.numW + SLOTS * P.pitch + 2 * P.zonePad;
P.qaW = P.w - 2 * P.side - P.zoneW - P.gap - 2.5; // هامش داخلي يمين السطر

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mm = v => `${Math.round(v * 100) / 100}mm`;

/* ---------- العشوائية: ثابتة لكل طالب (نفس الطالب = نفس الورقة لو انطبعت مرة ثانية) ---------- */
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const optCount = q => (q.type === 'tf' ? 2 : (q.options || []).length);
// توقيع هيكل الورقة: لو تغيّر (عدد/نوع/عدد خيارات/الترتيب/الخلط) تتغيّر أوراق الطلاب
function structSig(paper) {
  const s = paper.settings || {};
  return [paper.questions.map(q => q.type + optCount(q) + (q.fixOpts ? 'f' : '')).join(','), s.order || 'mcq', s.shuffleQ !== false ? 1 : 0, s.shuffleOpts !== false ? 1 : 0].join('|');
}
// ترتيب الأسئلة بورقة الطالب (q[موضع] = رقم السؤال الأصلي) وترتيب الخيارات (o[موضع][خانة] = الخيار الأصلي)
function makePerm(paper, nationalId) {
  const s = paper.settings || {};
  const rand = rng(hashStr(`${paper.id}|${nationalId}|${s.seed || 0}`));
  const groups = (s.order === 'tf' ? ['tf', 'mcq'] : ['mcq', 'tf']).map(t => paper.questions.map((q, i) => (q.type === t ? i : -1)).filter(i => i >= 0));
  const q = [].concat(...groups.map(g => (s.shuffleQ !== false ? shuffled(g, rand) : g)));
  const o = q.map(i => { const qq = paper.questions[i]; const base = [...Array(optCount(qq)).keys()]; return qq.type === 'mcq' && s.shuffleOpts !== false && !qq.fixOpts ? shuffled(base, rand) : base; });
  return { q, o };
}
// الترتيب الأصلي (نسخة المعلم)
function identityPerm(paper) {
  const s = paper.settings || {};
  const groups = (s.order === 'tf' ? ['tf', 'mcq'] : ['mcq', 'tf']).map(t => paper.questions.map((q, i) => (q.type === t ? i : -1)).filter(i => i >= 0));
  const q = [].concat(...groups);
  return { q, o: q.map(i => [...Array(optCount(paper.questions[i])).keys()]) };
}

/* =========================================================================
 * رسم الورقة
 * ========================================================================= */
const PAPER_STYLES = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size:A4 portrait; margin:0; }
  html, body { background:#fff; }
  body { font-family:'Tahoma','Arial',sans-serif; color:#000; }
  .qp-page { position:relative; width:210mm; height:297mm; overflow:hidden; background:#fff; page-break-after:always; break-after:page; }
  .qp-page:last-child { page-break-after:auto; break-after:auto; }
  .qp-abs { position:absolute; }
  .qp-mark { position:absolute; background:#000; }
  .qp-box { position:absolute; border:0.3mm solid #000; border-radius:1.5mm; }
  .qp-cell { position:absolute; border:0.25mm solid #000; display:flex; align-items:center; padding:0 1.6mm; white-space:nowrap; overflow:hidden; font-size:9pt; }
  .qp-cell.lbl { background:#e9e9e9; font-weight:700; justify-content:center; }
  .qp-cell.val { font-weight:700; }
  .qp-row { position:absolute; border-top:0.2mm solid #b5b5b5; }
  .qp-zone { position:absolute; border-inline-end:0.3mm solid #000; }
  .qp-bubble { position:absolute; border:0.3mm solid #000; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#9a9a9a; font-weight:700; line-height:1; font-size:7.5pt; background:#fff; }
  .qp-bubble.fill { background:#000; color:#000; }
  .qp-num { position:absolute; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:9pt; direction:ltr; }
  .qp-qa { position:absolute; overflow:hidden; direction:rtl; text-align:right; font-size:10.5pt; line-height:1.35; padding:1.2mm 0 0.8mm; display:flex; flex-direction:column; justify-content:center; gap:0.9mm; }
  .qp-qt { font-weight:700; }
  .qp-qt .n { display:inline-block; min-width:6mm; margin-inline-end:1.2mm; font-weight:900; }
  .qp-qt .tf { font-weight:400; color:#444; font-size:0.85em; margin-inline-start:1.5mm; white-space:nowrap; }
  .qp-opts { display:flex; flex-wrap:wrap; row-gap:0.6mm; padding-inline-start:7.2mm; }
  .qp-opt { padding-inline-end:2mm; }
  .qp-opt b { margin-inline-end:1mm; }
  .qp-opt.correct { text-decoration:underline; text-decoration-thickness:0.5mm; }
  .qp-foot { position:absolute; text-align:center; font-size:7pt; color:#555; }
  .qp-instr { position:absolute; font-size:7.6pt; color:#222; display:flex; align-items:center; gap:2mm; white-space:nowrap; }
  .qp-ex { display:inline-block; width:3.6mm; height:3.6mm; border:0.3mm solid #000; border-radius:50%; vertical-align:middle; }
  .qp-ex.fill { background:#000; }
  @media screen { body { background:#e9ecf1; padding:10mm 0; } .qp-page { margin:0 auto 8mm; box-shadow:0 2px 14px rgba(0,0,0,.18); } .qp-bar { position:sticky; top:0; z-index:5; display:flex; gap:10px; justify-content:center; align-items:center; padding:10px; background:#16233A; color:#fff; font:600 14px Tahoma; margin:-10mm 0 10mm; } .qp-bar button { font:700 14px Tahoma; padding:8px 18px; border-radius:8px; border:0; cursor:pointer; background:#fff; color:#16233A; } }
  @media print { .qp-bar { display:none; } }
`;

// يقيس طول الخيارات ويختار توزيعها: ٤ بسطر، أو ٢×٢، أو كل خيار بسطر
function optLayout(texts) {
  const max = Math.max(0, ...texts.map(t => String(t || '').length));
  if (max <= 15 && texts.length <= 4) return 100 / texts.length;
  if (max <= 36) return 50;
  return 100;
}

function rowHtml(paper, pos, perm, ri, top, opts = {}) {
  const qi = perm.q[pos];
  const q = paper.questions[qi];
  const n = pos + 1;
  const y = top + ri * P.rowH;
  const zoneX = P.side; // منطقة الدوائر يسار الصفحة
  let h = '';
  if (ri > 0) h += `<div class="qp-row" style="left:${mm(P.side)}; top:${mm(y)}; width:${mm(P.w - 2 * P.side)};"></div>`;
  // رقم السؤال يسار الدوائر، ثم الدوائر: الخانة ٠ (أ) أقصى اليمين
  h += `<div class="qp-num" style="left:${mm(zoneX + P.zonePad)}; top:${mm(y)}; width:${mm(P.numW)}; height:${mm(P.rowH)};">${n}</div>`;
  const nOpts = optCount(q);
  const correctSlot = opts.key ? perm.o[pos].indexOf(q.answer) : -1;
  for (let s = 0; s < nOpts; s++) {
    const bx = zoneX + P.zonePad + P.numW + (SLOTS - 1 - s) * P.pitch + (P.pitch - P.bubble) / 2;
    const label = q.type === 'tf' ? (s === 0 ? '✓' : '✗') : AR[s];
    h += `<div class="qp-bubble${s === correctSlot ? ' fill' : ''}" style="left:${mm(bx)}; top:${mm(y + (P.rowH - P.bubble) / 2)}; width:${mm(P.bubble)}; height:${mm(P.bubble)};">${label}</div>`;
  }
  // نص السؤال وخياراته
  const qaX = P.side + P.zoneW + P.gap;
  let body = `<div class="qp-qt"><span class="n">${n}.</span>${esc(q.text)}${q.type === 'tf' ? '<span class="tf">( ✓ صح &nbsp; ✗ خطأ )</span>' : ''}</div>`;
  if (q.type === 'mcq') {
    const texts = perm.o[pos].map(oi => q.options[oi]);
    const w = optLayout(texts);
    body += `<div class="qp-opts">${texts.map((t, s) => `<span class="qp-opt${s === correctSlot ? ' correct' : ''}" style="width:${w}%;"><b>${AR[s]})</b>${esc(t)}</span>`).join('')}</div>`;
  }
  h += `<div class="qp-qa" style="left:${mm(qaX)}; top:${mm(y + 0.2)}; width:${mm(P.qaW)}; height:${mm(P.rowH - 0.4)};">${body}</div>`;
  return h;
}

function pageHtml(paper, perm, student, pageNo, pageCount, opts = {}) {
  let h = `<div class="qp-page">`;
  [[P.markInset, P.markInset], [P.w - P.markInset - P.mark, P.markInset], [P.markInset, P.h - P.markInset - P.mark], [P.w - P.markInset - P.mark, P.h - P.markInset - P.mark]]
    .forEach(([x, y]) => { h += `<div class="qp-mark" style="left:${mm(x)}; top:${mm(y)}; width:${mm(P.mark)}; height:${mm(P.mark)};"></div>`; });
  const innerW = P.w - 2 * P.side;
  // الترويسة (يمين: الشعار، وسط: العنوان، يسار: الباركود)
  const logo = printLogo();
  if (logo) h += `<img class="qp-abs" src="${logo}" style="left:${mm(P.w - P.side - P.logoW)}; top:${mm(P.headTop + 1.5)}; width:${mm(P.logoW)}; height:${mm(P.headH - 3)}; object-fit:contain; object-position:right center;" />`;
  const titleX = P.side + P.barcodeW + 3, titleW = innerW - P.barcodeW - P.logoW - 6;
  h += `<div class="qp-abs" style="left:${mm(titleX)}; top:${mm(P.headTop)}; width:${mm(titleW)}; height:${mm(P.headH)}; display:flex; flex-direction:column; justify-content:center; text-align:center; line-height:1.35;">
    <div style="font-size:13pt; font-weight:900;">${esc(paper.title || 'اختبار')}</div>
    <div style="font-size:9pt; font-weight:700;">${esc(printOrgName())}${paper.subject ? ' — ' + esc(paper.subject) : ''}</div>
    ${opts.key ? '<div style="font-size:9pt; font-weight:900; color:#b00;">نسخة المعلم — الإجابات مظللة</div>' : ''}
  </div>`;
  h += `<div class="qp-box" style="left:${mm(P.side)}; top:${mm(P.headTop)}; width:${mm(P.barcodeW)}; height:${mm(P.headH)}; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.6mm;">`;
  if (student && student.national_id) {
    const code = `${String(student.national_id).trim()}-${pageNo}`;
    h += code128Svg(code, P.barModule, P.barH).svg + `<div style="font-size:8pt; font-family:'Courier New',monospace; font-weight:700; letter-spacing:0.4mm; direction:ltr;">${esc(code)}</div>`;
  } else h += `<div style="font-size:8pt; color:#888;">${opts.key ? 'نسخة المعلم' : 'مكان الباركود'}</div>`;
  h += `</div>`;
  // بيانات الطالب: الاسم | الصف | الفصل | الصفحة
  const g = student ? (gradeLabels[student.grade_level] || '') : (gradeLabels[paper.grade_level] || '');
  const cells = [['اسم الطالب', student ? student.full_name : '', 21, null], ['الصف', g, 11, 22], ['الفصل', student && student.class_section ? String(student.class_section) : '', 12, 9], ['الصفحة', `${pageNo} من ${pageCount}`, 14, 15]];
  const fixed = cells.reduce((a, c) => a + c[2] + (c[3] || 0), 0);
  const flexW = innerW - fixed;
  let off = 0;
  cells.forEach(([lbl, val, lw, vw0]) => {
    const vw = vw0 == null ? flexW : vw0;
    h += `<div class="qp-cell lbl" style="left:${mm(P.w - P.side - off - lw)}; top:${mm(P.infoTop)}; width:${mm(lw)}; height:${mm(P.infoH)};">${lbl}</div>`;
    h += `<div class="qp-cell val" style="left:${mm(P.w - P.side - off - lw - vw)}; top:${mm(P.infoTop)}; width:${mm(vw)}; height:${mm(P.infoH)}; direction:rtl;${vw0 != null ? ' justify-content:center;' : ''}">${esc(val || '')}</div>`;
    off += lw + vw;
  });
  // إطار الأسئلة + خط منطقة الدوائر
  h += `<div class="qp-box" style="left:${mm(P.side)}; top:${mm(P.rowsTop)}; width:${mm(innerW)}; height:${mm(P.rowsBottom - P.rowsTop)};"></div>`;
  h += `<div class="qp-abs" style="left:${mm(P.side + P.zoneW)}; top:${mm(P.rowsTop)}; width:0; height:${mm(P.rowsBottom - P.rowsTop)}; border-left:0.3mm solid #000;"></div>`;
  h += `<div class="qp-instr" style="left:${mm(P.side)}; top:${mm(P.rowsTop - 4.6)}; width:${mm(P.zoneW + 40)};">ظلّل دائرة واحدة تظليلًا كاملًا <span class="qp-ex fill"></span></div>`;
  const start = (pageNo - 1) * ROWS;
  for (let ri = 0; ri < ROWS && start + ri < perm.q.length; ri++) h += rowHtml(paper, start + ri, perm, ri, P.rowsTop, opts);
  h += `<div class="qp-foot" style="left:${mm(P.side + P.mark)}; width:${mm(innerW - 2 * P.mark)}; top:${mm(P.h - P.markInset - P.mark + 0.4)};">ورقة أسئلة · ${ROWS} سؤال بالصفحة · ${SLOTS} دوائر بكل سطر · A4 · الباركود: رقم الهوية-رقم الصفحة</div>`;
  return h + `</div>`;
}

const pagesOf = paper => Math.max(1, Math.ceil(paper.questions.length / ROWS));

function studentPages(paper, perm, student, opts) {
  const n = pagesOf(paper);
  return Array.from({ length: n }, (_, i) => pageHtml(paper, perm, student, i + 1, n, opts)).join('');
}

// يصغّر خط كل سؤال لين يدخل بسطره (نفس السكربت بالمعاينة والطباعة)
const FIT_SCRIPT = `(function(){ document.querySelectorAll('.qp-qa').forEach(function(el){ var fs = 10.5; while (el.scrollHeight > el.clientHeight + 1 && fs > 6.5) { fs -= 0.5; el.style.fontSize = fs + 'pt'; } if (el.scrollHeight > el.clientHeight + 1) el.style.outline = '0.6mm solid #e00'; }); })();`;

function openPrintWindow(win, title, pagesHtml, note) {
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAPER_STYLES}</style></head><body>
    <div class="qp-bar"><span>${esc(note)}</span><button onclick="window.print()">🖨️ طباعة</button></div>
    ${pagesHtml}
    <script>${FIT_SCRIPT}<\/script></body></html>`);
  win.document.close();
  win.focus();
}

/* =========================================================================
 * التصحيح: تحويل ملف Remark (صفحات بباركود "الهوية-الصفحة") لإجابات بالترتيب الأصلي
 * ========================================================================= */
export async function fetchPapers() {
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_papers').select('id, title, subject, grade_level, questions, settings, perms, created_by, updated_at');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('updated_at', { ascending: false });
  });
  return { data: data || [], error };
}

// يرجّع null لو الملف مو لورقة أسئلة، وإلا يحوّل parsed (بمكانه) ويرجّع ملخص
export async function applyPaperToParsed(parsed) {
  const re = /^\s*(\d{5,15})\s*-\s*(\d{1,2})\s*$/;
  const tagged = parsed.students.filter(s => re.test(String(s.id || '')));
  if (!tagged.length || tagged.length < parsed.students.length * 0.5) return null;
  const { data: papers, error } = await fetchPapers();
  if (error) throw new Error('تعذر تحميل أوراق الأسئلة: ' + error.message);
  const ids = new Set(tagged.map(s => String(s.id).match(re)[1]));
  let best = null, bestN = 0;
  papers.forEach(p => { const n = [...ids].filter(id => p.perms && p.perms[id]).length; if (n > bestN) { best = p; bestN = n; } });
  if (!best) throw new Error('الملف من ورقة أسئلة (الباركود فيه رقم الصفحة)، بس ما لقيت ورقة الأسئلة المطبوعة لهؤلاء الطلاب بالمنصة');

  const paper = best;
  const nQ = paper.questions.length;
  const nRowsCols = parsed.itemCount;
  // عرض كل عمود (خانات القالب): لو قيم الصح والخطأ ما تعدّت ٢ فالقالب معرّف بدائرتين لهالسطر
  const colMax = Array.from({ length: nRowsCols }, (_, c) => Math.max(0, ...tagged.map(s => (typeof s.answers[c] === 'number' ? s.answers[c] : 0))));
  const byStudent = new Map();
  tagged.forEach(s => {
    const [, id, pg] = String(s.id).match(re);
    if (!byStudent.has(id)) byStudent.set(id, { id, name: s.name, grade: s.grade, section: s.section, subject: s.subject, essay: s.essay, pages: {} });
    const st = byStudent.get(id);
    if (!st.name && s.name) st.name = s.name;
    st.pages[Number(pg)] = s.answers;
  });
  const unknown = [];
  const students = [];
  byStudent.forEach(st => {
    const perm = paper.perms[st.id];
    if (!perm || !Array.isArray(perm.q) || perm.q.length !== nQ) { unknown.push(st.id); return; }
    const answers = Array(nQ).fill(null);
    perm.q.forEach((qi, pos) => {
      const pg = Math.floor(pos / ROWS) + 1, r = pos % ROWS;
      const row = st.pages[pg];
      if (!row || r >= row.length) return;
      const v = row[r];
      if (v == null) return;
      if (typeof v === 'number' && v <= 0) { answers[qi] = v === -3 ? -3 : -2; return; }
      const q = paper.questions[qi];
      const width = parsed.textCoded ? null : (q.type === 'tf' && colMax[r] <= 2 ? 2 : SLOTS);
      const slot = parsed.textCoded ? v - 1 : width - v;
      const orig = perm.o[pos] && perm.o[pos][slot];
      answers[qi] = orig == null ? -3 : orig + 1; // ترميز عادي: الخيار الأصلي أ = ١
    });
    students.push({ id: st.id, name: st.name || '', grade: st.grade || '', section: st.section || '', subject: st.subject || '', essay: st.essay, modelRaw: null, answers, pagesRead: Object.keys(st.pages).length });
  });
  if (!students.length) throw new Error('ما قدرت أربط أي طالب بورقته - تأكد إن ورقة الأسئلة ما تغيّرت بعد الطباعة');

  const missingPages = students.filter(s => s.pagesRead < pagesOf(paper));
  parsed.students = students;
  parsed.itemCount = nQ;
  parsed.choiceCounts = paper.questions.map(optCount);
  parsed.itemTypes = paper.questions.map(q => (q.type === 'tf' ? 'tf' : 'mcq'));
  parsed.detectedKeyRaw = null;
  parsed.presetLetters = paper.questions.map(q => (q.answer == null ? null : ['أ', 'ب', 'ج', 'د'][q.answer]));
  parsed.paper = { id: paper.id, title: paper.title };
  parsed.textCoded = false;
  parsed.hasEssay = false;
  parsed.detected = { subject: paper.subject || parsed.detected.subject || '', grade: gradeLabels[paper.grade_level] || parsed.detected.grade || '' };
  return { paper, unknown, missingPages: missingPages.map(s => s.name || s.id) };
}

/* =========================================================================
 * الواجهة
 * ========================================================================= */
let papers = [];
let cur = null;          // الورقة المفتوحة
let dirty = false;
let studentsList = null;
let scope = { grade: '', sections: new Set() };

function blankPaper() {
  return { id: null, title: '', subject: '', grade_level: '', questions: [], settings: { shuffleQ: true, shuffleOpts: true, order: 'mcq' }, perms: {} };
}
const newMcq = () => ({ type: 'mcq', text: '', options: ['', '', '', ''], answer: null });
const newTf = () => ({ type: 'tf', text: '', answer: null });
const canEdit = p => !p.id || p.created_by === currentUserId || ['admin', 'deputy'].includes(currentProfile && currentProfile.role);

export async function openQuestionPapers() {
  const root = $('qp-root');
  if (!root) return;
  if (cur) { renderEditor(); return; }
  await renderList();
}

async function renderList() {
  const root = $('qp-root');
  root.innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';
  const { data, error } = await fetchPapers();
  if (error) { root.innerHTML = `<div class="error-msg" style="display:block;">تعذر التحميل: ${esc(error.message)}</div>`; return; }
  papers = data;
  root.innerHTML = `
    <div class="qp-intro">
      <div><b>ورقة أسئلة مع التظليل</b><span>اكتب الأسئلة مرة وحدة، وكل طالب تطلع له ورقة بترتيب أسئلة وخيارات مختلف ومربوط بهويته. ولما ترفع ملف Remark بالتقارير يتصحح كل طالب على نموذجه تلقائيًا.</span></div>
      <button type="button" class="btn-primary" id="qp-new" style="width:auto; padding:10px 18px;">+ ورقة أسئلة جديدة</button>
    </div>
    ${papers.length ? `<div class="qp-list">${papers.map(p => {
      const printed = Object.keys(p.perms || {}).length;
      const mcq = (p.questions || []).filter(q => q.type === 'mcq').length, tf = (p.questions || []).length - mcq;
      return `<div class="qp-item" data-id="${esc(p.id)}">
        <div class="qpi-main"><b>${esc(p.title || 'بدون عنوان')}</b><span>${esc([p.subject, gradeLabels[p.grade_level]].filter(Boolean).join(' · '))}</span></div>
        <div class="qpi-tags"><i>${mcq} اختيار متعدد</i>${tf ? `<i>${tf} صح وخطأ</i>` : ''}<i>${pagesOf({ questions: p.questions || [] })} صفحة</i>${printed ? `<i class="ok">مطبوعة لـ ${printed} طالب</i>` : '<i class="muted">ما انطبعت</i>'}</div>
        <div class="qpi-act"><button type="button" class="btn-secondary qp-open" data-id="${esc(p.id)}" style="width:auto; padding:8px 14px;">فتح</button>${canEdit(p) ? `<button type="button" class="text-action-btn qp-del" data-id="${esc(p.id)}" style="color:var(--danger) !important;">حذف</button>` : ''}</div>
      </div>`;
    }).join('')}</div>` : '<div class="ex-empty"><b>ما فيه أوراق أسئلة بعد</b><span>اضغط «+ ورقة أسئلة جديدة» واكتب أسئلتك أو الصقها جاهزة.</span></div>'}`;
  $('qp-new').onclick = () => { cur = blankPaper(); cur.questions.push(newMcq()); dirty = false; renderEditor(); };
  root.querySelectorAll('.qp-open').forEach(b => b.onclick = () => { const p = papers.find(x => x.id === b.dataset.id); if (!p) return; cur = JSON.parse(JSON.stringify(p)); cur.settings = { shuffleQ: true, shuffleOpts: true, order: 'mcq', ...(cur.settings || {}) }; cur.perms = cur.perms || {}; dirty = false; renderEditor(); });
  root.querySelectorAll('.qp-del').forEach(b => b.onclick = async () => {
    const p = papers.find(x => x.id === b.dataset.id);
    if (!p || !confirm(`حذف ورقة «${p.title || 'بدون عنوان'}» نهائيًا؟${Object.keys(p.perms || {}).length ? '\nتنبيه: الأوراق المطبوعة ما راح تتصحح بعد الحذف.' : ''}`)) return;
    const { error } = await sb.from('exam_papers').delete().eq('id', p.id);
    if (error) { alert('تعذر الحذف: ' + error.message); return; }
    renderList();
  });
}

/* ---------- المحرر ---------- */
function renderEditor() {
  const root = $('qp-root');
  const p = cur;
  const ro = !canEdit(p);
  const s = p.settings;
  root.innerHTML = `
    <div class="qp-top">
      <button type="button" class="btn-secondary" id="qp-back" style="width:auto; padding:9px 16px;">→ أوراق الأسئلة</button>
      <div class="qp-save">${ro ? '<span class="as-muted">للعرض فقط - الورقة لمعلم آخر</span>' : `<span id="qp-status" class="qp-status"></span><button type="button" class="btn-primary" id="qp-save-btn" style="width:auto; padding:10px 22px;">حفظ</button>`}</div>
    </div>
    <div class="qp-grid">
      <div class="qp-side">
        <div class="form-card">
          <h4>بيانات الاختبار</h4>
          <label class="as-f">عنوان الاختبار<input type="text" id="qp-title" value="${esc(p.title)}" placeholder="مثال: اختبار الفترة الأولى" ${ro ? 'disabled' : ''}/></label>
          <label class="as-f">المادة<input type="text" id="qp-subject" value="${esc(p.subject || '')}" placeholder="مثال: العلوم" ${ro ? 'disabled' : ''}/></label>
          <label class="as-f">الصف<select id="qp-grade" ${ro ? 'disabled' : ''}><option value="">—</option>${GRADES.map(g => `<option value="${g}"${p.grade_level === g ? ' selected' : ''}>${gradeLabels[g]}</option>`).join('')}</select></label>
        </div>
        <div class="form-card">
          <h4>العشوائية</h4>
          <label class="qp-chk"><input type="checkbox" id="qp-shq" ${s.shuffleQ !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}/> ترتيب الأسئلة يختلف لكل طالب</label>
          <label class="qp-chk"><input type="checkbox" id="qp-sho" ${s.shuffleOpts !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}/> ترتيب الخيارات يختلف لكل طالب</label>
          <label class="as-f" style="margin-top:8px;">ترتيب الأقسام<select id="qp-order" ${ro ? 'disabled' : ''}><option value="mcq"${s.order !== 'tf' ? ' selected' : ''}>الاختيار من متعدد ثم الصح والخطأ</option><option value="tf"${s.order === 'tf' ? ' selected' : ''}>الصح والخطأ ثم الاختيار من متعدد</option></select></label>
          <p class="qp-note">الأسئلة تتلخبط داخل قسمها، والصح والخطأ ما تتغير خياراته.</p>
        </div>
        <div class="form-card">
          <h4>الطباعة</h4>
          <div id="qp-print"></div>
        </div>
        <div class="form-card qp-remark">
          <h4>قالب Remark (مرة وحدة)</h4>
          <p>كل صفحة بأي ورقة أسئلة فيها <b>${ROWS} سطر</b> بنفس المكان، وبكل سطر <b>${SLOTS} دوائر</b> (أ ب ج د من اليمين). عرّف قالب واحد لصفحة A4: الباركود ← StudentID، والأسطر ← ${ROWS} سؤال اختيار متعدد. نفس القالب يقرأ كل الصفحات وكل الاختبارات.</p>
          <p>ارفع ملف النتائج من «التقارير ← رفع نتائج اختبار»، والمنصة تعرف إنه ورقة أسئلة من الباركود وتصحح كل طالب على نموذجه.</p>
        </div>
      </div>
      <div class="qp-main">
        <div class="qp-qhead">
          <h4>الأسئلة <span id="qp-count" class="qp-count"></span></h4>
          ${ro ? '' : `<div class="qp-qtools">
            <button type="button" class="btn-secondary" id="qp-add-mcq" style="width:auto; padding:8px 12px;">+ اختيار من متعدد</button>
            <button type="button" class="btn-secondary" id="qp-add-tf" style="width:auto; padding:8px 12px;">+ صح وخطأ</button>
            <button type="button" class="text-action-btn" id="qp-paste-btn">لصق أسئلة جاهزة</button>
          </div>`}
        </div>
        <div id="qp-paste" class="qp-paste hidden">
          <p>الصق أسئلتك بهالشكل، وحط <b>*</b> جنب الإجابة الصحيحة، و<b>(صح)</b> أو <b>(خطأ)</b> آخر سؤال الصح والخطأ:</p>
          <pre dir="rtl">1- عاصمة المملكة العربية السعودية؟
أ) جدة
ب) الرياض *
ج) الدمام
د) مكة
2- الماء يغلي عند 100 درجة مئوية (صح)</pre>
          <textarea id="qp-paste-text" rows="8" placeholder="الصق الأسئلة هنا"></textarea>
          <div style="display:flex; gap:8px; margin-top:8px;"><button type="button" class="btn-primary" id="qp-paste-go" style="width:auto; padding:9px 18px;">إضافة الأسئلة</button><button type="button" class="text-action-btn" id="qp-paste-cancel">إلغاء</button><span id="qp-paste-msg" class="qp-status"></span></div>
        </div>
        <div id="qp-questions"></div>
      </div>
    </div>`;

  $('qp-back').onclick = () => { if (dirty && !confirm('فيه تعديلات ما انحفظت. ترجع بدون حفظ؟')) return; cur = null; dirty = false; renderList(); };
  if (!ro) {
    const bind = (id, fn) => { const el = $(id); el.addEventListener('input', () => { fn(el); markDirty(); }); el.addEventListener('change', () => { fn(el); markDirty(); }); };
    bind('qp-title', el => { p.title = el.value; });
    bind('qp-subject', el => { p.subject = el.value; });
    bind('qp-grade', el => { p.grade_level = el.value; if (!scope.grade) { scope.grade = el.value; renderPrint(); } });
    bind('qp-shq', el => { s.shuffleQ = el.checked; });
    bind('qp-sho', el => { s.shuffleOpts = el.checked; });
    bind('qp-order', el => { s.order = el.value; renderQuestions(); });
    $('qp-save-btn').onclick = () => savePaper();
    $('qp-add-mcq').onclick = () => { p.questions.push(newMcq()); markDirty(); renderQuestions(true); };
    $('qp-add-tf').onclick = () => { p.questions.push(newTf()); markDirty(); renderQuestions(true); };
    $('qp-paste-btn').onclick = () => { $('qp-paste').classList.toggle('hidden'); $('qp-paste-text').focus(); };
    $('qp-paste-cancel').onclick = () => $('qp-paste').classList.add('hidden');
    $('qp-paste-go').onclick = () => {
      const res = parsePasted($('qp-paste-text').value);
      if (!res.length) { $('qp-paste-msg').textContent = 'ما لقيت أسئلة بالنص'; return; }
      // لو أول سؤال فاضي (الورقة جديدة) نشيله
      if (p.questions.length === 1 && !p.questions[0].text.trim() && (p.questions[0].options || []).every(o => !o.trim())) p.questions = [];
      p.questions.push(...res);
      $('qp-paste-text').value = '';
      $('qp-paste').classList.add('hidden');
      markDirty();
      renderQuestions();
      const noKey = res.filter(q => q.answer == null).length;
      setStatus(`أُضيف ${res.length} سؤال${noKey ? ` — ${noKey} بدون إجابة صحيحة، حددها` : ''}`, !!noKey);
    };
  }
  if (!scope.grade) scope.grade = p.grade_level || '';
  renderQuestions();
  renderPrint();
}

function markDirty() { dirty = true; const st = $('qp-status'); if (st) { st.textContent = 'فيه تعديلات ما انحفظت'; st.className = 'qp-status warn'; } }
function setStatus(msg, warn = false) { const st = $('qp-status'); if (st) { st.textContent = msg; st.className = 'qp-status' + (warn ? ' warn' : ' ok'); } }

// ترتيب العرض بالمحرر: نفس ترتيب الأقسام بالورقة الأصلية
function displayOrder() { return identityPerm(cur).q; }

function renderQuestions(scrollLast = false) {
  const box = $('qp-questions');
  const p = cur;
  const ro = !canEdit(p);
  const order = displayOrder();
  const mcq = p.questions.filter(q => q.type === 'mcq').length;
  $('qp-count').textContent = `${p.questions.length} سؤال · ${mcq} اختيار متعدد · ${p.questions.length - mcq} صح وخطأ · ${pagesOf(p)} ${pagesOf(p) === 1 ? 'صفحة' : 'صفحات'}`;
  if (!p.questions.length) { box.innerHTML = '<div class="ex-empty"><b>ما فيه أسئلة</b><span>أضف سؤال أو الصق أسئلة جاهزة.</span></div>'; return; }
  let lastType = null;
  box.innerHTML = order.map((qi, pos) => {
    const q = p.questions[qi];
    const head = q.type !== lastType ? `<div class="qp-sec">${q.type === 'tf' ? 'صح وخطأ' : 'اختيار من متعدد'}</div>` : '';
    lastType = q.type;
    const dis = ro ? 'disabled' : '';
    let body;
    if (q.type === 'mcq') {
      body = `<div class="qp-opts-ed">${q.options.map((o, oi) => `
        <div class="qp-opt-ed${q.answer === oi ? ' on' : ''}">
          <label class="qp-radio" title="الإجابة الصحيحة"><input type="radio" name="qp-ans-${qi}" data-q="${qi}" data-o="${oi}" class="qp-ans" ${q.answer === oi ? 'checked' : ''} ${dis}/><b>${AR[oi]}</b></label>
          <input type="text" class="qp-opt-in" data-q="${qi}" data-o="${oi}" value="${esc(o)}" placeholder="الخيار ${AR[oi]}" ${dis}/>
          ${!ro && q.options.length > 2 ? `<button type="button" class="qp-x qp-opt-del" data-q="${qi}" data-o="${oi}" aria-label="حذف الخيار">×</button>` : ''}
        </div>`).join('')}
        <div class="qp-opt-tools">${!ro && q.options.length < SLOTS ? `<button type="button" class="text-action-btn qp-opt-add" data-q="${qi}">+ خيار</button>` : ''}
          <label class="qp-chk sm"><input type="checkbox" class="qp-fix" data-q="${qi}" ${q.fixOpts ? 'checked' : ''} ${dis}/> ثبّت ترتيب الخيارات (مثل: جميع ما سبق)</label></div>
      </div>`;
    } else {
      body = `<div class="qp-tf-ed">${['صح ✓', 'خطأ ✗'].map((l, oi) => `<label class="qp-tf-opt${q.answer === oi ? ' on' : ''}"><input type="radio" name="qp-ans-${qi}" data-q="${qi}" data-o="${oi}" class="qp-ans" ${q.answer === oi ? 'checked' : ''} ${dis}/> ${l}</label>`).join('')}</div>`;
    }
    const issues = questionIssues(q);
    return `${head}<div class="qp-q${issues.length ? ' bad' : ''}" data-q="${qi}">
      <div class="qp-q-h"><span class="qp-q-n">${pos + 1}</span>
        ${issues.length ? `<span class="qp-q-warn">${esc(issues.join('، '))}</span>` : ''}
        ${ro ? '' : `<div class="qp-q-act">
          <button type="button" class="qp-ic qp-up" data-q="${qi}" aria-label="لفوق">↑</button>
          <button type="button" class="qp-ic qp-down" data-q="${qi}" aria-label="لتحت">↓</button>
          <button type="button" class="qp-ic qp-dup" data-q="${qi}" aria-label="تكرار">⧉</button>
          <button type="button" class="qp-ic danger qp-del-q" data-q="${qi}" aria-label="حذف السؤال">🗑</button></div>`}
      </div>
      <textarea class="qp-text" data-q="${qi}" rows="2" placeholder="${q.type === 'tf' ? 'نص العبارة' : 'نص السؤال'}" ${dis}>${esc(q.text)}</textarea>
      ${body}
    </div>`;
  }).join('');
  if (ro) return;

  const refreshCard = qi => {
    const card = box.querySelector(`.qp-q[data-q="${qi}"]`);
    const issues = questionIssues(p.questions[qi]);
    card.classList.toggle('bad', !!issues.length);
    let w = card.querySelector('.qp-q-warn');
    if (issues.length) { if (!w) { w = document.createElement('span'); w.className = 'qp-q-warn'; card.querySelector('.qp-q-n').after(w); } w.textContent = issues.join('، '); } else if (w) w.remove();
  };
  box.querySelectorAll('.qp-text').forEach(t => t.addEventListener('input', () => { p.questions[t.dataset.q].text = t.value; markDirty(); refreshCard(t.dataset.q); }));
  box.querySelectorAll('.qp-opt-in').forEach(t => t.addEventListener('input', () => { p.questions[t.dataset.q].options[t.dataset.o] = t.value; markDirty(); refreshCard(t.dataset.q); }));
  box.querySelectorAll('.qp-ans').forEach(r => r.addEventListener('change', () => {
    const q = p.questions[r.dataset.q]; q.answer = Number(r.dataset.o); markDirty();
    box.querySelectorAll(`.qp-q[data-q="${r.dataset.q}"] .qp-opt-ed, .qp-q[data-q="${r.dataset.q}"] .qp-tf-opt`).forEach((el, i) => el.classList.toggle('on', i === q.answer));
    refreshCard(r.dataset.q);
  }));
  box.querySelectorAll('.qp-fix').forEach(c => c.addEventListener('change', () => { p.questions[c.dataset.q].fixOpts = c.checked; markDirty(); }));
  box.querySelectorAll('.qp-opt-add').forEach(b => b.onclick = () => { p.questions[b.dataset.q].options.push(''); markDirty(); renderQuestions(); });
  box.querySelectorAll('.qp-opt-del').forEach(b => b.onclick = () => {
    const q = p.questions[b.dataset.q], oi = Number(b.dataset.o);
    q.options.splice(oi, 1);
    if (q.answer === oi) q.answer = null; else if (q.answer > oi) q.answer--;
    markDirty(); renderQuestions();
  });
  // التحريك داخل نفس القسم (حسب ترتيب العرض)
  const move = (qi, dir) => {
    const ord = displayOrder();
    const pos = ord.indexOf(qi), other = ord[pos + dir];
    if (other == null || p.questions[other].type !== p.questions[qi].type) return;
    [p.questions[qi], p.questions[other]] = [p.questions[other], p.questions[qi]];
    markDirty(); renderQuestions();
  };
  box.querySelectorAll('.qp-up').forEach(b => b.onclick = () => move(Number(b.dataset.q), -1));
  box.querySelectorAll('.qp-down').forEach(b => b.onclick = () => move(Number(b.dataset.q), 1));
  box.querySelectorAll('.qp-dup').forEach(b => b.onclick = () => { const qi = Number(b.dataset.q); p.questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(p.questions[qi]))); markDirty(); renderQuestions(); });
  box.querySelectorAll('.qp-del-q').forEach(b => b.onclick = () => {
    const qi = Number(b.dataset.q); const q = p.questions[qi];
    if ((q.text.trim() || (q.options || []).some(o => o.trim())) && !confirm('حذف هذا السؤال؟')) return;
    p.questions.splice(qi, 1); markDirty(); renderQuestions();
  });
  if (scrollLast) { const cards = box.querySelectorAll('.qp-q'); const last = [...cards].find(c => Number(c.dataset.q) === p.questions.length - 1) || cards[cards.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const t = last.querySelector('.qp-text'); if (t) t.focus(); } }
}

function questionIssues(q) {
  const out = [];
  if (!q.text.trim()) out.push('بدون نص');
  if (q.type === 'mcq' && q.options.some(o => !o.trim())) out.push('خيار فاضي');
  if (q.answer == null) out.push('حدد الإجابة الصحيحة');
  return out;
}

// لصق أسئلة جاهزة من نص
function parsePasted(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let q = null;
  const optRe = /^[([]?\s*([أاإبجدهـabcdABCD])\s*[)\].:\-–]\s*(.+)$/;
  const letterIdx = ch => { const c = ch.toLowerCase(); return ({ 'أ': 0, 'ا': 0, 'إ': 0, 'a': 0, 'ب': 1, 'b': 1, 'ج': 2, 'c': 2, 'د': 3, 'd': 3 })[c]; };
  const markRe = /\s*(\*|✓|✔|\(صح(يح)?\))\s*$/;
  const flush = () => { if (q) out.push(q); q = null; };
  lines.forEach(line => {
    const m = line.match(optRe);
    if (m && q && q.type === 'mcq' && letterIdx(m[1]) != null && q.options.length < SLOTS) {
      let t = m[2];
      const correct = markRe.test(t) || /^\*/.test(t);
      t = t.replace(markRe, '').replace(/^\*\s*/, '').trim();
      if (correct) q.answer = q.options.length;
      q.options.push(t);
      return;
    }
    flush();
    let t = line.replace(/^[\d٠-٩]+\s*[-.)،:]\s*/, '').replace(/^س\s*[\d٠-٩]*\s*[-.:)]\s*/, '').trim();
    const tf = t.match(/\(\s*(صح|صحيح|ص|خطأ|خطا|خاطئ|خ)\s*\)\s*$/);
    if (tf) {
      t = t.replace(tf[0], '').trim();
      q = { type: 'tf', text: t, answer: /^(صح|صحيح|ص)$/.test(tf[1]) ? 0 : 1 };
      flush();
      return;
    }
    q = { type: 'mcq', text: t, options: [], answer: null };
  });
  flush();
  return out.map(x => (x.type === 'mcq' && x.options.length < 2 ? { ...x, options: [...x.options, '', '', '', ''].slice(0, 4) } : x));
}

/* ---------- الحفظ ---------- */
async function savePaper(silent = false) {
  const p = cur;
  if (!p.title.trim()) { setStatus('اكتب عنوان الاختبار', true); $('qp-title').focus(); return false; }
  const sig = structSig(p);
  const printed = Object.keys(p.perms || {}).length;
  if (printed && p.settings.permSig && p.settings.permSig !== sig) {
    if (!confirm(`الورقة انطبعت لـ ${printed} طالب، وتغيّر عدد الأسئلة أو أنواعها أو خياراتها أو إعدادات الخلط.\nالأوراق المطبوعة قبل ما راح تتصحح صح - لازم تطبعها من جديد.\nأكمل الحفظ؟`)) return false;
    p.perms = {};
  }
  const row = { title: p.title.trim(), subject: (p.subject || '').trim() || null, grade_level: p.grade_level || null, questions: p.questions, settings: { ...p.settings, permSig: Object.keys(p.perms).length ? sig : (p.settings.permSig || null) }, perms: p.perms, updated_at: new Date().toISOString() };
  const btn = $('qp-save-btn');
  if (btn) btn.disabled = true;
  let res;
  if (p.id) res = await sb.from('exam_papers').update(row).eq('id', p.id).select('id, created_by').maybeSingle();
  else res = await writeWithSchool(extra => sb.from('exam_papers').insert({ ...row, created_by: currentUserId, ...extra }).select('id, created_by').single());
  if (btn) btn.disabled = false;
  if (res.error) { setStatus('تعذر الحفظ: ' + res.error.message, true); return false; }
  if (res.data) { p.id = res.data.id; p.created_by = res.data.created_by || currentUserId; }
  p.settings = row.settings;
  dirty = false;
  if (!silent) setStatus('تم الحفظ ✓');
  return true;
}

/* ---------- الطباعة ---------- */
async function loadStudents() {
  if (studentsList) return studentsList;
  const { allStudents } = await import('./students-cache.js?v=' + ASSET_VERSION);
  studentsList = await allStudents();
  return studentsList;
}

async function renderPrint() {
  const box = $('qp-print');
  if (!box) return;
  box.innerHTML = '<span class="as-muted">جارٍ تحميل الطلاب...</span>';
  let list;
  try { list = await loadStudents(); } catch (e) { box.innerHTML = `<span class="as-muted">تعذر تحميل الطلاب: ${esc(e.message)}</span>`; return; }
  if (!$('qp-print')) return;
  const g = scope.grade;
  const secs = [...new Set(list.filter(s => s.grade_level === g).map(s => Number(s.class_section) || 0).filter(Boolean))].sort((a, b) => a - b);
  const chosen = selectedStudents(list);
  const pages = pagesOf(cur);
  box.innerHTML = `
    <label class="as-f">الصف<select id="qp-pr-grade"><option value="">اختر الصف</option>${GRADES.map(x => `<option value="${x}"${g === x ? ' selected' : ''}>${gradeLabels[x]}</option>`).join('')}</select></label>
    ${g ? `<div class="qp-secs">${secs.map(n => `<button type="button" class="sd-chip sm${scope.sections.has(n) ? ' on' : ''}" data-s="${n}">فصل ${n}</button>`).join('')}</div><p class="qp-note">${scope.sections.size ? '' : 'كل الفصول — '}اضغط على فصل لتحديده.</p>` : ''}
    <div class="qp-pr-sum">${chosen.length ? `<b>${chosen.length}</b> طالب × ${pages} ${pages === 1 ? 'صفحة' : 'صفحات'} = <b>${chosen.length * pages}</b> صفحة` : 'اختر الصف'}</div>
    <div class="qp-pr-btns">
      <button type="button" class="btn-primary" id="qp-print-st" style="width:auto; padding:10px 16px;" ${chosen.length ? '' : 'disabled'}>🖨️ أوراق الطلاب</button>
      <button type="button" class="btn-secondary" id="qp-print-key" style="width:auto; padding:10px 14px;">نسخة المعلم</button>
      <button type="button" class="text-action-btn" id="qp-preview">معاينة طالب</button>
    </div>
    <div id="qp-pr-msg" class="qp-status"></div>`;
  $('qp-pr-grade').onchange = e => { scope.grade = e.target.value; scope.sections = new Set(); renderPrint(); };
  box.querySelectorAll('.qp-secs button').forEach(b => b.onclick = () => { const n = Number(b.dataset.s); if (scope.sections.has(n)) scope.sections.delete(n); else scope.sections.add(n); renderPrint(); });
  $('qp-print-st').onclick = () => printStudents(false);
  $('qp-preview').onclick = () => printStudents(true);
  $('qp-print-key').onclick = () => printKey();
}

function selectedStudents(list) {
  if (!scope.grade) return [];
  return list.filter(s => s.grade_level === scope.grade && (!scope.sections.size || scope.sections.has(Number(s.class_section) || 0)))
    .sort((a, b) => (Number(a.class_section) || 0) - (Number(b.class_section) || 0) || String(a.full_name).localeCompare(String(b.full_name), 'ar'));
}

function readyProblems() {
  const p = cur;
  if (!p.questions.length) return 'أضف أسئلة أول';
  const bad = p.questions.map((q, i) => (questionIssues(q).length ? i : -1)).filter(i => i >= 0);
  if (bad.length) { const ord = displayOrder(); return `فيه ${bad.length} ${bad.length === 1 ? 'سؤال ناقص' : 'أسئلة ناقصة'} (رقم ${bad.map(i => ord.indexOf(i) + 1).sort((a, b) => a - b).slice(0, 6).join('، ')}) - كمّلها قبل الطباعة`; }
  return null;
}

async function printStudents(previewOnly) {
  const msg = $('qp-pr-msg');
  const prob = readyProblems();
  if (prob) { msg.textContent = prob; msg.className = 'qp-status warn'; return; }
  const list = selectedStudents(studentsList || []);
  if (!list.length) { msg.textContent = 'اختر الصف'; msg.className = 'qp-status warn'; return; }
  const win = window.open('', '_blank');
  if (!win) { msg.textContent = 'اسمح بالنوافذ المنبثقة للطباعة'; msg.className = 'qp-status warn'; return; }
  win.document.write('<p style="font:16px Tahoma; padding:30px; text-align:center;" dir="rtl">جارٍ تجهيز الأوراق...</p>');
  const p = cur;
  const targets = previewOnly ? list.slice(0, 1) : list;
  if (!previewOnly) {
    // نحفظ خريطة كل طالب قبل الطباعة (اللي انطبع له قبل يبقى على نفس ورقته)
    const sig = structSig(p);
    if (p.settings.permSig && p.settings.permSig !== sig) p.perms = {};
    if (!p.id) { if (!(await savePaper(true))) { win.close(); return; } }
    targets.forEach(st => { const id = String(st.national_id).trim(); if (!p.perms[id]) p.perms[id] = makePerm(p, id); });
    p.settings.permSig = sig;
    if (!(await savePaper(true))) { win.close(); msg.textContent = 'تعذر حفظ ربط الأوراق بالطلاب - ما انطبعت'; msg.className = 'qp-status warn'; return; }
    msg.textContent = `تم ربط ${targets.length} ورقة بالطلاب وحفظها ✓`; msg.className = 'qp-status ok';
  }
  const html = targets.map(st => {
    const id = String(st.national_id).trim();
    const perm = (!previewOnly && p.perms[id]) || makePerm({ ...p, id: p.id || 'preview' }, id);
    return studentPages(p, perm, st, {});
  }).join('');
  openPrintWindow(win, `${p.title} — أوراق الطلاب`, html, previewOnly ? 'معاينة ورقة أول طالب (ما انحفظت)' : `${targets.length} طالب · ${targets.length * pagesOf(p)} صفحة`);
}

function printKey() {
  const msg = $('qp-pr-msg');
  const prob = readyProblems();
  if (prob) { msg.textContent = prob; msg.className = 'qp-status warn'; return; }
  const win = window.open('', '_blank');
  if (!win) return;
  openPrintWindow(win, `${cur.title} — نسخة المعلم`, studentPages(cur, identityPerm(cur), null, { key: true }), 'نسخة المعلم بالترتيب الأصلي والإجابات مظللة');
}
