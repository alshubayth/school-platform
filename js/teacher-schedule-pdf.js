import { sb, gradeLabels } from './core.js';
import { SCHEDULE_SUBJECTS } from './schedule.js';
import { loadPdfJs } from './lib-loader.js';

/*
 * استيراد جدول الحصص من ملف "جدول المعلمين الفردي" (كل معلم بصفحة مستقلة - نفس تصدير aSc
 * Timetables، بس بترتيب معاكس لملف الجدول حسب الفصول): عنوان كل صفحة هنا اسم المعلم نفسه،
 * وكل خلية بالجدول فيها اسم المادة + تسمية الفصل (صف/شعبة) اللي يدرّسها بهذي الحصة - بعكس
 * الملف الآخر اللي عنوان صفحته "صف/شعبة" وخلاياه فيها المادة + اسم المعلم.
 * نفس منهجية القراءة الهندسية (إحداثيات عبر pdf.js) المستخدمة بـ schedule-pdf.js، بس بدون
 * أي اعتماد تلقائي: لازم مراجعة كل صفحة، وربط يدوي لأي اسم معلم ما طابق حساب مسجّل.
 */

const GRADE_MAP = { 'أول': 'first_intermediate', 'ثاني': 'second_intermediate', 'ثالث': 'third_intermediate' };
const DAY_MAP = { 'احد': 'sunday', 'اثنين': 'monday', 'ثلاثاء': 'tuesday', 'اربعاء': 'wednesday', 'أربعاء': 'wednesday', 'خميس': 'thursday' };
const DAY_LABELS_AR = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
const REFERENCE_STRINGS = new Set([...Object.keys(DAY_MAP), ...Object.keys(GRADE_MAP), ...SCHEDULE_SUBJECTS]);
const ARABIC_RE = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const CLASS_LABEL_RE = /^(أول|ثاني|ثالث)\/?([0-9]{1,2})$/;

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function normalizeArText(s) { return String(s || '').trim().replace(/\s+/g, ' '); }

// نفس فكرة استبعاد الترويسة/التذييل الثابتة بكل صفحة الموجودة بـ schedule-pdf.js
function filterBoilerplateItems(items) {
  const boilerplateYs = new Set();
  items.forEach(it => {
    const norm = it.str.normalize('NFKC').trim();
    if (/^[A-Za-z][A-Za-z0-9\s,.\-:]*$/.test(norm) || /جدول|الأسبوع|Timetables|aSc/.test(norm)) {
      boilerplateYs.add(Math.round(it.y));
    }
  });
  if (boilerplateYs.size === 0) return items;
  return items.filter(it => !boilerplateYs.has(Math.round(it.y)));
}

function normalizeAr(s) { return String(s || '').replace(/[\sـ]/g, ''); }
function isSubsequence(needle, hay) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) { if (hay[j] === needle[i]) i++; }
  return i === needle.length;
}
function correctAgainstVocab(text, vocab) {
  const norm = normalizeAr(text);
  if (!norm) return text;
  if (vocab.includes(text)) return text;
  let best = null, bestExtra = Infinity;
  for (const candidate of vocab) {
    const cNorm = normalizeAr(candidate);
    if (cNorm.length < norm.length) continue;
    if (!isSubsequence(norm, cNorm)) continue;
    const extra = cNorm.length - norm.length;
    if (extra < bestExtra) { bestExtra = extra; best = candidate; }
  }
  if (best && bestExtra <= Math.max(3, Math.ceil(normalizeAr(best).length * 0.4))) return best;
  return text;
}

function translateDigits(s) { return s.replace(/[٠-٩]/g, ch => String(EASTERN_DIGITS.indexOf(ch))); }
function decodeReversed(raw) { return translateDigits(Array.from(raw).reverse().join('').normalize('NFKC')); }
function decodeNormal(raw) { return translateDigits(raw.normalize('NFKC')); }

function calibratePage(items) {
  let revScore = 0, normScore = 0;
  items.forEach(it => {
    const r = decodeReversed(it.str).trim();
    const n = decodeNormal(it.str).trim();
    if (REFERENCE_STRINGS.has(r)) revScore++;
    if (REFERENCE_STRINGS.has(n)) normScore++;
  });
  return revScore >= normScore ? 'reversed' : 'normal';
}

