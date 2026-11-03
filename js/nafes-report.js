/* =========================================================================
 * التقرير الشامل لاختبار نافس التجريبي
 * - لوحة النتائج: مؤشرات عامة، المواد، مستويات الأداء، توزيع الدرجات، مقارنة الفصول.
 * - المهارات والأسئلة: إتقان كل مهارة، صعوبة كل سؤال، والإجابة الخاطئة الأكثر اختيارًا.
 * - الطلاب: قائمة كاملة بالفرز والتصفية، وشهادة تحليلية لكل طالب (تُطبع منفردة أو مجتمعة).
 * - المعلمون: تحليل طلاب كل معلم في فصوله (من الجدول المدرسي) مقارنةً بمتوسط المدرسة.
 * الحساب من أوراق الطلاب ومفتاح التقرير نفسه (key_raw) وأجزاء المواد ومهارات الأسئلة في نموذج الإجابة.
 * ========================================================================= */
import { sb, printOrgName, printLogo, ASSET_VERSION, currentSchoolId, readScopedBySchool, gradeLabels } from './core.js';
import { letterFor } from './grading-core.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = v => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(v * 10) / 10));
const r2 = v => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(v * 100) / 100));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) : 0; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const normSj = s => String(s || '').trim().replace(/^ال/, '').replace(/[أإآ]/g, 'ا').replace(/ة$/, 'ه').replace(/\s+/g, '');
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const SUBJ_COLORS = ['#3B5BDB', '#0CA678', '#E8590C', '#AE3EC9', '#1098AD', '#F08C00'];

let D = null;          // بيانات التقرير المحسوبة
let V = { tab: 'overview', sec: 'all', q: '', pass: 'all', sort: 'rank', subj: null, teacher: null };

/* ---------- المستويات ---------- */
function levels(passPct) {
  return [
    { k: 4, t: 'متقدم', min: 90, c: '#2B8A3E', bg: '#EBFBEE' },
    { k: 3, t: 'متمكن', min: passPct, c: '#1971C2', bg: '#E7F5FF' },
    { k: 2, t: 'أساسي', min: 50, c: '#E67700', bg: '#FFF4E6' },
    { k: 1, t: 'دون الأساسي', min: 0, c: '#C92A2A', bg: '#FFF5F5' },
  ];
}
const levelOf = p => (p == null ? null : D.levels.find(l => p >= l.min - 1e-9) || D.levels[D.levels.length - 1]);
const lvTag = p => { const l = levelOf(p); return l ? `<span class="nr-lv" style="--c:${l.c};--b:${l.bg}">${l.t}</span>` : '—'; };

