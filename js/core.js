import { loadNotesModule } from './evaluation.js';
import { loadWeeklyTrackingModule } from './weekly-tracking.js';
import { loadPortalModule, loadPermsModule } from './employees-admin.js';
import { loadOpPlanModule } from './operational-plan.js';
import { loadWeeklyModule } from './weekly-plan.js';
import { loadDutyRosterModule, renderMyDutyBanner } from './duty-roster.js';
import { renderDashboard } from './dashboard.js';
import { loadExamsModule } from './exams.js';
import { loadExamTrackingTile } from './exam-tracking.js';
import { loadScheduleModule } from './schedule.js';

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
export const isAdminOrDeputy = () => ['admin','deputy'].includes(currentProfile.role);
export const isStaff = () => ['admin','deputy','teacher'].includes(currentProfile.role);
export function setupCollapsible(toggleId, bodyId, chevronId) {
  const toggle = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  toggle.addEventListener('click', () => {
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden');
    chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    const label = toggle.querySelector('span');
    label.textContent = label.textContent.replace(/^[+−]/, isHidden ? '−' : '+');
  });
}

const icons = {
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
};

export const tiles = [
  { key: 'weekly', icon: icons.weekly, title: 'الخطة الأسبوعية',    desc: 'الدروس والمهام والواجبات لكل مرحلة', roles: ['admin','deputy','teacher','parent'], color: 'diamond-teal' },
  { key: 'schedule', icon: icons.schedule, title: 'الجدول الدراسي', desc: 'جدول الحصص لكل فصل',            roles: ['admin','deputy'], color: 'diamond-teal' },
  { key: 'weekly-tracking', icon: icons.weekly, title: 'متابعة الخطة الأسبوعية', desc: 'المواد الناقصة كل أسبوع',   roles: ['admin','deputy'], color: 'diamond-navy' },
  { key: 'plan',   icon: icons.plan,   title: 'الخطة التشغيلية',    desc: 'المهام الأسبوعية والمتابعة',   roles: ['admin','deputy','teacher'], color: 'diamond-gold' },
  { key: 'notes',  icon: icons.notes,  title: 'متابعة أداء الموظفين', desc: 'ملاحظات ومؤشرات وتقييم',       roles: ['admin','deputy'], color: 'diamond-purple' },
  { key: 'portal', icon: icons.portal, title: 'بوابة الموظفين',      desc: 'بيانات وملفات الموظفين',       roles: ['admin','deputy'], color: 'diamond-purple' },
  { key: 'perms',  icon: icons.perms,  title: 'إدارة الصلاحيات',     desc: 'إضافة مستخدمين وأدوار',        roles: ['admin'], color: 'diamond-navy' },
  { key: 'duty',   icon: icons.duty,   title: 'المناوبات اليومية',   desc: 'المناوبون وتسجيل الحضور',      roles: ['admin','deputy'], color: 'diamond-navy' },
  { key: 'exams',  icon: icons.exams,  title: 'الاختبارات',          desc: 'تسكين الطلاب والتوزيع على اللجان', roles: ['admin','deputy'], color: 'diamond-purple' },
  { key: 'tracking', icon: icons.tracking, title: 'متابعة الاختبارات', desc: 'سير ورقة الإجابة وغياب الطلاب أثناء الاختبارات', roles: ['admin','deputy','teacher'], color: 'diamond-navy' },
  { key: 'more',   icon: icons.more,   title: 'إضافة قسم جديد',      desc: 'خدمات مستقبلية',               roles: ['admin'], color: 'diamond-gold' },
];

document.getElementById('login-btn').addEventListener('click', async () => {
  const rawInput = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!rawInput || !password) {
    errEl.textContent = 'أدخل البريد الإلكتروني أو الرقم الوظيفي وكلمة المرور';
    errEl.style.display = 'block';
    return;
  }
  const { data, error } = await sb.auth.signInWithPassword({ email: toLoginEmail(rawInput), password });
  if (error) {
    errEl.textContent = 'بيانات الدخول غير صحيحة. حاول مرة أخرى';
    errEl.style.display = 'block';
    return;
  }
  await loadProfileAndShowDashboard(data.user.id);
});

export async function loadProfileAndShowDashboard(userId) {
  const { data: profile, error } = await sb.from('profiles').select('full_name, role').eq('id', userId).single();
  if (error || !profile) {
    document.getElementById('login-error').textContent = 'تم الدخول لكن حسابك غير مربوط بدور بعد.';
    document.getElementById('login-error').style.display = 'block';
    return;
  }
  currentProfile = profile;
  currentUserId = userId;

  if (profile.role === 'teacher') {
    const { data: membership } = await sb.from('operational_plan_members').select('id').eq('profile_id', userId).maybeSingle();
    isOpPlanMember = !!membership;
  }

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('user-name').textContent = profile.full_name;
  document.getElementById('user-role-badge').textContent = roleLabels[profile.role] || profile.role;
  document.getElementById('user-avatar').textContent = (profile.full_name || '؟').trim().charAt(0);
  renderNav();
  renderDashboard();
  renderMyDutyBanner();
}

