import { sb, currentUserId, setupCollapsible, backToTiles, gradeLabels, currentSchoolId, readScopedBySchool, writeWithSchool, setSubRoute, printOrgName, printLogo } from './core.js';
import { initOverlayCard, setOverlayPeriod } from './overlay-print.js';
import { loadXLSX } from './lib-loader.js';

// شعار الترويسة من هوية المدرسة (printLogo بملف core.js)

setupCollapsible('exam-import-toggle', 'exam-import-body', 'exam-import-chevron');
document.getElementById('exam-period-toggle').addEventListener('click', () => {
  const body = document.getElementById('exam-period-body');
  const open = body.classList.toggle('hidden') === false;
  document.querySelector('#exam-period-toggle span').textContent = open ? 'إلغاء' : '+ فترة جديدة';
  document.getElementById('exam-period-toggle').classList.toggle('btn-secondary', open);
  if (open) document.getElementById('exam-period-name').focus();
});

/* إدراج المتغيرات بالسحب أو بالضغط */
function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
  const end = textarea.selectionEnd != null ? textarea.selectionEnd : textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const newPos = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(newPos, newPos);
}

document.querySelectorAll('.exam-var-chip').forEach(chip => {
  chip.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', chip.dataset.var);
    e.dataTransfer.effectAllowed = 'copy';
  });
  chip.addEventListener('click', () => {
    const textarea = document.getElementById('exam-message-template');
    insertAtCursor(textarea, chip.dataset.var);
  });
});

const messageTemplateEl = document.getElementById('exam-message-template');
messageTemplateEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
messageTemplateEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const varText = e.dataTransfer.getData('text/plain');
  if (!varText) return;
  insertAtCursor(messageTemplateEl, varText);
});

let currentPeriodId = null;
let currentPeriodRow = null;

export async function loadExamsModule(sub = null) {
  initOverlayCard();
  showListView(true);
  await Promise.all([refreshStudentStats(), refreshPeriodsList()]);
  if (sub) {
    const p = periodsCache.find(x => String(x.id) === String(sub));
    if (p) { selectPeriod(p); return; }
    setSubRoute(null, true);
  }
}

function showListView(resetRoute = false) {
  document.getElementById('exam-list-view').classList.remove('hidden');
  document.getElementById('exam-period-detail').classList.add('hidden');
  currentPeriodId = null;
  currentPeriodRow = null;
  if (resetRoute) return;
  setSubRoute(null);
  window.scrollTo(0, 0);
}
async function backToList() { showListView(); await refreshPeriodsList(); }
document.getElementById('exam-back-to-list').addEventListener('click', backToList);
document.getElementById('exam-finish-btn').addEventListener('click', backToList);

/* ---------- استيراد الطلاب ---------- */
async function refreshStudentStats() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('students').select('grade_level');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  const grades = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  const counts = { first_intermediate: 0, second_intermediate: 0, third_intermediate: 0 };
  (data || []).forEach(s => { if (counts[s.grade_level] !== undefined) counts[s.grade_level]++; });
  const container = document.getElementById('exam-student-stats');
  const total = counts.first_intermediate + counts.second_intermediate + counts.third_intermediate;
  container.innerHTML = `<span class="ess-total">${total} طالب</span>` + grades.map(g => `<span class="ess-chip">${gradeLabels[g]} <b>${counts[g]}</b></span>`).join('');
}

function normalizeGrade(raw) {
  const s = String(raw || '').trim();
  if (s.endsWith('730')) return 'first_intermediate';
  if (s.endsWith('830')) return 'second_intermediate';
  if (s.endsWith('930')) return 'third_intermediate';
  return null;
}

document.getElementById('exam-import-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('exam-import-file');
  const errEl = document.getElementById('exam-import-error');
  errEl.style.display = 'none';
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

      const { error } = await writeWithSchool(extra => sb.from('students').upsert(students.map(s => ({ ...s, ...extra })), { onConflict: 'national_id' }));
      if (error) { errEl.textContent = 'تعذر الاستيراد: ' + error.message; errEl.style.display = 'block'; return; }

      alert(`تم استيراد ${students.length} طالب بنجاح`);
      fileInput.value = '';
      await refreshStudentStats();
    } catch (err) {
      errEl.textContent = 'تعذرت قراءة الملف: ' + err.message;
      errEl.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
});

/* ---------- فترات الاختبار ---------- */
document.getElementById('exam-period-add').addEventListener('click', async () => {
  const name = document.getElementById('exam-period-name').value.trim();
  const academicYear = document.getElementById('exam-academic-year').value.trim();
  const semester = document.getElementById('exam-semester').value;
  const committeeCount = parseInt(document.getElementById('exam-committee-count').value);
  const seatFirst = parseInt(document.getElementById('exam-seat-first').value) || 1;
  const seatSecond = parseInt(document.getElementById('exam-seat-second').value) || 1;
  const seatThird = parseInt(document.getElementById('exam-seat-third').value) || 1;
  const specialSeatStart = parseInt(document.getElementById('exam-special-seat-start').value) || 1;
  const errEl = document.getElementById('exam-period-error');
  errEl.style.display = 'none';

  if (!name || !committeeCount || committeeCount < 1) {
    errEl.textContent = 'اكتب اسم الفترة وعدد اللجان أولاً';
    errEl.style.display = 'block';
    return;
  }

  const { error } = await writeWithSchool(extra => sb.from('exam_periods').insert({
    name, academic_year: academicYear || null, semester,
    committee_count: committeeCount,
    seat_start_first: seatFirst, seat_start_second: seatSecond, seat_start_third: seatThird,
    special_seat_start: specialSeatStart, created_by: currentUserId,
    ...extra,
  }));
  if (error) { errEl.textContent = 'تعذر الإنشاء: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('exam-period-name').value = '';
  document.getElementById('exam-academic-year').value = '';
  document.getElementById('exam-committee-count').value = '';
  document.getElementById('exam-period-toggle').click();
  await refreshPeriodsList();
});

let periodsCache = [];
let progressByPeriod = new Map(); // period_id -> { located, special, students }

const STEP_TITLES = ['الإعداد', 'اللجنة الخاصة', 'التوزيع', 'الطباعة', 'الرسائل'];
// الخطوة الحالية للفترة: 1 لو المقرات ناقصة، 3 لو ما تولّد التوزيع، 4 بعد التوليد
function periodStage(p) {
  const pr = progressByPeriod.get(p.id) || {};
  if (p.generated_at) return 4;
  if ((pr.located || 0) < (p.committee_count || 0)) return 1;
  return 3;
}
function escHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }); } catch { return ''; } }

async function loadPeriodProgress(ids) {
  progressByPeriod = new Map();
  if (!ids.length) return;
  const [{ data: locs }, { data: specials }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_locations').select('period_id, committee_number, location').in('period_id', ids);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_special_members').select('period_id').in('period_id', ids);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);
  ids.forEach(id => progressByPeriod.set(id, { located: 0, special: 0 }));
  (locs || []).forEach(l => { const e = progressByPeriod.get(l.period_id); if (e && String(l.location || '').trim()) e.located++; });
  (specials || []).forEach(m => { const e = progressByPeriod.get(m.period_id); if (e) e.special++; });
}

