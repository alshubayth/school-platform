import { sb, currentSchoolId, readScopedBySchool, gradeLabels, printOrgName, printLogo, ASSET_VERSION } from './core.js';

/* =========================================================================
 * ملف الطالب: المستوى الدراسي من درجات تقارير الاختبارات المرفوعة
 * - درجة الطالب في كل اختبار = الموضوعي (بمفتاح نموذجه ودرجة كل سؤال) + المقالي، كما في تقارير الاختبارات.
 * - الاختبارات موحدة لكل طلاب الصف، فالمقارنة بالنسبة المئوية مباشرة، مع ترتيب الطالب بين أقرانه.
 * - الإخفاق: المواد الأضعف مقارنة بالصف، والأسئلة التي أخطأ فيها وأجاب عنها أغلب زملائه،
 *   وأداؤه حسب نوع السؤال (اختيار من متعدد، صح وخطأ، مقالي).
 * - الصلاحية: المدير والوكيل فقط.
 * ========================================================================= */

const MODEL_B = 'ب';
const TYPE_LABEL = { periodic: 'فتري', diagnostic: 'تشخيصي', final: 'نهائي' };
const TYPE_PLURAL = { all: 'كل الاختبارات', periodic: 'الفترية', diagnostic: 'التشخيصية', final: 'النهائية' };
const ITEM_TYPE = { mcq: 'اختيار من متعدد', tf: 'صح وخطأ', essay: 'مقالي' };
const GRADE_ORDER = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const GRADE_CODE = Object.fromEntries(Object.entries(gradeLabels).map(([k, v]) => [v, k]));
const LEVELS = [
  { min: 90, label: 'ممتاز', cls: 'l5' },
  { min: 80, label: 'جيد جدًا', cls: 'l4' },
  { min: 65, label: 'جيد', cls: 'l3' },
  { min: 50, label: 'مقبول', cls: 'l2' },
  { min: 0, label: 'يحتاج إلى دعم', cls: 'l1' },
];
const EASY_P = 0.6;        // سؤال «سهل على الصف»: أجاب عنه 60% فأكثر

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
const keyHit = (v, k) => v != null && (Array.isArray(k) ? k.includes(v) : v === k);
const isAnswered = v => v != null && v !== '' && !(typeof v === 'number' && v <= 0) && !(Array.isArray(v) && !v.length);
const idOf = s => String(s || '').trim().replace(/-\d{1,2}$/, '');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pctTxt = p => (p == null ? '—' : `${Math.round(p)}%`);
const levelOf = p => LEVELS.find(l => p >= l.min) || LEVELS[LEVELS.length - 1];
const levelChip = p => (p == null ? '' : `<span class="sp-lv ${levelOf(p).cls}">${levelOf(p).label}</span>`);
const gradeTxt = gl => gradeLabels[gl] || gl || '';
const secTxt = s => (s ? `فصل ${s}` : '');
const dateTxt = iso => { try { return new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const qList = idx => idx.map(i => `س${i + 1}`).join('، ');
// تفصيل الخصم في اختبار: الأسئلة الخطأ والمتروكة ونقص المقالي
function lossParts(r) {
  const wrong = r.lost.filter(x => !x.blank), blank = r.lost.filter(x => x.blank);
  const easy = new Set(r.wrongEasy);
  const ptsTxt = x => (x.pts !== 1 ? ` (${fmtN(x.pts)})` : '');
  const essayLost = r.essay != null ? r.rep.essayMax - r.essay : 0;
  return { wrong, blank, easy, ptsTxt, essayLost, none: !wrong.length && !blank.length && essayLost <= 0 };
}
function lossHtml(r) {
  const L = lossParts(r);
  if (L.none) return '<span class="sp-ok">الدرجة كاملة</span>';
  return [
    L.wrong.length ? `<span class="sp-ls"><em>خطأ:</em> ${L.wrong.map(x => `<span class="sp-qw${L.easy.has(x.j) ? ' easy' : ''}" title="${L.easy.has(x.j) ? `أجاب عنه ${Math.round(r.rep.pVal[x.j] * 100)}% من الصف` : `أجاب عنه ${Math.round(r.rep.pVal[x.j] * 100)}% فقط من الصف`}">س${x.j + 1}${L.ptsTxt(x)}</span>`).join(' ')}</span>` : '',
    L.blank.length ? `<span class="sp-ls"><em>متروك دون إجابة:</em> ${L.blank.map(x => `<span class="sp-qb">س${x.j + 1}${L.ptsTxt(x)}</span>`).join(' ')}</span>` : '',
    L.essayLost > 0 ? `<span class="sp-ls"><em>المقالي:</em> نقص ${fmtN(L.essayLost)} من ${fmtN(r.rep.essayMax)}</span>` : '',
  ].filter(Boolean).join('');
}
function lossText(r) {
  const L = lossParts(r);
  if (L.none) return 'الدرجة كاملة';
  return [
    L.wrong.length ? `خطأ: ${L.wrong.map(x => `س${x.j + 1}${L.ptsTxt(x)}`).join('، ')}` : '',
    L.blank.length ? `متروك: ${L.blank.map(x => `س${x.j + 1}${L.ptsTxt(x)}`).join('، ')}` : '',
    L.essayLost > 0 ? `المقالي: نقص ${fmtN(L.essayLost)}` : '',
  ].filter(Boolean).join(' | ');
}

let reports = [];               // الاختبارات بعد الحساب
let students = new Map();       // رقم الطالب -> { id, name, gl, section, recs: [] }
let overall = new Map();        // رقم الطالب -> المعدل حسب الفلتر الحالي
let currentId = null;
const filt = { type: 'all', grade: '', section: '', q: '', sort: 'avg-desc', weak: false };

/* ---------- التحميل والحساب ---------- */
export async function loadStudentProfileModule() {
  const box = $('sp-container');
  box.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  try {
    const [reps, plat] = await Promise.all([fetchReports(), import('./students-cache.js?v=' + ASSET_VERSION).then(m => m.allStudents())]);
    build(reps, plat);
  } catch (e) {
    box.innerHTML = `<div class="sp-empty"><b>تعذر تحميل البيانات</b><span>${esc(e.message || e)}</span></div>`;
    return;
  }
  if (!filt.grade) filt.grade = GRADE_ORDER.find(g => [...students.values()].some(s => s.gl === g)) || '';
  currentId ? renderProfile(currentId) : renderOverview();
}

async function fetchReports() {
  const out = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('exam_reports').select('id, title, subject_name, grade_level, semester, exam_type, created_at, key_raw, raw_data, source')
        .order('created_at', { ascending: true }).range(from, from + 199);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 200) break;
  }
  return out;
}

