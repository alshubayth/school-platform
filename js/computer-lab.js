/*
 * معمل الحاسب الآلي: معمل واحد بالمدرسة بعدد أجهزة ثابت. المهم: فصولك المختلفة ما تكون
 * بالمعمل بنفس الوقت (كل فصل حصته وحده)، فرقم الجهاز نفسه يُعاد استخدامه بين الفصول - كل
 * فصل له ترقيمه الخاص من 1 إلى عدد الأجهزة (ثابت، يُحفظ ولا يتغيّر عشوائيًا). يعني جهاز رقم 1
 * يجلس عليه طالب رقم 1 من ثالث1 وطالب رقم 1 من ثالث2 وطالب رقم 1 من ثالث3... كل وحد بحصته.
 * الورقة اللي تُلصق على كل جهاز تجمع كل هالأسماء مع بعض (سطر لكل فصل) عشان تصلح لكل الحصص.
 * لو فصل معيّن عدد طلابه أكثر من عدد الأجهزة، الزيادة (لهذا الفصل بالذات) تظهر كتنبيه بدون
 * جهاز، بدون ما يأثر على باقي الفصول.
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

/* ---------- توزيع طلاب فصل واحد على أرقام الأجهزة (ترقيم خاص بكل فصل لحاله) ---------- */
// كل فصل له ترقيمه المستقل من 1 إلى عدد الأجهزة (نفس الأرقام تتكرر بين الفصول لأنها ما
// تتزامن أبدًا بنفس الوقت بالمعمل). يضمن كل طالب جديد ياخذ أول رقم فاضي *داخل فصله* فقط،
// بدون ما يغيّر توزيع أي طالب موزّع مسبقًا (لا بفصله ولا بأي فصل ثاني).
async function ensureSeatingForClass(lc) {
  const { data: rosterData } = await sb.from('students').select('id, full_name')
    .eq('grade_level', lc.grade_level).eq('class_section', lc.class_section).order('full_name');
  const roster = rosterData || [];
  const rosterIds = new Set(roster.map(s => s.id));

  const { data: rawSeats } = await sb.from('lab_seat_assignments').select('*').eq('lab_class_id', lc.id);
  // تنظيف أي مقعد لطالب لم يعد موجودًا بروستر الفصل (مثلاً نُقل لفصل ثاني)
  const orphaned = (rawSeats || []).filter(s => !rosterIds.has(s.student_id));
  for (const seat of orphaned) await sb.from('lab_seat_assignments').delete().eq('id', seat.id);
  const seats = (rawSeats || []).filter(s => rosterIds.has(s.student_id));

  const assignedIds = new Set(seats.map(s => s.student_id));
  const usedNumbers = new Set(seats.map(s => s.computer_number));
  const unassigned = roster.filter(s => !assignedIds.has(s.id));

  const freeNumbers = [];
  if (computerCount) {
    for (let n = 1; n <= computerCount && freeNumbers.length < unassigned.length; n++) {
      if (!usedNumbers.has(n)) freeNumbers.push(n);
    }
  }
  const newRows = unassigned.slice(0, freeNumbers.length).map((s, i) => ({
    teacher_id: currentUserId, lab_class_id: lc.id, student_id: s.id, computer_number: freeNumbers[i],
  }));
  if (newRows.length) await sb.from('lab_seat_assignments').insert(newRows);

  const { data: finalSeats } = await sb.from('lab_seat_assignments').select('*').eq('lab_class_id', lc.id).order('computer_number');
  const infoById = new Map(roster.map(s => [s.id, s]));
  const seatedIds = new Set((finalSeats || []).map(s => s.student_id));
  const overflow = roster.filter(s => !seatedIds.has(s.id));
  return { seats: finalSeats || [], infoById, overflow };
}

