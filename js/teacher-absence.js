import { sb, currentSchoolId, readScopedBySchool, writeWithSchool, printOrgName, printLogo } from './core.js';
import { loadXLSX } from './lib-loader.js';

/* =========================================================================
 * غياب وإشغال المعلمين
 * - رفع ملف «تصدير حالات الغياب والاستبدال» (ورقة لكل معلم) - يمكن رفع أكثر من ملف: يُضاف الجديد فقط
 *   ولا يُحذف أي سجل سابق.
 * - الملف يكرر بعض الصفوف (مرة تحت «ديسمبر» ومرة تحت شهرها): الصف المتطابق بكل بياناته يُحسب مرة واحدة.
 * - التصنيف: «سبب غير معروف» = إشغال، أي سبب آخر = غياب، وبلا سبب مع نوع استبدال (نقل...) = نقل/تبديل.
 * - إضافة يدوية للغياب والإشغال، وتقرير لكل معلم بالتفاصيل.
 * ========================================================================= */

const COVER_REASON = 'سبب غير معروف';
const KIND_LABEL = { absence: 'غياب', cover: 'إشغال', transfer: 'نقل/تبديل' };
const ABSENCE_REASONS = ['مرضية', 'مولود', 'ورشة عمل', 'اجتماع', 'رحلة مدرسية', 'تصحيح الاختبار', 'اضطرارية', 'أخرى'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

let rows = [];          // كل السجلات
let staff = [];         // موظفو المدرسة (لربط الأسماء)
let openTeacher = null; // المعلم المفتوحة تفاصيله
const filt = { from: '', to: '', q: '', sort: 'cover' };

const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const clean = v => { const s = String(v == null ? '' : v).trim(); return !s || /^\{.*\}$/.test(s) ? '' : s; };
const fmtDate = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } };
const periodText = p => { const m = String(p || '').match(/^(\d+)\s*->\s*(\d+)$/); return m ? `من الحصة ${m[1]} إلى ${m[2]}` : p ? `حصة ${p}` : 'حصة —'; };
const kindOf = (reason, subType) => (reason === COVER_REASON ? 'cover' : reason && reason !== 'تبديل' ? 'absence' : (subType || reason) ? 'transfer' : 'absence');

export async function loadTeacherAbsenceModule() {
  const box = $('ta-container');
  if (!box.dataset.ready) { box.innerHTML = shellHtml(); wireShell(); box.dataset.ready = '1'; }
  await Promise.all([loadStaff(), loadRows()]);
  render();
}

function shellHtml() {
  return `
  <div class="ta-toolbar">
    <div class="ta-actions">
      <button type="button" class="btn-primary" id="ta-upload-btn">⬆ رفع ملف الغياب والاستبدال</button>
      <button type="button" class="text-action-btn" id="ta-add-btn">＋ إضافة غياب أو إشغال يدويًا</button>
      <input type="file" id="ta-file" accept=".xlsx,.xls" class="hidden" />
    </div>
    <div class="ta-filters">
      <label>من <input type="date" id="ta-from" /></label>
      <label>إلى <input type="date" id="ta-to" /></label>
      <input type="search" id="ta-q" placeholder="ابحث باسم المعلم..." autocomplete="off" />
      <button type="button" class="text-action-btn" id="ta-print">🖨 طباعة</button>
      <button type="button" class="text-action-btn" id="ta-export">⬇ تصدير Excel</button>
    </div>
  </div>
  <div id="ta-msg" class="ta-msg hidden"></div>
  <div id="ta-stats" class="ta-stats"></div>
  <div id="ta-list"></div>`;
}

function wireShell() {
  $('ta-upload-btn').onclick = () => $('ta-file').click();
  $('ta-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleFile(f); };
  $('ta-add-btn').onclick = () => openManualForm();
  $('ta-from').onchange = e => { filt.from = e.target.value; render(); };
  $('ta-to').onchange = e => { filt.to = e.target.value; render(); };
  $('ta-q').oninput = e => { filt.q = e.target.value; render(); };
  $('ta-print').onclick = () => printReport();
  $('ta-export').onclick = () => exportExcel();
}

async function loadStaff() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher']);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  staff = (data || []).filter(p => p.full_name);
}

async function loadRows() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('teacher_absences').select('*').order('entry_date', { ascending: true }).range(from, from + 999);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) { showMsg('تعذر تحميل السجلات: ' + error.message, true); break; }
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  rows = all;
}

