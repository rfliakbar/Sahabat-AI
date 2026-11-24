/**
 * AgriERP — Lapisan Data Terpadu
 * -------------------------------------------------
 * Menyatukan aktivitas Kasir (AgriPOS) & Gudang (AgriStock WMS)
 * ke dalam satu sumber kebenaran (single source of truth) di localStorage.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'agripos_erp_v1';
  const SCHEMA_VERSION = 3;
  const CHANNEL_NAME = 'agristock_pos_sync';

  /* ------------------------------------------------------------------ */
  /* Utilitas                                                            */
  /* ------------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const rupiah = (n) =>
    'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

  const rupiahShort = (n) => {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1).replace('.', ',') + ' M';
    if (Math.abs(n) >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + ' jt';
    if (Math.abs(n) >= 1e3) return 'Rp ' + Math.round(n / 1e3) + ' rb';
    return 'Rp ' + n;
  };

  const num = (n) => (Number(n) || 0).toLocaleString('id-ID');

  // RNG deterministik agar data demo konsisten antar reload
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PRODUCTS = [
    { id: 'PRD-1001', sku: 'BNH-PADI-32', name: 'Benih Padi Unggul Inpari 32 (5kg)', category: 'Benih', price: 75000, cost: 54000, unit: 'karung', image: 'https://placehold.co/400x300/278b4d/ffffff?text=Benih+Padi', shelfMax: 20, shelfMin: 5 },
    { id: 'PRD-1002', sku: 'PPK-NPK-16', name: 'Pupuk NPK Mutiara 16-16-16 (1kg)', category: 'Pupuk', price: 22000, cost: 15500, unit: 'karung', image: 'https://placehold.co/400x300/38ab63/ffffff?text=Pupuk+NPK', shelfMax: 25, shelfMin: 6 },
    { id: 'PRD-1003', sku: 'PST-ORG-500', name: 'Pestisida Nabati Neem Oil 500ml', category: 'Pestisida', price: 48000, cost: 31000, unit: 'botol', image: 'https://placehold.co/400x300/1e5835/ffffff?text=Pestisida+Nabati', shelfMax: 15, shelfMin: 4 },
    { id: 'PRD-1004', sku: 'ALT-SPRY-16L', name: 'Tangki Sprayer Elektrik Pertanian 16L', category: 'Alat Pertanian', price: 465000, cost: 340000, unit: 'unit', image: 'https://placehold.co/400x300/216e3f/ffffff?text=Sprayer+16L', shelfMax: 6, shelfMin: 2 },
    { id: 'PRD-1005', sku: 'PPK-UREA-50', name: 'Pupuk Urea Premium (50kg)', category: 'Pupuk', price: 185000, cost: 142000, unit: 'karung', image: 'https://placehold.co/400x300/5fc684/ffffff?text=Urea+50kg', shelfMax: 12, shelfMin: 3 },
    { id: 'PRD-1006', sku: 'BNH-JAGUNG-1', name: 'Benih Jagung Hibrida Bisi-18 (1kg)', category: 'Benih', price: 62000, cost: 44000, unit: 'pak', image: 'https://placehold.co/400x300/96deaf/0d2718?text=Jagung+Bisi-18', shelfMax: 18, shelfMin: 4 },
    { id: 'PRD-1007', sku: 'PST-GLIF-1L', name: 'Herbisida Glifosat 480 SL (1L)', category: 'Pestisida', price: 58000, cost: 39000, unit: 'botol', image: 'https://placehold.co/400x300/278b4d/ffffff?text=Glifosat', shelfMax: 20, shelfMin: 5 },
    { id: 'PRD-1008', sku: 'ALT-CANGKUL', name: 'Cangkul Baja Handle Kayu', category: 'Alat Pertanian', price: 95000, cost: 61000, unit: 'unit', image: 'https://placehold.co/400x300/1a482d/ffffff?text=Cangkul+Baja', shelfMax: 10, shelfMin: 3 },
    { id: 'PRD-1009', sku: 'ALT-SELANG-50', name: 'Selang Irigasi PE 1 inch (50m)', category: 'Alat Pertanian', price: 210000, cost: 155000, unit: 'roll', image: 'https://placehold.co/400x300/38ab63/ffffff?text=Selang+Irigasi', shelfMax: 8, shelfMin: 2 },
    { id: 'PRD-1010', sku: 'HSL-BERAS-25', name: 'Beras Premium Hasil Tani (25kg)', category: 'Hasil Tani', price: 320000, cost: 265000, unit: 'karung', image: 'https://placehold.co/400x300/f3efe6/5c4d3c?text=Beras+Premium', shelfMax: 15, shelfMin: 4 },
    { id: 'PRD-1011', sku: 'PPK-KMPK-25', name: 'Pupuk KCL / MOP (25kg)', category: 'Pupuk', price: 145000, cost: 108000, unit: 'karung', image: 'https://placehold.co/400x300/216e3f/ffffff?text=Pupuk+KCL', shelfMax: 12, shelfMin: 3 },
    { id: 'PRD-1012', sku: 'PST-INSEK-250', name: 'Insektisida Cair 250ml', category: 'Pestisida', price: 39000, cost: 25000, unit: 'botol', image: 'https://placehold.co/400x300/5fc684/0d2718?text=Insektisida', shelfMax: 18, shelfMin: 5 },
    { id: 'PRD-1013', sku: 'HSL-JAGUNG-50', name: 'Jagung Pipil Kering (50kg)', category: 'Hasil Tani', price: 385000, cost: 315000, unit: 'karung', image: 'https://placehold.co/400x300/f3efe6/5c4d3c?text=Jagung+Pipil', shelfMax: 10, shelfMin: 3 },
    { id: 'PRD-1014', sku: 'ALT-GEMBOR', name: 'Gembor Semprot 5L', category: 'Alat Pertanian', price: 68000, cost: 43000, unit: 'unit', image: 'https://placehold.co/400x300/1e5835/ffffff?text=Gembor+5L', shelfMax: 12, shelfMin: 4 }
  ];

  const CASHIERS = ['Rina', 'Bagus', 'Sari'];
  const PAYMENTS = [
    { id: 'cash', label: 'Tunai', weight: 0.38, fee: 0 },
    { id: 'qris', label: 'QRIS', weight: 0.34, fee: 0.007 },
    { id: 'transfer', label: 'Transfer Bank', weight: 0.20, fee: 0 },
    { id: 'card', label: 'Kartu Debit/Kredit', weight: 0.08, fee: 0.02 }
  ];

  const OPS_TEMPLATE = [
    { name: 'Gaji Karyawan', amount: 4500000 },
    { name: 'Sewa Toko & Gudang', amount: 2000000 },
    { name: 'Listrik & Air', amount: 620000 },
    { name: 'Transport & Distribusi', amount: 480000 },
    { name: 'Pemasaran & Promosi', amount: 350000 },
    { name: 'Perawatan & Lain-lain', amount: 260000 }
  ];

  function pickPayment(rnd) {
    let r = rnd(), acc = 0;
    for (const p of PAYMENTS) { acc += p.weight; if (r <= acc) return p; }
    return PAYMENTS[0];
  }

  function seasonality(d) {
    const m = d.getMonth(); // 0..11
    // Musim tanam: Mar–Apr & Sep–Okt (permintaan benih/pupuk naik)
    const planting = (m === 2 || m === 3) ? 1.55 : (m === 8 || m === 9) ? 1.45 : 1;
    const panen = (m === 4 || m === 5 || m === 10 || m === 11) ? 1.25 : 1; // hasil tani
    const dow = d.getDay();
    const weekend = (dow === 0 || dow === 6) ? 1.18 : 1;
    return planting * panen * weekend;
  }

  /* ------------------------------------------------------------------ */
  /* Seeding data demo                                                   */
  /* ------------------------------------------------------------------ */
  function seed() {
    const rnd = mulberry32(20261117);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 17, 1);

    const products = PRODUCTS.map((p) => ({
      ...p,
      warehouseStock: 40 + Math.floor(rnd() * 120),
      shelfCurrent: Math.max(p.shelfMin - 1, Math.floor(rnd() * p.shelfMax))
    }));

    const sales = [];
    const purchases = [];
    const expenses = [];
    const stockMoves = [];
    let invoiceSeq = 1;

    const cursor = new Date(start);
    const dayMs = 86400000;

    while (cursor <= now) {
      const dayFactor = seasonality(cursor);
      const trend = 1 + (cursor - start) / (dayMs * 620); // pertumbuhan bisnis bertahap
      const isClosed = cursor.getDay() === 1 ? false : true; // tutup tiap Senin (variasi realistis)

      if (isClosed) {
        const txs = Math.max(2, Math.round((5 + rnd() * 6) * dayFactor * trend));
        for (let t = 0; t < txs; t++) {
          const hour = 8 + Math.floor(rnd() * 9);
          const minute = Math.floor(rnd() * 60);
          const ts = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hour, minute, Math.floor(rnd() * 60));

          const lineCount = 1 + Math.floor(rnd() * 3);
          const chosen = new Set();
          const items = [];
          for (let l = 0; l < lineCount; l++) {
            let p = products[Math.floor(rnd() * products.length)];
            if (chosen.has(p.sku)) continue;
            chosen.add(p.sku);
            const bulky = /Pupuk|Hasil Tani/.test(p.category);
            const qty = bulky ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 4);
            items.push({ sku: p.sku, name: p.name, category: p.category, qty, price: p.price, cost: p.cost });
          }
          if (!items.length) continue;

          const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
          const discountPct = rnd() < 0.22 ? (rnd() < 0.6 ? 5 : 10) : 0;
          const discount = Math.round((subtotal * discountPct) / 100);
          const after = subtotal - discount;
          const tax = Math.round(after * 0.11);
          const total = after + tax;
          const pay = pickPayment(rnd);
          const hpp = items.reduce((s, i) => s + i.cost * i.qty, 0);

          sales.push({
            id: 'SLS-' + String(invoiceSeq).padStart(5, '0'),
            invoice: 'INV/' + ts.getFullYear() + pad(ts.getMonth() + 1) + '/' + String(invoiceSeq).padStart(4, '0'),
            ts: ts.toISOString(),
            items, subtotal, discount, discountPct, tax, total, hpp,
            payment: pay.id, paymentLabel: pay.label, paymentFee: Math.round(total * pay.fee),
            cashier: CASHIERS[Math.floor(rnd() * CASHIERS.length)],
            channel: 'toko'
          });
          invoiceSeq++;
        }
      }

      // Restock gudang: setiap ±10 hari per produk prioritas
      if (rnd() < 0.16) {
        const p = products[Math.floor(rnd() * products.length)];
        const qty = 20 + Math.floor(rnd() * 60);
        stockMoves.push({
          id: 'SM-' + stockMoves.length,
          ts: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 7, 15).toISOString(),
          sku: p.sku, name: p.name, type: 'IN', qty,
          note: 'Penerimaan barang dari supplier',
          by: 'Gudang'
        });
        const purchaseCost = qty * p.cost;
        purchases.push({
          id: 'PO-' + String(purchases.length + 1).padStart(4, '0'),
          ts: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 7, 15).toISOString(),
          sku: p.sku, name: p.name, qty, unitCost: p.cost, total: purchaseCost
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    // Biaya operasional bulanan selama periode data
    const mc = new Date(start.getFullYear(), start.getMonth(), 1);
    while (mc <= now) {
      OPS_TEMPLATE.forEach((o) => {
        const jitter = 0.9 + rnd() * 0.22;
        expenses.push({
          id: 'EXP-' + expenses.length,
          ts: new Date(mc.getFullYear(), mc.getMonth(), 3, 10, 0).toISOString(),
          name: o.name,
          amount: Math.round((o.amount * jitter) / 1000) * 1000,
          category: 'Operasional'
        });
      });
      mc.setMonth(mc.getMonth() + 1);
    }

    return {
      version: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      products,
      sales,
      purchases,
      expenses,
      stockMoves,
      settings: {
        storeName: 'Toko Saprotan & Hasil Tani Sejahtera',
        taxPct: 11,
        aiProvider: 'local',
        aiEndpoint: 'https://api.openai.com/v1/chat/completions',
        aiModel: 'gpt-4o-mini',
        aiKey: ''
      },
      liveLog: [
        { ts: new Date().toISOString(), source: 'Sistem', message: 'ERP Agri terhubung dengan Kasir (AgriPOS) dan Gudang (AgriStock).' }
      ]
    };
  }

  /* ------------------------------------------------------------------ */
  /* Penyimpanan                                                         */
  /* ------------------------------------------------------------------ */
  let db = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.sales)) {
          db = parsed;
          syncExternalSources();
          return db;
        }
      }
    } catch (e) {
      console.warn('[AgriERP] Gagal membaca penyimpanan, membuat data baru.', e);
    }
    db = seed();
    save();
    syncExternalSources();
    return db;
  }

  /* Menarik aktivitas Kasir/Gudang yang tersimpan saat ERP tidak terbuka */
  function syncExternalSources() {
    // 1. Antrean transaksi kasir
    try {
      const KEY = 'agripos_pending_sales';
      const queue = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(queue) && queue.length) {
        queue.forEach((p) => recordExternalSale(p, true));
        localStorage.removeItem(KEY);
      }
    } catch (e) { /* ignore */ }

    // 2. Snapshot stok terakhir dari gudang
    try {
      const snap = JSON.parse(localStorage.getItem('agripos_catalog_snapshot') || 'null');
      if (snap && Array.isArray(snap.products)) {
        const d = get();
        if (!d.settings.lastCatalogSync || snap.ts > d.settings.lastCatalogSync) {
          snap.products.forEach((p) => {
            const local = d.products.find((x) => x.sku === p.sku);
            if (!local) return;
            if (typeof p.availableStock === 'number') local.warehouseStock = p.availableStock;
            if (typeof p.shelfStock === 'number') local.shelfCurrent = p.shelfStock;
            if (typeof p.price === 'number') local.price = p.price;
          });
          d.settings.lastCatalogSync = snap.ts;
          save();
        }
      }
    } catch (e) { /* ignore */ }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      console.warn('[AgriERP] Penyimpanan penuh / gagal menyimpan.', e);
    }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    db = seed();
    save();
    return db;
  }

  function get() { return db || load(); }

  function log(source, message) {
    const d = get();
    d.liveLog.unshift({ ts: new Date().toISOString(), source, message });
    d.liveLog = d.liveLog.slice(0, 120);
  }

  /* ------------------------------------------------------------------ */
  /* Filter periode                                                      */
  /* ------------------------------------------------------------------ */
  function periodRange(preset, granularity) {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let label = 'Hari ini';
    let gran = granularity || 'day';

    switch (preset) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        label = 'Hari ini'; gran = 'day';
        break;
      case 'yesterday': {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        label = 'Kemarin'; gran = 'day';
        break;
      }
      case '7d':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
        label = '7 hari terakhir'; gran = 'day';
        break;
      case '30d':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        label = '30 hari terakhir'; gran = 'day';
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        label = 'Bulan ini'; gran = 'day';
        break;
      case 'lastmonth': {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        start = d;
        label = 'Bulan lalu';
        gran = 'day';
        break;
      }
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        label = 'Tahun ini'; gran = 'month';
        break;
      case 'all': {
        const d = get();
        const first = d.sales.reduce((m, s) => (!m || s.ts < m ? s.ts : m), null);
        start = first ? new Date(first) : new Date(now.getFullYear(), 0, 1);
        label = 'Semua periode'; gran = 'month';
        break;
      }
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        label = 'Bulan ini';
    }
    return { start, end, label, gran, preset };
  }

  function previousRange(range) {
    const span = range.end.getTime() - range.start.getTime();
    return {
      start: new Date(range.start.getTime() - span - 1),
      end: new Date(range.start.getTime() - 1),
      gran: range.gran
    };
  }

  const inRange = (iso, r) => {
    const t = new Date(iso).getTime();
    return t >= r.start.getTime() && t <= r.end.getTime();
  };

  function salesIn(range) {
    return get().sales.filter((s) => inRange(s.ts, range));
  }

  function expensesIn(range) {
    return get().expenses.filter((e) => inRange(e.ts, range));
  }

  function purchasesIn(range) {
    return get().purchases.filter((p) => inRange(p.ts, range));
  }

  function stockMovesIn(range) {
    return get().stockMoves.filter((m) => inRange(m.ts, range));
  }

  /* ------------------------------------------------------------------ */
  /* Agregasi                                                            */
  /* ------------------------------------------------------------------ */
  function summarize(sales, expenses) {
    const revenue = sales.reduce((s, x) => s + x.total, 0);
    const gross = sales.reduce((s, x) => s + (x.subtotal - x.discount - x.hpp), 0);
    const hpp = sales.reduce((s, x) => s + x.hpp, 0);
    const discount = sales.reduce((s, x) => s + x.discount, 0);
    const tax = sales.reduce((s, x) => s + x.tax, 0);
    const fees = sales.reduce((s, x) => s + (x.paymentFee || 0), 0);
    const opex = (expenses || []).reduce((s, e) => s + e.amount, 0);
    const items = sales.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0);
    return {
      revenue, hpp, gross, discount, tax, fees, opex,
      net: gross - fees - opex,
      transactions: sales.length,
      items,
      avgTicket: sales.length ? revenue / sales.length : 0,
      margin: revenue ? ((gross - fees) / revenue) * 100 : 0,
      unitsPerTx: sales.length ? items / sales.length : 0
    };
  }

  function series(sales, range) {
    const buckets = new Map();
    const labelFmt = (d) =>
      range.gran === 'month'
        ? d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })
        : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });

    sales.forEach((s) => {
      const d = new Date(s.ts);
      const key =
        range.gran === 'month'
          ? monthKey(d)
          : range.gran === 'week'
          ? (() => {
              const tmp = new Date(d);
              const day = (tmp.getDay() + 6) % 7;
              tmp.setDate(tmp.getDate() - day);
              return dateKey(tmp);
            })()
          : dateKey(d);
      const cur = buckets.get(key) || { key, revenue: 0, gross: 0, tx: 0, hpp: 0 };
      cur.revenue += s.total;
      cur.gross += s.subtotal - s.discount - s.hpp;
      cur.hpp += s.hpp;
      cur.tx += 1;
      buckets.set(key, cur);
    });

    // Isi hari/bulan kosong agar grafik kontinu
    const out = [];
    const cursor = new Date(range.start);
    cursor.setHours(0, 0, 0, 0);
    const guard = 0;
    while (cursor <= range.end && out.length < 800) {
      const key =
        range.gran === 'month'
          ? monthKey(cursor)
          : range.gran === 'week'
          ? (() => {
              const tmp = new Date(cursor);
              tmp.setDate(tmp.getDate() - ((tmp.getDay() + 6) % 7));
              return dateKey(tmp);
            })()
          : dateKey(cursor);
      if (!out.find((x) => x.key === key)) {
        const v = buckets.get(key) || { key, revenue: 0, gross: 0, tx: 0, hpp: 0 };
        out.push({ ...v, label: labelFmt(cursor) });
      }
      if (range.gran === 'month') cursor.setMonth(cursor.getMonth() + 1);
      else if (range.gran === 'week') cursor.setDate(cursor.getDate() + 7);
      else cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  function topProducts(sales, limit = 8) {
    const map = new Map();
    sales.forEach((s) =>
      s.items.forEach((i) => {
        const cur = map.get(i.sku) || { sku: i.sku, name: i.name, category: i.category, qty: 0, revenue: 0, gross: 0 };
        cur.qty += i.qty;
        cur.revenue += i.price * i.qty;
        cur.gross += (i.price - i.cost) * i.qty;
        map.set(i.sku, cur);
      })
    );
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  }

  function categoryMix(sales) {
    const map = new Map();
    sales.forEach((s) =>
      s.items.forEach((i) => {
        const cur = map.get(i.category) || { category: i.category, revenue: 0, qty: 0 };
        cur.revenue += i.price * i.qty;
        cur.qty += i.qty;
        map.set(i.category, cur);
      })
    );
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }

  function paymentMix(sales) {
    const map = new Map();
    sales.forEach((s) => {
      const cur = map.get(s.payment) || { id: s.payment, label: s.paymentLabel, revenue: 0, tx: 0, fee: 0 };
      cur.revenue += s.total;
      cur.tx += 1;
      cur.fee += s.paymentFee || 0;
      map.set(s.payment, cur);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }

  function stockStatus() {
    const d = get();
    // Hitung penjualan 30 hari untuk velocity
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const recent = d.sales.filter((s) => new Date(s.ts) >= from);
    const sold = new Map();
    recent.forEach((s) => s.items.forEach((i) => sold.set(i.sku, (sold.get(i.sku) || 0) + i.qty)));

    return d.products.map((p) => {
      const qty30 = sold.get(p.sku) || 0;
      const velocity = qty30 / 30;
      const cover = velocity > 0 ? p.warehouseStock / velocity : null;
      const status =
        p.warehouseStock <= p.shelfMin * 2
          ? 'critical'
          : cover !== null && cover < 14
          ? 'warning'
          : cover !== null && cover > 120
          ? 'overstock'
          : 'healthy';
      return { ...p, qty30, velocity, cover, status, inventoryValue: p.warehouseStock * p.cost };
    });
  }

  function monthlyFinancials() {
    const d = get();
    const map = new Map();
    d.sales.forEach((s) => {
      const k = monthKey(new Date(s.ts));
      const cur = map.get(k) || { key: k, revenue: 0, hpp: 0, gross: 0, fees: 0, opex: 0, tx: 0 };
      cur.revenue += s.total;
      cur.hpp += s.hpp;
      cur.gross += s.subtotal - s.discount - s.hpp;
      cur.fees += s.paymentFee || 0;
      cur.tx += 1;
      map.set(k, cur);
    });
    d.expenses.forEach((e) => {
      const k = monthKey(new Date(e.ts));
      const cur = map.get(k) || { key: k, revenue: 0, hpp: 0, gross: 0, fees: 0, opex: 0, tx: 0 };
      cur.opex += e.amount;
      map.set(k, cur);
    });
    return [...map.values()]
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((m) => ({
        ...m,
        net: m.gross - m.fees - m.opex,
        label: new Date(m.key + '-01').toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
      }));
  }

  /* ------------------------------------------------------------------ */
  /* Integrasi real-time Kasir & Gudang                                  */
  /* ------------------------------------------------------------------ */
  function recordExternalSale(payload, silent) {
    const d = get();
    if (payload.clientId && d.sales.some((s) => s.clientId === payload.clientId)) return;
    const ts = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const items = (payload.items || []).map((i) => {
      const prod = d.products.find((p) => p.sku === i.sku) || {};
      return {
        sku: i.sku,
        name: i.name || prod.name || i.sku,
        category: i.category || prod.category || 'Lainnya',
        qty: Number(i.qty) || 0,
        price: Number(i.price) || prod.price || 0,
        cost: Number(i.cost) || prod.cost || 0
      };
    });
    if (!items.length) return;

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const total = Number(payload.total) || subtotal;
    const sale = {
      id: 'SLS-EXT-' + Date.now(),
      clientId: payload.clientId || null,
      invoice: payload.invoice || 'INV/POS/' + d.sales.length,
      ts: ts.toISOString(),
      items, subtotal, discount: 0, discountPct: 0,
      tax: Math.max(0, total - subtotal),
      total,
      hpp: items.reduce((s, i) => s + i.cost * i.qty, 0),
      payment: payload.payment || 'cash',
      paymentLabel: payload.paymentLabel || 'Tunai',
      paymentFee: 0,
      cashier: payload.cashier || 'Kasir',
      channel: 'pos'
    };
    d.sales.push(sale);

    items.forEach((i) => {
      const p = d.products.find((x) => x.sku === i.sku);
      if (p) {
        p.warehouseStock = Math.max(0, p.warehouseStock - i.qty);
        p.shelfCurrent = Math.max(0, p.shelfCurrent - i.qty);
      }
    });

    log('Kasir', `Transaksi ${sale.invoice} tercatat — ${items.length} item, ${rupiah(total)}`);
    save();
    dispatchUpdate('sale');
    return sale;
  }

  function recordStockAdjust(sku, qty, type, note) {
    const d = get();
    const p = d.products.find((x) => x.sku === sku);
    if (!p) return;
    d.stockMoves.push({
      id: 'SM-' + Date.now(),
      ts: new Date().toISOString(),
      sku, name: p.name, type, qty: Number(qty), note: note || '',
      by: 'Gudang'
    });
    if (type === 'IN') p.warehouseStock += Number(qty);
    if (type === 'OUT') p.warehouseStock = Math.max(0, p.warehouseStock - Number(qty));
    if (type === 'ADJ') p.warehouseStock = Number(qty);
    log('Gudang', `${type === 'IN' ? 'Barang masuk' : type === 'OUT' ? 'Barang keluar' : 'Penyesuaian stok'} ${p.name} (${qty})`);
    save();
    dispatchUpdate('stock');
  }

  function upsertProduct(product) {
    const d = get();
    const idx = d.products.findIndex((p) => p.sku === product.sku);
    if (idx >= 0) d.products[idx] = { ...d.products[idx], ...product };
    else d.products.push({ ...product, id: 'PRD-' + (1000 + d.products.length + 1) });
    log('Gudang', `Produk ${product.name} diperbarui dari modul gudang.`);
    save();
    dispatchUpdate('product');
  }

  function dispatchUpdate(kind) {
    window.dispatchEvent(new CustomEvent('erp:update', { detail: { kind } }));
  }

  let channel = null;
  function connectRealtime() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (ev) => {
        const data = ev.data || {};
        if (data.type === 'POS_SALE_COMPLETED') recordExternalSale(data);
        else if (data.type === 'CATALOG_UPDATED' && Array.isArray(data.products)) {
          const d = get();
          data.products.forEach((p) => {
            const local = d.products.find((x) => x.sku === p.sku);
            if (local) {
              if (typeof p.availableStock === 'number') local.warehouseStock = p.availableStock;
              if (typeof p.shelfStock === 'number') local.shelfCurrent = p.shelfStock;
              if (typeof p.price === 'number') local.price = p.price;
            } else {
              upsertProduct({
                sku: p.sku, name: p.name, price: p.price, cost: Math.round(p.price * 0.7),
                category: p.category || 'Lainnya', image: p.image,
                warehouseStock: p.availableStock || 0, shelfCurrent: p.shelfStock || 0,
                shelfMin: 3, shelfMax: 10, unit: 'unit'
              });
            }
          });
          log('Gudang', 'Sinkronisasi katalog diterima dari AgriStock WMS.');
          save();
          dispatchUpdate('catalog');
        }
      };
    } catch (e) {
      console.warn('[AgriERP] BroadcastChannel tidak tersedia.', e);
    }
  }

  function exportSnapshot() {
    const d = get();
    return {
      exportedAt: new Date().toISOString(),
      store: d.settings.storeName,
      products: d.products,
      sales: d.sales,
      purchases: d.purchases,
      expenses: d.expenses,
      stockMoves: d.stockMoves
    };
  }

  global.AgriERPData = {
    STORAGE_KEY,
    load, save, reset, get, log,
    periodRange, previousRange, inRange,
    salesIn, expensesIn, purchasesIn, stockMovesIn,
    summarize, series, topProducts, categoryMix, paymentMix,
    stockStatus, monthlyFinancials,
    recordExternalSale, recordStockAdjust, upsertProduct, connectRealtime,
    syncExternalSources,
    exportSnapshot,
    rupiah, rupiahShort, num, dateKey, monthKey,
    PAYMENTS, CASHIERS
  };
})(window);
