import { sb, currentUserId, currentProfile, gradeLabels, backToTiles } from './core.js';
import { DAYS, PERIODS } from './schedule.js';
import { VOUCHER_LOGO_DATA_URI } from './budget.js';

document.getElementById('back-to-tiles-14').addEventListener('click', backToTiles);

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
const ORG_NAME = 'مدرسة المروج المتوسطة';

/* ---------- مؤشرات نموذج الزيارة الصفية الرسمي (الهيئة الملكية للجبيل وينبع) ---------- */
// كل مؤشر: نص المؤشر + قائمة الخيارات مرتبة من الأفضل للأسوأ، وآخر خيار دايمًا "لم يتم تقييم..."
const INDICATORS = {
  12: {
    label: 'الإعداد للخطة والدرس',
    options: [
      'الإعداد مكتمل بطريقة مميزة وبجهد ذاتي من المعلم وموافق للخطة.',
      'الإعداد مكتمل وموافق للخطة.',
      'الإعداد مكتمل وغير موافق للخطة.',
      'الإعداد غير مكتمل العناصر.',
      'لم يتم إعداد الدرس.',
      'لم يتم تقييم الإعداد للخطة والدرس.',
    ],
  },
  13: {
    label: 'تحديد الأهداف وشموليتها',
    options: [
      'الأهداف محددة، وشاملة، وتراعي مهارات التفكير العليا، ويمكن قياسها.',
      'الأهداف محددة وشاملة ويمكن قياسها.',
      'الأهداف محددة و شاملة، ولا يمكن قياسها.',
      'الأهداف محددة وغير شاملة.',
      'الأهداف غير موجودة.',
      'لم يتم تقييم تحديد الأهداف وشموليتها.',
    ],
  },
  14: {
    label: 'تحديد الاستراتيجيات المطبقة ومناسبتها',
    options: [
      'استراتيجيات التدريس محددة، ومبتكرة، ومناسبة للدرس، ويمكن تنفيذها.',
      'استراتيجيات التدريس محددة، ومناسبة للدرس، ويمكن تنفيذها.',
      'استراتيجيات التدريس محددة، وغير مناسبة للدرس.',
      'استراتيجيات التدريس غير محددة.',
      'لم يتم تقييم تحديد الاستراتيجيات المطبقة ومناسبتها.',
    ],
  },
  15: {
    label: 'تقديم التهيئة المناسبة',
    options: [
      'مرتبطة بالدرس وزمنها مناسب ومثيرة للتفكير ومشوقة.',
      'مرتبطة بالدرس وذات زمن مناسب.',
      'مرتبطة بالدرس وذات زمن غير مناسب.',
      'غير مرتبطة بالدرس.',
      'لا يوجد تهيئة.',
      'لم يتم تقييم التهيئة المناسبة.',
    ],
  },
  16: {
    label: 'أهداف الدرس',
    options: [
      'الأهداف معروضة وقابلة للتنفيذ وتم مناقشتها.',
      'الأهداف معروضة وقابلة للتنفيذ.',
      'الأهداف معروضة.',
      'الأهداف غير معروضة.',
      'لم يتم تقييم أهداف الدرس.',
    ],
  },
  17: {
    label: 'طريقة التدريس وملاءمتها لتحقيق الأهداف',
    options: [
      'مناسبة للدرس ومنفذة بشكل يراعي بيئة التعلم ومشوقة.',
      'مناسبة للدرس ومنفذة بشكل يراعي بيئة التعلم.',
      'مناسبة للدرس ومنفذة بشكل لا يراعي بيئة التعلم.',
      'غير مناسبة للدرس.',
      'لم يتم تقييم طريقة التدريس وملاءمتها لتحقيق الأهداف.',
    ],
  },
  18: {
    label: 'العلاقة بين الدرس والبيئة المحيطة',
    options: [
      'وظفت البيئة المحيطة بما يتناسب مع مفاهيم الدرس وربطها بحياة المتعلم.',
      'وظفت البيئة المحيطة بما يتناسب مع مفاهيم الدرس.',
      'عدم توظيف البيئة المحيطة بما يناسب مفاهيم الدرس.',
      'لم يتم تقييم العلاقة بين الدرس والبيئة المحيطة.',
    ],
  },
  19: {
    label: 'فاعلية الوسيلة في تحقيق أهداف التعلم',
    options: [
      'مناسبة للموقف التعليمي وسليمة من الأخطاء ومرتبطة بالدرس ومشوقة.',
      'مناسبة للموقف التعليمي وسليمة من الأخطاء ومرتبطة بالدرس.',
      'الوسيلة غير مناسبة للموقف التعليمي.',
      'لا يوجد وسيلة تعليمية.',
      'لم يتم تقييم فاعلية الوسيلة في تحقيق أهداف التعلم.',
    ],
  },
  20: {
    label: 'فاعلية الأنشطة الصفية ودور الطالب في تنفيذها',
    options: [
      'أنشطة صفية منفذة من خلال تفاعل معظم الطلاب الإيجابي وتعزز من تعلم الأقران.',
      'أنشطة صفية منفذة من خلال تفاعل معظم الطلاب الإيجابي.',
      'أنشطة صفية منفذة من خلال تفاعل بعض الطلاب.',
      'أنشطة صفية غير فاعلة.',
      'لم يتم تقييم فاعلية الأنشطة الصفية ودور الطالب في تنفيذها.',
    ],
  },
  21: {
    label: 'مراعاة الفروق الفردية بين الطلاب',
    options: [
      'أساليب التدريس منوعة، ومستويات الأسئلة الصفية متمايزة ويتم تقديم الدعم المناسب لجميع فئات الطلاب والعناية بالطلاب الأكثر احتياجاً.',
      'أساليب التدريس منوعة، ومستويات الأسئلة الصفية متمايزة ويتم تقديم الدعم المناسب لجميع فئات الطلاب.',
      'أساليب التدريس منوعة، ولم يتم تقديم الدعم المناسب لجميع الطلاب.',
      'لا يوجد تنويع في أساليب التدريس.',
      'لم يتم تقييم مراعاة الفروق الفردية بين الطلاب.',
    ],
  },
  22: {
    label: 'إغلاق الدرس',
    options: [
      'إغلاق الدرس مرتبط بالأفكار الرئيسة وبزمن مناسب ومحدد المهام (واجب، مشروع .........) ويعزز مهارة البحث والاستقصاء.',
      'إغلاق الدرس مرتبط بالأفكار الرئيسة وبزمن مناسب ومحدد المهام.',
      'إغلاق الدرس مرتبط بالأفكار الرئيسة وبزمن مناسب وغير محدد المهام.',
      'إغلاق الدرس مرتبط بالأفكار الرئيسة بزمن غير مناسب.',
      'إغلاق الدرس غير مرتبط بالأفكار الرئيسة.',
      'لا يوجد إغلاق للدرس.',
      'لم يتم تقييم إغلاق الدرس.',
    ],
  },
  23: {
    label: 'البيئة الصفية',
    options: [
      'البيئة الصفية منظمة ومناسبة لتطبيق استراتيجيات التدريس وتحقق الانضباط الصفي ومحفزة للتعلم.',
      'البيئة الصفية منظمة ومناسبة لتطبيق استراتيجيات التدريس وتحقق الانضباط الصفي.',
      'البيئة الصفية منظمة ومناسبة لتطبيق استراتيجيات التدريس ولكن لا تحقق الانضباط الصفي.',
      'البيئة الصفية منظمة وغير مناسبة لتطبيق استراتيجيات التدريس.',
      'البيئة الصفية غير منظمة.',
      'لم يتم تقييم البيئة الصفية.',
    ],
  },
  24: {
    label: 'مهارات التواصل',
    options: [
      'التواصل يتسم بـ "الوضوح – الاحترام – الانصات ..." ويشجع الأفكار و ويتسم بالإيجابية والحكمة في المواقف المختلفة ويحقق التواصل الفعال بين الطلاب.',
      'التواصل يتسم بـ "الوضوح – الاحترام – الانصات ..." ويشجع الأفكار و ويتسم بالإيجابية والحكمة في المواقف المختلفة.',
      'التواصل يتسم بـ "الوضوح – الاحترام – الانصات ..." ويشجع الأفكار.',
      'التواصل يتسم بـ "الوضوح – الاحترام – الانصات ...".',
      'التواصل ضعيف.',
      'لم يتم تقييم مهارات التواصل.',
    ],
  },
  25: {
    label: 'إدارة الوقت',
    options: [
      'توزيع الوقت بشكل مناسب على مراحل التعلم، وإعطاء المتعلم وقتاً كافياً للتعلم، واستثمار وقت الحصة كاملاً.',
      'توزيع الوقت بشكل مناسب على مراحل التعلم، وإعطاء المتعلم وقتاً كافياً للتعلم.',
      'توزيع الوقت بشكل مناسب على مراحل التعلم.',
      'توزيع الوقت غير مناسب.',
      'لم يتم تقييم إدارة الوقت.',
    ],
  },
  26: {
    label: 'مراحل التقويم والتغذية الراجعة',
    options: [
      'مراحل التقويم مفعلة، ويتم تقديم تغذية راجعة مناسبة للطالب، بتوظيف استراتيجيات مناسبة.',
      'مراحل التقويم مفعلة، ويتم تقديم تغذية راجعة مناسبة للطالب.',
      'مراحل التقويم مفعلة ولم يتم تقديم التغذية الراجعة.',
      'مراحل التقويم مفعلة جزئياً ولم يتم تقديم التغذية الراجعة.',
      'مراحل التقويم غير مفعلة.',
      'لم يتم تقييم مراحل التقويم والتغذية الراجعة.',
    ],
  },
  27: {
    label: 'توثيق التقويم والمهام الأدائية أثناء التدريس',
    options: [
      'سجل المتابعة مفعل في مراحل التقويم المختلفة. ويتم توظيفه في تحفيز وتعزيز تعلم وسلوك الطلاب.',
      'سجل المتابعة مفعل في مراحل التقويم المختلفة.',
      'سجل المتابعة مفعل في بعض مراحل التقويم.',
      'سجل المتابعة غير مفعل.',
      'لم يتم تقييم توثيق التقويم والمهام الأدائية أثناء التدريس.',
    ],
  },
  28: {
    label: 'تنويع أساليب التقويم وأدواته (شفهي، كتابي الكتروني)',
    options: [
      'أساليب التقويم وأدواته منوعة، وتشمل التطبيقات والبرامج الإلكترونية.',
      'أساليب التقويم منوعة.',
      'أساليب التقويم غير منوعة.',
      'لم يتم تقييم تنويع أساليب التقويم وأدواته (شفهي، كتابي الكتروني).',
    ],
  },
};

