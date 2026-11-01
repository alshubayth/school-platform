// اختبارات منطق التصحيح: node --test tests/
// كل تعديل على js/grading-core.js يجب أن تمر بعده هذه الاختبارات.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  letterFor, valueForLetter, keyHit, buildManualKey, computeExamStats, gradeWithModels, parseSheetRows,
  rawFromIdx, mapPaperAnswers, paperToCanonical, rawFromChoice, scoreReportStudents, recomputeSavedReport, auditReport, MODEL_A, MODEL_B,
} from '../js/grading-core.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ≠ ${b}`);

test('تحويل الحروف والقيم الخام بالاتجاهين', () => {
  for (const reversed of [true, false]) for (const nc of [2, 3, 4, 5]) {
    ['أ', 'ب', 'ج', 'د', 'هـ'].slice(0, nc).forEach(l => {
      const v = valueForLetter(l, nc, reversed);
      assert.equal(letterFor(v, nc, reversed), l, `nc=${nc} rev=${reversed} ${l}`);
    });
  }
  // المعكوس (المواد العربية): بثلاث خيارات ٣ = أ، ١ = ج
  assert.equal(letterFor(3, 3, true), 'أ');
  assert.equal(letterFor(1, 3, true), 'ج');
  assert.equal(letterFor(-2, 3, true), null);
  assert.equal(letterFor(-3, 3, true), null);
});

test('مطابقة الإجابة بالمفتاح (إجابة واحدة أو أكثر)', () => {
  assert.equal(keyHit(3, 3), true);
  assert.equal(keyHit(2, 3), false);
  assert.equal(keyHit(null, null), false, 'الفارغ لا يُحتسب صحيحًا ولو كان المفتاح فارغًا');
  assert.equal(keyHit(2, [2, 3]), true);
  assert.equal(keyHit(1, [2, 3]), false);
  assert.equal(keyHit(-2, -2), true, 'قيمة خاصة متطابقة');
});

test('بناء المفتاح من الحروف المختارة يدويًا', () => {
  const k = buildManualKey(['أ', ['ب', 'ج'], 'د'], [4, 4, 4], true);
  assert.deepEqual(k, [4, [3, 2], 1]);
  assert.deepEqual(buildManualKey(['أ', 'ب'], [3, 3], false), [1, 2]);
});

// ثلاث أسئلة بأربع خيارات، ترميز معكوس: أ=4 ب=3 ج=2 د=1
const KEY = [4, 3, 2];
const CC = [4, 4, 4];
const S = (id, answers, extra = {}) => ({ id, name: 'طالب ' + id, section: '1', answers, ...extra });

test('حساب الدرجات والإحصاءات الأساسية', () => {
  const students = [S('1', [4, 3, 2]), S('2', [4, 1, -2]), S('3', [1, -3, 2]), S('4', [null, null, null])];
  const st = computeExamStats({ itemCount: 3, keyRaw: KEY, choiceCounts: CC, students, reversedOrder: true });
  assert.equal(st.n, 4);
  assert.equal(st.maxScore, 3);
  assert.equal(st.high, 3);
  assert.equal(st.low, 0);
  near(st.mean, (3 + 1 + 1 + 0) / 4, 'المتوسط');
  assert.equal(st.itemStats[0].correctCount, 2);
  assert.equal(st.itemStats[1].multi, 1);
  assert.equal(st.itemStats[2].notPresent, 2, 'فارغ = -2 أو null');
  assert.equal(st.itemStats[0].correctLetter, 'أ');
  near(st.gradeDistribution.reduce((a, b) => a + b.freq, 0), 4, 'كل طالب في فئة واحدة');
  assert.deepEqual(st.highestStudents.map(s => s.id), ['1']);
});

test('درجات الأسئلة الموزونة', () => {
  const students = [S('1', [4, 3, 2]), S('2', [4, 1, 1]), S('3', [1, 3, 2])];
  const st = computeExamStats({ itemCount: 3, keyRaw: KEY, choiceCounts: CC, students, points: [1, 2, 3] });
  assert.equal(st.maxScore, 6);
  assert.equal(st.weighted, true);
  assert.equal(st.high, 6);
  near(st.mean, (6 + 1 + 5) / 3);
});

test('سؤال يقبل أكثر من إجابة', () => {
  const key = [[4, 3], 3, 2];
  const students = [S('1', [3, 3, 2]), S('2', [4, 3, 2]), S('3', [2, 3, 2])];
  const st = computeExamStats({ itemCount: 3, keyRaw: key, choiceCounts: CC, students });
  assert.equal(st.itemStats[0].correctCount, 2);
  assert.equal(st.itemStats[0].correctLetter, 'أ / ب');
});