function showMsg(text, isErr = false) {
  const el = $('ta-msg');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('err', isErr);
}

// ربط اسم المعلم بالملف (مثل «فيصل المطيري») بحساب الموظف («فيصل بن ... المطيري»)
function matchTeacher(name) {
  const t = norm(name).split(' ').filter(w => w && w !== 'بن');
  if (!t.length) return null;
  const hits = staff.filter(p => {
    const pt = norm(p.full_name).split(' ').filter(w => w && w !== 'بن');
    return pt[0] === t[0] && t.every(w => pt.includes(w));
  });
  return hits.length === 1 ? hits[0] : null;
}

/* ---------- قراءة الملف ---------- */
function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const m = String(v || '').trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function parseWorkbook(wb) {
  const out = [];
  let dupInFile = 0;
  const seen = new Set();
  wb.SheetNames.forEach(sheetName => {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    let teacher = '';
    let col = null;
    aoa.forEach(r => {
      const cells = r.map(c => String(c == null ? '' : c).trim());
      const tCell = cells.find(c => /^المعلم\s*:/.test(c));
      if (tCell) teacher = tCell.replace(/^المعلم\s*:\s*/, '').trim();
      if (!col && cells.includes('التاريخ') && cells.includes('الحصة')) {
        col = { date: cells.indexOf('التاريخ'), period: cells.indexOf('الحصة'), classes: cells.indexOf('الفصول'), subject: cells.indexOf('المادة'), reason: cells.indexOf('سبب الغياب'), type: cells.indexOf('نوع الاستبدال') };
        return;
      }
      if (!col) return;
      const date = parseDate(r[col.date]);
      if (!date) return;
      const name = teacher || sheetName.replace(/^\d+\s*/, '').trim();
      const rec = {
        teacher_name: name, entry_date: date,
        period: clean(r[col.period]), classes: col.classes >= 0 ? clean(r[col.classes]) : '',
        subject: col.subject >= 0 ? clean(r[col.subject]) : '', reason: col.reason >= 0 ? clean(r[col.reason]) : '',
        sub_type: col.type >= 0 ? clean(r[col.type]) : '',
      };
      const sig = [rec.teacher_name, rec.entry_date, rec.period, rec.classes, rec.subject, rec.reason, rec.sub_type].join('|');
      if (seen.has(sig)) { dupInFile++; return; }
      seen.add(sig);
      rec.kind = kindOf(rec.reason, rec.sub_type);
      out.push(rec);
    });
  });
  return { recs: out, dupInFile };
}

