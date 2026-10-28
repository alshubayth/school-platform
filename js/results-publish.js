/* =========================================================================
 * نشر النتائج لأولياء الأمور (المدير والوكيل)
 * - «نتائج مجمّعة»: عدة تقارير (مثل كل الاختبارات الفترية لصف في فصل دراسي) في كشف واحد لكل طالب.
 * - «تقرير واحد»: نتيجة اختبار واحد.
 * عند الحفظ تُحسب درجات كل طالب من التقارير وتُحفظ نسخة جاهزة (result_entries)،
 * ويطّلع عليها ولي الأمر من صفحة results.html برقم الهوية وآخر أربعة أرقام من الجوال.
 * لا يظهر لولي الأمر اسم أي طالب آخر ولا ترتيب، فقط درجة ابنه ومتوسط فصله.
 * ========================================================================= */
import { sb, currentSchoolId, currentUserId, readScopedBySchool, writeWithSchool, gradeLabels, ASSET_VERSION } from './core.js';
import { loadPdfJs, loadPdfLib } from './lib-loader.js';

const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
const BUCKET = 'result-docs';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GRADE_ORDER = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const GRADE_CODE = Object.fromEntries(Object.entries(gradeLabels).map(([k, v]) => [v, k]));
const glOf = g => (GRADE_ORDER.includes(g) ? g : GRADE_CODE[g] || null);
const TYPE_LABEL = { periodic: 'الفترية', diagnostic: 'التشخيصية', final: 'النهائية', nafes: 'التجريبية لنافس' };
const SEMS = ['الفصل الدراسي الأول', 'الفصل الدراسي الثاني'];
const r2 = v => Math.round(v * 100) / 100;
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

let reportsMeta = [];   // تقارير المدرسة (بدون raw_data)
let pubs = [];
let slug = 'al-murooj';

const R = build => readScopedBySchool(sc => { let q = build(); if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; });
const pageUrl = () => location.origin + location.pathname.replace(/index\.html$/, '').replace(/\/[^/]*$/, '/') + 'results.html?school=' + encodeURIComponent(slug);

