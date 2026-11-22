/**
 * AgriERP — Mesin Bisnis Insight & Strategi (AI)
 * ------------------------------------------------------------------
 * 1) Mode "local"  : analitik deterministik berbasis data ERP (offline,
 *                    selalu tersedia, tanpa API key).
 * 2) Mode "openai" : kirim ringkasan bisnis ke endpoint OpenAI-compatible
 *                    (OpenAI / OpenRouter / Groq / LM Studio dst).
 * 3) Mode "ollama" : model lokal via http://localhost:11434.
 * Jika mode cloud gagal, otomatis fallback ke analitik lokal.
 */
(function (global) {
  'use strict';

  const D = global.AgriERPData;
  const fmt = D.rupiah;
  const pct = (n) => (isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

  /* ------------------------------------------------------------------ */
  /* Konteks bisnis                                                      */
  /* ------------------------------------------------------------------ */
  function buildContext(range) {
    const cur = D.salesIn(range);
    const prev = D.salesIn(D.previousRange(range));
    const curSum = D.summarize(cur, D.expensesIn(range));
    const prevSum = D.summarize(prev, []);
    const series = D.series(cur, range);
    const tops = D.topProducts(cur, 6);
    const cats = D.categoryMix(cur);
    const pays = D.paymentMix(cur);
    const stock = D.stockStatus();
    const days = Math.max(1, Math.round((range.end - range.start) / 86400000));

    const growth = prevSum.revenue ? ((curSum.revenue - prevSum.revenue) / prevSum.revenue) * 100 : null;
    const txGrowth = prevSum.transactions ? ((curSum.transactions - prevSum.transactions) / prevSum.transactions) * 100 : null;

    // jam sibuk
    const hours = new Array(24).fill(0);
    cur.forEach((s) => { hours[new Date(s.ts).getHours()] += s.total; });
    const peakHour = hours.indexOf(Math.max(...hours));

    // hari terbaik
    const dow = new Array(7).fill(0);
    cur.forEach((s) => { dow[new Date(s.ts).getDay()] += s.total; });
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const bestDay = dayNames[dow.indexOf(Math.max(...dow))];

    // perputaran stok (cost of goods / rata-rata nilai inventori)
    const invValue = stock.reduce((s, p) => s + p.inventoryValue, 0);
    const turns = invValue ? (curSum.hpp * (365 / days)) / invValue : 0;

    // Produk tidak bergerak (tidak terjual dalam periode)
    const soldSkus = new Set();
    cur.forEach((s) => s.items.forEach((i) => soldSkus.add(i.sku)));
    const deadStock = stock.filter((p) => !soldSkus.has(p.sku));

    // Proyeksi sederhana 30 hari ke depan
    const dailyAvg = curSum.revenue / days;
    const projected30 = dailyAvg * 30;

    return {
      range: { label: range.label, start: range.start.toISOString(), end: range.end.toISOString(), days },
      current: curSum,
      previous: prevSum,
      growth, txGrowth,
      series, tops, cats, pays, stock, deadStock,
      peakHour, bestDay, turns, invValue, dailyAvg, projected30,
      storeName: D.get().settings.storeName
    };
  }

  /* ------------------------------------------------------------------ */
  /* Analitik lokal                                                      */
  /* ------------------------------------------------------------------ */
  function localInsights(ctx) {
    const c = ctx.current;
    const out = [];

    // 1. Kinerja penjualan
    if (ctx.growth === null) {
      out.push({
        icon: 'trending-up', tone: 'info', title: 'Baseline periode terbentuk',
        text: `Periode ${ctx.range.label} mencatat ${fmt(c.revenue)} dari ${c.transactions} transaksi. Belum ada pembanding sebelumnya — gunakan periode berikutnya untuk mengukur tren.`,
        action: 'Pertahankan pencatatan harian agar tren bisa dibandingkan.'
      });
    } else if (ctx.growth >= 5) {
      out.push({
        icon: 'trending-up', tone: 'good', title: `Penjualan tumbuh ${pct(ctx.growth)}`,
        text: `Omzet ${fmt(c.revenue)} naik dibanding periode sebelumnya (${fmt(ctx.previous.revenue)}). Transaksi ${ctx.txGrowth >= 0 ? 'naik' : 'turun'} ${pct(ctx.txGrowth || 0)}.`,
        action: 'Amankan stok produk terlaris dan pertahankan jam operasional pada hari tersibuk (' + ctx.bestDay + ').'
      });
    } else if (ctx.growth <= -5) {
      out.push({
        icon: 'trending-down', tone: 'bad', title: `Penjualan turun ${pct(ctx.growth)}`,
        text: `Omzet turun dari ${fmt(ctx.previous.revenue)} menjadi ${fmt(c.revenue)}. Penurunan ini perlu ditelusuri pada kategori dan kanal penjualan.`,
        action: 'Jalankan promo bundling pada produk lambat laku dan hubungi pelanggan grosir yang berhenti membeli.'
      });
    } else {
      out.push({
        icon: 'activity', tone: 'info', title: 'Penjualan relatif stabil',
        text: `Omzet ${fmt(c.revenue)} bergerak ${pct(ctx.growth)} dibanding periode sebelumnya. Pertumbuhan datar menandakan perlu strategi akuisisi pelanggan baru.`,
        action: 'Fokus pada peningkatan rata-rata transaksi lewat upselling produk pendamping.'
      });
    }

    // 2. Margin
    const feeRatio = c.revenue ? ((c.fees / c.revenue) * 100) : 0;
    out.push({
      icon: 'percent', tone: c.margin >= 18 ? 'good' : c.margin >= 12 ? 'info' : 'bad',
      title: `Margin kotor ${c.margin.toFixed(1)}%`,
      text: `Laba kotor ${fmt(c.gross)} setelah biaya pembayaran ${fmt(c.fees)} (${feeRatio.toFixed(2)}% dari omzet). HPP menyerap ${c.revenue ? ((c.hpp / c.revenue) * 100).toFixed(1) : 0}% omzet.`,
      action: c.margin < 15
        ? 'Evaluasi harga jual produk bermargin rendah dan negosiasi harga beli ke supplier utama.'
        : 'Pertahankan struktur harga; dorong penjualan produk bermargin di atas rata-rata.'
    });

    // 3. Produk terlaris
    if (ctx.tops.length) {
      const t = ctx.tops[0];
      const share = c.revenue ? (t.revenue / c.revenue) * 100 : 0;
      out.push({
        icon: 'package', tone: 'info', title: `${t.name} memimpin penjualan`,
        text: `${D.num(t.qty)} unit terjual senilai ${fmt(t.revenue)} (${share.toFixed(1)}% omzet), menyumbang laba ${fmt(t.gross)}.`,
        action: `Jaga stok minimal 2x permintaan ${ctx.range.days} hari (≈${Math.ceil(t.qty / ctx.range.days * ctx.range.days * 2)} unit) dan tempatkan di rak depan.`
      });
    }

    // 4. Risiko stok
    const critical = ctx.stock.filter((p) => p.status === 'critical' || p.status === 'warning');
    const over = ctx.stock.filter((p) => p.status === 'overstock');
    if (critical.length) {
      out.push({
        icon: 'alert-triangle', tone: 'bad', title: `${critical.length} produk berisiko kehabisan stok`,
        text: critical.slice(0, 5).map((p) => `${p.name} (sisa ${p.warehouseStock} ${p.unit}${p.cover ? `, cover ${Math.round(p.cover)} hari` : ''})`).join('; ') + '.',
        action: 'Buat purchase order sekarang untuk item di bawah titik reorder. Prioritaskan yang cover < 7 hari.'
      });
    }
    if (over.length) {
      out.push({
        icon: 'archive', tone: 'warn', title: `${over.length} produk kelebihan stok`,
        text: `Modal tertahan ${fmt(over.reduce((s, p) => s + p.inventoryValue, 0))} pada ${over.map((p) => p.name).slice(0, 3).join(', ')}${over.length > 3 ? ' dll' : ''}.`,
        action: 'Bundling atau diskon terbatas untuk mempercepat perputaran; tunda restock produk ini.'
      });
    }

    // 5. Dead stock
    if (ctx.deadStock.length) {
      out.push({
        icon: 'package-x', tone: 'warn', title: `${ctx.deadStock.length} produk tidak bergerak`,
        text: `${ctx.deadStock.map((p) => p.name).slice(0, 4).join(', ')} tidak terjual sama sekali pada ${ctx.range.label}. Nilai stok ${fmt(ctx.deadStock.reduce((s, p) => s + p.inventoryValue, 0))}.`,
        action: 'Lakukan clearance bertingkat: 10% minggu pertama, 20% bila belum bergerak di minggu ketiga.'
      });
    }

    // 6. Pola waktu
    out.push({
      icon: 'clock', tone: 'info', title: `Puncak transaksi ${String(ctx.peakHour).padStart(2, '0')}:00, hari tersibuk ${ctx.bestDay}`,
      text: `Alokasikan kasir ekstra pada jam ${String(ctx.peakHour).padStart(2, '0')}:00–${String((ctx.peakHour + 2) % 24).padStart(2, '0')}:00 untuk memangkas antrean dan kehilangan penjualan.`,
      action: `Jadwalkan restock rak pada pagi ${ctx.bestDay} sebelum lonjakan pembeli.`
    });

    // 7. Metode pembayaran
    if (ctx.pays.length) {
      const top = ctx.pays[0];
      const share = c.revenue ? (top.revenue / c.revenue) * 100 : 0;
      out.push({
        icon: 'credit-card', tone: 'info', title: `${top.label} mendominasi (${share.toFixed(0)}%)`,
        text: `Biaya pembayaran total ${fmt(c.fees)}. ${ctx.pays.filter(p => p.fee > 0).map(p => `${p.label} ${fmt(p.fee)}`).join(', ') || 'Tidak ada biaya kanal signifikan'}.`,
        action: 'Dorong QRIS bertarif rendah untuk transaksi kecil agar biaya kanal tetap efisien.'
      });
    }

    // 8. Perputaran & proyeksi
    out.push({
      icon: 'refresh-cw', tone: ctx.turns < 4 ? 'warn' : 'good', title: `Perputaran stok ${ctx.turns.toFixed(1)}x / tahun`,
      text: `Nilai inventori saat ini ${fmt(ctx.invValue)}. Proyeksi omzet 30 hari ke depan ≈ ${fmt(ctx.projected30)} (rata-rata ${fmt(ctx.dailyAvg)}/hari).`,
      action: ctx.turns < 4
        ? 'Kurangi pembelian produk slow-moving; targetkan perputaran minimal 6x per tahun.'
        : 'Perputaran sehat — pertahankan rasio stok terhadap penjualan.'
    });

    return out;
  }

  function localStrategy(ctx) {
    const c = ctx.current;
    const plans = [];
    const critical = ctx.stock.filter((p) => p.status === 'critical' || p.status === 'warning');
    const top = ctx.tops[0];

    plans.push({
      horizon: '7 hari',
      title: 'Stabilkan ketersediaan produk inti',
      steps: [
        critical.length
          ? `Terbitkan PO untuk ${critical.slice(0, 3).map((p) => p.sku).join(', ')} (min. ${critical.slice(0, 3).map((p) => Math.max(10, Math.ceil((p.velocity || 1) * 21))).join('/')} unit).`
          : 'Audit titik reorder semua produk; pastikan buffer 14 hari terpenuhi.',
        'Sinkronkan stok rak dan gudang setiap pagi sebelum toko buka.',
        'Aktifkan notifikasi stok menipis pada dashboard gudang.'
      ],
      impact: 'Menekan kehilangan penjualan akibat stok kosong (potensi 3–7% omzet).'
    });

    plans.push({
      horizon: '30 hari',
      title: 'Naikkan nilai transaksi rata-rata',
      steps: [
        `Buat paket bundling ${top ? top.name : 'produk terlaris'} + pupuk pendamping dengan diskon 5%.`,
        'Terapkan cross-selling di kasir: tawarkan item pelengkap saat checkout.',
        `Targetkan rata-rata transaksi naik dari ${fmt(c.avgTicket)} ke ${fmt(c.avgTicket * 1.12)}.`
      ],
      impact: `Potensi tambahan omzet ±${fmt(c.revenue * 0.08)} per periode dengan volume pelanggan sama.`
    });

    plans.push({
      horizon: '90 hari',
      title: 'Perluas kanal & basis pelanggan grosir',
      steps: [
        'Kumpulkan nomor WhatsApp pelanggan bertransaksi > 3x, tawarkan harga grosir berjenjang.',
        'Jadwalkan promo musiman mengikuti kalender tanam (Mar–Apr & Sep–Okt).',
        'Evaluasi produk dead stock: clearance atau hentikan pembelian.'
      ],
      impact: 'Diversifikasi pendapatan dan mengurangi ketergantungan pada penjualan walk-in.'
    });

    if (ctx.growth !== null && ctx.growth < 0) {
      plans.unshift({
        horizon: 'Sekarang',
        title: 'Diagnosa penurunan omzet',
        steps: [
          'Bandingkan penjualan per kategori dengan periode sebelumnya untuk menemukan sumber penurunan.',
          'Hubungi 10 pelanggan grosir teratas yang tidak bertransaksi pada periode ini.',
          'Periksa ketersediaan stok produk terlaris — kehabisan stok sering menjadi penyebab utama.'
        ],
        impact: 'Mengembalikan omzet ke baseline dalam 2–4 minggu.'
      });
    }

    return plans;
  }

  /* ------------------------------------------------------------------ */
  /* Prompt untuk LLM                                                    */
  /* ------------------------------------------------------------------ */
  function compact(ctx) {
    const c = ctx.current;
    return {
      toko: ctx.storeName,
      periode: ctx.range.label,
      omzet: Math.round(c.revenue),
      transaksi: c.transactions,
      laba_kotor: Math.round(c.gross),
      hpp: Math.round(c.hpp),
      biaya_operasional: Math.round(c.opex),
      laba_bersih: Math.round(c.net),
      margin_pct: Number(c.margin.toFixed(1)),
      rata2_transaksi: Math.round(c.avgTicket),
      pertumbuhan_omzet_pct: ctx.growth === null ? null : Number(ctx.growth.toFixed(1)),
      produk_terlaris: ctx.tops.map((t) => ({ nama: t.name, qty: t.qty, omzet: Math.round(t.revenue) })),
      kategori: ctx.cats.map((k) => ({ nama: k.category, omzet: Math.round(k.revenue) })),
      metode_bayar: ctx.pays.map((p) => ({ nama: p.label, omzet: Math.round(p.revenue) })),
      stok_kritis: ctx.stock.filter((p) => p.status === 'critical' || p.status === 'warning').map((p) => ({ nama: p.name, sisa: p.warehouseStock, cover_hari: p.cover ? Math.round(p.cover) : null })),
      kelebihan_stok: ctx.stock.filter((p) => p.status === 'overstock').map((p) => p.name),
      produk_tidak_bergerak: ctx.deadStock.map((p) => p.name),
      hari_tersibuk: ctx.bestDay,
      jam_puncak: ctx.peakHour,
      perputaran_stok_x_tahun: Number(ctx.turns.toFixed(1)),
      nilai_inventori: Math.round(ctx.invValue),
      proyeksi_30_hari: Math.round(ctx.projected30)
    };
  }

  async function callLLM(ctx, question, settings) {
    const provider = settings.aiProvider || 'local';
    const summary = JSON.stringify(compact(ctx), null, 2);

    const systemPrompt =
      'Anda adalah konsultan bisnis ritel pertanian (toko saprotan & hasil tani) di Indonesia. ' +
      'Analisis data ERP berikut dan berikan insight bisnis yang tajam serta strategi yang dapat dieksekusi. ' +
      'Gunakan bahasa Indonesia, format markdown ringkas, sertakan angka konkret dari data. ' +
      'Struktur jawaban: (1) Ringkasan Kinerja, (2) 3-5 Insight Utama, (3) Rekomendasi Strategi 7/30/90 hari, (4) Risiko yang perlu diwaspadai.';

    const userPrompt = `Data ERP toko:\n${summary}\n\nPertanyaan pemilik toko: ${question || 'Berikan analisis menyeluruh dan rekomendasi strategi bisnis yang paling relevan.'}`;

    if (provider === 'ollama') {
      const base = (settings.aiEndpoint || 'http://localhost:11434').replace(/\/$/, '');
      const res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.aiModel || 'llama3.1',
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });
      if (!res.ok) throw new Error('Ollama menolak permintaan (' + res.status + '). Pastikan model tersedia.');
      const data = await res.json();
      return (data.message && data.message.content) || 'Tidak ada respons dari model.';
    }

    const endpoint = settings.aiEndpoint || 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (settings.aiKey || '')
      },
      body: JSON.stringify({
        model: settings.aiModel || 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('API AI gagal (' + res.status + '). ' + body.slice(0, 200));
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Tidak ada respons dari model.';
  }

  function markdownToHtml(md) {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.*)$/gm, '<h4 class="font-bold text-agri-800 mt-4 mb-1">$1</h4>')
      .replace(/^## (.*)$/gm, '<h3 class="font-bold text-agri-900 text-base mt-4 mb-1">$1</h3>')
      .replace(/^# (.*)$/gm, '<h2 class="font-extrabold text-agri-900 text-lg mt-4 mb-2">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-agri-900">$1</strong>')
      .replace(/^- (.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^\d+\. (.*)$/gm, '<li class="ml-4 list-decimal">$1</li>')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  async function analyze(range, question) {
    const ctx = buildContext(range);
    const settings = D.get().settings;
    const local = { insights: localInsights(ctx), plans: localStrategy(ctx), ctx };

    if (!settings.aiProvider || settings.aiProvider === 'local') {
      return { ...local, mode: 'local', answer: null };
    }
    try {
      const answer = await callLLM(ctx, question, settings);
      return { ...local, mode: settings.aiProvider, answer, answerHtml: markdownToHtml(answer) };
    } catch (err) {
      return { ...local, mode: 'local', error: err.message, answer: null };
    }
  }

  global.AgriERPai = { buildContext, localInsights, localStrategy, analyze, compact, markdownToHtml };
})(window);
