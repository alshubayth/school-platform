/* =========================================================================
 * تحليل المهارات والعلاج (تبويب «المهارات والعلاج» في التقرير)
 * يظهر عندما تكون أسئلة مفتاح الإجابة مربوطة بمهارات (وأهمها اختبارات نافس التجريبية).
 * - نسبة إتقان كل مهارة = ما حصّله الطلاب من درجات أسئلتها ÷ درجتها الكاملة.
 * - المستوى: متقن (٨٠٪ فأكثر)، متوسط (٦٠–٧٩٪)، يحتاج إلى علاج (أقل من ٦٠٪).
 * - لكل مهارة: الطلاب دون ٦٠٪، وخريطة الطلاب × المهارات، وخطة علاجية مطبوعة.
 * ========================================================================= */
import { sb, printOrgName, printLogo, ASSET_VERSION, currentProfile, currentUserId } from './core.js';

const MASTER = 80, WEAK = 60;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = v => (v == null ? '—' : String(Math.round(v * 10) / 10));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const lvl = p0 => { const p = p0 == null ? null : Math.round(p0 * 10) / 10; return (p == null ? { t: '—', c: 'na' } : p >= MASTER ? { t: 'متقن', c: 'ok' } : p >= WEAK ? { t: 'متوسط', c: 'mid' } : { t: 'يحتاج إلى علاج', c: 'bad' }); };
const ranges = qs => qs.reduce((a, q) => { const l = a[a.length - 1]; if (l && q === l[1] + 1) l[1] = q; else a.push([q, q]); return a; }, []).map(([a, b]) => (a === b ? a : `${a}-${b}`)).join('، ');
const STRATEGIES = [
  'إعادة شرح المهارة بأسلوب مختلف وأمثلة محسوسة',
  'تدريبات مركّزة على أسئلة مشابهة لأسئلة نافس مع تغذية راجعة فورية',
  'التعلم بالأقران: إسناد الطالب إلى زميل متقن للمهارة',
  'إعادة قياس المهارة بعد أسبوعين بأسئلة جديدة',
];

let A = null;   // بيانات التحليل الحالية
let view = { sec: 'all', subj: 'all', open: null };

