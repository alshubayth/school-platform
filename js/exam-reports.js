import { ASSET_VERSION, sb, currentUserId, currentProfile, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool, setSubRoute, gradeLabels, printOrgName, printLogo } from './core.js';
import { loadXLSX, loadJSZip } from './lib-loader.js';
import { initAnswerSheetCard, fetchSavedKeys, itemKinds } from './answer-sheet.js';
import { normSubj, subjectMatches, gradeFromText } from './teacher-scope.js';

document.getElementById('back-to-tiles-18').addEventListener('click', backToTiles);

const ARABIC_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز'];
const GRADE_BANDS = [
  { grade: 'A', min: 90, max: 100 },
  { grade: 'B', min: 80, max: 89.99 },
  { grade: 'C', min: 70, max: 79.99 },
  { grade: 'D', min: 60, max: 69.99 },
  { grade: 'F', min: 0, max: 59.99 },
];
const RELIABILITY_BANDS = [
  { label: 'ضعيف', min: -Infinity, max: 0.699999 },
  { label: 'متوسط', min: 0.70, max: 0.799999 },
  { label: 'جيد', min: 0.80, max: 0.899999 },
  { label: 'ممتاز', min: 0.90, max: Infinity },
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toLocaleString('ar-SA'); }
function fmt2(n) { return (Math.round((n || 0) * 100) / 100).toLocaleString('ar-SA'); }
function pct(n) { return fmt2(n) + '٪'; }

/* =========================================================================
 * تحليل ملف الإكسل: كشف الأعمدة، فصل صف "النموذج" (الإجابة الصحيحة)، وتحويل
 * كل الرموز الرقمية الخام لكل بند (سؤال) إلى حروف عربية للعرض.
 *
 * ملاحظة مهمة عن ترميز الاختيارات: القيم الرقمية بملف الإكسل معكوسة عن ترتيب
 * الحروف - أعلى رقم = "أ" (أول اختيار) وأقل رقم = آخر حرف مستخدم. مثلاً لسؤال
 * بثلاث اختيارات: ١="ج"، ٢="ب"، ٣="أ". كذلك: -2 تعني "لا توجد استجابة"،
 * -3 تعني "متعدد" (اختار أكثر من إجابة). هذا مؤكد من مطابقة نتائج حقيقية.
 * ========================================================================= */
