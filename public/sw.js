/* Echat service worker: makes the app installable and fast, never touches live data. */
const VERSION = 'echat-v4';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/logo-mark-blue.svg', '/logo-blue.svg', '/logo-192.png', '/logo-512.png', '/apple-touch-icon.png', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API calls, uploads, sockets or other sites: they must always be live.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname === '/ws') return;

  // Page loads: network first, offline page if the network is down.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Built assets (hashed file names) and icons: cache first, fill the cache as they are used.
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|jpg|jpeg|webp|woff2?|mp3)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});

// ---------- Push notifications (Firebase Cloud Messaging) ----------
// The eChat server sends data-only FCM messages; this worker draws them, so they arrive even when
// eChat is closed. When eChat is open and on screen, the app already shows its own toast instead.
const readPush = (event) => {
  if (!event.data) return null;
  let raw;
  try { raw = event.data.json(); } catch { return { title: 'eChat', body: event.data.text() }; }
  const data = raw && typeof raw === 'object' ? (raw.data || raw) : {};
  const shown = raw && raw.notification ? raw.notification : {};
  return {
    title: data.title || shown.title || 'eChat',
    body: data.body || shown.body || '',
    url: data.url || '/home',
    tag: data.tag || undefined,
    icon: data.icon || shown.icon || '/logo-192.png',
    kind: data.kind || 'general',
    badge: Number(data.badge || 0)
  };
};

self.addEventListener('push', (event) => {
  const push = readPush(event);
  if (!push) return;
  event.waitUntil((async () => {
    if (push.badge > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(push.badge).catch(() => {});
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const onScreen = windows.find((client) => client.visibilityState === 'visible' && client.focused);
    if (onScreen) { onScreen.postMessage({ type: 'echat:push', push }); return; }
    await self.registration.showNotification(push.title, {
      body: push.body,
      icon: push.icon,
      badge: '/logo-192.png',
      tag: push.tag,
      renotify: Boolean(push.tag),
      data: { url: push.url, kind: push.kind },
      vibrate: [80, 40, 80]
    });
  })());
});

// Tapping a notification opens eChat on the right screen (the chat, Friends, the group...).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/home', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => c.url.startsWith(self.location.origin) && 'focus' in c);
      if (client) {
        client.postMessage({ type: 'echat:open', url });
        return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
