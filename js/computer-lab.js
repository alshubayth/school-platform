/*
 * معمل الحاسب الآلي: توزيع طلاب كل فصل يدرّسه المعلم بالمعمل على أرقام الأجهزة.
 * التوزيع يُنشأ أول مرة تلقائيًا (بترتيب الأسماء) ويبقى ثابتًا بعدها بجدول lab_seat_assignments -
 * ما يتغيّر عشوائيًا كل مرة، ويقبل تعديل يدوي (تبديل جهازين). لو طلاب الفصل أكثر من عدد الأجهزة
 * المتاحة، الزيادة تظهر كتنبيه بدون جهاز بدل ما توزّع أكثر من طالب على نفس الجهاز.
 */
import { sb, currentUserId, gradeLabels, backToTiles } from './core.js';

document.getElementById('back-to-tiles-16').addEventListener('click', backToTiles);

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function classLabel(grade, section) { return `${gradeLabels[grade] || grade} - الفصل ${section}`; }

let labGrade = 'first_intermediate';
let classesCache = [];      // كل فصول المعمل المضافة (لهذا المعلم أو كلها لو مدير/وكيل)
let openClassId = null;     // الفصل المفتوح توزيعه حاليًا (لعرض واحد بالمرة)

export async function loadComputerLabModule() {
  renderGradeTabs();
  await refreshSectionOptions();
  await refreshClassesList();
}

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
  const computerCount = Number(document.getElementById('lab-computer-count').value);
  if (!section) { errEl.textContent = 'اختر الفصل أولاً'; errEl.style.display = 'block'; return; }
  if (!computerCount || computerCount < 1) { errEl.textContent = 'أدخل عدد أجهزة صحيح'; errEl.style.display = 'block'; return; }

  const { error } = await sb.from('lab_classes').upsert({
    teacher_id: currentUserId, grade_level: labGrade, class_section: section, computer_count: computerCount,
  }, { onConflict: 'teacher_id,grade_level,class_section' });
  if (error) { errEl.textContent = 'تعذّرت الإضافة: ' + error.message; errEl.style.display = 'block'; return; }
  await refreshClassesList();
});

async function refreshClassesList() {
  const { data } = await sb.from('lab_classes').select('*').eq('teacher_id', currentUserId).order('grade_level').order('class_section');
  classesCache = data || [];
  await renderClassesList();
}

