/* =========================================================================
 * بيانات الطلاب: بحث عن طالب بالاسم أو رقم الهوية أو جوال ولي الأمر،
 * ضمن المدرسة كلها أو مرحلة أو فصل محدد، مع عرض بيانات الطالب.
 * ========================================================================= */
import { sb, currentSchoolId, readScopedBySchool, gradeLabels, backToTiles } from './core.js';
import { loadSupport, saveSupport, removeSupport, canEditSupport, LD_STATUS, LD_AREAS, LD_ACCOM } from './student-support.js';

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');

const S = { all: [], grade: '', section: '', q: '', open: null, limit: 60, ld: false, sup: new Map(), edit: null };

async function fetchAll() {
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('students').select('id, national_id, full_name, grade_level, class_section, mobile').order('full_name').range(from, from + 999);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out.map(s => ({ ...s, _n: norm(s.full_name), _id: digits(s.national_id), _m: digits(s.mobile) }));
}

export async function loadStudentDataModule() {
  const root = $('sd-root');
  const back = $('back-to-tiles-sd');
  if (back && !back.dataset.wired) { back.dataset.wired = '1'; back.addEventListener('click', backToTiles); }
  root.innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';
  try { [S.all, S.sup] = await Promise.all([fetchAll(), loadSupport()]); } catch (e) { root.innerHTML = `<div class="error-msg" style="display:block;">تعذر تحميل الطلاب: ${esc(e.message)}</div>`; return; }
  S.open = null; S.limit = 60;
  root.innerHTML = `
    <div class="sd">
      <div class="sd-bar">
        <div class="sd-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input type="search" id="sd-q" placeholder="اسم الطالب، رقم الهوية، أو جوال ولي الأمر" autocomplete="off" value="${esc(S.q)}" aria-label="بحث عن طالب">
        </div>
        <div class="sd-scope">
          <span>البحث في:</span>
          <div class="sd-chips" id="sd-grades"></div>
          <div class="sd-chips" id="sd-secs"></div>
        </div>
      </div>
      <div class="sd-count" id="sd-count" aria-live="polite"></div>
      <div id="sd-list" class="sd-list"></div>
    </div>`;
  const q = $('sd-q');
  q.addEventListener('input', () => { S.q = q.value; S.limit = 60; S.open = null; renderList(); });
  if (window.innerWidth > 700) q.focus();
  renderScope();
  renderList();
}

function sectionsOf(grade) {
  return [...new Set(S.all.filter(s => s.grade_level === grade).map(s => Number(s.class_section) || 0).filter(n => n > 0))].sort((a, b) => a - b);
}

function renderScope() {
  const g = $('sd-grades');
  g.innerHTML = [['', 'الجميع', S.all.length], ...GRADES.map(k => [k, gradeLabels[k], S.all.filter(s => s.grade_level === k).length])]
    .map(([k, l, n]) => `<button type="button" class="sd-chip${S.grade === k ? ' on' : ''}" data-g="${k}" aria-pressed="${S.grade === k}">${esc(l)} <i>${n}</i></button>`).join('');
  const nLd = S.all.filter(s => S.sup.has(s.id) && S.sup.get(s.id).status !== 'exited').length;
  if (nLd || canEditSupport()) g.innerHTML += `<button type="button" class="sd-chip ld${S.ld ? ' on' : ''}" id="sd-ld" aria-pressed="${S.ld}">صعوبات التعلم <i>${nLd}</i></button>`;
  const ldb = $('sd-ld'); if (ldb) ldb.onclick = () => { S.ld = !S.ld; S.limit = 60; S.open = null; renderScope(); renderList(); };
  g.querySelectorAll('button[data-g]').forEach(b => b.onclick = () => { S.grade = b.dataset.g; S.section = ''; S.limit = 60; S.open = null; renderScope(); renderList(); });
  const sc = $('sd-secs');
  if (!S.grade) { sc.innerHTML = ''; sc.hidden = true; return; }
  sc.hidden = false;
  sc.innerHTML = `<button type="button" class="sd-chip sm${!S.section ? ' on' : ''}" data-s="">كل الفصول</button>` +
    sectionsOf(S.grade).map(n => `<button type="button" class="sd-chip sm${String(S.section) === String(n) ? ' on' : ''}" data-s="${n}">فصل ${n}</button>`).join('');
  sc.querySelectorAll('button').forEach(b => b.onclick = () => { S.section = b.dataset.s; S.limit = 60; S.open = null; renderScope(); renderList(); });
}

function matches() {
  const raw = S.q.trim();
  const nq = norm(raw), dq = digits(raw);
  const words = nq.split(' ').filter(Boolean);
  return S.all.filter(s => {
    if (S.grade && s.grade_level !== S.grade) return false;
    if (S.section && String(Number(s.class_section) || 0) !== String(S.section)) return false;
    if (S.ld && !(S.sup.has(s.id) && S.sup.get(s.id).status !== 'exited')) return false;
    if (!raw) return true;
    if (/^[\d٠-٩\s+]+$/.test(raw)) return dq.length > 0 && (s._id.includes(dq) || s._m.includes(dq) || (dq.length > 3 && s._m.includes(dq.replace(/^0/, ''))));
    return words.every(w => s._n.includes(w));
  });
}

