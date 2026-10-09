import { sb, currentUserId, currentProfile, gradeLabels, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool, academicCalendar, printOrgName, printLogo } from './core.js';
import { DAYS, PERIODS } from './schedule.js';
import { loadJSZip } from './lib-loader.js';

document.getElementById('back-to-tiles-14').addEventListener('click', backToTiles);

const GRADES = ['first_intermediate', 'second_intermediate', 'third_intermediate'];

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

// تعليقات جاهزة معتمدة من النموذج الرسمي (ملف بنود الزيارات المعتمد) - مفتاحة برقم المؤشر ثم فهرس الخيار داخل قائمة options
// كل مصفوفة بنفس طول options[]: نص تعليق لخيار "مميز" (فهرس 0) أو "فرصة تحسين" (الفهارس الوسطى)، وسلسلة فارغة لباقي الفهارس (حقق الهدف / لم يتم التقييم)
const OPTION_COMMENTS = {
  12: ['تميزكم في الإعداد له بالغ الأثر في تنظيم مجريات التدريس.', '', 'الالتزام بالخطة الفصلية، تمكن المعلم من إعطاء كل درس حقه.', 'بناء الإعداد واستكمال جميع عناصره تمكن المعلم من التخطيط الجيد.', 'إعداد الدرس هو خطة منظمة مقصودة يسير عليها المعلم مع طلابه من أجل تحقيق أهداف التعلم.', ''], // الإعداد للخطة والدرس
  13: ['تميزكم في تحديد أهدافكم وشموليتها ومراعاتها لمهارات التفكير العليا انعكس إيجابا على عملية التعلم ورفع مستوى التمكن لدى الطلاب.', '', 'قابلية القياس للأهداف شرط أساسي في بناء هدف صحيح، يؤدي إلى النتائج المرجوة من عملية التعلم.', 'شمولية الأهداف لجميع عناصر الدرس يجعل من الدرس كتلة واحده يمارسها الطالب ويبني عليها تعلمه اللاحق.', 'وجود الأهداف التعليمية هي الخطوة الأساسية لما سيقدم في الحصة وفي ضوئها يبني المعلم خطة سير الحصة.', ''], // تحديد الأهداف وشموليتها
  14: ['تميزكم واهتمامكم بالتنوع والابتكار في استراتيجيات التعلم انعكس إيجابا على المتعة والجودة في عملية التعلم.', '', 'انتقاء استراتيجيات التدريس أثناء الإعداد تمكن المعلم من تحديد الأدوار والمهام التي يقوم بها المعلم والمتعلم من أجل تحقيق أهداف الدرس، وتساعد في انتقاء الوسائل التعليمية المناسبة.', 'تحديد استراتيجيات التدريس أثناء الإعداد تمكن المعلم من تحديد الأدوار والمهام التي يقوم بها المعلم والمتعلم من أجل تحقيق أهداف الدرس، وتساعد في انتقاء الوسائل التعليمية المناسبة.', ''], // تحديد الاستراتيجيات المطبقة ومناسبتها
  15: ['تميزكم في تقديم التهيئة كان له الأثر في إثارة دافعية الطلاب .', '', 'الوقت المناسب للتهيئة يحقق الأهداف المرجو منها.', 'ارتباط التهيئة بالدرس يثير دافعية الطالب للتعلم.', 'وجود التهيئة  يسهم في بناء تعلم منظم.', ''], // تقديم التهيئة المناسبة
  16: ['تميزكم في عرض الأهداف ومناقشتها ساهم في توجيه الجهد وزيادة الدافعية.', '', 'مناسبة الأهداف يسهم في بناء معرفة الطلاب لمفاهيم الدرس.', 'معرفة الطلاب بأهداف الدرس يزيد من فرص التعلم وتوجيه الجهود.', ''], // أهداف الدرس
  17: ['تميزكم في اختيار طريقة التدريس المناسبة ساهم في تحقيق الأهداف.', '', 'مراعاة بيئة التعلم عند اختيار طريقة التدريس  يسهم في تحقيق الأهداف .', 'اختيار طريقة التدريس المناسبة يحقق أهداف الدرس.', ''], // طريقة التدريس وملاءمتها لتحقيق الأهداف
  18: ['تميزكم في توظيف البيئة المحيطة في مفاهيم الدرس وربطها بحياة المتعلم ساهم في بقاء أثر التعلم.', '', 'الاستفادة من البيئة المحيطة يسهم في بقاء أثر التعلم.', ''], // العلاقة بين الدرس والبيئة المحيطة
  19: ['تميزكم في اختيار الوسيلة المناسبة للدرس كان له الأثر في بقاء أثر التعلم.', '', 'الوسيلة المناسبة للدرس تسهم في بناء التعلم.', 'وجود الوسيلة المناسبة للدرس ضرورة لبناء التعلم.', ''], // فاعلية الوسيلة في تحقيق أهداف التعلم
  20: ['تميزكم مع طلابكم وتعزيز التفاعل الإيجابي وتعلم الأقران ساهم في فاعلية الأنشطة وتحقيق أهداف الدرس.', '', 'تفعيل دور جميع الطلاب في تنفيذ أنشطة الدرس يسهم في تنمية قدرات المتعلم وتحقيق الأهداف.', 'فاعلية الطالب في تنفيذ الأنشطة تنعكس إيجاباً على أدائه وتسهم في تحقيق الأهداف.', ''], // فاعلية الأنشطة الصفية ودور الطالب في تنفيذها
  21: ['تميزكم في مراعاة الفروق الفردية أثناء التدريس وتقديم الدعم اللازم لجميع فئات الطلاب حقق العدل في فرص التعلم وحقق الأهداف.', '', 'تقديم الدعم المناسب لجميع فئات الطلاب يسهم في تحقيق العدل في فرص التعلم ويحقق أهدافه.', 'التنويع في أساليب التدريس يسهم في مشاركة جميع الطلاب في عملية التعلم وتحقيق أهدافه.', ''], // مراعاة الفروق الفردية بين الطلاب
  22: ['تميزكم في إغلاق الدرس ساهم في إبراز وربط الأفكار الرئيسة للمتعلم.', '', 'تحديد المهام المطلوبة من المتعلم يسهم في تكامل بناء المعرفة.', 'تحديد الزمن المناسب لإغلاق الدرس يسهم في تنظيم إجراءات التعلم.', 'ربط الأفكار الرئيسة للدرس يسهم في تنظيم وتسلسل المعرفة.', 'إغلاق الدرس يسهم في تكامل وتنظيم المعرفة.', ''], // إغلاق الدرس
  23: ['تميزكم في تهيئة البيئة الصفية وتنظيمها ومناسبتها ساهم في تحقق الانضباط الصفي وتحفيز المتعلمين لعملية التعلم.', '', 'الانضباط الصفي يسهم في تحفيز المتعلمين للتعلم وتحقيق أهداف التعلم .', 'مناسبة البيئة لاستراتيجية التدريس يسهم في تنفيذها بشكل فاعل .', 'تنظيم البيئة الصفية يسهم في تحقيق أهداف الدرس.', ''], // البيئة الصفية
  24: ['تميزكم في مهارات التواصل ساهم في إدارة الصف بفاعلية وإبراز دور المتعلم في عملية التعلم.', '', 'التصرف الإيجابي في المواقف المختلفة يحقق التواصل الفعال.', 'تشجيع أفكار المتعلم يسهم في تحقيق التواصل الفعال.', 'التواصل الفعال بين أطراف العملية التعليمية يحقق أهداف التعلم.', ''], // مهارات التواصل
  25: ['تميزكم في إدارة وقت الحصة ساهم في استثماره بما يتناسب مع أنشطة الدرس وإجراءاته.', '', 'إعطاء المتعلم الوقت الكافي للتعلم يسهم في تحقيق أهداف التعلم بفاعلية.', 'توزيع الوقت بما تناسب مع مراحل التعلم يسهم في تحقيق أهدافها.', ''], // إدارة الوقت
  26: ['تميزكم في تفعيل مراحل التقويم وتفعيل الاستراتيجيات المناسبة وتقديم التغذية الراجعة ساهم في بقاء أثر التعلم.', '', 'تقديم التغذية الراجعة يسهم في بقاء أثر التعلم.', 'تفعيل جميع مراحل التقويم وتقديم التغذية الراجعة يسهم في بقاء أثر التعلم.', 'تفعيل مراحل التقويم وتقديم التغذية الراجعة يسهم في بقاء أثر التعلم.', ''], // مراحل التقويم والتغذية الراجعة
  27: ['تميزكم في تفعيل سجل المتابعة وتوظيفه في تحفيز وتعزيز وتعديل سلوكهم ساهم في تحسين نواتج التعلم.', '', 'تفعيل سجل المتابعة في مراحل التقويم المختلفة يسهم في تحفيز وتعزيز تعلم الطلاب وتعديل سلوكهم وتحسين نواتج التعلم.', 'تفعيل سجل المتابعة يسهم في تحفيز وتعزيز تعلم الطلاب وتعديل سلوكهم وتحسين نواتج التعلم.', ''], // توثيق التقويم والمهام الأدائية أثناء التدريس
  28: ['تميزكم في تنويع أساليب التقويم وأدواته وتوظيف التطبيقات والبرامج الإلكترونية ساهم في إيجاد بيئة تعلم فاعلة.', '', 'تنويع أساليب التقويم وأدواته يسهم في إيجاد بيئة تعلم فاعلة ويحسن من نواتج التعلم.', ''], // تنويع أساليب التقويم وأدواته (شفهي، كتابي الكتروني)
};

