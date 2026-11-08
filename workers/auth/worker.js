import { registerPasswordAccount, resendPasswordVerification, verifyPasswordAccount, requestPasswordReset, resetPasswordAccount, loginPasswordAccount, requestPasswordlessLogin, verifyPasswordlessLogin } from "./password-auth.js";
/**
 * Artist Level Up V101 — Cloudflare authentication and D1 API Worker.
 *
 * Required bindings/secrets:
 *   DB: D1 database binding
 *   SESSION_PEPPER: random secret stored as a Worker secret (minimum 32 chars) *   ALLOWED_ORIGINS: comma-separated exact HTTPS origins
 *
 * Owner authentication: *   GET  /auth/session         -> validate bearer session.
 *   POST /auth/refresh         -> rotate session token.
 *   POST /auth/logout          -> revoke session family.
 *
 * There is deliberately no owner-registration/bootstrap route and no content-seeding route.
 * Data APIs are partially ported. Keep unimplemented features on their existing adapters until replacement routes are tested.
 */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "")
    .split(",").map(x => x.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  });
  if (allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(data, status, cors) {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(value);
  return match ? match[1] : null;
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

async function hashToken(token, pepper) {
  const input = new TextEncoder().encode(pepper + ":" + token);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const MAX_BODY_BYTES = 16 * 1024;

async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new Error("JSON_REQUIRED");
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  try { return JSON.parse(raw); } catch { throw new Error("INVALID_JSON"); }
}

function cleanText(value, max, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw new Error("INVALID_FIELD");
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) throw new Error("INVALID_FIELD");
  return clean || null;
}

async function profileRoute(request, env, userId) {
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT id, display_name, avatar_url, role, created_at, updated_at FROM profiles WHERE id = ? LIMIT 1"
    ).bind(userId).first();
    return json({ profile: row || null }, 200, corsHeaders(request, env));
  }
  if (request.method !== "PUT") return null;
  const body = await readJson(request);
  const displayName = cleanText(body.display_name, 80);
  const avatarUrl = cleanText(body.avatar_url, 2048);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO profiles (id, display_name, avatar_url, role, created_at, updated_at) VALUES (?, ?, ?, 'user', ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at"
  ).bind(userId, displayName, avatarUrl, now, now).run();
  const row = await env.DB.prepare(
    "SELECT id, display_name, avatar_url, role, created_at, updated_at FROM profiles WHERE id = ? LIMIT 1"
  ).bind(userId).first();
  return json({ profile: row }, 200, corsHeaders(request, env));
}

async function artistRoute(request, env, userId) {
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT id, user_id, artist_name, bio, genre, country, status, created_at, updated_at FROM artists WHERE user_id = ? LIMIT 1"
    ).bind(userId).first();
    return json({ artist: row || null }, 200, corsHeaders(request, env));
  }
  if (request.method === "PUT") {
    const body = await readJson(request);
    const artistName = cleanText(body.artist_name, 100, true);
    const bio = cleanText(body.bio, 2000);
    const genre = cleanText(body.genre, 80);
    const country = cleanText(body.country, 80);
    if (!artistName) return json({ error: "Artist name is required" }, 400, corsHeaders(request, env));
    const result = await env.DB.prepare(
      "UPDATE artists SET artist_name = ?, bio = ?, genre = ?, country = ?, updated_at = ? WHERE user_id = ? AND suspended = 0"
    ).bind(artistName, bio, genre, country, new Date().toISOString(), userId).run();
    if (!result.meta?.changes) return json({ error: "Active artist account not found" }, 404, corsHeaders(request, env));
    const row = await env.DB.prepare(
      "SELECT id, user_id, artist_name, bio, genre, country, status, created_at, updated_at FROM artists WHERE user_id = ? LIMIT 1"
    ).bind(userId).first();
    return json({ artist: row }, 200, corsHeaders(request, env));
  }
  if (request.method !== "POST") return null;
  const body = await readJson(request);
  const artistName = cleanText(body.artist_name, 100, true);
  const bio = cleanText(body.bio, 2000);
  const genre = cleanText(body.genre, 80);
  const country = cleanText(body.country, 80);
  const existing = await env.DB.prepare("SELECT id FROM artists WHERE user_id = ? LIMIT 1").bind(userId).first();
  if (existing) return json({ error: "Artist account already exists" }, 409, corsHeaders(request, env));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO artists (id, user_id, artist_name, bio, genre, country, status, created_at, updated_at, suspended) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0)"
  ).bind(id, userId, artistName, bio, genre, country, now, now).run();
  const row = await env.DB.prepare(
    "SELECT id, user_id, artist_name, bio, genre, country, status, created_at, updated_at FROM artists WHERE id = ? LIMIT 1"
  ).bind(id).first();
  return json({ artist: row }, 201, corsHeaders(request, env));
}

async function songsRoute(request, env, userId, url) {
  const cors = corsHeaders(request, env);
  const artist = await env.DB.prepare(
    "SELECT id FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1"
  ).bind(userId).first();
  if (!artist) return json({ error: "Active artist account required" }, 403, cors);

  if (url.pathname === "/api/me/songs" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, artist_id, title, genre, audio_url, cover_url, duration_seconds, status, created_at, updated_at FROM songs WHERE artist_id = ? ORDER BY created_at DESC LIMIT 100"
    ).bind(artist.id).all();
    return json({ songs: rows.results || [] }, 200, cors);
  }

  if (url.pathname === "/api/me/songs" && request.method === "POST") {
    const body = await readJson(request);
    const title = cleanText(body.title, 160, true);
    const genre = cleanText(body.genre, 80);
    const audioUrl = cleanText(body.audio_url, 2048, true);
    const coverUrl = cleanText(body.cover_url, 2048);
    if (!trustedR2ObjectUrl(audioUrl, env, artist.id, "audio")) {
      return json({ error: "AUDIO_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
    }
    if (coverUrl && !trustedR2ObjectUrl(coverUrl, env, artist.id, "thumbnails")) {
      return json({ error: "COVER_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
    }
    const duration = body.duration_seconds == null ? null : Number(body.duration_seconds);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 86400)) {
      return json({ error: "INVALID_DURATION" }, 400, cors);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO songs (id, artist_id, title, genre, audio_url, cover_url, duration_seconds, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
    ).bind(id, artist.id, title, genre, audioUrl, coverUrl, duration, now, now).run();
    const row = await env.DB.prepare(
      "SELECT id, artist_id, title, genre, audio_url, cover_url, duration_seconds, status, created_at, updated_at FROM songs WHERE id = ? AND artist_id = ? LIMIT 1"
    ).bind(id, artist.id).first();
    return json({ song: row }, 201, cors);
  }

  const match = /^\/api\/me\/songs\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (match && request.method === "PATCH") {
    const body = await readJson(request);
    const existing = await env.DB.prepare(
      "SELECT id FROM songs WHERE id = ? AND artist_id = ? LIMIT 1"
    ).bind(match[1], artist.id).first();
    if (!existing) return json({ error: "Song not found" }, 404, cors);
    const fields = [];
    const values = [];
    if (Object.hasOwn(body, "title")) { fields.push("title = ?"); values.push(cleanText(body.title, 160, true)); }
    if (Object.hasOwn(body, "genre")) { fields.push("genre = ?"); values.push(cleanText(body.genre, 80)); }
    if (Object.hasOwn(body, "audio_url")) {
      const audioUrl = cleanText(body.audio_url, 2048, true);
      if (!trustedR2ObjectUrl(audioUrl, env, artist.id, "audio")) {
        return json({ error: "AUDIO_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
      }
      fields.push("audio_url = ?"); values.push(audioUrl);
    }
    if (Object.hasOwn(body, "cover_url")) { fields.push("cover_url = ?"); values.push(cleanText(body.cover_url, 2048)); }
    if (Object.hasOwn(body, "duration_seconds")) {
      const duration = body.duration_seconds == null ? null : Number(body.duration_seconds);
      if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 86400)) {
        return json({ error: "INVALID_DURATION" }, 400, cors);
      }
      fields.push("duration_seconds = ?"); values.push(duration);
    }
    if (!fields.length) return json({ error: "No editable fields supplied" }, 400, cors);
    fields.push("updated_at = ?");
    values.push(new Date().toISOString(), match[1], artist.id);
    await env.DB.prepare(
      "UPDATE songs SET " + fields.join(", ") + " WHERE id = ? AND artist_id = ?"
    ).bind(...values).run();
    const row = await env.DB.prepare(
      "SELECT id, artist_id, title, genre, audio_url, cover_url, duration_seconds, status, created_at, updated_at FROM songs WHERE id = ? AND artist_id = ? LIMIT 1"
    ).bind(match[1], artist.id).first();
    return json({ song: row }, 200, cors);
  }
  return null;
}

async function publicVideosRoute(request, env, url) {
  if (request.method !== "GET" || url.pathname !== "/api/public/videos") return null;
  const rawLimit = Number(url.searchParams.get("limit") || 20);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) return json({ error: "Invalid limit" }, 400, corsHeaders(request, env));
  const limit = Math.min(50, rawLimit);
  const rows = await env.DB.prepare(
    "SELECT v.id, v.artist_id, a.artist_name, v.title, v.description, v.video_url, v.thumbnail_url, v.status, v.tiktok_url, v.instagram_url, v.facebook_url, v.youtube_url, v.views, v.likes, v.created_at, v.song_id, s.title AS song_title, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url, s.status AS song_status FROM artist_videos v LEFT JOIN artists a ON a.id = v.artist_id LEFT JOIN songs s ON s.id = v.song_id WHERE v.status IN ('approved', 'published') ORDER BY v.created_at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ videos: rows.results || [] }, 200, corsHeaders(request, env));
}

async function publicSongsRoute(request, env, url) {
  if (request.method !== "GET" || url.pathname !== "/api/public/songs") return null;
  const rawLimit = Number(url.searchParams.get("limit") || 20);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) return json({ error: "Invalid limit" }, 400, corsHeaders(request, env));
  const limit = Math.min(50, rawLimit);
  const rows = await env.DB.prepare(
    "SELECT s.id, s.artist_id, a.artist_name, s.title, s.genre, s.audio_url, s.cover_url, s.duration_seconds, s.status, s.created_at FROM songs s LEFT JOIN artists a ON a.id = s.artist_id WHERE s.status IN ('published', 'approved') ORDER BY s.created_at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ songs: rows.results || [] }, 200, corsHeaders(request, env));
}

async function promotionRoute(request, env, userId) {
  // Fail closed until a real advertising provider is connected, authorized,
  // and live campaign delivery has been verified. Do not create payable rows.
  if (request.method !== "POST") return null;
  return json({
    error: "ADVERTISING_NOT_AVAILABLE",
    code: "AD_PROVIDER_NOT_CONFIGURED",
    message: "Paid advertising is temporarily unavailable. No campaign payment has been taken. Please try again after advertising delivery is enabled."
  }, 503, corsHeaders(request, env));
}

async function withdrawalRoute(request, env, userId) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return null;
  const body = await readJson(request);
  const amount = Number(body.amount);
  const bankName = cleanText(body.bank_name, 120, true);
  const accountName = cleanText(body.account_name, 120, true);
  const accountNumber = cleanText(String(body.account_number ?? ""), 32, true);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    return json({ error: "INVALID_AMOUNT" }, 400, cors);
  }
  if (!/^[0-9]{6,32}$/.test(accountNumber)) {
    return json({ error: "INVALID_ACCOUNT_NUMBER" }, 400, cors);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO withdrawals (id, user_id, amount, bank_name, account_name, account_number, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
  ).bind(id, userId, amount, bankName, accountName, accountNumber, now).run();
  return json({
    withdrawal: {
      id, user_id: userId, amount, bank_name: bankName,
      account_name: accountName, account_number: accountNumber,
      status: "pending", created_at: now
    }
  }, 201, cors);
}

async function adminWithdrawalsRoute(request, env, session, url) {
  const cors = corsHeaders(request, env);
  if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, cors);
  const status = url.searchParams.get("status");
  const allowed = new Set(["pending", "approved", "rejected", "paid"]);
  if (status && !allowed.has(status)) return json({ error: "Invalid withdrawal status" }, 400, cors);
  const rawLimit = Number(url.searchParams.get("limit") || 100);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) return json({ error: "Invalid limit" }, 400, cors);
  const limit = Math.min(100, rawLimit);
  const query = status
    ? env.DB.prepare("SELECT w.id, w.user_id, p.display_name, w.amount, w.bank_name, w.account_name, w.account_number, w.status, w.created_at FROM withdrawals w LEFT JOIN profiles p ON p.id = w.user_id WHERE w.status = ? ORDER BY w.created_at DESC LIMIT ?").bind(status, limit)
    : env.DB.prepare("SELECT w.id, w.user_id, p.display_name, w.amount, w.bank_name, w.account_name, w.account_number, w.status, w.created_at FROM withdrawals w LEFT JOIN profiles p ON p.id = w.user_id ORDER BY w.created_at DESC LIMIT ?").bind(limit);
  const rows = await query.all();
  return json({ withdrawals: rows.results || [] }, 200, cors);
}

