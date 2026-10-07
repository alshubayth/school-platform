import { renderDashboard, renderWorkspacePage } from './dashboard.js';
/* باقي وحدات الأقسام تُحمَّل ديناميكيًا (import() عند الحاجة فقط) داخل openTile()
 * بدل تحميلها كلها مسبقًا عند فتح الصفحة - يقلل حجم التحميل الأولي بشكل كبير
 * لأن المستخدم غالبًا يفتح قسم أو قسمين بس بكل جلسة. */

export const SUPABASE_URL = 'https://sovfrlvcvcyjcyauurpl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jWUr3tDZL-Bg_Qjr-iH5bg_xSEipTmA';
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// يحوّل "رقم وظيفي" لإيميل داخلي وهمي (لو مافيه @، نعتبره رقم وظيفي)
export const STAFF_ID_DOMAIN = '@madrasa-almuruj.local';
export function toLoginEmail(value) {
  const v = (value || '').trim();
  return v.includes('@') ? v : v + STAFF_ID_DOMAIN;
}

export let currentProfile = null;
export let currentUserId = null;
export const roleLabels = { admin: 'مدير', deputy: 'وكيل', teacher: 'معلم', parent: 'ولي أمر' };
export const gradeLabels = { first_intermediate: 'أول متوسط', second_intermediate: 'ثاني متوسط', third_intermediate: 'ثالث متوسط' };
export let isOpPlanMember = false;
export function setOpPlanMember(v) { isOpPlanMember = v; }
// هل عند المعلم أي مهمة فعلية في متابعة الاختبارات (مسؤول مادة، أو ضمن فريق كنترول/تدقيق) بأي فترة اختبار؟
export let hasExamAssignment = false;
// صلاحية قسم "ميزانية المدرسة": null (بدون صلاحية) | 'full' | 'request_only' — مستقلة عن دور المستخدم العام
export let myBudgetAccess = null;
export function setMyBudgetAccess(v) { myBudgetAccess = v; }
// هل عند المعلم صلاحية ممنوحة من المدير/الوكيل لرؤية "متابعة الخطة الأسبوعية"؟ (المدير/الوكيل يشوفونه دائمًا بحكم دورهم)
export let hasWeeklyTrackingAccess = false;
export function setWeeklyTrackingAccess(v) { hasWeeklyTrackingAccess = v; }
export const isAdminOrDeputy = () => ['admin','deputy'].includes(currentProfile.role);
export const isStaff = () => ['admin','deputy','teacher'].includes(currentProfile.role);
export function setupCollapsible(toggleId, bodyId, chevronId) {
  const toggle = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  // لو أي عنصر من الثلاثة مو موجود بالصفحة (مثلًا نسخة index.html قديمة ما تحدّثت مع ملف الجافاسكربت)
  // نتجاهل الإعداد بهدوء بدل ما نرمي خطأ يوقف تحميل باقي الوحدة (module) كاملة ويسبب صفحة فاضية.
  if (!toggle || !body || !chevron) { console.warn('setupCollapsible: عنصر مفقود بالصفحة', { toggleId, bodyId, chevronId }); return; }
  toggle.addEventListener('click', () => {
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden');
    chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    const label = toggle.querySelector('span');
    label.textContent = label.textContent.replace(/^[+−]/, isHidden ? '−' : '+');
  });
}

const icons = {
  settings: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  home: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>',
  plan: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/></svg>',
  notes: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h13l3 3v13H4z"/><path d="M8 10h8M8 14h6"/></svg>',
  portal: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.5-4 5-5.5 7-5.5s5.5 1.5 7 5.5"/></svg>',
  perms: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  more: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>',
  weekly: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3M13 14h3M8 17.5h3"/></svg>',
  duty: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  exams: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  tracking: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  schedule: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18"/><path d="M7.5 14.5h2M7.5 17.5h2M12 14.5h2M12 17.5h2M16.5 14.5h1M16.5 17.5h1"/></svg>',
  followups: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="7" r="3.2"/><path d="M3.5 20c1.2-3.6 4-5.3 5.5-5.3s4.3 1.7 5.5 5.3"/><path d="M16 5h5M16 9h5M15 13.5h6M15 17.5h6"/></svg>',
  budget: '<div class="ic riyal-icon" style="width:18px; height:18px;"></div>',
  visits: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/><path d="M9 3h6v4H9z"/><path d="m14 9 6-6M17 3h3v3"/><path d="M7 13h6M7 17h4"/></svg>',
  substitutes: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/></svg>',
  computerlab: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  files: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
  examreports: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5"/><path d="M8 16.5h3l1.2 2.4 1.3-4.8 1 2.4h2"/></svg>',
  admintasks: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m8 14.5 2 2 4-4.5"/></svg>',
  contacts: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
};