export async function openResultsPublisher() {
  let back = $('rp-back');
  if (!back) { back = document.createElement('div'); back.id = 'rp-back'; back.className = 'rp-back'; document.body.appendChild(back); }
  back.innerHTML = `<div class="rp" role="dialog" aria-modal="true" aria-label="نتائج أولياء الأمور"><div class="tx-loading"><span></span><span></span><span></span></div></div>`;
  back.classList.remove('hidden');
  document.body.classList.add('db-noscroll');
  back.onclick = e => { if (e.target === back) close(); };
  const [{ data: reps }, { data: ps, error }, { data: sch }] = await Promise.all([
    R(() => sb.from('exam_reports').select('id, title, subject_name, grade_level, semester, exam_type, created_at').order('created_at', { ascending: false })),
    R(() => sb.from('result_publications').select('*').order('created_at', { ascending: false })),
    currentSchoolId ? sb.from('schools').select('slug').eq('id', currentSchoolId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (sch && sch.slug) slug = sch.slug;
  if (error) { back.querySelector('.rp').innerHTML = `<p class="rp-err">تعذر تحميل البيانات: ${esc(error.message)}</p>`; return; }
  reportsMeta = (reps || []).map(r => ({ ...r, gl: glOf(r.grade_level) }));
  pubs = ps || [];
  renderList();
}
function close() { const b = $('rp-back'); if (b) b.classList.add('hidden'); document.body.classList.remove('db-noscroll'); }

function head(title, backBtn) {
  return `<div class="rp-h">${backBtn ? '<button type="button" class="rp-ib" data-back aria-label="رجوع">→</button>' : ''}<b>${title}</b><button type="button" class="rp-ib" data-close aria-label="إغلاق">✕</button></div>`;
}
function wireHead(box) {
  box.querySelector('[data-close]').onclick = close;
  const b = box.querySelector('[data-back]'); if (b) b.onclick = renderList;
}

/* ---------- القائمة ---------- */
function renderList() {
  const box = $('rp-back').querySelector('.rp');
  box.innerHTML = `${head('نتائج أولياء الأمور')}
    <div class="rp-link">
      <div><b>رابط صفحة النتائج</b><span>يدخل ولي الأمر رقم هوية الطالب وآخر أربعة أرقام من جواله المسجل في المدرسة.</span></div>
      <div class="rp-link-r"><code dir="ltr">${esc(pageUrl())}</code><button type="button" class="rp-btn ghost" id="rp-copy">نسخ الرابط</button><a class="rp-btn ghost" href="${esc(pageUrl())}" target="_blank" rel="noopener">فتح الصفحة</a></div>
    </div>
    <div class="rp-bar"><b>النتائج المحفوظة</b><button type="button" class="rp-btn" id="rp-new">＋ نشر نتائج جديدة</button></div>
    <div class="rp-list">${pubs.length ? pubs.map(p => `<div class="rp-item${p.published ? ' on' : ''}" data-id="${p.id}">
      <div class="rp-item-t"><b>${esc(p.title)}</b>
        <span>${p.kind === 'documents' ? 'تقارير PDF من نور' : p.mode === 'single' ? 'تقرير واحد' : `${p.report_ids.length} اختبارات`} · ${(p.grade_levels || []).map(g => esc(gradeLabels[g] || g)).join('، ') || '—'} · ${p.students_count} طالبًا</span></div>
      <span class="rp-pill ${p.published ? 'on' : ''}">${p.published ? 'منشورة' : 'مسودة'}</span>
      <div class="rp-item-a">
        <button type="button" class="rp-btn sm${p.published ? ' ghost' : ''}" data-act="toggle">${p.published ? 'إيقاف النشر' : 'نشر'}</button>
        ${p.kind === 'documents' ? '' : '<button type="button" class="rp-btn sm ghost" data-act="refresh" title="إعادة حساب الدرجات من التقارير بعد أي تعديل">تحديث الدرجات</button>'}
        <button type="button" class="rp-btn sm ghost" data-act="edit">تعديل</button>
        <button type="button" class="rp-btn sm danger" data-act="del">حذف</button>
      </div></div>`).join('') : '<div class="rp-empty">لم تُنشر نتائج بعد. اضغط «نشر نتائج جديدة» واختر الاختبارات.</div>'}</div>`;
  wireHead(box);
  $('rp-copy').onclick = async () => { try { await navigator.clipboard.writeText(pageUrl()); $('rp-copy').textContent = '✓ نُسخ'; } catch (e) { prompt('انسخ الرابط:', pageUrl()); } };
  $('rp-new').onclick = () => renderForm(null);
  box.querySelectorAll('.rp-item').forEach(row => {
    const p = pubs.find(x => x.id === row.dataset.id);
    row.querySelector('[data-act=toggle]').onclick = async e => {
      e.target.disabled = true;
      const on = !p.published;
      const { error } = await sb.from('result_publications').update({ published: on, published_at: on ? new Date().toISOString() : p.published_at, updated_at: new Date().toISOString() }).eq('id', p.id);
      if (error) { alert('تعذر الحفظ: ' + error.message); e.target.disabled = false; return; }
      p.published = on; if (on) p.published_at = new Date().toISOString(); renderList();
    };
    const rf = row.querySelector('[data-act=refresh]');
    if (rf) rf.onclick = async e => {
      const b = e.target; b.disabled = true; b.textContent = 'جارٍ التحديث...';
      const r = await generate(p);
      if (r.error) { alert(r.error); b.disabled = false; b.textContent = 'تحديث الدرجات'; return; }
      p.students_count = r.count; renderList();
    };
    row.querySelector('[data-act=edit]').onclick = () => (p.kind === 'documents' ? renderDocsForm(p) : renderForm(p));
    row.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`هل تريد حذف «${p.title}»؟ لن تظهر لأولياء الأمور بعد الحذف.`)) return;
      if (p.kind === 'documents') await removeDocFiles(p);
      const { error } = await sb.from('result_publications').delete().eq('id', p.id);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      pubs = pubs.filter(x => x.id !== p.id); renderList();
    };
  });
}

