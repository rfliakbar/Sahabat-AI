/**
 * AgriSuite ERP — backend autentikasi & RBAC.
 *
 * Berjalan di Cloudflare Workers di depan static assets yang sudah ada.
 * Data akun, sesi, dan log aktivitas disimpan di SQLite-backed Durable Object
 * (bukan localStorage / data dummy).
 */

import { DurableObject } from "cloudflare:workers";

const COOKIE_NAME = "sa_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam
// Cloudflare Workers WebCrypto membatasi PBKDF2 maksimal 100.000 iterasi.
const PBKDF2_ITERATIONS = 100000;
const AUTH_OBJECT_NAME = "sahabat-ai-auth";

const ROLE_LANDING = {
  owner: "/erp/",
  cashier: "/kasir/",
  warehouse: "/gudang/",
  customer: "/toko/",
};

const ROLE_LABEL = {
  owner: "Pemilik",
  cashier: "Kasir",
  warehouse: "Gudang",
  customer: "Customer",
};

const CUSTOMER_LANDING = "/toko/";

/**
 * Katalog awal. Dipakai HANYA bila Durable Object belum punya katalog
 * (mis. sebelum halaman Gudang pernah menyimpan produk).
 */
const SEED_CATALOG = [
  { id: "PRD-1001", sku: "BNH-PADI-32", name: "Benih Padi Unggul Inpari 32 (5kg)", category: "Benih", price: 75000, unit: "karung", stock: 42, image: "https://placehold.co/600x450/278b4d/ffffff?text=Benih+Padi", active: true },
  { id: "PRD-1002", sku: "PPK-NPK-16", name: "Pupuk NPK Mutiara 16-16-16 (1kg)", category: "Pupuk", price: 22000, unit: "karung", stock: 120, image: "https://placehold.co/600x450/38ab63/ffffff?text=Pupuk+NPK", active: true },
  { id: "PRD-1003", sku: "PST-ORG-500", name: "Pestisida Nabati Neem Oil 500ml", category: "Pestisida", price: 48000, unit: "botol", stock: 35, image: "https://placehold.co/600x450/1e5835/ffffff?text=Pestisida+Nabati", active: true },
  { id: "PRD-1004", sku: "ALT-SPRY-16L", name: "Tangki Sprayer Elektrik Pertanian 16L", category: "Alat Pertanian", price: 465000, unit: "unit", stock: 8, image: "https://placehold.co/600x450/216e3f/ffffff?text=Sprayer+16L", active: true },
  { id: "PRD-1005", sku: "PPK-UREA-50", name: "Pupuk Urea Premium (50kg)", category: "Pupuk", price: 185000, unit: "karung", stock: 26, image: "https://placehold.co/600x450/5fc684/ffffff?text=Urea+50kg", active: true },
  { id: "PRD-1006", sku: "BNH-JAGUNG-1", name: "Benih Jagung Hibrida Bisi-18 (1kg)", category: "Benih", price: 62000, unit: "pak", stock: 54, image: "https://placehold.co/600x450/96deaf/0d2718?text=Jagung+Bisi-18", active: true },
  { id: "PRD-1007", sku: "PST-GLIF-1L", name: "Herbisida Glifosat 480 SL (1L)", category: "Pestisida", price: 58000, unit: "botol", stock: 61, image: "https://placehold.co/600x450/278b4d/ffffff?text=Glifosat", active: true },
  { id: "PRD-1008", sku: "ALT-CANGKUL", name: "Cangkul Baja Handle Kayu", category: "Alat Pertanian", price: 95000, unit: "unit", stock: 19, image: "https://placehold.co/600x450/1a482d/ffffff?text=Cangkul+Baja", active: true },
  { id: "PRD-1009", sku: "ALT-SELANG-50", name: "Selang Irigasi PE 1 inch (50m)", category: "Alat Pertanian", price: 210000, unit: "roll", stock: 11, image: "https://placehold.co/600x450/38ab63/ffffff?text=Selang+Irigasi", active: true },
  { id: "PRD-1010", sku: "HSL-BERAS-25", name: "Beras Premium Hasil Tani (25kg)", category: "Hasil Tani", price: 320000, unit: "karung", stock: 33, image: "https://placehold.co/600x450/f3efe6/5c4d3c?text=Beras+Premium", active: true },
  { id: "PRD-1011", sku: "PPK-KMPK-25", name: "Pupuk KCL / MOP (25kg)", category: "Pupuk", price: 145000, unit: "karung", stock: 24, image: "https://placehold.co/600x450/216e3f/ffffff?text=Pupuk+KCL", active: true },
  { id: "PRD-1012", sku: "PST-INSEK-250", name: "Insektisida Cair 250ml", category: "Pestisida", price: 39000, unit: "botol", stock: 47, image: "https://placehold.co/600x450/5fc684/0d2718?text=Insektisida", active: true },
  { id: "PRD-1013", sku: "HSL-JAGUNG-50", name: "Jagung Pipil Kering (50kg)", category: "Hasil Tani", price: 385000, unit: "karung", stock: 14, image: "https://placehold.co/600x450/f3efe6/5c4d3c?text=Jagung+Pipil", active: true },
  { id: "PRD-1014", sku: "ALT-GEMBOR", name: "Gembor Semprot 5L", category: "Alat Pertanian", price: 68000, unit: "unit", stock: 28, image: "https://placehold.co/600x450/1e5835/ffffff?text=Gembor+5L", active: true },
];

function publicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    role: "customer",
    role_label: ROLE_LABEL.customer,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
    redirect: CUSTOMER_LANDING,
  };
}

/* ------------------------------------------------------------------ */
/* Kriptografi                                                         */
/* ------------------------------------------------------------------ */

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${hash}`;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations !== 100000) return false;
  let salt;
  try {
    salt = base64ToBytes(parts[2]);
  } catch {
    return false;
  }
  const hash = await derivePassword(password, salt, iterations);
  return constantTimeEqual(hash, parts[3]);
}

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    role_label: ROLE_LABEL[row.role] || row.role,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
    redirect: ROLE_LANDING[row.role] || "/login/",
  };
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanText(value, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionCookie(token, url, maxAge = SESSION_TTL_MS / 1000) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(url) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function redirect(location) {
  return new Response(null, {
    status: 307,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/**
 * URL pendek di _redirects tetap dipetakan secara eksplisit supaya
 * pemeriksaan akses dilakukan sebelum assets diputar.
 */
const EXACT_ALIASES = {
  "/erp": "/page/erp/",
  "/kasir": "/page/kasir/",
  "/gudang": "/page/gudang/",
  "/admin": "/page/admin/",
  "/toko": "/toko/",
};

function resolveInternalPath(pathname) {
  for (const [alias, target] of Object.entries(EXACT_ALIASES)) {
    if (pathname === alias) return target;
    if (pathname.startsWith(`${alias}/`)) return target + pathname.slice(alias.length + 1);
  }
  return pathname;
}

function allowedRolesFor(pathname) {
  const isUnder = (base) => pathname === base || pathname.startsWith(`${base}/`);
  if (isUnder("/toko/login")) return null;
  if (isUnder("/toko")) return ["customer"];
  if (isUnder("/page/erp")) return ["owner"];
  if (isUnder("/page/kasir")) return ["owner", "cashier"];
  if (isUnder("/page/gudang")) return ["owner", "warehouse"];
  if (isUnder("/page/admin")) return ["owner"];
  return null;
}

/* ------------------------------------------------------------------ */
/* Durable Object — satu penyimpanan tetap untuk seluruh akun          */
/* ------------------------------------------------------------------ */

export class AuthStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('owner', 'cashier', 'warehouse')),
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT,
          actor_name TEXT,
          action TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          phone TEXT,
          password_hash TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS catalog (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS shop_orders (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          email TEXT,
          name TEXT,
          phone TEXT,
          address TEXT,
          note TEXT,
          payment TEXT,
          total INTEGER NOT NULL,
          status TEXT NOT NULL,
          items TEXT NOT NULL,
          history TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      await this.seedOwner();
    });
  }

  async seedOwner() {
    const existing = this.ctx.storage.sql
      .exec("SELECT id FROM users WHERE role = 'owner' LIMIT 1")
      .toArray();
    if (existing.length) return;

    const email = normalizeEmail(this.env.INITIAL_OWNER_EMAIL || "admin@tokotani.id");
    const password = this.env.INITIAL_OWNER_PASSWORD || "admin123";
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO users (id, name, email, password_hash, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 1, ?, ?)`,
      "usr_owner",
      cleanText(this.env.INITIAL_OWNER_NAME || "Pemilik Toko", 100),
      email,
      await hashPassword(password),
      now,
      now,
    );
  }

  async authenticate(email, password) {
    const row = this.ctx.storage.sql
      .exec("SELECT * FROM users WHERE email = ? LIMIT 1", normalizeEmail(email))
      .toArray()[0];
    if (!row || !row.active) return { ok: false, error: "Email atau password salah." };
    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) return { ok: false, error: "Email atau password salah." };
    return { ok: true, user: publicUser(row) };
  }

  async createSession(userId) {
    const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      tokenHash,
      userId,
      now,
      now + SESSION_TTL_MS,
    );
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", now);
    return token;
  }

  async getSession(token) {
    if (!token) return null;
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
         LIMIT 1`,
        tokenHash,
        now,
      )
      .toArray()[0];
    if (row) return publicUser(row);

    const customer = this.ctx.storage.sql
      .exec(
        `SELECT c.* FROM sessions s
         JOIN customers c ON c.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND c.active = 1
         LIMIT 1`,
        tokenHash,
        now,
      )
      .toArray()[0];
    return customer ? publicCustomer(customer) : null;
  }

  async destroySession(token) {
    if (!token) return;
    this.ctx.storage.sql.exec(
      "DELETE FROM sessions WHERE token_hash = ?",
      await sha256Hex(token),
    );
  }

  async listEmployees() {
    return this.ctx.storage.sql
      .exec("SELECT * FROM users WHERE role <> 'owner' ORDER BY created_at DESC")
      .toArray()
      .map(publicUser);
  }

  async findUser(id) {
    return this.ctx.storage.sql.exec("SELECT * FROM users WHERE id = ? LIMIT 1", id).toArray()[0];
  }

  async createEmployee(input) {
    const name = cleanText(input.name, 100);
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    const role = input.role;

    if (name.length < 2) return { ok: false, error: "Nama lengkap minimal 2 karakter." };
    if (!isValidEmail(email)) return { ok: false, error: "Email tidak valid." };
    if (password.length < 8) return { ok: false, error: "Password minimal 8 karakter." };
    if (role !== "cashier" && role !== "warehouse") {
      return { ok: false, error: "Role harus Kasir atau Gudang." };
    }
    if (await this.findUserByEmail(email)) {
      return { ok: false, error: "Email sudah terdaftar." };
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO users (id, name, email, password_hash, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      name,
      email,
      await hashPassword(password),
      role,
      now,
      now,
    );
    return { ok: true, user: publicUser(await this.findUser(id)) };
  }

  async findUserByEmail(email) {
    return this.ctx.storage.sql
      .exec("SELECT * FROM users WHERE email = ? LIMIT 1", normalizeEmail(email))
      .toArray()[0];
  }

  async updateEmployee(id, input) {
    const row = await this.findUser(id);
    if (!row || row.role === "owner") return { ok: false, error: "Karyawan tidak ditemukan." };

    const name = input.name === undefined ? row.name : cleanText(input.name, 100);
    const email = input.email === undefined ? row.email : normalizeEmail(input.email);
    const role = input.role === undefined ? row.role : input.role;
    const active = input.active === undefined ? row.active : input.active ? 1 : 0;

    if (name.length < 2) return { ok: false, error: "Nama lengkap minimal 2 karakter." };
    if (!isValidEmail(email)) return { ok: false, error: "Email tidak valid." };
    if (role !== "cashier" && role !== "warehouse") {
      return { ok: false, error: "Role harus Kasir atau Gudang." };
    }
    const duplicate = await this.findUserByEmail(email);
    if (duplicate && duplicate.id !== id) return { ok: false, error: "Email sudah terdaftar." };

    let passwordHash = row.password_hash;
    if (input.password !== undefined && input.password !== "") {
      if (String(input.password).length < 8) {
        return { ok: false, error: "Password minimal 8 karakter." };
      }
      passwordHash = await hashPassword(String(input.password));
    }

    this.ctx.storage.sql.exec(
      `UPDATE users SET name = ?, email = ?, role = ?, active = ?, password_hash = ?, updated_at = ?
       WHERE id = ?`,
      name,
      email,
      role,
      active,
      passwordHash,
      Date.now(),
      id,
    );
    if (!active) {
      this.ctx.storage.sql.exec("DELETE FROM sessions WHERE user_id = ?", id);
    }
    return { ok: true, user: publicUser(await this.findUser(id)) };
  }

  async deleteEmployee(id) {
    const row = await this.findUser(id);
    if (!row || row.role === "owner") return { ok: false, error: "Karyawan tidak ditemukan." };
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE user_id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM users WHERE id = ?", id);
    return { ok: true };
  }

  async log(actor, action, detail) {
    this.ctx.storage.sql.exec(
      `INSERT INTO activity_log (actor_id, actor_name, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      actor ? actor.id : null,
      actor ? actor.name : "Sistem",
      action,
      detail ? String(detail).slice(0, 300) : null,
      Date.now(),
    );
  }

  async listActivity(limit = 20) {
    return this.ctx.storage.sql
      .exec(
        "SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?",
        Math.min(Math.max(Number(limit) || 20, 1), 100),
      )
      .toArray();
  }

  /* ------------------------------------------------------------------ */
  /* Customer (Toko) — akun, katalog, dan pesanan                       */
  /* ------------------------------------------------------------------ */

  async findCustomerByEmail(email) {
    return this.ctx.storage.sql
      .exec("SELECT * FROM customers WHERE email = ? LIMIT 1", normalizeEmail(email))
      .toArray()[0];
  }

  async registerCustomer(input) {
    const name = cleanText(input.name, 100);
    const email = normalizeEmail(input.email);
    const phone = cleanText(input.phone, 30);
    const password = typeof input.password === "string" ? input.password : "";

    if (name.length < 2) return { ok: false, error: "Nama lengkap minimal 2 karakter." };
    if (!isValidEmail(email)) return { ok: false, error: "Email tidak valid." };
    if (phone.replace(/\D/g, "").length < 8) return { ok: false, error: "Nomor HP tidak valid." };
    if (password.length < 6) return { ok: false, error: "Password minimal 6 karakter." };
    if (await this.findUserByEmail(email)) {
      return { ok: false, error: "Email tersebut dipakai akun staf. Gunakan email lain." };
    }
    if (await this.findCustomerByEmail(email)) {
      return { ok: false, error: "Email sudah terdaftar. Silakan masuk." };
    }

    const id = "cus_" + crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO customers (id, name, email, phone, password_hash, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      name,
      email,
      phone,
      await hashPassword(password),
      now,
      now,
    );
    return { ok: true, customer: publicCustomer(await this.findCustomerByEmail(email)) };
  }

  async authenticateCustomer(email, password) {
    const row = await this.findCustomerByEmail(email);
    if (!row || !row.active) return { ok: false, error: "Email atau password salah." };
    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) return { ok: false, error: "Email atau password salah." };
    return { ok: true, customer: publicCustomer(row) };
  }

  async getCatalog() {
    const row = this.ctx.storage.sql
      .exec("SELECT data, updated_at FROM catalog WHERE id = 1 LIMIT 1")
      .toArray()[0];
    if (row) {
      try {
        return { products: JSON.parse(row.data), updatedAt: row.updated_at };
      } catch {
        /* data rusak -> seed ulang */
      }
    }
    const now = Date.now();
    const products = SEED_CATALOG.map((p) => ({ ...p }));
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO catalog (id, data, updated_at) VALUES (1, ?, ?)",
      JSON.stringify(products),
      now,
    );
    return { products, updatedAt: now };
  }

  async setCatalog(inputProducts) {
    if (!Array.isArray(inputProducts)) {
      return { ok: false, error: "Data katalog tidak valid." };
    }
    const products = inputProducts
      .filter((p) => p && p.id && p.name)
      .map((p) => ({
        id: String(p.id),
        sku: cleanText(p.sku, 60),
        name: cleanText(p.name, 160),
        category: cleanText(p.category || "Lainnya", 60) || "Lainnya",
        price: Math.max(0, Number(p.price) || 0),
        unit: cleanText(p.unit || "unit", 30) || "unit",
        stock: Math.max(0, Number(p.stock) || 0),
        image: typeof p.image === "string" ? p.image.slice(0, 500) : "",
        active: p.active !== false,
        updatedAt: Date.now(),
      }));
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO catalog (id, data, updated_at) VALUES (1, ?, ?)",
      JSON.stringify(products),
      Date.now(),
    );
    return { ok: true, products };
  }

  orderFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      customer: { name: row.name, email: row.email, phone: row.phone, address: row.address },
      note: row.note,
      payment: row.payment,
      total: row.total,
      status: row.status,
      items: safeJsonArray(row.items),
      history: safeJsonArray(row.history),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async nextOrderCode() {
    const d = new Date();
    const prefix = `AGS-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const row = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS n FROM shop_orders WHERE code LIKE ?", `${prefix}-%`)
      .toArray()[0];
    return `${prefix}-${String((Number(row && row.n) || 0) + 1).padStart(3, "0")}`;
  }

  async createOrder(customer, input) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) return { ok: false, error: "Keranjang kosong." };

    const { products } = await this.getCatalog();
    const lines = [];
    for (const it of items) {
      const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
      const p = products.find((x) => x.id === it.id);
      if (!p || p.active === false) return { ok: false, error: "Produk tidak tersedia: " + it.id };
      if (qty < 1) continue;
      if (p.stock < qty) return { ok: false, error: `Stok ${p.name} hanya ${p.stock}` };
      lines.push({
        id: p.id,
        name: p.name,
        price: p.price,
        qty,
        unit: p.unit,
        subtotal: p.price * qty,
      });
    }
    if (!lines.length) return { ok: false, error: "Keranjang kosong." };

    const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
    lines.forEach((l) => {
      const p = products.find((x) => x.id === l.id);
      if (p) p.stock = Math.max(0, p.stock - l.qty);
    });
    await this.setCatalog(products);

    const now = Date.now();
    const id = "ord_" + crypto.randomUUID();
    const code = await this.nextOrderCode();
    const history = [{ status: "baru", at: new Date(now).toISOString() }];
    const order = {
      id,
      code,
      customer: {
        name: cleanText(input.customer && input.customer.name, 100),
        email: normalizeEmail(customer.email),
        phone: cleanText(input.customer && input.customer.phone, 30),
        address: cleanText(input.customer && input.customer.address, 300),
      },
      note: cleanText(input.note, 300),
      payment: input.payment === "transfer" ? "transfer" : "cod",
      items: lines,
      total,
      status: "baru",
      createdAt: new Date(now).toISOString(),
      history,
    };

    this.ctx.storage.sql.exec(
      `INSERT INTO shop_orders (id, code, email, name, phone, address, note, payment, total, status, items, history, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'baru', ?, ?, ?, ?)`,
      id,
      code,
      order.customer.email,
      order.customer.name,
      order.customer.phone,
      order.customer.address,
      order.note,
      order.payment,
      total,
      JSON.stringify(lines),
      JSON.stringify(history),
      now,
      now,
    );
    return { ok: true, order };
  }

  async listOrders(customer, all = false) {
    const rows = all
      ? this.ctx.storage.sql
          .exec("SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 500")
          .toArray()
      : this.ctx.storage.sql
          .exec(
            "SELECT * FROM shop_orders WHERE email = ? OR phone = ? ORDER BY created_at DESC LIMIT 200",
            normalizeEmail(customer.email),
            String(customer.phone || ""),
          )
          .toArray();
    return rows.map((row) => this.orderFromRow(row));
  }

  async updateOrderStatus(id, status) {
    const valid = ["baru", "diproses", "dikirim", "selesai", "batal"];
    if (!valid.includes(status)) return { ok: false, error: "Status tidak valid." };
    const row = this.ctx.storage.sql
      .exec("SELECT * FROM shop_orders WHERE id = ? LIMIT 1", id)
      .toArray()[0];
    if (!row) return { ok: false, error: "Pesanan tidak ditemukan." };

    if (status === "batal" && row.status !== "batal") {
      const { products } = await this.getCatalog();
      safeJsonArray(row.items).forEach((l) => {
        const p = products.find((x) => x.id === l.id);
        if (p) p.stock += Number(l.qty) || 0;
      });
      await this.setCatalog(products);
    }

    const history = safeJsonArray(row.history);
    history.push({ status, at: new Date().toISOString() });
    this.ctx.storage.sql.exec(
      "UPDATE shop_orders SET status = ?, history = ?, updated_at = ? WHERE id = ?",
      status,
      JSON.stringify(history),
      Date.now(),
      id,
    );
    return { ok: true, order: this.orderFromRow({ ...row, status, history }) };
  }
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

function authStub(env) {
  return env.AUTH_STORE.get(env.AUTH_STORE.idFromName(AUTH_OBJECT_NAME));
}

async function currentUser(request, env) {
  const token = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (!token) return null;
  return authStub(env).getSession(token);
}

async function requireRole(request, env, roles) {
  const user = await currentUser(request, env);
  if (!user) return { user: null, response: json({ error: "Silakan login terlebih dahulu." }, 401) };
  if (!roles.includes(user.role)) {
    return { user, response: json({ error: "Akses ditolak untuk peran ini." }, 403) };
  }
  return { user, response: null };
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function originIsAllowed(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // request same-origin tanpa header Origin
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD" && !originIsAllowed(request)) {
    return json({ error: "Origin tidak diizinkan." }, 403);
  }

  const store = authStub(env);

  if (path === "/api/auth/login" && method === "POST") {
    const { email, password } = await readJson(request);
    if (!email || !password) {
      return json({ error: "Email dan password wajib diisi." }, 400);
    }
    const result = await store.authenticate(email, password);
    if (!result.ok) return json({ error: result.error }, 401);
    const token = await store.createSession(result.user.id);
    await store.log(result.user, "LOGIN", `Login sebagai ${result.user.role_label}`);
    return json(
      { user: result.user, redirect: ROLE_LANDING[result.user.role] },
      200,
      { "Set-Cookie": sessionCookie(token, url) },
    );
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
    await store.destroySession(token);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(url) });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const user = await currentUser(request, env);
    if (!user) return json({ error: "Belum login." }, 401);
    return json({ user });
  }

  /* ---------------- Customer (Toko) ---------------- */

  if (path === "/api/customer/register" && method === "POST") {
    const result = await store.registerCustomer(await readJson(request));
    if (!result.ok) return json({ error: result.error }, 400);
    const token = await store.createSession(result.customer.id);
    await store.log(result.customer, "CUSTOMER_REGISTER", result.customer.email);
    return json(
      { user: result.customer, redirect: CUSTOMER_LANDING },
      201,
      { "Set-Cookie": sessionCookie(token, url) },
    );
  }

  if (path === "/api/customer/login" && method === "POST") {
    const { email, password } = await readJson(request);
    if (!email || !password) {
      return json({ error: "Email dan password wajib diisi." }, 400);
    }
    const result = await store.authenticateCustomer(email, password);
    if (!result.ok) return json({ error: result.error }, 401);
    const token = await store.createSession(result.customer.id);
    await store.log(result.customer, "CUSTOMER_LOGIN", result.customer.email);
    return json(
      { user: result.customer, redirect: CUSTOMER_LANDING },
      200,
      { "Set-Cookie": sessionCookie(token, url) },
    );
  }

  if (path === "/api/customer/me" && method === "GET") {
    const user = await currentUser(request, env);
    if (!user || user.role !== "customer") return json({ user: null });
    return json({ user });
  }

  /* ---------------- Katalog bersama ---------------- */

  if (path === "/api/catalog" && method === "GET") {
    const { response } = await requireRole(request, env, ["customer", "owner", "cashier", "warehouse"]);
    if (response) return response;
    const catalog = await store.getCatalog();
    return json(catalog);
  }

  if (path === "/api/catalog" && method === "PUT") {
    const { user, response } = await requireRole(request, env, ["owner", "warehouse"]);
    if (response) return response;
    const body = await readJson(request);
    const result = await store.setCatalog(body.products);
    if (!result.ok) return json({ error: result.error }, 400);
    await store.log(user, "CATALOG_UPDATE", `${result.products.length} produk`);
    return json({ ok: true, products: result.products });
  }

  /* ---------------- Pesanan Toko ---------------- */

  if (path === "/api/orders" && method === "POST") {
    const { user, response } = await requireRole(request, env, ["customer"]);
    if (response) return response;
    const result = await store.createOrder(user, await readJson(request));
    if (!result.ok) return json({ error: result.error }, 400);
    await store.log(user, "ORDER_CREATE", `${result.order.code} (${result.order.total})`);
    return json({ order: result.order }, 201);
  }

  if (path === "/api/orders" && method === "GET") {
    const { user, response } = await requireRole(request, env, ["customer", "owner", "cashier"]);
    if (response) return response;
    const all = user.role !== "customer";
    return json({ orders: await store.listOrders(user, all) });
  }

  const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && method === "PATCH") {
    const { user, response } = await requireRole(request, env, ["owner", "cashier"]);
    if (response) return response;
    const body = await readJson(request);
    const result = await store.updateOrderStatus(decodeURIComponent(orderMatch[1]), body.status);
    if (!result.ok) return json({ error: result.error }, 400);
    await store.log(user, "ORDER_STATUS", `${result.order.code} -> ${body.status}`);
    return json({ order: result.order });
  }

  if (path === "/api/employees" && method === "GET") {
    const { response } = await requireRole(request, env, ["owner"]);
    if (response) return response;
    return json({ employees: await store.listEmployees() });
  }

  if (path === "/api/employees" && method === "POST") {
    const { user, response } = await requireRole(request, env, ["owner"]);
    if (response) return response;
    const result = await store.createEmployee(await readJson(request));
    if (!result.ok) return json({ error: result.error }, 400);
    await store.log(user, "EMPLOYEE_CREATE", `${result.user.name} (${result.user.role})`);
    return json({ employee: result.user }, 201);
  }

  const employeeMatch = path.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch) {
    const id = decodeURIComponent(employeeMatch[1]);
    const allowed = ["owner"];

    if (method === "PATCH") {
      const { user, response } = await requireRole(request, env, allowed);
      if (response) return response;
      const result = await store.updateEmployee(id, await readJson(request));
      if (!result.ok) return json({ error: result.error }, 400);
      await store.log(user, "EMPLOYEE_UPDATE", `${result.user.name} (${result.user.role})`);
      return json({ employee: result.user });
    }

    if (method === "DELETE") {
      const { user, response } = await requireRole(request, env, allowed);
      if (response) return response;
      const result = await store.deleteEmployee(id);
      if (!result.ok) return json({ error: result.error }, 400);
      await store.log(user, "EMPLOYEE_DELETE", id);
      return json({ ok: true });
    }
  }

  if (path === "/api/activity" && method === "GET") {
    const { response } = await requireRole(request, env, ["owner"]);
    if (response) return response;
    return json({ activity: await store.listActivity() });
  }

  return json({ error: "Endpoint tidak ditemukan." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    const internalPath = resolveInternalPath(url.pathname);

    // Modul Toko (customer) kini punya pintu masuk sendiri.
    if (
      url.pathname === "/page/customer" ||
      url.pathname.startsWith("/page/customer/") ||
      url.pathname === "/customer" ||
      url.pathname.startsWith("/customer/")
    ) {
      return redirect("/toko/");
    }

    const roles = allowedRolesFor(internalPath);
    if (roles) {
      const user = await currentUser(request, env);
      if (!user) {
        const loginPath = internalPath.startsWith("/toko") ? "/toko/login/" : "/login/";
        const next = encodeURIComponent(url.pathname + url.search);
        return redirect(`${loginPath}?next=${next}`);
      }
      if (!roles.includes(user.role)) {
        return redirect(`${ROLE_LANDING[user.role]}?error=forbidden`);
      }
    }

    // Alias persis tetap dialihkan seperti _redirects (301 aslinya).
    if (EXACT_ALIASES[url.pathname]) return redirect(EXACT_ALIASES[url.pathname]);

    // Alias dengan trailing slash / subpath: ambil asset dari path page/ yang ditunjuk.
    let assetRequest = request;
    if (internalPath !== url.pathname) {
      const assetUrl = new URL(url.toString());
      assetUrl.pathname = internalPath;
      assetRequest = new Request(assetUrl, request);
    }
    return env.ASSETS.fetch(assetRequest);
  },
};
