import { academicWeekInfo, weekLabel, sb, currentUserId, currentProfile, isAdminOrDeputy, isStaff, gradeLabels, currentSchoolId } from './core.js';

/* ===== كتابة آمنة لعمود school_id قبل/بعد تنفيذ ترقية SQL للمرحلة الثانية =====
 * لو عمود school_id لسا ما انضاف لهذا الجدول بقاعدة البيانات (رفع الكود صار قبل تنفيذ SQL
 * الترقية)، الكتابة به تفشل - فنعيد المحاولة بدونه عشان الحفظ يستمر يشتغل عادي بمدرسة وحدة. */
async function writeWithSchoolFallback(fn) {
  const withSchool = currentSchoolId ? { school_id: currentSchoolId } : {};
  let res = await fn(withSchool);
  if (res.error && currentSchoolId) {
    res = await fn({});
  }
  return res;
}

/* ===== قراءة آمنة مقيّدة بمدرسة الحساب الحالي =====
 * لازم كل قراءة من weekly_plans/weekly_admin_notes/weekly_plan_publish_settings تتقيّد بمدرسة
 * الحساب، وإلا تختلط بيانات كل المدارس مع بعض بنفس القائمة. نفس منطق runScoped بصفحة أولياء
 * الأمور: نجرب الاستعلام مع فلتر المدرسة أول، ولو فشل (عمود school_id لسا ما انضاف) نعيد
 * المحاولة بدونه عشان الصفحة تستمر تشتغل بمدرسة وحدة قبل تنفيذ SQL الترقية. */
async function readScoped(factory) {
  let res = await factory(true);
  if (res.error && currentSchoolId) {
    res = await factory(false);
  }
  return res;
}

/* ===== رابط صفحة أولياء الأمور (خاص بمدرسة هذا الحساب) =====
 * parent.html يحدد المدرسة من ?school=<slug>. بدون تعدد مدارس (أو قبل تنفيذ ترقية SQL) نستخدم
 * "al-murooj" كافتراضي عشان الرابط يستمر يشتغل بدون تغيير لمدرسة المروج. */
async function buildParentPageUrl() {
  let slug = 'al-murooj';
  if (currentSchoolId) {
    const { data } = await sb.from('schools').select('slug').eq('id', currentSchoolId).maybeSingle();
    if (data && data.slug) slug = data.slug;
  }
  const base = location.origin + location.pathname.replace(/index\.html$/, '').replace(/\/[^/]*$/, '/');
  return base + 'parent.html?school=' + encodeURIComponent(slug);
}

document.getElementById('weekly-copy-parent-link').addEventListener('click', async () => {
  const msgEl = document.getElementById('weekly-copy-parent-link-msg');
  const url = await buildParentPageUrl();
  try {
    await navigator.clipboard.writeText(url);
    msgEl.textContent = 'تم نسخ الرابط: ' + url;
  } catch (e) {
    msgEl.textContent = 'تعذر النسخ التلقائي - انسخه يدويًا: ' + url;
  }
  msgEl.style.display = 'block';
  setTimeout(() => { msgEl.style.display = 'none'; }, 6000);
});

/* ===== تقييد نموذج الخطة الأسبوعية للمعلم حسب تخصصه ===== */
let teacherAssignments = [];
let teacherListenersBound = false;
async function loadTeacherAssignments() {
  const { data } = await sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)').eq('teacher_id', currentUserId);
  teacherAssignments = data || [];
}

function restrictWeeklyFormForTeacher() {
  const gradeSelect = document.getElementById('weekly-grade');
  const subSelect = document.getElementById('weekly-subject');
  const allowedGrades = [...new Set(teacherAssignments.map(a => a.grade_level))];

  if (teacherAssignments.length === 0) {
    document.getElementById('weekly-form-card').innerHTML = '<p style="color:var(--slate); font-size:13px;">ما عندك تخصيص مادة/مرحلة بعد. راجع المدير عشان يضيفك من "إدارة الصلاحيات".</p>';
    return;
  }

  const prevGrade = gradeSelect.value;
  gradeSelect.innerHTML = '';
  allowedGrades.forEach(g => { const o=document.createElement('option'); o.value=g; o.textContent=gradeLabels[g]; gradeSelect.appendChild(o); });
  if (allowedGrades.includes(prevGrade)) gradeSelect.value = prevGrade;

function refreshSubjectsForGrade() {
    const grade = gradeSelect.value;
    subSelect.innerHTML = '';
    teacherAssignments.filter(a => a.grade_level === grade).forEach(a => {
      const o = document.createElement('option'); o.value = a.subject_id; o.textContent = a.subjects ? a.subjects.name : ''; subSelect.appendChild(o);
    });
    loadFormForCurrentSelection();
  }
  // نربط المستمعين مرة وحدة بس (الدالة تنستدعى مع كل تغيير أسبوع)
  if (!teacherListenersBound) {
    teacherListenersBound = true;
    gradeSelect.addEventListener('change', () => { refreshSubjectsForGrade(); });
    subSelect.addEventListener('change', loadFormForCurrentSelection);
  }
  refreshSubjectsForGrade();
}

