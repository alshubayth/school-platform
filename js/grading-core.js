/* =========================================================================
 * منطق التصحيح وحساب الدرجات والإحصاءات (بدون واجهة ولا قاعدة بيانات)
 * يُستخدم في المنصة، وتغطيه الاختبارات الآلية في tests/grading.test.mjs
 * أي تعديل هنا يجب أن تمر بعده الاختبارات: node --test tests/
 * ========================================================================= */
export const ARABIC_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز'];
export const GRADE_BANDS = [
  { grade: 'A', min: 90, max: 100 },
  { grade: 'B', min: 80, max: 89.99 },
  { grade: 'C', min: 70, max: 79.99 },
  { grade: 'D', min: 60, max: 69.99 },
  { grade: 'F', min: 0, max: 59.99 },
];
export const RELIABILITY_BANDS = [
  { label: 'ضعيف', min: -Infinity, max: 0.699999 },
  { label: 'متوسط', min: 0.70, max: 0.799999 },
  { label: 'جيد', min: 0.80, max: 0.899999 },
  { label: 'ممتاز', min: 0.90, max: Infinity },
];

export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toLocaleString('ar-SA'); }
export function fmt2(n) { return (Math.round((n || 0) * 100) / 100).toLocaleString('ar-SA'); }
export function pct(n) { return fmt2(n) + '٪'; }

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
export function isAllZeros(val) {
  const s = String(val == null ? '' : val).trim();
  return s.length > 0 && /^0+$/.test(s);
}
export function isKeyRow(row) {
  return isAllZeros(row.id) || isAllZeros(row.name);
}

