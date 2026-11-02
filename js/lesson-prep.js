/* متابعة التحضير
 * المصدر: جدول كل معلم في منصة مدرستي؛ الحصة «محضّرة» إذا ربطها المعلم بدرس.
 * تقرأ إضافة مُدار المنصة بجلسة المستخدم في المتصفح (قراءة فقط)، وتحفظ الصفحة النتيجة يومًا بيوم
 * عبر lesson_prep_sync، فيطّلع عليها المدير والوكيل من أي جهاز. */
import { sb, currentSchoolId, backToTiles, printOrgName } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at8 = s => new Date(s + 'T08:00:00');
const sundayOf = s => { const d = at8(s); d.setDate(d.getDate() - d.getDay()); return iso(d); };
const addDays = (s, n) => { const d = at8(s); d.setDate(d.getDate() + n); return iso(d); };
const pctCls = p => p == null ? 'idle' : p >= 90 ? 'good' : p >= 50 ? 'warn' : 'bad';
const fmtDay = s => at8(s).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });

const DEFAULT_START = '2026-08-23'; // بداية الفصل الدراسي الأول 1448 (قابلة للتعديل من التقرير)
let S = { start: null, report: null, reportSort: 'pct', backfill: null, week: null, day: null, view: 'day', rows: [], days: {}, q: '', onlyMissing: false, busy: false, lastError: null };

/* ---------- إضافة مُدار ---------- */
const ext = { version: document.documentElement.dataset.mudaarExt || null, seq: 0, wait: new Map() };
window.addEventListener('message', e => {
  const d = e.data;
  if (e.source !== window || !d || d.from !== 'mudaar-ext') return;
  if (d.type === 'hello') ext.version = d.version;
  const w = d.id && ext.wait.get(d.id);
  if (!w) return;
  if (d.progress) { if (w.onProgress) w.onProgress(d.progress); }
  else if (d.reply) { ext.wait.delete(d.id); w.resolve(d.reply); }
});
const extVer = () => ext.version || document.documentElement.dataset.mudaarExt || '';
const extOk = () => { const [a, b] = extVer().split('.').map(Number); return a > 0 || b >= 12; };
async function extReady() {
  if (extVer()) return true;
  window.postMessage({ to: 'mudaar-ext', type: 'ping' }, location.origin);
  await new Promise(r => setTimeout(r, 500));
  return !!extVer();
}
function extCall(type, payload, onProgress) {
  return new Promise(resolve => {
    const id = 'p' + (++ext.seq) + '-' + Date.now();
    ext.wait.set(id, { resolve, onProgress });
    window.postMessage({ to: 'mudaar-ext', id, type, payload }, location.origin);
  });
}

