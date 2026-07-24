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

  projectsCache: []
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
   * @param {Object} activityPayload - payload createActivity (tanpa photo_ids)
   * @param {Array<{base64,mimeType}>} rawPhotos - foto mentah yang belum diupload
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
    const countEl = document.getElementById('pending-sync-count');
    const total = this.count();
    if (!banner) return;
    if (total > 0) {
      countEl.textContent = total;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  },

  /**
   * Mengirim ulang seluruh antrian secara berurutan (bukan paralel).
   * Menangani 2 jenis item: 'single' (langsung rawCall) dan
   * 'activityWithPhotos' (upload foto dulu satu-satu, baru createActivity).
   */
  async syncAll() {
    const queue = this.getAll();
    if (queue.length === 0) return;

    let successCount = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        if (item.type === 'activityWithPhotos') {
          const photoIds = [];
          for (const photo of item.rawPhotos) {
            const uploadResult = await Api.rawCall('uploadPhoto', {
              project_id: item.activityPayload.project_id,
              file_base64: photo.base64,
              mime_type: photo.mimeType
            });
            if (uploadResult.data && uploadResult.data.photo_id) {
              photoIds.push(uploadResult.data.photo_id);
            }
          }
          await Api.rawCall('createActivity', Object.assign({}, item.activityPayload, { photo_ids: photoIds }));
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
      Snackbar.show(successCount + ' data tertunda berhasil disinkronkan');
      Router.refreshCurrentView();
    }
  }
};

/* ============================================================
   4. API
   ============================================================ */
const Api = {
  /**
   * Batas waktu tunggu jaringan sebelum dianggap gagal dan dialihkan ke
   * penyimpanan lokal. Tujuannya supaya sales TIDAK menunggu lama tanpa
   * kepastian saat sinyal lemah — submit tetap terasa cepat, data aman
   * tersimpan lokal, dan dikirim belakangan lewat sync.
   */
  TIMEOUT_MS: 8000,

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
    const queueableActions = ['createProject', 'createActivity', 'uploadPhoto'];
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

  show(message, duration) {
    if (!this.el) return;
    this.el.textContent = message;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.classList.remove('show');
    }, duration || 2500);
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
    const icon = document.getElementById('theme-icon');
    icon.textContent = this.isDark() ? '☀️' : '🌙';
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
      Snackbar.show('Gagal memuat dashboard. Menampilkan data terakhir yang tersimpan.');
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
        '<h3 class="card-title">🏗 ' + item.project_name + '</h3>' +
        '<p class="card-sub">' + label + '</p>' +
        '<div class="followup-card-action" data-open-activity="' + item.project_id + '" data-project-name="' + item.project_name + '">' +
        '<span class="material-icon">arrow_forward</span> Catat Aktivitas</div>';
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
      Snackbar.show('Gagal memuat daftar project');
      return;
    }

    State.projectsCache = result.data || [];
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

      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('data-open-project', p.Project_ID);
      card.setAttribute('data-project-name', p.Project_Name);
      card.setAttribute('data-project-address', p.Location_Address || '');
      card.setAttribute('data-project-stage', p.Pipeline_Stage);
      card.innerHTML =
        '<h3 class="card-title"><span class="dot ' + dotClass + '"></span>' + p.Project_Name + '</h3>' +
        '<p class="card-sub">' + p.Pipeline_Stage + ' · ' + valueText + '</p>' +
        '<p class="card-sub-light">📍 ' + (p.Location_Address || '-') + '</p>' +
        '<p class="card-sub-light">🔧 ' + (p.Product_Type || '-') + '</p>';
      container.appendChild(card);
    });

    container.querySelectorAll('[data-open-project]').forEach((el) => {
      el.addEventListener('click', () => {
        TimelineView.open(
          el.dataset.openProject,
          el.dataset.projectName,
          el.dataset.projectAddress,
          el.dataset.projectStage
        );
      });
    });
  }
};

/* ============================================================
   9. RENDER: ACTIVITY TIMELINE
   ============================================================ */
const TimelineView = {
  async open(projectId, projectName, address, stage) {
    State.currentProjectId = projectId;
    State.currentProjectName = projectName;
    State.currentProjectStage = stage;

    document.getElementById('timeline-project-name').textContent = projectName;
    document.getElementById('timeline-project-meta').textContent = stage;
    document.getElementById('timeline-project-address').textContent = address || '-';

    Router.goTo('timeline');
    await this.load(projectId);
  },

  async load(projectId) {
    const result = await Api.call('readActivityTimeline', { project_id: projectId }, { noQueue: true }).catch(() => null);
    if (!result || !result.success) {
      Snackbar.show('Gagal memuat riwayat aktivitas');
      return;
    }
    this.render(result.data || []);
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

    document.querySelectorAll('#product-type-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        const value = chip.dataset.product;
        if (chip.classList.contains('selected')) {
          State.selectedProductTypes.push(value);
        } else {
          State.selectedProductTypes = State.selectedProductTypes.filter((v) => v !== value);
        }
      });
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
      Snackbar.show('Nama project dan lokasi wajib diisi');
      return;
    }
    if (State.selectedProductTypes.length === 0) {
      Snackbar.show('Pilih minimal 1 jenis produk');
      return;
    }

    const payload = {
      project_name: name,
      location_address: address,
      product_type: State.selectedProductTypes.join(', '),
      project_category: document.getElementById('select-project-category').value,
      construction_stage: document.getElementById('select-construction-stage').value
    };

    const result = await Api.call('createProject', payload);

    if (!result.success && !result.queued) {
      Snackbar.show(result.message || 'Gagal membuat project');
      return;
    }

    Snackbar.show(result.queued ? result.message : 'Project berhasil dibuat');
    SheetManager.close('sheet-add-project');

    const newProjectId = result.data ? result.data.project_id : null;

    // Sesuai alur di UI/UX Design: setelah project baru dibuat,
    // otomatis lanjut ke Update Progress untuk kunjungan pertama
    if (newProjectId) {
      State.currentProjectStage = 'New Visit';
      UpdateProgressSheet.open(newProjectId, name, 'New Visit');
    }

    Router.refreshCurrentView();
  }
};

