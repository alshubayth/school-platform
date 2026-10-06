/* ملفات الإنجاز
 * المصدر: إكسل «قارئ ملفات الإنجاز» داخل ون درايف المدرسة (Power Query يعدّ ملفات كل بند لكل معلم)،
 * والمنصة تسحبه من رابط المشاركة عن طريق /api/achv-sync وتحفظ آخر نسخة بجدول achv_snapshots.
 * المدير/الوكيل: لوحة اكتمال لكل معلم + ربط مجلد المعلم بحسابه + تذكير الناقصين + طباعة.
 * المعلم: يشوف ملفه هو بس (achv_my). */
import { sb, currentSchoolId, isAdminOrDeputy, isOwnerAccount, printOrgName, backToTiles } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canManage = () => isAdminOrDeputy() || isOwnerAccount;
const norm = s => String(s || '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
const AUTO_SYNC_MIN = 30;

let state = { source: null, snap: null, map: new Map(), staff: [], filter: { spec: '', q: '', sort: 'low' }, open: new Set(), syncing: false, missingSql: false };

function root() { return $('achv-root'); }

function fmtDT(s, withTime = true) {
  if (!s) return '—';
  const d = new Date(s.length === 16 ? s + ':00' : s);
  if (isNaN(d)) return '—';
  const o = { day: 'numeric', month: 'short' };
  if (withTime) Object.assign(o, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', o);
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  return fmtDT(iso);
}
const daysSince = s => s ? Math.floor((Date.now() - new Date(s.length === 16 ? s + ':00' : s)) / 86400000) : null;

/* ---------- الحساب ---------- */
// يطابق صفوف المعلم مع قواعد البنود: بالرقم أولاً، وإلا بالاسم
function evaluateTeacher(rows, rules) {
  const used = new Set();
  const items = rules.map(rule => {
    const matched = rows.filter((r, i) => {
      const ok = rule.no != null ? r.no === rule.no : norm(r.item).includes(norm(rule.name));
      if (ok) used.add(i);
      return ok;
    });
    const files = matched.reduce((a, r) => a + (r.files || 0), 0);
    const status = files >= rule.min ? 'ok' : files > 0 ? 'part' : 'none';
    const modified = matched.map(r => r.modified).filter(Boolean).sort().pop() || null;
    return { rule, files, status, modified };
  });
  const extra = rows.filter((r, i) => !used.has(i));
  const req = items.filter(x => x.rule.required);
  const done = req.filter(x => x.status === 'ok').length;
  const pct = req.length ? Math.round(done / req.length * 100) : null;
  const lastMod = rows.map(r => r.modified).filter(Boolean).sort().pop() || null;
  return { items, extra, req, done, pct, lastMod, missing: req.filter(x => x.status !== 'ok') };
}

function teachersFromSnap() {
  const snap = state.snap || { rows: [], rules: [] };
  const by = new Map();
  for (const r of snap.rows || []) {
    if (!by.has(r.teacher)) by.set(r.teacher, { name: r.teacher, spec: r.spec || '', rows: [] });
    const t = by.get(r.teacher);
    t.rows.push(r);
    if (!t.spec && r.spec) t.spec = r.spec;
  }
  // معلم مربوط بحساب لكن ما عنده ولا ملف (ما يطلع بالإكسل أصلاً)
  for (const [folder] of state.map) if (!by.has(folder)) by.set(folder, { name: folder, spec: '', rows: [] });
  const rules = snap.rules || [];
  return [...by.values()].map(t => ({ ...t, ev: evaluateTeacher(t.rows, rules), profile: state.map.get(t.name) || null }));
}

/* ---------- البيانات ---------- */
async function loadManagerData() {
  const [src, snap, map, staff] = await Promise.all([
    sb.from('achv_sources').select('xlsx_url, updated_at').eq('school_id', currentSchoolId).maybeSingle(),
    sb.from('achv_snapshots').select('rows, rules, fetched_at').eq('school_id', currentSchoolId).maybeSingle(),
    sb.from('achv_teacher_map').select('folder_name, profile_id').eq('school_id', currentSchoolId),
    sb.from('profiles').select('id, full_name, role').eq('school_id', currentSchoolId).in('role', ['admin', 'deputy', 'teacher']).order('full_name'),
  ]);
  if (src.error && /achv_|does not exist|schema cache/i.test(src.error.message || '')) { state.missingSql = true; return; }
  state.missingSql = false;
  state.source = src.data || null;
  state.snap = snap.data || null;
  state.map = new Map((map.data || []).filter(m => m.profile_id).map(m => [m.folder_name, m.profile_id]));
  state.staff = staff.data || [];
}

async function syncNow(silent = false) {
  if (state.syncing) return;
  state.syncing = true;
  const btn = $('av-sync');
  if (btn) { btn.disabled = true; btn.textContent = 'جارٍ القراءة...'; }
  let msg = null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch('/api/achv-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session ? session.access_token : '') },
      body: JSON.stringify({ school: currentSchoolId }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      msg = {
        not_public: 'الملف ما انفتح بدون تسجيل دخول. تأكد إن رابط المشاركة «أي شخص لديه الرابط».',
        no_table: 'الملف انقرأ لكن ما فيه جدول النتائج. افتحه في Excel واضغط «تحديث الكل» ثم احفظ.',
        bad_url: 'الرابط لازم يكون رابط مشاركة من ون درايف أو SharePoint.',
        no_source: 'ما فيه رابط محفوظ، أو ما عندك صلاحية.',
        download: 'تعذر تنزيل الملف من ون درايف. حاول بعد شوي.',
        auth: 'انتهت الجلسة، سجّل دخول من جديد.',
      }[out.error] || 'تعذر التحديث (' + (out.error || r.status) + ')';
    }
  } catch (e) { msg = 'تعذر الاتصال بالخادم.'; }
  state.syncing = false;
  if (msg) { if (!silent) toast(msg, true); else state.lastError = msg; }
  await loadManagerData();
  if (state.snap) await saveGuessedLinks(teachersFromSnap());
  renderManager();
  if (!msg && !silent) toast('تم تحديث البيانات من ملف الإكسل');
}

/* ---------- واجهة المدير/الوكيل ---------- */
function sourceCard() {
  const s = state.source;
  if (!s) return `
    <div class="form-card av-setup">
      <h3>ربط ملف «قارئ ملفات الإنجاز»</h3>
      <p>الصق رابط مشاركة ملف الإكسل (أي شخص لديه الرابط - عرض فقط). المنصة تقرأ منه عدد ملفات كل بند لكل معلم.</p>
      <div class="av-url-row"><input id="av-url" type="url" dir="ltr" placeholder="https://...sharepoint.com/:x:/g/personal/..."><button class="btn-primary" id="av-save-url">حفظ وقراءة</button></div>
    </div>`;
  const snap = state.snap;
  return `
    <div class="av-source">
      <div class="av-source-info">
        <span class="av-dot ${snap ? 'ok' : ''}"></span>
        <div><b>${snap ? 'آخر قراءة ' + esc(ago(snap.fetched_at)) : 'لم تتم القراءة بعد'}</b>
        <span>${state.lastError ? esc(state.lastError) : 'المصدر: ملف «قارئ ملفات الإنجاز» في ون درايف. حدّث الإكسل من Excel أولاً لو تغيّرت الملفات.'}</span></div>
      </div>
      <div class="av-source-actions">
        <button class="btn-primary" id="av-sync">تحديث الآن</button>
        <button class="btn-secondary" id="av-change-url">تغيير الرابط</button>
      </div>
    </div>`;
}

function renderManager() {
  const el = root();
  if (state.missingSql) { el.innerHTML = '<div class="form-card av-empty">القسم يحتاج تشغيل ملف sql/achievement_files.sql بقاعدة البيانات.</div>'; return; }
  const teachers = teachersFromSnap();
  const rules = (state.snap && state.snap.rules) || [];
  const specs = [...new Set(teachers.map(t => t.spec).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const f = state.filter;
  let list = teachers.filter(t => (!f.spec || t.spec === f.spec) && (!f.q || norm(t.name).includes(norm(f.q))));
  list.sort((a, b) => f.sort === 'name' ? a.name.localeCompare(b.name, 'ar')
    : f.sort === 'spec' ? (a.spec.localeCompare(b.spec, 'ar') || a.name.localeCompare(b.name, 'ar'))
    : ((a.ev.pct ?? 101) - (b.ev.pct ?? 101)) || a.name.localeCompare(b.name, 'ar'));

  const withPct = teachers.filter(t => t.ev.pct != null);
  const avg = withPct.length ? Math.round(withPct.reduce((a, t) => a + t.ev.pct, 0) / withPct.length) : null;
  const full = withPct.filter(t => t.ev.pct === 100).length;
  const behind = withPct.filter(t => t.ev.pct < 100).length;
  const unlinked = teachers.filter(t => !t.profile).length;
  const reqRules = rules.filter(r => r.required);

  el.innerHTML = `
    ${sourceCard()}
    ${state.snap ? `
    <div class="stat-grid av-stats">
      <div class="stat-card"><div class="label">المعلمين</div><div class="value">${teachers.length}</div></div>
      <div class="stat-card"><div class="label">نسبة الإنجاز بالمدرسة</div><div class="value">${avg == null ? '—' : avg + '%'}</div></div>
      <div class="stat-card"><div class="label">ملف مكتمل</div><div class="value">${full}</div></div>
      <div class="stat-card"><div class="label">يحتاج متابعة</div><div class="value">${behind}</div></div>
    </div>
    ${!reqRules.length ? '<div class="av-note">ورقة «البنود» في الإكسل ما فيها بنود إلزامية، فما تنحسب نسبة إنجاز. حدّد الإلزامي من الإكسل.</div>' : ''}
    ${unlinked ? `<div class="av-note">${unlinked} مجلد غير مربوط بحساب معلم، فما يوصله تذكير. اربطه من القائمة بجانب الاسم.</div>` : ''}
    <div class="av-toolbar">
      <input id="av-q" type="search" placeholder="بحث باسم المعلم" value="${esc(f.q)}">
      <select id="av-spec"><option value="">كل التخصصات</option>${specs.map(s => `<option ${s === f.spec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="av-sort">
        <option value="low" ${f.sort === 'low' ? 'selected' : ''}>الأقل إنجازًا أولاً</option>
        <option value="spec" ${f.sort === 'spec' ? 'selected' : ''}>حسب التخصص</option>
        <option value="name" ${f.sort === 'name' ? 'selected' : ''}>حسب الاسم</option>
      </select>
      <span class="av-grow"></span>
      <button class="btn-secondary" id="av-remind">تذكير الناقصين</button>
      <button class="btn-secondary" id="av-print">طباعة التقرير</button>
    </div>
    <div class="av-list">${list.length ? list.map(teacherRow).join('') : '<div class="av-empty">ما فيه نتائج.</div>'}</div>` : ''}`;
  bindManager();
}

function staffOptions(selected) {
  const guess = selected;
  return `<option value="">— غير مربوط —</option>` + state.staff.map(p =>
    `<option value="${p.id}" ${p.id === guess ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('');
}
// اقتراح الحساب من اسم المجلد: أكثر حساب يشترك بالاسم الأول والأخير
function guessProfile(folder) {
  const ft = norm(folder).split(' ').filter(w => w.length > 1 && !['بن', 'ابن', 'ال', 'م', 'ا', 'أ'].includes(w));
  if (!ft.length) return null;
  let best = null, bestScore = 0;
  for (const p of state.staff) {
    const pt = norm(p.full_name).split(' ');
    const score = ft.filter(w => pt.includes(w)).length + (pt[0] === ft[0] ? 1 : 0) + (pt[pt.length - 1] === ft[ft.length - 1] ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = p.id; }
  }
  return bestScore >= 3 ? best : null;
}

function bar(pct) {
  const cls = pct == null ? 'idle' : pct === 100 ? 'good' : pct >= 50 ? 'warn' : 'bad';
  return `<div class="av-bar ${cls}"><i style="width:${pct || 0}%"></i></div><b class="av-pct ${cls}">${pct == null ? '—' : pct + '%'}</b>`;
}
const ST_LABEL = { ok: 'مكتمل', part: 'ناقص', none: 'فارغ' };

function teacherRow(t) {
  const ev = t.ev, open = state.open.has(t.name);
  const stale = daysSince(ev.lastMod);
  const chips = ev.missing.slice(0, 4).map(x => `<span class="av-chip ${x.status}">${esc(x.rule.name)}${x.rule.min > 1 ? ` ${x.files}/${x.rule.min}` : ''}</span>`).join('')
    + (ev.missing.length > 4 ? `<span class="av-chip more">+${ev.missing.length - 4}</span>` : '');
  return `
  <div class="av-row ${open ? 'open' : ''}" data-t="${esc(t.name)}">
    <div class="av-row-main">
      <button class="av-toggle" aria-expanded="${open}" title="التفاصيل">
        <span class="av-name">${esc(t.name)}</span>
        <span class="av-spec">${esc(t.spec || '—')}${stale != null ? ` · آخر تعديل ${stale === 0 ? 'اليوم' : `قبل ${stale} يوم`}` : ' · لا توجد ملفات'}</span>
      </button>
      <div class="av-progress">${bar(ev.pct)}</div>
      <div class="av-missing">${ev.pct === 100 ? '<span class="av-chip ok">كل البنود الإلزامية مكتملة</span>' : chips}</div>
      <select class="av-link" data-folder="${esc(t.name)}" title="ربط المجلد بحساب المعلم">${staffOptions(t.profile)}</select>
    </div>
    ${open ? teacherDetail(t) : ''}
  </div>`;
}

function itemsTable(ev) {
  return `<div class="av-tablewrap"><table class="av-table"><thead><tr><th>البند</th><th>الملفات</th><th>المطلوب</th><th>الحالة</th><th>آخر تعديل</th></tr></thead><tbody>
    ${ev.items.map(x => `<tr class="${x.rule.required ? '' : 'opt'}"><td>${x.rule.no != null ? x.rule.no + '- ' : ''}${esc(x.rule.name)}${x.rule.required ? '' : ' <small>(اختياري)</small>'}</td>
      <td>${x.files}</td><td>${x.rule.min}</td><td><span class="av-st ${x.status}">${ST_LABEL[x.status]}</span></td><td>${esc(fmtDT(x.modified, false))}</td></tr>`).join('')}
    ${ev.extra.map(r => `<tr class="extra"><td>${esc(r.item)} <small>(غير موجود بقائمة البنود)</small></td><td>${r.files}</td><td>—</td><td>—</td><td>${esc(fmtDT(r.modified, false))}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function teacherDetail(t) { return `<div class="av-detail">${itemsTable(t.ev)}</div>`; }

function bindManager() {
  const save = $('av-save-url');
  if (save) save.onclick = saveUrl;
  const sync = $('av-sync');
  if (sync) sync.onclick = () => syncNow(false);
  const ch = $('av-change-url');
  if (ch) ch.onclick = () => { state.source = null; renderManager(); const u = $('av-url'); if (u) u.focus(); };
  const q = $('av-q');
  if (q) q.oninput = () => { state.filter.q = q.value; const pos = q.selectionStart; renderManager(); const n = $('av-q'); n.focus(); n.setSelectionRange(pos, pos); };
  const sp = $('av-spec'); if (sp) sp.onchange = () => { state.filter.spec = sp.value; renderManager(); };
  const so = $('av-sort'); if (so) so.onchange = () => { state.filter.sort = so.value; renderManager(); };
  const rm = $('av-remind'); if (rm) rm.onclick = openRemind;
  const pr = $('av-print'); if (pr) pr.onclick = printReport;
  root().querySelectorAll('.av-toggle').forEach(b => b.onclick = () => {
    const name = b.closest('.av-row').dataset.t;
    if (state.open.has(name)) state.open.delete(name); else state.open.add(name);
    renderManager();
  });
  root().querySelectorAll('.av-link').forEach(s => s.onchange = () => saveLink(s.dataset.folder, s.value, s));
}

async function saveUrl() {
  const v = ($('av-url').value || '').trim();
  if (!/^https:\/\/[^/]*(sharepoint\.com|1drv\.ms|onedrive\.live\.com)\//i.test(v)) { toast('الصق رابط مشاركة من ون درايف (يبدأ بـ https:// وفيه sharepoint.com)', true); return; }
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('achv_sources').upsert({ school_id: currentSchoolId, xlsx_url: v, updated_by: user ? user.id : null, updated_at: new Date().toISOString() }, { onConflict: 'school_id' });
  if (error) { toast('تعذر حفظ الرابط: ' + error.message, true); return; }
  state.source = { xlsx_url: v };
  renderManager();
  syncNow(false);
}

async function saveLink(folder, profileId, sel) {
  const res = profileId
    ? await sb.from('achv_teacher_map').upsert({ school_id: currentSchoolId, folder_name: folder, profile_id: profileId }, { onConflict: 'school_id,folder_name' })
    : await sb.from('achv_teacher_map').delete().eq('school_id', currentSchoolId).eq('folder_name', folder);
  if (res.error) { toast('تعذر حفظ الربط: ' + res.error.message, true); return; }
  if (profileId) state.map.set(folder, profileId); else state.map.delete(folder);
  sel.classList.add('saved'); setTimeout(() => sel.classList.remove('saved'), 900);
  toast(profileId ? 'تم ربط المجلد بالحساب' : 'تم إلغاء الربط');
}

// ربط تلقائي للمجلدات اللي اسمها يطابق اسم حساب بوضوح (الوكيل يقدر يغيّره من القائمة)
async function saveGuessedLinks(teachers) {
  const rows = teachers.filter(t => !t.profile).map(t => ({ folder: t.name, id: guessProfile(t.name) })).filter(x => x.id);
  if (!rows.length) return;
  const { error } = await sb.from('achv_teacher_map').upsert(rows.map(x => ({ school_id: currentSchoolId, folder_name: x.folder, profile_id: x.id })), { onConflict: 'school_id,folder_name' });
  if (!error) rows.forEach(x => state.map.set(x.folder, x.id));
}

/* ---------- تذكير الناقصين (تنبيه شخصي لكل معلم + إشعار جوال) ---------- */
async function openRemind() {
  await saveGuessedLinks(teachersFromSnap());
  const list = teachersFromSnap().filter(t => t.ev.req.length && t.ev.pct < 100);
  const linked = list.filter(t => t.profile), unl = list.filter(t => !t.profile);
  const wrap = document.createElement('div');
  wrap.className = 'av-modal';
  wrap.innerHTML = `
    <div class="av-modal-card" role="dialog" aria-modal="true" aria-label="تذكير الناقصين">
      <h3>تذكير المعلمين بالبنود الناقصة</h3>
      ${linked.length ? `<p>يوصل كل معلم تنبيه في المنصة وإشعار على الجوال، فيه بنوده الناقصة هو بس.</p>
      <label class="av-check-all"><input type="checkbox" id="av-all" checked> تحديد الكل (${linked.length})</label>
      <div class="av-pick">${linked.map(t => `<label><input type="checkbox" class="av-pick-cb" value="${esc(t.name)}" checked><span>${esc(t.name)}</span><small>${t.ev.missing.length} بند ناقص</small></label>`).join('')}</div>`
      : '<p>ما فيه معلم مربوط بحساب عنده نقص.</p>'}
      ${unl.length ? `<p class="av-warn">${unl.length} مجلد عنده نقص لكنه غير مربوط بحساب، فما يوصله تذكير: ${unl.slice(0, 5).map(t => esc(t.name)).join('، ')}${unl.length > 5 ? '…' : ''}</p>` : ''}
      <div class="av-modal-actions">
        ${linked.length ? '<button class="btn-primary" id="av-send">إرسال التذكير</button>' : ''}
        <button class="btn-secondary" id="av-cancel">إغلاق</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('#av-cancel').onclick = close;
  const all = wrap.querySelector('#av-all');
  if (all) all.onchange = () => wrap.querySelectorAll('.av-pick-cb').forEach(c => { c.checked = all.checked; });
  const send = wrap.querySelector('#av-send');
  if (send) send.onclick = async () => {
    const names = new Set([...wrap.querySelectorAll('.av-pick-cb:checked')].map(c => c.value));
    const targets = linked.filter(t => names.has(t.name));
    if (!targets.length) return;
    send.disabled = true;
    let ok = 0, fail = 0;
    for (const t of targets) {
      send.textContent = `جارٍ الإرسال ${ok + fail + 1}/${targets.length}...`;
      const lines = t.ev.missing.map(x => `• ${x.rule.name}${x.rule.min > 1 || x.files ? ` (عندك ${x.files} من ${x.rule.min})` : ''}`);
      const { error } = await sb.rpc('notice_send', {
        p_title: 'ملف الإنجاز: بنود تحتاج إكمال',
        p_body: `نأمل إكمال البنود التالية في ملف إنجازك على ون درايف:\n${lines.join('\n')}`,
        p_meeting_at: null, p_location: '', p_response_type: 'none', p_options: [], p_recipients: [t.profile], p_school: currentSchoolId,
      });
      if (error) fail++; else ok++;
    }
    close();
    toast(fail ? `أُرسل ${ok} وتعذر ${fail}` : `تم إرسال التذكير لـ ${ok} معلم`, !!fail);
  };
}

/* ---------- الطباعة ---------- */
function printReport() {
  const teachers = teachersFromSnap().filter(t => !state.filter.spec || t.spec === state.filter.spec)
    .sort((a, b) => a.spec.localeCompare(b.spec, 'ar') || a.name.localeCompare(b.name, 'ar'));
  const req = ((state.snap && state.snap.rules) || []).filter(r => r.required);
  const mark = x => x.status === 'ok' ? `<td class="ok">${x.files}</td>` : x.status === 'part' ? `<td class="part">${x.files}/${x.rule.min}</td>` : '<td class="none">✗</td>';
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>متابعة ملفات الإنجاز</title>
  <style>
    body{font-family:Tahoma,Arial,sans-serif;margin:18px;color:#152238}
    h1{font-size:18px;margin:0 0 4px} .meta{font-size:12px;color:#555;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:11px} th,td{border:1px solid #9aa3af;padding:4px 5px;text-align:center}
    th{background:#0F2447;color:#fff;font-weight:700} td.n{text-align:right;white-space:nowrap} td.ok{background:#E7F5EC}
    td.part{background:#FDF3DC} td.none{background:#FBEAE9;color:#C0453D;font-weight:700} tr.spec td{background:#EAF1FC;font-weight:700;text-align:right}
    .legend{font-size:11px;margin-top:8px;color:#444} @page{size:A4 landscape;margin:10mm}
  </style></head><body>
  <h1>متابعة ملفات الإنجاز${state.filter.spec ? ' - ' + esc(state.filter.spec) : ''}</h1>
  <div class="meta">${esc(printOrgName())} · آخر قراءة للملف: ${esc(fmtDT(state.snap ? state.snap.fetched_at : null))}</div>
  <table><thead><tr><th>المعلم</th>${req.map(r => `<th>${esc(r.name)}</th>`).join('')}<th>الإنجاز</th></tr></thead><tbody>
  ${(() => { let last = null; return teachers.map(t => {
      const head = t.spec !== last ? `<tr class="spec"><td colspan="${req.length + 2}">${esc(t.spec || 'بدون تخصص')}</td></tr>` : '';
      last = t.spec;
      const cells = req.map(r => mark(t.ev.items.find(x => x.rule === r)));
      return head + `<tr><td class="n">${esc(t.name)}</td>${cells.join('')}<td><b>${t.ev.pct == null ? '—' : t.ev.pct + '%'}</b></td></tr>`;
    }).join(''); })()}
  </tbody></table>
  <div class="legend">الرقم = عدد الملفات (مكتمل) · ٢/٣ = ناقص عن الحد الأدنى · ✗ = البند فارغ. البنود المعروضة هي الإلزامية فقط.</div>
  <script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', true); return; }
  w.document.write(html); w.document.close();
}

/* ---------- واجهة المعلم ---------- */
async function renderTeacher() {
  const el = root();
  el.innerHTML = '<div class="av-empty">جارٍ التحميل...</div>';
  const { data, error } = await sb.rpc('achv_my');
  if (error) { el.innerHTML = '<div class="form-card av-empty">تعذر تحميل ملف الإنجاز.</div>'; return; }
  if (!data || !data.linked) {
    el.innerHTML = '<div class="form-card av-empty">ملف إنجازك لم يُربط بحسابك بعد. يربطه الوكيل من صفحة ملفات الإنجاز.</div>';
    return;
  }
  const ev = evaluateTeacher(data.rows || [], data.rules || []);
  el.innerHTML = `
    <div class="form-card av-mine">
      <div class="av-mine-head">
        <div><h3>ملف إنجازي</h3><span>آخر قراءة ${data.fetched_at ? esc(ago(data.fetched_at)) : '—'}</span></div>
        <div class="av-progress big">${bar(ev.pct)}</div>
      </div>
      ${ev.missing.length ? `<div class="av-note">نأمل إكمال: ${ev.missing.map(x => esc(x.rule.name) + (x.rule.min > 1 ? ` (${x.files}/${x.rule.min})` : '')).join('، ')}</div>`
        : ev.req.length ? '<div class="av-note good">كل البنود الإلزامية مكتملة. شكرًا لك.</div>' : ''}
      ${itemsTable(ev)}
      <p class="av-hint">البيانات تُقرأ من مجلدك في ون درايف. بعد ما تضيف ملفات، تظهر هنا بعد التحديث القادم من الإدارة.</p>
    </div>`;
}

/* ---------- عام ---------- */
function toast(text, bad = false) {
  const t = document.createElement('div');
  t.className = 'av-toast' + (bad ? ' bad' : '');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 5200 : 2600);
}

export async function loadAchievementsModule() {
  const back = $('back-to-tiles-achv');
  if (back && !back.dataset.bound) { back.dataset.bound = '1'; back.addEventListener('click', backToTiles); }
  if (!canManage()) { renderTeacher(); return; }
  root().innerHTML = '<div class="av-empty">جارٍ التحميل...</div>';
  state.lastError = null;
  await loadManagerData();
  if (state.snap) await saveGuessedLinks(teachersFromSnap());
  renderManager();
  // قراءة تلقائية لو آخر قراءة قديمة
  if (state.source && (!state.snap || (Date.now() - new Date(state.snap.fetched_at)) / 60000 > AUTO_SYNC_MIN)) syncNow(true);
}
