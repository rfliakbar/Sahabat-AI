# Sahabat-AI

Sistem terpadu **AgriSuite** untuk toko saprotan & hasil tani: dashboard ERP, terminal kasir (POS), manajemen gudang (WMS), dan laporan keuangan dengan AI business insight.

## Live

- **Beranda:** <https://sahabat-ai.ridwanfatiya.workers.dev/>
- **Toko (Customer) — URL mandiri:** <https://sahabat-ai.ridwanfatiya.workers.dev/toko/>
- **Login Toko:** <https://sahabat-ai.ridwanfatiya.workers.dev/toko/login/>
- **Dashboard ERP:** <https://sahabat-ai.ridwanfatiya.workers.dev/erp/>
- **Kasir:** <https://sahabat-ai.ridwanfatiya.workers.dev/kasir/>
- **Gudang:** <https://sahabat-ai.ridwanfatiya.workers.dev/gudang/>
- **Admin:** <https://sahabat-ai.ridwanfatiya.workers.dev/admin/>
- **Satu pintu masuk staf (login):** <https://sahabat-ai.ridwanfatiya.workers.dev/login/>

## Arsitektur Integrasi Toko ↔ Website Utama

Toko memakai **origin, Worker, backend, dan database yang sama** dengan website utama — bukan sistem terpisah.

```
Browser ──> Cloudflare Worker (worker.js)
              ├── static assets: /, /erp/, /kasir/, /gudang/, /toko/
              ├── RBAC guard per peran (cookie sa_session)
              └── Durable Object "sahabat-ai-auth" (SQLite)
                    ├── users / sessions / activity_log   (staf ERP)
                    ├── customers                          (akun Toko)
                    ├── catalog                            (katalog bersama)
                    └── shop_orders                        (pesanan Toko)
```

- **Satu sumber katalog:** halaman **Gudang** memanggil `PUT /api/catalog` setiap kali produk/stok berubah (tambah, hapus, update stok, sinkron kasir). Data yang sama dibaca Toko lewat `GET /api/catalog`.
- **Satu sumber pesanan:** checkout Toko memanggil `POST /api/orders`; pesanan tersimpan di `shop_orders` pada Durable Object yang sama. Stok pada `catalog` otomatis berkurang, dan pembatalan mengembalikan stok.
- **Satu sistem autentikasi:** customer memakai `/api/customer/register` dan `/api/customer/login`, sesi tetap cookie `sa_session` (HttpOnly, SameSite=Lax, 12 jam) dengan role `customer`. Staf tetap memakai `/api/auth/login` dan tidak bisa membuka `/toko/` dengan role staf, begitu pula sebaliknya.
- **Same-origin:** karena `/toko/` berada di Worker yang sama, `localStorage` (`agristock_products_v1`, `agripos_catalog_snapshot`) dan `BroadcastChannel` (`agristock_pos_sync`) tetap berbagi data dengan Kasir/ERP saat dibuka di browser yang sama.

## Empat Peran: Staf ERP + Customer

Semua pengguna masuk lewat **`/login/`**. Pilih **Jenis akun** terlebih dahulu:

| Peran | Cara masuk | Diarahkan ke | Boleh mengakses |
|---|---|---|---|
| **Pemilik (Owner)** | Akun bawaan `admin@tokotani.id` / `admin123` | `/erp/` | Seluruh ERP, kasir, gudang, admin toko, **Manajemen Karyawan** |
| **Kasir** | Akun dibuat pemilik di menu Manajemen Karyawan | `/kasir/` | Terminal kasir & riwayat penjualan |
| **Gudang** | Akun dibuat pemilik di menu Manajemen Karyawan | `/gudang/` | Stok, barang masuk/keluar, produk, pergerakan inventory |
| **Customer** | Daftar/masuk di `/toko/login/` (atau `/login/` mode customer) | `/toko/` | Katalog, keranjang, checkout, lacak & pesanan saya |

