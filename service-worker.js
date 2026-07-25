/**
 * ============================================================
 * SERVICE-WORKER.JS — Sales Visit System
 * ============================================================
 * Bertanggung jawab untuk:
 * 1. Meng-cache seluruh file app-shell (HTML/CSS/JS/manifest)
 *    saat instalasi pertama, supaya PWA tetap BISA DIBUKA
 *    walau tidak ada koneksi internet.
 * 2. Menyajikan file dari cache lebih dulu (cache-first) untuk
 *    file statis, dengan fallback ke jaringan jika belum ter-cache.
 * 3. TIDAK ikut campur pada request POST ke Apps Script (API) —
 *    permintaan data selalu diteruskan langsung ke jaringan,
 *    penanganan offline untuk data dilakukan di script.js
 *    (OfflineQueue), bukan di sini.
 * ============================================================
 */

const CACHE_NAME = 'svs-cache-v3';

// PENTING: config.js SENGAJA TIDAK dimasukkan ke daftar precache ini.
// File itu berisi identitas sales yang wajar diedit sewaktu-waktu tanpa
// mengubah kode lain — kalau ikut di-cache-first, perubahan config.js
// di server tidak akan pernah terlihat sampai versi cache dinaikkan
// manual. Strategi khusus untuk config.js diatur terpisah di bagian
// fetch handler di bawah (selalu coba jaringan dulu / network-first).
const APP_SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './assets/fonts/inter-400.woff2',
  './assets/fonts/inter-500.woff2',
  './assets/fonts/inter-600.woff2',
  './assets/fonts/inter-700.woff2'
];

/**
 * Saat instalasi: simpan seluruh file app-shell ke cache.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

/**
 * Saat aktivasi: bersihkan cache versi lama jika ada
 * (misalnya setelah CACHE_NAME dinaikkan ke versi berikutnya).
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/**
 * Menangani setiap request jaringan dari halaman.
 *
 * Aturan:
 * - Hanya method GET yang ditangani oleh service worker ini.
 *   Request POST (semua panggilan action ke Apps Script) dibiarkan
 *   berjalan apa adanya, karena data tidak boleh "dianggap sukses"
 *   dari cache — penanganan gagal-kirim untuk data ditangani oleh
 *   OfflineQueue di script.js, bukan oleh service worker.
 * - Hanya request ke origin yang SAMA (file statis aplikasi sendiri)
 *   yang di-cache. Request ke domain Apps Script (origin berbeda)
 *   tidak pernah di-intercept di sini.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Khusus config.js: NETWORK-FIRST, bukan cache-first.
  // Selalu coba ambil versi terbaru dari server dulu — file ini berisi
  // identitas sales yang bisa berubah kapan saja tanpa deploy ulang
  // service worker. Cache hanya dipakai sebagai fallback saat benar-benar
  // tidak ada koneksi sama sekali.
  if (requestUrl.pathname.endsWith('config.js')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
