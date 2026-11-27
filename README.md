# Sahabat-AI

Sistem terpadu **AgriSuite** untuk toko saprotan & hasil tani: dashboard ERP, terminal kasir (POS), manajemen gudang (WMS), dan laporan keuangan dengan AI business insight.

## Live

- **Beranda:** <https://sahabat-ai.ridwanfatiya.workers.dev/>
- **Toko (Customer) — URL mandiri:** <https://sahabat-ai.ridwanfatiya.workers.dev/toko/>
- **Katalog produk:** <https://sahabat-ai.ridwanfatiya.workers.dev/toko/#produk>
- **Keranjang (tanpa login):** <https://sahabat-ai.ridwanfatiya.workers.dev/toko/keranjang/>
- **Akun & riwayat pesanan:** <https://sahabat-ai.ridwanfatiya.workers.dev/toko/akun/>
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
              ├── RBAC guard per halaman (cookie sa_session)
              └── Durable Object "sahabat-ai-auth" (SQLite)
                    ├── users / sessions / activity_log   (staf ERP)
                    ├── customers                          (akun pelanggan)
                    ├── catalog                            (katalog bersama)
                    ├── shop_orders                        (pesanan Toko)
                    └── pos_sales                          (penjualan Kasir)
```

- **Satu sumber katalog:** `GET /api/catalog` bersifat publik dan hanya mengembalikan field aman (`id`, `sku`, `name`, `category`, `price`, `unit`, `stock`, `image`, `active`, `updatedAt`). Gudang, Kasir, Admin, dan Toko membaca/menulis katalog yang sama lewat API; harga pokok/HPP tidak pernah dikirim ke publik.
- **Satu sumber transaksi:** checkout Toko memanggil `POST /api/orders`; penjualan kasir memanggil `POST /api/pos/sales`. Keduanya tersimpan di Durable Object yang sama, divalidasi backend (harga, stok, diskon, pajak, total), dan mengurangi stok `catalog`. Pembatalan pesanan Toko mengembalikan stok.
- **Idempoten:** `clientId` pada checkout dan penjualan kasir mencegah dobel submit/dobel potong stok. Pengiriman ulang mengembalikan catatan yang sudah ada.
- **Satu sistem autentikasi:** customer memakai `/api/customer/register` dan `/api/customer/login`, sesi tetap cookie `sa_session` (HttpOnly, SameSite=Lax, 12 jam) dengan role `customer`. Staf tetap memakai `/api/auth/login`. Role `customer` tidak bisa membuka `/erp/`, `/kasir/`, `/gudang/`, atau `/admin/`; role staf tidak dipakai untuk checkout pelanggan.
- **Same-origin:** karena `/toko/` berada di Worker yang sama, keranjang memakai `localStorage` browser yang sama dengan modul lain. `BroadcastChannel` (`agristock_pos_sync`) tetap dipakai untuk sinkronisasi antar halaman internal.

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
- Endpoint API: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/employees` (GET/POST/PATCH/DELETE, owner only), `/api/activity` (owner only), `/api/customer/register`, `/api/customer/login`, `/api/customer/me`, `/api/catalog` (GET publik, PUT owner/warehouse), `/api/payment-methods` (publik), `/api/orders` (POST customer, GET customer/owner/cashier), `/api/orders/:id` (PATCH owner/cashier), `/api/orders/:id/payment` (PATCH owner/cashier), `/api/pos/sales` (POST owner/cashier).
- Akun bawaan pemilik hanya dipakai saat inisialisasi. Ganti lewat `vars` `INITIAL_OWNER_EMAIL` / `INITIAL_OWNER_PASSWORD` di `wrangler.jsonc` sebelum deploy pertama, lalu buat akun kasir/gudang lewat dashboard.
- Customer memakai akun backend sendiri (`customers`), sehingga bisa masuk dari perangkat lain tanpa bergantung pada `localStorage`.

### Toko (Customer) — `/toko/`