/* ===== دعم أكثر من درس بنفس خطة المادة =====
 * ولمادة "الدراسات الإسلامية" تحديدًا: الجدول الدراسي نفسه ما يتغيّر (يبقى مادة وحدة فيه)،
 * لكن شاشة إدخال خطة المعلم تعرض قسمين مستقلين (القرآن الكريم / التربية الإسلامية) بدل حقل عام واحد،
 * بناءً على طلب الإدارة. يُخزَّن كل قسم كسطر بادئته اسم القسم داخل نفس عمود lessons (مصفوفة نصوص)
 * الموجود أصلًا، عشان ما نحتاج أي تعديل قاعدة بيانات - وتبقى صفحة ولي الأمر ولوحة المتابعة تعرضها
 * عاديًا كقائمة أسطر. */
const ISLAMIC_SECTIONS = [
  { key: 'quran', label: 'القرآن الكريم' },
  { key: 'islamic', label: 'التربية الإسلامية' },
];
/* الأقسام القديمة (قبل الدمج لقسمين) - عشان الخطط المحفوظة سابقًا تنفتح بالقسم الصحيح:
 * "قرآن" ← القرآن الكريم، والباقي (توحيد/تفسير/حديث/فقه) ← التربية الإسلامية مع إبقاء اسم القسم
 * القديم داخل نص الدرس حتى ما تضيع المعلومة. */
const LEGACY_ISLAMIC_PREFIXES = [
  { label: 'قرآن', key: 'quran', keepLabel: false },
  { label: 'توحيد', key: 'islamic', keepLabel: true },
  { label: 'تفسير', key: 'islamic', keepLabel: true },
  { label: 'حديث', key: 'islamic', keepLabel: true },
  { label: 'فقه', key: 'islamic', keepLabel: true },
];
function isIslamicSubjectName(name) { return !!name && name.includes('إسلام'); }
function currentSubjectName() {
  const subSelect = document.getElementById('weekly-subject');
  const opt = subSelect && subSelect.selectedOptions[0];
  return opt ? opt.textContent : '';
}

/* يبني واجهة إدخال الدروس (عامة أو مقسّمة لمواد الدراسات الإسلامية) داخل أي حاوية + زر إضافة،
 * قابلة لإعادة الاستخدام بكل من نموذج الإضافة العلوي وشاشة تعديل الإدارة بالقائمة. */
function buildLessonEditorUI({ container, addBtn, subjectName, lessons }) {
  const islamic = isIslamicSubjectName(subjectName);
  if (addBtn) addBtn.classList.toggle('hidden', islamic);
  container.innerHTML = '';

  function addGenericRow(value = '') {
    const row = document.createElement('div');
    row.className = 'lesson-row';
    row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; margin-bottom:10px;';
    row.innerHTML = `
      <textarea class="lesson-editor-input" placeholder="الدرس" rows="2" style="flex:1; margin-bottom:0;"></textarea>
      <button type="button" class="lesson-remove-btn text-action-btn" style="color:var(--danger) !important; white-space:nowrap;">حذف</button>`;
    row.querySelector('.lesson-editor-input').value = value;
    row.querySelector('.lesson-remove-btn').addEventListener('click', () => {
      row.remove();
      if (container.children.length === 0) addGenericRow('');
    });
    container.appendChild(row);
  }

  function addIslamicRow(key, value = '') {
    const rowsWrap = container.querySelector(`.islamic-lesson-rows[data-key="${key}"]`);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; margin-bottom:8px;';
    row.innerHTML = `
      <textarea class="lesson-editor-input" data-key="${key}" placeholder="الدرس" rows="2" style="flex:1; margin-bottom:0;"></textarea>
      <button type="button" class="lesson-remove-btn text-action-btn" style="color:var(--danger) !important; white-space:nowrap;">حذف</button>`;
    row.querySelector('.lesson-editor-input').value = value;
    row.querySelector('.lesson-remove-btn').addEventListener('click', () => {
      row.remove();
      if (rowsWrap.children.length === 0) addIslamicRow(key, '');
    });
    rowsWrap.appendChild(row);
  }

  if (islamic) {
    container.innerHTML = ISLAMIC_SECTIONS.map(sec => `
      <div class="islamic-lesson-group">
        <label style="font-weight:700; font-size:12.5px; color:var(--ink); display:block; margin:10px 0 6px;">${sec.label}</label>
        <div class="islamic-lesson-rows" data-key="${sec.key}"></div>
        <span class="text-action-btn islamic-add-lesson-btn" data-key="${sec.key}" style="font-size:12px;">+ إضافة درس</span>
      </div>`).join('');

    const grouped = {};
    ISLAMIC_SECTIONS.forEach(sec => { grouped[sec.key] = []; });
    (lessons || []).forEach(l => {
      const match = ISLAMIC_SECTIONS.find(sec => l.startsWith(sec.label + ': '));
      if (match) { grouped[match.key].push(l.slice(match.label.length + 2)); return; }
      const legacy = LEGACY_ISLAMIC_PREFIXES.find(p => l.startsWith(p.label + ': '));
      if (legacy) { grouped[legacy.key].push(legacy.keepLabel ? l : l.slice(legacy.label.length + 2)); return; }
      grouped.islamic.push(l); // احتياطًا لأي درس قديم بدون بادئة قسم واضحة - يُعرض تحت "التربية الإسلامية" بدل ما يضيع
    });
    ISLAMIC_SECTIONS.forEach(sec => {
      const vals = grouped[sec.key].length > 0 ? grouped[sec.key] : [''];
      vals.forEach(v => addIslamicRow(sec.key, v));
    });
    container.querySelectorAll('.islamic-add-lesson-btn').forEach(btn => {
      btn.addEventListener('click', () => addIslamicRow(btn.dataset.key, ''));
    });
  } else {
    const list = (lessons && lessons.length > 0) ? lessons : [''];
    list.forEach(v => addGenericRow(v));
    if (addBtn) addBtn.onclick = () => addGenericRow('');
  }
}

