/*
 * معمل الحاسب الآلي: معمل واحد بالمدرسة - يجمع طلاب كل الفصول اللي يدرّسها المعلم بمكان
 * واحد، ويوزّعهم على أرقام أجهزة المعمل (تجميعة واحدة، رقم الجهاز فريد على مستوى المعمل
 * كامل مو لكل فصل لحاله). التوزيع يُنشأ أول مرة تلقائيًا (بترتيب إضافة الفصول ثم أبجديًا داخل
 * كل فصل) ويبقى ثابتًا بعدها بجدول lab_seat_assignments - ما يتغيّر عشوائيًا كل مرة، ويقبل
 * تعديل يدوي (تبديل جهازين). لو مجموع الطلاب أكثر من عدد الأجهزة، الزيادة تظهر كتنبيه بدون
 * جهاز بدل ما توزّع أكثر من طالب على نفس الجهاز.
 */
import { sb, currentUserId, gradeLabels, backToTiles } from './core.js';

document.getElementById('back-to-tiles-16').addEventListener('click', backToTiles);

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function classLabel(grade, section) { return `${gradeLabels[grade] || grade} - الفصل ${section}`; }

let labGrade = 'first_intermediate';
let computerCount = null;
let classesCache = [];   // الفصول المضافة بترتيب الإضافة

export async function loadComputerLabModule() {
  renderGradeTabs();
  await refreshSectionOptions();
  await loadSettings();
  await refreshClassesList();
  await renderSeatingSection();
}

/* ---------- إعداد عدد أجهزة المعمل ---------- */
async function loadSettings() {
  const { data } = await sb.from('lab_settings').select('*').eq('teacher_id', currentUserId);
  const row = (data || [])[0];
  computerCount = row ? row.computer_count : null;
  document.getElementById('lab-computer-count').value = computerCount || '';
}

document.getElementById('lab-save-settings-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('lab-settings-error');
  errEl.style.display = 'none';
  const n = Number(document.getElementById('lab-computer-count').value);
  if (!n || n < 1) { errEl.textContent = 'أدخل عدد أجهزة صحيح'; errEl.style.display = 'block'; return; }
  const { error } = await sb.from('lab_settings').upsert({ teacher_id: currentUserId, computer_count: n }, { onConflict: 'teacher_id' });
  if (error) { errEl.textContent = 'تعذّر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }
  computerCount = n;
  await renderSeatingSection();
});

