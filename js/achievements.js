/* ملفات الإنجاز
 * المصدر المفضل: مجلد «العام» في ون درايف مباشرة، تقرؤه إضافة مُدار في المتصفح بجلسة المستخدم (قراءة فقط)،
 * فتُحسب ملفات كل بند لكل معلم وتُحفظ معها قائمة الملفات للاستعراض السريع.
 * المصدر البديل: إكسل «قارئ ملفات الإنجاز» داخل ون درايف المدرسة (Power Query يعدّ ملفات كل بند لكل معلم)،
 * والمنصة تسحبه من رابط المشاركة عن طريق /api/achv-sync وتحفظ آخر نسخة بجدول achv_snapshots.
 * المدير/الوكيل: لوحة اكتمال لكل معلم + ربط مجلد المعلم بحسابه + تذكير الناقصين + طباعة.
 * المعلم: يشوف ملفه هو بس (achv_my). */
import { sb, currentSchoolId, isAdminOrDeputy, isOwnerAccount, printOrgName, backToTiles } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canManage = () => isAdminOrDeputy() || isOwnerAccount;
const norm = s => String(s || '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
const AUTO_SYNC_MIN = 30;

/* ---------- إضافة مُدار (قراءة مجلد ون درايف بجلسة المتصفح) ---------- */
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
async function extReady() {
  ext.version = ext.version || document.documentElement.dataset.mudaarExt || null;
  if (ext.version) return true;
  window.postMessage({ to: 'mudaar-ext', type: 'ping' }, location.origin);
  await new Promise(r => setTimeout(r, 500));
  return !!(ext.version || document.documentElement.dataset.mudaarExt);
}
const extOk = () => { const v = ext.version || document.documentElement.dataset.mudaarExt || ''; const [a, b] = v.split('.').map(Number); return a > 0 || b >= 10; };
function extCall(type, payload, onProgress) {
  return new Promise(resolve => {
    const id = 'q' + (++ext.seq) + '-' + Date.now();
    ext.wait.set(id, { resolve, onProgress });
    window.postMessage({ to: 'mudaar-ext', id, type, payload }, location.origin);
  });
}

// ملفات المجلد ← صفوف بنفس شكل صفوف الإكسل: التخصص/المعلم/الفصل/البند (+ قائمة الملفات)
const itemNo = name => { const m = /^\s*(\d+)\s*[-–ـ.)]/.exec(name) || /[-–ـ]\s*(\d+)\s*$/.exec(name); return m ? Number(m[1]) : null; };
function localStamp(iso) { const d = new Date(iso); if (isNaN(d)) return null; const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }
function rowsFromScan(scan) {
  const root = scan.root.replace(/\/+$/, '');
  const rel = p => p.startsWith(root + '/') ? p.slice(root.length + 1) : null;
  const skipTeacher = t => /^\d+$/.test(t); // مجلدات قوالب مرقّمة
  const rows = new Map();
  const key = (spec, teacher, term, item) => [spec, teacher, term, item].join('\u0001');
  const row = (spec, teacher, term, item) => {
    const k = key(spec, teacher, term, item);
    if (!rows.has(k)) rows.set(k, { spec, teacher, term, item, no: item ? itemNo(item) : null, files: 0, modified: null, list: [] });
    return rows.get(k);
  };
  // المجلدات أولًا حتى تظهر البنود الفارغة والمعلم الذي لا ملفات له
  for (const p of scan.folders) {
    const r = rel(p); if (!r) continue;
    const seg = r.split('/');
    if (seg.length < 2 || skipTeacher(seg[1])) continue;
    if (seg.length === 2) row(seg[0], seg[1], '', '');
    else if (seg.length === 4) row(seg[0], seg[1], seg[2], seg[3]);
  }
  for (const f of scan.files) {
    const r = rel(f.p); if (!r) continue;
    const seg = r.split('/');
    if (seg.length < 3 || skipTeacher(seg[1])) continue; // ملفات في جذر المجلد أو التخصص
    const term = seg.length >= 4 ? seg[2] : '';
    const item = seg.length >= 5 ? seg[3] : 'ملفات خارج البنود';
    const x = row(seg[0], seg[1], term, item);
    x.files++;
    const t = localStamp(f.t);
    if (t && (!x.modified || t > x.modified)) x.modified = t;
    x.list.push({ r, s: f.s, t });
  }
  // نحذف صف «المعلم بلا بند» إذا وُجدت له بنود
  const withItems = new Set([...rows.values()].filter(x => x.item).map(x => x.teacher));
  return [...rows.values()].filter(x => x.item || !withItems.has(x.teacher)).map(x => { x.list.sort((a, b) => (b.t || '').localeCompare(a.t || '')); return x; });
}
function defaultRules(rows) {
  const by = new Map();
  for (const r of rows) if (r.item && r.item !== 'ملفات خارج البنود') { const k = r.no != null ? 'n' + r.no : 's' + norm(r.item); if (!by.has(k)) by.set(k, { no: r.no, name: r.item.replace(/^\s*\d+\s*[-–ـ.)]\s*/, '').replace(/\s*[-–ـ]\s*\d+\s*$/, ''), required: true, min: 1, note: '' }); }
  return [...by.values()].sort((a, b) => (a.no ?? 99) - (b.no ?? 99));
}
// رابط عرض الملف أو المجلد داخل ون درايف
function spLink(snap, r, folder = false) {
  if (!snap || !snap.viewer || !snap.root) return null;
  const full = snap.root.replace(/\/+$/, '') + '/' + r;
  const parent = full.slice(0, full.lastIndexOf('/'));
  return snap.viewer + '?id=' + encodeURIComponent(full) + (folder ? '' : '&parent=' + encodeURIComponent(parent));
}
const fileName = r => r.slice(r.lastIndexOf('/') + 1);
const fileExt = r => { const m = /\.([a-z0-9]{1,5})$/i.exec(r); return m ? m[1].toLowerCase() : ''; };
const EXT_KIND = { pdf: 'pdf', doc: 'doc', docx: 'doc', xls: 'xls', xlsx: 'xls', csv: 'xls', ppt: 'ppt', pptx: 'ppt', jpg: 'img', jpeg: 'img', png: 'img', heic: 'img', gif: 'img', webp: 'img', mp4: 'vid', mov: 'vid' };
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(b / 1024)) + ' ك.ب';

