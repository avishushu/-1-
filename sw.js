//self.addEventListener('fetch', (event) => {
    // קובץ שירות בסיסי להפעלת PWA
//});

// קוד שירות יציב ומוכן לשימוש - מאפשר התקנת PWA בכרום
self.addEventListener('install', (event) => {
    // מפעיל את ה-Service Worker החדש מיד ללא המתנה
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // תופס שליטה על הדפים באופן מיידי
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // חובה עבור כרום: מאזין לבקשות ומביא את המידע ישירות מהרשת.
    // זה מונע בעיות קאש (Cache) בזמן שאתה מעדכן את האפליקציה.
    event.respondWith(
        fetch(event.request).catch(() => {
            // אם המשתמש באמת אופליין לחלוטין, הדפדפן יציג את ה-Cache הבסיסי של הדף הראשי
            return caches.match(event.request);
        })
    );
});