/* ---------- الحساب ---------- */
async function build(rep, key) {
  const rd = rep.raw_data || {};
  const [{ scoreReport }, { allStudents }] = await Promise.all([
    import('./student-profile.js?v=' + ASSET_VERSION),
    import('./students-cache.js?v=' + ASSET_VERSION),
  ]);
  const plat = await allStudents();
  const platMap = new Map(plat.filter(p => p.national_id).map(p => [String(p.national_id).trim(), p]));
  const sr = scoreReport(rep, platMap);
  if (!sr) return null;
  const n = sr.n;
  const PW = j => (Array.isArray(rd.points) && Number.isFinite(+rd.points[j]) ? +rd.points[j] : 1);
  const passPct = Number.isFinite(+key.pass_pct) && +key.pass_pct > 0 ? +key.pass_pct : 75;
  const reversed = rd.reversedOrder !== false;
  const nCh = (rd.choiceCounts && rd.choiceCounts[0]) || key.choices || 4;
  const ansKey = rep.key_raw || [];

  // المواد (أجزاء الاختبار) ومهارات كل مادة
  const parts = (Array.isArray(key.parts) && key.parts.length ? key.parts : [{ s: key.subject || 'الاختبار', from: 1, to: n }])
    .map((pt, i) => { const qs = []; for (let q = +pt.from - 1; q < Math.min(n, +pt.to); q++) qs.push(q); return { s: pt.s, qs, w: qs.reduce((a, j) => a + PW(j), 0), color: SUBJ_COLORS[i % SUBJ_COLORS.length], teacherId: pt.teacher_id || null }; })
    .filter(p => p.qs.length);
  const subjOfQ = new Map(); parts.forEach(p => p.qs.forEach(j => subjOfQ.set(j, p)));
  const skills = new Map();
  (key.skills || []).slice(0, n).forEach((x, j) => {
    if (!x || !x.k) return;
    const p = subjOfQ.get(j); const s = p ? p.s : (x.s || '');
    const id = s + '|' + x.k;
    if (!skills.has(id)) skills.set(id, { id, s, k: x.k, qs: [], w: 0 });
    const g = skills.get(id); g.qs.push(j); g.w += PW(j);
  });
  parts.forEach(p => { p.skills = [...skills.values()].filter(g => g.s === p.s); });

  // أوراق الطلاب الخام (لتحليل البدائل)
  const rawBy = new Map();
  (rd.students || []).forEach(st => {
    const nm = String(st.name || '').trim().replace(/\s+/g, ' ');
    const id = String(st.id || '').trim().replace(/-\d{1,2}$/, '') || (nm ? 'name:' + nm : null);
    if (id && !rawBy.has(id)) rawBy.set(id, st.answers || []);
  });

  const students = sr.recs.map(r => {
    const p = platMap.get(r.id);
    const subj = {};
    parts.forEach(pt => {
      const got = pt.qs.reduce((a, j) => a + (r.correct[j] ? PW(j) : 0), 0);
      subj[pt.s] = { got, w: pt.w, pct: pt.w ? got / pt.w * 100 : null, pass: got >= (passPct / 100) * pt.w - 1e-6 };
    });
    const sk = {};
    skills.forEach(g => { const got = g.qs.reduce((a, j) => a + (r.correct[j] ? PW(j) : 0), 0); sk[g.id] = g.w ? got / g.w * 100 : null; });
    const fails = parts.filter(pt => !subj[pt.s].pass).map(pt => pt.s);
    return {
      id: r.id, nid: p ? p.national_id : (String(r.id).startsWith('name:') ? '' : r.id),
      name: p ? p.full_name : r.name, section: String((p && p.class_section) || r.section || ''),
      correct: r.correct, answers: rawBy.get(r.id) || [], total: r.total, max: r.max, pct: r.pct, subj, sk, fails, passed: !fails.length,
    };
  });
  // الترتيب على مستوى الصف
  const byScore = [...students].sort((a, b) => b.total - a.total);
  byScore.forEach((s, i) => { s.rank = byScore.findIndex(x => x.total === s.total) + 1; s.pctile = Math.round((byScore.filter(x => x.total < s.total).length / students.length) * 100); });

  // تحليل الأسئلة
  const items = Array.from({ length: n }, (_, j) => {
    const p = subjOfQ.get(j), g = [...skills.values()].find(x => x.qs.includes(j));
    const counts = {}; let blank = 0, right = 0;
    students.forEach(s => {
      const v = s.answers[j];
      if (s.correct[j]) right++;
      if (typeof v !== 'number' || v <= 0) blank++;
      else counts[v] = (counts[v] || 0) + 1;
    });
    const kv = Array.isArray(ansKey[j]) ? ansKey[j] : [ansKey[j]];
    const wrong = Object.entries(counts).filter(([v]) => !kv.includes(+v)).sort((a, b) => b[1] - a[1])[0];
    return {
      j, subj: p ? p.s : '', skill: g ? g.k : '', p: students.length ? right / students.length * 100 : 0,
      keyL: kv.map(v => letterFor(v, nCh, reversed)).filter(Boolean).join('/'),
      wrongL: wrong ? letterFor(+wrong[0], nCh, reversed) : '', wrongP: wrong ? wrong[1] / students.length * 100 : 0,
      blankP: students.length ? blank / students.length * 100 : 0,
      dist: Object.fromEntries(Object.entries(counts).map(([v, c]) => [letterFor(+v, nCh, reversed), c / students.length * 100])),
    };
  });

  // المعلمون: من الجدول المدرسي للصف نفسه، مطابقة بالمادة
  const gradeCode = key.grade_level || Object.keys(gradeLabels).find(k => gradeLabels[k] === rep.grade_level) || null;
  let teachers = [];
  if (gradeCode) {
    const { data: sched } = await readScopedBySchool(sc => { let q = sb.from('class_schedules').select('teacher_id, subject_name, class_section').eq('grade_level', gradeCode); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
    const tids = [...new Set((sched || []).map(r => r.teacher_id).filter(Boolean))];
    const { data: profs } = tids.length ? await sb.from('profiles').select('id, full_name').in('id', tids) : { data: [] };
    const nameOf = new Map((profs || []).map(x => [x.id, x.full_name]));
    const tm = new Map();
    (sched || []).forEach(r => {
      const pt = parts.find(p => normSj(p.s) === normSj(r.subject_name)); if (!pt || !r.teacher_id) return;
      const k = r.teacher_id + '|' + pt.s;
      if (!tm.has(k)) tm.set(k, { id: r.teacher_id, name: nameOf.get(r.teacher_id) || '—', subj: pt.s, secs: new Set() });
      tm.get(k).secs.add(String(r.class_section));
    });
    teachers = [...tm.values()].map(t => ({ ...t, secs: [...t.secs].sort((a, b) => +a - +b) }))
      .sort((a, b) => parts.findIndex(p => p.s === a.subj) - parts.findIndex(p => p.s === b.subj) || a.name.localeCompare(b.name, 'ar'));
  }
  const sections = [...new Set(students.map(s => s.section).filter(Boolean))].sort((a, b) => +a - +b);
  return { rep, key, passPct, parts, skills: [...skills.values()], students, items, teachers, sections, levels: levels(passPct), n, gradeTxt: rep.grade_level || gradeLabels[gradeCode] || '' };
}

/* ---------- مؤشرات مجموعة طلاب ---------- */
function groupStats(studs, subj = null) {
  const vals = subj ? studs.map(s => s.subj[subj].pct) : studs.map(s => s.pct);
  const pass = subj ? studs.filter(s => s.subj[subj].pass).length : studs.filter(s => s.passed).length;
  const lv = D.levels.map(l => ({ ...l, n: vals.filter(v => levelOf(v) === l).length }));
  return { n: studs.length, mean: mean(vals), sd: sd(vals), med: median(vals), pass, passP: studs.length ? pass / studs.length * 100 : 0, lv, hi: vals.length ? Math.max(...vals) : null, lo: vals.length ? Math.min(...vals) : null };
}
const skillMean = (g, studs) => mean(studs.map(s => s.sk[g.id]).filter(v => v != null));

/* ---------- الرسوم (SVG) ---------- */
function ring(p, color, size = 112, label = '') {
  const r = size / 2 - 9, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p || 0));
  return `<svg class="nr-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${r1(p)}%">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#EDF1F7" stroke-width="10"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="${label ? '47%' : '53%'}" text-anchor="middle" dominant-baseline="middle" font-size="${size / 4.6}" font-weight="900" fill="#0F2447">${r1(p)}%</text>
    ${label ? `<text x="50%" y="66%" text-anchor="middle" font-size="${size / 10}" fill="#6B7684" font-weight="700">${esc(label)}</text>` : ''}</svg>`;
}
function levelBar(lv, total) {
  return `<div class="nr-lvbar">${lv.map(l => l.n ? `<i style="flex:${l.n};background:${l.c}" title="${esc(l.t)}: ${l.n}"><b>${l.n}</b></i>` : '').join('')}</div>
    <div class="nr-lvleg">${lv.map(l => `<span><i style="background:${l.c}"></i>${esc(l.t)} <b>${l.n}</b> <small>(${total ? r1(l.n / total * 100) : 0}%)</small></span>`).join('')}</div>`;
}
// مدرج تكراري للنسب: ١٠ فئات
function histogram(vals, color = '#3B5BDB', passPct = null) {
  const bins = Array(10).fill(0); vals.forEach(v => bins[Math.min(9, Math.floor((v || 0) / 10))]++);
  const mx = Math.max(1, ...bins), W = 560, H = 200, bw = W / 10;
  const px = passPct != null ? (passPct / 100) * W : null;
  return `<svg class="nr-svg" viewBox="0 0 ${W} ${H + 26}" role="img" aria-label="توزيع الدرجات">
    ${bins.map((b, i) => { const h = (b / mx) * (H - 44); return `<g><rect x="${W - (i + 1) * bw + 4}" y="${H - h}" width="${bw - 8}" height="${h}" rx="5" fill="${color}" opacity="${0.45 + 0.55 * (i / 9)}"/>${b ? `<text x="${W - (i + 0.5) * bw}" y="${H - h - 6}" text-anchor="middle" font-size="12" font-weight="800" fill="#0F2447">${b}</text>` : ''}<text x="${W - (i + 0.5) * bw}" y="${H + 17}" text-anchor="middle" font-size="10.5" fill="#6B7684">${i * 10}–${i === 9 ? 100 : i * 10 + 9}</text></g>`; }).join('')}
    ${px != null ? `<line x1="${W - px}" x2="${W - px}" y1="4" y2="${H}" stroke="#C92A2A" stroke-width="2" stroke-dasharray="5 4"/><text x="${W - px - 6}" y="13" font-size="11" fill="#C92A2A" font-weight="800" text-anchor="start" direction="rtl">حد الاجتياز ${passPct}٪</text>` : ''}
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="#D5DCE6"/></svg>`;
}
// أعمدة متجاورة: مجموعات (الفصول) × سلاسل (المواد)
function groupedBars(groups, series, valOf, opts = {}) {
  const W = Math.max(620, groups.length * 135), H = 210, gw = W / Math.max(1, groups.length), pad = 10, bw = Math.min(26, (gw - pad * 2) / Math.max(1, series.length));
  const ref = opts.ref;
  return `<svg class="nr-svg" viewBox="0 0 ${W} ${H + 30}" role="img" aria-label="${esc(opts.label || '')}">
    ${[0, 25, 50, 75, 100].map(t => `<line x1="0" x2="${W}" y1="${H - t / 100 * (H - 16)}" y2="${H - t / 100 * (H - 16)}" stroke="#EEF2F7"/><text x="${W - 2}" y="${H - t / 100 * (H - 16) - 3}" font-size="9" fill="#98A2B3" text-anchor="end">${t}</text>`).join('')}
    ${ref != null ? `<line x1="0" x2="${W}" y1="${H - ref / 100 * (H - 16)}" y2="${H - ref / 100 * (H - 16)}" stroke="#C92A2A" stroke-dasharray="5 4" stroke-width="1.5"/>` : ''}
    ${groups.map((g, gi) => { const x0 = W - (gi + 1) * gw + (gw - bw * series.length) / 2; return series.map((s, si) => { const v = valOf(g, s) || 0, h = v / 100 * (H - 16); return `<rect x="${x0 + (series.length - 1 - si) * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="4" fill="${s.color}"><title>${esc(g.label)} · ${esc(s.s)}: ${r1(v)}%</title></rect>${bw > 17 ? `<text x="${x0 + (series.length - 1 - si) * bw + bw / 2}" y="${H - h - 4}" font-size="9" text-anchor="middle" fill="#344054" font-weight="700">${Math.round(v)}</text>` : ''}`; }).join('') + `<text x="${W - (gi + 0.5) * gw}" y="${H + 18}" text-anchor="middle" font-size="11.5" font-weight="800" fill="#0F2447">${esc(g.label)}</text>`; }).join('')}
  </svg>`;
}
function hbars(rows, opts = {}) {
  return `<div class="nr-hb">${rows.map(r => `<div class="nr-hb-r"><span class="nr-hb-l">${r.label}</span><div class="nr-hb-t"><i style="width:${Math.max(0, Math.min(100, r.v || 0))}%;background:${r.color || levelOf(r.v)?.c || '#3B5BDB'}"></i>${r.ref != null ? `<em style="right:${Math.max(0, Math.min(100, r.ref))}%" title="${esc(opts.refLabel || 'المرجع')}: ${r1(r.ref)}%"></em>` : ''}</div><b>${r1(r.v)}%</b>${r.extra ? `<small>${r.extra}</small>` : ''}</div>`).join('')}</div>`;
}

/* ---------- الواجهة ---------- */
export async function openNafesReport(rep, key) {
  let ov = document.getElementById('nr-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'nr-ov'; ov.className = 'nr-ov'; document.body.appendChild(ov); }
  injectCss();
  ov.innerHTML = '<div class="nr-load"><div class="tx-loading"><span></span><span></span><span></span></div><p>جارٍ تحليل نتائج نافس...</p></div>';
  ov.classList.remove('hidden'); document.body.classList.add('nr-lock');
  try { D = await build(rep, key); } catch (e) { console.error(e); D = null; }
  if (!D) { ov.innerHTML = `<div class="nr-load"><p>تعذر إعداد التقرير، فلا توجد أوراق طلاب صالحة.</p><button type="button" class="nr-btn" data-close>إغلاق</button></div>`; ov.querySelector('[data-close]').onclick = close; return; }
  V = { tab: 'overview', sec: 'all', q: '', pass: 'all', sort: 'rank', subj: D.parts[0].s, teacher: null };
  draw();
}
function close() { const ov = document.getElementById('nr-ov'); if (ov) ov.classList.add('hidden'); document.body.classList.remove('nr-lock'); document.removeEventListener('keydown', onKey); }
function onKey(e) { if (e.key === 'Escape') { const m = document.querySelector('.nr-modal'); if (m) m.remove(); else close(); } }
const studsOf = () => D.students.filter(s => V.sec === 'all' || s.section === V.sec);

function draw() {
  const ov = document.getElementById('nr-ov');
  const TABS = [['overview', 'لوحة النتائج'], ['skills', 'المهارات والأسئلة'], ['students', 'الطلاب'], ['teachers', 'المعلمون']];
  const body = V.tab === 'skills' ? viewSkills() : V.tab === 'students' ? viewStudents() : V.tab === 'teachers' ? viewTeachers() : viewOverview();
  ov.innerHTML = `<div class="nr">
    <header class="nr-top">
      <div class="nr-ttl"><span class="nr-badge">نافس</span><div><h2>التقرير الشامل لاختبار نافس التجريبي</h2><p>${esc(printOrgName())} · ${esc(D.gradeTxt)} · ${D.students.length} طالبًا · الاجتياز ${D.passPct}% في كل مادة</p></div></div>
      <div class="nr-acts"><button type="button" class="nr-btn ghost" id="nr-print">🖨 طباعة هذا القسم</button><button type="button" class="nr-x" data-close aria-label="إغلاق">✕</button></div>
      <nav class="nr-tabs">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${t}</button>`).join('')}</nav>
    </header>
    ${V.tab !== 'teachers' ? `<div class="nr-secs"><span>الفصل</span>${['all', ...D.sections].map(x => `<button type="button" data-sec="${esc(x)}" class="${V.sec === x ? 'on' : ''}">${x === 'all' ? 'كل الفصول' : 'فصل ' + esc(x)}</button>`).join('')}</div>` : ''}
    <main class="nr-main" id="nr-main">${body}</main></div>`;
  ov.querySelector('[data-close]').onclick = close;
  document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
  ov.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { V.tab = b.dataset.tab; draw(); ov.querySelector('.nr-main').scrollTop = 0; });
  ov.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { V.sec = b.dataset.sec; draw(); });
  ov.querySelectorAll('[data-subj]').forEach(b => b.onclick = () => { V.subj = b.dataset.subj; draw(); });
  ov.querySelectorAll('[data-pass]').forEach(b => b.onclick = () => { V.pass = b.dataset.pass; draw(); });
  const so = ov.querySelector('#nr-sort'); if (so) so.onchange = () => { V.sort = so.value; draw(); };
  const q = ov.querySelector('#nr-q'); if (q) q.oninput = () => { V.q = q.value; const pos = q.selectionStart; draw(); const n = ov.querySelector('#nr-q'); n.focus(); n.setSelectionRange(pos, pos); };
  ov.querySelectorAll('[data-st]').forEach(b => b.onclick = () => openCert(b.dataset.st));
  ov.querySelectorAll('[data-tch]').forEach(b => b.onclick = () => { V.teacher = V.teacher === b.dataset.tch ? null : b.dataset.tch; draw(); const el = ov.querySelector('.nr-tdetail'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const pc = ov.querySelector('#nr-print-certs'); if (pc) pc.onclick = () => printDoc('شهادات نافس', filteredStudents().map(certHtml).join(''), true);
  const pt = ov.querySelector('#nr-print-teacher'); if (pt) pt.onclick = () => { const t = D.teachers.find(x => x.id + '|' + x.subj === V.teacher); if (t) printDoc('تقرير المعلم - ' + t.name, teacherDetail(t, true)); };
  const pta = ov.querySelector('#nr-print-teachers'); if (pta) pta.onclick = () => printDoc('تقارير المعلمين', D.teachers.map(t => `<div class="nr-page">${teacherDetail(t, true)}</div>`).join(''), true);
  ov.querySelector('#nr-print').onclick = () => printDoc(TABS.find(t => t[0] === V.tab)[1], ov.querySelector('#nr-main').innerHTML);
}

/* ---------- لوحة النتائج ---------- */
function insights(studs) {
  const out = [];
  const st = D.parts.map(p => ({ p, g: groupStats(studs, p.s) }));
  const best = [...st].sort((a, b) => b.g.mean - a.g.mean)[0], worst = [...st].sort((a, b) => a.g.mean - b.g.mean)[0];
  if (st.length > 1) out.push(`أعلى المواد أداءً <b>${esc(best.p.s)}</b> بمتوسط ${r1(best.g.mean)}%، وأدناها <b>${esc(worst.p.s)}</b> بمتوسط ${r1(worst.g.mean)}%.`);
  const sk = D.skills.map(g => ({ g, m: skillMean(g, studs) })).filter(x => x.m != null).sort((a, b) => a.m - b.m);
  if (sk.length) out.push(`أضعف المهارات <b>${esc(sk[0].g.s)} · ${esc(sk[0].g.k)}</b> (${r1(sk[0].m)}%)، وأقواها <b>${esc(sk[sk.length - 1].g.s)} · ${esc(sk[sk.length - 1].g.k)}</b> (${r1(sk[sk.length - 1].m)}%).`);
  const near = studs.filter(s => !s.passed && s.fails.length === 1 && D.parts.some(p => s.fails[0] === p.s && s.subj[p.s].got >= (D.passPct / 100) * p.w - 2)).length;
  if (near) out.push(`<b>${near}</b> ${near === 1 ? 'طالب' : 'طالبًا'} على بُعد سؤال أو سؤالين من الاجتياز في مادة واحدة، وهم أولوية للدعم السريع.`);
  const hard = [...D.items].sort((a, b) => a.p - b.p).slice(0, 3);
  if (hard.length) out.push(`أصعب الأسئلة: ${hard.map(i => `<b>س${i.j + 1}</b> (${esc(i.subj)}، ${r1(i.p)}% أجابوا صحيحًا)`).join('، ')}.`);
  const trap = D.items.filter(i => i.wrongP > i.p && i.wrongP >= 35);
  if (trap.length) out.push(`<b>${trap.length}</b> من الأسئلة اختار أغلب الطلاب فيها إجابة خاطئة واحدة بعينها (مثل ${trap.slice(0, 3).map(i => `س${i.j + 1}: «${esc(i.wrongL)}» ${r1(i.wrongP)}%`).join('، ')})، فيُنصح بمراجعة المفهوم، والتأكد من مفتاح الإجابة.`);
  if (V.sec === 'all' && D.sections.length > 1) {
    const ss = D.sections.map(x => ({ x, m: mean(D.students.filter(s => s.section === x).map(s => s.pct)) })).sort((a, b) => b.m - a.m);
    out.push(`أعلى الفصول متوسطًا <b>فصل ${esc(ss[0].x)}</b> (${r1(ss[0].m)}%)، وأدناها <b>فصل ${esc(ss[ss.length - 1].x)}</b> (${r1(ss[ss.length - 1].m)}%).`);
  }
  return out;
}
function viewOverview() {
  const studs = studsOf(); if (!studs.length) return '<div class="nr-empty">لا يوجد طلاب</div>';
  const all = groupStats(studs);
  const nearPass = studs.filter(s => !s.passed && s.fails.length === 1).length;
  return `
  <section class="nr-hero">
    <div class="nr-kpi big"><span>نسبة الاجتياز الكلي</span>${ring(all.passP, all.passP >= 50 ? '#2B8A3E' : '#C92A2A', 132, `${all.pass} من ${all.n}`)}</div>
    <div class="nr-kpis">
      <div class="nr-kpi"><span>الطلاب المختبَرون</span><b>${all.n}</b><small>${V.sec === 'all' ? `${D.sections.length} فصول` : 'فصل ' + esc(V.sec)}</small></div>
      <div class="nr-kpi"><span>متوسط الأداء</span><b>${r1(all.mean)}%</b><small>الوسيط ${r1(all.med)}% · الانحراف ${r1(all.sd)}</small></div>
      <div class="nr-kpi ok"><span>اجتازوا جميع المواد</span><b>${all.pass}</b><small>${r1(all.passP)}% من الطلاب</small></div>
      <div class="nr-kpi warn"><span>تعثروا في مادة واحدة</span><b>${nearPass}</b><small>أقرب الطلاب إلى الاجتياز</small></div>
    </div>
  </section>
  <section class="nr-subjs">${D.parts.map(p => { const g = groupStats(studs, p.s); return `<article class="nr-subj" style="--sc:${p.color}">
    <header><h3>${esc(p.s)}</h3><small>${p.qs.length} سؤالًا · ${p.w} درجة · الاجتياز ${r2(D.passPct / 100 * p.w)} درجة</small></header>
    <div class="nr-subj-b">${ring(g.mean, p.color, 104, 'المتوسط')}<div class="nr-subj-n"><div><b>${g.pass}</b><span>اجتازوا (${r1(g.passP)}%)</span></div><div><b>${r2(g.mean / 100 * p.w)}</b><span>متوسط الدرجة من ${p.w}</span></div><div><b>${r2(g.hi / 100 * p.w)} / ${r2(g.lo / 100 * p.w)}</b><span>أعلى / أدنى درجة</span></div></div></div>
    ${levelBar(g.lv, g.n)}</article>`; }).join('')}</section>
  <section class="nr-grid2">
    <div class="nr-card"><h4>توزيع الدرجة الكلية</h4>${histogram(studs.map(s => s.pct), '#3B5BDB', D.passPct)}</div>
    <div class="nr-card"><h4>أبرز النتائج</h4><ul class="nr-ins">${insights(studs).map(x => `<li>${x}</li>`).join('')}</ul></div>
  </section>
  ${V.sec === 'all' && D.sections.length > 1 ? `<section class="nr-card"><h4>مقارنة الفصول في المواد <small>متوسط النسبة، والخط المتقطع حد الاجتياز</small></h4>
    ${groupedBars(D.sections.map(x => ({ x, label: 'فصل ' + x })), D.parts, (g, s) => mean(D.students.filter(st => st.section === g.x).map(st => st.subj[s.s].pct)), { ref: D.passPct, label: 'مقارنة الفصول' })}
    <div class="nr-leg">${D.parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.s)}</span>`).join('')}</div>
    <div class="nr-twrap"><table class="nr-t"><thead><tr><th>الفصل</th><th>الطلاب</th>${D.parts.map(p => `<th>${esc(p.s)}<small>المتوسط · الاجتياز</small></th>`).join('')}<th>الاجتياز الكلي</th></tr></thead><tbody>
    ${D.sections.map(x => { const ss = D.students.filter(s => s.section === x), a = groupStats(ss); return `<tr><td><b>فصل ${esc(x)}</b></td><td>${ss.length}</td>${D.parts.map(p => { const g = groupStats(ss, p.s); return `<td>${r1(g.mean)}% · <b>${g.pass}</b></td>`; }).join('')}<td><b>${a.pass}</b> (${r1(a.passP)}%)</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}
  <section class="nr-card"><h4>إتقان المهارات <small>متوسط نسبة إتقان الطلاب لكل مهارة</small></h4>
    <div class="nr-skcols">${D.parts.map(p => `<div><h5 style="color:${p.color}">${esc(p.s)}</h5>${hbars(p.skills.map(g => ({ label: esc(g.k) + ` <small>(${g.qs.length} س)</small>`, v: skillMean(g, studs) })))}</div>`).join('')}</div>
    ${lvLegend()}</section>`;
}
const lvLegend = () => `<div class="nr-leg">${D.levels.map(l => `<span><i style="background:${l.c}"></i>${l.t} ${l.k === 1 ? `أقل من 50%` : l.k === 4 ? '90% فأكثر' : `${l.min}% فأكثر`}</span>`).join('')}</div>`;

/* ---------- المهارات والأسئلة ---------- */
function viewSkills() {
  const studs = studsOf();
  const p = D.parts.find(x => x.s === V.subj) || D.parts[0];
  const qsSt = j => { const r = studs.filter(s => s.correct[j]).length; return studs.length ? r / studs.length * 100 : 0; };
  return `<div class="nr-chips">${D.parts.map(x => `<button type="button" data-subj="${esc(x.s)}" class="${x.s === p.s ? 'on' : ''}" style="--sc:${x.color}">${esc(x.s)}</button>`).join('')}</div>
  <section class="nr-card"><h4>مهارات ${esc(p.s)} <small>نسبة الإتقان، وعدد الطلاب في كل مستوى</small></h4>
    <div class="nr-twrap"><table class="nr-t"><thead><tr><th>المهارة</th><th>الأسئلة</th><th style="min-width:180px">الإتقان</th><th>المستوى</th>${D.levels.map(l => `<th style="color:${l.c}">${l.t}</th>`).join('')}</tr></thead><tbody>
    ${p.skills.map(g => { const m = skillMean(g, studs); return `<tr><td><b>${esc(g.k)}</b></td><td class="nr-q">${g.qs.map(j => j + 1).join('، ')}</td><td>${hbars([{ label: '', v: m }])}</td><td>${lvTag(m)}</td>${D.levels.map(l => `<td>${studs.filter(s => levelOf(s.sk[g.id]) === l).length}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div></section>
  <section class="nr-card"><h4>تحليل أسئلة ${esc(p.s)} <small>نسبة الإجابة الصحيحة، والإجابة الخاطئة الأكثر اختيارًا (مؤشر على المفهوم الخاطئ الشائع)</small></h4>
    ${qChart(p, studs)}
    <div class="nr-twrap"><table class="nr-t"><thead><tr><th>السؤال</th><th>المهارة</th><th>الإجابة الصحيحة</th><th style="min-width:160px">أجابوا صحيحًا</th><th>توزيع الاختيارات</th><th>الخطأ الأكثر شيوعًا</th></tr></thead><tbody>
    ${p.qs.map(j => { const it = D.items[j], pr = qsSt(j), flag = it.wrongP > pr && it.wrongP >= 35; return `<tr class="${flag ? 'flag' : ''}"><td><b>${j + 1}</b></td><td>${esc(it.skill)}</td><td><span class="nr-key">${esc(it.keyL)}</span></td><td>${hbars([{ label: '', v: pr }])}</td>
      <td><div class="nr-dist">${Object.entries(it.dist).sort((a, b) => a[0].localeCompare(b[0], 'ar')).map(([l, v]) => `<span class="${it.keyL.split('/').includes(l) ? 'k' : ''}"><b>${esc(l)}</b>${Math.round(v)}%</span>`).join('')}${it.blankP >= 1 ? `<span class="bl"><b>—</b>${Math.round(it.blankP)}%</span>` : ''}</div></td>
      <td>${it.wrongL ? `«${esc(it.wrongL)}» ${r1(it.wrongP)}%${flag ? ' <em class="nr-flag" title="اختار أغلب الطلاب هذه الإجابة الخاطئة: راجع المفهوم وتأكد من مفتاح الإجابة">⚠</em>' : ''}` : '—'}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}
function qChart(p, studs) {
  const W = 620, H = 150, bw = W / p.qs.length;
  return `<svg class="nr-svg" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="صعوبة الأسئلة">
    <line x1="0" x2="${W}" y1="${H - D.passPct / 100 * (H - 10)}" y2="${H - D.passPct / 100 * (H - 10)}" stroke="#C92A2A" stroke-dasharray="5 4"/>
    ${p.qs.map((j, i) => { const v = studs.length ? studs.filter(s => s.correct[j]).length / studs.length * 100 : 0, h = v / 100 * (H - 10); return `<rect x="${W - (i + 1) * bw + 2}" y="${H - h}" width="${bw - 4}" height="${h}" rx="3" fill="${levelOf(v).c}"><title>س${j + 1}: ${r1(v)}%</title></rect><text x="${W - (i + 0.5) * bw}" y="${H + 15}" text-anchor="middle" font-size="10" fill="#475467" font-weight="700">${j + 1}</text>`; }).join('')}
  </svg>`;
}

/* ---------- الطلاب ---------- */
function filteredStudents() {
  const q = V.q.trim();
  let l = studsOf().filter(s => !q || s.name.includes(q) || String(s.nid).includes(q));
  if (V.pass === 'pass') l = l.filter(s => s.passed); else if (V.pass === 'fail') l = l.filter(s => !s.passed); else if (V.pass === 'near') l = l.filter(s => !s.passed && s.fails.length === 1);
  else if (V.pass.startsWith('f:')) l = l.filter(s => s.fails.includes(V.pass.slice(2)));
  const S = { rank: (a, b) => a.rank - b.rank, name: (a, b) => a.name.localeCompare(b.name, 'ar'), low: (a, b) => b.rank - a.rank, sec: (a, b) => +a.section - +b.section || a.rank - b.rank };
  return l.sort(S[V.sort] || S.rank);
}
function viewStudents() {
  const l = filteredStudents(), base = studsOf();
  const F = [['all', 'الكل', base.length], ['pass', 'المجتازون', base.filter(s => s.passed).length], ['fail', 'غير المجتازين', base.filter(s => !s.passed).length], ['near', 'تعثروا في مادة واحدة', base.filter(s => !s.passed && s.fails.length === 1).length], ...D.parts.map(p => ['f:' + p.s, 'لم يجتز ' + p.s, base.filter(s => s.fails.includes(p.s)).length])];
  return `<div class="nr-sbar">
      <input type="search" id="nr-q" placeholder="ابحث بالاسم أو رقم الهوية" value="${esc(V.q)}">
      <select id="nr-sort" aria-label="الترتيب">${[['rank', 'الأعلى درجة'], ['low', 'الأدنى درجة'], ['name', 'الاسم'], ['sec', 'الفصل']].map(([k, t]) => `<option value="${k}" ${V.sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="nr-btn" id="nr-print-certs">🎓 طباعة شهادات القائمة (${l.length})</button></div>
    <div class="nr-chips">${F.map(([k, t, c]) => `<button type="button" data-pass="${esc(k)}" class="${V.pass === k ? 'on' : ''}">${esc(t)} <i>${c}</i></button>`).join('')}</div>
    <div class="nr-twrap"><table class="nr-t nr-st"><thead><tr><th>الترتيب</th><th>الطالب</th><th>الفصل</th>${D.parts.map(p => `<th style="color:${p.color}">${esc(p.s)}<small>من ${p.w}</small></th>`).join('')}<th>الكلية</th><th>المستوى</th><th>الاجتياز</th><th></th></tr></thead><tbody>
    ${l.map(s => `<tr><td class="nr-rk">${s.rank}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.section)}</td>${D.parts.map(p => { const x = s.subj[p.s]; return `<td class="nr-sc ${x.pass ? 'ok' : 'no'}">${r2(x.got)}</td>`; }).join('')}<td><b>${r1(s.pct)}%</b></td><td>${lvTag(s.pct)}</td><td>${s.passed ? '<span class="nr-ps yes">✓ اجتاز</span>' : `<span class="nr-ps no">لم يجتز<small>${esc(s.fails.join('، '))}</small></span>`}</td><td><button type="button" class="nr-btn sm" data-st="${esc(s.id)}">الشهادة</button></td></tr>`).join('') || '<tr><td colspan="99" class="nr-empty">لا يوجد طلاب</td></tr>'}</tbody></table></div>`;
}

/* ---------- شهادة الطالب ---------- */
function studentAnalysis(s) {
  const gm = mean(D.students.map(x => x.pct));
  const sk = D.skills.map(g => ({ g, v: s.sk[g.id] })).filter(x => x.v != null);
  const strong = sk.filter(x => x.v >= 80).sort((a, b) => b.v - a.v), weak = sk.filter(x => x.v < 50).sort((a, b) => a.v - b.v);
  const lines = [];
  lines.push(`حصل الطالب على <b>${r2(s.total)} من ${s.max}</b> (${r1(s.pct)}%)، وترتيبه <b>${s.rank}</b> من ${D.students.length} طالبًا في ${esc(D.gradeTxt)}، وأداؤه ${s.pct >= gm ? 'أعلى' : 'أدنى'} من متوسط الصف (${r1(gm)}%) بفارق ${r1(Math.abs(s.pct - gm))} نقطة، وهو أعلى من ${s.pctile}% من زملائه.`);
  lines.push(s.passed ? `<b>اجتاز الطالب الاختبار</b> بتحقيقه ${D.passPct}% فأكثر في جميع المواد.` : `<b>لم يجتز الطالب</b> في: ${s.fails.map(f => { const p = D.parts.find(x => x.s === f), x = s.subj[f], need = Math.max(0, Math.ceil((D.passPct / 100) * p.w - x.got - 1e-9)); return `${esc(f)} (ينقصه ${need} ${need === 1 ? 'درجة' : need === 2 ? 'درجتان' : 'درجات'})`; }).join('، ')}.`);
  if (strong.length) lines.push(`<b>نقاط القوة:</b> ${strong.slice(0, 4).map(x => `${esc(x.g.k)} (${esc(x.g.s)})`).join('، ')}.`);
  if (weak.length) lines.push(`<b>يحتاج إلى دعم في:</b> ${weak.slice(0, 4).map(x => `${esc(x.g.k)} (${esc(x.g.s)})`).join('، ')}.`);
  const rec = s.passed ? 'يُوصى بإثراء الطالب بأسئلة مستوى «متقدم» والمحافظة على مستواه حتى موعد الاختبار.' : weak.length ? `يُوصى بخطة علاجية مركّزة على ${esc(weak[0].g.k)}${weak[1] ? ' و' + esc(weak[1].g.k) : ''}، بتدريبات مشابهة لأسئلة نافس، ثم إعادة القياس بعد أسبوعين.` : 'يُوصى بتدريبات على نماذج نافس في المواد التي لم يجتزها، مع متابعة زمن الإجابة.';
  lines.push(`<b>التوصية:</b> ${rec}`);
  return lines;
}
function certHtml(s) {
  const logo = printLogo();
  return `<article class="nr-cert">
    <header class="nr-cert-h">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div class="nr-cert-org"><b>${esc(printOrgName())}</b><span>شهادة نتيجة اختبار نافس التجريبي</span></div><div class="nr-cert-st ${s.passed ? 'yes' : 'no'}">${s.passed ? '✓ مجتاز' : 'غير مجتاز'}</div></header>
    <div class="nr-cert-who"><div><small>اسم الطالب</small><b>${esc(s.name)}</b></div><div><small>الصف والفصل</small><b>${esc(D.gradeTxt)} · ${esc(s.section)}</b></div>${s.nid ? `<div><small>رقم الهوية</small><b>${esc(s.nid)}</b></div>` : ''}<div><small>الترتيب</small><b>${s.rank} / ${D.students.length}</b></div></div>
    <div class="nr-cert-tot">${ring(s.pct, levelOf(s.pct).c, 108, 'الدرجة الكلية')}<div><b>${r2(s.total)}<small> / ${s.max}</small></b>${lvTag(s.pct)}<span>الاجتياز: ${D.passPct}% فأكثر في كل مادة</span></div></div>
    <div class="nr-cert-subjs">${D.parts.map(p => { const x = s.subj[p.s]; return `<section class="nr-cert-s" style="--sc:${p.color}">
      <header><b>${esc(p.s)}</b><span class="nr-cert-sc">${r2(x.got)} <small>من ${p.w}</small></span><span class="nr-ps ${x.pass ? 'yes' : 'no'}">${x.pass ? '✓ اجتاز' : '✕ لم يجتز'}</span></header>
      <div class="nr-cert-bar"><i style="width:${x.pct}%"></i><em style="right:${D.passPct}%"></em></div>
      <table><tbody>${p.skills.map(g => { const v = s.sk[g.id]; return `<tr><td>${esc(g.k)}</td><td><div class="nr-mini"><i style="width:${v}%;background:${levelOf(v).c}"></i></div></td><td>${Math.round(v)}%</td><td>${lvTag(v)}</td></tr>`; }).join('')}</tbody></table></section>`; }).join('')}</div>
    <section class="nr-cert-an"><h5>التحليل العام</h5><ul>${studentAnalysis(s).map(x => `<li>${x}</li>`).join('')}</ul></section>
    <footer class="nr-cert-f"><div>معلم المادة<i></i></div><div>رائد النشاط / الموجه الطلابي<i></i></div><div>مدير المدرسة<i></i></div></footer>
  </article>`;
}
function openCert(id) {
  const s = D.students.find(x => x.id === id); if (!s) return;
  const list = filteredStudents(); let i = list.findIndex(x => x.id === id);
  const m = document.createElement('div'); m.className = 'nr-modal';
  const paint = () => {
    const st = list[i] || s;
    m.innerHTML = `<div class="nr-modal-b"><div class="nr-modal-t"><button type="button" class="nr-btn ghost" data-nav="-1" ${i <= 0 ? 'disabled' : ''}>‹ السابق</button><span>${i + 1} / ${list.length}</span><button type="button" class="nr-btn ghost" data-nav="1" ${i >= list.length - 1 ? 'disabled' : ''}>التالي ›</button><button type="button" class="nr-btn" data-printc>🖨 طباعة الشهادة</button><button type="button" class="nr-x" data-closem aria-label="إغلاق">✕</button></div>${certHtml(st)}</div>`;
    m.querySelector('[data-closem]').onclick = () => m.remove();
    m.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { i = Math.max(0, Math.min(list.length - 1, i + +b.dataset.nav)); paint(); });
    m.querySelector('[data-printc]').onclick = () => printDoc('شهادة ' + st.name, certHtml(st), true);
  };
  if (i < 0) { list.unshift(s); i = 0; }
  paint();
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.getElementById('nr-ov').appendChild(m);
}

/* ---------- المعلمون ---------- */
function teacherDetail(t, print = false) {
  const p = D.parts.find(x => x.s === t.subj);
  const studs = D.students.filter(s => t.secs.includes(s.section));
  if (!studs.length) return `<div class="nr-empty">لا يوجد طلاب في فصول ${esc(t.name)} ضمن التقرير.</div>`;
  const g = groupStats(studs, p.s), sch = groupStats(D.students, p.s);
  const diff = g.mean - sch.mean;
  const sk = p.skills.map(x => ({ x, m: skillMean(x, studs), s: skillMean(x, D.students) })).sort((a, b) => a.m - b.m);
  const hardQ = p.qs.map(j => ({ j, v: studs.filter(s => s.correct[j]).length / studs.length * 100, it: D.items[j] })).sort((a, b) => a.v - b.v).slice(0, 5);
  const fails = studs.filter(s => !s.subj[p.s].pass).sort((a, b) => a.subj[p.s].got - b.subj[p.s].got);
  const near = fails.filter(s => s.subj[p.s].got >= (D.passPct / 100) * p.w - 2);
  const ins = [];
  ins.push(`متوسط طلاب المعلم في ${esc(p.s)} <b>${r1(g.mean)}%</b> مقابل ${r1(sch.mean)}% لمتوسط المدرسة (${diff >= 0 ? 'أعلى' : 'أدنى'} بفارق ${r1(Math.abs(diff))} نقطة).`);
  ins.push(`اجتاز المادة <b>${g.pass}</b> من ${g.n} طالبًا (${r1(g.passP)}%)، ومتوسط المدرسة ${r1(sch.passP)}%.`);
  if (sk.length) ins.push(`أكبر مواطن الإخفاق: <b>${esc(sk[0].x.k)}</b> بإتقان ${r1(sk[0].m)}%${sk[1] ? `، ثم <b>${esc(sk[1].x.k)}</b> ${r1(sk[1].m)}%` : ''}.`);
  if (near.length) ins.push(`<b>${near.length}</b> ${near.length === 1 ? 'طالب' : 'طالبًا'} على بُعد درجة أو درجتين من اجتياز المادة؛ دعمهم يرفع نسبة الاجتياز إلى ${r1((g.pass + near.length) / g.n * 100)}%.`);
  return `<div class="nr-tdetail">
    <header class="nr-th" style="--sc:${p.color}"><div><h3>${esc(t.name)}</h3><span>${esc(p.s)} · فصول ${t.secs.map(esc).join('، ')} · ${g.n} طالبًا</span></div>${print ? '' : '<button type="button" class="nr-btn" id="nr-print-teacher">🖨 طباعة تقرير المعلم</button>'}</header>
    <div class="nr-tk">
      <div class="nr-kpi">${ring(g.mean, p.color, 100, 'المتوسط')}</div>
      <div class="nr-kpi"><span>الاجتياز</span><b>${g.pass} / ${g.n}</b><small>${r1(g.passP)}% · المدرسة ${r1(sch.passP)}%</small></div>
      <div class="nr-kpi ${diff >= 0 ? 'ok' : 'warn'}"><span>الفرق عن المدرسة</span><b>${diff >= 0 ? '+' : '−'}${r1(Math.abs(diff))}</b><small>نقطة مئوية</small></div>
      <div class="nr-kpi"><span>متوسط الدرجة</span><b>${r2(g.mean / 100 * p.w)}</b><small>من ${p.w}</small></div>
    </div>
    <div class="nr-card"><h4>مستويات الأداء</h4>${levelBar(g.lv, g.n)}</div>
    <ul class="nr-ins">${ins.map(x => `<li>${x}</li>`).join('')}</ul>
    <div class="nr-grid2">
      <div class="nr-card"><h4>المهارات <small>طلاب المعلم، والعلامة متوسط المدرسة</small></h4>${hbars(sk.map(o => ({ label: esc(o.x.k), v: o.m, ref: o.s })), { refLabel: 'متوسط المدرسة' })}</div>
      <div class="nr-card"><h4>الفصول</h4>${hbars(t.secs.map(x => { const ss = studs.filter(s => s.section === x); const gg = groupStats(ss, p.s); return { label: 'فصل ' + esc(x), v: gg.mean, extra: `اجتاز ${gg.pass}/${gg.n}`, color: p.color }; }))}</div>
    </div>
    <div class="nr-card"><h4>أصعب الأسئلة على طلابه</h4><div class="nr-twrap"><table class="nr-t"><thead><tr><th>السؤال</th><th>المهارة</th><th>أجابوا صحيحًا</th><th>المدرسة</th><th>الخطأ الشائع</th></tr></thead><tbody>${hardQ.map(q => `<tr><td><b>${q.j + 1}</b></td><td>${esc(q.it.skill)}</td><td>${r1(q.v)}%</td><td>${r1(q.it.p)}%</td><td>${q.it.wrongL ? `«${esc(q.it.wrongL)}» ${r1(q.it.wrongP)}%` : '—'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="nr-card"><h4>الطلاب غير المجتازين للمادة (${fails.length})</h4>${fails.length ? `<${print ? 'div' : 'details class="nr-more"'}>${print ? '' : `<summary>عرض القائمة (الأقرب إلى الاجتياز مظلّلون)</summary>`}<div class="nr-twrap"><table class="nr-t"><thead><tr><th>#</th><th>الطالب</th><th>الفصل</th><th>الدرجة</th><th>ينقصه</th><th>أضعف مهارة</th></tr></thead><tbody>${[...fails].sort((a, b) => b.subj[p.s].got - a.subj[p.s].got).map((s, k) => { const need = Math.max(0, Math.ceil((D.passPct / 100) * p.w - s.subj[p.s].got - 1e-9)); const w = p.skills.map(x => ({ x, v: s.sk[x.id] })).sort((a, b) => a.v - b.v)[0]; return `<tr class="${need <= 2 ? 'near' : ''}"><td>${k + 1}</td><td>${esc(s.name)}</td><td>${esc(s.section)}</td><td>${r2(s.subj[p.s].got)} / ${p.w}</td><td>${need}</td><td>${w ? esc(w.x.k) + ` (${Math.round(w.v)}%)` : '—'}</td></tr>`; }).join('')}</tbody></table></div></${print ? 'div' : 'details'}>` : '<p class="nr-empty">اجتاز جميع طلابه المادة.</p>'}</div>
  </div>`;
}
function viewTeachers() {
  if (!D.teachers.length) return '<div class="nr-empty">لم يُعثر على معلمين لمواد الاختبار في الجدول المدرسي لهذا الصف. أدخل الجدول المدرسي ليظهر تحليل المعلمين.</div>';
  const cards = D.parts.map(p => {
    const ts = D.teachers.filter(t => t.subj === p.s); if (!ts.length) return '';
    const sch = groupStats(D.students, p.s);
    return `<section class="nr-card"><h4 style="color:${p.color}">${esc(p.s)} <small>متوسط المدرسة ${r1(sch.mean)}% · الاجتياز ${r1(sch.passP)}%</small></h4><div class="nr-tcards">${ts.map(t => {
      const studs = D.students.filter(s => t.secs.includes(s.section)); const g = groupStats(studs, p.s); const k = t.id + '|' + t.subj; const diff = g.mean - sch.mean;
      return `<button type="button" class="nr-tcard ${V.teacher === k ? 'on' : ''}" data-tch="${esc(k)}" style="--sc:${p.color}">
        <b>${esc(t.name)}</b><small>فصول ${t.secs.map(esc).join('، ')} · ${g.n} طالبًا</small>
        <div class="nr-tcard-n"><span><b>${r1(g.mean)}%</b>المتوسط</span><span><b>${g.pass}/${g.n}</b>اجتازوا</span><span class="${diff >= 0 ? 'up' : 'down'}"><b>${diff >= 0 ? '▲' : '▼'} ${r1(Math.abs(diff))}</b>عن المدرسة</span></div>
        <div class="nr-mini"><i style="width:${g.passP}%;background:${p.color}"></i></div></button>`;
    }).join('')}</div></section>`;
  }).join('');
  const t = V.teacher && D.teachers.find(x => x.id + '|' + x.subj === V.teacher);
  return `<div class="nr-sbar"><p class="nr-hint">اختر معلمًا لعرض تحليل طلاب فصوله التي يدرّسها (من الجدول المدرسي).</p><button type="button" class="nr-btn" id="nr-print-teachers">🖨 طباعة تقارير جميع المعلمين</button></div>${cards}${t ? teacherDetail(t) : ''}`;
}

/* ---------- الطباعة ---------- */
function printDoc(title, body, paged = false) {
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${NR_CSS}
    @page{ size:A4; margin:10mm; } body{ margin:0; background:#fff; font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif; }
    .nr-print{ padding:0; } .nr-btn,.nr-x,#nr-print-teacher{ display:none !important; }
    .nr-cert{ break-after:page; box-shadow:none; border:1.5px solid #D5DCE6; margin:0 0 0; }
    .nr-cert:last-child{ break-after:auto; } .nr-page{ break-after:page; } .nr-page:last-child{ break-after:auto; }
    .nr-card,.nr-subj,.nr-tcard,.nr-cert-s,tr{ break-inside:avoid; } .nr-twrap{ overflow:visible; }
    *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }</style></head>
    <body><div class="nr nr-print">${paged ? '' : `<header class="nr-phead">${printLogo() ? `<img src="${esc(printLogo())}" alt="">` : ''}<div><b>${esc(printOrgName())}</b><span>تقرير نافس التجريبي · ${esc(title)} · ${esc(D.gradeTxt)}${V.sec !== 'all' && V.tab !== 'teachers' ? ' · فصل ' + esc(V.sec) : ''}</span></div></header>`}${body}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),600)<\/script></body></html>`);
  w.document.close();
}

/* ---------- التنسيق ---------- */
function injectCss() { if (document.getElementById('nr-css')) return; const s = document.createElement('style'); s.id = 'nr-css'; s.textContent = NR_CSS; document.head.appendChild(s); }
const NR_CSS = `
.nr-ov{ position:fixed; inset:0; z-index:9000; background:#F4F6FB; overflow:hidden; }
.nr-ov.hidden{ display:none; } body.nr-lock{ overflow:hidden; }
.nr-load{ display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:12px; color:#475467; font-weight:700; }
.nr{ display:flex; flex-direction:column; height:100%; color:#14233A; }
.nr-top{ position:relative; background:radial-gradient(120% 140% at 100% 0%,#24508F 0%,#0F2447 55%,#0A1830 100%); color:#fff; padding:16px 22px 0; display:grid; grid-template-columns:1fr auto; gap:10px 16px; overflow:hidden; }
.nr-top::after{ content:''; position:absolute; left:-60px; top:-80px; width:260px; height:260px; border-radius:50%; background:radial-gradient(circle,rgba(12,166,120,.35),transparent 70%); pointer-events:none; }
.nr-ttl{ display:flex; align-items:center; gap:14px; } .nr-ttl h2{ margin:0; font-size:20px; font-weight:900; } .nr-ttl p{ margin:3px 0 0; color:#B9C8E2; font-size:12.5px; }
.nr-badge{ background:linear-gradient(135deg,#0CA678,#3B5BDB); border-radius:14px; padding:10px 14px; font-weight:900; font-size:15px; box-shadow:0 6px 18px rgba(12,166,120,.35); }
.nr-acts{ display:flex; gap:8px; align-items:center; z-index:1; }
.nr-tabs{ grid-column:1/-1; display:flex; gap:4px; overflow-x:auto; z-index:1; }
.nr-tabs button{ border:0; background:none; color:#C8D6EE; font:inherit; font-weight:800; font-size:14px; padding:11px 16px; border-radius:12px 12px 0 0; cursor:pointer; white-space:nowrap; width:auto; margin:0; }
.nr-tabs button.on{ background:#F4F6FB; color:#0F2447; }
.nr-x{ width:38px; height:38px; margin:0; border-radius:11px; border:0; background:rgba(255,255,255,.14); color:#fff; font-size:16px; cursor:pointer; }
.nr-btn{ width:auto; margin:0; border:0; background:#0F2447; color:#fff; font:inherit; font-weight:800; font-size:13px; padding:9px 14px; border-radius:11px; cursor:pointer; white-space:nowrap; }
.nr-top .nr-btn.ghost{ background:rgba(255,255,255,.14); }
.nr-btn.ghost{ background:#EEF2F8; color:#0F2447; } .nr-btn.sm{ padding:5px 10px; font-size:12px; border-radius:9px; } .nr-btn:disabled{ opacity:.4; cursor:default; }
.nr-secs{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:12px 22px 0; }
.nr-secs span{ font-size:12px; font-weight:800; color:#667085; }
.nr-secs button,.nr-chips button{ width:auto; margin:0; border:1px solid #DCE3EE; background:#fff; color:#344054; font:inherit; font-size:12.5px; font-weight:800; padding:6px 12px; border-radius:99px; cursor:pointer; }
.nr-secs button.on{ background:#0F2447; color:#fff; border-color:#0F2447; }
.nr-chips{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.nr-chips button i{ font-style:normal; background:#F2F4F7; border-radius:99px; padding:0 7px; margin-inline-start:4px; font-size:11px; }
.nr-chips button.on{ background:var(--sc,#0F2447); color:#fff; border-color:var(--sc,#0F2447); } .nr-chips button.on i{ background:rgba(255,255,255,.22); }
.nr-main{ flex:1; overflow:auto; padding:16px 22px 40px; }
.nr-hero{ display:grid; grid-template-columns:auto 1fr; gap:14px; margin-bottom:14px; }
.nr-kpis{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.nr-kpi{ background:#fff; border:1px solid #E4E9F2; border-radius:18px; padding:14px 16px; display:flex; flex-direction:column; gap:4px; justify-content:center; box-shadow:0 1px 2px rgba(16,24,40,.04); }
.nr-kpi span{ font-size:12px; color:#667085; font-weight:800; } .nr-kpi b{ font-size:26px; font-weight:900; color:#0F2447; line-height:1.1; } .nr-kpi small{ color:#667085; font-size:11.5px; }
.nr-kpi.big{ align-items:center; padding:12px 20px; background:linear-gradient(160deg,#fff,#F1F5FD); }
.nr-kpi.ok b{ color:#2B8A3E; } .nr-kpi.warn b{ color:#C2410C; }
.nr-subjs{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin-bottom:14px; }
.nr-subj{ background:#fff; border:1px solid #E4E9F2; border-radius:20px; padding:14px 16px; border-top:5px solid var(--sc); }
.nr-subj header h3{ margin:0; font-size:17px; color:var(--sc); } .nr-subj header small{ color:#667085; font-size:11.5px; }
.nr-subj-b{ display:flex; align-items:center; gap:12px; margin:8px 0; }
.nr-subj-n{ display:grid; gap:6px; flex:1; } .nr-subj-n div{ display:flex; align-items:baseline; gap:8px; } .nr-subj-n b{ font-size:17px; font-weight:900; min-width:56px; } .nr-subj-n span{ font-size:11.5px; color:#667085; }
.nr-lvbar{ display:flex; height:22px; border-radius:8px; overflow:hidden; background:#F2F4F7; }
.nr-lvbar i{ display:flex; align-items:center; justify-content:center; min-width:18px; } .nr-lvbar b{ color:#fff; font-size:11px; font-weight:900; }
.nr-lvleg{ display:flex; flex-wrap:wrap; gap:4px 12px; margin-top:7px; font-size:11.5px; color:#475467; } .nr-lvleg i,.nr-leg i{ display:inline-block; width:10px; height:10px; border-radius:3px; margin-inline-end:4px; vertical-align:-1px; }
.nr-grid2{ display:grid; grid-template-columns:1.25fr 1fr; gap:12px; margin-bottom:14px; }
.nr-card{ background:#fff; border:1px solid #E4E9F2; border-radius:20px; padding:14px 16px; margin-bottom:14px; }
.nr-grid2 .nr-card{ margin-bottom:0; }
.nr-card h4{ margin:0 0 10px; font-size:15px; font-weight:900; } .nr-card h4 small{ font-weight:600; color:#667085; font-size:11.5px; margin-inline-start:6px; }
.nr-svg{ width:100%; height:auto; max-height:300px; display:block; font-family:inherit; direction:ltr; } .nr-svg text,.nr-ring text{ direction:rtl; unicode-bidi:plaintext; }
.nr-more summary{ cursor:pointer; font-weight:800; color:#1971C2; font-size:13px; padding:4px 0; }
.nr-ins{ margin:0; padding:0; list-style:none; display:grid; gap:8px; }
.nr-ins li{ position:relative; padding:9px 12px 9px 12px; padding-inline-start:30px; background:#F7F9FC; border-radius:12px; font-size:13px; line-height:1.75; }
.nr-ins li::before{ content:'◆'; position:absolute; inset-inline-start:11px; top:9px; color:#0CA678; font-size:11px; }
.nr-leg{ display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:#475467; margin-top:8px; }
.nr-twrap{ overflow-x:auto; margin-top:10px; }
.nr-t{ width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
.nr-t th{ background:#F5F7FB; color:#475467; font-weight:800; font-size:12px; padding:8px 10px; text-align:right; white-space:nowrap; border-bottom:1px solid #E4E9F2; }
.nr-t th small{ display:block; font-weight:600; color:#98A2B3; font-size:10.5px; }
.nr-t td{ padding:8px 10px; border-bottom:1px solid #F0F2F6; vertical-align:middle; }
.nr-t tr.flag td{ background:#FFF8F1; } .nr-t tr.near td{ background:#FFFBEB; }
.nr-q{ color:#667085; font-size:12px; }
.nr-skcols{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:18px; } .nr-skcols h5{ margin:0 0 8px; font-size:14px; }
.nr-hb{ display:grid; gap:7px; }
.nr-hb-r{ display:grid; grid-template-columns:minmax(110px,190px) 1fr 52px; align-items:center; gap:8px; font-size:12.5px; }
.nr-hb-r:has(.nr-hb-l:empty){ grid-template-columns:1fr 52px; } .nr-hb-l:empty{ display:none; }
.nr-hb-l{ font-weight:700; max-width:190px; } .nr-hb-l small{ color:#98A2B3; font-weight:600; }
.nr-hb-r > small{ grid-column:1/-1; color:#667085; font-size:11px; margin-top:-4px; }
.nr-hb-t{ position:relative; height:12px; background:#EEF2F7; border-radius:99px; overflow:visible; }
.nr-hb-t i{ position:absolute; inset-block:0; right:0; border-radius:99px; }
.nr-hb-t em{ position:absolute; top:-4px; width:3px; height:20px; background:#0F2447; border-radius:2px; transform:translateX(50%); }
.nr-hb-r b{ font-weight:900; text-align:left; }
.nr-lv{ display:inline-block; font-size:11px; font-weight:900; color:var(--c); background:var(--b); border:1px solid color-mix(in srgb,var(--c) 25%,transparent); border-radius:99px; padding:2px 9px; white-space:nowrap; }
.nr-key{ display:inline-block; min-width:24px; text-align:center; background:#E7F5FF; color:#1971C2; font-weight:900; border-radius:7px; padding:1px 6px; }
.nr-dist{ display:flex; gap:4px; flex-wrap:wrap; } .nr-dist span{ font-size:11px; background:#F2F4F7; border-radius:7px; padding:2px 6px; color:#475467; } .nr-dist span b{ margin-inline-end:3px; }
.nr-dist span.k{ background:#EBFBEE; color:#2B8A3E; } .nr-dist span.bl{ background:#fff; border:1px dashed #D0D5DD; }
.nr-flag{ font-style:normal; color:#C2410C; }
.nr-sbar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
.nr-sbar input,.nr-sbar select{ width:auto; margin:0; font:inherit; font-size:13px; padding:9px 12px; border-radius:11px; border:1px solid #D0D5DD; background:#fff; }
.nr-sbar input{ flex:1; min-width:200px; } .nr-hint{ margin:0; flex:1; color:#667085; font-size:13px; }
.nr-st .nr-rk{ font-weight:900; color:#98A2B3; } .nr-sc{ font-weight:900; } .nr-sc.ok{ color:#2B8A3E; } .nr-sc.no{ color:#C92A2A; }
.nr-ps{ display:inline-flex; flex-direction:column; font-size:12px; font-weight:900; border-radius:9px; padding:3px 9px; }
.nr-ps.yes{ background:#EBFBEE; color:#2B8A3E; } .nr-ps.no{ background:#FFF5F5; color:#C92A2A; } .nr-ps small{ font-weight:600; font-size:10.5px; }
.nr-empty{ padding:30px; text-align:center; color:#667085; }
.nr-modal{ position:absolute; inset:0; background:rgba(10,24,48,.55); backdrop-filter:blur(3px); display:flex; justify-content:center; overflow:auto; padding:18px 10px; z-index:2; }
.nr-modal-b{ width:min(860px,100%); }
.nr-modal-t{ display:flex; gap:8px; align-items:center; margin-bottom:10px; color:#fff; font-weight:800; }
.nr-modal-t span{ flex:1; text-align:center; } .nr-modal-t .nr-x{ background:rgba(255,255,255,.2); }
.nr-cert{ position:relative; background:#fff; border-radius:22px; padding:20px 22px; box-shadow:0 20px 50px rgba(10,24,48,.25); overflow:hidden; }
.nr-cert::before{ content:''; position:absolute; inset:0 0 auto 0; height:7px; background:linear-gradient(90deg,#3B5BDB,#0CA678,#E8590C); }
.nr-cert-h{ display:flex; align-items:center; gap:12px; border-bottom:1px solid #EEF2F7; padding-bottom:12px; }
.nr-cert-h img{ height:52px; } .nr-cert-org{ flex:1; display:flex; flex-direction:column; }
.nr-cert-h b{ font-size:15px; } .nr-cert-h span{ font-size:18px; font-weight:900; color:#0F2447; }
.nr-cert-st{ font-weight:900; font-size:15px; padding:9px 16px; border-radius:14px; } .nr-cert-st.yes{ background:#EBFBEE; color:#2B8A3E; border:1.5px solid #8CE99A; } .nr-cert-st.no{ background:#FFF5F5; color:#C92A2A; border:1.5px solid #FFA8A8; }
.nr-cert-who{ display:grid; grid-template-columns:2fr 1.2fr 1.2fr .8fr; gap:10px; margin:12px 0; }
.nr-cert-who div{ background:#F7F9FC; border-radius:12px; padding:8px 12px; } .nr-cert-who small{ display:block; color:#667085; font-size:11px; font-weight:700; } .nr-cert-who b{ font-size:14px; }
.nr-cert-tot{ display:flex; align-items:center; gap:16px; background:linear-gradient(135deg,#F1F5FD,#F2FBF7); border-radius:16px; padding:8px 16px; margin-bottom:12px; }
.nr-cert-tot > div{ display:flex; flex-direction:column; gap:6px; align-items:flex-start; } .nr-cert-tot b{ font-size:30px; font-weight:900; } .nr-cert-tot b small{ font-size:15px; color:#667085; } .nr-cert-tot span{ font-size:12px; color:#667085; }
.nr-cert-subjs{ display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:10px; }
.nr-cert-s{ border:1px solid #E4E9F2; border-radius:16px; padding:10px 12px; border-top:4px solid var(--sc); }
.nr-cert-s header{ display:flex; align-items:center; gap:8px; } .nr-cert-s header > b{ flex:1; color:var(--sc); font-size:15px; }
.nr-cert-sc{ font-weight:900; font-size:17px; } .nr-cert-sc small{ font-size:11px; color:#667085; }
.nr-cert-bar{ position:relative; height:10px; background:#EEF2F7; border-radius:99px; margin:8px 0; } .nr-cert-bar i{ position:absolute; inset-block:0; right:0; background:var(--sc); border-radius:99px; } .nr-cert-bar em{ position:absolute; top:-4px; width:2px; height:18px; background:#C92A2A; }
.nr-cert-s table{ width:100%; border-collapse:collapse; font-size:11.5px; } .nr-cert-s td{ padding:4px 2px; border-top:1px solid #F2F4F7; } .nr-cert-s td:first-child{ font-weight:700; }
.nr-mini{ height:7px; background:#EEF2F7; border-radius:99px; overflow:hidden; min-width:50px; } .nr-mini i{ display:block; height:100%; border-radius:99px; }
.nr-cert-an{ margin-top:12px; background:#F7F9FC; border-radius:16px; padding:10px 14px; } .nr-cert-an h5{ margin:0 0 6px; font-size:14px; } .nr-cert-an ul{ margin:0; padding-inline-start:18px; font-size:12.5px; line-height:1.9; }
.nr-cert-f{ display:flex; justify-content:space-between; gap:12px; margin-top:16px; font-size:12px; color:#475467; text-align:center; } .nr-cert-f div{ flex:1; } .nr-cert-f i{ display:block; border-bottom:1px solid #98A2B3; height:26px; }
.nr-tcards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; }
.nr-tcard{ width:auto; margin:0; text-align:right; border:1.5px solid #E4E9F2; background:#fff; border-radius:16px; padding:12px 14px; cursor:pointer; font:inherit; display:flex; flex-direction:column; gap:6px; transition:transform .15s,box-shadow .15s; }
.nr-tcard:hover{ transform:translateY(-2px); box-shadow:0 8px 20px rgba(16,24,40,.08); } .nr-tcard.on{ border-color:var(--sc); box-shadow:0 0 0 3px color-mix(in srgb,var(--sc) 18%,transparent); }
.nr-tcard > b{ font-size:15px; color:#0F2447; } .nr-tcard > small{ color:#667085; font-size:11.5px; }
.nr-tcard-n{ display:flex; gap:10px; } .nr-tcard-n span{ display:flex; flex-direction:column; font-size:11px; color:#667085; } .nr-tcard-n b{ font-size:16px; color:#0F2447; } .nr-tcard-n .up b{ color:#2B8A3E; } .nr-tcard-n .down b{ color:#C92A2A; }
.nr-tdetail{ margin-top:6px; }
.nr-th{ display:flex; align-items:center; gap:12px; background:linear-gradient(135deg,color-mix(in srgb,var(--sc) 12%,#fff),#fff); border:1px solid #E4E9F2; border-inline-start:6px solid var(--sc); border-radius:18px; padding:12px 16px; margin-bottom:12px; }
.nr-th > div{ flex:1; } .nr-th h3{ margin:0; font-size:19px; } .nr-th span{ color:#475467; font-size:12.5px; }
.nr-tk{ display:grid; grid-template-columns:auto repeat(3,1fr); gap:10px; margin-bottom:12px; }
.nr-tdetail > .nr-ins{ margin-bottom:12px; }
.nr-phead{ display:flex; align-items:center; gap:12px; border-bottom:2px solid #0F2447; padding-bottom:8px; margin-bottom:12px; } .nr-phead img{ height:44px; } .nr-phead b{ display:block; font-size:15px; } .nr-phead span{ color:#475467; font-size:12px; }
@media (max-width:820px){
  .nr-top{ padding:12px 12px 0; } .nr-ttl h2{ font-size:16px; } .nr-ttl p{ font-size:11px; } .nr-badge{ display:none; }
  #nr-print{ display:none; } .nr-main{ padding:12px 12px 40px; } .nr-secs{ padding:10px 12px 0; overflow-x:auto; flex-wrap:nowrap; }
  .nr-hero,.nr-grid2{ grid-template-columns:1fr; } .nr-kpis{ grid-template-columns:repeat(2,1fr); } .nr-kpi b{ font-size:21px; }
  .nr-cert{ padding:16px 14px; } .nr-cert-who{ grid-template-columns:1fr 1fr; } .nr-tk{ grid-template-columns:1fr 1fr; }
  .nr-hb-l{ max-width:120px; }
}`;
