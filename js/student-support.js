/* =========================================================================
 * صعوبات التعلم: حالة الطالب ومجالات الصعوبة والتسهيلات في الاختبارات.
 * تستفيد منها ورقة الأسئلة (نموذج صعوبات التعلم) ولجان الاختبارات النهائية.
 * ========================================================================= */
import { sb, currentSchoolId, readScopedBySchool, currentProfile } from './core.js';

export const LD_STATUS = { active: 'مشخّص وملتحق بالبرنامج', observation: 'تحت الملاحظة والتشخيص', exited: 'أنهى البرنامج' };
export const LD_AREAS = ['القراءة', 'الكتابة', 'الرياضيات', 'الانتباه والتركيز', 'الذاكرة', 'الإدراك', 'النطق واللغة'];
export const LD_ACCOM = { alt_paper: 'نموذج أسئلة خاص', special_committee: 'لجنة خاصة', reader: 'قارئ للأسئلة', writer: 'كاتب للإجابة', extra_time: 'وقت إضافي' };

// من يعدّل: المالك والمدير والوكيل والموجّه الطلابي
export const canEditSupport = () => { const p = currentProfile || {}; return ['owner', 'admin', 'deputy'].includes(p.role) || p.staff_role === 'counselor'; };
// يُطبع للطالب نموذج الصعوبات إذا لم ينهِ البرنامج وكان «نموذج أسئلة خاص» من تسهيلاته
export const needsAltPaper = r => !!r && r.status !== 'exited' && (r.accom || []).includes('alt_paper');
export const needsSpecialCommittee = r => !!r && r.status !== 'exited' && (r.accom || []).includes('special_committee');

// خريطة: رقم الطالب ← سجل الصعوبات
export async function loadSupport() {
  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('student_support').select('student_id, status, areas, accom, note, updated_at');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  if (error) return new Map();
  return new Map((data || []).map(r => [r.student_id, r]));
}

export async function saveSupport(studentId, rec) {
  return sb.from('student_support').upsert({ student_id: studentId, status: rec.status, areas: rec.areas || [], accom: rec.accom || [], note: (rec.note || '').trim() || null }, { onConflict: 'student_id' }).select('student_id, status, areas, accom, note, updated_at').single();
}
export async function removeSupport(studentId) {
  return sb.from('student_support').delete().eq('student_id', studentId);
}

// وصف مختصر للحالة: «صعوبات تعلم · القراءة، الكتابة»
export function supportLabel(r) {
  if (!r) return '';
  return [r.status === 'active' ? 'صعوبات تعلم' : LD_STATUS[r.status], (r.areas || []).join('، ')].filter(Boolean).join(' · ');
}
