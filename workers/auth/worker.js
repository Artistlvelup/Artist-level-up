/**
 * Artist Level Up V101 — isolated anonymous auth Worker prototype.
 *
 * Required bindings/secrets:
 *   DB: D1 database binding
 *   SESSION_PEPPER: random secret stored as a Worker secret (never in source)
 *   ALLOWED_ORIGINS: comma-separated exact HTTPS origins
 *
 * Routes:
 *   POST /auth/anonymous  -> create anonymous identity + opaque session
 *   GET  /auth/session   -> validate bearer session
 *   POST /auth/logout    -> revoke bearer session
 *   GET/PUT /api/me/profile -> read/update the signed-in profile
 *   GET/POST /api/me/artist -> read/create the signed-in artist account
 *
 * This is not yet wired into V101. Add rate limiting and production origin
 * configuration before deployment. Do not expose D1 or service credentials
 * to browser code.
 */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "")
    .split(",").map(x => x.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    "INSERT INTO profiles (id, display_name, avatar_url, role, created_at, updated_at) VALUES (?, ?, ?, 'artist', ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at"
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
    const coverUrl = cleanText(body.cover_url, 2048);
    const duration = body.duration_seconds == null ? null : Number(body.duration_seconds);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 86400)) {
      return json({ error: "INVALID_DURATION" }, 400, cors);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO songs (id, artist_id, title, genre, cover_url, duration_seconds, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)"
    ).bind(id, artist.id, title, genre, coverUrl, duration, now, now).run();
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

async function publicSongsRoute(request, env, url) {
  if (request.method !== "GET" || url.pathname !== "/api/public/songs") return null;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  if (!Number.isInteger(limit)) return json({ error: "Invalid limit" }, 400, corsHeaders(request, env));
  const rows = await env.DB.prepare(
    "SELECT id, artist_id, title, genre, audio_url, cover_url, duration_seconds, created_at FROM songs WHERE status IN ('published', 'approved') ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ songs: rows.results || [] }, 200, corsHeaders(request, env));
}

async function promotionRoute(request, env, userId) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return null;
  const artist = await env.DB.prepare(
    "SELECT id FROM artists WHERE user_id = ? AND suspended = 0 LIMIT 1"
  ).bind(userId).first();
  if (!artist) return json({ error: "Active artist account required" }, 403, cors);
  const body = await readJson(request);
  const title = cleanText(body.title, 120, true);
  const description = cleanText(body.description, 2000);
  const targetType = body.target_type == null ? "music" : cleanText(body.target_type, 20, true);
  if (!["music", "video"].includes(targetType)) return json({ error: "INVALID_TARGET_TYPE" }, 400, cors);
  const budget = Number(body.budget);
  if (!Number.isFinite(budget) || budget < 0 || budget > 100000000) {
    return json({ error: "INVALID_BUDGET" }, 400, cors);
  }
  const startsAt = cleanText(body.starts_at, 40);
  const endsAt = cleanText(body.ends_at, 40);
  if (startsAt && Number.isNaN(Date.parse(startsAt))) return json({ error: "INVALID_START_DATE" }, 400, cors);
  if (endsAt && Number.isNaN(Date.parse(endsAt))) return json({ error: "INVALID_END_DATE" }, 400, cors);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return json({ error: "INVALID_DATE_RANGE" }, 400, cors);
  }
  const videoId = body.video_id == null ? null : cleanText(body.video_id, 36);
  if (targetType === "video" && !videoId) return json({ error: "VIDEO_REQUIRED" }, 400, cors);
  if (videoId) {
    const video = await env.DB.prepare(
      "SELECT id FROM artist_videos WHERE id = ? AND artist_id = ? LIMIT 1"
    ).bind(videoId, artist.id).first();
    if (!video) return json({ error: "Video not found" }, 404, cors);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO promotions (id, artist_id, title, description, budget, status, starts_at, ends_at, created_at, target_type, video_id) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)"
  ).bind(id, artist.id, title, description, budget, startsAt, endsAt, new Date().toISOString(), targetType, videoId).run();
  return json({ promotion: { id, artist_id: artist.id, title, description, budget, status: "pending", starts_at: startsAt, ends_at: endsAt, target_type: targetType, video_id: videoId } }, 201, cors);
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

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_users (user_id, is_anonymous, status, created_at, updated_at) VALUES (?, 1, 'active', ?, ?)"
    ).bind(userId, now, now),
    env.DB.prepare(
      "INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)"
    ).bind(tokenHash, userId, now, expires)
  ]);

  return { userId, token, expiresAt: expires };
}

async function validateSession(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await hashToken(token, env.SESSION_PEPPER);
  const row = await env.DB.prepare(
    "SELECT s.user_id, s.expires_at FROM app_sessions s JOIN app_users u ON u.user_id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active' LIMIT 1"
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return row || null;
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
    if (!validConfig(env)) {
      return json({ error: "Authentication service is not configured" }, 503, cors);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/me/promotions") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await promotionRoute(request, env, session.user_id);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
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

      if (url.pathname === "/auth/anonymous" && request.method === "POST") {
        const session = await createAnonymous(env);
        return json(session, 201, cors);
      }

      if (url.pathname === "/auth/session" && request.method === "GET") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        return json({ userId: session.user_id, expiresAt: session.expires_at }, 200, cors);
      }

      if (url.pathname === "/auth/logout" && request.method === "POST") {
        const token = bearer(request);
        if (!token) return json({ error: "Bearer session required" }, 401, cors);
        const tokenHash = await hashToken(token, env.SESSION_PEPPER);
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
          "UPDATE app_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
        ).bind(now, tokenHash).run();
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