/* ---------- البيانات ---------- */
async function load() {
  const from = S.week, to = addDays(S.week, 4);
  const rows = [];
  for (let off = 0; off < 20000; off += 1000) {
    const { data, error } = await sb.from('lesson_prep').select('prep_date, teacher_key, teacher_name, slot, class_name, prepared, lesson, subject')
      .eq('school_id', currentSchoolId).gte('prep_date', from).lte('prep_date', to).order('prep_date').order('teacher_name').order('slot').range(off, off + 999);
    if (error) { S.lastError = /lesson_prep|does not exist|schema/i.test(error.message) ? 'القسم يحتاج تفعيل جداول متابعة التحضير.' : error.message; break; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const { data: days } = await sb.from('lesson_prep_days').select('prep_date, hijri, vacation, teachers, periods, prepared, synced_at').eq('school_id', currentSchoolId).gte('prep_date', from).lte('prep_date', to);
  S.rows = rows;
  S.days = Object.fromEntries((days || []).map(d => [d.prep_date, d]));
}

async function refresh(dates) {
  if (S.busy) return;
  if (!(await extReady()) || !extOk()) { toast('التحديث من منصة مدرستي يحتاج إضافة مُدار (الإصدار 0.12 أو أحدث) في هذا المتصفح. إذا ثبّتها أو حدّثتها للتو فحدّث هذه الصفحة.', true); return; }
  S.busy = true; render();
  const st = $('lp-status');
  const r = await extCall('prepScan', { dates }, p => { const el = $('lp-status'); if (el && p.total) el.textContent = `جارٍ قراءة جداول المعلمين من منصة مدرستي: ${p.done} من ${p.total}`; });
  let msg = null;
  if (!r.ok) msg = r.error || 'تعذّرت القراءة من منصة مدرستي';
  else {
    for (const D of r.data.days) {
      if (D.errors && !D.rows.length && !D.vacation) continue;
      const { error } = await sb.rpc('lesson_prep_sync', { p_school: currentSchoolId, p_date: D.date, p_hijri: D.hijri, p_vacation: D.vacation, p_rows: D.rows });
      if (error) { msg = 'تعذّر الحفظ: ' + error.message; break; }
    }
  }
  S.busy = false;
  await load();
  render();
  if (msg) toast(msg, true); else toast(dates.length > 1 ? 'تم تحديث تحضير الأسبوع من منصة مدرستي' : 'تم تحديث تحضير اليوم من منصة مدرستي');
  if (st) st.textContent = '';
}

/* ---------- الحساب ---------- */
function byTeacher(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.teacher_key)) m.set(r.teacher_key, { key: r.teacher_key, name: r.teacher_name, slots: {}, n: 0, ok: 0, perDay: {} });
    const t = m.get(r.teacher_key);
    t.n++; if (r.prepared) t.ok++;
    const d = (t.perDay[r.prep_date] = t.perDay[r.prep_date] || { n: 0, ok: 0 });
    d.n++; if (r.prepared) d.ok++;
    if (r.prep_date === S.day) t.slots[r.slot] = r;
  }
  return [...m.values()].map(t => ({ ...t, pct: t.n ? Math.round(t.ok / t.n * 100) : null }));
}
const dayStat = d => { const x = S.days[d]; return x && x.periods ? Math.round(x.prepared / x.periods * 100) : null; };