function findColumnAnchors(items) {
  const candidates = [];
  items.forEach(it => {
    const t = translateDigits(it.str.normalize('NFKC')).trim();
    if (/^[1-7]$/.test(t)) candidates.push({ period: parseInt(t), x: (it.x0 + it.x1) / 2, y: it.y, item: it });
  });
  if (candidates.length === 0) return {};
  const byY = new Map();
  candidates.forEach(c => {
    const yKey = Math.round(c.y);
    if (!byY.has(yKey)) byY.set(yKey, []);
    byY.get(yKey).push(c);
  });
  let bestY = null, bestCount = -1;
  byY.forEach((arr, y) => {
    const distinctPeriods = new Set(arr.map(a => a.period)).size;
    if (distinctPeriods > bestCount) { bestCount = distinctPeriods; bestY = y; }
  });
  const byPeriod = {};
  candidates.filter(c => Math.abs(c.y - bestY) < 3)
    .forEach(c => { if (!(c.period in byPeriod)) byPeriod[c.period] = { x: c.x, item: c.item }; });
  return byPeriod;
}

function findDayAnchors(items, decode) {
  const byDay = {};
  items.forEach(it => {
    const t = decode(it.str).trim();
    const day = DAY_MAP[t];
    if (day && !(day in byDay)) byDay[day] = { y: it.y, item: it };
  });
  return byDay;
}

function medianSpacing(sortedByX) {
  const gaps = [];
  for (let i = 0; i < sortedByX.length - 1; i++) gaps.push(sortedByX[i + 1].x - sortedByX[i].x);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 1;
}
function nearestColumn(cx, byX) {
  let best = byX[0], bestD = Math.abs(byX[0].x - cx);
  byX.forEach(a => { const d = Math.abs(a.x - cx); if (d < bestD) { bestD = d; best = a; } });
  return best.period;
}
function classifyColumns(cx, byX, allowMerge) {
  if (allowMerge) {
    const spacing = medianSpacing(byX);
    const tolerance = spacing * 0.22;
    for (let i = 0; i < byX.length - 1; i++) {
      const boundary = (byX[i].x + byX[i + 1].x) / 2;
      if (Math.abs(cx - boundary) < tolerance) return [byX[i].period, byX[i + 1].period];
    }
  }
  return [nearestColumn(cx, byX)];
}
function groupByColumn(items, byX, allowMerge) {
  const groups = {};
  items.forEach(it => {
    const cx = (it.x0 + it.x1) / 2;
    const periods = classifyColumns(cx, byX, allowMerge);
    const key = periods.join(',');
    if (!groups[key]) groups[key] = { periods, items: [] };
    groups[key].items.push(it);
  });
  return Object.values(groups);
}
function joinCellText(items, decode) {
  const sorted = [...items].sort((a, b) => b.x0 - a.x0);
  let result = '';
  let prevX0 = null;
  sorted.forEach(it => {
    if (prevX0 !== null) { const gap = prevX0 - it.x1; if (gap > 3) result += ' '; }
    result += decode(it.str);
    prevX0 = it.x0;
  });
  return result.trim();
}

async function extractPageItems(page) {
  const content = await page.getTextContent();
  return content.items
    .filter(it => it.str && it.str.trim().length > 0)
    .map(it => {
      const tr = it.transform;
      return { str: it.str, x0: tr[4], x1: tr[4] + it.width, y: tr[5], size: Math.hypot(tr[2], tr[3]) || Math.hypot(tr[0], tr[1]) || 1 };
    });
}

