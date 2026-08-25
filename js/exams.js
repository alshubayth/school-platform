import { sb, currentUserId, setupCollapsible, backToTiles, gradeLabels } from './core.js';

setupCollapsible('exam-import-toggle', 'exam-import-body', 'exam-import-chevron');
setupCollapsible('exam-period-toggle', 'exam-period-body', 'exam-period-chevron');

let currentPeriodId = null;
let currentPeriodRow = null;

export async function loadExamsModule() {
  await refreshStudentStats();
  await refreshPeriodsList();
  document.getElementById('exam-period-detail').classList.add('hidden');
  currentPeriodId = null;
}

/* ---------- استيراد الطلاب ---------- */
async function refreshStudentStats() {
  const { data } = await sb.from('students').select('grade_level');
  const grades = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  const counts = { first_intermediate: 0, second_intermediate: 0, third_intermediate: 0 };
  (data || []).forEach(s => { if (counts[s.grade_level] !== undefined) counts[s.grade_level]++; });
  const container = document.getElementById('exam-student-stats');
  container.innerHTML = grades.map(g => `
    <div class="stat-card"><div class="label">${gradeLabels[g]}</div><div class="value">${counts[g]}</div></div>`).join('');
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

      let headerIdx = -1, colMap = {};
      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const idx = row.findIndex(c => String(c).trim() === 'اسم الطالب');
        if (idx !== -1) {
          headerIdx = i;
          row.forEach((cell, ci) => { colMap[String(cell).trim()] = ci; });
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
        const name = row[colMap['اسم الطالب']];
        const nationalId = row[colMap['رقم الطالب']];
        const classSection = row[colMap['الفصل']];
        const gradeRaw = row[colMap['رقم الصف']];
        const mobile = row[colMap['الجوال']];
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

      const { error } = await sb.from('students').upsert(students, { onConflict: 'national_id' });
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

  const { error } = await sb.from('exam_periods').insert({
    name, academic_year: academicYear || null, semester,
    committee_count: committeeCount,
    seat_start_first: seatFirst, seat_start_second: seatSecond, seat_start_third: seatThird,
    special_seat_start: specialSeatStart, created_by: currentUserId,
  });
  if (error) { errEl.textContent = 'تعذر الإنشاء: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('exam-period-name').value = '';
  document.getElementById('exam-academic-year').value = '';
  document.getElementById('exam-committee-count').value = '';
  await refreshPeriodsList();
});

async function refreshPeriodsList() {
  const { data } = await sb.from('exam_periods').select('*').order('created_at', { ascending: false });
  const list = document.getElementById('exam-periods-list');
  list.innerHTML = '';
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>لا توجد فترات اختبار بعد</p></div>';
    return;
  }
  data.forEach(p => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div class="info"><div class="name">${p.name}</div>
      <div class="title">${p.committee_count} لجنة ${p.generated_at ? '· تم التوليد' : '· لم يُولَّد بعد'}</div></div>
      <button class="manage-btn text-action-btn">إدارة</button>
      <button class="delete-period-btn text-action-btn" style="color:var(--danger) !important;">حذف</button>`;
    row.querySelector('.manage-btn').addEventListener('click', () => selectPeriod(p));
    row.querySelector('.delete-period-btn').addEventListener('click', async () => {
      if (!confirm(`متأكد تبي تحذف فترة "${p.name}"؟ هذا يحذف كل التوزيع المرتبط فيها.`)) return;
      await sb.from('exam_periods').delete().eq('id', p.id);
      if (currentPeriodId === p.id) document.getElementById('exam-period-detail').classList.add('hidden');
      await refreshPeriodsList();
    });
    list.appendChild(row);
  });
}

async function selectPeriod(period) {
  currentPeriodId = period.id;
  currentPeriodRow = period;
  document.getElementById('exam-period-detail').classList.remove('hidden');
  document.getElementById('exam-detail-title').textContent = 'إدارة فترة: ' + period.name;
  document.getElementById('exam-special-search').value = '';
  document.getElementById('exam-special-search-results').innerHTML = '';
  await refreshSpecialList();
  await refreshResults();
}

/* ---------- اللجنة الخاصة ---------- */
document.getElementById('exam-special-search-btn').addEventListener('click', async () => {
  const q = document.getElementById('exam-special-search').value.trim();
  const resultsEl = document.getElementById('exam-special-search-results');
  resultsEl.innerHTML = '';
  if (!q || !currentPeriodId) return;

  const { data } = await sb.from('students').select('id, full_name, national_id, grade_level')
    .or(`full_name.ilike.%${q}%,national_id.ilike.%${q}%`).order('full_name').limit(15);

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
      const { error } = await sb.from('exam_special_members').insert({ period_id: currentPeriodId, student_id: s.id });
      if (error) { alert(error.message.includes('duplicate') ? 'هذا الطالب مضاف مسبقًا' : 'تعذر الإضافة: ' + error.message); return; }
      document.getElementById('exam-special-search').value = '';
      resultsEl.innerHTML = '';
      await refreshSpecialList();
    });
    resultsEl.appendChild(row);
  });
});

async function refreshSpecialList() {
  const { data } = await sb.from('exam_special_members').select('id, students(full_name, national_id, grade_level)').eq('period_id', currentPeriodId);
  const list = document.getElementById('exam-special-list');
  list.innerHTML = '';
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:14px;"><p>ما فيه طلاب باللجنة الخاصة بعد</p></div>';
    return;
  }
  data.forEach(m => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div class="info"><div class="name">${m.students ? m.students.full_name : '-'}</div>
      <div class="title">${m.students ? (gradeLabels[m.students.grade_level] || '') : ''} · ${m.students ? m.students.national_id : ''}</div></div>
      <button class="text-action-btn" style="color:var(--danger) !important;">حذف</button>`;
    row.querySelector('button').addEventListener('click', async () => {
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
    sb.from('students').select('id, full_name, grade_level'),
    sb.from('exam_special_members').select('student_id').eq('period_id', currentPeriodId),
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
  const { error } = await sb.from('exam_committee_assignments').insert(assignments);
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  await sb.from('exam_periods').update({ generated_at: new Date().toISOString() }).eq('id', currentPeriodId);
  currentPeriodRow.generated_at = new Date().toISOString();
  await refreshResults();
  await refreshPeriodsList();
});

/* ---------- عرض النتائج ---------- */
async function refreshResults() {
  const container = document.getElementById('exam-results');
  container.innerHTML = '';
  if (!currentPeriodId) return;

  const { data } = await sb.from('exam_committee_assignments')
    .select('committee_number, is_special, seat_number, students(full_name, national_id, grade_level)')
    .eq('period_id', currentPeriodId)
    .order('committee_number', { ascending: true })
    .order('seat_number', { ascending: true });

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما تم توليد أي توزيع لهذه الفترة بعد</p></div>';
    return;
  }

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

function buildCommitteeCard(title, rows) {
  const card = document.createElement('div');
  card.className = 'form-card';
  const tableRows = rows.map((r, i) => `
    <tr>
      <td style="padding:6px 8px; border-bottom:1px solid #ECEAE1;">${i + 1}</td>
      <td style="padding:6px 8px; border-bottom:1px solid #ECEAE1;">${r.students ? r.students.national_id : ''}</td>
      <td style="padding:6px 8px; border-bottom:1px solid #ECEAE1;">${r.students ? r.students.full_name : ''}</td>
      <td style="padding:6px 8px; border-bottom:1px solid #ECEAE1;">${r.students ? (gradeLabels[r.students.grade_level] || '') : ''}</td>
      <td style="padding:6px 8px; border-bottom:1px solid #ECEAE1;">${r.seat_number}</td>
    </tr>`).join('');

  card.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
      <h4 style="margin:0;">${title} <span style="font-size:12px; color:var(--slate); font-weight:400;">(${rows.length} طالب)</span></h4>
      <button class="print-btn text-action-btn">طباعة</button>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="background:var(--sand);">
          <th style="padding:6px 8px; text-align:right;">م</th>
          <th style="padding:6px 8px; text-align:right;">رقم الهوية</th>
          <th style="padding:6px 8px; text-align:right;">اسم الطالب</th>
          <th style="padding:6px 8px; text-align:right;">الصف</th>
          <th style="padding:6px 8px; text-align:right;">رقم الجلوس</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;

  card.querySelector('.print-btn').addEventListener('click', () => printCommittee(title, rows));
  return card;
}

function committeeLabelFromTitle(title) {
  const match = title.match(/\d+/);
  return match ? match[0] : 'خاصة';
}

function printCommittee(title, rows) {
  const num = committeeLabelFromTitle(title);
  const year = currentPeriodRow ? (currentPeriodRow.academic_year || '') : '';
  const semester = currentPeriodRow ? (currentPeriodRow.semester || '') : '';
  const logoImg = document.querySelector('.sidebar .brand img');
  const logoSrc = logoImg ? logoImg.getAttribute('src') : '';

  const tableRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.students ? r.students.national_id : ''}</td>
      <td class="name-cell">${r.students ? r.students.full_name : ''}</td>
      <td>${r.students ? (gradeLabels[r.students.grade_level] || '') : ''}</td>
      <td>${r.seat_number}</td>
      <td>لجنة${num}</td>
      <td></td>
    </tr>`).join('');

  const win = window.open('', '_blank');
  win.document.write(`
    <html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${title}</title>
    <style>
      body{ font-family: Arial, sans-serif; padding:24px; }
      table{ width:100%; border-collapse:collapse; margin-top:16px; }
      th, td{ border:1px solid #333; padding:6px 8px; text-align:center; font-size:13px; }
      th{ background:#eee; }
      .name-cell{ text-align:right; }
      h2{ text-align:center; margin:10px 0 4px; }
      .header{ display:flex; justify-content:space-between; align-items:flex-start; }
      .meta p{ margin:2px 0; font-size:13px; }
      .footer{ display:flex; justify-content:space-between; margin-top:40px; font-size:13px; }
    </style></head><body>
    <div class="header">
      <div class="meta">
        <p>رقم اللجنة: ${num}</p>
        <p>العام: ${year}</p>
        <p>الفصل الدراسي: ${semester}</p>
        <p>المادة: ........................</p>
      </div>
      ${logoSrc ? `<img src="${logoSrc}" style="width:140px;" />` : ''}
    </div>
    <h2>كشف مناداة لجنة رقم ${num}</h2>
    <table><thead><tr><th>م</th><th>رقم الهوية</th><th>اسم الطالب</th><th>الصف</th><th>رقم الجلوس</th><th>اللجنة</th><th>التوقيع</th></tr></thead>
    <tbody>${tableRows}</tbody></table>
    <div class="footer">
      <span>مراقب اللجان : ____________________</span>
      <span>الملاحظ: ____________________</span>
    </div>
    </body></html>`);
  win.document.close();
  win.print();
}

document.getElementById('back-to-tiles-9').addEventListener('click', backToTiles);