// تقدير كل خيار حسب ترتيبه (مطابق لملف "بنود الزيارات" الرسمي المعتمد):
// فهرس 0 = مميز، فهرس 1 = حقق الهدف، كل الفهارس من 2 حتى ما قبل الأخير = فرصة تحسين، والفهرس الأخير دايمًا "لم يتم تقييم..." ولا ياخذ تقدير
// الرموز مطابقة للنموذج الرسمي المعتمد: ✓ = حقق الهدف، ➔ = فرصة تحسين، ⭐ = مميز
function tierForOption(indicatorNum, optionText) {
  const opts = INDICATORS[indicatorNum].options;
  const idx = opts.indexOf(optionText);
  if (idx === -1 || idx === opts.length - 1) return null;
  if (idx === 0) return { label: 'مميز', symbol: '⭐' };
  if (idx === 1) return { label: 'حقق الهدف', symbol: '✓' };
  return { label: 'فرصة تحسين', symbol: '➔' };
}

let cvGrade = 'first_intermediate';
let cvSection = null;
let cvView = 'list'; // 'list' | 'form'
let cvSchedule = {}; // خريطة الحصص المتاحة للفصل المختار: "day-period" -> {subject, teacher}
let cvEditingId = null; // معرّف الزيارة الجاري تعديلها، أو null لو زيارة جديدة
let cvTeachers = []; // قائمة حسابات المعلمين المسجلين بالنظام: [{id, full_name}] — تُستخدم لربط الزيارة بحساب معلم فعلي (بدل الاعتماد على تطابق الاسم النصي في جدول الحصص فقط)

function normalizeArName(s) {
  return (s || '').trim().replace(/\s+/g, ' ');
}

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

/* ================= قائمة الزيارات: مجمّعة حسب المعلم ================= */
let cvFilter = 'all';     // all | draft | unvisited
let cvSearch = '';
let cvSpec = '';          // فلتر التخصص ('' = الكل)
let cvOpenTeachers = new Set();