export async function renderSkillsPanel(rep, panel, tabBtn) {
  const rd = rep.raw_data || {};
  const keyId = rep.key_id || (rd.models && rd.models.keyId) || null;
  panel.innerHTML = '';
  if (!keyId || !Array.isArray(rd.students)) return;
  const { data: key } = await sb.from('answer_keys').select('id, subject, skills, exam_kind, models, pass_pct, parts, created_by').eq('id', keyId).maybeSingle();
  if (!key || !Array.isArray(key.skills) || !key.skills.some(x => x && x.k)) return;
  tabBtn.classList.remove('hidden');
  panel.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const [{ scoreReport }, { allStudents }] = await Promise.all([
    import('./student-profile.js?v=' + ASSET_VERSION),
    import('./students-cache.js?v=' + ASSET_VERSION),
  ]);
  const plat = await allStudents();
  const platMap = new Map(plat.filter(p => p.national_id).map(p => [String(p.national_id).trim(), p]));
  const sr = scoreReport(rep, platMap);
  if (!sr) { panel.innerHTML = '<div class="sk-empty">لا توجد أوراق طلاب في التقرير بعد</div>'; return; }
  const n = sr.n;
  const PW = j => (Array.isArray(rd.points) && Number.isFinite(+rd.points[j]) ? +rd.points[j] : 1);
  // النموذج ب بأسئلة مختلفة كليًا لا يُحلَّل بمهارات النموذج أ
  const differentB = key.models && key.models.mode === 'different';
  const recs = sr.recs.filter(r => !(differentB && r.model === 'ب'));
  const nafes = key.exam_kind === 'nafes' || key.subject === 'نافس';
  const skills = new Map();
  key.skills.slice(0, n).forEach((x, j) => {
    if (!x || !x.k) return;
    const s = nafes ? (x.s || 'أخرى') : (x.s || key.subject || '');
    const id = s + '|' + x.k;
    if (!skills.has(id)) skills.set(id, { id, s, k: x.k, qs: [], w: 0 });
    const g = skills.get(id); g.qs.push(j); g.w += PW(j);
  });
  const list = [...skills.values()].filter(g => g.w > 0);
  const subjQs = new Map();
  if (nafes && Array.isArray(key.parts) && key.parts.length) key.parts.forEach(pt => { const qs = []; for (let q = +pt.from - 1; q < Math.min(n, +pt.to); q++) qs.push(q); subjQs.set(pt.s, qs); });
  else list.forEach(g => { if (!subjQs.has(g.s)) subjQs.set(g.s, []); subjQs.get(g.s).push(...g.qs); });
  const students = recs.map(r => {
    const p = platMap.get(r.id);
    const by = {};
    list.forEach(g => { by[g.id] = (g.qs.reduce((a, j) => a + (r.correct[j] ? PW(j) : 0), 0) / g.w) * 100; });
    // نافس: درجة الطالب في كل مادة من كل أسئلتها (أجزاء الاختبار)، وإلا من الأسئلة المربوطة بمهارات
    const subj = {}, subjScore = {};
    subjQs.forEach((qs, sj) => {
      const w = qs.reduce((a, j) => a + PW(j), 0);
      const got = qs.reduce((a, j) => a + (r.correct[j] ? PW(j) : 0), 0);
      subjScore[sj] = { got, w };
      subj[sj] = w ? got / w * 100 : null;
    });
    return { id: r.id, name: p ? p.full_name : r.name, section: String(r.section || ''), pct: r.pct, by, subj, subjScore };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  const unlinked = key.skills.slice(0, n).filter(x => !(x && x.k)).length + Math.max(0, n - key.skills.length);
  const passPct = Number.isFinite(+key.pass_pct) && +key.pass_pct > 0 ? +key.pass_pct : 75;
  // الدرجة الكاملة لكل مادة (مثل ٢٠)، لعرض شرط الاجتياز بالدرجة (١٥ من ٢٠)
  const subjMax = [...subjQs.values()].map(qs => qs.reduce((a, j) => a + PW(j), 0));
  const refMax = subjMax.length ? Math.max(...subjMax) : 0;
  A = { rep, key, nafes, list, students, unlinked, differentB, grade: sr.gl || '', passPct, refMax, subjects: [...subjQs.keys()] };
  view = { sec: 'all', subj: 'all', open: null, pass: 'all' };
  draw(panel);
}

function filtered() {
  return A.students.filter(s => view.sec === 'all' || s.section === view.sec);
}
// نافس: يجتاز الطالب إذا حقق النسبة المطلوبة في كل مادة من مواد الاختبار
const subjPass = (s, sj) => { const x = s.subjScore[sj]; return !x || !x.w || x.got >= (A.passPct / 100) * x.w - 1e-6; };
const failedSubjects = s => Object.keys(s.subjScore).filter(sj => !subjPass(s, sj));
const passScoreOf = () => Math.round((A.passPct / 100) * A.refMax * 100) / 100;
const passed = s => !failedSubjects(s).length;
const canEditKey = () => currentProfile && (['admin', 'deputy', 'owner'].includes(currentProfile.role) || A.key.created_by === currentUserId);
function skillStats(g, studs) {
  const vals = studs.map(s => s.by[g.id]).filter(v => v != null);
  const weak = studs.filter(s => s.by[g.id] < WEAK).sort((a, b) => a.by[g.id] - b.by[g.id]);
  return { m: mean(vals), weak };
}

function draw(panel) {
  const studs = filtered();
  const secs = [...new Set(A.students.map(s => s.section).filter(Boolean))].sort((a, b) => +a - +b);
  const subjects = [...new Set(A.list.map(g => g.s))];
  const shown = A.list.filter(g => view.subj === 'all' || g.s === view.subj);
  const stats = new Map(A.list.map(g => [g.id, skillStats(g, studs)]));
  const bySubj = subjects.map(s => {
    const gs = A.list.filter(g => g.s === s);
    const w = gs.reduce((a, g) => a + g.w, 0);
    const m = w ? gs.reduce((a, g) => a + (stats.get(g.id).m || 0) * g.w, 0) / w : null;
    return { s, m, n: gs.length };
  });
  const weakest = [...A.list].map(g => ({ g, m: stats.get(g.id).m })).filter(x => x.m != null).sort((a, b) => a.m - b.m).slice(0, 3);
  const needs = A.list.filter(g => stats.get(g.id).m < MASTER || stats.get(g.id).weak.length);
  const nPass = A.nafes ? studs.filter(passed).length : 0;
  const passBySubj = A.nafes ? Object.fromEntries(A.subjects.map(sj => [sj, studs.filter(s => s.subj[sj] != null && subjPass(s, sj)).length])) : {};
  const heatStuds = A.nafes && view.pass !== 'all' ? studs.filter(s => (view.pass === 'pass') === passed(s)) : studs;

  panel.innerHTML = `<div class="sk">
    <div class="sk-bar">
      <div class="sk-chips"><button type="button" data-sec="all" class="${view.sec === 'all' ? 'on' : ''}">كل الفصول</button>${secs.map(x => `<button type="button" data-sec="${esc(x)}" class="${view.sec === x ? 'on' : ''}">فصل ${esc(x)}</button>`).join('')}</div>
      <button type="button" class="sk-print" id="sk-plan">🖨 الخطة العلاجية</button>
    </div>
    ${A.unlinked ? `<div class="sk-note">${A.unlinked} من أسئلة الاختبار غير مربوطة بمهارة، فلا تدخل في التحليل. يمكن ربطها من «إعداد نموذج الإجابة».</div>` : ''}
    ${A.differentB ? '<div class="sk-note">أسئلة النموذج ب مختلفة عن النموذج أ، فالتحليل لطلاب النموذج أ فقط.</div>' : ''}
    ${A.nafes ? `<div class="sk-pass">
      <div class="sk-pass-n"><span>المجتازون</span><b>${nPass} <small>من ${studs.length}</small></b><em>${studs.length ? r1(nPass / studs.length * 100) : 0}%</em></div>
      <div class="sk-pass-t">يجتاز الطالب المادة إذا حقق <label><input type="number" id="sk-pass-pct" min="1" max="${A.refMax}" step="1" value="${passScoreOf()}" ${canEditKey() ? '' : 'disabled'}></label> من ${A.refMax} فأعلى، ويجتاز الاختبار إذا اجتاز: ${A.subjects.map(esc).join('، ')}<span id="sk-pass-msg"></span></div>
      <div class="sk-pass-s">${A.subjects.map(sj => `<span>${esc(sj)}: <b>${passBySubj[sj]}</b> اجتازوا المادة</span>`).join('')}</div>
    </div>` : ''}
    <div class="sk-cards">
      ${bySubj.map(x => { const l = lvl(x.m); return `<button type="button" class="sk-card ${l.c}${view.subj === x.s ? ' on' : ''}" data-subj="${esc(x.s)}"><span>${esc(x.s || 'الاختبار')}</span><b>${r1(x.m)}%</b><small>${l.t} · ${x.n} ${x.n === 1 ? 'مهارة' : x.n === 2 ? 'مهارتان' : 'مهارات'}</small></button>`; }).join('')}
      <div class="sk-card"><span>الطلاب المحللون</span><b>${studs.length}</b><small>${view.sec === 'all' ? 'كل الفصول' : 'فصل ' + esc(view.sec)}</small></div>
    </div>
    ${weakest.length ? `<div class="sk-weak"><b>أبرز مواطن الضعف</b>${weakest.map(x => `<span class="${lvl(x.m).c}">${A.nafes ? esc(x.g.s) + ' · ' : ''}${esc(x.g.k)} <i>${r1(x.m)}%</i></span>`).join('')}</div>` : ''}
    ${view.subj !== 'all' ? `<div class="sk-filter">مادة: <b>${esc(view.subj)}</b> <button type="button" data-subj="all">عرض الكل ✕</button></div>` : ''}
    <div class="sk-twrap"><table class="sk-table">
      <thead><tr>${A.nafes ? '<th>المادة</th>' : ''}<th>المهارة</th><th>الأسئلة</th><th>نسبة الإتقان</th><th>المستوى</th><th>دون ${WEAK}%</th></tr></thead>
      <tbody>${shown.map(g => {
        const st = stats.get(g.id), l = lvl(st.m), open = view.open === g.id;
        return `<tr class="sk-row${open ? ' open' : ''}" data-g="${esc(g.id)}">
          ${A.nafes ? `<td class="sk-s">${esc(g.s)}</td>` : ''}
          <td><b>${esc(g.k)}</b></td>
          <td class="sk-q">${ranges(g.qs.map(j => j + 1))}</td>
          <td><div class="sk-m"><span>${r1(st.m)}%</span><i><em class="${l.c}" style="width:${Math.max(0, Math.min(100, st.m || 0))}%"></em></i></div></td>
          <td><span class="sk-lv ${l.c}">${l.t}</span></td>
          <td><button type="button" class="sk-n${st.weak.length ? '' : ' zero'}" data-open="${esc(g.id)}">${st.weak.length} ${st.weak.length ? (open ? '▲' : '▼') : ''}</button></td>
        </tr>${open && st.weak.length ? `<tr class="sk-sub"><td colspan="${A.nafes ? 6 : 5}"><div class="sk-names">${st.weak.map(s => `<span>${esc(s.name)} <small>فصل ${esc(s.section)} · ${r1(s.by[g.id])}%</small></span>`).join('')}</div></td></tr>` : ''}`;
      }).join('')}</tbody>
    </table></div>
    <div class="sk-hrow"><h5 class="sk-h">خريطة الطلاب والمهارات <small>نسبة إتقان كل طالب في كل مهارة</small></h5>
      ${A.nafes ? `<div class="sk-chips">${[['all', 'الكل'], ['pass', 'المجتازون'], ['fail', 'غير المجتازين']].map(([k, t]) => `<button type="button" data-pass="${k}" class="${view.pass === k ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}</div>
    <div class="sk-twrap sk-heatwrap"><table class="sk-heat">
      <thead><tr><th>الطالب</th>${shown.map(g => `<th title="${esc((A.nafes ? g.s + ' · ' : '') + g.k)}"><span>${esc(g.k)}</span></th>`).join('')}${A.nafes ? A.subjects.map(sj => `<th class="sj"><span>${esc(sj)}</span></th>`).join('') + '<th>الاجتياز</th>' : ''}<th>الدرجة</th></tr></thead>
      <tbody>${heatStuds.map(s => { const fl = A.nafes ? failedSubjects(s) : []; return `<tr><td class="sk-nm">${esc(s.name)}<small>فصل ${esc(s.section)}</small></td>${shown.map(g => { const v = s.by[g.id]; return `<td class="h ${lvl(v).c}">${Math.round(v)}</td>`; }).join('')}${A.nafes ? A.subjects.map(sj => { const x = s.subjScore[sj]; return `<td class="h sj ${!x ? '' : subjPass(s, sj) ? 'ok' : 'bad'}">${!x ? '—' : `${Math.round(x.got * 100) / 100}<small>/${x.w}</small>`}</td>`; }).join('') + `<td class="sk-ps ${fl.length ? 'no' : 'yes'}">${fl.length ? `لم يجتز<small>${esc(fl.join('، '))}</small>` : '✓ اجتاز'}</td>` : ''}<td class="sk-tot">${r1(s.pct)}%</td></tr>`; }).join('') || `<tr><td colspan="99" class="sk-empty">لا يوجد طلاب</td></tr>`}</tbody>
    </table></div>
    <div class="sk-legend"><span><i class="ok"></i>متقن ${MASTER}% فأكثر</span><span><i class="mid"></i>متوسط ${WEAK}–${MASTER - 1}%</span><span><i class="bad"></i>يحتاج إلى علاج أقل من ${WEAK}%</span></div>
  </div>`;
  panel.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { view.sec = b.dataset.sec; view.open = null; draw(panel); });
  panel.querySelectorAll('[data-subj]').forEach(b => b.onclick = () => { view.subj = view.subj === b.dataset.subj ? 'all' : b.dataset.subj; draw(panel); });
  panel.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { view.open = view.open === b.dataset.open ? null : b.dataset.open; draw(panel); });
  panel.querySelectorAll('[data-pass]').forEach(b => b.onclick = () => { view.pass = b.dataset.pass; draw(panel); });
  const pp = panel.querySelector('#sk-pass-pct');
  if (pp) pp.onchange = async () => {
    const sc = Math.max(1, Math.min(A.refMax, +pp.value || 1));
    const v = Math.round(sc / A.refMax * 10000) / 100;
    A.passPct = v;
    const { error } = await sb.from('answer_keys').update({ pass_pct: v }).eq('id', A.key.id);
    setTimeout(() => { draw(panel); const m = panel.querySelector('#sk-pass-msg'); if (m) m.textContent = error ? ' · تعذر حفظ النسبة' : ' · حُفظت للاختبار ✓'; }, 0);
  };
  panel.querySelector('#sk-plan').onclick = () => printPlan(needs, stats, studs);
}

/* ---------- الخطة العلاجية (طباعة) ---------- */
function printPlan(needs, stats, studs) {
  const logo = printLogo();
  const secTxt = view.sec === 'all' ? 'كل الفصول' : 'فصل ' + view.sec;
  const items = needs.filter(g => view.subj === 'all' || g.s === view.subj).sort((a, b) => (stats.get(a.id).m || 0) - (stats.get(b.id).m || 0));
  const body = items.length ? items.map((g, i) => {
    const st = stats.get(g.id), l = lvl(st.m);
    return `<section class="it">
      <div class="it-h"><b>${i + 1}. ${A.nafes ? esc(g.s) + ' — ' : ''}${esc(g.k)}</b><span class="lv ${l.c}">${l.t} · ${r1(st.m)}%</span></div>
      <div class="meta">الأسئلة: ${ranges(g.qs.map(j => j + 1))} · عدد الطلاب المحتاجين للعلاج: ${st.weak.length}</div>
      ${st.weak.length ? `<table><thead><tr><th>#</th><th>الطالب</th><th>الفصل</th><th>الإتقان</th><th>تاريخ العلاج</th><th>إعادة القياس</th></tr></thead><tbody>${st.weak.map((s, k) => `<tr><td>${k + 1}</td><td>${esc(s.name)}</td><td>${esc(s.section)}</td><td>${r1(s.by[g.id])}%</td><td></td><td></td></tr>`).join('')}</tbody></table>` : '<div class="meta">لا يوجد طالب دون ' + WEAK + '%، ويكفي تعزيز المهارة للفصل كاملًا.</div>'}
      <div class="act"><b>الإجراءات العلاجية المقترحة:</b><ul>${STRATEGIES.map(x => `<li>${x}</li>`).join('')}</ul><div class="lines"><span>إجراءات أخرى:</span><i></i><i></i></div></div>
    </section>`;
  }).join('') : '<p>جميع المهارات في مستوى الإتقان، ولا تحتاج إلى خطة علاجية.</p>';
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>الخطة العلاجية - ${esc(A.rep.title)}</title>
  <style>
    @page{ size:A4; margin:14mm; }
    body{ font-family:Tahoma,'IBM Plex Sans Arabic',sans-serif; color:#14233A; font-size:12px; margin:0; }
    .hd{ display:flex; align-items:center; gap:12px; border-bottom:2px solid #1D4E89; padding-bottom:8px; margin-bottom:12px; }
    .hd img{ height:48px; } .hd h1{ font-size:17px; margin:0; } .hd p{ margin:2px 0 0; color:#5B6B80; }
    .it{ border:1px solid #D9E0EA; border-radius:8px; padding:10px 12px; margin-bottom:12px; break-inside:avoid; }
    .it-h{ display:flex; justify-content:space-between; align-items:center; gap:8px; } .it-h b{ font-size:14px; }
    .lv{ font-weight:700; border-radius:20px; padding:2px 10px; font-size:11px; } .ok{ background:#E7F5EC; color:#1F6A3C; } .mid{ background:#FFF4E5; color:#A4501A; } .bad{ background:#FBEAE9; color:#B2382F; }
    .meta{ color:#5B6B80; margin:4px 0 8px; }
    table{ width:100%; border-collapse:collapse; margin-bottom:8px; } th,td{ border:1px solid #D9E0EA; padding:4px 6px; text-align:right; } th{ background:#F3F6FA; font-size:11px; }
    .act ul{ margin:4px 0; padding-inline-start:18px; } .lines{ margin-top:6px; } .lines i{ display:block; border-bottom:1px dotted #9AA6B6; height:16px; }
    .sign{ display:flex; justify-content:space-between; margin-top:24px; } .sign div{ width:30%; text-align:center; } .sign i{ display:block; border-bottom:1px solid #14233A; height:28px; }
    *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  </style></head><body>
  <div class="hd">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div><h1>الخطة العلاجية للمهارات</h1><p>${esc(printOrgName())} · ${esc(A.rep.title)} · ${esc(secTxt)} · ${studs.length} طالبًا</p></div></div>
  ${A.nafes ? failHtml(studs) : ''}
  ${body}
  <div class="sign"><div>معلم المادة<i></i></div><div>الموجه الطلابي<i></i></div><div>مدير المدرسة<i></i></div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة لطباعة الخطة'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}


function failHtml(studs) {
  const fails = studs.filter(s => !passed(s)).sort((a, b) => failedSubjects(b).length - failedSubjects(a).length || String(a.name).localeCompare(String(b.name), 'ar'));
  const subjects = A.subjects;
  return `<section class="it"><div class="it-h"><b>الطلاب غير المجتازين (${fails.length} من ${studs.length})</b><span class="lv mid">الاجتياز: ${passScoreOf()} من ${A.refMax} فأعلى في كل مادة</span></div>
    ${fails.length ? `<table><thead><tr><th>#</th><th>الطالب</th><th>الفصل</th>${subjects.map(sj => `<th>${esc(sj)}</th>`).join('')}<th>مواد لم يجتزها</th></tr></thead><tbody>${fails.map((s, k) => `<tr><td>${k + 1}</td><td>${esc(s.name)}</td><td>${esc(s.section)}</td>${subjects.map(sj => { const x = s.subjScore[sj]; return `<td>${!x ? '—' : `${Math.round(x.got * 100) / 100} من ${x.w}`}</td>`; }).join('')}<td>${esc(failedSubjects(s).join('، '))}</td></tr>`).join('')}</tbody></table>` : '<div class="meta">اجتاز جميع الطلاب.</div>'}
  </section>`;
}
