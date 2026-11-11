/* =========================================================================
 * مركز الاختبارات: صفحة مساحة العمل «الاختبارات»
 * تجمع خدمات القسم في مكان واحد: رحلة الاختبار (إعداد ← تصحيح ← نتائج)،
 * مكتبة التقارير، اختبارات نافس، الاختبارات النهائية، وآخر الاختبارات المصححة.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool, openTile, tiles, isTileAllowed, finalExamTabs, gradeLabels, backToTiles, ASSET_VERSION } from './core.js';
import { gradeFromText } from './teacher-scope.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  sheet: ic('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="9.5" cy="9" r="1.4"/><circle cx="14.5" cy="9" r="1.4" fill="currentColor"/><circle cx="9.5" cy="14" r="1.4" fill="currentColor"/><circle cx="14.5" cy="14" r="1.4"/>'),
  paper: ic('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
  phone: ic('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><circle cx="12" cy="11" r="2.6"/><path d="M11 18.5h2"/>'),
  upload: ic('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  pen: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  list: ic('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  eye: ic('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  bars: ic('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
  target: ic('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  heal: ic('<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.600 12 20 12 20z"/><path d="M12 11v4M10 13h4"/>'),
  absent: ic('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c1-3.6 3.400-5.500 6.500-5.500 1.300 0 2.500.3 3.500 1"/><path d="M16.5 15.500l4 4M20.500 15.500l-4 4"/>'),
  family: ic('<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9.500" r="2.300"/><path d="M2.500 19c.8-3.200 2.900-5 5.500-5s4.700 1.800 5.500 5M14.500 14.600c.8-.4 1.600-.6 2.500-.6 2.100 0 3.700 1.400 4.500 4"/>'),
  check: ic('<path d="M12 3l7 3v5.500c0 4.300-2.900 7.800-7 9.500-4.100-1.700-7-5.200-7-9.500V6z"/><path d="M9 12l2.200 2.200L15.200 10"/>'),
  trend: ic('<path d="M3 17l5.500-5.500 4 4L21 7"/><path d="M15 7h6v6"/>'),
  medal: ic('<circle cx="12" cy="14.500" r="5"/><path d="M8.500 10.500L6 3h4l2 4 2-4h4l-2.500 7.500"/>'),
  seats: ic('<rect x="3" y="4" width="7" height="6" rx="1.500"/><rect x="14" y="4" width="7" height="6" rx="1.500"/><rect x="3" y="14" width="7" height="6" rx="1.500"/><rect x="14" y="14" width="7" height="6" rx="1.500"/>'),
  route: ic('<circle cx="6" cy="6" r="2.500"/><circle cx="18" cy="18" r="2.500"/><path d="M8.500 6H15a3.500 3.500 0 0 1 0 7H9a3.500 3.500 0 0 0 0 7h6.500"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  go: ic('<path d="M15 18l-6-6 6-6"/>'),
};
const TYPE = { diagnostic: ['تشخيصي', 'dg'], periodic: ['فتري', 'pr'], nafes: ['نافس', 'nf'] };
const num = n => Number(n || 0).toLocaleString('en-US');
const dateTxt = d => { try { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }); } catch { return ''; } };
const isTeacher = () => currentProfile && currentProfile.role === 'teacher';
const scopedTeacher = () => isTeacher() && currentProfile.staff_role !== 'counselor';
const allowed = key => { const t = tiles.find(x => x.key === key); return !!(t && isTileAllowed(t)); };

// نية تُسلَّم لقسم «النتائج والتقارير»: يفتح التقرير أو الخدمة المطلوبة مباشرة
export function setExamIntent(intent) { try { sessionStorage.setItem('er-intent', JSON.stringify(intent)); } catch { /* التخزين ممنوع */ } }
function go(key, sub = null, intent = null) {
  if (intent) setExamIntent(intent);
  const t = tiles.find(x => x.key === key);
  openTile(key, t ? t.title : '', sub);
}