const SECTIONS = [
  { title: 'التخطيط للتدريس', nums: [12, 13, 14] },
  { title: 'إجراءات وأنشطة الدرس', nums: [15, 16, 17, 18, 19, 20, 21, 22] },
  { title: 'إدارة الصف', nums: [23, 24, 25] },
  { title: 'التقويم', nums: [26, 27, 28] },
];

// قائمة الاستراتيجيات المعتمدة بالنموذج الرسمي
const STRATEGIES = [
  'العصف الذهني', 'خرائط المفاهيم', 'التدريب الثنائي', 'الرؤوس المرقمة', 'فكر زاوج شارك',
  'الرحلات المعرفية', 'نموذج فراير', 'النمذجة', 'الكرسي الساخن', 'المعلم الصغير',
  'أعواد المثلجات', 'النموذج الرباعي', 'حل المشكلات', 'مجموعة الخبراء جيكسو', 'التعلم باللعب',
  'سكامبر', 'الاستقراء', 'مسرح العرائس', 'من أنا', 'خماسية لماذا',
  'الأسلوب التدريبي', 'KWL المعرفة المكتسبة', 'المحاولة و الخطأ', 'القراءة النشطة',
  'ورقة الدقيقة الواحدة', 'المشاريع العملية', 'أرسل سؤال', 'الاستنتاج',
];