/* ============================================================
   11. SHEET: UPDATE PROGRESS
   ============================================================ */
const UpdateProgressSheet = {
  init() {
    document.querySelectorAll('#activity-type-grid .activity-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#activity-type-grid .activity-type-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        State.selectedActivityType = btn.dataset.activityType;
      });
    });

    document.getElementById('btn-take-photo').addEventListener('click', () => {
      document.getElementById('input-photo').click();
    });

    document.getElementById('input-photo').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const { base64, mimeType, previewUrl } = await Utils.compressAndReadImage(file);
        State.pendingPhotos.push({ base64, mimeType, previewUrl });
        this.renderPhotoThumbnails();
      } catch (err) {
        Snackbar.show('Gagal memproses foto, coba lagi');
      }
      e.target.value = ''; // reset input supaya bisa ambil foto lagi dari sumber sama
    });

    document.getElementById('select-pipeline-stage').addEventListener('change', (e) => {
      const lostGroup = document.getElementById('lost-reason-group');
      lostGroup.hidden = e.target.value !== 'Lost';
    });

    document.querySelectorAll('#lost-reason-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#lost-reason-chips .chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        State.selectedLostReason = chip.dataset.lostReason;
      });
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
      Snackbar.show('Pilih jenis aktivitas terlebih dahulu');
      return;
    }
    if (!note) {
      Snackbar.show('Catatan wajib diisi');
      return;
    }
    if (!followupDate) {
      Snackbar.show('Pilih tanggal follow up berikutnya');
      return;
    }
    if (stage === 'Lost' && !State.selectedLostReason) {
      Snackbar.show('Pilih alasan Lost terlebih dahulu');
      return;
    }
    // Catatan: foto SENGAJA tidak divalidasi wajib di sini — foto bersifat
    // opsional, boleh 0, 1, atau lebih dari 1.

    const activityPayload = {
      project_id: State.currentProjectId,
      activity_type: State.selectedActivityType,
      activity_note: note,
      pipeline_stage: stage,
      next_followup_date: followupDate,
      lost_reason: stage === 'Lost' ? State.selectedLostReason : undefined
    };

    const rawPhotos = State.pendingPhotos.map((p) => ({ base64: p.base64, mimeType: p.mimeType }));

    // Tutup sheet & beri feedback SEGERA — supaya sales tidak menunggu
    // proses upload/jaringan selesai dulu baru bisa lanjut kerja.
    // Proses upload+simpan aktivitas berjalan di background setelah ini.
    SheetManager.close('sheet-update-progress');
    Snackbar.show('Menyimpan...');

    try {
      // 1. Upload setiap foto satu per satu (kalau ada), kumpulkan photo_id-nya
      const photoIds = [];
      for (const photo of rawPhotos) {
        const uploadResult = await Api.rawCall('uploadPhoto', {
          project_id: State.currentProjectId,
          file_base64: photo.base64,
          mime_type: photo.mimeType
        });
        if (uploadResult.data && uploadResult.data.photo_id) {
          photoIds.push(uploadResult.data.photo_id);
        }
      }

      // 2. Buat Activity, kaitkan dengan seluruh photo_id hasil upload di atas
      const activityResult = await Api.rawCall('createActivity', Object.assign({}, activityPayload, { photo_ids: photoIds }));

      if (!activityResult.success) {
        Snackbar.show(activityResult.message || 'Gagal menyimpan aktivitas');
        return;
      }

      Snackbar.show('Aktivitas tersimpan');
      Router.refreshCurrentView();
    } catch (networkError) {
      // Jaringan gagal/lambat (timeout) di salah satu tahap manapun —
      // simpan SATU paket gabungan (aktivitas + seluruh foto mentah) ke
      // antrian lokal, supaya tidak ada foto yang "nyasar" tanpa aktivitas
      // saat proses sync belakangan.
      OfflineQueue.addActivityWithPhotos(activityPayload, rawPhotos);
      Snackbar.show('Tersimpan lokal (' + (rawPhotos.length + 1) + ' data) — akan dikirim otomatis saat online');
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

    document.querySelectorAll('#filter-stage-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filter-stage-chips .chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        State.filterStage = chip.dataset.filterStage;
      });
    });

    document.querySelectorAll('#filter-product-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filter-product-chips .chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        State.filterProduct = chip.dataset.filterProduct;
      });
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
  Snackbar.init();
  ThemeToggle.init();
  Router.init();
  SheetManager.init();
  DashboardView.init();
  AddProjectSheet.init();
  UpdateProgressSheet.init();
  FilterSheet.init();

  document.getElementById('header-title').textContent =
    'Halo, ' + SVS_CONFIG.SALES_NAME.split(' ')[0] + ' 👋';

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
    Snackbar.show('Mencoba sync...');
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
