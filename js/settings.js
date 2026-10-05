import { sb, currentUserId, currentSchoolId, readScopedBySchool, writeWithSchool, setSubRoute, gradeLabels, effectiveRoleForTiles, upsertSchoolKey, conflictOpt } from './core.js';
import { loadXLSX } from './lib-loader.js';

/* ===== صفحة الإعدادات: هوية المدرسة، الطلاب، التقويم، بيانات التواصل، المستخدمين =====
 * المدير يشوف كل الأقسام، والوكيل يشوف الطلاب وبيانات التواصل (نفس صلاحياته السابقة). */
const SECTIONS = [
  { k: 'identity', roles: ['admin'] },
  { k: 'students', roles: ['admin', 'deputy'] },
  { k: 'calendar', roles: ['admin'] },
  { k: 'contacts', roles: ['admin', 'deputy'] },
  { k: 'users', roles: ['admin'] },
];
let bound = false;
let current = null;
const $ = id => document.getElementById(id);

export async function loadSettingsModule(sub) {
  const role = effectiveRoleForTiles();
  const allowed = SECTIONS.filter(x => x.roles.includes(role)).map(x => x.k);
  document.querySelectorAll('#st-nav button').forEach(b => b.classList.toggle('hidden', !allowed.includes(b.dataset.s)));
  if (!bound) {
    bound = true;
    document.querySelectorAll('#st-nav button').forEach(b => b.addEventListener('click', () => showSection(b.dataset.s, true)));
    $('st-stu-import').addEventListener('click', async () => {
      const btn = $('st-stu-import');
      btn.disabled = true; btn.textContent = 'جارٍ الاستيراد...';
      try { await importStudentsFile(); } finally { btn.disabled = false; btn.textContent = 'استيراد الملف'; }
    });
    $('st-semester').querySelectorAll('button').forEach(b => b.addEventListener('click', () => saveSemester(b.dataset.v)));
  }
  const target = allowed.includes(sub) ? sub : allowed[0];
  await showSection(target, false, sub !== target);
}