// ملخص تقديرات زيارة: كم مؤشر مميز / حقق الهدف / فرصة تحسين
function visitTiers(v) {
  const t = { star: 0, ok: 0, imp: 0 };
  Object.entries(v.ratings || {}).forEach(([num, val]) => {
    if (!INDICATORS[num]) return;
    const tier = tierForOption(num, val);
    if (!tier) return;
    if (tier.label === 'مميز') t.star++; else if (tier.label === 'حقق الهدف') t.ok++; else t.imp++;
  });
  return t;
}
function daysAgo(iso) {
  if (!iso) return '';
  const d = Math.round((new Date(todayIso() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
  return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : d === 2 ? 'قبل يومين' : d <= 10 ? `قبل ${d} أيام` : `قبل ${d} يوم`;
}
function visitStatus(v) {
  if (!v.published) return { cls: 'draft', label: 'مسودة' };
  if (v.teacher_seen_at) return { cls: 'seen', label: 'اطّلع عليها المعلم' };
  return { cls: 'pub', label: 'منشورة للمعلم' };
}

async function renderList(container) {
  container.innerHTML = '<div class="tr-loading">جارٍ التحميل...</div>';
  const staff = isAdminOrDeputyHere();
  const [{ data, error }] = await Promise.all([
    readScopedBySchool(scoped => {
      let query = sb.from('classroom_visits').select('*, profiles!classroom_visits_visitor_id_fkey(full_name)');
      if (scoped && currentSchoolId) query = query.eq('school_id', currentSchoolId);
      return query.order('visit_date', { ascending: false }).order('created_at', { ascending: false });
    }),
    staff && !cvTeachers.length ? loadTeachersList() : Promise.resolve(),
  ]);
  const visits = data || [];
  // تخصص كل معلم: من «تخصصات المعلمين» (teacher_subjects)، ولو ما له تخصص مسجل ناخذه من زياراته
  const specMap = new Map(); // teacherId -> Set(أسماء المواد)
  if (staff) {
    const { data: ts } = await sb.from('teacher_subjects').select('teacher_id, subjects(name)');
    (ts || []).forEach(r => { const n = r.subjects && r.subjects.name; if (!n || !r.teacher_id) return; if (!specMap.has(r.teacher_id)) specMap.set(r.teacher_id, new Set()); specMap.get(r.teacher_id).add(n); });
  }

  // المعلم: نسجّل إنه اطّلع على زياراته المنشورة (لو عمود teacher_seen_at موجود)
  if (!staff) {
    const unseen = visits.filter(v => v.published && v.teacher_profile_id === currentUserId && 'teacher_seen_at' in v && !v.teacher_seen_at);
    if (unseen.length && typeof sb.rpc === 'function') sb.rpc('mark_visits_seen', { visit_ids: unseen.map(v => v.id) }).then(() => {}, () => {});
  }

  if (error) { container.innerHTML = `<div class="error-msg" style="display:block;">تعذر تحميل الزيارات: ${esc(error.message)}</div>`; return; }

  const teachers = groupVisitsByTeacher(visits);
  teachers.forEach(t => {
    t.visits.sort((a, b) => (b.visit_date || '').localeCompare(a.visit_date || ''));
    t.last = t.visits[0] ? t.visits[0].visit_date : null;
    t.tiers = t.visits.reduce((acc, v) => { const x = visitTiers(v); acc.star += x.star; acc.ok += x.ok; acc.imp += x.imp; return acc; }, { star: 0, ok: 0, imp: 0 });
    t.drafts = t.visits.filter(v => !v.published).length;
    t.subjects = [...new Set(t.visits.map(v => v.subject_name).filter(Boolean))];
  });
  // المعلمين اللي ما انزاروا من بداية العام الدراسي
  const yearStart = academicCalendar.start || '0000-00-00';
  const yearVisits = visits.filter(v => (v.visit_date || '') >= yearStart);
  const visitedIds = new Set(yearVisits.map(v => v.teacher_profile_id).filter(Boolean));
  const visitedNames = new Set(yearVisits.map(v => normalizeArName(v.teacher_name)).filter(Boolean));
  const unvisited = staff ? cvTeachers.filter(t => !visitedIds.has(t.id) && !visitedNames.has(normalizeArName(t.full_name))) : [];
  const idByName = new Map(cvTeachers.map(t => [normalizeArName(t.full_name), t.id]));
  const teacherIdOf = t => (t.key && !String(t.key).startsWith('name:') ? t.key : idByName.get(normalizeArName(t.name)) || null);
  const specsOfTeacher = (id, visitsList) => {
    const set = new Set(id && specMap.has(id) ? specMap.get(id) : []);
    if (!set.size) (visitsList || []).forEach(v => { const x = (v.specialization || v.subject_name || '').trim(); if (x) set.add(x); });
    return set;
  };
  teachers.forEach(t => { t.specs = specsOfTeacher(teacherIdOf(t), t.visits); });
  unvisited.forEach(t => { t.specs = specsOfTeacher(t.id, []); });
  // قائمة التخصصات مع عدد المعلمين اللي انزاروا من أصل الكل
  const specStats = new Map();
  const addStat = (spec, visited) => { if (!specStats.has(spec)) specStats.set(spec, { total: 0, visited: 0 }); const x = specStats.get(spec); x.total++; if (visited) x.visited++; };
  teachers.forEach(t => t.specs.forEach(sp => addStat(sp, true)));
  unvisited.forEach(t => t.specs.forEach(sp => addStat(sp, false)));
  const specNames = [...specStats.keys()].sort((a, b) => a.localeCompare(b, 'ar'));
  if (cvSpec && !specStats.has(cvSpec)) cvSpec = '';
  const monthStart = todayIso().slice(0, 8) + '01';
  const thisMonth = visits.filter(v => (v.visit_date || '') >= monthStart).length;
  const draftsAll = visits.filter(v => !v.published).length;

  let html = '';
  if (staff) {
    const totalT = cvTeachers.length;
    const visitedT = totalT ? totalT - unvisited.length : teachers.length;
    html += `
      <div class="cv-toolbar">
        <button class="btn-primary" id="cv-new-btn" style="width:auto; padding:11px 20px;">+ زيارة صفية جديدة</button>
        <div class="cv-tools">
          ${visits.length ? `<button class="btn-secondary" id="cv-dl-all-btn" style="width:auto; padding:10px 14px;">تحميل الكل (PDF)</button>` : ''}
        </div>
      </div>
      <div id="cv-dl-status" class="cv-dl-status"></div>
      <div class="kpi-grid">
        <div class="kpi"><span class="k-label">زيارات هذا الشهر</span><span class="k-value">${thisMonth}</span><span class="k-note">${visits.length} زيارة من بداية العام</span></div>
        <div class="kpi"><span class="k-label">المعلمين اللي انزاروا</span><span class="k-value">${visitedT}${totalT ? ` / ${totalT}` : ''}</span>${totalT ? `<div class="k-bar"><div style="width:${Math.round(visitedT / totalT * 100)}%;"></div></div>` : ''}<span class="k-note">من بداية العام الدراسي</span></div>
        <div class="kpi"><span class="k-label">ما انزاروا بعد</span><span class="k-value"${unvisited.length ? ' style="color:#A4501A;"' : ''}>${unvisited.length}</span><span class="k-note">${unvisited.length ? 'اضغط «ما انزاروا» تحت' : 'كل المعلمين انزاروا'}</span></div>
        <div class="kpi"><span class="k-label">مسودات غير منشورة</span><span class="k-value"${draftsAll ? ' style="color:#7A5410;"' : ''}>${draftsAll}</span><span class="k-note">ما يشوفها المعلم لين تنشرها</span></div>
      </div>
      <div class="tr-toolbar">
        <div class="seg-tabs" id="cv-filter">
          <button type="button" data-f="all">كل المعلمين <span class="tr-cnt">${teachers.length || ''}</span></button>
          <button type="button" data-f="draft">فيها مسودات <span class="tr-cnt">${teachers.filter(t => t.drafts).length || ''}</span></button>
          <button type="button" data-f="unvisited">ما انزاروا <span class="tr-cnt">${unvisited.length || ''}</span></button>
        </div>
        <select id="cv-spec" class="cv-spec" aria-label="فلتر التخصص">
          <option value="">كل التخصصات</option>
          ${specNames.map(n => `<option value="${esc(n)}"${cvSpec === n ? ' selected' : ''}>${esc(n)} (${specStats.get(n).visited}/${specStats.get(n).total})</option>`).join('')}
        </select>
        <input type="search" id="cv-search" class="cv-search" placeholder="ابحث باسم المعلم" value="${esc(cvSearch)}" />
      </div>
      <div id="cv-spec-sum"></div>`;
  } else {
    html += `<div class="cv-toolbar"><h3 class="cv-mine-title">زياراتي الصفية</h3><div id="cv-dl-status" class="cv-dl-status"></div></div>`;
  }
  html += '<div id="cv-board" class="cv-board"></div>';
  container.innerHTML = html;

  const board = document.getElementById('cv-board');
  const visitRow = (v) => {
    const st = visitStatus(v);
    const tiers = visitTiers(v);
    const dayLabel = (DAYS.find(d => d.key === v.day_of_week) || {}).label || v.day_of_week || '';
    const visitorRoleLabel = v.visitor_role === 'admin' ? 'المدير' : 'الوكيل';
    const visitorName = v.profiles?.full_name || null;
    return `<div class="cv-visit" data-id="${v.id}">
      <div class="cvv-main">
        <b>${fmtDate(v.visit_date)} · ${esc(v.subject_name || '')}</b>
        <span>${esc(gradeLabels[v.grade_level] || v.grade_level || '')}${v.class_section ? ' / فصل ' + esc(v.class_section) : ''}${dayLabel ? ' · ' + esc(dayLabel) : ''}${v.period_number ? ' · الحصة ' + esc(v.period_number) : ''} · زار: ${esc(visitorName || visitorRoleLabel)}</span>
      </div>
      <span class="cvv-tiers" title="مميز / حقق الهدف / فرصة تحسين"><i class="t-star">⭐ ${tiers.star}</i><i class="t-ok">✓ ${tiers.ok}</i><i class="t-imp">➔ ${tiers.imp}</i></span>
      <span class="cv-st ${st.cls}">${st.label}</span>
      <div class="cvv-actions">
        ${canEditVisit(v) ? `<button type="button" class="btn-secondary cv-edit-btn" data-id="${v.id}">تعديل</button>` : `<button type="button" class="btn-secondary cv-print-btn" data-id="${v.id}">عرض</button>`}
        <div class="row-menu">
          <button type="button" class="row-menu-btn" aria-label="خيارات أكثر" aria-haspopup="true">⋯</button>
          <div class="row-menu-pop hidden">
            <button type="button" class="cv-print-btn" data-id="${v.id}">طباعة</button>
            <button type="button" class="cv-dl-one-btn" data-id="${v.id}">تحميل PDF</button>
            ${staff ? `<button type="button" class="cv-publish-btn" data-id="${v.id}" data-current="${v.published}">${v.published ? 'إلغاء النشر' : 'نشر للمعلم'}</button>` : ''}
            ${canEditVisit(v) ? `<button type="button" class="cv-delete-btn danger" data-id="${v.id}">حذف</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  };

  const renderBoard = () => {
    document.querySelectorAll('#cv-filter button').forEach(b => b.classList.toggle('active', b.dataset.f === cvFilter));
    const q = cvSearch.trim();
    const match = name => !q || normalizeArName(name).includes(normalizeArName(q));
    if (!staff) {
      board.innerHTML = visits.length ? `<div class="cv-teacher open"><div class="cvt-visits">${visits.map(visitRow).join('')}</div></div>`
        : '<div class="ex-empty"><b>ما فيه زيارات منشورة لك بعد</b><span>تظهر هنا الزيارة بعد ما ينشرها المدير أو الوكيل.</span></div>';
      wireRows();
      return;
    }
    const specOk = t => !cvSpec || (t.specs && t.specs.has(cvSpec));
    const sumEl = document.getElementById('cv-spec-sum');
    if (sumEl) {
      if (!cvSpec) sumEl.innerHTML = '';
      else {
        const st = specStats.get(cvSpec) || { total: 0, visited: 0 };
        const missing = unvisited.filter(specOk);
        const nVis = teachers.filter(specOk).reduce((n, t) => n + t.visits.length, 0);
        sumEl.innerHTML = `<div class="cv-spec-sum"><div class="cvs-head"><b>${esc(cvSpec)}</b><span>انزار <strong>${st.visited}</strong> من ${st.total} ${st.total === 1 ? 'معلم' : 'معلمين'} · ${nVis} ${nVis === 1 ? 'زيارة' : nVis === 2 ? 'زيارتين' : 'زيارات'}</span>${st.total ? `<i class="cvs-bar"><i style="width:${Math.round(st.visited / st.total * 100)}%"></i></i>` : ''}</div>${missing.length ? `<div class="cvs-miss"><span>ما انزاروا:</span>${missing.map(t => `<em>${esc(t.full_name)}</em>`).join('')}</div>` : '<div class="cvs-miss done">كل معلمين هذا التخصص انزاروا ✓</div>'}</div>`;
      }
    }
    if (cvFilter === 'unvisited') {
      const list = unvisited.filter(t => match(t.full_name) && specOk(t));
      board.innerHTML = list.length ? `<div class="cv-unvisited">${list.map(t => `<div class="cvu-card"><span class="cvt-av">${esc(initialsOf(t.full_name))}</span><b>${esc(t.full_name)}</b><span>ما انزار من بداية العام</span></div>`).join('')}</div>`
        : `<div class="ex-empty"><b>${unvisited.length ? 'ما فيه نتائج' : 'كل المعلمين انزاروا من بداية العام'}</b></div>`;
      return;
    }
    let list = teachers.filter(t => match(t.name) && specOk(t));
    if (cvFilter === 'draft') list = list.filter(t => t.drafts);
    if (!list.length) {
      board.innerHTML = `<div class="ex-empty"><b>${visits.length ? 'ما فيه نتائج' : 'ما فيه زيارات مسجلة بعد'}</b>${visits.length ? '' : '<span>اضغط «+ زيارة صفية جديدة» وسجّل أول زيارة.</span>'}</div>`;
      return;
    }
    board.innerHTML = list.map(t => {
      const open = cvOpenTeachers.has(t.key);
      return `<div class="cv-teacher ${open ? 'open' : ''}" data-key="${esc(t.key)}">
        <button type="button" class="cvt-head">
          <span class="cvt-av">${esc(initialsOf(t.name))}</span>
          <span class="cvt-main"><b>${esc(t.name)}</b><span>${esc((t.specs && t.specs.size ? [...t.specs] : t.subjects).join('، '))}${t.last ? ` · آخر زيارة ${daysAgo(t.last)}` : ''}</span></span>
          <span class="cvt-tiers"><i class="t-star">⭐ ${t.tiers.star}</i><i class="t-ok">✓ ${t.tiers.ok}</i><i class="t-imp">➔ ${t.tiers.imp}</i></span>
          ${t.drafts ? `<span class="cv-st draft">${t.drafts} مسودة</span>` : ''}
          <span class="cvt-count">${t.visits.length}<small>${t.visits.length === 1 ? 'زيارة' : t.visits.length === 2 ? 'زيارتين' : 'زيارات'}</small></span>
          <svg class="cvt-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="cvt-body">
          <div class="cvt-visits">${t.visits.map(visitRow).join('')}</div>
          <div class="cvt-foot"><button type="button" class="text-action-btn cv-dl-teacher" data-key="${esc(t.key)}">تحميل كل زياراته (PDF)</button></div>
        </div>
      </div>`;
    }).join('');
    board.querySelectorAll('.cvt-head').forEach(h => h.addEventListener('click', () => {
      const card = h.closest('.cv-teacher'); const key = card.dataset.key;
      card.classList.toggle('open');
      if (card.classList.contains('open')) cvOpenTeachers.add(key); else cvOpenTeachers.delete(key);
    }));
    board.querySelectorAll('.cv-dl-teacher').forEach(btn => btn.addEventListener('click', async () => {
      const t = teachers.find(x => x.key === btn.dataset.key);
      if (!t) return;
      await runPdfJob(async (status) => {
        status(`جارٍ تجهيز تقارير ${t.name}...`);
        const ordered = [...t.visits].sort((a, b) => (a.visit_date || '').localeCompare(b.visit_date || ''));
        const blob = await visitsToPdfBlob(ordered, (i, n) => status(`جارٍ تجهيز تقارير ${t.name} (${i} من ${n})...`));
        saveBlob(blob, pdfFileName(t.name));
      });
    }));
    wireRows();
  };

  function wireRows() {
    board.querySelectorAll('.row-menu-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = btn.nextElementSibling;
      const willOpen = pop.classList.contains('hidden');
      document.querySelectorAll('.row-menu-pop').forEach(p => p.classList.add('hidden'));
      if (willOpen) pop.classList.remove('hidden');
    }));
    board.querySelectorAll('.cv-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const v = visits.find(x => x.id === btn.dataset.id);
      if (!v) return;
      cvEditingVisit = v; cvView = 'form'; renderView();
    }));
    board.querySelectorAll('.cv-print-btn').forEach(btn => btn.addEventListener('click', () => {
      const v = visits.find(x => x.id === btn.dataset.id);
      if (v) printVisitReport(v);
    }));
    board.querySelectorAll('.cv-dl-one-btn').forEach(btn => btn.addEventListener('click', async () => {
      const v = visits.find(x => x.id === btn.dataset.id);
      if (!v) return;
      await runPdfJob(async (status) => {
        status('جارٍ تجهيز الملف...');
        const blob = await visitsToPdfBlob([v]);
        saveBlob(blob, pdfFileName(v.teacher_name));
      });
    }));
    board.querySelectorAll('.cv-publish-btn').forEach(btn => btn.addEventListener('click', async () => {
      const current = btn.dataset.current === 'true';
      await sb.from('classroom_visits').update({ published: !current, updated_at: new Date().toISOString() }).eq('id', btn.dataset.id);
      renderView();
    }));
    board.querySelectorAll('.cv-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('تأكيد حذف هذي الزيارة نهائيًا؟')) return;
      await sb.from('classroom_visits').delete().eq('id', btn.dataset.id);
      renderView();
    }));
  }

  renderBoard();
  document.querySelectorAll('#cv-filter button').forEach(b => b.addEventListener('click', () => { cvFilter = b.dataset.f; renderBoard(); }));
  const search = document.getElementById('cv-search');
  if (search) search.addEventListener('input', () => { cvSearch = search.value; renderBoard(); });
  const specSel = document.getElementById('cv-spec');
  if (specSel) specSel.addEventListener('change', () => { cvSpec = specSel.value; if (cvSpec) cvOpenTeachers = new Set(teachers.filter(t => t.specs.has(cvSpec)).map(t => t.key)); renderBoard(); });

  const newBtn = document.getElementById('cv-new-btn');
  if (newBtn) newBtn.addEventListener('click', () => { cvEditingVisit = null; cvView = 'form'; renderView(); });

  const allBtn = document.getElementById('cv-dl-all-btn');
  if (allBtn) allBtn.addEventListener('click', async () => {
    await runPdfJob(async (status) => {
      if (teachers.length === 1) {
        status('جارٍ تجهيز الملف...');
        const blob = await visitsToPdfBlob(groupVisitsByTeacher(visits)[0].visits);
        saveBlob(blob, pdfFileName(teachers[0].name));
        return;
      }
      const grouped = groupVisitsByTeacher(visits);
      await loadJSZip();
      const zip = new window.JSZip();
      const usedNames = new Set();
      for (let i = 0; i < grouped.length; i++) {
        const t = grouped[i];
        status(`جارٍ تجهيز ملف ${i + 1} من ${grouped.length}: ${t.name}...`);
        const blob = await visitsToPdfBlob(t.visits);
        let name = pdfFileName(t.name);
        for (let n = 2; usedNames.has(name); n++) name = pdfFileName(`${t.name} (${n})`);
        usedNames.add(name);
        zip.file(name, blob);
      }
      status('جارٍ ضغط الملفات...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveBlob(zipBlob, `تقارير الزيارات الصفية - ${todayIso()}.zip`);
    });
  });
}
function initialsOf(name) { const p = String(name || '').trim().split(/\s+/); return (p[0] || '').charAt(0) + (p[1] ? ' ' + p[1].charAt(0) : ''); }
document.addEventListener('click', (e) => { if (!e.target.closest('.row-menu')) document.querySelectorAll('.row-menu-pop').forEach(p => p.classList.add('hidden')); });

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
      <div style="margin-top:12px;">
        <label style="font-size:12.5px; color:var(--slate); display:block; margin-bottom:6px; font-weight:600;">المعلم اللي زُرت حصته فعليًا</label>
        <select id="cv-teacher-select"><option value="">اختر المعلم</option></select>
        <div id="cv-teacher-hint" style="font-size:11.5px; color:var(--danger); margin-top:4px;"></div>
        <p style="font-size:11px; color:var(--slate); margin:6px 0 0;">يُختار تلقائيًا حسب الجدول الدراسي - لو الحصة كانت لمعلم بديل ذاك اليوم، غيّره يدويًا من القائمة للمعلم الصحيح.</p>
      </div>
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
          const tier = currentVal ? tierForOption(num, currentVal) : null;
          // لو الزيارة قديمة (قبل تفعيل التعليقات الرسمية لكل خيار) وما فيها ملاحظة محفوظة، نقترح التعليق الرسمي المقابل لنفس الخيار
          let currentRec = existing?.recommendations?.[num] || '';
          if (!currentRec && tier && (tier.label === 'فرصة تحسين' || tier.label === 'مميز')) {
            const idx = INDICATORS[num].options.indexOf(currentVal);
            currentRec = (OPTION_COMMENTS[num] || [])[idx] || '';
          }
          const showRec = tier && (tier.label === 'فرصة تحسين' || tier.label === 'مميز');
          const recPlaceholder = tier && tier.label === 'مميز' ? 'ملاحظة تميز (تظهر عند اختيار «مميز»)' : 'التوصية (تظهر عند اختيار «فرصة تحسين»)';
          return `
          <div style="margin-bottom:14px;">
            <label style="font-size:13px; color:var(--navy); display:block; margin-bottom:6px; font-weight:700;">${num}. ${esc(INDICATORS[num].label)}</label>
            <select class="cv-rating-select" data-indicator="${num}">
              <option value="">اختر التقييم</option>
              ${INDICATORS[num].options.map(o => `<option value="${esc(o)}"${o === currentVal ? ' selected' : ''}>${esc(o)}</option>`).join('')}
            </select>
            <div class="cv-rec-wrap" data-indicator="${num}" style="margin-top:6px; ${showRec ? '' : 'display:none;'}">
              <input type="text" class="cv-rec-input" data-indicator="${num}" placeholder="${esc(recPlaceholder)}" value="${esc(currentRec)}" style="font-size:12.5px;" />
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
  await loadTeachersList();
  if (isEdit) {
    document.getElementById('cv-section-select').value = String(existing.class_section);
    await loadScheduleForSlotPicker();
    updateSlotInfo();
    if (existing.teacher_profile_id) document.getElementById('cv-teacher-select').value = existing.teacher_profile_id;
  }

  document.getElementById('cv-day-select').addEventListener('change', updateSlotInfo);
  document.getElementById('cv-period-select').addEventListener('change', updateSlotInfo);

  // إظهار/إخفاء حقل "الملاحظة/التوصية" وتعبئته تلقائيًا (من النموذج الرسمي) لما يتغيّر التقييم إلى "مميز" أو "فرصة تحسين"
  container.querySelectorAll('.cv-rating-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const num = sel.dataset.indicator;
      const wrap = container.querySelector(`.cv-rec-wrap[data-indicator="${num}"]`);
      const input = container.querySelector(`.cv-rec-input[data-indicator="${num}"]`);
      const tier = sel.value ? tierForOption(num, sel.value) : null;
      if (tier && (tier.label === 'فرصة تحسين' || tier.label === 'مميز')) {
        wrap.style.display = '';
        input.placeholder = tier.label === 'مميز' ? 'ملاحظة تميز (تظهر عند اختيار «مميز»)' : 'التوصية (تظهر عند اختيار «فرصة تحسين»)';
        const idx = INDICATORS[num].options.indexOf(sel.value);
        const suggested = (OPTION_COMMENTS[num] || [])[idx] || '';
        if (!input.value && suggested) input.value = suggested;
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
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('class_schedules')
      .select('day_of_week, period_number, subject_name, teacher_name')
      .eq('grade_level', cvGrade).eq('class_section', cvSection);
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  (data || []).forEach(r => { cvSchedule[r.day_of_week + '-' + r.period_number] = { subject: r.subject_name || '', teacher: r.teacher_name || '' }; });
}

async function loadTeachersList() {
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('profiles').select('id, full_name').eq('role', 'teacher');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q.order('full_name');
  });
  cvTeachers = data || [];
  const sel = document.getElementById('cv-teacher-select');
  if (sel) sel.innerHTML = '<option value="">اختر حساب المعلم</option>' + cvTeachers.map(t => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('');
}

function updateSlotInfo() {
  const day = document.getElementById('cv-day-select').value;
  const period = document.getElementById('cv-period-select').value;
  const infoEl = document.getElementById('cv-slot-info');
  const teacherSel = document.getElementById('cv-teacher-select');
  const hintEl = document.getElementById('cv-teacher-hint');
  if (!cvSection || !day || !period) { infoEl.textContent = ''; return; }
  const cell = cvSchedule[day + '-' + period];
  if (!cell || !cell.subject) {
    infoEl.innerHTML = '<span style="color:var(--danger);">لا توجد مادة مسجلة بهذي الحصة بالجدول الدراسي — تأكد من اختيار الحصة الصحيحة أو حدّث الجدول أولًا.</span>';
    return;
  }
  infoEl.innerHTML = `المادة: <b>${esc(cell.subject)}</b> — المعلم المسجّل بالجدول: <b>${esc(cell.teacher || '-')}</b>`;

  // محاولة ربط تلقائي بين اسم المعلم المكتوب بجدول الحصص وحساب معلم فعلي على النظام
  // (الاسم بجدول الحصص نص حر ممكن ما يطابق حرفيًا اسم الحساب، فهذا الربط ضروري حتى يقدر المعلم يشوف زيارته)
  if (teacherSel) {
    const norm = normalizeArName(cell.teacher);
    const match = cvTeachers.find(t => normalizeArName(t.full_name) === norm);
    if (match) { teacherSel.value = match.id; if (hintEl) hintEl.textContent = ''; }
    else {
      teacherSel.value = '';
      if (hintEl) hintEl.textContent = 'تعذّر إيجاد حساب معلم مطابق تلقائيًا لاسم "' + (cell.teacher || '') + '" — اختر الحساب الصحيح يدويًا من القائمة أعلاه حتى يقدر المعلم يشوف هذي الزيارة.';
    }
  }
}

async function saveVisit() {
  const errEl = document.getElementById('cv-save-error');
  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; errEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  errEl.textContent = '';
  errEl.style.display = 'none';

  const day = document.getElementById('cv-day-select').value;
  const period = document.getElementById('cv-period-select').value;
  if (!cvSection || !day || !period) { showErr('اختر الفصل واليوم والحصة'); return; }
  const cell = cvSchedule[day + '-' + period];
  if (!cell || !cell.subject) { showErr('لا توجد مادة مسجلة بهذي الحصة بالجدول الدراسي'); return; }

  const teacherProfileId = document.getElementById('cv-teacher-select').value;
  if (!teacherProfileId) { showErr('اختر المعلم اللي زرت حصته من القائمة'); document.getElementById('cv-teacher-select').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  // اسم المعلم المحفوظ مع الزيارة يُؤخذ من المعلم المختار فعليًا بالقائمة (يدعم تغييره يدويًا لمعلم بديل)
  // بدل الاسم الثابت بالجدول الدراسي الرسمي
  const teacherAccount = cvTeachers.find(t => t.id === teacherProfileId);
  const effectiveTeacherName = teacherAccount ? teacherAccount.full_name : cell.teacher;

  const visitDate = document.getElementById('cv-visit-date').value;
  if (!visitDate) { showErr('حدد تاريخ الزيارة'); return; }

  let ratings = {};
  let recommendations = {};
  const ratingSelects = Array.from(document.querySelectorAll('.cv-rating-select'));
  for (const sel of ratingSelects) {
    if (!sel.value) { showErr(`أكمل تقييم كل المؤشرات (${INDICATORS[sel.dataset.indicator].label})`); sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ratings[sel.dataset.indicator] = sel.value;
    const recInput = document.querySelector(`.cv-rec-input[data-indicator="${sel.dataset.indicator}"]`);
    const tier = tierForOption(sel.dataset.indicator, sel.value);
    if (tier && (tier.label === 'فرصة تحسين' || tier.label === 'مميز') && recInput && recInput.value.trim()) {
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
    teacher_name: effectiveTeacherName,
    teacher_profile_id: teacherProfileId,
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
    ({ error } = await writeWithSchool(extra => sb.from('classroom_visits').insert({ ...payload, ...extra })));
  }
  if (error) { showErr('تعذر الحفظ: ' + error.message); return; }

  cvEditingVisit = null;
  cvView = 'list';
  renderView();
}

/* ================= طباعة تقرير PDF ================= */
// يطابق تصميم النموذج الرسمي (الهيئة الملكية للجبيل وينبع): شريط كباتن أزرق كنجي، عمود "التوصية" يظهر
// فقط للمؤشرات اللي تقديرها "فرصة تحسين"، وتذييل بشريط أزرق فيه دليل الرموز.
const VISIT_REPORT_STYLES = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  @page { size: A4; margin: 10mm; }
  body { font-family: 'Tahoma', 'Arial', sans-serif; padding: 0; margin: 0; color:#16233A; font-size:12px; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  }
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
  td.ind-cell { text-align:right; width:78%; }
  td.ind-cell .ind-val { font-weight:400; color:#333; margin-top:2px; }
  td.tier-cell { text-align:center; width:22%; font-weight:700; }
  td.tier-cell.tier-ok { color:#1f8a4c; }
  td.tier-cell.tier-improve { color:#c0392b; }
  td.tier-cell.tier-star { color:#b8860b; }
  tr.rec-row td { text-align:right; background:#fdf6e8; color:#7a5b00; font-size:10px; padding:5px 8px; }
  tr.rec-row.rec-star td { background:#eaf7ee; color:#1f6a3c; }

  .extra-box { border:1px solid #cfd6e0; border-radius:5px; padding:7px 10px; margin-bottom:8px; font-size:11.5px; display:flex; gap:8px; }
  .extra-box .lbl { font-weight:700; color:#16233A; flex-shrink:0; }
  .extra-box.positive { background:#eaf7ee; }
  .extra-box.improve { background:#fdecea; }

  .sign { display:flex; justify-content:space-between; margin-top:22px; gap:14px; }
  .sign > div { flex:1; text-align:center; font-size:11.5px; }
  .sign .box { margin-top:8px; border:1px solid #cfd6e0; border-radius:6px; height:54px; display:flex; flex-direction:column; justify-content:center; padding:6px 8px; }
  .sign .box .name { color:#16233A; font-weight:700; font-size:12px; }

  .footer-bar { margin-top:16px; background:#16233A; color:#fff; border-radius:5px; padding:6px 12px; display:flex; justify-content:space-between; align-items:center; font-size:10.5px; page-break-inside: avoid; break-inside: avoid; }
  .footer-bar .legend span { margin-inline-start:12px; }
`;