/* ---------- الواجهة ---------- */
function render() {
  const el = $('lp-root');
  const weekDays = DAYS.map((_, i) => addDays(S.week, i));
  const dayRows = S.rows.filter(r => r.prep_date === S.day);
  const teachers = byTeacher(S.rows);
  const todayT = teachers.filter(t => Object.keys(t.slots).length);
  const N = dayRows.length, OK = dayRows.filter(r => r.prepared).length;
  const meta = S.days[S.day];
  const filt = t => (!S.q || t.name.includes(S.q.trim())) && (!S.onlyMissing || Object.values(t.slots).some(r => !r.prepared));
  const maxSlot = Math.max(7, ...dayRows.map(r => r.slot));
  const wN = S.rows.length, wOK = S.rows.filter(r => r.prepared).length;

  el.innerHTML = `
  <div class="lp-top">
    <div class="lp-week">
      <button class="lp-nav" data-w="-7" title="الأسبوع السابق">›</button>
      <div class="lp-days">${weekDays.map((d, i) => { const p = dayStat(d); const x = S.days[d];
        return `<button class="lp-day ${d === S.day ? 'on' : ''} ${x ? '' : 'empty'}" data-d="${d}">
          <span class="lp-ring ${pctCls(p)}" style="--p:${p || 0}"><b>${x ? (x.vacation ? '—' : p + '%') : '·'}</b></span>
          <span class="lp-dn">${DAYS[i]}</span><small>${fmtDay(d)}</small></button>`; }).join('')}</div>
      <button class="lp-nav" data-w="7" title="الأسبوع التالي">‹</button>
    </div>
    <div class="lp-actions">
      <div class="lp-seg"><button data-v="day" class="${S.view === 'day' ? 'on' : ''}">جدول اليوم</button><button data-v="week" class="${S.view === 'week' ? 'on' : ''}">ملخص الأسبوع</button><button data-v="report" class="${S.view === 'report' ? 'on' : ''}">التقرير الشامل</button></div>
      <span class="lp-grow"></span>
      <button class="btn-primary lp-btn" id="lp-sync-day" ${S.busy ? 'disabled' : ''}>${S.busy ? 'جارٍ التحديث...' : 'تحديث اليوم من مدرستي'}</button>
      <button class="btn-secondary lp-btn" id="lp-sync-week" ${S.busy ? 'disabled' : ''}>تحديث الأسبوع</button>
      <button class="btn-secondary lp-btn" id="lp-print">طباعة</button>
    </div>
    <div class="lp-status" id="lp-status">${S.lastError ? esc(S.lastError) : meta ? `آخر تحديث لهذا اليوم: ${new Date(meta.synced_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${meta.hijri ? ' · ' + esc(meta.hijri) : ''}` : 'لم يُقرأ هذا اليوم بعد. اضغط «تحديث اليوم من مدرستي» (يتطلب إضافة مُدار وفتح منصة مدرستي بدور القائد أو الوكيل).'}</div>
  </div>
  ${S.view === 'day' ? dayView() : S.view === 'week' ? weekView() : reportView()}`;
  bind();

  function reportView() {
    const R = S.report;
    const today = iso(new Date());
    const head = `<div class="form-card lp-rep-head">
      <div class="lp-rep-range"><label>من<input type="date" id="lp-from" value="${esc(S.start)}" max="${today}"></label><label>إلى<input type="date" id="lp-to" value="${esc(S.repTo || today)}" max="${today}"></label>
        <button class="btn-secondary lp-btn" id="lp-rep-run">عرض</button><span class="lp-grow"></span>
        <button class="btn-primary lp-btn" id="lp-backfill" ${S.busy ? 'disabled' : ''}>${S.backfill ? esc(S.backfill) : 'استكمال القراءة من منصة مدرستي'}</button>
        <label class="lp-chk"><input type="checkbox" id="lp-reread" ${S.reread ? 'checked' : ''}> إعادة قراءة الأيام المقروءة</label></div>
      ${R ? `<div class="lp-cover ${R.missingDays.length ? 'warn' : ''}">${R.missingDays.length ? `⚠ لم تُقرأ ${R.missingDays.length} يومًا دراسيًا من الفترة بعد (من ${R.schoolDays} يوم). اضغط «استكمال القراءة» لتكتمل النسب.` : `✓ قُرئت جميع أيام الفترة (${R.schoolDays} يوم دراسي).`}</div>` : ''}
    </div>`;
    if (!R) return head + '<div class="form-card lp-empty">جارٍ إعداد التقرير...</div>';
    if (!R.rows.length) return head + '<div class="form-card lp-empty">لا توجد بيانات تحضير في هذه الفترة.</div>';
    const T = R.rows; const P = T.reduce((a, t) => a + t.periods, 0), K = T.reduce((a, t) => a + t.prepared, 0);
    const sorters = { pct: (a, b) => a.pct - b.pct || a.teacher_name.localeCompare(b.teacher_name, 'ar'), missed: (a, b) => b.missed - a.missed, periods: (a, b) => b.periods - a.periods, name: (a, b) => a.teacher_name.localeCompare(b.teacher_name, 'ar') };
    const list = T.filter(t => !S.q || t.teacher_name.includes(S.q.trim())).sort(sorters[S.reportSort] || sorters.pct);
    const band = p => p >= 90 ? 'ممتاز' : p >= 75 ? 'جيد جدًا' : p >= 50 ? 'متوسط' : 'ضعيف';
    return head + `
    <div class="stat-grid lp-stats">
      <div class="stat-card"><div class="label">نسبة تحضير المدرسة</div><div class="value">${P ? Math.round(K / P * 100) + '%' : '—'}</div></div>
      <div class="stat-card"><div class="label">إجمالي الحصص</div><div class="value">${P}</div></div>
      <div class="stat-card"><div class="label">الحصص المحضّرة</div><div class="value">${K}</div></div>
      <div class="stat-card"><div class="label">الفاقد من التحضير</div><div class="value lp-bad">${P - K}</div></div>
    </div>
    <div class="lp-note">نسبة كل معلم = حصصه المحضّرة ÷ حصصه المسندة له في الفترة نفسها؛ فالمعلم الذي نصابه 12 حصة يُقاس على حصصه هو، لا على نصاب غيره.</div>
    <div class="lp-tools"><input id="lp-q" type="search" placeholder="بحث باسم المعلم" value="${esc(S.q)}">
      <select id="lp-sort"><option value="pct" ${S.reportSort === 'pct' ? 'selected' : ''}>الأقل نسبة أولًا</option><option value="missed" ${S.reportSort === 'missed' ? 'selected' : ''}>الأكثر فاقدًا</option><option value="periods" ${S.reportSort === 'periods' ? 'selected' : ''}>الأكثر حصصًا</option><option value="name" ${S.reportSort === 'name' ? 'selected' : ''}>حسب الاسم</option></select>
      <span class="lp-grow"></span><button class="text-action-btn" id="lp-csv">تصدير Excel</button></div>
    <div class="lp-wrap"><table class="lp-grid lp-rep"><thead><tr><th>#</th><th class="nm">المعلم</th><th>النصاب الأسبوعي</th><th>الحصص المسندة</th><th>المحضّرة</th><th>الفاقد</th><th>نسبة التحضير</th><th>التقدير</th><th>آخر حصة غير محضّرة</th></tr></thead><tbody>
    ${list.map((t, i) => `<tr><td>${i + 1}</td><td class="nm">${esc(t.teacher_name)}</td><td>${t.weeks ? Math.round(t.periods / t.weeks) : '—'}</td><td><b>${t.periods}</b></td><td class="lp-g">${t.prepared}</td><td class="lp-r">${t.missed}</td>
      <td class="lp-pc"><div class="lp-bar ${pctCls(t.pct)}"><i style="width:${t.pct}%"></i></div><b class="lp-pct ${pctCls(t.pct)}">${t.pct}%</b></td><td><span class="lp-mini ${pctCls(t.pct)}">${band(t.pct)}</span></td><td>${t.last_missed ? fmtDay(t.last_missed) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function dayView() {
    if (meta && meta.vacation) return '<div class="form-card lp-empty">هذا اليوم إجازة في منصة مدرستي.</div>';
    if (!dayRows.length) return '<div class="form-card lp-empty">لا توجد بيانات لهذا اليوم.</div>';
    const full = todayT.filter(t => Object.values(t.slots).every(r => r.prepared)).length;
    const none = todayT.filter(t => !Object.values(t.slots).some(r => r.prepared)).length;
    const list = todayT.filter(filt).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return `
    <div class="stat-grid lp-stats">
      <div class="stat-card"><div class="label">نسبة التحضير اليوم</div><div class="value">${N ? Math.round(OK / N * 100) + '%' : '—'}</div></div>
      <div class="stat-card"><div class="label">حصص محضّرة</div><div class="value">${OK} <small>/ ${N}</small></div></div>
      <div class="stat-card"><div class="label">حضّر كل حصصه</div><div class="value">${full}</div></div>
      <div class="stat-card"><div class="label">لم يحضّر أي حصة</div><div class="value lp-bad">${none}</div></div>
    </div>
    <div class="lp-tools"><input id="lp-q" type="search" placeholder="بحث باسم المعلم" value="${esc(S.q)}"><label class="lp-chk"><input type="checkbox" id="lp-miss" ${S.onlyMissing ? 'checked' : ''}> غير المكتملين فقط</label>
      <span class="lp-legend"><i class="ok"></i>محضّرة <i class="no"></i>غير محضّرة</span><button class="text-action-btn" id="lp-csv">تصدير Excel</button></div>
    <div class="lp-wrap"><table class="lp-grid"><thead><tr><th>#</th><th class="nm">اسم المعلم</th>${Array.from({ length: maxSlot }, (_, i) => `<th>${['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة'][i] || i + 1}</th>`).join('')}<th>المحضّر</th></tr></thead><tbody>
    ${list.map((t, i) => { const v = Object.values(t.slots); const k = v.filter(r => r.prepared).length;
      return `<tr><td>${i + 1}</td><td class="nm">${esc(t.name)}</td>${Array.from({ length: maxSlot }, (_, s) => { const r = t.slots[s + 1];
        return r ? `<td><span class="lp-cell ${r.prepared ? 'ok' : 'no'}" title="${esc(r.prepared ? 'الدرس: ' + r.lesson : 'غير محضّرة' + (r.subject ? ' — ' + r.subject : ''))}">${esc(r.class_name)}</span></td>` : '<td></td>'; }).join('')}
        <td><b class="lp-pct ${pctCls(Math.round(k / v.length * 100))}">${k}/${v.length}</b></td></tr>`; }).join('') || `<tr><td colspan="${maxSlot + 3}" class="lp-empty">لا توجد نتائج.</td></tr>`}
    </tbody></table></div>`;
  }

  function weekView() {
    if (!S.rows.length) return '<div class="form-card lp-empty">لا توجد بيانات لهذا الأسبوع. اضغط «تحديث الأسبوع».</div>';
    const list = teachers.filter(t => !S.q || t.name.includes(S.q.trim())).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name, 'ar'));
    return `
    <div class="stat-grid lp-stats">
      <div class="stat-card"><div class="label">نسبة تحضير الأسبوع</div><div class="value">${wN ? Math.round(wOK / wN * 100) + '%' : '—'}</div></div>
      <div class="stat-card"><div class="label">حصص محضّرة</div><div class="value">${wOK} <small>/ ${wN}</small></div></div>
      <div class="stat-card"><div class="label">أيام مقروءة</div><div class="value">${weekDays.filter(d => S.days[d]).length} <small>/ 5</small></div></div>
      <div class="stat-card"><div class="label">لم يحضّر طوال الأسبوع</div><div class="value lp-bad">${teachers.filter(t => t.ok === 0).length}</div></div>
    </div>
    <div class="lp-tools"><input id="lp-q" type="search" placeholder="بحث باسم المعلم" value="${esc(S.q)}"><span class="lp-grow"></span><button class="text-action-btn" id="lp-csv">تصدير Excel</button></div>
    <div class="lp-wrap"><table class="lp-grid lp-week-t"><thead><tr><th class="nm">المعلم</th>${weekDays.map((d, i) => `<th>${DAYS[i]}<small>${fmtDay(d)}</small></th>`).join('')}<th>الأسبوع</th></tr></thead><tbody>
    ${list.map(t => `<tr><td class="nm">${esc(t.name)}</td>${weekDays.map(d => { const x = t.perDay[d]; if (!x) return '<td class="lp-na">—</td>'; const p = Math.round(x.ok / x.n * 100); return `<td><span class="lp-mini ${pctCls(p)}">${x.ok}/${x.n}</span></td>`; }).join('')}
      <td><div class="lp-bar ${pctCls(t.pct)}"><i style="width:${t.pct || 0}%"></i></div><b class="lp-pct ${pctCls(t.pct)}">${t.pct}%</b></td></tr>`).join('')}
    </tbody></table></div>`;
  }
}

function bind() {
  const root = $('lp-root');
  root.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.day = b.dataset.d; render(); });
  root.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => { S.week = addDays(S.week, +b.dataset.w); S.day = addDays(S.day, +b.dataset.w); await load(); render(); });
  root.querySelectorAll('[data-v]').forEach(b => b.onclick = async () => { S.view = b.dataset.v; if (S.view === 'report' && !S.report) { render(); await loadReport(); } render(); });
  const q = $('lp-q'); if (q) q.oninput = () => { S.q = q.value; const pos = q.selectionStart; render(); const n = $('lp-q'); n.focus(); n.setSelectionRange(pos, pos); };
  const m = $('lp-miss'); if (m) m.onchange = () => { S.onlyMissing = m.checked; render(); };
  $('lp-sync-day').onclick = () => refresh([S.day]);
  $('lp-sync-week').onclick = () => refresh(DAYS.map((_, i) => addDays(S.week, i)).filter(d => d <= iso(new Date())));
  $('lp-print').onclick = () => window.print();
  const so = $('lp-sort'); if (so) so.onchange = () => { S.reportSort = so.value; render(); };
  const rr = $('lp-rep-run'); if (rr) rr.onclick = async () => { S.start = $('lp-from').value || S.start; S.repTo = $('lp-to').value || null; await saveStart(); await loadReport(); render(); };
  const bf = $('lp-backfill'); if (bf) bf.onclick = () => { S.start = $('lp-from').value || S.start; S.repTo = $('lp-to').value || null; backfill(); };
  const rd = $('lp-reread'); if (rd) rd.onchange = () => { S.reread = rd.checked; };
  const c = $('lp-csv'); if (c) c.onclick = exportCsv;
}