async function showSection(k, push, replace = false) {
  current = k;
  document.querySelectorAll('#st-nav button').forEach(b => {
    const on = b.dataset.s === k;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('#settings-module .st-pane').forEach(p => p.classList.toggle('hidden', p.dataset.s !== k));
  $('perms-module').classList.toggle('hidden', k !== 'users');
  $('school-contacts-module').classList.toggle('hidden', k !== 'contacts');
  if (push) setSubRoute(k); else if (replace) setSubRoute(k, true);
  if (push && window.innerWidth < 900) document.querySelector('#settings-module .st-body').scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (k === 'identity') (await import('./school-brand.js')).initBrandPane();
  else if (k === 'students') await refreshStudents();
  else if (k === 'calendar') await renderCalendar();
  else if (k === 'contacts') (await import('./school-contacts.js')).loadSchoolContactsModule();
  else if (k === 'users') (await import('./employees-admin.js')).loadPermsModule();
}

/* ---------- الطلاب ---------- */
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
let stuCache = [];

async function fetchAllStudents() {
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await readScopedBySchool(scoped => {
      let q = sb.from('students').select('id, national_id, grade_level, class_section, updated_at').order('id', { ascending: true }).range(from, from + 999);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (error) { console.error('students fetch', error); break; }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function refreshStudents() {
  stuCache = await fetchAllStudents();
  const total = stuCache.length;
  const byGrade = new Map(GRADES.map(g => [g, new Map()]));
  let noSection = 0, last = null;
  stuCache.forEach(s => {
    if (s.updated_at && (!last || s.updated_at > last)) last = s.updated_at;
    const m = byGrade.get(s.grade_level); if (!m) return;
    const sec = Number(s.class_section) || 0;
    if (!sec) noSection++;
    m.set(sec, (m.get(sec) || 0) + 1);
  });
  const sectionsCount = g => [...byGrade.get(g).keys()].filter(x => x > 0).length;
  const lastTxt = last ? new Date(last).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  $('st-stu-kpis').innerHTML = `
    <div class="st-kpi main"><b>${total}</b><span>طالب${lastTxt ? ` · آخر تحديث ${lastTxt}` : ''}</span></div>
    ${GRADES.map(g => { const n = [...byGrade.get(g).values()].reduce((a, b) => a + b, 0); return `<div class="st-kpi"><b>${n}</b><span>${gradeLabels[g]} · ${sectionsCount(g)} فصول</span></div>`; }).join('')}`;
  const wrap = $('st-stu-sections');
  if (!total) { wrap.innerHTML = '<div class="ex-empty"><b>ما فيه طلاب بعد</b><span>ارفع ملف الطلاب من نور، والفصول تنحسب منه تلقائيًا</span></div>'; return; }
  wrap.innerHTML = GRADES.map(g => {
    const m = byGrade.get(g);
    const secs = [...m.entries()].filter(([k]) => k > 0).sort((a, b) => a[0] - b[0]);
    const none = m.get(0) || 0;
    return `<div class="st-grade">
      <div class="st-grade-h"><b>${gradeLabels[g]}</b><span>${arSections(secs.length)}</span></div>
      <div class="st-secs">${secs.length ? secs.map(([k, n]) => `<span class="st-sec"><b>${k}</b>${n} طالب</span>`).join('') : '<span class="st-hint">ما فيه طلاب</span>'}
      ${none ? `<span class="st-sec warn"><b>؟</b>${none} بدون فصل</span>` : ''}</div>
    </div>`;
  }).join('') + (noSection ? '<p class="st-help warn">فيه طلاب بدون رقم فصل بالملف، فما يطلعون في كشوف الفصول. تأكد من عمود "الفصل" بملف نور وارفعه مرة ثانية.</p>' : '');
}
function arSections(n) { return n === 0 ? 'بدون فصول' : n === 1 ? 'فصل واحد' : n === 2 ? 'فصلان' : n <= 10 ? `${n} فصول` : `${n} فصلًا`; }

function normalizeGrade(raw) {
  const s = String(raw || '').trim();
  if (s.endsWith('730')) return 'first_intermediate';
  if (s.endsWith('830')) return 'second_intermediate';
  if (s.endsWith('930')) return 'third_intermediate';
  return null;
}

async function importStudentsFile() {
  const fileInput = document.getElementById('st-stu-file');
  const errEl = document.getElementById('st-stu-error');
  const okEl = document.getElementById('st-stu-ok');
  errEl.style.display = 'none';
  okEl.classList.add('hidden');
  const file = fileInput.files[0];
  if (!file) { errEl.textContent = 'اختر ملف إكسل أولاً'; errEl.style.display = 'block'; return; }

  await loadXLSX();
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      let allRows = [];
      wb.SheetNames.forEach(name => {
        const sheet = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        allRows = allRows.concat(rows);
      });

      let headerIdx = -1, colIdx = {};
      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const idx = row.findIndex(c => String(c).includes('اسم') && String(c).includes('طالب'));
        if (idx !== -1) {
          headerIdx = i;
          row.forEach((cell, ci) => {
            const c = String(cell).trim();
            if (!c) return;
            if (c.includes('اسم') && c.includes('طالب')) colIdx.name = ci;
            else if (c.includes('هوية') || (c.includes('رقم') && c.includes('طالب'))) colIdx.nationalId = ci;
            else if (c.includes('فصل')) colIdx.classSection = ci;
            else if (c.includes('صف')) colIdx.grade = ci;
            else if (c.includes('جوال') || c.includes('هاتف') || c.includes('موبايل')) colIdx.mobile = ci;
          });
          break;
        }
      }
      if (headerIdx === -1) {
        errEl.textContent = 'ما لقيت عمود "اسم الطالب" بالملف، تأكد من شكل الملف';
        errEl.style.display = 'block';
        return;
      }

      const students = [];
      for (let i = headerIdx + 1; i < allRows.length; i++) {
        const row = allRows[i];
        const name = row[colIdx.name];
        const nationalId = row[colIdx.nationalId];
        const classSection = row[colIdx.classSection];
        const gradeRaw = row[colIdx.grade];
        const mobile = row[colIdx.mobile];
        if (!name || !nationalId) continue;
        const grade = normalizeGrade(gradeRaw);
        if (!grade) continue;
        students.push({
          national_id: String(nationalId).trim(),
          full_name: String(name).trim(),
          mobile: mobile ? String(mobile).trim() : null,
          grade_level: grade,
          class_section: parseInt(classSection) || 0,
          updated_at: new Date().toISOString(),
        });
      }

      if (students.length === 0) {
        errEl.textContent = 'ما لقيت أي صفوف طلاب صالحة بالملف';
        errEl.style.display = 'block';
        return;
      }

      // الطالب مميّز برقم هويته داخل المدرسة (الطالب المنتقل له سجل خاص بكل مدرسة)
      const { error } = await writeWithSchool(extra => upsertSchoolKey(k => sb.from('students').upsert(students.map(s => ({ ...s, ...extra })), conflictOpt(k)),
        'school_id,national_id', 'national_id'));
      if (error) { errEl.textContent = 'تعذر الاستيراد: ' + error.message; errEl.style.display = 'block'; return; }

      const known = new Set(stuCache.map(x => String(x.national_id)));
      const added = students.filter(x => !known.has(x.national_id)).length;
      okEl.textContent = `تم استيراد ${students.length} طالب: ${added} جديد و${students.length - added} تحدّثت بياناتهم`;
      okEl.classList.remove('hidden');
      fileInput.value = '';
      await refreshStudents();
    } catch (err) {
      errEl.textContent = 'تعذرت قراءة الملف: ' + err.message;
      errEl.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
}


/* ---------- التقويم + الفصل الدراسي الحالي ---------- */
async function loadSemester() {
  let res = currentSchoolId ? await sb.from('op_plan_settings').select('current_semester').eq('school_id', currentSchoolId).maybeSingle() : { error: true };
  if (res.error || !res.data) res = await sb.from('op_plan_settings').select('current_semester').eq('id', 1).maybeSingle();
  return (res.data && res.data.current_semester) || 'semester_1';
}
function paintSemester(v) { $('st-semester').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === v)); }
async function saveSemester(v) {
  paintSemester(v);
  const ok = $('st-sem-ok'); ok.classList.add('hidden');
  let error;
  if (currentSchoolId) {
    ({ error } = await sb.from('op_plan_settings').upsert({ school_id: currentSchoolId, current_semester: v, updated_by: currentUserId }, { onConflict: 'school_id' }));
    if (error) ({ error } = await sb.from('op_plan_settings').update({ current_semester: v, updated_by: currentUserId }).eq('id', 1));
  } else {
    ({ error } = await sb.from('op_plan_settings').update({ current_semester: v, updated_by: currentUserId }).eq('id', 1));
  }
  if (error) { ok.textContent = 'تعذر الحفظ: ' + error.message; ok.classList.add('err'); }
  else { ok.textContent = 'تم الحفظ ✓'; ok.classList.remove('err'); }
  ok.classList.remove('hidden');
}
async function renderCalendar() {
  paintSemester(await loadSemester());
  $('st-sem-ok').classList.add('hidden');
  const { renderCalendarEditor } = await import('./dashboard.js');
  renderCalendarEditor($('st-cal-box'), () => { const m = $('st-cal-box').querySelector('#cal-msg'); if (m) { m.textContent = 'تم الحفظ ✓'; m.style.color = '#1E8A55'; } });
}