async function adminSongsRoute(request, env, session, url) {
  const cors = corsHeaders(request, env);
  if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
  if (request.method === "GET") {
    const status = url.searchParams.get("status");
    const allowed = new Set(["draft", "pending", "approved", "published", "rejected", "archived"]);
    if (status && !allowed.has(status)) return json({ error: "Invalid song status" }, 400, cors);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 100)));
    if (!Number.isInteger(limit)) return json({ error: "Invalid limit" }, 400, cors);
    const query = status
      ? env.DB.prepare("SELECT s.id, s.artist_id, a.artist_name, s.title, s.genre, s.audio_url, s.cover_url, s.duration_seconds, s.status, s.created_at, s.updated_at FROM songs s LEFT JOIN artists a ON a.id = s.artist_id WHERE s.status = ? ORDER BY s.created_at DESC LIMIT ?").bind(status, limit)
      : env.DB.prepare("SELECT s.id, s.artist_id, a.artist_name, s.title, s.genre, s.audio_url, s.cover_url, s.duration_seconds, s.status, s.created_at, s.updated_at FROM songs s LEFT JOIN artists a ON a.id = s.artist_id ORDER BY s.created_at DESC LIMIT ?").bind(limit);
    const rows = await query.all();
    return json({ songs: rows.results || [] }, 200, cors);
  }
  if (request.method === "PATCH") {
    const songId = url.pathname.slice("/api/admin/songs/".length);
    if (!/^[0-9a-f-]{36}$/i.test(songId)) return json({ error: "Invalid song ID" }, 400, cors);
    let body;
    try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
    const status = String(body?.status || "");
    if (!new Set(["approved", "published", "rejected", "archived"]).has(status)) {
      return json({ error: "Status must be approved, published, rejected, or archived" }, 400, cors);
    }
    const result = await env.DB.prepare("UPDATE songs SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), songId).run();
    if (!result.meta?.changes) return json({ error: "Song not found" }, 404, cors);
    return json({ success: true, id: songId, status }, 200, cors);
  }
  return json({ error: "Method not allowed" }, 405, cors);
}

async function adminVideosRoute(request, env, session, url) {
  const cors = corsHeaders(request, env);
  if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
  if (request.method === "GET") {
    const status = url.searchParams.get("status");
    const allowed = new Set(["pending", "approved", "published", "rejected"]);
    if (status && !allowed.has(status)) return json({ error: "Invalid video status" }, 400, cors);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 100)));
    if (!Number.isInteger(limit)) return json({ error: "Invalid limit" }, 400, cors);
    const query = status
      ? env.DB.prepare("SELECT id, artist_id, title, description, video_url, thumbnail_url, status, tiktok_url, instagram_url, facebook_url, youtube_url, views, likes, created_at FROM artist_videos WHERE status = ? ORDER BY created_at DESC LIMIT ?").bind(status, limit)
      : env.DB.prepare("SELECT id, artist_id, title, description, video_url, thumbnail_url, status, tiktok_url, instagram_url, facebook_url, youtube_url, views, likes, created_at FROM artist_videos ORDER BY created_at DESC LIMIT ?").bind(limit);
    const rows = await query.all();
    return json({ videos: rows.results || [] }, 200, cors);
  }
  const videoId = url.pathname.slice("/api/admin/videos/".length);
  if (url.pathname !== "/api/admin/videos" && !/^[0-9a-f-]{36}$/.test(videoId)) {
    return json({ error: "Invalid video ID" }, 400, cors);
  }
  if (request.method === "PATCH") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
    const status = String(body?.status || "");
    if (!new Set(["approved", "published", "rejected"]).has(status)) {
      return json({ error: "Status must be approved, published, or rejected" }, 400, cors);
    }
    const result = await env.DB.prepare("UPDATE artist_videos SET status = ? WHERE id = ?")
      .bind(status, videoId).run();
    if (!result.meta?.changes) return json({ error: "Video not found" }, 404, cors);
    return json({ success: true, id: videoId, status }, 200, cors);
  }
  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM artist_videos WHERE id = ?").bind(videoId).run();
    if (!result.meta?.changes) return json({ error: "Video not found" }, 404, cors);
    return json({ success: true, id: videoId, storageObjectRetained: true }, 200, cors);
  }
  return json({ error: "Method not allowed" }, 405, cors);
}

async function deriveAdminPinHash(pin, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations, hash: "SHA-256" },
    material, 256
  );
  return paystackHex(bits);
}

function constantTimeTextEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function memberAccountPinRoute(request, env, session) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  let body;
  try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
  const pin = String(body?.pin || "");
  if (!/^\d{4,6}$/.test(pin)) return json({ error: "PIN must contain 4–6 digits" }, 400, cors);
  const salt = paystackHex(crypto.getRandomValues(new Uint8Array(16)));
  const iterations = 210000;
  const hash = await deriveAdminPinHash(pin, salt, iterations);
  await env.DB.prepare(
    "INSERT INTO member_account_pins (user_id, pin_hash, pin_salt, pin_iterations, pin_changed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, pin_iterations = excluded.pin_iterations, pin_changed_at = excluded.pin_changed_at"
  ).bind(session.user_id, hash, salt, iterations, new Date().toISOString()).run();
  return json({ ok: true, pinConfigured: true }, 200, cors);
}

async function verifyMemberAccountPin(request, env, session) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  let body;
  try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
  const pin = String(body?.pin || "");
  if (!/^\d{4,6}$/.test(pin)) return json({ error: "Enter your 4–6 digit PIN" }, 400, cors);
  const saved = await env.DB.prepare(
    "SELECT pin_hash, pin_salt, pin_iterations FROM member_account_pins WHERE user_id = ? LIMIT 1"
  ).bind(session.user_id).first();
  if (!saved?.pin_hash || !saved?.pin_salt || !saved?.pin_iterations) {
    return json({ error: "Account PIN has not been configured", pinConfigured: false }, 409, cors);
  }
  const hash = await deriveAdminPinHash(pin, saved.pin_salt, Number(saved.pin_iterations));
  if (!constantTimeTextEqual(hash, saved.pin_hash)) return json({ error: "Incorrect PIN" }, 401, cors);
  return json({ ok: true, verified: true }, 200, cors);
}

async function adminPinRoute(request, env, session) {
  const cors = corsHeaders(request, env);
  if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
  const admin = await env.DB.prepare("SELECT pin_hash, pin_salt, pin_iterations FROM platform_admins WHERE user_id = ? AND active = 1 LIMIT 1")
    .bind(session.user_id).first();
  if (!admin) return json({ error: "Admin account not found" }, 403, cors);
  let body;
  try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
  if (request.method === "POST" && new URL(request.url).pathname === "/api/admin/pin/setup") {
    const pin = String(body?.pin || "");
    if (!/^\d{4,6}$/.test(pin)) return json({ error: "PIN must contain 4–6 digits" }, 400, cors);
    if (admin.pin_hash) return json({ error: "Admin PIN is already configured" }, 409, cors);
    const salt = paystackHex(crypto.getRandomValues(new Uint8Array(16)));
    const iterations = 210000;
    const hash = await deriveAdminPinHash(pin, salt, iterations);
    await env.DB.prepare("UPDATE platform_admins SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, pin_changed_at = ? WHERE user_id = ?")
      .bind(hash, salt, iterations, new Date().toISOString(), session.user_id).run();
    return json({ ok: true, pinConfigured: true }, 200, cors);
  }
  if (request.method === "POST" && new URL(request.url).pathname === "/api/admin/pin/verify") {
    if (!admin.pin_hash || !admin.pin_salt || !admin.pin_iterations) return json({ error: "Admin PIN has not been configured", pinConfigured: false }, 409, cors);
    const pin = String(body?.pin || "");
    if (!/^\d{4,6}$/.test(pin)) return json({ error: "Enter your 4–6 digit PIN" }, 400, cors);
    const hash = await deriveAdminPinHash(pin, admin.pin_salt, Number(admin.pin_iterations));
    if (!constantTimeTextEqual(hash, admin.pin_hash)) return json({ error: "Incorrect Admin PIN" }, 401, cors);
    return json({ ok: true, verified: true }, 200, cors);
  }
  if (request.method === "PUT" && new URL(request.url).pathname === "/api/admin/pin") {
    if (!admin.pin_hash || !admin.pin_salt || !admin.pin_iterations) return json({ error: "Admin PIN has not been configured" }, 409, cors);
    const currentPin = String(body?.currentPin || ""), newPin = String(body?.newPin || "");
    if (!/^\d{4,6}$/.test(newPin)) return json({ error: "New PIN must contain 4–6 digits" }, 400, cors);
    const currentHash = await deriveAdminPinHash(currentPin, admin.pin_salt, Number(admin.pin_iterations));
    if (!constantTimeTextEqual(currentHash, admin.pin_hash)) return json({ error: "Current PIN is incorrect" }, 401, cors);
    const salt = paystackHex(crypto.getRandomValues(new Uint8Array(16))), iterations = 210000;
    const hash = await deriveAdminPinHash(newPin, salt, iterations);
    await env.DB.prepare("UPDATE platform_admins SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, pin_changed_at = ? WHERE user_id = ?")
      .bind(hash, salt, iterations, new Date().toISOString(), session.user_id).run();
    return json({ ok: true, pinConfigured: true }, 200, cors);
  }
  return json({ error: "Method not allowed" }, 405, cors);
}