test('نموذجان: نفس الأسئلة والخيارات مختلفة', () => {
  const keyA = [4, 3, 2], keyB = [1, 2, 4];
  const parsed = { itemCount: 3, choiceCounts: CC, students: [S('1', [4, 3, 2], { model: MODEL_A }), S('2', [1, 2, 4], { model: MODEL_B }), S('3', [4, 3, 2], { model: MODEL_B })] };
  const g = gradeWithModels({ parsed, keyA, keyB, mode: 'choices', reversedOrder: true, modelOf: s => s.model });
  assert.equal(g.stats.high, 3);
  assert.equal(g.stats.low, 0, 'طالب النموذج ب الذي أجاب بمفتاح أ يأخذ صفرًا');
  assert.deepEqual(g.stats.models.counts, { [MODEL_A]: 1, [MODEL_B]: 2 });
});

test('نموذجان: نفس الأسئلة بترتيب مختلف، والدرجة تطابق طريقة التصدير', () => {
  // سؤال النموذج ب رقم i يقابل سؤال النموذج أ رقم orderB[i]
  const orderB = [2, 0, 1];
  const keyA = [4, 3, 2];
  const keyB = [2, 4, 3]; // keyB[i] = keyA[orderB[i]]
  const studentsB = [S('2', [2, 4, 3], { model: MODEL_B }), S('3', [2, 1, 1], { model: MODEL_B })];
  const parsed = { itemCount: 3, choiceCounts: CC, students: [S('1', [4, 3, 2], { model: MODEL_A }), ...studentsB], points: [1, 2, 3] };
  const g = gradeWithModels({ parsed, keyA, keyB, mode: 'order', orderB, reversedOrder: true, modelOf: s => s.model });
  assert.equal(g.stats.high, 6);
  // الطالب ٣ أصاب سؤال النموذج ب الأول فقط، وهو السؤال الثالث في أ (درجته ٣)
  const rep = { key_raw: keyA, item_count: 3, raw_data: g.raw_data, stats: g.stats };
  const rows = scoreReportStudents(rep);
  assert.deepEqual(rows.map(r => r.obj), [6, 6, 3]);
  near(rows.reduce((a, r) => a + r.obj, 0) / 3, g.stats.mean, 'طريقتا الحساب متطابقتان');
});

test('قراءة ملف Remark: أرقام ونصوص، وصف النموذج، والأوراق المكررة', () => {
  const rows = [
    ['StudentID', 'اسم الطالب', 'الصف', 'الفصل', 'اختيار متعدد1', 'اختيار متعدد2', 'صح وخطأ1', 'مقالي'],
    ['0000', 'النموذج', '', '', 3, 2, 2, ''],
    ['111', 'أحمد', 'ثالث متوسط', '1', 3, 1, 2, 4],
    ['111', 'أحمد', 'ثالث متوسط', '1', 3, 1, 2, 4],
    ['222', 'خالد', 'ثالث متوسط', '2', '', -3, 1, ''],
    ['333', 'سالم', 'ثالث متوسط', '1', 2, 3, 2, 3],
    ['333', 'سالم', 'ثالث متوسط', '1', 1, 3, 2, 3],
  ];
  const p = parseSheetRows(rows);
  assert.equal(p.itemCount, 3);
  assert.deepEqual(p.itemTypes, ['mcq', 'mcq', 'tf']);
  assert.equal(p.students.length, 4, 'الورقة المكررة حرفيًا تُحذف، والمختلفة تبقى للمراجعة');
  assert.equal(p.dupRemoved, 1);
  assert.deepEqual(p.dupConflicts, ['333']);
  assert.deepEqual(p.detectedKeyRaw, [3, 2, 2]);
  assert.equal(p.students[1].answers[0], null);
  assert.equal(p.students[0].essay, 4);
  assert.equal(p.hasEssay, true);

  const t = parseSheetRows([['StudentID', 'اسم الطالب', 'سؤال 1', 'سؤال 2'], ['1', 'أ', 'ب', 'BLANK'], ['2', 'ب', 'أ,ب', 'ج']]);
  assert.equal(t.textCoded, true);
  assert.deepEqual(t.students[0].answers, [2, -2]);
  assert.deepEqual(t.students[1].answers, [-3, 3]);
});

