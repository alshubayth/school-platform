import { sb, gradeLabels } from './core.js';
import { SCHEDULE_SUBJECTS, previewInGrid } from './schedule.js';

/*
 * استيراد جدول الحصص من ملف PDF (بنفس شكل الجدول الرسمي المعتمد من المدرسة - برنامج aSc Timetables).
 * الفكرة: نقرأ نص كل صفحة بإحداثياته (عبر pdf.js)، ونحدد الأعمدة (الحصص 1-7) والصفوف (الأيام) هندسيًا
 * من مواقع النصوص نفسها (مو أرقام ثابتة بالكود) عشان يشتغل حتى لو تغيّر حجم/تخطيط الملف شوي مستقبلًا.
 * كل صفحة تُقرأ لحالها ولا تُعتمد تلقائيًا - لازم مراجعة وتأكيد يدوي من شاشة "الجدول الدراسي".
 */

const GRADE_MAP = { 'أول': 'first_intermediate', 'ثاني': 'second_intermediate', 'ثالث': 'third_intermediate' };
const DAY_MAP = { 'احد': 'sunday', 'اثنين': 'monday', 'ثلاثاء': 'tuesday', 'اربعاء': 'wednesday', 'أربعاء': 'wednesday', 'خميس': 'thursday' };
const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
const DAY_LABELS_AR = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
const REFERENCE_STRINGS = new Set([...Object.keys(DAY_MAP), ...Object.keys(GRADE_MAP), ...SCHEDULE_SUBJECTS]);
const ARABIC_RE = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩';

let parsedClasses = []; // [{page, grade, section, map}]

function translateDigits(s) {
  return s.replace(/[٠-٩]/g, ch => String(EASTERN_DIGITS.indexOf(ch)));
}
function decodeReversed(raw) {
  return translateDigits(Array.from(raw).reverse().join('').normalize('NFKC'));
}
function decodeNormal(raw) {
  return translateDigits(raw.normalize('NFKC'));
}

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
  const byPeriod = {};
  items.forEach(it => {
    const t = translateDigits(it.str.normalize('NFKC')).trim();
    if (/^[1-7]$/.test(t)) {
      const period = parseInt(t);
      if (!(period in byPeriod)) byPeriod[period] = { x: (it.x0 + it.x1) / 2, item: it };
    }
  });
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

// نص عنوان الصفحة (منطقة العنوان/الترويسة) طلع أحيانًا مكتوب بترتيب منطقي صحيح من pdf.js حتى لو باقي
// نصوص الصفحة (جدول الحصص نفسه) محتاجة وضع "معكوس" (decode المحسوب لكل الصفحة). فبدل ما نعتمد على
// وضع واحد بس هنا، نجرب الوضعين (عادي ومعكوس) على كل عنصر لحاله عشان نلقط أي الاثنين يطابق.
function bestDecodeMatch(str, testers) {
  for (const d of [decodeNormal, decodeReversed]) {
    const t = translateDigits(d(str)).trim();
    for (const test of testers) {
      const r = test(t);
      if (r) return r;
    }
  }
  return null;
}