function build(reps, plat) {
  const platMap = new Map(plat.map(p => [String(p.national_id).trim(), p]));
  students = new Map();
  reports = [];
  reps.forEach(rep => {
    const r = scoreReport(rep, platMap);
    if (!r) return;
    reports.push(r);
    r.recs.forEach(rec => {
      if (!students.has(rec.id)) {
        const p = platMap.get(rec.id);
        students.set(rec.id, { id: rec.id, name: p ? p.full_name : rec.name, gl: p ? p.grade_level : r.gl, section: p ? String(p.class_section || '') : rec.section, inPlatform: !!p, recs: [] });
      }
      students.get(rec.id).recs.push(rec);
    });
  });
}

function scoreReport(rep, platMap) {
  const rd = rep.raw_data || {};
  if (!Array.isArray(rd.students) || !rd.students.length) return null;
  const types = rd.itemTypes || [];
  const n = (rd.choiceCounts || []).length || types.length;
  const PW = i => (Array.isArray(rd.points) && Number.isFinite(+rd.points[i]) ? +rd.points[i] : 1);
  const objMax = Array.from({ length: n }, (_, i) => PW(i)).reduce((a, b) => a + b, 0);
  const essayMax = Number(rd.essayMax) || 0;
  const hasEssay = essayMax > 0 && rd.students.some(s => typeof s.essay === 'number');
  const max = objMax + (hasEssay ? essayMax : 0);
  if (!max) return null;
  const m = rd.models;
  const gl = GRADE_CODE[rep.grade_level] || null;
  const seen = new Set();
  const recs = [];
  rd.students.forEach(st => {
    const id = idOf(st.id);
    if (!id || seen.has(id)) return;
    const answered = (st.answers || []).some(v => v != null && v !== '');
    if (!answered && typeof st.essay !== 'number') return;   // ورقة فارغة = غائب
    seen.add(id);
    const isB = !!(m && st.model === MODEL_B && Array.isArray(m.keyB));
    const key = (isB ? m.keyB : (m && Array.isArray(m.keyA) ? m.keyA : rep.key_raw)) || [];
    const toA = i => (isB && m.mode === 'order' && Array.isArray(m.orderB) && m.orderB[i] != null ? m.orderB[i] : i);
    const correct = new Array(n).fill(false);
    const blank = new Array(n).fill(true);    // سؤال متروك بلا تظليل
    (st.answers || []).forEach((v, i) => {
      if (i >= n) return;
      const j = toA(i);
      if (j >= n) return;
      if (isAnswered(v)) blank[j] = false;
      if (keyHit(v, key[i])) correct[j] = true;
    });
    const obj = correct.reduce((s, c, j) => s + (c ? PW(j) : 0), 0);
    const essay = hasEssay ? Math.min(essayMax, Math.max(0, Number(st.essay) || 0)) : null;
    const total = obj + (essay || 0);
    const p = platMap.get(id);
    // الأسئلة التي خُصمت درجتها: خطأ أو متروك، مع درجة كل سؤال
    const lost = [];
    for (let j = 0; j < n; j++) if (!correct[j]) lost.push({ j, blank: blank[j], pts: PW(j) });
    recs.push({ repId: rep.id, id, name: st.name || '', section: p ? String(p.class_section || '') : String(st.section || ''), correct, lost, obj, essay, total, max, pct: (total / max) * 100 });
  });
  if (!recs.length) return null;
  // صعوبة كل سؤال (نسبة من أجاب عنه صحيحًا) ومتوسط الصف والفصول والمقالي
  const N = recs.length;
  const pVal = Array.from({ length: n }, (_, j) => recs.filter(r => r.correct[j]).length / N);
  const totals = recs.map(r => r.total).sort((a, b) => a - b);
  const bySec = new Map();
  recs.forEach(r => { if (!bySec.has(r.section)) bySec.set(r.section, []); bySec.get(r.section).push(r.pct); });
  const secMean = new Map([...bySec].map(([k, v]) => [k, mean(v)]));
  const essayMean = hasEssay ? mean(recs.map(r => (r.essay / essayMax) * 100)) : null;
  const typeIdx = { mcq: [], tf: [] };
  for (let j = 0; j < n; j++) (types[j] === 'tf' ? typeIdx.tf : typeIdx.mcq).push(j);
  const typePct = (r, k) => { const ix = typeIdx[k]; if (!ix.length) return null; const w = ix.reduce((s, j) => s + PW(j), 0); return w ? (ix.reduce((s, j) => s + (r.correct[j] ? PW(j) : 0), 0) / w) * 100 : null; };
  const typeMean = { mcq: mean(recs.map(r => typePct(r, 'mcq')).filter(v => v != null)), tf: mean(recs.map(r => typePct(r, 'tf')).filter(v => v != null)) };
  const out = {
    id: rep.id, title: rep.title || rep.subject_name || 'اختبار', subject: rep.subject_name || 'بدون مادة', gl, grade: rep.grade_level || '',
    type: rep.exam_type || 'periodic', date: rep.created_at, semester: rep.semester || '', n, max, objMax, essayMax: hasEssay ? essayMax : 0,
    N, meanPct: mean(recs.map(r => r.pct)), secMean, pVal, essayMean, typeMean, recs,
  };
  recs.forEach(r => {
    r.rep = out;
    const below = totals.filter(t => t < r.total).length, eq = totals.filter(t => t === r.total).length;
    r.percentile = ((below + eq / 2) / N) * 100;
    r.rank = totals.filter(t => t > r.total).length + 1;
    r.wrongEasy = pVal.map((p, j) => (!r.correct[j] && p >= EASY_P ? j : -1)).filter(j => j >= 0);
    r.typePct = { mcq: typePct(r, 'mcq'), tf: typePct(r, 'tf'), essay: hasEssay ? (r.essay / essayMax) * 100 : null };
  });
  return out;
}