function scopeLabel() {
  if (!S.grade) return 'المدرسة كلها';
  return gradeLabels[S.grade] + (S.section ? ' / فصل ' + S.section : '');
}

function renderList() {
  const list = matches();
  const box = $('sd-list');
  $('sd-count').textContent = `${list.length} ${list.length === 1 ? 'طالب' : list.length === 2 ? 'طالبان' : 'طالب'} · ${scopeLabel()}`;
  if (!S.all.length) { box.innerHTML = '<div class="ex-empty"><b>لا يوجد طلاب بعد</b><span>ارفع ملف الطلاب من الإعدادات ← الطلاب</span></div>'; return; }
  if (!list.length && S.ld && !S.q.trim()) { box.innerHTML = `<div class="ex-empty"><b>لا يوجد طلاب صعوبات تعلم مسجلون${S.grade ? ' في هذا النطاق' : ''}</b><span>${canEditSupport() ? 'ألغِ تصفية «صعوبات التعلم»، وابحث عن الطالب، ثم افتح بياناته واضغط «تسجيل صعوبات تعلم».' : 'يسجلهم المدير أو الوكيل أو الموجّه الطلابي من بيانات الطالب.'}</span></div>`; return; }
  if (!list.length) { box.innerHTML = '<div class="ex-empty"><b>لم يُعثر على طالب بهذا البحث</b><span>جرّب جزء من الاسم أو رقم الهوية، أو وسّع البحث للجميع</span></div>'; return; }
  const shown = list.slice(0, S.limit);
  box.innerHTML = shown.map(s => {
    const open = S.open === s.id;
    return `<div class="sd-row${open ? ' open' : ''}" data-id="${esc(s.id)}">
      <button type="button" class="sd-head" aria-expanded="${open}">
        <span class="sd-av" aria-hidden="true">${esc(String(s.full_name || '؟').trim().charAt(0))}</span>
        <span class="sd-main"><b>${hl(s.full_name)}${ldTag(s)}</b><span>${esc(gradeLabels[s.grade_level] || '')}${s.class_section ? ' · فصل ' + esc(s.class_section) : ''}</span></span>
        <span class="sd-nid">${esc(s.national_id || '')}</span>
      </button>
      ${open ? detailHtml(s) : ''}
    </div>`;
  }).join('') + (list.length > S.limit ? `<button type="button" class="sd-more" id="sd-more">عرض المزيد (${list.length - S.limit})</button>` : '');
  box.querySelectorAll('.sd-head').forEach(h => h.onclick = () => { const id = h.closest('.sd-row').dataset.id; S.open = S.open === id ? null : id; renderList(); });
  box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'تم النسخ ✓'; setTimeout(() => { b.textContent = 'نسخ'; }, 1500); } catch (e) { /* المتصفح ما سمح بالنسخ */ }
  });
  const more = $('sd-more');
  if (more) more.onclick = () => { S.limit += 100; renderList(); };
  bindSupport(box);
}

