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

// توصيات جاهزة معتمدة من نموذج رسمي فعلي — تُقترح تلقائيًا لما يكون تقدير المؤشر "فرصة تحسين"
// (ما عندنا توصية رسمية جاهزة لكل المؤشرات، فالباقي يُكتب يدويًا من قِبل الزائر)
const RECOMMENDATIONS = {
  16: 'معرفة الطالب بأهداف الدرس يزيد من فرص التعلم وتوجيه الجهود.',
  20: 'تفعيل دور جميع الطلاب في تنفيذ أنشطة الدرس يسهم في تنمية قدرات المتعلم وتحقيق الأهداف.',
  27: 'تفعيل سجل المتابعة يسهم في تحفيز وتعزيز تعلم الطلاب وتعديل سلوكهم وتحسين نواتج التعلم.',
  28: 'تنويع أساليب التقويم وأدواته يسهم في إيجاد بيئة تعلم فاعلة ويحسن من نواتج التعلم.',
};

// تقدير كل خيار حسب ترتيبه: أول خيار = مميز، آخر خيار حقيقي (قبل "لم يتم تقييم") = فرصة تحسين، والباقي = حقق الهدف
// الرموز مطابقة للنموذج الرسمي المعتمد: ✓ = حقق الهدف، ➔ = فرصة تحسين، ⭐ = مميز
// آخر عنصر بكل قائمة دايمًا "لم يتم تقييم..." ولا ياخذ تقدير
function tierForOption(indicatorNum, optionText) {
  const opts = INDICATORS[indicatorNum].options;
  const idx = opts.indexOf(optionText);
  if (idx === -1 || idx === opts.length - 1) return null;
  if (idx === 0) return { label: 'مميز', symbol: '⭐' };
  if (idx === opts.length - 2) return { label: 'فرصة تحسين', symbol: '➔' };
  return { label: 'حقق الهدف', symbol: '✓' };
}

let cvGrade = 'first_intermediate';
let cvSection = null;
let cvView = 'list'; // 'list' | 'form'
let cvSchedule = {}; // خريطة الحصص المتاحة للفصل المختار: "day-period" -> {subject, teacher}
let cvEditingId = null; // معرّف الزيارة الجاري تعديلها، أو null لو زيارة جديدة

function isAdminOrDeputyHere() { return ['admin', 'deputy'].includes(currentProfile.role); }
function canEditVisit(v) { return currentProfile.role === 'admin' || v.visitor_id === currentUserId; }

export async function loadClassroomVisitsModule() {
  cvView = 'list';
  cvEditingId = null;
  await renderView();
}

let cvEditingVisit = null; // كائن الزيارة الكامل لما نكون بوضع تعديل