function collectLessonsFromEditor(container, subjectName) {
  if (isIslamicSubjectName(subjectName)) {
    const result = [];
    ISLAMIC_SECTIONS.forEach(sec => {
      Array.from(container.querySelectorAll(`.lesson-editor-input[data-key="${sec.key}"]`))
        .map(t => t.value.trim()).filter(v => v.length > 0)
        .forEach(v => result.push(`${sec.label}: ${v}`));
    });
    return result;
  }
  return Array.from(container.querySelectorAll('.lesson-editor-input'))
    .map(t => t.value.trim()).filter(v => v.length > 0);
}

/* المادة تغيّرت بالنموذج العلوي - لو معلم، loadFormForCurrentSelection تتكفّل بإعادة البناء (وتستدعي
 * buildLessonEditorUI بنفسها)؛ لو إدارة (النموذج العلوي عندها "إضافة جديد" بس، بدون تحميل خطة
 * موجودة) نعيد بناء واجهة الإدخال فاضية لتطابق نوع المادة الجديدة. */
document.getElementById('weekly-subject').addEventListener('change', () => {
  if (currentProfile.role === 'teacher') return;
  // الإدارة: لو للمادة خطة محفوظة لهذا الأسبوع تنفتح بالنموذج للتعديل (بدل نموذج فاضي يكتب فوقها)
  loadFormForCurrentSelection();
});

