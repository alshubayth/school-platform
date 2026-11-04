/* =========================================================================
 * المشاركة المؤقتة: محادثة قصيرة العمر لنقل النصوص والملفات بين أجهزتك أو مع زملائك في المدرسة.
 * - كل مشاركة لها مدة (ساعة افتراضيًا، وبحد أقصى ٢٤ ساعة)، وبعدها تُحذف المحادثة وملفاتها نهائيًا
 *   (دالة drop-cleanup تعمل كل ١٠ دقائق، والصلاحيات تمنع الوصول بعد انتهاء المدة مباشرة).
 * - «بين أجهزتي»: مشاركة بلا أعضاء، تفتحها من الجوال والكمبيوتر بالحساب نفسه (ورمز QR للفتح السريع).
 * الجداول: drop_rooms / drop_items، والملفات في مستودع drops/<room>/...
 * ========================================================================= */
import { sb, currentUserId, currentSchoolId, siteBase, setSubRoute, backToTiles } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_FILE = 50 * 1024 * 1024;
const DURS = [[15, '15 دقيقة'], [60, 'ساعة'], [180, '3 ساعات'], [1440, '24 ساعة']];
const fmtSize = b => (b < 1024 ? b + ' بايت' : b < 1048576 ? (b / 1024).toFixed(0) + ' ك.ب' : (b / 1048576).toFixed(1) + ' م.ب');
const extOf = n => (String(n).match(/\.([a-z0-9]{1,6})$/i) || [, ''])[1].toLowerCase();
const KIND = e => (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'svg'].includes(e) ? 'img' : e === 'pdf' ? 'pdf' : ['doc', 'docx'].includes(e) ? 'doc' : ['xls', 'xlsx', 'csv'].includes(e) ? 'xls' : ['ppt', 'pptx'].includes(e) ? 'ppt' : ['zip', 'rar', '7z'].includes(e) ? 'zip' : ['mp4', 'mov', 'webm'].includes(e) ? 'vid' : ['mp3', 'm4a', 'wav', 'ogg'].includes(e) ? 'aud' : 'file');
const KIND_TXT = { img: 'صورة', pdf: 'PDF', doc: 'Word', xls: 'Excel', ppt: 'عرض', zip: 'مضغوط', vid: 'فيديو', aud: 'صوت', file: 'ملف' };
const leftTxt = ms => { if (ms <= 0) return 'انتهت'; const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000); return m >= 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m}:${String(s).padStart(2, '0')}`; };
const clock = iso => new Date(iso).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });

let S = { rooms: [], people: new Map(), room: null, items: [], poll: null, tick: null, busy: 0 };

/* ---------- الدخول للقسم ---------- */
export async function loadDropModule(sub) {
  const root = $('drop-root');
  root.innerHTML = '<div class="tx-loading"><span></span><span></span><span></span></div>';
  const back = $('back-to-tiles-drop'); if (back) back.onclick = () => { stop(); backToTiles(); };
  sb.functions.invoke('drop-cleanup').catch(() => {});
  await loadPeople();
  await loadRooms();
  if (sub && S.rooms.some(r => r.id === sub)) openRoom(sub);
  else { S.room = null; render(); }
}
async function loadPeople() {
  if (S.people.size) return;
  let q = sb.from('profiles').select('id, full_name, role').in('role', ['admin', 'deputy', 'teacher', 'owner']).order('full_name');
  if (currentSchoolId) q = q.eq('school_id', currentSchoolId);
  const { data } = await q;
  S.people = new Map((data || []).map(p => [p.id, p]));
}
async function loadRooms() {
  const { data } = await sb.from('drop_rooms').select('id, title, created_by, member_ids, expires_at, created_at').order('created_at', { ascending: false });
  S.rooms = (data || []).filter(r => new Date(r.expires_at) > new Date());
}
const nameOf = id => (id === currentUserId ? 'أنا' : (S.people.get(id) || {}).full_name || 'مستخدم');
const short = n => String(n || '').split(' ').filter((w, i, a) => i === 0 || i === a.length - 1).join(' ');
const roomTitle = r => r.title || (!r.member_ids.length && r.created_by === currentUserId ? 'بين أجهزتي' : r.created_by === currentUserId ? 'مع ' + r.member_ids.map(id => short(nameOf(id))).join('، ') : 'من ' + short(nameOf(r.created_by)));
function stop() { clearInterval(S.poll); clearInterval(S.tick); S.poll = S.tick = null; }
const alive = () => { const m = $('drop-module'); return m && !m.classList.contains('hidden'); };

/* ---------- الرسم ---------- */
function render() {
  const root = $('drop-root');
  root.innerHTML = `<div class="dp${S.room ? ' has-room' : ''}">
    <aside class="dp-side">
      <div class="dp-hero"><div class="dp-hero-i">⇄</div><div><h3>المشاركة المؤقتة</h3><p>انقل نصًا أو ملفًا بين جوالك وكمبيوترك، أو شاركه مع زميل. يُحذف كل شيء تلقائيًا عند انتهاء المدة.</p></div></div>
      <div class="dp-new"><button type="button" class="dp-btn big" data-new="self"><span>📲</span><b>بين أجهزتي</b><small>من الجوال إلى الكمبيوتر أو العكس</small></button>
        <button type="button" class="dp-btn big alt" data-new="people"><span>👥</span><b>مع زميل</b><small>أرسل ملفًا أو نصًا لشخص في المدرسة</small></button></div>
      <h4 class="dp-h">المشاركات النشطة <i>${S.rooms.length}</i></h4>
      <div class="dp-list">${S.rooms.map(r => roomCard(r)).join('') || '<div class="dp-empty">لا توجد مشاركات نشطة. ابدأ مشاركة جديدة، وستُحذف تلقائيًا بعد انتهاء مدتها.</div>'}</div>
    </aside>
    <section class="dp-main" id="dp-main">${S.room ? roomView() : `<div class="dp-placeholder"><div class="dp-orb"><span>⇄</span></div><b>اختر مشاركة أو ابدأ مشاركة جديدة</b><p>افتح «بين أجهزتي» على الكمبيوتر، ثم امسح رمز QR بجوالك لتفتح المشاركة نفسها مباشرة.</p></div>`}</section>
  </div>`;
  root.querySelectorAll('[data-new]').forEach(b => b.onclick = () => openCreate(b.dataset.new));
  root.querySelectorAll('[data-room]').forEach(b => b.onclick = () => openRoom(b.dataset.room));
  if (S.room) bindRoom();
  startTick();
}
function roomCard(r) {
  const left = new Date(r.expires_at) - Date.now(), total = new Date(r.expires_at) - new Date(r.created_at);
  const mine = r.created_by === currentUserId, self = mine && !r.member_ids.length;
  return `<button type="button" class="dp-rc${S.room && S.room.id === r.id ? ' on' : ''}${!mine ? ' in' : ''}" data-room="${r.id}">
    <span class="dp-rc-i">${self ? '📲' : mine ? '📤' : '📥'}</span>
    <span class="dp-rc-t"><b>${esc(roomTitle(r))}</b><small>${self ? 'جوالك وكمبيوترك' : mine ? `${r.member_ids.length} ${r.member_ids.length === 1 ? 'مستلم' : 'مستلمين'}` : 'شاركها معك'}</small></span>
    <span class="dp-rc-c" data-exp="${r.expires_at}" data-tot="${total}"><i style="--p:${Math.max(0, Math.min(1, left / total)) * 100}%"></i><em>${leftTxt(left)}</em></span>
  </button>`;
}

/* ---------- إنشاء مشاركة ---------- */
function openCreate(mode) {
  const picked = new Set();
  let dur = 60;
  const m = document.createElement('div'); m.className = 'dp-modal';
  const draw = () => {
    const q = (m.querySelector('#dp-q') || {}).value || '';
    const list = [...S.people.values()].filter(p => p.id !== currentUserId && (!q || p.full_name.includes(q.trim())));
    m.innerHTML = `<div class="dp-modal-b" role="dialog" aria-label="مشاركة جديدة">
      <header><b>${mode === 'self' ? '📲 مشاركة بين أجهزتي' : '👥 مشاركة مع زملاء'}</b><button type="button" class="dp-x" data-x aria-label="إغلاق">✕</button></header>
      ${mode === 'self' ? '<p class="dp-note">مشاركة خاصة بك وحدك. افتحها على الكمبيوتر وامسح رمز QR بالجوال (أو العكس)، ثم أرسل ما تريد.</p>' : `
      <label class="dp-lbl">المستلمون <small>${picked.size ? picked.size + ' محدد' : 'اختر شخصًا أو أكثر'}</small></label>
      <div class="dp-chips">${[...picked].map(id => `<button type="button" data-un="${id}">${esc(nameOf(id))} ✕</button>`).join('')}</div>
      <input type="search" id="dp-q" class="dp-in" placeholder="ابحث باسم الزميل" value="${esc(q)}" autocomplete="off">
      <div class="dp-people">${list.slice(0, 60).map(p => `<button type="button" data-pick="${p.id}" class="${picked.has(p.id) ? 'on' : ''}"><span class="dp-av">${esc(p.full_name.trim().charAt(0))}</span>${esc(p.full_name)}</button>`).join('') || '<div class="dp-empty">لا توجد نتائج</div>'}</div>`}
      <label class="dp-lbl">تُحذف بعد</label>
      <div class="dp-seg">${DURS.map(([v, t]) => `<button type="button" data-dur="${v}" class="${dur === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <label class="dp-lbl">عنوان <small>(اختياري)</small></label><input type="text" id="dp-title" class="dp-in" maxlength="60" placeholder="${mode === 'self' ? 'مثال: ملفات الاجتماع' : 'مثال: كشوف الدرجات'}">
      <footer><button type="button" class="dp-btn" id="dp-create" ${mode === 'people' && !picked.size ? 'disabled' : ''}>بدء المشاركة</button></footer></div>`;
    m.querySelector('[data-x]').onclick = () => m.remove();
    m.querySelectorAll('[data-dur]').forEach(b => b.onclick = () => { dur = +b.dataset.dur; keepDraw(); });
    m.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { picked.has(b.dataset.pick) ? picked.delete(b.dataset.pick) : picked.add(b.dataset.pick); keepDraw(); });
    m.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { picked.delete(b.dataset.un); keepDraw(); });
    const qi = m.querySelector('#dp-q'); if (qi) qi.oninput = () => { const pos = qi.selectionStart; keepDraw(); const n = m.querySelector('#dp-q'); n.focus(); n.setSelectionRange(pos, pos); };
    m.querySelector('#dp-create').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'جارٍ الإنشاء...';
      const title = m.querySelector('#dp-title').value.trim() || null;
      const { data, error } = await sb.from('drop_rooms').insert({ title, member_ids: [...picked], expires_at: new Date(Date.now() + dur * 60000).toISOString() }).select('id, title, created_by, member_ids, expires_at, created_at').single();
      if (error) { e.target.disabled = false; e.target.textContent = 'بدء المشاركة'; alert('تعذر إنشاء المشاركة: ' + error.message); return; }
      m.remove();
      S.rooms.unshift(data);
      openRoom(data.id, mode === 'self');
    };
  };
  let title = '';
  const keepDraw = () => { const t = m.querySelector('#dp-title'); if (t) title = t.value; draw(); const t2 = m.querySelector('#dp-title'); if (t2) t2.value = title; };
  draw();
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  const f = m.querySelector('#dp-q') || m.querySelector('#dp-title'); if (f && matchMedia('(min-width:700px)').matches) f.focus();
}

