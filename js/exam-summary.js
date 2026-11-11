/* =========================================================================
 * ملخص الاختبار: صفحة واحدة مركّزة تُقرأ في دقيقة وتُطبع على ورقة A4
 * الخلاصة بجملة واحدة، أربعة أرقام، توزيع المستويات، الفصول، الأسئلة الأضعف،
 * الطلاب الأعلى والمحتاجون للمتابعة، ثم ما يُقترح عمله.
 * ========================================================================= */
import { keyHit } from './grading-core.js';
import { printOrgName } from './core.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = x => Math.round(x || 0).toLocaleString('en-US');
const P = x => `${Math.round(x || 0)}%\u200E`;
const n1 = x => (Math.round((x || 0) * 10) / 10).toLocaleString('en-US');
const students = n => (n === 1 ? 'طالب واحد' : n === 2 ? 'طالبان' : n >= 3 && n <= 10 ? `${n} طلاب` : `${n} طالبًا`);
const LEVELS = [['ممتاز', 90, 'l1'], ['جيد جدًا', 80, 'l2'], ['جيد', 70, 'l3'], ['مقبول', 60, 'l4'], ['دون 60%\u200E', 0, 'l5']];
const PASS = 60;

function scoreAll(rep) {
  const rd = rep.raw_data || {}; const list = Array.isArray(rd.students) ? rd.students : [];
  const n = rep.item_count || (rep.key_raw || []).length;
  const W = Array.from({ length: n }, (_, i) => (Array.isArray(rd.points) && Number.isFinite(+rd.points[i]) && +rd.points[i] >= 0 ? +rd.points[i] : 1));
  const max = W.reduce((a, b) => a + b, 0) || 1;
  return list.map(st => {
    const K = st.key || rep.key_raw || []; let t = 0;
    for (let i = 0; i < n; i++) if (keyHit((st.answers || [])[i], K[i])) t += W[i];
    if (Number.isFinite(+st.essay)) t += +st.essay;
    return { name: st.name || '', section: st.section == null ? '' : String(st.section).trim(), total: t, pct: (t / (max + (Number.isFinite(+rd.essayMax) && rd.hasEssay ? +rd.essayMax : 0))) * 100 };
  });
}