export function detectColumns(headerRow) {
  const col = {};
  const items = [];
  const itemTypes = []; // 'tf' (صح وخطأ - اختيارين بس) أو 'mcq' (اختيار متعدد عادي) - بالتوازي مع items
  (headerRow || []).forEach((cell, idx) => {
    const c = String(cell == null ? '' : cell).trim();
    if (!c) return;
    if (col.id == null && (c === 'StudentID' || c.toLowerCase() === 'studentid' || (c.includes('رقم') && c.includes('هوي')))) col.id = idx;
    else if (col.name == null && c.includes('اسم') && c.includes('طالب')) col.name = idx;
    else if (col.grade == null && c.includes('صف')) col.grade = idx;
    else if (col.section == null && c === 'الفصل') col.section = idx;
    else if (col.subject == null && c.includes('اسم') && c.includes('ماد')) col.subject = idx;
    else if (col.model == null && (/نموذج/.test(c) || /^(exam\s*)?(form|version|model)(\s*(no\.?|#|code))?$/i.test(c))) col.model = idx;
    else if (col.essay == null && (c.includes('مقالي') || c.includes('مقال'))) col.essay = idx;
    else if (c.includes('صح') && c.includes('خطأ')) { items.push(idx); itemTypes.push('tf'); }
    else if (c.includes('اختيار متعدد') || /^q\d+$/i.test(c) || c.includes('سؤال') || /متعدد\s*\d+$/.test(c)) { items.push(idx); itemTypes.push('mcq'); }
  });
  return { col, items, itemTypes };
}

// بعض الملفات (نادرًا) يجي فيها صف "نموذج" جاهز برقم هوية أو اسم كله أصفار - لو انلقى
// نستخدمه كتعبئة مبدئية لنموذج إدخال الإجابة الصحيحة اليدوي بس (وليس شرطًا لتحليل الملف،
// لأن الغالب أن الملف ما يحتوي مفتاح إجابة أصلًا والمدير يدخلها يدويًا بعد الرفع).
function isAllZeros(val) {
  const s = String(val == null ? '' : val).trim();
  return s.length > 0 && /^0+$/.test(s);
}
function isKeyRow(row) {
  return isAllZeros(row.id) || isAllZeros(row.name);
}

// يحسب عدد الاختيارات الفعلي لكل بند (أكبر قيمة موجبة ظهرت فيه) - بحد أدنى ٢ لأسئلة
// "صح وخطأ" (اختيارين بس) وبحد أدنى ٣ لأسئلة الاختيار المتعدد العادية
function computeChoiceCounts(itemCols, dataRows, itemTypes = []) {
  return itemCols.map((_, i) => {
    let max = itemTypes[i] === 'tf' ? 2 : 3;
    dataRows.forEach(r => {
      const v = r.answers[i];
      if (typeof v === 'number' && v > 0 && v > max) max = v;
    });
    return max;
  });
}

// بعض الملفات ترمّز أول اختيار بأعلى رقم (معكوس - الغالب بالمواد العربية)، وبعضها ترمّزه
// بالرقم ١ عاديًا (المواد الإنجليزية غالبًا) - الاتجاه يُحدَّد بخيار "ترتيب الاختيارات"
// بشاشة الرفع (افتراضيًا يُخمَّن من اسم المادة)، ونفس القيمة تُحفظ مع التقرير عشان تعديل
// المفتاح لاحقًا يستخدم نفس الاتجاه.
function letterForRaw(value, numChoices, reversed = true) { return letterFor(value, numChoices, reversed); }
function letterFor(value, numChoices, reversed = true) {
  if (typeof value !== 'number' || value <= 0) return null;
  const idx = reversed ? numChoices - value : value - 1;
  return ARABIC_LETTERS[idx] || ('اختيار ' + value);
}
// سؤال يقبل أكثر من إجابة: قيمته بالمفتاح مصفوفة قيم خام
export const keyHit = (v, k) => v != null && (Array.isArray(k) ? k.includes(v) : v === k);
const collapseKey = arr => (arr.length > 1 ? arr : (arr.length ? arr[0] : null));
function keyLetters(raw, numChoices, reversed = true) { return (Array.isArray(raw) ? raw : [raw]).map(v => letterFor(v, numChoices, reversed)).filter(Boolean); }
// عكس letterFor: يحوّل الحرف المختار يدويًا (أ/ب/ج...) للقيمة الرقمية الخام المطابقة لترميز الملف
function valueForLetter(letter, numChoices, reversed = true) {
  const idx = ARABIC_LETTERS.indexOf(letter);
  if (idx === -1) return null;
  return reversed ? numChoices - idx : idx + 1;
}
// تخمين مبدئي لاتجاه الترميز من اسم المادة - المواد اللي اسمها بحروف لاتينية (إنجليزي
// غالبًا) الأرجح ترميزها عادي (غير معكوس)؛ غير كذا نفترض معكوس (المواد العربية)
function guessReversedOrder(subjectName) {
  return !/[A-Za-z]/.test(String(subjectName || ''));
}

/* يحوّل صفوف الشيت الخام (array of arrays، أول صف عناوين) لقائمة طلاب. الملفات عادة ما
 * تحتوي صف "نموذج" (مفتاح إجابة) - الإجابة الصحيحة تُدخل يدويًا بعد الرفع (انظر
 * buildManualKey) - لكن لو انلقى صف مفتاح جاهز (رقم هوية/اسم كله أصفار) نستخدمه كتعبئة
 * مبدئية بس، ونستبعده من قائمة الطلاب. */
// قيمة نصية من ملف Remark ← قيمة خام: أ=1، ب=2...، صح=1، خطأ=2، فاضي=-2، أكثر من إجابة=-3
const TEXT_LETTERS = [['أ', 'ا', 'a', '✓', 'صح', 'صحيح', 'true', 't'], ['ب', 'b', '✗', 'خطأ', 'خطا', 'خاطئ', 'false', 'f'], ['ج', 'c'], ['د', 'd'], ['هـ', 'ه', 'e'], ['و', 'f6'], ['ز', 'g']];
function textAnswer(v) {
  const t = String(v).trim().toLowerCase();
  if (!t) return null;
  if (t === 'blank' || t === '-' || t === 'لا توجد استجابة') return -2;
  if (/[,،]/.test(t) || t === 'multi' || t === 'متعدد') return -3;
  const x = t.replace(/[()]/g, '').trim();
  const idx = TEXT_LETTERS.findIndex(list => list.includes(x));
  return idx === -1 ? null : idx + 1;
}

export function parseSheetRows(rows) {
  if (!rows || rows.length < 2) throw new Error('الملف فارغ أو لا يحتوي على بيانات كافية');
  const header = rows[0];
  const { col, items, itemTypes } = detectColumns(header);
  if (col.id == null && col.name == null) throw new Error('لم يُعثر في الملف على عمود "StudentID" (رقم الهوية) ولا على عمود اسم الطالب');
  if (items.length === 0) throw new Error('لم يُعثر في الملف على أعمدة الأسئلة (اختيار متعدد)');

  const allRows = rows.slice(1)
    .filter(r => r && (
      (col.id != null && r[col.id] != null && String(r[col.id]).trim() !== '') ||
      (col.name != null && r[col.name] != null && String(r[col.name]).trim() !== '')
    ))
    .map(r => ({
      id: col.id != null ? String(r[col.id] == null ? '' : r[col.id]).trim() : '',
      name: col.name != null ? String(r[col.name] == null ? '' : r[col.name]).trim() : '',
      grade: col.grade != null ? String(r[col.grade] == null ? '' : r[col.grade]).trim() : '',
      section: col.section != null ? String(r[col.section] == null ? '' : r[col.section]).trim() : '',
      subject: col.subject != null ? String(r[col.subject] == null ? '' : r[col.subject]).trim() : '',
      // النموذج اللي ظلّله الطالب بورقته (لو الملف فيه عمود "النموذج") - قيمة خام مثل الأسئلة
      essay: col.essay != null && r[col.essay] !== '' && r[col.essay] != null && Number.isFinite(Number(r[col.essay])) ? Number(r[col.essay]) : null,
      modelRaw: col.model != null ? parseModelCell(r[col.model]) : null,
      answers: items.map(ci => {
        const v = r[ci];
        if (v === '' || v == null) return null;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
        return textAnswer(v);
      }),
    }));

  // ملف بإجابات نصية (Remark مصدّر بالحروف: أ/ب/ج، صح/خطأ، BLANK) بدل الأرقام:
  // القيمة = رقم الحرف + 1 بترتيب عادي (غير معكوس)
  const textCoded = rows.slice(1).some(r => r && items.some(ci => typeof r[ci] === 'string' && r[ci].trim() && !Number.isFinite(Number(r[ci])) && textAnswer(r[ci]) !== null));

  const keyRows = allRows.filter(isKeyRow);
  const detectedKeyRow = keyRows[0] || null;
  // الورقة نفسها مكررة بالملف (نفس رقم الهوية ونفس الإجابات، كأن تُصدَّر دفعة سابقة مرتين): تُحسب مرة واحدة.
  // ونفس رقم الهوية بإجابات مختلفة يبقى كما هو مع تنبيه، ليراجعه المعلم
  const seen = new Map();
  let dupRemoved = 0;
  const dupConflicts = new Set();
  const sig = r => JSON.stringify([r.answers, r.essay ?? null, r.modelRaw ?? null]);
  const students = [];
  allRows.filter(r => !isKeyRow(r)).forEach(r => {
    const id = String(r.id || '').trim();
    if (!id) { students.push(r); return; }
    const prev = seen.get(id);
    if (!prev) { seen.set(id, [sig(r)]); students.push(r); return; }
    if (prev.includes(sig(r))) { dupRemoved++; return; }
    prev.push(sig(r)); dupConflicts.add(id); students.push(r);
  });
  if (students.length === 0) throw new Error('لا يوجد طلاب بالملف');

  const choiceCounts = computeChoiceCounts(items, students.concat(detectedKeyRow ? [detectedKeyRow] : []), itemTypes);

  return {
    hasEssay: col.essay != null,
    textCoded,
    dupRemoved,
    dupConflicts: [...dupConflicts],
    itemCount: items.length,
    choiceCounts,
    itemTypes,
    students,
    detectedKeyRaw: detectedKeyRow ? detectedKeyRow.answers : null,
    detected: {
      subject: students.find(s => s.subject)?.subject || '',
      grade: mostCommon(students.map(s => s.grade).filter(Boolean)) || '',
    },
  };
}

// يبني مصفوفة المفتاح الرقمية الخام من اختيارات الحروف اللي دخّلها المدير يدويًا لكل سؤال
export function buildManualKey(letterSelections, choiceCounts, reversed = true) {
  return letterSelections.map((letter, i) => (Array.isArray(letter)
    ? collapseKey(letter.map(l => valueForLetter(l, choiceCounts[i], reversed)).filter(v => v != null))
    : valueForLetter(letter, choiceCounts[i], reversed)));
}

function mostCommon(arr) {
  const counts = new Map();
  arr.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null, bestN = 0;
  counts.forEach((n, v) => { if (n > bestN) { best = v; bestN = n; } });
  return best;
}

/* =========================================================================
 * حساب كل الإحصاءات المطلوبة للتقارير الستة، من بيانات مُحلَّلة (parseSheetRows)
 * ========================================================================= */
export function computeExamStats({ itemCount, keyRaw, choiceCounts, students, reversedOrder = true, itemTypes = [], points = null }) {
  const n = students.length;
  // درجة كل سؤال (افتراضيًا ١) والدرجة الكاملة
  const W = Array.from({ length: itemCount }, (_, i) => (Array.isArray(points) && Number.isFinite(+points[i]) && +points[i] >= 0 ? +points[i] : 1));
  const maxScore = W.reduce((a, b) => a + b, 0);
  const weighted = W.some(w => w !== 1);

  // كل طالب يتصحّح بمفتاح نموذجه (s.key) لو الاختبار بأكثر من نموذج، وإلا بالمفتاح العام
  const K = st => st.key || keyRaw;
  const isCorrectSt = (st, i) => keyHit(st.answers[i], K(st)[i]);
  const totals = students.map(st => {
    let t = 0;
    for (let i = 0; i < itemCount; i++) if (isCorrectSt(st, i)) t += W[i];
    return t;
  });

  const mean = totals.reduce((a, b) => a + b, 0) / n;
  const sorted = totals.slice().sort((a, b) => a - b);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const high = Math.max(...totals);
  const low = Math.min(...totals);
  const variance = totals.reduce((s, t) => s + (t - mean) * (t - mean), 0) / n;
  const sd = Math.sqrt(variance);
  const meanPct = maxScore ? (mean / maxScore) * 100 : 0;

  // ---- تقرير ١: التوزيع التكراري للصف (A-F) ----
  const gradeDistribution = GRADE_BANDS.map(b => {
    const rawMin = (b.min / 100) * maxScore;
    const rawMax = (b.max / 100) * maxScore;
    const freq = totals.filter(t => {
      const p = maxScore ? (t / maxScore) * 100 : 0;
      return p >= b.min && p <= b.max;
    }).length;
    return { grade: b.grade, pctMin: b.min, pctMax: b.max, rawMin, rawMax, freq, freqPct: n ? (freq / n) * 100 : 0 };
  });

  // ---- تقرير ٢: الرسم البياني لتقدير الطالب (10 فئات بالدرجة المئوية) ----
  const scoreHistogram = Array.from({ length: 10 }, (_, i) => ({ label: String((i + 1) * 10), count: 0 }));
  totals.forEach(t => {
    const p = maxScore ? (t / maxScore) * 100 : 0;
    const idx = Math.min(9, Math.floor(p / 10));
    scoreHistogram[idx].count++;
  });

  // ---- إحصاءات كل بند: نسبة الصواب، تكرارات كل اختيار، ثنائي التسلسل النقطي، أعلى/أدنى ٢٧٪ ----
  const k27 = Math.max(1, Math.round(n * 0.27));
  const sortedByTotalDesc = students.map((s, idx) => ({ idx, total: totals[idx] })).sort((a, b) => b.total - a.total);
  const upperSet = new Set(sortedByTotalDesc.slice(0, k27).map(x => x.idx));
  const lowerSet = new Set(sortedByTotalDesc.slice(-k27).map(x => x.idx));

  const itemStats = [];
  let mcqSeq = 0, tfSeq = 0;
  // أسئلة الصح والخطأ تنعرض «صح/خطأ» بدل أ/ب
  const TF_LABEL = { 'أ': 'صح', 'ب': 'خطأ' };
  const letterFor = (v, nc, rev) => { const l = letterForRaw(v, nc, rev); return itemTypes[curItem] === 'tf' && TF_LABEL[l] ? TF_LABEL[l] : l; };
  let curItem = 0;
  for (let i = 0; i < itemCount; i++) {
    curItem = i;
    const numChoices = choiceCounts[i];
    // لو الطلاب بنماذج إجابتها الصحيحة تختلف بهذا السؤال، الحروف ما تنقارن ببعض - نعرض صحيح/خطأ بس
    const keyVals = new Set(students.map(st => JSON.stringify(K(st)[i] ?? null)));
    const mixedKey = keyVals.size > 1;
    const correctLabels = mixedKey ? [] : keyLetters(students.length ? K(students[0])[i] : keyRaw[i], numChoices, reversedOrder)
      .map(l => (itemTypes[i] === 'tf' && TF_LABEL[l] ? TF_LABEL[l] : l));
    const correctLetter = mixedKey ? 'حسب النموذج' : correctLabels.join(' / ');
    const freqMap = new Map(); // key: label -> {count, isCorrect, sortVal}
    let correctCount = 0, notPresent = 0, multi = 0;
    students.forEach(st => {
      const v = st.answers[i];
      const ok = keyHit(v, K(st)[i]);
      let label, sortVal;
      if (v == null || v === -2) { label = 'لا توجد استجابة'; sortVal = 1000; notPresent++; }
      else if (v === -3) { label = 'متعدد'; sortVal = 999; multi++; }
      else if (typeof v === 'number' && v > 0) {
        if (mixedKey) { label = ok ? 'إجابة صحيحة' : 'إجابة خاطئة'; sortVal = ok ? 1 : 2; }
        else { label = letterFor(v, numChoices, reversedOrder); sortVal = v; }
      }
      else { label = 'لا توجد استجابة'; sortVal = 1000; notPresent++; }
      if (!freqMap.has(label)) freqMap.set(label, { label, count: 0, isCorrect: mixedKey ? label === 'إجابة صحيحة' : correctLabels.includes(label), sortVal });
      freqMap.get(label).count++;
      if (ok) correctCount++;
    });
    const choices = Array.from(freqMap.values())
      .sort((a, b) => a.sortVal - b.sortVal)
      .map(c => ({ ...c, pct: n ? (c.count / n) * 100 : 0 }));

    const correctPct = n ? (correctCount / n) * 100 : 0;
    const mask = students.map(st => (isCorrectSt(st, i) ? 1 : 0));
    const p = correctCount / n, q = 1 - p;
    const m1vals = [], m0vals = [];
    mask.forEach((m, si) => (m ? m1vals : m0vals).push(totals[si]));
    const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const m1 = avg(m1vals), m0 = avg(m0vals);
    const pointBiserial = sd > 0 ? ((m1 - m0) / sd) * Math.sqrt(p * q) : 0;

    let upperCorrect = 0, lowerCorrect = 0;
    students.forEach((st, si) => {
      if (upperSet.has(si) && isCorrectSt(st, i)) upperCorrect++;
      if (lowerSet.has(si) && isCorrectSt(st, i)) lowerCorrect++;
    });
    const upper27 = (upperCorrect / k27) * 100;
    const lower27 = (lowerCorrect / k27) * 100;

    const wrongChoices = mixedKey ? [] : choices.filter(c => !c.isCorrect && c.label !== 'لا توجد استجابة' && c.label !== 'متعدد');
    const topWrong = wrongChoices.reduce((best, c) => (!best || c.count > best.count ? c : best), null);
    const flagged = !!(topWrong && topWrong.count > correctCount);

    itemStats.push({
      num: i + 1,
      points: W[i],
      label: itemTypes[i] === 'tf' ? 'صح وخطأ' + (++tfSeq) : 'اختيار متعدد' + (++mcqSeq),
      correctLetter,
      correctCount, notPresent, multi,
      wrongCount: n - correctCount - notPresent - multi,
      correctPct, choices,
      pointBiserial, upper27, lower27, flagged, topWrong: topWrong ? topWrong.label : null,
    });
  }

  const sumPQ = itemStats.reduce((s, it) => {
    const p = it.correctCount / n;
    return s + p * (1 - p);
  }, 0);
  const kr20 = itemCount > 1 && variance > 0 ? (itemCount / (itemCount - 1)) * (1 - sumPQ / variance) : 0;
  const reliabilityBand = (RELIABILITY_BANDS.find(b => kr20 >= b.min && kr20 <= b.max) || RELIABILITY_BANDS[0]).label;

  const hardest = itemStats.slice().sort((a, b) => a.correctPct - b.correctPct).slice(0, Math.min(10, itemCount));
  const easiest = itemStats.slice().sort((a, b) => b.correctPct - a.correctPct).slice(0, Math.min(10, itemCount));
  const toReview = itemStats.filter(it => it.flagged);

  const lowestStudents = students.filter((s, idx) => totals[idx] === low).map(s => ({ id: s.id, name: s.name }));
  const highestStudents = students.filter((s, idx) => totals[idx] === high).map(s => ({ id: s.id, name: s.name }));

  // ---- أعلى ١٥ وأدنى ١٥ درجة (بالاسم والفصل) ----
  const ranked = students.map((s, idx) => ({
    id: s.id,
    name: s.name,
    section: s.section,
    total: totals[idx],
    pct: maxScore ? (totals[idx] / maxScore) * 100 : 0,
  })).sort((a, b) => b.total - a.total);
  const topStudents = ranked.slice(0, 15);
  // الطلاب الضعاف: أي طالب تحقيقه أقل من ٥٠٪ من الدرجة (مو رقم ثابت) - بالاسم، من الأدنى للأعلى
  const weakStudents = ranked.filter(r => r.pct < 50).slice().sort((a, b) => a.total - b.total);

  return {
    n, itemCount, maxScore, weighted, points: weighted ? W : null, mean, median, high, low, range: high - low, sd, meanPct, kr20, reliabilityBand,
    gradeDistribution, scoreHistogram, itemStats, hardest, easiest, toReview, lowestStudents, highestStudents,
    topStudents, weakStudents,
  };
}

/* =========================================================================
 * الاختبار بنموذجين (أ و ب): كل طالب يتصحّح بإجابة نموذجه. نموذج الطالب محفوظ مع مفتاح
 * الإجابة (model_map) برقم هويته وقت طباعة الأوراق، لأن ملف Remark ما فيه النموذج.
 * mode: 'choices' نفس الأسئلة والترتيب | 'order' نفس الأسئلة بترتيب مختلف (orderB[i] = رقم السؤال
 * المقابل بالنموذج أ) | 'different' أسئلة مختلفة (تحليل الأسئلة لكل نموذج لحاله)
 * ========================================================================= */
const MODEL_A = 'أ', MODEL_B = 'ب';
const MODE_LABELS = { choices: 'نفس الأسئلة والترتيب، الخيارات مختلفة', order: 'نفس الأسئلة بترتيب مختلف', different: 'أسئلة مختلفة' };
// مفتاح محفوظ (فهارس: 0 = أ) ← قيم خام بنفس ترميز ملف Remark
export function rawFromIdx(idxArr, choiceCounts, reversed) {
  return choiceCounts.map((c, i) => {
    const x = idxArr ? idxArr[i] : null;
    if (x == null) return null;
    if (Array.isArray(x)) return collapseKey(x.map(j => valueForLetter(ARABIC_LETTERS[j], c, reversed)).filter(v => v != null));
    return valueForLetter(ARABIC_LETTERS[x], c, reversed);
  });
}
// نموذج الطالب من تظليله بالورقة: نفس ترميز الأسئلة (عربي معكوس: ٢ = أ، ١ = ب)
// خانة النموذج بالملف: تقبل حرفًا (أ/ب، A/B، «نموذج أ») أو رقمًا (١/٢ بترميز Remark)
function parseModelCell(x) {
  if (x == null) return null;
  let t = String(x).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/^(النموذج|نموذج|form|version|model)\s*[:\-]?\s*/i, '').trim();
  if (!t) return null;
  if (/^(أ|ا|إ|آ|a)$/i.test(t)) return MODEL_A;
  if (/^(ب|b)$/i.test(t)) return MODEL_B;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function fileModel(st, reversed = true) {
  const v = st && st.modelRaw;
  if (v === MODEL_A || v === MODEL_B) return v;
  if (v !== 1 && v !== 2) return null;
  return reversed ? (v === 2 ? MODEL_A : MODEL_B) : (v === 1 ? MODEL_A : MODEL_B);
}
export function gradeWithModels({ parsed, keyA, keyB, mode, orderB, reversedOrder, modelOf, keyId }) {
  const n = parsed.itemCount;
  // بالترتيب المختلف: نرتّب إجابات طالب النموذج ب (ومفتاحه) على أرقام أسئلة النموذج أ
  const toA = arr => {
    if (mode !== 'order' || !Array.isArray(orderB)) return arr;
    const out = Array(n).fill(null);
    orderB.forEach((j, i) => { if (j != null && j < n) out[j] = arr[i]; });
    return out;
  };
  const keyBA = toA(keyB);
  const tagged = parsed.students.map(st => ({ ...st, model: modelOf(st) === MODEL_B ? MODEL_B : MODEL_A }));
  const graded = tagged.map(st => (st.model === MODEL_B ? { ...st, answers: toA(st.answers), key: keyBA } : { ...st, key: keyA }));
  const base = { itemCount: n, choiceCounts: parsed.choiceCounts, reversedOrder, itemTypes: parsed.itemTypes || [], points: parsed.points || null };
  const stats = computeExamStats({ ...base, keyRaw: keyA, students: graded });
  const byModel = {};
  [MODEL_A, MODEL_B].forEach(m => {
    const sub = graded.filter(st => st.model === m).map(({ key, ...rest }) => rest);
    if (sub.length) byModel[m] = computeExamStats({ ...base, keyRaw: m === MODEL_B ? keyBA : keyA, students: sub });
  });
  stats.models = { mode, counts: { [MODEL_A]: tagged.filter(st => st.model === MODEL_A).length, [MODEL_B]: tagged.filter(st => st.model === MODEL_B).length } };
  stats.itemsMixed = mode === 'different';
  stats.byModel = byModel;
  const raw_data = { students: tagged, choiceCounts: parsed.choiceCounts, itemTypes: parsed.itemTypes || [], reversedOrder, ...(parsed.points ? { points: parsed.points } : {}), models: { keyId: keyId || null, mode, keyA, keyB, orderB: orderB || null } };
  return { stats, raw_data, key_raw: keyA };
}

// ملف فيه عمود «النموذج»: الطالب الذي لم يظلّل نموذجه يُحدَّد يدويًا ولا يُؤخذ من توزيع الطباعة،
// لأن الأوراق قد تُوزَّع على الطلاب بترتيب يختلف عن ترتيب طباعتها
const fileHasModelCol = parsed => parsed.students.some(st => st.modelRaw != null);
function modelKeysRaw(parsed, rev) {
  const k = parsed.modelKey;
  return {
    A: rawFromIdx(alignKeyToFile(k, k.answers), parsed.choiceCounts, rev),
    B: rawFromIdx(alignKeyToFile(k, k.models.answers_b), parsed.choiceCounts, rev),
  };
}
// النموذج الأقرب لإجابات الطالب (عدد الإجابات المطابقة لكل مفتاح) - اقتراح فقط
function suggestModel(st, keys, mode) {
  if (mode !== 'choices') return null;
  const hits = key => (st.answers || []).reduce((n, v, i) => n + (key[i] != null && keyHit(v, key[i]) ? 1 : 0), 0);
  const a = hits(keys.A), b = hits(keys.B);
  return a === b ? null : { model: a > b ? MODEL_A : MODEL_B, a, b };
}
function renderModelSummary(parsed) {
  const k = parsed.modelKey;
  const map = k.model_map || {};
  const idOf = st => String(st.id || '').trim();
  const rev = document.getElementById('er-reversed-order').checked;
  const hasCol = fileHasModelCol(parsed);
  const picks = parsed.modelPicks || (parsed.modelPicks = {});
  const keys = modelKeysRaw(parsed, rev);
  const autoOf = st => fileModel(st, rev) || (hasCol ? null : map[idOf(st)]) || null;
  const unknown = parsed.students.filter(st => !autoOf(st));
  unknown.forEach(st => { const id = idOf(st); if (!picks[id]) { const sg = suggestModel(st, keys, k.models.mode); picks[id] = sg ? sg.model : MODEL_A; } });
  const mOf = st => autoOf(st) || picks[idOf(st)] || null;
  const a = parsed.students.filter(st => mOf(st) === MODEL_A).length;
  const b = parsed.students.filter(st => mOf(st) === MODEL_B).length;
  const fromFile = parsed.students.filter(st => fileModel(st, rev)).length;
  const el = document.getElementById('er-key-form');
  el.innerHTML = `<div class="er-models-sum">
    <div class="er-models-h"><b>اختبار بنموذجين</b><span>${esc(MODE_LABELS[k.models.mode] || '')}</span></div>
    <div class="dd-stats" style="margin:8px 0;">
      <span class="ds ds-all"><b>${a}</b> نموذج أ</span>
      <span class="ds ds-present"><b>${b}</b> نموذج ب</span>
      ${unknown.length ? `<span class="ds ds-late"><b>${unknown.length}</b> حُدِّد نموذجهم يدويًا</span>` : ''}
    </div>
    <p class="er-models-p">${fromFile ? `نموذج ${fromFile} طالب مقروء من تظليلهم بالورقة. ` : ''}يُصحَّح كل طالب تلقائيًا وفق مفتاح نموذجه. لتعديل الإجابات: عدّل المفتاح من "ورقة إجابة للتصحيح الآلي" واحفظه.</p>
    ${unknown.length ? `<div class="er-unknown"><p>⚠ لم يظلّل هؤلاء الطلاب النموذج (أو ظلّلوا النموذجين) - حدّد نموذج كل طالب. الاختيار المبدئي هو النموذج الأقرب لإجاباته:</p>
      ${unknown.map(st => {
        const id = idOf(st); const sg = suggestModel(st, keys, k.models.mode); const cur = picks[id];
        return `<div class="er-unk-row"><span>${esc(st.name || st.id)}</span><small>${esc(st.id)}</small>
          ${sg ? `<em class="er-unk-hint" title="عدد الإجابات المطابقة لكل مفتاح">أ: ${sg.a} · ب: ${sg.b}</em>` : ''}
          <span class="er-mpick" data-id="${esc(id)}">${[MODEL_A, MODEL_B].map(m => `<button type="button" class="${cur === m ? 'on' : ''}" data-m="${m}" title="نموذج ${m}">${m}</button>`).join('')}</span></div>`;
      }).join('')}</div>` : ''}
  </div>`;
  el.querySelectorAll('.er-mpick button').forEach(btn => btn.addEventListener('click', () => {
    picks[btn.parentElement.dataset.id] = btn.dataset.m;
    renderModelSummary(parsed);
  }));
}

/* =========================================================================
 * واجهة الرفع والتحليل
 * ========================================================================= */
let parsedData = null; // { itemCount, choiceCounts, students, detectedKeyRaw, detected }
let currentReport = null; // آخر تقرير محفوظ تم فتحه بشاشة التفاصيل

const isTeacherView = () => !!(currentProfile && currentProfile.role === 'teacher');
export async function loadExamReportsModule(sub = null) {
  document.getElementById('er-detail-view').classList.add('hidden');
  document.getElementById('er-list-view').classList.remove('hidden');
  document.getElementById('er-preview-card').classList.add('hidden');
  document.getElementById('er-upload-card').classList.add('hidden');
  document.getElementById('er-file').value = '';
  parsedData = null;
  // المعلم: التصحيح بالجوال وتقاريره هو بس (بدون تصميم الأوراق ورفع ملفات Remark)
  document.getElementById('exam-reports-module').classList.toggle('er-teacher', isTeacherView());
  initAnswerSheetCard();
  if (sub === 'sheet') { setMode('sheet', false); loadSavedList(); return; }
  if (sub === 'camera') { setMode('camera', false); loadSavedList(); return; }
  if (sub === 'paper') { setMode('paper', false); loadSavedList(); return; }
  setMode('reports', false);
  const n = await loadSavedList();
  if (sub && sub !== 'reports') openReport(sub);
  else if (isTeacherView() && !n) setMode('camera', false);
}

/* ---------- التصحيح بالجوال (ملف منفصل يتحمّل عند الحاجة) ---------- */
let cameraKeyId = null;
async function openCameraMode() {
  const { openOmrPanel } = await import('./omr-scan.js?v=' + ASSET_VERSION);
  openOmrPanel({ keyId: cameraKeyId, openReport: id => { setMode('reports', false); openReport(id); } });
  cameraKeyId = null;
}

/* ---------- وضعين: التقارير / ورقة الإجابة والمفتاح ---------- */
function setMode(mode, route = true) {
  document.querySelectorAll('#er-mode-tabs button').forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.getElementById('er-mode-reports').classList.toggle('hidden', mode !== 'reports');
  document.getElementById('er-mode-sheet').classList.toggle('hidden', mode !== 'sheet');
  document.getElementById('er-mode-camera').classList.toggle('hidden', mode !== 'camera');
  document.getElementById('er-mode-paper').classList.toggle('hidden', mode !== 'paper');
  if (mode === 'paper') import('./question-paper.js?v=' + ASSET_VERSION).then(m => m.openQuestionPapers());
  if (mode === 'sheet' && document.getElementById('as-body').classList.contains('hidden')) document.getElementById('as-toggle-btn').click();
  if (mode === 'camera') openCameraMode();
  if (mode === 'reports' && route) loadSavedList();
  if (route) setSubRoute(mode === 'reports' ? null : mode, true);
}
function openUpload(open = true) {
  const card = document.getElementById('er-upload-card');
  card.classList.toggle('hidden', !open);
  document.getElementById('er-upload-toggle').textContent = open ? 'إلغاء' : '+ رفع نتائج اختبار';
  document.getElementById('er-upload-toggle').classList.toggle('btn-secondary', open);
  if (open) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.querySelectorAll('#er-mode-tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.getElementById('er-upload-toggle').addEventListener('click', () => openUpload(document.getElementById('er-upload-card').classList.contains('hidden')));
document.querySelectorAll('.er-flow-step').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === 'upload') { setMode('reports'); openUpload(true); }
  else setMode('sheet');
}));

// يكمّل اسم الطالب وصفه وفصله من طلاب المنصة برقم الهوية (لو Remark ما لقاه بقاعدة بياناته)
async function enrichFromPlatform(parsed) {
  const { studentsById } = await import('./students-cache.js?v=' + ASSET_VERSION);
  let found = new Map();
  try { found = await studentsById(); } catch (e) { /* بدون تكميل */ }
  let filled = 0; const unknown = []; const fixedIds = [];
  // رقم هوية انقرأ غلط من الباركود (رقم زايد/ناقص/مختلف): لو فيه طالب واحد بس بالمنصة
  // رقمه يختلف بخانة وحدة وما له ورقة بالملف، نصحح الرقم له
  const inFile = new Set(parsed.students.map(s => String(s.id || '').trim()));
  const oneEdit = (a, b) => {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return d === 1; }
    const [l, sh] = a.length > b.length ? [a, b] : [b, a];
    for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === sh) return true;
    return false;
  };
  parsed.students.forEach(s => {
    const id = String(s.id || '').trim();
    if (!id || found.has(id) || !/^\d{8,12}$/.test(id)) return;
    const cands = [...found.keys()].filter(k => !inFile.has(k) && oneEdit(id, k));
    if (cands.length === 1) { fixedIds.push(id + ' ← ' + cands[0]); s.id = cands[0]; inFile.add(cands[0]); }
  });
  parsed.students.forEach(s => {
    const r = found.get(String(s.id || '').trim());
    if (!r) { if (!s.name) unknown.push(s.id || '—'); return; }
    let changed = false;
    if (!s.name && r.full_name) { s.name = r.full_name; changed = true; }
    if (!s.grade && r.grade_level) { s.grade = gradeLabels[r.grade_level] || r.grade_level; changed = true; }
    if (!s.section && r.class_section) { s.section = String(r.class_section); changed = true; }
    if (changed) filled++;
  });
  if (!parsed.detected.grade) parsed.detected.grade = mostCommon(parsed.students.map(s => s.grade).filter(Boolean)) || '';
  return { filled, unknown, fixedIds };
}