/* ---------- غرفة المشاركة ---------- */
async function openRoom(id, showQr = false) {
  S.room = S.rooms.find(r => r.id === id) || null;
  if (!S.room) { render(); return; }
  S.items = [];
  setSubRoute(id, true);
  render();
  await fetchItems();
  clearInterval(S.poll);
  S.poll = setInterval(() => { if (!alive()) { stop(); return; } if (!document.hidden) fetchItems(); }, 4000);
  if (showQr) openQr();
}
async function fetchItems() {
  if (!S.room) return;
  const rid = S.room.id;
  const { data, error } = await sb.from('drop_items').select('id, sender_id, kind, body, path, name, size, mime, created_at').eq('room_id', rid).order('created_at');
  if (!S.room || S.room.id !== rid) return;
  if (error) return;
  const before = S.items.map(x => x.id).join();
  S.items = data || [];
  if (S.items.map(x => x.id).join() !== before) paintItems(true);
}
function roomView() {
  const r = S.room, mine = r.created_by === currentUserId, self = mine && !r.member_ids.length;
  const members = [r.created_by, ...r.member_ids];
  return `<div class="dp-room" id="dp-room">
    <header class="dp-rh">
      <button type="button" class="dp-back" id="dp-back" aria-label="رجوع">→</button>
      <div class="dp-rh-t"><b>${esc(roomTitle(r))}</b><small>${self ? 'خاصة بك · افتحها من جهاز آخر بالحساب نفسه' : members.map(id => esc(short(nameOf(id)))).join('، ')}</small></div>
      <div class="dp-timer" id="dp-timer"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="tr"/><circle cx="18" cy="18" r="15" class="fg" id="dp-timer-c"/></svg><span id="dp-timer-t"></span></div>
      <div class="dp-rh-a">
        <button type="button" class="dp-ib" id="dp-qr" title="افتح على جهاز آخر">▦ <span>جهاز آخر</span></button>
        ${mine ? '<button type="button" class="dp-ib" id="dp-ext" title="تمديد المدة ساعة">＋ <span>ساعة</span></button><button type="button" class="dp-ib danger" id="dp-del" title="حذف المشاركة الآن">🗑 <span>حذف الآن</span></button>' : ''}
      </div>
    </header>
    <div class="dp-feed" id="dp-feed"></div>
    <div class="dp-drop-hint" id="dp-drop-hint"><b>أفلت الملفات هنا</b><span>تُرفع وتُحذف تلقائيًا بانتهاء المدة</span></div>
    <div class="dp-up" id="dp-up"></div>
    <footer class="dp-comp">
      <label class="dp-attach" title="إرفاق ملفات"><input type="file" id="dp-file" multiple hidden>📎</label>
      <textarea id="dp-text" rows="1" placeholder="اكتب نصًا أو أرفق ملفًا" aria-label="النص"></textarea>
      <button type="button" class="dp-send" id="dp-send" aria-label="إرسال">➤</button>
    </footer>
  </div>`;
}
function paintItems(scroll = false) {
  const feed = $('dp-feed'); if (!feed) return;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  feed.innerHTML = S.items.length ? S.items.map(itemHtml).join('') : `<div class="dp-feed-empty"><span>✦</span><b>المشاركة جاهزة</b><p>أرسل نصًا أو أرفق ملفات (حتى 50 م.ب للملف)، أو اسحبها وأفلتها هنا.</p></div>`;
  feed.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => download(b.dataset.dl));
  feed.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const it = S.items.find(x => x.id === b.dataset.copy); try { await navigator.clipboard.writeText(it.body); b.textContent = '✓ نُسخ'; setTimeout(() => { b.textContent = 'نسخ'; }, 1400); } catch { /* */ } });
  feed.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeItem(b.dataset.rm));
  feed.querySelectorAll('img[data-thumb]').forEach(loadThumb);
  if (scroll && (atBottom || S.justSent)) { feed.scrollTop = feed.scrollHeight; S.justSent = false; }
}
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
function itemHtml(it) {
  const mine = it.sender_id === currentUserId, canRm = mine || S.room.created_by === currentUserId;
  const who = S.room.member_ids.length ? `<span class="dp-who">${esc(short(nameOf(it.sender_id)))}</span>` : '';
  if (it.kind === 'text') return `<div class="dp-msg ${mine ? 'me' : 'them'}"><div class="dp-bub">${who}<div class="dp-tx">${linkify(it.body)}</div><div class="dp-meta"><span>${clock(it.created_at)}</span><button type="button" data-copy="${it.id}">نسخ</button>${canRm ? `<button type="button" data-rm="${it.id}">حذف</button>` : ''}</div></div></div>`;
  const k = KIND(extOf(it.name));
  return `<div class="dp-msg ${mine ? 'me' : 'them'}"><div class="dp-bub file">${who}
    ${k === 'img' ? `<button type="button" class="dp-thumb" data-dl="${it.id}"><img data-thumb="${esc(it.path)}" alt="${esc(it.name)}"></button>` : ''}
    <div class="dp-file"><span class="dp-fi k-${k}">${esc(extOf(it.name).toUpperCase() || KIND_TXT[k])}</span><span class="dp-fn"><b>${esc(it.name)}</b><small>${KIND_TXT[k]} · ${fmtSize(it.size || 0)}</small></span><button type="button" class="dp-dl" data-dl="${it.id}">⬇ تنزيل</button></div>
    <div class="dp-meta"><span>${clock(it.created_at)}</span>${canRm ? `<button type="button" data-rm="${it.id}">حذف</button>` : ''}</div></div></div>`;
}
const thumbCache = new Map();
async function loadThumb(img) {
  const p = img.dataset.thumb;
  if (thumbCache.has(p)) { img.src = thumbCache.get(p); return; }
  const { data } = await sb.storage.from('drops').createSignedUrl(p, 3600);
  if (data && data.signedUrl) { thumbCache.set(p, data.signedUrl); img.src = data.signedUrl; }
}
async function download(id) {
  const it = S.items.find(x => x.id === id); if (!it) return;
  const { data, error } = await sb.storage.from('drops').createSignedUrl(it.path, 300, { download: it.name });
  if (error || !data) { toast('تعذر التنزيل، ربما انتهت المشاركة'); return; }
  const a = document.createElement('a'); a.href = data.signedUrl; a.download = it.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
async function removeItem(id) {
  const it = S.items.find(x => x.id === id); if (!it || !confirm('حذف هذا العنصر من المشاركة؟')) return;
  if (it.path) await sb.storage.from('drops').remove([it.path]);
  await sb.from('drop_items').delete().eq('id', id);
  S.items = S.items.filter(x => x.id !== id); paintItems();
}

function bindRoom() {
  paintItems(true);
  const txt = $('dp-text'), room = $('dp-room');
  const grow = () => { txt.style.height = 'auto'; txt.style.height = Math.min(160, txt.scrollHeight) + 'px'; };
  txt.oninput = grow;
  txt.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendText(); } };
  txt.onpaste = e => { const fs = [...(e.clipboardData && e.clipboardData.files || [])]; if (fs.length) { e.preventDefault(); upload(fs); } };
  $('dp-send').onclick = sendText;
  $('dp-file').onchange = e => { upload([...e.target.files]); e.target.value = ''; };
  $('dp-back').onclick = () => { stop(); S.room = null; setSubRoute(null, true); render(); };
  $('dp-qr').onclick = openQr;
  const ext = $('dp-ext'); if (ext) ext.onclick = extend;
  const del = $('dp-del'); if (del) del.onclick = deleteRoom;
  let depth = 0;
  room.ondragenter = e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; room.classList.add('drag'); } };
  room.ondragleave = () => { depth = Math.max(0, depth - 1); if (!depth) room.classList.remove('drag'); };
  room.ondragover = e => e.preventDefault();
  room.ondrop = e => { e.preventDefault(); depth = 0; room.classList.remove('drag'); const fs = [...(e.dataTransfer.files || [])]; if (fs.length) upload(fs); };
}
async function sendText() {
  const txt = $('dp-text'); const body = txt.value.trim(); if (!body || !S.room) return;
  txt.value = ''; txt.style.height = 'auto';
  const { error } = await sb.from('drop_items').insert({ room_id: S.room.id, kind: 'text', body });
  if (error) { txt.value = body; toast(expiredErr(error) ? 'انتهت مدة المشاركة' : 'تعذر الإرسال: ' + error.message); return; }
  S.justSent = true; fetchItems();
}
const expiredErr = e => /row-level|policy|violates/i.test((e && e.message) || '');
async function upload(files) {
  if (!S.room) return;
  const up = $('dp-up');
  for (const f of files) {
    if (f.size > MAX_FILE) { toast(`«${f.name}» أكبر من 50 م.ب`); continue; }
    const row = document.createElement('div'); row.className = 'dp-upr'; row.innerHTML = `<span class="dp-spin"></span><b>${esc(f.name)}</b><small>${fmtSize(f.size)}</small>`;
    up.appendChild(row);
    const e = extOf(f.name);
    const path = `${S.room.id}/${crypto.randomUUID()}${e ? '.' + e : ''}`;
    const { error } = await sb.storage.from('drops').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (!error) {
      const { error: e2 } = await sb.from('drop_items').insert({ room_id: S.room.id, kind: 'file', path, name: f.name || 'ملف', size: f.size, mime: f.type || null });
      if (e2) { await sb.storage.from('drops').remove([path]); toast('تعذر حفظ الملف: ' + e2.message); }
    } else toast(expiredErr(error) ? 'انتهت مدة المشاركة' : `تعذر رفع «${f.name}»: ${error.message}`);
    row.remove();
    S.justSent = true; await fetchItems();
  }
}
async function extend() {
  const r = S.room; const base = Math.max(Date.now(), new Date(r.expires_at).getTime());
  const next = new Date(Math.min(base + 3600000, Date.now() + 24 * 3600000)).toISOString();
  const { data, error } = await sb.from('drop_rooms').update({ expires_at: next }).eq('id', r.id).select('expires_at').single();
  if (error) { toast('تعذر التمديد'); return; }
  r.expires_at = data.expires_at; toast('مُددت المشاركة ساعة ✓'); startTick();
}
async function deleteRoom() {
  if (!confirm('حذف المشاركة وجميع ملفاتها الآن؟ لا يمكن التراجع.')) return;
  const r = S.room;
  const paths = S.items.filter(x => x.path).map(x => x.path);
  if (paths.length) await sb.storage.from('drops').remove(paths);
  await sb.from('drop_rooms').delete().eq('id', r.id);
  stop(); S.rooms = S.rooms.filter(x => x.id !== r.id); S.room = null; setSubRoute(null, true); render(); toast('حُذفت المشاركة');
}
function onExpired() {
  const r = S.room; stop();
  S.rooms = S.rooms.filter(x => new Date(x.expires_at) > new Date());
  if (r && new Date(r.expires_at) <= new Date()) { S.room = null; setSubRoute(null, true); render(); toast('انتهت مدة المشاركة وحُذفت'); sb.functions.invoke('drop-cleanup').catch(() => {}); }
  else render();
}
function startTick() {
  clearInterval(S.tick);
  const step = () => {
    if (!alive()) { stop(); return; }
    document.querySelectorAll('.dp-rc-c').forEach(el => { const left = new Date(el.dataset.exp) - Date.now(); el.querySelector('em').textContent = leftTxt(left); el.querySelector('i').style.setProperty('--p', Math.max(0, Math.min(1, left / +el.dataset.tot)) * 100 + '%'); });
    if (S.room) {
      const left = new Date(S.room.expires_at) - Date.now(), tot = Math.max(1, new Date(S.room.expires_at) - new Date(S.room.created_at));
      const t = $('dp-timer-t'), c = $('dp-timer-c'), w = $('dp-timer');
      if (t) { t.textContent = leftTxt(left); c.style.strokeDashoffset = String(94.25 * (1 - Math.max(0, Math.min(1, left / tot)))); w.classList.toggle('low', left < 5 * 60000); }
      if (left <= 0) { onExpired(); return; }
    } else if (S.rooms.some(r => new Date(r.expires_at) <= new Date())) { onExpired(); return; }
  };
  step(); S.tick = setInterval(step, 1000);
}

