import { sb, currentUserId, backToTiles } from './core.js';
import { loadXLSX, loadJSZip } from './lib-loader.js';

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

  const isCorrect = (ans, i) => ans[i] != null && ans[i] === keyRaw[i];
  const totals = students.map(s => {
    let t = 0;
    for (let i = 0; i < itemCount; i++) if (isCorrect(s.answers, i)) t++;
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
    const correctLetter = letterFor(keyRaw[i], numChoices, reversedOrder);
    const freqMap = new Map(); // key: label -> {count, isCorrect, sortVal}
    let correctCount = 0, notPresent = 0, multi = 0;
    students.forEach(s => {
      const v = s.answers[i];
      let label, sortVal;
      if (v == null || v === -2) { label = 'لا توجد استجابة'; sortVal = 1000; notPresent++; }
      else if (v === -3) { label = 'متعدد'; sortVal = 999; multi++; }
      else if (typeof v === 'number' && v > 0) { label = letterFor(v, numChoices, reversedOrder); sortVal = v; }
      else { label = 'لا توجد استجابة'; sortVal = 1000; notPresent++; }
      if (!freqMap.has(label)) freqMap.set(label, { label, count: 0, isCorrect: label === correctLetter, sortVal });
      freqMap.get(label).count++;
      if (v === keyRaw[i]) correctCount++;
    });
    const choices = Array.from(freqMap.values())
      .sort((a, b) => a.sortVal - b.sortVal)
      .map(c => ({ ...c, pct: n ? (c.count / n) * 100 : 0 }));

    const correctPct = n ? (correctCount / n) * 100 : 0;
    const mask = students.map(s => (isCorrect(s.answers, i) ? 1 : 0));
    const p = correctCount / n, q = 1 - p;
    const m1vals = [], m0vals = [];
    mask.forEach((m, si) => (m ? m1vals : m0vals).push(totals[si]));
    const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const m1 = avg(m1vals), m0 = avg(m0vals);
    const pointBiserial = sd > 0 ? ((m1 - m0) / sd) * Math.sqrt(p * q) : 0;

    let upperCorrect = 0, lowerCorrect = 0;
    students.forEach((s, si) => {
      if (upperSet.has(si) && isCorrect(s.answers, i)) upperCorrect++;
      if (lowerSet.has(si) && isCorrect(s.answers, i)) lowerCorrect++;
    });
    const upper27 = (upperCorrect / k27) * 100;
    const lower27 = (lowerCorrect / k27) * 100;

    const wrongChoices = choices.filter(c => !c.isCorrect && c.label !== 'لا توجد استجابة' && c.label !== 'متعدد');
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
 * واجهة الرفع والتحليل
 * ========================================================================= */
let parsedData = null; // { itemCount, choiceCounts, students, detectedKeyRaw, detected }
let currentReport = null; // آخر تقرير محفوظ تم فتحه بشاشة التفاصيل

export async function loadExamReportsModule() {
  document.getElementById('er-detail-view').classList.add('hidden');
  document.getElementById('er-list-view').classList.remove('hidden');
  document.getElementById('er-preview-card').classList.add('hidden');
  document.getElementById('er-file').value = '';
  parsedData = null;
  await loadSavedList();
}

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
  const el = document.getElementById('er-key-form');
  el.innerHTML = `<div class="er-key-grid">${parsed.choiceCounts.map((numChoices, i) => {
    const options = ARABIC_LETTERS.slice(0, numChoices);
    const preselect = parsed.detectedKeyRaw ? letterFor(parsed.detectedKeyRaw[i], numChoices, reversed) : null;
    return `<div class="er-key-item">
      <label>سؤال ${i + 1}</label>
      <select class="er-key-select" data-item="${i}">
        <option value="">اختر...</option>
        ${options.map(o => `<option value="${o}"${o === preselect ? ' selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`;
  }).join('')}</div>`;
}

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
  const { error } = await sb.from('exam_reports').insert({
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
  });
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  parsedData = null;
  document.getElementById('er-preview-card').classList.add('hidden');
  document.getElementById('er-file').value = '';
  await loadSavedList();
});

async function loadSavedList() {
  const listEl = document.getElementById('er-saved-list');
  const { data, error } = await sb.from('exam_reports')
    .select('id, title, subject_name, grade_level, semester, item_count, students_count, created_at')
    .order('created_at', { ascending: false });
  if (error) { listEl.innerHTML = '<p style="color:var(--danger); font-size:12.5px;">تعذر تحميل التقارير</p>'; return; }
  if (!data || data.length === 0) {
    listEl.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه تقارير محفوظة بعد</p></div>';
    return;
  }
  const colors = [
    { bg: 'var(--teal-light)', fg: 'var(--teal)' },
    { bg: 'var(--gold-light)', fg: 'var(--gold)' },
    { bg: 'var(--purple-light)', fg: 'var(--purple)' },
    { bg: 'var(--meadow-light)', fg: 'var(--meadow-dark)' },
  ];
  const examIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px; height:26px;"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;

  listEl.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:14px;">
    ${data.map((r, i) => {
      const c = colors[i % colors.length];
      return `
      <div data-id="${r.id}" title="${esc(r.title)}" style="position:relative; background:#fff; border:1px solid var(--border); border-radius:14px; padding:20px 12px 14px; text-align:center; cursor:pointer; transition:0.15s; box-shadow:var(--shadow-sm);" onmouseover="this.style.boxShadow='var(--shadow-md)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.boxShadow='var(--shadow-sm)'; this.style.transform='none';">
        <button type="button" class="er-delete-btn" data-id="${r.id}" title="حذف" style="position:absolute; top:6px; left:6px; border:none; background:none; color:var(--danger); cursor:pointer; font-size:13px; padding:3px 6px; line-height:1; border-radius:6px;">✕</button>
        <div style="width:50px; height:50px; border-radius:13px; background:${c.bg}; color:${c.fg}; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;">${examIconSvg}</div>
        <div style="font-size:12.5px; font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.4; min-height:34px;">${esc(r.title)}</div>
        <div style="font-size:10.5px; color:var(--slate); margin-top:6px;">${esc(r.grade_level || '-')} — ${r.students_count} طالب</div>
      </div>`;
    }).join('')}
  </div>`;

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
}

