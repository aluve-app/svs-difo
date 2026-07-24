/**
 * ============================================================
 * CONFIG.JS
 * ============================================================
 * File ini berisi identitas sales yang sedang menggunakan device
 * ini, beserta alamat Web App Apps Script tujuan.
 *
 * Sesuai keputusan V1 (tanpa login formal): setiap sales punya
 * SATU file config.js sendiri yang di-deploy ke device/akun mereka.
 * Nilai sales_code dan token HARUS cocok dengan baris yang sudah
 * didaftarkan di sheet Sales_Master pada backend.
 *
 * Untuk role Manager, cukup set ROLE menjadi 'manager' — dashboard
 * otomatis menampilkan data seluruh tim (bukan hanya milik 1 sales).
 * ============================================================
 */

const SVS_CONFIG = {
  // Identitas sales pengguna device ini — WAJIB cocok dengan sheet Sales_Master
  SALES_CODE: 'SLS-02',
  SALES_NAME: 'Difo',
  TOKEN: 'aluve-0002',

  // Role: 'sales' atau 'manager' — menentukan data apa yang ditampilkan di Dashboard
  ROLE: 'sales',

  // URL Web App hasil Deploy dari Apps Script (lihat tahap setup backend)
  API_URL: 'https://script.google.com/macros/s/AKfycbznquzDsslQsfk-p1AxHmvwer0PL98tmn-WQdN9roQWmObLLLeGm1eNC-Cuckdmok5m1g/exec',

  // Batas ukuran foto sebelum dikompresi (dalam piksel, sisi terpanjang)
  // Menjaga ukuran upload tetap kecil untuk sinyal lapangan yang lemah
  PHOTO_MAX_DIMENSION: 1280,
  PHOTO_QUALITY: 0.7
};
