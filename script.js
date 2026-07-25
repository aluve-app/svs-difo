/**
 * ============================================================
 * SCRIPT.JS — Sales Visit System (Frontend Logic)
 * ============================================================
 * File ini murni JavaScript — TIDAK ADA HTML dicampur di sini.
 * Seluruh interaksi dipasang lewat addEventListener, bukan
 * atribut onclick di HTML, supaya struktur (index.html) dan
 * perilaku (script.js) tetap terpisah.
 *
 * Daftar bagian (modular per fungsi, dalam satu file sesuai
 * struktur yang diminta):
 *   1. STATE          — penyimpanan data sementara di memori
 *   2. UTILS          — fungsi bantu umum
 *   3. OFFLINE QUEUE  — antrian data saat tidak ada sinyal
 *   4. API            — komunikasi ke Google Apps Script
 *   5. SNACKBAR       — notifikasi singkat
 *   6. DARK MODE      — toggle tema
 *   7. RENDER: DASHBOARD
 *   8. RENDER: PROJECT LIST
 *   9. RENDER: TIMELINE
 *  10. SHEET: TAMBAH PROJECT
 *  11. SHEET: UPDATE PROGRESS
 *  12. SHEET: FILTER
 *  13. NAVIGASI / ROUTER
 *  14. INIT
 * ============================================================
 */

/* ============================================================
   1. STATE
   ============================================================ */
const State = {
  currentView: 'dashboard',
  currentProjectId: null,   // project yang sedang dibuka di Timeline / Update Progress
  currentProjectName: '',
  currentProjectStage: 'New Visit',

  selectedProductTypes: [],   // untuk form Tambah Project
  selectedActivityType: null, // untuk form Update Progress
  selectedLostReason: null,
  selectedFollowupDate: null,
  pendingPhotos: [],         // array of { base64, mimeType, previewUrl } — foto opsional, boleh lebih dari 1

  quickFilter: 'Semua',
  filterStage: '',
  filterProduct: '',
  searchKeyword: '',

  summaryData: { today: {}, week: {}, month: {} },
  selectedSummaryPeriod: 'today',

  projectsCache: [],
  contactsSummary: {}
};

/* ============================================================
   2b. ID GENERATOR (client-side)
   ============================================================
   Membuat ID di HP SEBELUM request dikirim ke server, dengan format
   yang sama seperti backend (PRJ-/ACT-/PHT-). Tujuannya supaya:
   1. Aplikasi bisa langsung lanjut ke langkah berikutnya tanpa menunggu
      balasan server (ID sudah pasti sejak awal).
   2. Kalau request perlu dikirim ulang (retry/sync setelah offline),
      ID yang dipakai TETAP SAMA — sehingga backend yang sudah idempotent
      bisa mendeteksi "ini permintaan yang sama" dan tidak membuat data
      dobel walau dikirim berkali-kali.
   ============================================================ */
const IdGen = {
  randomSuffix() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  },
  formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return '' + yyyy + mm + dd;
  },
  formatDateTime(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return this.formatDate(d) + hh + mi + ss;
  },
  projectId() { return 'PRJ-' + this.formatDate(new Date()) + '-' + this.randomSuffix(); },
  activityId() { return 'ACT-' + this.formatDateTime(new Date()) + '-' + this.randomSuffix(); },
  photoId() { return 'PHT-' + this.formatDateTime(new Date()) + '-' + this.randomSuffix(); },
  contactId() { return 'CNT-' + this.formatDate(new Date()) + '-' + this.randomSuffix(); }
};

/* ============================================================
   1b. ICONS (SVG kecil untuk konten yang di-render JS — supaya
   konsisten dengan chrome utama, bukan emoji yang beda-beda per HP)
   ============================================================ */
const Icons = {
  pin: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  tag: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  folder: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  user: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  phone: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  message: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  arrowRight: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  calendar: '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
};

/* ============================================================
   1c. LOOKUP CACHE — daftar pilihan (status pipeline, jenis aktivitas,
   jenis produk, alasan lost, role kontak) diambil dari sheet "Lookup"
   di backend, supaya menambah/mengurangi pilihan cukup edit Google
   Sheets, TANPA perlu ubah kode aplikasi.

   Strategi offline-aman:
   1. Simpan hasil terakhir yang berhasil dimuat ke localStorage —
      kunjungan berikutnya langsung pakai itu (instan, tidak nunggu
      server), sambil diam-diam cek versi terbaru di background.
   2. Kalau belum pernah berhasil sama sekali (device baru / sinyal
      pertama kali buka jelek), pakai DEFAULTS di bawah supaya
      aplikasi tetap bisa dipakai, tidak pernah kosong total.
   ============================================================ */
const LookupCache = {
  STORAGE_KEY: 'svs_lookup_options',

  DEFAULTS: {
    Activity_Type: ['Visit', 'Follow Up', 'Kirim Penawaran', 'Deal Update'],
    Pipeline_Stage: ['New Visit', 'Qualified', 'Quotation Sent', 'Negotiation', 'Won', 'Lost'],
    Product_Type: ['Kusen Aluminium', 'Pintu Aluminium', 'Jendela Aluminium', 'Curtain Wall', 'Railing', 'ACP', 'Facade'],
    Lost_Reason: ['Kalah Harga', 'Kalah Kompetitor', 'Proyek Batal', 'Spek Tidak Cocok'],
    Contact_Role: ['Owner', 'Developer', 'Kontraktor', 'Konsultan', 'Arsitek', 'Mandor', 'Project Manager', 'Purchasing']
  },

  get() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
      return saved || this.DEFAULTS;
    } catch (e) {
      return this.DEFAULTS;
    }
  },

  save(data) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },

  /** Ambil versi terbaru dari server (dipanggil di background saat app dibuka) */
  async refresh() {
    const result = await Api.call('readLookupOptions', {}, { noQueue: true }).catch(() => null);
    if (result && result.success && result.data) {
      this.save(result.data);
      return result.data;
    }
    return null;
  }
};

/* ============================================================
   1d. LOOKUP RENDERER — menggambar ulang 5 pemilih (chip/dropdown)
   berdasarkan data dari LookupCache. Dipanggil sekali saat app dibuka
   (pakai data cache/default, instan) dan sekali lagi kalau refresh()
   di background berhasil dapat data lebih baru.
   ============================================================ */