async function adminDashboardRoute(request, env, session) {
  const cors = corsHeaders(request, env);
  if (request.method !== "GET") return null;
  if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
  const [sales, beats, users, orders, recent] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_ngn ELSE 0 END), 0) AS totalSales, COALESCE(SUM(CASE WHEN status = 'paid' THEN platform_fee_ngn ELSE 0 END), 0) AS platformCommission, COALESCE(SUM(CASE WHEN status = 'paid' THEN producer_payout_ngn ELSE 0 END), 0) AS producerPayouts, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paidOrders, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingOrders, COUNT(*) AS totalOrders FROM marketplace_orders").first(),
    env.DB.prepare("SELECT COUNT(*) AS publishedBeats, COUNT(DISTINCT producer_name) AS connectedProducers FROM marketplace_beats WHERE status = 'published'").first(),
    env.DB.prepare("SELECT COUNT(*) AS totalUsers FROM app_users WHERE status = 'active'").first(),
    env.DB.prepare("SELECT COUNT(*) AS totalOrders FROM marketplace_orders").first(),
    env.DB.prepare("SELECT beat_title, producer_name, amount_ngn, platform_fee_ngn, producer_payout_ngn, paid_at, paystack_reference FROM marketplace_orders WHERE status = 'paid' ORDER BY paid_at DESC LIMIT 10").all()
  ]);
  return json({
    ok: true,
    stats: {
      totalSales: Number(sales?.totalSales || 0),
      platformCommission: Number(sales?.platformCommission || 0),
      producerPayouts: Number(sales?.producerPayouts || 0),
      paidOrders: Number(sales?.paidOrders || 0),
      pendingOrders: Number(sales?.pendingOrders || 0),
      totalOrders: Number(sales?.totalOrders || orders?.totalOrders || 0),
      publishedBeats: Number(beats?.publishedBeats || 0),
      connectedProducers: Number(beats?.connectedProducers || 0),
      totalUsers: Number(users?.totalUsers || 0)
    },
    recentSales: recent.results || []
  }, 200, cors);
}

async function adminCommissionRoute(request, env, session) {
  const cors = corsHeaders(request, env);
  if (request.method !== "GET") return null;
  if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 50)));
  if (!Number.isInteger(limit)) return json({ error: "Invalid limit" }, 400, cors);
  const rows = await env.DB.prepare(
    "SELECT id, beat_title, producer_name, amount_ngn, status, platform_fee_percent, platform_fee_ngn, producer_payout_ngn, paid_at, paystack_reference FROM marketplace_orders WHERE status = 'paid' ORDER BY paid_at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ orders: rows.results || [] }, 200, cors);
}

function paystackHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function verifyPaystackSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return paystackHex(digest) === String(signature).toLowerCase();
}

async function initializePaystack(env, { email, amountNgn, reference, metadata, returnUrl }) {
  if (!env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is not configured in the Cloudflare Worker.");
  const callback = String(returnUrl || env.APP_PUBLIC_URL || "https://artistlevelup.com.ng");
  const safeCallback = /^https:\/\/(artistlevelup\.com\.ng|www\.artistlevelup\.com\.ng)(\/|$)/i.test(callback)
    ? callback : "https://artistlevelup.com.ng";
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.PAYSTACK_SECRET_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      amount: Math.round(Number(amountNgn) * 100),
      reference,
      callback_url: safeCallback,
      metadata
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== true || !payload.data?.authorization_url) {
    throw new Error(payload.message || "Paystack could not initialize checkout.");
  }
  return payload.data;
}

async function paystackWebhookRoute(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Payment provider is not configured" }, 503);
  const raw = await request.text();
  const signature = request.headers.get("x-paystack-signature") || "";
  if (!await verifyPaystackSignature(raw, signature, env.PAYSTACK_SECRET_KEY)) {
    return json({ error: "Invalid Paystack signature" }, 401);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid webhook payload" }, 400); }
  if (event?.event !== "charge.success") return json({ received: true }, 200);
  const reference = String(event?.data?.reference || "").trim();
  if (!reference) return json({ error: "Missing payment reference" }, 400);
  const distributionPayment = await env.DB.prepare(
    "SELECT request_id, user_id, amount_ngn, currency, status FROM music_distribution_payments WHERE reference = ? LIMIT 1"
  ).bind(reference).first();
  if (distributionPayment) {
    const expected = Math.round(Number(distributionPayment.amount_ngn || 0) * 100);
    if (Number(event?.data?.amount || 0) !== expected || String(event?.data?.currency || "") !== String(distributionPayment.currency || "NGN")) {
      return json({ error: "Distribution payment amount or currency does not match" }, 400);
    }
    if (distributionPayment.status !== "paid") {
      const paidAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE music_distribution_payments SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE reference = ?").bind(paidAt, reference),
        env.DB.prepare("UPDATE music_distribution_requests SET status = 'paid', paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ? AND user_id = ? AND status = 'quoted'").bind(paidAt, paidAt, distributionPayment.request_id, distributionPayment.user_id)
      ]);
    }
    return json({ received: true, distribution_paid: true }, 200);
  }
  const payment = await env.DB.prepare(
    "SELECT id, user_id, purpose, status, amount_ngn, currency, metadata_json FROM payment_transactions WHERE reference = ? LIMIT 1"
  ).bind(reference).first();
  if (!payment) return json({ received: true, ignored: true }, 200);
  const expectedAmount = Number(payment.amount_ngn || 0) * 100;
  const eventAmount = Number(event?.data?.amount || 0);
  const eventCurrency = String(event?.data?.currency || "");
  if (eventAmount !== expectedAmount || eventCurrency !== String(payment.currency || "NGN")) {
    return json({ error: "Payment amount or currency does not match the transaction" }, 400);
  }
  if (payment.purpose === "course") {
    if (Number(payment.amount_ngn) !== 15000 || String(payment.currency) !== "NGN") {
      return json({ error: "Course payment configuration mismatch" }, 409);
    }
    const paidAt = new Date().toISOString();
    await env.DB.prepare("UPDATE payment_transactions SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE reference = ?")
      .bind(paidAt, reference).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO course_enrollments (id, user_id, course_key, payment_reference, amount_ngn, currency, status, enrolled_at) VALUES (?, ?, 'music-growth-2026', ?, 15000, 'NGN', 'active', ?)"
    ).bind(crypto.randomUUID(), payment.user_id, reference, paidAt).run();
    return json({ received: true, enrolled: true }, 200);
  }
  if (payment.status === "paid") return json({ received: true, duplicate: true }, 200);
  const paidAt = new Date().toISOString();
  await env.DB.prepare("UPDATE payment_transactions SET status = 'paid', paid_at = ? WHERE reference = ?")
    .bind(paidAt, reference).run();
  if (payment.purpose === "marketplace_beat") {
    const metadata = JSON.parse(payment.metadata_json || "{}");
    await env.DB.prepare(
      "UPDATE marketplace_orders SET status = 'paid', paid_at = ? WHERE id = ? AND paystack_reference = ?"
    ).bind(paidAt, metadata.order_id, reference).run();
  }
  return json({ received: true }, 200);
}

async function courseCheckoutRoute(request, env, userId) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return null;
  const credentials = await env.DB.prepare(
    "SELECT email_normalized, email_verified_at FROM app_credentials WHERE user_id = ? LIMIT 1"
  ).bind(userId).first();
  if (!credentials?.email_normalized || !credentials.email_verified_at) {
    return json({ error: "Verify your member email before checkout" }, 403, cors);
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM course_enrollments WHERE user_id = ? AND course_key = 'music-growth-2026' AND status = 'active' LIMIT 1"
  ).bind(userId).first();
  if (existing) return json({ ok: true, enrolled: true }, 200, cors);
  const lessonReadiness = await env.DB.prepare(
    "SELECT COUNT(*) AS published FROM course_lessons WHERE course_key = 'music-growth-2026' AND status = 'published' AND r2_object_key IS NOT NULL"
  ).first();
  if (Number(lessonReadiness?.published || 0) < 15) {
    return json({ error: "Course checkout will open after all 15 lessons are uploaded to secure course storage.", code: "COURSE_CONTENT_NOT_READY", published_lessons: Number(lessonReadiness?.published || 0) }, 409, cors);
  }
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Paystack is not configured. Course checkout is disabled." }, 503, cors);
  const body = await readJson(request);
  const reference = "ALU-COURSE-" + crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = { purpose: "artist_level_up_course", course_key: "music-growth-2026", user_id: userId };
  await env.DB.prepare(
    "INSERT INTO payment_transactions (id, reference, user_id, purpose, amount_ngn, currency, status, metadata_json, created_at) VALUES (?, ?, ?, 'course', 15000, 'NGN', 'pending', ?, ?)"
  ).bind(crypto.randomUUID(), reference, userId, JSON.stringify(metadata), now).run();
  try {
    const checkout = await initializePaystack(env, {
      email: credentials.email_normalized, amountNgn: 15000, reference, metadata,
      returnUrl: body?.return_url
    });
    return json({ ok: true, authorization_url: checkout.authorization_url, reference }, 200, cors);
  } catch (error) {
    await env.DB.prepare("UPDATE payment_transactions SET status = 'failed' WHERE reference = ?").bind(reference).run();
    return json({ error: String(error?.message || "Paystack checkout failed") }, 503, cors);
  }
}

