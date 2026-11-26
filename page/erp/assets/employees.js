/**
 * AgriERP — klien API akun & karyawan.
 * Semua data berasal dari backend Worker (/api/*), bukan localStorage.
 */
(function () {
  'use strict';

  async function request(path, options) {
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

  window.AgriERPEmployees = {
    me: () => request('/api/auth/me'),
    list: () => request('/api/employees'),
    activity: () => request('/api/activity'),
    create: (payload) => request('/api/employees', { method: 'POST', body: payload }),
    update: (id, payload) => request('/api/employees/' + encodeURIComponent(id), { method: 'PATCH', body: payload }),
    remove: (id) => request('/api/employees/' + encodeURIComponent(id), { method: 'DELETE' }),
    logout: () => request('/api/auth/logout', { method: 'POST' })
  };
})();
