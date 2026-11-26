# AgriERP — Sistem ERP Terpadu Toko Saprotan & Hasil Tani

Modul ERP yang menyatukan **Kasir (AgriPOS)**, **Gudang (AgriStock WMS)**, dan **Laporan Keuangan** dalam satu dashboard, dilengkapi **AI Business Insight** untuk rekomendasi strategi bisnis.

## Cara Menjalankan

### Opsi 1 — Server lokal (disarankan)
```powershell
cd "path\ke\sahabat-AI"
python -m http.server 8080
```
Buka: <http://localhost:8080/page/erp/index.html>

### Opsi 2 — Buka langsung
Klik dua kali `page/erp/index.html`. Semua fitur inti (dashboard, filter periode, AI lokal) tetap berjalan.

### Opsi 3 — Versi online (Cloudflare)
<https://sahabat-ai.ridwanfatiya.workers.dev/erp/>

Deploy ulang dari root repo: `npx wrangler deploy --name sahabat-ai`.

> Modul Kasir dan Gudang dibuka dari menu **Integrasi** di sidebar ERP (tab baru).
> Agar sinkronisasi real-time aktif, buka Kasir/Gudang dan ERP pada browser yang sama.

## Fitur

| Modul | Isi |
|---|---|
| **Dashboard** | KPI omzet, transaksi, laba bersih, nilai inventori; tren penjualan & laba; komposisi pembayaran; produk terlaris; omzet per kategori; peringatan stok; transaksi terbaru |
| **Penjualan (Kasir)** | Agregasi per hari / bulan / tahun, kinerja kategori & kasir, riwayat transaksi dengan pencarian |
| **Stok & Gudang** | Nilai inventori, perputaran stok, pergerakan masuk vs terjual, status inventori, rekomendasi restock otomatis, log pergerakan & pembelian |
| **Laporan Keuangan** | Pendapatan, HPP, laba kotor, biaya pembayaran, opex, laba bersih; grafik 12 bulan; rekap bulanan; cetak laporan |
| **AI Business Insight** | 7+ insight otomatis (tren, margin, stok kritis, dead stock, pola jam/hari, metode bayar, perputaran), roadmap strategi 7/30/90 hari, Q&A bisnis |
| **Manajemen Karyawan** | (Owner only) Tambah/edit/nonaktifkan/hapus akun Kasir & Gudang, lihat daftar dan log aktivitas akun — tersimpan di backend SQLite |
| **Pengaturan** | Nama toko, penyedia AI, log aktivitas, reset data |

## Filter Periode

Preset: **Hari ini, 7 Hari, 30 Hari, Bulan ini, Tahun ini, Semua**.
Agregasi: **Otomatis / Per Hari / Per Bulan / Per Tahun**.

## Akses & Peran (RBAC)

| Peran | Dashboard | Kasir | Gudang | Manajemen Karyawan |
|---|---|---|---|---|
| Pemilik (`owner`) | ✅ | ✅ | ✅ | ✅ |
| Kasir (`cashier`) | ❌ | ✅ | ❌ | ❌ |
| Gudang (`warehouse`) | ❌ | ❌ | ✅ | ❌ |

Login staf memakai `/login/` → pilih **Pemilik / Karyawan (ERP)**. Setelah login, Worker membaca role dari database dan mengarahkan ke dashboard masing-masing. Halaman internal (`/erp/`, `/kasir/`, `/gudang/`, `/admin/`) ditolak di **backend** bila role tidak sesuai — bukan hanya disembunyikan di menu.

- Akun pemilik bawaan: `admin@tokotani.id` / `admin123` (di-hash PBKDF2 di database).
- Kasir & gudang dibuat pemilik lewat menu **Manajemen Karyawan** di sidebar ERP.
- Endpoint backend: `/api/auth/*`, `/api/employees`, `/api/activity` (lihat `worker.js`).
- Klien API ERP ada di `assets/employees.js`; data akun tidak memakai `localStorage`.

## Integrasi AI

Tiga mode, diatur di **Pengaturan & AI**:

1. **Analitik Lokal (default)** — offline, tanpa API key. Menghitung insight & strategi langsung dari data ERP.
2. **OpenAI-compatible** — endpoint + model + API key (OpenAI, OpenRouter, Groq, LM Studio, dsb).
   Contoh endpoint: `https://api.openai.com/v1/chat/completions`, model `gpt-4o-mini`.
3. **Ollama** — model lokal, default endpoint `http://localhost:11434`, model `llama3.1`.

API key disimpan di `localStorage` browser dan hanya dikirim saat Anda menekan tombol analisis. Bila panggilan AI gagal, sistem otomatis memakai analitik lokal.

## Integrasi Kasir & Gudang

- Kanal: `BroadcastChannel('agristock_pos_sync')`.
- Kasir mengirim `POS_SALE_COMPLETED`; ERP mencatat transaksi dan memotong stok.
- Gudang mengirim `CATALOG_UPDATED`; ERP memperbarui harga & stok.
- **Buffering**: bila ERP tertutup, Kasir menyimpan transaksi ke `localStorage` (`agripos_pending_sales`) dan Gudang menyimpan snapshot stok (`agripos_catalog_snapshot`). Saat ERP dibuka, antrean otomatis diproses (dengan deduplikasi `clientId`).

## Struktur Berkas

```
page/erp/
├── index.html          # Kerangka UI & seluruh view
├── assets/
│   ├── styles.css      # Gaya kustom, print styles, komponen
│   ├── data.js         # Data layer: seed demo, agregasi, storage, realtime bridge
│   ├── ai.js           # Mesin insight lokal + integrasi LLM
│   ├── employees.js    # Klien API akun/karyawan (/api/*)
│   └── app.js          # Render UI, chart, filter, ekspor, event, Manajemen Karyawan
└── README.md
```

## Catatan Data

- Data demo dibangkitkan deterministik (18 bulan transaksi, 14 SKU, ±7.000 transaksi) dan disimpan di `localStorage` dengan kunci `agripos_erp_v1`.
- Gunakan **Reset Data** di Pengaturan untuk membangun ulang dataset demo.
- Ekspor CSV tersedia per modul sesuai filter periode aktif.