/* ---------- صعوبات التعلم ---------- */
function ldTag(s) {
  const r = S.sup.get(s.id); if (!r) return '';
  return ` <em class="sd-ldtag${r.status === 'exited' ? ' off' : ''}">${r.status === 'exited' ? 'أنهى برنامج الصعوبات' : r.status === 'observation' ? 'تحت الملاحظة' : 'صعوبات تعلم'}</em>`;
}
function supportHtml(s) {
  const r = S.sup.get(s.id), can = canEditSupport();
  if (S.edit === s.id) {
    const v = r || { status: 'active', areas: [], accom: ['alt_paper', 'special_committee'], note: '' };
    const chips = (name, items, on) => items.map(([k, t]) => `<label class="sd-ldc"><input type="checkbox" name="${name}" value="${esc(k)}"${on.includes(k) ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('');
    return `<div class="sd-ld edit">
      <h5>صعوبات التعلم</h5>
      <label class="sd-ldf"><span>الحالة</span><select id="sd-ld-st">${Object.entries(LD_STATUS).map(([k, t]) => `<option value="${k}"${v.status === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="sd-ldf"><span>مجالات الصعوبة</span><div class="sd-ldcs">${chips('ar', LD_AREAS.map(a => [a, a]), v.areas || [])}</div></div>
      <div class="sd-ldf"><span>التسهيلات في الاختبارات</span><div class="sd-ldcs">${chips('ac', Object.entries(LD_ACCOM), v.accom || [])}</div>
        <small>«نموذج أسئلة خاص»: تُطبع له ورقة نموذج صعوبات التعلم تلقائيًا ضمن أوراق فصله إذا أعدّ المعلم هذا النموذج. «لجنة خاصة»: يُضاف إلى اللجنة الخاصة في الاختبارات النهائية.</small></div>
      <label class="sd-ldf"><span>ملاحظات (اختياري)</span><textarea id="sd-ld-note" rows="2" placeholder="مثال: يحتاج إلى قراءة الأسئلة بصوت مسموع">${esc(v.note || '')}</textarea></label>
      <div class="sd-ldbtns"><button type="button" class="btn-primary" data-ldsave="${esc(s.id)}" style="width:auto; padding:9px 18px;">حفظ</button><button type="button" class="text-action-btn" data-ldcancel>إلغاء</button>${r ? `<button type="button" class="text-action-btn danger" data-lddel="${esc(s.id)}">إزالة التسجيل</button>` : ''}<span class="sd-ldmsg" id="sd-ldmsg"></span></div>
    </div>`;
  }
  if (!r) return can ? `<div class="sd-ld none"><button type="button" class="btn-secondary" data-ldedit="${esc(s.id)}" style="width:auto; padding:8px 14px;">تسجيل صعوبات تعلم</button></div>` : '';
  return `<div class="sd-ld${r.status === 'exited' ? ' off' : ''}">
    <h5>صعوبات التعلم ${can ? `<button type="button" class="text-action-btn" data-ldedit="${esc(s.id)}">تعديل</button>` : ''}</h5>
    <dl>
      <div><dt>الحالة</dt><dd>${esc(LD_STATUS[r.status] || r.status)}</dd></div>
      <div><dt>مجالات الصعوبة</dt><dd>${(r.areas || []).length ? esc(r.areas.join('، ')) : '—'}</dd></div>
      <div><dt>التسهيلات في الاختبارات</dt><dd>${(r.accom || []).length ? esc(r.accom.map(k => LD_ACCOM[k] || k).join('، ')) : '—'}</dd></div>
      ${r.note ? `<div><dt>ملاحظات</dt><dd>${esc(r.note)}</dd></div>` : ''}
    </dl>
  </div>`;
}
function bindSupport(box) {
  box.querySelectorAll('[data-ldedit]').forEach(b => b.onclick = () => { S.edit = b.dataset.ldedit; renderList(); });
  box.querySelectorAll('[data-ldcancel]').forEach(b => b.onclick = () => { S.edit = null; renderList(); });
  box.querySelectorAll('[data-ldsave]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ldsave, w = b.closest('.sd-ld');
    const rec = { status: w.querySelector('#sd-ld-st').value, areas: [...w.querySelectorAll('input[name=ar]:checked')].map(x => x.value), accom: [...w.querySelectorAll('input[name=ac]:checked')].map(x => x.value), note: w.querySelector('#sd-ld-note').value };
    b.disabled = true;
    const { data, error } = await saveSupport(id, rec);
    if (error) { b.disabled = false; $('sd-ldmsg').textContent = 'تعذّر الحفظ: ' + error.message; return; }
    S.sup.set(id, data); S.edit = null; renderScope(); renderList();
  });
  box.querySelectorAll('[data-lddel]').forEach(b => b.onclick = async () => {
    if (!confirm('إزالة تسجيل الطالب في صعوبات التعلم؟')) return;
    const { error } = await removeSupport(b.dataset.lddel);
    if (error) { $('sd-ldmsg').textContent = 'تعذّرت الإزالة: ' + error.message; return; }
    S.sup.delete(b.dataset.lddel); S.edit = null; renderScope(); renderList();
  });
}

function detailHtml(s) {
  const mob = String(s.mobile || '').trim();
  const intl = mob ? '966' + digits(mob).replace(/^966/, '').replace(/^0/, '') : '';
  const classmates = S.all.filter(x => x.grade_level === s.grade_level && Number(x.class_section) === Number(s.class_section)).length;
  return `<div class="sd-detail">
    <dl>
      <div><dt>الاسم</dt><dd>${esc(s.full_name)}</dd></div>
      <div><dt>رقم الهوية</dt><dd class="ltr">${esc(s.national_id || '—')} ${s.national_id ? `<button type="button" class="sd-copy" data-copy="${esc(s.national_id)}">نسخ</button>` : ''}</dd></div>
      <div><dt>الصف</dt><dd>${esc(gradeLabels[s.grade_level] || '—')}</dd></div>
      <div><dt>الفصل</dt><dd>${s.class_section ? esc(s.class_section) + ` <small>(${classmates} طالب)</small>` : '—'}</dd></div>
      <div><dt>جوال ولي الأمر</dt><dd class="ltr">${mob ? esc(mob) + ` <button type="button" class="sd-copy" data-copy="${esc(mob)}">نسخ</button>` : '—'}</dd></div>
    </dl>
    ${supportHtml(s)}
    ${mob ? `<div class="sd-actions"><a class="btn-secondary" href="tel:${esc(digits(mob))}">📞 اتصال</a><a class="btn-secondary" href="https://wa.me/${esc(intl)}" target="_blank" rel="noopener">واتساب</a></div>` : ''}
  </div>`;
}

// يبرز جزء الاسم المطابق للبحث
function hl(name) {
  const words = norm(S.q).split(' ').filter(w => w && !/^\d+$/.test(w));
  if (!words.length) return esc(name);
  return String(name || '').split(' ').map(part => (words.some(w => norm(part).includes(w)) ? `<mark>${esc(part)}</mark>` : esc(part))).join(' ');
}