let skipPaperOnce = false;
document.getElementById('er-analyze-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('er-analyze-error');
  errEl.style.display = 'none';
  const file = document.getElementById('er-file').files[0];
  if (!file) { errEl.textContent = 'اختر ملف إكسل أولًا'; errEl.style.display = 'block'; return; }

  try {
    await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    let rows = [];
    wb.SheetNames.forEach(name => {
      const sheet = wb.Sheets[name];
      rows = rows.concat(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }));
    });
    parsedData = parseSheetRows(rows);
    const { applyPaperToParsed } = await import('./question-paper.js?v=' + ASSET_VERSION);
    const paperRes = await applyPaperToParsed(parsedData, { skip: skipPaperOnce });
    skipPaperOnce = false;
    const enr = await enrichFromPlatform(parsedData);

    const keyNote = paperRes
      ? ` — ورقة أسئلة «${esc(paperRes.paper.title)}»: يُصحَّح كل طالب وفق نموذجه، والمفتاح مأخوذ من الورقة`
      : parsedData.detectedKeyRaw
      ? ' — عُثر في الملف على صف نموذج جاهز وعُبّئت الإجابات منه، راجعها أو عدّلها أدناه'
      : ' — أدخل الإجابة الصحيحة لكل سؤال بالأسفل';
    document.getElementById('er-preview-summary').innerHTML =
      `تم العثور على <strong>${parsedData.students.length}</strong> طالب، و<strong>${parsedData.itemCount}</strong> سؤال${keyNote}`
      + (enr.filled ? `<br><span style="color:#1F6A3C;">✓ اكتملت بيانات ${enr.filled} ${enr.filled === 1 ? 'طالب' : 'طلاب'} (الاسم/الصف/الفصل) من طلاب المنصة برقم الهوية</span>` : '')
      + (enr.fixedIds && enr.fixedIds.length ? `<br><span style="color:#1F6A3C;">✓ صححت ${enr.fixedIds.length === 1 ? 'رقم هوية قُرئ خطأً من الباركود' : enr.fixedIds.length + ' أرقام هوية قُرئت خطأً من الباركود'}: ${enr.fixedIds.map(esc).join('، ')}</span>` : '')
      + (paperRes && paperRes.unknown.length ? `<br><span style="color:#A4501A;">⚠ ${paperRes.unknown.length} ورقة لم ترتبط بطالب (لم تُطبع له من المنصة أو تغيّرت الورقة بعد الطباعة): ${paperRes.unknown.slice(0, 5).map(esc).join('، ')}</span>` : '')
      + (paperRes && paperRes.missingPages.length ? `<br><span style="color:#A4501A;">⚠ ${paperRes.missingPages.length} طالب تنقصهم صفحة أو أكثر في الملف (تُحتسب أسئلتها بلا إجابة): ${paperRes.missingPages.slice(0, 5).map(esc).join('، ')}${paperRes.missingPages.length > 5 ? '...' : ''}</span>` : '')
      + (parsedData.dupRemoved ? `<br><span style="color:#A4501A;">⚠ ${parsedData.dupRemoved} ${parsedData.dupRemoved === 1 ? 'ورقة مكررة' : 'أوراق مكررة'} في الملف (نفس الطالب بنفس الإجابات) - احتُسبت مرة واحدة</span>` : '')
      + (parsedData.dupConflicts && parsedData.dupConflicts.length ? `<br><span style="color:#B42318;">⚠ ${parsedData.dupConflicts.length} ${parsedData.dupConflicts.length === 1 ? 'طالب له' : 'طلاب لهم'} أكثر من ورقة بإجابات مختلفة - راجعهم قبل الحفظ: ${parsedData.dupConflicts.slice(0, 5).map(esc).join('، ')}${parsedData.dupConflicts.length > 5 ? '...' : ''}</span>` : '')
      + (enr.unknown.length ? `<br><span style="color:#A4501A;">⚠ ${enr.unknown.length} ${enr.unknown.length === 1 ? 'رقم هوية' : 'أرقام هوية'} غير موجودة ضمن طلاب المنصة: ${enr.unknown.slice(0, 5).map(esc).join('، ')}${enr.unknown.length > 5 ? '...' : ''}</span>` : '');
    document.getElementById('er-title').value = '';
    await fillUploadSelects();
    setSelectValue('er-subject', canonSubject(parsedData.detected.subject));
    setSelectValue('er-grade', canonGrade(parsedData.detected.grade));
    document.getElementById('er-semester').value = '';
    const revEl = document.getElementById('er-reversed-order');
    revEl.checked = parsedData.textCoded || paperRes ? false : guessReversedOrder(parsedData.detected.subject);
    revEl.disabled = !!parsedData.textCoded || !!paperRes;
    renderKeyForm(parsedData, document.getElementById('er-reversed-order').checked);
    if (paperRes) {
      if (!document.getElementById('er-title').value.trim()) document.getElementById('er-title').value = paperRes.paper.title || '';
      if (paperRes.paper.subject) setSelectValue('er-subject', canonSubject(paperRes.paper.subject));
      if (paperRes.paper.grade_level) setSelectValue('er-grade', canonGrade(gradeLabels[paperRes.paper.grade_level] || paperRes.paper.grade_level));
      const ks = document.getElementById('er-saved-key');
      ks.innerHTML = `<option value="">ورقة الأسئلة: ${esc(paperRes.paper.title)}</option>`;
      ks.disabled = true;
      const km = document.getElementById('er-saved-key-msg');
      km.innerHTML = 'المفتاح مأخوذ من ورقة الأسئلة ✓ راجعه واضغط «حفظ التقرير». <button type="button" id="er-not-paper" class="link-btn" style="color:var(--danger); text-decoration:underline; background:none; border:0; cursor:pointer; padding:0;">ليس هذا الملف لورقة الأسئلة؟ استخدم مفتاح إجابة</button>';
      document.getElementById('er-not-paper').addEventListener('click', () => { skipPaperOnce = true; document.getElementById('er-analyze-btn').click(); });
    } else {
      document.getElementById('er-saved-key').disabled = false;
      await setupSavedKeyPicker(parsedData);
    }
    document.getElementById('er-preview-card').classList.remove('hidden');
    document.getElementById('er-preview-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    errEl.textContent = e.message || 'تعذر تحليل الملف';
    errEl.style.display = 'block';
  }
});

// يبني نموذج اختيار الإجابة الصحيحة لكل سؤال - قائمة منسدلة بعدد اختيارات ذلك السؤال بالضبط،
// معبّاة مبدئيًا من صف النموذج لو انلقى بالملف. تُعاد كل مرة يتغيّر فيها خيار "ترتيب الاختيارات"
// عشان الحروف المعروضة/المعبّأة تطابق الاتجاه المختار
// اختيار الإجابة الصحيحة بأزرار الحروف. مع «السماح بأكثر من إجابة» يقبل السؤال أكثر من حرف
function keyPickHtml(i, numChoices, isTf, sel) {
  return `<div class="er-kp" data-item="${i}">${ARABIC_LETTERS.slice(0, numChoices).map(o => `<button type="button" data-l="${o}" class="${sel.includes(o) ? 'on' : ''}">${isTf ? ({ 'أ': 'صح', 'ب': 'خطأ' }[o] || o) : o}</button>`).join('')}</div>`;
}
const multiToggleHtml = on => `<label class="er-multi-lbl"><input type="checkbox" class="er-multi-on"${on ? ' checked' : ''} /> السماح بأكثر من إجابة صحيحة للسؤال (اضغط كل الحروف المقبولة)</label>`;
function readKeyPick(container) {
  return [...container.querySelectorAll('.er-kp')].map(box => { const ls = [...box.querySelectorAll('button.on')].map(b => b.dataset.l); return ls.length > 1 ? ls : (ls[0] || ''); });
}
function setKeyPick(container, lettersPerItem) {
  container.querySelectorAll('.er-kp').forEach((box, i) => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', (lettersPerItem[i] || []).includes(b.dataset.l))));
}
['er-key-form', 'er-editkey-form'].forEach(id => {
  const c = document.getElementById(id);
  if (!c) return;
  c.addEventListener('click', e => {
    const b = e.target.closest('.er-kp button');
    if (!b) return;
    const multi = c.querySelector('.er-multi-on');
    if (multi && multi.checked) { b.classList.toggle('on'); return; }
    const was = b.classList.contains('on');
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    if (!was) b.classList.add('on');
  });
});
function renderKeyForm(parsed, reversed = true) {
  if (parsed.modelKey) { renderModelSummary(parsed); return; }
  const el = document.getElementById('er-key-form');
  const pre = parsed.choiceCounts.map((numChoices, i) => {
    const p = parsed.presetLetters ? parsed.presetLetters[i]
      : (parsed.detectedKeyRaw ? letterFor(parsed.detectedKeyRaw[i], numChoices, reversed) : null);
    return p == null ? [] : Array.isArray(p) ? p : [p];
  });
  el.innerHTML = multiToggleHtml(pre.some(p => p.length > 1)) + `<div class="er-key-grid">${parsed.choiceCounts.map((numChoices, i) => `<div class="er-key-item">
      <label>سؤال ${i + 1}</label>
      ${keyPickHtml(i, numChoices, (parsed.itemTypes || [])[i] === 'tf', pre[i])}
    </div>`).join('')}</div>`;
}

/* ===== تطبيق مفتاح محفوظ (من بطاقة ورقة الإجابة) على الملف المرفوع =====
 * نختار تلقائيًا المفتاح اللي عدد أسئلته = عدد أسئلة الملف، والأقرب بالمادة/المرحلة. والمفتاح
 * المحفوظ يحدد كمان عدد الخيارات الفعلي لكل سؤال (بدل تخمينه من إجابات الطلاب) واتجاه الحروف. */
let erSavedKeys = [];
function normAr(s) { return String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim(); }

async function setupSavedKeyPicker(parsed) {
  const sel = document.getElementById('er-saved-key');
  const msg = document.getElementById('er-saved-key-msg');
  parsed._origChoiceCounts = parsed.choiceCounts.slice();
  const { data, error } = await fetchSavedKeys();
  erSavedKeys = data;
  if (error) { sel.innerHTML = '<option value="">—</option>'; msg.textContent = error; return; }
  const subj = normAr(parsed.detected.subject);
  const scored = erSavedKeys.map(k => {
    let score = 0;
    if (subj && k.subject && (normAr(k.subject).includes(subj) || subj.includes(normAr(k.subject)))) score += 2;
    if (subj && normAr(k.title).includes(subj)) score += 1;
    return { k, score, match: k.questions === parsed.itemCount };
  }).sort((a, b) => (b.match - a.match) || (b.score - a.score));
  const matches = scored.filter(x => x.match);
  const others = scored.filter(x => !x.match);
  sel.innerHTML = '<option value="">بدون - إدخال المفتاح يدويًا</option>' +
    (matches.length ? `<optgroup label="مطابقة لعدد أسئلة الملف (${parsed.itemCount})">${matches.map(x => `<option value="${x.k.id}">${esc(x.k.title)}${x.k.subject ? ' — ' + esc(x.k.subject) : ''}</option>`).join('')}</optgroup>` : '') +
    (others.length ? `<optgroup label="عدد أسئلة مختلف">${others.map(x => `<option value="${x.k.id}" disabled>${esc(x.k.title)} (${x.k.questions} سؤال)</option>`).join('')}</optgroup>` : '');
  if (matches.length) {
    sel.value = matches[0].k.id;
    applySavedKey(matches[0].k);
    if (matches.length > 1) msg.textContent += ` (يوجد ${matches.length} مفاتيح بنفس عدد الأسئلة - تأكد إنه الصحيح)`;
  } else {
    msg.textContent = erSavedKeys.length
      ? `لا يوجد مفتاح محفوظ بعدد أسئلة الملف نفسه (${parsed.itemCount}) - أدخل المفتاح يدويًا أو احفظه من بطاقة ورقة الإجابة`
      : 'لا توجد مفاتيح محفوظة بعد - يمكنك حفظها من بطاقة "ورقة إجابة للتصحيح الآلي"';
  }
}

// إجابات المفتاح بترتيب أعمدة الملف: لو الملف يرتب الاختيار المتعدد والصح والخطأ بترتيب غير
// ترتيب المفتاح (مثلاً المفتاح الصح والخطأ أول والملف آخر)، نوزّع إجابات كل نوع على أعمدته بالترتيب
function alignKeyToFile(k, arr) {
  if (!k || !k.tf_count || !parsedData || k.questions !== parsedData.itemCount) return arr;
  const fileKinds = parsedData._origItemTypes || parsedData.itemTypes || [];
  if (fileKinds.filter(t => t === 'tf').length !== k.tf_count) return arr;
  const keyKinds = itemKinds({ questions: k.questions, tf: k.tf_count, tfFirst: k.tf_first !== false });
  const byKind = { tf: [], mcq: [] };
  keyKinds.forEach((t, i) => byKind[t === 'tf' ? 'tf' : 'mcq'].push(arr[i]));
  const ptr = { tf: 0, mcq: 0 };
  return fileKinds.map(t => { const kk = t === 'tf' ? 'tf' : 'mcq'; return byKind[kk][ptr[kk]++]; });
}

function applySavedKey(k) {
  if (!parsedData) return;
  const msg = document.getElementById('er-saved-key-msg');
  delete parsedData.modelPicks;
  if (k && k.models && k.models.mode) parsedData.modelKey = k; else delete parsedData.modelKey;
  if (!k) {
    delete parsedData.presetLetters;
    parsedData.essayMax = null;
    parsedData.points = null;
    if (parsedData._origItemTypes) parsedData.itemTypes = parsedData._origItemTypes.slice();
    parsedData.choiceCounts = parsedData._origChoiceCounts.slice();
    msg.textContent = '';
    renderKeyForm(parsedData, document.getElementById('er-reversed-order').checked);
    return;
  }
  parsedData.essayMax = Number(k.essay_total) || null;
  parsedData.points = Array.isArray(k.points) && k.points.length === parsedData.itemCount ? alignKeyToFile(k, k.points) : null;
  parsedData.presetLetters = alignKeyToFile(k, k.answers || []).map(i => (i == null ? null : Array.isArray(i) ? i.map(j => ARABIC_LETTERS[j]) : ARABIC_LETTERS[i]));
  // مفتاح فيه أسئلة صح وخطأ: نوع كل سؤال وعدد خياراته من المفتاح نفسه
  if (!parsedData._origItemTypes) parsedData._origItemTypes = (parsedData.itemTypes || []).slice();
  if (k.tf_count && k.questions === parsedData.itemCount) {
    const fileKinds = parsedData._origItemTypes;
    const kinds = fileKinds.filter(t => t === 'tf').length === k.tf_count ? fileKinds.slice()
      : itemKinds({ questions: k.questions, tf: k.tf_count, tfFirst: k.tf_first !== false });
    parsedData.itemTypes = kinds;
    parsedData.choiceCounts = kinds.map(t => (t === 'tf' ? 2 : k.choices));
  } else {
    parsedData.itemTypes = parsedData._origItemTypes.slice();
    parsedData.choiceCounts = parsedData._origChoiceCounts.map((c, i) => (parsedData.itemTypes[i] === 'tf' ? c : k.choices));
  }
  const observedMax = Math.max(0, ...parsedData.students.flatMap(st => st.answers.filter(v => typeof v === 'number')));
  document.getElementById('er-reversed-order').checked = parsedData.textCoded ? false : k.lang !== 'en';
  if (!document.getElementById('er-title').value.trim()) document.getElementById('er-title').value = k.title || '';
  if (!document.getElementById('er-subject').value.trim() && k.subject) setSelectValue('er-subject', canonSubject(k.subject));
  if (!document.getElementById('er-grade').value.trim() && k.grade_level) setSelectValue('er-grade', canonGrade(k.grade_level));
  renderKeyForm(parsedData, document.getElementById('er-reversed-order').checked);
  msg.textContent = `تم تطبيق المفتاح "${k.title}" ✓ راجع الإجابات واضغط "حفظ التقرير"`;
  if (observedMax > k.choices) msg.textContent += ` — تنبيه: بالملف قيم أكبر من عدد الخيارات بالمفتاح (${k.choices})، تأكد من أن الملف للاختبار نفسه`;
}

document.getElementById('er-saved-key').addEventListener('change', (e) => {
  applySavedKey(erSavedKeys.find(k => k.id === e.target.value) || null);
});

document.getElementById('er-reversed-order').addEventListener('change', (e) => {
  if (!parsedData) return;
  renderKeyForm(parsedData, e.target.checked);
});

document.getElementById('er-cancel-btn').addEventListener('click', () => {
  parsedData = null;
  document.getElementById('er-preview-card').classList.add('hidden');
  document.getElementById('er-file').value = '';
});

document.getElementById('er-save-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('er-save-error');
  errEl.style.display = 'none';
  if (!parsedData) { errEl.textContent = 'حلّل الملف أولًا'; errEl.style.display = 'block'; return; }
  const title = document.getElementById('er-title').value.trim();
  if (!title) { errEl.textContent = 'اكتب عنوانًا للتقرير'; errEl.style.display = 'block'; return; }
  if (!document.getElementById('er-subject').value || !document.getElementById('er-grade').value) { errEl.textContent = 'اختر المادة والمرحلة لتنظيم التقرير في قائمة التقارير'; errEl.style.display = 'block'; return; }
  if (!confirmNoDuplicate(document.getElementById('er-subject').value, document.getElementById('er-grade').value)) return;

  if (parsedData.modelKey) {
    const k = parsedData.modelKey;
    const map = k.model_map || {};
    const picks = parsedData.modelPicks || {};
    const hasCol = fileHasModelCol(parsedData);
    const reversedOrder = document.getElementById('er-reversed-order').checked;
    const g = gradeWithModels({
      parsed: parsedData,
      keyA: rawFromIdx(alignKeyToFile(k, k.answers), parsedData.choiceCounts, reversedOrder),
      keyB: rawFromIdx(alignKeyToFile(k, k.models.answers_b), parsedData.choiceCounts, reversedOrder),
      mode: k.models.mode, orderB: k.models.order_b, reversedOrder, keyId: k.id,
      modelOf: st => { const id = String(st.id || '').trim(); return fileModel(st, reversedOrder) || (hasCol ? null : map[id]) || picks[id] || MODEL_A; },
    });
    g.raw_data.essayMax = essayMaxOf(parsedData);
    g.raw_data.hasEssay = !!parsedData.hasEssay;
    const { error } = await insertReport({
      title,
      subject_name: canonSubject(document.getElementById('er-subject').value) || null,
      grade_level: canonGrade(document.getElementById('er-grade').value) || null,
      semester: document.getElementById('er-semester').value || null,
      item_count: parsedData.itemCount,
      students_count: parsedData.students.length,
      key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data,
      created_by: currentUserId,
    });
    if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }
    parsedData = null;
    document.getElementById('er-preview-card').classList.add('hidden');
    document.getElementById('er-file').value = '';
    openUpload(false);
    await loadSavedList();
    return;
  }

  const letterSelections = readKeyPick(document.getElementById('er-key-form'));
  if (letterSelections.some(v => !v || !v.length)) {
    errEl.textContent = 'اختر الإجابة الصحيحة لكل سؤال قبل الحفظ';
    errEl.style.display = 'block';
    return;
  }
  const reversedOrder = document.getElementById('er-reversed-order').checked;
  const keyRaw = buildManualKey(letterSelections, parsedData.choiceCounts, reversedOrder);

  const stats = computeExamStats({ ...parsedData, keyRaw, reversedOrder });
  const { error } = await insertReport({
    title,
    subject_name: canonSubject(document.getElementById('er-subject').value) || null,
    grade_level: canonGrade(document.getElementById('er-grade').value) || null,
    semester: document.getElementById('er-semester').value || null,
    item_count: parsedData.itemCount,
    students_count: parsedData.students.length,
    key_raw: keyRaw,
    stats,
    // نحفظ إجابات الطلاب الخام كمان (مو بس النتيجة المحسوبة) عشان لو المدير احتاج يعدّل
    // مفتاح الإجابة بعدين نقدر نعيد الحساب بدون ما يرفع نفس الملف مرة ثانية - وكذلك اتجاه
    // ترميز الاختيارات المستخدم عشان تعديل المفتاح لاحقًا يفهم نفس الحروف صح
    raw_data: { students: parsedData.students, choiceCounts: parsedData.choiceCounts, itemTypes: parsedData.itemTypes, reversedOrder, essayMax: essayMaxOf(parsedData), hasEssay: !!parsedData.hasEssay, ...(parsedData.paper ? { paper: parsedData.paper } : {}), ...(parsedData.points ? { points: parsedData.points } : {}) },
    created_by: currentUserId,
  });
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  parsedData = null;
  document.getElementById('er-preview-card').classList.add('hidden');
  document.getElementById('er-file').value = '';
  openUpload(false);
  await loadSavedList();
});