async function refreshPeriodsList() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_periods').select('*');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('created_at', { ascending: false });
  });
  periodsCache = data || [];
  await loadPeriodProgress(periodsCache.map(p => p.id));
  const list = document.getElementById('exam-periods-list');
  list.innerHTML = '';
  if (!periodsCache.length) {
    list.innerHTML = '<div class="ex-empty"><b>ما فيه فترات اختبار بعد</b><span>اضغط «+ فترة جديدة» وحدد عدد اللجان وبداية أرقام الجلوس.</span></div>';
    return;
  }
  periodsCache.forEach(p => {
    const stage = periodStage(p);
    const pr = progressByPeriod.get(p.id) || {};
    const card = document.createElement('div');
    card.className = 'ex-period-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const meta = [p.academic_year, p.semester, `${p.committee_count} ${p.committee_count >= 3 && p.committee_count <= 10 ? 'لجان' : 'لجنة'}`].filter(Boolean).map(escHtml).join(' · ');
    const stageText = p.generated_at ? `تم التوليد ${fmtDate(p.generated_at)} · جاهزة للطباعة` : stage === 1 ? `الخطوة 1 من 5 · مقرات اللجان ${pr.located || 0} من ${p.committee_count}` : 'الخطوة 3 من 5 · بانتظار توليد التوزيع';
    card.innerHTML = `
      <div class="epc-top">
        <div class="epc-titles"><b>${escHtml(p.name)}</b><span>${meta}</span></div>
        <button type="button" class="text-action-btn epc-del" style="color:var(--danger) !important;">حذف</button>
      </div>
      <div class="epc-bar">${[1, 2, 3, 4, 5].map(i => `<i class="${i < stage || (p.generated_at && i <= 3) ? 'on' : i === stage ? 'cur' : ''}"></i>`).join('')}</div>
      <div class="epc-stage ${p.generated_at ? 'ok' : ''}">${stageText}${pr.special ? ` · اللجنة الخاصة: ${pr.special}` : ''}</div>`;
    const open = () => selectPeriod(p);
    card.addEventListener('click', (e) => { if (!e.target.closest('.epc-del')) open(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    card.querySelector('.epc-del').addEventListener('click', async () => {
      if (!confirm(`متأكد تبي تحذف فترة "${p.name}"؟ هذا يحذف كل التوزيع المرتبط فيها.`)) return;
      await sb.from('exam_periods').delete().eq('id', p.id);
      await refreshPeriodsList();
    });
    list.appendChild(card);
  });
}

let currentStep = 1;
async function selectPeriod(period) {
  currentPeriodId = period.id;
  currentPeriodRow = period;
  document.getElementById('exam-list-view').classList.add('hidden');
  document.getElementById('exam-period-detail').classList.remove('hidden');
  document.getElementById('exam-detail-title').textContent = period.name;
  renderPeriodMeta();
  fillEditForm();
  document.getElementById('exam-special-search').value = '';
  document.getElementById('exam-special-search-results').innerHTML = '';
  setSubRoute(period.id);
  window.scrollTo(0, 0);
  if (!progressByPeriod.has(period.id)) await loadPeriodProgress([period.id]);
  goStep(periodStage(period));
  await Promise.all([refreshSpecialList(), refreshResults(), refreshCommitteeLocations()]);
  setOverlayPeriod(period.id); // بطاقة "الطباعة على النموذج المعتمد" تستخدم لجان وأرقام جلوس هذي الفترة
}

function renderPeriodMeta() {
  const p = currentPeriodRow;
  if (!p) return;
  document.getElementById('exam-detail-meta').textContent = [p.academic_year, p.semester, `${p.committee_count} ${p.committee_count >= 3 && p.committee_count <= 10 ? 'لجان' : 'لجنة'}`].filter(Boolean).join(' · ');
}

/* شريط الخطوات: كل خطوة توضح حالتها (مكتملة / الحالية / اختيارية) */
function renderSteps() {
  const p = currentPeriodRow;
  if (!p) return;
  const pr = progressByPeriod.get(p.id) || { located: 0, special: 0 };
  const states = [
    { done: pr.located >= p.committee_count, note: `${pr.located} من ${p.committee_count} مقر` },
    { done: pr.special > 0, note: pr.special ? `${pr.special} طالب` : 'اختيارية' },
    { done: !!p.generated_at, note: p.generated_at ? 'تم التوليد' : 'لم يُولَّد' },
    { done: false, note: p.generated_at ? 'جاهزة' : 'بعد التوليد' },
    { done: false, note: 'إكسل' },
  ];
  const nav = document.getElementById('exam-steps');
  nav.innerHTML = STEP_TITLES.map((t, i) => {
    const n = i + 1, st = states[i];
    return `<button type="button" class="ex-step-btn ${n === currentStep ? 'cur' : ''} ${st.done ? 'done' : ''}" data-step="${n}" ${n === currentStep ? 'aria-current="step"' : ''}>
      <span class="esb-num">${st.done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' : n}</span>
      <span class="esb-txt"><b>${t}</b><span>${st.note}</span></span></button>`;
  }).join('');
  nav.querySelectorAll('.ex-step-btn').forEach(b => b.addEventListener('click', () => goStep(+b.dataset.step)));
  const cnt = document.getElementById('exam-locations-count');
  if (cnt) { cnt.textContent = `${pr.located} من ${p.committee_count}`; cnt.classList.toggle('ok', pr.located >= p.committee_count); }
  // بوابة الطباعة: الكشوف والملصقات تحتاج توزيع مولّد
  const gen = !!p.generated_at;
  document.getElementById('exam-print-gate').classList.toggle('hidden', gen);
  document.querySelectorAll('#exam-period-detail .ex-print-tile').forEach(b => { b.disabled = !gen; });
  const st = document.getElementById('exam-generate-state');
  if (st) st.innerHTML = gen
    ? `<span class="ex-dot ok"></span><span>تم التوليد ${fmtDate(p.generated_at)}. إعادة التوليد تعيد ترقيم الكل من الصفر.</span>`
    : `<span class="ex-dot"></span><span>ما تم التوليد بعد. تأكد من اللجنة الخاصة قبل التوليد.</span>`;
  document.getElementById('exam-generate-btn').textContent = gen ? 'إعادة توليد التوزيع' : 'توليد التوزيع والترقيم';
}

function goStep(n) {
  currentStep = Math.max(1, Math.min(5, n));
  document.querySelectorAll('#exam-period-detail .ex-step').forEach(sec => sec.classList.toggle('hidden', +sec.dataset.step !== currentStep));
  renderSteps();
  const nav = document.getElementById('exam-steps'), cur = nav.querySelector('.ex-step-btn.cur');
  if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
}
document.querySelectorAll('#exam-period-detail .ex-next').forEach(b => b.addEventListener('click', () => {
  goStep(+b.dataset.go);
  document.getElementById('exam-steps').scrollIntoView({ block: 'start', behavior: 'smooth' });
}));

/* ---------- تعديل بيانات الفترة ---------- */
const EDIT_FIELDS = [
  ['exam-edit-name', 'name', 'text'], ['exam-edit-year', 'academic_year', 'text'], ['exam-edit-semester', 'semester', 'text'],
  ['exam-edit-committees', 'committee_count', 'num'], ['exam-edit-seat-first', 'seat_start_first', 'num'],
  ['exam-edit-seat-second', 'seat_start_second', 'num'], ['exam-edit-seat-third', 'seat_start_third', 'num'],
  ['exam-edit-seat-special', 'special_seat_start', 'num'],
];
function fillEditForm() {
  const p = currentPeriodRow;
  const sem = document.getElementById('exam-edit-semester');
  if (p.semester && ![...sem.options].some(o => o.value === p.semester)) sem.add(new Option(p.semester, p.semester));
  EDIT_FIELDS.forEach(([id, col]) => { document.getElementById(id).value = p[col] == null ? '' : p[col]; });
  document.getElementById('exam-edit-warn').classList.add('hidden');
  document.getElementById('exam-edit-error').style.display = 'none';
  document.getElementById('exam-edit-ok').classList.add('hidden');
}
document.getElementById('exam-edit-save').addEventListener('click', async () => {
  const p = currentPeriodRow;
  const errEl = document.getElementById('exam-edit-error');
  errEl.style.display = 'none';
  if (!p) return;
  const upd = {};
  EDIT_FIELDS.forEach(([id, col, kind]) => {
    const raw = document.getElementById(id).value.trim();
    upd[col] = kind === 'num' ? (parseInt(raw) || null) : (raw || null);
  });
  if (!upd.name || !upd.committee_count || upd.committee_count < 1) { errEl.textContent = 'اسم الفترة وعدد اللجان مطلوبة'; errEl.style.display = 'block'; return; }
  ['seat_start_first', 'seat_start_second', 'seat_start_third', 'special_seat_start'].forEach(k => { if (!upd[k]) upd[k] = 1; });
  const structural = ['committee_count', 'seat_start_first', 'seat_start_second', 'seat_start_third', 'special_seat_start'].some(k => Number(upd[k]) !== Number(p[k]));
  const { error } = await sb.from('exam_periods').update(upd).eq('id', p.id);
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }
  Object.assign(p, upd);
  document.getElementById('exam-detail-title').textContent = p.name;
  renderPeriodMeta();
  document.getElementById('exam-edit-warn').classList.toggle('hidden', !(structural && p.generated_at));
  const ok = document.getElementById('exam-edit-ok');
  ok.classList.remove('hidden'); setTimeout(() => ok.classList.add('hidden'), 1800);
  await refreshCommitteeLocations();
});

/* ---------- مقرات اللجان ---------- */
async function refreshCommitteeLocations() {
  const container = document.getElementById('exam-locations-list');
  container.innerHTML = '';
  if (!currentPeriodId || !currentPeriodRow) return;

  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_locations').select('committee_number, location').eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  const existing = {};
  (data || []).forEach(row => { existing[row.committee_number] = row.location || ''; });

  for (let i = 1; i <= currentPeriodRow.committee_count; i++) {
    const row = document.createElement('label');
    row.className = 'ex-loc';
    row.innerHTML = `<span>لجنة ${i}</span><input type="text" class="exam-location-input" data-committee="${i}" placeholder="مثال: الفصل 101" value="${escHtml(existing[i] || '')}" />`;
    container.appendChild(row);
  }
  const pr = progressByPeriod.get(currentPeriodId) || { located: 0, special: 0 };
  pr.located = Object.entries(existing).filter(([n, v]) => +n <= currentPeriodRow.committee_count && String(v).trim()).length;
  progressByPeriod.set(currentPeriodId, pr);
  renderSteps();
}

document.getElementById('exam-locations-save').addEventListener('click', async () => {
  const errEl = document.getElementById('exam-locations-error');
  const successEl = document.getElementById('exam-locations-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';
  if (!currentPeriodId) return;

  const rows = Array.from(document.querySelectorAll('.exam-location-input')).map(input => ({
    period_id: currentPeriodId,
    committee_number: parseInt(input.dataset.committee),
    location: input.value.trim(),
  }));

  const { error } = await writeWithSchool(extra => sb.from('exam_committee_locations').upsert(rows.map(r => ({ ...r, ...extra })), { onConflict: 'period_id,committee_number' }));
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }
  successEl.style.display = 'block';
  setTimeout(() => { successEl.style.display = 'none'; }, 2000);
  await refreshCommitteeLocations();
});

/* ---------- اللجنة الخاصة ---------- */
document.getElementById('exam-special-search-btn').addEventListener('click', async () => {
  const q = document.getElementById('exam-special-search').value.trim();
  const resultsEl = document.getElementById('exam-special-search-results');
  resultsEl.innerHTML = '';
  if (!q || !currentPeriodId) return;

  const { data } = await readScopedBySchool(scoped => {
    let query = sb.from('students').select('id, full_name, national_id, grade_level')
      .or(`full_name.ilike.%${q}%,national_id.ilike.%${q}%`);
    if (scoped && currentSchoolId) query = query.eq('school_id', currentSchoolId);
    return query.order('full_name').limit(15);
  });

  if (!data || data.length === 0) {
    resultsEl.innerHTML = '<div class="placeholder" style="padding:14px;"><p>ما فيه نتائج</p></div>';
    return;
  }
  data.forEach(s => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div class="info"><div class="name">${s.full_name}</div>
      <div class="title">${gradeLabels[s.grade_level] || ''} · ${s.national_id}</div></div>
      <button class="text-action-btn add-special-btn">إضافة للجنة الخاصة</button>`;
    row.querySelector('.add-special-btn').addEventListener('click', async () => {
      const conditionNote = prompt('الحالة (مثل: صعوبات تعلم، توحد، إعاقة حركية) — اختياري:', '');
      if (conditionNote === null) return;
      const { error } = await writeWithSchool(extra => sb.from('exam_special_members').insert({ period_id: currentPeriodId, student_id: s.id, condition_note: conditionNote.trim() || null, ...extra }));
      if (error) { alert(error.message.includes('duplicate') ? 'هذا الطالب مضاف مسبقًا' : 'تعذر الإضافة: ' + error.message); return; }
      document.getElementById('exam-special-search').value = '';
      resultsEl.innerHTML = '';
      await refreshSpecialList();
    });
    resultsEl.appendChild(row);
  });
});

async function refreshSpecialList() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_special_members').select('id, condition_note, students(full_name, national_id, grade_level)').eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  const list = document.getElementById('exam-special-list');
  list.innerHTML = '';
  const pr = progressByPeriod.get(currentPeriodId) || { located: 0, special: 0 };
  pr.special = (data || []).length;
  progressByPeriod.set(currentPeriodId, pr);
  renderSteps();
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:14px;"><p>ما فيه طلاب باللجنة الخاصة بعد</p></div>';
    return;
  }
  data.forEach(m => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    const conditionHtml = m.condition_note
      ? `<span style="font-size:11.5px; background:var(--sand); color:var(--ink); padding:3px 10px; border-radius:20px; font-weight:600;">${m.condition_note}</span>`
      : '';
    row.innerHTML = `
      <div class="info"><div class="name">${m.students ? m.students.full_name : '-'} ${conditionHtml}</div>
      <div class="title">${m.students ? (gradeLabels[m.students.grade_level] || '') : ''} · ${m.students ? m.students.national_id : ''}</div></div>
      <button class="text-action-btn edit-condition-btn">تعديل الحالة</button>
      <button class="text-action-btn" style="color:var(--danger) !important;">حذف</button>`;
    row.querySelector('.edit-condition-btn').addEventListener('click', async () => {
      const newNote = prompt('الحالة:', m.condition_note || '');
      if (newNote === null) return;
      await sb.from('exam_special_members').update({ condition_note: newNote.trim() || null }).eq('id', m.id);
      await refreshSpecialList();
    });
    row.querySelectorAll('button')[1].addEventListener('click', async () => {
      await sb.from('exam_special_members').delete().eq('id', m.id);
      await refreshSpecialList();
    });
    list.appendChild(row);
  });
}

/* ---------- توليد التوزيع ---------- */
function arabicSort(a, b) {
  return a.full_name.localeCompare(b.full_name, 'ar');
}

document.getElementById('exam-generate-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('exam-generate-error');
  errEl.style.display = 'none';
  if (!currentPeriodId || !currentPeriodRow) return;
  if (!confirm('توليد التوزيع يعيد ترقيم وتسكين كل الطلاب من الصفر لهذه الفترة. متأكد؟')) return;

  const [{ data: allStudents }, { data: specialMembers }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('students').select('id, full_name, grade_level');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_special_members').select('student_id').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);

  const specialIds = new Set((specialMembers || []).map(m => m.student_id));
  const specialStudents = (allStudents || []).filter(s => specialIds.has(s.id)).sort(arabicSort);
  const mainStudents = (allStudents || []).filter(s => !specialIds.has(s.id));

  const n = currentPeriodRow.committee_count;
  const gradeKeys = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  const seatStarts = {
    first_intermediate: currentPeriodRow.seat_start_first,
    second_intermediate: currentPeriodRow.seat_start_second,
    third_intermediate: currentPeriodRow.seat_start_third,
  };

  const assignments = [];

  gradeKeys.forEach(grade => {
    const list = mainStudents.filter(s => s.grade_level === grade).sort(arabicSort);
    const total = list.length;
    if (total === 0) return;
    const base = Math.floor(total / n);
    const remainder = total % n;

    let cursor = 0;
    for (let committee = 1; committee <= n; committee++) {
      const chunkSize = committee <= remainder ? base + 1 : base;
      for (let k = 0; k < chunkSize; k++) {
        const student = list[cursor];
        if (!student) break;
        assignments.push({
          period_id: currentPeriodId,
          student_id: student.id,
          committee_number: committee,
          is_special: false,
          seat_number: seatStarts[grade] + cursor,
        });
        cursor++;
      }
    }
  });

  specialStudents.forEach((s, idx) => {
    assignments.push({
      period_id: currentPeriodId,
      student_id: s.id,
      committee_number: null,
      is_special: true,
      seat_number: currentPeriodRow.special_seat_start + idx,
    });
  });

  await sb.from('exam_committee_assignments').delete().eq('period_id', currentPeriodId);
  const { error } = await writeWithSchool(extra => sb.from('exam_committee_assignments').insert(assignments.map(a => ({ ...a, ...extra }))));
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  await sb.from('exam_periods').update({ generated_at: new Date().toISOString() }).eq('id', currentPeriodId);
  currentPeriodRow.generated_at = new Date().toISOString();
  document.getElementById('exam-edit-warn').classList.add('hidden');
  renderSteps();
  await refreshResults();
});

/* ---------- عرض النتائج ---------- */
async function refreshResults() {
  const container = document.getElementById('exam-results');
  container.innerHTML = '';
  if (!currentPeriodId) return;

  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_assignments')
      .select('committee_number, is_special, seat_number, students(full_name, national_id, grade_level)')
      .eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('committee_number', { ascending: true }).order('seat_number', { ascending: true });
  });

  if (!data || data.length === 0) {
    container.innerHTML = '';
    return;
  }
  const { data: locs } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_locations').select('committee_number, location').eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  resultLocations = new Map((locs || []).map(l => [l.committee_number, l.location]));
  container.className = 'ex-results-grid';
  const head = document.createElement('div');
  head.className = 'ex-results-head';
  head.innerHTML = `<h5 class="ex-sub" style="margin:0;">نتيجة التوزيع <span class="ex-pill">${data.length} طالب</span></h5><button type="button" class="text-action-btn" id="exam-expand-all">عرض كل الأسماء</button>`;
  container.appendChild(head);
  head.querySelector('#exam-expand-all').addEventListener('click', (e) => {
    const cards = container.querySelectorAll('.ex-com-card');
    const anyClosed = [...cards].some(c => !c.classList.contains('open'));
    cards.forEach(c => c.classList.toggle('open', anyClosed));
    e.target.textContent = anyClosed ? 'إخفاء الأسماء' : 'عرض كل الأسماء';
  });

  const committees = new Map();
  const special = [];
  data.forEach(row => {
    if (row.is_special) { special.push(row); return; }
    if (!committees.has(row.committee_number)) committees.set(row.committee_number, []);
    committees.get(row.committee_number).push(row);
  });

  const sortedNumbers = Array.from(committees.keys()).sort((a, b) => a - b);
  sortedNumbers.forEach(num => {
    container.appendChild(buildCommitteeCard('لجنة رقم ' + num, committees.get(num)));
  });
  if (special.length > 0) {
    container.appendChild(buildCommitteeCard('اللجنة الخاصة', special));
  }
}

let resultLocations = new Map();
function buildCommitteeCard(title, rows) {
  const card = document.createElement('div');
  card.className = 'ex-com-card';
  const num = (title.match(/\d+/) || [])[0];
  const loc = num ? resultLocations.get(+num) : null;
  const byGrade = { first_intermediate: 0, second_intermediate: 0, third_intermediate: 0 };
  rows.forEach(r => { const g = r.students && r.students.grade_level; if (byGrade[g] != null) byGrade[g]++; });
  const seats = rows.map(r => r.seat_number).filter(n => n != null);
  const tableRows = rows.map((r, i) => `
    <tr><td>${i + 1}</td><td>${r.students ? escHtml(r.students.full_name) : ''}</td><td>${r.students ? (gradeLabels[r.students.grade_level] || '') : ''}</td><td dir="ltr">${r.students ? escHtml(r.students.national_id) : ''}</td><td><b>${r.seat_number ?? ''}</b></td></tr>`).join('');
  card.innerHTML = `
    <div class="ecc-head">
      <div class="ecc-title"><b>${escHtml(title)}</b><span>${loc ? escHtml(loc) : (num ? '<i style="color:var(--status-warn); font-style:normal;">بدون مقر</i>' : '')}</span></div>
      <span class="ecc-count">${rows.length}</span>
    </div>
    <div class="ecc-grades">
      <span>أول ${byGrade.first_intermediate}</span><span>ثاني ${byGrade.second_intermediate}</span><span>ثالث ${byGrade.third_intermediate}</span>
      ${seats.length ? `<span class="ecc-seats" dir="ltr">${Math.min(...seats)}–${Math.max(...seats)}</span>` : ''}
    </div>
    <div class="ecc-actions">
      <button type="button" class="text-action-btn ecc-toggle">الأسماء</button>
      <button type="button" class="text-action-btn print-btn">طباعة</button>
    </div>
    <div class="ecc-table"><table><thead><tr><th>م</th><th>اسم الطالب</th><th>الصف</th><th>الهوية</th><th>الجلوس</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
  card.querySelector('.ecc-toggle').addEventListener('click', () => card.classList.toggle('open'));
  card.querySelector('.print-btn').addEventListener('click', () => printCommittee(title, rows));
  return card;
}

function committeeLabelFromTitle(title) {
  const match = title.match(/\d+/);
  return match ? match[0] : 'خاصة';
}

function committeeInnerHtml(num, rows) {
  const year = currentPeriodRow ? (currentPeriodRow.academic_year || '') : '';
  const semester = currentPeriodRow ? (currentPeriodRow.semester || '') : '';
  const tableRows = rows.map((r, i) => {
    const gradeClass = r.students && r.students.grade_level === 'second_intermediate' ? ' class="grade-shade"' : '';
    return `
    <tr${gradeClass}>
      <td>${i + 1}</td>
      <td>${r.students ? r.students.national_id : ''}</td>
      <td class="name-cell">${r.students ? r.students.full_name : ''}</td>
      <td>${r.students ? (gradeLabels[r.students.grade_level] || '') : ''}</td>
      <td>${r.seat_number}</td>
      <td></td>
    </tr>`;
  }).join('');

  return `
    <div class="print-page">
    <div class="header">
      <img class="print-logo" style="width:216px;" />
      <div class="meta">
        <p>رقم اللجنة: ${num}</p>
        <p>العام: ${year}</p>
        <p>الفصل الدراسي: ${semester}</p>
        <p>المادة: ........................</p>
      </div>
    </div>
    <h2>كشف مناداة لجنة رقم ${num}</h2>
    <table>
      <colgroup><col style="width:4%;"><col style="width:10%;"><col style="width:42%;"><col style="width:10%;"><col style="width:8%;"><col class="sig"></colgroup>
      <thead><tr><th>م</th><th>رقم الهوية</th><th>اسم الطالب</th><th>الصف</th><th>رقم الجلوس</th><th>التوقيع</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="footer">
      <span>مراقب اللجان : ____________________</span>
      <span>الملاحظ: ____________________</span>
    </div>
    </div>`;
}

const PRINT_STYLES = `
  @page{ size: A4; margin: 10mm; }
  body{ font-family: Arial, sans-serif; margin:0; padding:8px; font-size:12px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table{ width:100%; border-collapse:collapse; margin-top:8px; }
  th, td{ border:1px solid #333; padding:4px 6px; text-align:center; font-size:12px; }
  th{ background:#B3E5F2 !important; color:#E8763A !important; font-size:15px; font-weight:bold; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .name-cell{ text-align:right; }
  .grade-shade{ background:#E6E6E6 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h2{ text-align:center; margin:6px 0 3px; font-size:20px; }
  .header{ display:flex; justify-content:space-between; align-items:center; }
  .meta p{ margin:2px 0; font-size:12px; font-weight:bold; text-align:right; }
  .footer{ display:flex; justify-content:space-between; margin-top:18px; font-size:15px; font-weight:bold; }
  col.sig{ width:22%; }
  .print-page{ page-break-after: always; }
  .print-page:last-child{ page-break-after: auto; }
`;

function openPrintWindow(win, title, innerHtml) {
  win.document.write(`
    <html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${title}</title>
    <style>${PRINT_STYLES}</style></head><body>${innerHtml}</body></html>`);
  win.document.close();
  const logoSrc = printLogo();
  const logos = win.document.querySelectorAll('.print-logo');
  if (!logoSrc) logos.forEach(img => img.remove());
  if (logos.length === 0 || !logoSrc) { win.print(); return; }
  let loaded = 0;
  const done = () => { loaded++; if (loaded === logos.length) win.print(); };
  logos.forEach(img => { img.onload = done; img.onerror = done; img.src = logoSrc; });
}

function printCommittee(title, rows) {
  const num = committeeLabelFromTitle(title);
  const inner = committeeInnerHtml(num, rows);
  const win = window.open('', '_blank');
  openPrintWindow(win, title, inner);
}

async function printAllCommittees(win) {
  if (!currentPeriodId) { win.close(); return; }
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_assignments')
      .select('committee_number, is_special, seat_number, students(full_name, national_id, grade_level)')
      .eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('committee_number', { ascending: true }).order('seat_number', { ascending: true });
  });

  if (!data || data.length === 0) { win.close(); alert('ما فيه توزيع مولّد لهذه الفترة بعد'); return; }

  const committees = new Map();
  const special = [];
  data.forEach(row => {
    if (row.is_special) { special.push(row); return; }
    if (!committees.has(row.committee_number)) committees.set(row.committee_number, []);
    committees.get(row.committee_number).push(row);
  });

  const sortedNumbers = Array.from(committees.keys()).sort((a, b) => a - b);
  let innerHtml = sortedNumbers.map(num => committeeInnerHtml(num, committees.get(num))).join('');
  if (special.length > 0) innerHtml += committeeInnerHtml('خاصة', special);
  openPrintWindow(win, 'كل كشوف المناداة', innerHtml);
}

/* ---------- كشوف الفصول (مقر كل طالب) ---------- */
function classSheetInnerHtml(title, rows) {
  const year = currentPeriodRow ? (currentPeriodRow.academic_year || '') : '';
  const semester = currentPeriodRow ? (currentPeriodRow.semester || '') : '';
  const tableRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.national_id}</td>
      <td class="name-cell">${r.full_name}</td>
      <td>${r.seat_number}</td>
      <td>${r.committee_label}</td>
      <td>${r.location || '-'}</td>
    </tr>`).join('');

  return `
    <div class="print-page">
    <div class="header">
      <img class="print-logo" style="width:216px;" />
      <div class="meta">
        <p>العام: ${year}</p>
        <p>الفصل الدراسي: ${semester}</p>
      </div>
    </div>
    <h2>كشف مقاعد الاختبار — ${title}</h2>
    <table>
      <colgroup><col style="width:5%;"><col style="width:14%;"><col style="width:38%;"><col style="width:13%;"><col style="width:13%;"><col style="width:17%;"></colgroup>
      <thead><tr><th>م</th><th>رقم الهوية</th><th>اسم الطالب</th><th>رقم الجلوس</th><th>رقم اللجنة</th><th>مقر اللجنة</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>`;
}

async function printClassSheets(win) {
  if (!currentPeriodId) { win.close(); return; }

  const [{ data: students }, { data: assignments }, { data: locations }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('students').select('id, full_name, national_id, grade_level, class_section');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_assignments').select('student_id, committee_number, seat_number, is_special').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_locations').select('committee_number, location').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);

  if (!assignments || assignments.length === 0) { win.close(); alert('ما فيه توزيع مولّد لهذه الفترة بعد'); return; }

  const locationMap = {};
  (locations || []).forEach(l => { locationMap[l.committee_number] = l.location; });

  const assignMap = {};
  assignments.forEach(a => { assignMap[a.student_id] = a; });

  const classGroups = new Map();
  (students || []).forEach(s => {
    const a = assignMap[s.id];
    if (!a) return;
    const key = s.grade_level + '|' + s.class_section;
    if (!classGroups.has(key)) classGroups.set(key, { grade_level: s.grade_level, class_section: s.class_section, rows: [] });
    classGroups.get(key).rows.push({
      full_name: s.full_name,
      national_id: s.national_id,
      seat_number: a.seat_number,
      committee_label: a.is_special ? 'خاصة' : a.committee_number,
      location: a.is_special ? '-' : (locationMap[a.committee_number] || '-'),
    });
  });

  const gradeOrder = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  const sortedKeys = Array.from(classGroups.keys()).sort((k1, k2) => {
    const g1 = classGroups.get(k1), g2 = classGroups.get(k2);
    const gi1 = gradeOrder.indexOf(g1.grade_level), gi2 = gradeOrder.indexOf(g2.grade_level);
    if (gi1 !== gi2) return gi1 - gi2;
    return (g1.class_section || 0) - (g2.class_section || 0);
  });

  let innerHtml = '';
  sortedKeys.forEach(key => {
    const group = classGroups.get(key);
    group.rows.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
    const title = (gradeLabels[group.grade_level] || '') + ' ' + (group.class_section || '');
    innerHtml += classSheetInnerHtml(title, group.rows);
  });

  if (!innerHtml) { win.close(); alert('ما فيه بيانات كافية لبناء كشوف الفصول'); return; }
  openPrintWindow(win, 'كشوف مقاعد الاختبار حسب الفصل', innerHtml);
}

/* ---------- كشف بحالات اللجنة الخاصة ---------- */
function specialConditionsInnerHtml(rows) {
  const year = currentPeriodRow ? (currentPeriodRow.academic_year || '') : '';
  const semester = currentPeriodRow ? (currentPeriodRow.semester || '') : '';
  const tableRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.national_id}</td>
      <td class="name-cell">${r.full_name}</td>
      <td>${r.grade_label}</td>
      <td>${r.seat_number}</td>
      <td>${r.condition_note || '-'}</td>
    </tr>`).join('');

  return `
    <div class="print-page">
    <div class="header">
      <img class="print-logo" style="width:216px;" />
      <div class="meta">
        <p>اللجنة: خاصة</p>
        <p>العام: ${year}</p>
        <p>الفصل الدراسي: ${semester}</p>
      </div>
    </div>
    <h2>كشف بحالات اللجنة الخاصة</h2>
    <table>
      <colgroup><col style="width:4%;"><col style="width:12%;"><col style="width:34%;"><col style="width:10%;"><col style="width:10%;"><col style="width:30%;"></colgroup>
      <thead><tr><th>م</th><th>رقم الهوية</th><th>اسم الطالب</th><th>الصف</th><th>رقم الجلوس</th><th>الحالة</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>`;
}