async function courseAccessRoute(request, env, userId) {
  const cors = corsHeaders(request, env);
  if (request.method !== "GET") return null;
  const requestedReference = new URL(request.url).searchParams.get("reference");
  if (requestedReference && env.PAYSTACK_SECRET_KEY) {
    const pending = await env.DB.prepare(
      "SELECT reference, amount_ngn, currency, status FROM payment_transactions WHERE reference = ? AND user_id = ? AND purpose = 'course' LIMIT 1"
    ).bind(requestedReference, userId).first();
    if (pending && pending.status !== "paid") {
      const verifyResponse = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(requestedReference), {
        headers: { Authorization: "Bearer " + env.PAYSTACK_SECRET_KEY }
      });
      const verified = await verifyResponse.json().catch(() => ({}));
      if (verifyResponse.ok && verified.status === true && verified.data?.status === "success" &&
          Number(verified.data.amount) === 1500000 && verified.data.currency === "NGN" &&
          Number(pending.amount_ngn) === 15000 && pending.currency === "NGN") {
        const paidAt = new Date().toISOString();
        await env.DB.prepare("UPDATE payment_transactions SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE reference = ?")
          .bind(paidAt, requestedReference).run();
        await env.DB.prepare(
          "INSERT OR IGNORE INTO course_enrollments (id, user_id, course_key, payment_reference, amount_ngn, currency, status, enrolled_at) VALUES (?, ?, 'music-growth-2026', ?, 15000, 'NGN', 'active', ?)"
        ).bind(crypto.randomUUID(), userId, requestedReference, paidAt).run();
      }
    }
  }
  const enrollment = await env.DB.prepare(
    "SELECT course_key, enrolled_at FROM course_enrollments WHERE user_id = ? AND course_key = 'music-growth-2026' AND status = 'active' LIMIT 1"
  ).bind(userId).first();
  const latest = await env.DB.prepare(
    "SELECT reference, status, amount_ngn, currency FROM payment_transactions WHERE user_id = ? AND purpose = 'course' ORDER BY created_at DESC LIMIT 1"
  ).bind(userId).first();
  const lessonReadiness = await env.DB.prepare(
    "SELECT COUNT(*) AS published FROM course_lessons WHERE course_key = 'music-growth-2026' AND status = 'published' AND r2_object_key IS NOT NULL"
  ).first();
  const publishedLessons = Number(lessonReadiness?.published || 0);
  return json({ ok: true, enrolled: !!enrollment, enrollment: enrollment || null, payment: latest || null, published_lessons: publishedLessons, ready: publishedLessons >= 15 }, 200, cors);
}

async function marketplaceCheckoutRoute(request, env, userId) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return null;
  let body;
  try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
  const beatId = cleanText(body?.beat_id, 80, true);
  const license = String(body?.license || "Premium");
  if (!beatId || !new Set(["Basic", "Premium", "Exclusive"]).has(license)) {
    return json({ error: "Choose a valid beat and licence" }, 400, cors);
  }
  const beat = await env.DB.prepare(
    "SELECT id, title, producer_name, price_ngn, status, moderation_status FROM marketplace_beats WHERE id = ? LIMIT 1"
  ).bind(beatId).first();
  if (!beat || beat.status !== "published" || beat.moderation_status !== "approved") {
    return json({ error: "This beat is not available for purchase" }, 404, cors);
  }
  const credentials = await env.DB.prepare(
    "SELECT email_normalized, email_verified_at FROM app_credentials WHERE user_id = ? LIMIT 1"
  ).bind(userId).first();
  if (!credentials?.email_normalized || !credentials.email_verified_at) {
    return json({ error: "Verify your member email before checkout" }, 403, cors);
  }
  const base = Number(beat.price_ngn || 0);
  const amount = license === "Basic" ? Math.max(1000, Math.round(base * 0.72))
    : license === "Exclusive" ? Math.max(base, Math.round(base * 1.75)) : Math.round(base);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Beat price is not configured" }, 409, cors);
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Paystack is not connected yet. Checkout is safely disabled." }, 503, cors);
  const id = crypto.randomUUID();
  const reference = "ALU-" + crypto.randomUUID();
  const fee = Math.round(amount * 0.1 * 100) / 100;
  const payout = Math.round((amount - fee) * 100) / 100;
  const now = new Date().toISOString();
  const metadata = { order_id: id, beat_id: beat.id, license, purpose: "marketplace_beat" };
  await env.DB.prepare(
    "INSERT INTO marketplace_orders (id, buyer_user_id, beat_id, beat_title, producer_name, license, amount_ngn, currency, status, platform_fee_percent, platform_fee_ngn, producer_payout_ngn, paystack_reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', 'pending', 10, ?, ?, ?, ?)"
  ).bind(id, userId, beat.id, beat.title, beat.producer_name, license, amount, fee, payout, reference, now).run();
  await env.DB.prepare(
    "INSERT INTO payment_transactions (id, reference, user_id, purpose, amount_ngn, currency, status, metadata_json, created_at) VALUES (?, ?, ?, 'marketplace_beat', ?, 'NGN', 'pending', ?, ?)"
  ).bind(crypto.randomUUID(), reference, userId, amount, JSON.stringify(metadata), now).run();
  try {
    const checkout = await initializePaystack(env, {
      email: credentials.email_normalized, amountNgn: amount, reference, metadata,
      returnUrl: body?.return_url
    });
    return json({ ok: true, authorization_url: checkout.authorization_url, reference, order_id: id }, 200, cors);
  } catch (error) {
    await env.DB.prepare("UPDATE marketplace_orders SET status = 'failed' WHERE id = ?").bind(id).run();
    await env.DB.prepare("UPDATE payment_transactions SET status = 'failed' WHERE reference = ?").bind(reference).run();
    return json({ error: String(error?.message || "Paystack checkout failed") }, 503, cors);
  }
}

async function marketplaceDownloadRoute(request, env, userId, url) {
  if (request.method !== "GET") return null;
  const orderId = url.pathname.slice("/api/me/marketplace/orders/".length).replace(/\/download$/, "");
  const order = await env.DB.prepare(
    "SELECT o.id, o.status, o.beat_title, b.audio_file_url FROM marketplace_orders o LEFT JOIN marketplace_beats b ON b.id = o.beat_id WHERE o.id = ? AND o.buyer_user_id = ? LIMIT 1"
  ).bind(orderId, userId).first();
  if (!order || order.status !== "paid") return json({ error: "Paid order not found" }, 404, corsHeaders(request, env));
  if (!order.audio_file_url) return json({ error: "The producer has not uploaded the licensed audio file yet" }, 409, corsHeaders(request, env));
  return json({ ok: true, title: order.beat_title, download_url: order.audio_file_url }, 200, corsHeaders(request, env));
}