const LookupRenderer = {
  // Ikon per Jenis Aktivitas yang sudah dikenal — kalau ada nama baru
  // ditambahkan lewat sheet yang tidak ada di daftar ini, otomatis
  // pakai ikon fallback generik supaya tetap tampil rapi.
  ACTIVITY_ICONS: {
    'Visit': Icons.pin,
    'Follow Up': '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    'Kirim Penawaran': '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    'Deal Update': '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
  },
  ACTIVITY_ICON_FALLBACK: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',

  renderAll(data) {
    this.renderActivityTypeGrid(data.Activity_Type || []);
    this.renderPipelineStageSelect(data.Pipeline_Stage || []);
    this.renderProductTypeChips(data.Product_Type || []);
    this.renderLostReasonChips(data.Lost_Reason || []);
    this.renderContactRoleSelect(data.Contact_Role || []);
    this.renderFilterStageChips(data.Pipeline_Stage || []);
    this.renderFilterProductChips(data.Product_Type || []);
  },

  renderActivityTypeGrid(types) {
    const container = document.getElementById('activity-type-grid');
    const currentSelection = State.selectedActivityType;
    container.innerHTML = types.map((type) => {
      const icon = this.ACTIVITY_ICONS[type] || this.ACTIVITY_ICON_FALLBACK;
      const selectedClass = type === currentSelection ? ' selected' : '';
      return '<button class="activity-type-btn' + selectedClass + '" type="button" data-activity-type="' + type + '">' +
        icon + '<span>' + type + '</span></button>';
    }).join('');
  },

  renderPipelineStageSelect(stages) {
    const select = document.getElementById('select-pipeline-stage');
    const currentValue = select.value;
    select.innerHTML = stages.map((s) => '<option value="' + s + '">' + s + '</option>').join('');
    if (stages.includes(currentValue)) select.value = currentValue;
  },

  renderProductTypeChips(products) {
    const container = document.getElementById('product-type-chips');
    container.innerHTML = products.map((p) => {
      const selectedClass = State.selectedProductTypes.includes(p) ? ' selected' : '';
      return '<button class="chip' + selectedClass + '" type="button" data-product="' + p + '">' + p + '</button>';
    }).join('');
  },

  renderLostReasonChips(reasons) {
    const container = document.getElementById('lost-reason-chips');
    container.innerHTML = reasons.map((r) => {
      const selectedClass = r === State.selectedLostReason ? ' selected' : '';
      return '<button class="chip' + selectedClass + '" type="button" data-lost-reason="' + r + '">' + r + '</button>';
    }).join('');
  },

  renderContactRoleSelect(roles) {
    const select = document.getElementById('select-contact-role');
    const currentValue = select.value;
    select.innerHTML = '<option value="">Role Kontak (opsional)</option>' +
      roles.map((r) => '<option value="' + r + '">' + r + '</option>').join('');
    if (roles.includes(currentValue)) select.value = currentValue;
  },

  renderFilterStageChips(stages) {
    const container = document.getElementById('filter-stage-chips');
    const extra = stages.map((s) => '<button class="chip" type="button" data-filter-stage="' + s + '">' + s + '</button>').join('');
    // Chip "Semua" (statis, di HTML) selalu dipertahankan sebagai elemen pertama
    const semuaChip = container.querySelector('[data-filter-stage=""]');
    container.innerHTML = '';
    if (semuaChip) container.appendChild(semuaChip);
    container.insertAdjacentHTML('beforeend', extra);
  },

  renderFilterProductChips(products) {
    const container = document.getElementById('filter-product-chips');
    const extra = products.map((p) => '<button class="chip" type="button" data-filter-product="' + p + '">' + p + '</button>').join('');
    const semuaChip = container.querySelector('[data-filter-product=""]');
    container.innerHTML = '';
    if (semuaChip) container.appendChild(semuaChip);
    container.insertAdjacentHTML('beforeend', extra);
  }
};

/* ============================================================
   2. UTILS
   ============================================================ */
const Utils = {
  /** Format objek Date/string tanggal menjadi "DD Mon" (contoh: 23 Jul) */
  formatShortDate(dateValue) {
    if (!dateValue) return '-';
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return '-';
    const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return d.getDate() + ' ' + bulan[d.getMonth()];
  },

  /** Format Date menjadi YYYY-MM-DD untuk dikirim ke backend / input[type=date] */
  formatDateForInput(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  },

  /** Menentukan class dot warna berdasarkan Health_Status / Pipeline_Stage */
  healthDotClass(project) {
    if (project.Pipeline_Stage === 'Won') return 'dot-won';
    if (project.Pipeline_Stage === 'Lost') return 'dot-lost';
    if (project.Health_Status === 'Perlu Perhatian') return 'dot-perhatian';
    if (project.Health_Status === 'Stale') return 'dot-stale';
    return 'dot-aktif';
  },

  /** Label status ringkas untuk ditampilkan di judul kartu, contoh: "Coba lagi (Aktif)" */
  statusLabel(pipelineStage) {
    if (pipelineStage === 'Won') return 'Won';
    if (pipelineStage === 'Lost') return 'Lost';
    return 'Aktif';
  },

  /** Class glow border sesuai status — dipakai di kartu project & ringkasan */
  statusGlowClass(pipelineStage) {
    if (pipelineStage === 'Won') return 'glow-warning';
    if (pipelineStage === 'Lost') return 'glow-danger';
    return 'glow-success';
  },

  /** Membaca file foto menjadi base64 (tanpa prefix data:...) + kompresi sederhana via canvas */
  compressAndReadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca file foto'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Gagal memuat gambar'));
        img.onload = () => {
          const maxDim = SVS_CONFIG.PHOTO_MAX_DIMENSION;
          let { width, height } = img;
          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL('image/jpeg', SVS_CONFIG.PHOTO_QUALITY);
          const base64 = dataUrl.split(',')[1];
          resolve({ base64, mimeType: 'image/jpeg', previewUrl: dataUrl });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
};

/* ============================================================
   3. OFFLINE QUEUE
   ============================================================
   Menyimpan aksi yang GAGAL terkirim (network error) ke
   localStorage, lalu mengirim ulang otomatis saat koneksi
   kembali ada. Ini adalah jaring pengaman untuk sinyal terputus
   sesaat di lokasi proyek — bukan mode kerja offline penuh.
   ============================================================ */
