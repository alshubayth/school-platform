import { sb, currentSchoolId, readScopedBySchool, writeWithSchool, printOrgName, printLogo } from './core.js';
import { loadXLSX } from './lib-loader.js';

/* =========================================================================
 * غياب وإشغال المعلمين
 * - رفع ملف «تصدير حالات الغياب والاستبدال» (ورقة لكل معلم) - يمكن رفع أكثر من ملف: يُضاف الجديد فقط
 *   ولا يُحذف أي سجل سابق.
 * - الملف يكرر بعض الصفوف (مرة تحت «ديسمبر» ومرة تحت شهرها): الصف المتطابق بكل بياناته يُحسب مرة واحدة.
 * - التصنيف (من بنية الملف): عمود «سبب الغياب» معبأ = غياب المعلم نفسه (ومنه «سبب غير معروف» = غياب بدون سبب)،
 *   وعمود «نوع الاستبدال» معبأ بلا سبب («نوع غير معروف»...) = إشغال: المعلم أخذ الحصة بدل معلم غائب،
 *   و«نقل» أو «تبديل» = نقل/تبديل لا يُحسب غيابًا ولا إشغالًا.
 * - عند رفع ملف جديد يُضاف فقط ما بعد آخر تاريخ تم استيراده، فلا يعود ما حذفه المستخدم سابقًا.
 * - إضافة يدوية للغياب والإشغال، ولوحة: مؤشرات + الأعلى إشغالًا/غيابًا + قائمة المعلمين وتفاصيل كل معلم.
 * ========================================================================= */

const COVER_TYPE = 'إشغال';                 // نوع الاستبدال للإشغال اليدوي
const UNKNOWN_REASON = 'سبب غير معروف';
const TRANSFER_TYPES = new Set(['نقل', 'تبديل']);
const KIND_LABEL = { absence: 'غياب', cover: 'إشغال', transfer: 'نقل/تبديل' };
const ABSENCE_REASONS = ['مرضية', 'مولود', 'ورشة عمل', 'اجتماع', 'رحلة مدرسية', 'تصحيح الاختبار', 'اضطرارية', 'أخرى'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const RANGES = [['all', 'كل الفترات'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['30', 'آخر 30 يومًا'], ['custom', 'فترة مخصصة']];
const AV_COLORS = [['#EAF1FC', '#2455A4'], ['#EFEBFB', '#6249A6'], ['#E3F4F7', '#0E93A8'], ['#FDEFE3', '#B65A1B'], ['#E7F5EC', '#2E7A4C'], ['#FBEAE9', '#A63A33']];

let rows = [];          // كل السجلات
let staff = [];         // موظفو المدرسة (لربط الأسماء)
let loads = { byId: new Map(), byName: [] };   // نصاب كل معلم الأسبوعي من الجدول المدرسي
let selected = null;    // المعلم المعروضة تفاصيله
let detailTab = 'cover';
let selMode = false;            // وضع تحديد عدة حصص للحذف
const picked = new Set();
const filt = { range: 'all', from: '', to: '', q: '', sort: 'cover' };

const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const clean = v => { const s = String(v == null ? '' : v).trim(); return !s || /^\{.*\}$/.test(s) ? '' : s; };
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateTxt = (iso, opts) => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', opts); } catch { return iso; } };
const fmtDate = iso => dateTxt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = iso => dateTxt(iso, { day: 'numeric', month: 'long', year: 'numeric' });
const periodText = p => { const m = String(p || '').match(/^(\d+)\s*->\s*(\d+)$/); return m ? `من الحصة ${m[1]} إلى ${m[2]}` : p ? `الحصة ${p}` : 'حصة غير محددة'; };
const periodBadge = p => { const m = String(p || '').match(/^(\d+)\s*->\s*(\d+)$/); return m ? `${m[1]}←${m[2]}` : (p || '—'); };
const kindOf = (reason, subType) => (reason && reason !== 'تبديل' ? 'absence'
  : TRANSFER_TYPES.has(subType) || reason === 'تبديل' ? 'transfer' : subType ? 'cover' : 'absence');
const reasonText = r => r.reason || r.sub_type || '';   // الغياب بلا سبب يبقى «سبب غير معروف»
const lastImportDate = () => rows.reduce((m, r) => (r.source === 'import' && r.entry_date > m ? r.entry_date : m), '');
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const initials = name => { const w = String(name || '').split(/\s+/).filter(x => x && x !== 'بن'); return (w[0] ? w[0][0] : '') + (w.length > 1 ? w[w.length - 1][0] : ''); };
const avColor = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; };
const avatar = (name, cls = '') => { const [bg, fg] = avColor(name); return `<span class="tx-av ${cls}" style="background:${bg}; color:${fg};" aria-hidden="true">${esc(initials(name))}</span>`; };

const IC = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  excel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13l4 5M13 13l-4 5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 3.9 1.6 4.5 4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9.5 14.5 5 4M14.5 14.5l-5 4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>',
  cover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m9 10 2 2 4-4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3-3 3 3"/></svg>',
};

export async function loadTeacherAbsenceModule() {
  const box = $('ta-container');
  if (!box.dataset.ready) { box.innerHTML = shellHtml(); wireShell(); box.dataset.ready = '1'; }
  $('tx-board').innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  await Promise.all([loadStaff(), loadRows(), loadLoads()]);
  render();
}

