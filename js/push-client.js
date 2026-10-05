/* إشعارات الجوال - أدوات مشتركة بين صفحة أولياء الأمور ومنصة الموظفين (سكربت عادي: window.MudaarPush)
 * الجهاز الواحد له اشتراك واحد بالمتصفح، ونفرّق بين "ولي أمر" و"موظف" بقاعدة البيانات (audience). */
(function () {
  const VAPID_PUBLIC_KEY = 'BNu2GGZ2cp0WI-apjduljCIgRCHVW8LbRzmVMdiOp36asZAq6C-lz1wrRqf0EkFDI7jFKAk7hNPrtUQaQQnMWNI';
  const FLAG = a => 'mudaar:push:' + a;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
               set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function registration() {
    if (!('serviceWorker' in navigator)) return null;
    await navigator.serviceWorker.register('sw.js').catch(() => null);
    return navigator.serviceWorker.ready;
  }
  async function currentSubscription() {
    if (!supported()) return null;
    const reg = await registration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  // الحالة: unsupported | ios-install | denied | on | off
  async function status(audience) {
    if (!supported()) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted' || ls.get(FLAG(audience)) !== '1') return 'off';
    return (await currentSubscription()) ? 'on' : 'off';
  }
  // يطلب الإذن ويرجّع بيانات الاشتراك { endpoint, p256dh, auth }
  async function subscribe() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  }
  function markOn(audience, on) { ls.set(FLAG(audience), on ? '1' : null); }
  window.MudaarPush = { status, subscribe, currentSubscription, markOn, isIOS, isStandalone };
})();
