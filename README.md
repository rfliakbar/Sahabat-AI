# Sahabat-AI

Sistem terpadu **AgriSuite** untuk toko saprotan & hasil tani: dashboard ERP, terminal kasir (POS), manajemen gudang (WMS), dan laporan keuangan dengan AI business insight.

## Live

- **Beranda:** <https://sahabat-ai.ridwanfatiya.workers.dev/>
- **Dashboard ERP:** <https://sahabat-ai.ridwanfatiya.workers.dev/erp/>
- **Kasir:** <https://sahabat-ai.ridwanfatiya.workers.dev/kasir/>
- **Gudang:** <https://sahabat-ai.ridwanfatiya.workers.dev/gudang/>

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