function shellHtml() {
  return `
  <div class="tx-page" id="tx-page">
    <div class="tx-cmd">
      <div class="tx-ranges" role="tablist" aria-label="الفترة">
        ${RANGES.map(([k, l]) => `<button type="button" role="tab" data-range="${k}" class="${filt.range === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="tx-custom hidden" id="tx-custom">
        <label>من <input type="date" id="tx-from" /></label>
        <label>إلى <input type="date" id="tx-to" /></label>
      </div>
      <div class="tx-cmd-actions">
        <button type="button" class="tx-btn ghost" id="tx-add-btn">${IC.plus}<span>إضافة يدوية</span></button>
        <button type="button" class="tx-btn primary" id="tx-upload-btn">${IC.upload}<span>رفع ملف الغياب</span></button>
        <div class="tx-menu-wrap">
          <button type="button" class="tx-btn icon" id="tx-menu-btn" aria-haspopup="true" aria-expanded="false" aria-label="خيارات أخرى">${IC.more}</button>
          <div class="tx-menu hidden" id="tx-menu" role="menu">
            <button type="button" role="menuitem" id="tx-print">${IC.print}<span>طباعة الملخص</span></button>
            <button type="button" role="menuitem" id="tx-export">${IC.excel}<span>تصدير Excel</span></button>
          </div>
        </div>
        <input type="file" id="tx-file" accept=".xlsx,.xls" class="hidden" />
      </div>
    </div>
    <div id="tx-toast" class="tx-toast hidden" role="status"></div>
    <div id="tx-board"></div>
    <div class="tx-drop hidden" id="tx-drop"><div>${IC.file}<b>أفلت ملف «حالات الغياب والاستبدال» هنا</b><span>يُضاف الجديد فقط دون تكرار</span></div></div>
  </div>`;
}

function wireShell() {
  document.querySelectorAll('.tx-ranges button').forEach(b => b.onclick = () => {
    filt.range = b.dataset.range;
    document.querySelectorAll('.tx-ranges button').forEach(x => x.classList.toggle('on', x === b));
    $('tx-custom').classList.toggle('hidden', filt.range !== 'custom');
    render();
  });
  $('tx-from').onchange = e => { filt.from = e.target.value; render(); };
  $('tx-to').onchange = e => { filt.to = e.target.value; render(); };
  $('tx-upload-btn').onclick = () => $('tx-file').click();
  $('tx-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleFile(f); };
  $('tx-add-btn').onclick = () => openManualForm(selected || '');
  const menu = $('tx-menu'), mb = $('tx-menu-btn');
  mb.onclick = e => { e.stopPropagation(); const open = menu.classList.toggle('hidden') === false; mb.setAttribute('aria-expanded', open); };
  document.addEventListener('click', () => { menu.classList.add('hidden'); mb.setAttribute('aria-expanded', 'false'); });
  $('tx-print').onclick = () => printReport(false);
  $('tx-export').onclick = () => exportExcel();
  // سحب الملف وإفلاته على القسم
  const page = $('tx-page'), drop = $('tx-drop');
  let depth = 0;
  page.addEventListener('dragenter', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { depth++; drop.classList.remove('hidden'); } });
  page.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.add('hidden'); });
  page.addEventListener('dragover', e => e.preventDefault());
  page.addEventListener('drop', e => { e.preventDefault(); depth = 0; drop.classList.add('hidden'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
}

async function loadStaff() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher']);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  staff = (data || []).filter(p => p.full_name);
}

// النصاب = عدد حصص المعلم في الأسبوع من الجدول المدرسي (class_schedules)
async function loadLoads() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('class_schedules').select('teacher_id, teacher_name, day_of_week, period_number').range(from, from + 999);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) break;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const byId = new Map(), byNm = new Map();
  all.forEach(r => {
    const slot = `${r.day_of_week}|${r.period_number}`;
    if (r.teacher_id) { if (!byId.has(r.teacher_id)) byId.set(r.teacher_id, new Set()); byId.get(r.teacher_id).add(slot); }
    if (r.teacher_name) { if (!byNm.has(r.teacher_name)) byNm.set(r.teacher_name, new Set()); byNm.get(r.teacher_name).add(slot); }
  });
  loads = { byId, byName: [...byNm.entries()].map(([n, set]) => ({ tokens: norm(n).split(' ').filter(w => w && w !== 'بن'), n: set.size })) };
}
function loadOf(t) {
  if (t.teacher_id && loads.byId.has(t.teacher_id)) return loads.byId.get(t.teacher_id).size;
  const tk = norm(t.name).split(' ').filter(w => w && w !== 'بن');
  if (!tk.length) return null;
  const hits = loads.byName.filter(x => x.tokens[0] === tk[0] && tk.every(w => x.tokens.includes(w)));
  return hits.length === 1 ? hits[0].n : null;
}
// الفاقد = حصص الغياب − حصص الإشغال (موجب: عليه حصص، سالب: له حصص زائدة)
const lossTxt = n => (n > 0 ? String(n) : n < 0 ? `−${Math.abs(n)}` : '0');
const lossCls = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');

async function loadRows() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('teacher_absences').select('*').order('entry_date', { ascending: true }).range(from, from + 999);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) { toast('تعذر تحميل السجلات: ' + error.message, 'err'); break; }
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  rows = all;
}

let toastTimer = null;
function toast(text, type = 'ok', sticky = false) {
  const el = $('tx-toast');
  clearTimeout(toastTimer);
  el.className = 'tx-toast ' + type;
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  if (text && !sticky && type !== 'err') toastTimer = setTimeout(() => el.classList.add('hidden'), 6000);
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
  if (v instanceof Date && !isNaN(v)) return isoOf(v);
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

const sigOf = r => [r.teacher_name, r.entry_date, r.period || '', r.classes || '', r.subject || '', r.reason || '', r.sub_type || ''].join('|');

async function handleFile(file) {
  if (!/\.xlsx?$/i.test(file.name)) { toast('الملف يجب أن يكون بصيغة Excel ‏(.xlsx)', 'err'); return; }
  toast('جارٍ قراءة الملف...', 'info', true);
  try {
    await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const { recs, dupInFile } = parseWorkbook(wb);
    toast('');
    if (!recs.length) { toast('لم يُعثر في الملف على سجلات غياب أو استبدال. تأكد أن الملف هو «تصدير حالات الغياب والاستبدال».', 'err'); return; }
    // الدمج: يُضاف ما بعد آخر تاريخ مستورد فقط (حتى لا يعود ما حُذف سابقًا)، ولا يُحذف أي سجل
    const existing = new Set(rows.map(sigOf));
    const newOnly = recs.filter(r => !existing.has(sigOf(r)));
    openImportPreview(file.name, recs, newOnly, dupInFile, lastImportDate());
  } catch (e) {
    toast('تعذر قراءة الملف: ' + (e.message || e), 'err');
  }
}

function openImportPreview(fileName, recs, newOnly, dupInFile, last) {
  const after = newOnly.filter(r => !last || r.entry_date > last);
  const older = newOnly.length - after.length;   // قبل آخر تحديث وغير موجودة حاليًا (قد تكون محذوفة عمدًا)
  let withOld = false;
  const fresh = () => (withOld ? newOnly : after);
  const dates = recs.map(r => r.entry_date).sort();
  const from = dates[0], to = dates[dates.length - 1];
  const teachers = [...new Set(recs.map(r => r.teacher_name))];
  const unmatched = teachers.filter(t => !matchTeacher(t));
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  const html = () => {
    const f = fresh();
    const cnt = k => f.filter(r => r.kind === k).length;
    return `<div class="er-abs tx-modal" role="dialog" aria-modal="true" aria-label="استيراد ملف الغياب">
    <div class="er-abs-h"><div><b>استيراد ملف الغياب والاستبدال</b><span>${esc(fileName)}</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body">
      <div class="tx-imp-range">${IC.cal}<span>${teachers.length} معلمًا · من ${esc(fmtLong(from))} إلى ${esc(fmtLong(to))}</span></div>
      ${last ? `<div class="tx-imp-last">آخر تحديث سابق حتى <b>${esc(fmtLong(last))}</b>، ويُضاف من الملف ما بعده فقط.</div>` : ''}
      ${f.length ? `
      <div class="tx-imp-big"><b>${f.length}</b><span>${f.length === 1 ? 'سجل جديد سيُضاف' : 'سجلًا جديدًا سيُضاف'}</span></div>
      <div class="tx-imp-tiles">
        <div class="cov"><b>${cnt('cover')}</b><span>حصة إشغال</span></div>
        <div class="abs"><b>${cnt('absence')}</b><span>حصة غياب</span></div>
        <div><b>${cnt('transfer')}</b><span>نقل/تبديل</span></div>
      </div>` : `<div class="tx-imp-none">${last && to <= last ? 'تاريخ الملف لا يتجاوز آخر تحديث، فلا يوجد جديد للإضافة.' : 'كل سجلات الملف موجودة مسبقًا، فلا يوجد جديد للإضافة.'}</div>`}
      <ul class="tx-imp-notes">
        ${recs.length - newOnly.length ? `<li>${recs.length - newOnly.length} سجلًا موجود مسبقًا ولن يتكرر.</li>` : ''}
        ${older ? `<li>${older} سجلًا تاريخه قبل آخر تحديث وغير موجود حاليًا (ربما حُذف)، ${withOld ? 'وسيُضاف' : 'ولن يُضاف'}.
          <label class="tx-imp-old"><input type="checkbox" id="tx-imp-old" ${withOld ? 'checked' : ''}/> إضافتها أيضًا (مثل رفع ملف لفترة سابقة)</label></li>` : ''}
        ${dupInFile ? `<li>${dupInFile} صفًا مكررًا داخل الملف احتُسب مرة واحدة.</li>` : ''}
        <li>لن يُحذف أي سجل سابق.</li>
        ${unmatched.length ? `<li>${unmatched.length} ${unmatched.length === 1 ? 'اسم لم يُربط' : 'اسمًا لم تُربط'} بحساب موظف بالمنصة، وتُحفظ بالاسم كما في الملف. <details><summary>عرض الأسماء</summary><span>${unmatched.map(esc).join('، ')}</span></details></li>` : ''}
      </ul>
    </div>
    <div class="er-man-foot tx-modal-foot">
      <button type="button" class="tx-btn ghost" data-act="cancel">إلغاء</button>
      ${f.length ? `<button type="button" class="tx-btn primary" data-act="ok">إضافة ${f.length} سجلًا</button>` : ''}
    </div>
  </div>`;
  };
  const close = () => back.remove();
  const paint = () => {
    back.innerHTML = html();
    back.querySelector('.er-abs-x').onclick = close;
    back.querySelector('[data-act="cancel"]').onclick = close;
    const old = back.querySelector('#tx-imp-old');
    if (old) old.onchange = () => { withOld = old.checked; paint(); };
    const okBtn = back.querySelector('[data-act="ok"]');
    if (okBtn) okBtn.onclick = async () => {
      okBtn.disabled = true; okBtn.textContent = 'جارٍ الحفظ...';
      const saved = await saveImported(fresh());
      close();
      if (saved != null) toast(`✓ أُضيف ${saved} سجلًا جديدًا من الملف، والسجلات السابقة باقية كما هي.`);
    };
  };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  document.body.appendChild(back);
  paint();
}

async function saveImported(fresh) {
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
    if (error) { toast(`تعذر حفظ بعض السجلات (${saved} من ${toInsert.length}): ${error.message}`, 'err'); await loadRows(); render(); return null; }
    saved += chunk.length;
  }
  await loadRows();
  render();
  return saved;
}

/* ---------- التجميع ---------- */
function rangeBounds() {
  const now = new Date();
  if (filt.range === 'week') { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); return [isoOf(s), isoOf(now)]; }
  if (filt.range === 'month') return [isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), isoOf(now)];
  if (filt.range === '30') { const s = new Date(now); s.setDate(now.getDate() - 29); return [isoOf(s), isoOf(now)]; }
  if (filt.range === 'custom') return [filt.from || '', filt.to || ''];
  return ['', ''];
}
function inRange() {
  const [from, to] = rangeBounds();
  return rows.filter(r => (!from || r.entry_date >= from) && (!to || r.entry_date <= to));
}

function summarize(list) {
  const by = new Map();
  list.forEach(r => {
    if (!by.has(r.teacher_name)) by.set(r.teacher_name, { name: r.teacher_name, teacher_id: r.teacher_id, absence: [], cover: [], transfer: [] });
    const t = by.get(r.teacher_name);
    t[r.kind].push(r);
    if (r.teacher_id) t.teacher_id = r.teacher_id;
  });
  return [...by.values()].map(t => ({
    ...t,
    absDays: new Set(t.absence.map(r => r.entry_date)).size,
    absPeriods: t.absence.length,
    coverPeriods: t.cover.length,
    transfers: t.transfer.length,
    loss: t.absence.length - t.cover.length,
    load: loadOf(t),
  }));
}

const SORTS = {
  cover: (a, b) => b.coverPeriods - a.coverPeriods || b.absPeriods - a.absPeriods || a.name.localeCompare(b.name, 'ar'),
  absence: (a, b) => b.absPeriods - a.absPeriods || b.absDays - a.absDays || a.name.localeCompare(b.name, 'ar'),
  loss: (a, b) => b.loss - a.loss || b.absPeriods - a.absPeriods || a.name.localeCompare(b.name, 'ar'),
  name: (a, b) => a.name.localeCompare(b.name, 'ar'),
};

/* ---------- العرض ---------- */
function render() {
  const board = $('tx-board');
  if (!board) return;
  if (!rows.length) { board.innerHTML = emptyHtml(); wireEmpty(); return; }
  const list = inRange();
  const all = summarize(list);
  const tot = k => list.filter(r => r.kind === k).length;
  const absDays = all.reduce((s, t) => s + t.absDays, 0);
  const coverTeachers = all.filter(t => t.coverPeriods).length;
  const avg = coverTeachers ? (tot('cover') / coverTeachers) : 0;
  const reasons = {};
  list.filter(r => r.kind === 'absence').forEach(r => { const k = reasonText(r) || 'بدون سبب'; reasons[k] = (reasons[k] || 0) + 1; });
  const [from, to] = rangeBounds();
  const rangeNote = from || to ? `${from ? fmtLong(from) : 'البداية'} – ${to ? fmtLong(to) : 'اليوم'}` : 'كل السجلات المحفوظة';

  board.innerHTML = `
    <div class="tx-kpis">
      ${kpi('cover', IC.cover, tot('cover'), 'حصة إشغال', coverTeachers ? `على ${plural(coverTeachers, 'معلم واحد', 'معلمين', 'معلمين', 'معلمًا')} · بمتوسط ${avg.toFixed(1)}` : 'لا يوجد إشغال')}
      ${kpi('abs', IC.cal, absDays, 'يوم غياب', `${tot('absence')} حصة غياب`)}
      ${kpi('', IC.users, all.length, 'معلمًا لهم سجلات', rangeNote)}
      ${kpi('muted', IC.swap, tot('transfer'), 'نقل وتبديل', 'لا تُحسب غيابًا ولا إشغالًا')}
    </div>
    ${list.length ? `
    <div class="tx-insights">
      ${rankCard('الأعلى إشغالًا', 'cov', all.filter(t => t.coverPeriods).sort(SORTS.cover).slice(0, 5).map(t => [t.name, t.coverPeriods, 'حصة']))}
      ${rankCard('الأعلى غيابًا', 'abs', all.filter(t => t.absPeriods).sort(SORTS.absence).slice(0, 5).map(t => [t.name, t.absPeriods, `حصة · ${t.absDays} ${t.absDays === 1 ? 'يوم' : 'أيام'}`]))}
      ${rankCard('أسباب الغياب', 'rsn', Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, v, 'حصة']), false)}
    </div>` : ''}
    <div class="tx-main">
      <section class="tx-panel tx-teachers" aria-label="المعلمون">
        <div class="tx-panel-h">
          <h4>المعلمون <small id="tx-tcount"></small></h4>
          <div class="tx-sortseg" role="tablist" aria-label="الترتيب">
            ${[['cover', 'الإشغال'], ['absence', 'الغياب'], ['loss', 'الفاقد'], ['name', 'الاسم']].map(([k, l]) => `<button type="button" data-sort="${k}" class="${filt.sort === k ? 'on' : ''}">${l}</button>`).join('')}
          </div>
        </div>
        <label class="tx-search">${IC.search}<input type="search" id="tx-q" placeholder="ابحث باسم المعلم" value="${esc(filt.q)}" autocomplete="off" /></label>
        <div class="tx-legend"><i class="cov"></i>إشغال <i class="abs"></i>غياب <i class="loss"></i>الفاقد = الغياب − الإشغال</div>
        <div class="tx-tlist" id="tx-tlist"></div>
      </section>
      <section class="tx-panel tx-detail" id="tx-detail" aria-live="polite"></section>
    </div>`;

  board.querySelectorAll('.tx-sortseg button').forEach(b => b.onclick = () => { filt.sort = b.dataset.sort; board.querySelectorAll('.tx-sortseg button').forEach(x => x.classList.toggle('on', x === b)); renderTeachers(all); });
  const q = $('tx-q');
  q.oninput = () => { filt.q = q.value; renderTeachers(all); };
  board.querySelectorAll('.tx-rank li[data-name]').forEach(li => li.onclick = () => selectTeacher(li.dataset.name, all, li.closest('.tx-rank').dataset.kind === 'abs' ? 'absence' : 'cover'));
  if (selected && !all.some(t => t.name === selected)) selected = null;
  renderTeachers(all);
  renderDetail(all);
}

function kpi(tone, icon, value, label, sub) {
  return `<div class="tx-kpi ${tone}"><span class="tx-kpi-ic">${icon}</span><div><b>${value}</b><span class="tx-kpi-l">${label}</span><span class="tx-kpi-s">${esc(sub)}</span></div></div>`;
}

function rankCard(title, kind, items, clickable = true) {
  const max = Math.max(1, ...items.map(i => i[1]));
  return `<div class="tx-panel tx-rank" data-kind="${kind}">
    <h5>${title}</h5>
    ${items.length ? `<ol>${items.map(([name, n, unit]) => `<li${clickable ? ` data-name="${esc(name)}" tabindex="0"` : ''}>
      <span class="tx-rank-n">${esc(name)}</span><span class="tx-rank-v"><b>${n}</b> ${esc(unit)}</span>
      <span class="tx-rank-bar"><i style="width:${Math.round((n / max) * 100)}%"></i></span></li>`).join('')}</ol>`
      : '<p class="tx-none">لا يوجد في هذه الفترة</p>'}
  </div>`;
}

function renderTeachers(all) {
  const box = $('tx-tlist');
  if (!box) return;
  const q = norm(filt.q);
  const list = all.filter(t => !q || norm(t.name).includes(q)).sort(SORTS[filt.sort] || SORTS.cover);
  $('tx-tcount').textContent = list.length;
  const max = Math.max(1, ...all.map(t => t.coverPeriods + t.absPeriods));
  box.innerHTML = list.map(t => `
    <button type="button" class="tx-trow${selected === t.name ? ' on' : ''}" data-name="${esc(t.name)}">
      ${avatar(t.name)}
      <span class="tx-tmain"><span class="tx-tname"><b>${esc(t.name)}</b>${t.load != null ? `<span class="tx-load" title="النصاب الأسبوعي من الجدول المدرسي">النصاب ${t.load}</span>` : ''}</span>
        <span class="tx-tbar" aria-hidden="true"><i class="cov" style="width:${(t.coverPeriods / max) * 100}%"></i><i class="abs" style="width:${(t.absPeriods / max) * 100}%"></i></span>
      </span>
      <span class="tx-tnums"><span class="cov" title="حصص الإشغال">${t.coverPeriods}</span><span class="abs" title="حصص الغياب">${t.absPeriods}</span><span class="loss ${lossCls(t.loss)}" title="الفاقد: الغياب − الإشغال">${lossTxt(t.loss)}</span></span>
    </button>`).join('') || '<p class="tx-none">لا يوجد معلم مطابق</p>';
  box.querySelectorAll('.tx-trow').forEach(b => b.onclick = () => selectTeacher(b.dataset.name, all));
}

function selectTeacher(name, all, tab = null) {
  const t = all.find(x => x.name === name);
  if (selected !== name || tab) { selMode = false; picked.clear(); }
  selected = name;
  detailTab = tab || (t && !t.coverPeriods && t.absPeriods ? 'absence' : detailTab === 'transfer' && t && !t.transfers ? 'cover' : detailTab);
  document.querySelectorAll('.tx-trow').forEach(b => b.classList.toggle('on', b.dataset.name === name));
  renderDetail(all);
  if (window.matchMedia('(max-width: 900px)').matches) $('tx-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDetail(all) {
  const box = $('tx-detail');
  if (!box) return;
  const t = selected ? all.find(x => x.name === selected) : null;
  if (!t) {
    box.innerHTML = `<div class="tx-detail-empty">${IC.users}<b>اختر معلمًا</b><span>اختر معلمًا من القائمة لعرض حصص إشغاله وأيام غيابه بالتفصيل.</span></div>`;
    return;
  }
  const tabs = [['cover', 'الإشغال', t.coverPeriods], ['absence', 'الغياب', t.absPeriods], ...(t.transfers ? [['transfer', 'نقل/تبديل', t.transfers]] : [])];
  if (!tabs.some(x => x[0] === detailTab)) detailTab = 'cover';
  const items = t[detailTab];
  const reasons = {};
  if (detailTab === 'absence') t.absence.forEach(r => { const k = reasonText(r) || 'بدون سبب'; reasons[k] = (reasons[k] || 0) + 1; });
  const byDay = new Map();
  items.slice().sort((a, b) => b.entry_date.localeCompare(a.entry_date) || String(a.period).localeCompare(String(b.period), 'en', { numeric: true }))
    .forEach(r => { if (!byDay.has(r.entry_date)) byDay.set(r.entry_date, []); byDay.get(r.entry_date).push(r); });
  box.innerHTML = `
    <div class="tx-dhead">
      ${avatar(t.name, 'lg')}
      <div class="tx-dname"><b>${esc(t.name)}</b><span class="${t.teacher_id ? 'ok' : 'warn'}">${t.teacher_id ? 'مربوط بحساب موظف' : 'غير مربوط بحساب موظف'}</span></div>
      <div class="tx-dact">
        <button type="button" class="tx-btn ghost sm" id="tx-d-print">${IC.print}<span>تقرير المعلم</span></button>
        <button type="button" class="tx-btn ghost sm" id="tx-d-add">${IC.plus}<span>إضافة</span></button>
      </div>
    </div>
    <div class="tx-dkpis">
      <div class="loss ${lossCls(t.loss)}"><b>${lossTxt(t.loss)}</b><span>الفاقد</span><small>${t.loss > 0 ? 'غيابه أكثر من إشغاله' : t.loss < 0 ? 'إشغاله أكثر من غيابه' : 'متوازن'}</small></div>
      <div class="load"><b>${t.load != null ? t.load : '—'}</b><span>النصاب الأسبوعي</span>${t.load == null ? '<small>غير موجود في الجدول</small>' : ''}</div>
      <div class="cov"><b>${t.coverPeriods}</b><span>حصة إشغال</span></div>
      <div class="abs"><b>${t.absDays}</b><span>${t.absDays === 1 ? 'يوم غياب' : 'أيام غياب'}</span></div>
      <div class="abs"><b>${t.absPeriods}</b><span>حصة غياب</span></div>
      <div><b>${t.transfers}</b><span>نقل/تبديل</span></div>
    </div>
    <div class="tx-dtabs-row">
      <div class="tx-dtabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" data-tab="${k}" class="${detailTab === k ? 'on' : ''}">${l} <i>${n}</i></button>`).join('')}</div>
      ${items.length ? `<button type="button" class="tx-btn ghost sm tx-selbtn${selMode ? ' on' : ''}" id="tx-selmode">${selMode ? 'إنهاء التحديد' : 'تحديد للحذف'}</button>` : ''}
    </div>
    ${selMode ? `<div class="tx-selbar"><span>محدد: <b id="tx-selcount">${picked.size}</b> من ${items.length}</span>
      <button type="button" class="tx-link" id="tx-selall">تحديد الكل</button>
      <button type="button" class="tx-btn danger sm" id="tx-seldel" ${picked.size ? '' : 'disabled'}>${IC.trash}<span>حذف المحدد</span></button></div>` : ''}
    ${detailTab === 'absence' && Object.keys(reasons).length ? `<div class="tx-reasons">${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k)} <b>${v}</b></span>`).join('')}</div>` : ''}
    <div class="tx-timeline${selMode ? ' sel' : ''}">
      ${byDay.size ? [...byDay.entries()].map(([d, rs]) => `
        <div class="tx-day">
          <div class="tx-day-h">${selMode ? `<input type="checkbox" class="tx-dchk" data-day="${d}" aria-label="تحديد حصص اليوم" ${rs.every(r => picked.has(r.id)) ? 'checked' : ''}/>` : ''}<b>${esc(dateTxt(d, { weekday: 'long' }))}</b><span>${esc(dateTxt(d, { day: 'numeric', month: 'long' }))}</span><small>${plural(rs.length, 'حصة واحدة', 'حصتان', 'حصص', 'حصة')}</small>
            ${selMode ? '' : `<button type="button" class="tx-dday" data-day="${d}" title="حذف حصص هذا اليوم" aria-label="حذف حصص هذا اليوم">${IC.trash}</button>`}</div>
          <ul>${rs.map(r => `<li data-id="${r.id}" class="${picked.has(r.id) ? 'picked' : ''}">
            ${selMode ? `<input type="checkbox" class="tx-rchk" data-id="${r.id}" aria-label="تحديد الحصة" ${picked.has(r.id) ? 'checked' : ''}/>` : ''}
            <span class="tx-pbadge ${r.kind}" title="${esc(periodText(r.period))}">${esc(periodBadge(r.period))}</span>
            <span class="tx-li-main"><span>${esc(periodText(r.period))}</span><span class="tx-li-meta">${[r.classes, r.subject].filter(Boolean).map(esc).join(' · ') || 'بدون فصل أو مادة'}</span>
              <span class="tx-note-slot">${r.note ? `<span class="tx-li-note">${esc(r.note)}</span>` : ''}</span></span>
            ${r.kind !== 'cover' && reasonText(r) ? `<span class="tx-pill ${r.kind}">${esc(reasonText(r))}</span>` : ''}
            ${r.source === 'manual' ? '<span class="tx-pill man">يدوي</span>' : ''}
            ${selMode ? '' : `<button type="button" class="tx-ico tx-note-btn" data-id="${r.id}" title="${r.note ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}" aria-label="${r.note ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}">${IC.note}</button>
            <button type="button" class="tx-ico tx-del" data-id="${r.id}" title="حذف الحصة" aria-label="حذف الحصة">${IC.trash}</button>`}
          </li>`).join('')}</ul>
        </div>`).join('') : `<p class="tx-none">لا يوجد ${KIND_LABEL[detailTab]} لهذا المعلم في الفترة المحددة</p>`}
    </div>`;
  box.querySelectorAll('.tx-dtabs button').forEach(b => b.onclick = () => { detailTab = b.dataset.tab; selMode = false; picked.clear(); renderDetail(all); });
  $('tx-d-print').onclick = () => printReport(true);
  $('tx-d-add').onclick = () => openManualForm(t.name, detailTab === 'absence' ? 'absence' : 'cover');
  const selBtn = $('tx-selmode');
  if (selBtn) selBtn.onclick = () => { selMode = !selMode; picked.clear(); renderDetail(all); };
  const refreshSel = () => {
    $('tx-selcount').textContent = picked.size;
    $('tx-seldel').disabled = !picked.size;
    box.querySelectorAll('.tx-timeline li[data-id]').forEach(li => { const on = picked.has(li.dataset.id); li.classList.toggle('picked', on); const c = li.querySelector('.tx-rchk'); if (c) c.checked = on; });
    box.querySelectorAll('.tx-dchk').forEach(c => { const ids = byDay.get(c.dataset.day).map(r => r.id); c.checked = ids.every(id => picked.has(id)); });
  };
  if (selMode) {
    box.querySelectorAll('.tx-rchk').forEach(c => c.onchange = () => { c.checked ? picked.add(c.dataset.id) : picked.delete(c.dataset.id); refreshSel(); });
    box.querySelectorAll('.tx-dchk').forEach(c => c.onchange = () => { byDay.get(c.dataset.day).forEach(r => (c.checked ? picked.add(r.id) : picked.delete(r.id))); refreshSel(); });
    box.querySelectorAll('.tx-timeline li[data-id]').forEach(li => li.onclick = e => { if (e.target.closest('input')) return; const id = li.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); refreshSel(); });
    $('tx-selall').onclick = () => { const allOn = items.every(r => picked.has(r.id)); items.forEach(r => (allOn ? picked.delete(r.id) : picked.add(r.id))); refreshSel(); };
    $('tx-seldel').onclick = () => deleteRecords([...picked], `حذف ${plural(picked.size, 'الحصة المحددة', 'الحصتين المحددتين', 'حصص محددة', 'حصة محددة')} نهائيًا؟`, () => { selMode = false; picked.clear(); });
  }
  box.querySelectorAll('.tx-dday').forEach(b => b.onclick = () => {
    const rs = byDay.get(b.dataset.day);
    deleteRecords(rs.map(r => r.id), `حذف ${plural(rs.length, 'حصة واحدة', 'حصتين', 'حصص', 'حصة')} (${KIND_LABEL[detailTab]}) ليوم ${dateTxt(b.dataset.day, { weekday: 'long', day: 'numeric', month: 'long' })} نهائيًا؟`);
  });
  box.querySelectorAll('.tx-del').forEach(b => b.onclick = () => deleteRecords([b.dataset.id], 'حذف هذه الحصة نهائيًا؟'));
  box.querySelectorAll('.tx-note-btn').forEach(b => b.onclick = () => editNote(b.closest('li'), b.dataset.id));
}

// حذف سجل أو أكثر (حصة، أو حصص يوم، أو المحدد)
async function deleteRecords(ids, question, after) {
  if (!ids.length || !confirm(question)) return;
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await sb.from('teacher_absences').delete().in('id', ids.slice(i, i + 200));
    if (error) { toast('تعذر الحذف: ' + error.message, 'err'); await loadRows(); render(); return; }
  }
  const gone = new Set(ids);
  rows = rows.filter(r => !gone.has(r.id));
  if (after) after();
  render();
  toast(ids.length === 1 ? 'تم حذف الحصة' : `تم حذف ${plural(ids.length, 'حصة واحدة', 'حصتين', 'حصص', 'حصة')}`);
}

// ملاحظة على أي حصة غياب أو إشغال: تحرير في مكانها
function editNote(li, id) {
  const r = rows.find(x => x.id === id);
  if (!r || li.querySelector('.tx-note-ed')) return;
  const slot = li.querySelector('.tx-note-slot');
  slot.innerHTML = `<span class="tx-note-ed"><input type="text" maxlength="300" placeholder="اكتب ملاحظة على هذه الحصة" value="${esc(r.note || '')}" aria-label="الملاحظة" />
    <button type="button" class="tx-btn primary sm" data-a="save">حفظ</button><button type="button" class="tx-btn ghost sm" data-a="cancel">إلغاء</button></span>`;
  const inp = slot.querySelector('input');
  inp.focus(); inp.select();
  const restore = () => { slot.innerHTML = r.note ? `<span class="tx-li-note">${esc(r.note)}</span>` : ''; };
  const save = async () => {
    const note = inp.value.trim() || null;
    if (note === (r.note || null)) { restore(); return; }
    slot.querySelector('[data-a="save"]').disabled = true;
    const { error } = await sb.from('teacher_absences').update({ note }).eq('id', id);
    if (error) { toast('تعذر حفظ الملاحظة: ' + error.message, 'err'); slot.querySelector('[data-a="save"]').disabled = false; return; }
    r.note = note;
    restore();
    const btn = li.querySelector('.tx-note-btn');
    if (btn) { btn.title = note ? 'تعديل الملاحظة' : 'إضافة ملاحظة'; btn.setAttribute('aria-label', btn.title); }
    toast(note ? 'تم حفظ الملاحظة' : 'تم حذف الملاحظة');
  };
  slot.querySelector('[data-a="save"]').onclick = save;
  slot.querySelector('[data-a="cancel"]').onclick = restore;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') restore(); };
}

function emptyHtml() {
  return `<div class="tx-empty">
    <span class="tx-empty-ic">${IC.file}</span>
    <h3>ابدأ بسجل غياب وإشغال المعلمين</h3>
    <p>صدّر «حالات الغياب والاستبدال» من برنامج الجداول وارفعه هنا. يمكنك رفع أكثر من ملف وفي أي وقت، وتُضاف السجلات الجديدة فقط دون تكرار.</p>
    <div class="tx-empty-act">
      <button type="button" class="tx-btn primary" id="tx-e-upload">${IC.upload}<span>رفع ملف الغياب</span></button>
      <button type="button" class="tx-btn ghost" id="tx-e-add">${IC.plus}<span>إضافة يدوية</span></button>
    </div>
    <ol class="tx-steps">
      <li><b>1</b>صدّر التقرير من برنامج الجداول</li>
      <li><b>2</b>ارفع الملف أو أفلته هنا</li>
      <li><b>3</b>راجع الإشغال والغياب لكل معلم</li>
    </ol>
  </div>`;
}
function wireEmpty() {
  $('tx-e-upload').onclick = () => $('tx-file').click();
  $('tx-e-add').onclick = () => openManualForm();
}

/* ---------- إضافة يدوية ---------- */
function openManualForm(presetName = '', presetKind = 'cover') {
  const names = [...new Set([...staff.map(p => p.full_name), ...rows.map(r => r.teacher_name)])].sort((a, b) => a.localeCompare(b, 'ar'));
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  back.innerHTML = `<div class="er-abs tx-modal" role="dialog" aria-modal="true" aria-label="إضافة غياب أو إشغال">
    <div class="er-abs-h"><div><b>إضافة غياب أو إشغال</b><span>تُحفظ كسجلات يدوية ولا تتأثر برفع الملفات</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body tx-form">
      <div class="tx-seg" role="tablist"><button type="button" data-k="cover" class="${presetKind === 'cover' ? 'on' : ''}">${IC.cover}إشغال</button><button type="button" data-k="absence" class="${presetKind === 'absence' ? 'on' : ''}">${IC.cal}غياب</button></div>
      <label class="tx-field">المعلم<input list="tx-names" id="tx-f-name" value="${esc(presetName)}" placeholder="اكتب اسم المعلم أو اختره" autocomplete="off" /></label>
      <datalist id="tx-names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label class="tx-field">التاريخ<input type="date" id="tx-f-date" value="${isoOf(new Date())}" /></label>
      <div class="tx-field">الحصص <span class="tx-hint">اختر حصة أو أكثر</span>
        <div class="tx-periods">${PERIODS.map(p => `<label><input type="checkbox" value="${p}" /><span>${p}</span></label>`).join('')}</div>
      </div>
      <label class="tx-field tx-f-reason${presetKind === 'absence' ? '' : ' hidden'}">سبب الغياب<select id="tx-f-reason">${ABSENCE_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <div class="tx-f-row"><label class="tx-field">الفصل<input id="tx-f-class" placeholder="مثال: أول-2" /></label><label class="tx-field">المادة<input id="tx-f-subject" /></label></div>
      <label class="tx-field">ملاحظة<input id="tx-f-note" placeholder="اختياري" /></label>
      <div class="error-msg" id="tx-f-err"></div>
    </div>
    <div class="er-man-foot tx-modal-foot">
      <button type="button" class="tx-btn ghost" data-act="cancel">إلغاء</button>
      <button type="button" class="tx-btn primary" id="tx-f-save">حفظ</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('.er-abs-x').onclick = close;
  back.querySelector('[data-act="cancel"]').onclick = close;
  let kind = presetKind;
  back.querySelectorAll('.tx-seg button').forEach(b => b.onclick = () => {
    kind = b.dataset.k;
    back.querySelectorAll('.tx-seg button').forEach(x => x.classList.toggle('on', x === b));
    back.querySelector('.tx-f-reason').classList.toggle('hidden', kind !== 'absence');
  });
  setTimeout(() => (presetName ? $('tx-f-date') : $('tx-f-name')).focus(), 50);
  $('tx-f-save').onclick = async () => {
    const err = $('tx-f-err');
    const fail = m => { err.textContent = m; err.style.display = 'block'; };
    const name = $('tx-f-name').value.trim();
    const date = $('tx-f-date').value;
    const periods = [...back.querySelectorAll('.tx-periods input:checked')].map(i => i.value);
    if (!name) return fail('اكتب اسم المعلم');
    if (!date) return fail('اختر التاريخ');
    if (!periods.length) return fail('اختر حصة واحدة على الأقل');
    const p = staff.find(s => s.full_name === name) || matchTeacher(name);
    const reason = kind === 'cover' ? null : $('tx-f-reason').value;
    const recs = periods.map(per => ({
      teacher_name: name, teacher_id: p ? p.id : null, entry_date: date, period: per,
      classes: $('tx-f-class').value.trim() || null, subject: $('tx-f-subject').value.trim() || null,
      reason, sub_type: kind === 'cover' ? COVER_TYPE : null, kind, source: 'manual', note: $('tx-f-note').value.trim() || null,
    }));
    $('tx-f-save').disabled = true;
    const { error } = await writeWithSchool(extra => sb.from('teacher_absences').insert(recs.map(r => ({ ...r, ...extra }))));
    $('tx-f-save').disabled = false;
    if (error) return fail(/duplicate|unique/i.test(error.message) ? 'يوجد سجل مطابق لنفس المعلم والتاريخ والحصة' : 'تعذر الحفظ: ' + error.message);
    close();
    await loadRows();
    selected = name; detailTab = kind;
    render();
    toast(`✓ أُضيف ${KIND_LABEL[kind]} ${plural(periods.length, 'حصة واحدة', 'حصتين', 'حصص', 'حصة')} لـ ${name}`);
  };
}

