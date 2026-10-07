/* =========================================================================
 * تحديث تخصصات المعلمين (teacher_subjects) من الجدول الدراسي المحفوظ
 *
 * كل حصة بالجدول فيها: المعلم (اسم حسابه بعد الربط، أو رقمه الوظيفي) + المادة + الصف. نطلع منها لكل
 * معلم: (المادة، الصف)، ونقارنها بتخصصاته الحالية: الجديد ينضاف، واللي ما له حصص ينحذف (بعد المعاينة
 * والمدير يقدر يستثني). أسماء المواد بالجدول مختصرة (لغتي، رقمية...) فنربطها بقائمة المواد، والربط
 * اليدوي ينحفظ للمرات الجاية (school_settings: subject_aliases).
 * ========================================================================= */
import { sb, currentSchoolId, readScopedBySchool, writeWithSchool, gradeLabels } from './core.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const IGNORE = '__ignore';
// تطبيع للمطابقة: بدون "ال" التعريف بأول الكلمات، والهمزات والتاء المربوطة
const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '')
  .split(/\s+/).map(w => w.replace(/^ال(?=..)/, '')).join(' ').trim();
const ALIASES = { 'اجتماعيات': ['دراسات اجتماعيه'], 'اسلاميه': ['دراسات اسلاميه', 'تربيه اسلاميه'], 'رقميه': ['مهارات رقميه', 'حاسب'], 'حياتيه': ['مهارات حياتيه'], 'انجليزي': ['لغه انجليزيه'], 'حاسب': ['مهارات رقميه'], 'لغتي': ['لغه عربيه'], 'فنيه': ['تربيه فنيه'], 'بدنيه': ['تربيه بدنيه'], 'تفكير': ['تفكير ناقد'] };

const S = { box: null, sched: [], profiles: [], subjects: [], current: [], aliases: {}, map: {}, removeKeep: new Set() };