// مساحات العمل: كل قسم ينتمي لمساحة وحدة، وترتيب الأقسام داخلها بحسب keys (القائمة الجانبية،
// بطاقات مساحات العمل بالرئيسية، ومسار التنقل أعلى كل قسم). "الرئيسية" مو منها - هي عنصر مستقل.
export const GROUPS = [
  { key: 'students', title: 'الطلاب', keys: ['weekly', 'schedule', 'followups'],
    icon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>' },
  { key: 'teachers', title: 'المعلمين', keys: ['notes', 'visits', 'achievements', 'weekly-tracking', 'duty', 'substitutes', 'portal'],
    icon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 3.9 1.6 4.5 4"/></svg>' },
  { key: 'exams', title: 'الاختبارات', keys: ['exams', 'tracking', 'exam-reports'],
    icon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>' },
  { key: 'admin', title: 'الإدارة', keys: ['plan', 'admin-tasks', 'budget', 'computerlab', 'schools-admin', 'more'],
    icon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 20V9"/></svg>' },
];

export const tiles = [
  { key: 'weekly', icon: icons.weekly, title: 'الخطة الأسبوعية',    desc: 'الدروس والمهام والواجبات لكل مرحلة', roles: ['admin','deputy','teacher','parent'], color: 'diamond-teal', group: 'students' },
  { key: 'schedule', icon: icons.schedule, title: 'الجدول الدراسي', desc: 'جدول الحصص لكل فصل',            roles: ['admin','deputy'], color: 'diamond-teal', group: 'admin' },
  { key: 'followups', icon: icons.followups, title: 'كشوف متابعة الطلاب', desc: 'ملاحظات وسلوك ودرجات مشاركة/اختبارات لكل فصل', roles: ['admin','deputy'], color: 'diamond-gold', group: 'students' },
  { key: 'weekly-tracking', icon: icons.weekly, title: 'متابعة الخطة الأسبوعية', desc: 'المواد الناقصة كل أسبوع',   roles: ['admin','deputy','teacher'], color: 'diamond-navy', group: 'teachers' },
  { key: 'plan',   icon: icons.plan,   title: 'الخطة التشغيلية',    desc: 'المهام الأسبوعية والمتابعة',   roles: ['admin','deputy','teacher'], color: 'diamond-gold', group: 'admin' },
  { key: 'notes',  icon: icons.notes,  title: 'متابعة أداء الموظفين', desc: 'ملاحظات ومؤشرات وتقييم',       roles: ['admin','deputy'], color: 'diamond-purple', group: 'teachers' },
  { key: 'portal', icon: icons.portal, title: 'بوابة الموظفين',      desc: 'بيانات وملفات الموظفين',       roles: ['admin','deputy'], color: 'diamond-purple', group: 'teachers' },
  { key: 'perms',  icon: icons.perms,  title: 'إدارة الصلاحيات',     desc: 'إضافة مستخدمين وأدوار',        roles: ['admin'], color: 'diamond-navy', group: 'admin' },
  { key: 'duty',   icon: icons.duty,   title: 'المناوبات اليومية',   desc: 'المناوبون وتسجيل الحضور',      roles: ['admin','deputy','teacher'], color: 'diamond-navy', group: 'teachers' },
  { key: 'exams',  icon: icons.exams,  title: 'الاختبارات',          desc: 'تسكين الطلاب والتوزيع على اللجان', roles: ['admin','deputy'], color: 'diamond-purple', group: 'students' },
  { key: 'tracking', icon: icons.tracking, title: 'متابعة الاختبارات', desc: 'سير ورقة الإجابة وغياب الطلاب أثناء الاختبارات', roles: ['admin','deputy','teacher'], color: 'diamond-navy', group: 'students' },
  { key: 'exam-reports', icon: icons.examreports, title: 'تقارير الاختبارات', desc: 'تحليل نتائج الاختبارات وبنودها', roles: ['admin','deputy','teacher'], color: 'diamond-purple', group: 'students' },
  { key: 'budget', icon: icons.budget, title: 'ميزانية المدرسة',     desc: 'الإيرادات والمصروفات وطلبات الصرف', roles: ['admin','deputy','teacher'], color: 'diamond-green', group: 'admin' },
  { key: 'achievements', icon: icons.files, title: 'ملفات الإنجاز', desc: 'اكتمال ملفات إنجاز المعلمين في ون درايف', roles: ['admin','deputy','teacher'], color: 'diamond-gold', group: 'teachers' },
  { key: 'visits', icon: icons.visits, title: 'الزيارات الصفية',     desc: 'زيارة حصص المعلمين وتقييمها',   roles: ['admin','deputy','teacher'], color: 'diamond-teal', group: 'teachers' },
  { key: 'substitutes', icon: icons.substitutes, title: 'جدول اليوم والبدلاء', desc: 'الغياب والاستئذان وتحريك الحصص والبدلاء', roles: ['admin','deputy','teacher'], color: 'diamond-gold', group: 'teachers' },
  { key: 'computerlab', icon: icons.computerlab, title: 'معمل الحاسب الآلي', desc: 'توزيع الطلاب على أجهزة المعمل وطباعة الملصقات', roles: ['admin','deputy'], color: 'diamond-teal', group: 'extra' },
  { key: 'more',   icon: icons.more,   title: 'إضافة قسم جديد',      desc: 'خدمات مستقبلية',               roles: ['admin'], color: 'diamond-gold', group: 'extra' },
  { key: 'schools-admin', icon: icons.perms, title: 'إدارة المدارس والخدمات', desc: 'إضافة مدرسة جديدة وتفعيل خدماتها', roles: ['owner'], color: 'diamond-navy', group: 'admin' },
  { key: 'admin-tasks', icon: icons.admintasks, title: 'المهام الإدارية', desc: 'مهام كل أسبوع ومسؤول تنفيذها وحالتها', roles: ['admin','deputy'], color: 'diamond-purple', group: 'admin' },
  { key: 'school-contacts', icon: icons.contacts, title: 'بيانات التواصل', desc: 'أرقام تواصل المدرسة اللي تظهر لولي الأمر', roles: ['admin','deputy'], color: 'diamond-green', group: 'admin' },
  { key: 'settings', icon: icons.settings, title: 'الإعدادات', desc: 'بيانات المدرسة والطلاب والتقويم والحسابات', roles: ['admin','deputy'], color: 'diamond-navy' },
];
// مساحة العمل لكل قسم تُستمد من GROUPS (مصدر واحد للترتيب والتجميع)
tiles.forEach(t => { const g = GROUPS.find(x => x.keys.includes(t.key)); t.group = g ? g.key : (t.key === 'settings' ? null : 'admin'); });
export function groupTilesFor(groupKey) {
  const g = GROUPS.find(x => x.key === groupKey);
  return g ? g.keys.map(k => tiles.find(t => t.key === k)).filter(t => t && isTileAllowed(t)) : [];
}
export function tileTitle(t) { if (t.key === 'substitutes' && currentProfile && currentProfile.role === 'teacher') return 'جدول يومي'; return t.key === 'budget' ? budgetTileTitle() : t.title; }
export function tileDesc(t) { if (t.key === 'substitutes' && currentProfile && currentProfile.role === 'teacher') return 'حصصي اليوم وحصص الإشغال'; if (t.key === 'exam-reports' && currentProfile && currentProfile.role === 'teacher') return 'تصحيح أوراق الإجابة بالجوال وتقاريرها'; return t.key === 'budget' ? budgetTileDesc() : t.desc; }

/* شاشة الدخول: تاريخ اليوم بالهجري والميلادي + إظهار كلمة المرور + الدخول بزر Enter */
(function initLoginExtras() {
  const today = document.getElementById('lg-today');
  if (today) {
    const d = new Date();
    try {
      const day = d.toLocaleDateString('ar-SA-u-nu-latn', { weekday: 'long' });
      const hij = d.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
      const greg = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
      today.innerHTML = `<b>${day}</b><span>${hij}</span><span>${greg}</span>`;
    } catch (e) { today.remove(); }
  }
  const eye = document.getElementById('lg-eye');
  const pass = document.getElementById('login-password');
  if (eye && pass) eye.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    pass.focus();
  });
  const form = document.getElementById('login-card');
  if (form && form.tagName === 'FORM') form.addEventListener('submit', (e) => e.preventDefault());
})();

document.getElementById('login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('login-btn');
  if (btn.disabled) return;
  const rawInput = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!rawInput || !password) {
    errEl.textContent = 'أدخل البريد الإلكتروني أو الرقم الوظيفي وكلمة المرور';
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true; btn.textContent = 'جارٍ الدخول...';
  const { data, error } = await sb.auth.signInWithPassword({ email: toLoginEmail(rawInput), password });
  btn.disabled = false; btn.textContent = 'دخول';
  if (error) {
    errEl.textContent = 'البريد أو الرقم الوظيفي أو كلمة المرور غير صحيحة';
    errEl.style.display = 'block';
    return;
  }
  await loadProfileAndShowDashboard(data.user.id);
});

/* ===== تغيير كلمة المرور من شاشة تسجيل الدخول ===== */
document.getElementById('show-reset-link').addEventListener('click', () => {
  document.getElementById('login-card').classList.add('hidden');
  document.getElementById('reset-password-card').classList.remove('hidden');
  document.getElementById('reset-error').style.display = 'none';
  document.getElementById('reset-success').style.display = 'none';
  document.getElementById('reset-email').value = document.getElementById('login-email').value;
  document.getElementById('reset-old-password').value = '';
  document.getElementById('reset-new-password').value = '';
  document.getElementById('reset-new-password-confirm').value = '';
});
document.getElementById('hide-reset-link').addEventListener('click', () => {
  document.getElementById('reset-password-card').classList.add('hidden');
  document.getElementById('login-card').classList.remove('hidden');
});

document.getElementById('reset-submit-btn').addEventListener('click', async () => {
  const rawInput = document.getElementById('reset-email').value.trim();
  const oldPassword = document.getElementById('reset-old-password').value;
  const newPassword = document.getElementById('reset-new-password').value;
  const newPasswordConfirm = document.getElementById('reset-new-password-confirm').value;
  const errEl = document.getElementById('reset-error');
  const successEl = document.getElementById('reset-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!rawInput || !oldPassword || !newPassword || !newPasswordConfirm) {
    errEl.textContent = 'عبّي كل الحقول أولاً';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword.length < 6) {
    errEl.textContent = 'كلمة المرور الجديدة لازم تكون 6 أحرف على الأقل';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword !== newPasswordConfirm) {
    errEl.textContent = 'كلمة المرور الجديدة وتأكيدها غير متطابقين';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword === oldPassword) {
    errEl.textContent = 'كلمة المرور الجديدة لازم تختلف عن الحالية';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('reset-submit-btn');
  btn.disabled = true;
  btn.textContent = 'جاري التحقق...';

  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({ email: toLoginEmail(rawInput), password: oldPassword });
  if (signInError) {
    errEl.textContent = 'كلمة المرور الحالية أو البريد/الرقم الوظيفي غير صحيح';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'تغيير كلمة المرور';
    return;
  }

  const { error: updateError } = await sb.auth.updateUser({ password: newPassword });
  btn.disabled = false;
  btn.textContent = 'تغيير كلمة المرور';
  if (updateError) {
    errEl.textContent = 'تعذر تغيير كلمة المرور: ' + updateError.message;
    errEl.style.display = 'block';
    return;
  }

  successEl.textContent = 'تم تغيير كلمة المرور بنجاح، جاري الدخول...';
  successEl.style.display = 'block';
  setTimeout(async () => {
    document.getElementById('reset-password-card').classList.add('hidden');
    document.getElementById('login-card').classList.remove('hidden');
    await loadProfileAndShowDashboard(signInData.user.id);
  }, 1200);
});

/* ===== المرحلة الأولى من دعم تعدد المدارس (Multi-tenant) =====
 * حساب دوره "owner" (مالك) ما يرتبط بمدرسة معينة - يشوف شاشة اختيار مدرسة، ويفتح لوحة تحكم
 * المدرسة اللي يختارها (بصلاحيات "مدير" بالتبويبات). كل مدرسة عندها قائمة خدمات مفعّلة
 * بجدول school_modules، فتختفي تبويبات الخدمات الغير مشترك فيها المدرسة تلقائيًا.
 * ملاحظة مهمة: هذي المرحلة توفر التنقل بين المدارس وتفعيل/تعطيل الخدمات بس - بيانات كل قسم
 * (الطلاب، الاختبارات، الميزانية...) لسا غير معزولة فعليًا بين المدارس (يحتاج مرحلة ثانية منفصلة). */
export let currentSchoolId = null;
export let currentSchoolModules = null; // null = بدون قيد (توافق خلفي لحساب مربوط بمدرسة وحدة أو قبل تنفيذ SQL الترقية)
// الدور الحقيقي المخزّن بقاعدة البيانات - يبقى true دايمًا لحساب "المالك" حتى بعد ما ندخل مدرسة
// (نغيّر currentProfile.role إلى 'admin' عشان كل شاشات المنصة تعامله كمدير كامل الصلاحيات داخل
// المدرسة اللي دخلها - بدون هذا العلم كنا بنفقد التمييز عن "مدير" حقيقي بمكانين محددين بس:
// تبويب "إدارة المدارس والخدمات" وزر "تبديل المدرسة")
export let isOwnerAccount = false;

/* ===== هوية المدرسة (الاسم والشعارات) =====
 * كل مدرسة لها هويتها بعمود schools.branding: الاسم المختصر، شعار المدرسة، والجهة التابعة لها
 * (الهيئة الملكية أو جهة ثانية بشعارها أو بدون). المطبوعات والشريط العلوي تاخذ منها بدل الأسماء الثابتة.
 * قبل الدخول ما نعرف المدرسة، فنعرض اسم المنصة نفسها. */
export const PLATFORM_NAME = 'مُدار';
// رقم إصدار للملفات اللي تنحمّل لاحقًا - غيّره مع كل تحديث عشان المتصفح ما يستخدم نسخة قديمة
export const ASSET_VERSION = '2026-10-07b';
export const RC_AUTHORITY_NAME = 'الهيئة الملكية للجبيل وينبع';
const RC_LOGO_URL = new URL('logo-rc.png', window.location.href).href;
export let schoolBrand = { id: null, slug: null, name: '', principal: '', short: PLATFORM_NAME, logo: null, authority: 'none', authorityName: '', authorityLogo: null, raw: {}, hasColumn: false };

function brandFromRow(s) {
  const hasColumn = !!(s && Object.prototype.hasOwnProperty.call(s, 'branding'));
  const b = (s && s.branding) || {};
  // قبل تشغيل ملف SQL الهوية (العمود غير موجود) نحافظ على السلوك القديم: شعار الهيئة الملكية
  const authority = b.authority || (hasColumn ? 'none' : 'rc');
  return {
    id: s ? s.id : null, slug: s ? s.slug : null, raw: b, hasColumn,
    name: (s && s.name) || '',
    // اسم مدير المدرسة (توقيع سند الصرف) - قبل ملف SQL الهوية نحافظ على الاسم السابق
    principal: b.principal_name || (hasColumn ? '' : 'منيف بن محمد النفيعي'),
    short: b.short_name || (s && s.name) || PLATFORM_NAME,
    logo: b.school_logo || null,
    authority,
    authorityName: authority === 'rc' ? RC_AUTHORITY_NAME : authority === 'custom' ? (b.authority_name || '') : '',
    authorityLogo: authority === 'rc' ? RC_LOGO_URL : authority === 'custom' ? (b.authority_logo || null) : null,
  };
}

export async function loadSchoolBrand() {
  let row = null;
  if (currentSchoolId) {
    let r = await sb.from('schools').select('id, name, slug, branding').eq('id', currentSchoolId).maybeSingle();
    if (r.error) r = await sb.from('schools').select('id, name, slug').eq('id', currentSchoolId).maybeSingle();
    row = r.data || null;
  }
  schoolBrand = brandFromRow(row);
  applyBrandToShell();
  return schoolBrand;
}
export function setSchoolBrandFromRow(row) { schoolBrand = brandFromRow(row); applyBrandToShell(); }

export function applyBrandToShell() {
  const img = document.querySelector('#tn-brand img');
  const span = document.querySelector('#tn-brand span');
  // الشريط العلوي كحلي: شعار المنصة الأبيض، وشعار المدرسة (لو مرفوع) داخل خلفية بيضاء صغيرة
  if (img) {
    img.src = schoolBrand.logo || 'mark-white.svg';
    img.classList.toggle('on-chip', !!schoolBrand.logo);
    img.alt = schoolBrand.logo ? 'شعار ' + (schoolBrand.name || schoolBrand.short) : PLATFORM_NAME;
  }
  if (span) span.textContent = schoolBrand.short;
  document.title = pageTitle(lastPageTitle);
  // التطبيق المثبّت يحمل اسم المدرسة تحت الأيقونة (ملف التطبيق يتولّد حسب المدرسة)
  if (schoolBrand.slug) {
    const mf = document.getElementById('app-manifest');
    if (mf) mf.href = '/api/manifest?app=staff&school=' + encodeURIComponent(schoolBrand.slug);
    const at = document.getElementById('apple-title');
    if (at) at.setAttribute('content', schoolBrand.short || PLATFORM_NAME);
    const il = document.getElementById('um-install-link');
    if (il) il.href = 'install.html?school=' + encodeURIComponent(schoolBrand.slug);
  }
}
// عنوان تبويب المتصفح: الصفحة الحالية - اسم المدرسة المختصر (أو اسم المنصة)
let lastPageTitle = '';
export function pageTitle(page) {
  lastPageTitle = page || '';
  const tail = schoolBrand.short || PLATFORM_NAME;
  return lastPageTitle ? `${lastPageTitle} - ${tail}` : tail;
}
// اسم المدرسة بالمطبوعات، وشعار ترويستها (شعار الجهة التابعة لها، وإلا شعار المدرسة، وإلا بدون)
export function printOrgName() { return schoolBrand.name || schoolBrand.short || ''; }
export function printLogo() { return schoolBrand.authorityLogo || schoolBrand.logo || null; }

export function effectiveRoleForTiles() {
  return currentProfile.role === 'owner' ? 'admin' : currentProfile.role;
}

export async function loadSchoolModulesForCurrent() {
  if (!currentSchoolId) { currentSchoolModules = null; return; }
  const { data, error } = await sb.from('school_modules').select('module_key, enabled').eq('school_id', currentSchoolId);
  currentSchoolModules = (error || !data) ? null : data.filter(r => r.enabled).map(r => r.module_key);
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

async function showSchoolPicker() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('school-picker-screen').classList.remove('hidden');
  const list = document.getElementById('school-picker-list');
  list.innerHTML = '<p style="text-align:center; color:var(--slate); grid-column:1/-1;">جارٍ التحميل...</p>';

  const { data: schools, error } = await sb.from('schools').select('id, name').order('name');
  if (error) {
    list.innerHTML = `<p style="color:var(--danger); text-align:center; grid-column:1/-1;">تعذر تحميل قائمة المدارس: ${escHtml(error.message)}</p>`;
    return;
  }
  if (!schools || !schools.length) {
    list.innerHTML = '<p style="text-align:center; color:var(--slate); grid-column:1/-1;">ما فيه أي مدرسة مضافة بعد.</p>';
    return;
  }
  list.innerHTML = schools.map(s => `
    <div class="form-card school-picker-card" data-id="${s.id}" style="text-align:center; cursor:pointer; margin:0;">
      <div style="font-weight:700; font-size:14px; margin-bottom:10px;">${escHtml(s.name)}</div>
      <button type="button" class="btn-primary" style="width:auto; padding:8px 20px; pointer-events:none;">دخول</button>
    </div>`).join('');
  list.querySelectorAll('.school-picker-card').forEach(card => {
    card.addEventListener('click', () => enterSchool(card.dataset.id, schools.find(s => s.id === card.dataset.id)));
  });
}

async function enterSchool(schoolId, school) {
  currentSchoolId = schoolId;
  await loadSchoolModulesForCurrent();
  // المالك يشتغل داخل المدرسة اللي دخلها بكل صلاحيات "مدير" (isAdminOrDeputy/isStaff وكل الفحوصات
  // المشابهة بباقي الأقسام تتحقق من currentProfile.role مباشرة) - isOwnerAccount يبقى العلم الوحيد
  // اللي يميّزه كمالك حقيقي لتبويب "إدارة المدارس والخدمات" وزر "تبديل المدرسة" بس
  currentProfile = { ...currentProfile, role: 'admin' };
  document.getElementById('school-picker-screen').classList.add('hidden');
  await Promise.all([loadAcademicCalendar(), loadSchoolBrand()]);
  finishShowingDashboard(school ? school.name : null);
  const { renderMyDutyBanner } = await import('./duty-roster.js');
  renderMyDutyBanner();
}

document.getElementById('school-picker-logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
document.getElementById('switch-school-btn').addEventListener('click', () => { showSchoolPicker(); });

function finishShowingDashboard(schoolNameOverride) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('school-picker-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentProfile.full_name;
  document.getElementById('user-role-badge').textContent = isOwnerAccount ? 'مالك النظام' : (roleLabels[currentProfile.role] || currentProfile.role);
  document.getElementById('user-avatar').textContent = (currentProfile.full_name || '؟').trim().charAt(0);
  document.getElementById('switch-school-btn').classList.toggle('hidden', !isOwnerAccount);
  applyBrandToShell();
  const gear = document.getElementById('settings-open-btn');
  const st = tiles.find(x => x.key === 'settings');
  gear.classList.toggle('hidden', !(st && isTileAllowed(st)));
  renderNav();
  renderDashboard();
  import('./search.js').then(m => m.initGlobalSearch()).catch(err => console.warn('search init failed', err));
  import('./notices.js?v=' + ASSET_VERSION).then(m => m.initNotices()).catch(err => console.warn('notices init failed', err));
  routeFromHash(true);
}

export async function loadProfileAndShowDashboard(userId) {
  // نحاول نجيب school_id واسم المدرسة (موجودين بس بعد تنفيذ SQL ترقية تعدد المدارس) - ولو فشل
  // (عمود/جدول لسا ما انضاف) نرجع تلقائيًا لنفس الاستعلام القديم عشان تسجيل الدخول يستمر يشتغل عادي
  let profile, error;
  ({ data: profile, error } = await sb.from('profiles').select('full_name, role, school_id, schools(name)').eq('id', userId).single());
  if (error) {
    ({ data: profile, error } = await sb.from('profiles').select('full_name, role').eq('id', userId).single());
  }
  if (error || !profile) {
    document.getElementById('login-error').textContent = 'تم الدخول لكن حسابك غير مربوط بدور بعد.';
    document.getElementById('login-error').style.display = 'block';
    return;
  }
  currentProfile = profile;
  currentUserId = userId;
  isOwnerAccount = profile.role === 'owner';

  if (profile.role === 'owner') {
    await showSchoolPicker();
    return;
  }

  currentSchoolId = profile.school_id || null;
  await loadSchoolModulesForCurrent();

  if (profile.role === 'teacher') {
    const { data: membership } = await sb.from('operational_plan_members').select('id').eq('profile_id', userId).maybeSingle();
    isOpPlanMember = !!membership;

    const [{ data: subjectAssign }, { data: teamAssign }] = await Promise.all([
      sb.from('exam_subject_assignments').select('id').eq('responsible_teacher_id', userId).limit(1),
      sb.from('exam_period_teams').select('member_id').eq('member_id', userId).limit(1),
    ]);
    hasExamAssignment = !!(subjectAssign && subjectAssign.length) || !!(teamAssign && teamAssign.length);

    const { data: wtPerm } = await sb.from('weekly_tracking_permissions').select('id').eq('profile_id', userId).maybeSingle();
    hasWeeklyTrackingAccess = !!wtPerm;
  }

  if (profile.role !== 'admin' && profile.role !== 'parent') {
    const { data: budgetPerm } = await sb.from('budget_permissions').select('level').eq('profile_id', userId).maybeSingle();
    myBudgetAccess = budgetPerm ? budgetPerm.level : null;
  }

  await Promise.all([loadAcademicCalendar(), loadSchoolBrand()]);
  finishShowingDashboard(profile.schools ? profile.schools.name : null);
  const { renderMyDutyBanner } = await import('./duty-roster.js');
  renderMyDutyBanner();
}

document.getElementById('logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

sb.auth.getSession().then(({ data }) => { if (data.session) loadProfileAndShowDashboard(data.session.user.id); });

/* ===== أدوات مشتركة لعزل بيانات كل مدرسة (المرحلة الثانية) =====
 * تُستخدم بكل الملفات اللي تحتاج تفلتر قراءة/كتابة جدول بعمود school_id، مع نفس منطق التوافق
 * الخلفي: لو الفلترة فشلت (عمود school_id لسا ما انضاف بقاعدة البيانات) نعيد المحاولة بدونها
 * عشان القسم يستمر يشتغل بمدرسة وحدة قبل تنفيذ SQL الترقية. */
export async function readScopedBySchool(factory) {
  let res = await factory(true);
  if (res.error && currentSchoolId) res = await factory(false);
  return res;
}
/* upsert بمفتاح تعارض يشمل المدرسة (عشان مدرستين ما تتصادم بياناتهم)، ولو قاعدة البيانات لسا على
 * القيد القديم (sql/school_unique_keys.sql ما نُفذ) نرجع للمفتاح القديم بدل ما يفشل الحفظ */
export async function upsertSchoolKey(run, newKey, oldKey) {
  const res = await run(newKey);
  const msg = (res.error && res.error.message) || '';
  if (res.error && (res.error.code === '42P10' || /no unique or exclusion constraint/i.test(msg))) return run(oldKey);
  return res;
}
export const conflictOpt = key => (key ? { onConflict: key } : undefined);

export async function writeWithSchool(factory) {
  const extra = currentSchoolId ? { school_id: currentSchoolId } : {};
  let res = await factory(extra);
  if (res.error && currentSchoolId) res = await factory({});
  return res;
}

/* ===== التقويم الدراسي: ترقيم أسابيع الخطة حسب التاريخ =====
 * الأسبوع الأول يبدأ يوم الأحد المحدد (start)، وأسابيع الإجازة (breaks: تواريخ آحادها) ما تنحسب.
 * يُحفظ بجدول school_settings (المفتاح academic_calendar)؛ لو الجدول أو الإعداد غير موجود نستخدم
 * الافتراضي: بداية العام الدراسي ١٤٤٨هـ يوم الأحد ٢٣ أغسطس ٢٠٢٦. */
export const DEFAULT_ACADEMIC_START = '2026-08-23';
// noPlanWeeks: أسابيع دراسة ما فيها خطة أسبوعية (مثل الأسبوع الأول) - ما تنحسب كخطط ناقصة
export let academicCalendar = { start: DEFAULT_ACADEMIC_START, breaks: [], noPlanWeeks: [1], saved: false };
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export function sundayOf(date = new Date()) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - d.getDay()); return d; }

export async function loadAcademicCalendar() {
  try {
    const { data, error } = await readScopedBySchool(sc => {
      let q = sb.from('school_settings').select('value').eq('key', 'academic_calendar');
      if (sc && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.maybeSingle();
    });
    if (!error && data && data.value && data.value.start) {
      academicCalendar = { start: data.value.start, breaks: Array.isArray(data.value.breaks) ? data.value.breaks : [],
        noPlanWeeks: Array.isArray(data.value.noPlanWeeks) ? data.value.noPlanWeeks : [1], saved: true };
    }
  } catch (e) { /* نبقى على الافتراضي */ }
  return academicCalendar;
}
export async function saveAcademicCalendar(start, breaks, noPlanWeeks = academicCalendar.noPlanWeeks || []) {
  const value = { start, breaks: [...new Set(breaks)].sort(), noPlanWeeks: [...new Set(noPlanWeeks.map(Number))].filter(n => n >= 1 && n <= 40).sort((a, b) => a - b) };
  const res = await writeWithSchool(extra => sb.from('school_settings').upsert(
    { key: 'academic_calendar', value, updated_at: new Date().toISOString(), ...extra },
    { onConflict: 'school_id,key' }));
  if (!res.error) academicCalendar = { ...value, saved: true };
  return res;
}
// يرجّع { current: رقم أسبوع الدراسة الحالي أو null لو إجازة/قبل بداية العام، next: رقم الأسبوع القادم، isBreak }
export function academicWeekInfo(date = new Date()) {
  const start = parseIso(academicCalendar.start);
  const sun = sundayOf(date);
  const breaks = new Set(academicCalendar.breaks || []);
  if (sun < start) return { current: null, next: 1, isBreak: false, beforeStart: true };
  let n = 0;
  for (let d = new Date(start); d <= sun; d.setDate(d.getDate() + 7)) if (!breaks.has(isoDate(d))) n++;
  const isBreak = breaks.has(isoDate(sun));
  return { current: isBreak ? null : n, next: n + 1, isBreak, beforeStart: false };
}
// تاريخ الأحد اللي يبدأ فيه أسبوع الدراسة رقم k (بتخطي أسابيع الإجازة)
export function studyWeekStart(k) {
  const breaks = new Set(academicCalendar.breaks || []);
  const d = parseIso(academicCalendar.start);
  let n = 0;
  for (let guard = 0; guard < 80; guard++, d.setDate(d.getDate() + 7)) {
    if (breaks.has(isoDate(d))) continue;
    if (++n === k) return new Date(d);
  }
  return null;
}
export function isNoPlanWeek(k) { return (academicCalendar.noPlanWeeks || []).includes(Number(k)); }
export function weekLabel(k, withDate = true) {
  const info = academicWeekInfo();
  const tag = k === info.current ? ' (الحالي)' : k === info.next ? ' (القادم)' : '';
  const ds = studyWeekStart(k);
  const dateTxt = withDate && ds ? ` · يبدأ ${ds.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })}` : '';
  return `الأسبوع ${k}${tag}${dateTxt}`;
}
export { isoDate as toIsoDate };

export function isTileAllowed(t) {
  // تبويب "إدارة المدارس والخدمات" خاص بالدور الحقيقي "owner" بس (بدون تحويله لـ"admin")
  if (t.key === 'schools-admin') return isOwnerAccount;
  const role = effectiveRoleForTiles();
  if (!t.roles.includes(role)) return false;
  if (t.key === 'plan' && role === 'teacher' && !isOpPlanMember) return false;
  if (t.key === 'tracking' && role === 'teacher' && !hasExamAssignment) return false;
  if (t.key === 'weekly-tracking' && role === 'teacher' && !hasWeeklyTrackingAccess) return false;
  // فلترة حسب الخدمات المفعّلة لهذي المدرسة (المرحلة الأولى من دعم تعدد المدارس) - لو ما فيه
  // قائمة خدمات محمّلة (توافق خلفي، أو قبل تنفيذ SQL الترقية) نسمح بعرض كل شي زي ما هو
  // الإعدادات أساسية لكل مدرسة، ما تنطفي من قائمة الخدمات
  if (t.key !== 'settings' && Array.isArray(currentSchoolModules) && !currentSchoolModules.includes(t.key)) return false;
  return true;
}

// ميزانية المدرسة/طلب صرف فاتورة: العنوان يختلف حسب الصلاحية - المدير وصاحب الصلاحية "الكاملة" يشوفون
// "ميزانية المدرسة" (اللوحة الكاملة)، وباقي الموظفين يشوفون "طلب صرف فاتورة" (نموذج تقديم طلب باسمهم فقط)
export function budgetTileTitle() {
  const isFullBudget = currentProfile.role === 'admin' || myBudgetAccess === 'full';
  return isFullBudget ? 'ميزانية المدرسة' : 'طلب صرف فاتورة';
}
export function budgetTileDesc() {
  const isFullBudget = currentProfile.role === 'admin' || myBudgetAccess === 'full';
  return isFullBudget ? 'الإيرادات والمصروفات وطلبات الصرف' : 'تقديم طلب صرف فاتورة باسمك';
}

/* ===== الشريط العلوي: الرئيسية + أزرار مساحات العمل (اتجاه «مساحات العمل») ===== */
export function renderNav(){
  const nav = document.getElementById('nav-list');
  let html = `<a href="#/" class="tn-pill" data-nav="home">الرئيسية</a>`;
  GROUPS.forEach(g => {
    if (!groupTilesFor(g.key).length) return;
    html += `<a href="#/ws/${g.key}" class="tn-pill" data-nav="ws/${g.key}">${g.title}</a>`;
  });
  nav.innerHTML = html;
  nav.querySelectorAll('.tn-pill').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const k = el.dataset.nav;
      if (k === 'home') backToTiles(); else openWorkspace(k.slice(3));
    });
  });
  setActiveNavByKey(activeRouteKey || 'home');
}
export function setActiveNav(el){ if (el && el.dataset && el.dataset.key) setActiveNavByKey(el.dataset.key); }
// الزر النشط: الرئيسية، أو مساحة العمل نفسها، أو مساحة العمل اللي ينتمي لها القسم المفتوح
export function setActiveNavByKey(key){
  let navKey = 'home';
  if (key && key.startsWith('ws/')) navKey = key;
  else if (key && key !== 'home') { const t = tiles.find(x => x.key === key); navKey = t && t.group ? 'ws/' + t.group : 'none'; }
  document.querySelectorAll('#nav-list .tn-pill').forEach(n => {
    const on = n.dataset.nav === navKey;
    n.classList.toggle('active', on);
    if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  const act = document.querySelector('#nav-list .tn-pill.active');
  if (act && act.scrollIntoView && window.innerWidth < 900) act.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/* ===== روابط الأقسام (#/exams ، #/ws/exams ...) - التحديث يرجعك لنفس الصفحة، وزر الرجوع بالمتصفح يشتغل ===== */
let activeRouteKey = 'home';
let routingFromHistory = false;
function routeKeyFromHash() {
  const m = (location.hash || '').match(/^#\/([\w\/-]*)/);
  return m && m[1] ? m[1].replace(/\/+$/, '') : 'home';
}
function pushRoute(key) {
  activeRouteKey = key;
  if (routingFromHistory) return;
  const h = key === 'home' ? '#/' : '#/' + key;
  if (location.hash !== h) history.pushState({ key }, '', h);
}
function routeFromHash(initial = false) {
  const key = routeKeyFromHash();
  const wsKey = key.startsWith('ws/') ? key.slice(3) : null;
  // مسار فرعي داخل قسم: #/exams/<id> ← القسم exams مع sub=<id>
  const [base, ...rest] = wsKey ? [key] : key.split('/');
  const sub = rest.join('/') || null;
  const t = wsKey ? null : tiles.find(x => x.key === base);
  const wsOk = wsKey && groupTilesFor(wsKey).length > 0;
  routingFromHistory = true;
  try {
    if (t && isTileAllowed(t)) openTile(base, tileTitle(t), sub);
    else if (wsOk) openWorkspace(wsKey);
    else if (!initial || key !== 'home') { if (key !== 'home') history.replaceState({ key: 'home' }, '', '#/'); if (!initial) backToTiles(); }
  } finally { routingFromHistory = false; }
  if (!(t && isTileAllowed(t)) && !wsOk) { activeRouteKey = 'home'; setActiveNavByKey('home'); }
}
// الأقسام تستخدمها لتحديث المسار الفرعي (مثلاً فتح فترة اختبار) بدون إعادة فتح القسم
export function setSubRoute(sub, replace = false) {
  if (routingFromHistory) return;
  const base = String(activeRouteKey || 'home').split('/')[0];
  if (base === 'home' || base === 'ws') return;
  const key = sub ? base + '/' + sub : base;
  activeRouteKey = key;
  const h = '#/' + key;
  if (location.hash === h) return;
  if (replace) history.replaceState({ key }, '', h); else history.pushState({ key }, '', h);
}
window.addEventListener('popstate', () => { if (currentProfile && !document.getElementById('dashboard-screen').classList.contains('hidden')) routeFromHash(false); });

/* ===== صفحة مساحة العمل: أقسامها كبطاقات + سطر حالة ===== */
export function openWorkspace(groupKey) {
  const g = GROUPS.find(x => x.key === groupKey);
  if (!g || !groupTilesFor(groupKey).length) { backToTiles(); return; }
  hideAllModules();
  document.getElementById('module-header').classList.add('hidden');
  pushRoute('ws/' + groupKey);
  setActiveNavByKey('ws/' + groupKey);
  document.title = pageTitle(g.title);
  window.scrollTo(0, 0);
  const view = document.getElementById('ws-view');
  view.classList.remove('hidden');
  renderWorkspacePage(groupKey, view);
}

/* ===== قائمة الحساب (الاسم، تبديل المدرسة، الخروج) ===== */
function closeUserMenu() {
  document.getElementById('user-menu').classList.add('hidden');
  document.getElementById('user-menu-btn').setAttribute('aria-expanded', 'false');
}
document.getElementById('settings-open-btn').addEventListener('click', () => { closeUserMenu(); openTile('settings'); });
document.getElementById('user-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = document.getElementById('user-menu');
  const open = m.classList.toggle('hidden') === false;
  document.getElementById('user-menu-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', (e) => { if (!e.target.closest('.tn-user')) closeUserMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUserMenu(); });
document.getElementById('tn-brand').addEventListener('click', (e) => { e.preventDefault(); backToTiles(); });

export function hideAllModules() {
  document.getElementById('tiles-view').classList.add('hidden');
  document.getElementById('ws-view').classList.add('hidden');
  document.getElementById('notes-module').classList.add('hidden');
  document.getElementById('weekly-module').classList.add('hidden');
  document.getElementById('weekly-tracking-module').classList.add('hidden');
  document.getElementById('perms-module').classList.add('hidden');
  document.getElementById('portal-module').classList.add('hidden');
  document.getElementById('opplan-module').classList.add('hidden');
  document.getElementById('duty-module').classList.add('hidden');
  document.getElementById('exams-module').classList.add('hidden');
  document.getElementById('exam-tracking-module').classList.add('hidden');
  document.getElementById('exam-reports-module').classList.add('hidden');
  document.getElementById('schedule-module').classList.add('hidden');
  document.getElementById('followups-module').classList.add('hidden');
  document.getElementById('budget-module').classList.add('hidden');
  document.getElementById('visits-module').classList.add('hidden');
  document.getElementById('substitutes-module').classList.add('hidden');
  document.getElementById('computerlab-module').classList.add('hidden');
  document.getElementById('schools-admin-module').classList.add('hidden');
  document.getElementById('admin-tasks-module').classList.add('hidden');
  document.getElementById('school-contacts-module').classList.add('hidden');
  document.getElementById('settings-module').classList.add('hidden');
  const achv = document.getElementById('achv-module'); if (achv) achv.classList.add('hidden');
  document.getElementById('settings-open-btn').classList.remove('active');
  document.getElementById('placeholder-module').classList.add('hidden');
}

function renderModuleHeader(key) {
  const header = document.getElementById('module-header');
  const t = tiles.find(x => x.key === key);
  if (!t) { header.classList.add('hidden'); return; }
  let title = t.title;
  let desc = t.desc;
  if (key === 'duty' && currentProfile.role === 'teacher') desc = 'المناوبة المسندة لي';
  if (key === 'achievements' && currentProfile.role === 'teacher') desc = 'بنود ملف إنجازي واكتمالها';
  if (key === 'exam-reports' && currentProfile.role === 'teacher') desc = 'تصحيح أوراق الإجابة بالجوال وتقارير اختباراتي';
  if (key === 'substitutes' && currentProfile.role === 'teacher') { title = 'جدول يومي'; desc = 'حصصي اليوم وحصص الإشغال'; }
  if (key === 'budget') { title = budgetTileTitle(); desc = budgetTileDesc(); }
  const g = GROUPS.find(x => x.key === t.group);
  header.innerHTML = `<div class="ic-diamond ${t.color}">${t.icon}</div><div>${g ? `<div class="crumb"><a href="#/" data-crumb="home">الرئيسية</a> / <a href="#/ws/${g.key}" data-crumb="${g.key}">${g.title}</a></div>` : ''}<h2>${title}</h2><p>${desc}</p></div>`;
  header.querySelectorAll('.crumb a').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    if (a.dataset.crumb === 'home') backToTiles(); else openWorkspace(a.dataset.crumb);
  }));
  header.classList.remove('hidden');
}

export async function openTile(key, title, sub = null) {
  // الصلاحيات وبيانات التواصل انتقلت لصفحة الإعدادات
  if (key === 'perms' || key === 'school-contacts') {
    const sec = key === 'perms' ? 'users' : 'contacts';
    history.replaceState({ key: 'settings/' + sec }, '', '#/settings/' + sec);
    return openTile('settings', null, sec);
  }
  hideAllModules();
  renderModuleHeader(key);
  pushRoute(sub ? key + '/' + sub : key);
  setActiveNavByKey(key);
  const tt = tiles.find(x => x.key === key);
  document.title = pageTitle(tt ? tileTitle(tt) : (title || 'القسم'));
  window.scrollTo(0, 0);
  if (key === 'notes') {
    document.getElementById('notes-module').classList.remove('hidden');
    const { loadNotesModule } = await import('./evaluation.js');
    loadNotesModule();
  } else if (key === 'weekly') {
    document.getElementById('weekly-module').classList.remove('hidden');
    const { loadWeeklyModule } = await import('./weekly-plan.js');
    loadWeeklyModule();
  } else if (key === 'weekly-tracking') {
    document.getElementById('weekly-tracking-module').classList.remove('hidden');
    const { loadWeeklyTrackingModule } = await import('./weekly-tracking.js');
    loadWeeklyTrackingModule();
  } else if (key === 'perms') {
    document.getElementById('perms-module').classList.remove('hidden');
    const { loadPermsModule } = await import('./employees-admin.js');
    loadPermsModule();
  } else if (key === 'portal') {
    document.getElementById('portal-module').classList.remove('hidden');
    const { loadPortalModule } = await import('./employees-admin.js');
    loadPortalModule();
  } else if (key === 'plan') {
    document.getElementById('opplan-module').classList.remove('hidden');
    const { loadOpPlanModule } = await import('./operational-plan.js');
    loadOpPlanModule();
  } else if (key === 'duty') {
    document.getElementById('duty-module').classList.remove('hidden');
    const { loadDutyRosterModule } = await import('./duty-roster.js');
    loadDutyRosterModule();
  } else if (key === 'exams') {
    document.getElementById('exams-module').classList.remove('hidden');
    const { loadExamsModule } = await import('./exams.js');
    loadExamsModule(sub);
  } else if (key === 'tracking') {
    document.getElementById('exam-tracking-module').classList.remove('hidden');
    const { loadExamTrackingTile } = await import('./exam-tracking.js');
    loadExamTrackingTile(sub);
  } else if (key === 'exam-reports') {
    document.getElementById('exam-reports-module').classList.remove('hidden');
    const { loadExamReportsModule } = await import('./exam-reports.js');
    loadExamReportsModule(sub);
  } else if (key === 'schedule') {
    document.getElementById('schedule-module').classList.remove('hidden');
    const [{ loadScheduleModule }] = await Promise.all([import('./schedule.js'), import('./schedule-pdf.js')]);
    loadScheduleModule();
  } else if (key === 'followups') {
    document.getElementById('followups-module').classList.remove('hidden');
    const { loadStudentFollowupsModule } = await import('./student-followups.js');
    loadStudentFollowupsModule();
  } else if (key === 'budget') {
    document.getElementById('budget-module').classList.remove('hidden');
    const { loadBudgetModule } = await import('./budget.js');
    loadBudgetModule();
  } else if (key === 'visits') {
    document.getElementById('visits-module').classList.remove('hidden');
    const { loadClassroomVisitsModule } = await import('./classroom-visits.js');
    loadClassroomVisitsModule();
  } else if (key === 'substitutes') {
    document.getElementById('substitutes-module').classList.remove('hidden');
    const { loadSubstitutionsModule } = await import('./substitutions.js');
    loadSubstitutionsModule();
  } else if (key === 'computerlab') {
    document.getElementById('computerlab-module').classList.remove('hidden');
    const { loadComputerLabModule } = await import('./computer-lab.js');
    loadComputerLabModule();
  } else if (key === 'schools-admin') {
    document.getElementById('schools-admin-module').classList.remove('hidden');
    const { loadSchoolAdminModule } = await import('./school-admin.js');
    loadSchoolAdminModule();
  } else if (key === 'admin-tasks') {
    document.getElementById('admin-tasks-module').classList.remove('hidden');
    const { loadAdminTasksModule } = await import('./admin-tasks.js');
    loadAdminTasksModule();
  } else if (key === 'achievements') {
    document.getElementById('achv-module').classList.remove('hidden');
    const { loadAchievementsModule } = await import('./achievements.js?v=' + ASSET_VERSION);
    loadAchievementsModule();
  } else if (key === 'settings') {
    document.getElementById('settings-module').classList.remove('hidden');
    document.getElementById('settings-open-btn').classList.add('active');
    const { loadSettingsModule } = await import('./settings.js');
    loadSettingsModule(sub);
  } else if (key === 'school-contacts') {
    document.getElementById('school-contacts-module').classList.remove('hidden');
    const { loadSchoolContactsModule } = await import('./school-contacts.js');
    loadSchoolContactsModule();
  } else {
    document.getElementById('placeholder-module').classList.remove('hidden');
    document.getElementById('placeholder-text').textContent = `قسم "${title}" قيد التطوير حاليًا`;
  }
}
export async function backToTiles() {
  pushRoute('home');
  setActiveNavByKey('home');
  document.title = pageTitle('الرئيسية');
  window.scrollTo(0, 0);
  hideAllModules();
  document.getElementById('module-header').classList.add('hidden');
  document.getElementById('tiles-view').classList.remove('hidden');
  renderDashboard();
  const { renderMyDutyBanner } = await import('./duty-roster.js');
  renderMyDutyBanner();
}
document.getElementById('back-to-tiles').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-2').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-3').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-4').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-5').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-7').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-6').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-19').addEventListener('click', backToTiles);