async function loadData() {
  const out = { reps: [], keys: null, pubs: null, period: null };
  const rr = await readScopedBySchool(scoped => {
    let q = sb.from('exam_reports').select('id, title, subject_name, grade_level, students_count, created_at, created_by, exam_type');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('created_at', { ascending: false });
  });
  let reps = rr.data || [];
  if (scopedTeacher() && reps.length) {
    try {
      const { myTeachingScope, subjectMatches } = await import('./teacher-scope.js?v=' + ASSET_VERSION);
      const sc = await myTeachingScope();
      reps = reps.filter(r => {
        if (r.created_by === currentUserId) return true;
        if (!sc.subjects.length) return false;
        if (!sc.subjects.some(sj => subjectMatches(r.subject_name || r.title, sj) || subjectMatches(r.title, sj))) return false;
        const g = gradeFromText(r.grade_level) || gradeFromText(r.title);
        return !g || sc.grades.has(g);
      });
    } catch (e) { reps = reps.filter(r => r.created_by === currentUserId); }
  }
  out.reps = reps;
  const jobs = [];
  jobs.push(readScopedBySchool(scoped => {
    let q = sb.from('answer_keys').select('id, created_by');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  }).then(r => { if (!r.error) out.keys = (r.data || []).filter(k => !isTeacher() || k.created_by === currentUserId).length; }).catch(() => {}));
  if (!isTeacher()) {
    jobs.push(readScopedBySchool(scoped => {
      let q = sb.from('result_publications').select('id, published');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }).then(r => { if (!r.error) out.pubs = (r.data || []).filter(p => p.published).length; }).catch(() => {}));
    jobs.push(readScopedBySchool(scoped => {
      let q = sb.from('exam_periods').select('name, committee_count, created_at');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('created_at', { ascending: false }).limit(1);
    }).then(r => { if (!r.error) out.period = (r.data || [])[0] || null; }).catch(() => {}));
  }
  await Promise.all(jobs);
  return out;
}

const bubbles = () => `<div class="xh-omr" aria-hidden="true">${[[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0], [0, 0, 0, 1], [0, 1, 0, 0]].map((row, i) => `<div><em>${i + 1}</em>${row.map((f, j) => `<i class="${f ? 'on' : ''}">${'أبجد'[j]}</i>`).join('')}</div>`).join('')}</div>`;

const stat = (v, l) => `<div class="xh-stat"><b>${v}</b><span>${l}</span></div>`;
const link = (act, icon, t, d = '') => `<button type="button" class="xh-link" data-act="${act}"><span class="xh-li">${icon}</span><span class="xh-lt"><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span><span class="xh-lgo">${I.go}</span></button>`;
const rep = (act, icon, t, d, tone = '') => `<button type="button" class="xh-rep ${tone}" data-act="${act}"><span class="xh-ri">${icon}</span><b>${t}</b><small>${d}</small></button>`;

let PICK = null; // الاختبار المختار في «تقارير الاختبار»

