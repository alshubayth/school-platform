// Service Worker بسيط: يخزن الصفحة الأساسية للسماح بالتثبيت والعمل الجزئي بدون إنترنت
const CACHE_NAME = 'madrasa-almuruj-v1';

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