- **Backend sungguhan:** akun, sesi, dan log aktivitas disimpan di SQLite-backed **Durable Object** (`worker.js`), bukan `localStorage`.
- Password di-hash dengan **PBKDF2-SHA256 (100.000 iterasi + salt acak 16 byte, batas maksimal WebCrypto Cloudflare Workers)**. Tidak ada password plain text di database maupun browser.
- Sesion memakai cookie `HttpOnly` + `SameSite=Lax` (`Secure` otomatis di HTTPS), berlaku 12 jam.
- **RBAC ditegakkan di Worker**: sebelum halaman internal dikirim, peran dicek dari sesi di database. Menu yang tidak diizinkan juga disembunyikan di frontend.
- Endpoint API: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/employees` (GET/POST/PATCH/DELETE, owner only), `/api/activity` (owner only), `/api/customer/register`, `/api/customer/login`, `/api/customer/me`, `/api/catalog` (GET semua peran, PUT owner/warehouse), `/api/orders` (POST customer, GET customer/owner/cashier), `/api/orders/:id` (PATCH owner/cashier).
- Akun bawaan pemilik hanya dipakai saat inisialisasi. Ganti lewat `vars` `INITIAL_OWNER_EMAIL` / `INITIAL_OWNER_PASSWORD` di `wrangler.jsonc` sebelum deploy pertama, lalu buat akun kasir/gudang lewat dashboard.
- Customer memakai akun backend sendiri (`customers`), sehingga bisa masuk dari perangkat lain tanpa bergantung pada `localStorage`.

### Toko (Customer) — `/toko/`

- Halaman mandiri dengan header sendiri, dapat dibuka langsung tanpa melewati beranda.
- Katalog dari `GET /api/catalog`: pencarian, filter kategori, harga, dan stok yang diperbarui dari Gudang.
- Keranjang, checkout (COD/transfer), kode pesanan `AGS-YYYYMMDD-NNN`, lacak pesanan, dan daftar **Pesanan saya**.
- Login/daftar di `/toko/login/`; tautan ke `/login/` tetap tersedia untuk staf.
- URL lama `/page/customer/` dan `/customer/` dialihkan permanen ke `/toko/`.

### Admin — `/page/admin/`

- Login admin lewat `/login/` dengan email **`admin@tokotani.id`** · password **`admin123`**.
- **Ringkasan:** omzet valid, pesanan baru, omzet hari ini, stok menipis, grafik omzet 7 hari, pesanan terbaru.
- **Pesanan:** filter status/pencarian, ubah status (Baru → Diproses → Dikirim → Selesai), batalkan (stok dikembalikan).
- **Produk:** tambah/edit produk, atur harga & stok, aktif/nonaktifkan dari toko.
- **Pelanggan:** rekap pelanggan dari pesanan (jumlah pesanan, total belanja, transaksi terakhir).
- **Reset demo** untuk mengembalikan data contoh.

> Catatan: autentikasi staf & RBAC kini memakai backend Worker + Durable Object. Data transaksi ERP/kasir/gudang masih memakai penyimpanan lokal browser yang sudah ada (lihat `page/erp/README.md`) dan tidak diubah oleh pembaruan ini.

Data katalog & pesanan Toko kini disimpan di Durable Object (`catalog`, `shop_orders`). `localStorage` (`agrisuite_shop_v1`, `agristock_products_v1`, `agripos_catalog_snapshot`) tetap dipakai modul ERP/Kasir/Gudang yang sudah ada.


## Menjalankan lokal

```powershell
python -m http.server 8080
```

Buka <http://localhost:8080/> untuk melihat tampilan statis. Route pendek (`/erp`, `/kasir`, `/gudang`, `/toko`, `/admin`) dan endpoint `/api/*` hanya aktif saat dijalankan sebagai Worker (Cloudflare atau `npx wrangler dev`). Secara lokal tanpa Worker, gunakan `/page/.../` — kecuali `/toko/`, yang membutuhkan Worker untuk autentikasi & katalog.

> Untuk mencoba Toko dan login staf/RBAC secara lokal, jalankan `npx wrangler dev` (membutuhkan Node.js) atau langsung gunakan deployment Cloudflare.

## Deploy ke Cloudflare

Situs ini di-deploy sebagai **Cloudflare Worker** (`worker.js`) yang melayani API sekaligus static assets dari folder root repo. Akun/sesi memakai satu SQLite-backed Durable Object `AuthStore` yang dibuat otomatis lewat `exports` di `wrangler.jsonc`.

### Otomatis (utama)

Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) berjalan setiap **push ke `main`** (dan bisa dipicu manual dari tab Actions).

```
git push origin main  →  GitHub Actions  →  Cloudflare (live ±1 menit)
```

Membutuhkan secret repo `CLOUDFLARE_API_TOKEN` (API token Cloudflare dengan izin **Workers Scripts: Edit** dan **Durable Objects: Edit**). Migration Durable Object dijalankan otomatis saat deploy; tidak perlu membuat database/manual step.

### Manual (cadangan)

```powershell
npx wrangler deploy --name sahabat-ai
```

Konfigurasi ada di `wrangler.jsonc` (`main: worker.js`, assets directory `.`, binding `AUTH_STORE`, `ASSETS`, `run_worker_first: true`, custom 404 page). File `.assetsignore` mengecualikan `.git`, `.github`, `node_modules`, `worker.js`, dan konfigurasi deploy dari publik.

Panduan modul ERP selengkapnya: [`page/erp/README.md`](page/erp/README.md).