async function handleFile(file) {
  showMsg('جارٍ قراءة الملف...');
  try {
    await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const { recs, dupInFile } = parseWorkbook(wb);
    if (!recs.length) { showMsg('لم يُعثر في الملف على سجلات غياب أو استبدال. تأكد أن الملف هو «تصدير حالات الغياب والاستبدال».', true); return; }
    const dates = recs.map(r => r.entry_date).sort();
    const from = dates[0], to = dates[dates.length - 1];
    const teachers = [...new Set(recs.map(r => r.teacher_name))];
    const unmatched = teachers.filter(t => !matchTeacher(t));
    const cnt = k => recs.filter(r => r.kind === k).length;
    // الدمج: يُضاف من الملف ما ليس موجودًا فقط، ولا يُحذف أي سجل سابق (يمكن رفع أكثر من ملف لفترات مختلفة)
    const sigOf = r => [r.teacher_name, r.entry_date, r.period || '', r.classes || '', r.subject || '', r.reason || '', r.sub_type || ''].join('|');
    const existing = new Set(rows.map(sigOf));
    const fresh = recs.filter(r => !existing.has(sigOf(r)));
    const cntNew = k => fresh.filter(r => r.kind === k).length;
    showMsg('');
    if (!fresh.length) { showMsg(`كل سجلات الملف (${recs.length} سجلًا من ${fmtDate(from)} إلى ${fmtDate(to)}) موجودة مسبقًا - لا يوجد جديد للإضافة.`); return; }
    const ok = confirm(
      `الملف يحتوي ${teachers.length} معلمًا و${recs.length} سجلًا من ${fmtDate(from)} إلى ${fmtDate(to)}`
      + (dupInFile ? ` (احتُسب المكرر بالملف مرة واحدة: ${dupInFile})` : '') + `.\n\n`
      + `الجديد الذي سيُضاف: ${fresh.length} سجلًا\n• غياب: ${cntNew('absence')} حصة\n• إشغال: ${cntNew('cover')} حصة\n• نقل/تبديل: ${cntNew('transfer')}\n`
      + (recs.length - fresh.length ? `\n${recs.length - fresh.length} سجلًا موجود مسبقًا ولن يتكرر.\n` : '')
      + `لن يُحذف أي سجل سابق.\n\n`
      + (unmatched.length ? `${unmatched.length} اسمًا لم يُربط بحساب موظف بالمنصة، وتُحفظ بالاسم كما في الملف.\n\n` : '')
      + 'هل تريد المتابعة؟');
    if (!ok) return;
    showMsg('جارٍ حفظ السجلات...');
    const toInsert = fresh.map(r => {
      const p = matchTeacher(r.teacher_name);
      return { ...r, period: r.period || null, classes: r.classes || null, subject: r.subject || null, reason: r.reason || null, sub_type: r.sub_type || null, teacher_id: p ? p.id : null, source: 'import' };
    });
    let saved = 0;
    for (let i = 0; i < toInsert.length; i += 400) {
      const chunk = toInsert.slice(i, i + 400);
      let { error } = await writeWithSchool(extra => sb.from('teacher_absences').insert(chunk.map(r => ({ ...r, ...extra }))));
      if (error && /duplicate|unique/i.test(error.message || '')) {
        // سجل أُضيف بالتوازي من جهاز آخر: نحفظ الدفعة سجلًا سجلًا ونتجاوز الموجود
        error = null;
        for (const r of chunk) {
          const res = await writeWithSchool(extra => sb.from('teacher_absences').insert({ ...r, ...extra }));
          if (res.error && !/duplicate|unique/i.test(res.error.message || '')) { error = res.error; break; }
          if (!res.error) saved++;
        }
        if (!error) continue;
      }
      if (error) { showMsg(`تعذر حفظ بعض السجلات (${saved} من ${toInsert.length}): ${error.message}`, true); await loadRows(); render(); return; }
      saved += chunk.length;
    }
    await loadRows();
    render();
    showMsg(`✓ أُضيف ${saved} سجلًا جديدًا من الملف (${fmtDate(from)} – ${fmtDate(to)}). السجلات السابقة باقية كما هي.`);
  } catch (e) {
    showMsg('تعذر قراءة الملف: ' + (e.message || e), true);
  }
}

/* ---------- التجميع والعرض ---------- */
function filtered() {
  const q = norm(filt.q);
  return rows.filter(r => (!filt.from || r.entry_date >= filt.from) && (!filt.to || r.entry_date <= filt.to) && (!q || norm(r.teacher_name).includes(q)));
}

function summarize(list) {
  const by = new Map();
  list.forEach(r => {
    const key = r.teacher_name;
    if (!by.has(key)) by.set(key, { name: key, teacher_id: r.teacher_id, absence: [], cover: [], transfer: [] });
    by.get(key)[r.kind].push(r);
  });
  return [...by.values()].map(t => ({
    ...t,
    absDays: new Set(t.absence.map(r => r.entry_date)).size,
    absPeriods: t.absence.length,
    coverPeriods: t.cover.length,
    transfers: t.transfer.length,
  }));
}

const SORTS = {
  cover: (a, b) => b.coverPeriods - a.coverPeriods || a.name.localeCompare(b.name, 'ar'),
  absence: (a, b) => b.absPeriods - a.absPeriods || b.absDays - a.absDays || a.name.localeCompare(b.name, 'ar'),
  name: (a, b) => a.name.localeCompare(b.name, 'ar'),
};