async function renderView() {
  const container = document.getElementById('cv-container');
  if (cvView === 'form') {
    await renderForm(container, cvEditingVisit);
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
              ${canEditVisit(v) ? `<button class="btn-secondary cv-edit-btn" data-id="${v.id}" style="width:auto; padding:8px 14px; font-size:12.5px;">تعديل</button>` : ''}
              ${isAdminOrDeputyHere() ? `<button class="btn-secondary cv-publish-btn" data-id="${v.id}" data-current="${v.published}" style="width:auto; padding:8px 14px; font-size:12.5px;">${v.published ? 'إلغاء النشر' : 'نشر للمعلم'}</button>` : ''}
              ${canEditVisit(v) ? `<button class="btn-secondary cv-delete-btn" data-id="${v.id}" style="width:auto; padding:8px 14px; font-size:12.5px; color:var(--danger);">حذف</button>` : ''}
            </div>
          </div>
        </div>`;
    });
    html += '</div>';
  }

  container.innerHTML = html;

  const newBtn = document.getElementById('cv-new-btn');
  if (newBtn) newBtn.addEventListener('click', () => { cvEditingVisit = null; cvView = 'form'; renderView(); });

  container.querySelectorAll('.cv-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = visits.find(x => x.id === btn.dataset.id);
      if (!v) return;
      cvEditingVisit = v;
      cvView = 'form';
      renderView();
    });
  });

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

/* ================= نموذج زيارة جديدة / تعديل زيارة ================= */
async function renderForm(container, existing) {
  const isEdit = !!existing;
  cvEditingId = isEdit ? existing.id : null;
  if (isEdit) { cvGrade = existing.grade_level; cvSection = existing.class_section; }

  container.innerHTML = `
    <div style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
      <button class="btn-secondary" id="cv-back-list-btn" style="width:auto; padding:9px 18px;">→ رجوع لقائمة الزيارات</button>
      ${isEdit ? '<span style="font-size:12.5px; color:var(--gold); font-weight:700;">وضع التعديل — التغييرات تُحفظ على نفس الزيارة</span>' : ''}
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
          <select id="cv-day-select"><option value="">اختر اليوم</option>${DAYS.map(d => `<option value="${d.key}"${isEdit && existing.day_of_week === d.key ? ' selected' : ''}>${d.label}</option>`).join('')}</select>
        </div>
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الحصة</label>
          <select id="cv-period-select"><option value="">اختر الحصة</option>${PERIODS.map(p => `<option value="${p}"${isEdit && existing.period_number === p ? ' selected' : ''}>الحصة ${p}</option>`).join('')}</select>
        </div>
      </div>
      <div id="cv-slot-info" style="margin-top:10px; font-size:13px; color:var(--navy); font-weight:700;"></div>
    </div>

    <div class="form-card">
      <h4>بيانات إضافية</h4>
      <div class="form-row">
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">التخصص</label>
          <input type="text" id="cv-specialization" placeholder="تخصص المعلم" value="${esc(existing?.specialization || '')}" />
        </div>
        <div>
          <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">تاريخ الزيارة</label>
          <input type="date" id="cv-visit-date" />
        </div>
      </div>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الموضوع</label>
      <input type="text" id="cv-lesson-topic" placeholder="موضوع الدرس" value="${esc(existing?.lesson_topic || '')}" style="margin-bottom:12px;" />
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الهدف من الزيارة</label>
      <input type="text" id="cv-visit-purpose" placeholder="الهدف من الزيارة" value="${esc(existing?.visit_purpose || '')}" />
    </div>

    <div class="form-card">
      <h4>الاستراتيجيات المطبقة</h4>
      <div id="cv-strategies" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:8px;">
        ${STRATEGIES.map(s => `
          <label style="font-size:12.5px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="checkbox" class="cv-strategy-cb" value="${esc(s)}" style="width:auto; margin:0;"${existing?.strategies?.includes(s) ? ' checked' : ''} /> ${esc(s)}
          </label>`).join('')}
      </div>
      <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
        <label style="font-size:12.5px; display:flex; align-items:center; gap:6px; font-weight:400;">
          <input type="checkbox" id="cv-strategy-other-cb" style="width:auto; margin:0;"${existing?.strategies_other ? ' checked' : ''} /> إجابة أخرى
        </label>
        <input type="text" id="cv-strategy-other-text" placeholder="غير ذلك" value="${esc(existing?.strategies_other || '')}" style="flex:1;" />
      </div>
    </div>

    ${SECTIONS.map(sec => `
      <div class="form-card">
        <h4>${esc(sec.title)}</h4>
        ${sec.nums.map(num => {
          const currentVal = existing?.ratings?.[num] || '';
          const currentRec = existing?.recommendations?.[num] || '';
          const tier = currentVal ? tierForOption(num, currentVal) : null;
          const showRec = tier && tier.label === 'فرصة تحسين';
          return `
          <div style="margin-bottom:14px;">
            <label style="font-size:13px; color:var(--navy); display:block; margin-bottom:6px; font-weight:700;">${num}. ${esc(INDICATORS[num].label)}</label>
            <select class="cv-rating-select" data-indicator="${num}">
              <option value="">اختر التقييم</option>
              ${INDICATORS[num].options.map(o => `<option value="${esc(o)}"${o === currentVal ? ' selected' : ''}>${esc(o)}</option>`).join('')}
            </select>
            <div class="cv-rec-wrap" data-indicator="${num}" style="margin-top:6px; ${showRec ? '' : 'display:none;'}">
              <input type="text" class="cv-rec-input" data-indicator="${num}" placeholder="التوصية (تظهر عند اختيار «فرصة تحسين»)" value="${esc(currentRec)}" style="font-size:12.5px;" />
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}

    <div class="form-card">
      <h4>بيانات ختامية</h4>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">ارتقاء (رياضيات - لغتي)</label>
      <div style="display:flex; gap:16px; margin-bottom:14px;">
        ${['يوجد', 'لا يوجد', 'لا ينطبق'].map(v => `
          <label style="font-size:13px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="radio" name="cv-upgrade" value="${v}" style="width:auto;"${existing?.upgrade_math_lughati === v ? ' checked' : ''} /> ${v}
          </label>`).join('')}
      </div>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">داعم (مجتمعات التعلم المهنية - علاج التعثر)</label>
      <div style="display:flex; gap:16px; margin-bottom:14px;">
        ${['يوجد', 'لا يوجد'].map(v => `
          <label style="font-size:13px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="radio" name="cv-support" value="${v}" style="width:auto;"${existing?.support_plc === v ? ' checked' : ''} /> ${v}
          </label>`).join('')}
      </div>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الجوانب الإيجابية</label>
      <textarea id="cv-positive" rows="3" placeholder="يمكنك تركه فارغ" style="margin-bottom:14px;">${esc(existing?.positive_aspects || '')}</textarea>
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">فرص التحسين</label>
      <div style="margin-bottom:6px;">
        <label style="font-size:13px; display:flex; align-items:center; gap:6px; font-weight:400;">
          <input type="checkbox" id="cv-improve-above" style="width:auto;"${existing?.improvement_mentioned_above ? ' checked' : ''} /> تم ذكرها أعلاه
        </label>
      </div>
      <input type="text" id="cv-improve-other" placeholder="غير ذلك" value="${esc(existing?.improvement_other || '')}" style="margin-bottom:14px;" />
      <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">الاحتياج التدريبي المقترح</label>
      <textarea id="cv-training" rows="3" placeholder="يمكنك تركه فارغ">${esc(existing?.training_need || '')}</textarea>
    </div>

    <div class="error-msg" id="cv-save-error"></div>
    <button class="btn-primary" id="cv-save-btn" style="width:auto; padding:12px 26px;">${isEdit ? 'حفظ التعديلات' : 'حفظ الزيارة'}</button>
  `;

  document.getElementById('cv-back-list-btn').addEventListener('click', () => { cvEditingVisit = null; cvView = 'list'; renderView(); });
  document.getElementById('cv-visit-date').value = existing?.visit_date || todayIso();

  renderGradeTabs();
  await refreshSectionOptions();
  if (isEdit) {
    document.getElementById('cv-section-select').value = String(existing.class_section);
    await loadScheduleForSlotPicker();
    updateSlotInfo();
  }

  document.getElementById('cv-day-select').addEventListener('change', updateSlotInfo);
  document.getElementById('cv-period-select').addEventListener('change', updateSlotInfo);

  // إظهار/إخفاء حقل "التوصية" وتعبئته تلقائيًا لما يتغيّر التقييم إلى "فرصة تحسين"
  container.querySelectorAll('.cv-rating-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const num = sel.dataset.indicator;
      const wrap = container.querySelector(`.cv-rec-wrap[data-indicator="${num}"]`);
      const input = container.querySelector(`.cv-rec-input[data-indicator="${num}"]`);
      const tier = sel.value ? tierForOption(num, sel.value) : null;
      if (tier && tier.label === 'فرصة تحسين') {
        wrap.style.display = '';
        if (!input.value && RECOMMENDATIONS[num]) input.value = RECOMMENDATIONS[num];
      } else {
        wrap.style.display = 'none';
      }
    });
  });

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
  const recommendations = {};
  const ratingSelects = Array.from(document.querySelectorAll('.cv-rating-select'));
  for (const sel of ratingSelects) {
    if (!sel.value) { errEl.textContent = `أكمل تقييم كل المؤشرات (${INDICATORS[sel.dataset.indicator].label})`; sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ratings[sel.dataset.indicator] = sel.value;
    const recInput = document.querySelector(`.cv-rec-input[data-indicator="${sel.dataset.indicator}"]`);
    const tier = tierForOption(sel.dataset.indicator, sel.value);
    if (tier && tier.label === 'فرصة تحسين' && recInput && recInput.value.trim()) {
      recommendations[sel.dataset.indicator] = recInput.value.trim();
    }
  }

  const strategies = Array.from(document.querySelectorAll('.cv-strategy-cb:checked')).map(cb => cb.value);
  const strategiesOtherChecked = document.getElementById('cv-strategy-other-cb').checked;
  const strategiesOther = strategiesOtherChecked ? document.getElementById('cv-strategy-other-text').value.trim() : null;

  const upgradeEl = document.querySelector('input[name="cv-upgrade"]:checked');
  const supportEl = document.querySelector('input[name="cv-support"]:checked');

  const payload = {
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
    recommendations,
    upgrade_math_lughati: upgradeEl ? upgradeEl.value : null,
    support_plc: supportEl ? supportEl.value : null,
    positive_aspects: document.getElementById('cv-positive').value.trim() || null,
    improvement_mentioned_above: document.getElementById('cv-improve-above').checked,
    improvement_other: document.getElementById('cv-improve-other').value.trim() || null,
    training_need: document.getElementById('cv-training').value.trim() || null,
  };

  let error;
  if (cvEditingId) {
    payload.updated_at = new Date().toISOString();
    ({ error } = await sb.from('classroom_visits').update(payload).eq('id', cvEditingId));
  } else {
    payload.visitor_id = currentUserId;
    payload.visitor_role = currentProfile.role;
    payload.published = false;
    ({ error } = await sb.from('classroom_visits').insert(payload));
  }
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; return; }

  cvEditingVisit = null;
  cvView = 'list';
  renderView();
}

/* ================= طباعة تقرير PDF ================= */
// يطابق تصميم النموذج الرسمي (الهيئة الملكية للجبيل وينبع): شريط كباتن أزرق كنجي، عمود "التوصية" يظهر
// فقط للمؤشرات اللي تقديرها "فرصة تحسين"، وتذييل بشريط أزرق فيه دليل الرموز.
function printVisitReport(v) {
  const dayLabel = (DAYS.find(d => d.key === v.day_of_week) || {}).label || v.day_of_week;

  const sectionHtml = (title) => `
    <tr class="sec-row"><td colspan="3">${esc(title)}</td></tr>
    <tr class="col-heads"><td>مؤشر الأداء</td><td>التقدير</td><td>التوصية</td></tr>`;

  const rowHtml = (num) => {
    const selected = (v.ratings || {})[num] || '';
    const tier = selected ? tierForOption(num, selected) : null;
    const rec = (v.recommendations || {})[num] || '';
    const tierClass = tier ? ({ 'مميز': 'tier-star', 'حقق الهدف': 'tier-ok', 'فرصة تحسين': 'tier-improve' }[tier.label] || '') : '';
    return `<tr>
      <td class="ind-cell"><b>${esc(INDICATORS[num].label)}</b><div class="ind-val">${esc(selected || '-')}</div></td>
      <td class="tier-cell ${tierClass}">${tier ? `${tier.symbol}<br>${esc(tier.label)}` : '-'}</td>
      <td class="rec-cell">${esc(rec || '-')}</td>
    </tr>`;
  };

  const sectionsHtml = `
    <table class="ratings">
      <tbody>
        ${SECTIONS.map(sec => sectionHtml(sec.title) + sec.nums.map(rowHtml).join('')).join('')}
      </tbody>
    </table>`;

  const strategiesText = [...(v.strategies || []), v.strategies_other ? `أخرى: ${v.strategies_other}` : null].filter(Boolean).join('، ') || '-';
  const improvementText = [(v.improvement_mentioned_above ? 'تم ذكرها أعلاه' : null), v.improvement_other].filter(Boolean).join('، ') || '-';
  const visitorLabel = v.visitor_role === 'admin' ? 'مدير المدرسة' : 'وكيل المدرسة';

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
  @page { size: A4; margin: 10mm; }
  body { font-family: 'Tahoma', 'Arial', sans-serif; padding: 0; margin: 0; color:#16233A; font-size:12px; }
  .doc { width: 100%; max-width: 190mm; margin: 0 auto; }

  .header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:8px; }
  .header .logo-side { width: 42mm; flex-shrink:0; }
  .header .logo-side img { max-width: 42mm; max-height: 15mm; }
  .header .titles { flex:1; text-align:center; }
  .header .titles h1 { font-size:17px; margin:0; color:#16233A; }
  .header .titles .dept { font-size:11px; color:#1D3F73; font-weight:700; margin:2px 0 0; }
  .header-bar { height:5px; background:linear-gradient(90deg,#16233A,#1D5FA6); border-radius:3px; margin-bottom:12px; }

  table.meta { width:100%; border-collapse:collapse; margin-bottom:14px; }
  table.meta td { border:1px solid #cfd6e0; padding:6px 9px; font-size:11.5px; }
  table.meta td.label { background:#eef1f6; font-weight:700; color:#16233A; width:110px; }

  table.ratings { width:100%; border-collapse:collapse; margin-bottom:12px; table-layout:fixed; }
  table.ratings td { border:1px solid #cfd6e0; padding:6px 8px; font-size:10.5px; vertical-align:middle; }
  tr.sec-row td { background:#16233A; color:#fff; font-weight:700; font-size:12.5px; padding:7px 10px; }
  tr.col-heads td { background:#dbe3ee; color:#16233A; font-weight:700; text-align:center; font-size:10.5px; }
  tr.col-heads td:first-child, tr.sec-row td { text-align:right; }
  td.ind-cell { text-align:right; width:46%; }
  td.ind-cell .ind-val { font-weight:400; color:#333; margin-top:2px; }
  td.tier-cell { text-align:center; width:16%; font-weight:700; }
  td.tier-cell.tier-ok { color:#1f8a4c; }
  td.tier-cell.tier-improve { color:#c0392b; }
  td.tier-cell.tier-star { color:#b8860b; }
  td.rec-cell { text-align:right; width:38%; color:#333; }

  .extra-box { border:1px solid #cfd6e0; border-radius:5px; padding:7px 10px; margin-bottom:8px; font-size:11.5px; display:flex; gap:8px; }
  .extra-box .lbl { font-weight:700; color:#16233A; flex-shrink:0; }
  .extra-box.positive { background:#eaf7ee; }
  .extra-box.improve { background:#fdecea; }

  .sign { display:flex; justify-content:space-between; margin-top:22px; gap:14px; }
  .sign > div { flex:1; text-align:center; font-size:11.5px; }
  .sign .box { margin-top:8px; border:1px solid #cfd6e0; border-radius:6px; height:54px; display:flex; flex-direction:column; justify-content:center; padding:6px 8px; }
  .sign .box .name { color:#16233A; font-weight:700; font-size:12px; }

  .footer-bar { margin-top:16px; background:#16233A; color:#fff; border-radius:5px; padding:6px 12px; display:flex; justify-content:space-between; align-items:center; font-size:10.5px; }
  .footer-bar .legend span { margin-inline-start:12px; }

  @media print { .footer-bar { position: fixed; bottom: 0; left: 10mm; right: 10mm; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="header">
      <div class="logo-side">${logoHtml}</div>
      <div class="titles">
        <h1>تقرير زيارة صفية</h1>
        <p class="dept">${esc(ORG_NAME)}</p>
      </div>
      <div class="logo-side"></div>
    </div>
    <div class="header-bar"></div>

    <table class="meta">
      <tr><td class="label">اسم المعلم</td><td>${esc(v.teacher_name)}</td><td class="label">التخصص</td><td>${esc(v.specialization || '-')}</td></tr>
      <tr><td class="label">مادة التدريس</td><td>${esc(v.subject_name)}</td><td class="label">الموضوع</td><td>${esc(v.lesson_topic || '-')}</td></tr>
      <tr><td class="label">الصف</td><td>${gradeLabels[v.grade_level] || v.grade_level}</td><td class="label">الشعبة</td><td>${v.class_section}</td></tr>
      <tr><td class="label">اليوم</td><td>${dayLabel}</td><td class="label">الحصة</td><td>${v.period_number}</td></tr>
      <tr><td class="label">التاريخ</td><td>${fmtDate(v.visit_date)}</td><td class="label">الهدف من الزيارة</td><td>${esc(v.visit_purpose || '-')}</td></tr>
      <tr><td class="label">الاستراتيجيات المطبقة</td><td colspan="3">${esc(strategiesText)}</td></tr>
    </table>

    ${sectionsHtml}

    <div class="extra-box"><span class="lbl">ارتقاء (رياضيات - لغتي):</span>${esc(v.upgrade_math_lughati || '-')}</div>
    <div class="extra-box"><span class="lbl">داعم (مجتمعات التعلم المهنية - علاج التعثر):</span>${esc(v.support_plc || '-')}</div>
    <div class="extra-box positive"><span class="lbl">الجوانب الإيجابية:</span>${esc(v.positive_aspects || '-')}</div>
    <div class="extra-box improve"><span class="lbl">فرص التحسين:</span>${esc(improvementText)}</div>
    <div class="extra-box"><span class="lbl">الاحتياج التدريبي المقترح:</span>${esc(v.training_need || '-')}</div>

    <div class="sign">
      <div>الزائر<div class="box"><div class="name">${esc(visitorLabel)}</div></div></div>
      <div>المعلم<div class="box"><div class="name">${esc(v.teacher_name)}</div></div></div>
    </div>

    <div class="footer-bar">
      <span>تمت الطباعة من نظام إدارة المدرسة — ${fmtDate(todayIso())}</span>
      <span class="legend"><span>⭐ مميز</span><span>✓ حقق الهدف</span><span>➔ فرصة تحسين</span></span>
    </div>
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