/* ---------- نموذج الإنشاء والتعديل ---------- */
function renderForm(edit) {
  const box = $('rp-back').querySelector('.rp');
  const f = edit
    ? { mode: edit.mode, type: edit.exam_type || 'periodic', sem: edit.semester || '', grades: new Set(edit.grade_levels || []), picked: new Set(edit.report_ids || []), single: (edit.report_ids || [])[0] || '', title: edit.title, avg: edit.show_class_avg, titleTouched: true }
    : { mode: 'combined', type: 'periodic', sem: '', grades: new Set(), picked: new Set(), single: '', title: '', avg: true, titleTouched: false };
  const sems = [...new Set([...SEMS, ...reportsMeta.map(r => r.semester).filter(Boolean)])];
  const typesAvail = [...new Set(reportsMeta.map(r => r.exam_type || 'periodic'))];
  if (!edit) {
    f.sem = reportsMeta.find(r => (r.exam_type || 'periodic') === f.type && r.semester)?.semester || '';
    GRADE_ORDER.forEach(g => { if (reportsMeta.some(r => r.gl === g)) f.grades.add(g); });
  }
  const matching = () => reportsMeta.filter(r => (r.exam_type || 'periodic') === f.type && (!f.sem || r.semester === f.sem) && f.grades.has(r.gl))
    .sort((a, b) => GRADE_ORDER.indexOf(a.gl) - GRADE_ORDER.indexOf(b.gl) || String(a.subject_name).localeCompare(String(b.subject_name), 'ar'));
  const autoTitle = () => {
    if (f.mode === 'single') { const r = reportsMeta.find(x => x.id === f.single); return r ? `نتيجة ${r.title}` : ''; }
    return `نتائج الاختبارات ${TYPE_LABEL[f.type] || ''}${f.sem ? ' - ' + f.sem : ''}`;
  };
  if (!edit) f.picked = new Set(matching().map(r => r.id));

  const draw = () => {
    if (!f.titleTouched) f.title = autoTitle();
    const list = matching();
    box.innerHTML = `${head(edit ? 'تعديل النتائج' : 'نشر نتائج جديدة', true)}
      <div class="rp-form">
        ${segHtml(f.mode, !!edit)}
        ${f.mode === 'combined' ? `
          <div class="rp-row">
            <label>نوع الاختبار<select id="rp-type">${typesAvail.map(t => `<option value="${t}"${t === f.type ? ' selected' : ''}>${esc(TYPE_LABEL[t] || t)}</option>`).join('')}</select></label>
            <label>الفصل الدراسي<select id="rp-sem"><option value="">كل الفصول</option>${sems.map(s => `<option${s === f.sem ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          </div>
          <div class="rp-lbl">الصفوف</div>
          <div class="rp-chips">${GRADE_ORDER.map(g => `<button type="button" data-g="${g}" class="${f.grades.has(g) ? 'on' : ''}">${esc(gradeLabels[g])}</button>`).join('')}</div>
          <div class="rp-lbl">الاختبارات المشمولة <small>(${[...f.picked].filter(id => list.some(r => r.id === id)).length} من ${list.length})</small></div>
          <div class="rp-reps">${list.length ? list.map(r => `<label class="rp-rep"><input type="checkbox" data-r="${r.id}"${f.picked.has(r.id) ? ' checked' : ''}><b>${esc(r.subject_name || r.title)}</b><span>${esc(gradeLabels[r.gl] || r.grade_level || '')} · ${esc(r.title)}</span></label>`).join('') : '<div class="rp-empty sm">لا توجد تقارير مطابقة</div>'}</div>`
        : `<label class="rp-full">التقرير<select id="rp-single"><option value="">اختر التقرير...</option>${reportsMeta.map(r => `<option value="${r.id}"${r.id === f.single ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}</select></label>`}
        <label class="rp-full">العنوان الظاهر لولي الأمر<input type="text" id="rp-title" value="${esc(f.title)}" maxlength="120"></label>
        <label class="rp-chk"><input type="checkbox" id="rp-avg"${f.avg ? ' checked' : ''}> إظهار متوسط الفصل بجانب درجة الطالب</label>
        <p class="rp-note">تُحسب الدرجة من التقرير كما في تقارير الاختبارات. يظهر لولي الأمر درجة ابنه ونسبته وتقديره في كل مادة، ولا يظهر له اسم أي طالب آخر.</p>
        <div class="rp-err" id="rp-err"></div>
        <div class="rp-foot"><button type="button" class="rp-btn ghost" id="rp-draft">حفظ كمسودة</button><button type="button" class="rp-btn" id="rp-pub">حفظ ونشر</button></div>
      </div>`;
    wireHead(box);
    box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (b.dataset.mode === 'docs') { renderDocsForm(null); return; } f.mode = b.dataset.mode; draw(); });
    const t = $('rp-type'); if (t) t.onchange = () => { f.type = t.value; f.picked = new Set(matching().map(r => r.id)); draw(); };
    const s = $('rp-sem'); if (s) s.onchange = () => { f.sem = s.value; f.picked = new Set(matching().map(r => r.id)); draw(); };
    box.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { f.grades.has(b.dataset.g) ? f.grades.delete(b.dataset.g) : f.grades.add(b.dataset.g); matching().forEach(r => f.picked.add(r.id)); draw(); });
    box.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { c.checked ? f.picked.add(c.dataset.r) : f.picked.delete(c.dataset.r); draw(); });
    const sg = $('rp-single'); if (sg) sg.onchange = () => { f.single = sg.value; draw(); };
    $('rp-title').oninput = e => { f.title = e.target.value; f.titleTouched = true; };
    $('rp-avg').onchange = e => { f.avg = e.target.checked; };
    $('rp-draft').onclick = () => save(false);
    $('rp-pub').onclick = () => save(true);
  };

  const save = async publish => {
    const err = $('rp-err'); err.textContent = '';
    const ids = f.mode === 'single' ? (f.single ? [f.single] : []) : matching().filter(r => f.picked.has(r.id)).map(r => r.id);
    if (!ids.length) { err.textContent = f.mode === 'single' ? 'اختر التقرير أولًا' : 'اختر اختبارًا واحدًا على الأقل'; return; }
    const title = (f.title || '').trim() || autoTitle();
    const grades = [...new Set(ids.map(id => (reportsMeta.find(r => r.id === id) || {}).gl).filter(Boolean))];
    const one = f.mode === 'single' ? reportsMeta.find(r => r.id === f.single) : null;
    const row = { title, mode: f.mode, exam_type: one ? one.exam_type : f.type, semester: one ? one.semester : (f.sem || null), grade_levels: grades, report_ids: ids, show_class_avg: f.avg, updated_at: new Date().toISOString() };
    if (publish) { row.published = true; row.published_at = new Date().toISOString(); }
    const btns = [$('rp-draft'), $('rp-pub')]; btns.forEach(b => { b.disabled = true; }); $('rp-pub').textContent = 'جارٍ حساب الدرجات...';
    let pub;
    if (edit) {
      const { data, error } = await sb.from('result_publications').update(row).eq('id', edit.id).select('*').single();
      if (error) { err.textContent = 'تعذر الحفظ: ' + error.message; btns.forEach(b => { b.disabled = false; }); $('rp-pub').textContent = 'حفظ ونشر'; return; }
      pub = data;
    } else {
      const { data, error } = await writeWithSchool(extra => sb.from('result_publications').insert({ ...row, created_by: currentUserId, ...extra }).select('*').single());
      if (error) { err.textContent = 'تعذر الحفظ: ' + error.message; btns.forEach(b => { b.disabled = false; }); $('rp-pub').textContent = 'حفظ ونشر'; return; }
      pub = data;
    }
    const r = await generate(pub);
    if (r.error) { err.textContent = r.error; btns.forEach(b => { b.disabled = false; }); $('rp-pub').textContent = 'حفظ ونشر'; return; }
    pub.students_count = r.count;
    pubs = [pub, ...pubs.filter(x => x.id !== pub.id)];
    renderList();
  };
  draw();
}