const OfflineQueue = {
  STORAGE_KEY: 'svs_offline_queue',

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  },

  saveAll(queue) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(queue));
    this.updateBanner();
  },

  /** Menambah item tunggal (1 action + payload biasa, misal createProject) */
  add(action, payload) {
    const queue = this.getAll();
    queue.push({ type: 'single', action, payload, queuedAt: Date.now() });
    this.saveAll(queue);
  },

  /**
   * Menambah item GABUNGAN: 1 aktivitas beserta banyak foto mentahnya
   * (belum diupload). Dipakai saat submit Update Progress gagal terkirim
   * karena sinyal lemah — supaya foto & aktivitas selalu tersinkron
   * bersamaan saat sync nanti, tidak ada foto yang "nyasar" tanpa aktivitas.
   *
   * @param {Object} activityPayload - payload createActivity (activity_id
   *   & photo_ids sudah ditentukan di client sebelum dipanggil)
   * @param {Array<{photoId,base64,mimeType}>} rawPhotos - foto mentah yang
   *   belum diupload, tiap foto sudah punya photoId masing-masing
   */
  addActivityWithPhotos(activityPayload, rawPhotos) {
    const queue = this.getAll();
    queue.push({
      type: 'activityWithPhotos',
      activityPayload,
      rawPhotos,
      queuedAt: Date.now()
    });
    this.saveAll(queue);
  },

  count() {
    return this.getAll().length;
  },

  /** Menampilkan/menyembunyikan banner jumlah data yang masih tertunda */
  updateBanner() {
    const banner = document.getElementById('pending-sync-banner');
    if (!banner) return;

    if (this.isSyncing) {
      banner.innerHTML = '<span class="snackbar-spinner"></span>Menyinkronkan data...';
      banner.disabled = true;
      banner.hidden = false;
      return;
    }

    banner.disabled = false;
    const total = this.count();
    if (total > 0) {
      banner.innerHTML = '📤 <span id="pending-sync-count">' + total + '</span> data menunggu dikirim — Tap untuk sync sekarang';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  },

  /**
   * Mengirim ulang seluruh antrian secara berurutan (bukan paralel).
   * Menangani 2 jenis item: 'single' (langsung rawCall) dan
   * 'activityWithPhotos' (upload foto dulu satu-satu, baru createActivity).
   *
   * Dilindungi dengan penguncian (isSyncing) — kalau fungsi ini dipanggil
   * lagi SAAT proses sebelumnya masih berjalan (misal tombol "Sync Sekarang"
   * ditekan berkali-kali, atau auto-sync dan manual-sync kebetulan
   * bersamaan), panggilan kedua langsung diabaikan. Tanpa penguncian ini,
   * kedua proses akan membaca antrian yang sama sebelum salah satu selesai
   * menghapusnya, menyebabkan data yang sama terkirim dua kali.
   */
  isSyncing: false,

  async syncAll() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.updateBanner(); // tampilkan spinner + "Menyinkronkan..." di banner

    try {
      const queue = this.getAll();
      if (queue.length === 0) return;

      let successCount = 0;
      const remaining = [];

    for (const item of queue) {
      try {
        if (item.type === 'activityWithPhotos') {
          // photo_id dan activity_id SUDAH ditentukan sejak awal (saat
          // pertama kali disimpan ke antrian) — dikirim apa adanya di sini
          // supaya backend yang idempotent bisa mengenali kalau sebagian
          // sudah pernah berhasil terkirim sebelumnya (tidak dobel).
          for (const photo of item.rawPhotos) {
            await Api.rawCall('uploadPhoto', {
              photo_id: photo.photoId,
              project_id: item.activityPayload.project_id,
              file_base64: photo.base64,
              mime_type: photo.mimeType
            });
          }
          await Api.rawCall('createActivity', item.activityPayload);
        } else {
          await Api.rawCall(item.action, item.payload);
        }
        successCount++;
      } catch (err) {
        remaining.push(item); // gagal lagi -> tetap simpan untuk percobaan berikutnya
      }
    }

      this.saveAll(remaining);

      if (successCount > 0) {
        Snackbar.show(successCount + ' data tertunda berhasil disinkronkan', 'success');
        Router.refreshCurrentView();
      }
    } finally {
      this.isSyncing = false;
      this.updateBanner(); // kembalikan tampilan banner ke normal (hitung ulang / sembunyikan)
    }
  }
};

/* ============================================================
   4. API
   ============================================================ */
const Api = {
  /**
   * Batas waktu tunggu jaringan sebelum dianggap gagal dan dialihkan ke
   * penyimpanan lokal. Dibuat cukup longgar (15 detik) karena Google Apps
   * Script kadang butuh beberapa detik untuk "bangun" (cold start) setelah
   * idle — bukan karena sinyal buruk. Timeout terlalu ketat (misal 8 detik)
   * berisiko menganggap request yang sebenarnya masih berjalan normal
   * sebagai gagal, sehingga data disimpan lokal padahal sebenarnya bisa
   * berhasil kalau ditunggu sedikit lebih lama.
   */
  TIMEOUT_MS: 15000,

  /**
   * Panggilan API mentah (tanpa penanganan offline) — dipakai
   * juga oleh OfflineQueue.syncAll() saat mengirim ulang data.
   *
   * Catatan teknis: Content-Type sengaja "text/plain" (bukan
   * application/json) untuk menghindari CORS preflight request
   * (OPTIONS) yang tidak ditangani oleh Google Apps Script secara
   * default. Apps Script tetap mem-parsing body ini sebagai JSON
   * di sisi server (lihat Code.gs -> JSON.parse(e.postData.contents)).
   *
   * Dibatasi waktu tunggu (TIMEOUT_MS) lewat AbortController — kalau
   * server tidak merespons dalam batas waktu itu, request dibatalkan
   * dan dianggap gagal (supaya pemanggil bisa langsung fallback ke
   * penyimpanan lokal, bukan menunggu tanpa batas).
   */
  rawCall(action, payload) {
    const body = Object.assign(
      { action, sales_code: SVS_CONFIG.SALES_CODE, token: SVS_CONFIG.TOKEN },
      payload
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    return fetch(SVS_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
      .then((res) => res.json())
      .finally(() => clearTimeout(timeoutId));
  },

  /**
   * Panggilan API dengan penanganan offline otomatis.
   * Jika request gagal karena tidak ada koneksi, dan action termasuk
   * jenis yang boleh diantre (mengubah data), data disimpan ke
   * OfflineQueue dan dianggap "berhasil secara lokal".
   */
  async call(action, payload, options) {
    const queueableActions = ['createProject', 'createActivity', 'uploadPhoto', 'createContact', 'updateProject'];
    const opts = options || {};

    try {
      const result = await this.rawCall(action, payload);
      return result;
    } catch (networkError) {
      if (queueableActions.includes(action) && !opts.noQueue) {
        OfflineQueue.add(action, payload);
        return { success: true, queued: true, data: null, message: 'Tersimpan lokal, akan dikirim otomatis saat online' };
      }
      throw networkError;
    }
  }
};

/* ============================================================
   5. SNACKBAR
   ============================================================ */
const Snackbar = {
  el: null,
  timer: null,

  init() {
    this.el = document.getElementById('snackbar');
  },

  /**
   * Menampilkan snackbar yang otomatis hilang setelah `duration` (default 2.5 detik).
   * Dipakai untuk pesan hasil akhir (sukses/gagal).
   */
  /**
   * Menampilkan snackbar yang otomatis hilang setelah `duration` (default 2.5 detik).
   * @param {string} message
   * @param {string} [type] - 'success' | 'error' | 'info' (default 'info')
   * @param {number} [duration]
   */
  show(message, type, duration) {
    if (!this.el) return;
    this.el.textContent = message;
    this.el.className = 'snackbar show snackbar-' + (type || 'info');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.classList.remove('show');
    }, duration || 2500);
  },

  /**
   * Menampilkan snackbar dengan ikon loading berputar, yang TIDAK otomatis
   * hilang — tetap tampil sampai dipanggil show()/showPersistent() lain
   * (biasanya dengan pesan hasil akhir).
   */
  showPersistent(message) {
    if (!this.el) return;
    clearTimeout(this.timer);
    this.el.className = 'snackbar show snackbar-info';
    this.el.innerHTML = '<span class="snackbar-spinner"></span>' + message;
  }
};

/* ============================================================
   5b. LOADING INDICATOR (teks dengan titik animasi, misal "Memuat...")
   ============================================================ */
const LoadingIndicator = {
  intervalId: null,

  /** Mulai animasi titik pada sebuah elemen, contoh hasil: "Memuat", "Memuat.", "Memuat..", "Memuat..." */
  start(el, baseText) {
    if (!el) return;
    this.stop();
    let dots = 0;
    el.textContent = baseText;
    this.intervalId = setInterval(() => {
      dots = (dots + 1) % 4;
      el.textContent = baseText + '.'.repeat(dots);
    }, 400);
  },

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
};

/* ============================================================
   6. DARK MODE
   ============================================================ */
const ThemeToggle = {
  STORAGE_KEY: 'svs_theme',

  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
    this.updateIcon();

    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      this.toggle();
    });
  },

  toggle() {
    const isDark = this.isDark();
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(this.STORAGE_KEY, next);
    this.updateIcon();
  },

  isDark() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  },

  updateIcon() {
    const isDark = this.isDark();
    document.getElementById('btn-theme-toggle').classList.toggle('is-dark', isDark);
  }
};