// تقدير كل خيار حسب ترتيبه (أول خيار = مميز، آخر خيار حقيقي = فرصة تحسين، والباقي = حقق الهدف)
// آخر عنصر بكل قائمة دايمًا "لم يتم تقييم..." ولا ياخذ تقدير
function tierForOption(indicatorNum, optionText) {
  const opts = INDICATORS[indicatorNum].options;
  const idx = opts.indexOf(optionText);
  if (idx === -1 || idx === opts.length - 1) return null;
  if (idx === 0) return { label: 'مميز', symbol: '✓' };
  if (idx === opts.length - 2) return { label: 'فرصة تحسين', symbol: '➔' };
  return { label: 'حقق الهدف', symbol: '—' };
}

let cvGrade = 'first_intermediate';
let cvSection = null;
let cvView = 'list'; // 'list' | 'form'
let cvSchedule = {}; // خريطة الحصص المتاحة للفصل المختار: "day-period" -> {subject, teacher}

function isAdminOrDeputyHere() { return ['admin', 'deputy'].includes(currentProfile.role); }

export async function loadClassroomVisitsModule() {
  cvView = 'list';
  await renderView();
}

async function renderView() {
  const container = document.getElementById('cv-container');
  if (cvView === 'form') {
    await renderForm(container);
  } else {
    await renderList(container);
  }
}