/* ---------- حساب درجات الطلاب وحفظها ---------- */
async function generate(pub) {
  try {
    const [{ data: reps, error }, { scoreReport }, { allStudents }] = await Promise.all([
      sb.from('exam_reports').select('id, title, subject_name, grade_level, semester, exam_type, created_at, key_raw, raw_data, source').in('id', pub.report_ids),
      import('./student-profile.js?v=' + ASSET_VERSION),
      import('./students-cache.js?v=' + ASSET_VERSION),
    ]);
    if (error) return { error: 'تعذر تحميل التقارير: ' + error.message };
    const plat = await allStudents();
    const platMap = new Map(plat.filter(p => p.national_id).map(p => [String(p.national_id).trim(), p]));
    const entries = new Map();
    const order = pub.report_ids;
    (reps || []).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).forEach(rep => {
      const sr = scoreReport(rep, platMap);
      if (!sr) return;
      const gl = sr.gl || glOf(rep.grade_level);
      const subject = rep.subject_name || sr.subject;
      const sections = new Set(sr.recs.map(r => String(r.section)));
      const done = new Set();
      sr.recs.forEach(rec => {
        const p = platMap.get(rec.id); if (!p) return;
        done.add(rec.id);
        entryOf(entries, p).rows.push({ subject, title: rep.title || '', score: r2(rec.total), max: r2(rec.max), pct: r2(rec.pct), classAvg: sr.secMean.get(rec.section) != null ? r2(sr.secMean.get(rec.section)) : null });
      });
      // غائب: طالب من الصف نفسه وفي فصل شارك في الاختبار ولم تُرصد له ورقة
      plat.forEach(p => {
        const id = String(p.national_id || '').trim();
        if (!id || done.has(id) || p.grade_level !== gl || !sections.has(String(p.class_section))) return;
        const sm = sr.secMean.get(String(p.class_section));
        entryOf(entries, p).rows.push({ subject, title: rep.title || '', absent: true, max: r2(sr.max), classAvg: sm != null ? r2(sm) : null });
      });
    });
    const rows = [...entries.values()].map(e => {
      const sat = e.rows.filter(x => !x.absent);
      const sMax = sat.reduce((a, x) => a + x.max, 0);
      const total = sat.length ? { score: r2(sat.reduce((a, x) => a + x.score, 0)), max: r2(sMax), pct: sMax ? r2(sat.reduce((a, x) => a + x.score, 0) / sMax * 100) : null, avgPct: r2(mean(sat.map(x => x.pct))), classAvg: mean(sat.map(x => x.classAvg).filter(v => v != null)) } : null;
      if (total && total.classAvg != null) total.classAvg = r2(total.classAvg);
      e.rows.sort((a, b) => String(a.subject).localeCompare(String(b.subject), 'ar'));
      return { publication_id: pub.id, national_id: e.id, student_name: e.name, grade_level: e.gl, class_section: e.section, payload: { rows: e.rows, total } };
    });
    const del = await sb.from('result_entries').delete().eq('publication_id', pub.id);
    if (del.error) return { error: 'تعذر تحديث النتائج: ' + del.error.message };
    for (let i = 0; i < rows.length; i += 300) {
      const { error: e2 } = await writeWithSchool(extra => sb.from('result_entries').insert(rows.slice(i, i + 300).map(r => ({ ...r, ...extra }))));
      if (e2) return { error: 'تعذر حفظ النتائج: ' + e2.message };
    }
    await sb.from('result_publications').update({ students_count: rows.length, updated_at: new Date().toISOString() }).eq('id', pub.id);
    return { count: rows.length };
  } catch (e) {
    return { error: 'تعذر حساب النتائج: ' + (e.message || e) };
  }
}
function entryOf(map, p) {
  const id = String(p.national_id).trim();
  if (!map.has(id)) map.set(id, { id, name: p.full_name, gl: p.grade_level, section: p.class_section != null ? String(p.class_section) : '', rows: [] });
  return map.get(id);
}