function exportCsv() {
  if (S.view === 'report' && S.report) {
    const cell2 = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = S.report.rows.map(t => [t.teacher_name, t.weeks ? Math.round(t.periods / t.weeks) : '', t.periods, t.prepared, t.missed, t.pct + '%', t.last_missed || '']);
    const csv = '\ufeff' + [['المعلم', 'النصاب الأسبوعي', 'الحصص المسندة', 'المحضّرة', 'الفاقد', 'نسبة التحضير', 'آخر حصة غير محضّرة'], ...rows].map(r => r.map(cell2).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `التقرير-الشامل-للتحضير-${S.start}-${S.repTo || iso(new Date())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    return;
  }
  const cell = v => { let x = String(v == null ? '' : v); if (/^[=+\-@]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
  const rows = (S.view === 'day' ? S.rows.filter(r => r.prep_date === S.day) : S.rows)
    .map(r => [r.prep_date, r.teacher_name, r.slot, r.class_name, r.prepared ? 'محضّرة' : 'غير محضّرة', r.lesson]);
  const csv = '﻿' + [['التاريخ', 'المعلم', 'الحصة', 'الفصل', 'الحالة', 'الدرس'], ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `متابعة-التحضير-${S.view === 'day' ? S.day : 'أسبوع-' + S.week}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------- التقرير الشامل ---------- */
function schoolDaysBetween(from, to) {
  const out = []; let d = from;
  while (d <= to && out.length < 400) { if (at8(d).getDay() <= 4) out.push(d); d = addDays(d, 1); }
  return out;
}
async function loadReport() {
  const to = S.repTo || iso(new Date());
  const [{ data, error }, { data: days }] = await Promise.all([
    sb.rpc('lesson_prep_summary', { p_school: currentSchoolId, p_from: S.start, p_to: to }),
    sb.from('lesson_prep_days').select('prep_date, vacation').eq('school_id', currentSchoolId).gte('prep_date', S.start).lte('prep_date', to),
  ]);
  if (error) { toast('تعذر إعداد التقرير: ' + error.message, true); S.report = { rows: [], missingDays: [], schoolDays: 0 }; return; }
  const have = new Set((days || []).map(d => d.prep_date));
  const vac = new Set((days || []).filter(d => d.vacation).map(d => d.prep_date));
  const all = schoolDaysBetween(S.start, to);
  S.report = {
    rows: (data || []).map(t => ({ ...t, pct: t.periods ? Math.round(t.prepared / t.periods * 100) : 0 })),
    missingDays: all.filter(d => !have.has(d)),
    schoolDays: all.filter(d => !vac.has(d)).length,
  };
}
async function saveStart() {
  await sb.from('school_settings').upsert({ school_id: currentSchoolId, key: 'lesson_prep_start', value: { date: S.start }, updated_at: new Date().toISOString() }, { onConflict: 'school_id,key' });
}
// قراءة كل أيام الفترة غير المقروءة من منصة مدرستي، أسبوعًا أسبوعًا
async function backfill() {
  if (S.busy) return;
  if (!(await extReady()) || !extOk()) { toast('القراءة من منصة مدرستي تحتاج إضافة مُدار (الإصدار 0.12 أو أحدث) في هذا المتصفح. إذا ثبّتها أو حدّثتها للتو فحدّث هذه الصفحة.', true); return; }
  await saveStart();
  await loadReport(); // الفترة قد تغيّرت
  const to = S.repTo || iso(new Date());
  const todo = S.reread ? schoolDaysBetween(S.start, to) : S.report.missingDays;
  if (!todo.length) { toast('جميع أيام الفترة مقروءة.'); return; }
  S.busy = true;
  let done = 0, msg = null;
  for (let i = 0; i < todo.length && !msg; i += 5) {
    const batch = todo.slice(i, i + 5);
    S.backfill = `جارٍ القراءة: ${done} من ${todo.length} يوم`; render();
    const r = await extCall('prepScan', { dates: batch }, p => { const b = $('lp-backfill'); if (b && p.total) b.textContent = `جارٍ القراءة: ${done} من ${todo.length} يوم (${Math.round(p.done / p.total * 100)}%)`; });
    if (!r.ok) { msg = r.error || 'تعذّرت القراءة من منصة مدرستي'; break; }
    for (const D of r.data.days) {
      if (D.errors && !D.rows.length && !D.vacation) continue;
      const { error } = await sb.rpc('lesson_prep_sync', { p_school: currentSchoolId, p_date: D.date, p_hijri: D.hijri, p_vacation: D.vacation, p_rows: D.rows });
      if (error) { msg = 'تعذّر الحفظ: ' + error.message; break; }
    }
    done += batch.length;
  }
  S.busy = false; S.backfill = null;
  await loadReport(); await load(); render();
  toast(msg || `اكتملت قراءة ${done} يوم من منصة مدرستي`, !!msg);
}

function toast(text, bad = false) {
  const t = document.createElement('div');
  t.className = 'av-toast' + (bad ? ' bad' : '');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2600);
}

export async function loadLessonPrepModule() {
  const back = $('back-to-tiles-lp');
  if (back && !back.dataset.bound) { back.dataset.bound = '1'; back.addEventListener('click', backToTiles); }
  const today = iso(new Date());
  const wd = at8(today).getDay();
  S.day = S.day || (wd <= 4 ? today : addDays(sundayOf(today), 4)); // الجمعة والسبت ← خميس الأسبوع
  S.week = sundayOf(S.day);
  S.lastError = null;
  if (!S.start) {
    const { data: st } = await sb.from('school_settings').select('value').eq('school_id', currentSchoolId).eq('key', 'lesson_prep_start').maybeSingle();
    S.start = (st && st.value && st.value.date) || DEFAULT_START;
  }
  $('lp-root').innerHTML = '<div class="form-card lp-empty">جارٍ التحميل...</div>';
  await load();
  // لا توجد بيانات لهذا الأسبوع بعد ← نعرض آخر يوم قُرئ
  if (!S.rows.length) {
    const { data } = await sb.from('lesson_prep_days').select('prep_date').eq('school_id', currentSchoolId).order('prep_date', { ascending: false }).limit(1);
    if (data && data[0] && data[0].prep_date < S.week) { S.day = data[0].prep_date; S.week = sundayOf(S.day); await load(); }
  }
  render();
  document.title = 'متابعة التحضير - ' + (printOrgName() || 'مُدار');
}
