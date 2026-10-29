/* Bahr Network service worker: offline app shell + push notifications. */
const VERSION = 'bahr-v4';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/icon.svg', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/badge-96.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // API calls always go to the network (live data).
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;
  // Pages: network first so updates show immediately, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // App files: network first so a new deploy is picked up right away; cache is the offline fallback.
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }
  // Fonts rarely change: cache first.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Bahr Network', body: event.data && event.data.text() };
  }
  const title = data.title || 'Bahr Network';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: data.tag,
        renotify: !!data.tag,
        data: { url: data.url || '/' },
        vibrate: [60, 40, 60],
      }),
      // Tell open windows so they can refresh badges / feeds.
      self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'push', data }))),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const win = cs.find((c) => new URL(c.url).origin === location.origin);
      if (win) {
        win.navigate(target).catch(() => {});
        return win.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
