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

## Satu Link, Dua Peran

Semua pengguna masuk lewat **satu tautan: `/login/`**. Sistem login menentukan peran secara otomatis:

| Peran | Cara masuk | Diarahkan ke |
|---|---|---|
| **Customer** | Daftar akun baru atau masuk dengan email pribadi | `/page/customer/` |
| **Admin** | Email khusus toko **`admin@tokotani.id`** + password | `/page/erp/` (dashboard ERP = tampilan admin) |

- Password admin demo: **`admin123`**.
- Admin yang berhasil masuk langsung diarahkan ke **dashboard ERP** (`/erp/`), yang berfungsi sebagai tampilan akun admin. Panel kelola toko tetap dapat dibuka dari menu **Kelola Toko (Admin)** di sidebar ERP.
- Email berdomain `@tokotani.id` otomatis dikenali sebagai admin (badge berubah saat email diketik).
- Customer tidak diizinkan memakai email toko saat mendaftar.
- Sesi disimpan di `localStorage`, jadi tidak perlu login ulang saat membuka halaman.
- Guard peran: customer yang membuka `/admin/` dikembalikan ke toko; admin yang membuka `/customer/` dikembalikan ke dashboard.
- Tombol **Keluar** tersedia di header kedua halaman dan menghapus sesi.

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

> Catatan: ini demo statis tanpa backend. Login admin hanya pembatas tampilan di sisi klien — jangan gunakan untuk data nyata.

Data toko tersimpan pada kunci `localStorage` **`agrisuite_shop_v1`** (logika bersama di `page/shop/store.js`).


## Menjalankan lokal

```powershell
python -m http.server 8080
```

Buka <http://localhost:8080/>. `_redirects` (URL pendek `/erp`, `/kasir`, `/gudang`, `/customer`, `/admin`) hanya aktif di Cloudflare; secara lokal gunakan `/page/erp/`, `/page/kasir/`, `/page/gudang/`, `/page/customer/`, `/page/admin/`.

> `/customer/` dan `/admin/` juga tersedia di lokal melalui halaman pengalihan di folder `customer/` dan `admin/`.

## Deploy ke Cloudflare

Situs ini di-deploy sebagai **Cloudflare Workers Static Assets** langsung dari folder root repo.

### Otomatis (utama)

Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) berjalan setiap **push ke `main`** (dan bisa dipicu manual dari tab Actions).

```
git push origin main  →  GitHub Actions  →  Cloudflare (live ±1 menit)
```

Membutuhkan secret repo `CLOUDFLARE_API_TOKEN` (API token Cloudflare dengan izin Workers Scripts: Edit).

### Manual (cadangan)

```powershell
npx wrangler deploy --name sahabat-ai
```

Konfigurasi ada di `wrangler.jsonc` (asset directory `.`, custom 404 page). File `.assetsignore` mengecualikan `.git`, `.github`, `node_modules`, dan konfigurasi deploy dari publik.

Panduan modul ERP selengkapnya: [`page/erp/README.md`](page/erp/README.md).
