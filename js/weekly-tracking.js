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

  const [{ data: allSubjects }, { data: enteredPlans }] = await Promise.all([
    sb.from('subjects').select('id, name').order('name'),
    sb.from('weekly_plans').select('grade_level, subject_id').eq('week_number', wtWeek),
  ]);

  container.innerHTML = '';
  const grades = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

  grades.forEach(grade => {
    const enteredIds = new Set((enteredPlans || []).filter(p => p.grade_level === grade).map(p => p.subject_id));
    const missingCount = (allSubjects || []).filter(s => !enteredIds.has(s.id)).length;

    const chips = (allSubjects || []).map(s => {
      const isEntered = enteredIds.has(s.id);
      const bg = isEntered ? 'var(--meadow-light)' : 'var(--danger-light)';
      const color = isEntered ? 'var(--meadow)' : 'var(--danger)';
      return `<span style="display:inline-block; font-size:12.5px; background:${bg}; color:${color}; padding:4px 12px; border-radius:20px; margin:0 4px 4px 0; font-weight:600;">${s.name}</span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'form-card';
    const statusText = missingCount === 0
      ? '<span style="color:var(--meadow);">كل المواد مُدخلة لهذا الأسبوع 🎉</span>'
      : `<span style="font-size:12px; color:var(--slate); font-weight:400;">(${missingCount} مادة ناقصة من ${(allSubjects || []).length})</span>`;
    card.innerHTML = `
      <h4 style="margin-bottom:10px;">${gradeLabels[grade]} ${statusText}</h4>
      <div>${chips}</div>`;
    container.appendChild(card);
  });
}