function parseTitle(items, decode, excludeItems) {
  // الحالة الشائعة: المرحلة/الفصل بخلية واحدة مثل "أول/1"
  // نرجّع أيضًا العنصر (العناصر) اللي طلعت منها القراءة عشان نستبعدها من محتوى الجدول لاحقًا
  // (وإلا ينسحب نص العنوان بالغلط داخل إحدى خلايا الجدول القريبة منه).
  for (const it of items) {
    if (excludeItems.has(it)) continue;
    const res = bestDecodeMatch(it.str, [t => {
      const m = t.match(/^(أول|ثاني|ثالث)\s*\/?\s*([0-9]+)$/);
      return m ? { grade: GRADE_MAP[m[1]], section: parseInt(m[2]) } : null;
    }]);
    if (res) return { ...res, items: [it] };
  }
  // احتياطي: كلمة المرحلة ورقم الفصل (وأحيانًا حتى "/" الفاصلة) بعناصر منفصلة قريبة من بعض هندسيًا -
  // نطابق كل عنصر مع الوضعين (عادي/معكوس) لحاله، بدون الاعتماد على ترتيب تجميعها.
  const gradeItems = items.filter(it => !excludeItems.has(it) && [decodeNormal, decodeReversed].some(d => ['أول', 'ثاني', 'ثالث'].includes(d(it.str).trim())));
  const digitItems = items.filter(it => {
    if (excludeItems.has(it)) return false;
    return [decodeNormal, decodeReversed].some(d => /^[0-9]{1,2}$/.test(translateDigits(d(it.str)).trim()));
  });
  for (const g of gradeItems) {
    let best = null, bestD = Infinity;
    digitItems.forEach(d => {
      const dist = Math.hypot(d.x0 - g.x0, d.y - g.y);
      if (dist < bestD) { bestD = dist; best = d; }
    });
    if (best && bestD < 80) {
      const gradeWord = [decodeNormal, decodeReversed].map(d => d(g.str).trim()).find(t => ['أول', 'ثاني', 'ثالث'].includes(t));
      const digitStr = [decodeNormal, decodeReversed].map(d => translateDigits(d(best.str)).trim()).find(t => /^[0-9]{1,2}$/.test(t));
      return { grade: GRADE_MAP[gradeWord], section: parseInt(digitStr), items: [g, best] };
    }
  }
  return null;
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

// allowMerge: نسمح بكشف "حصة مزدوجة" (نص يتوسط حدّ عمودين) للمادة فقط - لأن عرضها ثابت غالبًا فتوسّطها
// دليل موثوق على امتدادها لحصتين. أسماء المعلمين تختلف بعرضها بشكل كبير فمركزها الهندسي ممكن يقع قرب
// حد عمودين بالصدفة حتى لو الاسم لحصة وحدة بس - فنجبرها دايمًا على أقرب عمود واحد، والمعلم للحصة
// الثانية المزدوجة نعبّيه لاحقًا فقط لو تأكدنا إن نفس المادة مكرره بالحصتين (راجع التعليق بالأسفل).
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
  const sorted = [...items].sort((a, b) => b.x0 - a.x0); // قراءة من اليمين لليسار
  let result = '';
  let prevX0 = null;
  sorted.forEach(it => {
    if (prevX0 !== null) {
      const gap = prevX0 - it.x1;
      if (gap > 3) result += ' ';
    }
    result += decode(it.str);
    prevX0 = it.x0;
  });
  return result.trim();
}

async function extractPageItems(page) {
  const content = await page.getTextContent();
  // ملاحظة مهمة (تأكدنا منها بالتشخيص مع ملف حقيقي): pdf.js يرجّع كل عنصر (item) بنصه الصحيح
  // منطقيًا زي ما هو مكتوب فعلاً (مو بترتيب بصري معكوس زي بعض أدوات استخراج PDF الثانية) - فما نحتاج
  // ندمج الحروف يدويًا ولا نعكسها. اللي نحتاجه بس: ترتيب العناصر المنفصلة (لما الخلية توزّعت على أكثر
  // من عنصر) من اليمين لليسار عند التجميع - وهذا موجود أصلاً بدالة joinCellText.
  return content.items
    .filter(it => it.str && it.str.trim().length > 0)
    .map(it => {
      const tr = it.transform;
      return {
        str: it.str,
        x0: tr[4],
        x1: tr[4] + it.width,
        y: tr[5],
        size: Math.hypot(tr[2], tr[3]) || Math.hypot(tr[0], tr[1]) || 1,
      };
    });
}