async function printSpecialConditions(win) {
  if (!currentPeriodId) { win.close(); return; }

  const [{ data: assignments }, { data: members }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_assignments')
        .select('student_id, seat_number, students(full_name, national_id, grade_level)')
        .eq('period_id', currentPeriodId).eq('is_special', true);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('seat_number', { ascending: true });
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_special_members').select('student_id, condition_note').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);

  if (!assignments || assignments.length === 0) { win.close(); alert('ما فيه طلاب باللجنة الخاصة مسكّنين لهذه الفترة بعد'); return; }

  const conditionMap = {};
  (members || []).forEach(m => { conditionMap[m.student_id] = m.condition_note; });

  const rows = assignments.map(a => ({
    full_name: a.students ? a.students.full_name : '',
    national_id: a.students ? a.students.national_id : '',
    grade_label: a.students ? (gradeLabels[a.students.grade_level] || '') : '',
    seat_number: a.seat_number,
    condition_note: conditionMap[a.student_id] || '',
  }));

  openPrintWindow(win, 'كشف بحالات اللجنة الخاصة', specialConditionsInnerHtml(rows));
}

/* ---------- كشاف اللجان (ملخص الأعداد) ---------- */
function committeeRosterInnerHtml(rows, totals) {
  const year = currentPeriodRow ? (currentPeriodRow.academic_year || '') : '';
  const semester = currentPeriodRow ? (currentPeriodRow.semester || '') : '';
  const tableRows = rows.map(r => `
    <tr>
      <td class="name-cell">${r.label}</td>
      <td>${r.location || '-'}</td>
      <td>${r.first}</td>
      <td>${r.second}</td>
      <td>${r.third}</td>
      <td>${r.total}</td>
    </tr>`).join('');

  return `
    <div class="print-page">
    <div class="header">
      <img class="print-logo" style="width:216px;" />
      <div class="meta">
        <p>العام: ${year}</p>
        <p>الفصل الدراسي: ${semester}</p>
      </div>
    </div>
    <h2>كشاف اللجان</h2>
    <table>
      <colgroup><col style="width:12%;"><col style="width:20%;"><col style="width:17%;"><col style="width:17%;"><col style="width:17%;"><col style="width:17%;"></colgroup>
      <thead><tr><th>اللجنة</th><th>مقرها</th><th>أول متوسط</th><th>ثاني متوسط</th><th>ثالث متوسط</th><th>الإجمالي</th></tr></thead>
      <tbody>${tableRows}
      <tr style="font-weight:bold;">
        <td colspan="2">الإجمالي</td>
        <td>${totals.first}</td>
        <td>${totals.second}</td>
        <td>${totals.third}</td>
        <td>${totals.total}</td>
      </tr>
      </tbody>
    </table>
    </div>`;
}

async function printCommitteeRoster(win) {
  if (!currentPeriodId || !currentPeriodRow) { win.close(); return; }

  const [{ data: assignments }, { data: locations }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_assignments').select('committee_number, is_special, students(grade_level)').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_locations').select('committee_number, location').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);

  if (!assignments || assignments.length === 0) { win.close(); alert('ما فيه توزيع مولّد لهذه الفترة بعد'); return; }

  const locationMap = {};
  (locations || []).forEach(l => { locationMap[l.committee_number] = l.location; });

  const counts = new Map();
  let specialCounts = { first: 0, second: 0, third: 0 };
  assignments.forEach(a => {
    const grade = a.students ? a.students.grade_level : null;
    if (a.is_special) {
      if (grade === 'first_intermediate') specialCounts.first++;
      else if (grade === 'second_intermediate') specialCounts.second++;
      else if (grade === 'third_intermediate') specialCounts.third++;
      return;
    }
    if (!counts.has(a.committee_number)) counts.set(a.committee_number, { first: 0, second: 0, third: 0 });
    const c = counts.get(a.committee_number);
    if (grade === 'first_intermediate') c.first++;
    else if (grade === 'second_intermediate') c.second++;
    else if (grade === 'third_intermediate') c.third++;
  });

  const rows = [];
  const totals = { first: 0, second: 0, third: 0, total: 0 };
  const sortedNumbers = Array.from(counts.keys()).sort((a, b) => a - b);
  sortedNumbers.forEach(num => {
    const c = counts.get(num);
    const total = c.first + c.second + c.third;
    rows.push({ label: 'لجنة' + num, location: locationMap[num] || '', first: c.first, second: c.second, third: c.third, total });
    totals.first += c.first; totals.second += c.second; totals.third += c.third; totals.total += total;
  });

  const specialTotal = specialCounts.first + specialCounts.second + specialCounts.third;
  if (specialTotal > 0) {
    rows.push({ label: 'لجنة خاصة', location: locationMap['special'] || '', first: specialCounts.first, second: specialCounts.second, third: specialCounts.third, total: specialTotal });
    totals.first += specialCounts.first; totals.second += specialCounts.second; totals.third += specialCounts.third; totals.total += specialTotal;
  }

  openPrintWindow(win, 'كشاف اللجان', committeeRosterInnerHtml(rows, totals));
}

