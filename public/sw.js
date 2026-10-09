/* XTO Pizza service worker: images cache-first, everything else passes through to the network */
'use strict';
const CACHE = 'xto-images-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    '/images/icon-192.png', '/images/icon-512.png', '/images/mark.svg'
  ]).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // only intercept images; navigations, api and assets go straight to the network
  if (!url.pathname.startsWith('/images/')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});

/* ---- push notifications ---- */
self.addEventListener('push', (e) => {
  let data = { title: 'XTO Pizza', body: 'Tap for hot updates from the oven.', url: '/' };
  try { data = Object.assign(data, e.data.json()); } catch (err) {
    try { data.body = e.data.text(); } catch (err2) {}
  }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/images/icon-192.png',
    badge: '/images/icon-192.png',
    tag: data.tag || 'xto',
    data: { url: data.url || '/' },
    vibrate: [120, 60, 120]
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes(url.split('?')[0]) && 'focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});
