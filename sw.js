const VERSION = 'v1.1.2'; // עדכן ידנית בכל דיפלוי משמעותי — שינוי הגרסה מנקה את המטמון הישן אוטומטית
const CACHE_NAME = `im-here-${VERSION}`;

// קבצי ה"מעטפת" של האפליקציה — נשמרים במטמון מיד בהתקנה כדי שהאפליקציה תיפתח
// גם באופליין גמור, כולל בפעם הראשונה שנפתחת לאחר ההתקנה.
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './micon.png',
    './micon2.png',
    './micon4.png',
];

// דומיינים של Firebase/Firestore/Auth — לעולם לא ליירט או לשמור במטמון. יש להם
// מנגנון ה-sync/streaming/offline-persistence משלהם (כולל, כעת, persistentLocalCache
// בקוד האפליקציה עצמו), וכל התערבות של ה-SW עלולה לשבור חיבורי long-polling/סטרימינג
// חיים או ליצור התנהגות כפולה. תמיד עובר ישירות לרשת, ללא נגיעה.
const NEVER_INTERCEPT_HOSTS = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'www.googleapis.com',
];

// כתובת ה-CDN הקבועה (מגרסה נעולה) של ה-SDK של Firebase — בטוח לחלוטין לשמור
// במטמון cache-first, כי כל שינוי גרסה משנה את ה-URL עצמו.
const FIREBASE_SDK_HOST = 'www.gstatic.com';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch((err) => console.warn('SW precache failed (non-fatal):', err))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // never intercept writes

    const url = new URL(req.url);

    // Firebase/Firestore/Auth traffic — always straight to network, untouched.
    if (NEVER_INTERCEPT_HOSTS.includes(url.hostname)) return;

    // App navigation (loading/reloading the page itself): network-first, so anyone
    // online always gets the latest deployed code, falling back to the cached shell
    // the moment the network is unavailable — this is what makes the app open at all
    // with no connection.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
                    return res;
                })
                .catch(() => caches.match('./index.html').then((res) => res || caches.match('./')))
        );
        return;
    }

    // Pinned-version Firebase SDK files: cache-first, since the URL itself is
    // version-locked and will never change contents.
    if (url.hostname === FIREBASE_SDK_HOST) {
        event.respondWith(
            caches.match(req).then((cached) => cached || fetch(req).then((res) => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                return res;
            }))
        );
        return;
    }

    // Everything else same-origin (manifest, icons, any future static asset):
    // cache-first with a background refresh, so it's instant AND stays current.
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                const networkFetch = fetch(req).then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    return res;
                }).catch(() => cached);
                return cached || networkFetch;
            })
        );
        return;
    }

    // Anything else (e.g. the on-demand eruda dev-console CDN script): let the
    // browser handle it normally, no SW involvement.
});

// =====================================================
// PUSH NOTIFICATIONS
// =====================================================
// No separate firebase-messaging-sw.js on purpose (see im-here push-notification
// work) — a second service worker would compete with this one for the same
// scope/lifecycle. Handling the raw Web Push 'push' event ourselves means we're
// fully responsible for calling showNotification (the browser will NOT
// auto-display anything on our behalf once a 'push' listener exists), but it
// keeps everything — caching, offline shell, and now push — in one file.
//
// Payload shape sent by the Make.com scenario → FCM "Send a message" module:
// a `notification: {title, body}` block (rendered by us below) plus a
// `data: {url}` field carrying the in-app screen to open on click. Falls back
// gracefully if either block is missing so a malformed/legacy payload still
// shows *something* rather than silently doing nothing.
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (err) {
        console.warn('Push payload was not valid JSON:', err);
    }

    const notif = payload.notification || {};
    const data = payload.data || {};

    const title = notif.title || data.title || 'Im Here';
    const body = notif.body || data.body || '';
    const targetUrl = data.url || './';

    const options = {
        body,
        icon: './micon2.png',
        badge: './micon4.png',
        dir: 'rtl',
        lang: 'he',
        data: { url: targetUrl },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Click handling: focus an already-open tab and navigate it to the relevant
// in-app screen if one exists, otherwise open a fresh tab there. Mirrors the
// "click navigates user to the relevant in-app screen" requirement from the
// push-notifications design.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const rawUrl = (event.notification.data && event.notification.data.url) || './';
    const targetUrl = new URL(rawUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url && new URL(client.url).origin === self.location.origin && 'focus' in client) {
                    if ('navigate' in client) {
                        return client.navigate(targetUrl).then((c) => c.focus());
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