document.getElementById('exam-print-all-btn').addEventListener('click', () => {
  const win = window.open('', '_blank');
  printAllCommittees(win);
});
document.getElementById('exam-class-sheets-btn').addEventListener('click', () => {
  const win = window.open('', '_blank');
  printClassSheets(win);
});
document.getElementById('exam-conditions-print-btn').addEventListener('click', () => {
  const win = window.open('', '_blank');
  printSpecialConditions(win);
});
document.getElementById('exam-roster-print-btn').addEventListener('click', () => {
  const win = window.open('', '_blank');
  printCommitteeRoster(win);
});

/* ---------- ملصقات الطلاب (GS-1114، 105×42مم، عمودين × 7 صفوف) ---------- */
const LABEL_LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAATkAAABMCAMAAAAhpzAFAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAINUExURQAAAP////////7+/v7+/v////7+/v39/f7+/v7+/v39/f////7+/v7+/v////7+/v7+/v7+/v////39/f7+/v////////////7+/v39/f7+/v////////7+/v7+/v////7+/v////7+/v39/f////////7+/v7+/v7+/v7+/v7+/v////39/f39/f////7+/v////////////////7+/v39/f////////////////////////////////////39/f39/f////////z8/P////////////7+/v39/f////////////7+/v7+/v////39/f////7+/v7+/v////39/f39/f7+/v////7+/v7+/v////39/f39/f7+/v////////39/f////39/f7+/v////7+/vz8/P39/f////////////////7+/v39/f////39/fz8/P////7+/v39/f////39/f39/f7+/v7+/v39/f7+/v39/f////////7+/v////39/f////39/f39/f7+/v7+/v////7+/v////////////7+/v////7+/v7+/vv7+/////7+/v7+/v////////////39/f39/f7+/v7+/v////7+/v7+/v////////7+/v////39/f7+/vz8/P////7+/v39/f39/f////39/f///////////////////yfN8loAAACvdFJOUwBl//SvStX+/a6jAtzsKdHowwaQyQUvaNqP8UUSwsp1uyDPlHhu5u25vd8Hqds58xxIXjXS72waaR8DEDJQTW6mCvBZb3Fb+4cBCBbZ+TuiLtb1qt/l+mT4/ojg9asbC6EEjPwzsVGNSUBaTO/aD5a5IbjyFGfktLOeyJIsNuc8m1159PLgPr4eJETpGMHN1kL32F9zFZzM5ep03eFUS61Og7zGKuuIdiL4WBlWEVVmFzv+AAAACXBIWXMAACHVAAAh1QEEnLSdAAAIK0lEQVR4Xu2bh78dRRXHxxHCQ0OLIIRQBKN0gnQFUWnBKAqIggIBjAVCx0KTokRUmgYLKlhAwQL6N3LO7/xmdmZ3dnf23pcHvHu/n3dnTvmdM7vn3dzc19yS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';