// درجة المقالي العظمى: من المفتاح المحفوظ، وإلا أعلى درجة بالملف
function essayMaxOf(parsed) {
  if (!parsed.hasEssay) return null;
  if (parsed.essayMax) return parsed.essayMax;
  const vals = parsed.students.map(s => s.essay).filter(v => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}
// حفظ تقرير مع نوع الاختبار (تشخيصي/فتري) - لو عمود exam_type ما انضاف بقاعدة البيانات نحفظ بدونه
async function insertReport(row) {
  const exam_type = document.getElementById('er-type') ? document.getElementById('er-type').value : 'diagnostic';
  let res = await writeWithSchool(extra => sb.from('exam_reports').insert({ ...row, exam_type, ...extra }));
  if (res.error && /exam_type/i.test(res.error.message || '')) res = await writeWithSchool(extra => sb.from('exam_reports').insert({ ...row, ...extra }));
  return res;
}

/* ===== توحيد اسم المادة والمرحلة: «English» و«انجليزي» = «اللغة الإنجليزية»، «الثالث المتوسط» = «ثالث متوسط» ===== */
const SUBJECTS_FALLBACK = ['التربية البدنية', 'التربية الفنية', 'التفكير الناقد', 'الدراسات الإسلامية', 'الدراسات الاجتماعية', 'الرياضيات', 'العلوم', 'اللغة الإنجليزية', 'اللغة العربية', 'المهارات الحياتية والأسرية', 'المهارات الرقمية'];
let subjectNames = null;
async function loadSubjectNames() {
  if (subjectNames) return subjectNames;
  try {
    const { data } = await sb.from('subjects').select('name');
    subjectNames = [...new Set((data || []).map(x => x.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  } catch { /* نستخدم القائمة الافتراضية */ }
  if (!subjectNames || !subjectNames.length) subjectNames = SUBJECTS_FALLBACK.slice();
  return subjectNames;
}
function subjScore(a, b) {
  const x = normSubj(String(a).toLowerCase()), y = normSubj(String(b).toLowerCase());
  if (!x || !y) return 0;
  if (x === y) return 100;
  const tx = x.split(' '), ty = y.split(' ');
  let sc = tx.filter(w => w.length >= 3 && ty.includes(w)).length * 10;
  if (!sc && subjectMatches(String(a).toLowerCase(), String(b).toLowerCase())) sc = 5;
  return sc;
}
export function canonSubject(t) {
  const v = String(t || '').trim();
  if (!v) return '';
  let best = null, bestSc = 0;
  (subjectNames || SUBJECTS_FALLBACK).forEach(n => { const sc = subjScore(v, n); if (sc > bestSc) { best = n; bestSc = sc; } });
  return best || v;
}
export function canonGrade(t) {
  const g = gradeFromText(t);
  return g ? gradeLabels[g] : String(t || '').trim();
}
// قوائم المادة والمرحلة في نموذج الرفع: تختار القيمة الموحّدة (وتضيفها لو غير موجودة)
function setSelectValue(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  if (v && ![...el.options].some(o => o.value === v)) el.add(new Option(v, v));
  el.value = v || '';
}
async function fillUploadSelects() {
  const names = await loadSubjectNames();
  const sj = document.getElementById('er-subject');
  if (sj && sj.tagName === 'SELECT' && sj.options.length <= 1) names.forEach(n => sj.add(new Option(n, n)));
  const gr = document.getElementById('er-grade');
  if (gr && gr.tagName === 'SELECT' && gr.options.length <= 1) Object.values(gradeLabels).forEach(n => gr.add(new Option(n, n)));
}
// تقرير موجود لنفس المادة والمرحلة والنوع والفصل الدراسي: ننبّه قبل إنشاء تقرير ثانٍ
function confirmNoDuplicate(subject, grade) {
  const type = document.getElementById('er-type') ? document.getElementById('er-type').value : 'diagnostic';
  const sem = document.getElementById('er-semester').value || '';
  const sj = canonSubject(subject), g = gradeFromText(grade);
  if (!sj || !g) return true;
  const dup = erListData.find(r => canonSubject(r.subject_name) === sj && repGradeKey(r) === g && (r.exam_type || 'diagnostic') === type && (r.semester || '') === sem);
  if (!dup) return true;
  return confirm(`يوجد تقرير محفوظ لنفس المادة والمرحلة: «${dup.title}» (${dup.students_count || 0} طالب).\n\nإذا كان الملف الجديد لطلاب إضافيين من نفس الاختبار، فالأفضل فتح ذلك التقرير واستخدام «إضافة طلاب من ملف».\n\nهل تريد إنشاء تقرير جديد مستقل؟`);
}

async function loadSavedList() {
  const listEl = document.getElementById('er-saved-list');
  const res = await readScopedBySchool(scoped => {
    let q = sb.from('exam_reports')
      .select('id, title, subject_name, grade_level, semester, item_count, students_count, created_at, created_by, source, exam_type');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('created_at', { ascending: false });
  });
  let data = res.data, error = res.error;
  if (error && /exam_type/i.test(error.message || '')) {
    const r1 = await readScopedBySchool(scoped => {
      let q = sb.from('exam_reports').select('id, title, subject_name, grade_level, semester, item_count, students_count, created_at, created_by, source');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('created_at', { ascending: false });
    });
    data = r1.data; error = r1.error;
  }
  if (error && /source/i.test(error.message || '')) {
    // قبل تشغيل ملف sql/omr_camera.sql
    const r2 = await readScopedBySchool(scoped => {
      let q = sb.from('exam_reports').select('id, title, subject_name, grade_level, semester, item_count, students_count, created_at, created_by');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('created_at', { ascending: false });
    });
    data = r2.data; error = r2.error;
  }
  if (error) { listEl.innerHTML = '<p style="color:var(--danger); font-size:12.5px;">تعذر تحميل التقارير</p>'; return 0; }
  // المعلم: تقاريره + تقارير مواده وصفوفه
  if (isTeacherView()) {
    const { myTeachingScope, subjectMatches, gradeFromText } = await import('./teacher-scope.js?v=' + ASSET_VERSION);
    const sc = await myTeachingScope();
    data = (data || []).filter(r => {
      if (r.created_by === currentUserId) return true;
      if (!sc.subjects.length) return false;
      if (!sc.subjects.some(sj => subjectMatches(r.subject_name || r.title, sj) || subjectMatches(r.title, sj))) return false;
      const g = gradeFromText(r.grade_level) || gradeFromText(r.title);
      return !g || sc.grades.has(g);
    });
  }
  erListData = data || [];
  if (!data || data.length === 0) {
    const fb = document.getElementById('er-filters'); if (fb) fb.innerHTML = '';
    listEl.innerHTML = isTeacherView()
      ? '<div class="ex-empty"><b>لا توجد تقارير لك بعد</b><span>صحّح أوراق طلابك من تبويب «التصحيح بالجوال»، وسيظهر التقرير هنا تلقائيًا.</span></div>'
      : '<div class="ex-empty"><b>لا توجد تقارير محفوظة بعد</b><span>صحّح أوراق الطلاب في Remark، ثم اضغط «+ رفع نتائج اختبار» وارفع ملف الإكسل.</span></div>';
    return 0;
  }
  // مين صحح (للإدارة): أسماء أصحاب التقارير
  const names = {};
  if (!isTeacherView()) {
    const ids = [...new Set(data.map(r => r.created_by).filter(Boolean))];
    if (ids.length) {
      const { data: profs } = await sb.from('profiles').select('id, full_name').in('id', ids);
      (profs || []).forEach(p => { names[p.id] = p.full_name; });
    }
  }
  erListNames = names;
  await loadSubjectNames();
  renderSavedList();
  return data.length;
}

/* ===== تنظيم قائمة التقارير: بطاقات المواد، وداخل كل مادة اختباراتها مجمّعة بالمرحلة، مع فلاتر ===== */
let erListData = [], erListNames = {};
const ER_FILT_KEY = 'er-list-filters';
let erFilt = (() => { try { return { q: '', type: '', sem: '', grade: '', subject: '', ...JSON.parse(localStorage.getItem(ER_FILT_KEY) || '{}') }; } catch { return { q: '', type: '', sem: '', grade: '', subject: '' }; } })();
const saveFilt = () => { try { localStorage.setItem(ER_FILT_KEY, JSON.stringify({ ...erFilt, q: '' })); } catch { /* المتصفح يمنع التخزين */ } };
const NO_SUBJ = 'بدون مادة', NO_GRADE = 'بدون مرحلة';
const repSubject = r => canonSubject(r.subject_name) || NO_SUBJ;
const repGradeKey = r => gradeFromText(r.grade_level) || gradeFromText(r.title) || '';
const SUBJ_COLORS = [
  { bg: 'var(--teal-light)', fg: 'var(--teal)' }, { bg: 'var(--gold-light)', fg: 'var(--gold)' },
  { bg: 'var(--purple-light)', fg: 'var(--purple)' }, { bg: 'var(--meadow-light)', fg: 'var(--meadow-dark)' },
];
const examIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px; height:26px;"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;
const bookIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px; height:26px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>`;
const dateTxt = d => { try { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

const countTests = n => (n === 1 ? 'اختبار واحد' : n === 2 ? 'اختباران' : n <= 10 ? `${n} اختبارات` : `${n} اختبارًا`);
function filteredReports(ignoreSubject = false) {
  const q = normSubj(erFilt.q);
  return erListData.filter(r =>
    (!erFilt.type || (r.exam_type || 'diagnostic') === erFilt.type)
    && (!erFilt.sem || (erFilt.sem === '-' ? !r.semester : r.semester === erFilt.sem))
    && (!erFilt.grade || repGradeKey(r) === erFilt.grade)
    && (ignoreSubject || !erFilt.subject || repSubject(r) === erFilt.subject)
    && (!q || normSubj([r.title, r.subject_name, r.grade_level].join(' ')).includes(q)));
}

function reportCardHtml(r, i) {
  const c = SUBJ_COLORS[i % SUBJ_COLORS.length];
  const names = erListNames;
  const meta = [repSubject(r) !== NO_SUBJ ? repSubject(r) : '', gradeLabels[repGradeKey(r)] || r.grade_level, r.semester].filter(Boolean).map(esc).join(' · ');
  return `
      <div data-id="${r.id}" class="er-report-card" tabindex="0" role="button" title="${esc(r.title)}">
        <span class="erc-ic" style="background:${c.bg}; color:${c.fg};">${examIconSvg}</span>
        <span class="erc-main">
          <b>${esc(r.title)}</b>
          <span>${meta || '&nbsp;'}</span>
          <span class="erc-chips">${isTeacherView() && r.created_by !== currentUserId ? '<i class="erc-shared">من الإدارة</i>' : ''}${r.exam_type === 'periodic' ? '<i class="erc-periodic">فتري</i>' : '<i>تشخيصي</i>'}${r.source === 'camera' ? '<i class="erc-cam">📷 بالجوال</i>' : ''}${r.students_count != null ? `<i>${r.students_count} طالب</i>` : ''}${r.item_count != null ? `<i>${r.item_count} سؤال</i>` : ''}${r.created_at ? `<i>${dateTxt(r.created_at)}</i>` : ''}${names[r.created_by] && r.source === 'camera' ? `<i>صححه: ${esc(names[r.created_by])}</i>` : ''}</span>
          ${r.exam_type === 'periodic' || r.source !== 'camera' ? `<span class="erc-actions">${r.exam_type === 'periodic' ? `<button type="button" class="erc-act er-export-btn" data-rid="${r.id}">⬇ تصدير النتائج</button><button type="button" class="erc-act er-results-btn" data-rid="${r.id}">استعراض النتائج</button><button type="button" class="erc-act er-absence-btn" data-rid="${r.id}">الغياب</button>` : ''}${r.source !== 'camera' ? `<button type="button" class="erc-act er-addsheet-btn" data-rid="${r.id}">➕ ورقة طالب</button>` : ''}</span>` : ''}
        </span>
        ${!isTeacherView() || r.created_by === currentUserId ? `<button type="button" class="er-delete-btn" data-id="${r.id}" title="حذف التقرير" aria-label="حذف التقرير">✕</button>` : ''}
      </div>`;
}

function renderFilterBar() {
  const fb = document.getElementById('er-filters');
  if (!fb) return;
  const subjects = [...new Set(erListData.map(repSubject))].sort((a, b) => (a === NO_SUBJ) - (b === NO_SUBJ) || a.localeCompare(b, 'ar'));
  const sems = [...new Set(erListData.map(r => r.semester).filter(Boolean))];
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  const active = ['type', 'sem', 'grade', 'subject'].some(k => erFilt[k]) || erFilt.q;
  fb.innerHTML = `<div class="er-filt">
    <input type="search" id="erf-q" placeholder="ابحث بعنوان الاختبار..." value="${esc(erFilt.q)}" autocomplete="off" />
    <select id="erf-subject" aria-label="المادة">${opt('', 'كل المواد', erFilt.subject)}${subjects.map(x => opt(x, x, erFilt.subject)).join('')}</select>
    <select id="erf-grade" aria-label="المرحلة">${opt('', 'كل المراحل', erFilt.grade)}${GRADE_ORDER.map(g => opt(g, gradeLabels[g], erFilt.grade)).join('')}</select>
    <select id="erf-type" aria-label="نوع الاختبار">${opt('', 'كل الأنواع', erFilt.type)}${opt('diagnostic', 'تشخيصي', erFilt.type)}${opt('periodic', 'فتري', erFilt.type)}</select>
    <select id="erf-sem" aria-label="الفصل الدراسي">${opt('', 'كل الفصول الدراسية', erFilt.sem)}${['الفصل الدراسي الأول', 'الفصل الدراسي الثاني', ...sems].filter((x, i, a) => a.indexOf(x) === i).map(x => opt(x, x, erFilt.sem)).join('')}${erListData.some(r => !r.semester) ? opt('-', 'بدون فصل دراسي', erFilt.sem) : ''}</select>
    ${active ? '<button type="button" class="text-action-btn" id="erf-clear">مسح الفلاتر</button>' : ''}
  </div>`;
  const on = (id, k, ev = 'change') => { const el = document.getElementById(id); el.addEventListener(ev, () => { erFilt[k] = el.value; saveFilt(); renderSavedList(id === 'erf-q'); }); };
  on('erf-subject', 'subject'); on('erf-grade', 'grade'); on('erf-type', 'type'); on('erf-sem', 'sem'); on('erf-q', 'q', 'input');
  const cl = document.getElementById('erf-clear');
  if (cl) cl.onclick = () => { erFilt = { q: '', type: '', sem: '', grade: '', subject: '' }; saveFilt(); renderSavedList(); };
}

function renderSavedList(keepSearchFocus = false) {
  const listEl = document.getElementById('er-saved-list');
  if (!listEl) return;
  if (erFilt.subject && !erListData.some(r => repSubject(r) === erFilt.subject)) erFilt.subject = '';
  if (!keepSearchFocus) renderFilterBar();
  else { const cl = document.getElementById('erf-clear'); if (!cl) renderFilterBar(); }
  if (keepSearchFocus) { const q = document.getElementById('erf-q'); if (q && document.activeElement !== q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }

  // بدون مادة محددة وبدون بحث: بطاقات المواد
  if (!erFilt.subject && !erFilt.q) {
    const list = filteredReports(true);
    const bySubj = new Map();
    list.forEach(r => { const k = repSubject(r); if (!bySubj.has(k)) bySubj.set(k, []); bySubj.get(k).push(r); });
    const subjects = [...bySubj.keys()].sort((a, b) => (a === NO_SUBJ) - (b === NO_SUBJ) || a.localeCompare(b, 'ar'));
    listEl.innerHTML = subjects.length ? `<div class="er-subj-grid">${subjects.map((sj, i) => {
      const reps = bySubj.get(sj);
      const c = SUBJ_COLORS[i % SUBJ_COLORS.length];
      const gc = GRADE_ORDER.map(g => [g, reps.filter(r => repGradeKey(r) === g).length]).filter(([, n]) => n);
      const noG = reps.filter(r => !repGradeKey(r)).length;
      const last = reps.reduce((a, r) => (!a || r.created_at > a ? r.created_at : a), '');
      return `<button type="button" class="er-subj-card" data-subj="${esc(sj)}">
        <span class="erc-ic" style="background:${c.bg}; color:${c.fg};">${bookIconSvg}</span>
        <span class="ers-main"><b>${esc(sj)}</b>
          <span class="ers-n">${countTests(reps.length)}${last ? ` · آخرها ${dateTxt(last)}` : ''}</span>
          <span class="erc-chips">${gc.map(([g, n]) => `<i>${esc(gradeLabels[g])}: ${n}</i>`).join('')}${noG ? `<i>${NO_GRADE}: ${noG}</i>` : ''}</span>
        </span><span class="ers-go" aria-hidden="true">‹</span>
      </button>`;
    }).join('')}</div>` : '<div class="ex-empty"><b>لا توجد تقارير مطابقة للفلاتر</b><span>غيّر الفلاتر أو امسحها لعرض كل التقارير.</span></div>';
    listEl.querySelectorAll('.er-subj-card').forEach(b => b.addEventListener('click', () => {
      erFilt.subject = b.dataset.subj; saveFilt(); renderSavedList();
      listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    return;
  }

  // مادة محددة (أو بحث): الاختبارات مجمّعة بالمرحلة
  const list = filteredReports();
  const groups = [...GRADE_ORDER, ''].map(g => [g, list.filter(r => repGradeKey(r) === g)]).filter(([, a]) => a.length);
  const head = erFilt.subject
    ? `<div class="er-subj-head"><button type="button" class="text-action-btn" id="er-subj-back">→ كل المواد</button><b>${esc(erFilt.subject)}</b><span>${countTests(list.length)}</span></div>`
    : `<div class="er-subj-head"><b>نتائج البحث</b><span>${list.length}</span></div>`;
  let idx = 0;
  listEl.innerHTML = head + (groups.length ? groups.map(([g, reps]) => `
    <section class="er-grade-grp">
      <h4>${esc(g ? gradeLabels[g] : NO_GRADE)} <small>${reps.length}</small></h4>
      <div class="er-report-grid">${reps.map(r => reportCardHtml(r, idx++)).join('')}</div>
    </section>`).join('') : '<div class="ex-empty"><b>لا توجد تقارير مطابقة</b><span>غيّر الفلاتر أو امسحها.</span></div>');
  const back = document.getElementById('er-subj-back');
  if (back) back.onclick = () => { erFilt.subject = ''; saveFilt(); renderSavedList(); };
  listEl.querySelectorAll('.er-report-card').forEach(card => card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openReport(card.dataset.id); }));

  listEl.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.er-delete-btn') || e.target.closest('.erc-act')) return;
      openReport(card.dataset.id);
    });
  });
  listEl.querySelectorAll('.er-export-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ التجهيز...';
    try { await exportPeriodicResults(btn.dataset.rid); } catch (err) { alert('تعذر التصدير: ' + (err.message || err)); }
    btn.disabled = false; btn.textContent = t;
  }));
  listEl.querySelectorAll('.er-addsheet-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ الفتح...';
    try {
      const { data: rep, error } = await sb.from('exam_reports').select('*').eq('id', btn.dataset.rid).single();
      if (error || !rep) throw new Error(error ? error.message : 'التقرير غير موجود');
      await openManualSheet(rep, () => loadSavedList());
    } catch (err) { alert('تعذر فتح إضافة الورقة: ' + (err.message || err)); }
    btn.disabled = false; btn.textContent = t;
  }));
  listEl.querySelectorAll('.er-results-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ التحميل...';
    try { await showResults(btn.dataset.rid); } catch (err) { alert('تعذر عرض النتائج: ' + (err.message || err)); }
    btn.disabled = false; btn.textContent = t;
  }));
  listEl.querySelectorAll('.er-absence-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ التحميل...';
    try { await showAbsence(btn.dataset.rid); } catch (err) { alert('تعذر عرض الغياب: ' + (err.message || err)); }
    btn.disabled = false; btn.textContent = t;
  }));
  listEl.querySelectorAll('.er-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('هل أنت متأكد من حذف هذا التقرير؟')) return;
      await sb.from('exam_reports').delete().eq('id', btn.dataset.id);
      await loadSavedList();
    });
  });
}

async function openReport(id) {
  const { data, error } = await sb.from('exam_reports').select('*').eq('id', id).single();
  if (error || !data) { alert('تعذر فتح التقرير'); return; }
  currentReport = data;
  setSubRoute(id);
  window.scrollTo(0, 0);
  document.getElementById('er-list-view').classList.add('hidden');
  document.getElementById('er-detail-view').classList.remove('hidden');
  document.getElementById('er-detail-title').textContent = data.title;
  document.getElementById('er-detail-sub').textContent = `${data.subject_name || '-'} — ${data.grade_level || '-'} — ${data.semester || '-'} — ${data.students_count} طالب`;
  showErTab('dist');
  const ekb = document.getElementById('er-edit-key-btn');
  ekb.textContent = data.raw_data && data.raw_data.models ? '↻ إعادة التصحيح بالمفتاح المحفوظ' : '✎ تعديل مفتاح الإجابة والدرجات';
  // تقرير الجوال ينبني من الأوراق المصححة: التعديل يكون من شاشة التصحيح نفسها
  const cam = data.source === 'camera';
  ekb.classList.toggle('hidden', cam || isTeacherView());
  document.getElementById('er-update-file-btn').classList.toggle('hidden', cam || isTeacherView());
  document.getElementById('er-append-file-btn').classList.toggle('hidden', cam || isTeacherView());
  const asb = document.getElementById('er-add-sheet-btn');
  if (asb) {
    asb.classList.toggle('hidden', cam || !data.raw_data || !Array.isArray(data.raw_data.students));
    asb.onclick = async () => {
      if (asb.disabled) return;
      const t = asb.textContent; asb.disabled = true; asb.textContent = 'جارٍ الفتح...';
      try { await openManualSheet(data); } catch (err) { alert('تعذر فتح إضافة الورقة: ' + (err.message || err)); }
      asb.disabled = false; asb.textContent = t;
    };
  }
  const cc = document.getElementById('er-camera-continue');
  cc.classList.toggle('hidden', !(cam && data.created_by === currentUserId && data.key_id));
  cc.onclick = () => { cameraKeyId = data.key_id; document.getElementById('er-detail-view').classList.add('hidden'); document.getElementById('er-list-view').classList.remove('hidden'); setMode('camera'); };
  document.getElementById('er-editkey-card').classList.add('hidden');
  document.getElementById('er-updatefile-card').classList.add('hidden');
  renderReportStats(data.stats);
}

/* ---------- تحديث ملف الإكسل لتقرير محفوظ - يبقي الإجابة الصحيحة كما هي ----------
 * وضعين: 'replace' الملف الجديد يحل محل كل الطلاب، و'append' طلاب الملف ينضافون للموجودين
 * (اللي له ورقة بالتقرير ورجع بالملف الجديد تتحدّث ورقته). */
let updMode = 'replace';
const UPD_TEXT = {
  replace: ['تحديث ملف الإكسل', 'ارفع ملف إكسل جديد بنفس عدد الأسئلة (مثلاً بيانات طلاب محدّثة أو فصل إضافي) - الإجابة الصحيحة لكل سؤال تبقى كما هي، والملف الجديد يحل محل كل الطلاب الحاليين.', 'تحديث'],
  append: ['إضافة طلاب من ملف', 'ارفع ملف Remark الذي يضم الطلاب الذين صححتهم لاحقًا (للاختبار نفسه وبعدد الأسئلة نفسه). سيُضافون إلى الطلاب الموجودين في التقرير، وإذا كان لأحدهم ورقة سابقة فستُحدَّث بالورقة الجديدة. تبقى الإجابة الصحيحة كما هي.', 'إضافة للتقرير'],
};
function openUpdateCard(mode) {
  updMode = mode;
  const [h, p, b] = UPD_TEXT[mode];
  document.getElementById('er-updatefile-h').textContent = h;
  document.getElementById('er-updatefile-p').textContent = p;
  document.getElementById('er-updatefile-confirm').textContent = b;
}
document.getElementById('er-append-file-btn').addEventListener('click', () => { openUpdateCard('append'); openUpdateCardBody(); });
document.getElementById('er-update-file-btn').addEventListener('click', () => { openUpdateCard('replace'); openUpdateCardBody(); });
function openUpdateCardBody() {
  if (!currentReport) return;
  document.getElementById('er-editkey-card').classList.add('hidden');
  const errEl = document.getElementById('er-updatefile-error');
  errEl.style.display = 'none';
  document.getElementById('er-update-file').value = '';
  if (!currentReport.raw_data || !Array.isArray(currentReport.raw_data.choiceCounts)) {
    errEl.textContent = 'هذا التقرير محفوظ بنسخة سابقة من النظام لا تحتوي على بيانات كافية لتحديث الملف دون تعديل يدوي - احذفه وارفعه من جديد.';
    errEl.style.display = 'block';
  }
  document.getElementById('er-updatefile-card').classList.remove('hidden');
  document.getElementById('er-updatefile-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('er-updatefile-cancel').addEventListener('click', () => {
  document.getElementById('er-updatefile-card').classList.add('hidden');
});

document.getElementById('er-updatefile-confirm').addEventListener('click', async () => {
  const errEl = document.getElementById('er-updatefile-error');
  errEl.style.display = 'none';
  if (!currentReport || !currentReport.raw_data || !Array.isArray(currentReport.raw_data.choiceCounts)) {
    errEl.textContent = 'لا تتوفر في التقرير الحالي بيانات كافية لتحديثه بهذه الطريقة.';
    errEl.style.display = 'block';
    return;
  }
  const file = document.getElementById('er-update-file').files[0];
  if (!file) { errEl.textContent = 'اختر ملف إكسل أولًا'; errEl.style.display = 'block'; return; }

  try {
    await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    let rows = [];
    wb.SheetNames.forEach(name => {
      const sheet = wb.Sheets[name];
      rows = rows.concat(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }));
    });
    const newParsed = parseSheetRows(rows);
    const { applyPaperToParsed } = await import('./question-paper.js?v=' + ASSET_VERSION);
    await applyPaperToParsed(newParsed);
    await enrichFromPlatform(newParsed);

    const { choiceCounts: oldChoiceCounts, reversedOrder = true } = currentReport.raw_data;
    if (newParsed.itemCount !== oldChoiceCounts.length) {
      errEl.textContent = `عدد أسئلة الملف الجديد (${newParsed.itemCount}) لا يطابق عدد أسئلة التقرير الحالي (${oldChoiceCounts.length}) - يجب أن يكون عدد الأسئلة نفسه ليبقى مفتاح الإجابة صحيحًا. وإذا كان الاختبار مختلفًا كليًا، فارفعه تقريرًا جديدًا بدل التحديث.`;
      errEl.style.display = 'block';
      return;
    }

    if (currentReport.raw_data.points && currentReport.raw_data.points.length === newParsed.itemCount) newParsed.points = currentReport.raw_data.points;
    // إضافة: نفس ترميز التقرير الحالي، والطلاب = الموجودين (إلا اللي رجعوا بالملف) + طلاب الملف
    let appendNote = '';
    if (updMode === 'append') {
      const idOf = st => String(st.id || '').trim();
      newParsed.choiceCounts = oldChoiceCounts.slice();
      if (Array.isArray(currentReport.raw_data.itemTypes) && currentReport.raw_data.itemTypes.length === oldChoiceCounts.length) newParsed.itemTypes = currentReport.raw_data.itemTypes.slice();
      const oldStudents = currentReport.raw_data.students || [];
      const oldIds = new Set(oldStudents.map(idOf).filter(Boolean));
      const newIds = new Set(newParsed.students.map(idOf).filter(Boolean));
      const added = newParsed.students.filter(st => !oldIds.has(idOf(st))).length;
      const updated = newParsed.students.length - added;
      newParsed.students = oldStudents.filter(st => !newIds.has(idOf(st))).concat(newParsed.students);
      appendNote = `تمت الإضافة ✓ ${added} طالب جديد${updated ? `، و${updated} ${updated === 1 ? 'طالب حُدِّثت ورقته' : 'طلاب حُدِّثت أوراقهم'}` : ''} — مجموع الطلاب الآن ${newParsed.students.length}`;
    }

    if (currentReport.raw_data.models) {
      const m = currentReport.raw_data.models;
      const key = await fetchKeyById(m.keyId);
      const oldModel = new Map((currentReport.raw_data.students || []).map(st => [String(st.id || '').trim(), st.model]));
      const map = (key && key.model_map) || {};
      let keyA, keyB, mode = m.mode, orderB = m.orderB;
      if (key && key.models) {
        keyA = rawFromIdx(key.answers, newParsed.choiceCounts, reversedOrder);
        keyB = rawFromIdx(key.models.answers_b, newParsed.choiceCounts, reversedOrder);
        mode = key.models.mode; orderB = key.models.order_b;
      } else {
        const conv = raw => buildManualKey(oldChoiceCounts.map((c, i) => collapseKey(keyLetters(raw[i], c, reversedOrder))), newParsed.choiceCounts, reversedOrder);
        keyA = conv(m.keyA); keyB = conv(m.keyB);
      }
      const g = gradeWithModels({ parsed: newParsed, keyA, keyB, mode, orderB, reversedOrder, keyId: m.keyId,
        modelOf: st => { const id = String(st.id || '').trim(); return fileModel(st, reversedOrder) || map[id] || oldModel.get(id) || MODEL_A; } });
      const { error } = await sb.from('exam_reports').update({
        item_count: newParsed.itemCount, students_count: newParsed.students.length,
        key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data,
      }).eq('id', currentReport.id);
      if (error) { errEl.textContent = 'تعذر تحديث التقرير: ' + error.message; errEl.style.display = 'block'; return; }
      currentReport = { ...currentReport, item_count: newParsed.itemCount, students_count: newParsed.students.length, key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data };
      document.getElementById('er-detail-sub').textContent = `${currentReport.subject_name || '-'} — ${currentReport.grade_level || '-'} — ${currentReport.semester || '-'} — ${currentReport.students_count} طالب`;
      renderReportStats(g.stats);
      document.getElementById('er-updatefile-card').classList.add('hidden');
      periodicCache.delete(currentReport.id);
      if (appendNote) alert(appendNote);
      return;
    }

    // نحوّل مفتاح الإجابة الحالي (قيم خام) لحروف باستخدام بيانات الترميز القديمة، وبعدين نبنيه
    // من جديد بنفس الحروف على قيم الملف الجديد - عشان الإجابة الصحيحة (بالحرف) تبقى كما هي
    // حتى لو الترميز الخام اختلف شوي بين الملفين
    const letters = oldChoiceCounts.map((numChoices, i) => collapseKey(keyLetters(currentReport.key_raw[i], numChoices, reversedOrder)));
    if (letters.some(l => !l)) {
      errEl.textContent = 'تعذر قراءة مفتاح الإجابة الحالي لتطبيقه على الملف الجديد - استخدم "تعديل مفتاح الإجابة" بدلًا من ذلك.';
      errEl.style.display = 'block';
      return;
    }
    const newKeyRaw = buildManualKey(letters, newParsed.choiceCounts, reversedOrder);
    const stats = computeExamStats({ ...newParsed, keyRaw: newKeyRaw, reversedOrder });
    const newRawData = { ...currentReport.raw_data, students: newParsed.students, choiceCounts: newParsed.choiceCounts, itemTypes: newParsed.itemTypes, reversedOrder };

    const { error } = await sb.from('exam_reports').update({
      item_count: newParsed.itemCount,
      students_count: newParsed.students.length,
      key_raw: newKeyRaw,
      stats,
      raw_data: newRawData,
    }).eq('id', currentReport.id);
    if (error) { errEl.textContent = 'تعذر تحديث التقرير: ' + error.message; errEl.style.display = 'block'; return; }

    currentReport = { ...currentReport, item_count: newParsed.itemCount, students_count: newParsed.students.length, key_raw: newKeyRaw, stats, raw_data: newRawData };
    document.getElementById('er-detail-sub').textContent = `${currentReport.subject_name || '-'} — ${currentReport.grade_level || '-'} — ${currentReport.semester || '-'} — ${currentReport.students_count} طالب`;
    renderReportStats(stats);
    document.getElementById('er-updatefile-card').classList.add('hidden');
    periodicCache.delete(currentReport.id);
    if (appendNote) alert(appendNote);
  } catch (e) {
    errEl.textContent = e.message || 'تعذر قراءة الملف';
    errEl.style.display = 'block';
  }
});

/* ---------- تعديل مفتاح الإجابة لتقرير محفوظ وإعادة حساب التقارير الستة ---------- */
async function fetchKeyById(id) {
  if (!id) return null;
  let { data, error } = await sb.from('answer_keys').select('id, answers, choices, models, model_map, points').eq('id', id).maybeSingle();
  if (error) ({ data } = await sb.from('answer_keys').select('id, answers, choices, models, model_map').eq('id', id).maybeSingle());
  return data || null;
}

// تقرير بنموذجين: يعيد التصحيح بآخر نسخة من المفتاح المحفوظ (الإجابات ونموذج كل طالب)
async function regradeModelReport() {
  const rd = currentReport.raw_data;
  const key = await fetchKeyById(rd.models.keyId);
  if (!key || !key.models) { alert('حُذف المفتاح المحفوظ لهذا الاختبار أو أصبح بنموذج واحد - تتعذّر إعادة التصحيح منه.'); return; }
  if (!confirm('إعادة تصحيح كل الطلاب بآخر نسخة من المفتاح المحفوظ؟')) return;
  const reversedOrder = rd.reversedOrder !== false;
  const map = key.model_map || {};
  const g = gradeWithModels({
    parsed: { itemCount: rd.choiceCounts.length, choiceCounts: rd.choiceCounts, itemTypes: rd.itemTypes, students: rd.students, points: Array.isArray(key.points) && key.points.length === rd.choiceCounts.length ? key.points : (rd.points || null) },
    keyA: rawFromIdx(key.answers, rd.choiceCounts, reversedOrder),
    keyB: rawFromIdx(key.models.answers_b, rd.choiceCounts, reversedOrder),
    mode: key.models.mode, orderB: key.models.order_b, reversedOrder, keyId: key.id,
    modelOf: st => fileModel(st, reversedOrder) || map[String(st.id || '').trim()] || st.model || MODEL_A,
  });
  const { error } = await sb.from('exam_reports').update({ key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data }).eq('id', currentReport.id);
  if (error) { alert('تعذر الحفظ: ' + error.message); return; }
  currentReport = { ...currentReport, key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data };
  showErTab('dist');
  renderReportStats(g.stats);
}

document.getElementById('er-edit-key-btn').addEventListener('click', () => {
  if (!currentReport) return;
  if (currentReport.raw_data && currentReport.raw_data.models) { regradeModelReport(); return; }
  document.getElementById('er-updatefile-card').classList.add('hidden');
  const errEl = document.getElementById('er-editkey-error');
  errEl.style.display = 'none';
  if (!currentReport.raw_data || !Array.isArray(currentReport.raw_data.choiceCounts)) {
    errEl.textContent = 'هذا التقرير محفوظ بنسخة سابقة من النظام لا تحتوي على بيانات الطلاب الخام - يجب رفع ملف الإكسل نفسه وحفظ التقرير من جديد لتتمكن من تعديل مفتاحه لاحقًا.';
    errEl.style.display = 'block';
    document.getElementById('er-editkey-card').classList.remove('hidden');
    document.getElementById('er-editkey-form').innerHTML = '';
    return;
  }
  const { choiceCounts, reversedOrder = true } = currentReport.raw_data;
  const pts = currentReport.raw_data.points || [];
  const ptOf = i => (Number.isFinite(+pts[i]) ? +pts[i] : 1);
  const el = document.getElementById('er-editkey-form');
  el.innerHTML = `<label style="display:flex; align-items:center; gap:8px; font-size:12px; background:#fff; border:1px solid var(--border); border-radius:10px; padding:9px 12px; margin-bottom:12px;">
    <input type="checkbox" id="er-editkey-reversed" style="width:auto; margin:0;"${reversedOrder ? ' checked' : ''} />
    <span>ترتيب رموز الاختيارات بالملف معكوس (بطّله إذا المادة إنجليزية أو النتائج غريبة)</span>
  </label>
  ${multiToggleHtml((currentReport.key_raw || []).some(Array.isArray))}
  <div class="er-key-grid">${choiceCounts.map((numChoices, i) => {
    const current = keyLetters(currentReport.key_raw[i], numChoices, reversedOrder);
    return `<div class="er-key-item">
      <label>سؤال ${i + 1}</label>
      ${keyPickHtml(i, numChoices, (currentReport.raw_data.itemTypes || [])[i] === 'tf', current)}
      <input type="number" class="er-editkey-pt" data-item="${i}" min="0" step="0.25" value="${ptOf(i)}" title="درجة السؤال" aria-label="درجة السؤال ${i + 1}" autocomplete="off" />
    </div>`;
  }).join('')}</div>
  <div class="er-pt-bar"><span>درجة السؤال تظهر بجانب كل إجابة.</span> اجعل كل الأسئلة بدرجة <input type="number" id="er-editkey-pt-all" min="0" step="0.25" value="1" autocomplete="off" /> <button type="button" class="text-action-btn" id="er-editkey-pt-apply">تطبيق</button> <b id="er-editkey-pt-sum"></b></div>`;
  const sumPts = () => { const t = [...document.querySelectorAll('.er-editkey-pt')].reduce((a, x) => a + (Number.isFinite(+x.value) && +x.value >= 0 ? +x.value : 1), 0); document.getElementById('er-editkey-pt-sum').textContent = `الدرجة الكاملة: ${Math.round(t * 100) / 100}`; };
  el.addEventListener('input', e => { if (e.target.classList.contains('er-editkey-pt')) sumPts(); });
  document.getElementById('er-editkey-pt-apply').onclick = () => { const v = document.getElementById('er-editkey-pt-all').value; document.querySelectorAll('.er-editkey-pt').forEach(x => { x.value = v; }); sumPts(); };
  sumPts();
  document.getElementById('er-editkey-reversed').addEventListener('change', (e) => {
    setKeyPick(el, choiceCounts.map((numChoices, i) => keyLetters(currentReport.key_raw[i], numChoices, e.target.checked)));
  });
  document.getElementById('er-editkey-card').classList.remove('hidden');
  document.getElementById('er-editkey-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.getElementById('er-editkey-cancel').addEventListener('click', () => {
  document.getElementById('er-editkey-card').classList.add('hidden');
});

document.getElementById('er-editkey-save').addEventListener('click', async () => {
  const errEl = document.getElementById('er-editkey-error');
  errEl.style.display = 'none';
  if (!currentReport || !currentReport.raw_data) return;
  const { students, choiceCounts, itemTypes = [] } = currentReport.raw_data;

  const letterSelections = readKeyPick(document.getElementById('er-editkey-form'));
  if (letterSelections.some(v => !v || !v.length)) {
    errEl.textContent = 'اختر الإجابة الصحيحة لكل سؤال';
    errEl.style.display = 'block';
    return;
  }
  const reversedOrder = document.getElementById('er-editkey-reversed').checked;
  const keyRaw = buildManualKey(letterSelections, choiceCounts, reversedOrder);
  const ptsIn = Array.from(document.querySelectorAll('.er-editkey-pt')).map(x => (Number.isFinite(+x.value) && +x.value >= 0 ? +x.value : 1));
  const points = ptsIn.length === choiceCounts.length && ptsIn.some(v => v !== 1) ? ptsIn : null;
  const stats = computeExamStats({ itemCount: choiceCounts.length, keyRaw, choiceCounts, students, reversedOrder, itemTypes, points });
  const newRawData = { ...currentReport.raw_data, reversedOrder };
  if (points) newRawData.points = points; else delete newRawData.points;
  periodicCache.delete(currentReport.id);

  const { error } = await sb.from('exam_reports').update({ key_raw: keyRaw, stats, raw_data: newRawData }).eq('id', currentReport.id);
  if (error) { errEl.textContent = 'تعذر حفظ المفتاح الجديد: ' + error.message; errEl.style.display = 'block'; return; }

  currentReport = { ...currentReport, key_raw: keyRaw, stats, raw_data: newRawData };
  document.getElementById('er-editkey-card').classList.add('hidden');
  showErTab('dist');
  renderReportStats(stats);
});

document.getElementById('er-back-to-list').addEventListener('click', () => {
  document.getElementById('er-detail-view').classList.add('hidden');
  document.getElementById('er-list-view').classList.remove('hidden');
  setSubRoute(null);
});

const ER_TABS = ['dist', 'hist', 'items', 'summary', 'itemstats', 'analysis'];
function showErTab(tab) {
  ER_TABS.forEach(t => {
    document.getElementById(`er-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`er-panel-${t}`).classList.toggle('hidden', t !== tab);
  });
}
ER_TABS.forEach(t => document.getElementById(`er-tab-${t}`).addEventListener('click', () => showErTab(t)));

