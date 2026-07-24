# SVS Frontend — Progressive Web App

Frontend Sales Visit System: HTML5 + CSS3 + Vanilla JavaScript, tanpa framework,
mobile-first, Material Design modern, siap PWA (installable + offline app-shell).

## Struktur File

| File | Peran |
|---|---|
| `index.html` | Struktur halaman — murni HTML, tidak ada JavaScript inline |
| `style.css` | Design token (warna/tipografi), layout, komponen, dark mode |
| `config.js` | Identitas sales aktif + URL Web App Apps Script (diisi per device) |
| `script.js` | Seluruh logika aplikasi, dibagi per modul dalam satu file |
| `manifest.json` | Metadata PWA (nama, ikon, warna tema, mode standalone) |
| `service-worker.js` | Caching app-shell untuk dukungan offline |

## Sebelum Dipakai — WAJIB Diisi

1. **`config.js`** — ganti `SALES_CODE`, `SALES_NAME`, `TOKEN` sesuai baris yang
   sudah didaftarkan di sheet `Sales_Master`, dan `API_URL` dengan URL Web App
   hasil deploy Apps Script.
2. **Ikon PWA** — siapkan 2 file ikon (`icon-192.png`, `icon-512.png`) di folder
   `assets/icons/`, sesuai yang direferensikan `manifest.json` dan
   `index.html` (apple-touch-icon). Tanpa ini, PWA tetap berjalan tapi ikon
   di homescreen akan kosong/default.
3. **Ikon** — seluruh ikon di aplikasi ini memakai emoji biasa (📍 📞 📄 🤝 dst),
   BUKAN font ikon khusus. Ini disengaja: memakai font ikon eksternal (seperti
   Material Symbols) berisiko tidak tampil saat aplikasi dibuka offline jika
   font tersebut belum sempat ter-cache. Emoji selalu tersedia di sistem
   operasi device, tanpa dependensi file tambahan.

## Alur Kerja yang Sudah Diimplementasikan

- **Dashboard** → memuat ringkasan follow up jatuh tempo + angka bulan berjalan
  dari `action: readDashboard`.
- **Tambah Project** (tombol FAB) → bottom sheet, lokasi diisi manual oleh
  sales (tanpa GPS), kirim `action: createProject`, otomatis lanjut ke
  Update Progress untuk kunjungan pertama.
- **Update Progress** → bottom sheet dengan 4 tombol jenis aktivitas, ambil
  foto (dikompresi otomatis via canvas sebelum dikirim), catatan, pipeline
  stage, alasan Lost kondisional, dan tombol cepat follow up. Foto diunggah
  lebih dulu (`action: uploadPhoto`) sebelum `action: createActivity` dikirim,
  sesuai Flow Photo Upload di Architecture Design.
- **Project List** ("Project Saya") → pencarian, quick filter chip, dan bottom
  sheet Filter lengkap (stage + produk), memanggil `action: filterProject`.
- **Activity Timeline** → dibuka dengan tap kartu project, memanggil
  `action: readActivityTimeline`, menampilkan histori kronologis + foto.
- **Offline Support** → jika `fetch` gagal karena tidak ada koneksi, data
  (create project/activity/photo) disimpan ke `localStorage` lewat modul
  `OfflineQueue`, lalu otomatis dikirim ulang saat event `online` terpicu.
  Banner kuning muncul di atas layar saat device terdeteksi offline.
- **Dark Mode** → mengikuti `prefers-color-scheme` sistem secara otomatis,
  dengan tombol toggle manual di header (disimpan ke `localStorage` supaya
  pilihan tetap tersimpan di kunjungan berikutnya).
- **Responsive** → `#app` dibatasi `max-width: 480px` dan dipusatkan di layar
  lebar (tablet/desktop), sehingga tetap terasa seperti aplikasi mobile
  meski dibuka di layar besar — sejalan dengan prinsip Mobile First.

## Catatan Teknis Penting

- **CORS ke Apps Script**: `script.js` mengirim request dengan header
  `Content-Type: text/plain;charset=utf-8` (bukan `application/json`) secara
  sengaja, untuk menghindari CORS preflight (`OPTIONS`) yang tidak ditangani
  Apps Script secara default. Backend tetap mem-parsing body ini sebagai JSON.
- **Role Manager**: ubah `SVS_CONFIG.ROLE` menjadi `'manager'` di `config.js`
  untuk device milik SPV/Manager — Dashboard otomatis menampilkan data
  seluruh tim (bukan hanya 1 sales). Halaman Dashboard Manager/Analytics yang
  lebih lengkap (funnel pipeline tim, ranking sales) belum termasuk di
  build ini — mengikuti scope V1 yang berfokus pada sisi Sales terlebih
  dahulu sesuai file Software Architecture sebelumnya.
- **Instalasi ke Homescreen**: buka aplikasi lewat URL hosting (lihat catatan
  hosting di bawah) di Chrome Android/Safari iOS, lalu pilih "Add to Home
  Screen" / "Install App".

## Hosting

File-file ini adalah static files biasa (tidak butuh Node.js/server backend
selain Apps Script) — bisa di-hosting lewat GitHub Pages, Google Sites (embed),
Firebase Hosting (tier gratis), atau layanan static hosting lain mana pun,
selama seluruh file tetap berada di folder yang sama seperti struktur di atas.
