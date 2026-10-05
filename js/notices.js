/* ===== التنبيهات للموظفين: جرس بالشريط العلوي + صندوق التنبيهات + الرد =====
 * المدير والوكيل: «تنبيه جديد» (موظف أو أكثر / مجموعة)، والرد: بدون / مكتوب / خيارات (استبيان سريع)،
 * و«المرسلة» بنتائج الاطلاع والردود وزر تذكير اللي ما ردّوا.
 * الإرسال والرد عبر دوال قاعدة البيانات (sql/staff_notices.sql) - وإشعار الجوال يطلع تلقائيًا للمفعّلين. */
import { sb, currentUserId, currentSchoolId, isAdminOrDeputy, isOwnerAccount, roleLabels } from './core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canSend = () => isAdminOrDeputy() || isOwnerAccount;
const RESP_LABEL = { none: 'للاطلاع', text: 'رد مكتوب', choice: 'خيارات' };

let inited = false, view = 'inbox', inbox = [], tableMissing = false, pollTimer = null;

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  if (mins < 60 * 24 && d.getDate() === now.getDate()) return d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
}
function fmtMeeting(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
}

/* ---------- البنية ---------- */
function ensureShell() {
  if ($('nt-bell')) return;
  const gear = $('settings-open-btn');
  const bell = document.createElement('button');
  bell.type = 'button'; bell.id = 'nt-bell'; bell.className = 'tn-gear nt-bell'; bell.setAttribute('aria-label', 'التنبيهات'); bell.title = 'التنبيهات';
  bell.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><span class="nt-badge hidden" id="nt-badge"></span>`;
  gear.parentNode.insertBefore(bell, gear);
  bell.addEventListener('click', () => openPanel('inbox'));

  const wrap = document.createElement('div');
  wrap.id = 'nt-wrap'; wrap.className = 'nt-wrap hidden';
  wrap.innerHTML = `<div class="nt-overlay" data-close></div>
    <aside class="nt-panel" role="dialog" aria-modal="true" aria-labelledby="nt-title">
      <header class="nt-head">
        <button type="button" class="nt-icon hidden" id="nt-back" aria-label="رجوع">→</button>
        <h3 id="nt-title">التنبيهات</h3>
        <button type="button" class="nt-icon" data-close aria-label="إغلاق">✕</button>
      </header>
      <div class="nt-tabs hidden" id="nt-tabs">
        <button type="button" data-v="inbox" class="on">الواردة</button>
        <button type="button" data-v="sent">المرسلة</button>
        <button type="button" data-v="compose" class="nt-new">+ تنبيه جديد</button>
      </div>
      <div class="nt-body" id="nt-body"></div>
    </aside>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closePanel(); });
  $('nt-tabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) openPanel(b.dataset.v); });
  $('nt-back').addEventListener('click', () => openPanel(view === 'sentDetail' ? 'sent' : 'inbox'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.classList.contains('hidden')) closePanel(); });
}
function closePanel() { $('nt-wrap').classList.add('hidden'); document.body.style.overflow = ''; }
function setHead(title, back) {
  $('nt-title').textContent = title;
  $('nt-back').classList.toggle('hidden', !back);
  $('nt-tabs').classList.toggle('hidden', !canSend() || back);
  $('nt-tabs').querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view));
}
function openPanel(v, arg) {
  ensureShell();
  $('nt-wrap').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  view = v;
  if (v === 'inbox') renderInbox();
  else if (v === 'detail') renderDetail(arg);
  else if (v === 'compose') renderCompose();
  else if (v === 'sent') renderSent();
  else if (v === 'sentDetail') renderSentDetail(arg);
}
const body = () => $('nt-body');
const loading = () => { body().innerHTML = '<div class="nt-empty">جارٍ التحميل...</div>'; };
const missingMsg = '<div class="nt-empty">خدمة التنبيهات تحتاج تشغيل ملف sql/staff_notices.sql بقاعدة البيانات.</div>';