/* =========================================================================
 * عرض التقارير الستة
 * ========================================================================= */
function statBox(label, value) {
  return `<div class="stat-card compact"><div class="body"><div class="label">${esc(label)}</div><div class="value" style="font-size:16px;">${value}</div></div></div>`;
}

function summaryStatsGrid(s) {
  return `<div class="stat-grid compact-grid" style="grid-template-columns:repeat(3,1fr);">
    ${statBox('عدد الطلاب', s.n)}
    ${statBox('أعلى درجة', fmt1(s.high) + (s.weighted || s.withEssay ? ` <small style="font-size:.6em; color:var(--slate);">من ${fmt1(s.maxScore)}</small>` : ''))}
    ${statBox('أقل درجة', fmt1(s.low))}
    ${statBox('متوسط الدرجة', fmt2(s.mean))}
    ${statBox('الدرجة الوسيطة', fmt1(s.median))}
    ${statBox('نطاق الدرجات', fmt1(s.range))}
    ${statBox('الانحراف المعياري', fmt2(s.sd))}
    ${statBox('معامل الثبات (KR20)', fmt2(s.kr20))}
    ${statBox('متوسط الدرجة %', pct(s.meanPct))}
  </div>${s.withEssay ? `<p class="er-essay-note">الدرجات شاملة المقالي: الموضوعي من ${fmt1(s.objMax)} + المقالي من ${fmt1(s.essayMax)} = ${fmt1(s.maxScore)}. تحليل الأسئلة ومعامل الثبات للجزء الموضوعي فقط.</p>` : ''}`;
}