// اسم المعلم = عنوان الصفحة هنا (نص حر، مو نمط ثابت زي صف/شعبة) - نلقطه هندسيًا: أي نص عربي
// فوق صف أرقام الحصص (1-7) بالجدول، وما هو أصلًا من عناصر أعمدة الحصص/الأيام ولا ترويسة/تذييل ثابت.
// ملاحظة: ما نستخدم صف الأيام كحد فاصل لأن أول يوم بالجدول (الأحد) محتوى خلاياه (المادة/الفصل)
// يقع فوق موضع كلمة "الأحد" نفسها رأسيًا، فلو اعتمدنا عليه راح يختلط محتوى أول يوم بعنوان الصفحة.
// صف أرقام الحصص هو أعلى نقطة بالجدول فعليًا (فوق كل محتوى الأيام بما فيها الأحد)، فهو الحد الصحيح.
function parseTeacherName(items, columnAnchorItems, dayAnchorItems, decode) {
  const excluded = new Set([...columnAnchorItems, ...dayAnchorItems]);
  const colYs = [...columnAnchorItems].map(it => it.y);
  if (colYs.length === 0) return null;
  const topColY = Math.max(...colYs);
  const candidates = items.filter(it => !excluded.has(it) && ARABIC_RE.test(it.str) && it.y > topColY + 5);
  if (candidates.length === 0) return null;
  const text = joinCellText(candidates, decode);
  return text ? { name: text, items: candidates } : null;
}

// نفس فكرة correctAgainstVocab لكن لتسمية الفصل (صف/شعبة): لو الحرف الناقص (بسبب عيب ترميز
// بالخط) يخلي الكلمة تحتمل أكثر من صف دراسي واحد، ما نخمّن أبدًا - نرجع null ونعتبرها تحتاج
// مراجعة يدوية، بعكس تصحيح اسم المادة اللي فيه مفردة واحدة بس تحتمل كل مرة
function resolveGradeWord(wordPart) {
  if (GRADE_MAP[wordPart]) return { grade: GRADE_MAP[wordPart], ambiguous: false };
  const norm = normalizeAr(wordPart);
  if (!norm) return { grade: null, ambiguous: false };
  const candidates = Object.keys(GRADE_MAP).filter(g => {
    const gNorm = normalizeAr(g);
    return gNorm.length >= norm.length && isSubsequence(norm, gNorm) && (gNorm.length - norm.length) <= 2;
  });
  if (candidates.length === 1) return { grade: GRADE_MAP[candidates[0]], ambiguous: false, corrected: true };
  if (candidates.length > 1) return { grade: null, ambiguous: true };
  return { grade: null, ambiguous: false };
}

// نسخة متسامحة من قراءة "صف/شعبة" تتحمل غياب حرف أو أكثر من كلمة الصف بسبب عيب ترميز بالخط
// (بعض حروف "ثالث"/"ثاني" طلعت بدون تعيين Unicode بخط بعض صفحات هذا الملف تحديدًا) - نفصل
// رقم الشعبة (آخر رقم بالنص) عن باقي النص (كلمة الصف)، ثم نحاول قراءتها بالتساهل أعلاه
function parseClassLabel(raw) {
  const digitMatch = raw.match(/([0-9]{1,2})$/);
  if (!digitMatch) return null;
  const section = parseInt(digitMatch[1]);
  const wordPart = raw.slice(0, digitMatch.index).replace(/\/$/, '');
  const resolved = resolveGradeWord(wordPart);
  if (resolved.grade) return { grade: resolved.grade, section, corrected: !!resolved.corrected };
  if (resolved.ambiguous) return { grade: null, section, ambiguous: true, rawWord: wordPart };
  return null;
}

