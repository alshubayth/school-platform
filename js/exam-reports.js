import { ASSET_VERSION, sb, currentUserId, currentProfile, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool, setSubRoute, gradeLabels, printOrgName, printLogo } from './core.js';
import { loadXLSX, loadJSZip } from './lib-loader.js';
import { initAnswerSheetCard, fetchSavedKeys, itemKinds } from './answer-sheet.js';

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

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
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
    else if (col.model == null && (c === 'النموذج' || c === 'نموذج' || /^(form|version|model)$/i.test(c))) col.model = idx;
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
function letterFor(value, numChoices, reversed = true) {
  if (typeof value !== 'number' || value <= 0) return null;
  const idx = reversed ? numChoices - value : value - 1;
  return ARABIC_LETTERS[idx] || ('اختيار ' + value);
}
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
export function parseSheetRows(rows) {
  if (!rows || rows.length < 2) throw new Error('الملف فاضي أو ما فيه بيانات كافية');
  const header = rows[0];
  const { col, items, itemTypes } = detectColumns(header);
  if (col.id == null && col.name == null) throw new Error('ما لقيت عمود "StudentID" (رقم الهوية) ولا عمود اسم الطالب بالملف');
  if (items.length === 0) throw new Error('ما لقيت أعمدة الأسئلة (اختيار متعدد) بالملف');

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
      modelRaw: col.model != null && r[col.model] !== '' && r[col.model] != null && Number.isFinite(Number(r[col.model])) ? Number(r[col.model]) : null,
      answers: items.map(ci => {
        const v = r[ci];
        if (v === '' || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }),
    }));

  const keyRows = allRows.filter(isKeyRow);
  const detectedKeyRow = keyRows[0] || null;
  const students = allRows.filter(r => !isKeyRow(r));
  if (students.length === 0) throw new Error('ما فيه طلاب بالملف');

  const choiceCounts = computeChoiceCounts(items, students.concat(detectedKeyRow ? [detectedKeyRow] : []), itemTypes);

  return {
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
  return letterSelections.map((letter, i) => valueForLetter(letter, choiceCounts[i], reversed));
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
export function computeExamStats({ itemCount, keyRaw, choiceCounts, students, reversedOrder = true, itemTypes = [] }) {
  const n = students.length;

  // كل طالب يتصحّح بمفتاح نموذجه (s.key) لو الاختبار بأكثر من نموذج، وإلا بالمفتاح العام
  const K = st => st.key || keyRaw;
  const isCorrectSt = (st, i) => st.answers[i] != null && st.answers[i] === K(st)[i];
  const totals = students.map(st => {
    let t = 0;
    for (let i = 0; i < itemCount; i++) if (isCorrectSt(st, i)) t++;
    return t;
  });

  const mean = totals.reduce((a, b) => a + b, 0) / n;
  const sorted = totals.slice().sort((a, b) => a - b);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const high = Math.max(...totals);
  const low = Math.min(...totals);
  const variance = totals.reduce((s, t) => s + (t - mean) * (t - mean), 0) / n;
  const sd = Math.sqrt(variance);
  const meanPct = itemCount ? (mean / itemCount) * 100 : 0;

  // ---- تقرير ١: التوزيع التكراري للصف (A-F) ----
  const gradeDistribution = GRADE_BANDS.map(b => {
    const rawMin = (b.min / 100) * itemCount;
    const rawMax = (b.max / 100) * itemCount;
    const freq = totals.filter(t => {
      const p = itemCount ? (t / itemCount) * 100 : 0;
      return p >= b.min && p <= b.max;
    }).length;
    return { grade: b.grade, pctMin: b.min, pctMax: b.max, rawMin, rawMax, freq, freqPct: n ? (freq / n) * 100 : 0 };
  });

  // ---- تقرير ٢: الرسم البياني لتقدير الطالب (10 فئات بالدرجة المئوية) ----
  const scoreHistogram = Array.from({ length: 10 }, (_, i) => ({ label: String((i + 1) * 10), count: 0 }));
  totals.forEach(t => {
    const p = itemCount ? (t / itemCount) * 100 : 0;
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
  for (let i = 0; i < itemCount; i++) {
    const numChoices = choiceCounts[i];
    // لو الطلاب بنماذج إجابتها الصحيحة تختلف بهذا السؤال، الحروف ما تنقارن ببعض - نعرض صحيح/خطأ بس
    const keyVals = new Set(students.map(st => K(st)[i]));
    const mixedKey = keyVals.size > 1;
    const correctLetter = mixedKey ? 'حسب النموذج' : letterFor(students.length ? K(students[0])[i] : keyRaw[i], numChoices, reversedOrder);
    const freqMap = new Map(); // key: label -> {count, isCorrect, sortVal}
    let correctCount = 0, notPresent = 0, multi = 0;
    students.forEach(st => {
      const v = st.answers[i];
      const ok = v != null && v === K(st)[i];
      let label, sortVal;
      if (v == null || v === -2) { label = 'لا توجد استجابة'; sortVal = 1000; notPresent++; }
      else if (v === -3) { label = 'متعدد'; sortVal = 999; multi++; }
      else if (typeof v === 'number' && v > 0) {
        if (mixedKey) { label = ok ? 'إجابة صحيحة' : 'إجابة خاطئة'; sortVal = ok ? 1 : 2; }
        else { label = letterFor(v, numChoices, reversedOrder); sortVal = v; }
      }
      else { label = 'لا توجد استجابة'; sortVal = 1000; notPresent++; }
      if (!freqMap.has(label)) freqMap.set(label, { label, count: 0, isCorrect: mixedKey ? label === 'إجابة صحيحة' : label === correctLetter, sortVal });
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
    pct: itemCount ? (totals[idx] / itemCount) * 100 : 0,
  })).sort((a, b) => b.total - a.total);
  const topStudents = ranked.slice(0, 15);
  // الطلاب الضعاف: أي طالب تحقيقه أقل من ٥٠٪ من الدرجة (مو رقم ثابت) - بالاسم، من الأدنى للأعلى
  const weakStudents = ranked.filter(r => r.pct < 50).slice().sort((a, b) => a.total - b.total);

  return {
    n, itemCount, mean, median, high, low, range: high - low, sd, meanPct, kr20, reliabilityBand,
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
  return choiceCounts.map((c, i) => (idxArr && idxArr[i] != null ? valueForLetter(ARABIC_LETTERS[idxArr[i]], c, reversed) : null));
}
// نموذج الطالب من تظليله بالورقة: نفس ترميز الأسئلة (عربي معكوس: ٢ = أ، ١ = ب)
function fileModel(st, reversed = true) {
  const v = st && st.modelRaw;
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
  const base = { itemCount: n, choiceCounts: parsed.choiceCounts, reversedOrder, itemTypes: parsed.itemTypes || [] };
  const stats = computeExamStats({ ...base, keyRaw: keyA, students: graded });
  const byModel = {};
  [MODEL_A, MODEL_B].forEach(m => {
    const sub = graded.filter(st => st.model === m).map(({ key, ...rest }) => rest);
    if (sub.length) byModel[m] = computeExamStats({ ...base, keyRaw: m === MODEL_B ? keyBA : keyA, students: sub });
  });
  stats.models = { mode, counts: { [MODEL_A]: tagged.filter(st => st.model === MODEL_A).length, [MODEL_B]: tagged.filter(st => st.model === MODEL_B).length } };
  stats.itemsMixed = mode === 'different';
  stats.byModel = byModel;
  const raw_data = { students: tagged, choiceCounts: parsed.choiceCounts, itemTypes: parsed.itemTypes || [], reversedOrder, models: { keyId: keyId || null, mode, keyA, keyB, orderB: orderB || null } };
  return { stats, raw_data, key_raw: keyA };
}

function renderModelSummary(parsed) {
  const k = parsed.modelKey;
  const map = k.model_map || {};
  const idOf = st => String(st.id || '').trim();
  const rev = document.getElementById('er-reversed-order').checked;
  const mOf = st => fileModel(st, rev) || map[idOf(st)] || null;
  const a = parsed.students.filter(st => mOf(st) === MODEL_A).length;
  const b = parsed.students.filter(st => mOf(st) === MODEL_B).length;
  const unknown = parsed.students.filter(st => !mOf(st));
  const fromFile = parsed.students.filter(st => fileModel(st, rev)).length;
  document.getElementById('er-key-form').innerHTML = `<div class="er-models-sum">
    <div class="er-models-h"><b>اختبار بنموذجين</b><span>${esc(MODE_LABELS[k.models.mode] || '')}</span></div>
    <div class="dd-stats" style="margin:8px 0;">
      <span class="ds ds-all"><b>${a}</b> نموذج أ</span>
      <span class="ds ds-present"><b>${b}</b> نموذج ب</span>
      ${unknown.length ? `<span class="ds ds-late"><b>${unknown.length}</b> ما عُرف نموذجهم</span>` : ''}
    </div>
    <p class="er-models-p">${fromFile ? `نموذج ${fromFile} طالب مقروء من تظليلهم بالورقة. ` : ''}كل طالب يتصحّح بإجابة نموذجه تلقائيًا. لتعديل الإجابات: عدّل المفتاح من "ورقة إجابة للتصحيح الآلي" واحفظه.</p>
    ${unknown.length ? `<div class="er-unknown"><p>هذول ما عرفت نموذجهم (ما ظلّلوه، أو ظلّلوا الاثنين، أو أوراقهم ما انطبعت من المنصة) - اختر نموذج كل واحد:</p>
      ${unknown.map(st => `<label class="er-unk-row"><span>${esc(st.name || st.id)}</span><small>${esc(st.id)}</small>
        <select class="er-model-pick" data-id="${esc(idOf(st))}"><option value="أ">نموذج أ</option><option value="ب">نموذج ب</option></select></label>`).join('')}</div>` : ''}
  </div>`;
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
  if (!isTeacherView()) initAnswerSheetCard();
  if (sub === 'sheet' && !isTeacherView()) { setMode('sheet', false); loadSavedList(); return; }
  if (sub === 'camera') { setMode('camera', false); loadSavedList(); return; }
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

document.getElementById('er-analyze-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('er-analyze-error');
  errEl.style.display = 'none';
  const file = document.getElementById('er-file').files[0];
  if (!file) { errEl.textContent = 'اختر ملف إكسل أولاً'; errEl.style.display = 'block'; return; }

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

    const keyNote = parsedData.detectedKeyRaw
      ? ' — لقيت صف نموذج جاهز بالملف وعبّيت الإجابات منه، راجعها/عدّلها بالأسفل'
      : ' — عبّي الإجابة الصحيحة لكل سؤال بالأسفل';
    document.getElementById('er-preview-summary').innerHTML =
      `تم العثور على <strong>${parsedData.students.length}</strong> طالب، و<strong>${parsedData.itemCount}</strong> سؤال${keyNote}`;
    document.getElementById('er-title').value = '';
    document.getElementById('er-subject').value = parsedData.detected.subject || '';
    document.getElementById('er-grade').value = parsedData.detected.grade || '';
    document.getElementById('er-semester').value = '';
    document.getElementById('er-reversed-order').checked = guessReversedOrder(parsedData.detected.subject);
    renderKeyForm(parsedData, document.getElementById('er-reversed-order').checked);
    await setupSavedKeyPicker(parsedData);
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
function renderKeyForm(parsed, reversed = true) {
  if (parsed.modelKey) { renderModelSummary(parsed); return; }
  const el = document.getElementById('er-key-form');
  el.innerHTML = `<div class="er-key-grid">${parsed.choiceCounts.map((numChoices, i) => {
    const options = ARABIC_LETTERS.slice(0, numChoices);
    const preselect = parsed.presetLetters ? (parsed.presetLetters[i] || null)
      : (parsed.detectedKeyRaw ? letterFor(parsed.detectedKeyRaw[i], numChoices, reversed) : null);
    return `<div class="er-key-item">
      <label>سؤال ${i + 1}</label>
      <select class="er-key-select" data-item="${i}">
        <option value="">اختر...</option>
        ${options.map(o => `<option value="${o}"${o === preselect ? ' selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`;
  }).join('')}</div>`;
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
    if (matches.length > 1) msg.textContent += ` (فيه ${matches.length} مفاتيح بنفس عدد الأسئلة - تأكد إنه الصحيح)`;
  } else {
    msg.textContent = erSavedKeys.length
      ? `ما فيه مفتاح محفوظ بنفس عدد أسئلة الملف (${parsed.itemCount}) - أدخل المفتاح يدويًا أو احفظه من بطاقة ورقة الإجابة`
      : 'ما فيه مفاتيح محفوظة بعد - تقدر تحفظها من بطاقة "ورقة إجابة للتصحيح الآلي"';
  }
}

function applySavedKey(k) {
  if (!parsedData) return;
  const msg = document.getElementById('er-saved-key-msg');
  if (k && k.models && k.models.mode) parsedData.modelKey = k; else delete parsedData.modelKey;
  if (!k) {
    delete parsedData.presetLetters;
    if (parsedData._origItemTypes) parsedData.itemTypes = parsedData._origItemTypes.slice();
    parsedData.choiceCounts = parsedData._origChoiceCounts.slice();
    msg.textContent = '';
    renderKeyForm(parsedData, document.getElementById('er-reversed-order').checked);
    return;
  }
  parsedData.presetLetters = (k.answers || []).map(i => (i == null ? null : ARABIC_LETTERS[i]));
  // مفتاح فيه أسئلة صح وخطأ: نوع كل سؤال وعدد خياراته من المفتاح نفسه
  if (!parsedData._origItemTypes) parsedData._origItemTypes = (parsedData.itemTypes || []).slice();
  if (k.tf_count && k.questions === parsedData.itemCount) {
    const kinds = itemKinds({ questions: k.questions, tf: k.tf_count, tfFirst: k.tf_first !== false });
    parsedData.itemTypes = kinds;
    parsedData.choiceCounts = kinds.map(t => (t === 'tf' ? 2 : k.choices));
  } else {
    parsedData.itemTypes = parsedData._origItemTypes.slice();
    parsedData.choiceCounts = parsedData._origChoiceCounts.map((c, i) => (parsedData.itemTypes[i] === 'tf' ? c : k.choices));
  }
  const observedMax = Math.max(0, ...parsedData.students.flatMap(st => st.answers.filter(v => typeof v === 'number')));
  document.getElementById('er-reversed-order').checked = k.lang !== 'en';
  if (!document.getElementById('er-title').value.trim()) document.getElementById('er-title').value = k.title || '';
  if (!document.getElementById('er-subject').value.trim() && k.subject) document.getElementById('er-subject').value = k.subject;
  renderKeyForm(parsedData, document.getElementById('er-reversed-order').checked);
  msg.textContent = `تم تطبيق المفتاح "${k.title}" ✓ راجع الإجابات واضغط "حفظ التقرير"`;
  if (observedMax > k.choices) msg.textContent += ` — تنبيه: بالملف قيم أكبر من عدد الخيارات بالمفتاح (${k.choices})، تأكد إن الملف لنفس الاختبار`;
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
  if (!parsedData) { errEl.textContent = 'حلّل الملف أولاً'; errEl.style.display = 'block'; return; }
  const title = document.getElementById('er-title').value.trim();
  if (!title) { errEl.textContent = 'اكتب عنوان للتقرير'; errEl.style.display = 'block'; return; }

  if (parsedData.modelKey) {
    const k = parsedData.modelKey;
    const map = k.model_map || {};
    const picks = {};
    document.querySelectorAll('.er-model-pick').forEach(sel => { picks[sel.dataset.id] = sel.value; });
    const reversedOrder = document.getElementById('er-reversed-order').checked;
    const g = gradeWithModels({
      parsed: parsedData,
      keyA: rawFromIdx(k.answers, parsedData.choiceCounts, reversedOrder),
      keyB: rawFromIdx(k.models.answers_b, parsedData.choiceCounts, reversedOrder),
      mode: k.models.mode, orderB: k.models.order_b, reversedOrder, keyId: k.id,
      modelOf: st => { const id = String(st.id || '').trim(); return fileModel(st, reversedOrder) || map[id] || picks[id] || MODEL_A; },
    });
    const { error } = await writeWithSchool(extra => sb.from('exam_reports').insert({
      title,
      subject_name: document.getElementById('er-subject').value.trim() || null,
      grade_level: document.getElementById('er-grade').value.trim() || null,
      semester: document.getElementById('er-semester').value || null,
      item_count: parsedData.itemCount,
      students_count: parsedData.students.length,
      key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data,
      created_by: currentUserId,
      ...extra,
    }));
    if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }
    parsedData = null;
    document.getElementById('er-preview-card').classList.add('hidden');
    document.getElementById('er-file').value = '';
    openUpload(false);
    await loadSavedList();
    return;
  }

  const selects = Array.from(document.querySelectorAll('.er-key-select'));
  const letterSelections = selects.map(s => s.value);
  if (letterSelections.some(v => !v)) {
    errEl.textContent = 'اختر الإجابة الصحيحة لكل سؤال قبل الحفظ';
    errEl.style.display = 'block';
    return;
  }
  const reversedOrder = document.getElementById('er-reversed-order').checked;
  const keyRaw = buildManualKey(letterSelections, parsedData.choiceCounts, reversedOrder);

  const stats = computeExamStats({ ...parsedData, keyRaw, reversedOrder });
  const { error } = await writeWithSchool(extra => sb.from('exam_reports').insert({
    title,
    subject_name: document.getElementById('er-subject').value.trim() || null,
    grade_level: document.getElementById('er-grade').value.trim() || null,
    semester: document.getElementById('er-semester').value || null,
    item_count: parsedData.itemCount,
    students_count: parsedData.students.length,
    key_raw: keyRaw,
    stats,
    // نحفظ إجابات الطلاب الخام كمان (مو بس النتيجة المحسوبة) عشان لو المدير احتاج يعدّل
    // مفتاح الإجابة بعدين نقدر نعيد الحساب بدون ما يرفع نفس الملف مرة ثانية - وكذلك اتجاه
    // ترميز الاختيارات المستخدم عشان تعديل المفتاح لاحقًا يفهم نفس الحروف صح
    raw_data: { students: parsedData.students, choiceCounts: parsedData.choiceCounts, itemTypes: parsedData.itemTypes, reversedOrder },
    created_by: currentUserId,
    ...extra,
  }));
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  parsedData = null;
  document.getElementById('er-preview-card').classList.add('hidden');
  document.getElementById('er-file').value = '';
  openUpload(false);
  await loadSavedList();
});

async function loadSavedList() {
  const listEl = document.getElementById('er-saved-list');
  const res = await readScopedBySchool(scoped => {
    let q = sb.from('exam_reports')
      .select('id, title, subject_name, grade_level, semester, item_count, students_count, created_at, created_by, source');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('created_at', { ascending: false });
  });
  let data = res.data, error = res.error;
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
  if (isTeacherView()) data = (data || []).filter(r => r.created_by === currentUserId);
  if (!data || data.length === 0) {
    listEl.innerHTML = isTeacherView()
      ? '<div class="ex-empty"><b>ما فيه تقارير لك بعد</b><span>صحّح أوراق طلابك من تبويب «التصحيح بالجوال» ويطلع التقرير هنا تلقائيًا.</span></div>'
      : '<div class="ex-empty"><b>ما فيه تقارير محفوظة بعد</b><span>صحّح أوراق الطلاب في Remark، ثم اضغط «+ رفع نتائج اختبار» وارفع ملف الإكسل.</span></div>';
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
  const colors = [
    { bg: 'var(--teal-light)', fg: 'var(--teal)' },
    { bg: 'var(--gold-light)', fg: 'var(--gold)' },
    { bg: 'var(--purple-light)', fg: 'var(--purple)' },
    { bg: 'var(--meadow-light)', fg: 'var(--meadow-dark)' },
  ];
  const examIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px; height:26px;"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;

  const gradeName = g => gradeLabels[g] || g || '';
  const dateTxt = d => { try { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  listEl.innerHTML = `<div class="er-report-grid">
    ${data.map((r, i) => {
      const c = colors[i % colors.length];
      const meta = [r.subject_name, gradeName(r.grade_level), r.semester].filter(Boolean).map(esc).join(' · ');
      return `
      <div data-id="${r.id}" class="er-report-card" tabindex="0" role="button" title="${esc(r.title)}">
        <span class="erc-ic" style="background:${c.bg}; color:${c.fg};">${examIconSvg}</span>
        <span class="erc-main">
          <b>${esc(r.title)}</b>
          <span>${meta || '&nbsp;'}</span>
          <span class="erc-chips">${r.source === 'camera' ? '<i class="erc-cam">📷 بالجوال</i>' : ''}${r.students_count != null ? `<i>${r.students_count} طالب</i>` : ''}${r.item_count != null ? `<i>${r.item_count} سؤال</i>` : ''}${r.created_at ? `<i>${dateTxt(r.created_at)}</i>` : ''}${names[r.created_by] && r.source === 'camera' ? `<i>صححه: ${esc(names[r.created_by])}</i>` : ''}</span>
        </span>
        <button type="button" class="er-delete-btn" data-id="${r.id}" title="حذف التقرير" aria-label="حذف التقرير">✕</button>
      </div>`;
    }).join('')}
  </div>`;
  listEl.querySelectorAll('.er-report-card').forEach(card => card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openReport(card.dataset.id); }));

  listEl.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.er-delete-btn')) return;
      openReport(card.dataset.id);
    });
  });
  listEl.querySelectorAll('.er-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('متأكد تبي تحذف هذا التقرير؟')) return;
      await sb.from('exam_reports').delete().eq('id', btn.dataset.id);
      await loadSavedList();
    });
  });
  return data.length;
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
  renderReportStats(data.stats);
  const ekb = document.getElementById('er-edit-key-btn');
  ekb.textContent = data.raw_data && data.raw_data.models ? '↻ إعادة التصحيح بالمفتاح المحفوظ' : '✎ تعديل مفتاح الإجابة';
  // تقرير الجوال ينبني من الأوراق المصححة: التعديل يكون من شاشة التصحيح نفسها
  const cam = data.source === 'camera';
  ekb.classList.toggle('hidden', cam || isTeacherView());
  document.getElementById('er-update-file-btn').classList.toggle('hidden', cam || isTeacherView());
  const cc = document.getElementById('er-camera-continue');
  cc.classList.toggle('hidden', !(cam && data.created_by === currentUserId && data.key_id));
  cc.onclick = () => { cameraKeyId = data.key_id; document.getElementById('er-detail-view').classList.add('hidden'); document.getElementById('er-list-view').classList.remove('hidden'); setMode('camera'); };
  document.getElementById('er-editkey-card').classList.add('hidden');
  document.getElementById('er-updatefile-card').classList.add('hidden');
}

/* ---------- تحديث ملف الإكسل لتقرير محفوظ - يبقي الإجابة الصحيحة كما هي ---------- */
document.getElementById('er-update-file-btn').addEventListener('click', () => {
  if (!currentReport) return;
  document.getElementById('er-editkey-card').classList.add('hidden');
  const errEl = document.getElementById('er-updatefile-error');
  errEl.style.display = 'none';
  document.getElementById('er-update-file').value = '';
  if (!currentReport.raw_data || !Array.isArray(currentReport.raw_data.choiceCounts)) {
    errEl.textContent = 'هذا تقرير محفوظ بنسخة سابقة من النظام ما تحتوي بيانات كافية لتحديث الملف بدون تعديل يدوي - احذفه وارفعه من جديد.';
    errEl.style.display = 'block';
  }
  document.getElementById('er-updatefile-card').classList.remove('hidden');
  document.getElementById('er-updatefile-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.getElementById('er-updatefile-cancel').addEventListener('click', () => {
  document.getElementById('er-updatefile-card').classList.add('hidden');
});

document.getElementById('er-updatefile-confirm').addEventListener('click', async () => {
  const errEl = document.getElementById('er-updatefile-error');
  errEl.style.display = 'none';
  if (!currentReport || !currentReport.raw_data || !Array.isArray(currentReport.raw_data.choiceCounts)) {
    errEl.textContent = 'ما فيه بيانات كافية بالتقرير الحالي لتحديثه بهذي الطريقة.';
    errEl.style.display = 'block';
    return;
  }
  const file = document.getElementById('er-update-file').files[0];
  if (!file) { errEl.textContent = 'اختر ملف إكسل أولاً'; errEl.style.display = 'block'; return; }

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

    const { choiceCounts: oldChoiceCounts, reversedOrder = true } = currentReport.raw_data;
    if (newParsed.itemCount !== oldChoiceCounts.length) {
      errEl.textContent = `عدد أسئلة الملف الجديد (${newParsed.itemCount}) ما يطابق عدد أسئلة التقرير الحالي (${oldChoiceCounts.length}) - لازم يكون نفس عدد الأسئلة عشان يبقى نفس مفتاح الإجابة صحيح. لو الاختبار مختلف كليًا، ارفعه كتقرير جديد بدل التحديث.`;
      errEl.style.display = 'block';
      return;
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
        const conv = raw => buildManualKey(oldChoiceCounts.map((c, i) => letterFor(raw[i], c, reversedOrder)), newParsed.choiceCounts, reversedOrder);
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
      return;
    }

    // نحوّل مفتاح الإجابة الحالي (قيم خام) لحروف باستخدام بيانات الترميز القديمة، وبعدين نبنيه
    // من جديد بنفس الحروف على قيم الملف الجديد - عشان الإجابة الصحيحة (بالحرف) تبقى كما هي
    // حتى لو الترميز الخام اختلف شوي بين الملفين
    const letters = oldChoiceCounts.map((numChoices, i) => letterFor(currentReport.key_raw[i], numChoices, reversedOrder));
    if (letters.some(l => !l)) {
      errEl.textContent = 'تعذر قراءة مفتاح الإجابة الحالي لتطبيقه على الملف الجديد - استخدم "تعديل مفتاح الإجابة" بدالًا من ذلك.';
      errEl.style.display = 'block';
      return;
    }
    const newKeyRaw = buildManualKey(letters, newParsed.choiceCounts, reversedOrder);
    const stats = computeExamStats({ ...newParsed, keyRaw: newKeyRaw, reversedOrder });
    const newRawData = { students: newParsed.students, choiceCounts: newParsed.choiceCounts, itemTypes: newParsed.itemTypes, reversedOrder };

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
  } catch (e) {
    errEl.textContent = e.message || 'تعذر قراءة الملف';
    errEl.style.display = 'block';
  }
});

/* ---------- تعديل مفتاح الإجابة لتقرير محفوظ وإعادة حساب التقارير الستة ---------- */
async function fetchKeyById(id) {
  if (!id) return null;
  const { data } = await sb.from('answer_keys').select('id, answers, choices, models, model_map').eq('id', id).maybeSingle();
  return data || null;
}

// تقرير بنموذجين: يعيد التصحيح بآخر نسخة من المفتاح المحفوظ (الإجابات ونموذج كل طالب)
async function regradeModelReport() {
  const rd = currentReport.raw_data;
  const key = await fetchKeyById(rd.models.keyId);
  if (!key || !key.models) { alert('المفتاح المحفوظ لهذا الاختبار انحذف أو صار بنموذج واحد - ما أقدر أعيد التصحيح منه.'); return; }
  if (!confirm('إعادة تصحيح كل الطلاب بآخر نسخة من المفتاح المحفوظ؟')) return;
  const reversedOrder = rd.reversedOrder !== false;
  const map = key.model_map || {};
  const g = gradeWithModels({
    parsed: { itemCount: rd.choiceCounts.length, choiceCounts: rd.choiceCounts, itemTypes: rd.itemTypes, students: rd.students },
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
    errEl.textContent = 'هذا تقرير محفوظ بنسخة سابقة من النظام ما تحتوي بيانات الطلاب الخام - لازم ترفع نفس ملف الإكسل وتحفظ التقرير من جديد عشان تقدر تعدّل مفتاحه لاحقًا.';
    errEl.style.display = 'block';
    document.getElementById('er-editkey-card').classList.remove('hidden');
    document.getElementById('er-editkey-form').innerHTML = '';
    return;
  }
  const { choiceCounts, reversedOrder = true } = currentReport.raw_data;
  const el = document.getElementById('er-editkey-form');
  el.innerHTML = `<label style="display:flex; align-items:center; gap:8px; font-size:12px; background:#fff; border:1px solid var(--border); border-radius:10px; padding:9px 12px; margin-bottom:12px;">
    <input type="checkbox" id="er-editkey-reversed" style="width:auto; margin:0;"${reversedOrder ? ' checked' : ''} />
    <span>ترتيب رموز الاختيارات بالملف معكوس (بطّله إذا المادة إنجليزية أو النتائج غريبة)</span>
  </label>
  <div class="er-key-grid">${choiceCounts.map((numChoices, i) => {
    const options = ARABIC_LETTERS.slice(0, numChoices);
    const current = letterFor(currentReport.key_raw[i], numChoices, reversedOrder);
    return `<div class="er-key-item">
      <label>سؤال ${i + 1}</label>
      <select class="er-editkey-select" data-item="${i}">
        ${options.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`;
  }).join('')}</div>`;
  document.getElementById('er-editkey-reversed').addEventListener('change', (e) => {
    const opts = ARABIC_LETTERS;
    document.querySelectorAll('.er-editkey-select').forEach((sel, i) => {
      const numChoices = choiceCounts[i];
      const letter = letterFor(currentReport.key_raw[i], numChoices, e.target.checked);
      sel.value = letter || opts[0];
    });
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

  const selects = Array.from(document.querySelectorAll('.er-editkey-select'));
  const letterSelections = selects.map(s => s.value);
  if (letterSelections.some(v => !v)) {
    errEl.textContent = 'اختر الإجابة الصحيحة لكل سؤال';
    errEl.style.display = 'block';
    return;
  }
  const reversedOrder = document.getElementById('er-editkey-reversed').checked;
  const keyRaw = buildManualKey(letterSelections, choiceCounts, reversedOrder);
  const stats = computeExamStats({ itemCount: choiceCounts.length, keyRaw, choiceCounts, students, reversedOrder, itemTypes });
  const newRawData = { ...currentReport.raw_data, reversedOrder };

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
    ${statBox('أعلى درجة', fmt1(s.high))}
    ${statBox('أقل درجة', fmt1(s.low))}
    ${statBox('متوسط الدرجة', fmt2(s.mean))}
    ${statBox('الدرجة الوسيطة', fmt1(s.median))}
    ${statBox('نطاق الدرجات', fmt1(s.range))}
    ${statBox('الانحراف المعياري', fmt2(s.sd))}
    ${statBox('معامل الثبات (KR20)', fmt2(s.kr20))}
    ${statBox('متوسط الدرجة %', pct(s.meanPct))}
  </div>`;
}

// تقرير اختبار بنموذجين: تبديل بين "كل الطلاب" وكل نموذج لحاله
function renderReportStats(stats, view = 'all') {
  const sw = document.getElementById('er-model-switch');
  const byModel = stats && stats.byModel;
  if (!sw || !byModel || !Object.keys(byModel).length) { if (sw) sw.classList.add('hidden'); renderAllReports(stats); return; }
  const c = (stats.models && stats.models.counts) || {};
  sw.innerHTML = `<button type="button" data-v="all">كل الطلاب <span class="tr-cnt">${stats.n}</span></button>` +
    Object.keys(byModel).map(m => `<button type="button" data-v="${m}">نموذج ${m} <span class="tr-cnt">${c[m] || byModel[m].n}</span></button>`).join('');
  sw.classList.remove('hidden');
  sw.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.v === view);
    b.onclick = () => renderReportStats(stats, b.dataset.v);
  });
  renderAllReports(view === 'all' ? stats : byModel[view]);
  if (view === 'all' && stats.itemsMixed) {
    ['er-panel-items', 'er-panel-itemstats', 'er-panel-analysis'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.insertAdjacentHTML('afterbegin', '<div class="er-mixed-note">أسئلة النموذجين مختلفة، فتحليل الأسئلة هنا يخلط سؤالين مختلفين. اختر "نموذج أ" أو "نموذج ب" من فوق لتحليل أسئلة كل نموذج.</div>');
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
      الإجابة الصحيحة معلّمة بـ * ولون <span style="color:#2E9155; font-weight:700;">أخضر</span> — المشتت الأكثر
      اختيارًا يصير <span style="color:#D4B106; font-weight:700;">أصفر</span> فقط لو تجاوز عدد من اختاره عدد من
      اختار الإجابة الصحيحة (تحتاج مراجعة) — وإلا يبقى <span style="color:#C0453D; font-weight:700;">أحمر</span>
      مثل بقية الاختيارات وعدم الاستجابة/متعدد
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
      <p style="font-size:12.5px; margin:0;">${s.toReview.length ? s.toReview.map(it => esc(it.label) + (it.topWrong ? ` (اختار كثيرون "${esc(it.topWrong)}" بدل الإجابة الصحيحة)` : '')).join('، ') : 'ما فيه أسئلة مشتتاتها أكثر اختيارًا من الإجابة الصحيحة'}</p>
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
    ${isLegacyReport ? `<p style="font-size:12px; color:var(--danger); margin:8px 0 0;">هذا التقرير محفوظ بنسخة سابقة من النظام ما تحتوي بيانات الترتيب - ارفع نفس ملف الإكسل وأعد حفظ التقرير لعرض هذه القائمة.</p>` : `
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
    if (errEl) { errEl.textContent = 'ما فيه طلاب ضعاف (أقل من ٥٠٪) بهذا التقرير حاليًا.'; errEl.style.display = 'block'; }
    return;
  }
  try {
    await loadJSZip();
    const templateResp = await fetch(REMEDIAL_TEMPLATE_URL);
    if (!templateResp.ok) throw new Error('تعذر تحميل نموذج الخطة العلاجية (js/templates/remedial-plan-template.docx) - تأكد إنه مرفوع على الموقع بنفس المسار.');
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
