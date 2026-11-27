/**
 * Mertani storefront — helper bersama untuk katalog, keranjang, checkout, dan akun.
 * Semua data produk berasal dari /api/catalog (sumber yang sama dengan kasir/gudang).
 */
(function (global) {
  'use strict';

  var CART_KEY = 'mertani_cart_v1';
  var CHECKOUT_KEY = 'mertani_checkout_client_id';

  function money(value) {
    return 'Rp ' + Math.round(Number(value) || 0).toLocaleString('id-ID');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function api(path, options) {
    var opts = Object.assign({ credentials: 'same-origin' }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    var res = await fetch(path, opts);
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) throw new Error(data.error || 'Permintaan gagal (' + res.status + ')');
    return data;
  }

  function fetchCatalog() {
    return api('/api/catalog', { method: 'GET' }).then(function (d) {
      return Array.isArray(d.products) ? d.products : [];
    });
  }

  function fetchMe() {
    return api('/api/customer/me', { method: 'GET' }).then(function (d) { return d.user || null; });
  }

  function fetchPaymentMethods() {
    return api('/api/payment-methods', { method: 'GET' }).then(function (d) {
      return Array.isArray(d.methods) ? d.methods : [];
    });
  }

  function fetchOrders() {
    return api('/api/orders', { method: 'GET' }).then(function (d) {
      return Array.isArray(d.orders) ? d.orders : [];
    });
  }

  function createOrder(payload) {
    return api('/api/orders', { method: 'POST', body: payload }).then(function (d) { return d.order; });
  }

  function getCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) return [];
      return items
        .filter(function (i) { return i && i.id; })
        .map(function (i) {
          return {
            id: String(i.id),
            qty: Math.min(99, Math.max(1, Math.floor(Number(i.qty) || 1))),
            snapshot: i.snapshot && typeof i.snapshot === 'object' ? i.snapshot : {}
          };
        });
    } catch (e) { return []; }
  }

  function saveCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items || []));
    syncHeader();
    global.dispatchEvent(new CustomEvent('mertani:cart', { detail: getCart() }));
  }

  function addToCart(product, qty) {
    var items = getCart();
    var amount = Math.min(99, Math.max(1, Math.floor(Number(qty) || 1)));
    var found = items.find(function (i) { return i.id === product.id; });
    if (found) {
      found.qty = Math.min(99, found.qty + amount);
    } else {
      items.push({
        id: product.id,
        qty: amount,
        snapshot: {
          name: product.name || '',
          price: Number(product.price) || 0,
          image: product.image || '',
          unit: product.unit || 'unit'
        }
      });
    }
    saveCart(items);
    return items;
  }

  function updateQty(id, qty) {
    var items = getCart();
    var found = items.find(function (i) { return i.id === id; });
    if (!found) return items;
    var next = Math.floor(Number(qty) || 0);
    if (next < 1) return removeFromCart(id);
    found.qty = Math.min(99, next);
    saveCart(items);
    return items;
  }

  function removeFromCart(id) {
    var items = getCart().filter(function (i) { return i.id !== id; });
    saveCart(items);
    return items;
  }

  function clearCart() {
    saveCart([]);
    clearCheckoutClientId();
  }

  function cartCount() {
    return getCart().reduce(function (sum, i) { return sum + i.qty; }, 0);
  }

  /** Gabungkan keranjang lokal dengan harga/stok terbaru dari backend. */
  function cartLines(products) {
    return getCart().map(function (item) {
      var product = (products || []).find(function (p) { return p.id === item.id; });
      var snapshot = item.snapshot || {};
      if (!product || product.active === false) {
        return {
          id: item.id, qty: item.qty, product: null, snapshot: snapshot,
          name: snapshot.name || 'Produk tidak tersedia', image: snapshot.image || '',
          price: 0, lineTotal: 0, available: false, missing: true,
          issue: 'Produk tidak lagi tersedia.'
        };
      }
      var changed = Number(snapshot.price || 0) !== Number(product.price);
      var enough = Number(product.stock) >= item.qty;
      return {
        id: item.id, qty: item.qty, product: product, snapshot: snapshot,
        name: product.name, image: product.image || snapshot.image || '',
        price: Number(product.price), lineTotal: Number(product.price) * item.qty,
        changed: changed, available: enough, missing: false,
        issue: !enough ? 'Stok tersedia ' + product.stock + ', sesuaikan jumlah.' : (changed ? 'Harga berubah dari ' + money(snapshot.price) + ' menjadi ' + money(product.price) + '.' : '')
      };
    });
  }

  function cartTotals(lines) {
    var available = (lines || []).filter(function (l) { return l.product && l.available; });
    return {
      items: available.reduce(function (sum, l) { return sum + l.qty; }, 0),
      total: available.reduce(function (sum, l) { return sum + l.lineTotal; }, 0),
      blocked: (lines || []).some(function (l) { return !l.available; })
    };
  }

  function placeholder(name) {
    var initial = String(name || 'M').trim().charAt(0).toUpperCase() || 'M';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450">' +
      '<rect width="600" height="450" fill="#e8f7ef"/>' +
      '<circle cx="300" cy="180" r="72" fill="#009345" opacity=".14"/>' +
      '<text x="300" y="215" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="bold" fill="#009345">' + esc(initial) + '</text>' +
      '<text x="300" y="330" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#056fb5">MERTANI</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function imageOf(product) {
    return (product && product.image) || placeholder(product && product.name);
  }

  function checkoutClientId() {
    var id = sessionStorage.getItem(CHECKOUT_KEY);
    if (!id) {
      id = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('ckt-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      sessionStorage.setItem(CHECKOUT_KEY, id);
    }
    return id;
  }

  function clearCheckoutClientId() {
    sessionStorage.removeItem(CHECKOUT_KEY);
  }

  function toast(message, variant) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (variant === 'error' ? ' error' : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function icons() {
    try { if (global.lucide) global.lucide.createIcons(); } catch (e) { /* opsional */ }
  }

  function syncHeader() {
    var count = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = String(count);
      el.classList.toggle('hide', count < 1);
    });
  }

  function footerYear() {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  function initMobileNav() {
    var btn = document.querySelector('[data-menu-btn]');
    var nav = document.querySelector('[data-mobile-nav]');
    if (!btn || !nav) return;
    btn.addEventListener('click', function () { nav.classList.toggle('hide'); });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.add('hide'); });
    });
  }

  function initShared() {
    syncHeader();
    footerYear();
    initMobileNav();
    icons();
    global.addEventListener('mertani:cart', syncHeader);
  }

  global.Mertani = {
    CART_KEY: CART_KEY,
    money: money, esc: esc, api: api,
    fetchCatalog: fetchCatalog, fetchMe: fetchMe,
    fetchPaymentMethods: fetchPaymentMethods, fetchOrders: fetchOrders, createOrder: createOrder,
    getCart: getCart, saveCart: saveCart, addToCart: addToCart, updateQty: updateQty,
    removeFromCart: removeFromCart, clearCart: clearCart, cartCount: cartCount,
    cartLines: cartLines, cartTotals: cartTotals,
    placeholder: placeholder, imageOf: imageOf,
    checkoutClientId: checkoutClientId, clearCheckoutClientId: clearCheckoutClientId,
    toast: toast, icons: icons, syncHeader: syncHeader, initShared: initShared
  };
})(window);