async function parsePdfFile(file) {
  await loadPdfJs();
  if (!window.pdfjsLib) throw new Error('مكتبة قراءة PDF ما تحمّلت. حدّث الصفحة وجرب مرة ثانية.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

  const teachers = [];
  const issues = [];
  let correctedCount = 0;
  let classCorrectedTotal = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const items = filterBoilerplateItems(await extractPageItems(page));

    if (items.length === 0) {
      issues.push({ page: pageNum, reason: 'ما فيه أي نص قابل للقراءة بهذي الصفحة — يحتمل إنها صورة ممسوحة ضوئيًا.' });
      continue;
    }

    const mode = calibratePage(items);
    const decode = mode === 'reversed' ? decodeReversed : decodeNormal;

    const columnAnchors = findColumnAnchors(items);
    if (Object.keys(columnAnchors).length !== 7) {
      issues.push({ page: pageNum, reason: 'ما قدرت أحدد أعمدة الحصص (1-7) بهذي الصفحة' });
      continue;
    }
    const byX = Object.entries(columnAnchors).map(([p, a]) => ({ period: parseInt(p), x: a.x })).sort((a, b) => a.x - b.x);
    const columnAnchorItems = new Set(Object.values(columnAnchors).map(a => a.item));

    const dayAnchors = findDayAnchors(items, decode);
    if (Object.keys(dayAnchors).length !== 5) {
      issues.push({ page: pageNum, reason: 'ما قدرت أحدد كل أيام الأسبوع (5 أيام) بهذي الصفحة' });
      continue;
    }
    const dayAnchorItems = new Set(Object.values(dayAnchors).map(a => a.item));

    const title = parseTeacherName(items, columnAnchorItems, dayAnchorItems, decode);
    if (!title) {
      issues.push({ page: pageNum, reason: 'ما قدرت أحدد اسم المعلم (عنوان الصفحة) بهذي الصفحة' });
      continue;
    }

    const usedItems = new Set([...columnAnchorItems, ...dayAnchorItems, ...title.items]);
    const contentItems = items.filter(it => !usedItems.has(it) && ARABIC_RE.test(it.str));

    const dayYs = Object.values(dayAnchors).map(a => a.y).sort((a, b) => a - b);
    const dayGaps = [];
    for (let i = 0; i < dayYs.length - 1; i++) dayGaps.push(dayYs[i + 1] - dayYs[i]);
    dayGaps.sort((a, b) => a - b);
    const daySpacing = dayGaps[Math.floor(dayGaps.length / 2)] || 90;
    const maxDayDist = daySpacing * 0.6;

    const rowsByDay = {};
    Object.keys(dayAnchors).forEach(day => { rowsByDay[day] = []; });
    contentItems.forEach(it => {
      let bestDay = null, bestD = Infinity;
      Object.entries(dayAnchors).forEach(([day, a]) => {
        const d = Math.abs(a.y - it.y);
        if (d < bestD) { bestD = d; bestDay = day; }
      });
      if (bestDay && bestD <= maxDayDist) rowsByDay[bestDay].push(it);
    });

    const cellMap = {}; // 'day-period' -> { subject, grade, section }
    let filledCount = 0;
    let pageCorrected = 0;
    let pageClassCorrected = 0;
    const unresolvedCells = []; // { day, period, rawWord } - عيب ترميز بالخط ما قدرنا نحسم الفصل منه

    Object.entries(rowsByDay).forEach(([day, rowItems]) => {
      if (rowItems.length === 0) return;
      const sizes = [...new Set(rowItems.map(it => Math.round(it.size * 10) / 10))].sort((a, b) => a - b);
      let splitPoint = -Infinity;
      if (sizes.length > 1) {
        let maxGap = -1, gapIdx = 0;
        for (let i = 0; i < sizes.length - 1; i++) {
          const g = sizes[i + 1] - sizes[i];
          if (g > maxGap) { maxGap = g; gapIdx = i; }
        }
        splitPoint = (sizes[gapIdx] + sizes[gapIdx + 1]) / 2;
      }
      // بعكس ملف الجدول حسب الفصول: هنا تسمية الفصل (صف/شعبة) هي الخط الأكبر، والمادة الخط الأصغر
      const classLabelItems = rowItems.filter(it => it.size > splitPoint);
      const subjectItems = rowItems.filter(it => it.size <= splitPoint);

      groupByColumn(classLabelItems, byX, true).forEach(g => {
        const raw = joinCellText(g.items, decode).replace(/\s+/g, '');
        const m = raw.match(CLASS_LABEL_RE);
        let grade = null, section = null;
        if (m) {
          grade = GRADE_MAP[m[1]];
          section = parseInt(m[2]);
        } else {
          const parsed = parseClassLabel(raw);
          if (parsed && parsed.grade) {
            grade = parsed.grade;
            section = parsed.section;
            pageClassCorrected++;
          } else if (parsed && parsed.ambiguous) {
            // عيب ترميز بالخط خلّى كلمة الصف تحتمل أكثر من صف دراسي - ما نخمّن، نسجلها للمراجعة اليدوية
            g.periods.forEach(p => unresolvedCells.push({ day, period: p, rawWord: parsed.rawWord }));
            return;
          } else {
            return; // خلية مثل "مجمع الإسلامية" أو غير متعرف عليها - نتجاهلها
          }
        }
        g.periods.forEach(p => {
          const key = day + '-' + p;
          if (!cellMap[key]) { cellMap[key] = { subject: '', grade: null, section: null }; filledCount++; }
          cellMap[key].grade = grade;
          cellMap[key].section = section;
        });
      });
      groupByColumn(subjectItems, byX, false).forEach(g => {
        const raw = joinCellText(g.items, decode);
        if (!raw) return;
        const text = correctAgainstVocab(raw, SCHEDULE_SUBJECTS);
        if (text !== raw) { pageCorrected++; correctedCount++; }
        g.periods.forEach(p => {
          const key = day + '-' + p;
          if (!cellMap[key]) cellMap[key] = { subject: '', grade: null, section: null };
          cellMap[key].subject = text;
        });
      });

      for (let p = 1; p < 7; p++) {
        const a = cellMap[day + '-' + p];
        const b = cellMap[day + '-' + (p + 1)];
        if (a && b && a.grade && a.grade === b.grade && a.section === b.section) {
          if (!a.subject && b.subject) a.subject = b.subject;
          else if (!b.subject && a.subject) b.subject = a.subject;
        }
      }
    });

    const cells = [];
    Object.entries(cellMap).forEach(([key, val]) => {
      if (!val.subject || !val.grade || !val.section) return;
      const [day, period] = key.split('-');
      cells.push({ day, period: parseInt(period), grade: val.grade, section: val.section, subject: val.subject });
    });

    teachers.push({
      page: pageNum, teacherNameRaw: title.name, cells, filledCount,
      correctedCount: pageCorrected, classCorrectedCount: pageClassCorrected, unresolvedCells,
    });
    classCorrectedTotal += pageClassCorrected;
  }

  return { teachers, issues, correctedCount, classCorrectedTotal };
}

