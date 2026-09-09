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

/* ---------- طباعة أوراق اللصق (ملصق واحد لكل جهاز، يجمع كل الفصول اللي تستخدم نفس الرقم؛
   ثمان ملصقات بكل ورقة A4 - عمودين × 4 صفوف) ---------- */
const GRADE_DOT_CLASS = { first_intermediate: 'first', second_intermediate: 'second', third_intermediate: 'third' };

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
        dot: GRADE_DOT_CLASS[lc.grade_level] || 'first',
      });
    });
  });
  const usedNumbers = [...byNumber.keys()].filter(n => byNumber.get(n).length > 0).sort((a, b) => a - b);
  if (usedNumbers.length === 0) { alert('ما فيه أي طالب موزّع على جهاز بعد'); return; }

  // كثافة الملصق تتحدد حسب أكبر عدد أسطر بجهاز واحد (لو فصولك كثيرة ممكن يوصل الجهاز الواحد
  // لـ10-15 طالب لأنه يُستخدم بحصص مختلفة) - كل ما زاد العدد صغّرنا الخط والمسافات وقسّمنا
  // الأسماء لعمودين داخل الملصق نفسه عشان تنعرض منظمة وما تطلع برا حدود الملصق
  const maxEntries = Math.max(...usedNumbers.map(n => byNumber.get(n).length));
  const density = maxEntries <= 3 ? 1 : maxEntries <= 6 ? 2 : maxEntries <= 10 ? 3 : maxEntries <= 16 ? 4 : 5;

  const LABELS_PER_PAGE = 8;
  const labelHtml = n => {
    const entriesHtml = byNumber.get(n).map(e => `
      <div class="entry">
        <span class="dot ${e.dot}"></span>
        <div><div class="name">${esc(e.name)}</div><div class="cls">${esc(e.cls)}</div></div>
      </div>`).join('');
    return `<div class="label">
      <div class="label-head"><div class="num"><small>جهاز رقم</small>${n}</div><div class="icon">🖥️</div></div>
      <div class="label-body">${entriesHtml}</div>
      <div class="label-foot">معمل الحاسب الآلي</div>
    </div>`;
  };

  let pagesHtml = '';
  for (let i = 0; i < usedNumbers.length; i += LABELS_PER_PAGE) {
    const chunk = usedNumbers.slice(i, i + LABELS_PER_PAGE);
    const cells = chunk.map(labelHtml).join('') + '<div class="label empty"></div>'.repeat(LABELS_PER_PAGE - chunk.length);
    pagesHtml += `<div class="page">${cells}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>أوراق أجهزة معمل الحاسب</title>
<style>
  :root {
    --purple: #6B4FA0; --purple-light: #8A6FC4;
    --first: #1F9D8F; --second: #C9962B; --third: #2C3E70;
    --ink: #24262b; --muted: #7a7f8a;
  }
  * { box-sizing: border-box; }
  body { font-family: Tahoma, Arial, sans-serif; margin: 0; color: var(--ink); }
  .page {
    width: 210mm; height: 297mm; page-break-after: always;
    display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(4, 1fr);
    gap: 4mm; padding: 10mm 8mm;
  }
  @media print { .page:last-child { page-break-after: auto; } }
  .label { border: 1.5px dashed #cfd2da; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .label.empty { border-style: dashed; border-color: #eee; }
  .label-head {
    background: linear-gradient(135deg, var(--purple), var(--purple-light)); color: #fff;
    display: flex; align-items: center; justify-content: space-between;
  }
  .label-head .num { font-weight: 800; line-height: 1; }
  .label-head .num small { font-weight: 600; display: block; opacity: .85; }
  .label-head .icon { opacity: .9; }
  .label-body { flex: 1; overflow: hidden; }
  .entry { display: flex; align-items: center; background: #f7f6fb; border-radius: 6px; overflow: hidden; }
  .entry .name { font-weight: 700; color: var(--ink); overflow-wrap: break-word; }
  .entry .cls { color: var(--muted); }
  .dot { border-radius: 50%; flex: none; }
  .dot.first { background: var(--first); }
  .dot.second { background: var(--second); }
  .dot.third { background: var(--third); }
  .label-foot { text-align: center; color: #b6b9c2; letter-spacing: .3px; }

  /* كثافة 1: 1-3 أسماء بالجهاز - تصميم فسيح بخط كبير */
  body[data-density="1"] .label-head { padding: 7mm 6mm 5mm; }
  body[data-density="1"] .label-head .num { font-size: 15mm; }
  body[data-density="1"] .label-head .num small { font-size: 4mm; margin-bottom: 1mm; }
  body[data-density="1"] .label-head .icon { font-size: 9mm; }
  body[data-density="1"] .label-body { padding: 4mm 5mm; display: flex; flex-direction: column; gap: 2.5mm; justify-content: center; }
  body[data-density="1"] .entry { gap: 2.5mm; padding: 2.2mm 3mm; }
  body[data-density="1"] .dot { width: 3mm; height: 3mm; }
  body[data-density="1"] .entry .name { font-size: 4.6mm; }
  body[data-density="1"] .entry .cls { font-size: 3.1mm; }
  body[data-density="1"] .label-foot { font-size: 2.8mm; padding: 1.5mm 0 2.5mm; }

  /* كثافة 2: 4-6 أسماء */
  body[data-density="2"] .label-head { padding: 5mm 5mm 3.5mm; }
  body[data-density="2"] .label-head .num { font-size: 11mm; }
  body[data-density="2"] .label-head .num small { font-size: 3.3mm; margin-bottom: .8mm; }
  body[data-density="2"] .label-head .icon { font-size: 7mm; }
  body[data-density="2"] .label-body { padding: 2.5mm 3.5mm; display: flex; flex-direction: column; gap: 1.4mm; justify-content: center; }
  body[data-density="2"] .entry { gap: 1.8mm; padding: 1.3mm 2mm; }
  body[data-density="2"] .dot { width: 2.4mm; height: 2.4mm; }
  body[data-density="2"] .entry .name { font-size: 3.5mm; }
  body[data-density="2"] .entry .cls { font-size: 2.5mm; }
  body[data-density="2"] .label-foot { font-size: 2.3mm; padding: 1mm 0 1.8mm; }

  /* كثافة 3: 7-10 أسماء - عمودين داخل الملصق */
  body[data-density="3"] .label-head { padding: 3.5mm 4mm 2.5mm; }
  body[data-density="3"] .label-head .num { font-size: 8mm; }
  body[data-density="3"] .label-head .num small { font-size: 2.7mm; margin-bottom: .6mm; }
  body[data-density="3"] .label-head .icon { font-size: 5.5mm; }
  body[data-density="3"] .label-body { padding: 1.8mm 2.5mm; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: min-content; align-content: center; gap: .9mm; }
  body[data-density="3"] .entry { gap: 1.1mm; padding: .8mm 1.2mm; }
  body[data-density="3"] .dot { width: 1.8mm; height: 1.8mm; }
  body[data-density="3"] .entry .name { font-size: 2.7mm; line-height: 1.15; }
  body[data-density="3"] .entry .cls { font-size: 1.9mm; }
  body[data-density="3"] .label-foot { font-size: 1.9mm; padding: .8mm 0 1.3mm; }

  /* كثافة 4: 11-16 اسم - عمودين، ضغط أكثر */
  body[data-density="4"] .label-head { padding: 2.5mm 3mm 2mm; }
  body[data-density="4"] .label-head .num { font-size: 6mm; }
  body[data-density="4"] .label-head .num small { font-size: 2.2mm; margin-bottom: .4mm; }
  body[data-density="4"] .label-head .icon { font-size: 4.5mm; }
  body[data-density="4"] .label-body { padding: 1mm 1.6mm; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: min-content; align-content: center; gap: .5mm; }
  body[data-density="4"] .entry { gap: .8mm; padding: .5mm .8mm; }
  body[data-density="4"] .dot { width: 1.4mm; height: 1.4mm; }
  body[data-density="4"] .entry .name { font-size: 2.2mm; line-height: 1.1; }
  body[data-density="4"] .entry .cls { font-size: 1.6mm; }
  body[data-density="4"] .label-foot { display: none; }

  /* كثافة 5: أكثر من 16 اسم - ثلاث أعمدة، أصغر ما يمكن مع بقاء القراءة ممكنة */
  body[data-density="5"] .label-head { padding: 2mm 2.5mm 1.5mm; }
  body[data-density="5"] .label-head .num { font-size: 5mm; }
  body[data-density="5"] .label-head .num small { font-size: 1.9mm; margin-bottom: .3mm; }
  body[data-density="5"] .label-head .icon { font-size: 4mm; }
  body[data-density="5"] .label-body { padding: .8mm 1.2mm; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-auto-rows: min-content; align-content: center; gap: .35mm; }
  body[data-density="5"] .entry { gap: .5mm; padding: .35mm .6mm; }
  body[data-density="5"] .dot { width: 1.1mm; height: 1.1mm; }
  body[data-density="5"] .entry .name { font-size: 1.8mm; line-height: 1.05; }
  body[data-density="5"] .entry .cls { font-size: 1.3mm; }
  body[data-density="5"] .label-foot { display: none; }
</style>
</head>
<body data-density="${density}">${pagesHtml}</body>
</html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('المتصفح منع فتح نافذة الطباعة - يرجى السماح بالنوافذ المنبثقة'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
});