async function renderClassesList() {
  const wrap = document.getElementById('lab-classes-list');
  if (classesCache.length === 0) {
    wrap.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما أضفت أي فصل بالمعمل بعد</p></div>';
    return;
  }
  wrap.innerHTML = '';
  for (const lc of classesCache) {
    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '12px';
    card.dataset.id = lc.id;

    const { count: studentCount } = await sb.from('students').select('id', { count: 'exact', head: true })
      .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section);

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div>
          <h4 style="margin:0 0 4px;">${esc(classLabel(lc.grade_level, lc.class_section))}</h4>
          <p style="margin:0; font-size:12.5px; color:var(--slate);">عدد الأجهزة: ${lc.computer_count} — عدد الطلاب: ${studentCount ?? '؟'}</p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn-primary lab-toggle-btn" style="width:auto; padding:7px 14px;">${openClassId === lc.id ? 'إخفاء التوزيع' : 'عرض التوزيع'}</button>
          <button type="button" class="lab-print-btn" style="border:1px solid var(--slate); background:none; color:var(--slate); border-radius:8px; padding:6px 14px; font-size:12.5px; cursor:pointer;">🖨 طباعة أوراق اللصق</button>
          <button type="button" class="lab-delete-btn" style="border:1px solid var(--danger); background:none; color:var(--danger); border-radius:8px; padding:6px 14px; font-size:12.5px; cursor:pointer;">حذف الفصل</button>
        </div>
      </div>
      <div class="lab-seating-area" style="margin-top:12px;"></div>
    `;
    wrap.appendChild(card);

    card.querySelector('.lab-toggle-btn').addEventListener('click', async () => {
      openClassId = openClassId === lc.id ? null : lc.id;
      await renderClassesList();
    });
    card.querySelector('.lab-print-btn').addEventListener('click', () => printLabSheets(lc));
    card.querySelector('.lab-delete-btn').addEventListener('click', async () => {
      await sb.from('lab_classes').delete().eq('id', lc.id);
      if (openClassId === lc.id) openClassId = null;
      await refreshClassesList();
    });

    if (openClassId === lc.id) {
      await renderSeatingArea(card.querySelector('.lab-seating-area'), lc);
    }
  }
}

// يتأكد إن كل طلاب الفصل الجدد (اللي ما لهم جهاز بعد) ياخذون أول جهاز فاضي - بدون ما يغيّر توزيع أحد موجود
async function ensureSeating(lc) {
  const { data: students } = await sb.from('students').select('id, full_name')
    .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section).order('full_name');
  const { data: seats } = await sb.from('lab_seat_assignments').select('*').eq('lab_class_id', lc.id);

  const assignedStudentIds = new Set((seats || []).map(s => s.student_id));
  const usedComputerNumbers = new Set((seats || []).map(s => s.computer_number));
  const unassigned = (students || []).filter(s => !assignedStudentIds.has(s.id));

  const freeNumbers = [];
  for (let n = 1; n <= lc.computer_count && freeNumbers.length < unassigned.length; n++) {
    if (!usedComputerNumbers.has(n)) freeNumbers.push(n);
  }
  const newRows = unassigned.slice(0, freeNumbers.length).map((s, i) => ({
    lab_class_id: lc.id, student_id: s.id, computer_number: freeNumbers[i],
  }));
  if (newRows.length) await sb.from('lab_seat_assignments').insert(newRows);

  const { data: finalSeats } = await sb.from('lab_seat_assignments').select('*').eq('lab_class_id', lc.id).order('computer_number');
  const seatedIds = new Set((finalSeats || []).map(s => s.student_id));
  const overflow = (students || []).filter(s => !seatedIds.has(s.id));
  return { students: students || [], seats: finalSeats || [], overflow };
}

async function renderSeatingArea(container, lc) {
  container.innerHTML = '<p style="font-size:12.5px; color:var(--slate);">جارٍ تحميل التوزيع...</p>';
  const { seats, overflow } = await ensureSeating(lc);
  const nameById = new Map();
  const { data: students } = await sb.from('students').select('id, full_name')
    .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section);
  (students || []).forEach(s => nameById.set(s.id, s.full_name));

  const rowsHtml = seats.map(seat => `
    <tr data-seat-id="${seat.id}" data-computer="${seat.computer_number}">
      <td style="padding:6px 8px; text-align:center; font-weight:700;">${seat.computer_number}</td>
      <td style="padding:6px 8px;">${esc(nameById.get(seat.student_id) || '؟')}</td>
      <td style="padding:6px 8px; text-align:center;">
        <input type="number" class="lab-move-input" min="1" max="${lc.computer_count}" placeholder="بدّل مع جهاز رقم..." style="width:120px; margin:0; padding:5px 8px; font-size:12.5px;">
        <button type="button" class="lab-move-btn" style="border:1px solid var(--slate); background:none; color:var(--slate); border-radius:6px; padding:5px 10px; font-size:12px; cursor:pointer;">نقل/تبديل</button>
      </td>
    </tr>`).join('');

  const overflowHtml = overflow.length === 0 ? '' : `
    <div style="background:#FDEDEC; border-radius:8px; padding:10px 12px; margin-top:10px;">
      <p style="margin:0 0 4px; font-size:12.5px; color:var(--danger); font-weight:700;">⚠ عدد الطلاب أكثر من عدد الأجهزة المتاحة (${lc.computer_count}) - الطلاب التاليين بدون جهاز:</p>
      <p style="margin:0; font-size:12.5px; color:var(--danger);">${overflow.map(s => esc(s.full_name)).join('، ')}</p>
    </div>`;

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="background:var(--sand);">
          <th style="padding:6px 8px; text-align:center;">رقم الجهاز</th>
          <th style="padding:6px 8px; text-align:right;">الطالب</th>
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
      await moveOrSwapSeat(lc.id, fromComputer, toComputer, lc.computer_count);
      await renderSeatingArea(container, lc);
    });
  });
}

// ينقل طالب الجهاز A لجهاز B الفاضي، أو يبدّل طالبي الجهازين لو B مشغول أصلاً
async function moveOrSwapSeat(labClassId, fromComputer, toComputer, computerCount) {
  if (toComputer < 1 || toComputer > computerCount) return;
  const { data: seats } = await sb.from('lab_seat_assignments').select('*').eq('lab_class_id', labClassId);
  const fromSeat = (seats || []).find(s => s.computer_number === fromComputer);
  const toSeat = (seats || []).find(s => s.computer_number === toComputer);
  if (!fromSeat) return;
  if (toSeat) {
    const fromStudent = fromSeat.student_id;
    await sb.from('lab_seat_assignments').update({ student_id: toSeat.student_id }).eq('id', fromSeat.id);
    await sb.from('lab_seat_assignments').update({ student_id: fromStudent }).eq('id', toSeat.id);
  } else {
    await sb.from('lab_seat_assignments').update({ computer_number: toComputer }).eq('id', fromSeat.id);
  }
}

/* ---------- طباعة أوراق اللصق (ورقة منفصلة لكل جهاز) ---------- */
async function printLabSheets(lc) {
  const { seats } = await ensureSeating(lc);
  if (seats.length === 0) { alert('ما فيه أي طالب موزّع على جهاز بهذا الفصل بعد'); return; }
  const { data: students } = await sb.from('students').select('id, full_name')
    .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section);
  const nameById = new Map((students || []).map(s => [s.id, s.full_name]));

  const sorted = seats.slice().sort((a, b) => a.computer_number - b.computer_number);
  const pagesHtml = sorted.map(seat => `
    <div class="lab-sheet">
      <div class="lab-sheet-computer">جهاز رقم ${seat.computer_number}</div>
      <div class="lab-sheet-name">${esc(nameById.get(seat.student_id) || '؟')}</div>
      <div class="lab-sheet-class">${esc(classLabel(lc.grade_level, lc.class_section))}</div>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>أوراق أجهزة المعمل - ${esc(classLabel(lc.grade_level, lc.class_section))}</title>
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
}