let parsedTeachers = [];
let teacherProfiles = [];

function renderDetailTable(cells, unresolvedCells) {
  const order = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4 };
  const sorted = [...cells].sort((a, b) => (order[a.day] - order[b.day]) || (a.period - b.period));
  const rows = sorted.map(c => `
    <tr>
      <td>${DAY_LABELS_AR[c.day]}</td>
      <td>${c.period}</td>
      <td>${esc(c.subject)}</td>
      <td>${esc(gradeLabels[c.grade] || c.grade)} - ${c.section}</td>
    </tr>`).join('');
  let extra = '';
  if (unresolvedCells && unresolvedCells.length) {
    const sortedU = [...unresolvedCells].sort((a, b) => (order[a.day] - order[b.day]) || (a.period - b.period));
    const uRows = sortedU.map(u => `
      <tr style="color:var(--danger);">
        <td>${DAY_LABELS_AR[u.day]}</td>
        <td>${u.period}</td>
        <td colspan="2">؟ ما تحدد الفصل بسبب عيب بالملف — أدخلها يدويًا</td>
      </tr>`).join('');
    extra = `<p style="font-size:11.5px; color:var(--danger); margin:10px 0 4px;">حصص تحتاج مراجعة يدوية (الفصل غير واضح):</p>
      <table><tbody>${uRows}</tbody></table>`;
  }
  return `<table><thead><tr><th>اليوم</th><th>الحصة</th><th>المادة</th><th>الفصل</th></tr></thead><tbody>${rows}</tbody></table>${extra}`;
}

