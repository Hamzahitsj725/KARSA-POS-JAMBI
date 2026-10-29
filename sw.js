/**
 * KARSA POS - PWA Service Worker (Offline Cache)
 * Memastikan aplikasi kasir tetap dapat dimuat dan dioperasikan meski tanpa koneksi internet
 */

const CACHE_NAME = 'simmarket-enterprise-v2.5';

const ASSETS = [
  './',
  './index.html',
  './register.html',
  './register.js',
  './app.js',
  './style.css',
  './manifest.json',
  './assets/karsa-pos-logo.png.png',
  './config/supabase.js',
  './services/state.js',
  './services/auth.js',
  './services/googleAuth.js',
  './services/roles.js',
  './services/db.js',
  './services/productValidation.js',
  './services/invitations.js',
  './services/offlineQueue.js',
  './services/notification.js',
  './modules/pos.js',
  './modules/inventory.js',
  './modules/members.js',
  './modules/suppliers.js',
  './modules/reports.js',
  './modules/ui.js'
];

// Pemasangan & Caching Asset
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async (asset) => {
      try {
        const response = await fetch(asset);
        if (response.ok) await cache.put(asset, response);
      } catch {
        // Optional offline assets must not prevent the worker from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

// Pembersihan Cache Versi Lama
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Menghapus cache usang:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Strategi Cache: Network-First dengan Cache Fallback untuk aset statis
self.addEventListener('fetch', (e) => {
  // Abaikan request POST/PUT/DELETE atau API Supabase luar agar tidak terintersepsi cache sembarangan
  if (e.request.method !== 'GET' || e.request.url.includes('supabase.co')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Jika berhasil mengambil dari jaringan, update cache secara background
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Jika offline atau jaringan terputus, ambil langsung dari cache lokal
        return caches.match(e.request);
      })
  );
});