// تقرير اختبار بنموذجين: تبديل بين "كل الطلاب" وكل نموذج لحاله
function renderReportStats(stats, view = 'all') {
  const sw = document.getElementById('er-model-switch');
  const byModel = stats && stats.byModel;
  if (!sw || !byModel || !Object.keys(byModel).length) { if (sw) sw.classList.add('hidden'); renderAllReports(statsWithEssay(stats, currentReport)); return; }
  const c = (stats.models && stats.models.counts) || {};
  sw.innerHTML = `<button type="button" data-v="all">كل الطلاب <span class="tr-cnt">${stats.n}</span></button>` +
    Object.keys(byModel).map(m => `<button type="button" data-v="${m}">نموذج ${m} <span class="tr-cnt">${c[m] || byModel[m].n}</span></button>`).join('');
  sw.classList.remove('hidden');
  sw.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.v === view);
    b.onclick = () => renderReportStats(stats, b.dataset.v);
  });
  renderAllReports(view === 'all' ? statsWithEssay(stats, currentReport) : statsWithEssay(byModel[view], currentReport, view));
  if (view === 'all' && stats.itemsMixed) {
    ['er-panel-items', 'er-panel-itemstats', 'er-panel-analysis'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.insertAdjacentHTML('afterbegin', '<div class="er-mixed-note">أسئلة النموذجين مختلفة، فتحليل الأسئلة هنا يخلط سؤالين مختلفين. اختر "نموذج أ" أو "نموذج ب" من الأعلى لتحليل أسئلة كل نموذج.</div>');
    });
  }
}

function renderAllReports(s) {
  renderDist(s);
  renderHist(s);
  renderItems(s);
  renderSummary(s);
  renderItemStats(s);
  renderAnalysis(s);
}

const GRADE_COLORS = { A: '#2E9155', B: '#2455A4', C: '#0E93A8', D: '#E07A34', F: '#C0453D' };
const GRADE_LABELS = { A: 'ممتاز', B: 'جيد جدًا', C: 'جيد', D: 'مقبول', F: 'ضعيف' };

function renderDist(s) {
  const el = document.getElementById('er-panel-dist');
  el.innerHTML = `
    <h4 style="margin-bottom:14px;">تقرير التوزيع التكراري للصف <span style="font-size:12.5px; color:var(--slate); font-weight:400;">متوسط الدرجة% ${pct(s.meanPct)}</span></h4>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px,1fr)); gap:18px; align-items:start;">
      <div style="overflow-x:auto;"><table class="er-table"><thead><tr>
        <th>التقدير</th><th>الدرجة المئوية</th><th>الدرجة الخام</th><th>التكرار</th><th>النسبة المئوية</th>
      </tr></thead><tbody>
        ${s.gradeDistribution.map(g => `<tr>
          <td><span class="badge" style="background:${GRADE_COLORS[g.grade]}1a; color:${GRADE_COLORS[g.grade]};">${GRADE_LABELS[g.grade] || g.grade}</span></td>
          <td>${fmt1(g.pctMin)} - ${fmt2(g.pctMax)}</td>
          <td>${fmt2(g.rawMin)} - ${fmt2(g.rawMax)}</td>
          <td>${g.freq}</td>
          <td>${pct(g.freqPct)}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <div class="form-card" style="margin:0;">
        <h5 style="margin:0 0 10px; font-size:13px;">عدد الطلاب حسب التقدير</h5>
        <div style="position:relative; height:270px;"><canvas id="er-dist-chart" style="width:100% !important; height:100% !important;"></canvas></div>
      </div>
    </div>`;
  drawBarChart('er-dist-chart', s.gradeDistribution.map(g => GRADE_LABELS[g.grade] || g.grade), s.gradeDistribution.map(g => g.freq), 'التكرار', {
    colors: s.gradeDistribution.map(g => GRADE_COLORS[g.grade]),
  });
}

function renderHist(s) {
  const el = document.getElementById('er-panel-hist');
  const histColors = s.scoreHistogram.map((b, i) => (i >= 7 ? '#2E9155' : i >= 5 ? '#2455A4' : i >= 3 ? '#0E93A8' : i >= 1 ? '#E07A34' : '#C0453D'));
  el.innerHTML = `
    <h4 style="margin-bottom:14px;">الرسم البياني لتقدير الطالب</h4>
    ${summaryStatsGrid(s)}
    <div class="form-card" style="margin-top:18px;">
      <h5 style="margin:0 0 10px; font-size:13px;">توزيع الطلاب حسب الدرجة المئوية (فئات ١٠٪)</h5>
      <div style="position:relative; height:270px;"><canvas id="er-hist-chart" style="width:100% !important; height:100% !important;"></canvas></div>
    </div>`;
  drawBarChart('er-hist-chart', s.scoreHistogram.map(b => b.label + '٪'), s.scoreHistogram.map(b => b.count), 'عدد الطلاب', {
    colors: histColors,
  });
}

// لون شريط النسبة لكل بديل: أخضر للإجابة الصحيحة، أصفر للمشتت الأكثر اختيارًا لو تجاوز
// عدد من اختاره عدد من اختار الإجابة الصحيحة (مشكلة فعلية تحتاج مراجعة)، وإلا أحمر
function choiceBarColor(c, it) {
  if (c.isCorrect) return '#2E9155';
  if (it.flagged && it.topWrong && c.label === it.topWrong) return '#FACC15';
  return '#C0453D';
}

function renderItems(s) {
  const el = document.getElementById('er-panel-items');
  el.innerHTML = `
    <h4 style="margin-bottom:14px;">التحليل المجمع لبنود الاختبار</h4>
    <p style="font-size:12px; color:var(--slate); margin:0 0 14px;">
      الإجابة الصحيحة معلّمة بـ * وباللون <span style="color:#2E9155; font-weight:700;">الأخضر</span> — ويظهر المشتت الأكثر
      اختيارًا باللون <span style="color:#D4B106; font-weight:700;">الأصفر</span> فقط إذا تجاوز عدد من اختاره عدد من
      اختار الإجابة الصحيحة (يحتاج إلى مراجعة) — وإلا فيبقى باللون <span style="color:#C0453D; font-weight:700;">الأحمر</span>
      مثل بقية الاختيارات وعدم الاستجابة/الإجابة المتعددة
    </p>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:14px; direction:rtl;">
      ${s.itemStats.map(it => `
        <div class="form-card" style="margin:0;">
          <h5 style="margin:0 0 10px; font-size:13px; display:flex; align-items:center; justify-content:space-between; gap:6px;">
            <span>${esc(it.label)}</span>
            ${it.flagged ? '<span class="badge badge-danger" title="مشتت أُختير أكثر من الإجابة الصحيحة">⚠ مراجعة</span>' : ''}
          </h5>
          <div style="display:flex; flex-direction:column; gap:9px;">
            ${it.choices.map(c => `
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; font-size:12px; gap:6px;">
                  <span>${esc(c.label)}${c.isCorrect ? ' *' : ''}</span>
                  <span>${c.count} — ${pct(c.pct)}</span>
                </div>
                <div style="background:var(--sand); border-radius:5px; height:8px; overflow:hidden;">
                  <div style="background:${choiceBarColor(c, it)}; height:100%; border-radius:5px; width:${c.pct > 0 ? Math.max(c.pct, 2) : 0}%;"></div>
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function renderSummary(s) {
  const el = document.getElementById('er-panel-summary');
  el.innerHTML = `
    <h4 style="margin-bottom:14px;">تقرير موجز للاختبار</h4>
    ${summaryStatsGrid(s)}
    <div style="overflow-x:auto; margin-top:18px;"><table class="er-table"><thead><tr>
      <th>رقم</th><th>سؤال</th><th>الإجابة الصحيحة</th><th>الإجمالي: الصواب%</th><th>أعلى ٢٧٪</th><th>أدنى ٢٧٪</th><th>نقطي ثنائي التسلسل</th>
    </tr></thead><tbody>
      ${s.itemStats.map(it => `<tr>
        <td>${it.num}</td><td>${esc(it.label)}</td><td>${esc(it.correctLetter || '-')}</td>
        <td>${pct(it.correctPct)}</td><td>${pct(it.upper27)}</td><td>${pct(it.lower27)}</td><td>${fmt2(it.pointBiserial)}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderItemStats(s) {
  const el = document.getElementById('er-panel-itemstats');
  el.innerHTML = `
    <h4 style="margin-bottom:14px;">تقرير إحصاءات بنود الاختبار</h4>
    <div style="overflow-x:auto;"><table class="er-table"><thead><tr>
      <th>سؤال</th><th>نقاط</th><th>مصحح</th><th>الصواب</th><th>الخطأ</th><th>غير موجود</th><th>نقطي ثنائي التسلسل</th><th>النسبة% الصواب</th>
    </tr></thead><tbody>
      ${s.itemStats.map(it => `<tr>
        <td>${esc(it.label)}</td><td>1</td><td>${s.n}</td><td>${it.correctCount}</td><td>${it.wrongCount}</td><td>${it.notPresent}</td>
        <td>${fmt2(it.pointBiserial)}</td><td>${pct(it.correctPct)}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderAnalysis(s) {
  const el = document.getElementById('er-panel-analysis');
  // تقارير محفوظة بنسخة سابقة من النظام ما تحتوي هذه القوائم بعد - نتفادى انهيار الصفحة
  const topStudents = Array.isArray(s.topStudents) ? s.topStudents : [];
  // توافق مع التقارير المحفوظة قبل التحويل من "أدنى ١٥" لـ"الطلاب الضعاف (أقل من ٥٠٪)"
  const weakStudents = Array.isArray(s.weakStudents) ? s.weakStudents : (Array.isArray(s.bottomStudents) ? s.bottomStudents : []);
  const isLegacyReport = !Array.isArray(s.topStudents) && !Array.isArray(s.weakStudents) && !Array.isArray(s.bottomStudents);
  el.innerHTML = `
    <h4 style="margin-bottom:14px;">تقرير تحليل الاختبار</h4>
    ${summaryStatsGrid(s)}
    <div class="form-row" style="align-items:stretch; margin-top:18px;">
      <div class="form-card" style="margin:0;">
        <h5 style="margin:0 0 10px; font-size:13px;">أصعب الأسئلة</h5>
        ${s.hardest.map(it => `<div style="display:flex; justify-content:space-between; font-size:12.5px; padding:4px 0; border-bottom:1px solid #ECEAE1;"><span>${esc(it.label)}</span><span style="font-weight:700; color:var(--danger);">${pct(it.correctPct)}</span></div>`).join('')}
      </div>
      <div class="form-card" style="margin:0;">
        <h5 style="margin:0 0 10px; font-size:13px;">أسهل الأسئلة</h5>
        ${s.easiest.map(it => `<div style="display:flex; justify-content:space-between; font-size:12.5px; padding:4px 0; border-bottom:1px solid #ECEAE1;"><span>${esc(it.label)}</span><span style="font-weight:700; color:var(--meadow);">${pct(it.correctPct)}</span></div>`).join('')}
      </div>
    </div>
    <div class="form-card" style="margin-top:18px;">
      <h5 style="margin:0 0 8px; font-size:13px;">الموثوقية (كرونباخ ألفا)</h5>
      <p style="font-size:13px; margin:0;">${fmt2(s.kr20)} — <span class="badge badge-gray">${esc(s.reliabilityBand)}</span></p>
      <p style="font-size:11.5px; color:var(--slate); margin-top:8px;">تُستخدم لقياس الاتساق الداخلي (الموثوقية) للاختبار: ضعيف &lt;٠٫٧٠ / متوسط ٠٫٧٠-٠٫٧٩ / جيد ٠٫٨٠-٠٫٨٩ / ممتاز ٠٫٩٠+</p>
    </div>
    <div class="form-card" style="margin-top:18px;">
      <h5 style="margin:0 0 8px; font-size:13px;">أسئلة للمراجعة</h5>
      <p style="font-size:12.5px; margin:0;">${s.toReview.length ? s.toReview.map(it => esc(it.label) + (it.topWrong ? ` (اختار كثيرون "${esc(it.topWrong)}" بدل الإجابة الصحيحة)` : '')).join('، ') : 'لا توجد أسئلة مشتتاتها أكثر اختيارًا من الإجابة الصحيحة'}</p>
    </div>
    <div style="margin-top:22px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
      <div>
        <h5 style="margin:0 0 4px; font-size:14px;">أعلى ١٥ درجة والطلاب الضعاف</h5>
        <p style="font-size:11.5px; color:var(--slate); margin:0;">بأسماء الطلاب وفصولهم - الضعاف: كل طالب تحقيقه أقل من ٥٠٪ من الدرجة (بدون حد أقصى للعدد)</p>
      </div>
      ${isLegacyReport ? '' : `<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <select id="er-print-scope" style="width:auto; padding:8px 10px; font-size:12px; border:1px solid var(--border); border-radius:8px;">
          <option value="both">طباعة: كلاهما</option>
          <option value="weak">طباعة: الضعاف فقط</option>
          <option value="top">طباعة: أعلى ١٥ فقط</option>
        </select>
        <div id="er-print-sections" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; border:1px solid var(--border); border-radius:8px; padding:6px 10px;">
          <label style="font-size:12px; display:flex; align-items:center; gap:4px; font-weight:700;"><input type="checkbox" class="er-section-cb" value="__all__" checked style="width:auto; margin:0;" /> كل الفصول</label>
          ${sectionOptionsFor([...topStudents, ...weakStudents]).map(sec => `<label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input type="checkbox" class="er-section-cb" value="${esc(sec)}" style="width:auto; margin:0;" /> فصل ${esc(sec)}</label>`).join('')}
        </div>
        <button type="button" class="text-action-btn" id="er-print-topbottom" style="width:auto; padding:8px 14px;">🖨 طباعة</button>
        <button type="button" class="text-action-btn" id="er-export-topbottom" style="width:auto; padding:8px 14px;">⬇ تصدير إكسل</button>
        <button type="button" class="text-action-btn" id="er-export-remedial" style="width:auto; padding:8px 14px;" title="ملف وورد منفصل لكل فصل فيه طلاب ضعاف - جاهز للتعبئة اليدوية">📄 خطط علاجية جماعية (وورد)</button>
      </div>`}
    </div>
    ${isLegacyReport ? `<p style="font-size:12px; color:var(--danger); margin:8px 0 0;">هذا التقرير محفوظ بنسخة سابقة من النظام لا تحتوي على بيانات الترتيب - ارفع ملف الإكسل نفسه وأعد حفظ التقرير لعرض هذه القائمة.</p>` : `
    <div class="form-row" style="align-items:stretch; margin-top:10px;">
      ${studentRankTable(topStudents, 'أعلى ١٥ درجة', 'badge-meadow')}
      ${studentRankTable(weakStudents, 'الطلاب الضعاف (أقل من ٥٠٪)', 'badge-danger')}
    </div>`}
    <div class="error-msg" id="er-remedial-error" style="margin-top:8px;"></div>`;

  // تعامل صندوق "كل الفصول" كمستبعد لباقي الصناديق، وأي فصل محدد يلغي تفعيل "كل الفصول" تلقائيًا
  const sectionCbs = Array.from(el.querySelectorAll('.er-section-cb'));
  sectionCbs.forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.value === '__all__') {
        if (cb.checked) sectionCbs.forEach(o => { if (o !== cb) o.checked = false; });
      } else {
        if (cb.checked) {
          const allCb = sectionCbs.find(o => o.value === '__all__');
          if (allCb) allCb.checked = false;
        }
        const anyChecked = sectionCbs.some(o => o.value !== '__all__' && o.checked);
        if (!anyChecked) {
          const allCb = sectionCbs.find(o => o.value === '__all__');
          if (allCb) allCb.checked = true;
        }
      }
    });
  });
  // يرجع مصفوفة الفصول المحددة، أو مصفوفة فاضية لو "كل الفصول" مفعّل (يعني بدون فلترة)
  function getSelectedSections() {
    const allCb = sectionCbs.find(o => o.value === '__all__');
    if (!allCb || allCb.checked) return [];
    return sectionCbs.filter(o => o.value !== '__all__' && o.checked).map(o => o.value);
  }

  const printBtn = document.getElementById('er-print-topbottom');
  const exportBtn = document.getElementById('er-export-topbottom');
  const remedialBtn = document.getElementById('er-export-remedial');
  if (printBtn) printBtn.addEventListener('click', () => {
    const scopeEl = document.getElementById('er-print-scope');
    printTopBottomReport({ ...s, topStudents, weakStudents }, scopeEl ? scopeEl.value : 'both', getSelectedSections());
  });
  if (exportBtn) exportBtn.addEventListener('click', () => {
    exportTopBottomExcel({ ...s, topStudents, weakStudents }, getSelectedSections());
  });
  if (remedialBtn) remedialBtn.addEventListener('click', () => exportRemedialPlans(weakStudents));
}