async function renderSummary({ teachers, issues, correctedCount, classCorrectedTotal }) {
  parsedTeachers = teachers;
  const el = document.getElementById('tsc-pdf-summary');

  const { data: profiles } = await sb.from('profiles').select('id, full_name').in('role', ['teacher', 'deputy']);
  teacherProfiles = (profiles || []).slice().sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  const profileByNorm = new Map(teacherProfiles.map(p => [normalizeArText(p.full_name), p]));

  const unresolvedTotal = teachers.reduce((sum, t) => sum + (t.unresolvedCells ? t.unresolvedCells.length : 0), 0);

  let html = `<p style="font-size:12.5px; color:var(--slate); margin:10px 0;">تم التعرف على <b>${teachers.length}</b> معلم${issues.length ? ` (وتعذّر التعرف على ${issues.length} صفحة، راجعها بالأسفل)` : ''}.</p>`;
  if (correctedCount > 0) {
    html += `<p style="font-size:12px; color:#b8860b; background:#fff8e6; border-radius:8px; padding:6px 10px; margin:0 0 10px;">⚠ تم تصحيح <b>${correctedCount}</b> اسم مادة تلقائيًا (حروف ناقصة بسبب عيب ترميز بملف الـ PDF) — راجعها للتأكد.</p>`;
  }
  if (classCorrectedTotal > 0) {
    html += `<p style="font-size:12px; color:#b8860b; background:#fff8e6; border-radius:8px; padding:6px 10px; margin:0 0 10px;">⚠ تم تصحيح <b>${classCorrectedTotal}</b> تسمية فصل (صف/شعبة) تلقائيًا لنفس السبب — راجعها للتأكد.</p>`;
  }
  if (unresolvedTotal > 0) {
    html += `<p style="font-size:12px; color:var(--danger); background:var(--danger-light); border-radius:8px; padding:6px 10px; margin:0 0 10px;">⚠ فيه <b>${unresolvedTotal}</b> حصة ما قدرنا نحدد فصلها تلقائيًا (عيب ترميز بالملف خلّى اسم الصف يحتمل أكثر من قراءة) — موزّعة على المعلمين أدناه، وتحتاج إدخالها يدويًا من "الجدول الدراسي" بعد المراجعة.</p>`;
  }

  if (teachers.length > 0) {
    html += `<div style="max-height:460px; overflow-y:auto;">`;
    teachers.forEach((t, idx) => {
      const norm = normalizeArText(t.teacherNameRaw);
      const matched = profileByNorm.get(norm) || null;
      html += `
        <div class="tsc-teacher-row" data-idx="${idx}">
          <div class="tsc-row-head">
            <span class="tsc-name">${esc(t.teacherNameRaw)}</span>
            <span class="badge ${matched ? 'badge-meadow' : 'badge-gold'}">${matched ? 'متطابق تلقائيًا' : 'يحتاج ربط يدوي'}</span>
            <span style="font-size:11.5px; color:var(--slate);">${t.filledCount} حصة${t.correctedCount ? ` · تصحيح مادة ${t.correctedCount}` : ''}${t.classCorrectedCount ? ` · تصحيح فصل ${t.classCorrectedCount}` : ''}</span>
            ${t.unresolvedCells && t.unresolvedCells.length ? `<span class="badge badge-danger">${t.unresolvedCells.length} حصة تحتاج مراجعة يدوية</span>` : ''}
          </div>
          <div class="form-row" style="margin-top:8px;">
            <select class="tsc-link-select" data-idx="${idx}">
              <option value="">— استخدام الاسم من الملف كما هو (${esc(t.teacherNameRaw)}) —</option>
              ${teacherProfiles.map(p => `<option value="${p.id}" ${matched && matched.id === p.id ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('')}
            </select>
            <button type="button" class="text-action-btn tsc-preview-btn" data-idx="${idx}">عرض التفاصيل</button>
          </div>
          <div class="tsc-detail hidden" id="tsc-detail-${idx}"></div>
        </div>`;
    });
    html += `</div>
      <div style="margin-top:14px;">
        <button class="btn-primary" id="tsc-pdf-commit-all" style="width:auto; padding:11px 22px;">اعتماد كل المعلمين دفعة وحدة</button>
        <span id="tsc-pdf-commit-status" style="font-size:12.5px; color:var(--slate); margin-right:10px;"></span>
      </div>`;
  }

  if (issues.length > 0) {
    html += `<div style="margin-top:14px; background:var(--danger-light); border-radius:10px; padding:10px 14px;">
      <p style="font-size:12.5px; font-weight:700; color:var(--danger); margin-bottom:6px;">صفحات ما قدرنا نقرأها تلقائيًا:</p>
      ${issues.map(i => `<p style="font-size:12px; color:var(--danger); margin:2px 0;">صفحة ${i.page}: ${i.reason}</p>`).join('')}
    </div>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.tsc-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const detailEl = document.getElementById('tsc-detail-' + idx);
      if (!detailEl.classList.contains('hidden')) { detailEl.classList.add('hidden'); return; }
      detailEl.innerHTML = renderDetailTable(parsedTeachers[idx].cells, parsedTeachers[idx].unresolvedCells);
      detailEl.classList.remove('hidden');
    });
  });

  const commitBtn = document.getElementById('tsc-pdf-commit-all');
  if (commitBtn) commitBtn.addEventListener('click', commitAllParsed);
}

