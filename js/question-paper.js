/* =========================================================================
 * ورقة الأسئلة مع التظليل (للتصحيح الآلي ببرنامج Remark)
 *
 * المعلم يكتب الأسئلة بالمنصة (اختيار من متعدد بثلاث خيارات أ ب ج / صح وخطأ)، والمنصة تطبع
 * لكل طالب ورقة A4 بالطول خاصة فيه: ترتيب الأسئلة وترتيب الخيارات عشوائي ومربوط برقم هويته.
 *
 * الأسئلة فوق، و"نموذج الإجابة" (شبكة التظليل) أسفل الصفحة الأولى بمكان ثابت بالمليمتر:
 * ٣ أعمدة × ١٠ أسئلة = ٣٠ سؤال، ٣ دوائر بكل سطر (أ ب ج من اليمين). فقالب Remark واحد يقرأ
 * كل الطلاب وكل الاختبارات. الباركود = رقم هوية الطالب. لو الأسئلة ما كفتها الصفحة الأولى
 * تكمل بصفحة ثانية (تنطبع على ظهر الأولى)، والتظليل يبقى بالأولى.
 *
 * التصحيح: لما يُرفع ملف Remark بتقارير الاختبارات، نرجّع إجابات كل طالب لترتيب الأسئلة
 * الأصلي (بخريطة الطالب المحفوظة perms)، ونصحح بمفتاح واحد.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool, writeWithSchool, gradeLabels, printOrgName, printLogo, ASSET_VERSION } from './core.js';
import { code128Svg } from './answer-sheet.js';

const AR = ['أ', 'ب', 'ج'];
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const SLOTS = 3;              // دوائر كل سطر بشبكة التظليل (أ ب ج)
const G_COLS = 2, G_ROWS = 5;
const CAP = G_COLS * G_ROWS;  // أقصى عدد أسئلة

/* ---------- أبعاد الصفحة الأولى (مم) - ثابتة لكل الأوراق ---------- */
const P = {
  w: 210, h: 297, side: 12, mark: 6, markInset: 6,
  titleTop: 10, titleH: 15,
  infoTop: 27, infoRowH: 6.6, barcodeW: 56, barModule: 0.36, barH: 10,
  instrTop: 48.5, instrH: 6,
  qTop: 57,
  gridTitleH: 7, gridHeadH: 6.5, gridRowH: 9.5, gridBottomY: 281,
  gNumW: 16, gPitch: 13, gBubble: 7.2, gPad: 4,
};
P.gridTop = P.gridBottomY - (P.gridTitleH + 2 + P.gridHeadH + G_ROWS * P.gridRowH);
P.gridRowsTop = P.gridTop + P.gridTitleH + 2 + P.gridHeadH;
P.gridBottom = P.gridRowsTop + G_ROWS * P.gridRowH;
P.qBottom = P.gridTop - 4;
P.gColW = P.gNumW + SLOTS * P.gPitch + 2 * P.gPad;
P.innerW = P.w - 2 * P.side;
P.gGap = Math.min(16, (P.innerW - G_COLS * P.gColW) / Math.max(1, G_COLS - 1));
P.gOff = (P.innerW - G_COLS * P.gColW - (G_COLS - 1) * P.gGap) / 2; // توسيط الشبكة

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
  body { font-family:'Tahoma','Arial',sans-serif; color:#16233A; }
  .qp-page { position:relative; width:210mm; height:297mm; overflow:hidden; background:#fff; page-break-after:always; break-after:page; }
  .qp-page:last-child { page-break-after:auto; break-after:auto; }
  .qp-abs { position:absolute; }
  .qp-mark { position:absolute; background:#000; }
  .qp-title { position:absolute; text-align:center; display:flex; flex-direction:column; justify-content:center; line-height:1.4; }
  .qp-title b { font-size:15pt; font-weight:900; }
  .qp-title span { font-size:9pt; color:#3c4a60; font-weight:700; }
  .qp-cell { position:absolute; display:flex; align-items:center; padding:0 2mm; white-space:nowrap; overflow:hidden; font-size:9pt; border:0.25mm solid #9aa6b8; }
  .qp-cell.lbl { background:#1d3557; color:#fff; font-weight:700; justify-content:center; border-color:#1d3557; }
  .qp-cell.val { font-weight:700; background:#fff; }
  .qp-bcbox { position:absolute; border:0.35mm solid #1d3557; border-radius:2mm; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.8mm; background:#fff; }
  .qp-instr { position:absolute; display:flex; align-items:center; justify-content:center; font-size:8.6pt; font-weight:700; background:#eef1f6; border-radius:1.5mm; color:#1d3557; text-align:center; padding:0 3mm; }
  .qp-qarea { position:absolute; overflow:hidden; }
  .qb { border:0.25mm solid #b9c3d1; border-radius:1.6mm; margin-bottom:1.3mm; overflow:hidden; break-inside:avoid; }
  .qb-q { background:#eef1f6; padding:0.9mm 2.2mm; font-weight:700; font-size:var(--qfs,10pt); line-height:1.45; }
  .qb-q .n { color:#1d3557; font-weight:900; margin-inline-end:1.2mm; }
  .qb-opts { display:grid; font-size:var(--ofs,9.6pt); line-height:1.4; }
  .qb-opts.c3 { grid-template-columns:repeat(3, minmax(0,1fr)); }
  .qb-opts.c2 { grid-template-columns:repeat(2, minmax(0,1fr)); }
  .qb-opts.c1 { grid-template-columns:minmax(0,1fr); }
  .qb-o { display:flex; align-items:flex-start; gap:1.4mm; padding:0.8mm 1.8mm; border-top:0.2mm solid #dde3ec; }
  .qb-opts.c3 .qb-o:not(:nth-child(3n+1)), .qb-opts.c2 .qb-o:not(:nth-child(2n+1)) { border-inline-start:0.2mm solid #dde3ec; }
  .qb-o .l { flex-shrink:0; width:4.6mm; height:4.6mm; border:0.3mm solid #1d3557; border-radius:1mm; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:8pt; color:#1d3557; margin-top:0.2mm; }
  .qb-o.correct { background:#e3f3ea; font-weight:700; }
  .qb-o.correct .l { background:#1d3557; color:#fff; }
  .qp-grid-title { position:absolute; display:flex; align-items:center; justify-content:center; gap:3mm; background:#1d3557; color:#fff; font-weight:900; font-size:10.5pt; border-radius:1.6mm; }
  .qp-gbox { position:absolute; border:0.35mm solid #1d3557; border-radius:1.8mm; overflow:hidden; background:#fff; }
  .qp-ghead { position:absolute; background:#1d3557; color:#fff; font-weight:700; font-size:9.5pt; display:flex; align-items:center; justify-content:center; }
  .qp-gnum { position:absolute; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:12pt; background:#eef1f6; color:#1d3557; direction:ltr; }
  .qp-grule { position:absolute; height:0; border-top:0.2mm solid #d3dae5; }
  .qp-bubble { position:absolute; border:0.3mm solid #222; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#8a8a8a; font-weight:700; line-height:1; font-size:10pt; background:#fff; }
  .qp-bubble.fill { background:#000; color:#000; border-color:#000; }
  .qp-foot { position:absolute; text-align:center; font-size:6.8pt; color:#6a7486; }
  .qp-ex { display:inline-block; width:3.4mm; height:3.4mm; border:0.3mm solid #000; border-radius:50%; vertical-align:middle; margin:0 0.8mm; }
  .qp-ex.fill { background:#000; }
  .qp-cont { position:absolute; display:flex; justify-content:space-between; align-items:center; font-size:9pt; font-weight:700; border-bottom:0.4mm solid #1d3557; padding-bottom:1mm; }
  @media screen { body { background:#e9ecf1; padding:10mm 0; } .qp-page { margin:0 auto 8mm; box-shadow:0 2px 14px rgba(0,0,0,.18); } .qp-bar { position:sticky; top:0; z-index:5; display:flex; gap:10px; justify-content:center; align-items:center; padding:10px; background:#16233A; color:#fff; font:600 14px Tahoma; margin:-10mm 0 10mm; } .qp-bar button { font:700 14px Tahoma; padding:8px 18px; border-radius:8px; border:0; cursor:pointer; background:#fff; color:#16233A; } }
  @media print { .qp-bar { display:none; } }
`;

// توزيع الخيارات: ٣ بسطر للقصيرة، وإلا ٢ أو كل خيار بسطر
function optCols(texts) {
  const max = Math.max(0, ...texts.map(t => String(t || '').length));
  if (texts.length === 2) return max <= 80 ? 'c2' : 'c1';
  return max <= 90 ? 'c3' : 'c1';
}

function questionBlock(paper, perm, pos, key) {
  const q = paper.questions[perm.q[pos]];
  const n = pos + 1;
  const correctSlot = key ? perm.o[pos].indexOf(q.answer) : -1;
  let opts;
  if (q.type === 'tf') {
    opts = `<div class="qb-opts c2">${['صح', 'خطأ'].map((t, s) => `<div class="qb-o${s === correctSlot ? ' correct' : ''}"><span class="l">${s === 0 ? '✓' : '✗'}</span><span>${t}</span></div>`).join('')}</div>`;
  } else {
    const texts = perm.o[pos].map(oi => q.options[oi]);
    opts = `<div class="qb-opts ${optCols(texts)}">${texts.map((t, s) => `<div class="qb-o${s === correctSlot ? ' correct' : ''}"><span class="l">${AR[s]}</span><span>${esc(t)}</span></div>`).join('')}</div>`;
  }
  return `<div class="qb"><div class="qb-q"><span class="n">${n}-</span>${esc(q.text)}</div>${opts}</div>`;
}

function marksHtml() {
  return [[P.markInset, P.markInset], [P.w - P.markInset - P.mark, P.markInset], [P.markInset, P.h - P.markInset - P.mark], [P.w - P.markInset - P.mark, P.h - P.markInset - P.mark]]
    .map(([x, y]) => `<div class="qp-mark" style="left:${mm(x)}; top:${mm(y)}; width:${mm(P.mark)}; height:${mm(P.mark)};"></div>`).join('');
}

// شبكة التظليل أسفل الصفحة الأولى: الأعمدة من اليمين (١-١٠ أقصى اليمين)، أ أقصى يمين كل سطر
function gridHtml(paper, perm, key) {
  const n = perm.q.length;
  let h = `<div class="qp-grid-title" style="left:${mm(P.side)}; top:${mm(P.gridTop)}; width:${mm(P.innerW)}; height:${mm(P.gridTitleH)};">نموذج الإجابة <span style="font-weight:400; font-size:8.5pt;">ظلّل دائرة واحدة لكل سؤال تظليلًا كاملًا <span class="qp-ex fill" style="border-color:#fff; background:#fff;"></span></span></div>`;
  const top = P.gridTop + P.gridTitleH + 2;
  for (let c = 0; c < G_COLS; c++) {
    const x = P.w - P.side - P.gOff - (c + 1) * P.gColW - c * P.gGap; // العمود الأول يمين
    const boxH = P.gridHeadH + G_ROWS * P.gridRowH;
    h += `<div class="qp-gbox" style="left:${mm(x)}; top:${mm(top)}; width:${mm(P.gColW)}; height:${mm(boxH)};"></div>`;
    h += `<div class="qp-ghead" style="left:${mm(x + P.gColW - P.gNumW)}; top:${mm(top)}; width:${mm(P.gNumW)}; height:${mm(P.gridHeadH)};">السؤال</div>`;
    h += `<div class="qp-ghead" style="left:${mm(x)}; top:${mm(top)}; width:${mm(P.gColW - P.gNumW)}; height:${mm(P.gridHeadH)}; border-inline-end:0.3mm solid #fff;">الإجابة</div>`;
    for (let r = 0; r < G_ROWS; r++) {
      const pos = c * G_ROWS + r;
      const y = P.gridRowsTop + r * P.gridRowH;
      if (r > 0) h += `<div class="qp-grule" style="left:${mm(x)}; top:${mm(y)}; width:${mm(P.gColW)};"></div>`;
      h += `<div class="qp-gnum" style="left:${mm(x + P.gColW - P.gNumW)}; top:${mm(y)}; width:${mm(P.gNumW)}; height:${mm(P.gridRowH)};">${pos < n ? pos + 1 : ''}</div>`;
      if (pos >= n) continue;
      const q = paper.questions[perm.q[pos]];
      const correctSlot = key ? perm.o[pos].indexOf(q.answer) : -1;
      for (let s = 0; s < optCount(q); s++) {
        const bx = x + P.gColW - P.gNumW - P.gPad - (s + 1) * P.gPitch + (P.gPitch - P.gBubble) / 2;
        const label = q.type === 'tf' ? (s === 0 ? '✓' : '✗') : AR[s];
        h += `<div class="qp-bubble${s === correctSlot ? ' fill' : ''}" style="left:${mm(bx)}; top:${mm(y + (P.gridRowH - P.gBubble) / 2)}; width:${mm(P.gBubble)}; height:${mm(P.gBubble)};">${label}</div>`;
      }
    }
  }
  return h;
}

function firstPageHtml(paper, perm, student, opts) {
  let h = `<div class="qp-page qp-first">` + marksHtml();
  const sub = [paper.subject, gradeLabels[paper.grade_level]].filter(Boolean).join(' · ');
  h += `<div class="qp-title" style="left:${mm(P.side + 10)}; top:${mm(P.titleTop)}; width:${mm(P.innerW - 20)}; height:${mm(P.titleH)};"><b>${esc(paper.title || 'اختبار')}</b><span>${esc(sub)}${opts.key ? ' — <span style="color:#b00;">نسخة المعلم: الإجابات مظللة</span>' : ''}</span></div>`;
  // البيانات يمين، والباركود يسار
  const tblW = P.innerW - P.barcodeW - 4;
  const right = P.w - P.side;
  const g = student ? (gradeLabels[student.grade_level] || '') : (gradeLabels[paper.grade_level] || '');
  const rows = [
    [['اسم الطالب', student ? student.full_name : '', 22, null]],
    [['المدرسة', printOrgName(), 22, null]],
    [['الصف', g, 22, null], ['الفصل', student && student.class_section ? String(student.class_section) : '', 16, 18]],
  ];
  rows.forEach((cells, ri) => {
    const fixed = cells.reduce((a, c) => a + c[2] + (c[3] || 0), 0);
    const flexW = tblW - fixed;
    let off = 0;
    const y = P.infoTop + ri * (P.infoRowH + 0.6);
    cells.forEach(([lbl, val, lw, vw0]) => {
      const vw = vw0 == null ? flexW : vw0;
      h += `<div class="qp-cell lbl" style="left:${mm(right - off - lw)}; top:${mm(y)}; width:${mm(lw)}; height:${mm(P.infoRowH)};">${lbl}</div>`;
      h += `<div class="qp-cell val" style="left:${mm(right - off - lw - vw)}; top:${mm(y)}; width:${mm(vw)}; height:${mm(P.infoRowH)}; direction:rtl;">${esc(val || '')}</div>`;
      off += lw + vw;
    });
  });
  const bcH = 3 * P.infoRowH + 1.2;
  h += `<div class="qp-bcbox" style="left:${mm(P.side)}; top:${mm(P.infoTop)}; width:${mm(P.barcodeW)}; height:${mm(bcH)};">`;
  if (student && student.national_id) {
    const id = String(student.national_id).trim();
    h += code128Svg(id, P.barModule, P.barH).svg + `<div style="font-size:8.5pt; font-family:'Courier New',monospace; font-weight:700; letter-spacing:0.6mm; direction:ltr;">${esc(id)}</div>`;
  } else h += `<div style="font-size:9pt; color:#888;">${opts.key ? 'نسخة المعلم' : 'الباركود'}</div>`;
  h += `</div>`;
  h += `<div class="qp-instr" style="left:${mm(P.side)}; top:${mm(P.instrTop)}; width:${mm(P.innerW)}; height:${mm(P.instrH)};">اقرأ كل سؤال، ثم ظلّل الإجابة الصحيحة في «نموذج الإجابة» أسفل الصفحة — إجابة واحدة لكل سؤال${perm.q.length ? ` · عدد الأسئلة ${perm.q.length}` : ''}</div>`;
  h += `<div class="qp-qarea" style="left:${mm(P.side)}; top:${mm(P.qTop)}; width:${mm(P.innerW)}; height:${mm(P.qBottom - P.qTop)};"></div>`;
  h += gridHtml(paper, perm, opts.key);
  h += `<div class="qp-foot" style="left:${mm(P.side + P.mark)}; width:${mm(P.innerW - 2 * P.mark)}; top:${mm(P.h - P.markInset - P.mark + 0.6)};">ورقة أسئلة · قالب Remark: ${G_COLS} أعمدة × ${G_ROWS} أسئلة · ${SLOTS} دوائر بكل سطر</div>`;
  return h + `</div>`;
}

function contPageHtml(paper, student) {
  return `<div class="qp-page qp-next"><div class="qp-cont" style="left:${mm(P.side)}; top:${mm(10)}; width:${mm(P.innerW)};"><span>${esc(paper.title || '')}</span><span>${esc(student ? student.full_name : '')}</span></div>
    <div class="qp-qarea" style="left:${mm(P.side)}; top:${mm(18)}; width:${mm(P.innerW)}; height:${mm(P.h - 18 - 12)};"></div>
    <div class="qp-foot" style="left:${mm(P.side)}; width:${mm(P.innerW)}; top:${mm(P.h - 9)};">التظليل في الصفحة الأولى</div></div>`;
}

// كل طالب: الصفحة الأولى (فيها التظليل) + قالب صفحة تكميلية + الأسئلة؛ السكربت يوزع الأسئلة على الصفحات
function studentBundle(paper, perm, student, opts = {}) {
  const blocks = perm.q.map((_, pos) => questionBlock(paper, perm, pos, opts.key)).join('');
  return `<div class="qp-stu">${firstPageHtml(paper, perm, student, opts)}<template class="qp-next-tpl">${contPageHtml(paper, student)}</template><template class="qp-blocks">${blocks}</template></div>`;
}

// يوزّع الأسئلة: الصفحة الأولى ثم صفحات تكميلية؛ ولو كلها تقريبًا تدخل بالأولى يصغّر الخط شوي
const FLOW_SCRIPT = `(function(){
  function fill(stu, fs){
    stu.querySelectorAll('.qp-next').forEach(function(p){ p.remove(); });
    var area = stu.querySelector('.qp-first .qp-qarea'); area.innerHTML = '';
    area.style.setProperty('--qfs', fs + 'pt'); area.style.setProperty('--ofs', (fs - 0.4) + 'pt');
    var tmp = document.createElement('div'); tmp.innerHTML = stu.querySelector('template.qp-blocks').innerHTML;
    var blocks = Array.prototype.slice.call(tmp.children), pages = 1, last = stu.querySelector('.qp-first');
    if (window.QP_SINGLE) { blocks.forEach(function(b){ area.appendChild(b); }); return area.scrollHeight > area.clientHeight + 0.5 ? 2 : 1; }
    blocks.forEach(function(b){
      area.appendChild(b);
      if (area.scrollHeight > area.clientHeight + 0.5 && area.children.length > 1) {
        area.removeChild(b);
        var holder = document.createElement('div'); holder.innerHTML = stu.querySelector('template.qp-next-tpl').innerHTML;
        var pg = holder.firstElementChild; last.after(pg); last = pg; pages++;
        area = pg.querySelector('.qp-qarea'); area.style.setProperty('--qfs', fs + 'pt'); area.style.setProperty('--ofs', (fs - 0.4) + 'pt');
        area.appendChild(b);
      }
    });
    return pages;
  }
  document.querySelectorAll('.qp-stu').forEach(function(stu){
    var base = fill(stu, 10), best = 10, bestPages = base;
    var minF = window.QP_SINGLE ? 6.5 : 7.5;
    for (var f = 9.5; bestPages > 1 && f >= minF; f -= 0.5) { var pg = fill(stu, f); if (pg < bestPages) { best = f; bestPages = pg; } }
    if (window.QP_SINGLE && bestPages > 1) best = minF;
    fill(stu, best);
    if (window.QP_SINGLE && bestPages > 1) stu.querySelector('.qp-first .qp-qarea').style.outline = '0.8mm solid #e00';
  });
  var n = document.querySelectorAll('.qp-sheet2').length || document.querySelectorAll('.qp-page').length; var c = document.getElementById('qp-count'); if (c) c.textContent = n;
})();`;

// A4 بالعرض: ورقتين A5 (نفس تصميم A4 مصغّر بنسبة ١/√٢ بالضبط) مع خط قص بالنص - الطالب الأول يمين
const TWO_UP_STYLES = `
  @page { size:A4 landscape; margin:0; }
  .qp-sheet2 { position:relative; width:297mm; height:210mm; overflow:hidden; background:#fff; page-break-after:always; break-after:page; }
  .qp-sheet2:last-child { page-break-after:auto; break-after:auto; }
  .qp-slot { position:absolute; top:0; width:148.5mm; height:210mm; overflow:hidden; }
  /* zoom (مو transform): المتصفح يرتّب الورقة بحجمها المصغّر فعليًا، فما تنقص عند الطباعة */
  .qp-slot .qp-stu { position:absolute; top:0; right:0; width:210mm; height:297mm; zoom:0.70711; }
  @supports not (zoom: 1) { .qp-slot .qp-stu { zoom:normal; transform:scale(0.70711); transform-origin:top right; } }
  .qp-slot .qp-page { overflow:hidden; }
  .qp-slot .qp-page { margin:0 !important; box-shadow:none !important; page-break-after:auto; break-after:auto; }
  .qp-cut { position:absolute; left:148.5mm; top:0; bottom:0; width:0; border-left:0.3mm dashed #888; }
  .qp-cut span { position:absolute; left:-2.4mm; font-size:10pt; color:#666; }
  @media screen { .qp-sheet2 { margin:0 auto 8mm; box-shadow:0 2px 14px rgba(0,0,0,.18); } }
`;
function openPrintWindow(win, title, bundles, note, layout = 'A4') {
  const two = layout === 'A4L2';
  let body = bundles.join('');
  if (two) {
    body = '';
    for (let i = 0; i < bundles.length; i += 2) {
      body += `<div class="qp-sheet2"><div class="qp-slot" style="right:0;">${bundles[i]}</div>${bundles[i + 1] ? `<div class="qp-slot" style="left:0;">${bundles[i + 1]}</div>` : ''}<div class="qp-cut"><span style="top:3mm;">✂</span><span style="bottom:3mm;">✂</span></div></div>`;
    }
  }
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAPER_STYLES}${two ? TWO_UP_STYLES : ''}</style></head><body>
    <div class="qp-bar"><span>${esc(note)} · <span id="qp-count"></span> ${two ? 'ورقة A4 بالعرض' : 'صفحة'}</span><button onclick="window.print()">🖨️ طباعة</button></div>
    ${body}
    <script>window.QP_SINGLE = ${two ? 'true' : 'false'};${FLOW_SCRIPT}<\/script></body></html>`);
  win.document.close();
  win.focus();
}

/* =========================================================================
 * التصحيح: تحويل ملف Remark (صف لكل طالب بالباركود = رقم الهوية) لإجابات بالترتيب الأصلي
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
export async function applyPaperToParsed(parsed, { skip = false } = {}) {
  if (skip) return null;
  const idOf = s => String(s.id || '').trim().replace(/-\d{1,2}$/, '');
  const fileIds = parsed.students.map(idOf).filter(Boolean);
  if (!fileIds.length) return null;
  const { data: papers, error } = await fetchPapers();
  if (error || !papers.length) return null;
  let best = null, bestN = 0;
  papers.forEach(p => {
    if (!p.perms || p.questions.length > parsed.itemCount) return;
    const n = fileIds.filter(id => p.perms[id]).length;
    if (n > bestN) { best = p; bestN = n; }
  });
  if (!best || bestN < fileIds.length * 0.5) return null;

  const paper = best;
  const nQ = paper.questions.length;
  const unknown = [];
  const students = [];
  // أسطر الصح والخطأ بنفس المواضع لكل الطلاب: لو انقرت فيها القيمة ١ فالقالب معرّف بدائرتين (صح=٢، خطأ=١)
  const sample = paper.perms[Object.keys(paper.perms)[0]];
  const tfTwo = sample.q.map((qi, pos) => paper.questions[qi].type === 'tf' && parsed.students.some(st => st.answers[pos] === 1));
  parsed.students.forEach(st => {
    const id = idOf(st);
    const perm = paper.perms[id];
    if (!perm || !Array.isArray(perm.q) || perm.q.length !== nQ) { unknown.push(id || st.name || '—'); return; }
    const answers = Array(nQ).fill(null);
    perm.q.forEach((qi, pos) => {
      const v = st.answers[pos];
      if (v == null) return;
      if (typeof v === 'number' && v <= 0) { answers[qi] = v === -3 ? -3 : -2; return; }
      const q = paper.questions[qi];
      // ترميز Remark: أرقام معكوسة (أقصى يمين = أعلى رقم) أو حروف نصية (أ = ١)
      const width = parsed.textCoded ? null : (q.type === 'tf' && tfTwo[pos] ? 2 : SLOTS);
      const slot = parsed.textCoded ? v - 1 : width - v;
      const orig = perm.o[pos] && perm.o[pos][slot];
      answers[qi] = orig == null ? -3 : orig + 1; // ترميز عادي: الخيار الأصلي أ = ١
    });
    students.push({ ...st, id, model: undefined, modelRaw: null, answers });
  });
  if (!students.length) return null;

  parsed.students = students;
  parsed.itemCount = nQ;
  parsed.choiceCounts = paper.questions.map(optCount);
  parsed.itemTypes = paper.questions.map(q => (q.type === 'tf' ? 'tf' : 'mcq'));
  parsed.detectedKeyRaw = null;
  parsed.presetLetters = paper.questions.map(q => (q.answer == null ? null : AR[q.answer]));
  parsed.paper = { id: paper.id, title: paper.title };
  parsed.textCoded = false;
  parsed.hasEssay = false;
  parsed.detected = { subject: paper.subject || parsed.detected.subject || '', grade: gradeLabels[paper.grade_level] || parsed.detected.grade || '' };
  return { paper, unknown, missingPages: [] };
}

/* =========================================================================
 * الواجهة
 * ========================================================================= */
let papers = [];
let cur = null;          // الورقة المفتوحة
let dirty = false;
let studentsList = null;
let scope = { grade: '', sections: new Set(), layout: (() => { try { return localStorage.getItem('qp-layout') || 'A4'; } catch (_) { return 'A4'; } })() };

function blankPaper() {
  return { id: null, title: '', subject: '', grade_level: '', questions: [], settings: { shuffleQ: true, shuffleOpts: true, order: 'mcq' }, perms: {} };
}
const newMcq = () => ({ type: 'mcq', text: '', options: ['', '', ''], answer: null });
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
      <div><b>ورقة أسئلة مع التظليل</b><span>اكتب الأسئلة مرة واحدة، فتُطبع لكل طالب ورقة بترتيب مختلف للأسئلة والخيارات مرتبطة بهويته. وعند رفع ملف Remark في التقارير يُصحَّح كل طالب وفق نموذجه تلقائيًا.</span></div>
      <button type="button" class="btn-primary" id="qp-new" style="width:auto; padding:10px 18px;">+ ورقة أسئلة جديدة</button>
    </div>
    ${papers.length ? `<div class="qp-list">${papers.map(p => {
      const printed = Object.keys(p.perms || {}).length;
      const mcq = (p.questions || []).filter(q => q.type === 'mcq').length, tf = (p.questions || []).length - mcq;
      return `<div class="qp-item" data-id="${esc(p.id)}">
        <div class="qpi-main"><b>${esc(p.title || 'بدون عنوان')}</b><span>${esc([p.subject, gradeLabels[p.grade_level]].filter(Boolean).join(' · '))}</span></div>
        <div class="qpi-tags"><i>${mcq} اختيار متعدد</i>${tf ? `<i>${tf} صح وخطأ</i>` : ''}${printed ? `<i class="ok">مطبوعة لـ ${printed} طالب</i>` : '<i class="muted">لم تُطبع</i>'}</div>
        <div class="qpi-act"><button type="button" class="btn-secondary qp-open" data-id="${esc(p.id)}" style="width:auto; padding:8px 14px;">فتح</button>${canEdit(p) ? `<button type="button" class="text-action-btn qp-del" data-id="${esc(p.id)}" style="color:var(--danger) !important;">حذف</button>` : ''}</div>
      </div>`;
    }).join('')}</div>` : '<div class="ex-empty"><b>لا توجد أوراق أسئلة بعد</b><span>اضغط «+ ورقة أسئلة جديدة» واكتب أسئلتك أو الصقها جاهزة.</span></div>'}`;
  $('qp-new').onclick = () => { cur = blankPaper(); cur.questions.push(newMcq()); dirty = false; renderEditor(); };
  root.querySelectorAll('.qp-open').forEach(b => b.onclick = () => { const p = papers.find(x => x.id === b.dataset.id); if (!p) return; cur = JSON.parse(JSON.stringify(p)); cur.settings = { shuffleQ: true, shuffleOpts: true, order: 'mcq', ...(cur.settings || {}) }; cur.perms = cur.perms || {}; dirty = false; renderEditor(); });
  root.querySelectorAll('.qp-del').forEach(b => b.onclick = async () => {
    const p = papers.find(x => x.id === b.dataset.id);
    if (!p || !confirm(`حذف ورقة «${p.title || 'بدون عنوان'}» نهائيًا؟${Object.keys(p.perms || {}).length ? '\nتنبيه: لن تُصحَّح الأوراق المطبوعة بعد الحذف.' : ''}`)) return;
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
          <p class="qp-note">يتغيّر ترتيب الأسئلة داخل قسمها، ولا تتغيّر خيارات أسئلة الصح والخطأ.</p>
        </div>
        <div class="form-card">
          <h4>الطباعة</h4>
          <div id="qp-print"></div>
        </div>
        <div class="form-card qp-remark">
          <h4>قالب Remark (مرة واحدة)</h4>
          <p>«نموذج الإجابة» أسفل الصفحة بنفس المكان بكل الأوراق: <b>${G_COLS} أعمدة × ${G_ROWS} أسئلة</b>، وبكل سطر <b>${SLOTS} دوائر</b> (أ ب ج من اليمين). عرّف قالب Remark واحد: الباركود ← StudentID، والشبكة ← ${CAP} سؤال اختيار متعدد. نفس القالب يقرأ كل الاختبارات.</p>
          <p>إذا طبعت A4 بالعرض (طالبان)، فقص الورقة من المنتصف، ليصبح كل نصف ورقة A5 بالتصميم نفسه مصغّرًا - وعرّف له قالب A5 مستقلًا.</p>
          
          <p>ارفع ملف النتائج من «التقارير ← رفع نتائج اختبار»، وستتعرّف المنصة من الباركود على أنه ملف ورقة أسئلة وتصحح كل طالب وفق نموذجه.</p>
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
          <p>الصق أسئلتك بهذا الشكل، وضع <b>*</b> بجانب الإجابة الصحيحة، و<b>(صح)</b> أو <b>(خطأ)</b> في نهاية سؤال الصح والخطأ:</p>
          <pre dir="rtl">1- عاصمة المملكة العربية السعودية؟
أ) جدة
ب) الرياض *
ج) الدمام
2- الماء يغلي عند 100 درجة مئوية (صح)</pre>
          <textarea id="qp-paste-text" rows="8" placeholder="الصق الأسئلة هنا"></textarea>
          <div style="display:flex; gap:8px; margin-top:8px;"><button type="button" class="btn-primary" id="qp-paste-go" style="width:auto; padding:9px 18px;">إضافة الأسئلة</button><button type="button" class="text-action-btn" id="qp-paste-cancel">إلغاء</button><span id="qp-paste-msg" class="qp-status"></span></div>
        </div>
        <div id="qp-questions"></div>
      </div>
    </div>`;

  $('qp-back').onclick = () => { if (dirty && !confirm('توجد تعديلات غير محفوظة. هل تريد الرجوع دون حفظ؟')) return; cur = null; dirty = false; renderList(); };
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
      if (!res.length) { $('qp-paste-msg').textContent = 'لم يُعثر على أسئلة في النص'; return; }
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

function markDirty() { dirty = true; const st = $('qp-status'); if (st) { st.textContent = 'توجد تعديلات غير محفوظة'; st.className = 'qp-status warn'; } }
function setStatus(msg, warn = false) { const st = $('qp-status'); if (st) { st.textContent = msg; st.className = 'qp-status' + (warn ? ' warn' : ' ok'); } }

// ترتيب العرض بالمحرر: نفس ترتيب الأقسام بالورقة الأصلية
function displayOrder() { return identityPerm(cur).q; }

function renderQuestions(scrollLast = false) {
  const box = $('qp-questions');
  const p = cur;
  const ro = !canEdit(p);
  const order = displayOrder();
  const mcq = p.questions.filter(q => q.type === 'mcq').length;
  $('qp-count').textContent = `${p.questions.length} من ${CAP} سؤال · ${mcq} اختيار متعدد · ${p.questions.length - mcq} صح وخطأ`;
  if (!p.questions.length) { box.innerHTML = '<div class="ex-empty"><b>لا توجد أسئلة</b><span>أضف سؤال أو الصق أسئلة جاهزة.</span></div>'; return; }
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
  if (q.type === 'mcq' && q.options.some(o => !o.trim())) out.push('خيار فارغ');
  if (q.type === 'mcq' && q.options.length > SLOTS) out.push(`أقصى ${SLOTS} خيارات`);
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
    if (m && q && q.type === 'mcq' && letterIdx(m[1]) != null && q.options.length < 4) {
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
  return out.map(x => (x.type === 'mcq' && x.options.length < 2 ? { ...x, options: [...x.options, '', '', ''].slice(0, 3) } : x));
}

/* ---------- الحفظ ---------- */
async function savePaper(silent = false) {
  const p = cur;
  if (!p.title.trim()) { setStatus('اكتب عنوان الاختبار', true); $('qp-title').focus(); return false; }
  const sig = structSig(p);
  const printed = Object.keys(p.perms || {}).length;
  if (printed && p.settings.permSig && p.settings.permSig !== sig) {
    if (!confirm(`طُبعت الورقة لـ ${printed} طالب، وتغيّر عدد الأسئلة أو أنواعها أو خياراتها أو إعدادات الخلط.\nلن تُصحَّح الأوراق المطبوعة سابقًا تصحيحًا سليمًا - يجب طباعتها من جديد.\nأكمل الحفظ؟`)) return false;
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
  box.innerHTML = `
    <label class="as-f">الصف<select id="qp-pr-grade"><option value="">اختر الصف</option>${GRADES.map(x => `<option value="${x}"${g === x ? ' selected' : ''}>${gradeLabels[x]}</option>`).join('')}</select></label>
    ${g ? `<div class="qp-secs">${secs.map(n => `<button type="button" class="sd-chip sm${scope.sections.has(n) ? ' on' : ''}" data-s="${n}">فصل ${n}</button>`).join('')}</div><p class="qp-note">${scope.sections.size ? '' : 'كل الفصول — '}اضغط على فصل لتحديده.</p>` : ''}
    <label class="as-f">حجم الطباعة<select id="qp-pr-layout"><option value="A4"${scope.layout !== 'A4L2' ? ' selected' : ''}>A4 بالطول (طالب بالورقة)</option><option value="A4L2"${scope.layout === 'A4L2' ? ' selected' : ''}>A4 بالعرض (طالبين + علامة قص)</option></select></label>
    <div class="qp-pr-sum">${chosen.length ? (scope.layout === 'A4L2' ? `<b>${chosen.length}</b> طالب — <b>${Math.ceil(chosen.length / 2)}</b> ورقة A4 بالعرض` : `<b>${chosen.length}</b> طالب — ورقة لكل طالب`) : 'اختر الصف'}</div>
    <div class="qp-pr-btns">
      <button type="button" class="btn-primary" id="qp-print-st" style="width:auto; padding:10px 16px;" ${chosen.length ? '' : 'disabled'}>🖨️ أوراق الطلاب</button>
      <button type="button" class="btn-secondary" id="qp-print-key" style="width:auto; padding:10px 14px;">نسخة المعلم</button>
      <button type="button" class="text-action-btn" id="qp-preview">معاينة طالب</button>
    </div>
    <div id="qp-pr-msg" class="qp-status"></div>`;
  $('qp-pr-grade').onchange = e => { scope.grade = e.target.value; scope.sections = new Set(); renderPrint(); };
  $('qp-pr-layout').onchange = e => { scope.layout = e.target.value; try { localStorage.setItem('qp-layout', scope.layout); } catch (_) { /* التخزين غير متاح */ } renderPrint(); };
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
  if (!p.questions.length) return 'أضف أسئلة أولًا';
  if (p.questions.length > CAP) return `أقصى عدد ${CAP} سؤال في الورقة (لديك ${p.questions.length})`;
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
  const targets = previewOnly ? list.slice(0, scope.layout === 'A4L2' ? 2 : 1) : list;
  if (!previewOnly) {
    // نحفظ خريطة كل طالب قبل الطباعة (اللي انطبع له قبل يبقى على نفس ورقته)
    const sig = structSig(p);
    if (p.settings.permSig && p.settings.permSig !== sig) p.perms = {};
    if (!p.id) { if (!(await savePaper(true))) { win.close(); return; } }
    targets.forEach(st => { const id = String(st.national_id).trim(); if (!p.perms[id]) p.perms[id] = makePerm(p, id); });
    p.settings.permSig = sig;
    if (!(await savePaper(true))) { win.close(); msg.textContent = 'تعذّر حفظ ربط الأوراق بالطلاب - لم تُطبع'; msg.className = 'qp-status warn'; return; }
    msg.textContent = `تم ربط ${targets.length} ورقة بالطلاب وحفظها ✓`; msg.className = 'qp-status ok';
  }
  const bundles = targets.map(st => {
    const id = String(st.national_id).trim();
    const perm = (!previewOnly && p.perms[id]) || makePerm({ ...p, id: p.id || 'preview' }, id);
    return studentBundle(p, perm, st, {});
  });
  openPrintWindow(win, `${p.title} — أوراق الطلاب`, bundles, previewOnly ? 'معاينة (غير محفوظة)' : `${targets.length} طالب`, scope.layout);
}

function printKey() {
  const msg = $('qp-pr-msg');
  const prob = readyProblems();
  if (prob) { msg.textContent = prob; msg.className = 'qp-status warn'; return; }
  const win = window.open('', '_blank');
  if (!win) return;
  openPrintWindow(win, `${cur.title} — نسخة المعلم`, [studentBundle(cur, identityPerm(cur), null, { key: true })], 'نسخة المعلم بالترتيب الأصلي والإجابات مظللة', scope.layout);
}