/* ============================================================
   7. RENDER: DASHBOARD
   ============================================================ */
const DashboardView = {
  async load() {
    const payload = SVS_CONFIG.ROLE === 'manager' ? {} : { sales_code: SVS_CONFIG.SALES_CODE };
    const result = await Api.call('readDashboard', payload, { noQueue: true }).catch(() => null);

    if (!result || !result.success) {
      Snackbar.show('Gagal memuat dashboard. Menampilkan data terakhir yang tersimpan.', 'error');
      return;
    }

    this.renderFollowUps(result.data.needs_followup || []);
    State.summaryData = result.data.summary || { today: {}, week: {}, month: {} };
    this.renderSummary(State.selectedSummaryPeriod);
    this.updateNotificationBadge(result.data.needs_followup || []);
  },

  init() {
    document.querySelectorAll('#summary-period-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#summary-period-chips .chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        State.selectedSummaryPeriod = chip.dataset.period;
        this.renderSummary(State.selectedSummaryPeriod);
      });
    });

    // Klik salah satu angka ringkasan (Kunjungan/Deal Ditutup/Deal Hilang)
    // untuk melihat rincian nama project yang menyusun angka itu.
    document.querySelectorAll('.summary-item').forEach((item) => {
      item.addEventListener('click', () => {
        this.openSummaryDetail(item.dataset.summaryType);
      });
    });
  },

  async openSummaryDetail(type) {
    const titles = { visit: 'Kunjungan', won: 'Deal Ditutup', lost: 'Deal Hilang' };
    const periodLabels = { today: 'Hari Ini', week: 'Minggu Ini', month: 'Bulan Ini' };
    const period = State.selectedSummaryPeriod;

    document.getElementById('summary-detail-title').textContent =
      titles[type] + ' — ' + periodLabels[period];

    const listEl = document.getElementById('summary-detail-list');
    listEl.innerHTML = '<p class="loading-text">Memuat data</p>';
    LoadingIndicator.start(listEl.querySelector('.loading-text'), 'Memuat data');

    SheetManager.open('sheet-summary-detail');

    const payload = { period, type };
    if (SVS_CONFIG.ROLE !== 'manager') payload.sales_code = SVS_CONFIG.SALES_CODE;

    const result = await Api.call('readSummaryDetail', payload, { noQueue: true }).catch(() => null);
    LoadingIndicator.stop();

    if (!result || !result.success || !result.data || result.data.length === 0) {
      listEl.innerHTML = '<p class="empty-state">Belum ada data untuk periode ini.</p>';
      return;
    }

    listEl.innerHTML = result.data.map((item) => {
      return '<div class="card">' +
        '<p class="card-title">' + item.project_name + '</p>' +
        '<p class="card-sub-light">' + Utils.formatShortDate(item.timestamp) + '</p>' +
        '</div>';
    }).join('');
  },

  renderFollowUps(items) {
    const container = document.getElementById('followup-list');
    const emptyEl = document.getElementById('followup-empty');
    container.innerHTML = '';

    if (items.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    items.forEach((item) => {
      const urgency = item.overdue_days > 0 ? 'overdue' : 'today';
      const label = item.overdue_days > 0
        ? 'Terlewat ' + item.overdue_days + ' hari 🔴'
        : 'Jatuh tempo hari ini';

      const card = document.createElement('div');
      card.className = 'card followup-card ' + urgency;
      card.innerHTML =
        '<h3 class="card-title">' + Icons.folder + ' ' + item.project_name + '</h3>' +
        '<p class="card-sub">' + label + '</p>' +
        '<div class="followup-card-action" data-open-activity="' + item.project_id + '" data-project-name="' + item.project_name + '">' +
        'Catat Aktivitas ' + Icons.arrowRight + '</div>';
      container.appendChild(card);
    });

    // Pasang event listener untuk setiap tombol "Catat Aktivitas" yang baru dibuat
    container.querySelectorAll('[data-open-activity]').forEach((el) => {
      el.addEventListener('click', () => {
        UpdateProgressSheet.open(el.dataset.openActivity, el.dataset.projectName, null);
      });
    });
  },

  renderSummary(period) {
    const summary = State.summaryData[period] || {};
    document.getElementById('summary-visit').textContent = summary.visit_count || 0;
    document.getElementById('summary-won').textContent = summary.won_count || 0;
    document.getElementById('summary-lost').textContent = summary.lost_count || 0;
  },

  updateNotificationBadge(items) {
    const badge = document.getElementById('badge-notification-count');
    if (items.length > 0) {
      badge.textContent = items.length > 9 ? '9+' : String(items.length);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
};

/* ============================================================
   8. RENDER: PROJECT LIST
   ============================================================ */
const ProjectListView = {
  async load() {
    const payload = {
      sales_code: SVS_CONFIG.ROLE === 'manager' ? undefined : SVS_CONFIG.SALES_CODE,
      pipeline_stage: State.filterStage || undefined,
      product_type: State.filterProduct || undefined
    };

    const result = await Api.call('filterProject', payload, { noQueue: true }).catch(() => null);
    if (!result || !result.success) {
      Snackbar.show('Gagal memuat daftar project', 'error');
      return;
    }

    // Ambil ringkasan kontak (nama+role) untuk semua project sekaligus,
    // supaya kartu bisa tampilkan siapa kontak di lokasi tanpa 1 request
    // terpisah per project. Kalau gagal, tidak fatal — kartu cukup tanpa
    // info kontak.
    const contactsResult = await Api.call('readContactsSummary', {}, { noQueue: true }).catch(() => null);
    State.contactsSummary = (contactsResult && contactsResult.success) ? contactsResult.data : {};

    const serverProjects = result.data || [];
    const serverIds = new Set(serverProjects.map((p) => p.Project_ID));

    // Sertakan juga project yang MASIH tertunda di antrian offline (belum
    // berhasil terkirim ke server) — supaya tetap terlihat di list walau
    // aplikasi baru dibuka lagi/di-refresh, bukan cuma selama sesi berjalan.
    // Project yang Project_ID-nya sudah muncul di data server (berarti sudah
    // berhasil sync) TIDAK diikutkan lagi di sini, supaya tidak dobel tampil.
    const pendingFromQueue = OfflineQueue.getAll()
      .filter((item) => item.type === 'single' && item.action === 'createProject')
      .map((item) => item.payload)
      .filter((p) => !serverIds.has(p.project_id))
      .map((p) => ({
        Project_ID: p.project_id,
        Project_Name: p.project_name,
        Location_Address: p.location_address,
        Product_Type: p.product_type,
        Pipeline_Stage: 'New Visit',
        Estimated_Value: '',
        Health_Status: 'Aktif',
        Date_Created: new Date().toISOString(),
        Date_Last_Activity: new Date().toISOString(),
        _pendingSync: true
      }));

    // Urutkan berdasarkan AKTIVITAS TERAKHIR (bukan tanggal dibuat) —
    // project yang baru saja di-update/follow up tampil paling atas,
    // supaya sales langsung lihat project yang paling relevan sekarang.
    const projects = serverProjects.slice().sort((a, b) => {
      return new Date(b.Date_Last_Activity) - new Date(a.Date_Last_Activity);
    });

    State.projectsCache = pendingFromQueue.concat(projects);
    this.applyQuickFilterAndSearch();
  },

  applyQuickFilterAndSearch() {
    let list = State.projectsCache;

    if (State.quickFilter === 'Aktif') {
      list = list.filter((p) => p.Pipeline_Stage !== 'Won' && p.Pipeline_Stage !== 'Lost');
    } else if (State.quickFilter === 'Won') {
      list = list.filter((p) => p.Pipeline_Stage === 'Won');
    } else if (State.quickFilter === 'Lost') {
      list = list.filter((p) => p.Pipeline_Stage === 'Lost');
    }

    if (State.searchKeyword) {
      const kw = State.searchKeyword.toLowerCase();
      list = list.filter((p) =>
        String(p.Project_Name).toLowerCase().includes(kw) ||
        String(p.Location_Address).toLowerCase().includes(kw)
      );
    }

    this.render(list);
  },

  render(projects) {
    const container = document.getElementById('project-list');
    const emptyEl = document.getElementById('project-list-empty');
    container.innerHTML = '';

    if (projects.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    projects.forEach((p) => {
      const dotClass = Utils.healthDotClass(p);
      const valueText = p.Estimated_Value ? ('Rp ' + Number(p.Estimated_Value).toLocaleString('id-ID')) : '-';
      const pendingBadge = p._pendingSync
        ? '<span class="pending-badge">⏳ Menunggu Sync</span>'
        : '';

      const contact = State.contactsSummary[p.Project_ID];
      const contactLine = contact
        ? '<p class="card-sub-light">' + Icons.user + ' ' + contact.contact_name + ' (' + contact.role + ')</p>'
        : '';

      const statusLabel = Utils.statusLabel(p.Pipeline_Stage);
      const glowClass = Utils.statusGlowClass(p.Pipeline_Stage);
      const lastUpdateText = p.Date_Last_Activity ? Utils.formatShortDate(p.Date_Last_Activity) : '';

      const card = document.createElement('div');
      card.className = 'card ' + glowClass;
      card.setAttribute('data-open-project', p.Project_ID);
      card.setAttribute('data-project-name', p.Project_Name);
      card.setAttribute('data-project-address', p.Location_Address || '');
      card.setAttribute('data-project-stage', p.Pipeline_Stage);
      card.setAttribute('data-project-product', p.Product_Type || '');
      card.setAttribute('data-project-construction', p.Construction_Stage || '');
      card.innerHTML =
        '<h3 class="card-title"><span class="dot ' + dotClass + '"></span>' + p.Project_Name +
        ' <span class="card-status-suffix">(' + statusLabel + ')</span></h3>' +
        '<p class="card-sub">' + p.Pipeline_Stage + '</p>' +
        '<p class="card-sub-light">' + Icons.pin + ' ' + (p.Location_Address || '-') +
        (lastUpdateText ? ' &nbsp; ' + Icons.calendar + ' ' + lastUpdateText : '') + '</p>' +
        (p.Estimated_Value ? '<p class="card-sub-light">' + valueText + '</p>' : '') +
        contactLine +
        pendingBadge;
      container.appendChild(card);
    });

    container.querySelectorAll('[data-open-project]').forEach((el) => {
      el.addEventListener('click', () => {
        TimelineView.open(
          el.dataset.openProject,
          el.dataset.projectName,
          el.dataset.projectAddress,
          el.dataset.projectStage,
          el.dataset.projectProduct,
          el.dataset.projectConstruction
        );
      });
    });
  }
};

/* ============================================================
   9. RENDER: ACTIVITY TIMELINE
   ============================================================ */
const TimelineView = {
  async open(projectId, projectName, address, stage, productType, constructionStage) {
    State.currentProjectId = projectId;
    State.currentProjectName = projectName;
    State.currentProjectStage = stage;

    document.getElementById('timeline-project-name').textContent = projectName;
    document.getElementById('timeline-project-meta').textContent = stage;
    document.getElementById('timeline-project-address').textContent = address || '-';

    // Border glow di header detail mengikuti status project (Aktif/Won/Lost),
    // konsisten dengan warna yang sama di kartu Project List.
    const headerCard = document.querySelector('#view-timeline .timeline-header');
    headerCard.classList.remove('glow-success', 'glow-warning', 'glow-danger');
    headerCard.classList.add(Utils.statusGlowClass(stage));

    const detailParts = [];
    if (productType) detailParts.push('Jenis Produk: ' + productType);
    if (constructionStage) detailParts.push('Tahap Konstruksi: ' + constructionStage);
    document.getElementById('timeline-project-detail').textContent =
      detailParts.length > 0 ? 'Detail Proyek: ' + detailParts.join(' · ') : '';

    // PENTING: bersihkan konten lama SEGERA (foto/aktivitas project
    // sebelumnya) dan tampilkan loading — supaya sales tidak sempat
    // melihat data project LAIN sekilas saat berpindah, yang bisa
    // dikira aplikasi error/nyasar.
    const listContainer = document.getElementById('timeline-list');
    listContainer.innerHTML = '<p id="timeline-loading" class="loading-text">Memuat riwayat aktivitas</p>';
    LoadingIndicator.start(document.getElementById('timeline-loading'), 'Memuat riwayat aktivitas');

    document.getElementById('timeline-project-contacts').innerHTML = '';
    this.loadContacts(projectId); // berjalan paralel, tidak perlu ditunggu

    Router.goTo('timeline');
  },

  /**
   * Mengambil & menampilkan kontak yang terhubung ke project ini (no. telepon
   * & role), supaya sales tidak perlu mengingat-ingat kontak lokasi —
   * nomor telepon bisa langsung diklik untuk telpon atau chat WhatsApp.
   */
  async loadContacts(projectId) {
    const result = await Api.call('readProjectContacts', { project_id: projectId }, { noQueue: true }).catch(() => null);
    const container = document.getElementById('timeline-project-contacts');
    if (!result || !result.success || !result.data || result.data.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = result.data.map((c) => {
      const digits = String(c.Phone_Number).replace(/\D/g, '');
      const waNumber = digits.startsWith('0') ? '62' + digits.slice(1) : digits;
      return (
        '<div class="contact-item">' +
        '<div class="contact-name-row">' + Icons.user + ' ' + c.Contact_Name + ' (' + c.Role + ')</div>' +
        '<a href="tel:' + digits + '" class="contact-link">' + Icons.phone + ' Telpon</a> ' +
        '<a href="https://wa.me/' + waNumber + '" target="_blank" rel="noopener" class="contact-link">' + Icons.message + ' WhatsApp</a>' +
        '</div>'
      );
    }).join('');
  },

  async load(projectId) {
    const result = await Api.call('readActivityTimeline', { project_id: projectId }, { noQueue: true }).catch(() => null);
    LoadingIndicator.stop();

    if (!result || !result.success) {
      Snackbar.show('Gagal memuat riwayat aktivitas', 'error');
      document.getElementById('timeline-list').innerHTML = '<p class="empty-state">Gagal memuat data. Coba lagi.</p>';
      return;
    }

    this.render(result.data || []);

    // Perbarui status utama di header berdasarkan aktivitas TERBARU
    // (sebelumnya header hanya memakai status dari saat kartu di-tap,
    // jadi tidak ikut berubah setelah ada follow up baru)
    if (result.data && result.data.length > 0) {
      const latestStage = result.data[0].Pipeline_Stage_At_This_Point;
      if (latestStage) {
        State.currentProjectStage = latestStage;
        document.getElementById('timeline-project-meta').textContent = latestStage;
        const headerCard = document.querySelector('#view-timeline .timeline-header');
        headerCard.classList.remove('glow-success', 'glow-warning', 'glow-danger');
        headerCard.classList.add(Utils.statusGlowClass(latestStage));
      }
    }
  },

  render(activities) {
    const container = document.getElementById('timeline-list');
    container.innerHTML = '';

    if (activities.length === 0) {
      container.innerHTML = '<p class="empty-state">Belum ada aktivitas tercatat untuk project ini.</p>';
      return;
    }

    activities.forEach((a) => {
      const item = document.createElement('div');
      item.className = 'timeline-item';

      let photosHtml = '';
      if (a.photos && a.photos.length > 0) {
        photosHtml = a.photos.map((p) => '<img class="timeline-photo" src="' + p.url + '" alt="Foto kunjungan" loading="lazy" />').join('');
      }

      item.innerHTML =
        '<p class="timeline-date">' + Utils.formatShortDate(a.Timestamp) + ' · ' + a.Activity_Type + '</p>' +
        '<p class="timeline-note">' + a.Activity_Note + '</p>' +
        '<p class="card-sub-light">Status saat itu: ' + a.Pipeline_Stage_At_This_Point +
        (a.Next_Followup_Date ? ' · Follow up berikutnya: ' + Utils.formatShortDate(a.Next_Followup_Date) : '') +
        '</p>' +
        photosHtml;

      container.appendChild(item);
    });
  }
};

/* ============================================================
   10. SHEET: TAMBAH PROJECT
   ============================================================ */
const AddProjectSheet = {
  init() {
    document.getElementById('fab-add-project').addEventListener('click', () => this.open());

    // Event delegation: chip Jenis Produk sekarang dibuat dinamis dari
    // sheet Lookup (bisa berubah-ubah), jadi listener dipasang di
    // KONTAINER-nya, bukan per-chip — supaya tetap berfungsi walau
    // chip-nya baru dirender belakangan/diperbarui.
    document.getElementById('product-type-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      chip.classList.toggle('selected');
      const value = chip.dataset.product;
      if (chip.classList.contains('selected')) {
        State.selectedProductTypes.push(value);
      } else {
        State.selectedProductTypes = State.selectedProductTypes.filter((v) => v !== value);
      }
    });

    document.getElementById('form-add-project').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  },

  open() {
    State.selectedProductTypes = [];
    document.getElementById('form-add-project').reset();
    document.querySelectorAll('#product-type-chips .chip').forEach((c) => c.classList.remove('selected'));

    SheetManager.open('sheet-add-project');
  },

  async submit() {
    const name = document.getElementById('input-project-name').value.trim();
    const address = document.getElementById('input-project-address').value.trim();

    if (!name || !address) {
      Snackbar.show('Nama project dan lokasi wajib diisi', 'error');
      return;
    }
    if (State.selectedProductTypes.length === 0) {
      Snackbar.show('Pilih minimal 1 jenis produk', 'error');
      return;
    }

    const payload = {
      project_id: IdGen.projectId(),
      project_name: name,
      location_address: address,
      product_type: State.selectedProductTypes.join(', '),
      project_category: document.getElementById('select-project-category').value,
      construction_stage: document.getElementById('select-construction-stage').value,
      estimated_value: document.getElementById('input-project-value').value || ''
    };

    // Tambahkan langsung ke tampilan lokal (optimistic) — supaya project
    // baru langsung terlihat di "Project Saya" walau server belum sempat
    // mengonfirmasi. Ditandai _pendingSync sampai server benar-benar merespons.
    State.projectsCache.unshift({
      Project_ID: payload.project_id,
      Project_Name: payload.project_name,
      Location_Address: payload.location_address,
      Product_Type: payload.product_type,
      Pipeline_Stage: 'New Visit',
      Estimated_Value: '',
      Health_Status: 'Aktif',
      Date_Created: new Date().toISOString(),
      _pendingSync: true
    });

    SheetManager.close('sheet-add-project');

    // Sesuai alur di UI/UX Design: setelah project baru dibuat, otomatis
    // lanjut ke Update Progress untuk kunjungan pertama. Ini dilakukan
    // SEGERA (tidak menunggu balasan server) karena project_id sudah pasti
    // dibuat di atas — request ke server dikirim di belakang layar.
    State.currentProjectStage = 'New Visit';
    UpdateProgressSheet.open(payload.project_id, name, 'New Visit');
    Router.refreshCurrentView();

    Api.call('createProject', payload).then((result) => {
      if (!result.success && !result.queued) {
        Snackbar.show(result.message || 'Gagal menyimpan project ke server', 'error');
      }
      // Kalau berhasil ATAU sudah masuk antrian offline, tidak perlu
      // notifikasi tambahan — sales sudah lihat project-nya sejak tadi.
    });

    // Info kontak bersifat OPSIONAL — kalau salah satu field diisi,
    // kirim sebagai request terpisah (tidak menghalangi alur utama project).
    const contactName = document.getElementById('input-contact-name').value.trim();
    const contactPhone = document.getElementById('input-contact-phone').value.trim();
    const contactRole = document.getElementById('select-contact-role').value;

    if (contactName && contactPhone && contactRole) {
      Api.call('createContact', {
        contact_id: IdGen.contactId(),
        project_id: payload.project_id,
        contact_name: contactName,
        phone_number: contactPhone,
        role: contactRole
      }).then((result) => {
        if (!result.success && !result.queued) {
          Snackbar.show('Gagal menyimpan info kontak: ' + (result.message || ''), 'error');
        }
      });
    } else if (contactName || contactPhone || contactRole) {
      Snackbar.show('Info kontak tidak disimpan — Nama, Telepon, dan Role harus diisi semua kalau ingin mencatat kontak', 'info');
    }
  }
};

/* ============================================================
   11. SHEET: UPDATE PROGRESS
   ============================================================ */
const UpdateProgressSheet = {
  init() {
    // Event delegation: tombol Jenis Aktivitas & chip Alasan Lost sekarang
    // dibuat dinamis dari sheet Lookup, jadi listener dipasang di
    // KONTAINER-nya, bukan per-elemen.
    document.getElementById('activity-type-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.activity-type-btn');
      if (!btn) return;
      document.querySelectorAll('#activity-type-grid .activity-type-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      State.selectedActivityType = btn.dataset.activityType;
    });

    document.getElementById('btn-take-photo').addEventListener('click', () => {
      document.getElementById('input-photo').click();
    });

    document.getElementById('btn-pick-gallery').addEventListener('click', () => {
      document.getElementById('input-gallery').click();
    });

    // Satu handler dipakai untuk KEDUA sumber foto (kamera & galeri) —
    // mendukung lebih dari 1 file sekaligus (galeri bisa multi-select,
    // kamera biasanya cuma 1 per pengambilan, tapi kode ini menangani
    // keduanya dengan cara yang sama).
    const handlePhotoFiles = async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const { base64, mimeType, previewUrl } = await Utils.compressAndReadImage(file);
          State.pendingPhotos.push({ base64, mimeType, previewUrl });
        } catch (err) {
          Snackbar.show('Gagal memproses salah satu foto, dilewati', 'error');
        }
      }
      this.renderPhotoThumbnails();
      e.target.value = ''; // reset input supaya bisa pilih lagi dari sumber sama
    };

    document.getElementById('input-photo').addEventListener('change', handlePhotoFiles);
    document.getElementById('input-gallery').addEventListener('change', handlePhotoFiles);

    document.getElementById('select-pipeline-stage').addEventListener('change', (e) => {
      const lostGroup = document.getElementById('lost-reason-group');
      lostGroup.hidden = e.target.value !== 'Lost';
    });

    document.getElementById('lost-reason-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#lost-reason-chips .chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      State.selectedLostReason = chip.dataset.lostReason;
    });

    document.querySelectorAll('#followup-quick-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#followup-quick-chips .chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        const days = parseInt(chip.dataset.followupDays, 10);
        const date = new Date();
        date.setDate(date.getDate() + days);
        const formatted = Utils.formatDateForInput(date);
        document.getElementById('input-followup-date').value = formatted;
        State.selectedFollowupDate = formatted;
      });
    });

    document.getElementById('input-followup-date').addEventListener('change', (e) => {
      State.selectedFollowupDate = e.target.value;
      document.querySelectorAll('#followup-quick-chips .chip').forEach((c) => c.classList.remove('selected'));
    });

    document.getElementById('btn-add-activity-from-timeline').addEventListener('click', () => {
      this.open(State.currentProjectId, State.currentProjectName, State.currentProjectStage);
    });

    document.getElementById('form-update-progress').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  },

  open(projectId, projectName, currentStage) {
    State.currentProjectId = projectId;
    State.currentProjectName = projectName;
    State.selectedActivityType = null;
    State.selectedLostReason = null;
    State.pendingPhotos = [];

    document.getElementById('form-update-progress').reset();
    document.getElementById('update-progress-project-name').textContent = projectName;
    this.renderPhotoThumbnails();
    document.getElementById('lost-reason-group').hidden = true;
    document.querySelectorAll('#activity-type-grid .activity-type-btn').forEach((b) => b.classList.remove('selected'));
    document.querySelectorAll('#lost-reason-chips .chip').forEach((c) => c.classList.remove('selected'));
    document.querySelectorAll('#followup-quick-chips .chip').forEach((c) => c.classList.remove('selected'));

    if (currentStage) {
      document.getElementById('select-pipeline-stage').value = currentStage;
    }

    SheetManager.open('sheet-update-progress');
  },

  /** Menampilkan ulang seluruh thumbnail foto yang sudah diambil, dengan tombol hapus per foto */
  renderPhotoThumbnails() {
    const container = document.getElementById('photo-thumbnail-list');
    container.innerHTML = '';

    State.pendingPhotos.forEach((photo, index) => {
      const item = document.createElement('div');
      item.className = 'photo-thumbnail-item';
      item.innerHTML =
        '<img src="' + photo.previewUrl + '" alt="Foto kunjungan ' + (index + 1) + '" />' +
        '<button type="button" class="photo-thumbnail-remove" data-remove-photo-index="' + index + '">✕</button>';
      container.appendChild(item);
    });

    container.querySelectorAll('[data-remove-photo-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.removePhotoIndex, 10);
        State.pendingPhotos.splice(idx, 1);
        this.renderPhotoThumbnails();
      });
    });
  },

  async submit() {
    const note = document.getElementById('input-activity-note').value.trim();
    const stage = document.getElementById('select-pipeline-stage').value;
    const followupDate = document.getElementById('input-followup-date').value || State.selectedFollowupDate;

    if (!State.selectedActivityType) {
      Snackbar.show('Pilih jenis aktivitas terlebih dahulu', 'error');
      return;
    }
    if (!note) {
      Snackbar.show('Catatan wajib diisi', 'error');
      return;
    }
    if (!followupDate) {
      Snackbar.show('Pilih tanggal follow up berikutnya', 'error');
      return;
    }
    if (stage === 'Lost' && !State.selectedLostReason) {
      Snackbar.show('Pilih alasan Lost terlebih dahulu', 'error');
      return;
    }
    // Catatan: foto SENGAJA tidak divalidasi wajib di sini — foto bersifat
    // opsional, boleh 0, 1, atau lebih dari 1.

    const activityId = IdGen.activityId();
    const photoAssignments = State.pendingPhotos.map((p) => ({
      photoId: IdGen.photoId(),
      base64: p.base64,
      mimeType: p.mimeType
    }));

    const activityPayload = {
      activity_id: activityId,
      project_id: State.currentProjectId,
      activity_type: State.selectedActivityType,
      activity_note: note,
      pipeline_stage: stage,
      next_followup_date: followupDate,
      lost_reason: stage === 'Lost' ? State.selectedLostReason : undefined,
      photo_ids: photoAssignments.map((p) => p.photoId)
    };

    const estimatedValue = document.getElementById('input-estimated-value').value;

    // Tutup sheet & beri feedback SEGERA — supaya sales tidak menunggu
    // proses upload/jaringan selesai dulu baru bisa lanjut kerja.
    // Proses upload+simpan aktivitas berjalan di background setelah ini.
    SheetManager.close('sheet-update-progress');
    Snackbar.showPersistent('Menyimpan...');

    // Kirim update nilai project (kalau diisi) sebagai request TERPISAH,
    // tidak menghalangi alur utama simpan aktivitas — sengaja tidak
    // ditunggu (fire-and-forget), sama seperti pola kontak di Tambah Project.
    if (estimatedValue) {
      Api.call('updateProject', {
        project_id: State.currentProjectId,
        sales_code: SVS_CONFIG.SALES_CODE,
        estimated_value: estimatedValue
      }).then((result) => {
        if (!result.success && !result.queued) {
          Snackbar.show('Gagal menyimpan nilai project: ' + (result.message || ''), 'error');
        }
      });
    }

    try {
      // Upload setiap foto satu per satu (kalau ada) — photo_id sudah
      // ditentukan di atas, dikirim ke server supaya idempotent kalau
      // request ini perlu diulang.
      for (const photo of photoAssignments) {
        await Api.rawCall('uploadPhoto', {
          photo_id: photo.photoId,
          project_id: State.currentProjectId,
          file_base64: photo.base64,
          mime_type: photo.mimeType
        });
      }

      // Buat Activity — activity_id & photo_ids sudah ditentukan di atas
      const activityResult = await Api.rawCall('createActivity', activityPayload);

      if (!activityResult.success) {
        Snackbar.show(activityResult.message || 'Gagal menyimpan aktivitas', 'error');
        return;
      }

      Snackbar.show('Aktivitas tersimpan', 'success');
      Router.refreshCurrentView();
    } catch (networkError) {
      // Jaringan gagal/lambat (timeout) di salah satu tahap manapun —
      // simpan SATU paket gabungan (aktivitas + seluruh foto mentah,
      // lengkap dengan ID yang sudah ditentukan di atas) ke antrian lokal,
      // supaya saat sync belakangan tidak ada foto yang "nyasar" tanpa
      // aktivitas, dan tidak ada data dobel walau diulang berkali-kali.
      OfflineQueue.addActivityWithPhotos(activityPayload, photoAssignments);
      Snackbar.show('Tersimpan lokal (' + (photoAssignments.length + 1) + ' data) — akan dikirim otomatis saat online', 'info');
      Router.refreshCurrentView();
    }
  }
};