/* ---------- QR للفتح من جهاز آخر ---------- */
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function openQr() {
  const url = siteBase() + '#/drop/' + S.room.id;
  const m = document.createElement('div'); m.className = 'dp-modal';
  m.innerHTML = `<div class="dp-modal-b dp-qrb"><header><b>افتح المشاركة على جهاز آخر</b><button type="button" class="dp-x" data-x aria-label="إغلاق">✕</button></header>
    <div class="dp-qr" id="dp-qr-box"><div class="tx-loading"><span></span><span></span><span></span></div></div>
    <p class="dp-note">امسح الرمز بكاميرا الجوال، وسجّل الدخول بحساب ${S.room.member_ids.length ? 'أحد المشاركين' : 'مُدار نفسه'} إن طُلب منك.</p>
    <div class="dp-link"><input class="dp-in" readonly value="${esc(url)}"><button type="button" class="dp-btn" id="dp-cp">نسخ الرابط</button></div></div>`;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-x]')) m.remove(); };
  document.body.appendChild(m);
  m.querySelector('#dp-cp').onclick = async e => { try { await navigator.clipboard.writeText(url); e.target.textContent = '✓ نُسخ'; } catch { m.querySelector('input').select(); } };
  try { await loadQrLib(); const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make(); m.querySelector('#dp-qr-box').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  catch { m.querySelector('#dp-qr-box').innerHTML = '<p class="dp-note">تعذر إنشاء الرمز، استخدم الرابط.</p>'; }
}

