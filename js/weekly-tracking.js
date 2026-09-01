import { sb, gradeLabels } from './core.js';

let wtWeek = 1;

export async function loadWeeklyTrackingModule() {
  document.getElementById('wt-week-label').textContent = 'الأسبوع ' + wtWeek;
  await refreshWeeklyTracking();
}

document.getElementById('wt-week-prev').addEventListener('click', () => { if (wtWeek > 1) { wtWeek--; loadWeeklyTrackingModule(); } });
document.getElementById('wt-week-next').addEventListener('click', () => { if (wtWeek < 40) { wtWeek++; loadWeeklyTrackingModule(); } });

async function refreshWeeklyTracking() {
  const container = document.getElementById('wt-grades-container');
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  // نجيب المواد المسندة فعليًا لكل مرحلة (عن طريق تخصيص المعلمين) بدل كل مواد المدرسة،
  // عشان مادة مسندة لمرحلة وحدة بس (مثل التفكير الناقد لثالث متوسط) ما تظهر "ناقصة" بمرحلة ثانية أصلاً ما تُدرّس فيها.
  const [{ data: assignments }, { data: enteredPlans }] = await Promise.all([
    sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)'),
    sb.from('weekly_plans').select('grade_level, subject_id').eq('week_number', wtWeek),
  ]);

  container.innerHTML = '';
  const grades = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

  grades.forEach(grade => {
    const subjMap = new Map();
    (assignments || []).filter(a => a.grade_level === grade && a.subject_id).forEach(a => {
      if (!subjMap.has(a.subject_id)) subjMap.set(a.subject_id, a.subjects ? a.subjects.name : '');
    });
    const gradeSubjects = Array.from(subjMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const enteredIds = new Set((enteredPlans || []).filter(p => p.grade_level === grade).map(p => p.subject_id));
    const missingCount = gradeSubjects.filter(s => !enteredIds.has(s.id)).length;

    const chips = gradeSubjects.map(s => {
      const isEntered = enteredIds.has(s.id);
      const bg = isEntered ? 'var(--meadow-light)' : 'var(--danger-light)';
      const color = isEntered ? 'var(--meadow)' : 'var(--danger)';
      return `<span style="display:inline-block; font-size:12.5px; background:${bg}; color:${color}; padding:4px 12px; border-radius:20px; margin:0 4px 4px 0; font-weight:600;">${s.name}</span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'form-card';
    let statusText;
    if (gradeSubjects.length === 0) {
      statusText = '<span style="font-size:12px; color:var(--slate); font-weight:400;">لا توجد مواد مُسندة لهذه المرحلة بعد</span>';
    } else if (missingCount === 0) {
      statusText = '<span style="color:var(--meadow);">كل المواد مُدخلة لهذا الأسبوع 🎉</span>';
    } else {
      statusText = `<span style="font-size:12px; color:var(--slate); font-weight:400;">(${missingCount} مادة ناقصة من ${gradeSubjects.length})</span>`;
    }
    card.innerHTML = `
      <h4 style="margin-bottom:10px;">${gradeLabels[grade]} ${statusText}</h4>
      <div>${chips}</div>`;
    container.appendChild(card);
  });
}