/* ---------- التجميع حسب الفلتر ---------- */
const recsOf = s => s.recs.filter(r => filt.type === 'all' || r.rep.type === filt.type);

function subjectsOf(s) {
  const by = new Map();
  recsOf(s).forEach(r => { if (!by.has(r.rep.subject)) by.set(r.rep.subject, []); by.get(r.rep.subject).push(r); });
  return [...by.entries()].map(([subject, rs]) => {
    rs.sort((a, b) => String(a.rep.date).localeCompare(String(b.rep.date)));
    return {
      subject, recs: rs,
      pct: mean(rs.map(r => r.pct)),
      gradeMean: mean(rs.map(r => r.rep.meanPct)),
      classMean: mean(rs.map(r => r.rep.secMean.get(r.section)).filter(v => v != null)),
      percentile: mean(rs.map(r => r.percentile)),
      trend: rs.length > 1 ? rs[rs.length - 1].pct - rs[0].pct : null,
    };
  }).sort((a, b) => a.subject.localeCompare(b.subject, 'ar'));
}

function computeOverall() {
  overall = new Map();
  students.forEach(s => {
    const subs = subjectsOf(s);
    if (!subs.length) return;
    overall.set(s.id, { avg: mean(subs.map(x => x.pct)), percentile: mean(subs.map(x => x.percentile)), nSub: subs.length, nTests: subs.reduce((a, x) => a + x.recs.length, 0) });
  });
  // الترتيب داخل الصف (المرحلة) وداخل الفصل بالمعدل العام
  const groups = new Map();
  students.forEach(s => { const o = overall.get(s.id); if (!o) return; [`g|${s.gl}`, `c|${s.gl}|${s.section}`].forEach(k => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }); });
  groups.forEach((list, k) => {
    const sorted = list.map(o => o.avg).sort((a, b) => b - a);
    const avg = mean(sorted);
    list.forEach(o => {
      const rank = sorted.findIndex(v => v <= o.avg + 1e-9) + 1;
      if (k[0] === 'g') { o.gRank = rank; o.gN = list.length; o.gAvg = avg; } else { o.cRank = rank; o.cN = list.length; o.cAvg = avg; }
    });
  });
}