function render() {
  const list = filtered();
  const teachers = summarize(list).sort(SORTS[filt.sort] || SORTS.cover);
  const tot = k => list.filter(r => r.kind === k).length;
  const absDaysTotal = teachers.reduce((s, t) => s + t.absDays, 0);
  $('ta-stats').innerHTML = rows.length ? `
    <div class="ta-stat"><b>${teachers.length}</b><span>معلم</span></div>
    <div class="ta-stat abs"><b>${absDaysTotal}</b><span>يوم غياب</span></div>
    <div class="ta-stat abs"><b>${tot('absence')}</b><span>حصة غياب</span></div>
    <div class="ta-stat cov"><b>${tot('cover')}</b><span>حصة إشغال</span></div>
    <div class="ta-stat"><b>${tot('transfer')}</b><span>نقل/تبديل</span></div>` : '';
  if (!rows.length) {
    $('ta-list').innerHTML = `<div class="ex-empty"><b>لا توجد سجلات بعد</b><span>صدّر «حالات الغياب والاستبدال» من برنامج الجداول وارفع الملف هنا، أو أضف الغياب والإشغال يدويًا. يمكنك رفع أكثر من ملف وفي أي وقت: يُضاف الجديد فقط دون تكرار.</span></div>`;
    return;
  }
  const th = (k, label) => `<th class="ta-sort${filt.sort === k ? ' on' : ''}" data-sort="${k}" title="ترتيب">${label}${filt.sort === k ? ' ▾' : ''}</th>`;
  $('ta-list').innerHTML = `<div class="ta-table-wrap"><table class="ta-table">
    <thead><tr><th>#</th>${th('name', 'المعلم')}<th>أيام الغياب</th>${th('absence', 'حصص الغياب')}${th('cover', 'حصص الإشغال')}<th>نقل/تبديل</th><th></th></tr></thead>
    <tbody>${teachers.map((t, i) => `
      <tr class="ta-row${openTeacher === t.name ? ' open' : ''}" data-name="${esc(t.name)}">
        <td>${i + 1}</td><td class="ta-name">${esc(t.name)}${t.teacher_id ? '' : ' <small title="غير مربوط بحساب موظف">•</small>'}</td>
        <td>${t.absDays || '—'}</td><td>${t.absPeriods || '—'}</td><td class="ta-cov">${t.coverPeriods || '—'}</td><td>${t.transfers || '—'}</td>
        <td><span class="ta-more">${openTeacher === t.name ? 'إخفاء' : 'التفاصيل'}</span></td>
      </tr>
      ${openTeacher === t.name ? `<tr class="ta-detail-row"><td colspan="7">${detailHtml(t)}</td></tr>` : ''}`).join('') || '<tr><td colspan="7" class="ta-empty">لا توجد نتائج</td></tr>'}
    </tbody></table></div>`;
  $('ta-list').querySelectorAll('.ta-sort').forEach(h => h.onclick = () => { filt.sort = h.dataset.sort; render(); });
  $('ta-list').querySelectorAll('.ta-row').forEach(tr => tr.onclick = () => { openTeacher = openTeacher === tr.dataset.name ? null : tr.dataset.name; render(); });
  $('ta-list').querySelectorAll('.ta-del').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!confirm('حذف هذا السجل؟')) return;
    const { error } = await sb.from('teacher_absences').delete().eq('id', b.dataset.id);
    if (error) { alert('تعذر الحذف: ' + error.message); return; }
    rows = rows.filter(r => r.id !== b.dataset.id);
    render();
  });
  $('ta-list').querySelectorAll('.ta-add-for').forEach(b => b.onclick = e => { e.stopPropagation(); openManualForm(b.dataset.name); });
}

function detailHtml(t) {
  const item = r => `<li><span class="ta-d">${esc(fmtDate(r.entry_date))}</span><span class="ta-p">${esc(periodText(r.period))}</span>`
    + `${r.classes ? `<span>${esc(r.classes)}</span>` : ''}${r.subject ? `<span>${esc(r.subject)}</span>` : ''}`
    + `${r.kind !== 'cover' && (r.reason || r.sub_type) ? `<span class="ta-r">${esc(r.reason || r.sub_type)}</span>` : ''}`
    + `${r.source === 'manual' ? '<i class="ta-man">يدوي</i>' : ''}${r.note ? `<span class="ta-note">${esc(r.note)}</span>` : ''}`
    + `<button type="button" class="ta-del" data-id="${r.id}" title="حذف السجل" aria-label="حذف السجل">✕</button></li>`;
  // الغياب مجمّع باليوم
  const days = new Map();
  t.absence.forEach(r => { if (!days.has(r.entry_date)) days.set(r.entry_date, []); days.get(r.entry_date).push(r); });
  const reasons = {};
  t.absence.forEach(r => { const k = r.reason || 'بدون سبب'; reasons[k] = (reasons[k] || 0) + 1; });
  return `<div class="ta-detail">
    <div class="ta-dhead"><b>${esc(t.name)}</b>
      <span>${Object.entries(reasons).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'لا يوجد غياب'}</span>
      <button type="button" class="text-action-btn ta-add-for" data-name="${esc(t.name)}">＋ إضافة لهذا المعلم</button></div>
    <div class="ta-cols">
      <section><h5>الإشغال <small>${t.cover.length} حصة</small></h5>${t.cover.length ? `<ul>${t.cover.map(item).join('')}</ul>` : '<p class="ta-none">لا يوجد</p>'}</section>
      <section><h5>الغياب <small>${t.absDays} يوم · ${t.absence.length} حصة</small></h5>${t.absence.length ? `<ul>${[...days.values()].flat().map(item).join('')}</ul>` : '<p class="ta-none">لا يوجد</p>'}</section>
      ${t.transfer.length ? `<section><h5>نقل/تبديل <small>${t.transfer.length}</small></h5><ul>${t.transfer.map(item).join('')}</ul></section>` : ''}
    </div></div>`;
}