/* ===== تحديد الفصول اللي عليها الاختبار (لو المادة تُدرّس بأكثر من فصل بمعلمين مختلفين) ===== */
const sectionsCacheByGrade = {};
async function getSectionsForGrade(grade) {
  if (sectionsCacheByGrade[grade]) return sectionsCacheByGrade[grade];
  const { data } = await sb.from('students').select('class_section').eq('grade_level', grade);
  let sections = [...new Set((data || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);
  if (sections.length === 0) sections = [1, 2, 3, 4, 5, 6, 7, 8];
  sectionsCacheByGrade[grade] = sections;
  return sections;
}

async function renderTestSectionsPicker(container, grade, selected) {
  const sections = await getSectionsForGrade(grade);
  container.innerHTML = sections.map(n => `
    <label style="display:flex; align-items:center; gap:5px; font-size:12.5px;">
      <input type="checkbox" class="test-section-check" value="${n}" style="width:auto;" ${selected && selected.includes(n) ? 'checked' : ''} />
      الفصل ${n}
    </label>`).join('');
}
function collectTestSections(container) {
  const checked = Array.from(container.querySelectorAll('.test-section-check:checked')).map(c => parseInt(c.value));
  return checked.length > 0 ? checked : null; // فاضية = كل الفصول
}
function formatTestSections(sections) {
  return (sections && sections.length > 0) ? 'الفصول: ' + sections.map(n => 'الفصل ' + n).join('، ') : 'كل الفصول';
}

/* ===== "لا يوجد واجب" - يعطّل خانة نص الواجبات ويوضّح ذلك للطالب/ولي الأمر بدل النص الحر ===== */
function toggleNoHomeworkUI(checked) {
  const homeworkField = document.getElementById('weekly-homework');
  homeworkField.disabled = checked;
  if (checked) homeworkField.value = '';
}
document.getElementById('weekly-no-homework').addEventListener('change', (e) => {
  toggleNoHomeworkUI(e.target.checked);
});

document.getElementById('weekly-has-test').addEventListener('change', async (e) => {
  const wrap = document.getElementById('weekly-test-sections-wrap');
  wrap.classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) {
    const grade = document.getElementById('weekly-grade').value;
    await renderTestSectionsPicker(document.getElementById('weekly-test-sections-list'), grade, null);
  }
});

/* تحميل خطة المعلم الحالية (إن وُجدت) للمادة/المرحلة/الأسبوع المحددين، للتعديل بدل الإدخال من الصفر */
async function loadFormForCurrentSelection() {
  if (!isStaff() && currentProfile.role !== 'teacher') return;
  const subjectId = document.getElementById('weekly-subject').value;
  const grade = document.getElementById('weekly-grade').value;
  const titleEl = document.getElementById('weekly-form-title');
  if (!subjectId || !grade) {
    buildLessonEditorUI({ container: document.getElementById('weekly-lessons-container'), addBtn: document.getElementById('weekly-add-lesson-btn'), subjectName: currentSubjectName(), lessons: [''] });
    return;
  }

  const { data: existing } = await readScoped(scoped => {
    let q = sb.from('weekly_plans')
      .select('lessons, performance_tasks, homework, no_homework, has_test, test_sections, test_note')
      .eq('subject_id', subjectId).eq('grade_level', grade).eq('week_number', currentWeek);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.maybeSingle();
  });

  const lessonsContainer = document.getElementById('weekly-lessons-container');
  const lessonsAddBtn = document.getElementById('weekly-add-lesson-btn');
  const subjectName = currentSubjectName();

  const testWrap = document.getElementById('weekly-test-sections-wrap');
  if (existing) {
    buildLessonEditorUI({ container: lessonsContainer, addBtn: lessonsAddBtn, subjectName, lessons: existing.lessons || [] });
    document.getElementById('weekly-tasks').value = existing.performance_tasks || '';
    document.getElementById('weekly-homework').value = existing.homework || '';
    document.getElementById('weekly-no-homework').checked = !!existing.no_homework;
    toggleNoHomeworkUI(!!existing.no_homework);
    document.getElementById('weekly-has-test').checked = !!existing.has_test;
    testWrap.classList.toggle('hidden', !existing.has_test);
    document.getElementById('weekly-test-note').value = existing.test_note || '';
    if (existing.has_test) await renderTestSectionsPicker(document.getElementById('weekly-test-sections-list'), grade, existing.test_sections);
    titleEl.textContent = 'تحديث خطة المادة لهذا الأسبوع';
  } else {
    buildLessonEditorUI({ container: lessonsContainer, addBtn: lessonsAddBtn, subjectName, lessons: [''] });
    document.getElementById('weekly-tasks').value = '';
    document.getElementById('weekly-homework').value = '';
    document.getElementById('weekly-no-homework').checked = false;
    toggleNoHomeworkUI(false);
    document.getElementById('weekly-has-test').checked = false;
    testWrap.classList.add('hidden');
    document.getElementById('weekly-test-note').value = '';
    titleEl.textContent = 'إضافة خطة المادة لهذا الأسبوع';
  }
}

// يفتح افتراضيًا على الأسبوع القادم (اللي يدخّل له المعلمون خطتهم خلال الأسبوع الحالي)
let currentWeek = null;
let subjectsCache = [];

export async function loadWeeklyModule() {
  if (currentWeek == null) currentWeek = Math.min(40, academicWeekInfo().next);
  document.getElementById('weekly-form-card').classList.toggle('hidden', !isStaff());
  document.getElementById('wp-note-toggle').classList.toggle('hidden', !isAdminOrDeputy());
  if (!isAdminOrDeputy()) document.getElementById('weekly-admin-note-card').classList.add('hidden');
  document.getElementById('weekly-publish-card').classList.toggle('hidden', !isAdminOrDeputy());
  document.getElementById('weekly-parent-link-card').classList.toggle('hidden', !isAdminOrDeputy());
  document.getElementById('week-label').textContent = weekLabel(currentWeek);

  if (currentProfile.role === 'teacher') {
    document.getElementById('weekly-form-card').classList.remove('hidden');
    await loadTeacherAssignments();
    restrictWeeklyFormForTeacher();
  } else if (subjectsCache.length === 0) {
    const { data: subjects } = await sb.from('subjects').select('id, name').order('name');
    subjectsCache = subjects || [];
    const subSelect = document.getElementById('weekly-subject');
    subSelect.innerHTML = '';
    subjectsCache.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; subSelect.appendChild(o); });
    buildLessonEditorUI({ container: document.getElementById('weekly-lessons-container'), addBtn: document.getElementById('weekly-add-lesson-btn'), subjectName: currentSubjectName(), lessons: [''] });
  }

  syncGradeTabs();
  if (currentProfile.role !== 'teacher' && isStaff()) loadFormForCurrentSelection();
  if (isAdminOrDeputy()) {
    await loadWeeklyAdminNote();
    await loadPublishToggle();
  }
  await refreshWeeklyList();
}