export async function openSubjectSync(box, opts = {}) {
  S.box = box;
  if (opts.onApplied) S.onApplied = opts.onApplied;
  box.innerHTML = '<p class="ss-note">جارٍ التحميل...</p>';
  const [sc, pr, su, ts, al] = await Promise.all([
    readScopedBySchool(scoped => { let q = sb.from('class_schedules').select('grade_level, class_section, subject_name, teacher_name'); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
    sb.from('profiles').select('id, full_name, role, login_email').in('role', ['teacher', 'deputy', 'admin']),
    sb.from('subjects').select('id, name'),
    readScopedBySchool(scoped => { let q = sb.from('teacher_subjects').select('id, teacher_id, subject_id, grade_level'); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q; }),
    readScopedBySchool(scoped => { let q = sb.from('school_settings').select('value').eq('key', 'subject_aliases'); if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId); return q.maybeSingle(); }),
  ]);
  if (sc.error || su.error || ts.error) { box.innerHTML = `<p class="ss-note bad">تعذر التحميل: ${esc((sc.error || su.error || ts.error).message)}</p>`; return; }
  S.sched = (sc.data || []).filter(r => r.subject_name && r.teacher_name && GRADES.includes(r.grade_level));
  S.profiles = pr.data || [];
  S.subjects = (su.data || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  S.current = ts.data || [];
  S.aliases = (al && al.data && al.data.value) || {};
  if (!S.sched.length) { box.innerHTML = '<p class="ss-note">الجدول الدراسي فاضي - استورد الجدول أو عبّيه أولًا.</p>'; return; }
  S.map = {};
  [...new Set(S.sched.map(r => r.subject_name.trim()))].forEach(n => { S.map[n] = guessSubject(n); });
  S.removeKeep = new Set();
  render();
}

function guessSubject(name) {
  if (S.aliases[name] !== undefined) return S.aliases[name];
  const n = norm(name);
  const targets = [n, ...(ALIASES[n] || [])];
  const exact = S.subjects.find(s => targets.includes(norm(s.name)));
  if (exact) return exact.id;
  const cands = S.subjects.filter(s => { const m = norm(s.name); return targets.some(t => m.includes(t) || t.includes(m)); });
  if (cands.length) return cands.sort((a, b) => a.name.length - b.name.length)[0].id;
  return '';
}

function teacherOf(name) {
  const n = norm(name);
  const raw = String(name).trim();
  return S.profiles.find(p => norm(p.full_name) === n)
    || (/^\d{3,}$/.test(raw) ? S.profiles.find(p => String(p.login_email || '').split('@')[0].replace(/^0+/, '') === raw.replace(/^0+/, '')) : null)
    || null;
}

// المطلوب من الجدول: teacher_id -> Set("subject_id|grade")
function wanted() {
  const out = new Map(), unlinked = new Map();
  S.sched.forEach(r => {
    const sid = S.map[r.subject_name.trim()];
    if (!sid || sid === IGNORE) return;
    const t = teacherOf(r.teacher_name);
    if (!t) { unlinked.set(r.teacher_name, (unlinked.get(r.teacher_name) || 0) + 1); return; }
    if (!out.has(t.id)) out.set(t.id, new Set());
    out.get(t.id).add(sid + '|' + r.grade_level);
  });
  return { out, unlinked };
}

function diff() {
  const { out, unlinked } = wanted();
  const cur = new Map();
  S.current.forEach(c => { if (!cur.has(c.teacher_id)) cur.set(c.teacher_id, []); cur.get(c.teacher_id).push(c); });
  const ids = new Set([...out.keys(), ...cur.keys()]);
  const rows = [];
  ids.forEach(id => {
    const p = S.profiles.find(x => x.id === id);
    const want = out.get(id) || new Set();
    const have = cur.get(id) || [];
    const haveKeys = new Set(have.map(c => c.subject_id + '|' + c.grade_level));
    const add = [...want].filter(k => !haveKeys.has(k));
    const keep = have.filter(c => want.has(c.subject_id + '|' + c.grade_level));
    const remove = have.filter(c => !want.has(c.subject_id + '|' + c.grade_level));
    if (add.length || remove.length || keep.length) rows.push({ id, name: p ? p.full_name : '(حساب غير معروف)', add, keep, remove, inSchedule: out.has(id) });
  });
  rows.sort((a, b) => (b.add.length + b.remove.length) - (a.add.length + a.remove.length) || a.name.localeCompare(b.name, 'ar'));
  return { rows, unlinked };
}

const subjName = id => (S.subjects.find(s => s.id === id) || {}).name || '؟';
const gShort = g => (gradeLabels[g] || g || '').replace(' متوسط', '');

function render() {
  const { rows, unlinked } = diff();
  const names = Object.keys(S.map).sort((a, b) => a.localeCompare(b, 'ar'));
  const unmapped = names.filter(n => !S.map[n]);
  const nAdd = rows.reduce((s, r) => s + r.add.length, 0);
  const nRem = rows.reduce((s, r) => s + r.remove.filter(c => !S.removeKeep.has(c.id)).length, 0);
  S.box.innerHTML = `
    <div class="ss-sec">
      <h5>١) ربط أسماء المواد بالجدول بقائمة المواد ${unmapped.length ? `<span class="ss-bad">${unmapped.length} بدون ربط</span>` : '<span class="ss-ok">✓</span>'}</h5>
      <div class="ss-map">${names.map(n => `
        <label class="ss-map-row${S.map[n] ? '' : ' miss'}"><span>${esc(n)}</span>
          <select data-subj="${esc(n)}"><option value="">— اختر المادة —</option>${S.subjects.map(s => `<option value="${s.id}"${S.map[n] === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="${IGNORE}"${S.map[n] === IGNORE ? ' selected' : ''}>تجاهل (مو مادة تخصص)</option><option value="__new">➕ إضافة مادة جديدة...</option></select>
        </label>`).join('')}</div>
    </div>
    ${unlinked.size ? `<div class="ss-sec ss-warn"><b>${unlinked.size} معلم بالجدول ما انربط بحساب</b> (تخصصاتهم ما تتحدث): ${[...unlinked.keys()].slice(0, 12).map(esc).join('، ')}${unlinked.size > 12 ? '...' : ''}<br><small>اربطهم من «استيراد الجدول من PDF» وأعد الاعتماد، أو تأكد إن اسمهم بالجدول مطابق لاسم حسابهم.</small></div>` : ''}
    <div class="ss-sec">
      <h5>٢) التغييرات <span class="ss-sum"><b class="add">+${nAdd}</b> إضافة · <b class="rem">−${nRem}</b> حذف</span></h5>
      <div class="ss-list">${rows.map(r => `
        <div class="ss-row">
          <b class="ss-name">${esc(r.name)}${r.inSchedule ? '' : ' <small>(ما له حصص بالجدول)</small>'}</b>
          <div class="ss-chips">
            ${r.add.map(k => { const [sid, g] = k.split('|'); return `<span class="ss-chip add">+ ${esc(subjName(sid))} · ${esc(gShort(g))}</span>`; }).join('')}
            ${r.keep.map(c => `<span class="ss-chip keep">${esc(subjName(c.subject_id))} · ${esc(gShort(c.grade_level))}</span>`).join('')}
            ${r.remove.map(c => `<label class="ss-chip rem${S.removeKeep.has(c.id) ? ' kept' : ''}" title="ألغِ التحديد عشان يبقى"><input type="checkbox" data-rem="${c.id}"${S.removeKeep.has(c.id) ? '' : ' checked'}> حذف ${esc(subjName(c.subject_id))} · ${esc(gShort(c.grade_level))}</label>`).join('')}
          </div>
        </div>`).join('') || '<p class="ss-note">التخصصات مطابقة للجدول - ما فيه تغييرات ✓</p>'}</div>
    </div>
    <div class="ss-foot">
      <button type="button" class="btn-primary" id="ss-apply"${nAdd + nRem ? '' : ' disabled'}>اعتماد التغييرات</button>
      <span class="ss-note" id="ss-status">${unmapped.length ? 'المواد اللي بدون ربط ما تدخل بالحساب - اربطها أو اختر «تجاهل».' : ''}</span>
    </div>`;
  S.box.querySelectorAll('[data-subj]').forEach(sel => sel.addEventListener('change', async () => {
    const n = sel.dataset.subj;
    if (sel.value === '__new') {
      const guess = { 'حياتيه': 'المهارات الحياتية والأسرية', 'رقميه': 'المهارات الرقمية', 'فنيه': 'التربية الفنية', 'بدنيه': 'التربية البدنية' }[norm(n)] || n;
      const name = (prompt('اسم المادة الجديدة كما تبيه يظهر بالمنصة:', guess) || '').trim();
      if (!name) { render(); return; }
      const { data, error } = await sb.from('subjects').insert({ name }).select('id, name').single();
      if (error) {
        alert(/row-level security|permission|policy/i.test(error.message || '') ? 'إضافة المواد تحتاج تشغيل ملف sql/subjects_admin.sql بقاعدة البيانات أولًا' : 'تعذر إضافة المادة: ' + error.message);
        render(); return;
      }
      S.subjects.push(data);
      S.subjects.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      S.map[n] = data.id;
      render(); return;
    }
    S.map[n] = sel.value; render();
  }));
  S.box.querySelectorAll('[data-rem]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) S.removeKeep.delete(cb.dataset.rem); else S.removeKeep.add(cb.dataset.rem); render(); }));
  const ap = document.getElementById('ss-apply');
  if (ap) ap.addEventListener('click', apply);
}

async function apply() {
  const { rows } = diff();
  const adds = rows.flatMap(r => r.add.map(k => { const [subject_id, grade_level] = k.split('|'); return { teacher_id: r.id, subject_id, grade_level }; }));
  const dels = rows.flatMap(r => r.remove.filter(c => !S.removeKeep.has(c.id)).map(c => c.id));
  if (!confirm(`إضافة ${adds.length} تخصص وحذف ${dels.length}؟`)) return;
  const st = document.getElementById('ss-status');
  const btn = document.getElementById('ss-apply');
  btn.disabled = true; st.textContent = 'جارٍ الحفظ...';
  for (let i = 0; i < dels.length; i += 100) {
    const { error } = await sb.from('teacher_subjects').delete().in('id', dels.slice(i, i + 100));
    if (error) { st.textContent = 'تعذر الحذف: ' + error.message; btn.disabled = false; return; }
  }
  for (let i = 0; i < adds.length; i += 200) {
    const chunk = adds.slice(i, i + 200);
    const { error } = await writeWithSchool(extra => sb.from('teacher_subjects').insert(chunk.map(r => ({ ...r, ...extra }))));
    if (error) { st.textContent = 'تعذر الإضافة: ' + error.message; btn.disabled = false; return; }
  }
  // نحفظ ربط أسماء المواد للمرات الجاية
  const aliases = { ...S.aliases };
  Object.entries(S.map).forEach(([n, id]) => { if (id) aliases[n] = id; });
  await writeWithSchool(extra => sb.from('school_settings').upsert({ key: 'subject_aliases', value: aliases, updated_at: new Date().toISOString(), ...extra }, { onConflict: 'school_id,key' }));
  await openSubjectSync(S.box);
  if (S.onApplied) S.onApplied();
  const st2 = document.getElementById('ss-status');
  if (st2) st2.textContent = `تم ✓ أُضيف ${adds.length} وحُذف ${dels.length}`;
}
