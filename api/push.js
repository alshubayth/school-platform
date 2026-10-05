// خادم إرسال إشعارات الجوال (Vercel Serverless)
// يستقبل الأحداث من قاعدة البيانات (pg_net) ويحدد المستلمين ويرسل لهم Web Push.
// متغيرات البيئة في Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY, PUSH_WEBHOOK_SECRET
const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sovfrlvcvcyjcyauurpl.supabase.co';
const GRADE_LABELS = {
  first_primary: 'أول ابتدائي', second_primary: 'ثاني ابتدائي', third_primary: 'ثالث ابتدائي',
  fourth_primary: 'رابع ابتدائي', fifth_primary: 'خامس ابتدائي', sixth_primary: 'سادس ابتدائي',
  first_intermediate: 'أول متوسط', second_intermediate: 'ثاني متوسط', third_intermediate: 'ثالث متوسط',
  first_secondary: 'أول ثانوي', second_secondary: 'ثاني ثانوي', third_secondary: 'ثالث ثانوي',
};
const WEEK_NAMES = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];
const gradeLabel = g => GRADE_LABELS[g] || g || '';
const weekName = n => 'الأسبوع ' + (WEEK_NAMES[n - 1] || n);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

// ---------- قراءة Supabase بمفتاح الخادم ----------
async function sbGet(path, deps) {
  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await deps.fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${path}`);
  return r.json();
}
async function sbDelete(path, deps) {
  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
  await deps.fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } });
}
const inList = ids => '(' + ids.map(encodeURIComponent).join(',') + ')';

// ---------- تحديد المستلمين والرسائل لكل حدث ----------
// يرجّع قائمة: [{ subs: [اشتراكات], title, body, url, tag }]
async function plan(ev, deps) {
  const school = ev.school_id;
  if (!school) return [];
  const [sc] = await sbGet(`schools?id=eq.${school}&select=slug,name`, deps);
  const slug = sc ? sc.slug : '';
  const parentUrl = '/parent.html?school=' + encodeURIComponent(slug);

  if (ev.type === 'plan_published' || ev.type === 'exams_published' || ev.type === 'exams_updated') {
    const subs = await sbGet(`push_subscriptions?school_id=eq.${school}&audience=eq.parent&select=*`, deps);
    if (ev.type === 'plan_published') {
      // الخطة تُنشر لكل الصفوف مرة وحدة - رسالة وحدة لكل جهاز، باسم صف الابن لو واحد
      return subs.map(s => {
        const grades = [...new Set((s.targets || []).map(t => t.grade).filter(Boolean))];
        const who = grades.length === 1 ? ' ل' + gradeLabel(grades[0]) : '';
        return { subs: [s], title: 'الخطة الأسبوعية', body: `نُشرت خطة ${weekName(ev.week_number)}${who}`, url: parentUrl, tag: 'plan-' + ev.week_number };
      });
    }
    const forGrade = subs.filter(s => (s.targets || []).some(t => t.grade === ev.grade_level));
    if (!forGrade.length) return [];
    const body = ev.type === 'exams_published'
      ? `نُشر جدول الاختبارات الفترية ل${gradeLabel(ev.grade_level)}`
      : `تم تحديث جدول الاختبارات الفترية ل${gradeLabel(ev.grade_level)}`;
    return [{ subs: forGrade, title: 'جدول الاختبارات', body, url: parentUrl + '#exams', tag: 'exams-' + ev.grade_level }];
  }

  if (ev.type === 'schedule_change') {
    // المعلم محفوظ بالجدول بالاسم: نربطه بحسابه عن طريق بوابة الموظفين أو اسم الحساب
    const name = norm(ev.teacher_name);
    const [emps, profs] = await Promise.all([
      sbGet(`employees?school_id=eq.${school}&select=full_name,profile_id`, deps).catch(() => []),
      sbGet(`profiles?school_id=eq.${school}&select=id,full_name`, deps),
    ]);
    const ids = new Set();
    emps.filter(e => e.profile_id && norm(e.full_name) === name).forEach(e => ids.add(e.profile_id));
    profs.filter(p => norm(p.full_name) === name).forEach(p => ids.add(p.id));
    if (!ids.size) return [];
    const subs = await sbGet(`push_subscriptions?audience=eq.staff&profile_id=in.${inList([...ids])}&select=*`, deps);
    if (!subs.length) return [];
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // توقيت الرياض
    const when = ev.change_date === today ? 'اليوم' : 'بتاريخ ' + ev.change_date;
    const cls = `${gradeLabel(ev.grade_level)} / ${ev.class_section}`;
    const what = ev.reason === 'substitute' ? 'عندك حصة انتظار' : 'تغيّر جدولك';
    return [{ subs, title: 'جدول اليوم', body: `${what} ${when}: الحصة ${ev.period_number} – ${cls}${ev.subject_name ? ' (' + ev.subject_name + ')' : ''}`,
      url: '/index.html', tag: `sch-${ev.change_date}-${ev.period_number}` }];
  }

  if (ev.type === 'op_pending') {
    const admins = await sbGet(`profiles?school_id=eq.${school}&role=eq.admin&select=id`, deps);
    if (!admins.length) return [];
    const subs = await sbGet(`push_subscriptions?audience=eq.staff&profile_id=in.${inList(admins.map(a => a.id))}&select=*`, deps);
    if (!subs.length) return [];
    const [who] = ev.profile_id ? await sbGet(`profiles?id=eq.${ev.profile_id}&select=full_name`, deps) : [];
    const from = who && who.full_name ? ` من ${norm(who.full_name)}` : '';
    const body = ev.kind === 'completion'
      ? (ev.count > 1 ? `${ev.count} مهام منفّذة تنتظر اعتمادك${from}` : `مهمة منفّذة تنتظر اعتمادك${from}`)
      : (ev.count > 1 ? `${ev.count} مهام جديدة تنتظر اعتمادك${from}` : `مهمة جديدة تنتظر اعتمادك${from}`);
    return [{ subs, title: 'الخطة التشغيلية', body, url: '/index.html#/plan', tag: 'op-pending' }];
  }

  if (ev.type === 'op_reviewed') {
    if (!ev.profile_id) return [];
    const subs = await sbGet(`push_subscriptions?audience=eq.staff&profile_id=eq.${ev.profile_id}&select=*`, deps);
    if (!subs.length) return [];
    const pre = ev.kind === 'completion' ? 'تنفيذ ' : '';
    const single = (ev.approved || 0) + (ev.rejected || 0) === 1;
    const parts = [];
    if (ev.approved) parts.push(single ? `تم اعتماد ${pre}مهمتك: ${ev.title}` : `تم اعتماد ${pre}${ev.approved} من مهامك`);
    if (ev.rejected) parts.push(single ? `تم رفض ${pre}مهمتك: ${ev.title}` : `تم رفض ${pre}${ev.rejected} من مهامك`);
    return [{ subs, title: 'الخطة التشغيلية', body: parts.join(' · '), url: '/index.html#/plan', tag: 'op-reviewed' }];
  }
  return [];
}

async function send(messages, deps) {
  let sent = 0, gone = 0, failed = 0;
  for (const m of messages) {
    for (const s of m.subs) {
      const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag, audience: s.audience });
      try {
        await deps.webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        // الاشتراك انتهى (حذف التطبيق أو ألغى الإذن) - نحذفه
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { gone++; await sbDelete(`push_subscriptions?id=eq.${s.id}`, deps); }
        else failed++;
      }
    }
  }
  return { sent, gone, failed };
}

async function handle(ev, deps) {
  const messages = await plan(ev, deps);
  return send(messages, deps);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!process.env.PUSH_WEBHOOK_SECRET || req.headers['x-push-secret'] !== process.env.PUSH_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  try {
    webpush.setVapidDetails('mailto:support@mudaar.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const ev = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await handle(ev || {}, { fetch, webpush, env: process.env });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
module.exports.handle = handle;
module.exports.plan = plan;