async function commitAllParsed() {
  const statusEl = document.getElementById('tsc-pdf-commit-status');
  const total = parsedTeachers.reduce((sum, t) => sum + t.cells.length, 0);
  if (!confirm(`سيتم حفظ/تحديث ${total} حصة بجدول الحصص من ${parsedTeachers.length} معلم. أي حصة موجودة مسبقًا لنفس الفصل/اليوم/الحصة راح تتغيّر بالمادة والمعلم الجديدين. متأكد؟`)) return;

  statusEl.textContent = 'جارٍ الاعتماد...';
  statusEl.style.color = 'var(--slate)';

  const selects = document.querySelectorAll('.tsc-link-select');
  const rows = [];
  selects.forEach(sel => {
    const idx = parseInt(sel.dataset.idx);
    const t = parsedTeachers[idx];
    const profileId = sel.value;
    const profile = profileId ? teacherProfiles.find(p => p.id === profileId) : null;
    const teacherName = profile ? profile.full_name : t.teacherNameRaw;
    t.cells.forEach(c => {
      rows.push({
        grade_level: c.grade, class_section: c.section,
        day_of_week: c.day, period_number: c.period,
        subject_name: c.subject, teacher_name: teacherName,
      });
    });
  });

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const { error } = await sb.from('class_schedules').upsert(chunk, { onConflict: 'grade_level,class_section,day_of_week,period_number' });
    if (error) {
      statusEl.textContent = 'تعذر الحفظ: ' + error.message;
      statusEl.style.color = 'var(--danger)';
      return;
    }
  }

  statusEl.textContent = 'تم اعتماد جدول كل المعلمين بنجاح ✓';
  statusEl.style.color = 'var(--meadow)';
}

async function handleParseClick() {
  const fileInput = document.getElementById('tsc-pdf-file');
  const errEl = document.getElementById('tsc-pdf-error');
  const summaryEl = document.getElementById('tsc-pdf-summary');
  errEl.style.display = 'none';
  errEl.textContent = '';
  summaryEl.innerHTML = '<p style="font-size:12.5px; color:var(--slate); margin-top:10px;">جارٍ القراءة والتحليل، ممكن تاخذ نص دقيقة لو الملف كبير...</p>';

  const file = fileInput.files[0];
  if (!file) {
    errEl.textContent = 'اختر ملف PDF أولاً';
    errEl.style.display = 'block';
    summaryEl.innerHTML = '';
    return;
  }

  try {
    const result = await parsePdfFile(file);
    if (result.teachers.length === 0 && result.issues.length === 0) {
      errEl.textContent = 'ما قدرت أستخرج أي معلم من الملف. تأكد إنه ملف PDF سليم وبنفس شكل جدول المعلمين الفردي المعتاد.';
      errEl.style.display = 'block';
      summaryEl.innerHTML = '';
      return;
    }
    await renderSummary(result);
    if (result.teachers.length === 0) {
      errEl.textContent = 'ما قدرت أستخرج أي معلم من الملف — شوف تفاصيل كل صفحة بالأسفل لمعرفة السبب.';
      errEl.style.display = 'block';
    }
  } catch (e) {
    console.error(e);
    errEl.textContent = 'تعذرت قراءة الملف: ' + (e && e.message ? e.message : e);
    errEl.style.display = 'block';
    summaryEl.innerHTML = '';
  }
}

const parseBtn = document.getElementById('tsc-pdf-parse-btn');
if (parseBtn) parseBtn.addEventListener('click', handleParseClick);