async function parsePdfFile(file) {
  if (!window.pdfjsLib) throw new Error('مكتبة قراءة PDF ما تحمّلت. حدّث الصفحة وجرب مرة ثانية.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

  const classes = [];
  const issues = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const items = await extractPageItems(page);

    if (items.length === 0) {
      issues.push({ page: pageNum, reason: 'ما فيه أي نص قابل للقراءة بهذي الصفحة — يحتمل إن الملف صورة ممسوحة ضوئيًا (سكان) أو تم ضغطه بطريقة حوّلت الصفحات لصور بدل نص. جرّب ملف PDF الأصلي غير المضغوط.' });
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

    const excludeForTitle = new Set([...columnAnchorItems, ...dayAnchorItems]);
    const title = parseTitle(items, decode, excludeForTitle);
    if (!title) {
      issues.push({ page: pageNum, reason: 'ما قدرت أحدد المرحلة/الفصل (اسم الصفحة) بهذي الصفحة' });
      continue;
    }

    const usedItems = new Set([...columnAnchorItems, ...dayAnchorItems, ...(title.items || [])]);
    const contentItems = items.filter(it => !usedItems.has(it) && ARABIC_RE.test(it.str));

    // أقصى مسافة معقولة بين خلية ومنتصف صف يومها (نص متوسط تباعد الأيام) - لاستبعاد أي نص خارج
    // الجدول نفسه (زي تذييل الصفحة "aSc Timetables ... جدول الفصل الدراسي" اللي ينطبع أسفل كل صفحة
    // وأقرب صف له هو "الخميس" رغم إنه مو جزء من جدوله فعليًا).
    const dayYs = Object.values(dayAnchors).map(a => a.y).sort((a, b) => a - b);
    const dayGaps = [];
    for (let i = 0; i < dayYs.length - 1; i++) dayGaps.push(dayYs[i + 1] - dayYs[i]);
    dayGaps.sort((a, b) => a - b);
    const daySpacing = dayGaps[Math.floor(dayGaps.length / 2)] || 90;
    const maxDayDist = daySpacing * 0.6;

    // تجميع كل خلية حسب أقرب يوم (صف)
    const rows = {};
    Object.keys(dayAnchors).forEach(day => { rows[day] = []; });
    contentItems.forEach(it => {
      let bestDay = null, bestD = Infinity;
      Object.entries(dayAnchors).forEach(([day, a]) => {
        const d = Math.abs(a.y - it.y);
        if (d < bestD) { bestD = d; bestDay = day; }
      });
      if (bestDay && bestD <= maxDayDist) rows[bestDay].push(it);
    });

    const classMap = {};
    let filledCount = 0;

    Object.entries(rows).forEach(([day, rowItems]) => {
      if (rowItems.length === 0) return;
      const sizes = [...new Set(rowItems.map(it => Math.round(it.size * 10) / 10))].sort((a, b) => a - b);
      let splitPoint = -Infinity; // افتراضيًا الكل "مادة" لو ما فيه إلا حجم خط واحد
      if (sizes.length > 1) {
        let maxGap = -1, gapIdx = 0;
        for (let i = 0; i < sizes.length - 1; i++) {
          const g = sizes[i + 1] - sizes[i];
          if (g > maxGap) { maxGap = g; gapIdx = i; }
        }
        splitPoint = (sizes[gapIdx] + sizes[gapIdx + 1]) / 2;
      }
      const subjItems = rowItems.filter(it => it.size > splitPoint);
      const teachItems = rowItems.filter(it => it.size <= splitPoint);

      groupByColumn(subjItems, byX, true).forEach(g => {
        const text = joinCellText(g.items, decode);
        if (!text) return;
        g.periods.forEach(p => {
          const key = day + '-' + p;
          if (!classMap[key]) { classMap[key] = { subject: '', teacher: '' }; filledCount++; }
          classMap[key].subject = text;
        });
      });
      groupByColumn(teachItems, byX, false).forEach(g => {
        const text = joinCellText(g.items, decode);
        if (!text) return;
        g.periods.forEach(p => {
          const key = day + '-' + p;
          if (!classMap[key]) classMap[key] = { subject: '', teacher: '' };
          classMap[key].teacher = text;
        });
      });

      // حصة مزدوجة (نفس المادة بحصتين متتاليتين): أحيانًا نص المعلم (لأنه أقصر من عرض الحصتين)
      // ينحسب هندسيًا بحصة وحدة بس مع إن المادة انحسبت صح بالحصتين. نعبّي الفراغ من الحصة الجارة
      // لو نفس المادة بالحصتين وواحدة بس فيها اسم معلم.
      for (let p = 1; p < 7; p++) {
        const a = classMap[day + '-' + p];
        const b = classMap[day + '-' + (p + 1)];
        if (a && b && a.subject && a.subject === b.subject) {
          if (!a.teacher && b.teacher) a.teacher = b.teacher;
          else if (!b.teacher && a.teacher) b.teacher = a.teacher;
        }
      }
    });

    classes.push({ page: pageNum, grade: title.grade, section: title.section, map: classMap, filledCount });
  }

  return { classes, issues };
}

function renderSummary({ classes, issues }) {
  parsedClasses = classes;
  const el = document.getElementById('sc-pdf-summary');

  const order = { first_intermediate: 0, second_intermediate: 1, third_intermediate: 2 };
  const sorted = [...classes].sort((a, b) => (order[a.grade] - order[b.grade]) || (a.section - b.section));

  let html = `<p style="font-size:12.5px; color:var(--slate); margin:10px 0;">تم التعرف على <b>${classes.length}</b> فصل${issues.length ? ` (وتعذّر التعرف على ${issues.length} صفحة، راجعها يدويًا)` : ''}.</p>`;

  if (classes.length > 0) {
    html += `<div style="max-height:280px; overflow-y:auto; border-radius:10px; background:#fff; padding:6px;">`;
    sorted.forEach((c, idx) => {
      const totalCells = 34; // 7×5 ناقص فسحة الخميس (خلية فاضية عادة)
      const warn = c.filledCount < totalCells - 4; // فرق واضح عن المتوقع
      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-bottom:1px solid var(--sand);">
          <span style="font-size:12.5px; font-weight:600;">${gradeLabels[c.grade]} - الفصل ${c.section} ${warn ? '<span style="color:var(--danger);">⚠ عدد خلايا قليل، راجعها</span>' : ''}</span>
          <button type="button" class="text-action-btn sc-preview-btn" data-idx="${idx}" style="width:auto;">معاينة</button>
        </div>`;
    });
    html += `</div>
      <div style="margin-top:14px;">
        <button class="btn-primary" id="sc-pdf-commit-all" style="width:auto; padding:11px 22px;">اعتماد كل الفصول دفعة وحدة</button>
        <span id="sc-pdf-commit-status" style="font-size:12.5px; color:var(--slate); margin-right:10px;"></span>
      </div>`;
  }

  if (issues.length > 0) {
    html += `<div style="margin-top:14px; background:var(--danger-light); border-radius:10px; padding:10px 14px;">
      <p style="font-size:12.5px; font-weight:700; color:var(--danger); margin-bottom:6px;">صفحات ما قدرنا نقرأها تلقائيًا:</p>
      ${issues.map(i => `<p style="font-size:12px; color:var(--danger); margin:2px 0;">صفحة ${i.page}: ${i.reason}</p>`).join('')}
    </div>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.sc-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cls = sorted[parseInt(btn.dataset.idx)];
      previewInGrid(cls.grade, cls.section, cls.map);
    });
  });

  const commitBtn = document.getElementById('sc-pdf-commit-all');
  if (commitBtn) commitBtn.addEventListener('click', commitAllParsed);
}

