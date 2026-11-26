/**
 * AgriShop — Lapisan data bersama untuk halaman Customer & Admin
 * Disimpan di localStorage (demo statis, tanpa server).
 */
(function (global) {
  'use strict';

  const KEY = 'agrisuite_shop_v1';
  const ADMIN_KEY = 'agrisuite_admin_session_v1';
  const ACCOUNTS_KEY = 'agrisuite_accounts_v1';
  const SESSION_KEY = 'agrisuite_session_v1';
  const ADMIN_EMAIL = 'admin@tokotani.id';
  const DEMO_ADMIN = { username: 'admin', email: ADMIN_EMAIL, password: 'admin123' };

  const SEED_PRODUCTS = [
    { id: 'PRD-1001', sku: 'BNH-PADI-32', name: 'Benih Padi Unggul Inpari 32 (5kg)', category: 'Benih', price: 75000, unit: 'karung', stock: 42, image: 'https://placehold.co/600x450/278b4d/ffffff?text=Benih+Padi' },
    { id: 'PRD-1002', sku: 'PPK-NPK-16', name: 'Pupuk NPK Mutiara 16-16-16 (1kg)', category: 'Pupuk', price: 22000, unit: 'karung', stock: 120, image: 'https://placehold.co/600x450/38ab63/ffffff?text=Pupuk+NPK' },
    { id: 'PRD-1003', sku: 'PST-ORG-500', name: 'Pestisida Nabati Neem Oil 500ml', category: 'Pestisida', price: 48000, unit: 'botol', stock: 35, image: 'https://placehold.co/600x450/1e5835/ffffff?text=Pestisida+Nabati' },
    { id: 'PRD-1004', sku: 'ALT-SPRY-16L', name: 'Tangki Sprayer Elektrik Pertanian 16L', category: 'Alat Pertanian', price: 465000, unit: 'unit', stock: 8, image: 'https://placehold.co/600x450/216e3f/ffffff?text=Sprayer+16L' },
    { id: 'PRD-1005', sku: 'PPK-UREA-50', name: 'Pupuk Urea Premium (50kg)', category: 'Pupuk', price: 185000, unit: 'karung', stock: 26, image: 'https://placehold.co/600x450/5fc684/ffffff?text=Urea+50kg' },
    { id: 'PRD-1006', sku: 'BNH-JAGUNG-1', name: 'Benih Jagung Hibrida Bisi-18 (1kg)', category: 'Benih', price: 62000, unit: 'pak', stock: 54, image: 'https://placehold.co/600x450/96deaf/0d2718?text=Jagung+Bisi-18' },
    { id: 'PRD-1007', sku: 'PST-GLIF-1L', name: 'Herbisida Glifosat 480 SL (1L)', category: 'Pestisida', price: 58000, unit: 'botol', stock: 61, image: 'https://placehold.co/600x450/278b4d/ffffff?text=Glifosat' },
    { id: 'PRD-1008', sku: 'ALT-CANGKUL', name: 'Cangkul Baja Handle Kayu', category: 'Alat Pertanian', price: 95000, unit: 'unit', stock: 19, image: 'https://placehold.co/600x450/1a482d/ffffff?text=Cangkul+Baja' },
    { id: 'PRD-1009', sku: 'ALT-SELANG-50', name: 'Selang Irigasi PE 1 inch (50m)', category: 'Alat Pertanian', price: 210000, unit: 'roll', stock: 11, image: 'https://placehold.co/600x450/38ab63/ffffff?text=Selang+Irigasi' },
    { id: 'PRD-1010', sku: 'HSL-BERAS-25', name: 'Beras Premium Hasil Tani (25kg)', category: 'Hasil Tani', price: 320000, unit: 'karung', stock: 33, image: 'https://placehold.co/600x450/f3efe6/5c4d3c?text=Beras+Premium' },
    { id: 'PRD-1011', sku: 'PPK-KMPK-25', name: 'Pupuk KCL / MOP (25kg)', category: 'Pupuk', price: 145000, unit: 'karung', stock: 24, image: 'https://placehold.co/600x450/216e3f/ffffff?text=Pupuk+KCL' },
    { id: 'PRD-1012', sku: 'PST-INSEK-250', name: 'Insektisida Cair 250ml', category: 'Pestisida', price: 39000, unit: 'botol', stock: 47, image: 'https://placehold.co/600x450/5fc684/0d2718?text=Insektisida' },
    { id: 'PRD-1013', sku: 'HSL-JAGUNG-50', name: 'Jagung Pipil Kering (50kg)', category: 'Hasil Tani', price: 385000, unit: 'karung', stock: 14, image: 'https://placehold.co/600x450/f3efe6/5c4d3c?text=Jagung+Pipil' },
    { id: 'PRD-1014', sku: 'ALT-GEMBOR', name: 'Gembor Semprot 5L', category: 'Alat Pertanian', price: 68000, unit: 'unit', stock: 28, image: 'https://placehold.co/600x450/1e5835/ffffff?text=Gembor+5L' }
  ];

  const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  const pad = (n) => String(n).padStart(2, '0');
  const nowIso = () => new Date().toISOString();

  function seed() {
    return { version: 1, products: SEED_PRODUCTS.map((p) => ({ ...p, active: true })), orders: [], counter: 1 };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        const fresh = seed();
        localStorage.setItem(KEY, JSON.stringify(fresh));
        return fresh;
      }
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.products)) throw new Error('invalid');
      if (!Array.isArray(data.orders)) data.orders = [];
      if (!data.counter) data.counter = data.orders.length + 1;
      return data;
    } catch (e) {
      const fresh = seed();
      localStorage.setItem(KEY, JSON.stringify(fresh));
      return fresh;
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    try {
      const ch = new BroadcastChannel('agrisuite_shop_sync');
      ch.postMessage({ type: 'SHOP_UPDATED', at: Date.now() });
      ch.close();
    } catch (e) { /* BroadcastChannel opsional */ }
    global.dispatchEvent(new CustomEvent('agrishop:updated', { detail: data }));
    return data;
  }

  function onChange(cb) {
    window.addEventListener('storage', (e) => { if (e.key === KEY) cb(load()); });
    window.addEventListener('agrishop:updated', (e) => cb(e.detail));
    try {
      const ch = new BroadcastChannel('agrisuite_shop_sync');
      ch.onmessage = () => cb(load());
    } catch (e) { /* ignore */ }
  }

  function nextOrderCode(data) {
    const d = new Date();
    const code = `AGS-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(data.counter).padStart(3, '0')}`;
    data.counter += 1;
    return code;
  }

  /** Buat pesanan; memotong stok produk. */
  function createOrder({ customer, items, note, payment }) {
    const data = load();
    if (!items || !items.length) throw new Error('Keranjang kosong');

    const lines = items.map((it) => {
      const p = data.products.find((x) => x.id === it.id);
      if (!p || !p.active) throw new Error('Produk tidak tersedia: ' + it.id);
      if (p.stock < it.qty) throw new Error(`Stok ${p.name} hanya ${p.stock}`);
      return { id: p.id, name: p.name, price: p.price, qty: it.qty, unit: p.unit, subtotal: p.price * it.qty };
    });

    const total = lines.reduce((s, l) => s + l.subtotal, 0);
    const order = {
      id: 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      code: nextOrderCode(data),
      customer: {
        name: (customer.name || '').trim(),
        email: (customer.email || '').trim().toLowerCase(),
        phone: (customer.phone || '').trim(),
        address: (customer.address || '').trim()
      },
      note: (note || '').trim(),
      payment: payment || 'cod',
      items: lines,
      total,
      status: 'baru',
      createdAt: nowIso(),
      history: [{ status: 'baru', at: nowIso() }]
    };

    lines.forEach((l) => {
      const p = data.products.find((x) => x.id === l.id);
      if (p) p.stock = Math.max(0, p.stock - l.qty);
    });
    data.orders.unshift(order);
    save(data);
    return order;
  }

  function updateOrderStatus(orderId, status) {
    const data = load();
    const o = data.orders.find((x) => x.id === orderId);
    if (!o) return null;
    if (o.status === 'batal' && status !== 'batal') return o; // stok sudah dikembalikan
    if (status === 'batal' && o.status !== 'batal') {
      o.items.forEach((l) => {
        const p = data.products.find((x) => x.id === l.id);
        if (p) p.stock += l.qty;
      });
    }
    o.status = status;
    o.history = o.history || [];
    o.history.push({ status, at: nowIso() });
    save(data);
    return o;
  }

  function upsertProduct(product) {
    const data = load();
    const idx = data.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) data.products[idx] = { ...data.products[idx], ...product };
    else {
      data.products.push({
        id: product.id || 'PRD-' + Date.now().toString().slice(-6),
        sku: product.sku || 'SKU-' + Date.now().toString().slice(-5),
        name: product.name,
        category: product.category || 'Lainnya',
        price: Number(product.price) || 0,
        unit: product.unit || 'unit',
        stock: Number(product.stock) || 0,
        image: product.image || 'https://placehold.co/600x450/278b4d/ffffff?text=' + encodeURIComponent(product.name || 'Produk'),
        active: product.active !== false
      });
    }
    save(data);
  }

  function toggleProduct(id, active) {
    const data = load();
    const p = data.products.find((x) => x.id === id);
    if (p) { p.active = active; save(data); }
  }

  function resetDemo() {
    const fresh = seed();
    fresh.counter = Math.floor(Math.random() * 20) + 1;
    const sampleNames = ['Pak Sutrisno', 'Bu Rina Wati', 'Kelompok Tani Sumber Rejeki', 'Pak Hendra', 'Bu Siti Aminah'];
    const cities = ['Jl. Raya Sawangan No. 12, Magelang', 'Dusun Krajan RT 3/RW 2, Temanggung', 'Jl. Pertanian No. 45, Salatiga', 'Desa Sumberejo, Boyolali', 'Jl. Pasar Baru No. 8, Ungaran'];
    for (let i = 0; i < 6; i++) {
      const picks = [];
      const n = 1 + (i % 3);
      for (let j = 0; j < n; j++) {
        const p = fresh.products[(i * 3 + j) % fresh.products.length];
        if (picks.find((x) => x.id === p.id)) continue;
        picks.push({ id: p.id, name: p.name, price: p.price, qty: 1 + ((i + j) % 3), unit: p.unit, subtotal: 0 });
      }
      picks.forEach((l) => { l.subtotal = l.price * l.qty; });
      const dayOffset = i * 0.6;
      const created = new Date(Date.now() - dayOffset * 86400000).toISOString();
      fresh.orders.push({
        id: 'ord_seed_' + i,
        code: `AGS-${new Date().getFullYear()}${pad(new Date().getMonth() + 1)}${pad(new Date().getDate())}-${String(fresh.counter + i).padStart(3, '0')}`,
        customer: { name: sampleNames[i], phone: '0812' + (3000000 + i * 12345), address: cities[i] },
        note: i === 2 ? 'Tolong kirim pagi hari.' : '',
        payment: i % 2 ? 'transfer' : 'cod',
        items: picks,
        total: picks.reduce((s, l) => s + l.subtotal, 0),
        status: ['baru', 'diproses', 'selesai', 'diproses', 'selesai', 'batal'][i],
        createdAt: created,
        history: [{ status: 'baru', at: created }]
      });
    }
    fresh.counter += 6;
    save(fresh);
    return fresh;
  }

  function stats(data) {
    data = data || load();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const valid = data.orders.filter((o) => o.status !== 'batal');
    const revenue = valid.reduce((s, o) => s + o.total, 0);
    const todayOrders = valid.filter((o) => new Date(o.createdAt) >= today);
    const lowStock = data.products.filter((p) => p.active && p.stock <= 10);
    return {
      orders: data.orders.length,
      baru: data.orders.filter((o) => o.status === 'baru').length,
      diproses: data.orders.filter((o) => o.status === 'diproses').length,
      selesai: data.orders.filter((o) => o.status === 'selesai').length,
      batal: data.orders.filter((o) => o.status === 'batal').length,
      revenue,
      todayRevenue: todayOrders.reduce((s, o) => s + o.total, 0),
      todayCount: todayOrders.length,
      lowStock,
      products: data.products.filter((p) => p.active).length
    };
  }

  const STATUS_META = {
    baru: { label: 'Baru', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    diproses: { label: 'Diproses', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
      dikirim: { label: 'Dikirim', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    selesai: { label: 'Selesai', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    batal: { label: 'Dibatalkan', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
  };

  function login(username, password) {
    if (username.trim().toLowerCase() === DEMO_ADMIN.username && password === DEMO_ADMIN.password) {
      sessionStorage.setItem(ADMIN_KEY, JSON.stringify({ user: DEMO_ADMIN.username, at: Date.now() }));
      return true;
    }
    return false;
  }
  function isLoggedIn() {
    try { return !!JSON.parse(sessionStorage.getItem(ADMIN_KEY) || 'null'); } catch (e) { return false; }
  }
  function logout() { sessionStorage.removeItem(ADMIN_KEY); }

  /* ------------------------------------------------------------------ */
  /* Akun & sesi terpadu (customer + admin)                              */
  /* ------------------------------------------------------------------ */
  const hash = (s) => btoa(unescape(encodeURIComponent('agrishop:' + s)));

  function isAdminEmail(email) {
    return String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
  }

  function accounts() {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveAccounts(list) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); }

  function register({ name, email, phone, password }) {
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    phone = (phone || '').trim();
    if (!name || !email || !phone || !password) throw new Error('Semua kolom wajib diisi.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Format email tidak valid.');
    if (password.length < 6) throw new Error('Password minimal 6 karakter.');
    if (isAdminEmail(email)) throw new Error('Email tersebut khusus admin toko. Silakan masuk lewat tab admin.');
    const list = accounts();
    if (list.some((a) => a.email === email)) throw new Error('Email sudah terdaftar. Silakan masuk.');
    const acc = { name, email, phone, password: hash(password), createdAt: nowIso() };
    list.push(acc); saveAccounts(list);
    setSession({ role: 'customer', name, email, phone });
    return acc;
  }

  function loginAccount(email, password) {
    email = (email || '').trim().toLowerCase();
    if (!email || !password) throw new Error('Email dan password wajib diisi.');
    if (isAdminEmail(email)) {
      if (password !== DEMO_ADMIN.password) throw new Error('Password admin salah.');
      setSession({ role: 'admin', name: 'Admin Toko Tani', email });
      return { role: 'admin', name: 'Admin Toko Tani', email };
    }
    const acc = accounts().find((a) => a.email === email);
    if (!acc) throw new Error('Email belum terdaftar. Silakan daftar terlebih dahulu.');
    if (acc.password !== hash(password)) throw new Error('Password salah.');
    setSession({ role: 'customer', name: acc.name, email: acc.email, phone: acc.phone });
    return { role: 'customer', name: acc.name, email: acc.email, phone: acc.phone };
  }

  function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, at: Date.now() }));
  }
  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && s.role ? s : null;
    } catch (e) { return null; }
  }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  /* ------------------------------------------------------------------ */
  /* Akun ERP (owner / kasir / gudang) melalui backend                   */
  /* ------------------------------------------------------------------ */
  const STAFF_LANDING = {
    owner: '/page/erp/',
    admin: '/page/erp/',
    cashier: '/page/kasir/',
    warehouse: '/page/gudang/',
    customer: '/page/customer/'
  };

  function landingFor(role) { return STAFF_LANDING[role] || '/page/customer/'; }

  async function apiRequest(path, options) {
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) throw new Error(data.error || 'Permintaan gagal. Status ' + res.status);
    return data;
  }

  /** Login staf: role asli disimpan di erp_role, role 'admin' dipakai panel lama. */
  async function loginStaff(email, password) {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    const u = data.user;
    const sessionRole = u.role === 'owner' ? 'admin' : u.role;
    setSession({
      role: sessionRole,
      erp_role: u.role,
      name: u.name,
      email: u.email,
      redirect: u.redirect || landingFor(sessionRole)
    });
    return Object.assign({}, u, { role: sessionRole, redirect: u.redirect || landingFor(sessionRole) });
  }

  async function logoutAllAsync() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch (e) { /* abaikan */ }
    clearSession();
    logout();
  }

  function logoutAll() {
    try {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true });
    } catch (e) { /* abaikan */ }
    clearSession();
    logout();
  }

  /** Arahkan ke login bila sesi tidak sesuai; kembalikan sesi aktif. */
  function requireRole(role, nextPath) {
    const s = getSession();
    if (!s) {
      const next = encodeURIComponent(nextPath || location.pathname);
      location.replace('/page/login/?next=' + next);
      return null;
    }
    const allowed = Array.isArray(role) ? role : [role];
    if (allowed.length && !allowed.includes(s.role)) {
      location.replace(landingFor(s.role));
      return null;
    }
    return s;
  }

  function ordersOf(email, phone) {
    const e = String(email || '').toLowerCase();
    const p = String(phone || '').replace(/\D/g, '');
    return load().orders.filter((o) => {
      const oe = (o.customer.email || '').toLowerCase();
      const op = (o.customer.phone || '').replace(/\D/g, '');
      return (e && oe === e) || (!oe && p && op === p);
    });
  }

  global.AgriShop = {
    KEY, DEMO_ADMIN, ADMIN_EMAIL, SEED_PRODUCTS, STATUS_META,
    rupiah, load, save, onChange, createOrder, updateOrderStatus,
    upsertProduct, toggleProduct, resetDemo, stats,
    login, isLoggedIn, logout,
    isAdminEmail, register, loginAccount, loginStaff, setSession, getSession, clearSession,
    logoutAll, logoutAllAsync, requireRole, landingFor, ordersOf
  };
})(window);