const LABEL_STYLES = `
  @page{ size: A4; margin: 0; }
  body{ font-family: Arial, sans-serif; margin:0; padding:0; }
  .label-page{ display:flex; flex-wrap:wrap; align-content:flex-start; width:210mm; height:297mm; box-sizing:border-box; }
  .label-card{ width:105mm; height:42mm; box-sizing:border-box; border:1px solid #999; display:flex; flex-direction:row; overflow:hidden; page-break-inside:avoid; background:#fff; }
  .label-strip{ width:12mm; background:#538135; display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:visible; }
  .label-strip img{ width:34mm; height:auto; transform:rotate(-90deg); }
  .label-main{ flex:1; padding:2mm 4mm; display:flex; flex-direction:column; }
  .label-tag{ margin-right:auto; border:0.4mm solid #375623; border-radius:3mm; padding:0.5mm 3mm; font-size:13px; font-weight:bold; color:#375623; flex-shrink:0; }
  .label-title{ text-align:center; font-weight:bold; font-size:15px; color:#2F5496; margin-top:1mm; }
  .label-body{ flex:1; display:flex; flex-direction:column; justify-content:center; gap:1.3mm; }
  .label-row{ font-size:15px; color:#000; }
  .label-row .lbl{ font-weight:bold; color:#7030A0; }
  .label-row .val-green{ color:#00B050; font-weight:bold; }
  .label-row .val-red{ color:#FF0000; font-weight:bold; }
`;

