/* =========================================================================
 * نطاق المعلم: فصوله (من الجدول الدراسي) ومواده (من تخصصاته + الجدول)
 * يُستخدم لعرض تقارير مواده وصفوفه، وحصر اختيار الطلاب على طلابه.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool } from './core.js';

let cache = null;
export const normSubj = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '')
  .split(/\s+/).map(w => w.replace(/^(وال|بال|لل|ال)/, '')).filter(Boolean).join(' ').trim();
const ALIASES = [['رقميه', 'حاسب', 'حاسوب', 'تقنيه'], ['اسلاميه', 'قران', 'توحيد', 'فقه', 'حديث', 'تجويد'], ['لغتي', 'عربيه'], ['انجليزي', 'انجليزيه', 'english'], ['اجتماعيات', 'اجتماعيه'], ['بدنيه', 'رياضه بدنيه'], ['فنيه', 'تربيه فنيه'], ['حياتيه', 'اسريه']];

// هل اسم المادة a يطابق b (جزئيًا أو بمرادف)
export function subjectMatches(a, b) {
  const x = normSubj(a), y = normSubj(b);
  if (!x || !y) return false;
  const tx = x.split(' ').filter(w => w.length >= 3), ty = y.split(' ').filter(w => w.length >= 3);
  if (tx.some(w => y.includes(w)) || ty.some(w => x.includes(w))) return true;
  return ALIASES.some(g => g.some(w => x.includes(w)) && g.some(w => y.includes(w)));
}

// المرحلة من نص حر (أول متوسط / الأول المتوسط / first_intermediate)
export function gradeFromText(t) {
  const s = String(t || '');
  if (/first|اول|الأول|أول/.test(s)) return 'first_intermediate';
  if (/second|ثاني|الثاني/.test(s)) return 'second_intermediate';
  if (/third|ثالث|الثالث/.test(s)) return 'third_intermediate';
  return null;
}

export async function myTeachingScope() {
  if (cache && cache.uid === currentUserId) return cache;
  const name = (currentProfile && currentProfile.full_name || '').trim();
  let rows = [];
  if (name) {
    let r = await readScopedBySchool(scoped => {
      let q = sb.from('class_schedules').select('grade_level, class_section, subject_name').or(`teacher_id.eq.${currentUserId},teacher_name.eq."${name.replace(/"/g, '')}"`);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    if (r.error) r = await readScopedBySchool(scoped => {
      let q = sb.from('class_schedules').select('grade_level, class_section, subject_name').eq('teacher_name', name);
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    });
    rows = r.data || [];
  }
  const { data: ts } = await sb.from('teacher_subjects').select('grade_level, subjects(name)').eq('teacher_id', currentUserId);
  const classes = new Map();
  rows.forEach(r => { const sec = parseInt(r.class_section, 10) || 0; if (r.grade_level && sec) classes.set(r.grade_level + '|' + sec, { grade: r.grade_level, section: sec }); });
  const grades = new Set([...classes.values()].map(c => c.grade));
  (ts || []).forEach(t => { if (t.grade_level) grades.add(t.grade_level); });
  const subjects = [...new Set([...rows.map(r => r.subject_name), ...(ts || []).map(t => t.subjects && t.subjects.name)].filter(Boolean))];
  cache = { uid: currentUserId, classes: [...classes.values()], grades, subjects };
  return cache;
}

// طالب ضمن فصول المعلم؟ (لو ما له فصول بالجدول: ضمن صفوف تخصصه)
export function inMyClasses(scope, grade, section) {
  if (scope.classes.length) return scope.classes.some(c => c.grade === grade && String(c.section) === String(parseInt(section, 10) || 0));
  return scope.grades.has(grade);
}
