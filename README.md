# Sahabat-AI

Sistem terpadu **AgriSuite** untuk toko saprotan & hasil tani: dashboard ERP, terminal kasir (POS), manajemen gudang (WMS), dan laporan keuangan dengan AI business insight.

## Live

- **Beranda:** <https://sahabat-ai.ridwanfatiya.workers.dev/>
- **Dashboard ERP:** <https://sahabat-ai.ridwanfatiya.workers.dev/erp/>
- **Kasir:** <https://sahabat-ai.ridwanfatiya.workers.dev/kasir/>
- **Gudang:** <https://sahabat-ai.ridwanfatiya.workers.dev/gudang/>
- **Toko (Customer):** <https://sahabat-ai.ridwanfatiya.workers.dev/customer/>
- **Admin:** <https://sahabat-ai.ridwanfatiya.workers.dev/admin/>
- **Satu pintu masuk (login):** <https://sahabat-ai.ridwanfatiya.workers.dev/login/>

## Satu Link Login, Tiga Peran ERP + Customer

Semua pengguna masuk lewat **`/login/`**. Pilih **Jenis akun** terlebih dahulu:

| Peran | Cara masuk | Diarahkan ke | Boleh mengakses |
|---|---|---|---|
| **Pemilik (Owner)** | Akun bawaan `admin@tokotani.id` / `admin123` | `/erp/` | Seluruh ERP, kasir, gudang, admin toko, **Manajemen Karyawan** |
| **Kasir** | Akun dibuat pemilik di menu Manajemen Karyawan | `/kasir/` | Terminal kasir & riwayat penjualan |
| **Gudang** | Akun dibuat pemilik di menu Manajemen Karyawan | `/gudang/` | Stok, barang masuk/keluar, produk, pergerakan inventory |
| **Customer** | Daftar akun baru / email pribadi | `/customer/` | Katalog & pesanan toko |

- **Backend sungguhan:** akun, sesi, dan log aktivitas disimpan di SQLite-backed **Durable Object** (`worker.js`), bukan `localStorage`.
- Password di-hash dengan **PBKDF2-SHA256 (100.000 iterasi + salt acak 16 byte, batas maksimal WebCrypto Cloudflare Workers)**. Tidak ada password plain text di database maupun browser.
- Sesion memakai cookie `HttpOnly` + `SameSite=Lax` (`Secure` otomatis di HTTPS), berlaku 12 jam.
- **RBAC ditegakkan di Worker**: sebelum halaman internal dikirim, peran dicek dari sesi di database. Menu yang tidak diizinkan juga disembunyikan di frontend.
- Endpoint API: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/employees` (GET/POST/PATCH/DELETE, owner only), `/api/activity` (owner only).
- Akun bawaan pemilik hanya dipakai saat inisialisasi. Ganti lewat `vars` `INITIAL_OWNER_EMAIL` / `INITIAL_OWNER_PASSWORD` di `wrangler.jsonc` sebelum deploy pertama, lalu buat akun kasir/gudang lewat dashboard.
- Customer tetap memakai alur toko lama (`localStorage`) agar fitur belanja tidak berubah.

Dua halaman baru dengan data toko yang saling terhubung (produk, stok, dan pesanan) melalui `localStorage` + `BroadcastChannel`.

### Customer — `/page/customer/`

- Katalog produk dengan pencarian & filter kategori, harga, dan stok real-time.
- Keranjang (ubah jumlah) lalu checkout tanpa akun: nama, HP, alamat, catatan, metode bayar (COD/transfer).
- Pesanan memotong stok otomatis dan mendapat kode unik `AGS-YYYYMMDD-NNN`.
- **Lacak pesanan** memakai kode tersebut, lengkap dengan progres status.

### Admin — `/page/admin/`

- Login admin lewat `/login/` dengan email **`admin@tokotani.id`** · password **`admin123`**.
- **Ringkasan:** omzet valid, pesanan baru, omzet hari ini, stok menipis, grafik omzet 7 hari, pesanan terbaru.
- **Pesanan:** filter status/pencarian, ubah status (Baru → Diproses → Dikirim → Selesai), batalkan (stok dikembalikan).
- **Produk:** tambah/edit produk, atur harga & stok, aktif/nonaktifkan dari toko.
- **Pelanggan:** rekap pelanggan dari pesanan (jumlah pesanan, total belanja, transaksi terakhir).
- **Reset demo** untuk mengembalikan data contoh.

> Catatan: autentikasi staf & RBAC kini memakai backend Worker + Durable Object. Data transaksi ERP/kasir/gudang masih memakai penyimpanan lokal browser yang sudah ada (lihat `page/erp/README.md`) dan tidak diubah oleh pembaruan ini.

Data toko tersimpan pada kunci `localStorage` **`agrisuite_shop_v1`** (logika bersama di `page/shop/store.js`).


## Menjalankan lokal

```powershell
python -m http.server 8080
```

Buka <http://localhost:8080/> untuk melihat tampilan statis. Route pendek (`/erp`, `/kasir`, `/gudang`, `/customer`, `/admin`) dan endpoint `/api/*` hanya aktif saat dijalankan sebagai Worker (Cloudflare atau `npx wrangler dev`). Secara lokal tanpa Worker, gunakan `/page/.../`.

> Untuk mencoba login staf/RBAC secara lokal, jalankan `npx wrangler dev` (membutuhkan Node.js) atau langsung gunakan deployment Cloudflare.

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