document.getElementById('logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

sb.auth.getSession().then(({ data }) => { if (data.session) loadProfileAndShowDashboard(data.session.user.id); });

export function isTileAllowed(t) {
  if (!t.roles.includes(currentProfile.role)) return false;
  if (t.key === 'plan' && currentProfile.role === 'teacher' && !isOpPlanMember) return false;
  return true;
}

export function renderNav(){
  const nav = document.getElementById('nav-list');
  nav.innerHTML = `<div class="nav-item active" data-key="home">${icons.home}<span>الرئيسية</span></div>`;
  tiles.forEach(t=>{
    if (!isTileAllowed(t)) return;
    const div = document.createElement('div');
    div.className = 'nav-item';
    div.innerHTML = `${t.icon}<span>${t.title}</span>`;
    div.addEventListener('click', ()=>{ setActiveNav(div); openTile(t.key, t.title); });
    nav.appendChild(div);
  });
  nav.querySelector('[data-key="home"]').addEventListener('click', (e)=>{ setActiveNav(e.currentTarget); backToTiles(); });
}
export function setActiveNav(el){ document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); el.classList.add('active'); }


export function hideAllModules() {
  document.getElementById('tiles-view').classList.add('hidden');
  document.getElementById('notes-module').classList.add('hidden');
  document.getElementById('weekly-module').classList.add('hidden');
  document.getElementById('weekly-tracking-module').classList.add('hidden');
  document.getElementById('perms-module').classList.add('hidden');
  document.getElementById('portal-module').classList.add('hidden');
  document.getElementById('opplan-module').classList.add('hidden');
  document.getElementById('duty-module').classList.add('hidden');
  document.getElementById('exams-module').classList.add('hidden');
  document.getElementById('exam-tracking-module').classList.add('hidden');
  document.getElementById('schedule-module').classList.add('hidden');
  document.getElementById('placeholder-module').classList.add('hidden');
}

function renderModuleHeader(key) {
  const header = document.getElementById('module-header');
  const t = tiles.find(x => x.key === key);
  if (!t) { header.classList.add('hidden'); return; }
  header.innerHTML = `<div class="ic-diamond ${t.color}">${t.icon}</div><div><h2>${t.title}</h2><p>${t.desc}</p></div>`;
  header.classList.remove('hidden');
}

export function openTile(key, title) {
  hideAllModules();
  renderModuleHeader(key);
  if (key === 'notes') {
    document.getElementById('notes-module').classList.remove('hidden');
    loadNotesModule();
  } else if (key === 'weekly') {
    document.getElementById('weekly-module').classList.remove('hidden');
    loadWeeklyModule();
  } else if (key === 'weekly-tracking') {
    document.getElementById('weekly-tracking-module').classList.remove('hidden');
    loadWeeklyTrackingModule();
  } else if (key === 'perms') {
    document.getElementById('perms-module').classList.remove('hidden');
    loadPermsModule();
  } else if (key === 'portal') {
    document.getElementById('portal-module').classList.remove('hidden');
    loadPortalModule();
  } else if (key === 'plan') {
    document.getElementById('opplan-module').classList.remove('hidden');
    loadOpPlanModule();
  } else if (key === 'duty') {
    document.getElementById('duty-module').classList.remove('hidden');
    loadDutyRosterModule();
  } else if (key === 'exams') {
    document.getElementById('exams-module').classList.remove('hidden');
    loadExamsModule();
  } else if (key === 'tracking') {
    document.getElementById('exam-tracking-module').classList.remove('hidden');
    loadExamTrackingTile();
  } else if (key === 'schedule') {
    document.getElementById('schedule-module').classList.remove('hidden');
    loadScheduleModule();
  } else {
    document.getElementById('placeholder-module').classList.remove('hidden');
    document.getElementById('placeholder-text').textContent = `قسم "${title}" قيد التطوير حاليًا`;
  }
}
export function backToTiles() {
  hideAllModules();
  document.getElementById('module-header').classList.add('hidden');
  document.getElementById('tiles-view').classList.remove('hidden');
  renderDashboard();
  renderMyDutyBanner();
}
document.getElementById('back-to-tiles').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-2').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-3').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-4').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-5').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-7').addEventListener('click', backToTiles);
document.getElementById('back-to-tiles-6').addEventListener('click', backToTiles);
