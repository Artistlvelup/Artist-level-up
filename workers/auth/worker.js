/**
 * Artist Level Up V101 — isolated anonymous auth Worker prototype.
 *
 * Required bindings/secrets:
 *   DB: D1 database binding
 *   SESSION_PEPPER: random secret stored as a Worker secret (never in source)
 *   ALLOWED_ORIGINS: comma-separated exact HTTPS origins
 *
 * Routes:
 *   POST /auth/bridge/supabase -> validate current Supabase session and preserve its UUID
 *   POST /auth/anonymous  -> create anonymous identity + opaque session (prototype only)
 *   GET  /auth/session   -> validate bearer session
 *   POST /auth/logout    -> revoke bearer session
 *
 * Bridge configuration: SUPABASE_URL and SUPABASE_ANON_KEY are Worker vars.
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

async function marketplaceRoute(request, env, userId, url) {
  const cors = corsHeaders(request, env);
  if (url.pathname === "/api/marketplace/beats" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, title, producer_name, genre, mood, bpm, price_ngn, default_license, audio_preview_url, created_at FROM marketplace_beats WHERE status = 'published' ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({ beats: rows.results || [] }, 200, cors);
  }
  if (url.pathname === "/api/me/marketplace/orders" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, beat_id, beat_title, producer_name, license, amount_ngn, currency, status, paid_at, created_at FROM marketplace_orders WHERE buyer_user_id = ? ORDER BY created_at DESC LIMIT 100"
    ).bind(userId).all();
    return json({ orders: rows.results || [] }, 200, cors);
  }
  return null;
}


const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/x-m4v"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  if (!["video", "thumbnail"].includes(purpose)) return json({ error: "INVALID_PURPOSE" }, 400, cors);
  const filename = cleanText(body.filename, 180, true);
  const contentType = cleanText(body.contentType, 100, true).toLowerCase();
  const size = Number(body.size);
  const allowed = purpose === "video" ? VIDEO_TYPES : IMAGE_TYPES;
  const maxBytes = purpose === "video" ? MAX_VIDEO_BYTES : 10 * 1024 * 1024;
  if (!allowed.has(contentType)) return json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 415, cors);
  if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) return json({ error: "INVALID_FILE_SIZE" }, 413, cors);
  const extension = (filename.match(/\.([a-z0-9]{1,8})$/i)?.[1] || (purpose === "video" ? "mp4" : "jpg")).toLowerCase();
  const key = artist.id + "/" + (purpose === "video" ? "videos" : "thumbnails") + "/" + crypto.randomUUID() + "." + extension;
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

async function bridgeSupabaseSession(request, env) {
  const cors = corsHeaders(request, env);
  const body = await readJson(request);
  const accessToken = cleanText(body.access_token, 8192, true);
  if (!accessToken || accessToken.length < 20) {
    return json({ error: "INVALID_SUPABASE_TOKEN" }, 400, cors);
  }

  let base;
  try {
    base = new URL(String(env.SUPABASE_URL || ""));
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
      throw new Error("INVALID_SUPABASE_URL");
    }
  } catch {
    return json({ error: "SUPABASE_AUTH_NOT_CONFIGURED" }, 503, cors);
  }
  const anonKey = String(env.SUPABASE_ANON_KEY || "");
  if (!anonKey) return json({ error: "SUPABASE_AUTH_NOT_CONFIGURED" }, 503, cors);

  // Ask Supabase Auth to validate the access token. Never trust a decoded JWT
  // or a user ID supplied by the browser.
  let authResponse;
  try {
    authResponse = await fetch(new URL("/auth/v1/user", base.origin), {
      method: "GET",
      headers: {
        "apikey": anonKey,
        "Authorization": "Bearer " + accessToken,
        "Accept": "application/json"
      }
    });
  } catch {
    return json({ error: "SUPABASE_AUTH_UNAVAILABLE" }, 503, cors);
  }
  if (!authResponse.ok) return json({ error: "INVALID_SUPABASE_SESSION" }, 401, cors);

  let supabaseUser;
  try { supabaseUser = await authResponse.json(); } catch {
    return json({ error: "INVALID_SUPABASE_RESPONSE" }, 502, cors);
  }
  const userId = typeof supabaseUser?.id === "string" ? supabaseUser.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return json({ error: "INVALID_SUPABASE_RESPONSE" }, 502, cors);
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    "SELECT status, is_anonymous FROM app_users WHERE user_id = ? LIMIT 1"
  ).bind(userId).first();

  // This bridge is for identities explicitly imported during the V101 cutover.
  // Never auto-provision a D1 identity merely because an arbitrary Supabase
  // account presents a valid token. New-user onboarding is a separate flow.
  if (!existing) {
    return json({ error: "ACCOUNT_NOT_MIGRATED" }, 403, cors);
  }
  if (existing.status !== "active") {
    return json({ error: "ACCOUNT_DISABLED" }, 403, cors);
  }
  if (existing.is_anonymous !== (supabaseUser.is_anonymous === true ? 1 : 0)) {
    return json({ error: "ACCOUNT_IDENTITY_MISMATCH" }, 403, cors);
  }

  const token = await newToken();
  const tokenHash = await hashToken(token, env.SESSION_PEPPER);
  const familyId = crypto.randomUUID();
  const expiresAt = now + SESSION_TTL_SECONDS;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_session_families (family_id, user_id, created_at, revoked_at) VALUES (?, ?, ?, NULL)"
    ).bind(familyId, userId, now),
    env.DB.prepare(
      "INSERT INTO app_sessions (token_hash, user_id, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
    ).bind(tokenHash, userId, familyId, now, expiresAt)
  ]);

  return json({ userId, token, expiresAt }, 201, cors);
}


const PASSWORD_ITERATIONS = 310000;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 5;

function constantTimeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i % (left.length || 1)) || 0) ^
      (right.charCodeAt(i % (right.length || 1)) || 0);
  }
  return diff === 0;
}

function validEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function derivePasswordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256",
    salt: Uint8Array.from(atob(salt.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((salt.length + 3) % 4)), c => c.charCodeAt(0)),
    iterations
  }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function createPasswordSalt() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
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

async function registerFirstAdmin(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  if (!env.BOOTSTRAP_SECRET || String(env.BOOTSTRAP_SECRET).length < 32) {
    return json({ error: "OWNER_SETUP_NOT_CONFIGURED" }, 503, cors);
  }
  const body = await readJson(request);
  const email = validEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = cleanText(body.display_name, 80, true);
  const bootstrapSecret = typeof body.bootstrap_secret === "string" ? body.bootstrap_secret : "";
  if (!email || password.length < 12 || password.length > 128 || !displayName) {
    return json({ error: "Enter a valid email, display name and password of at least 12 characters." }, 400, cors);
  }
  if (!constantTimeEqual(bootstrapSecret, env.BOOTSTRAP_SECRET)) {
    return json({ error: "Owner setup key is invalid." }, 403, cors);
  }

  const salt = await createPasswordSalt();
  const passwordHash = await derivePasswordHash(password, salt);
  const userId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const isoNow = new Date().toISOString();
  const familyId = crypto.randomUUID();

  // D1 batch is transactional. Conditional inserts make the bootstrap one-time,
  // even if two setup requests arrive together.
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_users (user_id, is_anonymous, status, created_at, updated_at, email, password_hash, password_salt, password_iterations, role) SELECT ?, 0, 'active', ?, ?, ?, ?, ?, ?, 'admin' WHERE EXISTS (SELECT 1 FROM auth_bootstrap_state WHERE id = 1 AND claimed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM app_users WHERE is_anonymous = 0 AND role = 'admin' AND status = 'active')"
    ).bind(userId, now, now, email, passwordHash, salt, PASSWORD_ITERATIONS),
    env.DB.prepare(
      "UPDATE auth_bootstrap_state SET claimed_at = ? WHERE id = 1 AND claimed_at IS NULL AND EXISTS (SELECT 1 FROM app_users WHERE user_id = ? AND role = 'admin')"
    ).bind(now, userId),
    env.DB.prepare(
      "INSERT INTO profiles (id, display_name, role, created_at, updated_at) SELECT ?, ?, 'admin', ?, ? WHERE EXISTS (SELECT 1 FROM app_users WHERE user_id = ?)"
    ).bind(userId, displayName, isoNow, isoNow, userId),
    env.DB.prepare(
      "INSERT INTO platform_admins (user_id, active, created_at) SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM app_users WHERE user_id = ?)"
    ).bind(userId, isoNow, userId),
    env.DB.prepare(
      "INSERT INTO app_session_families (family_id, user_id, created_at, revoked_at) SELECT ?, user_id, ?, NULL FROM app_users WHERE user_id = ?"
    ).bind(familyId, now, userId)
  ]);
  if (!results?.[0]?.meta || results[0].meta.changes !== 1) {
    return json({ error: "OWNER_SETUP_ALREADY_USED" }, 409, cors);
  }

  const token = await newToken();
  const tokenHash = await hashToken(token, env.SESSION_PEPPER);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await env.DB.prepare(
    "INSERT INTO app_sessions (token_hash, user_id, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
  ).bind(tokenHash, userId, familyId, now, expiresAt).run();
  return json({ userId, token, expiresAt, role: "admin" }, 201, cors);
}

async function loginOwner(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  const body = await readJson(request);
  const email = validEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || password.length > 128) {
    return json({ error: "Invalid email or password." }, 400, cors);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const attemptKey = await hashToken(email + "|" + ip, env.SESSION_PEPPER);
  const now = Math.floor(Date.now() / 1000);
  const attempt = await env.DB.prepare(
    "SELECT attempts, window_started_at, locked_until FROM auth_login_attempts WHERE attempt_key = ? LIMIT 1"
  ).bind(attemptKey).first();
  if (attempt?.locked_until && attempt.locked_until > now) {
    return json({ error: "Too many login attempts. Try again later." }, 429, cors);
  }

  const user = await env.DB.prepare(
    "SELECT user_id, password_hash, password_salt, password_iterations, status, role FROM app_users WHERE email = ? AND is_anonymous = 0 LIMIT 1"
  ).bind(email).first();
  const salt = user?.password_salt || "MDAwMDAwMDAwMDAwMDAwMA";
  const expected = user?.password_hash || "0".repeat(64);
  const actual = await derivePasswordHash(password, salt, user?.password_iterations || PASSWORD_ITERATIONS);
  if (!user || user.status !== "active" || !constantTimeEqual(actual, expected)) {
    const freshWindow = !attempt || now - attempt.window_started_at >= LOGIN_WINDOW_SECONDS;
    const attempts = freshWindow ? 1 : Number(attempt.attempts || 0) + 1;
    const windowStarted = freshWindow ? now : attempt.window_started_at;
    const lockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_WINDOW_SECONDS : null;
    await env.DB.prepare(
      "INSERT INTO auth_login_attempts (attempt_key, attempts, window_started_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(attempt_key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until"
    ).bind(attemptKey, attempts, windowStarted, lockedUntil).run();
    return json({ error: "Invalid email or password." }, 401, cors);
  }

  await env.DB.prepare("DELETE FROM auth_login_attempts WHERE attempt_key = ?").bind(attemptKey).run();
  const session = await createUserSession(env, user.user_id);
  return json({ ...session, role: user.role }, 200, cors);
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
  const row = await env.DB.prepare(
    "SELECT s.user_id, s.expires_at FROM app_sessions s JOIN app_users u ON u.user_id = s.user_id JOIN app_session_families f ON f.family_id = s.family_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active' AND f.revoked_at IS NULL LIMIT 1"
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
      if (url.pathname === "/auth/register-admin") {
        return await registerFirstAdmin(request, env);
      }
      if (url.pathname === "/auth/login") {
        return await loginOwner(request, env);
      }
      if (url.pathname === "/api/marketplace/beats") {
        const result = await marketplaceRoute(request, env, null, url);
        if (result) return result;
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/api/me/marketplace/orders") {
        const session = await validateSession(request, env);
        if (!session) return json({ error: "Invalid or expired session" }, 401, cors);
        const result = await marketplaceRoute(request, env, session.user_id, url);
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

      if (url.pathname === "/auth/refresh" && request.method === "POST") {
        return await refreshSession(request, env);
      }

      if (url.pathname === "/auth/bridge/supabase" && request.method === "POST") {
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
          return json({ error: "SUPABASE_AUTH_NOT_CONFIGURED" }, 503, cors);
        }
        return await bridgeSupabaseSession(request, env);
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