async function picturePostsRoute(request, env, userId, url, mode = "member") {
  const cors = corsHeaders(request, env);
  if (mode === "public" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT p.id, p.image_url, p.caption, p.artist_name, p.created_at, p.sound_title, p.sound_audio_url FROM picture_posts p WHERE p.status IN ('approved','published') ORDER BY p.created_at DESC LIMIT 50"
    ).all();
    return json({ pictures: rows.results || [] }, 200, cors);
  }
  if (mode === "admin") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, user_id, artist_id, image_url, caption, artist_name, status, created_at, sound_title, sound_audio_url FROM picture_posts ORDER BY created_at DESC LIMIT 100"
      ).all();
      return json({ pictures: rows.results || [] }, 200, cors);
    }
    if (request.method === "PATCH") {
      const id = url.pathname.slice("/api/admin/pictures/".length);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid picture ID" }, 400, cors);
      let body;
      try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
      const status = String(body?.status || "");
      if (!new Set(["approved", "published", "rejected", "hidden"]).has(status)) return json({ error: "Invalid picture status" }, 400, cors);
      const result = await env.DB.prepare("UPDATE picture_posts SET status = ? WHERE id = ?").bind(status, id).run();
      if (!result.meta?.changes) return json({ error: "Picture not found" }, 404, cors);
      return json({ ok: true, id, status }, 200, cors);
    }
    return null;
  }
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, image_url, caption, artist_name, status, created_at, sound_title, sound_audio_url FROM picture_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(userId).all();
    return json({ pictures: rows.results || [] }, 200, cors);
  }
  if (request.method === "POST") {
    const artist = await env.DB.prepare("SELECT id, artist_name FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1").bind(userId).first();
    if (!artist) return json({ error: "Active artist account required" }, 403, cors);
    let body;
    try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
    const imageUrl = cleanText(body?.image_url, 2048, true);
    if (!imageUrl || !trustedR2ObjectUrl(imageUrl, env, artist.id, "pictures")) return json({ error: "PICTURE_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const caption = cleanText(body?.caption, 1000);
    const soundTitle = cleanText(body?.sound_title, 160);
    const soundAudioUrl = cleanText(body?.sound_audio_url, 2048);
    await env.DB.prepare(
      "INSERT INTO picture_posts (id, user_id, artist_id, image_url, caption, artist_name, status, created_at, sound_title, sound_audio_url) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)"
    ).bind(id, userId, artist.id, imageUrl, caption, artist.artist_name, now, soundTitle, soundAudioUrl).run();
    return json({ ok: true, picture: { id, image_url: imageUrl, caption, artist_name: artist.artist_name, status: "pending", created_at: now } }, 201, cors);
  }
  return null;
}

async function marketplaceBeatsRoute(request, env, userId, url, admin = false) {
  const cors = corsHeaders(request, env);
  if (admin && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, producer_user_id, title, producer_name, genre, mood, bpm, price_ngn, default_license, audio_preview_url, audio_file_url, status, moderation_status, created_at FROM marketplace_beats ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({ beats: rows.results || [] }, 200, cors);
  }
  if (!admin && request.method === "GET" && url.pathname === "/api/me/marketplace/beats") {
    const rows = await env.DB.prepare(
      "SELECT id, title, producer_name, genre, mood, bpm, price_ngn, default_license, audio_preview_url, audio_file_url, status, moderation_status, created_at FROM marketplace_beats WHERE producer_user_id = ? ORDER BY created_at DESC LIMIT 100"
    ).bind(userId).all();
    return json({ beats: rows.results || [] }, 200, cors);
  }
  if (!admin && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, title, producer_name, genre, mood, bpm, price_ngn, default_license, audio_preview_url, created_at FROM marketplace_beats WHERE status = 'published' AND moderation_status = 'approved' ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({ beats: rows.results || [] }, 200, cors);
  }
  if (!admin && request.method === "POST" && url.pathname === "/api/me/marketplace/beats") {
    const artist = await env.DB.prepare("SELECT id, artist_name FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1").bind(userId).first();
    if (!artist) return json({ error: "Active artist account required" }, 403, cors);
    let body;
    try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
    const title = cleanText(body?.title, 120, true);
    const genre = cleanText(body?.genre, 80);
    const mood = cleanText(body?.mood, 80);
    const bpm = body?.bpm == null || body.bpm === "" ? null : Number(body.bpm);
    const price = Number(body?.price_ngn);
    const audioUrl = cleanText(body?.audio_file_url, 2048, true);
    const previewUrl = cleanText(body?.audio_preview_url || body?.audio_file_url, 2048, true);
    const license = cleanText(body?.default_license || "Premium", 24, true);
    if (!title || !audioUrl || !previewUrl || !Number.isFinite(price) || price <= 0 || (bpm != null && (!Number.isInteger(bpm) || bpm < 30 || bpm > 300))) {
      return json({ error: "Enter a title, valid price, and uploaded beat master and preview" }, 400, cors);
    }
    if (!trustedR2ObjectUrl(audioUrl, env, artist.id, "beats") || !trustedR2ObjectUrl(previewUrl, env, artist.id, "beats")) {
      return json({ error: "BEAT_AUDIO_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
    }
    if (!new Set(["Basic", "Premium", "Exclusive"]).has(license)) return json({ error: "Invalid default licence" }, 400, cors);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO marketplace_beats (id, producer_user_id, title, producer_name, genre, mood, bpm, price_ngn, default_license, audio_preview_url, audio_file_url, status, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'pending', ?)"
    ).bind(id, userId, title, artist.artist_name, genre, mood, bpm, price, license, previewUrl, audioUrl, now).run();
    return json({ ok: true, beat: { id, title, producer_name: artist.artist_name, status: "draft", moderation_status: "pending" } }, 201, cors);
  }
  if (admin && request.method === "PATCH") {
    const beatId = url.pathname.slice("/api/admin/marketplace/beats/".length);
    if (!/^[0-9a-f-]{36}$/i.test(beatId)) return json({ error: "Invalid beat ID" }, 400, cors);
    let body;
    try { body = await readJson(request); } catch { return json({ error: "Invalid JSON body" }, 400, cors); }
    const status = String(body?.status || "");
    if (!new Set(["approved", "rejected", "archived"]).has(status)) return json({ error: "Invalid moderation status" }, 400, cors);
    const published = status === "approved" ? "published" : status === "archived" ? "archived" : "draft";
    const result = await env.DB.prepare("UPDATE marketplace_beats SET moderation_status = ?, status = ? WHERE id = ?")
      .bind(status, published, beatId).run();
    if (!result.meta?.changes) return json({ error: "Beat not found" }, 404, cors);
    return json({ ok: true, id: beatId, status }, 200, cors);
  }
  return null;
}

async function marketplaceRoute(request, env, userId, url) {
  const cors = corsHeaders(request, env);
  if (url.pathname === "/api/marketplace/beats" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, title, producer_name, genre, mood, bpm, price_ngn, default_license, audio_preview_url, created_at FROM marketplace_beats WHERE status = 'published' AND moderation_status = 'approved' ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({ beats: rows.results || [] }, 200, cors);
  }
  if (url.pathname === "/api/me/marketplace/orders" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, beat_id, beat_title, producer_name, license, amount_ngn, currency, status, paystack_reference, paid_at, created_at FROM marketplace_orders WHERE buyer_user_id = ? ORDER BY created_at DESC LIMIT 100"
    ).bind(userId).all();
    return json({ orders: rows.results || [] }, 200, cors);
  }
  return null;
}


const VIDEO_SOCIAL_FIELDS = ["tiktok_url", "instagram_url", "facebook_url", "youtube_url"];

function trustedR2ObjectUrl(value, env, artistId, folder) {
  const base = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base || !/^https:\/\//i.test(base)) return false;
  let candidate, root;
  try { candidate = new URL(value); root = new URL(base); } catch { return false; }
  if (candidate.origin !== root.origin || candidate.username || candidate.password || candidate.search || candidate.hash) return false;
  const prefix = root.pathname.replace(/\/$/, "") + "/" + artistId + "/" + folder + "/";
  return candidate.pathname.startsWith(prefix) && candidate.pathname.length > prefix.length;
}

function safeSocialUrl(value) {
  if (value == null || value === "") return null;
  const clean = cleanText(value, 2048);
  try {
    const parsed = new URL(clean);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch { return null; }
}

async function myVideosRoute(request, env, userId, url) {
  const cors = corsHeaders(request, env);
  const artist = await env.DB.prepare(
    "SELECT id FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1"
  ).bind(userId).first();
  if (!artist) return json({ error: "Active artist account required" }, 403, cors);

  if (url.pathname === "/api/me/videos" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, artist_id, title, description, video_url, thumbnail_url, status, tiktok_url, instagram_url, facebook_url, youtube_url, views, likes, created_at FROM artist_videos WHERE artist_id = ? ORDER BY created_at DESC LIMIT 100"
    ).bind(artist.id).all();
    return json({ videos: rows.results || [] }, 200, cors);
  }

  if (url.pathname === "/api/me/videos" && request.method === "POST") {
    const body = await readJson(request);
    const title = cleanText(body.title, 160, true);
    const description = cleanText(body.description, 2000);
    const videoUrl = cleanText(body.video_url, 2048, true);
    if (!trustedR2ObjectUrl(videoUrl, env, artist.id, "videos")) {
      return json({ error: "VIDEO_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
    }
    const thumbnailUrl = body.thumbnail_url == null || body.thumbnail_url === ""
      ? null : cleanText(body.thumbnail_url, 2048);
    if (thumbnailUrl && !trustedR2ObjectUrl(thumbnailUrl, env, artist.id, "thumbnails")) {
      return json({ error: "THUMBNAIL_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
    }
    const socials = {};
    for (const field of VIDEO_SOCIAL_FIELDS) {
      const raw = body[field] == null ? null : cleanText(body[field], 2048);
      const parsed = raw == null ? null : safeSocialUrl(raw);
      if (raw && !parsed) return json({ error: "INVALID_SOCIAL_URL", field }, 400, cors);
      socials[field] = parsed;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO artist_videos (id, artist_id, title, description, video_url, thumbnail_url, status, tiktok_url, instagram_url, facebook_url, youtube_url, views, likes, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, 0, ?)"
    ).bind(id, artist.id, title, description, videoUrl, thumbnailUrl, socials.tiktok_url, socials.instagram_url, socials.facebook_url, socials.youtube_url, now).run();
    const video = await env.DB.prepare(
      "SELECT id, artist_id, title, description, video_url, thumbnail_url, status, tiktok_url, instagram_url, facebook_url, youtube_url, views, likes, created_at FROM artist_videos WHERE id = ? AND artist_id = ? LIMIT 1"
    ).bind(id, artist.id).first();
    return json({ video }, 201, cors);
  }

  const match = /^\/api\/me\/videos\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (!match) return null;
  const videoId = match[1];
  const existing = await env.DB.prepare(
    "SELECT id FROM artist_videos WHERE id = ? AND artist_id = ? LIMIT 1"
  ).bind(videoId, artist.id).first();
  if (!existing) return json({ error: "Video not found" }, 404, cors);

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const fields = [], values = [];
    if (Object.hasOwn(body, "title")) { fields.push("title = ?"); values.push(cleanText(body.title, 160, true)); }
    if (Object.hasOwn(body, "description")) { fields.push("description = ?"); values.push(cleanText(body.description, 2000)); }
    if (Object.hasOwn(body, "thumbnail_url")) {
      const value = body.thumbnail_url == null || body.thumbnail_url === "" ? null : cleanText(body.thumbnail_url, 2048);
      if (value && !trustedR2ObjectUrl(value, env, artist.id, "thumbnails")) {
        return json({ error: "THUMBNAIL_URL_MUST_BE_AN_OWNED_R2_UPLOAD" }, 400, cors);
      }
      fields.push("thumbnail_url = ?"); values.push(value);
    }
    for (const field of VIDEO_SOCIAL_FIELDS) {
      if (!Object.hasOwn(body, field)) continue;
      const raw = body[field] == null ? null : cleanText(body[field], 2048);
      const parsed = raw == null ? null : safeSocialUrl(raw);
      if (raw && !parsed) return json({ error: "INVALID_SOCIAL_URL", field }, 400, cors);
      fields.push(field + " = ?"); values.push(parsed);
    }
    if (!fields.length) return json({ error: "No editable fields supplied" }, 400, cors);
    values.push(videoId, artist.id);
    await env.DB.prepare(
      "UPDATE artist_videos SET " + fields.join(", ") + " WHERE id = ? AND artist_id = ?"
    ).bind(...values).run();
    const video = await env.DB.prepare(
      "SELECT id, artist_id, title, description, video_url, thumbnail_url, status, tiktok_url, instagram_url, facebook_url, youtube_url, views, likes, created_at FROM artist_videos WHERE id = ? AND artist_id = ? LIMIT 1"
    ).bind(videoId, artist.id).first();
    return json({ video }, 200, cors);
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM artist_videos WHERE id = ? AND artist_id = ?").bind(videoId, artist.id).run();
    return json({ success: true, id: videoId, record_deleted: true, media_object_deleted: false }, 200, cors);
  }
  return json({ error: "Method not allowed" }, 405, cors);
}


const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/x-m4v"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac", "audio/m4a", "audio/x-m4a"]);
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function awsPath(path) {
  return path.split("/").map(awsEncode).join("/");
}

function awsQuery(params) {
  return [...params.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    .map(([k, v]) => k + "=" + v).join("&");
}

async function hmacSha256(key, value) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
}

function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function presignR2Put(env, objectKey, contentType) {
  const account = String(env.CLOUDFLARE_ACCOUNT_ID || "");
  const accessKey = String(env.R2_ACCESS_KEY_ID || "");
  const secret = String(env.R2_SECRET_ACCESS_KEY || "");
  const bucket = String(env.R2_BUCKET || "artist-level-up-videos");
  if (!/^[a-f0-9]{32}$/i.test(account) || !accessKey || !secret || !bucket) {
    throw new Error("R2_NOT_CONFIGURED");
  }
  const host = account + ".r2.cloudflarestorage.com";
  const path = "/" + awsEncode(bucket) + "/" + awsPath(objectKey);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const scope = dateStamp + "/" + region + "/" + service + "/aws4_request";
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": accessKey + "/" + scope,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "300",
    "X-Amz-SignedHeaders": "host"
  });
  const canonicalQuery = awsQuery(params);
  const canonicalRequest = ["PUT", path, canonicalQuery, "content-type:" + contentType + "\nhost:" + host + "\n", "content-type;host", "UNSIGNED-PAYLOAD"].join("\n");
  const encoder = new TextEncoder();
  const requestHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest))));
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, requestHash].join("\n");
  const kDate = await hmacSha256(encoder.encode("AWS4" + secret), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = hex(await hmacSha256(kSigning, stringToSign));
  const uploadUrl = "https://" + host + path + "?" + canonicalQuery + "&X-Amz-Signature=" + signature;
  const publicBase = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBase || !/^https:\/\//i.test(publicBase)) throw new Error("R2_PUBLIC_URL_NOT_CONFIGURED");
  return { uploadUrl, publicUrl: publicBase + "/" + objectKey.split("/").map(awsEncode).join("/"), objectKey, contentType, expiresIn: 300 };
}