/* ---------- الواردة ---------- */
async function loadInbox() {
  const { data: mine, error } = await sb.from('staff_notice_recipients')
    .select('notice_id, read_at, response_text, response_choice, responded_at').eq('profile_id', currentUserId).limit(200);
  if (error) { tableMissing = /does not exist|relation|schema cache/i.test(error.message || ''); inbox = []; return; }
  tableMissing = false;
  const ids = (mine || []).map(r => r.notice_id);
  if (!ids.length) { inbox = []; return; }
  const { data: notices } = await sb.from('staff_notices')
    .select('id, title, body, meeting_at, location, response_type, options, created_at, sender_id').in('id', ids);
  const senderIds = [...new Set((notices || []).map(n => n.sender_id))];
  const { data: senders } = senderIds.length ? await sb.from('profiles').select('id, full_name').in('id', senderIds) : { data: [] };
  const nameOf = Object.fromEntries((senders || []).map(p => [p.id, p.full_name]));
  const byId = Object.fromEntries((notices || []).map(n => [n.id, n]));
  inbox = (mine || []).filter(r => byId[r.notice_id]).map(r => ({ ...byId[r.notice_id], me: r, sender: nameOf[byId[r.notice_id].sender_id] || 'الإدارة' }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
function needsAction(n) { return !n.me.read_at || (n.response_type !== 'none' && !n.me.responded_at); }
function updateBadge() {
  const b = $('nt-badge'); if (!b) return;
  const count = inbox.filter(needsAction).length;
  b.textContent = count > 9 ? '9+' : String(count);
  b.classList.toggle('hidden', count === 0);
}
async function refreshBadge() { await loadInbox(); updateBadge(); }

async function renderInbox() {
  setHead('التنبيهات', false); loading();
  await loadInbox(); updateBadge();
  if (tableMissing) { body().innerHTML = missingMsg; return; }
  if (!inbox.length) { body().innerHTML = '<div class="nt-empty">ما عندك تنبيهات</div>'; return; }
  body().innerHTML = `<div class="nt-list">${inbox.map(n => {
    const status = n.response_type === 'none' ? '' : n.me.responded_at ? '<span class="nt-chip ok">تم الرد</span>' : '<span class="nt-chip wait">بانتظار ردك</span>';
    return `<button type="button" class="nt-item${!n.me.read_at ? ' unread' : ''}" data-id="${esc(n.id)}">
      <div class="nt-item-top"><b>${esc(n.title)}</b><span class="nt-time">${esc(fmtTime(n.created_at))}</span></div>
      ${n.meeting_at ? `<div class="nt-item-meet">🗓 ${esc(fmtMeeting(n.meeting_at))}${n.location ? ' – ' + esc(n.location) : ''}</div>` : ''}
      <div class="nt-item-sub"><span>${esc(n.sender)}</span>${status}</div>
    </button>`;
  }).join('')}</div>`;
  body().querySelectorAll('.nt-item').forEach(b => b.addEventListener('click', () => openPanel('detail', b.dataset.id)));
}

/* ---------- تفاصيل تنبيه + الرد ---------- */
async function renderDetail(id) {
  setHead('تنبيه', true);
  let n = inbox.find(x => x.id === id);
  if (!n) { loading(); await loadInbox(); n = inbox.find(x => x.id === id); }
  if (!n) { body().innerHTML = '<div class="nt-empty">التنبيه غير موجود</div>'; return; }
  if (!n.me.read_at) {
    sb.rpc('notice_mark_read', { p_notice: n.id }).then(() => { n.me.read_at = new Date().toISOString(); updateBadge(); });
  }
  const opts = Array.isArray(n.options) ? n.options : [];
  let resp = '';
  if (n.response_type === 'choice') {
    resp = `<div class="nt-resp"><div class="nt-resp-h">${n.me.responded_at ? 'ردك (تقدر تغيّره):' : 'اختر ردك:'}</div>
      <div class="nt-choices">${opts.map((o, i) => `<button type="button" class="nt-choice${n.me.response_choice === i ? ' on' : ''}" data-i="${i}">${esc(o)}</button>`).join('')}</div></div>`;
  } else if (n.response_type === 'text') {
    resp = `<div class="nt-resp"><div class="nt-resp-h">${n.me.responded_at ? 'ردك (تقدر تعدّله):' : 'اكتب ردك:'}</div>
      <textarea id="nt-reply" rows="3" maxlength="1000">${esc(n.me.response_text || '')}</textarea>
      <button type="button" class="btn-primary" id="nt-send-reply">إرسال الرد</button></div>`;
  }
  body().innerHTML = `<article class="nt-detail">
      <h2>${esc(n.title)}</h2>
      <div class="nt-meta">من ${esc(n.sender)} · ${esc(fmtTime(n.created_at))}</div>
      ${n.meeting_at || n.location ? `<div class="nt-meet">${n.meeting_at ? `<div>🗓 <b>${esc(fmtMeeting(n.meeting_at))}</b></div>` : ''}${n.location ? `<div>📍 ${esc(n.location)}</div>` : ''}</div>` : ''}
      ${n.body ? `<p class="nt-text">${esc(n.body)}</p>` : ''}
      ${resp}
      <div class="nt-msg" id="nt-msg"></div>
    </article>`;
  const msg = t => { const m = $('nt-msg'); m.textContent = t; m.classList.add('show'); };
  body().querySelectorAll('.nt-choice').forEach(b => b.addEventListener('click', async () => {
    const i = Number(b.dataset.i);
    const { data, error } = await sb.rpc('notice_respond', { p_notice: n.id, p_text: null, p_choice: i });
    if (error || data === false) { msg('تعذّر إرسال الرد'); return; }
    n.me.response_choice = i; n.me.responded_at = new Date().toISOString();
    body().querySelectorAll('.nt-choice').forEach(x => x.classList.toggle('on', Number(x.dataset.i) === i));
    msg('تم إرسال ردك ✓'); updateBadge();
  }));
  const sendBtn = $('nt-send-reply');
  if (sendBtn) sendBtn.addEventListener('click', async () => {
    const t = $('nt-reply').value.trim();
    if (!t) { msg('اكتب ردك أول'); return; }
    sendBtn.disabled = true;
    const { data, error } = await sb.rpc('notice_respond', { p_notice: n.id, p_text: t, p_choice: null });
    sendBtn.disabled = false;
    if (error || data === false) { msg('تعذّر إرسال الرد'); return; }
    n.me.response_text = t; n.me.responded_at = new Date().toISOString();
    msg('تم إرسال ردك ✓'); updateBadge();
  });
}

/* ---------- تنبيه جديد (المدير والوكيل) ---------- */
let staffCache = null;
async function loadStaff() {
  if (staffCache) return staffCache;
  let q = sb.from('profiles').select('id, full_name, role');
  if (currentSchoolId) q = q.eq('school_id', currentSchoolId);
  const { data } = await q;
  staffCache = (data || []).filter(p => ['admin', 'deputy', 'teacher'].includes(p.role) && p.full_name)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  return staffCache;
}
async function renderCompose() {
  setHead('تنبيه جديد', false); loading();
  const staff = await loadStaff();
  const picked = new Set();
  body().innerHTML = `<form class="nt-form" id="nt-form" novalidate>
      <label>المستلمين</label>
      <div class="nt-groups">
        <button type="button" data-g="all">كل الموظفين</button>
        <button type="button" data-g="teacher">المعلمين</button>
        <button type="button" data-g="admin">الإدارة</button>
        <button type="button" data-g="none">مسح</button>
      </div>
      <input type="search" id="nt-search" placeholder="ابحث بالاسم..." autocomplete="off" />
      <div class="nt-people" id="nt-people"></div>
      <div class="nt-count" id="nt-count">ما اخترت أحد</div>

      <label for="nt-f-title">العنوان</label>
      <input id="nt-f-title" maxlength="150" placeholder="مثال: اجتماع لجنة الاختبارات" />
      <label for="nt-f-body">الرسالة <small>(اختياري)</small></label>
      <textarea id="nt-f-body" rows="3" maxlength="3000"></textarea>
      <div class="nt-row2">
        <div><label for="nt-f-when">الموعد <small>(اختياري)</small></label><input type="datetime-local" id="nt-f-when" /></div>
        <div><label for="nt-f-where">المكان <small>(اختياري)</small></label><input id="nt-f-where" maxlength="150" placeholder="غرفة الاجتماعات" /></div>
      </div>

      <label>نوع الرد</label>
      <div class="nt-seg" id="nt-seg">
        <button type="button" data-t="none" class="on">بدون رد</button>
        <button type="button" data-t="text">رد مكتوب</button>
        <button type="button" data-t="choice">خيارات</button>
      </div>
      <div class="nt-opts hidden" id="nt-opts">
        <div class="nt-opt-list" id="nt-opt-list"></div>
        <div class="nt-opt-quick"><button type="button" data-q="حاضر|أعتذر">حاضر / أعتذر</button><button type="button" data-q="نعم|لا">نعم / لا</button><button type="button" id="nt-opt-add">+ خيار</button></div>
      </div>
      <div class="nt-msg" id="nt-msg"></div>
      <button type="submit" class="btn-primary nt-submit" id="nt-submit">إرسال التنبيه</button>
    </form>`;
  let rtype = 'none';
  const renderPeople = () => {
    const term = $('nt-search').value.trim();
    const list = staff.filter(p => !term || p.full_name.includes(term));
    $('nt-people').innerHTML = list.map(p => `<label class="nt-person${picked.has(p.id) ? ' on' : ''}"><input type="checkbox" value="${esc(p.id)}" ${picked.has(p.id) ? 'checked' : ''}/><span>${esc(p.full_name)}</span><small>${esc(roleLabels[p.role] || '')}</small></label>`).join('') || '<div class="nt-empty sm">ما فيه نتائج</div>';
    $('nt-count').textContent = picked.size ? `المختارين: ${picked.size}` : 'ما اخترت أحد';
  };
  renderPeople();
  $('nt-search').addEventListener('input', renderPeople);
  $('nt-people').addEventListener('change', e => { const c = e.target; if (c.type !== 'checkbox') return; c.checked ? picked.add(c.value) : picked.delete(c.value); renderPeople(); });
  body().querySelector('.nt-groups').addEventListener('click', e => {
    const g = e.target.closest('[data-g]'); if (!g) return;
    if (g.dataset.g === 'none') picked.clear();
    else staff.filter(p => g.dataset.g === 'all' || (g.dataset.g === 'teacher' ? p.role === 'teacher' : p.role !== 'teacher')).forEach(p => picked.add(p.id));
    renderPeople();
  });
  const optList = $('nt-opt-list');
  const addOpt = (v = '') => {
    if (optList.children.length >= 6) return;
    const row = document.createElement('div'); row.className = 'nt-opt';
    row.innerHTML = `<input maxlength="60" placeholder="خيار ${optList.children.length + 1}" value="${esc(v)}" /><button type="button" aria-label="حذف">✕</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    optList.appendChild(row);
  };
  $('nt-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    rtype = b.dataset.t;
    $('nt-seg').querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
    $('nt-opts').classList.toggle('hidden', rtype !== 'choice');
    if (rtype === 'choice' && !optList.children.length) { addOpt('حاضر'); addOpt('أعتذر'); }
  });
  $('nt-opt-add').addEventListener('click', () => addOpt());
  body().querySelector('.nt-opt-quick').addEventListener('click', e => {
    const q = e.target.closest('[data-q]'); if (!q) return;
    optList.innerHTML = ''; q.dataset.q.split('|').forEach(v => addOpt(v));
  });
  $('nt-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = t => { const m = $('nt-msg'); m.textContent = t; m.classList.add('show'); };
    const title = $('nt-f-title').value.trim();
    if (!picked.size) return msg('اختر مستلم واحد على الأقل');
    if (!title) return msg('اكتب عنوان التنبيه');
    let options = [];
    if (rtype === 'choice') {
      options = [...optList.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
      if (options.length < 2) return msg('اكتب خيارين على الأقل');
    }
    const whenVal = $('nt-f-when').value;
    const btn = $('nt-submit'); btn.disabled = true; btn.textContent = 'جارٍ الإرسال...';
    const { error } = await sb.rpc('notice_send', {
      p_title: title, p_body: $('nt-f-body').value.trim(), p_meeting_at: whenVal ? new Date(whenVal).toISOString() : null,
      p_location: $('nt-f-where').value.trim(), p_response_type: rtype, p_options: options, p_recipients: [...picked], p_school: currentSchoolId });
    btn.disabled = false; btn.textContent = 'إرسال التنبيه';
    if (error) {
      const m = error.message || '';
      if (/not allowed/i.test(m)) return msg('ما عندك صلاحية الإرسال لهذي المدرسة');
      if (/no recipients/i.test(m)) return msg('المستلمين المختارين مو من موظفين هذي المدرسة');
      return msg('تعذّر الإرسال: ' + m + (error.code ? ' (' + error.code + ')' : ''));
    }
    openPanel('sent');
    toast(`تم إرسال التنبيه لـ ${picked.size} ${picked.size === 1 ? 'موظف' : 'موظفين'} ✓`);
  });
}

/* ---------- المرسلة + النتائج ---------- */
async function renderSent() {
  setHead('التنبيهات المرسلة', false); loading();
  let q = sb.from('staff_notices').select('id, title, meeting_at, response_type, created_at, sender_id').order('created_at', { ascending: false }).limit(60);
  if (currentSchoolId) q = q.eq('school_id', currentSchoolId);
  const { data: notices, error } = await q;
  if (error) { body().innerHTML = missingMsg; return; }
  if (!notices || !notices.length) { body().innerHTML = '<div class="nt-empty">ما أرسلت تنبيهات بعد<br><button type="button" class="btn-primary" id="nt-go-new" style="margin-top:12px">+ تنبيه جديد</button></div>'; $('nt-go-new').addEventListener('click', () => openPanel('compose')); return; }
  const { data: recs } = await sb.from('staff_notice_recipients').select('notice_id, read_at, responded_at').in('notice_id', notices.map(n => n.id));
  const stat = {};
  (recs || []).forEach(r => { const s = stat[r.notice_id] = stat[r.notice_id] || { all: 0, read: 0, resp: 0 }; s.all++; if (r.read_at) s.read++; if (r.responded_at) s.resp++; });
  body().innerHTML = `<div class="nt-list">${notices.map(n => {
    const s = stat[n.id] || { all: 0, read: 0, resp: 0 };
    const line = n.response_type === 'none' ? `اطلع ${s.read} من ${s.all}` : `ردّ ${s.resp} من ${s.all} · اطلع ${s.read}`;
    return `<button type="button" class="nt-item" data-id="${esc(n.id)}">
      <div class="nt-item-top"><b>${esc(n.title)}</b><span class="nt-time">${esc(fmtTime(n.created_at))}</span></div>
      <div class="nt-item-sub"><span>${esc(RESP_LABEL[n.response_type])}</span><span class="nt-chip ${s.all && (n.response_type === 'none' ? s.read : s.resp) === s.all ? 'ok' : 'wait'}">${esc(line)}</span></div>
    </button>`;
  }).join('')}</div>`;
  body().querySelectorAll('.nt-item').forEach(b => b.addEventListener('click', () => openPanel('sentDetail', b.dataset.id)));
}
async function renderSentDetail(id) {
  setHead('نتائج التنبيه', true); loading();
  const [{ data: ns }, { data: recs }] = await Promise.all([
    sb.from('staff_notices').select('id, title, body, meeting_at, location, response_type, options, created_at').eq('id', id),
    sb.from('staff_notice_recipients').select('profile_id, read_at, response_text, response_choice, responded_at').eq('notice_id', id),
  ]);
  const n = ns && ns[0];
  if (!n) { body().innerHTML = '<div class="nt-empty">التنبيه غير موجود</div>'; return; }
  const ids = (recs || []).map(r => r.profile_id);
  const { data: people } = ids.length ? await sb.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
  const nameOf = Object.fromEntries((people || []).map(p => [p.id, p.full_name]));
  const rows = (recs || []).map(r => ({ ...r, name: nameOf[r.profile_id] || '—' })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const all = rows.length, read = rows.filter(r => r.read_at).length, resp = rows.filter(r => r.responded_at).length;
  const names = list => list.length ? list.map(r => `<span class="nt-name">${esc(r.name)}</span>`).join('') : '<span class="nt-none">—</span>';
  let results = '';
  if (n.response_type === 'choice') {
    const opts = Array.isArray(n.options) ? n.options : [];
    results = opts.map((o, i) => {
      const who = rows.filter(r => r.responded_at && r.response_choice === i);
      const pct = all ? Math.round(who.length / all * 100) : 0;
      return `<div class="nt-opt-res"><div class="nt-opt-res-top"><b>${esc(o)}</b><span>${who.length}</span></div>
        <div class="nt-bar"><i style="width:${pct}%"></i></div><div class="nt-names">${names(who)}</div></div>`;
    }).join('');
  } else if (n.response_type === 'text') {
    const who = rows.filter(r => r.responded_at);
    results = who.length ? who.map(r => `<div class="nt-reply"><b>${esc(r.name)}</b><p>${esc(r.response_text)}</p></div>`).join('') : '<div class="nt-empty sm">ما فيه ردود بعد</div>';
  }
  const pending = rows.filter(r => n.response_type === 'none' ? !r.read_at : !r.responded_at);
  body().innerHTML = `<article class="nt-detail">
      <h2>${esc(n.title)}</h2>
      <div class="nt-meta">${esc(fmtTime(n.created_at))} · ${esc(RESP_LABEL[n.response_type])}</div>
      ${n.meeting_at || n.location ? `<div class="nt-meet">${n.meeting_at ? `<div>🗓 <b>${esc(fmtMeeting(n.meeting_at))}</b></div>` : ''}${n.location ? `<div>📍 ${esc(n.location)}</div>` : ''}</div>` : ''}
      <div class="nt-stats">
        <div><b>${all}</b><span>المستلمين</span></div>
        <div><b>${read}</b><span>اطلعوا</span></div>
        ${n.response_type !== 'none' ? `<div><b>${resp}</b><span>ردّوا</span></div>` : ''}
      </div>
      ${results ? `<h4>الردود</h4>${results}` : ''}
      <h4>${n.response_type === 'none' ? 'ما اطلعوا' : 'ما ردّوا'} (${pending.length})</h4>
      <div class="nt-names">${names(pending)}</div>
      <div class="nt-actions">
        ${pending.length ? `<button type="button" class="btn-primary" id="nt-remind">تذكير ${pending.length === 1 ? 'المتبقي' : 'المتبقين'}</button>` : ''}
        <button type="button" class="btn-secondary nt-del" id="nt-del">حذف التنبيه</button>
      </div>
      <div class="nt-msg" id="nt-msg"></div>
    </article>`;
  const msg = t => { const m = $('nt-msg'); m.textContent = t; m.classList.add('show'); };
  const rb = $('nt-remind');
  if (rb) rb.addEventListener('click', async () => {
    rb.disabled = true;
    const { data, error } = await sb.rpc('notice_remind', { p_notice: n.id });
    if (error || data < 0) { rb.disabled = false; msg('تعذّر إرسال التذكير'); return; }
    msg(`تم إرسال تذكير لـ ${data} ✓ (يوصل اللي مفعّلين إشعارات الجوال، والباقي يشوفونه بالجرس)`);
  });
  const del = $('nt-del');
  del.addEventListener('click', async () => {
    if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'تأكيد الحذف؟'; return; }
    const { error } = await sb.from('staff_notices').delete().eq('id', n.id);
    if (error) { msg('تعذّر الحذف'); return; }
    openPanel('sent'); toast('تم حذف التنبيه');
  });
}

function toast(t) {
  let el = $('push-toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'push-toast'; el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#0F2447;color:#fff;font-size:13px;font-weight:700;padding:11px 18px;border-radius:12px;max-width:min(92vw,460px);text-align:center;line-height:1.7;box-shadow:0 8px 24px rgba(16,23,40,.25);transition:opacity .2s;';
    document.body.appendChild(el);
  }
  el.textContent = t; el.style.opacity = '1';
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
}

export async function initNotices() {
  if (!currentUserId) return;
  ensureShell();
  if (!inited) {
    inited = true;
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && $('nt-wrap').classList.contains('hidden')) refreshBadge(); }, 90000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadge(); });
  }
  await refreshBadge();
  // فتح تنبيه من إشعار الجوال (?notice=ID)
  const qs = new URLSearchParams(location.search);
  const nid = qs.get('notice');
  if (nid) {
    qs.delete('notice');
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
    openPanel('detail', nid);
  }
}
