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
      // Keep internal SQL/errors out of the response.
      console.error("V101 auth Worker error", error);
      return json({ error: "Authentication request failed" }, 500, cors);
    }
  }
};