function draw(view, D) {
  const teacher = isTeacher();
  const reps = D.reps;
  const sheets = reps.reduce((a, r) => a + (Number(r.students_count) || 0), 0);
  const nafes = reps.filter(r => r.exam_type === 'nafes');
  const hasPeriodic = reps.some(r => r.exam_type === 'periodic');
  const fx = finalExamTabs();
  if (!PICK || !reps.some(r => r.id === PICK)) PICK = reps.length ? reps[0].id : null;
  const byType = k => reps.filter(r => (r.exam_type || 'diagnostic') === k).length;

  // مجموعات قائمة اختيار الاختبار: حسب المادة
  const groups = new Map();
  reps.forEach(r => { const k = r.subject_name || 'أخرى'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const pickHtml = [...groups.entries()].map(([sj, list]) => `<optgroup label="${esc(sj)}">${list.map(r => `<option value="${r.id}"${r.id === PICK ? ' selected' : ''}>${esc(r.title)} · ${dateTxt(r.created_at)}</option>`).join('')}</optgroup>`).join('');

  view.innerHTML = `<div class="xh">
    <section class="xh-hero">
      ${bubbles()}
      <div class="xh-hero-main">
        <div class="xh-crumb"><a href="#/" data-home>الرئيسية</a> / مساحة العمل</div>
        <h1>مركز الاختبارات</h1>
        <p>${teacher ? 'أعدّ اختبارك وصحّحه واطّلع على نتائج طلابك وتحليلها من مكان واحد.' : 'إعداد الاختبارات وتصحيحها وتحليل نتائجها ونشرها لأولياء الأمور، مع إدارة الاختبارات النهائية.'}</p>
        <div class="xh-cta">
          ${allowed('exam-prep') ? `<button type="button" class="xh-btn pri" data-act="prep">${I.plus}<span>اختبار جديد</span></button>` : ''}
          ${allowed('exam-grading') ? `<button type="button" class="xh-btn" data-act="grade">${I.phone}<span>تصحيح الأوراق</span></button>` : ''}
          ${allowed('exam-reports') ? `<button type="button" class="xh-btn" data-act="results">${I.list}<span>نتائج الاختبارات</span></button>` : ''}
        </div>
      </div>
      <div class="xh-stats">
        ${stat(num(reps.length), teacher ? 'اختبارًا في نطاقك' : 'اختبارًا مصحَّحًا')}
        ${stat(num(sheets), 'ورقة طالب مصحَّحة')}
        ${D.keys != null ? stat(num(D.keys), 'نموذج إجابة محفوظ') : ''}
        ${D.pubs != null ? stat(num(D.pubs), 'نتيجة منشورة لأولياء الأمور') : ''}
      </div>
    </section>

    <section class="xh-block">
      <header class="xh-h"><h2>رحلة الاختبار</h2><span>ثلاث مراحل متتابعة من إعداد الورقة إلى قراءة النتيجة</span></header>
      <div class="xh-path">
        ${allowed('exam-prep') ? `<article class="xh-stage s1">
          <div class="xh-stage-h"><i>1</i><div><h3>إعداد الاختبار</h3><p>نموذج الإجابة والمهارات وطباعة الأوراق</p></div></div>
          ${link('prep', I.sheet, 'ورقة إجابة ونموذج إجابة', 'ورقة تظليل لكل طالب برقمه')}
          ${link('prep-paper', I.paper, 'ورقة أسئلة مع التظليل', 'الأسئلة والتظليل في ورقة واحدة')}
        </article>` : ''}
        ${allowed('exam-grading') ? `<article class="xh-stage s2">
          <div class="xh-stage-h"><i>2</i><div><h3>التصحيح</h3><p>اختر الطريقة المناسبة لأوراقك</p></div></div>
          ${link('grade', I.phone, 'التصحيح بالجوال', 'صوّر ورقة الطالب بالكاميرا')}
          ${teacher ? '' : link('grade-upload', I.upload, 'رفع ملف Remark', 'ملف الإكسل الناتج من الماسح')}
          ${link('grade-manual', I.pen, 'إدخال يدوي', 'أضف ورقة طالب لاختبار مصحَّح')}
        </article>` : ''}
        ${allowed('exam-reports') ? `<article class="xh-stage s3">
          <div class="xh-stage-h"><i>3</i><div><h3>النتائج والتقارير</h3><p>الدرجات والتحليل والنشر</p></div></div>
          ${link('results', I.list, 'نتائج الاختبارات', reps.length ? `${num(reps.length)} اختبارًا مرتبة حسب المادة` : 'تظهر هنا بعد التصحيح')}
          ${teacher ? '' : link('publish', I.family, 'النشر لأولياء الأمور', 'رابط النتائج وإشعارات الدرجات')}
        </article>` : ''}
      </div>
    </section>

    <div class="xh-cols">
      <div class="xh-main">
        ${allowed('exam-reports') ? `<section class="xh-block">
          <header class="xh-h"><h2>مكتبة التقارير</h2><span>كل تقرير يفتح مباشرة على الصفحة المطلوبة</span></header>

          <div class="xh-shelf">
            <div class="xh-shelf-h"><b>تقارير اختبار محدد</b>
              ${reps.length ? `<label class="xh-pick"><span>الاختبار</span><select id="xh-pick" aria-label="اختر الاختبار">${pickHtml}</select></label>` : ''}</div>
            ${reps.length ? `<div class="xh-reps">
              ${rep('tab-brief', I.eye, 'الملخص', 'الخلاصة في صفحة واحدة للطباعة', 't-teal')}
              ${rep('tab-grades', I.bars, 'توزيع الدرجات', 'التقديرات والمدرج التكراري', 't-blue')}
              ${rep('tab-questions', I.target, 'تحليل الأسئلة', 'الصعوبة والتمييز والمشتتات', 't-purple')}
              ${rep('tab-skills', I.heal, 'المهارات والعلاج', 'إتقان المهارات والخطة العلاجية', 't-gold')}
            </div>` : '<p class="xh-empty">لا توجد اختبارات مصحَّحة بعد. ابدأ من «إعداد الاختبار» ثم صحّح الأوراق لتظهر تقاريرها هنا.</p>'}
          </div>

          ${!teacher || hasPeriodic ? `<div class="xh-shelf">
            <div class="xh-shelf-h"><b>تقارير على مستوى المدرسة</b></div>
            <div class="xh-reps">
              ${hasPeriodic ? rep('absence', I.absent, 'تقرير الغياب', 'الغائبون عن الاختبارات الفترية', 't-red') : ''}
              ${teacher ? '' : rep('publish', I.family, 'نتائج أولياء الأمور', 'نشر النتائج والشهادات عبر الرابط', 't-blue')}
              ${teacher ? '' : rep('audit', I.check, 'التحقق من الدرجات', 'إعادة حساب التقارير ومطابقتها', 't-green')}
            </div>
          </div>` : ''}

          ${nafes.length ? `<div class="xh-shelf xh-nafes">
            <div class="xh-shelf-h"><b>اختبارات نافس</b><span class="xh-chip nf">${nafes.length === 1 ? 'اختبار واحد' : nafes.length === 2 ? 'اختباران' : nafes.length + ' اختبارات'}</span></div>
            <div class="xh-reps">
              ${rep('nafes', I.medal, 'التقرير الشامل', 'الاجتياز والمواد والمهارات والمعلمون', 't-nafes')}
              ${rep('nafes-progress', I.trend, 'التطور عبر الاختبارات', 'الفروق والتحسن والتراجع', 't-nafes')}
              ${rep('nafes-students', I.family, 'نتائج الطلاب والشهادات', 'بطاقة كل طالب وشهادته', 't-nafes')}
            </div>
          </div>` : ''}
        </section>` : ''}
      </div>

      <aside class="xh-side">
        ${reps.length ? `<section class="xh-card">
          <header class="xh-h sm"><h2>آخر الاختبارات</h2><button type="button" class="xh-more" data-act="results">عرض الكل</button></header>
          <div class="xh-recent">${reps.slice(0, 6).map(r => { const [tl, tc] = TYPE[r.exam_type || 'diagnostic'] || TYPE.diagnostic; return `<button type="button" data-open="${r.id}">
            <span class="xh-rt"><b>${esc(r.title)}</b><small>${dateTxt(r.created_at)} · ${num(r.students_count)} طالبًا</small></span><span class="xh-chip ${tc}">${tl}</span></button>`; }).join('')}</div>
          <div class="xh-mix">${['diagnostic', 'periodic', 'nafes'].filter(k => byType(k)).map(k => `<button type="button" data-type="${k}" class="${TYPE[k][1]}"><b>${byType(k)}</b>${TYPE[k][0]}</button>`).join('')}</div>
        </section>` : ''}
        ${fx.length ? `<section class="xh-card xh-final">
          <header class="xh-h sm"><h2>الاختبارات النهائية</h2></header>
          <p class="xh-final-p">${D.period ? `${esc(D.period.name)}${D.period.committee_count ? ` · ${D.period.committee_count} لجنة` : ''}` : 'اللجان والتسكين ومتابعة سير أوراق الإجابة'}</p>
          ${fx.some(x => x.key === 'exams') ? link('final-exams', I.seats, 'اللجان وتسكين الطلاب', 'التوزيع والكشوف والملصقات') : ''}
          ${fx.some(x => x.key === 'tracking') ? link('final-tracking', I.route, 'متابعة سير الاختبارات', 'ورقة الإجابة وغياب الطلاب') : ''}
        </section>` : ''}
      </aside>
    </div>
  </div>`;

  const ACT = {
    prep: () => go('exam-prep'), 'prep-paper': () => go('exam-prep', 'paper'),
    grade: () => go('exam-grading'), 'grade-upload': () => go('exam-grading', 'upload'), 'grade-manual': () => go('exam-grading', 'manual'),
    results: () => go('exam-reports'),
    publish: () => go('exam-reports', null, { act: 'publish' }),
    absence: () => go('exam-reports', null, { act: 'absence' }),
    audit: () => go('exam-reports', null, { act: 'audit' }),
    nafes: () => go('exam-reports', null, { act: 'nafes', id: nafes[0].id, tab: 'brief' }),
    'nafes-progress': () => go('exam-reports', null, { act: 'nafes', id: nafes[0].id, tab: 'progress' }),
    'nafes-students': () => go('exam-reports', null, { act: 'nafes', id: nafes[0].id, tab: 'students' }),
    'final-exams': () => go('exams'), 'final-tracking': () => go('tracking'),
  };
  view.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a.startsWith('tab-')) { if (PICK) go('exam-reports', PICK, { act: 'tab', id: PICK, tab: a.slice(4) }); return; }
    if (ACT[a]) ACT[a]();
  }));
  view.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => go('exam-reports', b.dataset.open)));
  view.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => go('exam-reports', null, { act: 'filter', type: b.dataset.type })));
  const pk = view.querySelector('#xh-pick'); if (pk) pk.addEventListener('change', () => { PICK = pk.value; });
  view.querySelector('[data-home]').addEventListener('click', e => { e.preventDefault(); backToTiles(); });
}

export async function renderExamsHub(view) {
  const empty = { reps: [], keys: null, pubs: null, period: null };
  draw(view, empty);
  view.querySelector('.xh').classList.add('is-loading');
  let D = empty;
  try { D = await loadData(); } catch (e) { console.error('exams hub', e); }
  if (!view.querySelector('.xh')) return; // انتقل المستخدم لصفحة أخرى
  draw(view, D);
}