let state = { excluded: new Set(), source: null, snap: null, map: new Map(), staff: [], filter: { spec: '', q: '', sort: 'low', term: '' }, open: new Set(), syncing: false, missingSql: false };

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
  rows = rows.filter(r => r.item); // صفوف «مجلد بدون ملفات» للعرض فقط
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
    const list = matched.flatMap(r => r.list || []);
    const folder = matched.length === 1 && matched[0].term ? [matched[0].spec, matched[0].teacher, matched[0].term, matched[0].item].join('/') : null;
    return { rule, files, status, modified, list, folder };
  });
  const extra = rows.filter((r, i) => !used.has(i));
  const req = items.filter(x => x.rule.required);
  const done = req.filter(x => x.status === 'ok').length;
  const pct = req.length ? Math.round(done / req.length * 100) : null;
  const lastMod = rows.map(r => r.modified).filter(Boolean).sort().pop() || null;
  return { items, extra, req, done, pct, lastMod, missing: req.filter(x => x.status !== 'ok') };
}

// الفصول الدراسية الموجودة بالمجلدات (ف1، ف2...) - الافتراضي الفصل اللي فيه أكثر ملفات
function termsOf(rows) { return [...new Set((rows || []).map(r => r.term).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar', { numeric: true })); }
function busiestTerm(rows) {
  const n = new Map();
  for (const r of rows || []) if (r.term) n.set(r.term, (n.get(r.term) || 0) + (r.files || 0));
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
function currentTerm() {
  const rows = state.snap && state.snap.rows;
  const terms = termsOf(rows);
  if (!terms.length) return '';
  if (!terms.includes(state.filter.term)) state.filter.term = busiestTerm(rows);
  return state.filter.term;
}
function teachersFromSnap() {
  const snap = state.snap || { rows: [], rules: [] };
  const by = new Map();
  const term = currentTerm();
  // كل معلم له مجلد فيه ملفات بأي فصل يطلع، والتقييم بملفات الفصل المختار فقط
  for (const r of snap.rows || []) {
    if (!by.has(r.teacher)) by.set(r.teacher, { name: r.teacher, spec: r.spec || '', rows: [] });
    const t = by.get(r.teacher);
    if (!t.spec && r.spec) t.spec = r.spec;
    if (term && r.term && r.term !== term) continue;
    t.rows.push(r);
  }
  // معلم مربوط بحساب لكن ما عنده ولا ملف (ما يطلع بالإكسل أصلاً)
  for (const [folder] of state.map) if (!by.has(folder)) by.set(folder, { name: folder, spec: '', rows: [] });
  const rules = snap.rules || [];
  const list = [...by.values()].map(t => ({ ...t, ev: evaluateTeacher(t.rows, rules), profile: state.map.get(t.name) || null }));
  // معلمو المنصة اللي ما لقينا لهم ولا ملف (مجلداتهم فاضية، فما تطلع بالإكسل أصلاً) - إلا المستبعدين (إداريين...)
  const linked = new Set(list.map(t => t.profile).filter(Boolean));
  for (const p of state.staff) {
    if (p.role !== 'teacher' || linked.has(p.id) || by.has(p.full_name) || state.excluded.has(p.id)) continue;
    list.push({ name: p.full_name, spec: '', rows: [], profile: p.id, noFolder: true, ev: evaluateTeacher([], rules) });
  }
  return list;
}

async function saveExcluded() {
  const value = { ids: [...state.excluded] };
  const { error } = await sb.from('school_settings').upsert({ school_id: currentSchoolId, key: 'achv_excluded', value, updated_at: new Date().toISOString() }, { onConflict: 'school_id,key' });
  if (error) toast('تعذر الحفظ: ' + error.message, true);
}

/* ---------- البيانات ---------- */
async function loadManagerData() {
  const [src, snap, map, staff, exc] = await Promise.all([
    sb.from('achv_sources').select('xlsx_url, folder_url, updated_at').eq('school_id', currentSchoolId).maybeSingle(),
    sb.from('achv_snapshots').select('rows, rules, fetched_at, source, viewer, root').eq('school_id', currentSchoolId).maybeSingle(),
    sb.from('achv_teacher_map').select('folder_name, profile_id').eq('school_id', currentSchoolId),
    sb.from('profiles').select('id, full_name, role').eq('school_id', currentSchoolId).in('role', ['admin', 'deputy', 'teacher']).order('full_name'),
    sb.from('school_settings').select('value').eq('school_id', currentSchoolId).eq('key', 'achv_excluded').maybeSingle(),
  ]);
  if (src.error && /achv_|does not exist|schema cache/i.test(src.error.message || '')) { state.missingSql = true; return; }
  state.missingSql = false;
  state.source = src.data || null;
  state.snap = snap.data || null;
  state.map = new Map((map.data || []).filter(m => m.profile_id).map(m => [m.folder_name, m.profile_id]));
  state.staff = staff.data || [];
  state.excluded = new Set((exc && exc.data && exc.data.value && exc.data.value.ids) || []);
}

async function syncNow(silent = false) {
  if (state.source && state.source.folder_url) return scanFolder(silent);
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
        not_public: 'تعذّر فتح الملف دون تسجيل الدخول. تأكد من أن صلاحية رابط المشاركة هي «أي شخص لديه الرابط».',
        no_table: 'قُرئ الملف لكنه لا يحتوي على جدول النتائج. افتحه في Excel واضغط «تحديث الكل» ثم احفظ.',
        bad_url: 'يجب أن يكون الرابط رابط مشاركة من ون درايف أو SharePoint.',
        no_source: 'لا يوجد رابط محفوظ، أو ليست لديك صلاحية.',
        download: 'تعذّر تنزيل الملف من ون درايف. حاول مرة أخرى بعد قليل.',
        auth: 'انتهت الجلسة، سجّل دخول من جديد.',
      }[out.error] || 'تعذر التحديث (' + (out.error || r.status) + ')';
      if (out.at || out.title) console.warn('achv-sync', out);
      if (out.error === 'no_table' && out.sheets) msg += ' [الأوراق: ' + out.sheets.join(' ؛ ') + ']';
      if (out.error === 'not_public' && (out.at || out.title)) msg += ' [' + [out.at, out.type, out.title].filter(Boolean).join(' | ') + ']';
    }
  } catch (e) { msg = 'تعذر الاتصال بالخادم.'; }
  state.syncing = false;
  if (msg) { if (!silent) toast(msg, true); else state.lastError = msg; }
  await loadManagerData();
  if (state.snap) await saveGuessedLinks(teachersFromSnap());
  renderManager();
  if (!msg && !silent) toast('تم تحديث البيانات من ملف الإكسل');
}

async function scanFolder(silent = false) {
  if (state.syncing) return;
  if (!(await extReady()) || !extOk()) {
    state.lastError = 'القراءة من المجلد تحتاج إضافة مُدار (الإصدار 0.10 أو أحدث) في هذا المتصفح.';
    if (!silent) toast(state.lastError, true);
    renderManager(); return;
  }
  state.syncing = true; state.lastError = null;
  const btn = $('av-sync');
  if (btn) { btn.disabled = true; btn.textContent = 'جارٍ القراءة...'; }
  const r = await extCall('achvScan', { url: state.source.folder_url }, p => { const b = $('av-sync'); if (b) { b.disabled = true; b.textContent = `جارٍ القراءة: ${p.folders} مجلد · ${p.files} ملف`; } });
  let msg = null;
  if (!r.ok) msg = r.error || 'تعذّرت قراءة المجلد';
  else {
    const rows = rowsFromScan(r.data);
    const old = state.snap && state.snap.rules && state.snap.rules.length ? state.snap.rules : defaultRules(rows);
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('achv_snapshots').upsert({ school_id: currentSchoolId, rows, rules: old, fetched_at: new Date().toISOString(), fetched_by: user ? user.id : null, source: 'folder', viewer: r.data.viewer, root: r.data.root }, { onConflict: 'school_id' });
    if (error) msg = 'تعذر حفظ النتيجة: ' + error.message;
    else state.scanInfo = { files: rows.reduce((n, x) => n + x.files, 0), folders: r.data.folders.length };
  }
  state.syncing = false;
  if (msg) { state.lastError = msg; if (!silent) toast(msg, true); }
  await loadManagerData();
  if (state.snap) await saveGuessedLinks(teachersFromSnap());
  renderManager();
  if (!msg && !silent) toast(`تمت قراءة المجلد: ${state.scanInfo.files} ملف`);
}

/* ---------- واجهة المدير/الوكيل ---------- */
function sourceCard() {
  const s = state.source;
  if (!s || state.pickSource) return `
    <div class="form-card av-setup">
      <h3>مصدر ملفات الإنجاز</h3>
      <div class="av-src-opt rec">
        <b>القراءة من مجلد ون درايف مباشرة <span class="av-badge">موصى به</span></b>
        <p>افتح مجلد العام الدراسي في ون درايف (الذي يحتوي مجلدات التخصصات ثم المعلمين) وانسخ الرابط من شريط العنوان. تقرأ إضافة مُدار المجلد في متصفحك بحسابك في ون درايف، دون تعديل أي ملف، وتظهر الملفات هنا للاستعراض.</p>
        <div class="av-url-row"><input id="av-folder" type="url" dir="ltr" placeholder="https://...-my.sharepoint.com/my?id=/personal/.../العام" value="${esc((s && s.folder_url) || '')}"><button class="btn-primary" id="av-save-folder">حفظ وقراءة</button></div>
        ${extOk() ? '' : '<div class="av-note">تحتاج إضافة مُدار للمتصفح (الإصدار 0.10 أو أحدث) لقراءة المجلد.</div>'}
      </div>
      <details class="av-src-opt"${s && s.xlsx_url && !s.folder_url ? ' open' : ''}><summary>أو من ملف إكسل «قارئ ملفات الإنجاز»</summary>
        <p>الصق رابط مشاركة ملف الإكسل (أي شخص لديه الرابط - عرض فقط). المنصة تقرأ منه عدد ملفات كل بند لكل معلم.</p>
        <div class="av-url-row"><input id="av-url" type="url" dir="ltr" placeholder="https://...sharepoint.com/:x:/g/personal/..." value="${esc((s && s.xlsx_url) || '')}"><button class="btn-secondary" id="av-save-url">حفظ وقراءة</button></div>
      </details>
      ${s ? '<button class="text-action-btn" id="av-cancel-src">إلغاء</button>' : ''}
    </div>`;
  if (s.folder_url) {
    const snap = state.snap;
    const fileCount = snap ? (snap.rows || []).reduce((a, r) => a + (r.files || 0), 0) : 0;
    return `
    <div class="av-source">
      <div class="av-source-info">
        <span class="av-dot ${snap && snap.source === 'folder' && !state.lastError ? 'ok' : ''}"></span>
        <div><b>${snap && snap.source === 'folder' ? 'آخر قراءة للمجلد ' + esc(ago(snap.fetched_at)) + ' · ' + fileCount + ' ملف' : 'لم يُقرأ المجلد بعد'}</b>
        <span>${state.lastError ? esc(state.lastError) : 'المصدر: مجلد ون درايف مباشرة عبر إضافة مُدار في هذا المتصفح (قراءة فقط).'}</span></div>
      </div>
      <div class="av-source-actions">
        <button class="btn-primary" id="av-sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'جارٍ القراءة...' : 'تحديث من ون درايف'}</button>
        ${snap && snap.viewer ? `<a class="btn-secondary av-open-root" href="${esc(spLink(snap, '', true).replace(/%2F$/, ''))}" target="_blank" rel="noopener">فتح المجلد</a>` : ''}
        <button class="btn-secondary" id="av-change-url">تغيير المصدر</button>
      </div>
    </div>`;
  }
  const snap = state.snap;
  return `
    <div class="av-source">
      <div class="av-source-info">
        <span class="av-dot ${snap ? 'ok' : ''}"></span>
        <div><b>${snap ? 'آخر قراءة ' + esc(ago(snap.fetched_at)) : 'لم تتم القراءة بعد'}</b>
        <span>${state.lastError ? esc(state.lastError) : 'المصدر: ملف «قارئ ملفات الإنجاز» في ون درايف. حدّث ملف الإكسل من Excel أولًا إذا تغيّرت الملفات.'}</span></div>
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
  let list = teachers.filter(t => (!f.spec || t.spec === f.spec) && (!f.q || norm(t.name).includes(norm(f.q))) && (!f.unlinked || !t.profile));
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
    ${!reqRules.length ? '<div class="av-note">ورقة «البنود» في ملف الإكسل لا تحتوي على بنود إلزامية، لذا لا تُحتسب نسبة الإنجاز. حدّد الإلزامي من الإكسل.</div>' : ''}
    ${unlinked ? `<div class="av-note av-note-link"><span>⚠ ${unlinked} معلم لا يطابق اسم مجلده اسم حسابه في المنصة. اربطه من القائمة المجاورة لاسمه ليصله التذكير ويطّلع على ملفه.</span><button class="btn-secondary" id="av-only-unlinked">${f.unlinked ? 'عرض الكل' : 'عرض غير المربوطين'}</button></div>` : ''}
    <div class="av-toolbar">
      <input id="av-q" type="search" placeholder="بحث باسم المعلم" value="${esc(f.q)}">
      ${termsOf(state.snap && state.snap.rows).length > 1 ? `<select id="av-term">${termsOf(state.snap.rows).map(x => `<option ${x === f.term ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
      <select id="av-spec"><option value="">كل التخصصات</option>${specs.map(s => `<option ${s === f.spec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="av-sort">
        <option value="low" ${f.sort === 'low' ? 'selected' : ''}>الأقل إنجازًا أولًا</option>
        <option value="spec" ${f.sort === 'spec' ? 'selected' : ''}>حسب التخصص</option>
        <option value="name" ${f.sort === 'name' ? 'selected' : ''}>حسب الاسم</option>
      </select>
      <span class="av-grow"></span>
      <button class="btn-secondary" id="av-remind">تذكير الناقصين</button>
      <button class="btn-secondary" id="av-print">طباعة التقرير</button>
    </div>
    <div class="av-list">${list.length ? list.map(teacherRow).join('') : '<div class="av-empty">لا توجد نتائج.</div>'}</div>
    ${discoveredPanel()}
    ${state.excluded.size ? `<details class="av-excluded"><summary>المستبعدون من المتابعة (${state.excluded.size})</summary>${state.staff.filter(p => state.excluded.has(p.id)).map(p => `<div class="av-exc-row"><span>${esc(p.full_name)}</span><button class="text-action-btn av-restore" data-id="${p.id}">إرجاع</button></div>`).join('')}</details>` : ''}` : ''}`;
  bindManager();
}

// كل مجلدات المعلمين اللي لقاها الإكسل (كل الفصول) - للتأكد إن القراءة شملت الجميع
function discoveredPanel() {
  const rows = (state.snap && state.snap.rows) || [];
  if (!rows.length) return '';
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.teacher)) by.set(r.teacher, { spec: r.spec || '', files: 0, terms: new Map(), items: new Set() });
    const t = by.get(r.teacher);
    t.files += r.files || 0;
    if (r.term) t.terms.set(r.term, (t.terms.get(r.term) || 0) + (r.files || 0));
    if (r.item && r.item !== '(no item)') t.items.add(r.item);
  }
  const staffName = id => (state.staff.find(p => p.id === id) || {}).full_name || '';
  const list = [...by].sort((a, b) => a[1].spec.localeCompare(b[1].spec, 'ar') || a[0].localeCompare(b[0], 'ar'));
  return `<details class="av-excluded av-found"><summary>المعلمين المكتشفين في الملف (${list.length}) · ${rows.reduce((a, r) => a + (r.files || 0), 0)} ملف</summary>
    <div class="av-tablewrap"><table class="av-table"><thead><tr><th>#</th><th>اسم المجلد</th><th>التخصص</th><th>الملفات</th><th>البنود</th><th>حسب الفصل</th><th>الحساب المربوط</th></tr></thead><tbody>
    ${list.map(([name, t], i) => { const pid = state.map.get(name); return `<tr><td>${i + 1}</td><td>${esc(name)}</td><td>${esc(t.spec)}</td><td>${t.files}</td><td>${t.items.size}</td><td>${[...t.terms].map(([k, v]) => esc(k) + ': ' + v).join('، ') || '—'}</td><td>${pid ? esc(staffName(pid)) : '<span class="av-st part">غير مربوط</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></details>`;
}

function staffOptions(selected) {
  const guess = selected;
  return `<option value="">${selected ? '— إلغاء الربط —' : '⚠ اختر حساب المعلم'}</option>` + state.staff.map(p =>
    `<option value="${p.id}" ${p.id === guess ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('');
}
// اقتراح الحساب من اسم المجلد: أكثر حساب يشترك بالاسم الأول والأخير
function guessProfile(folder) {
  // ربط تلقائي فقط لما يتطابق الاسم (بعد تجاهل «بن» والمسافات والهمزات) مع حساب واحد بالضبط
  const key = n => norm(n).split(' ').filter(w => w && !['بن', 'ابن', 'بنت'].includes(w)).join(' ');
  const k = key(folder);
  if (!k) return null;
  const hits = state.staff.filter(p => key(p.full_name) === k);
  return hits.length === 1 ? hits[0].id : null;
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
        <span class="av-spec">${esc(t.spec || '—')}${stale != null ? ` · آخر تعديل ${stale === 0 ? 'اليوم' : `قبل ${stale} يوم`}` : t.noFolder ? '' : ' · لا توجد ملفات'}</span>
      </button>
      <div class="av-progress">${bar(ev.pct)}</div>
      <div class="av-missing">${ev.pct === 100 ? '<span class="av-chip ok">كل البنود الإلزامية مكتملة</span>' : chips}</div>
      ${t.noFolder ? `<div class="av-nofolder-box"><span class="av-nofolder">لم نجد ملفات باسمه</span><button class="text-action-btn av-exclude" data-id="${t.profile}" title="إخفاؤه من متابعة ملفات الإنجاز (إداري، مرشد طلابي...)">ليس معلمًا؟ استبعاد</button></div>` : `<select class="av-link ${t.profile ? '' : 'need'}" data-folder="${esc(t.name)}" title="ربط المجلد بحساب المعلم" aria-label="ربط ${esc(t.name)} بحساب">${staffOptions(t.profile)}</select>`}
    </div>
    ${open ? teacherDetail(t) : ''}
  </div>`;
}

function filesCell(list, n) {
  return list && list.length ? `<button type="button" class="av-files-btn" aria-expanded="false">${n} <span>ملف ▾</span></button>` : String(n);
}
function filesRow(snap, list, folder) {
  if (!list || !list.length) return '';
  return `<tr class="av-files-row" hidden><td colspan="5"><div class="av-files">
    ${list.map(f => { const k = EXT_KIND[fileExt(f.r)] || 'other'; const href = spLink(snap, f.r); return `<a class="av-file" ${href ? `href="${esc(href)}" target="_blank" rel="noopener"` : ''} title="${esc(fileName(f.r))}">
      <span class="av-ext ${k}">${esc(fileExt(f.r).toUpperCase() || 'ملف')}</span><span class="av-fn">${esc(fileName(f.r))}</span><small>${esc(fmtDT(f.t, false))}${f.s ? ' · ' + fmtSize(f.s) : ''}</small></a>`; }).join('')}
    ${folder && spLink(snap, folder, true) ? `<a class="av-file av-file-folder" href="${esc(spLink(snap, folder, true))}" target="_blank" rel="noopener"><span class="av-ext folder">📁</span><span class="av-fn">فتح مجلد البند في ون درايف</span></a>` : ''}
  </div></td></tr>`;
}
function itemsTable(ev, snap = state.snap) {
  return `<div class="av-tablewrap"><table class="av-table"><thead><tr><th>البند</th><th>الملفات</th><th>المطلوب</th><th>الحالة</th><th>آخر تعديل</th></tr></thead><tbody>
    ${ev.items.map(x => `<tr class="${x.rule.required ? '' : 'opt'}"><td>${x.rule.no != null ? x.rule.no + '- ' : ''}${esc(x.rule.name)}${x.rule.required ? '' : ' <small>(اختياري)</small>'}</td>
      <td>${filesCell(x.list, x.files)}</td><td>${x.rule.min}</td><td><span class="av-st ${x.status}">${ST_LABEL[x.status]}</span></td><td>${esc(fmtDT(x.modified, false))}</td></tr>${filesRow(snap, x.list, x.folder)}`).join('')}
    ${ev.extra.filter(r => r.files || !r.list).map(r => `<tr class="extra"><td>${esc(r.item)} <small>(غير موجود بقائمة البنود)</small></td><td>${filesCell(r.list, r.files)}</td><td>—</td><td>—</td><td>${esc(fmtDT(r.modified, false))}</td></tr>${filesRow(snap, r.list, null)}`).join('')}
  </tbody></table></div>`;
}
// فتح وإغلاق قائمة ملفات البند دون إعادة رسم الصفحة
function bindFiles(el) {
  el.querySelectorAll('.av-files-btn').forEach(b => b.onclick = () => {
    const row = b.closest('tr').nextElementSibling;
    if (!row || !row.classList.contains('av-files-row')) return;
    row.hidden = !row.hidden; b.setAttribute('aria-expanded', String(!row.hidden));
  });
}
function teacherDetail(t) { return `<div class="av-detail">${itemsTable(t.ev)}</div>`; }

function bindManager() {
  const save = $('av-save-url');
  if (save) save.onclick = saveUrl;
  const sync = $('av-sync');
  if (sync) sync.onclick = () => syncNow(false);
  const ch = $('av-change-url');
  if (ch) ch.onclick = () => { state.pickSource = true; renderManager(); const u = $('av-folder'); if (u) u.focus(); };
  const cs = $('av-cancel-src'); if (cs) cs.onclick = () => { state.pickSource = false; renderManager(); };
  const sf = $('av-save-folder'); if (sf) sf.onclick = saveFolder;
  bindFiles(root());
  const q = $('av-q');
  if (q) q.oninput = () => { state.filter.q = q.value; const pos = q.selectionStart; renderManager(); const n = $('av-q'); n.focus(); n.setSelectionRange(pos, pos); };
  root().querySelectorAll('.av-exclude').forEach(b => b.onclick = async () => { state.excluded.add(b.dataset.id); await saveExcluded(); renderManager(); toast('تم استبعاده من متابعة ملفات الإنجاز'); });
  root().querySelectorAll('.av-restore').forEach(b => b.onclick = async () => { state.excluded.delete(b.dataset.id); await saveExcluded(); renderManager(); });
  const ou = $('av-only-unlinked'); if (ou) ou.onclick = () => { state.filter.unlinked = !state.filter.unlinked; renderManager(); };
  const tm = $('av-term'); if (tm) tm.onchange = () => { state.filter.term = tm.value; renderManager(); };
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

async function saveFolder() {
  const v = ($('av-folder').value || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.sharepoint\.com\//i.test(v)) { toast('الصق رابط المجلد من ون درايف (يبدأ بـ https:// وفيه sharepoint.com)', true); return; }
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('achv_sources').upsert({ school_id: currentSchoolId, folder_url: v, updated_by: user ? user.id : null, updated_at: new Date().toISOString() }, { onConflict: 'school_id' });
  if (error) { toast('تعذر حفظ الرابط: ' + error.message, true); return; }
  state.source = { ...(state.source || {}), folder_url: v };
  state.pickSource = false;
  renderManager();
  scanFolder(false);
}

async function saveUrl() {
  const v = ($('av-url').value || '').trim();
  if (!/^https:\/\/[^/]*(sharepoint\.com|1drv\.ms|onedrive\.live\.com)\//i.test(v)) { toast('الصق رابط مشاركة من ون درايف (يبدأ بـ https:// وفيه sharepoint.com)', true); return; }
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('achv_sources').upsert({ school_id: currentSchoolId, xlsx_url: v, folder_url: null, updated_by: user ? user.id : null, updated_at: new Date().toISOString() }, { onConflict: 'school_id' });
  if (error) { toast('تعذر حفظ الرابط: ' + error.message, true); return; }
  state.source = { xlsx_url: v };
  state.pickSource = false;
  renderManager();
  syncNow(false);
}

async function saveLink(folder, profileId, sel) {
  const res = profileId
    ? await sb.from('achv_teacher_map').upsert({ school_id: currentSchoolId, folder_name: folder, profile_id: profileId }, { onConflict: 'school_id,folder_name' })
    : await sb.from('achv_teacher_map').delete().eq('school_id', currentSchoolId).eq('folder_name', folder);
  if (res.error) { toast('تعذر حفظ الربط: ' + res.error.message, true); return; }
  if (profileId) state.map.set(folder, profileId); else state.map.delete(folder);
  renderManager();
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
      ${linked.length ? `<p>يصل كل معلم تنبيه في المنصة وإشعار على الجوال يتضمن بنوده الناقصة فقط.</p>
      <label class="av-check-all"><input type="checkbox" id="av-all" checked> تحديد الكل (${linked.length})</label>
      <div class="av-pick">${linked.map(t => `<label><input type="checkbox" class="av-pick-cb" value="${esc(t.name)}" checked><span>${esc(t.name)}</span><small>${t.ev.missing.length} بند ناقص</small></label>`).join('')}</div>`
      : '<p>لا يوجد معلم مرتبط بحساب لديه نقص.</p>'}
      ${unl.length ? `<p class="av-warn">${unl.length} مجلد لديه نقص لكنه غير مرتبط بحساب، فلن يصله تذكير: ${unl.slice(0, 5).map(t => esc(t.name)).join('، ')}${unl.length > 5 ? '…' : ''}</p>` : ''}
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
      const lines = t.ev.missing.map(x => `• ${x.rule.name}${x.rule.min > 1 || x.files ? ` (لديك ${x.files} من ${x.rule.min})` : ''}`);
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
  <h1>متابعة ملفات الإنجاز${state.filter.term ? ' - ' + esc(state.filter.term) : ''}${state.filter.spec ? ' - ' + esc(state.filter.spec) : ''}</h1>
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
  const myTerms = termsOf(data.rows);
  const myTerm = myTerms[myTerms.length - 1] || '';
  const ev = evaluateTeacher((data.rows || []).filter(r => !myTerm || !r.term || r.term === myTerm), data.rules || []);
  el.innerHTML = `
    <div class="form-card av-mine">
      <div class="av-mine-head">
        <div><h3>ملف إنجازي${myTerm ? ' - ' + esc(myTerm) : ''}</h3><span>آخر قراءة ${data.fetched_at ? esc(ago(data.fetched_at)) : '—'}</span></div>
        <div class="av-progress big">${bar(ev.pct)}</div>
      </div>
      ${ev.missing.length ? `<div class="av-note">نأمل إكمال: ${ev.missing.map(x => esc(x.rule.name) + (x.rule.min > 1 ? ` (${x.files}/${x.rule.min})` : '')).join('، ')}</div>`
        : ev.req.length ? '<div class="av-note good">كل البنود الإلزامية مكتملة. شكرًا لك.</div>' : ''}
      ${itemsTable(ev, data)}
      <p class="av-hint">البيانات تُقرأ من مجلدك في ون درايف. بعد إضافتك للملفات، تظهر هنا بعد التحديث القادم من الإدارة.</p>
    </div>`;
  bindFiles(el);
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
  if (state.source && (!state.snap || (Date.now() - new Date(state.snap.fetched_at)) / 60000 > AUTO_SYNC_MIN)) {
    if (!state.source.folder_url) syncNow(true);
    else if (await extReady() && extOk()) scanFolder(true);
  }
}