test('المفتاح المحفوظ (فهارس) ← قيم خام', () => {
  assert.deepEqual(rawFromIdx([0, 1, [0, 2], null], [3, 3, 3, 3], true), [3, 2, [3, 1], null]);
  assert.deepEqual(rawFromIdx([0, 1], [4, 4], false), [1, 2]);
});

// ورقة أسئلة مخلوطة: الموضع المطبوع pos يحمل السؤال الأصلي q[pos] وخياراته بترتيب o[pos]
const PERM = { q: [2, 0, 1], o: [[1, 2, 0], [0, 1, 2], [2, 0, 1]] };
const QUESTIONS = [{ type: 'mcq', answer: 0 }, { type: 'mcq', answer: 1 }, { type: 'mcq', answer: 2 }];

test('ورقة مخلوطة من ملف Remark ← ترتيب الأسئلة الأصلي', () => {
  // ترميز Remark معكوس بثلاث خانات: الخانة 0 (أقصى اليمين) = 3
  // الطالب ظلّل في كل موضع الخانة التي تحمل الإجابة الصحيحة الأصلية
  const slotOf = pos => PERM.o[pos].indexOf(QUESTIONS[PERM.q[pos]].answer);
  const remark = [0, 1, 2].map(pos => 3 - slotOf(pos));
  const mapped = mapPaperAnswers(remark, PERM, QUESTIONS, { slots: 3 });
  assert.deepEqual(mapped, QUESTIONS.map(q => q.answer + 1), 'كل الإجابات صحيحة بعد إرجاعها لترتيبها الأصلي');
  assert.deepEqual(mapPaperAnswers([-2, -3, null], PERM, QUESTIONS), [-3, null, -2]);
});

test('الإدخال اليدوي لورقة مخلوطة يُصحَّح على ترتيب الطالب (مشكلة المهارات الرقمية)', () => {
  // المعلم ضغط في كل موضع الخيار المطبوع الذي يحمل الإجابة الصحيحة
  const printed = [0, 1, 2].map(pos => PERM.o[pos].indexOf(QUESTIONS[PERM.q[pos]].answer));
  const canon = paperToCanonical(printed, PERM, 3);
  assert.deepEqual(canon, QUESTIONS.map(q => q.answer));
  // بدون خريطة: الترتيب كما هو
  assert.deepEqual(paperToCanonical([1, null, 0], null, 3), [1, null, 0]);
  // تحويلها لقيم خام ثم تصحيحها بالمفتاح الأصلي = درجة كاملة
  const key = QUESTIONS.map(q => rawFromChoice(q.answer, 3, true));
  const raw = canon.map(j => rawFromChoice(j, 3, true));
  const st = computeExamStats({ itemCount: 3, keyRaw: key, choiceCounts: [3, 3, 3], students: [S('1', raw)] });
  assert.equal(st.high, 3);
  // الخطأ القديم: تصحيح ترتيب الطالب مباشرة بالمفتاح الأصلي يعطي درجة خاطئة
  const wrong = computeExamStats({ itemCount: 3, keyRaw: key, choiceCounts: [3, 3, 3], students: [S('1', printed.map(j => rawFromChoice(j, 3, true)))] });
  assert.notEqual(wrong.high, 3);
});

test('إعادة حساب تقرير محفوظ وفحص سلامته', () => {
  const students = [S('1', [4, 3, 2]), S('2', [4, 1, 1]), S('3', [1, 3, 2])];
  const rd = { students, choiceCounts: CC, itemTypes: ['mcq', 'mcq', 'mcq'], reversedOrder: true };
  const stats = computeExamStats({ itemCount: 3, keyRaw: KEY, choiceCounts: CC, students });
  const rep = { key_raw: KEY, item_count: 3, raw_data: rd, stats };
  assert.equal(auditReport(rep).ok, true);
  near(recomputeSavedReport(rep, students).stats.mean, stats.mean);

  const bad = auditReport({ ...rep, stats: { ...stats, mean: stats.mean + 0.5, n: 5 } });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some(i => i.kind === 'count'));
  assert.ok(bad.issues.some(i => i.kind === 'stat'));

  const missing = auditReport({ ...rep, key_raw: [4, null, 2], stats: computeExamStats({ itemCount: 3, keyRaw: [4, null, 2], choiceCounts: CC, students }) });
  assert.ok(missing.issues.some(i => i.kind === 'key'));

  assert.equal(auditReport({ raw_data: {} }).skipped, true);
});
