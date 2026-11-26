/**
 * AgriERP — Logika Antarmuka
 */
(function () {
  'use strict';

  const D = window.AgriERPData;
  const AI = window.AgriERPai;
  const EMP = window.AgriERPEmployees;

  const state = {
    view: 'dashboard',
    preset: '30d',
    granularity: 'auto',
    range: null,
    charts: {},
    ai: null,
    user: null,
    employees: [],
    editingEmployee: null
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };

  const PALETTE = ['#278b4d', '#38ab63', '#5fc684', '#96deaf', '#216e3f', '#1e5835', '#e6decb', '#5c4d3c'];
  const STATUS_MAP = {
    critical: { label: 'Kritis', cls: 'bg-rose-50 text-rose-700 border border-rose-200' },
    warning: { label: 'Menipis', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
    overstock: { label: 'Berlebih', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
    healthy: { label: 'Sehat', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' }
  };

  /* ------------------------------------------------------------------ */
  /* Format                                                              */
  /* ------------------------------------------------------------------ */
  const short = D.rupiahShort;
  const money = D.rupiah;
  const pctStr = (n) => (n === null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');
  const fmtDate = (iso, withTime) =>
    new Date(iso).toLocaleString('id-ID', withTime
      ? { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: 'short', year: 'numeric' });
  const esc = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------ */
  /* Navigasi                                                            */
  /* ------------------------------------------------------------------ */
  const VIEW_META = {
    dashboard: ['Dashboard', 'Ringkasan terpadu aktivitas kasir, gudang, dan keuangan'],
    penjualan: ['Penjualan & Kasir', 'Analisis transaksi, kategori, dan kinerja kasir'],
    stok: ['Stok & Gudang', 'Inventori, pergerakan barang, dan rekomendasi restock'],
    keuangan: ['Laporan Keuangan', 'Laba rugi, arus biaya, dan rekap bulanan'],
    ai: ['AI Business Insight', 'Insight otomatis dan rekomendasi strategi bisnis'],
    karyawan: ['Manajemen Karyawan', 'Kelola akun kasir & gudang beserta hak aksesnya'],
    pengaturan: ['Pengaturan & Integrasi', 'Konfigurasi toko, mesin AI, dan status modul']
  };

  function go(view) {
    if (view === 'karyawan' && state.user && state.user.role !== 'owner') view = 'dashboard';
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const target = $('view-' + view);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-link[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    const meta = VIEW_META[view] || VIEW_META.dashboard;
    $('page-title').textContent = meta[0];
    $('page-subtitle').textContent = meta[1];
    if (window.innerWidth < 1024) $('sidebar').classList.add('-translate-x-full');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render();
  }

  function bindNav() {
    document.body.addEventListener('click', (e) => {
      const link = e.target.closest('[data-view]');
      if (!link) return;
      e.preventDefault();
      go(link.dataset.view);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Builder chart                                                       */
  /* ------------------------------------------------------------------ */
  function chart(id, config) {
    const canvas = $(id);
    if (!canvas) return null;
    if (state.charts[id]) state.charts[id].destroy();
    const ctx = canvas.getContext('2d');
    state.charts[id] = new Chart(ctx, config);
    return state.charts[id];
  }

  const baseOpts = (currency = true) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { family: 'Plus Jakarta Sans', size: 11 } } },
      tooltip: {
        backgroundColor: '#0d2718',
        padding: 10,
        titleFont: { family: 'Plus Jakarta Sans', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        callbacks: {
          label: (c) => ' ' + c.dataset.label + ': ' + (currency && typeof c.parsed.y === 'number' ? short(c.parsed.y) : c.parsed.y)
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, maxRotation: 0, autoSkip: true } },
      y: {
        grid: { color: '#eef2f0' },
        ticks: {
          font: { family: 'JetBrains Mono', size: 10 },
          callback: (v) => (currency ? short(v) : v)
        }
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Compute range sesuai granularitas                                   */
  /* ------------------------------------------------------------------ */
  function computeRange() {
    const r = D.periodRange(state.preset, null);
    if (state.granularity !== 'auto') r.gran = state.granularity;
    return r;
  }

  function seriesForRange(range) {
    const sales = D.salesIn(range);
    if (range.gran !== 'year') return D.series(sales, range);

    // Agregasi tahunan dari data bulanan
    const monthly = D.series(sales, { ...range, gran: 'month' });
    const map = new Map();
    monthly.forEach((m) => {
      const year = m.key.slice(0, 4);
      const cur = map.get(year) || { key: year, label: year, revenue: 0, gross: 0, hpp: 0, tx: 0 };
      cur.revenue += m.revenue; cur.gross += m.gross; cur.hpp += m.hpp; cur.tx += m.tx;
      map.set(year, cur);
    });
    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /* ------------------------------------------------------------------ */
  /* Render utama                                                        */
  /* ------------------------------------------------------------------ */
  function render() {
    const db = D.get();
    const range = computeRange();
    state.range = range;

    const sales = D.salesIn(range);
    const expenses = D.expensesIn(range);
    const sum = D.summarize(sales, expenses);
    const prevRange = D.previousRange(range);
    const prev = D.summarize(D.salesIn(prevRange), []);
    const srs = seriesForRange(range);
    const stock = D.stockStatus();

    $('period-label').textContent = range.label;
    const granLabel = { day: 'Hari', month: 'Bulan', year: 'Tahun', week: 'Minggu' }[range.gran] || 'Hari';
    $('data-meta').textContent = `${db.sales.length.toLocaleString('id-ID')} transaksi · ${db.products.length} SKU · agregasi ${granLabel.toLowerCase()}`;
    $('sidebar-sync-time').textContent = 'Sinkron terakhir ' + new Date().toLocaleTimeString('id-ID');
    $('footer-clock').textContent = new Date().toLocaleString('id-ID');

    renderKPI(sum, prev, stock, srs);
    renderTrend(srs, range);
    renderPayment(sales);
    renderTopProducts(sales);
    renderCategory(sales);
    renderDashboardTables(sales, stock);
    renderSalesView(sales, srs, range, sum, stock);
    renderStockView(stock, sales, range);
    renderFinanceView(sum, expenses, range);
    renderSettings(db);
    renderEmployees();

    $('ai-teaser').textContent = `Periode ${range.label}: omzet ${money(sum.revenue)} dari ${sum.transactions} transaksi. ` +
      `${stock.filter((s) => s.status === 'critical' || s.status === 'warning').length} produk butuh perhatian stok.`;
    $('ai-period-badge').textContent = range.label;

    if (window.lucide) window.lucide.createIcons();
  }

  /* ---------------- KPI ---------------- */
  function renderKPI(sum, prev, stock, srs) {
    const growth = prev.revenue ? ((sum.revenue - prev.revenue) / prev.revenue) * 100 : null;
    $('kpi-revenue').textContent = short(sum.revenue);
    const delta = $('kpi-revenue-delta');
    delta.textContent = pctStr(growth);
    delta.className = 'badge ' + (growth === null ? 'bg-slate-100 text-slate-600' : growth >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700');

    $('kpi-tx').textContent = D.num(sum.transactions);
    $('kpi-tx-sub').textContent = `Rata-rata ${short(sum.avgTicket)} · ${sum.items.toLocaleString('id-ID')} unit terjual`;

    $('kpi-net').textContent = short(sum.net);
    $('kpi-net-sub').textContent = `Margin ${sum.margin.toFixed(1)}% · laba kotor ${short(sum.gross)}`;

    const invValue = stock.reduce((s, p) => s + p.inventoryValue, 0);
    $('kpi-inventory').textContent = short(invValue);
    $('kpi-inventory-sub').textContent = `${stock.length} SKU aktif · ${stock.filter((s) => s.status === 'critical').length} kritis`;

    spark('spark-revenue', srs.map((x) => x.revenue), '#278b4d');
    spark('spark-tx', srs.map((x) => x.tx), '#2563eb');
    spark('spark-net', srs.map((x) => x.gross), '#059669');
    spark('spark-stock', srs.map((x) => x.hpp), '#d97706');
  }

  function spark(id, data, color) {
    chart(id, {
      type: 'line',
      data: {
        labels: data.map((_, i) => i + 1),
        datasets: [{
          data, borderColor: color, borderWidth: 2, pointRadius: 0,
          fill: true,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 40);
            g.addColorStop(0, color + '33'); g.addColorStop(1, color + '00');
            return g;
          },
          tension: 0.4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { borderJoinStyle: 'round' } },
        animation: { duration: 400 }
      }
    });
  }

  /* ---------------- Charts dashboard ---------------- */
  function renderTrend(srs, range) {
    const granLabel = { day: 'hari', month: 'bulan', year: 'tahun', week: 'minggu' }[range.gran] || 'hari';
    $('trend-badge').textContent = 'Tren per ' + granLabel;
    chart('chart-trend', {
      type: 'bar',
      data: {
        labels: srs.map((x) => x.label),
        datasets: [
          {
            type: 'line', label: 'Laba Kotor', data: srs.map((x) => x.gross),
            borderColor: '#38ab63', backgroundColor: '#38ab63', borderWidth: 2.5,
            pointRadius: 0, tension: 0.35, fill: false, yAxisID: 'y1'
          },
          { type: 'bar', label: 'Omzet', data: srs.map((x) => x.revenue), backgroundColor: '#c4edd2', hoverBackgroundColor: '#96deaf', borderRadius: 4, barPercentage: 0.7 }
        ]
      },
      options: {
        ...baseOpts(),
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { grid: { color: '#eef2f0' }, ticks: { callback: (v) => short(v), font: { family: 'JetBrains Mono', size: 10 } } },
          y1: { position: 'right', grid: { display: false }, ticks: { callback: (v) => short(v), font: { family: 'JetBrains Mono', size: 10 } } }
        }
      }
    });
  }

  function renderPayment(sales) {
    const pays = D.paymentMix(sales);
    chart('chart-payment', {
      type: 'doughnut',
      data: {
        labels: pays.map((p) => p.label),
        datasets: [{
          data: pays.map((p) => p.revenue),
          backgroundColor: PALETTE,
          borderWidth: 2, borderColor: '#fff', hoverOffset: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d2718',
            callbacks: { label: (c) => ' ' + c.label + ': ' + short(c.parsed) }
          }
        }
      }
    });
    const total = pays.reduce((s, p) => s + p.revenue, 0) || 1;
    $('payment-legend').innerHTML = pays.map((p, i) => `
      <div class="flex items-center justify-between text-[11.5px]">
        <span class="flex items-center gap-2 text-slate-600">
          <span class="w-2.5 h-2.5 rounded-full" style="background:${PALETTE[i % PALETTE.length]}"></span>${p.label}
        </span>
        <span class="font-mono text-slate-700 font-semibold">${((p.revenue / total) * 100).toFixed(0)}% · ${short(p.revenue)}</span>
      </div>`).join('');
  }

  function renderTopProducts(sales) {
    const tops = D.topProducts(sales, 7);
    chart('chart-top-products', {
      type: 'bar',
      data: {
        labels: tops.map((t) => t.name.length > 26 ? t.name.slice(0, 26) + '…' : t.name),
        datasets: [{
          label: 'Omzet', data: tops.map((t) => t.revenue),
          backgroundColor: '#278b4d', borderRadius: 5, barPercentage: 0.72
        }]
      },
      options: {
        ...baseOpts(), indexAxis: 'y',
        plugins: { ...baseOpts().plugins, legend: { display: false } },
        scales: {
          x: { grid: { color: '#eef2f0' }, ticks: { callback: (v) => short(v), font: { family: 'JetBrains Mono', size: 10 } } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  function renderCategory(sales) {
    const cats = D.categoryMix(sales);
    chart('chart-category', {
      type: 'polarArea',
      data: {
        labels: cats.map((c) => c.category),
        datasets: [{ data: cats.map((c) => c.revenue), backgroundColor: PALETTE.map((c) => c + 'd9'), borderColor: '#fff', borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 9, boxHeight: 9, font: { size: 10 } } },
          tooltip: { backgroundColor: '#0d2718', callbacks: { label: (c) => ' ' + c.label + ': ' + short(c.parsed.r) } }
        },
        scales: { r: { ticks: { display: false }, grid: { color: '#eef2f0' } } }
      }
    });
  }

  function renderDashboardTables(sales, stock) {
    const critical = stock.filter((p) => p.status === 'critical' || p.status === 'warning').sort((a, b) => (a.cover || 999) - (b.cover || 999)).slice(0, 6);
    $('table-dashboard-stock').innerHTML = critical.length
      ? critical.map((p) => {
          const st = STATUS_MAP[p.status];
          return `<tr>
            <td><div class="font-semibold text-slate-700">${p.name}</div><div class="text-[10.5px] text-slate-400 font-mono">${p.sku}</div></td>
            <td class="font-mono">${D.num(p.warehouseStock)} <span class="text-slate-400 text-[10px]">${p.unit}</span></td>
            <td class="font-mono">${p.cover ? Math.round(p.cover) + ' hari' : '—'}</td>
            <td><span class="badge ${st.cls}">${st.label}</span></td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="4" class="text-center text-slate-400 py-6">Semua stok dalam kondisi sehat ✓</td></tr>`;

    const recent = [...sales].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 6);
    $('table-recent-sales').innerHTML = recent.map((s) => `
      <tr>
        <td class="font-mono text-[11px] text-agri-800 font-semibold">${s.invoice}</td>
        <td class="text-[11px] text-slate-500">${fmtDate(s.ts, true)}</td>
        <td><span class="badge bg-slate-100 text-slate-600">${s.paymentLabel}</span></td>
        <td class="text-right font-mono font-semibold">${money(s.total)}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="text-center text-slate-400 py-6">Belum ada transaksi pada periode ini</td></tr>`;
  }

  /* ---------------- Penjualan ---------------- */
  function renderSalesView(sales, srs, range, sum, stock) {
    $('sales-revenue').textContent = short(sum.revenue);
    $('sales-revenue-sub').textContent = `${range.label} · ${sum.transactions} transaksi`;
    $('sales-units').textContent = D.num(sum.items);
    $('sales-units-sub').textContent = `${sum.unitsPerTx.toFixed(1)} unit per transaksi`;
    $('sales-avg').textContent = short(sum.avgTicket);
    $('sales-avg-sub').textContent = `Median item ${sum.items ? Math.round(sum.items / Math.max(1, sum.transactions)) : 0} per transaksi`;
    $('sales-discount').textContent = short(sum.discount);
    $('sales-discount-sub').textContent = `${sum.revenue ? ((sum.discount / (sum.revenue + sum.discount)) * 100).toFixed(1) : 0}% dari penjualan bruto`;

    const granLabel = { day: 'Hari', month: 'Bulan', year: 'Tahun', week: 'Minggu' }[range.gran] || 'Hari';
    $('sales-gran-label').textContent = granLabel;

    const best = srs.slice().sort((a, b) => b.revenue - a.revenue)[0];
    $('sales-peak').textContent = best ? `Terbaik: ${best.label} — ${short(best.revenue)}` : 'Belum ada data';

    chart('chart-sales', {
      type: 'line',
      data: {
        labels: srs.map((x) => x.label),
        datasets: [
          {
            label: 'Omzet', data: srs.map((x) => x.revenue), borderColor: '#278b4d',
            backgroundColor: (ctx) => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280);
              g.addColorStop(0, '#38ab6333'); g.addColorStop(1, '#38ab6300');
              return g;
            },
            borderWidth: 2.5, fill: true, tension: 0.35, pointRadius: srs.length > 40 ? 0 : 2.5, pointBackgroundColor: '#278b4d'
          },
          { label: 'Jumlah Transaksi', data: srs.map((x) => x.tx), borderColor: '#94a3b8', borderDash: [4, 4], borderWidth: 1.8, pointRadius: 0, yAxisID: 'y1', tension: 0.3 }
        ]
      },
      options: {
        ...baseOpts(),
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, font: { size: 10 } } },
          y: { grid: { color: '#eef2f0' }, ticks: { callback: (v) => short(v), font: { family: 'JetBrains Mono', size: 10 } } },
          y1: { position: 'right', grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => v } }
        }
      }
    });

    const cats = D.categoryMix(sales);
    const catTotal = cats.reduce((s, c) => s + c.revenue, 0) || 1;
    $('table-categories').innerHTML = cats.map((c) => `
      <tr>
        <td class="font-semibold text-slate-700">${c.category}</td>
        <td class="font-mono">${D.num(c.qty)}</td>
        <td class="text-right font-mono">${money(c.revenue)}</td>
        <td class="text-right">
          <div class="flex items-center justify-end gap-2">
            <div class="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-agri-500" style="width:${(c.revenue / catTotal) * 100}%"></div></div>
            <span class="font-mono text-[11px]">${((c.revenue / catTotal) * 100).toFixed(0)}%</span>
          </div>
        </td>
      </tr>`).join('') || `<tr><td colspan="4" class="text-center text-slate-400 py-6">Tidak ada data</td></tr>`;

    const byCashier = new Map();
    sales.forEach((s) => {
      const cur = byCashier.get(s.cashier) || { name: s.cashier, tx: 0, revenue: 0 };
      cur.tx++; cur.revenue += s.total;
      byCashier.set(s.cashier, cur);
    });
    $('table-cashiers').innerHTML = [...byCashier.values()].sort((a, b) => b.revenue - a.revenue).map((c) => `
      <tr>
        <td class="font-semibold text-slate-700">${c.name}</td>
        <td class="font-mono">${D.num(c.tx)}</td>
        <td class="text-right font-mono">${money(c.revenue)}</td>
        <td class="text-right font-mono text-slate-500">${money(c.revenue / c.tx)}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="text-center text-slate-400 py-6">Tidak ada data</td></tr>`;

    renderSalesTable();
  }

  function renderSalesTable() {
    const q = ($('sales-search')?.value || '').toLowerCase().trim();
    const range = state.range;
    let rows = D.salesIn(range);
    if (q) rows = rows.filter((s) => s.invoice.toLowerCase().includes(q) || s.cashier.toLowerCase().includes(q) || s.paymentLabel.toLowerCase().includes(q));
    rows = rows.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 250);
    $('table-sales').innerHTML = rows.map((s) => `
      <tr>
        <td class="font-mono text-[11px] text-agri-800 font-semibold">${s.invoice}</td>
        <td class="text-[11px] text-slate-500 whitespace-nowrap">${fmtDate(s.ts, true)}</td>
        <td>${s.cashier}</td>
        <td class="font-mono">${s.items.reduce((a, i) => a + i.qty, 0)}</td>
        <td><span class="badge bg-slate-100 text-slate-600">${s.paymentLabel}</span></td>
        <td class="text-right font-mono font-semibold">${money(s.total)}</td>
      </tr>`).join('') || `<tr><td colspan="6" class="text-center text-slate-400 py-8">Tidak ada transaksi yang cocok</td></tr>`;
  }

  /* ---------------- Stok ---------------- */
  function renderStockView(stock, sales, range) {
    const invValue = stock.reduce((s, p) => s + p.inventoryValue, 0);
    const critical = stock.filter((p) => p.status === 'critical' || p.status === 'warning');
    const days = Math.max(1, Math.round((range.end - range.start) / 86400000));
    const cogs = sales.reduce((s, x) => s + x.hpp, 0);
    const turns = invValue ? (cogs * (365 / days)) / invValue : 0;

    $('stock-sku').textContent = stock.length;
    $('stock-value').textContent = short(invValue);
    $('stock-critical').textContent = critical.length;
    $('stock-turns').textContent = turns.toFixed(1) + 'x';

    // Pergerakan stok per bucket
    const moves = D.stockMovesIn(range);
    const buckets = new Map();
    const keyOf = (d) => range.gran === 'month' ? D.monthKey(d) : D.dateKey(d);
    const addBucket = (key, label) => {
      if (!buckets.has(key)) buckets.set(key, { key, label, masuk: 0, keluar: 0, adj: 0 });
      return buckets.get(key);
    };

    moves.forEach((m) => {
      const d = new Date(m.ts);
      const b = addBucket(keyOf(d), range.gran === 'month' ? d.toLocaleDateString('id-ID', { month: 'short' }) : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));
      if (m.type === 'IN') b.masuk += m.qty;
      else if (m.type === 'OUT') b.keluar += m.qty;
      else b.adj += m.qty;
    });
    sales.forEach((s) => {
      const d = new Date(s.ts);
      const b = addBucket(keyOf(d), range.gran === 'month' ? d.toLocaleDateString('id-ID', { month: 'short' }) : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));
      b.keluar += s.items.reduce((a, i) => a + i.qty, 0);
    });

    const flow = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-24);

    chart('chart-stock-flow', {
      type: 'bar',
      data: {
        labels: flow.map((f) => f.label),
        datasets: [
          { label: 'Barang Masuk', data: flow.map((f) => f.masuk), backgroundColor: '#96deaf', borderRadius: 4, barPercentage: 0.7 },
          { label: 'Terjual / Keluar', data: flow.map((f) => f.keluar), backgroundColor: '#278b4d', borderRadius: 4, barPercentage: 0.7 }
        ]
      },
      options: baseOpts(false)
    });

    const groups = { critical: 0, warning: 0, overstock: 0, healthy: 0 };
    stock.forEach((p) => groups[p.status]++);
    const statusItems = [
      { key: 'critical', label: 'Kritis — restock segera', color: 'bg-rose-500' },
      { key: 'warning', label: 'Menipis — pantau ketat', color: 'bg-amber-500' },
      { key: 'overstock', label: 'Berlebih — modal tertahan', color: 'bg-blue-500' },
      { key: 'healthy', label: 'Sehat — stok ideal', color: 'bg-emerald-500' }
    ];
    $('stock-status-list').innerHTML = statusItems.map((s) => `
      <div class="flex items-center justify-between text-[11.5px]">
        <span class="flex items-center gap-2 text-slate-600"><span class="w-2.5 h-2.5 rounded-full ${s.color}"></span>${s.label}</span>
        <span class="font-mono font-bold text-slate-700">${groups[s.key]} SKU</span>
      </div>
      <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1"><div class="h-full ${s.color}" style="width:${(groups[s.key] / stock.length) * 100}%"></div></div>
    `).join('');

    renderInventory();
    renderStockMoves(moves, range);
    renderPurchases(range);
  }

  function renderInventory() {
    const q = ($('stock-search')?.value || '').toLowerCase().trim();
    let rows = D.stockStatus();
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    rows.sort((a, b) => {
      const order = { critical: 0, warning: 1, overstock: 2, healthy: 3 };
      return order[a.status] - order[b.status] || a.name.localeCompare(b.name);
    });

    $('table-inventory').innerHTML = rows.map((p) => {
      const st = STATUS_MAP[p.status];
      const suggest = p.status === 'critical' || p.status === 'warning'
        ? Math.max(10, Math.ceil((p.velocity || 1) * 21) - p.warehouseStock)
        : 0;
      return `<tr>
        <td class="font-mono text-[10.5px] text-slate-500">${p.sku}</td>
        <td class="font-semibold text-slate-700 max-w-[220px] truncate" title="${p.name}">${p.name}</td>
        <td><span class="badge bg-agri-50 text-agri-700 border border-agri-100">${p.category}</span></td>
        <td class="text-right font-mono">${D.num(p.warehouseStock)}</td>
        <td class="text-right font-mono ${p.shelfCurrent <= p.shelfMin ? 'text-rose-600 font-bold' : ''}">${D.num(p.shelfCurrent)}</td>
        <td class="text-right font-mono">${D.num(p.qty30)}</td>
        <td class="text-right font-mono">${p.cover ? Math.round(p.cover) + 'h' : '—'}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td class="text-right font-mono ${suggest ? 'text-agri-700 font-bold' : 'text-slate-400'}">${suggest ? '+' + D.num(suggest) : '—'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="text-center text-slate-400 py-8">Tidak ada produk cocok</td></tr>`;
  }

  function renderStockMoves(moves, range) {
    const rows = moves.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 80);
    const typeBadge = {
      IN: 'bg-emerald-50 text-emerald-700', OUT: 'bg-rose-50 text-rose-700', ADJ: 'bg-blue-50 text-blue-700'
    };
    $('table-stock-moves').innerHTML = rows.map((m) => `
      <tr>
        <td class="text-[11px] text-slate-500 whitespace-nowrap">${fmtDate(m.ts, true)}</td>
        <td><span class="badge ${typeBadge[m.type] || 'bg-slate-100 text-slate-600'}">${m.type === 'IN' ? 'Masuk' : m.type === 'OUT' ? 'Keluar' : 'Adjust'}</span></td>
        <td class="max-w-[200px] truncate" title="${m.name}">${m.name}</td>
        <td class="text-right font-mono ${m.type === 'IN' ? 'text-emerald-700' : m.type === 'OUT' ? 'text-rose-600' : 'text-blue-600'}">${m.type === 'IN' ? '+' : m.type === 'OUT' ? '−' : ''}${D.num(m.qty)}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="text-center text-slate-400 py-6">Belum ada pergerakan stok</td></tr>`;
  }

  function renderPurchases(range) {
    const rows = D.purchasesIn(range).slice().sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 60);
    $('table-purchases').innerHTML = rows.map((p) => `
      <tr>
        <td class="text-[11px] text-slate-500 whitespace-nowrap">${fmtDate(p.ts)}</td>
        <td class="max-w-[220px] truncate" title="${p.name}">${p.name}</td>
        <td class="text-right font-mono">${D.num(p.qty)}</td>
        <td class="text-right font-mono font-semibold">${money(p.total)}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="text-center text-slate-400 py-6">Tidak ada pembelian pada periode ini</td></tr>`;
  }

  /* ---------------- Keuangan ---------------- */
  function renderFinanceView(sum, expenses, range) {
    $('fin-revenue').textContent = short(sum.revenue);
    $('fin-revenue-sub').textContent = range.label;
    $('fin-hpp').textContent = short(sum.hpp);
    $('fin-hpp-sub').textContent = `${sum.revenue ? ((sum.hpp / sum.revenue) * 100).toFixed(1) : 0}% dari pendapatan`;
    $('fin-opex').textContent = short(sum.opex);
    $('fin-opex-sub').textContent = `${expenses.length} pos biaya`;
    $('fin-net').textContent = short(sum.net);
    $('fin-net-sub').textContent = `Margin bersih ${sum.revenue ? ((sum.net / sum.revenue) * 100).toFixed(1) : 0}%`;

    const months = D.monthlyFinancials().slice(-12);
    chart('chart-finance', {
      type: 'bar',
      data: {
        labels: months.map((m) => m.label),
        datasets: [
          { label: 'Pendapatan', data: months.map((m) => m.revenue), backgroundColor: '#c4edd2', borderRadius: 4, barPercentage: 0.75 },
          { label: 'Laba Kotor', data: months.map((m) => m.gross), backgroundColor: '#5fc684', borderRadius: 4, barPercentage: 0.75 },
          { type: 'line', label: 'Laba Bersih', data: months.map((m) => m.net), borderColor: '#1a482d', backgroundColor: '#1a482d', borderWidth: 2.5, tension: 0.35, pointRadius: 3, fill: false }
        ]
      },
      options: baseOpts()
    });

    const byName = new Map();
    expenses.forEach((e) => byName.set(e.name, (byName.get(e.name) || 0) + e.amount));
    const totalOpex = [...byName.values()].reduce((a, b) => a + b, 0) || 1;
    $('opex-breakdown').innerHTML = [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => `
      <div>
        <div class="flex items-center justify-between text-[11.5px] mb-0.5">
          <span class="text-slate-600">${name}</span>
          <span class="font-mono font-semibold text-slate-700">${short(amount)}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-agri-500" style="width:${(amount / totalOpex) * 100}%"></div></div>
      </div>`).join('') || '<p class="text-[11.5px] text-slate-400">Tidak ada biaya pada periode ini.</p>';
    $('opex-total').textContent = money(totalOpex);

    const all = D.monthlyFinancials().slice().reverse();
    $('table-finance').innerHTML = all.map((m) => {
      const margin = m.revenue ? (m.net / m.revenue) * 100 : 0;
      return `<tr>
        <td class="font-semibold text-slate-700 whitespace-nowrap">${m.label}</td>
        <td class="text-right font-mono">${money(m.revenue)}</td>
        <td class="text-right font-mono text-slate-500">${money(m.hpp)}</td>
        <td class="text-right font-mono">${money(m.gross)}</td>
        <td class="text-right font-mono text-slate-500">${money(m.fees)}</td>
        <td class="text-right font-mono text-slate-500">${money(m.opex)}</td>
        <td class="text-right font-mono font-bold ${m.net >= 0 ? 'text-agri-700' : 'text-rose-600'}">${money(m.net)}</td>
        <td class="text-right"><span class="badge ${margin >= 10 ? 'bg-emerald-50 text-emerald-700' : margin >= 0 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}">${margin.toFixed(1)}%</span></td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" class="text-center text-slate-400 py-8">Belum ada data keuangan</td></tr>`;
  }

  /* ---------------- Pengaturan ---------------- */
  function renderSettings(db) {
    $('set-store').value = db.settings.storeName || '';
    $('set-ai-provider').value = db.settings.aiProvider || 'local';
    $('set-ai-endpoint').value = db.settings.aiEndpoint || '';
    $('set-ai-model').value = db.settings.aiModel || '';
    $('set-ai-key').value = db.settings.aiKey || '';
    $('set-data-info').textContent = `${db.sales.length.toLocaleString('id-ID')} transaksi · ${db.products.length} produk · dibuat ${fmtDate(db.createdAt)}`;
    const provider = db.settings.aiProvider || 'local';
    $('ai-mode-badge').innerHTML = provider === 'local'
      ? '<i data-lucide="cpu" class="w-3 h-3"></i> Analitik Lokal (offline)'
      : `<i data-lucide="bot" class="w-3 h-3"></i> ${provider === 'ollama' ? 'Ollama lokal' : 'Cloud AI'} · ${db.settings.aiModel || '—'}`;
    $('ai-cloud-fields').style.opacity = provider === 'local' ? '0.55' : '1';
    $('ai-cloud-fields').style.pointerEvents = provider === 'local' ? 'none' : 'auto';

    $('event-log').innerHTML = (db.liveLog || []).slice(0, 40).map((l) => `
      <div class="flex items-start gap-2 text-[11px] border-b border-slate-100 pb-1.5">
        <span class="badge ${l.source === 'Kasir' ? 'bg-blue-50 text-blue-700' : l.source === 'Gudang' ? 'bg-amber-50 text-amber-700' : 'bg-agri-50 text-agri-700'} flex-shrink-0">${l.source}</span>
        <span class="text-slate-600 flex-1">${l.message}</span>
        <span class="text-slate-400 font-mono text-[10px] flex-shrink-0">${new Date(l.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>`).join('') || '<p class="text-[11.5px] text-slate-400">Belum ada aktivitas.</p>';
  }

  function saveSettings() {
    const db = D.get();
    db.settings.storeName = $('set-store').value.trim() || 'Toko Saprotan & Hasil Tani Sejahtera';
    db.settings.aiProvider = $('set-ai-provider').value;
    db.settings.aiEndpoint = $('set-ai-endpoint').value.trim();
    db.settings.aiModel = $('set-ai-model').value.trim();
    db.settings.aiKey = $('set-ai-key').value.trim();
    D.save();
    const note = $('settings-saved');
    note.classList.remove('hidden');
    setTimeout(() => note.classList.add('hidden'), 2200);
    render();
    if (window.lucide) window.lucide.createIcons();
  }

  function resetData() {
    if (!confirm('Reset seluruh data ERP? Data demo akan dibuat ulang dan transaksi tersimpan akan dihapus.')) return;
    D.reset();
    state.ai = null;
    render();
    if (window.lucide) window.lucide.createIcons();
  }

  /* ---------------- AI ---------------- */
  async function runAI(question) {
    const btn = $('btn-run-ai');
    const original = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Menganalisis…';
    btn.disabled = true;
    if (window.lucide) window.lucide.createIcons();

    $('ai-error').classList.add('hidden');
    $('ai-insight-grid').innerHTML = '<div class="card p-4 skeleton h-32"></div><div class="card p-4 skeleton h-32"></div><div class="card p-4 skeleton h-32"></div><div class="card p-4 skeleton h-32"></div>';

    try {
      const result = await AI.analyze(state.range, question);
      state.ai = result;
      renderAI(result);
      if (result.answerHtml) {
        $('ai-answer-wrap').classList.remove('hidden');
        $('ai-answer').innerHTML = result.answerHtml;
        $('ai-answer-meta').textContent = '· ' + (result.mode === 'ollama' ? 'Ollama' : 'Cloud AI') + ' · ' + new Date().toLocaleTimeString('id-ID');
      }
      if (result.error) {
        const box = $('ai-error');
        box.classList.remove('hidden');
        box.innerHTML = `<b>AI cloud gagal:</b> ${result.error}<br>Hasil di bawah dihasilkan oleh mesin analitik lokal.`;
      }
      if (result.mode !== 'local') {
        $('ai-mode-badge').innerHTML = `<i data-lucide="bot" class="w-3 h-3"></i> ${result.mode === 'ollama' ? 'Ollama lokal' : 'Cloud AI'} aktif`;
      }
    } catch (err) {
      $('ai-error').classList.remove('hidden');
      $('ai-error').textContent = 'Gagal menjalankan analisis: ' + err.message;
    } finally {
      btn.innerHTML = original;
      btn.disabled = false;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  const TONE = {
    good: 'border-l-emerald-500 bg-emerald-50/50',
    bad: 'border-l-rose-500 bg-rose-50/40',
    warn: 'border-l-amber-500 bg-amber-50/40',
    info: 'border-l-agri-500 bg-white'
  };
  const TONE_ICON = { good: 'text-emerald-600', bad: 'text-rose-600', warn: 'text-amber-600', info: 'text-agri-700' };

  function renderAI(result) {
    const grid = $('ai-insight-grid');
    grid.innerHTML = result.insights.map((i) => `
      <div class="card p-4 border-l-4 ${TONE[i.tone] || TONE.info}">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 ${TONE_ICON[i.tone] || TONE_ICON.info}">
            <i data-lucide="${i.icon}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0">
            <h4 class="font-bold text-[13px] text-agri-950">${i.title}</h4>
            <p class="text-[11.5px] text-slate-600 mt-1 leading-relaxed">${i.text}</p>
            <p class="text-[11px] text-agri-800 bg-agri-50 border border-agri-100 rounded-lg px-2.5 py-1.5 mt-2"><b>Aksi:</b> ${i.action}</p>
          </div>
        </div>
      </div>`).join('');

    $('ai-plan-grid').innerHTML = result.plans.map((p) => `
      <div class="rounded-xl border border-slate-200 p-3.5 bg-gradient-to-br from-white to-agri-50/40">
        <div class="flex items-center justify-between mb-2">
          <span class="badge bg-agri-700 text-white">${p.horizon}</span>
          <i data-lucide="flag" class="w-3.5 h-3.5 text-agri-600"></i>
        </div>
        <h4 class="font-bold text-[12.5px] text-agri-950 leading-snug">${p.title}</h4>
        <ul class="mt-2 space-y-1">
          ${p.steps.map((s) => `<li class="text-[11.5px] text-slate-600 flex gap-1.5"><span class="text-agri-500 mt-0.5">•</span><span>${s}</span></li>`).join('')}
        </ul>
        <p class="text-[10.5px] text-agri-800 mt-2 bg-white border border-agri-100 rounded-lg px-2 py-1.5"><b>Dampak:</b> ${p.impact}</p>
      </div>`).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  function askAI() {
    const q = $('ai-question').value.trim();
    if (!q) { $('ai-question').focus(); return; }
    runAI(q);
    $('ai-answer-wrap').classList.remove('hidden');
    $('ai-answer').innerHTML = '<span class="text-slate-500">Menyusun jawaban…</span>';
    $('ai-answer-meta').textContent = '· memproses';
  }

  /* ---------------- Akun & karyawan (backend) ---------------- */
  function employeeMsg(id, message) {
    const box = $(id);
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  async function loadSession() {
    if (!EMP) return;
    try {
      const res = await EMP.me();
      state.user = res.user;
      $('user-name').textContent = res.user.name || '—';
      $('user-role').textContent = res.user.role_label || res.user.role;
      $('user-avatar').textContent = (res.user.name || '?').trim().charAt(0).toUpperCase();
      const nav = $('nav-karyawan');
      if (nav) nav.classList.toggle('hidden', res.user.role !== 'owner');
      $('logoutBtn').onclick = async () => {
        try { await EMP.logout(); } catch (e) { /* tetap keluar secara lokal */ }
        location.replace('/login/');
      };
    } catch (e) {
      location.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search));
    }
  }

  function resetEmployeeForm() {
    state.editingEmployee = null;
    const form = $('employeeForm');
    if (!form) return;
    form.reset();
    $('empPassword').required = true;
    $('empPasswordHint').textContent = '(min. 8 karakter)';
    $('empSubmit').textContent = 'Simpan Karyawan';
    employeeMsg('employeeError', '');
    employeeMsg('employeeOk', '');
  }

  async function renderEmployees() {
    if (state.view !== 'karyawan' || !EMP) return;
    const tbody = $('employeeTable');
    if (!tbody) return;
    try {
      const res = await EMP.list();
      state.employees = res.employees || [];
      tbody.innerHTML = state.employees.length ? state.employees.map((u) => `
        <tr>
          <td class="px-3 py-2 font-semibold text-slate-700">${esc(u.name)}</td>
          <td class="px-3 py-2 text-slate-600">${esc(u.email)}</td>
          <td class="px-3 py-2"><span class="badge ${u.role === 'cashier' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">${esc(u.role_label || u.role)}</span></td>
          <td class="px-3 py-2"><span class="badge ${u.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${u.active ? 'Aktif' : 'Nonaktif'}</span></td>
          <td class="px-3 py-2 text-slate-500">${esc(fmtDate(u.created_at))}</td>
          <td class="px-3 py-2">
            <div class="flex items-center gap-1">
              <button data-emp-edit="${esc(u.id)}" class="p-1.5 rounded-lg hover:bg-slate-100" title="Edit"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
              <button data-emp-toggle="${esc(u.id)}" class="p-1.5 rounded-lg hover:bg-slate-100" title="${u.active ? 'Nonaktifkan' : 'Aktifkan'}"><i data-lucide="${u.active ? 'user-x' : 'user-check'}" class="w-3.5 h-3.5"></i></button>
              <button data-emp-delete="${esc(u.id)}" class="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600" title="Hapus"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </div>
          </td>
        </tr>`).join('') : '<tr><td colspan="6" class="text-center text-slate-400 py-6">Belum ada karyawan.</td></tr>';
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-rose-500 py-6">${esc(err.message)}</td></tr>`;
    }
    await renderEmployeeActivity();
    if (window.lucide) window.lucide.createIcons();
  }

  async function renderEmployeeActivity() {
    const box = $('employeeActivity');
    if (!box || !EMP) return;
    try {
      const res = await EMP.activity();
      const rows = res.activity || [];
      box.innerHTML = rows.length ? rows.slice(0, 12).map((a) => `
        <div class="flex items-start gap-2 border-b border-slate-100 pb-1.5">
          <span class="font-mono text-[10px] text-slate-400 w-28 flex-shrink-0">${esc(fmtDate(a.created_at, true))}</span>
          <span class="font-bold text-slate-600">${esc(a.actor_name || 'Sistem')}</span>
          <span class="text-slate-500">${esc(String(a.action || '').replace(/_/g, ' ').toLowerCase())} — ${esc(a.detail || '-')}</span>
        </div>`).join('') : '<p>Belum ada aktivitas akun.</p>';
    } catch (e) {
      box.textContent = e.message;
    }
  }

  function bindEmployeeControls() {
    if (!EMP || !$('employeeForm')) return;
    $('employeeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      employeeMsg('employeeError', '');
      employeeMsg('employeeOk', '');
      const payload = {
        name: $('empName').value.trim(),
        email: $('empEmail').value.trim(),
        password: $('empPassword').value,
        role: $('empRole').value
      };
      try {
        if (state.editingEmployee) {
          await EMP.update(state.editingEmployee, payload);
          employeeMsg('employeeOk', 'Akun karyawan berhasil diperbarui.');
        } else {
          await EMP.create(payload);
          employeeMsg('employeeOk', 'Akun karyawan berhasil dibuat.');
        }
        resetEmployeeForm();
        await renderEmployees();
      } catch (err) {
        employeeMsg('employeeError', err.message);
      }
    });

    $('empCancel').onclick = resetEmployeeForm;
    $('empReload').onclick = () => renderEmployees();

    document.body.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-emp-edit]');
      const toggle = e.target.closest('[data-emp-toggle]');
      const del = e.target.closest('[data-emp-delete]');
      if (!edit && !toggle && !del) return;
      e.preventDefault();
      employeeMsg('employeeError', '');
      employeeMsg('employeeOk', '');

      if (edit) {
        const user = state.employees.find((u) => u.id === edit.dataset.empEdit);
        if (!user) return;
        state.editingEmployee = user.id;
        $('empName').value = user.name;
        $('empEmail').value = user.email;
        $('empRole').value = user.role;
        $('empPassword').value = '';
        $('empPassword').required = false;
        $('empPasswordHint').textContent = '(kosongkan jika tidak diubah)';
        $('empSubmit').textContent = 'Perbarui Karyawan';
        $('empName').focus();
        return;
      }

      const id = toggle ? toggle.dataset.empToggle : del.dataset.empDelete;
      try {
        if (toggle) {
          const user = state.employees.find((u) => u.id === id);
          await EMP.update(id, { active: !user.active });
          employeeMsg('employeeOk', 'Status karyawan diperbarui.');
        } else {
          if (!confirm('Hapus akun karyawan ini? Tindakan ini tidak dapat dibatalkan.')) return;
          await EMP.remove(id);
          employeeMsg('employeeOk', 'Akun karyawan dihapus.');
        }
        await renderEmployees();
      } catch (err) {
        employeeMsg('employeeError', err.message);
      }
    });
  }

  /* ---------------- Ekspor ---------------- */
  function exportCSV() {
    const range = state.range;
    let rows;
    let name;
    if (state.view === 'stok') {
      rows = [['SKU', 'Produk', 'Kategori', 'Stok Gudang', 'Stok Rak', 'Terjual 30h', 'Cover (hari)', 'Status', 'Nilai Inventori']]
        .concat(D.stockStatus().map((p) => [p.sku, p.name, p.category, p.warehouseStock, p.shelfCurrent, p.qty30, p.cover ? Math.round(p.cover) : '', p.status, p.inventoryValue]));
      name = 'stok-inventori';
    } else if (state.view === 'karyawan') {
      rows = [['Nama', 'Email', 'Role', 'Status', 'Dibuat']]
        .concat(state.employees.map((u) => [u.name, u.email, u.role_label || u.role, u.active ? 'Aktif' : 'Nonaktif', fmtDate(u.created_at)]));
      name = 'karyawan';
    } else if (state.view === 'keuangan') {
      rows = [['Bulan', 'Pendapatan', 'HPP', 'Laba Kotor', 'Biaya Bayar', 'Opex', 'Laba Bersih']]
        .concat(D.monthlyFinancials().map((m) => [m.label, m.revenue, m.hpp, m.gross, m.fees, m.opex, m.net]));
      name = 'laporan-keuangan';
    } else if (state.view === 'penjualan' || state.view === 'dashboard') {
      rows = [['Invoice', 'Tanggal', 'Kasir', 'Metode', 'Item', 'Subtotal', 'Diskon', 'PPN', 'Total', 'HPP', 'Laba Kotor']]
        .concat(D.salesIn(range).map((s) => [
          s.invoice, new Date(s.ts).toLocaleString('id-ID'), s.cashier, s.paymentLabel,
          s.items.reduce((a, i) => a + i.qty, 0), s.subtotal, s.discount, s.tax, s.total, s.hpp,
          s.subtotal - s.discount - s.hpp
        ]));
      name = 'penjualan';
    } else {
      const ctx = AI.buildContext(range);
      rows = [['Insight', 'Detail'], ...ctx.tops.map((t) => ['Produk terlaris: ' + t.name, `${t.qty} unit · ${money(t.revenue)}`])];
      name = 'insight';
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agrierp-${name}-${D.dateKey(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* ---------------- Event ---------------- */
  function bindControls() {
    document.querySelectorAll('#preset-group [data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        state.preset = b.dataset.preset;
        document.querySelectorAll('#preset-group [data-preset]').forEach((x) => x.classList.toggle('active', x === b));
        render();
      });
    });

    $('granularity').addEventListener('change', (e) => {
      state.granularity = e.target.value;
      render();
    });

    $('set-ai-provider').addEventListener('change', (e) => {
      const local = e.target.value === 'local';
      $('ai-cloud-fields').style.opacity = local ? '0.55' : '1';
      $('ai-cloud-fields').style.pointerEvents = local ? 'none' : 'auto';
    });

    $('ai-question').addEventListener('keydown', (e) => { if (e.key === 'Enter') askAI(); });

    bindEmployeeControls();

    window.addEventListener('erp:update', () => {
      $('sidebar-sync-time').textContent = 'Event masuk ' + new Date().toLocaleTimeString('id-ID');
      render();
    });
  }

  function refresh(manual) {
    D.load();
    render();
    if (manual) {
      const btn = document.querySelector('[onclick="App.refresh(true)"]');
      if (btn) {
        btn.classList.add('animate-spin');
        setTimeout(() => btn.classList.remove('animate-spin'), 600);
      }
    }
  }

  /* ---------------- Bootstrap ---------------- */
  async function init() {
    D.load();
    D.connectRealtime();
    bindNav();
    bindControls();
    await loadSession();
    render();
    setInterval(() => { $('footer-clock').textContent = new Date().toLocaleString('id-ID'); }, 30000);
    if (window.lucide) window.lucide.createIcons();
  }

  window.App = { go, render, refresh, runAI, askAI, saveSettings, resetData, exportCSV, renderSalesTable, renderInventory, state };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