/* ================= قائمة الزيارات ================= */
async function renderList(container) {
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  let query = sb.from('classroom_visits').select('*').order('visit_date', { ascending: false }).order('created_at', { ascending: false });
  const { data, error } = await query;
  const visits = data || [];

  let html = '';
  if (isAdminOrDeputyHere()) {
    html += `<div style="margin-bottom:16px;"><button class="btn-primary" id="cv-new-btn" style="width:auto; padding:11px 22px;">+ زيارة صفية جديدة</button></div>`;
  }

  if (error) {
    html += `<div class="error-msg">تعذر تحميل الزيارات: ${error.message}</div>`;
  } else if (visits.length === 0) {
    html += `<div class="placeholder" style="padding:30px;"><p>لا توجد زيارات مسجلة بعد</p></div>`;
  } else {
    html += '<div style="display:flex; flex-direction:column; gap:12px;">';
    visits.forEach(v => {
      const dayLabel = (DAYS.find(d => d.key === v.day_of_week) || {}).label || v.day_of_week;
      html += `
        <div class="form-card" style="padding:16px 18px;">
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; align-items:center;">
            <div>
              <div style="font-weight:800; font-size:15px; color:var(--navy);">${esc(v.teacher_name)} — ${esc(v.subject_name)}</div>
              <div style="font-size:12.5px; color:var(--slate); margin-top:4px;">
                ${gradeLabels[v.grade_level] || v.grade_level} / الفصل ${v.class_section} — ${dayLabel} — الحصة ${v.period_number} — ${fmtDate(v.visit_date)}
              </div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <span class="badge ${v.published ? 'badge-green' : 'badge-gold'}" style="padding:5px 12px; border-radius:20px; font-size:11.5px; font-weight:700; ${v.published ? 'background:#e4f5ea; color:#1f8a4c;' : 'background:#fdf2df; color:#9a6b1e;'}">${v.published ? 'منشورة للمعلم' : 'غير منشورة'}</span>
              <button class="btn-secondary cv-print-btn" data-id="${v.id}" style="width:auto; padding:8px 14px; font-size:12.5px;">طباعة PDF</button>
              ${isAdminOrDeputyHere() ? `<button class="btn-secondary cv-publish-btn" data-id="${v.id}" data-current="${v.published}" style="width:auto; padding:8px 14px; font-size:12.5px;">${v.published ? 'إلغاء النشر' : 'نشر للمعلم'}</button>` : ''}
              ${isAdminOrDeputyHere() ? `<button class="btn-secondary cv-delete-btn" data-id="${v.id}" style="width:auto; padding:8px 14px; font-size:12.5px; color:var(--danger);">حذف</button>` : ''}
            </div>
          </div>
        </div>`;
    });
    html += '</div>';
  }

  container.innerHTML = html;

  const newBtn = document.getElementById('cv-new-btn');
  if (newBtn) newBtn.addEventListener('click', () => { cvView = 'form'; renderView(); });

  container.querySelectorAll('.cv-print-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const v = visits.find(x => x.id === btn.dataset.id);
      if (v) printVisitReport(v);
    });
  });
  container.querySelectorAll('.cv-publish-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const current = btn.dataset.current === 'true';
      await sb.from('classroom_visits').update({ published: !current, updated_at: new Date().toISOString() }).eq('id', btn.dataset.id);
      renderView();
    });
  });
  container.querySelectorAll('.cv-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('تأكيد حذف هذي الزيارة نهائيًا؟')) return;
      await sb.from('classroom_visits').delete().eq('id', btn.dataset.id);
      renderView();
    });
  });
}