/* تبويبات المراحل بدل القائمة المنسدلة (تقرأ خيارات #weekly-grade - للمعلم: مراحله فقط) */
function syncGradeTabs() {
  const sel = document.getElementById('weekly-grade');
  const box = document.getElementById('wp-grade-tabs');
  box.innerHTML = [...sel.options].map(o => `<button type="button" role="tab" data-g="${o.value}" class="${o.value === sel.value ? 'active' : ''}">${esc(o.textContent)}</button>`).join('');
  box.classList.toggle('hidden', sel.options.length < 2);
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (sel.value === b.dataset.g) return;
    sel.value = b.dataset.g;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    sel.dispatchEvent(new Event('change'));
  }));
}
function syncPublishLabel() {
  const on = document.getElementById('weekly-publish-toggle').checked;
  document.getElementById('weekly-publish-card').classList.toggle('on', on);
  document.querySelector('#weekly-publish-card .wp-publish-txt').textContent = on ? 'منشور لأولياء الأمور' : 'غير منشور (مسودة)';
}
document.getElementById('wp-note-toggle').addEventListener('click', () => {
  const card = document.getElementById('weekly-admin-note-card');
  card.classList.toggle('hidden');
  if (!card.classList.contains('hidden')) document.getElementById('weekly-admin-note-text').focus();
});

async function loadPublishToggle() {
  const { data } = await readScoped(scoped => {
    let q = sb.from('weekly_plan_publish_settings').select('is_published').eq('week_number', currentWeek);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.maybeSingle();
  });
  document.getElementById('weekly-publish-toggle').checked = !!(data && data.is_published);
  syncPublishLabel();
}

document.getElementById('weekly-publish-toggle').addEventListener('change', async (e) => {
  const isPublished = e.target.checked;
  syncPublishLabel();
  if (isPublished) {
    await writeWithSchoolFallback(extra => sb.from('weekly_plan_publish_settings').upsert({ week_number: currentWeek, is_published: true, updated_at: new Date().toISOString(), ...extra }));
  } else {
    let q = sb.from('weekly_plan_publish_settings').delete().eq('week_number', currentWeek);
    if (currentSchoolId) q = q.eq('school_id', currentSchoolId);
    await q;
  }
});

async function loadWeeklyAdminNote() {
  const grade = document.getElementById('weekly-grade').value;
  const { data } = await readScoped(scoped => {
    let q = sb.from('weekly_admin_notes').select('note').eq('grade_level', grade).eq('week_number', currentWeek);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.maybeSingle();
  });
  document.getElementById('weekly-admin-note-text').value = data ? data.note : '';
  document.getElementById('weekly-admin-note-success').style.display = 'none';
  // الملاحظة تظهر تلقائيًا لو فيه ملاحظة محفوظة، وإلا تبقى خلف زر «ملاحظة الإدارة»
  document.getElementById('weekly-admin-note-card').classList.toggle('hidden', !(data && data.note));
  document.getElementById('wp-note-toggle').textContent = data && data.note ? 'ملاحظة الإدارة ✓' : 'ملاحظة الإدارة';
}

document.getElementById('weekly-admin-note-save').addEventListener('click', async () => {
  const grade = document.getElementById('weekly-grade').value;
  const note = document.getElementById('weekly-admin-note-text').value.trim();
  const successEl = document.getElementById('weekly-admin-note-success');

  if (!note) {
    let q = sb.from('weekly_admin_notes').delete().eq('grade_level', grade).eq('week_number', currentWeek);
    if (currentSchoolId) q = q.eq('school_id', currentSchoolId);
    await q;
    successEl.textContent = 'تم حذف الملاحظة (الحقل فارغ).';
  } else {
    await writeWithSchoolFallback(extra => sb.from('weekly_admin_notes').upsert(
      { grade_level: grade, week_number: currentWeek, note, created_by: currentUserId, ...extra },
      { onConflict: 'grade_level,week_number' }
    ));
    successEl.textContent = 'تم حفظ الملاحظة بنجاح.';
  }
  successEl.style.display = 'block';
});

