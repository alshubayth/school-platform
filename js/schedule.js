import { sb, gradeLabels, backToTiles } from './core.js';

document.getElementById('back-to-tiles-11').addEventListener('click', backToTiles);

export const DAYS = [
  { key: 'sunday', label: 'الأحد' },
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
];
export const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

let scGrade = 'first_intermediate';
let scSection = null;

// مواد جدول الحصص (حسب تسمياتها بالجدول الرسمي المعتمد من المدرسة)
export const SCHEDULE_SUBJECTS = [
  'إنجليزي', 'الإسلامية', 'الاجتماعيات', 'البدنية', 'الحياتية',
  'الرياضيات', 'الفكير الناقد', 'الفنية', 'رقمية', 'علوم', 'لغتي',
];

export async function loadScheduleModule() {
  renderGradeTabs();
  await refreshSectionOptions();
}

// يستخدمها استيراد PDF لعرض بيانات مستخرجة داخل نفس شاشة التحرير المعتادة، بدون حفظها تلقائيًا
export async function previewInGrid(grade, section, map) {
  scGrade = grade;
  scSection = section;
  renderGradeTabs();

  const sectionSelect = document.getElementById('sc-section-select');
  const hasOption = Array.from(sectionSelect.options).some(o => o.value === String(section));
  if (!hasOption) {
    const opt = document.createElement('option');
    opt.value = String(section);
    opt.textContent = 'الفصل ' + section;
    sectionSelect.appendChild(opt);
  }
  sectionSelect.value = String(section);

  await renderGrid(map);
  document.getElementById('sc-grid-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderGradeTabs() {
  const wrap = document.getElementById('sc-grade-tabs');
  wrap.innerHTML = '';
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (g === scGrade ? ' active' : '');
    btn.textContent = gradeLabels[g];
    btn.addEventListener('click', () => {
      scGrade = g;
      scSection = null;
      renderGradeTabs();
      refreshSectionOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshSectionOptions() {
  const sectionSelect = document.getElementById('sc-section-select');
  sectionSelect.innerHTML = '<option value="">جارٍ التحميل...</option>';
  document.getElementById('sc-grid-container').innerHTML = '';

  const { data: studentsData } = await sb.from('students').select('class_section').eq('grade_level', scGrade);
  let sections = [...new Set((studentsData || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);

  // احتياطًا لو ما استُوردت بيانات الطلاب بعد لهذه المرحلة، نتيح فصول 1-8 يدويًا
  if (sections.length === 0) sections = [1, 2, 3, 4, 5, 6, 7, 8];

  sectionSelect.innerHTML = '<option value="">اختر الفصل</option>' +
    sections.map(n => `<option value="${n}">الفصل ${n}</option>`).join('');
  sectionSelect.onchange = () => {
    scSection = sectionSelect.value ? parseInt(sectionSelect.value) : null;
    renderGrid();
  };
  scSection = null;
}

function subjectOptionsHtml(selected) {
  let html = '<option value=""' + (!selected ? ' selected' : '') + '>-</option>';
  SCHEDULE_SUBJECTS.forEach(name => {
    html += `<option value="${name}"${name === selected ? ' selected' : ''}>${name}</option>`;
  });
  // لو المادة المحفوظة مو من القائمة المعروفة (تمت إضافتها يدويًا)، نضيفها كخيار برضو
  if (selected && !SCHEDULE_SUBJECTS.includes(selected)) {
    html += `<option value="${selected}" selected>${selected}</option>`;
  }
  return html;
}

async function renderGrid(overrideMap) {
  const container = document.getElementById('sc-grid-container');
  if (!scSection) { container.innerHTML = ''; return; }

  let map;
  if (overrideMap) {
    map = overrideMap;
  } else {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';
    const { data: existing } = await sb.from('class_schedules')
      .select('day_of_week, period_number, subject_name, teacher_name')
      .eq('grade_level', scGrade).eq('class_section', scSection);
    map = {};
    (existing || []).forEach(r => { map[r.day_of_week + '-' + r.period_number] = { subject: r.subject_name || '', teacher: r.teacher_name || '' }; });
  }

  let html = `
    <div class="form-card">
      <h4>${gradeLabels[scGrade]} - الفصل ${scSection}</h4>
      ${overrideMap ? '<p style="font-size:12.5px; color:var(--gold); font-weight:700; margin:-6px 0 12px;">⚠ معاينة من ملف مستورد — راجع كل خلية بعنايه، ثم اضغط "حفظ الجدول" لاعتمادها</p>' : ''}
      <div style="overflow-x:auto;">
        <table id="sc-table" style="width:100%; border-collapse:collapse; min-width:760px;">
          <thead>
            <tr>
              <th style="padding:8px; text-align:center; font-size:12.5px; color:var(--slate);">اليوم</th>
              ${PERIODS.map(p => `<th style="padding:8px; text-align:center; font-size:12.5px; color:var(--slate);">الحصة ${p}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${DAYS.map(d => `
              <tr>
                <td style="padding:6px; text-align:center; font-weight:700; font-size:13px;">${d.label}</td>
                ${PERIODS.map(p => {
                  const cell = map[d.key + '-' + p] || { subject: '', teacher: '' };
                  return `
                  <td style="padding:4px;">
                    <select class="sc-cell-subject" data-day="${d.key}" data-period="${p}" style="margin-bottom:4px; font-size:12.5px; padding:8px 6px;">
                      ${subjectOptionsHtml(cell.subject)}
                    </select>
                    <input class="sc-cell-teacher" data-day="${d.key}" data-period="${p}" type="text" placeholder="اسم المعلم" value="${cell.teacher.replace(/"/g, '&quot;')}" style="margin-bottom:0; font-size:11.5px; padding:7px 6px;" />
                  </td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:16px; display:flex; align-items:center; gap:12px;">
        <button class="btn-primary" id="sc-save-btn" style="width:auto; padding:11px 24px;">حفظ الجدول</button>
        <span id="sc-save-status" style="font-size:12.5px; color:var(--slate);"></span>
      </div>
    </div>`;

  container.innerHTML = html;
  document.getElementById('sc-save-btn').addEventListener('click', saveGrid);
}

async function saveGrid() {
  const statusEl = document.getElementById('sc-save-status');
  statusEl.textContent = 'جارٍ الحفظ...';
  statusEl.style.color = 'var(--slate)';

  const subjectSelects = Array.from(document.querySelectorAll('.sc-cell-subject'));
  const rowsToUpsert = [];
  const keysToDelete = [];

  subjectSelects.forEach(sel => {
    const day = sel.dataset.day;
    const period = parseInt(sel.dataset.period);
    const subject = sel.value.trim();
    const teacherInput = document.querySelector(`.sc-cell-teacher[data-day="${day}"][data-period="${period}"]`);
    const teacher = teacherInput ? teacherInput.value.trim() : '';
    if (subject) {
      rowsToUpsert.push({
        grade_level: scGrade, class_section: scSection,
        day_of_week: day, period_number: period,
        subject_name: subject, teacher_name: teacher || null, updated_at: new Date().toISOString(),
      });
    } else {
      keysToDelete.push({ day, period });
    }
  });

  if (rowsToUpsert.length > 0) {
    const { error } = await sb.from('class_schedules').upsert(rowsToUpsert, { onConflict: 'grade_level,class_section,day_of_week,period_number' });
    if (error) { statusEl.textContent = 'تعذر الحفظ: ' + error.message; statusEl.style.color = 'var(--danger)'; return; }
  }

  // حذف الخلايا اللي رجعت فاضية (لو كانت محفوظة سابقًا)
  for (const k of keysToDelete) {
    await sb.from('class_schedules').delete()
      .eq('grade_level', scGrade).eq('class_section', scSection)
      .eq('day_of_week', k.day).eq('period_number', k.period);
  }

  statusEl.textContent = 'تم الحفظ بنجاح ✓';
  statusEl.style.color = 'var(--meadow)';
}
