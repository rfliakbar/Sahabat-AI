# Sahabat-AI

Sistem terpadu **AgriSuite** untuk toko saprotan & hasil tani: dashboard ERP, terminal kasir (POS), manajemen gudang (WMS), dan laporan keuangan dengan AI business insight.

## Live

- **Beranda:** <https://sahabat-ai.ridwanfatiya.workers.dev/>
- **Dashboard ERP:** <https://sahabat-ai.ridwanfatiya.workers.dev/erp/>
- **Kasir:** <https://sahabat-ai.ridwanfatiya.workers.dev/kasir/>
- **Gudang:** <https://sahabat-ai.ridwanfatiya.workers.dev/gudang/>
- **Toko (Customer):** <https://sahabat-ai.ridwanfatiya.workers.dev/customer/>
- **Admin:** <https://sahabat-ai.ridwanfatiya.workers.dev/admin/>

## Halaman Customer & Admin

Dua halaman baru dengan data toko yang saling terhubung (produk, stok, dan pesanan) melalui `localStorage` + `BroadcastChannel`.

### Customer — `/page/customer/`

- Katalog produk dengan pencarian & filter kategori, harga, dan stok real-time.
- Keranjang (ubah jumlah) lalu checkout tanpa akun: nama, HP, alamat, catatan, metode bayar (COD/transfer).
- Pesanan memotong stok otomatis dan mendapat kode unik `AGS-YYYYMMDD-NNN`.
- **Lacak pesanan** memakai kode tersebut, lengkap dengan progres status.

### Admin — `/page/admin/`

- Login demo: **username `admin`** · **password `admin123`** (disimpan di `sessionStorage`).
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

Buka <http://localhost:8080/>. Catatan: `_redirects` (URL pendek `/erp`, `/kasir`, `/gudang`) hanya aktif di Cloudflare; secara lokal gunakan `/page/erp/`, `/page/kasir/`, `/page/gudang/`.

## Deploy ke Cloudflare

Situs ini di-deploy sebagai **Cloudflare Workers Static Assets** (Pages versi terbaru) langsung dari folder root repo.

Sekali setup:

```powershell
npx wrangler login
```

Setiap kali ada perubahan:

```powershell
npx wrangler deploy --name sahabat-ai
```

Konfigurasi ada di `wrangler.jsonc` (asset directory `.`, custom 404 page). File `.assetsignore` mengecualikan `.git` dan konfigurasi deploy dari publik.

Panduan modul ERP selengkapnya: [`page/erp/README.md`](page/erp/README.md).