/* ---------- الفصول اللي يدرّسها بالمعمل ---------- */
function renderGradeTabs() {
  const wrap = document.getElementById('lab-grade-tabs');
  wrap.innerHTML = '';
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (g === labGrade ? ' active' : '');
    btn.textContent = gradeLabels[g];
    btn.addEventListener('click', () => {
      labGrade = g;
      renderGradeTabs();
      refreshSectionOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshSectionOptions() {
  const sel = document.getElementById('lab-section-select');
  sel.innerHTML = '<option value="">جارٍ التحميل...</option>';
  const { data } = await sb.from('students').select('class_section').eq('grade_level', labGrade);
  const sections = [...new Set((data || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);
  sel.innerHTML = sections.length === 0
    ? '<option value="">ما فيه طلاب مسجلين لهذه المرحلة بعد</option>'
    : '<option value="">اختر الفصل</option>' + sections.map(n => `<option value="${n}">الفصل ${n}</option>`).join('');
}

document.getElementById('lab-add-class-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('lab-add-error');
  errEl.style.display = 'none';
  const section = Number(document.getElementById('lab-section-select').value);
  if (!section) { errEl.textContent = 'اختر الفصل أولاً'; errEl.style.display = 'block'; return; }

  const { error } = await sb.from('lab_classes').upsert({
    teacher_id: currentUserId, grade_level: labGrade, class_section: section,
  }, { onConflict: 'teacher_id,grade_level,class_section' });
  if (error) { errEl.textContent = 'تعذّرت الإضافة: ' + error.message; errEl.style.display = 'block'; return; }
  await refreshClassesList();
  await renderSeatingSection();
});

async function refreshClassesList() {
  const { data } = await sb.from('lab_classes').select('*').eq('teacher_id', currentUserId).order('created_at');
  classesCache = data || [];
  renderClassesChips();
}

function renderClassesChips() {
  const wrap = document.getElementById('lab-classes-chips');
  if (classesCache.length === 0) {
    wrap.innerHTML = '<p style="font-size:12.5px; color:var(--slate); margin:8px 0 0;">ما أضفت أي فصل بالمعمل بعد</p>';
    return;
  }
  wrap.innerHTML = '';
  classesCache.forEach(lc => {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:var(--sand); border-radius:999px; padding:6px 12px; font-size:13px; margin:4px 6px 0 0;';
    chip.innerHTML = `${esc(classLabel(lc.grade_level, lc.class_section))} <button type="button" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:14px; line-height:1;">✕</button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      await sb.from('lab_classes').delete().eq('id', lc.id);
      await refreshClassesList();
      await renderSeatingSection();
    });
    wrap.appendChild(chip);
  });
}

/* ---------- توزيع الطلاب على أجهزة المعمل (تجميعة واحدة لكل الفصول) ---------- */
// يجمع طلاب كل الفصول المضافة (بترتيب إضافتها، وأبجديًا داخل كل فصل)، ويضمن كل طالب جديد
// ياخذ أول رقم جهاز فاضي - بدون ما يغيّر توزيع أي طالب موزّع مسبقًا
async function ensureSeating() {
  const allStudents = []; // بترتيب: الفصول حسب تاريخ إضافتها، وداخل كل فصل أبجديًا
  for (const lc of classesCache) {
    const { data } = await sb.from('students').select('id, full_name')
      .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section).order('full_name');
    (data || []).forEach(s => allStudents.push({ ...s, lab_class_id: lc.id, grade_level: lc.grade_level, class_section: lc.class_section }));
  }

  const validIds = new Set(allStudents.map(s => s.id));
  const { data: rawSeats } = await sb.from('lab_seat_assignments').select('*').eq('teacher_id', currentUserId);
  // نحرر أي مقعد بقي لطالب لم يعد ضمن فصول المعمل الحالية (مثلاً انحذف فصله من القائمة،
  // أو تبدّل مكانه سابقًا مع طالب من فصل آخر ثم انحذف الفصل الأصلي) بدل الاعتماد فقط على
  // حذف قاعدة البيانات المتسلسل حسب lab_class_id الذي قد لا يطابق الطالب الجالس فعليًا بعد التبديل
  const orphaned = (rawSeats || []).filter(s => !validIds.has(s.student_id));
  for (const seat of orphaned) await sb.from('lab_seat_assignments').delete().eq('id', seat.id);
  const seats = (rawSeats || []).filter(s => validIds.has(s.student_id));

  const assignedStudentIds = new Set(seats.map(s => s.student_id));
  const usedComputerNumbers = new Set(seats.map(s => s.computer_number));
  const unassigned = allStudents.filter(s => !assignedStudentIds.has(s.id));

  const freeNumbers = [];
  if (computerCount) {
    for (let n = 1; n <= computerCount && freeNumbers.length < unassigned.length; n++) {
      if (!usedComputerNumbers.has(n)) freeNumbers.push(n);
    }
  }
  const newRows = unassigned.slice(0, freeNumbers.length).map((s, i) => ({
    teacher_id: currentUserId, lab_class_id: s.lab_class_id, student_id: s.id, computer_number: freeNumbers[i],
  }));
  if (newRows.length) await sb.from('lab_seat_assignments').insert(newRows);

  const { data: finalSeats } = await sb.from('lab_seat_assignments').select('*').eq('teacher_id', currentUserId).order('computer_number');
  const infoById = new Map(allStudents.map(s => [s.id, s]));
  const seatedIds = new Set((finalSeats || []).map(s => s.student_id));
  const overflow = allStudents.filter(s => !seatedIds.has(s.id));
  return { seats: finalSeats || [], infoById, overflow };
}

async function renderSeatingSection() {
  const container = document.getElementById('lab-seating-area');
  if (!computerCount) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>حدّد عدد أجهزة المعمل أولاً</p></div>';
    return;
  }
  if (classesCache.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>أضف فصل واحد على الأقل عشان يبدأ التوزيع</p></div>';
    return;
  }
  container.innerHTML = '<p style="font-size:12.5px; color:var(--slate);">جارٍ تحميل التوزيع...</p>';
  const { seats, infoById, overflow } = await ensureSeating();

  const rowsHtml = seats.map(seat => {
    const info = infoById.get(seat.student_id);
    return `<tr data-seat-id="${seat.id}" data-computer="${seat.computer_number}">
      <td style="padding:6px 8px; text-align:center; font-weight:700;">${seat.computer_number}</td>
      <td style="padding:6px 8px;">${esc(info ? info.full_name : '؟')}</td>
      <td style="padding:6px 8px; color:var(--slate);">${info ? esc(classLabel(info.grade_level, info.class_section)) : '-'}</td>
      <td style="padding:6px 8px; text-align:center;">
        <input type="number" class="lab-move-input" min="1" max="${computerCount}" placeholder="بدّل مع جهاز رقم..." style="width:120px; margin:0; padding:5px 8px; font-size:12.5px;">
        <button type="button" class="lab-move-btn" style="border:1px solid var(--slate); background:none; color:var(--slate); border-radius:6px; padding:5px 10px; font-size:12px; cursor:pointer;">نقل/تبديل</button>
      </td>
    </tr>`;
  }).join('');

  const overflowHtml = overflow.length === 0 ? '' : `
    <div style="background:#FDEDEC; border-radius:8px; padding:10px 12px; margin-top:12px;">
      <p style="margin:0 0 4px; font-size:12.5px; color:var(--danger); font-weight:700;">⚠ عدد الطلاب (${seats.length + overflow.length}) أكثر من عدد أجهزة المعمل (${computerCount}) - الطلاب التاليين بدون جهاز:</p>
      <p style="margin:0; font-size:12.5px; color:var(--danger);">${overflow.map(s => `${esc(s.full_name)} (${esc(classLabel(s.grade_level, s.class_section))})`).join('، ')}</p>
    </div>`;

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="background:var(--sand);">
          <th style="padding:6px 8px; text-align:center;">رقم الجهاز</th>
          <th style="padding:6px 8px; text-align:right;">الطالب</th>
          <th style="padding:6px 8px; text-align:right;">الفصل</th>
          <th style="padding:6px 8px; text-align:center;">تعديل</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${overflowHtml}
  `;

  container.querySelectorAll('tr[data-seat-id]').forEach(row => {
    row.querySelector('.lab-move-btn').addEventListener('click', async () => {
      const fromComputer = Number(row.dataset.computer);
      const toComputer = Number(row.querySelector('.lab-move-input').value);
      if (!toComputer || toComputer === fromComputer) return;
      await moveOrSwapSeat(fromComputer, toComputer);
      await renderSeatingSection();
    });
  });
}

// ينقل طالب الجهاز A لجهاز B الفاضي، أو يبدّل طالبي الجهازين لو B مشغول أصلاً
async function moveOrSwapSeat(fromComputer, toComputer) {
  if (toComputer < 1 || toComputer > computerCount) return;
  // خريطة طالب → فصله الحالي بالمعمل، عشان نحدّث lab_class_id مع الطالب دايمًا (وإلا يختل حذف
  // الفصول المتسلسل لاحقًا لو تبدّل طالب من فصل لمقعد كان يخص فصل ثاني)
  const studentClassId = new Map();
  for (const lc of classesCache) {
    const { data } = await sb.from('students').select('id')
      .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section);
    (data || []).forEach(s => studentClassId.set(s.id, lc.id));
  }

  const { data: seats } = await sb.from('lab_seat_assignments').select('*').eq('teacher_id', currentUserId);
  const fromSeat = (seats || []).find(s => s.computer_number === fromComputer);
  const toSeat = (seats || []).find(s => s.computer_number === toComputer);
  if (!fromSeat) return;
  if (toSeat) {
    const fromStudent = fromSeat.student_id;
    const toStudent = toSeat.student_id;
    await sb.from('lab_seat_assignments').update({ student_id: toStudent, lab_class_id: studentClassId.get(toStudent) || fromSeat.lab_class_id }).eq('id', fromSeat.id);
    await sb.from('lab_seat_assignments').update({ student_id: fromStudent, lab_class_id: studentClassId.get(fromStudent) || toSeat.lab_class_id }).eq('id', toSeat.id);
  } else {
    await sb.from('lab_seat_assignments').update({ computer_number: toComputer }).eq('id', fromSeat.id);
  }
}

/* ---------- طباعة أوراق اللصق (ورقة منفصلة لكل جهاز، لكل فصول المعمل مع بعض) ---------- */
document.getElementById('lab-print-btn').addEventListener('click', async () => {
  if (!computerCount || classesCache.length === 0) { alert('حدّد عدد الأجهزة وأضف فصل واحد على الأقل أولاً'); return; }
  const { seats, infoById } = await ensureSeating();
  if (seats.length === 0) { alert('ما فيه أي طالب موزّع على جهاز بعد'); return; }

  const sorted = seats.slice().sort((a, b) => a.computer_number - b.computer_number);
  const pagesHtml = sorted.map(seat => {
    const info = infoById.get(seat.student_id);
    return `<div class="lab-sheet">
      <div class="lab-sheet-computer">جهاز رقم ${seat.computer_number}</div>
      <div class="lab-sheet-name">${esc(info ? info.full_name : '؟')}</div>
      <div class="lab-sheet-class">${info ? esc(classLabel(info.grade_level, info.class_section)) : ''}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>أوراق أجهزة معمل الحاسب</title>
<style>
  body { font-family: Tahoma, Arial, sans-serif; margin: 0; }
  .lab-sheet {
    height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; page-break-after: always; padding: 24px; box-sizing: border-box;
  }
  .lab-sheet-computer { font-size: 28px; color: #6B4FA0; font-weight: 700; margin-bottom: 18px; }
  .lab-sheet-name { font-size: 46px; font-weight: 800; color: #222; margin-bottom: 10px; }
  .lab-sheet-class { font-size: 20px; color: #555; }
  @media print { .lab-sheet:last-child { page-break-after: auto; } }
</style>
</head>
<body>${pagesHtml}</body>
</html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('المتصفح منع فتح نافذة الطباعة - يرجى السماح بالنوافذ المنبثقة'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
});