function buildVisitReportDoc(v) {
  const dayLabel = (DAYS.find(d => d.key === v.day_of_week) || {}).label || v.day_of_week;

  const sectionHtml = (title) => `
    <tr class="sec-row"><td colspan="2">${esc(title)}</td></tr>
    <tr class="col-heads"><td>مؤشر الأداء</td><td>التقدير</td></tr>`;

  const rowHtml = (num) => {
    const selected = (v.ratings || {})[num] || '';
    const tier = selected ? tierForOption(num, selected) : null;
    // لو ما فيه ملاحظة محفوظة بالزيارة (زيارات قديمة قبل تفعيل التعليقات الرسمية لكل خيار) نرجع للتعليق الرسمي المقابل لنفس الخيار تلقائيًا
    let rec = (v.recommendations || {})[num] || '';
    if (!rec && tier && (tier.label === 'فرصة تحسين' || tier.label === 'مميز')) {
      const idx = INDICATORS[num].options.indexOf(selected);
      rec = (OPTION_COMMENTS[num] || [])[idx] || '';
    }
    const tierClass = tier ? ({ 'مميز': 'tier-star', 'حقق الهدف': 'tier-ok', 'فرصة تحسين': 'tier-improve' }[tier.label] || '') : '';
    const recLabel = tier && tier.label === 'مميز' ? 'ملاحظة تميز' : 'التوصية';
    const recRowClass = tier && tier.label === 'مميز' ? 'rec-row rec-star' : 'rec-row';
    const recRow = rec
      ? `<tr class="${recRowClass}"><td colspan="2"><b>${recLabel}:</b> ${esc(rec)}</td></tr>`
      : '';
    return `<tr>
      <td class="ind-cell"><b>${esc(INDICATORS[num].label)}</b><div class="ind-val">${esc(selected || '-')}</div></td>
      <td class="tier-cell ${tierClass}">${tier ? esc(tier.label) : '-'}</td>
    </tr>${recRow}`;
  };

  const sectionsHtml = `
    <table class="ratings">
      <tbody>
        ${SECTIONS.map(sec => sectionHtml(sec.title) + sec.nums.map(rowHtml).join('')).join('')}
      </tbody>
    </table>`;

  const strategiesText = [...(v.strategies || []), v.strategies_other ? `أخرى: ${v.strategies_other}` : null].filter(Boolean).join('، ') || '-';
  const improvementText = [(v.improvement_mentioned_above ? 'تم ذكرها أعلاه' : null), v.improvement_other].filter(Boolean).join('، ') || '-';
  const visitorRoleLabel = v.visitor_role === 'admin' ? 'مدير المدرسة' : 'وكيل المدرسة';
  const visitorName = v.profiles?.full_name || null;
  const visitorLabel = visitorName ? `${visitorName} — ${visitorRoleLabel}` : visitorRoleLabel;

  const logoHtml = printLogo()
    ? `<img src="${printLogo()}" alt="الشعار" />`
    : '';

  return `<div class="doc">
    <div class="header">
      <div class="logo-side">${logoHtml}</div>
      <div class="titles">
        <h1>تقرير زيارة صفية</h1>
        <p class="dept">${esc(printOrgName())}</p>
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
      <span class="legend"><span>مميز</span><span>حقق الهدف</span><span>فرصة تحسين</span></span>
    </div>
  </div>`;
}