/* ============================================================
   12. SHEET: FILTER
   ============================================================ */
const FilterSheet = {
  init() {
    document.getElementById('btn-open-filter').addEventListener('click', () => {
      SheetManager.open('sheet-filter');
    });

    document.getElementById('filter-stage-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#filter-stage-chips .chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      State.filterStage = chip.dataset.filterStage;
    });

    document.getElementById('filter-product-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#filter-product-chips .chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      State.filterProduct = chip.dataset.filterProduct;
    });

    document.getElementById('btn-filter-reset').addEventListener('click', () => {
      State.filterStage = '';
      State.filterProduct = '';
      document.querySelectorAll('#filter-stage-chips .chip, #filter-product-chips .chip').forEach((c, i) => {
        c.classList.toggle('selected', c.dataset.filterStage === '' || c.dataset.filterProduct === '');
      });
    });

    document.getElementById('btn-filter-apply').addEventListener('click', async () => {
      SheetManager.close('sheet-filter');
      await ProjectListView.load();
    });

    document.querySelectorAll('#quick-filter-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#quick-filter-chips .chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        State.quickFilter = chip.dataset.quickfilter;
        ProjectListView.applyQuickFilterAndSearch();
      });
    });

    document.getElementById('input-search-project').addEventListener('input', (e) => {
      State.searchKeyword = e.target.value;
      ProjectListView.applyQuickFilterAndSearch();
    });
  }
};

