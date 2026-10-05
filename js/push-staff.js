/* إشعارات الجوال للموظفين: تفعيل/إيقاف من قائمة الحساب.
 * يوصل للمعلم: حصة انتظار أو تغيير بجدوله اليوم، ونتيجة اعتماد مهامه بالخطة التشغيلية.
 * ويوصل للمدير: المهام اللي تنتظر اعتماده. */
import { sb } from './core.js';

const btn = document.getElementById('push-toggle-btn');
const label = document.getElementById('push-toggle-label');

async function refresh() {
  if (!window.MudaarPush || !btn) return 'unsupported';
  const st = await MudaarPush.status('staff');
  label.textContent = st === 'on' ? 'الإشعارات مفعّلة ✓ (إيقاف)' : 'تفعيل الإشعارات على الجوال';
  return st;
}

function notify(msg) {
  let t = document.getElementById('push-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'push-toast'; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#0F2447;color:#fff;font-size:13px;font-weight:700;padding:11px 18px;border-radius:12px;max-width:min(92vw,460px);text-align:center;line-height:1.7;box-shadow:0 8px 24px rgba(16,23,40,.25);transition:opacity .2s;';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(notify._t); notify._t = setTimeout(() => { t.style.opacity = '0'; }, 4500);
}

btn && btn.addEventListener('click', async () => {
  document.getElementById('user-menu').classList.add('hidden');
  const st = await refresh();
  if (st === 'unsupported') { notify('جهازك أو متصفحك ما يدعم الإشعارات.'); return; }
  if (st === 'ios-install') { notify('في الآيفون: ثبّت التطبيق على الشاشة الرئيسية أولًا، وبعدها فعّل الإشعارات من داخله.'); return; }
  if (st === 'denied') { notify('الإشعارات مرفوضة لهذا الموقع. اسمح بها من إعدادات المتصفح أو الجوال ثم حاول مرة ثانية.'); return; }
  if (st === 'on') {
    try {
      const sub = await MudaarPush.currentSubscription();
      if (sub) await sb.rpc('push_unsubscribe', { p_endpoint: sub.endpoint, p_audience: 'staff' });
    } catch (e) { /* */ }
    MudaarPush.markOn('staff', false);
    await refresh();
    notify('تم إيقاف الإشعارات على هذا الجهاز');
    return;
  }
  try {
    const sub = await MudaarPush.subscribe();
    const { data, error } = await sb.rpc('push_subscribe_staff', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth });
    if (error || data !== true) throw new Error(error ? error.message : 'rejected');
    MudaarPush.markOn('staff', true);
    await refresh();
    notify('تم تفعيل الإشعارات ✓ يوصلك تنبيه بحصص الانتظار ونتائج اعتماد مهامك');
  } catch (err) {
    const m = String(err && err.message || '');
    notify(m === 'denied' ? 'رفضت الإذن. تقدر تسمح بالإشعارات من إعدادات المتصفح أو الجوال.'
      : m === 'dismissed' ? 'ما تم التفعيل. حاول مرة ثانية ووافق على الإذن.'
      : 'تعذر التفعيل حاليًا، حاول لاحقًا.');
  }
});

refresh();