/* ---------- طباعة وتصدير ---------- */
function periodLabel() {
  const [from, to] = rangeBounds();
  return from || to ? `الفترة: ${from ? fmtLong(from) : 'البداية'} – ${to ? fmtLong(to) : 'اليوم'}` : 'كل السجلات المحفوظة';
}

function printReport(onlySelected) {
  const all = summarize(inRange()).sort(SORTS[filt.sort] || SORTS.cover);
  const one = onlySelected && selected ? all.find(t => t.name === selected) : null;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة لطباعة التقرير'); return; }
  const logo = printLogo();
  const tbl = (title, items, cols) => items.length ? `<h4>${title} (${items.length})</h4><table><thead><tr><th>#</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${items.map((r, i) => `<tr><td>${i + 1}</td>${cols.map(c => `<td>${esc(c[1](r))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
  const byDate = arr => arr.slice().sort((a, b) => a.entry_date.localeCompare(b.entry_date) || String(a.period).localeCompare(String(b.period), 'en', { numeric: true }));
  const detail = t => `<div class="kp"><div><b>${t.load != null ? t.load : '—'}</b>النصاب الأسبوعي</div><div><b>${lossTxt(t.loss)}</b>الفاقد</div><div><b>${t.coverPeriods}</b>حصة إشغال</div><div><b>${t.absDays}</b>يوم غياب</div><div><b>${t.absPeriods}</b>حصة غياب</div><div><b>${t.transfers}</b>نقل/تبديل</div></div>
    ${tbl('الإشغال', byDate(t.cover), [['التاريخ', r => fmtLong(r.entry_date)], ['الحصة', r => periodBadge(r.period)], ['الفصل', r => r.classes || ''], ['المادة', r => r.subject || '']])}
    ${tbl('الغياب', byDate(t.absence), [['التاريخ', r => fmtLong(r.entry_date)], ['الحصة', r => periodBadge(r.period)], ['الفصل', r => r.classes || ''], ['السبب', r => r.reason || '']])}`;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${one ? 'تقرير ' + esc(one.name) : 'غياب وإشغال المعلمين'}</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;margin:26px;color:#152238}.hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #152238;padding-bottom:10px;margin-bottom:16px}
    .hd img{height:56px}h1{font-size:19px;margin:0 0 3px}h2{font-size:16px;margin:0 0 10px}h4{margin:14px 0 6px;font-size:13.5px}.sub{color:#555;font-size:12px}
    .kp{display:flex;gap:10px;margin:6px 0 10px}.kp div{flex:1;border:1px solid #d6dbe4;border-radius:8px;padding:8px;text-align:center;font-size:11.5px;color:#555}.kp b{display:block;font-size:18px;color:#152238}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}th,td{border:1px solid #c9ced8;padding:5px 6px;text-align:center}th{background:#152238;color:#fff}
    tr:nth-child(even) td{background:#f5f6f8}td.n{text-align:right}.sig{display:flex;justify-content:space-between;margin-top:36px;font-size:12.5px}@media print{table{break-inside:auto}h4{break-after:avoid}}</style></head><body>
    <div class="hd">${logo ? `<img src="${esc(logo)}">` : ''}<div><h1>${one ? 'تقرير غياب وإشغال المعلم' : 'تقرير غياب وإشغال المعلمين'}</h1><div class="sub">${esc(printOrgName())} · ${esc(periodLabel())}</div></div></div>
    ${one ? `<h2>${esc(one.name)}</h2>${detail(one)}` : `<table><thead><tr><th>#</th><th>المعلم</th><th>النصاب</th><th>حصص الإشغال</th><th>أيام الغياب</th><th>حصص الغياب</th><th>الفاقد</th><th>نقل/تبديل</th></tr></thead><tbody>
      ${all.map((t, i) => `<tr><td>${i + 1}</td><td class="n">${esc(t.name)}</td><td>${t.load != null ? t.load : '—'}</td><td>${t.coverPeriods}</td><td>${t.absDays}</td><td>${t.absPeriods}</td><td>${lossTxt(t.loss)}</td><td>${t.transfers}</td></tr>`).join('')}</tbody></table>`}
    <div class="sig"><span>${one ? 'توقيع المعلم: ..................' : ''}</span><span>وكيل الشؤون التعليمية: ..................</span><span>مدير المدرسة: ..................</span></div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

async function exportExcel() {
  await loadXLSX();
  const list = inRange();
  const all = summarize(list).sort(SORTS.name);
  const wb = XLSX.utils.book_new();
  const sum = all.map((t, i) => ({ '#': i + 1, 'المعلم': t.name, 'النصاب الأسبوعي': t.load != null ? t.load : '', 'حصص الإشغال': t.coverPeriods, 'أيام الغياب': t.absDays, 'حصص الغياب': t.absPeriods, 'الفاقد': t.loss, 'نقل/تبديل': t.transfers }));
  const ws1 = XLSX.utils.json_to_sheet(sum); ws1['!views'] = [{ RTL: true }]; ws1['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'الملخص');
  const det = list.slice().sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, 'ar') || a.entry_date.localeCompare(b.entry_date))
    .map(r => ({ 'المعلم': r.teacher_name, 'النوع': KIND_LABEL[r.kind], 'التاريخ': r.entry_date, 'الحصة': r.period || '', 'الفصل': r.classes || '', 'المادة': r.subject || '', 'السبب': r.kind === 'cover' ? '' : reasonText(r), 'المصدر': r.source === 'manual' ? 'يدوي' : 'الملف', 'ملاحظة': r.note || '' }));
  const ws2 = XLSX.utils.json_to_sheet(det); ws2['!views'] = [{ RTL: true }]; ws2['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'التفاصيل');
  XLSX.writeFile(wb, `غياب وإشغال المعلمين ${isoOf(new Date())}.xlsx`);
}
