/* =========================================================================
 * كاش طلاب المدرسة بالجلسة: طلب واحد (مقسوم صفحات) بدل طلبات متكررة لكل شاشة.
 * قاعدة البيانات بعيدة (كل طلب له زمن رحلة)، فنحمّل القائمة مرة ونعيد استخدامها دقائق.
 * ========================================================================= */
import { sb, currentSchoolId, currentUserId, readScopedBySchool } from './core.js';

const TTL = 5 * 60 * 1000;
let cache = null; // { key, at, promise }

export function allStudents(force = false) {
  const key = (currentSchoolId || '') + '|' + (currentUserId || '');
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) return cache.promise;
  const promise = (async () => {
    const out = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await readScopedBySchool(scoped => {
        let q = sb.from('students').select('id, national_id, full_name, grade_level, class_section, mobile').order('full_name').range(from, from + 999);
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      });
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out.filter(s => s.national_id);
  })();
  cache = { key, at: Date.now(), promise };
  promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
  return promise;
}

export async function studentsById() {
  const list = await allStudents();
  return new Map(list.map(s => [String(s.national_id).trim(), s]));
}

export function invalidateStudents() { cache = null; }