function printVisitReport(v) {
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>تقرير زيارة صفية — ${esc(v.teacher_name)}</title>
<style>${VISIT_REPORT_STYLES}</style>
</head>
<body>
${buildVisitReportDoc(v)}
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

/* ================= تحميل التقارير كملفات PDF (بدون نافذة طباعة) =================
 * التقرير يُرسم داخل iframe مخفي (عشان تنسيقات التقرير العامة مثل body و * ما تأثر على المنصة نفسها)،
 * ثم يُصوَّر بـ html2canvas ويُقسَّم لصفحات A4 عند حدود الصفوف/المربعات - ما ينقص سطر بنص الصفحة -
 * ويُجمع بـ jsPDF. كل زيارة تبدأ بصفحة جديدة. */
const PDF_LIBS = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};
const pdfLibPromises = {};
function loadPdfLib(key) {
  if (pdfLibPromises[key]) return pdfLibPromises[key];
  pdfLibPromises[key] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = PDF_LIBS[key];
    el.onload = resolve;
    el.onerror = () => { delete pdfLibPromises[key]; reject(new Error('تعذر تحميل مكتبة إنشاء PDF، تأكد من الاتصال بالإنترنت.')); };
    document.head.appendChild(el);
  });
  return pdfLibPromises[key];
}
async function loadPdfLibs() {
  if (!window.html2canvas) await loadPdfLib('html2canvas');
  if (!window.jspdf) await loadPdfLib('jspdf');
}