async function videoUploadIntentRoute(request, env, userId) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return null;
  const artist = await env.DB.prepare(
    "SELECT id FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1"
  ).bind(userId).first();
  if (!artist) return json({ error: "Active artist account required" }, 403, cors);
  const body = await readJson(request);
  const purpose = body.purpose == null ? "video" : cleanText(body.purpose, 16, true);
  if (!["video", "thumbnail", "audio", "beat", "picture"].includes(purpose)) return json({ error: "INVALID_PURPOSE" }, 400, cors);
  const filename = cleanText(body.filename, 180, true);
  const contentType = cleanText(body.contentType, 100, true).toLowerCase();
  const size = Number(body.size);
  const allowed = purpose === "video" ? VIDEO_TYPES : (purpose === "audio" || purpose === "beat") ? AUDIO_TYPES : IMAGE_TYPES;
  const maxBytes = purpose === "video" ? MAX_VIDEO_BYTES : (purpose === "audio" || purpose === "beat") ? MAX_AUDIO_BYTES : 10 * 1024 * 1024;
  if (!allowed.has(contentType)) return json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 415, cors);
  if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) return json({ error: "INVALID_FILE_SIZE" }, 413, cors);
  const extension = (filename.match(/\.([a-z0-9]{1,8})$/i)?.[1] || (purpose === "video" ? "mp4" : (purpose === "audio" || purpose === "beat") ? "mp3" : "jpg")).toLowerCase();
  const key = artist.id + "/" + (purpose === "video" ? "videos" : purpose === "audio" ? "audio" : purpose === "beat" ? "beats" : purpose === "picture" ? "pictures" : "thumbnails") + "/" + crypto.randomUUID() + "." + extension;
  try {
    const signed = await presignR2Put(env, key, contentType);
    return json(signed, 200, cors);
  } catch (error) {
    if (error?.message === "R2_NOT_CONFIGURED" || error?.message === "R2_PUBLIC_URL_NOT_CONFIGURED") {
      return json({ error: "R2 upload service is not configured" }, 503, cors);
    }
    throw error;
  }
}


// V101 music distribution — Cloudflare D1 + private R2.
async function presignR2Object(env, objectKey, method, contentType = "") {
  const account = String(env.CLOUDFLARE_ACCOUNT_ID || "");
  const accessKey = String(env.R2_ACCESS_KEY_ID || "");
  const secret = String(env.R2_SECRET_ACCESS_KEY || "");
  const bucket = String(env.R2_DISTRIBUTION_BUCKET || "");
  if (!/^[a-f0-9]{32}$/i.test(account) || !accessKey || !secret || !bucket) {
    throw new Error("DISTRIBUTION_R2_NOT_CONFIGURED");
  }
  const host = account + ".r2.cloudflarestorage.com";
  const path = "/" + awsEncode(bucket) + "/" + awsPath(objectKey);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\\.\\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + "/auto/s3/aws4_request";
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": accessKey + "/" + scope,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "300",
    "X-Amz-SignedHeaders": method === "PUT" ? "content-type;host" : "host"
  });
  const headers = method === "PUT" ? "content-type:" + contentType + "\\nhost:" + host + "\\n" : "host:" + host + "\\n";
  const signedHeaders = method === "PUT" ? "content-type;host" : "host";
  const canonicalRequest = [method, path, awsQuery(params), headers, signedHeaders, "UNSIGNED-PAYLOAD"].join("\\n");
  const encoder = new TextEncoder();
  const requestHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest))));
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, requestHash].join("\\n");
  const kDate = await hmacSha256(encoder.encode("AWS4" + secret), dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = hex(await hmacSha256(kSigning, stringToSign));
  return "https://" + host + path + "?" + awsQuery(params) + "&X-Amz-Signature=" + signature;
}

async function distributionObjectExists(env, key) {
  const url = await presignR2Object(env, key, "HEAD");
  const response = await fetch(url, { method: "HEAD" });
  return response.ok;
}

function parseDistributionRow(row) {
  return {
    id: row.id, artist_name: row.artist_name, release_title: row.release_title,
    release_type: row.release_type, genre: row.genre, preferred_release_date: row.preferred_release_date,
    explicit_content: row.explicit_content, notes: row.notes,
    platforms: JSON.parse(row.platforms_json || "[]"),
    audio_files: JSON.parse(row.audio_files_json || "[]"),
    artwork_key: row.artwork_key, status: row.status,
    quote_amount_minor: row.quote_amount_minor, quote_currency: row.quote_currency,
    admin_note: row.admin_note, created_at: row.created_at, updated_at: row.updated_at,
    paid_at: row.paid_at, portal_transfer_status: "not_configured"
  };
}

async function distributionUploadIntentRoute(request, env, session) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  const body = await readJson(request);
  const requestId = cleanText(body.request_id, 64, true);
  const purpose = cleanText(body.purpose, 16, true);
  const filename = cleanText(body.filename, 180, true);
  const contentType = cleanText(body.contentType, 100, true).toLowerCase();
  const size = Number(body.size);
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !["audio", "artwork"].includes(purpose)) {
    return json({ error: "INVALID_UPLOAD_REQUEST" }, 400, cors);
  }
  const owned = await env.DB.prepare(
    "SELECT id FROM music_distribution_requests WHERE id = ? AND user_id = ? AND status = 'draft' LIMIT 1"
  ).bind(requestId, session.user_id).first();
  if (!owned) return json({ error: "Distribution draft not found" }, 404, cors);
  const allowed = purpose === "audio" ? AUDIO_TYPES : IMAGE_TYPES;
  const maxBytes = purpose === "audio" ? 250 * 1024 * 1024 : 15 * 1024 * 1024;
  if (!allowed.has(contentType) || !Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
    return json({ error: "UNSUPPORTED_FILE_OR_SIZE" }, 415, cors);
  }
  const extension = (filename.match(/\\.([a-z0-9]{1,8})$/i)?.[1] || (purpose === "audio" ? "mp3" : "jpg")).toLowerCase();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const objectName = /\\.[a-z0-9]{1,8}$/i.test(safeName) ? safeName : safeName + "." + extension;
  const objectKey = session.user_id + "/" + requestId + "/" + purpose + "/" + crypto.randomUUID() + "-" + objectName;
  try {
    const uploadUrl = await presignR2Object(env, objectKey, "PUT", contentType);
    return json({ uploadUrl, objectKey, contentType, expiresIn: 300 }, 200, cors);
  } catch (error) {
    return json({ error: error?.message === "DISTRIBUTION_R2_NOT_CONFIGURED" ? "Private music distribution storage is not configured." : "Could not prepare secure upload." }, 503, cors);
  }
}

async function verifyDistributionPayment(env, userId, reference) {
  if (!env.PAYSTACK_SECRET_KEY) throw new Error("Paystack is not configured.");
  const payment = await env.DB.prepare(
    "SELECT request_id, amount_ngn, currency, status FROM music_distribution_payments WHERE reference = ? AND user_id = ? LIMIT 1"
  ).bind(reference, userId).first();
  if (!payment) throw new Error("Distribution payment reference not found.");
  if (payment.status !== "paid") {
    const response = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      headers: { Authorization: "Bearer " + env.PAYSTACK_SECRET_KEY }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== true || result.data?.status !== "success" ||
        Number(result.data?.amount) !== Math.round(Number(payment.amount_ngn) * 100) ||
        String(result.data?.currency) !== String(payment.currency)) {
      throw new Error("Paystack has not confirmed this distribution payment.");
    }
    const paidAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE music_distribution_payments SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE reference = ?").bind(paidAt, reference),
      env.DB.prepare("UPDATE music_distribution_requests SET status = 'paid', paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ? AND user_id = ? AND status = 'quoted'").bind(paidAt, paidAt, payment.request_id, userId)
    ]);
  }
  return { ok: true, paid: true, reference, request_id: payment.request_id };
}