const LABELS_PER_PAGE = 14; // ورقة GS-1114: عمودين × 7 صفوف = 14 ملصق بالحجم الصحيح 105×42مم

/* يقسّم صفوف الملصقات إلى صفحات فعلية (كل صفحة 14 ملصق كحد أقصى بالحجم الصحيح).
   أي مجموعة (لجنة/مرحلة) دائمًا تبدأ بصفحة جديدة حتى لو فيه مكان فاضي بآخر صفحة قبلها،
   ولو المجموعة أكبر من صفحة وحدة تكمل على أكثر من صفحة بنفس الحجم الصحيح للملصقات. */
function buildLabelPagesHtml(rows, groupKeyFn) {
  const pages = [];
  let currentKey = null, currentPage = null;
  rows.forEach(r => {
    const key = groupKeyFn(r);
    if (key !== currentKey || !currentPage || currentPage.length >= LABELS_PER_PAGE) {
      currentPage = [];
      pages.push(currentPage);
      currentKey = key;
    }
    currentPage.push(r);
  });
  return pages.map(g => `<div class="label-page">` + g.map(studentLabelHtml).join('') + '</div>').join('');
}

const LABEL_STRIP_COLORS = {
  first_intermediate: '#2F5496',   // أول متوسط - أزرق
  second_intermediate: '#538135',  // ثاني متوسط - أخضر
  third_intermediate: '#D9A400',   // ثالث متوسط - أصفر
};