async function ensureSeatingAllClasses() {
  const result = [];
  for (const lc of classesCache) {
    const data = await ensureSeatingForClass(lc);
    result.push({ lc, ...data });
  }
  return result;
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
  const perClass = await ensureSeatingAllClasses();

  container.innerHTML = perClass.map(({ lc, seats, infoById, overflow }) => {
    const rowsHtml = seats.map(seat => {
      const info = infoById.get(seat.student_id);
      return `<tr data-seat-id="${seat.id}" data-computer="${seat.computer_number}" data-lab-class="${lc.id}">
        <td style="padding:6px 8px; text-align:center; font-weight:700;">${seat.computer_number}</td>
        <td style="padding:6px 8px;">${esc(info ? info.full_name : '؟')}</td>
        <td style="padding:6px 8px; text-align:center;">
          <input type="number" class="lab-move-input" min="1" max="${computerCount}" placeholder="بدّل مع جهاز رقم..." style="width:120px; margin:0; padding:5px 8px; font-size:12.5px;">
          <button type="button" class="lab-move-btn" style="border:1px solid var(--slate); background:none; color:var(--slate); border-radius:6px; padding:5px 10px; font-size:12px; cursor:pointer;">نقل/تبديل</button>
        </td>
      </tr>`;
    }).join('');

    const overflowHtml = overflow.length === 0 ? '' : `
      <div style="background:#FDEDEC; border-radius:8px; padding:10px 12px; margin-top:10px;">
        <p style="margin:0 0 4px; font-size:12.5px; color:var(--danger); font-weight:700;">⚠ عدد طلاب هذا الفصل (${seats.length + overflow.length}) أكثر من عدد أجهزة المعمل (${computerCount}) - الطلاب التاليين بدون جهاز:</p>
        <p style="margin:0; font-size:12.5px; color:var(--danger);">${overflow.map(s => esc(s.full_name)).join('، ')}</p>
      </div>`;

    return `
      <div class="form-card" style="margin-top:14px;">
        <h4 style="margin:0 0 10px;">${esc(classLabel(lc.grade_level, lc.class_section))}</h4>
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
      </div>`;
  }).join('');

  container.querySelectorAll('tr[data-seat-id]').forEach(row => {
    row.querySelector('.lab-move-btn').addEventListener('click', async () => {
      const labClassId = row.dataset.labClass;
      const fromComputer = Number(row.dataset.computer);
      const toComputer = Number(row.querySelector('.lab-move-input').value);
      if (!toComputer || toComputer === fromComputer) return;
      await moveOrSwapSeat(labClassId, fromComputer, toComputer);
      await renderSeatingSection();
    });
  });
}

// ينقل طالب الجهاز A لجهاز B الفاضي، أو يبدّل طالبي الجهازين لو B مشغول أصلاً - دايمًا داخل
// نفس الفصل (الفصول ما تتزامن بنفس الوقت أصلًا، فالتبديل بين فصلين ما له معنى)
async function moveOrSwapSeat(labClassId, fromComputer, toComputer) {
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

/* ---------- طباعة أوراق اللصق (ورقة واحدة لكل جهاز، تجمع كل الفصول اللي تستخدم نفس الرقم) ---------- */
document.getElementById('lab-print-btn').addEventListener('click', async () => {
  if (!computerCount || classesCache.length === 0) { alert('حدّد عدد الأجهزة وأضف فصل واحد على الأقل أولاً'); return; }
  const perClass = await ensureSeatingAllClasses();

  const byNumber = new Map();
  for (let n = 1; n <= computerCount; n++) byNumber.set(n, []);
  perClass.forEach(({ lc, seats, infoById }) => {
    seats.forEach(seat => {
      const info = infoById.get(seat.student_id);
      byNumber.get(seat.computer_number).push({
        name: info ? info.full_name : '؟',
        cls: classLabel(lc.grade_level, lc.class_section),
      });
    });
  });
  const usedNumbers = [...byNumber.keys()].filter(n => byNumber.get(n).length > 0).sort((a, b) => a - b);
  if (usedNumbers.length === 0) { alert('ما فيه أي طالب موزّع على جهاز بعد'); return; }

  const pagesHtml = usedNumbers.map(n => {
    const entriesHtml = byNumber.get(n).map(e => `
      <div class="lab-sheet-entry">
        <div class="lab-sheet-name">${esc(e.name)}</div>
        <div class="lab-sheet-class">${esc(e.cls)}</div>
      </div>`).join('');
    return `<div class="lab-sheet">
      <div class="lab-sheet-computer">جهاز رقم ${n}</div>
      <div class="lab-sheet-entries">${entriesHtml}</div>
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
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; page-break-after: always; padding: 24px; box-sizing: border-box;
  }
  .lab-sheet-computer { font-size: 30px; color: #6B4FA0; font-weight: 800; margin-bottom: 22px; }
  .lab-sheet-entries { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 520px; }
  .lab-sheet-entry { border: 1px solid #ddd; border-radius: 10px; padding: 12px 16px; }
  .lab-sheet-name { font-size: 30px; font-weight: 800; color: #222; margin-bottom: 4px; }
  .lab-sheet-class { font-size: 16px; color: #666; }
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