async function musicDistributionRoute(request, env, session, url, admin = false) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  const body = await readJson(request);
  const operation = cleanText(body.operation, 32, true);
  const isAdmin = session.role === "admin";
  if (operation === "admin_list" || operation === "quote" || operation === "set_status") {
    if (!isAdmin) return json({ error: "Admin access required" }, 403, cors);
  }
  if (operation === "create_draft") {
    const artist = await env.DB.prepare(
      "SELECT id, artist_name FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1"
    ).bind(session.user_id).first();
    if (!artist) return json({ error: "Active artist account required" }, 403, cors);
    const credentials = await env.DB.prepare(
      "SELECT email_verified_at FROM app_credentials WHERE user_id = ? LIMIT 1"
    ).bind(session.user_id).first();
    if (!credentials?.email_verified_at) return json({ error: "Verify your member email before submitting a release." }, 403, cors);
    const artistName = cleanText(body.artist_name || artist.artist_name, 100, true);
    const releaseTitle = cleanText(body.release_title, 160, true);
    const releaseType = cleanText(body.release_type || "Single", 16, true);
    const genre = cleanText(body.genre || "Afrobeats", 80, true);
    if (!["Single", "EP", "Album"].includes(releaseType)) return json({ error: "Invalid release type" }, 400, cors);
    const platforms = Array.isArray(body.platforms) ? body.platforms.map(x => cleanText(x, 60, true)).filter(Boolean).slice(0, 20) : [];
    if (!platforms.length) return json({ error: "Choose at least one streaming platform." }, 400, cors);
    if (body.rights_confirmed !== true) return json({ error: "Confirm that you own or control the rights to this release." }, 400, cors);
    const now = new Date().toISOString();
    let requestId = cleanText(body.request_id, 64);
    if (requestId) {
      const existing = await env.DB.prepare(
        "SELECT id FROM music_distribution_requests WHERE id = ? AND user_id = ? AND status = 'draft' LIMIT 1"
      ).bind(requestId, session.user_id).first();
      if (!existing) requestId = null;
    }
    if (requestId) {
      await env.DB.prepare(
        "UPDATE music_distribution_requests SET artist_name = ?, release_title = ?, release_type = ?, genre = ?, preferred_release_date = ?, explicit_content = ?, notes = ?, platforms_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'draft'"
      ).bind(artistName, releaseTitle, releaseType, genre, cleanText(body.preferred_release_date, 20), cleanText(body.explicit_content || "No", 8), cleanText(body.notes, 2000), JSON.stringify(platforms), now, requestId, session.user_id).run();
    } else {
      requestId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO music_distribution_requests (id, user_id, artist_id, artist_name, release_title, release_type, genre, preferred_release_date, explicit_content, notes, platforms_json, audio_files_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'draft', ?, ?)"
      ).bind(requestId, session.user_id, artist.id, artistName, releaseTitle, releaseType, genre, cleanText(body.preferred_release_date, 20), cleanText(body.explicit_content || "No", 8), cleanText(body.notes, 2000), JSON.stringify(platforms), now, now).run();
    }
    const row = await env.DB.prepare("SELECT * FROM music_distribution_requests WHERE id = ? AND user_id = ? LIMIT 1").bind(requestId, session.user_id).first();
    return json({ ok: true, request: parseDistributionRow(row) }, 200, cors);
  }
  if (operation === "list_mine") {
    const rows = await env.DB.prepare(
      "SELECT * FROM music_distribution_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(session.user_id).all();
    return json({ ok: true, requests: (rows.results || []).map(parseDistributionRow) }, 200, cors);
  }
  if (operation === "submit") {
    const requestId = cleanText(body.request_id, 64, true);
    const row = await env.DB.prepare(
      "SELECT * FROM music_distribution_requests WHERE id = ? AND user_id = ? AND status = 'draft' LIMIT 1"
    ).bind(requestId, session.user_id).first();
    if (!row) return json({ error: "Distribution draft not found or already submitted." }, 404, cors);
    const audioFiles = Array.isArray(body.audio_files) ? body.audio_files : [];
    const artworkKey = cleanText(body.artwork_key, 512, true);
    if ((row.release_type === "Single" && audioFiles.length !== 1) ||
        (["EP", "Album"].includes(row.release_type) && audioFiles.length < 2) || audioFiles.length > 30) {
      return json({ error: "The number of audio masters does not match the selected release type." }, 400, cors);
    }
    const expectedPrefix = session.user_id + "/" + requestId + "/";
    const validAudio = audioFiles.every(f => typeof f?.path === "string" &&
      f.path.startsWith(expectedPrefix + "audio/") && Number(f.size) > 0 &&
      Number(f.size) <= 250 * 1024 * 1024 && AUDIO_TYPES.has(String(f.type || "").toLowerCase()));
    if (!validAudio || !artworkKey.startsWith(expectedPrefix + "artwork/")) {
      return json({ error: "Uploaded files do not belong to this distribution request." }, 400, cors);
    }
    try {
      const checks = await Promise.all([
        ...audioFiles.map(f => distributionObjectExists(env, f.path)),
        distributionObjectExists(env, artworkKey)
      ]);
      if (checks.some(ok => !ok)) return json({ error: "One or more uploaded files are missing from secure storage. Upload them again." }, 400, cors);
    } catch (error) {
      return json({ error: "Could not verify private R2 uploads. Please retry." }, 503, cors);
    }
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE music_distribution_requests SET audio_files_json = ?, artwork_key = ?, status = 'submitted', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'draft'"
    ).bind(JSON.stringify(audioFiles), artworkKey, now, requestId, session.user_id).run();
    const updated = await env.DB.prepare("SELECT * FROM music_distribution_requests WHERE id = ? LIMIT 1").bind(requestId).first();
    return json({ ok: true, request: parseDistributionRow(updated) }, 200, cors);
  }
  if (operation === "checkout") {
    const requestId = cleanText(body.request_id, 64, true);
    const row = await env.DB.prepare(
      "SELECT id, status, quote_amount_minor FROM music_distribution_requests WHERE id = ? AND user_id = ? LIMIT 1"
    ).bind(requestId, session.user_id).first();
    if (!row || row.status !== "quoted" || !Number.isInteger(Number(row.quote_amount_minor)) || Number(row.quote_amount_minor) < 10000) {
      return json({ error: "A valid admin quote is required before payment." }, 409, cors);
    }
    const credentials = await env.DB.prepare("SELECT email_normalized, email_verified_at FROM app_credentials WHERE user_id = ? LIMIT 1").bind(session.user_id).first();
    if (!credentials?.email_verified_at) return json({ error: "Verify your member email before payment." }, 403, cors);
    if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Paystack is not configured. Payment is disabled." }, 503, cors);
    const amountNgn = Number(row.quote_amount_minor) / 100;
    const reference = "ALU-DIST-" + crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO music_distribution_payments (id, request_id, user_id, reference, amount_ngn, currency, status, created_at) VALUES (?, ?, ?, ?, ?, 'NGN', 'pending', ?)"
    ).bind(crypto.randomUUID(), requestId, session.user_id, reference, amountNgn, now).run();
    try {
      const checkout = await initializePaystack(env, {
        email: credentials.email_normalized, amountNgn, reference,
        metadata: { purpose: "music_distribution", request_id: requestId, user_id: session.user_id },
        returnUrl: body.return_url
      });
      return json({ ok: true, authorization_url: checkout.authorization_url, reference }, 200, cors);
    } catch (error) {
      await env.DB.prepare("UPDATE music_distribution_payments SET status = 'failed' WHERE reference = ?").bind(reference).run();
      return json({ error: String(error?.message || "Paystack checkout failed") }, 503, cors);
    }
  }
  if (operation === "verify_payment") {
    try { return json(await verifyDistributionPayment(env, session.user_id, cleanText(body.reference, 120, true)), 200, cors); }
    catch (error) { return json({ error: error?.message || "Payment verification failed" }, 409, cors); }
  }
  if (operation === "admin_list") {
    const rows = await env.DB.prepare(
      "SELECT r.*, c.email_normalized AS contact_email FROM music_distribution_requests r LEFT JOIN app_credentials c ON c.user_id = r.user_id ORDER BY r.created_at DESC LIMIT 100"
    ).all();
    const requests = [];
    for (const row of rows.results || []) {
      const item = parseDistributionRow(row);
      item.contact_email = row.contact_email || "";
      item.signed_files = {};
      for (const file of item.audio_files) {
        if (file?.path) item.signed_files[file.path] = await presignR2Object(env, file.path, "GET");
      }
      if (item.artwork_key) item.signed_files[item.artwork_key] = await presignR2Object(env, item.artwork_key, "GET");
      requests.push(item);
    }
    return json({ ok: true, requests }, 200, cors);
  }
  if (operation === "quote") {
    const requestId = cleanText(body.request_id, 64, true);
    const amount = Number(body.amount_ngn);
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 10000000) return json({ error: "Enter a valid distribution fee in naira." }, 400, cors);
    const note = cleanText(body.admin_note, 2000);
    const result = await env.DB.prepare(
      "UPDATE music_distribution_requests SET status = 'quoted', quote_amount_minor = ?, quote_currency = 'NGN', admin_note = ?, updated_at = ? WHERE id = ? AND status IN ('submitted','quoted')"
    ).bind(amount * 100, note, new Date().toISOString(), requestId).run();
    if (!result.meta?.changes) return json({ error: "Submitted distribution request not found." }, 404, cors);
    return json({ ok: true, id: requestId, status: "quoted" }, 200, cors);
  }
  if (operation === "set_status") {
    const requestId = cleanText(body.request_id, 64, true);
    const status = cleanText(body.status, 20, true);
    if (!["in_review", "approved", "rejected"].includes(status)) return json({ error: "Invalid distribution review status." }, 400, cors);
    const result = await env.DB.prepare(
      "UPDATE music_distribution_requests SET status = ?, admin_note = ?, updated_at = ? WHERE id = ? AND status IN ('paid','in_review')"
    ).bind(status, cleanText(body.admin_note, 2000), new Date().toISOString(), requestId).run();
    if (!result.meta?.changes) return json({ error: "Paid distribution request not found." }, 404, cors);
    return json({ ok: true, id: requestId, status }, 200, cors);
  }
  return json({ error: "Unknown music distribution operation." }, 400, cors);
}

async function revokeSessionFamily(env, familyId, now) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE app_session_families SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL"
    ).bind(now, familyId),
    env.DB.prepare(
      "UPDATE app_sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL"
    ).bind(now, familyId)
  ]);
}

async function refreshSession(request, env) {
  const cors = corsHeaders(request, env);
  const oldToken = bearer(request);
  if (!oldToken) return json({ error: "Bearer session required" }, 401, cors);

  const now = Math.floor(Date.now() / 1000);
  const oldHash = await hashToken(oldToken, env.SESSION_PEPPER);
  const newSessionToken = await newToken();
  const newHash = await hashToken(newSessionToken, env.SESSION_PEPPER);
  const expiresAt = now + SESSION_TTL_SECONDS;

  // Rotation is atomic and stays inside the original family. Only one
  // concurrent refresh can consume a given live token.
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_sessions (token_hash, user_id, family_id, created_at, expires_at, revoked_at) SELECT ?, s.user_id, s.family_id, ?, ?, NULL FROM app_sessions s JOIN app_users u ON u.user_id = s.user_id JOIN app_session_families f ON f.family_id = s.family_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active' AND f.revoked_at IS NULL"
    ).bind(newHash, now, expiresAt, oldHash, now),
    env.DB.prepare(
      "UPDATE app_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
    ).bind(now, oldHash, now)
  ]);

  if (!results?.[0]?.meta || results[0].meta.changes !== 1) {
    // A previously consumed token is evidence of replay. Revoke every token
    // in that family, including the token most recently issued by refresh.
    const previous = await env.DB.prepare(
      "SELECT family_id, revoked_at FROM app_sessions WHERE token_hash = ? LIMIT 1"
    ).bind(oldHash).first();
    if (previous?.family_id && previous.revoked_at !== null) {
      await revokeSessionFamily(env, previous.family_id, now);
    }
    return json({ error: "Invalid or expired session" }, 401, cors);
  }
  return json({ token: newSessionToken, expiresAt }, 200, cors);
}

async function createUserSession(env, userId) {
  const token = await newToken();
  const tokenHash = await hashToken(token, env.SESSION_PEPPER);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  const familyId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_session_families (family_id, user_id, created_at, revoked_at) VALUES (?, ?, ?, NULL)"
    ).bind(familyId, userId, now),
    env.DB.prepare(
      "INSERT INTO app_sessions (token_hash, user_id, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
    ).bind(tokenHash, userId, familyId, now, expiresAt)
  ]);
  return { userId, token, expiresAt };
}


