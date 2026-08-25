const VERSION = 'v1.1.0'; // עדכן ידנית בכל דיפלוי משמעותי — שינוי הגרסה מנקה את המטמון הישן אוטומטית
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