/* ---------- الصفحة الرئيسية للقسم ---------- */
function typeSeg() {
  const types = ['all', ...new Set(reports.map(r => r.type))];
  return `<div class="sp-seg" role="tablist" aria-label="نوع الاختبار">${types.map(t => `<button type="button" data-type="${t}" class="${filt.type === t ? 'on' : ''}">${TYPE_PLURAL[t] || t}</button>`).join('')}</div>`;
}
function wireTypeSeg(after) {
  document.querySelectorAll('.sp-seg button[data-type]').forEach(b => b.onclick = () => { filt.type = b.dataset.type; after(); });
}

function renderOverview() {
  currentId = null;
  const box = $('sp-container');
  if (!reports.length) {
    box.innerHTML = `<div class="sp-empty"><b>لا توجد درجات بعد</b><span>يُبنى ملف الطالب تلقائيًا من تقارير الاختبارات. ارفع نتائج اختبار من «تقارير الاختبارات» ثم عُد إلى هنا.</span></div>`;
    return;
  }
  computeOverall();
  const grades = GRADE_ORDER.filter(g => [...students.values()].some(s => s.gl === g));
  const sections = [...new Set([...students.values()].filter(s => s.gl === filt.grade && s.section).map(s => s.section))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  if (filt.section && !sections.includes(filt.section)) filt.section = '';
  box.innerHTML = `
    <div class="sp-page">
      <div class="sp-head">
        <div><h3>ملف الطالب</h3><p>المستوى الدراسي لكل طالب من درجات الاختبارات المرفوعة، ومقارنته بأقرانه في الصف والفصل.</p></div>
        ${typeSeg()}
      </div>
      <label class="sp-search">${ICON.search}<input type="search" id="sp-q" placeholder="ابحث باسم الطالب أو رقم الهوية في كل الصفوف" value="${esc(filt.q)}" autocomplete="off" /></label>
      <div class="sp-filters">
        <div class="sp-chips" role="tablist" aria-label="الصف">${grades.map(g => `<button type="button" data-grade="${g}" class="${filt.grade === g ? 'on' : ''}">${gradeTxt(g)}</button>`).join('')}</div>
        <select id="sp-sec" aria-label="الفصل"><option value="">كل الفصول</option>${sections.map(s => `<option value="${esc(s)}" ${filt.section === s ? 'selected' : ''}>فصل ${esc(s)}</option>`).join('')}</select>
        <select id="sp-sort" aria-label="الترتيب">
          <option value="avg-desc" ${filt.sort === 'avg-desc' ? 'selected' : ''}>الأعلى معدلًا أولًا</option>
          <option value="avg-asc" ${filt.sort === 'avg-asc' ? 'selected' : ''}>الأدنى معدلًا أولًا</option>
          <option value="name" ${filt.sort === 'name' ? 'selected' : ''}>بالاسم</option>
        </select>
        <label class="sp-check"><input type="checkbox" id="sp-weak" ${filt.weak ? 'checked' : ''}/> من يحتاجون إلى دعم فقط</label>
      </div>
      <div id="sp-summary"></div>
      <div class="sp-list" id="sp-list"></div>
    </div>`;
  wireTypeSeg(renderOverview);
  box.querySelectorAll('.sp-chips button').forEach(b => b.onclick = () => { filt.grade = b.dataset.grade; filt.section = ''; renderOverview(); });
  $('sp-sec').onchange = e => { filt.section = e.target.value; renderList(); };
  $('sp-sort').onchange = e => { filt.sort = e.target.value; renderList(); };
  $('sp-weak').onchange = e => { filt.weak = e.target.checked; renderList(); };
  const q = $('sp-q');
  q.oninput = () => { filt.q = q.value; renderList(); };
  renderList();
}

function renderList() {
  const q = norm(filt.q);
  let list = [...students.values()].filter(s => overall.has(s.id));
  if (q) list = list.filter(s => norm(s.name).includes(q) || s.id.includes(q));
  else list = list.filter(s => s.gl === filt.grade && (!filt.section || s.section === filt.section));
  const scope = list;
  if (filt.weak) list = list.filter(s => overall.get(s.id).avg < 50 || subjectsOf(s).some(x => x.pct < 50));
  const S = {
    'avg-desc': (a, b) => overall.get(b.id).avg - overall.get(a.id).avg,
    'avg-asc': (a, b) => overall.get(a.id).avg - overall.get(b.id).avg,
    name: (a, b) => a.name.localeCompare(b.name, 'ar'),
  };
  list.sort(S[filt.sort] || S['avg-desc']);
  // ملخص النطاق: توزيع المستويات ومتوسط كل مادة
  const dist = LEVELS.map(l => ({ ...l, n: scope.filter(s => levelOf(overall.get(s.id).avg) === l).length }));
  const subjAvg = new Map();
  scope.forEach(s => subjectsOf(s).forEach(x => { if (!subjAvg.has(x.subject)) subjAvg.set(x.subject, []); subjAvg.get(x.subject).push(x.pct); }));
  const scopeName = q ? 'نتائج البحث' : `${gradeTxt(filt.grade)}${filt.section ? ' · فصل ' + filt.section : ''}`;
  $('sp-summary').innerHTML = scope.length ? `
    <div class="sp-sumgrid">
      <div class="sp-card sp-dist">
        <div class="sp-card-h"><b>توزيع المستويات</b><span>${esc(scopeName)} · ${scope.length} طالبًا · المعدل ${pctTxt(mean(scope.map(s => overall.get(s.id).avg)))}</span></div>
        <div class="sp-stack">${dist.filter(d => d.n).map(d => `<i class="${d.cls}" style="flex:${d.n}" title="${d.label}: ${d.n}"></i>`).join('')}</div>
        <ul class="sp-distl">${dist.map(d => `<li><span class="sp-dot ${d.cls}"></span>${d.label}<b>${d.n}</b></li>`).join('')}</ul>
      </div>
      <div class="sp-card">
        <div class="sp-card-h"><b>متوسط المواد</b><span>${esc(scopeName)}</span></div>
        <div class="sp-subjbars">${[...subjAvg.entries()].map(([k, v]) => [k, mean(v)]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
          <div><span>${esc(k)}</span><span class="sp-bar"><i class="${levelOf(v).cls}" style="width:${Math.max(2, v)}%"></i></span><b>${pctTxt(v)}</b></div>`).join('')}</div>
      </div>
    </div>` : '';
  $('sp-list').innerHTML = list.length ? `
    <div class="sp-lhead"><span>#</span><span>الطالب</span><span>المواد</span><span>المعدل</span><span>المستوى</span></div>
    ${list.slice(0, 400).map((s, i) => { const o = overall.get(s.id); const subs = subjectsOf(s); return `
    <button type="button" class="sp-row" data-id="${esc(s.id)}">
      <span class="sp-rn">${filt.sort === 'name' ? i + 1 : o.gRank}</span>
      <span class="sp-rname"><b>${esc(s.name || s.id)}</b><small>${esc([gradeTxt(s.gl), secTxt(s.section)].filter(Boolean).join(' · '))}</small></span>
      <span class="sp-rsubs">${subs.map(x => `<i class="${levelOf(x.pct).cls}" title="${esc(x.subject)}: ${pctTxt(x.pct)}"></i>`).join('')}</span>
      <span class="sp-ravg">${pctTxt(o.avg)}</span>
      <span>${levelChip(o.avg)}</span>
    </button>`; }).join('')}
    ${list.length > 400 ? `<p class="sp-none">يظهر أول 400 طالب، استخدم البحث أو الفلاتر للتضييق.</p>` : ''}`
    : `<p class="sp-none">${q ? 'لا يوجد طالب مطابق للبحث' : 'لا يوجد طلاب في هذا الاختيار'}</p>`;
  document.querySelectorAll('.sp-row').forEach(b => b.onclick = () => renderProfile(b.dataset.id));
}

/* ---------- ملف الطالب ---------- */
function analyze(s) {
  const o = overall.get(s.id);
  const subs = subjectsOf(s);
  const weak = subs.filter(x => x.pct < 50 || x.pct < x.gradeMean - 10 || x.percentile < 25).sort((a, b) => (a.pct - a.gradeMean) - (b.pct - b.gradeMean));
  const strong = subs.filter(x => !weak.includes(x) && (x.percentile >= 75 || x.pct >= 90)).sort((a, b) => b.percentile - a.percentile);
  // أداء الطالب حسب نوع السؤال مقابل الصف (في كل اختباراته)
  const types = ['mcq', 'tf', 'essay'].map(k => {
    const rs = recsOf(s).filter(r => r.typePct[k] != null);
    if (!rs.length) return null;
    const mine = mean(rs.map(r => r.typePct[k]));
    const peers = mean(rs.map(r => (k === 'essay' ? r.rep.essayMean : r.rep.typeMean[k])).filter(v => v != null));
    return { k, mine, peers };
  }).filter(Boolean);
  const easyMiss = recsOf(s).reduce((a, r) => a + r.wrongEasy.length, 0);
  const blanks = recsOf(s).reduce((a, r) => a + r.lost.filter(x => x.blank).length, 0);
  return { o, subs, weak, strong, types, easyMiss, blanks };
}

function summaryText(s, a) {
  const { o, weak, strong, types } = a;
  const parts = [];
  parts.push(`مستوى الطالب العام «${levelOf(o.avg).label}» بمعدل ${pctTxt(o.avg)} في ${o.nSub === 1 ? 'مادة واحدة' : o.nSub === 2 ? 'مادتين' : `${o.nSub} ${o.nSub <= 10 ? 'مواد' : 'مادة'}`}، وترتيبه ${o.gRank} من ${o.gN} في ${gradeTxt(s.gl)}${o.cN ? `، و${o.cRank} من ${o.cN} في فصله` : ''}.`);
  const diff = o.avg - o.gAvg;
  parts.push(Math.abs(diff) < 3 ? 'معدله قريب من متوسط الصف.' : diff > 0 ? `معدله أعلى من متوسط الصف بـ ${Math.round(diff)} نقطة مئوية.` : `معدله أقل من متوسط الصف بـ ${Math.round(-diff)} نقطة مئوية.`);
  if (strong.length) parts.push(`أبرز نقاط القوة: ${strong.slice(0, 3).map(x => x.subject).join('، ')}.`);
  if (weak.length) parts.push(`يحتاج إلى دعم في: ${weak.slice(0, 3).map(x => `${x.subject} (${pctTxt(x.pct)} مقابل ${pctTxt(x.gradeMean)} للصف)`).join('، ')}.`);
  else parts.push('لا توجد مادة يقل فيها بوضوح عن مستوى الصف.');
  const gap = types.filter(t => t.peers != null && t.mine < t.peers - 12).sort((x, y) => (x.mine - x.peers) - (y.mine - y.peers))[0];
  if (gap) parts.push(`أضعف أداء له في أسئلة «${ITEM_TYPE[gap.k]}» (${pctTxt(gap.mine)} مقابل ${pctTxt(gap.peers)} للصف).`);
  if (a.blanks) parts.push(`ترك ${a.blanks === 1 ? 'سؤالًا واحدًا' : a.blanks === 2 ? 'سؤالين' : a.blanks <= 10 ? `${a.blanks} أسئلة` : `${a.blanks} سؤالًا`} دون إجابة في اختباراته، وخُصمت درجتها.`);
  return parts.join(' ');
}

function renderProfile(id) {
  const s = students.get(id);
  if (!s) { renderOverview(); return; }
  currentId = id;
  computeOverall();
  const box = $('sp-container');
  const a = analyze(s);
  if (!a.o) {
    box.innerHTML = `<div class="sp-page">${backBar()}${typeSeg()}<div class="sp-empty"><b>${esc(s.name)}</b><span>لا توجد للطالب درجات في هذا النوع من الاختبارات.</span></div></div>`;
    wireBack(); wireTypeSeg(() => renderProfile(id));
    return;
  }
  const { o, subs, weak, types } = a;
  box.innerHTML = `
    <div class="sp-page">
      ${backBar()}
      <div class="sp-hero">
        <div class="sp-hero-id">
          <span class="sp-av">${esc(initials(s.name))}</span>
          <div><h3>${esc(s.name || s.id)}</h3><span>${esc([gradeTxt(s.gl), secTxt(s.section)].filter(Boolean).join(' · '))} · <span dir="ltr">${esc(s.id)}</span></span></div>
        </div>
        <div class="sp-hero-act">${typeSeg()}<button type="button" class="tx-btn ghost sm" id="sp-print">${ICON.print}<span>طباعة الملف</span></button></div>
      </div>
      <div class="sp-kpis">
        <div class="sp-kpi big ${levelOf(o.avg).cls}"><span>المستوى العام</span><b>${levelOf(o.avg).label}</b><small>المعدل ${pctTxt(o.avg)}</small></div>
        <div class="sp-kpi"><span>ترتيبه في ${esc(gradeTxt(s.gl))}</span><b>${o.gRank}<small> / ${o.gN}</small></b><small>متوسط الصف ${pctTxt(o.gAvg)}</small></div>
        <div class="sp-kpi"><span>ترتيبه في الفصل</span><b>${o.cRank || '—'}<small> / ${o.cN || '—'}</small></b><small>متوسط الفصل ${pctTxt(o.cAvg)}</small></div>
        <div class="sp-kpi"><span>مقارنة بأقرانه</span><b>${Math.round(o.percentile)}%</b><small>متقدم على هذه النسبة من طلاب الصف</small></div>
      </div>
      <div class="sp-card sp-insight"><b>${ICON.spark} التحليل</b><p>${esc(summaryText(s, a))}</p></div>

      <div class="sp-card">
        <div class="sp-card-h"><b>المستوى في كل مادة</b><span class="sp-legend"><i class="me"></i>الطالب <i class="cl"></i>متوسط الفصل <i class="gr"></i>متوسط الصف</span></div>
        <div class="sp-cmp">
          ${subs.map(x => `<div class="sp-cmp-row${weak.includes(x) ? ' weak' : ''}">
            <span class="sp-cmp-n"><b>${esc(x.subject)}</b><small>${x.recs.length === 1 ? 'اختبار واحد' : x.recs.length === 2 ? 'اختباران' : `${x.recs.length} اختبارات`}${x.trend != null ? ` · ${x.trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(x.trend))}` : ''}</small></span>
            <span class="sp-cmp-bar"><i class="me ${levelOf(x.pct).cls}" style="width:${Math.max(1.5, x.pct)}%"></i>
              ${x.classMean != null ? `<em class="cl" style="inset-inline-start:${x.classMean}%" title="متوسط الفصل ${pctTxt(x.classMean)}"></em>` : ''}
              <em class="gr" style="inset-inline-start:${x.gradeMean}%" title="متوسط الصف ${pctTxt(x.gradeMean)}"></em></span>
            <span class="sp-cmp-v"><b>${pctTxt(x.pct)}</b><small>الصف ${pctTxt(x.gradeMean)}</small></span>
            ${levelChip(x.pct)}
          </div>`).join('')}
        </div>
      </div>

      <div class="sp-grid2">
        <div class="sp-card">
          <div class="sp-card-h"><b>مواطن الإخفاق</b><span>${weak.length ? `${weak.length === 1 ? 'مادة واحدة' : weak.length === 2 ? 'مادتان' : `${weak.length} مواد`} تحتاج إلى دعم` : 'لا توجد مادة ضعيفة بوضوح'}</span></div>
          ${weak.length ? weak.map(x => weakCard(x)).join('') : `<p class="sp-none">أداء الطالب في كل المواد قريب من مستوى الصف أو أعلى.</p>`}
          ${a.easyMiss && !weak.length ? `<p class="sp-note">أخطأ في ${a.easyMiss} ${a.easyMiss <= 10 ? 'أسئلة' : 'سؤالًا'} أجاب عنها أغلب زملائه، وتظهر تفاصيلها في جدول الاختبارات.</p>` : ''}
        </div>
        <div class="sp-card">
          <div class="sp-card-h"><b>الأداء حسب نوع السؤال</b><span>مقارنة بمتوسط الصف</span></div>
          <div class="sp-types">${types.map(t => `<div>
            <span>${ITEM_TYPE[t.k]}</span>
            <span class="sp-bar two"><i class="${levelOf(t.mine).cls}" style="width:${Math.max(1.5, t.mine)}%"></i>${t.peers != null ? `<em class="gr" style="inset-inline-start:${t.peers}%"></em>` : ''}</span>
            <b>${pctTxt(t.mine)}</b><small>${t.peers != null ? `الصف ${pctTxt(t.peers)}` : ''}</small></div>`).join('')}</div>
        </div>
      </div>

      <div class="sp-card">
        <div class="sp-card-h"><b>الاختبارات</b><span class="sp-legend"><span class="sp-qw easy">س</span> خطأ في سؤال أجاب عنه أغلب الصف <span class="sp-qw">س</span> خطأ <span class="sp-qb">س</span> متروك دون إجابة</span></div>
        <div class="sp-tblwrap"><table class="sp-tbl">
          <thead><tr><th>الاختبار</th><th>النوع</th><th>الدرجة</th><th>النسبة</th><th>متوسط الصف</th><th>ترتيبه</th><th>سبب الخصم</th></tr></thead>
          <tbody>${recsOf(s).slice().sort((x, y) => x.rep.subject.localeCompare(y.rep.subject, 'ar') || String(x.rep.date).localeCompare(String(y.rep.date))).map(r => `<tr>
            <td><b>${esc(r.rep.subject)}</b><small>${esc(r.rep.title)}${r.rep.date ? ' · ' + esc(dateTxt(r.rep.date)) : ''}</small></td>
            <td>${esc(TYPE_LABEL[r.rep.type] || r.rep.type)}</td>
            <td>${fmtN(r.total)} / ${fmtN(r.max)}${r.essay != null ? `<small>منها مقالي ${fmtN(r.essay)} / ${fmtN(r.rep.essayMax)}</small>` : ''}</td>
            <td><b class="sp-pct ${levelOf(r.pct).cls}">${pctTxt(r.pct)}</b></td>
            <td>${pctTxt(r.rep.meanPct)}</td>
            <td>${r.rank} / ${r.rep.N}</td>
            <td class="sp-qs">${lossHtml(r)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
  wireBack();
  wireTypeSeg(() => renderProfile(id));
  $('sp-print').onclick = () => printProfile(s, a);
  window.scrollTo(0, 0);
}

function weakCard(x) {
  const miss = x.recs.flatMap(r => r.wrongEasy.map(j => ({ j, p: r.rep.pVal[j], r })));
  const byTest = x.recs.filter(r => r.wrongEasy.length);
  return `<div class="sp-weak">
    <div class="sp-weak-h"><b>${esc(x.subject)}</b>${levelChip(x.pct)}<span>${pctTxt(x.pct)} مقابل ${pctTxt(x.gradeMean)} للصف${x.classMean != null ? ` و${pctTxt(x.classMean)} للفصل` : ''}</span></div>
    ${miss.length ? `<p>أخطأ في ${miss.length} ${miss.length === 1 ? 'سؤال' : miss.length <= 10 ? 'أسئلة' : 'سؤالًا'} أجاب عنها ${Math.round(EASY_P * 100)}% فأكثر من الصف:</p>
      ${byTest.map(r => `<div class="sp-qrow">${x.recs.length > 1 ? `<small>الاختبار ${esc(TYPE_LABEL[r.rep.type] || '')} · ${esc(r.rep.title)}</small>` : ''}${r.wrongEasy.map(j => `<span class="sp-q" title="أجاب عنه ${Math.round(r.rep.pVal[j] * 100)}% من الصف">س${j + 1}<i>${Math.round(r.rep.pVal[j] * 100)}%</i></span>`).join('')}</div>`).join('')}`
      : `<p>أخطاؤه في أسئلة صعبة على أغلب الصف أيضًا، فيحتاج إلى تقوية عامة في المادة.</p>`}
  </div>`;
}

const fmtN = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
const initials = name => { const w = String(name || '').split(/\s+/).filter(x => x && x !== 'بن').map(x => x.replace(/^ال(?=.{2})/, '')); return (w[0] ? w[0][0] : '') + (w.length > 1 ? w[w.length - 1][0] : ''); };
const backBar = () => `<button type="button" class="sp-back" id="sp-back">→ كل الطلاب</button>`;
function wireBack() { $('sp-back').onclick = () => { currentId = null; renderOverview(); window.scrollTo(0, 0); }; }

/* ---------- الطباعة ---------- */
function printProfile(s, a) {
  const { o, subs, weak } = a;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة لطباعة الملف'); return; }
  const logo = printLogo();
  const typeNote = filt.type === 'all' ? 'كل الاختبارات' : `الاختبارات ${TYPE_PLURAL[filt.type] || ''}`;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ملف الطالب - ${esc(s.name)}</title>
  <style>body{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#152238;font-size:12.5px}.hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #152238;padding-bottom:10px;margin-bottom:14px}
  .hd img{height:56px}h1{font-size:18px;margin:0 0 3px}h2{font-size:16px;margin:0 0 4px}h4{margin:16px 0 6px;font-size:13.5px}.sub{color:#555;font-size:12px}
  .kp{display:flex;gap:8px;margin:10px 0}.kp div{flex:1;border:1px solid #d6dbe4;border-radius:8px;padding:8px;text-align:center;color:#555;font-size:11px}.kp b{display:block;font-size:17px;color:#152238}
  .box{border:1px solid #d6dbe4;border-radius:8px;padding:10px 12px;line-height:1.9;background:#f7f9fc}
  table{width:100%;border-collapse:collapse;font-size:11.5px}th,td{border:1px solid #c9ced8;padding:5px 6px;text-align:center}th{background:#152238;color:#fff}td.n{text-align:right}
  tr:nth-child(even) td{background:#f5f6f8}.sig{display:flex;justify-content:space-between;margin-top:36px}@media print{h4{break-after:avoid}}</style></head><body>
  <div class="hd">${logo ? `<img src="${esc(logo)}">` : ''}<div><h1>ملف الطالب: المستوى الدراسي</h1><div class="sub">${esc(printOrgName())} · ${esc(typeNote)}</div></div></div>
  <h2>${esc(s.name)}</h2><div class="sub">${esc([gradeTxt(s.gl), secTxt(s.section)].filter(Boolean).join(' · '))} · رقم الهوية ${esc(s.id)}</div>
  <div class="kp"><div><b>${levelOf(o.avg).label}</b>المستوى العام</div><div><b>${pctTxt(o.avg)}</b>المعدل</div><div><b>${o.gRank} / ${o.gN}</b>الترتيب في الصف</div><div><b>${o.cRank || '—'} / ${o.cN || '—'}</b>الترتيب في الفصل</div><div><b>${Math.round(o.percentile)}%</b>متقدم على أقرانه</div></div>
  <div class="box">${esc(summaryText(s, a))}</div>
  <h4>المستوى في كل مادة</h4>
  <table><thead><tr><th>المادة</th><th>نسبة الطالب</th><th>المستوى</th><th>متوسط الفصل</th><th>متوسط الصف</th><th>عدد الاختبارات</th></tr></thead><tbody>
  ${subs.map(x => `<tr><td class="n">${esc(x.subject)}${weak.includes(x) ? ' ⚑' : ''}</td><td>${pctTxt(x.pct)}</td><td>${levelOf(x.pct).label}</td><td>${pctTxt(x.classMean)}</td><td>${pctTxt(x.gradeMean)}</td><td>${x.recs.length}</td></tr>`).join('')}</tbody></table>
  <h4>الاختبارات</h4>
  <table><thead><tr><th>المادة</th><th>الاختبار</th><th>الدرجة</th><th>النسبة</th><th>متوسط الصف</th><th>الترتيب</th><th>سبب الخصم</th></tr></thead><tbody>
  ${recsOf(s).map(r => `<tr><td class="n">${esc(r.rep.subject)}</td><td class="n">${esc(r.rep.title)}</td><td>${fmtN(r.total)} / ${fmtN(r.max)}</td><td>${pctTxt(r.pct)}</td><td>${pctTxt(r.rep.meanPct)}</td><td>${r.rank} / ${r.rep.N}</td><td class="n">${esc(lossText(r))}</td></tr>`).join('')}</tbody></table>
  <div class="sig"><span>وكيل الشؤون التعليمية: ..................</span><span>مدير المدرسة: ..................</span></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
};