- **Publik tanpa login:** Home, Produk, detail produk, pencarian nama, filter kategori, sorting A–Z/Z–A dan harga, harga jual, status stok, tambah ke keranjang, serta kelola keranjang di `/toko/keranjang/`.
- **Wajib login:** `/toko/checkout/`, `/toko/akun/`, dan `/toko/pesanan/` (mengalihkan ke akun). Jika belum login saat checkout, halaman login menerima `?next=/toko/checkout/` dan mengembalikan pelanggan ke checkout dengan keranjang tetap utuh.
- **Keranjang persisten:** `localStorage` menyimpan produk, jumlah, dan snapshot harga/gambar. Saat keranjang/checkout dibuka, backend membandingkan harga dan stok terbaru; produk habis atau harga berubah diberi peringatan dan tidak bisa dipesan jika stok kurang.
- **Checkout tervalidasi backend:** nama/HP/alamat diisi pelanggan, metode bayar diambil dari `/api/payment-methods`, total dihitung ulang server, stok dicek server, dan `clientId` mencegah pesanan dobel. Kode pesanan unik berbentuk `AGS-YYYYMMDD-NNN-XX`.
- **Pembayaran jujur:** hanya `cod` (Bayar di Tempat/Kasir) dan `transfer` yang tersedia. Status awal masing-masing `belum_dibayar` dan `menunggu_verifikasi`; status tidak otomatis `lunas` karena tidak ada gateway pembayaran online yang terhubung. Staf dapat mengubah status melalui `PATCH /api/orders/:id/payment`.
- **Riwayat pelanggan:** `/toko/akun/` menampilkan profil, nomor pesanan, status pesanan, status pembayaran, metode bayar, total, dan item pesanan.
- Identitas toko memakai logo/foto asli, alamat lengkap, serta footer `© PT. MERTANI ID.` dan `All Rights Reserved.`.
- Login/daftar di `/toko/login/`; tautan ke `/login/` tetap tersedia untuk staf. URL lama `/page/customer/` dan `/customer/` dialihkan permanen ke `/toko/`.

### Admin — `/page/admin/`

- Login admin lewat `/login/` dengan email **`admin@tokotani.id`** · password **`admin123`**.
- **Ringkasan:** omzet valid, pesanan baru, omzet hari ini, stok menipis, grafik omzet 7 hari, pesanan terbaru.
- **Pesanan:** filter status/pencarian, ubah status (Baru → Diproses → Dikirim → Selesai), batalkan (stok dikembalikan).
- **Produk:** tambah/edit produk, atur harga & stok, aktif/nonaktifkan dari toko.
- **Pelanggan:** rekap pelanggan dari pesanan (jumlah pesanan, total belanja, transaksi terakhir).
- **Reset demo** untuk mengembalikan data contoh.

> Catatan: autentikasi staf & RBAC memakai backend Worker + Durable Object. Analitik ERP masih membaca antrean `agripos_pending_sales` di `localStorage` (lihat `page/erp/README.md`), tetapi penjualan kasir kini **juga** dicatat di tabel backend `pos_sales` agar stok dan transaksi menjadi sumber bersama dengan Toko.

Data katalog, pesanan Toko, dan penjualan Kasir disimpan di Durable Object (`catalog`, `shop_orders`, `pos_sales`). `localStorage` (`agrisuite_shop_v1`, `agristock_products_v1`, `agripos_catalog_snapshot`) tetap dipakai modul ERP/Kasir/Gudang yang sudah ada sebagai cache antarmuka.


## Menjalankan lokal

```powershell
python -m http.server 8080
```

Buka <http://localhost:8080/> untuk melihat tampilan statis. Halaman `/toko/`, `/toko/keranjang/`, dan `/toko/login/` dapat dirender, tetapi `/api/catalog`, `/api/orders`, dan endpoint lain mengembalikan 404 tanpa Worker. Route pendek (`/erp`, `/kasir`, `/gudang`, `/toko`, `/admin`), RBAC, dan seluruh alur checkout hanya aktif saat dijalankan sebagai Worker.

> Untuk mencoba katalog, keranjang dengan data backend, login, checkout, dan RBAC secara lokal, jalankan `npx wrangler dev` (membutuhkan Node.js) atau langsung gunakan deployment Cloudflare.

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