function validConfig(env) {
  return Boolean(env.DB && env.SESSION_PEPPER && String(env.SESSION_PEPPER).length >= 32);
}

async function createAnonymous(env) {
  const userId = crypto.randomUUID();
  const token = await newToken();
  const tokenHash = await hashToken(token, env.SESSION_PEPPER);
  const now = Math.floor(Date.now() / 1000);
  const expires = now + SESSION_TTL_SECONDS;

  const familyId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_users (user_id, is_anonymous, status, created_at, updated_at) VALUES (?, 1, 'active', ?, ?)"
    ).bind(userId, now, now),
    env.DB.prepare(
      "INSERT INTO app_session_families (family_id, user_id, created_at, revoked_at) VALUES (?, ?, ?, NULL)"
    ).bind(familyId, userId, now),
    env.DB.prepare(
      "INSERT INTO app_sessions (token_hash, user_id, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
    ).bind(tokenHash, userId, familyId, now, expires)
  ]);

  return { userId, token, expiresAt: expires };
}

async function validateSession(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await hashToken(token, env.SESSION_PEPPER);
  const now = Math.floor(Date.now() / 1000);
  // Sliding one-year session: members who keep using the website stay signed in.
  // Explicit logout still revokes the complete session family immediately.
  await env.DB.prepare(
    "UPDATE app_sessions SET expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
  ).bind(now + SESSION_TTL_SECONDS, tokenHash, now).run();
  const row = await env.DB.prepare(
    "SELECT s.user_id, s.expires_at, c.email_normalized, c.email_verified_at, CASE WHEN EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = s.user_id AND pa.active = 1) THEN 'admin' ELSE 'user' END AS role FROM app_sessions s JOIN app_users u ON u.user_id = s.user_id JOIN app_session_families f ON f.family_id = s.family_id LEFT JOIN app_credentials c ON c.user_id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active' AND f.revoked_at IS NULL LIMIT 1"
  ).bind(tokenHash, now).first();
  if (!row) return null;
  const configuredOwner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (configuredOwner && row.email_verified_at && String(row.email_normalized || '').toLowerCase() === configuredOwner && row.role !== 'admin') {
    await env.DB.prepare(
      "INSERT INTO platform_admins (user_id, active, created_at, created_by) VALUES (?, 1, ?, ?) ON CONFLICT(user_id) DO UPDATE SET active = 1"
    ).bind(row.user_id, new Date().toISOString(), row.user_id).run();
    row.role = 'admin';
  }
  return row;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).has(origin)) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }
    if (request.method === "OPTIONS") {
      if (origin && !allowedOrigins(env).has(origin)) {
        return json({ error: "Origin not allowed" }, 403, cors);
      }
      return new Response(null, { status: 204, headers: cors });
    }
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "artist-level-up-v101", status: "online" }, 200, cors);
    }
    if (url.pathname === "/api/payments/health" && request.method === "GET") {
      return json({ paystack_configured: !!env.PAYSTACK_SECRET_KEY }, 200, cors);
    }
    if (url.pathname === "/api/payments/paystack/webhook") {
      return await paystackWebhookRoute(request, env);
    }
    if (!validConfig(env)) {
      return json({ error: "Authentication service is not configured" }, 503, cors);
    }

    try {
      if (url.pathname === "/auth/register" && request.method === "POST") {
        return await registerPasswordAccount(request, env, cors);
      }
      if (url.pathname === "/auth/resend-verification" && request.method === "POST") {
        return await resendPasswordVerification(request, env, cors);
      }
      if (url.pathname === "/auth/verify-email" && request.method === "POST") {
        return await verifyPasswordAccount(request, env, cors);
      }
      if (url.pathname === "/auth/password-reset/request" && request.method === "POST") {
        return await requestPasswordReset(request, env, cors);
      }
      if (url.pathname === "/auth/password-reset" && request.method === "POST") {
        return await resetPasswordAccount(request, env, cors);
      }
      if (url.pathname === "/auth/request-login-link" && request.method === "POST") {
        return await requestPasswordlessLogin(request, env, cors);
      }
      if (url.pathname === "/auth/verify-login-link" && request.method === "POST") {
        return await verifyPasswordlessLogin(request, env, cors, createUserSession);
      }
      if (url.pathname === "/auth/login" && request.method === "POST") {
        return await loginPasswordAccount(request, env, cors, createUserSession);
      }
      if (url.pathname === "/api/marketplace/beats") {
        const result = await marketplaceRoute(request, env, null, url);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/admin/songs" || url.pathname.startsWith("/api/admin/songs/")) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await adminSongsRoute(request, env, session, url);
        if (result) return result;
      }

      if (url.pathname === "/api/admin/videos" || url.pathname.startsWith("/api/admin/videos/")) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await adminVideosRoute(request, env, session, url);
        if (result) return result;
      }

      if (url.pathname === "/api/admin/withdrawals") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await adminWithdrawalsRoute(request, env, session, url);
      }

      if (url.pathname === "/api/admin/marketplace/commissions") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await adminCommissionRoute(request, env, session);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }
      if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await adminDashboardRoute(request, env, session);
        if (result) return result;
      }
      if (url.pathname === "/api/admin/marketplace/beats" || /^\/api\/admin\/marketplace\/beats\/[0-9a-f-]{36}$/i.test(url.pathname)) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
        const result = await marketplaceBeatsRoute(request, env, session.user_id, url, true, session.role);
        if (result) return result;
      }
      if (url.pathname === "/api/admin/pictures" || /^\/api\/admin\/pictures\/[0-9a-f-]{36}$/i.test(url.pathname)) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
        const result = await picturePostsRoute(request, env, session.user_id, url, "admin");
        if (result) return result;
      }

      if (url.pathname === "/api/me/pin" || url.pathname === "/api/me/pin/verify") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        if (url.pathname === "/api/me/pin/verify") return await verifyMemberAccountPin(request, env, session);
        return await memberAccountPinRoute(request, env, session);
      }

      if (url.pathname === "/api/me/pictures") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await picturePostsRoute(request, env, session.user_id, url, "member");
        if (result) return result;
      }

      if (url.pathname === "/api/public/pictures" && request.method === "GET") {
        return await picturePostsRoute(request, env, null, url, "public");
      }

      if (url.pathname === "/api/marketplace/beats" && request.method === "GET") {
        const result = await marketplaceRoute(request, env, null, url);
        if (result) return result;
      }
      if (url.pathname === "/api/public/marketplace/beats" && request.method === "GET") {
        const result = await marketplaceBeatsRoute(request, env, null, url, false);
        if (result) return result;
      }

      if (url.pathname === "/api/me/course/checkout") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await courseCheckoutRoute(request, env, session.user_id);
      }
      if (url.pathname === "/api/me/course/access" && request.method === "GET") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await courseAccessRoute(request, env, session.user_id);
      }

      if (url.pathname === "/api/me/marketplace/checkout") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await marketplaceCheckoutRoute(request, env, session.user_id);
      }
      if (url.pathname === "/api/me/marketplace/beats") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await marketplaceBeatsRoute(request, env, session.user_id, url, false);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/marketplace/orders" || /^\/api\/me\/marketplace\/orders\/[0-9a-f-]{36}\/download$/i.test(url.pathname)) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        if (url.pathname.includes("/download")) {
          const result = await marketplaceDownloadRoute(request, env, session.user_id, url);
          if (result) return result;
        }
        const result = await marketplaceRoute(request, env, session.user_id, url);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/videos" || /^\/api\/me\/videos\/[0-9a-f-]{36}$/i.test(url.pathname)) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await myVideosRoute(request, env, session.user_id, url);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/videos/upload-intent") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await videoUploadIntentRoute(request, env, session.user_id);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/withdrawals") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await withdrawalRoute(request, env, session.user_id);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/distribution/upload-intent") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await distributionUploadIntentRoute(request, env, session);
      }
      if (url.pathname === "/api/me/distribution") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await musicDistributionRoute(request, env, session, url, false);
      }
      if (url.pathname === "/api/admin/distribution") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        if (session.role !== "admin") return json({ error: "Admin access required" }, 403, cors);
        return await musicDistributionRoute(request, env, session, url, true);
      }

      if (url.pathname === "/api/me/promotions") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await promotionRoute(request, env, session.user_id);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname.startsWith("/api/public/videos")) {
        const result = await publicVideosRoute(request, env, url);
        if (result) return result;
      }

      if (url.pathname.startsWith("/api/public/songs")) {
        const result = await publicSongsRoute(request, env, url);
        if (result) return result;
      }

      if (url.pathname === "/api/me/songs" || url.pathname.startsWith("/api/me/songs/")) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await songsRoute(request, env, session.user_id, url);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/profile" || url.pathname === "/api/me/artist") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = url.pathname.endsWith("/profile")
          ? await profileRoute(request, env, session.user_id)
          : await artistRoute(request, env, session.user_id);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/auth/refresh" && request.method === "POST") {
        return await refreshSession(request, env);
      }

      if (url.pathname === "/auth/anonymous" && request.method === "POST") {
        const session = await createAnonymous(env);
        return json(session, 201, cors);
      }

      if (url.pathname === "/auth/session" && request.method === "GET") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return json({ userId: session.user_id, expiresAt: session.expires_at, role: session.role }, 200, cors);
      }
      if (url.pathname === "/api/admin/session" && request.method === "GET") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return json({ ok: true, isAdmin: session.role === "admin", role: session.role }, 200, cors);
      }
      if (["/api/admin/pin/setup", "/api/admin/pin/verify", "/api/admin/pin"].includes(url.pathname)) {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return await adminPinRoute(request, env, session);
      }

      if (url.pathname === "/auth/logout" && request.method === "POST") {
        const token = bearer(request);
        if (!token) return json({ error: "Bearer session required" }, 401, cors);
        const tokenHash = await hashToken(token, env.SESSION_PEPPER);
        const now = Math.floor(Date.now() / 1000);
        const current = await env.DB.prepare(
          "SELECT family_id FROM app_sessions WHERE token_hash = ? LIMIT 1"
        ).bind(tokenHash).first();
        if (current?.family_id) await revokeSessionFamily(env, current.family_id, now);
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      if (["JSON_REQUIRED", "BODY_TOO_LARGE", "INVALID_JSON", "INVALID_FIELD"].includes(error?.message)) {
        const status = error.message === "BODY_TOO_LARGE" ? 413 : 400;
        return json({ error: error.message }, status, cors);
      }
      // Keep internal SQL/errors out of the response.
      console.error("V101 auth Worker error", error);
      return json({ error: "Authentication request failed" }, 500, cors);
    }
  }
};