/* ============================================================
   SHEET MANAGER (generik, dipakai oleh ketiga bottom sheet)
   ============================================================ */
const SheetManager = {
  init() {
    document.querySelectorAll('[data-close-sheet]').forEach((btn) => {
      btn.addEventListener('click', () => this.close(btn.dataset.closeSheet));
    });
    document.getElementById('sheet-overlay').addEventListener('click', () => this.closeAll());
  },

  open(sheetId) {
    document.getElementById('sheet-overlay').hidden = false;
    document.getElementById(sheetId).hidden = false;
  },

  close(sheetId) {
    document.getElementById(sheetId).hidden = true;
    document.getElementById('sheet-overlay').hidden = true;
  },

  closeAll() {
    document.querySelectorAll('.bottom-sheet').forEach((sheet) => { sheet.hidden = true; });
    document.getElementById('sheet-overlay').hidden = true;
  }
};

/* ============================================================
   13. NAVIGASI / ROUTER
   ============================================================ */
const Router = {
  init() {
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => this.goTo(btn.dataset.nav));
    });

    document.getElementById('btn-back').addEventListener('click', () => {
      this.goTo('projects');
    });
  },

  goTo(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');
    State.currentView = viewName;

    const isTimeline = viewName === 'timeline';
    document.getElementById('btn-back').hidden = !isTimeline;

    const titles = {
      dashboard: 'Halo, ' + SVS_CONFIG.SALES_NAME.split(' ')[0] + ' 👋',
      projects: 'Project Saya',
      timeline: State.currentProjectName || 'Detail Project'
    };
    document.getElementById('header-title').textContent = titles[viewName] || 'SVS';

    document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === viewName);
    });

    // FAB hanya relevan di Dashboard & Project List, bukan di Timeline
    document.getElementById('fab-add-project').hidden = isTimeline;

    this.refreshCurrentView();
  },

  refreshCurrentView() {
    if (State.currentView === 'dashboard') DashboardView.load();
    if (State.currentView === 'projects') ProjectListView.load();
    if (State.currentView === 'timeline' && State.currentProjectId) TimelineView.load(State.currentProjectId);
  }
};