function groupVisitsByTeacher(visits) {
  const map = new Map();
  visits.forEach(v => {
    const key = v.teacher_profile_id || ('name:' + (v.teacher_name || ''));
    if (!map.has(key)) map.set(key, { key, name: v.teacher_name || 'بدون اسم', visits: [] });
    map.get(key).visits.push(v);
  });
  const list = [...map.values()];
  // داخل ملف المعلم: الأقدم أولًا (ترتيب زمني للتقارير)
  list.forEach(t => t.visits.sort((a, b) => (a.visit_date || '').localeCompare(b.visit_date || '')));
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

function pdfFileName(teacherName) {
  const clean = String(teacherName || 'تقرير زيارة').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${clean || 'تقرير زيارة'}.pdf`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let pdfJobRunning = false;
async function runPdfJob(job) {
  if (pdfJobRunning) return;
  pdfJobRunning = true;
  const statusEl = document.getElementById('cv-dl-status');
  const btns = document.querySelectorAll('#cv-dl-all-btn, #cv-dl-teacher-btn, .cv-dl-one-btn');
  const prevDisabled = [...btns].map(b => b.disabled);
  btns.forEach(b => { b.disabled = true; });
  const status = (msg) => { if (statusEl) { statusEl.style.color = 'var(--slate)'; statusEl.textContent = msg; } };
  try {
    await loadPdfLibs();
    await job(status);
    if (statusEl) { statusEl.style.color = 'var(--green, #1f8a4c)'; statusEl.textContent = 'تم التحميل ✓'; }
  } catch (err) {
    console.error(err);
    const msg = 'تعذر إنشاء ملف PDF: ' + (err && err.message ? err.message : err);
    if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = msg; } else alert(msg);
  } finally {
    btns.forEach((b, i) => { b.disabled = prevDisabled[i]; });
    pdfJobRunning = false;
  }
}

const PDF_PAGE_W_MM = 210, PDF_PAGE_H_MM = 297, PDF_MARGIN_MM = 10;
const PDF_CONTENT_W_MM = PDF_PAGE_W_MM - 2 * PDF_MARGIN_MM;
const PDF_CONTENT_H_MM = PDF_PAGE_H_MM - 2 * PDF_MARGIN_MM;
// عناصر ما ينفع تنقص بين صفحتين - الصفحة تنكسر قبلها مباشرة لو ما تكفي
const PDF_BREAK_SELECTOR = '.header, .header-bar, table.meta tr, table.ratings tr, .extra-box, .sign, .footer-bar';

async function visitsToPdfBlob(visitList, onProgress) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed; top:0; left:0; width:${PDF_CONTENT_W_MM}mm; height:${PDF_CONTENT_H_MM}mm; border:0; opacity:0; pointer-events:none; z-index:-9999;`;
  document.body.appendChild(iframe);

  try {
    for (let i = 0; i < visitList.length; i++) {
      if (onProgress) onProgress(i + 1, visitList.length);
      const idoc = iframe.contentDocument;
      idoc.open();
      idoc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${VISIT_REPORT_STYLES}
        html, body { background:#fff; width:${PDF_CONTENT_W_MM}mm; } .doc { max-width:none; }</style></head>
        <body>${buildVisitReportDoc(visitList[i])}</body></html>`);
      idoc.close();
      await Promise.all([...idoc.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      if (idoc.fonts && idoc.fonts.ready) await idoc.fonts.ready;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const docEl = idoc.querySelector('.doc');
      const docRect = docEl.getBoundingClientRect();
      const pxPerMm = docRect.width / PDF_CONTENT_W_MM;
      const totalH = docEl.scrollHeight;
      const pageH = PDF_CONTENT_H_MM * pxPerMm;
      const breakTops = [...idoc.querySelectorAll(PDF_BREAK_SELECTOR)]
        .map(el => el.getBoundingClientRect().top - docRect.top)
        .filter(t => t > 0).sort((a, b) => a - b);

      const scale = 2;
      const canvas = await window.html2canvas(docEl, {
        scale, useCORS: true, backgroundColor: '#ffffff',
        windowWidth: idoc.documentElement.scrollWidth, windowHeight: totalH,
      });
      if (!canvas.width || !canvas.height) throw new Error('الصورة الناتجة فارغة');

      // تحديد نقاط القطع: أبعد بداية عنصر تدخل بالصفحة الحالية
      const cuts = [];
      let start = 0;
      while (totalH - start > pageH + 1) {
        const limit = start + pageH;
        const candidates = breakTops.filter(t => t > start + 40 && t <= limit);
        const cut = candidates.length ? candidates[candidates.length - 1] : limit;
        cuts.push([start, cut]);
        start = cut;
      }
      cuts.push([start, totalH]);

      cuts.forEach(([from, to], pageIdx) => {
        const sliceH = Math.max(1, Math.round((to - from) * scale));
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceH;
        const ctx = slice.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, Math.round(from * scale), canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        if (i > 0 || pageIdx > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_CONTENT_W_MM, (to - from) / pxPerMm);
      });
    }
    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
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