/* ================= نموذج زيارة جديدة ================= */
async function renderForm(container) {
  container.innerHTML = `
    <div style="margin-bottom:14px;">
      <button class="btn-secondary" id="cv-back-list-btn" style="width:auto; padding:9px 18px;">→ رجوع لقائمة الزيارات</button>
    </div>

    <div class="form-card" style="background:var(--sand);">
      <h4>بيانات الحصة (تُسحب من الجدول الدراسي)</h4>
      <div class="tabs" id="cv-grade-tabs"></div>
      <div class="form-row" style="margin-top:10px;">
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الفصل</label>
          <select id="cv-section-select"><option value="">اختر الفصل</option></select>
        </div>
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">اليوم</label>
          <select id="cv-day-select"><option value="">اختر اليوم</option>${DAYS.map(d => `<option value="${d.key}">${d.label}</option>`).join('')}</select>
        </div>
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الحصة</label>
          <select id="cv-period-select"><option value="">اختر الحصة</option>${PERIODS.map(p => `<option value="${p}">الحصة ${p}</option>`).join('')}</select>
        </div>
      </div>
      <div id="cv-slot-info" style="margin-top:10px; font-size:13px; color:var(--navy); font-weight:700;"></div>
    </div>

    <div class="form-card">
      <h4>بيانات إضافية</h4>
      <div class="form-row">
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">التخصص</label>
          <input type="text" id="cv-specialization" placeholder="تخصص المعلم" />
        </div>
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">تاريخ الزيارة</label>
          <input type="date" id="cv-visit-date" />
        </div>
      </div>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الموضوع</label>
      <input type="text" id="cv-lesson-topic" placeholder="موضوع الدرس" style="margin-bottom:12px;" />
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الهدف من الزيارة</label>
      <input type="text" id="cv-visit-purpose" placeholder="الهدف من الزيارة" />
    </div>

    <div class="form-card">
      <h4>الاستراتيجيات المطبقة</h4>
      <div id="cv-strategies" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:8px;">
        ${STRATEGIES.map((s, i) => `
          <label style="font-size:12.5px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="checkbox" class="cv-strategy-cb" value="${esc(s)}" style="width:auto; margin:0;" /> ${esc(s)}
          </label>`).join('')}
      </div>
      <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
        <label style="font-size:12.5px; display:flex; align-items:center; gap:6px; font-weight:400;">
          <input type="checkbox" id="cv-strategy-other-cb" style="width:auto; margin:0;" /> إجابة أخرى
        </label>
        <input type="text" id="cv-strategy-other-text" placeholder="غير ذلك" style="flex:1;" />
      </div>
    </div>

    ${SECTIONS.map(sec => `
      <div class="form-card">
        <h4>${esc(sec.title)}</h4>
        ${sec.nums.map(num => `
          <div style="margin-bottom:14px;">
            <label style="font-size:13px; color:var(--navy); display:block; margin-bottom:6px; font-weight:700;">${num}. ${esc(INDICATORS[num].label)}</label>
            <select class="cv-rating-select" data-indicator="${num}">
              <option value="">اختر التقييم</option>
              ${INDICATORS[num].options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>`).join('')}

    <div class="form-card">
      <h4>بيانات ختامية</h4>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">ارتقاء (رياضيات - لغتي)</label>
      <div style="display:flex; gap:16px; margin-bottom:14px;">
        ${['يوجد', 'لا يوجد', 'لا ينطبق'].map(v => `
          <label style="font-size:13px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="radio" name="cv-upgrade" value="${v}" style="width:auto;" /> ${v}
          </label>`).join('')}
      </div>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">داعم (مجتمعات التعلم المهنية - علاج التعثر)</label>
      <div style="display:flex; gap:16px; margin-bottom:14px;">
        ${['يوجد', 'لا يوجد'].map(v => `
          <label style="font-size:13px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="radio" name="cv-support" value="${v}" style="width:auto;" /> ${v}
          </label>`).join('')}
      </div>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الجوانب الإيجابية</label>
      <textarea id="cv-positive" rows="3" placeholder="يمكنك تركه فارغ" style="margin-bottom:14px;"></textarea>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">فرص التحسين</label>
      <div style="margin-bottom:6px;">
        <label style="font-size:13px; display:flex; align-items:center; gap:6px; font-weight:400;">
          <input type="checkbox" id="cv-improve-above" style="width:auto;" /> تم ذكرها أعلاه
        </label>
      </div>
      <input type="text" id="cv-improve-other" placeholder="غير ذلك" style="margin-bottom:14px;" />
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الاحتياج التدريبي المقترح</label>
      <textarea id="cv-training" rows="3" placeholder="يمكنك تركه فارغ"></textarea>
    </div>

    <div class="error-msg" id="cv-save-error"></div>
    <button class="btn-primary" id="cv-save-btn" style="width:auto; padding:12px 26px;">حفظ الزيارة</button>
  `;

  document.getElementById('cv-back-list-btn').addEventListener('click', () => { cvView = 'list'; renderView(); });
  document.getElementById('cv-visit-date').value = todayIso();

  renderGradeTabs();
  await refreshSectionOptions();

  document.getElementById('cv-day-select').addEventListener('change', updateSlotInfo);
  document.getElementById('cv-period-select').addEventListener('change', updateSlotInfo);

  document.getElementById('cv-save-btn').addEventListener('click', saveVisit);
}

function renderGradeTabs() {
  const wrap = document.getElementById('cv-grade-tabs');
  wrap.innerHTML = '';
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (g === cvGrade ? ' active' : '');
    btn.textContent = gradeLabels[g];
    btn.addEventListener('click', () => {
      cvGrade = g;
      cvSection = null;
      renderGradeTabs();
      refreshSectionOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshSectionOptions() {
  const sectionSelect = document.getElementById('cv-section-select');
  sectionSelect.innerHTML = '<option value="">جارٍ التحميل...</option>';

  const { data: studentsData } = await sb.from('students').select('class_section').eq('grade_level', cvGrade);
  let sections = [...new Set((studentsData || []).map(s => s.class_section).filter(n => n > 0))].sort((a, b) => a - b);
  if (sections.length === 0) sections = [1, 2, 3, 4, 5, 6, 7, 8];

  sectionSelect.innerHTML = '<option value="">اختر الفصل</option>' + sections.map(n => `<option value="${n}">الفصل ${n}</option>`).join('');
  sectionSelect.onchange = async () => {
    cvSection = sectionSelect.value ? parseInt(sectionSelect.value) : null;
    await loadScheduleForSlotPicker();
    updateSlotInfo();
  };
}

async function loadScheduleForSlotPicker() {
  cvSchedule = {};
  if (!cvSection) return;
  const { data } = await sb.from('class_schedules')
    .select('day_of_week, period_number, subject_name, teacher_name')
    .eq('grade_level', cvGrade).eq('class_section', cvSection);
  (data || []).forEach(r => { cvSchedule[r.day_of_week + '-' + r.period_number] = { subject: r.subject_name || '', teacher: r.teacher_name || '' }; });
}

function updateSlotInfo() {
  const day = document.getElementById('cv-day-select').value;
  const period = document.getElementById('cv-period-select').value;
  const infoEl = document.getElementById('cv-slot-info');
  if (!cvSection || !day || !period) { infoEl.textContent = ''; return; }
  const cell = cvSchedule[day + '-' + period];
  if (!cell || !cell.subject) {
    infoEl.innerHTML = '<span style="color:var(--danger);">لا توجد مادة مسجلة بهذي الحصة بالجدول الدراسي — تأكد من اختيار الحصة الصحيحة أو حدّث الجدول أولًا.</span>';
    return;
  }
  infoEl.innerHTML = `المادة: <b>${esc(cell.subject)}</b> — المعلم: <b>${esc(cell.teacher || '-')}</b>`;
}

async function saveVisit() {
  const errEl = document.getElementById('cv-save-error');
  errEl.textContent = '';

  const day = document.getElementById('cv-day-select').value;
  const period = document.getElementById('cv-period-select').value;
  if (!cvSection || !day || !period) { errEl.textContent = 'اختر الفصل واليوم والحصة'; return; }
  const cell = cvSchedule[day + '-' + period];
  if (!cell || !cell.subject) { errEl.textContent = 'لا توجد مادة مسجلة بهذي الحصة بالجدول الدراسي'; return; }
  if (!cell.teacher) { errEl.textContent = 'لا يوجد اسم معلم مسجل بهذي الحصة بالجدول الدراسي'; return; }

  const visitDate = document.getElementById('cv-visit-date').value;
  if (!visitDate) { errEl.textContent = 'حدد تاريخ الزيارة'; return; }

  const ratings = {};
  const ratingSelects = Array.from(document.querySelectorAll('.cv-rating-select'));
  for (const sel of ratingSelects) {
    if (!sel.value) { errEl.textContent = `أكمل تقييم كل المؤشرات (${INDICATORS[sel.dataset.indicator].label})`; sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ratings[sel.dataset.indicator] = sel.value;
  }

  const strategies = Array.from(document.querySelectorAll('.cv-strategy-cb:checked')).map(cb => cb.value);
  const strategiesOtherChecked = document.getElementById('cv-strategy-other-cb').checked;
  const strategiesOther = strategiesOtherChecked ? document.getElementById('cv-strategy-other-text').value.trim() : null;

  const upgradeEl = document.querySelector('input[name="cv-upgrade"]:checked');
  const supportEl = document.querySelector('input[name="cv-support"]:checked');

  const payload = {
    visitor_id: currentUserId,
    visitor_role: currentProfile.role,
    grade_level: cvGrade,
    class_section: cvSection,
    day_of_week: day,
    period_number: parseInt(period),
    teacher_name: cell.teacher,
    subject_name: cell.subject,
    specialization: document.getElementById('cv-specialization').value.trim() || null,
    visit_date: visitDate,
    lesson_topic: document.getElementById('cv-lesson-topic').value.trim() || null,
    visit_purpose: document.getElementById('cv-visit-purpose').value.trim() || null,
    strategies,
    strategies_other: strategiesOther || null,
    ratings,
    upgrade_math_lughati: upgradeEl ? upgradeEl.value : null,
    support_plc: supportEl ? supportEl.value : null,
    positive_aspects: document.getElementById('cv-positive').value.trim() || null,
    improvement_mentioned_above: document.getElementById('cv-improve-above').checked,
    improvement_other: document.getElementById('cv-improve-other').value.trim() || null,
    training_need: document.getElementById('cv-training').value.trim() || null,
    published: false,
  };

  const { error } = await sb.from('classroom_visits').insert(payload);
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; return; }

  cvView = 'list';
  renderView();
}

/* ================= طباعة تقرير PDF ================= */
function printVisitReport(v) {
  const dayLabel = (DAYS.find(d => d.key === v.day_of_week) || {}).label || v.day_of_week;

  const sectionsHtml = SECTIONS.map(sec => `
    <h3 class="sec-title">${esc(sec.title)}</h3>
    <table class="ratings">
      <thead><tr><th style="width:26px;">م</th><th>المؤشر</th><th>التقييم</th><th style="width:90px;">التقدير</th></tr></thead>
      <tbody>
        ${sec.nums.map(num => {
          const selected = (v.ratings || {})[num] || '-';
          const tier = v.ratings && v.ratings[num] ? tierForOption(num, v.ratings[num]) : null;
          return `<tr>
            <td>${num}</td>
            <td style="text-align:right;">${esc(INDICATORS[num].label)}</td>
            <td style="text-align:right;">${esc(selected)}</td>
            <td>${tier ? `${tier.symbol} ${esc(tier.label)}` : '-'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`).join('');

  const strategiesText = [...(v.strategies || []), v.strategies_other ? `أخرى: ${v.strategies_other}` : null].filter(Boolean).join('، ') || '-';
  const improvementText = [(v.improvement_mentioned_above ? 'تم ذكرها أعلاه' : null), v.improvement_other].filter(Boolean).join('، ') || '-';

  const logoHtml = VOUCHER_LOGO_DATA_URI
    ? `<img src="${VOUCHER_LOGO_DATA_URI}" alt="الشعار" />`
    : `<div class="logo-placeholder">الشعار</div>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>تقرير زيارة صفية — ${esc(v.teacher_name)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 12mm; }
  body { font-family: 'Tahoma', 'Arial', sans-serif; padding: 8mm; margin: 0; color:#16233A; }
  .doc { width: 100%; max-width: 186mm; margin: 0 auto; }

  .header { display:flex; align-items:center; justify-content:space-between; border-bottom: 2px solid #16233A; padding-bottom: 12px; margin-bottom: 14px; gap:10px; }
  .header .logo-side { width: 40mm; flex-shrink:0; }
  .header .logo-side img { max-width: 40mm; max-height: 13mm; }
  .header .titles { flex: 1; text-align:center; }
  .header .titles h1 { font-size: 18px; margin: 0 0 3px; color:#B3413A; }
  .header .titles .org { font-size: 13px; color:#444; margin: 0; }

  table.meta { width:100%; border-collapse:collapse; margin-bottom:14px; }
  table.meta td { border:1px solid #ccc; padding:6px 9px; font-size:12px; }
  table.meta td.label { background:#f3f3f0; font-weight:bold; width:110px; }

  h3.sec-title { font-size:14px; color:#16233A; background:#eef1f6; padding:6px 10px; border-radius:4px; margin:16px 0 8px; }
  table.ratings { width:100%; border-collapse:collapse; margin-bottom:6px; }
  table.ratings th, table.ratings td { border:1px solid #999; padding:5px 7px; font-size:10.5px; text-align:center; }
  table.ratings th { background:#16233A; color:#fff; font-weight:600; }
  table.ratings tbody tr:nth-child(even) { background:#f7f7f2; }

  .extra-box { border:1px solid #ccc; border-radius:6px; padding:8px 10px; margin-bottom:10px; font-size:12px; }
  .extra-box .lbl { font-weight:700; color:#16233A; margin-bottom:3px; display:block; }

  .sign { display:flex; justify-content:space-between; margin-top:30px; gap:14px; }
  .sign > div { flex:1; text-align:center; font-size:12px; }
  .sign .box { margin-top:8px; border:1px solid #999; border-radius:6px; height:60px; display:flex; flex-direction:column; justify-content:space-between; padding:6px 8px; }
  .sign .box .name { color:#16233A; font-weight:700; font-size:12.5px; }

  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="header">
      <div class="logo-side">${logoHtml}</div>
      <div class="titles">
        <h1>تقرير زيارة صفية</h1>
        <p class="org">${esc(ORG_NAME)}</p>
      </div>
      <div class="logo-side"></div>
    </div>

    <table class="meta">
      <tr><td class="label">المعلم</td><td>${esc(v.teacher_name)}</td><td class="label">التخصص</td><td>${esc(v.specialization || '-')}</td></tr>
      <tr><td class="label">المادة</td><td>${esc(v.subject_name)}</td><td class="label">الموضوع</td><td>${esc(v.lesson_topic || '-')}</td></tr>
      <tr><td class="label">الصف</td><td>${gradeLabels[v.grade_level] || v.grade_level} / ${v.class_section}</td><td class="label">اليوم والحصة</td><td>${dayLabel} — الحصة ${v.period_number}</td></tr>
      <tr><td class="label">التاريخ</td><td>${fmtDate(v.visit_date)}</td><td class="label">الزائر</td><td>${esc(v.visitor_role === 'admin' ? 'مدير المدرسة' : 'وكيل المدرسة')}</td></tr>
      <tr><td class="label">الهدف من الزيارة</td><td colspan="3">${esc(v.visit_purpose || '-')}</td></tr>
      <tr><td class="label">الاستراتيجيات المطبقة</td><td colspan="3">${esc(strategiesText)}</td></tr>
    </table>

    ${sectionsHtml}

    <div class="extra-box"><span class="lbl">ارتقاء (رياضيات - لغتي)</span>${esc(v.upgrade_math_lughati || '-')}</div>
    <div class="extra-box"><span class="lbl">داعم (مجتمعات التعلم المهنية - علاج التعثر)</span>${esc(v.support_plc || '-')}</div>
    <div class="extra-box"><span class="lbl">الجوانب الإيجابية</span>${esc(v.positive_aspects || '-')}</div>
    <div class="extra-box"><span class="lbl">فرص التحسين</span>${esc(improvementText)}</div>
    <div class="extra-box"><span class="lbl">الاحتياج التدريبي المقترح</span>${esc(v.training_need || '-')}</div>

    <div class="sign">
      <div>الزائر<div class="box"><div class="name">${esc(v.visitor_role === 'admin' ? 'مدير المدرسة' : 'وكيل المدرسة')}</div></div></div>
      <div>المعلم<div class="box"><div class="name">${esc(v.teacher_name)}</div></div></div>
    </div>

    <div style="margin-top:16px; font-size:10px; color:#999; text-align:center;">تمت الطباعة من نظام إدارة المدرسة — ${fmtDate(todayIso())}</div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('يرجى السماح بفتح نافذة منبثقة للطباعة'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/* ---------- أدوات مساعدة ---------- */
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
