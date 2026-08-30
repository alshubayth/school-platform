import { sb, currentUserId, gradeLabels, backToTiles } from './core.js';

document.getElementById('back-to-tiles-12').addEventListener('click', backToTiles);

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

const TYPE_LABELS = { note: 'ملاحظة', participation: 'مشاركة', exam: 'اختبار', deduction: 'خصم' };
const TYPE_BADGE = { note: 'badge-gray', participation: 'badge-meadow', exam: 'badge-gold', deduction: 'badge-danger' };

let sfGrade = 'first_intermediate';
let sfSection = null;
let sfDate = todayIso();
let studentsCache = [];

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

export async function loadStudentFollowupsModule() {
  renderGradeTabs();
  document.getElementById('sf-date').value = sfDate;
  await refreshSectionOptions();
}

document.getElementById('sf-date').addEventListener('change', (e) => {
  sfDate = e.target.value || todayIso();
});

function renderGradeTabs() {
  const wrap = document.getElementById('sf-grade-tabs');
  wrap.innerHTML = '';
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (g === sfGrade ? ' active' : '');
    btn.textContent = gradeLabels[g];
    btn.addEventListener('click', () => {
      sfGrade = g;
      sfSection = null;
      renderGradeTabs();
      refreshSectionOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshSectionOptions() {
  const sectionSelect = document.getElementById('sf-section-select');
  sectionSelect.innerHTML = '<option value="">جارٍ التحميل...</option>';
  document.getElementById('sf-students-list').innerHTML = '';

  const { data } = await sb.from('students').select('class_section').eq('grade_level', sfGrade);
  const sections = [...new Set((data || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);

  if (sections.length === 0) {
    sectionSelect.innerHTML = '<option value="">ما فيه طلاب مسجلين لهذه المرحلة بعد</option>';
    return;
  }
  sectionSelect.innerHTML = '<option value="">اختر الفصل</option>' +
    sections.map(n => `<option value="${n}">الفصل ${n}</option>`).join('');
  sectionSelect.onchange = () => {
    sfSection = sectionSelect.value ? parseInt(sectionSelect.value) : null;
    renderStudentsList();
  };
}

async function renderStudentsList() {
  const container = document.getElementById('sf-students-list');
  if (!sfSection) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  const { data } = await sb.from('students').select('id, full_name, national_id')
    .eq('grade_level', sfGrade).eq('class_section', sfSection).order('full_name');
  studentsCache = data || [];

  if (studentsCache.length === 0) {
    container.innerHTML = '<div class="placeholder"><p>ما فيه طلاب مسجلين بهذا الفصل</p></div>';
    return;
  }

  container.innerHTML = '';
  studentsCache.forEach(st => container.appendChild(buildStudentRow(st)));
}

function buildStudentRow(student) {
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.marginBottom = '10px';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;';
  head.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <div class="avatar-circle" style="width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex-shrink:0; background:var(--meadow-light); color:var(--meadow);">${(student.full_name || '؟').trim().charAt(0)}</div>
      <span style="font-weight:700; font-size:14px;">${student.full_name}</span>
    </div>
    <span class="text-action-btn sf-toggle-log" style="width:auto; background:transparent; color:var(--teal); font-size:12.5px; cursor:pointer;">عرض السجل</span>`;
  card.appendChild(head);

  const entryRow = document.createElement('div');
  entryRow.style.cssText = 'display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:8px; align-items:end;';
  entryRow.innerHTML = `
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">ملاحظة</label>
      <div style="display:flex; gap:6px;">
        <input type="text" class="sf-note-input" placeholder="اكتب ملاحظة..." style="margin:0;" />
        <button class="sf-add-btn" data-type="note" style="width:auto; padding:9px 12px; background:var(--sand); color:var(--ink);">+</button>
      </div>
    </div>
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">مشاركة</label>
      <div style="display:flex; gap:6px;">
        <input type="number" class="sf-score-input" data-type="participation" placeholder="0" style="margin:0;" />
        <button class="sf-add-btn" data-type="participation" style="width:auto; padding:9px 12px; background:var(--meadow-light); color:var(--meadow);">+</button>
      </div>
    </div>
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">اختبار</label>
      <div style="display:flex; gap:6px;">
        <input type="number" class="sf-score-input" data-type="exam" placeholder="0" style="margin:0;" />
        <button class="sf-add-btn" data-type="exam" style="width:auto; padding:9px 12px; background:var(--gold-light); color:var(--gold);">+</button>
      </div>
    </div>
    <div>
      <label style="font-size:11px; color:var(--slate); display:block; margin-bottom:4px;">خصم</label>
      <div style="display:flex; gap:6px;">
        <input type="number" class="sf-score-input" data-type="deduction" placeholder="0" style="margin:0;" />
        <button class="sf-add-btn" data-type="deduction" style="width:auto; padding:9px 12px; background:var(--danger-light); color:var(--danger);">+</button>
      </div>
    </div>`;
  card.appendChild(entryRow);

  const errEl = document.createElement('div');
  errEl.className = 'error-msg';
  errEl.style.marginTop = '10px';
  card.appendChild(errEl);

  const logWrap = document.createElement('div');
  logWrap.className = 'sf-log-wrap hidden';
  logWrap.style.cssText = 'border-top:1px solid #ECEAE1; margin-top:12px; padding-top:12px;';
  card.appendChild(logWrap);

  card.querySelectorAll('.sf-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      const type = btn.dataset.type;
      let noteText = null, score = null;
      if (type === 'note') {
        const input = card.querySelector('.sf-note-input');
        noteText = input.value.trim();
        if (!noteText) { errEl.textContent = 'اكتب نص الملاحظة أولًا'; errEl.style.display = 'block'; return; }
      } else {
        const input = card.querySelector(`.sf-score-input[data-type="${type}"]`);
        if (input.value === '') { errEl.textContent = 'أدخل قيمة أولًا'; errEl.style.display = 'block'; return; }
        score = parseFloat(input.value);
      }

      const { error } = await sb.from('student_followups').insert({
        student_id: student.id, grade_level: sfGrade, class_section: sfSection,
        record_date: sfDate, type, note_text: noteText, score,
        created_by: currentUserId,
      });
      if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

      if (type === 'note') { card.querySelector('.sf-note-input').value = ''; }
      else { card.querySelector(`.sf-score-input[data-type="${type}"]`).value = ''; }

      if (!logWrap.classList.contains('hidden')) await renderLog(logWrap, student.id);
    });
  });

  const toggleBtn = head.querySelector('.sf-toggle-log');
  toggleBtn.addEventListener('click', async () => {
    const isHidden = logWrap.classList.contains('hidden');
    if (isHidden) {
      logWrap.classList.remove('hidden');
      toggleBtn.textContent = 'إخفاء السجل';
      await renderLog(logWrap, student.id);
    } else {
      logWrap.classList.add('hidden');
      toggleBtn.textContent = 'عرض السجل';
    }
  });

  return card;
}

async function renderLog(logWrap, studentId) {
  logWrap.innerHTML = '<p style="font-size:12.5px; color:var(--slate);">جارٍ التحميل...</p>';
  const { data } = await sb.from('student_followups')
    .select('id, record_date, type, note_text, score')
    .eq('student_id', studentId).order('record_date', { ascending: false }).order('created_at', { ascending: false });

  const rows = data || [];
  if (rows.length === 0) {
    logWrap.innerHTML = '<p style="font-size:12.5px; color:var(--slate); margin:0;">ما فيه سجلات لهذا الطالب بعد</p>';
    return;
  }

  logWrap.innerHTML = '';
  rows.forEach(r => {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #F3F1E9; font-size:12.5px;';
    const valueText = r.type === 'note' ? (r.note_text || '') : String(r.score ?? '');
    line.innerHTML = `
      <span style="display:flex; align-items:center; gap:8px; min-width:0;">
        <span class="badge ${TYPE_BADGE[r.type] || 'badge-gray'}">${TYPE_LABELS[r.type] || r.type}</span>
        <span style="color:var(--slate); flex-shrink:0;">${formatDate(r.record_date)}</span>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${valueText}</span>
      </span>
      <button class="sf-delete-btn" data-id="${r.id}" style="width:auto; background:transparent; color:var(--danger); padding:2px 6px; font-size:14px; flex-shrink:0;">×</button>`;
    logWrap.appendChild(line);
  });

  logWrap.querySelectorAll('.sf-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('حذف هذا السجل؟')) return;
      await sb.from('student_followups').delete().eq('id', btn.dataset.id);
      await renderLog(logWrap, studentId);
    });
  });
}