/* ============================================================
   14. INIT
   ============================================================ */
function initApp() {
  // Setiap modul di-init lewat wrapper aman ini — supaya kalau ada 1 modul
  // gagal karena error tak terduga, modul-modul LAIN tetap ter-inisialisasi
  // normal (sebelumnya: satu error di tengah bisa menghentikan seluruh sisa
  // initApp(), membuat tombol-tombol setelahnya jadi tidak merespons sama
  // sekali tanpa pesan error yang terlihat).
  function safeInit(name, fn) {
    try {
      fn();
    } catch (err) {
      console.error('Gagal inisialisasi ' + name + ':', err);
    }
  }

  // Render pilihan chip/dropdown (status, jenis produk, dll) SEGERA
  // pakai data cache/default — supaya form langsung bisa dipakai tanpa
  // menunggu server. Ini harus jalan SEBELUM init sheet lain, supaya
  // dropdown/chip sudah terisi saat sales pertama kali buka form.
  safeInit('LookupRenderer (awal)', () => LookupRenderer.renderAll(LookupCache.get()));

  safeInit('Snackbar', () => Snackbar.init());
  safeInit('ThemeToggle', () => ThemeToggle.init());
  safeInit('Router', () => Router.init());
  safeInit('SheetManager', () => SheetManager.init());
  safeInit('DashboardView', () => DashboardView.init());
  safeInit('AddProjectSheet', () => AddProjectSheet.init());
  safeInit('UpdateProgressSheet', () => UpdateProgressSheet.init());
  safeInit('FilterSheet', () => FilterSheet.init());

  // Cek versi terbaru dari server di BACKGROUND (tidak memblokir apa pun).
  // Kalau berhasil dan datanya berhasil dimuat, render ulang diam-diam —
  // supaya perubahan di Google Sheets (tambah/kurang status, dll) langsung
  // kepakai tanpa sales perlu tahu ada proses ini berjalan.
  LookupCache.refresh().then((freshData) => {
    if (freshData) LookupRenderer.renderAll(freshData);
  });

  document.getElementById('header-title').textContent =
    'Halo, ' + SVS_CONFIG.SALES_NAME.split(' ')[0] + ' 👋';

  // Tampilkan tanggal hari ini dalam format Indonesia di bawah sapaan
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];
  const bulanPanjang = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const now = new Date();
  let jam12 = now.getHours() % 12;
  if (jam12 === 0) jam12 = 12;
  const menit = String(now.getMinutes()).padStart(2, '0');
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  document.getElementById('dashboard-date-subtitle').textContent =
    hari[now.getDay()] + ', ' + now.getDate() + ' ' + bulanPanjang[now.getMonth()] + ' ' + now.getFullYear() +
    ' • ' + jam12 + ':' + menit + ' ' + ampm;

  // Sembunyikan logo header otomatis kalau file assets/icons/logo.png
  // belum di-upload (mencegah tampilan "gambar rusak" muncul di header)
  const headerLogo = document.getElementById('header-logo');
  headerLogo.addEventListener('error', () => { headerLogo.style.display = 'none'; });

  // Muat data awal Dashboard
  DashboardView.load();

  // Pantau status koneksi untuk banner offline + auto-sync antrian
  const offlineBanner = document.getElementById('offline-banner');
  function updateConnectionState() {
    offlineBanner.hidden = navigator.onLine;
    if (navigator.onLine) OfflineQueue.syncAll();
  }
  window.addEventListener('online', updateConnectionState);
  window.addEventListener('offline', updateConnectionState);
  updateConnectionState();

  // Tombol manual "Sync Sekarang" — untuk kondisi sinyal naik-turun,
  // di mana event 'online' browser belum tentu langsung terpicu tapi
  // sales sudah tahu sinyalnya sedang bagus.
  document.getElementById('pending-sync-banner').addEventListener('click', () => {
    OfflineQueue.syncAll();
  });
  OfflineQueue.updateBanner();

  // Registrasi Service Worker untuk dukungan PWA & offline app-shell
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {
        // Kegagalan registrasi tidak menghentikan aplikasi — hanya berarti
        // dukungan offline/PWA tidak aktif, aplikasi tetap bisa dipakai online.
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', initApp);