async function commitAllParsed() {
  const statusEl = document.getElementById('sc-pdf-commit-status');
  if (!confirm(`سيتم استبدال جدول ${parsedClasses.length} فصل بالكامل بالبيانات المستخرجة من الملف. هذا الإجراء يحذف الجدول الحالي لهذي الفصول ويحطّ بدله الجديد. متأكد؟`)) return;

  statusEl.textContent = 'جارٍ الاعتماد...';
  statusEl.style.color = 'var(--slate)';

  for (const cls of parsedClasses) {
    await sb.from('class_schedules').delete().eq('grade_level', cls.grade).eq('class_section', cls.section);
    const rows = [];
    Object.entries(cls.map).forEach(([key, val]) => {
      if (!val.subject) return;
      const [day, period] = key.split('-');
      rows.push({
        grade_level: cls.grade, class_section: cls.section,
        day_of_week: day, period_number: parseInt(period),
        subject_name: val.subject, teacher_name: val.teacher || null,
      });
    });
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      if (chunk.length === 0) continue;
      const { error } = await sb.from('class_schedules').insert(chunk);
      if (error) {
        statusEl.textContent = `تعذر حفظ ${gradeLabels[cls.grade]} - الفصل ${cls.section}: ${error.message}`;
        statusEl.style.color = 'var(--danger)';
        return;
      }
    }
  }

  statusEl.textContent = 'تم اعتماد كل الفصول بنجاح ✓';
  statusEl.style.color = 'var(--meadow)';
}

async function handleParseClick() {
  const fileInput = document.getElementById('sc-pdf-file');
  const errEl = document.getElementById('sc-pdf-error');
  const summaryEl = document.getElementById('sc-pdf-summary');
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
    if (result.classes.length === 0 && result.issues.length === 0) {
      errEl.textContent = 'ما قدرت أستخرج أي فصل من الملف. تأكد إنه ملف PDF سليم وبنفس شكل الجدول الرسمي المعتاد.';
      errEl.style.display = 'block';
      summaryEl.innerHTML = '';
      return;
    }
    renderSummary(result);
    if (result.classes.length === 0) {
      errEl.textContent = 'ما قدرت أستخرج أي فصل من الملف — شوف تفاصيل كل صفحة بالأسفل لمعرفة السبب.';
      errEl.style.display = 'block';
    }
  } catch (e) {
    console.error(e);
    errEl.textContent = 'تعذرت قراءة الملف: ' + (e && e.message ? e.message : e);
    errEl.style.display = 'block';
    summaryEl.innerHTML = '';
  }
}

document.getElementById('sc-pdf-parse-btn').addEventListener('click', handleParseClick);