// يحسب عدد الاختيارات الفعلي لكل بند (أكبر قيمة موجبة ظهرت فيه) - بحد أدنى ٢ لأسئلة
// "صح وخطأ" (اختيارين بس) وبحد أدنى ٣ لأسئلة الاختيار المتعدد العادية
export function computeChoiceCounts(itemCols, dataRows, itemTypes = []) {
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
export function letterForRaw(value, numChoices, reversed = true) { return letterFor(value, numChoices, reversed); }
export function letterFor(value, numChoices, reversed = true) {
  if (typeof value !== 'number' || value <= 0) return null;
  const idx = reversed ? numChoices - value : value - 1;
  return ARABIC_LETTERS[idx] || ('اختيار ' + value);
}
// سؤال يقبل أكثر من إجابة: قيمته بالمفتاح مصفوفة قيم خام
export const keyHit = (v, k) => v != null && (Array.isArray(k) ? k.includes(v) : v === k);
export const collapseKey = arr => (arr.length > 1 ? arr : (arr.length ? arr[0] : null));
export function keyLetters(raw, numChoices, reversed = true) { return (Array.isArray(raw) ? raw : [raw]).map(v => letterFor(v, numChoices, reversed)).filter(Boolean); }
// عكس letterFor: يحوّل الحرف المختار يدويًا (أ/ب/ج...) للقيمة الرقمية الخام المطابقة لترميز الملف
export function valueForLetter(letter, numChoices, reversed = true) {
  const idx = ARABIC_LETTERS.indexOf(letter);
  if (idx === -1) return null;
  return reversed ? numChoices - idx : idx + 1;
}
// تخمين مبدئي لاتجاه الترميز من اسم المادة - المواد اللي اسمها بحروف لاتينية (إنجليزي
// غالبًا) الأرجح ترميزها عادي (غير معكوس)؛ غير كذا نفترض معكوس (المواد العربية)
export function guessReversedOrder(subjectName) {
  return !/[A-Za-z]/.test(String(subjectName || ''));
}

/* يحوّل صفوف الشيت الخام (array of arrays، أول صف عناوين) لقائمة طلاب. الملفات عادة ما
 * تحتوي صف "نموذج" (مفتاح إجابة) - الإجابة الصحيحة تُدخل يدويًا بعد الرفع (انظر
 * buildManualKey) - لكن لو انلقى صف مفتاح جاهز (رقم هوية/اسم كله أصفار) نستخدمه كتعبئة
 * مبدئية بس، ونستبعده من قائمة الطلاب. */
// قيمة نصية من ملف Remark ← قيمة خام: أ=1، ب=2...، صح=1، خطأ=2، فاضي=-2، أكثر من إجابة=-3
export const TEXT_LETTERS = [['أ', 'ا', 'a', '✓', 'صح', 'صحيح', 'true', 't'], ['ب', 'b', '✗', 'خطأ', 'خطا', 'خاطئ', 'false', 'f'], ['ج', 'c'], ['د', 'd'], ['هـ', 'ه', 'e'], ['و', 'f6'], ['ز', 'g']];
export function textAnswer(v) {
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

export function mostCommon(arr) {
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
export const MODEL_A = 'أ';
export const MODEL_B = 'ب';
export const MODE_LABELS = { choices: 'نفس الأسئلة والترتيب، الخيارات مختلفة', order: 'نفس الأسئلة بترتيب مختلف', different: 'أسئلة مختلفة' };
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
export function parseModelCell(x) {
  if (x == null) return null;
  let t = String(x).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/^(النموذج|نموذج|form|version|model)\s*[:\-]?\s*/i, '').trim();
  if (!t) return null;
  if (/^(أ|ا|إ|آ|a)$/i.test(t)) return MODEL_A;
  if (/^(ب|b)$/i.test(t)) return MODEL_B;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export function fileModel(st, reversed = true) {
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

export function recomputeSavedReport(rep, list) {
  const rd = rep.raw_data || {};
  const n = rep.item_count || (rd.choiceCounts || []).length;
  const reversed = rd.reversedOrder !== false;
  const base = { itemCount: n, choiceCounts: rd.choiceCounts || [], itemTypes: rd.itemTypes || [], students: list, points: rd.points || null };
  if (rd.models) {
    const m = rd.models;
    const g = gradeWithModels({ parsed: base, keyA: m.keyA, keyB: m.keyB, mode: m.mode, orderB: m.orderB, reversedOrder: reversed, keyId: m.keyId, modelOf: s2 => s2.model || MODEL_A });
    return { stats: g.stats, raw_data: { ...rd, ...g.raw_data }, students_count: list.length };
  }
  const stats = computeExamStats({ ...base, keyRaw: rep.key_raw, reversedOrder: reversed });
  return { stats, raw_data: { ...rd, students: list }, students_count: list.length };
}
export function scoreReportStudents(rep) {
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

/* =========================================================================
 * ورقة الأسئلة المخلوطة: كل طالب له ترتيب أسئلة وخيارات خاص (perm)
 * perm.q[pos] = رقم السؤال الأصلي المطبوع في الموضع pos
 * perm.o[pos][slot] = رقم الخيار الأصلي المطبوع في الخانة slot من ذلك الموضع
 * ========================================================================= */
// إجابات ملف Remark (بترتيب ورقة الطالب) ← ترميز عادي بترتيب الأسئلة الأصلي (أ = ١، -2 فارغ، -3 متعدد/غير مقروء)
export function mapPaperAnswers(stAnswers, perm, questions, { textCoded = false, tfTwo = [], slots = 3 } = {}) {
  const nQ = questions.length;
  const answers = Array(nQ).fill(null);
  perm.q.forEach((qi, pos) => {
    const v = (stAnswers || [])[pos];
    if (v == null) return;
    if (typeof v === 'number' && v <= 0) { answers[qi] = v === -3 ? -3 : -2; return; }
    const q = questions[qi];
    // ترميز Remark: أرقام معكوسة (أقصى يمين = أعلى رقم) أو حروف نصية (أ = ١)
    const width = textCoded ? null : (q.type === 'tf' && tfTwo[pos] ? 2 : slots);
    const slot = textCoded ? v - 1 : width - v;
    const orig = perm.o[pos] && perm.o[pos][slot];
    answers[qi] = orig == null ? -3 : orig + 1;
  });
  return answers;
}
// الإدخال اليدوي من ورقة الطالب: خيار مطبوع (فهرس) لكل موضع ← الخيار الأصلي (فهرس) لكل سؤال أصلي
export function paperToCanonical(posAnswers, perm, n) {
  const out = Array(n).fill(null);
  (posAnswers || []).forEach((j, pos) => {
    const i = perm ? perm.q[pos] : pos;
    if (i == null || i >= n) return;
    out[i] = perm && j != null ? ((perm.o[pos] || [])[j] ?? null) : (j ?? null);
  });
  return out;
}
// فهرس خيار (0 = أ) ← قيمة خام بترميز Remark لسؤال عدد خياراته count
export const rawFromChoice = (j, count, reversed = true) => (j == null ? -2 : reversed ? (count || 4) - j : j + 1);

/* =========================================================================
 * فحص سلامة تقرير محفوظ: يعيد حساب الإحصاءات من أوراق الطلاب المحفوظة ومفتاح الإجابة،
 * ويقارنها بالمحفوظ، ويقارن بين طريقتي الحساب (الإحصاءات، ودرجات الطلاب للتصدير والنشر)
 * ========================================================================= */
export function auditReport(rep) {
  const rd = rep.raw_data || {};
  const issues = [];
  if (!Array.isArray(rd.students) || !rd.students.length || !Array.isArray(rd.choiceCounts)) return { ok: true, skipped: true, issues };
  const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) < 1e-6;
  let fresh;
  try { fresh = recomputeSavedReport(rep, rd.students).stats; } catch (e) { return { ok: false, issues: [{ kind: 'error', text: 'تعذر إعادة الحساب: ' + e.message }] }; }
  const saved = rep.stats || {};
  if (Number(saved.n) !== fresh.n) issues.push({ kind: 'count', text: `عدد الطلاب المحفوظ ${saved.n ?? '—'} والفعلي ${fresh.n}` });
  [['mean', 'المتوسط'], ['high', 'أعلى درجة'], ['low', 'أدنى درجة'], ['maxScore', 'الدرجة الكاملة']].forEach(([k, t]) => {
    if (saved[k] != null && !near(saved[k], fresh[k])) issues.push({ kind: 'stat', text: `${t}: المحفوظ ${Math.round(saved[k] * 100) / 100} والصحيح ${Math.round(fresh[k] * 100) / 100}` });
  });
  // الطريقة الثانية (درجة كل طالب كما تُصدَّر وتُنشر لولي الأمر) يجب أن تطابق الأولى
  const rows = scoreReportStudents(rep);
  const objMean = rows.reduce((a, r) => a + r.obj, 0) / rows.length;
  if (!near(objMean, fresh.mean)) issues.push({ kind: 'paths', text: `درجات الطلاب في التصدير لا تطابق الإحصاءات (متوسط ${Math.round(objMean * 100) / 100} مقابل ${Math.round(fresh.mean * 100) / 100})` });
  const hi = Math.max(...rows.map(r => r.obj)), lo = Math.min(...rows.map(r => r.obj));
  if (!near(hi, fresh.high) || !near(lo, fresh.low)) issues.push({ kind: 'paths', text: 'أعلى أو أدنى درجة في التصدير لا تطابق الإحصاءات' });
  // مفتاح ناقص: سؤال بلا إجابة صحيحة يُحتسب خطأ على كل الطلاب
  const keys = rd.models ? [rd.models.keyA, rd.models.keyB] : [rep.key_raw];
  keys.filter(Array.isArray).forEach((k, ki) => {
    const miss = rd.choiceCounts.map((_, i) => i).filter(i => k[i] == null || (Array.isArray(k[i]) && !k[i].length));
    if (miss.length) issues.push({ kind: 'key', text: `${rd.models ? (ki ? 'مفتاح النموذج ب' : 'مفتاح النموذج أ') : 'مفتاح الإجابة'} بلا إجابة للأسئلة: ${miss.slice(0, 8).map(i => i + 1).join('، ')}${miss.length > 8 ? '…' : ''}` });
  });
  if (rd.needsRecalc) issues.push({ kind: 'recalc', text: 'التقرير معلَّم بانتظار إعادة الحساب' });
  return { ok: !issues.length, issues, fresh };
}