function toast(t) {
  let el = $('dp-toast'); if (!el) { el = document.createElement('div'); el.id = 'dp-toast'; el.className = 'dp-toast'; document.body.appendChild(el); }
  el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- تنبيه المشاركات الواردة (يعمل في أي صفحة) ---------- */
let seen = null;
export function initDropBadge(openTile) {
  const check = async () => {
    if (document.hidden) return;
    const { data } = await sb.from('drop_rooms').select('id, created_by, title, expires_at').neq('created_by', currentUserId);
    const list = (data || []).filter(r => new Date(r.expires_at) > new Date());
    if (seen === null) { try { seen = new Set(JSON.parse(sessionStorage.getItem('dp-seen') || '[]')); } catch { seen = new Set(); } }
    const fresh = list.filter(r => !seen.has(r.id));
    if (!fresh.length || alive()) { fresh.forEach(r => seen.add(r.id)); save(); return; }
    await loadPeople();
    const r = fresh[0];
    let el = $('dp-incoming'); if (!el) { el = document.createElement('button'); el.type = 'button'; el.id = 'dp-incoming'; el.className = 'dp-incoming'; document.body.appendChild(el); }
    el.innerHTML = `<span>📥</span><b>${esc(short(nameOf(r.created_by)))} شاركك ${r.title ? '«' + esc(r.title) + '»' : 'ملفات مؤقتة'}</b><em>فتح</em><i data-close aria-label="إخفاء">✕</i>`;
    el.classList.add('show');
    el.onclick = e => { fresh.forEach(x => seen.add(x.id)); save(); el.classList.remove('show'); if (e.target.closest('[data-close]')) return; openTile('drop', 'المشاركة المؤقتة', r.id); };
  };
  const save = () => { try { sessionStorage.setItem('dp-seen', JSON.stringify([...seen])); } catch { /* */ } };
  check(); setInterval(check, 45000);
}