function studentLabelHtml(r) {
  const stripColor = LABEL_STRIP_COLORS[r.grade_level] || '#538135';
  return `
    <div class="label-card">
      <div class="label-strip" style="background:${stripColor};"><img src="data:image/png;base64,${LABEL_LOGO_B64}"></div>
      <div class="label-main">
        <div class="label-tag">${r.committee_label}</div>
        <div class="label-title">بيانات الطالب</div>
        <div class="label-body">
          <div class="label-row"><span class="lbl">اسم الطالب : </span>${r.full_name}</div>
          <div class="label-row"><span class="lbl">رقم الهوية : </span><span class="val-green">${r.national_id}</span></div>
          <div class="label-row"><span class="lbl">رقم الجلوس : </span><span class="val-red">${r.seat_number}</span>&nbsp;&nbsp;&nbsp;<span class="lbl">الصف : </span>${r.grade_label}</div>
        </div>
      </div>
    </div>`;
}

const PDF_LIB_URLS = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};
const scriptLoadPromises = {};
function loadScript(key, src) {
  if (scriptLoadPromises[key]) return scriptLoadPromises[key];
  scriptLoadPromises[key] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete scriptLoadPromises[key]; reject(new Error('تعذر تحميل مكتبة إنشاء PDF (' + key + ')')); };
    document.head.appendChild(s);
  });
  return scriptLoadPromises[key];
}
async function loadPdfLibs() {
  if (!window.html2canvas) await loadScript('html2canvas', PDF_LIB_URLS.html2canvas);
  if (!window.jspdf) await loadScript('jspdf', PDF_LIB_URLS.jspdf);
}

