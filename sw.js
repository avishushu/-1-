const VERSION = 'v1.0.1'; // עדכן ידנית בכל דיפלוי משמעותי

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
    // קובץ שירות בסיסי — ללא caching, אבל דואג ש-SW חדש ייכנס לתוקף מיד
});