// يرجع قائمة أرقام الفصول الفريدة الموجودة بقائمة الطلاب، مرتبة تصاعديًا (فصل ١ ثم ٢ ثم ٣...)
function sectionOptionsFor(list) {
  const set = new Set(list.map(st => st.section).filter(v => v !== undefined && v !== null && v !== ''));
  return [...set].sort((a, b) => String(a).localeCompare(String(b), 'ar', { numeric: true }));
}

// ترتيب الطباعة/التصدير المطلوب: الفصول تصاعديًا (١ ثم ٢ ثم ٣...) وداخل كل فصل الأسماء أبجديًا
function sortStudentsForPrint(list) {
  return list.slice().sort((a, b) => {
    const cmpSec = String(a.section ?? '').localeCompare(String(b.section ?? ''), 'ar', { numeric: true });
    if (cmpSec !== 0) return cmpSec;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  });
}

// يفلتر قائمة الطلاب على فصل واحد أو أكثر (مصفوفة sectionFilters؛ فاضية = بدون فلترة، كل الفصول) ثم يرتبها بترتيب الطباعة
function filterAndSortForPrint(list, sectionFilters) {
  const filters = Array.isArray(sectionFilters) ? sectionFilters : (sectionFilters ? [sectionFilters] : []);
  const filtered = filters.length ? list.filter(st => filters.includes(String(st.section))) : list;
  return sortStudentsForPrint(filtered);
}