async function openReport(id) {
  const { data, error } = await sb.from('exam_reports').select('*').eq('id', id).single();
  if (error || !data) { alert('تعذر فتح التقرير'); return; }
  currentReport = data;
  document.getElementById('er-list-view').classList.add('hidden');
  document.getElementById('er-detail-view').classList.remove('hidden');
  document.getElementById('er-detail-title').textContent = data.title;
  document.getElementById('er-detail-sub').textContent = `${data.subject_name || '-'} — ${data.grade_level || '-'} — ${data.semester || '-'} — ${data.students_count} طالب`;
  showErTab('dist');
  renderAllReports(data.stats);
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
    renderAllReports(stats);
    document.getElementById('er-updatefile-card').classList.add('hidden');
  } catch (e) {
    errEl.textContent = e.message || 'تعذر قراءة الملف';
    errEl.style.display = 'block';
  }
});

/* ---------- تعديل مفتاح الإجابة لتقرير محفوظ وإعادة حساب التقارير الستة ---------- */
document.getElementById('er-edit-key-btn').addEventListener('click', () => {
  if (!currentReport) return;
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
  renderAllReports(stats);
});

document.getElementById('er-back-to-list').addEventListener('click', () => {
  document.getElementById('er-detail-view').classList.add('hidden');
  document.getElementById('er-list-view').classList.remove('hidden');
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

  const printBtn = document.getElementById('er-print-topbottom');
  const exportBtn = document.getElementById('er-export-topbottom');
  const remedialBtn = document.getElementById('er-export-remedial');
  if (printBtn) printBtn.addEventListener('click', () => {
    const scopeEl = document.getElementById('er-print-scope');
    printTopBottomReport({ ...s, topStudents, weakStudents }, scopeEl ? scopeEl.value : 'both');
  });
  if (exportBtn) exportBtn.addEventListener('click', () => exportTopBottomExcel({ ...s, topStudents, weakStudents }));
  if (remedialBtn) remedialBtn.addEventListener('click', () => exportRemedialPlans(weakStudents));
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
const ER_LOGO_DATA_URI = new URL('logo.png', window.location.href).href;
function printTopBottomReport(s, scope = 'both') {
  const title = currentReport ? currentReport.title : 'تقرير أعلى وأدنى الدرجات';
  const sub = currentReport ? `${currentReport.subject_name || '-'} — ${currentReport.grade_level || '-'} — ${currentReport.semester || '-'}` : '';
  const showTop = scope === 'both' || scope === 'top';
  const showWeak = scope === 'both' || scope === 'weak';
  const pageTitle = scope === 'top' ? 'أعلى ١٥ درجة' : scope === 'weak' ? 'الطلاب الضعاف' : 'أعلى ١٥ درجة والطلاب الضعاف';

  const rowsHtml = (list) => list.length
    ? list.map((st, i) => `<tr>
        <td>${i + 1}</td>
        <td style="text-align:right;">${esc(st.name || st.id || '-')}</td>
        <td>${esc(st.section || '-')}</td>
        <td>${fmt1(st.total)}</td>
        <td>${pct(st.pct)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5">لا يوجد</td></tr>';

  const logoHtml = ER_LOGO_DATA_URI ? `<img src="${ER_LOGO_DATA_URI}" alt="شعار" style="height:50px;" />` : '';
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
      ${showTop ? colHtml('أعلى ١٥ درجة', s.topStudents) : ''}
      ${showWeak ? colHtml('الطلاب الضعاف (أقل من ٥٠٪)', s.weakStudents) : ''}
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
async function exportTopBottomExcel(s) {
  await loadXLSX();
  const title = currentReport ? currentReport.title : 'تقرير';
  const header = ['#', 'الاسم', 'الفصل', 'الدرجة', 'النسبة%'];
  const toRows = (list) => list.map((st, i) => [i + 1, st.name || st.id || '-', st.section || '-', Math.round(st.total * 10) / 10, Math.round(st.pct * 100) / 100]);

  const aoa = [
    ['أعلى ١٥ درجة'], header, ...toRows(s.topStudents),
    [],
    ['الطلاب الضعاف (أقل من ٥٠٪)'], header, ...toRows(s.weakStudents),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'أعلى الدرجات والضعاف');
  XLSX.writeFile(wb, `${title}_أعلى_الدرجات_والضعاف.xlsx`);
}

/* ---------- تصدير "الخطة العلاجية (الجماعية)" - ملف وورد منفصل لكل فصل فيه طلاب ضعاف ----------
 * نستخدم نفس ملف النموذج الرسمي الأصلي (.docx) بالضبط كقالب - محفوظ بمسار js/templates/remedial-plan-template.docx
 * ومزروع فيه حقول {SCHOOL} {SUBJECT} {GRADE} {SECTION} {DATE} {NAMES} بمكانها الصحيح بالجدول (كل حقل نص واحد
 * متواصل بعنصر <w:t> واحد، تأكدنا من كذا وقت بناء القالب). نعبّيهم باستبدال نص مباشر داخل word/document.xml
 * (بمكتبة JSZip بس، بدون أي مكتبة خارجية زيادة) فتبقى كل التنسيقات (الخطوط، الحدود، خانات الاختيار، نص
 * رأي المعلم...) مطابقة تمامًا للملف الأصلي بدون أي تغيير. نصدّر ملف .docx حقيقي واحد لكل فصل، مضغوطين
 * بملف zip واحد. */
const SCHOOL_NAME = 'مدرسة المروج المتوسطة';
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
        .replace(/\{SCHOOL\}/g, escXml(SCHOOL_NAME))
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
