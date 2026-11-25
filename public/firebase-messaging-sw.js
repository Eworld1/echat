/*
 * eChat push notifications (Firebase Cloud Messaging) - this file must stay at the ROOT of /public.
 *
 * Registered by the app with scope /firebase-cloud-messaging-push-scope (FCM's own scope), separate from
 * /sw.js (offline cache), so the two never replace each other. It has no install work, so it becomes
 * active almost instantly - push subscriptions need an ACTIVE worker.
 *
 * The eChat server sends data-only FCM messages; this worker draws them, so they arrive even when
 * eChat is closed. When eChat is open on screen, the app shows its own toast instead.
 * (The VAPID key is used by the page when it asks FCM for a token - see src/services/push.ts.)
 */
if (self.registration && self.registration.scope.includes('/firebase-cloud-messaging-push-scope')) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
}

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