export function renderExamSummary(rep, panel) {
  const s = rep.stats || {};
  const rows = scoreAll(rep);
  if (!rows.length) { panel.innerHTML = '<p class="xs-none">لا توجد أوراق طلاب في هذا الاختبار بعد.</p>'; return; }
  const n = rows.length;
  const meanPct = rows.reduce((a, r) => a + r.pct, 0) / n;
  const passed = rows.filter(r => r.pct >= PASS).length;
  const below50 = rows.filter(r => r.pct < 50).length;
  const maxScore = s.maxScore || rep.item_count || 0;
  const sorted = [...rows].sort((a, b) => b.pct - a.pct);
  const lv = LEVELS.map(([t, min, c], i) => ({ t, c, cnt: rows.filter(r => r.pct >= min && (i === 0 || r.pct < LEVELS[i - 1][1])).length }));

  // الفصول
  const sm = new Map();
  rows.forEach(r => { const k = r.section || '—'; if (!sm.has(k)) sm.set(k, []); sm.get(k).push(r.pct); });
  const secs = [...sm.entries()].map(([k, a]) => ({ k, n: a.length, avg: a.reduce((x, y) => x + y, 0) / a.length, pass: a.filter(p => p >= PASS).length }))
    .sort((a, b) => b.avg - a.avg);
  const hasSecs = secs.length > 1;

  // الأسئلة الأضعف
  const items = [...(s.itemStats || [])].sort((a, b) => a.correctPct - b.correctPct);
  const weakQ = items.filter(q => q.correctPct < 60).slice(0, 5);
  const qShow = weakQ.length ? weakQ : items.slice(0, 3);
  const distractor = q => { const w = (q.choices || []).filter(c => !c.isCorrect).sort((a, b) => b.count - a.count)[0]; return w && w.pct >= 20 ? `أكثر الأخطاء على (${esc(w.label)})` : ''; };

  // الخلاصة
  const level = meanPct >= 85 ? 'مرتفع' : meanPct >= 70 ? 'جيد' : meanPct >= 60 ? 'مقبول' : 'دون المأمول';
  const verdict = `متوسط الأداء ${P(meanPct)}، وهو مستوى ${level}. حصل ${students(passed)} من ${n} على ${P(PASS)} فأكثر.`;
  const best = secs[0], worst = secs[secs.length - 1];
  const note = hasSecs && best.avg - worst.avg >= 5
    ? `أعلى الفصول ${esc(best.k)} بمتوسط ${P(best.avg)}، وأدناها ${esc(worst.k)} بمتوسط ${P(worst.avg)}.`
    : hasSecs ? 'مستوى الفصول متقارب، والفارق بين أعلاها وأدناها أقل من 5 نقاط.' : '';

  // ما يُقترح عمله
  const todo = [];
  if (weakQ.length) todo.push(`إعادة شرح ما تقيسه ${weakQ.length === 1 ? 'السؤال' : 'الأسئلة'} ${weakQ.map(q => q.num).sort((a, b) => a - b).join('، ')}، فنسبة الإجابة الصحيحة فيها أقل من ${P(PASS)}.`);
  if (below50) todo.push(`متابعة ${students(below50)} حصلوا على أقل من ${P(50)} بخطة علاجية.`);
  if (hasSecs && meanPct - worst.avg >= 5) todo.push(`دعم الفصل ${esc(worst.k)}، فمتوسطه أقل من متوسط الصف بـ ${n0(meanPct - worst.avg)} نقاط.`);
  if (!todo.length) todo.push('النتائج مطمئنة، ولا يظهر ما يستدعي إجراءً علاجيًا عامًّا.');

  const date = (() => { try { return new Date(rep.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } })();
  const person = r => `<tr><td>${esc(r.name)}</td>${hasSecs ? `<td class="c">${esc(r.section)}</td>` : ''}<td class="n">${n1(r.total)}</td></tr>`;
  const meta = [['المادة', rep.subject_name], ['الصف', rep.grade_level], ['الفصل الدراسي', rep.semester], ['عدد الأسئلة', rep.item_count], ['التاريخ', date]].filter(([, v]) => v);

  panel.innerHTML = `<div class="xs-bar"><button type="button" class="xs-print" id="xs-print">طباعة الملخص</button></div>
  <article class="xs-sheet" id="xs-sheet">
    <header class="xs-head">
      <p class="xs-org">${esc(printOrgName())}</p>
      <h2>${esc(rep.title || 'ملخص الاختبار')}</h2>
      <dl class="xs-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </header>

    <p class="xs-verdict">${verdict}${note ? `<span>${note}</span>` : ''}</p>

    <div class="xs-nums">
      <div><b>${n0(meanPct)}<i>%</i></b><span>متوسط الأداء</span><small>${n1(s.mean != null ? s.mean : meanPct * maxScore / 100)} من ${n0(maxScore)}</small></div>
      <div><b>${passed}<i>/${n}</i></b><span>حصلوا على ${P(PASS)} فأكثر</span><small>${P(passed / n * 100)} من الطلاب</small></div>
      <div><b>${n1(sorted[0].total)}</b><span>أعلى درجة</span><small>${P(sorted[0].pct)}</small></div>
      <div><b>${n1(sorted[n - 1].total)}</b><span>أدنى درجة</span><small>${P(sorted[n - 1].pct)}</small></div>
    </div>

    <section class="xs-sec">
      <h3>توزيع الطلاب على المستويات</h3>
      <div class="xs-stack" role="img" aria-label="${lv.map(l => `${l.t} ${l.cnt}`).join('، ')}">${lv.filter(l => l.cnt).map(l => `<span class="${l.c}" style="flex:${l.cnt}"></span>`).join('')}</div>
      <div class="xs-legend">${lv.map(l => `<div><i class="${l.c}"></i><span>${l.t}</span><b>${l.cnt}</b><small>${P(l.cnt / n * 100)}</small></div>`).join('')}</div>
    </section>

    <div class="xs-two">
      ${hasSecs ? `<section class="xs-sec">
        <h3>الفصول</h3>
        <table class="xs-t"><thead><tr><th>الفصل</th><th class="c">الطلاب</th><th colspan="2">المتوسط</th></tr></thead>
        <tbody>${secs.map(x => `<tr><td>${esc(x.k)}</td><td class="c">${x.n}</td><td class="n">${P(x.avg)}</td><td class="bar"><span><i class="${x.avg < PASS ? 'low' : ''}" style="width:${Math.max(3, Math.min(100, x.avg))}%"></i></span></td></tr>`).join('')}</tbody></table>
      </section>` : ''}
      <section class="xs-sec">
        <h3>${weakQ.length ? 'أسئلة أخفق فيها أكثر الطلاب' : 'أصعب الأسئلة'}</h3>
        <table class="xs-t"><thead><tr><th>السؤال</th><th colspan="2">أجابوا إجابة صحيحة</th></tr></thead>
        <tbody>${qShow.map(q => `<tr><td>السؤال ${q.num}${distractor(q) ? `<small>${distractor(q)}</small>` : ''}</td><td class="n">${P(q.correctPct)}</td><td class="bar"><span><i class="${q.correctPct < PASS ? 'low' : ''}" style="width:${Math.max(3, q.correctPct)}%"></i></span></td></tr>`).join('')}</tbody></table>
      </section>
    </div>

    <div class="xs-two">
      <section class="xs-sec">
        <h3>الأعلى درجة</h3>
        <table class="xs-t"><thead><tr><th>الطالب</th>${hasSecs ? '<th class="c">الفصل</th>' : ''}<th class="n">الدرجة</th></tr></thead><tbody>${sorted.slice(0, 5).map(person).join('')}</tbody></table>
      </section>
      <section class="xs-sec">
        <h3>يحتاجون متابعة</h3>
        <table class="xs-t"><thead><tr><th>الطالب</th>${hasSecs ? '<th class="c">الفصل</th>' : ''}<th class="n">الدرجة</th></tr></thead><tbody>${sorted.slice(-5).reverse().map(person).join('')}</tbody></table>
      </section>
    </div>

    <section class="xs-sec xs-todo">
      <h3>ما يُقترح عمله</h3>
      <ol>${todo.map(t => `<li>${t}</li>`).join('')}</ol>
    </section>
  </article>`;

  panel.querySelector('#xs-print').onclick = () => {
    document.body.classList.add('xs-printing');
    const done = () => { document.body.classList.remove('xs-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
}