/* ---------- إضافة يدوية ---------- */
function openManualForm(presetName = '') {
  const names = [...new Set([...staff.filter(p => p.role === 'teacher' || p.role === 'deputy' || p.role === 'admin').map(p => p.full_name), ...rows.map(r => r.teacher_name)])]
    .sort((a, b) => a.localeCompare(b, 'ar'));
  const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  back.innerHTML = `<div class="er-abs ta-form" role="dialog" aria-modal="true" aria-label="إضافة غياب أو إشغال">
    <div class="er-abs-h"><div><b>إضافة غياب أو إشغال</b><span>تُحفظ كسجلات يدوية ولا تتأثر برفع الملف</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body">
      <div class="ta-kind"><button type="button" data-k="cover" class="on">إشغال</button><button type="button" data-k="absence">غياب</button></div>
      <label>المعلم<input list="ta-names" id="ta-f-name" value="${esc(presetName)}" placeholder="اكتب اسم المعلم أو اختره" autocomplete="off" /></label>
      <datalist id="ta-names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label>التاريخ<input type="date" id="ta-f-date" value="${iso}" /></label>
      <div class="ta-f-periods"><span>الحصص</span>${PERIODS.map(p => `<label><input type="checkbox" value="${p}" /> ${p}</label>`).join('')}</div>
      <label class="ta-f-reason hidden">سبب الغياب<select id="ta-f-reason">${ABSENCE_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <div class="ta-f-row"><label>الفصل<input id="ta-f-class" placeholder="مثال: أول-2" /></label><label>المادة<input id="ta-f-subject" /></label></div>
      <label>ملاحظة<input id="ta-f-note" /></label>
      <div class="error-msg" id="ta-f-err"></div>
    </div>
    <div class="er-man-foot"><button type="button" class="btn-primary" id="ta-f-save">حفظ</button></div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('.er-abs-x').onclick = close;
  let kind = 'cover';
  back.querySelectorAll('.ta-kind button').forEach(b => b.onclick = () => {
    kind = b.dataset.k;
    back.querySelectorAll('.ta-kind button').forEach(x => x.classList.toggle('on', x === b));
    back.querySelector('.ta-f-reason').classList.toggle('hidden', kind !== 'absence');
  });
  $('ta-f-save').onclick = async () => {
    const err = $('ta-f-err');
    const name = $('ta-f-name').value.trim();
    const date = $('ta-f-date').value;
    const periods = [...back.querySelectorAll('.ta-f-periods input:checked')].map(i => i.value);
    if (!name) { err.textContent = 'اكتب اسم المعلم'; err.style.display = 'block'; return; }
    if (!date) { err.textContent = 'اختر التاريخ'; err.style.display = 'block'; return; }
    if (!periods.length) { err.textContent = 'اختر حصة واحدة على الأقل'; err.style.display = 'block'; return; }
    const p = staff.find(s => s.full_name === name) || matchTeacher(name);
    const reason = kind === 'cover' ? COVER_REASON : $('ta-f-reason').value;
    const recs = periods.map(per => ({
      teacher_name: name, teacher_id: p ? p.id : null, entry_date: date, period: per,
      classes: $('ta-f-class').value.trim() || null, subject: $('ta-f-subject').value.trim() || null,
      reason, sub_type: null, kind, source: 'manual', note: $('ta-f-note').value.trim() || null,
    }));
    const { error } = await writeWithSchool(extra => sb.from('teacher_absences').insert(recs.map(r => ({ ...r, ...extra }))));
    if (error) { err.textContent = /duplicate|unique/i.test(error.message) ? 'يوجد سجل مطابق لنفس المعلم والتاريخ والحصة' : 'تعذر الحفظ: ' + error.message; err.style.display = 'block'; return; }
    close();
    await loadRows();
    openTeacher = name;
    render();
    showMsg(`✓ أُضيف ${KIND_LABEL[kind]} ${periods.length === 1 ? 'حصة واحدة' : periods.length + ' حصص'} لـ ${name}`);
  };
}

/* ---------- طباعة وتصدير ---------- */
function periodLabel() {
  return filt.from || filt.to ? `الفترة: ${filt.from ? fmtDate(filt.from) : 'البداية'} – ${filt.to ? fmtDate(filt.to) : 'الآن'}` : 'كل الفترات المسجلة';
}

function printReport() {
  const teachers = summarize(filtered()).sort(SORTS[filt.sort] || SORTS.cover);
  const one = openTeacher ? teachers.find(t => t.name === openTeacher) : null;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة لطباعة التقرير'); return; }
  const logo = printLogo();
  const list = one ? [one] : teachers;
  const detail = t => `<h3>${esc(t.name)}</h3>
    <p class="sub">أيام الغياب: ${t.absDays} · حصص الغياب: ${t.absPeriods} · حصص الإشغال: ${t.coverPeriods}</p>
    ${t.cover.length ? `<table><thead><tr><th>#</th><th>التاريخ</th><th>الحصة</th><th>الفصل</th><th>المادة</th></tr></thead><tbody>${t.cover.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.entry_date)}</td><td>${esc(r.period || '')}</td><td>${esc(r.classes || '')}</td><td>${esc(r.subject || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${t.absence.length ? `<h4>الغياب</h4><table><thead><tr><th>#</th><th>التاريخ</th><th>الحصة</th><th>الفصل</th><th>السبب</th></tr></thead><tbody>${t.absence.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.entry_date)}</td><td>${esc(r.period || '')}</td><td>${esc(r.classes || '')}</td><td>${esc(r.reason || '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>غياب وإشغال المعلمين</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#152238}.hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #152238;padding-bottom:10px;margin-bottom:14px}
    .hd img{height:54px}h1{font-size:19px;margin:0}h3{margin:18px 0 4px;font-size:15px}h4{margin:10px 0 4px;font-size:13px}.sub{color:#555;font-size:12px;margin:0 0 6px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}th,td{border:1px solid #bbb;padding:5px 6px;text-align:center}th{background:#152238;color:#fff}
    tr:nth-child(even) td{background:#f5f6f8}@media print{h3{break-after:avoid}table{break-inside:auto}}</style></head><body>
    <div class="hd">${logo ? `<img src="${esc(logo)}">` : ''}<div><h1>${one ? 'تقرير غياب وإشغال المعلم' : 'تقرير غياب وإشغال المعلمين'}</h1><div class="sub">${esc(printOrgName())} · ${esc(periodLabel())}</div></div></div>
    ${one ? detail(one) : `<table><thead><tr><th>#</th><th>المعلم</th><th>أيام الغياب</th><th>حصص الغياب</th><th>حصص الإشغال</th><th>نقل/تبديل</th></tr></thead><tbody>
      ${list.map((t, i) => `<tr><td>${i + 1}</td><td style="text-align:right">${esc(t.name)}</td><td>${t.absDays}</td><td>${t.absPeriods}</td><td>${t.coverPeriods}</td><td>${t.transfers}</td></tr>`).join('')}</tbody></table>`}
    <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

async function exportExcel() {
  await loadXLSX();
  const list = filtered();
  const teachers = summarize(list).sort(SORTS.name);
  const wb = XLSX.utils.book_new();
  const sum = teachers.map((t, i) => ({ '#': i + 1, 'المعلم': t.name, 'أيام الغياب': t.absDays, 'حصص الغياب': t.absPeriods, 'حصص الإشغال': t.coverPeriods, 'نقل/تبديل': t.transfers }));
  const ws1 = XLSX.utils.json_to_sheet(sum); ws1['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, ws1, 'الملخص');
  const det = list.slice().sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, 'ar') || a.entry_date.localeCompare(b.entry_date))
    .map(r => ({ 'المعلم': r.teacher_name, 'النوع': KIND_LABEL[r.kind], 'التاريخ': r.entry_date, 'الحصة': r.period || '', 'الفصل': r.classes || '', 'المادة': r.subject || '', 'السبب': r.kind === 'cover' ? '' : (r.reason || r.sub_type || ''), 'المصدر': r.source === 'manual' ? 'يدوي' : 'الملف', 'ملاحظة': r.note || '' }));
  const ws2 = XLSX.utils.json_to_sheet(det); ws2['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, ws2, 'التفاصيل');
  XLSX.writeFile(wb, `غياب وإشغال المعلمين ${new Date().toISOString().slice(0, 10)}.xlsx`);
}