document.getElementById('week-prev').addEventListener('click', () => { if (currentWeek > 1) { currentWeek--; loadWeeklyModule(); } });
document.getElementById('week-next').addEventListener('click', () => { if (currentWeek < 40) { currentWeek++; loadWeeklyModule(); } });
document.getElementById('weekly-grade').addEventListener('change', async () => {
  refreshWeeklyList();
  if (isAdminOrDeputy()) loadWeeklyAdminNote();
  if (currentProfile.role !== 'teacher') loadFormForCurrentSelection();
  const testWrap = document.getElementById('weekly-test-sections-wrap');
  if (!testWrap.classList.contains('hidden')) {
    await renderTestSectionsPicker(document.getElementById('weekly-test-sections-list'), document.getElementById('weekly-grade').value, null);
  }
});

document.getElementById('weekly-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('weekly-error');
  const lessons = collectLessonsFromEditor(document.getElementById('weekly-lessons-container'), currentSubjectName());
  if (lessons.length === 0) { errEl.textContent = 'اكتب درس واحد على الأقل'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const { data: userData } = await sb.auth.getUser();
  const hasTest = document.getElementById('weekly-has-test').checked;
  const noHomework = document.getElementById('weekly-no-homework').checked;
  const payload = {
    subject_id: document.getElementById('weekly-subject').value,
    grade_level: document.getElementById('weekly-grade').value,
    week_number: currentWeek,
    lessons: lessons,
    performance_tasks: document.getElementById('weekly-tasks').value.trim(),
    homework: noHomework ? '' : document.getElementById('weekly-homework').value.trim(),
    no_homework: noHomework,
    has_test: hasTest,
    test_sections: hasTest ? collectTestSections(document.getElementById('weekly-test-sections-list')) : null,
    test_note: hasTest ? document.getElementById('weekly-test-note').value.trim() : '',
    created_by: userData.user.id,
  };

  // تحديث إذا موجودة خطة لنفس المادة/المرحلة/الأسبوع، وإلا إضافة جديدة
  const { data: existing } = await readScoped(scoped => {
    let q = sb.from('weekly_plans').select('id')
      .eq('subject_id', payload.subject_id).eq('grade_level', payload.grade_level).eq('week_number', currentWeek);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.maybeSingle();
  });

  let error;
  if (existing) {
    ({ error } = await sb.from('weekly_plans').update(payload).eq('id', existing.id));
  } else {
    ({ error } = await writeWithSchoolFallback(extra => sb.from('weekly_plans').insert({ ...payload, ...extra })));
  }

  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('weekly-tasks').value = '';
  document.getElementById('weekly-homework').value = '';
  document.getElementById('weekly-no-homework').checked = false;
  toggleNoHomeworkUI(false);
  document.getElementById('weekly-has-test').checked = false;
  document.getElementById('weekly-test-sections-wrap').classList.add('hidden');
  document.getElementById('weekly-test-note').value = '';
  await loadFormForCurrentSelection();
  await refreshWeeklyList();

  const successEl = document.getElementById('weekly-submit-success');
  successEl.textContent = `تم إضافة الخطة بنجاح للأسبوع ${currentWeek}`;
  successEl.style.display = 'block';
  setTimeout(() => { successEl.style.display = 'none'; }, 3500);
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

async function refreshWeeklyList() {
  const grade = document.getElementById('weekly-grade').value;
  const { data: plans } = await readScoped(scoped => {
    let q = sb.from('weekly_plans')
      .select('id, subject_id, grade_level, lessons, performance_tasks, homework, no_homework, has_test, test_sections, test_note, subjects(name)')
      .eq('grade_level', grade).eq('week_number', currentWeek);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

  const list = document.getElementById('weekly-list');
  list.innerHTML = '';
  renderSubjectStatus(grade, plans || []);

  if (!plans || plans.length === 0) {
    list.innerHTML = `<div class="placeholder" style="padding:30px;"><p>لا توجد خطة مُدخلة لـ${gradeLabels[grade]} في الأسبوع ${currentWeek} بعد.</p></div>`;
    return;
  }

  const tableCard = document.createElement('div');
  tableCard.className = 'wp-table-card';
  const table = document.createElement('table');
  table.className = 'wp-table';
  tableCard.appendChild(table);
  list.appendChild(tableCard);

  plans.forEach(p => {
    const row = document.createElement('tr');
    renderPlanViewMode(row, p);
    table.appendChild(row);
  });
}

/* شريط حالة المواد: كل مادة مسندة لهذي المرحلة ✓ مسلّمة أو لسا - الضغط يفتح المادة بالنموذج */
let gradeAssignCache = null;
async function renderSubjectStatus(grade, plans) {
  const box = document.getElementById('wp-status');
  if (!box) return;
  let subjects;
  if (currentProfile.role === 'teacher') {
    subjects = teacherAssignments.filter(a => a.grade_level === grade).map(a => ({ id: a.subject_id, name: a.subjects ? a.subjects.name : '' }));
  } else {
    if (!gradeAssignCache) {
      const { data } = await readScoped(scoped => {
        let q = sb.from('teacher_subjects').select('subject_id, grade_level, subjects(name)');
        if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
        return q;
      });
      gradeAssignCache = data || [];
    }
    const m = new Map();
    gradeAssignCache.filter(a => a.grade_level === grade).forEach(a => { if (!m.has(a.subject_id)) m.set(a.subject_id, { id: a.subject_id, name: a.subjects ? a.subjects.name : '' }); });
    subjects = [...m.values()];
  }
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  if (!subjects.length) { box.innerHTML = ''; return; }
  const done = new Set(plans.map(p => p.subject_id));
  const n = subjects.filter(s => done.has(s.id)).length;
  const mine = currentProfile.role === 'teacher';
  box.innerHTML = `<div class="wp-status-head"><b>${mine ? 'موادي' : 'المواد'} في ${esc(gradeLabels[grade] || '')}</b><span class="wt-gcount ${n === subjects.length ? 'full' : ''}">${n} من ${subjects.length} مسلّمة</span></div>
    <div class="wt-chips">${subjects.map(s => `<button type="button" class="wt-chip ${done.has(s.id) ? 'ok' : 'miss'}" data-id="${s.id}"><b>${done.has(s.id) ? '✓ ' : ''}${esc(s.name)}</b><span>${done.has(s.id) ? 'مسلّمة · اضغط للتعديل' : 'لسا · اضغط للإدخال'}</span></button>`).join('')}</div>`;
  box.querySelectorAll('.wt-chip').forEach(b => b.addEventListener('click', () => {
    const sel = document.getElementById('weekly-subject');
    if (![...sel.options].some(o => o.value === b.dataset.id)) return;
    sel.value = b.dataset.id;
    sel.dispatchEvent(new Event('change'));
    document.getElementById('weekly-form-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
}

function renderPlanViewMode(row, p) {
  const testTag = p.has_test
    ? `<span class="wp-tag wp-tag-test">اختبار</span><div class="wp-topic-text">${esc(formatTestSections(p.test_sections))}</div>${p.test_note ? `<div class="wp-topic-text" style="color:var(--slate);">${esc(p.test_note)}</div>` : ''}`
    : '';
  const lessonsList = (p.lessons && p.lessons.length > 0) ? p.lessons : [];
  const lessonsHtml = lessonsList.length > 1
    ? '<ul style="margin:6px 0 0; padding-right:18px;">' + lessonsList.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>'
    : `<div class="wp-topic-text">${esc(lessonsList[0] || '-')}</div>`;
  const editBtnHtml = isAdminOrDeputy()
    ? `<button class="weekly-edit-btn" style="background:var(--sand); color:var(--ink);" data-id="${p.id}">تعديل</button>`
    : '';
  const deleteBtnHtml = isAdminOrDeputy()
    ? `<button class="weekly-delete-btn" style="background:var(--danger-light); color:var(--danger);" data-id="${p.id}">حذف</button>`
    : '';
  row.innerHTML = `
    <td class="wp-subj-cell">${esc(p.subjects ? p.subjects.name : '')}</td>
    <td>
      <span class="wp-tag wp-tag-lesson">درس</span>
      ${lessonsHtml}
      ${p.performance_tasks ? `<span class="wp-tag wp-tag-lesson" style="margin-top:10px; display:inline-block;">مهام أدائية</span><div class="wp-topic-text">${esc(p.performance_tasks)}</div>` : ''}
      ${p.no_homework
        ? `<div class="wp-no-hw">لا يوجد واجب هذا الأسبوع</div>`
        : (p.homework ? `<span class="wp-tag wp-tag-hw" style="margin-top:10px; display:inline-block;">واجب</span><div class="wp-topic-text">${esc(p.homework)}</div>` : '')}
      ${testTag}
      ${(editBtnHtml || deleteBtnHtml) ? `<div class="wp-row-actions">${editBtnHtml}${deleteBtnHtml}</div>` : ''}
    </td>`;

  const editBtn = row.querySelector('.weekly-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => renderPlanEditMode(row, p));

  const delBtn = row.querySelector('.weekly-delete-btn');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm(`متأكد تبي تحذف خطة "${p.subjects ? p.subjects.name : 'هذه المادة'}" لهذا الأسبوع؟`)) return;
      const { error } = await sb.from('weekly_plans').delete().eq('id', p.id);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      await refreshWeeklyList();
    });
  }
}

function renderPlanEditMode(card, p) {
  const lessonsList = (p.lessons && p.lessons.length > 0) ? p.lessons : [''];
  // card هنا صف جدول (tr) - المحتوى لازم يكون داخل td واحدة تمتد على العمودين عشان يبقى الجدول صالح
  card.innerHTML = `
    <td colspan="2">
    <h4 style="color:var(--meadow); margin:0 0 10px;">${esc(p.subjects ? p.subjects.name : '')} — تعديل (بواسطة الإدارة)</h4>
    <div class="edit-lessons-container"></div>
    <span class="text-action-btn edit-add-lesson-btn" style="display:inline-block; margin-bottom:14px;">+ إضافة درس</span>
    <textarea class="edit-tasks" rows="2" placeholder="المهام الأدائية">${p.performance_tasks || ''}</textarea>
    <textarea class="edit-homework" rows="2" placeholder="الواجبات" ${p.no_homework ? 'disabled' : ''}>${p.homework || ''}</textarea>
    <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--ink); margin-bottom:14px; cursor:pointer;">
      <input type="checkbox" class="edit-no-homework" ${p.no_homework ? 'checked' : ''} style="width:auto; margin:0;" />
      لا يوجد واجب هذا الأسبوع لهذه المادة
    </label>
    <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--ink); margin-bottom:10px; cursor:pointer;">
      <input type="checkbox" class="edit-has-test" ${p.has_test ? 'checked' : ''} style="width:auto; margin:0;" />
      يوجد اختبار هذا الأسبوع لهذه المادة
    </label>
    <div class="edit-test-sections-wrap ${p.has_test ? '' : 'hidden'}" style="background:var(--sand); border-radius:10px; padding:10px 12px; margin-bottom:14px;">
      <p style="font-size:12px; color:var(--slate); margin:0 0 8px;">حدد الفصول اللي عليها الاختبار. اتركها كلها فاضية = الاختبار على كل الفصول.</p>
      <div class="edit-test-sections-list" style="display:flex; flex-wrap:wrap; gap:12px;"></div>
      <textarea class="edit-test-note" placeholder="ملاحظة عن الاختبار (مثال: من صفحة ١٠ إلى ١٥ في الكتاب، أو من ورقة العمل المرفقة)" rows="2" style="margin:10px 0 0;">${p.test_note || ''}</textarea>
    </div>
    <div class="error-msg edit-error"></div>
    <button class="btn-primary edit-save-btn" style="width:auto; padding:10px 18px;">حفظ التعديل</button>
    <span class="text-action-btn edit-cancel-btn" style="margin-right:10px;">إلغاء</span>
    </td>`;

  const editHomeworkField = card.querySelector('.edit-homework');
  card.querySelector('.edit-no-homework').addEventListener('change', (e) => {
    editHomeworkField.disabled = e.target.checked;
    if (e.target.checked) editHomeworkField.value = '';
  });

  const testWrap = card.querySelector('.edit-test-sections-wrap');
  const testList = card.querySelector('.edit-test-sections-list');
  if (p.has_test) renderTestSectionsPicker(testList, p.grade_level, p.test_sections);
  card.querySelector('.edit-has-test').addEventListener('change', async (e) => {
    testWrap.classList.toggle('hidden', !e.target.checked);
    if (e.target.checked) await renderTestSectionsPicker(testList, p.grade_level, p.test_sections);
  });

  const lessonsContainer = card.querySelector('.edit-lessons-container');
  const editSubjectName = p.subjects ? p.subjects.name : '';
  buildLessonEditorUI({ container: lessonsContainer, addBtn: card.querySelector('.edit-add-lesson-btn'), subjectName: editSubjectName, lessons: lessonsList });

  card.querySelector('.edit-cancel-btn').addEventListener('click', () => renderPlanViewMode(card, p));
  card.querySelector('.edit-save-btn').addEventListener('click', async () => {
    const errEl = card.querySelector('.edit-error');
    const lessons = collectLessonsFromEditor(lessonsContainer, editSubjectName);
    if (lessons.length === 0) { errEl.textContent = 'اكتب درس واحد على الأقل'; errEl.style.display = 'block'; return; }

    const editHasTest = card.querySelector('.edit-has-test').checked;
    const editNoHomework = card.querySelector('.edit-no-homework').checked;
    const payload = {
      lessons,
      performance_tasks: card.querySelector('.edit-tasks').value.trim(),
      homework: editNoHomework ? '' : card.querySelector('.edit-homework').value.trim(),
      no_homework: editNoHomework,
      has_test: editHasTest,
      test_sections: editHasTest ? collectTestSections(testList) : null,
      test_note: editHasTest ? card.querySelector('.edit-test-note').value.trim() : '',
    };
    const { error } = await sb.from('weekly_plans').update(payload).eq('id', p.id);
    if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

    Object.assign(p, payload);
    renderPlanViewMode(card, p);
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