function studentRankTable(list, title, badgeClass) {
  return `<div class="form-card" style="margin:0;">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
      <h5 style="margin:0; font-size:13px;">${esc(title)}</h5>
      <span class="badge ${badgeClass}">${list.length} طالب</span>
    </div>
    <div style="overflow-x:auto;"><table class="er-table small"><thead><tr>
      <th>#</th><th style="text-align:right;">الاسم</th><th>الفصل</th><th>الدرجة</th><th>النسبة</th>
    </tr></thead><tbody>
      ${list.length ? list.map((st, i) => `<tr>
        <td>${i + 1}</td>
        <td style="text-align:right;">${esc(st.name || st.id || '-')}</td>
        <td>${esc(st.section || '-')}</td>
        <td>${fmt1(st.total)}</td>
        <td>${pct(st.pct)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--slate);">لا يوجد</td></tr>'}
    </tbody></table></div>
  </div>`;
}

/* ---------- طباعة تقرير أعلى/أدنى ١٥ درجة ---------- */
// شعار الترويسة من هوية المدرسة (printLogo بملف core.js)
function printTopBottomReport(s, scope = 'both', sectionFilter = []) {
  const title = currentReport ? currentReport.title : 'تقرير أعلى وأدنى الدرجات';
  const sub = currentReport ? `${currentReport.subject_name || '-'} — ${currentReport.grade_level || '-'} — ${currentReport.semester || '-'}` : '';
  const showTop = scope === 'both' || scope === 'top';
  const showWeak = scope === 'both' || scope === 'weak';
  const pageTitleBase = scope === 'top' ? 'أعلى ١٥ درجة' : scope === 'weak' ? 'الطلاب الضعاف' : 'أعلى ١٥ درجة والطلاب الضعاف';
  const sectionFilters = Array.isArray(sectionFilter) ? sectionFilter : (sectionFilter ? [sectionFilter] : []);
  const pageTitle = sectionFilters.length ? `${pageTitleBase} — فصل ${sectionFilters.join('، ')}` : pageTitleBase;
  const topList = filterAndSortForPrint(s.topStudents, sectionFilters);
  const weakList = filterAndSortForPrint(s.weakStudents, sectionFilters);

  const rowsHtml = (list) => list.length
    ? list.map((st, i) => `<tr>
        <td>${i + 1}</td>
        <td style="text-align:right;">${esc(st.name || st.id || '-')}</td>
        <td>${esc(st.section || '-')}</td>
        <td>${fmt1(st.total)}</td>
        <td>${pct(st.pct)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5">لا يوجد</td></tr>';

  const logoHtml = printLogo() ? `<img src="${printLogo()}" alt="شعار" style="height:50px;" />` : '';
  const colHtml = (heading, list) => `<div>
        <h3>${esc(heading)}</h3>
        <table><thead><tr><th style="width:28px;">#</th><th>الاسم</th><th>الفصل</th><th>الدرجة</th><th>النسبة</th></tr></thead>
        <tbody>${rowsHtml(list)}</tbody></table>
      </div>`;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>${esc(pageTitle)} - ${esc(title)}</title>
<style>
  body { font-family: 'Tajawal', 'Tahoma', Arial, sans-serif; padding: 24px; color:#16233A; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  .doc { max-width: 960px; margin: 0 auto; }
  .header { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #16233A; padding-bottom:14px; margin-bottom:20px; }
  .header h1 { margin:0; font-size:19px; }
  .header p { margin:2px 0 0; font-size:12px; color:#6B7684; }
  .cols { display:flex; gap:18px; }
  .cols > div { flex:1; }
  h3 { font-size:13.5px; margin:0 0 8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  th, td { border:1px solid #999; padding:6px 8px; font-size:11.5px; text-align:center; }
  th { background:#16233A; color:#fff; font-weight:600; }
  tbody tr:nth-child(even) { background:#f7f7f2; }
  .footer-note { margin-top:20px; font-size:10px; color:#999; text-align:center; }
  @media print { body { padding:0; } .cols { display:block; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="header">
      ${logoHtml}
      <div style="text-align:center; flex:1;">
        <h1>تقرير ${esc(pageTitle)}</h1>
        <p>${esc(title)}${sub ? ' — ' + esc(sub) : ''}</p>
      </div>
      <div style="width:50px;"></div>
    </div>
    <div class="cols">
      ${showTop ? colHtml('أعلى ١٥ درجة', topList) : ''}
      ${showWeak ? colHtml('الطلاب الضعاف (أقل من ٥٠٪)', weakList) : ''}
    </div>
    <div class="footer-note">تمت الطباعة من نظام إدارة المدرسة</div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('يرجى السماح بفتح نافذة منبثقة للطباعة'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/* ---------- تصدير تقرير أعلى/أدنى ١٥ درجة لملف إكسل ---------- */
async function exportTopBottomExcel(s, sectionFilter = []) {
  await loadXLSX();
  const title = currentReport ? currentReport.title : 'تقرير';
  const header = ['#', 'الاسم', 'الفصل', 'الدرجة', 'النسبة%'];
  const toRows = (list) => list.map((st, i) => [i + 1, st.name || st.id || '-', st.section || '-', Math.round(st.total * 10) / 10, Math.round(st.pct * 100) / 100]);
  const sectionFilters = Array.isArray(sectionFilter) ? sectionFilter : (sectionFilter ? [sectionFilter] : []);
  const topList = filterAndSortForPrint(s.topStudents, sectionFilters);
  const weakList = filterAndSortForPrint(s.weakStudents, sectionFilters);

  const aoa = [
    ['أعلى ١٥ درجة'], header, ...toRows(topList),
    [],
    ['الطلاب الضعاف (أقل من ٥٠٪)'], header, ...toRows(weakList),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'أعلى الدرجات والضعاف');
  XLSX.writeFile(wb, `${title}_أعلى_الدرجات_والضعاف${sectionFilters.length ? '_فصل' + sectionFilters.join('-') : ''}.xlsx`);
}

/* ---------- تصدير "الخطة العلاجية (الجماعية)" - ملف وورد منفصل لكل فصل فيه طلاب ضعاف ----------
 * نستخدم نفس ملف النموذج الرسمي الأصلي (.docx) بالضبط كقالب - محفوظ بمسار js/templates/remedial-plan-template.docx
 * ومزروع فيه حقول {SCHOOL} {SUBJECT} {GRADE} {SECTION} {DATE} {NAMES} بمكانها الصحيح بالجدول (كل حقل نص واحد
 * متواصل بعنصر <w:t> واحد، تأكدنا من كذا وقت بناء القالب). نعبّيهم باستبدال نص مباشر داخل word/document.xml
 * (بمكتبة JSZip بس، بدون أي مكتبة خارجية زيادة) فتبقى كل التنسيقات (الخطوط، الحدود، خانات الاختيار، نص
 * رأي المعلم...) مطابقة تمامًا للملف الأصلي بدون أي تغيير. نصدّر ملف .docx حقيقي واحد لكل فصل، مضغوطين
 * بملف zip واحد. */
const REMEDIAL_TEMPLATE_URL = new URL('js/templates/remedial-plan-template.docx', window.location.href).href;

// يشيل رموز ممنوعة بأسماء الملفات (Windows/macOS) عشان التنزيل ما يفشل أو يتقطع الاسم
function safeFileName(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function exportRemedialPlans(weakStudents) {
  const errEl = document.getElementById('er-remedial-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!weakStudents.length) {
    if (errEl) { errEl.textContent = 'لا يوجد طلاب ضعاف (أقل من ٥٠٪) في هذا التقرير حاليًا.'; errEl.style.display = 'block'; }
    return;
  }
  try {
    await loadJSZip();
    const templateResp = await fetch(REMEDIAL_TEMPLATE_URL);
    if (!templateResp.ok) throw new Error('تعذر تحميل نموذج الخطة العلاجية (js/templates/remedial-plan-template.docx) - تأكد من أنه مرفوع على الموقع بالمسار نفسه.');
    const templateBuf = await templateResp.arrayBuffer();

    const subject = currentReport ? currentReport.subject_name : '';
    const grade = currentReport ? currentReport.grade_level : '';
    const title = currentReport ? currentReport.title : 'تقرير';
    const dateStr = new Date().toLocaleDateString('ar-SA-u-nu-latn');

    // تجميع الطلاب الضعاف حسب الفصل (الشعبة) - ترتيب طبيعي (١، ٢، ٣... حتى لو نصوص)
    const groups = new Map();
    weakStudents.forEach(st => {
      const key = (st.section || '').trim() || 'بدون فصل محدد';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(st.name || st.id || '-');
    });
    const sortedSections = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));

    const zip = new JSZip();
    for (const section of sortedSections) {
      const sectionLabel = section === 'بدون فصل محدد' ? section : ('الفصل ' + section);
      const names = groups.get(section);
      const namesText = names.map((n, i) => `${i + 1}. ${n}`).join('، ');

      const docZip = await JSZip.loadAsync(templateBuf);
      let xml = await docZip.file('word/document.xml').async('string');
      xml = xml
        .replace(/\{SCHOOL\}/g, escXml(printOrgName()))
        .replace(/\{SUBJECT\}/g, escXml(subject || '-'))
        .replace(/\{GRADE\}/g, escXml(grade || '-'))
        .replace(/\{SECTION\}/g, escXml(sectionLabel))
        .replace(/\{DATE\}/g, escXml(dateStr))
        .replace(/\{NAMES\}/g, escXml(namesText));
      docZip.file('word/document.xml', xml);
      const out = await docZip.generateAsync({ type: 'arraybuffer' });
      // اسم الملف: "خطة علاجية [المادة] [الصف] ف[الفصل]" - مثلاً "خطة علاجية لغتي ثالث متوسط ف1"
      const sectionShort = section === 'بدون فصل محدد' ? section : ('ف' + section);
      const fileTitle = safeFileName(['خطة علاجية', subject, grade, sectionShort].filter(Boolean).join(' ')) || safeFileName(sectionLabel);
      zip.file(`${fileTitle}.docx`, out);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(['خطط علاجية', subject, grade].filter(Boolean).join(' ')) || safeFileName(title)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    if (errEl) { errEl.textContent = (e && e.message) || 'تعذر إنشاء ملفات الخطط العلاجية'; errEl.style.display = 'block'; }
  }
}

/* ---------- رسم بياني بسيط (أعمدة) بستخدام Chart.js - يُحمَّل عند الحاجة فقط ---------- */
let chartLibPromise = null;
function loadChartLib() {
  if (window.Chart) return Promise.resolve();
  if (chartLibPromise) return chartLibPromise;
  chartLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload = resolve;
    s.onerror = () => { chartLibPromise = null; reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')); };
    document.head.appendChild(s);
  });
  return chartLibPromise;
}
const chartInstances = {};
async function drawBarChart(canvasId, labels, data, label, opts = {}) {
  try {
    await loadChartLib();
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) { chartInstances[canvasId].destroy(); delete chartInstances[canvasId]; }

    // يرسم عدد الطلاب فوق كل عمود مباشرة - بدون الحاجة لمكتبة إضافية
    const dataLabelsPlugin = {
      id: 'erDataLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '700 11px Tahoma, Arial, sans-serif';
        ctx.fillStyle = '#3A4351';
        ctx.textAlign = 'center';
        chart.data.datasets[0].data.forEach((v, i) => {
          const bar = meta.data[i];
          if (!bar || !v) return;
          ctx.fillText(String(v), bar.x, bar.y - 6);
        });
        ctx.restore();
      },
    };

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: opts.colors || '#2455A4', borderRadius: 6, maxBarThickness: 52 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#ECEAE1' } },
          x: { grid: { display: false } },
        },
      },
      plugins: [dataLabelsPlugin],
    });
  } catch (e) {
    console.error('chart error:', e);
  }
}


/* =========================================================================
 * الاختبارات الفترية: تصدير النتائج (إكسل) + الغياب لكل فصل
 * الدرجة: كل سؤال اختيار متعدد أو صح وخطأ = درجة، والمقالي بدرجته من الملف.
 * الغائب = طالب بالمنصة بنفس المرحلة والفصل اللي فيهم طلاب بالملف، وما له ورقة بالملف.
 * ========================================================================= */
const GRADE_ORDER = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

const periodicCache = new Map(); // reportId -> نتيجة loadPeriodicData (تنمسح لما تنضاف ورقة)
/* درجة كل طالب من بيانات التقرير المحفوظة: كل طالب بمفتاح نموذجه (أ/ب)، وبدرجة كل سؤال،
 * والمقالي لحاله. تُستخدم في «الدرجات» وفي إحصاءات التقرير شاملة المقالي */
function scoreReportStudents(rep) {
  const rd = rep.raw_data || {};
  const types = rd.itemTypes || [];
  const n = (rd.choiceCounts || []).length || types.length;
  const m = rd.models;
  const PW = i => (Array.isArray(rd.points) && Number.isFinite(+rd.points[i]) ? +rd.points[i] : 1);
  return (rd.students || []).map(st => {
    const isB = !!(m && st.model === MODEL_B && Array.isArray(m.keyB));
    const key = (isB ? m.keyB : (m && Array.isArray(m.keyA) ? m.keyA : rep.key_raw)) || [];
    // بالترتيب المختلف: سؤال النموذج ب رقم i يقابل سؤال النموذج أ رقم orderB[i] (ودرجته منه)
    const toA = i => (isB && m.mode === 'order' && Array.isArray(m.orderB) && m.orderB[i] != null ? m.orderB[i] : i);
    let mcq = 0, tf = 0;
    (st.answers || []).forEach((v, i) => {
      if (i >= n || !keyHit(v, key[i])) return;
      const j = toA(i);
      if (types[j] === 'tf') tf += PW(j); else mcq += PW(j);
    });
    const essay = typeof st.essay === 'number' ? st.essay : null;
    return { st, mcq, tf, obj: mcq + tf, essay };
  });
}
// إحصاءات الملخص بالمجموع الكلي (الموضوعي + المقالي) بدل الموضوعي وحده
function statsWithEssay(stats, rep, model) {
  const rd = (rep && rep.raw_data) || {};
  const essayMax = Number(rd.essayMax) || 0;
  if (!stats || !essayMax || !Array.isArray(rd.students)) return stats;
  const rows = scoreReportStudents(rep).filter(r => !model || (r.st.model || MODEL_A) === model);
  if (!rows.length || !rows.some(r => r.essay != null)) return stats;
  const objMax = Number(stats.maxScore) || Number(stats.itemCount) || 0;
  const maxAll = objMax + essayMax;
  const totals = rows.map(r => r.obj + Math.min(essayMax, Math.max(0, r.essay || 0)));
  const n = totals.length;
  const mean = totals.reduce((a, b) => a + b, 0) / n;
  const sorted = totals.slice().sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const high = sorted[n - 1], low = sorted[0];
  const sd = Math.sqrt(totals.reduce((a, t) => a + (t - mean) * (t - mean), 0) / n);
  const pctOf = t => (maxAll ? (t / maxAll) * 100 : 0);
  const gradeDistribution = GRADE_BANDS.map(b => {
    const freq = totals.filter(t => { const p = pctOf(t); return p >= b.min && p <= b.max; }).length;
    return { grade: b.grade, pctMin: b.min, pctMax: b.max, rawMin: (b.min / 100) * maxAll, rawMax: (b.max / 100) * maxAll, freq, freqPct: (freq / n) * 100 };
  });
  const scoreHistogram = Array.from({ length: 10 }, (_, i) => ({ label: String((i + 1) * 10), count: 0 }));
  totals.forEach(t => { scoreHistogram[Math.min(9, Math.floor(pctOf(t) / 10))].count++; });
  const ranked = rows.map((r, i) => ({ id: r.st.id, name: r.st.name, section: r.st.section, total: totals[i], pct: pctOf(totals[i]) })).sort((a, b) => b.total - a.total);
  return {
    ...stats, withEssay: true, objMax, essayMax, maxScore: maxAll, n, mean, median, high, low, range: high - low, sd, meanPct: pctOf(mean),
    gradeDistribution, scoreHistogram,
    topStudents: ranked.slice(0, 15),
    weakStudents: ranked.filter(r => r.pct < 50).sort((a, b) => a.total - b.total),
    highestStudents: ranked.filter(r => r.total === high).map(r => ({ id: r.id, name: r.name })),
    lowestStudents: ranked.filter(r => r.total === low).map(r => ({ id: r.id, name: r.name })),
  };
}
async function loadPeriodicData(reportId) {
  if (periodicCache.has(reportId)) return periodicCache.get(reportId);
  const { allStudents } = await import('./students-cache.js?v=' + ASSET_VERSION);
  const [{ data: rep, error }, platList] = await Promise.all([
    sb.from('exam_reports').select('id, title, subject_name, key_raw, raw_data').eq('id', reportId).single(),
    allStudents().catch(e => { throw new Error('تعذر تحميل بيانات الطلاب، حدّث الصفحة وحاول مرة أخرى' + (e && e.message ? ` (${e.message})` : '')); }),
  ]);
  if (error || !rep) throw new Error('تعذر تحميل التقرير');
  const rd = rep.raw_data || {};
  const types = rd.itemTypes || [];
  const studs = rd.students || [];
  const nItems = (rd.choiceCounts || []).length || types.length;
  const PW = i => (Array.isArray(rd.points) && Number.isFinite(+rd.points[i]) ? +rd.points[i] : 1);
  const scored = scoreReportStudents(rep).map(({ st, mcq, tf, essay }) =>
    ({ id: String(st.id || '').trim(), name: st.name || '', grade: st.grade || '', section: st.section || '', mcq, tf, essay }));
  // المرحلة والفصل الرسميين من طلاب المنصة (برقم الهوية)
  const plat = new Map(platList.map(p => [String(p.national_id).trim(), p]));
  scored.forEach(x => {
    const p = plat.get(x.id);
    x.gl = p ? p.grade_level : null;
    if (p) { x.name = x.name || p.full_name; x.section = String(p.class_section || x.section || ''); x.grade = gradeLabels[p.grade_level] || x.grade; }
  });
  // الغياب: طلاب نفس الفصول بالمنصة اللي ما لهم ورقة
  const pairs = new Set(scored.filter(x => x.gl && x.section).map(x => x.gl + '|' + Number(x.section)));
  const present = new Set(scored.map(x => x.id));
  const absent = platList.filter(p => pairs.has(p.grade_level + '|' + Number(p.class_section)) && !present.has(String(p.national_id).trim()))
    .map(p => ({ id: String(p.national_id).trim(), name: p.full_name, gl: p.grade_level, grade: gradeLabels[p.grade_level] || '', section: String(p.class_section), absent: true }));
  // المعلم: فصوله بس
  let scoredF = scored, absentF = absent;
  if (isTeacherView()) {
    const { myTeachingScope, inMyClasses } = await import('./teacher-scope.js?v=' + ASSET_VERSION);
    const sc = await myTeachingScope();
    if (sc.classes.length || sc.grades.size) {
      scoredF = scored.filter(x => x.gl && inMyClasses(sc, x.gl, x.section));
      absentF = absent.filter(x => inMyClasses(sc, x.gl, x.section));
    }
  }
  let nMcq = 0, nTf = 0;
  for (let i = 0; i < nItems; i++) { if (types[i] === 'tf') nTf += PW(i); else nMcq += PW(i); }
  const hasEssay = rd.hasEssay || scored.some(x => x.essay != null);
  const out = { rep, scored: scoredF, absent: absentF, nMcq, nTf, hasEssay, essayMax: rd.essayMax || null };
  periodicCache.set(reportId, out);
  return out;
}

const bySection = (a, b) => (GRADE_ORDER.indexOf(a.gl) - GRADE_ORDER.indexOf(b.gl)) || (Number(a.section) || 0) - (Number(b.section) || 0) || String(a.name).localeCompare(String(b.name), 'ar');

async function exportPeriodicResults(reportId) {
  const d = await loadPeriodicData(reportId);
  await loadXLSX();
  const hMcq = `الاختيار من متعدد (من ${d.nMcq})`;
  const hTf = `صح وخطأ (من ${d.nTf})`;
  const hEs = `المقالي${d.essayMax ? ` (من ${d.essayMax})` : ''}`;
  const full = d.nMcq + d.nTf + (d.essayMax || 0);
  const hTot = `المجموع${full ? ` (من ${full})` : ''}`;
  const rows = [...d.scored, ...d.absent].sort(bySection).map(x => {
    const r = { 'رقم الهوية': x.id, 'الاسم': x.name, 'المرحلة': x.grade, 'الفصل': x.section ? Number(x.section) || x.section : '' };
    if (x.absent) {
      if (d.nMcq) r[hMcq] = '';
      if (d.nTf) r[hTf] = '';
      if (d.hasEssay) r[hEs] = '';
      r[hTot] = 'غائب';
      return r;
    }
    if (d.nMcq) r[hMcq] = x.mcq;
    if (d.nTf) r[hTf] = x.tf;
    if (d.hasEssay) r[hEs] = x.essay == null ? '' : x.essay;
    r[hTot] = x.mcq + x.tf + (x.essay || 0);
    return r;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: k === 'الاسم' ? 38 : k === 'رقم الهوية' ? 14 : Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'النتائج');
  const safe = String(d.rep.title || 'نتائج').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  XLSX.writeFile(wb, `${safe} - النتائج.xlsx`);
}

async function showAbsence(reportId) {
  const d = await loadPeriodicData(reportId);
  const groups = new Map();
  const key = x => x.gl + '|' + Number(x.section);
  d.scored.filter(x => x.gl).forEach(x => { if (!groups.has(key(x))) groups.set(key(x), { gl: x.gl, section: x.section, present: 0, absent: [] }); groups.get(key(x)).present++; });
  d.absent.forEach(x => { if (!groups.has(key(x))) groups.set(key(x), { gl: x.gl, section: x.section, present: 0, absent: [] }); groups.get(key(x)).absent.push(x); });
  const list = [...groups.values()].sort(bySection);
  const total = d.absent.length;
  const unknown = d.scored.filter(x => !x.gl).length;
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  back.innerHTML = `<div class="er-abs" role="dialog" aria-modal="true" aria-label="الغياب">
    <div class="er-abs-h"><div><b>الغياب — ${esc(d.rep.title)}</b><span>${total} ${total === 1 ? 'غائب' : 'غائبين'} من ${total + d.scored.length - unknown} طالب</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body">
      ${list.map(g => `<details class="er-abs-sec"${g.absent.length ? '' : ' disabled'}>
        <summary><span class="er-abs-name">${esc(SHORT_GRADE[g.gl] || gradeLabels[g.gl] || '')} ${esc(g.section)}</span><span class="er-abs-n${g.absent.length ? '' : ' zero'}">غياب ${g.absent.length}</span><span class="er-abs-of">من ${g.present + g.absent.length}</span></summary>
        ${g.absent.length ? `<ol>${g.absent.map(x => `<li><span>${esc(x.name)}</span><small>${esc(x.id)}</small></li>`).join('')}</ol>` : ''}
      </details>`).join('') || '<p class="er-abs-empty">تعذّر تحديد فصول الطلاب - تأكد من أن أرقام الهوية في الملف موجودة ضمن طلاب المنصة</p>'}
      ${unknown ? `<p class="er-abs-note">${unknown} طالب في الملف أرقامهم غير موجودة ضمن طلاب المنصة، فلم يُحتسبوا في الفصول</p>` : ''}
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelector('.er-abs-x').onclick = close;
}
const SHORT_GRADE = { first_intermediate: 'أول', second_intermediate: 'ثاني', third_intermediate: 'ثالث' };


/* =========================================================================
 * إضافة ورقة طالب يدويًا لتقرير مرفوع (Remark): تختار الطالب وتظلل إجاباته
 * والتقرير ينحسب من جديد. المعلم يختار من طلاب فصوله بس.
 * ========================================================================= */
async function openManualSheet(rep, onDone) {
  const rd = rep.raw_data || {};
  const n = rep.item_count || (rd.choiceCounts || []).length;
  const counts = rd.choiceCounts || [];
  const types = rd.itemTypes || [];
  const reversed = rd.reversedOrder !== false;
  const hasEssay = !!rd.hasEssay;
  const models = rd.models || null;
  const have = new Set((rd.students || []).map(st => String(st.id || '').trim()));
  // الطلاب
  let students = [];
  {
    const { allStudents } = await import('./students-cache.js?v=' + ASSET_VERSION);
    const data = await allStudents();
    students = (data || []).filter(x => x.national_id);
    if (isTeacherView()) {
      const { myTeachingScope, inMyClasses } = await import('./teacher-scope.js?v=' + ASSET_VERSION);
      const sc = await myTeachingScope();
      const mine = students.filter(x => inMyClasses(sc, x.grade_level, x.class_section));
      // لو ما انعرفت فصوله من الجدول: طلاب صفوف التقرير
      if (mine.length) students = mine;
      else {
        const ids = new Set((rd.students || []).map(st => String(st.id || '').trim()));
        const gs = new Set(students.filter(x => ids.has(String(x.national_id).trim())).map(x => x.grade_level));
        students = students.filter(x => gs.has(x.grade_level));
      }
    }
  }
  const gradesInReport = new Set((rd.students || []).map(st => {
    const p = students.find(x => String(x.national_id).trim() === String(st.id).trim()); return p && p.grade_level;
  }).filter(Boolean));
  const st = { student: null, answers: Array(n).fill(null), essay: null, model: 'أ' };
  const lettersOf = i => (types[i] === 'tf' ? ['صح', 'خطأ'] : ARABIC_LETTERS.slice(0, counts[i] || 4));
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  back.innerHTML = `<div class="er-abs er-man" role="dialog" aria-modal="true" aria-label="إضافة ورقة طالب">
    <div class="er-abs-h"><div><b>إضافة ورقة طالب يدويًا</b><span>${esc(rep.title)} · ${n} سؤال</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body">
      <div class="er-man-st"></div>
      ${models ? `<div class="er-man-model"><span>النموذج:</span><button type="button" data-m="أ" class="on">أ</button><button type="button" data-m="ب">ب</button></div>` : ''}
      <div class="er-man-qs">${Array.from({ length: n }, (_, i) => `<div class="er-man-q" data-q="${i}"><small>${i + 1}</small>${lettersOf(i).map((l, j) => `<button type="button" data-v="${j}">${esc(l)}</button>`).join('')}</div>`).join('')}</div>
      ${hasEssay ? `<label class="er-man-essay">درجة المقالي <input type="number" min="0" step="0.5" inputmode="decimal"${rd.essayMax ? ` max="${rd.essayMax}"` : ''}>${rd.essayMax ? ` / ${rd.essayMax}` : ''}</label>` : ''}
      <div class="er-man-sum"></div>
    </div>
    <div class="er-man-foot"><button type="button" class="btn-primary er-man-save">حفظ الورقة وإعادة حساب التقرير</button></div>
  </div>`;
  document.body.appendChild(back);
  const $b = sel => back.querySelector(sel);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $b('.er-abs-x').onclick = close;

  const renderSt = () => {
    const box = $b('.er-man-st');
    if (st.student) {
      const x = st.student;
      box.innerHTML = `<div class="er-man-chosen"><b>${esc(x.full_name)}</b><span>${esc(gradeLabels[x.grade_level] || '')} ${esc(x.class_section || '')} · ${esc(x.national_id)}</span><button type="button" class="ope-link">تغيير</button></div>`;
      box.querySelector('button').onclick = () => { st.student = null; renderSt(); };
      return;
    }
    const grades = [...new Set(students.map(x => x.grade_level))].filter(Boolean);
    const g0 = gradesInReport.size === 1 ? [...gradesInReport][0] : '';
    box.innerHTML = `<div class="er-man-pick"><div class="er-man-row"><select class="pg"><option value="">كل الصفوف</option>${grades.map(g => `<option value="${g}"${g === g0 ? ' selected' : ''}>${esc(gradeLabels[g] || g)}</option>`).join('')}</select><select class="ps"><option value="">كل الفصول</option></select></div>
      <input type="search" class="pq" placeholder="ابحث بالاسم أو رقم الهوية"><div class="er-man-list"></div></div>`;
    const pg = box.querySelector('.pg'), ps = box.querySelector('.ps'), pq = box.querySelector('.pq'), list = box.querySelector('.er-man-list');
    const fill = () => { const secs = [...new Set(students.filter(x => !pg.value || x.grade_level === pg.value).map(x => x.class_section).filter(v => v != null))].sort((a, b) => a - b); ps.innerHTML = '<option value="">كل الفصول</option>' + secs.map(v => `<option value="${v}">${v}</option>`).join(''); };
    const draw = () => {
      const q = normAr(pq.value);
      const rows = students.filter(x => (!pg.value || x.grade_level === pg.value) && (!ps.value || String(x.class_section) === ps.value) && (!q || normAr(x.full_name).includes(q) || String(x.national_id).includes(q)))
        .sort((a, b) => (have.has(String(a.national_id).trim()) - have.has(String(b.national_id).trim())) || String(a.full_name).localeCompare(String(b.full_name), 'ar')).slice(0, 60);
      list.innerHTML = rows.map(x => { const done = have.has(String(x.national_id).trim()); return `<button type="button" data-id="${esc(x.national_id)}"><b>${esc(x.full_name)}</b><small>${esc(gradeLabels[x.grade_level] || '')} ${esc(x.class_section || '')}${done ? ' · له ورقة بالتقرير (الحفظ يستبدلها)' : ''}</small></button>`; }).join('') || `<span class="omr-empty">${students.length ? 'لا توجد نتائج' : 'لا يوجد طلاب متاحون لك - تأكد من تسجيل تخصصاتك في «تخصصات المعلمين» أو من وجود حصصك في الجدول الدراسي'}</span>`;
      list.querySelectorAll('button').forEach(b => b.onclick = () => { st.student = students.find(x => String(x.national_id) === b.dataset.id); renderSt(); });
    };
    pg.onchange = () => { fill(); draw(); }; ps.onchange = draw; pq.oninput = draw;
    fill(); draw();
  };
  const keyFor = () => (models && st.model === 'ب' && models.keyB ? models.keyB : (models ? models.keyA : rep.key_raw)) || [];
  const toRaw = (i, j) => (j == null ? -2 : reversed ? (counts[i] || 4) - j : j + 1);
  const renderSum = () => {
    const key = keyFor();
    let ok = 0, blank = 0;
    st.answers.forEach((j, i) => { if (j == null) blank++; else if (keyHit(toRaw(i, j), key[i])) ok++; });
    $b('.er-man-sum').innerHTML = `<b>${ok}</b> / ${n} صحيحة${blank ? ` · ${blank} بدون إجابة` : ''}${hasEssay && st.essay != null ? ` · مقالي ${st.essay}` : ''}`;
    back.querySelectorAll('.er-man-q').forEach(row => {
      const i = +row.dataset.q;
      row.querySelectorAll('button').forEach(b => {
        const j = +b.dataset.v;
        b.classList.toggle('on', st.answers[i] === j);
        b.classList.toggle('key', keyHit(toRaw(i, j), key[i]));
      });
    });
  };
  back.querySelectorAll('.er-man-q button').forEach(b => b.onclick = () => { const i = +b.closest('.er-man-q').dataset.q, j = +b.dataset.v; st.answers[i] = st.answers[i] === j ? null : j; renderSum(); });
  back.querySelectorAll('.er-man-model button').forEach(b => b.onclick = () => { st.model = b.dataset.m; back.querySelectorAll('.er-man-model button').forEach(x => x.classList.toggle('on', x === b)); renderSum(); });
  const ei = $b('.er-man-essay input');
  if (ei) ei.oninput = () => { st.essay = ei.value === '' ? null : Number(ei.value); renderSum(); };
  renderSt(); renderSum();

  $b('.er-man-save').onclick = async () => {
    if (!st.student) { alert('اختر الطالب أولًا'); return; }
    const btn = $b('.er-man-save'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    const x = st.student;
    const row = {
      id: String(x.national_id).trim(), name: x.full_name, grade: gradeLabels[x.grade_level] || '', section: String(x.class_section || ''),
      subject: rep.subject_name || '', modelRaw: null, answers: st.answers.map((j, i) => toRaw(i, j)), essay: st.essay, manual: true,
    };
    if (models) row.model = st.model;
    const list = (rd.students || []).filter(s2 => String(s2.id).trim() !== row.id).map(s2 => { const { key, ...rest } = s2; return rest; });
    list.push(row);
    let upd;
    if (models) {
      const g = gradeWithModels({
        parsed: { itemCount: n, choiceCounts: counts, itemTypes: types, students: list, points: rd.points || null },
        keyA: models.keyA, keyB: models.keyB, mode: models.mode, orderB: models.orderB, reversedOrder: reversed, keyId: models.keyId,
        modelOf: s2 => s2.model || 'أ',
      });
      upd = { stats: g.stats, raw_data: { ...rd, ...g.raw_data }, students_count: list.length };
    } else {
      const stats = computeExamStats({ itemCount: n, keyRaw: rep.key_raw, choiceCounts: counts, students: list, reversedOrder: reversed, itemTypes: types, points: rd.points || null });
      upd = { stats, raw_data: { ...rd, students: list }, students_count: list.length };
    }
    let error;
    if (!isTeacherView() || rep.created_by === currentUserId) ({ error } = await sb.from('exam_reports').update(upd).eq('id', rep.id));
    else {
      // المعلم على تقرير الإدارة: يضيف ورقة طالب واحدة بس (دالة بقاعدة البيانات)
      const saved = (upd.raw_data.students || []).find(s2 => String(s2.id).trim() === row.id) || row;
      ({ error } = await sb.rpc('exam_report_put_sheet', { p_report: rep.id, p_student: saved, p_stats: upd.stats }));
    }
    if (error) { btn.disabled = false; btn.textContent = 'حفظ الورقة وإعادة حساب التقرير'; alert('تعذر الحفظ: ' + error.message); return; }
    periodicCache.delete(rep.id);
    close();
    if (onDone) onDone(); else openReport(rep.id);
  };
}


// استعراض النتائج: الفصول، وداخل كل فصل الطلاب ومجموع درجاتهم (الغائب مكتوب غائب)
async function showResults(reportId) {
  const d = await loadPeriodicData(reportId);
  const full = d.nMcq + d.nTf + (d.essayMax || 0);
  const totalOfX = x => x.mcq + x.tf + (x.essay || 0);
  const groups = new Map();
  const key = x => (x.gl || '?') + '|' + (Number(x.section) || 0);
  [...d.scored, ...d.absent].forEach(x => {
    if (!groups.has(key(x))) groups.set(key(x), { gl: x.gl, section: x.section, rows: [] });
    groups.get(key(x)).rows.push(x);
  });
  const list = [...groups.values()].sort(bySection);
  const fmtN = n => (Math.round(n * 10) / 10).toString();
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  back.innerHTML = `<div class="er-abs er-res" role="dialog" aria-modal="true" aria-label="النتائج">
    <div class="er-abs-h"><div><b>النتائج — ${esc(d.rep.title)}</b><span>${d.scored.length} طالب${full ? ` · الدرجة من ${full}` : ''}${d.absent.length ? ` · ${d.absent.length} غائب` : ''}</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body">
      ${list.map((g, gi) => {
        const pres = g.rows.filter(x => !x.absent);
        const avg = pres.length ? pres.reduce((a, x) => a + totalOfX(x), 0) / pres.length : 0;
        const rows = g.rows.slice().sort((a, b) => ((a.absent ? 1 : 0) - (b.absent ? 1 : 0)) || (a.absent ? 0 : totalOfX(b) - totalOfX(a)) || String(a.name).localeCompare(String(b.name), 'ar'));
        return `<details class="er-abs-sec"${gi === 0 ? ' open' : ''}>
          <summary><span class="er-abs-name">${g.gl ? esc((SHORT_GRADE[g.gl] || gradeLabels[g.gl] || '') + ' ' + (g.section || '')) : 'غير محدد الفصل'}</span><span class="er-abs-of">${pres.length} طالب · المتوسط ${fmtN(avg)}${full ? ' / ' + full : ''}</span></summary>
          <table class="er-res-t"><thead><tr><th>#</th><th>الطالب</th>${d.nMcq ? '<th>اختيار</th>' : ''}${d.nTf ? '<th>ص/خ</th>' : ''}${d.hasEssay ? '<th>مقالي</th>' : ''}<th>المجموع</th></tr></thead><tbody>
          ${rows.map((x, i) => x.absent
            ? `<tr class="abs"><td>${i + 1}</td><td>${esc(x.name)}</td><td colspan="${(d.nMcq ? 1 : 0) + (d.nTf ? 1 : 0) + (d.hasEssay ? 1 : 0) + 1}">غائب</td></tr>`
            : `<tr class="${full && totalOfX(x) < full / 2 ? 'weak' : ''}"><td>${i + 1}</td><td>${esc(x.name || x.id)}</td>${d.nMcq ? `<td>${fmtN(x.mcq)}</td>` : ''}${d.nTf ? `<td>${fmtN(x.tf)}</td>` : ''}${d.hasEssay ? `<td>${x.essay == null ? '—' : fmtN(x.essay)}</td>` : ''}<td><b>${fmtN(totalOfX(x))}</b></td></tr>`).join('')}
          </tbody></table>
        </details>`;
      }).join('') || '<p class="er-abs-empty">لا توجد نتائج</p>'}
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelector('.er-abs-x').onclick = close;
}
