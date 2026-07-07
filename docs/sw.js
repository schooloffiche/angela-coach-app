/* Coach — Angela: single service worker.
   Handles (1) offline app-shell caching so the PWA installs/opens instantly,
   and (2) Firebase Cloud Messaging background push notifications.
   Keeping both in ONE file avoids the two-service-workers-fighting-over-one-scope problem. */

const CACHE_NAME = 'coach-angela-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './firebase-config.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.includes('firestore.googleapis.com') || url.includes('googleapis.com')) return;

  // firebase-config.js can change (new keys, VAPID rotation) without the service
  // worker file itself changing, so it must never be served stale from cache —
  // always try the network first, and only fall back to cache if offline.
  if (url.includes('firebase-config.js')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first (with background refresh) for the rest of the app shell.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ── FIREBASE CLOUD MESSAGING (background push) ─────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');
importScripts('./firebase-config.js'); // defines self.firebaseConfig via `var firebaseConfig`

try {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const data = payload.notification || payload.data || {};
    const title = data.title || 'Coach Angela';
    const body = data.body || 'Check in now.';
    self.registration.showNotification(title, {
      body: body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'coach-angela-reminder',
      renotify: true,
      data: { url: './index.html' }
    });
  });
} catch (e) {
  // firebase-config.js not filled in yet — background push will silently no-op
  // until REPLACE_ME values are set. Foreground app still works fine.
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
