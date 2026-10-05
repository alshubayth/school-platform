// Service Worker: التثبيت كتطبيق + استقبال إشعارات الجوال
const CACHE_NAME = 'mudaar-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // نمرر كل الطلبات للشبكة مباشرة (بياناتك دايمًا حديثة من Supabase)
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

/* ===== إشعارات الجوال ===== */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const isParent = d.audience === 'parent';
  event.waitUntil(self.registration.showNotification(d.title || (isParent ? 'خطة الأسبوع' : 'مُدار'), {
    body: d.body || '',
    icon: isParent ? 'icon-parent-192.png?v=3' : 'icon-192.png?v=3',
    badge: isParent ? 'icon-parent-192.png?v=3' : 'icon-192.png?v=3',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    dir: 'rtl',
    lang: 'ar',
    data: { url: d.url || (isParent ? '/parent.html' : '/index.html') },
  }));
});

// الضغط على الإشعار: يفتح التطبيق على الصفحة المعنية (أو يركّز على نافذة مفتوحة)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const samePage = wins.find(w => w.url.split('#')[0] === target.split('#')[0]);
    if (samePage) { await samePage.focus(); if (samePage.url !== target && 'navigate' in samePage) await samePage.navigate(target); return; }
    await self.clients.openWindow(target);
  })());
});