function segHtml(mode, editing) {
  const tabs = [['combined', 'نتائج مجمّعة لعدة اختبارات'], ['single', 'نتيجة تقرير واحد'], ['docs', 'تقارير نور (PDF)']];
  // عند التعديل لا يتغير نوع النتيجة
  const list = editing ? tabs.filter(([k]) => (mode === 'docs' ? k === 'docs' : k !== 'docs')) : tabs;
  return `<div class="rp-seg" role="tablist">${list.map(([k, l]) => `<button type="button" data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

/* =========================================================================
 * تقارير نور (PDF): كل طالب صفحة، ورقم الهوية مكتوب فيها.
 * يُقرأ نص كل صفحة، ويُبحث فيه عن رقم هوية طالب مسجل في المنصة، فتُقسم الملفات
 * إلى ملف لكل طالب ويُرفع إلى مخزن خاص، والصفحات التي لم يُعرف صاحبها تُحدد يدويًا.
 * ========================================================================= */
const toLatin = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
function idsInText(text, known) {
  const runs = (toLatin(text).match(/\d+/g) || []);
  const cands = new Set();
  runs.forEach((r, i) => {
    if (r.length >= 10) for (let k = 0; k + 10 <= r.length; k++) cands.add(r.slice(k, k + 10));
    // رقم مقسوم على أكثر من قطعة نصية
    let acc = r;
    for (let j = i + 1; j < runs.length && acc.length < 10; j++) { acc += runs[j]; if (acc.length === 10) cands.add(acc); }
  });
  const hits = new Set();
  cands.forEach(c => { if (known.has(c)) hits.add(c); const rv = c.split('').reverse().join(''); if (known.has(rv)) hits.add(rv); });
  return [...hits];
}

function renderDocsForm(edit) {
  const box = $('rp-back').querySelector('.rp');
  const st = { title: edit ? edit.title : 'تقرير نتائج الطالب - الفصل الدراسي الأول', sem: edit ? (edit.semester || '') : SEMS[0], files: [], pages: [], plat: null, known: null, busy: false };
  const draw = () => {
    const matched = new Map();
    st.pages.forEach(pg => { const id = pg.manual || pg.nid; if (id) { if (!matched.has(id)) matched.set(id, []); matched.get(id).push(pg); } });
    const unmatched = st.pages.filter(pg => !(pg.manual || pg.nid));
    const dup = [...matched.values()].filter(v => v.length > 1).length;
    box.innerHTML = `${head(edit ? 'تحديث تقارير نور' : 'نشر نتائج جديدة', true)}
      <div class="rp-form">
        ${segHtml('docs', !!edit)}
        <div class="rp-row">
          <label>العنوان الظاهر لولي الأمر<input type="text" id="rd-title" value="${esc(st.title)}" maxlength="120"></label>
          <label>الفصل الدراسي<select id="rd-sem">${SEMS.map(x => `<option${x === st.sem ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        </div>
        <label class="rp-drop" id="rd-drop"><input type="file" id="rd-files" accept="application/pdf,.pdf" multiple hidden>
          <b>${st.files.length ? `${st.files.length} ملف · ${st.pages.length} صفحة` : 'اختر ملفات PDF المصدّرة من نور'}</b>
          <span>${st.files.length ? 'اضغط لإضافة ملفات أخرى' : 'يمكن اختيار عدة ملفات (فصل أو أكثر في كل ملف). كل صفحة تقرير طالب.'}</span></label>
        ${edit && !st.files.length ? `<p class="rp-note">مرفوع حاليًا ${edit.students_count} تقريرًا. الملفات الجديدة تُضاف، ومن له تقرير سابق يُستبدل تقريره.</p>` : ''}
        <div id="rd-status" class="rp-note"></div>
        ${st.pages.length ? `<div class="rd-sum">
            <div class="ok"><b>${matched.size}</b><span>طالبًا عُرف من رقم الهوية</span></div>
            <div class="${unmatched.length ? 'warn' : ''}"><b>${unmatched.length}</b><span>صفحة لم يُعرف صاحبها</span></div>
            ${dup ? `<div><b>${dup}</b><span>طالبًا له أكثر من صفحة (تُجمع في ملف واحد)</span></div>` : ''}
          </div>
          ${unmatched.length ? `<div class="rp-lbl">حدد صاحب كل صفحة أو اتركها (لن تُرفع)</div>
            <div class="rd-un">${unmatched.map(pg => `<div class="rd-pg" data-k="${pg.k}"><canvas></canvas><div><b>${esc(pg.fileName)} · صفحة ${pg.page}</b>
              <input list="rd-dl" placeholder="اكتب اسم الطالب أو رقم هويته" data-k="${pg.k}"></div></div>`).join('')}</div>
            <datalist id="rd-dl">${(st.plat || []).filter(p => p.national_id).map(p => `<option value="${esc(String(p.national_id).trim())}">${esc(p.full_name)} · ${esc(gradeLabels[p.grade_level] || '')} ${esc(p.class_section || '')}</option>`).join('')}</datalist>` : ''}` : ''}
        <div class="rp-err" id="rp-err"></div>
        <div class="rp-foot"><button type="button" class="rp-btn ghost" id="rp-draft"${matched.size ? '' : ' disabled'}>رفع كمسودة</button><button type="button" class="rp-btn" id="rp-pub"${matched.size ? '' : ' disabled'}>رفع ونشر${matched.size ? ` (${matched.size})` : ''}</button></div>
      </div>`;
    wireHead(box);
    box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (b.dataset.mode !== 'docs') renderForm(null); });
    $('rd-title').oninput = e => { st.title = e.target.value; };
    $('rd-sem').onchange = e => { st.sem = e.target.value; };
    $('rd-files').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) analyze(fs); };
    box.querySelectorAll('.rd-un input').forEach(inp => inp.onchange = () => {
      const pg = st.pages.find(x => x.k === inp.dataset.k); const v = toLatin(inp.value).replace(/\D/g, '');
      if (st.known.has(v)) { pg.manual = v; draw(); } else { inp.value = ''; inp.placeholder = 'لم يُعثر على الطالب، اختر من القائمة'; }
    });
    unmatched.forEach(pg => thumb(pg, box.querySelector(`.rd-pg[data-k="${pg.k}"] canvas`)));
    $('rp-draft').onclick = () => upload(false, matched);
    $('rp-pub').onclick = () => upload(true, matched);
  };
  const status = t => { const el = $('rd-status'); if (el) el.textContent = t; };

  const analyze = async fs => {
    try {
      status('جارٍ تجهيز القراءة...');
      await loadPdfJs(); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      if (!st.plat) {
        const { allStudents } = await import('./students-cache.js?v=' + ASSET_VERSION);
        st.plat = (await allStudents()).filter(p => p.national_id);
        st.known = new Set(st.plat.map(p => String(p.national_id).trim()));
      }
      for (const file of fs) {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') continue;
        const buf = await file.arrayBuffer();
        const fi = st.files.length;
        st.files.push({ name: file.name, buf });
        const doc = await window.pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        for (let i = 1; i <= doc.numPages; i++) {
          status(`جارٍ قراءة «${file.name}»: صفحة ${i} من ${doc.numPages}`);
          const page = await doc.getPage(i);
          const tc = await page.getTextContent();
          const text = tc.items.map(x => x.str).join(' ');
          const hits = idsInText(text, st.known);
          st.pages.push({ k: fi + '-' + i, fi, page: i, fileName: file.name, nid: hits.length === 1 ? hits[0] : null, noText: !text.trim(), doc });
        }
      }
      const noText = st.pages.filter(p => p.noText).length;
      draw();
      status(noText === st.pages.length ? 'الملفات صور بلا نص، فلا يمكن قراءة رقم الهوية منها تلقائيًا. صدّر التقرير من نور بصيغة PDF عادية، أو حدد صاحب كل صفحة يدويًا.' : '');
    } catch (e) { status('تعذر قراءة الملف: ' + (e.message || e)); }
  };

  const thumb = async (pg, cv) => {
    if (!cv) return;
    try {
      const page = await pg.doc.getPage(pg.page);
      const v0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (110 * (window.devicePixelRatio || 1)) / v0.width });
      cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    } catch (e) { /* معاينة فقط */ }
  };

  const upload = async (publish, matched) => {
    if (st.busy) return;
    const err = $('rp-err'); err.textContent = '';
    if (!currentSchoolId) { err.textContent = 'لم تُحدد المدرسة'; return; }
    st.busy = true;
    ['rp-draft', 'rp-pub'].forEach(id => { $(id).disabled = true; });
    try {
      await loadPdfLib();
      const grades = [...new Set([...matched.keys()].map(id => (st.plat.find(p => String(p.national_id).trim() === id) || {}).grade_level).filter(Boolean))];
      const row = { title: (st.title || '').trim() || 'تقرير نتائج الطالب', semester: st.sem || null, kind: 'documents', mode: 'single', updated_at: new Date().toISOString() };
      if (publish) { row.published = true; row.published_at = new Date().toISOString(); }
      let pub;
      if (edit) {
        row.grade_levels = [...new Set([...(edit.grade_levels || []), ...grades])];
        const { data, error } = await sb.from('result_publications').update(row).eq('id', edit.id).select('*').single();
        if (error) throw error; pub = data;
      } else {
        row.grade_levels = grades;
        const { data, error } = await writeWithSchool(extra => sb.from('result_publications').insert({ ...row, created_by: currentUserId, ...extra }).select('*').single());
        if (error) throw error; pub = data;
      }
      const srcs = [];
      for (const f of st.files) srcs.push(await window.PDFLib.PDFDocument.load(f.buf.slice(0), { ignoreEncryption: true }));
      const items = [...matched.entries()];
      let done = 0; const fails = [];
      const worker = async () => {
        while (items.length) {
          const [nid, pages] = items.shift();
          try {
            const out = await window.PDFLib.PDFDocument.create();
            for (const pg of pages) { const [cp] = await out.copyPages(srcs[pg.fi], [pg.page - 1]); out.addPage(cp); }
            const bytes = await out.save();
            const path = `${currentSchoolId}/${pub.id}/${nid}.pdf`;
            const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' });
            if (error) throw error;
            const p = st.plat.find(x => String(x.national_id).trim() === nid);
            const { error: e2 } = await writeWithSchool(extra => sb.from('result_documents').upsert({ publication_id: pub.id, national_id: nid, student_name: p ? p.full_name : null, storage_path: path, pages: pages.length, ...extra }, { onConflict: 'publication_id,national_id' }));
            if (e2) throw e2;
          } catch (e) { fails.push(nid); }
          done++; status(`جارٍ الرفع: ${done} من ${matched.size}`);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      const { count } = await sb.from('result_documents').select('id', { count: 'exact', head: true }).eq('publication_id', pub.id);
      await sb.from('result_publications').update({ students_count: count || 0 }).eq('id', pub.id);
      pub.students_count = count || 0;
      pubs = [pub, ...pubs.filter(x => x.id !== pub.id)];
      if (fails.length) { st.busy = false; err.textContent = `رُفع ${matched.size - fails.length} تقريرًا، وتعذر رفع ${fails.length}. أعد المحاولة لاحقًا من «تعديل».`; status(''); return; }
      renderList();
    } catch (e) {
      st.busy = false; err.textContent = 'تعذر الرفع: ' + (e.message || e);
      ['rp-draft', 'rp-pub'].forEach(id => { const b = $(id); if (b) b.disabled = false; });
    }
  };
  draw();
}

async function removeDocFiles(p) {
  const dir = `${p.school_id || currentSchoolId}/${p.id}`;
  for (let i = 0; i < 50; i++) {
    const { data } = await sb.storage.from(BUCKET).list(dir, { limit: 1000 });
    if (!data || !data.length) break;
    const { error } = await sb.storage.from(BUCKET).remove(data.map(f => `${dir}/${f.name}`));
    if (error) break;
  }
}