// يبني الملصقات في عنصر مخفي بالصفحة الحالية، يصوّر كل صفحة (كل لجنة/مرحلة) على حدة،
// ثم يجمعها في ملف PDF وينزّله مباشرة. نستخدم html2canvas وjsPDF مباشرة (بدون مكوّن
// تقسيم الصفحات التلقائي بمكتبات أخرى) عشان لو صار خطأ أثناء التصوير نقدر نمسكه ونبلّغ المستخدم،
// بدل ما ننتج ملف فارغ بصمت.
async function downloadLabelsPdf(innerHtml, filename) {
  await loadPdfLibs();

  const container = document.createElement('div');
  // بالزاوية (0,0) وخلف كل شي بـ z-index سالب - عناصر بعيدة جدًا عن الشاشة تخلي html2canvas يطلع صورة فارغة أحيانًا
  container.style.cssText = 'position:fixed; top:0; left:0; width:210mm; background:#fff; z-index:-9999;';
  container.innerHTML = `<style>${LABEL_STYLES}</style>${innerHtml}`;
  document.body.appendChild(container);

  // ننتظر إطارين عشان نضمن اكتمال الرسم/تخطيط الصفحة (وتحميل صورة الشعار) قبل التصوير
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const pageEls = Array.from(container.querySelectorAll('.label-page'));
    if (pageEls.length === 0) throw new Error('لا توجد ملصقات لعرضها');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    for (let i = 0; i < pageEls.length; i++) {
      const canvas = await window.html2canvas(pageEls[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        windowWidth: pageEls[i].scrollWidth || 794,
        windowHeight: pageEls[i].scrollHeight || 1123,
      });
      if (!canvas.width || !canvas.height) throw new Error('فشل تصوير الملصقات (الصورة الناتجة فارغة)');

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      if (i > 0) doc.addPage();
      doc.addImage(imgData, 'JPEG', 0, 0, 210, 297);
    }

    doc.save(filename);
  } catch (err) {
    alert('تعذر إنشاء ملف PDF: ' + (err && err.message ? err.message : err));
  } finally {
    document.body.removeChild(container);
  }
}

async function printStudentLabels() {
  if (!currentPeriodId) return;

  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_assignments')
      .select('committee_number, is_special, seat_number, students(full_name, national_id, grade_level)')
      .eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('committee_number', { ascending: true }).order('seat_number', { ascending: true });
  });

  if (!data || data.length === 0) { alert('ما فيه توزيع مولّد لهذه الفترة بعد'); return; }

  const rows = data.map(r => ({
    full_name: r.students ? r.students.full_name : '',
    national_id: r.students ? r.students.national_id : '',
    grade_level: r.students ? r.students.grade_level : '',
    grade_label: r.students ? (gradeLabels[r.students.grade_level] || '') : '',
    seat_number: r.seat_number,
    committee_label: r.is_special ? 'لجنة خاصة' : ('لجنة رقم \u200F' + r.committee_number),
    _committee_key: r.is_special ? 'special' : r.committee_number,
  }));

  // كل لجنة تبدأ بصفحة جديدة
  const innerHtml = buildLabelPagesHtml(rows, r => r._committee_key);
  await downloadLabelsPdf(innerHtml, 'ملصقات-الطلاب.pdf');
}

async function printStudentLabelsByGrade() {
  if (!currentPeriodId) return;

  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_assignments')
      .select('committee_number, is_special, seat_number, students(full_name, national_id, grade_level)')
      .eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('committee_number', { ascending: true }).order('seat_number', { ascending: true });
  });

  if (!data || data.length === 0) { alert('ما فيه توزيع مولّد لهذه الفترة بعد'); return; }

  const GRADE_ORDER = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

  const rows = data.map(r => ({
    full_name: r.students ? r.students.full_name : '',
    national_id: r.students ? r.students.national_id : '',
    grade_level: r.students ? r.students.grade_level : '',
    grade_label: r.students ? (gradeLabels[r.students.grade_level] || '') : '',
    seat_number: r.seat_number,
    committee_label: r.is_special ? 'لجنة خاصة' : ('لجنة رقم \u200F' + r.committee_number),
  })).sort((a, b) => GRADE_ORDER.indexOf(a.grade_level) - GRADE_ORDER.indexOf(b.grade_level));

  // كل مرحلة (أول متوسط، ثاني متوسط، ثالث متوسط) تبدأ بصفحة جديدة مستقلة
  const innerHtml = buildLabelPagesHtml(rows, r => r.grade_level);
  await downloadLabelsPdf(innerHtml, 'ملصقات-الطلاب-حسب-المرحلة.pdf');
}

document.getElementById('exam-labels-print-btn').addEventListener('click', () => {
  printStudentLabels();
});

document.getElementById('exam-labels-print-bygrade-btn').addEventListener('click', () => {
  printStudentLabelsByGrade();
});

/* ---------- إعداد رسائل أولياء الأمور ---------- */
document.getElementById('exam-messages-export-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('exam-messages-error');
  errEl.style.display = 'none';
  if (!currentPeriodId) return;

  const template = document.getElementById('exam-message-template').value;
  if (!template.trim()) { errEl.textContent = 'اكتب نص الرسالة أولاً'; errEl.style.display = 'block'; return; }

  const { data: assignments } = await readScopedBySchool(scoped => {
    let q = sb.from('exam_committee_assignments')
      .select('student_id, committee_number, seat_number, is_special').eq('period_id', currentPeriodId);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

  if (!assignments || assignments.length === 0) { errEl.textContent = 'ما فيه توزيع مولّد لهذه الفترة بعد'; errEl.style.display = 'block'; return; }

  const [{ data: students }, { data: locations }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('students').select('id, full_name, grade_level, mobile');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    readScopedBySchool(scoped => {
      let q = sb.from('exam_committee_locations').select('committee_number, location').eq('period_id', currentPeriodId);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
  ]);

  const studentMap = {};
  (students || []).forEach(s => { studentMap[s.id] = s; });
  const locationMap = {};
  (locations || []).forEach(l => { locationMap[l.committee_number] = l.location; });

  const rows = [];
  assignments.forEach(a => {
    const s = studentMap[a.student_id];
    if (!s || !s.mobile) return;
    const firstName = (s.full_name || '').trim().split(/\s+/)[0] || '';
    const committeeLabel = a.is_special ? 'اللجنة الخاصة' : ('لجنة ' + a.committee_number);
    const location = a.is_special ? '' : (locationMap[a.committee_number] || '');
    const msg = template
      .replaceAll('#الاسم_الاول', firstName)
      .replaceAll('#اللجنة', committeeLabel)
      .replaceAll('#الصف', gradeLabels[s.grade_level] || '')
      .replaceAll('#رقم_الجلوس', String(a.seat_number))
      .replaceAll('#المقر', location);
    rows.push([s.mobile, msg]);
  });

  if (rows.length === 0) { errEl.textContent = 'ما فيه طلاب لديهم رقم جوال مسجّل بهذه الفترة'; errEl.style.display = 'block'; return; }

  await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الرسائل');
  XLSX.writeFile(wb, 'رسائل_اولياء_الامور.xlsx');
});
document.getElementById('back-to-tiles-9').addEventListener('click', backToTiles);
