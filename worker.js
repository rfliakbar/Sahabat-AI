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
};

const ROLE_LABEL = {
  owner: "Pemilik",
  cashier: "Kasir",
  warehouse: "Gudang",
};

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
    return row ? publicUser(row) : null;
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
    const roles = allowedRolesFor(internalPath);
    if (roles) {
      const user = await currentUser(request, env);
      if (!user) {
        const next = encodeURIComponent(url.pathname + url.search);
        return redirect(`/login/?next=${next}`);
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
