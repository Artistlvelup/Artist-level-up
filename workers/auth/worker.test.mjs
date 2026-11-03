import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { loadWorker } from "./worker-test-loader.mjs";
const worker = await loadWorker(import.meta.url);

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeD1 {
  users = new Map();
  sessions = new Map();
  families = new Map();
  artist = null;
  ownerAdminMapped = false;
  ownerProfileExists = false;

  prepare(sql) {
    const db = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (sql.includes("SELECT pa.user_id FROM platform_admins")) {
          const [userId] = this.values;
          return db.ownerAdminMapped && db.ownerProfileExists ? { user_id: userId } : null;
        }
        if (sql.includes("SELECT user_id, is_anonymous, status FROM app_users")) {
          const [userId] = this.values;
          const user = db.users.get(userId);
          return user ? { user_id: userId, is_anonymous: user.is_anonymous, status: user.status } : null;
        }
        if (sql.includes("SELECT user_id FROM app_users WHERE user_id = ? AND is_anonymous = 0")) {
          const [userId] = this.values;
          const user = db.users.get(userId);
          return user?.status === "active" && user.is_anonymous === 0 ? { user_id: userId } : null;
        }
        if (sql.includes("SELECT id FROM artists")) return db.artist;
        if (sql.includes("SELECT status FROM app_users") || sql.includes("SELECT status, is_anonymous FROM app_users")) {
          const [userId] = this.values;
          const user = db.users.get(userId);
          return user ? { status: user.status, is_anonymous: user.is_anonymous } : null;
        }
        if (sql.includes("SELECT family_id, revoked_at FROM app_sessions") ||
            sql.includes("SELECT family_id FROM app_sessions")) {
          const [hash] = this.values;
          const session = db.sessions.get(hash);
          if (!session) return null;
          return sql.includes("revoked_at")
            ? { family_id: session.family_id, revoked_at: session.revoked_at }
            : { family_id: session.family_id };
        }
        if (sql.includes("SELECT s.user_id")) {
          const [hash, now] = this.values;
          const session = db.sessions.get(hash);
          if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
          const user = db.users.get(session.user_id);
          const family = db.families.get(session.family_id);
          return user?.status === "active" && family?.revoked_at === null
            ? { user_id: session.user_id, expires_at: session.expires_at, role: db.ownerAdminMapped ? "admin" : "artist" }
            : null;
        }
        throw new Error("Unexpected SQL in first(): " + sql);
      },
      async run() {
        if (sql.includes("INSERT INTO app_users") && sql.includes("SELECT ?, 0, 'active'")) {
          const [userId, createdAt, updatedAt, adminId, profileId] = this.values;
          if (!db.ownerAdminMapped || !db.ownerProfileExists || adminId !== userId || profileId !== userId) {
            return { success: true, meta: { changes: 0 } };
          }
          if (!db.users.has(userId)) db.users.set(userId, {
            status: "active", is_anonymous: 0, created_at: createdAt, updated_at: updatedAt
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO app_users")) {
          const [userId, isAnonymous, createdAt, updatedAt] = this.values;
          const existing = db.users.get(userId);
          if (!existing) db.users.set(userId, { status: "active", is_anonymous: isAnonymous, created_at: createdAt, updated_at: updatedAt });
          else if (existing.status === "active") existing.updated_at = updatedAt;
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO app_sessions")) {
          const [tokenHash, userId, familyId, createdAt, expiresAt] = this.values;
          db.sessions.set(tokenHash, { user_id: userId, family_id: familyId, created_at: createdAt, expires_at: expiresAt, revoked_at: null });
          return { success: true, meta: { changes: 1 } };
        }
        throw new Error("Unexpected SQL in run(): " + sql);
      }
    };
  }

  async batch(statements) {
    const firstSql = statements[0].sql;
    if (firstSql.includes("INSERT INTO app_users")) {
      const [userId, createdAt, updatedAt] = statements[0].values;
      const [familyId, familyUserId, familyCreatedAt] = statements[1].values;
      const [tokenHash, sessionUserId, sessionFamilyId, sessionCreatedAt, expiresAt] = statements[2].values;
      assert.equal(familyUserId, userId);
      assert.equal(sessionUserId, userId);
      assert.equal(sessionFamilyId, familyId);
      this.users.set(userId, { status: "active", is_anonymous: 1, created_at: createdAt, updated_at: updatedAt });
      this.families.set(familyId, { user_id: userId, created_at: familyCreatedAt, revoked_at: null });
      this.sessions.set(tokenHash, { user_id: userId, family_id: familyId, created_at: sessionCreatedAt, expires_at: expiresAt, revoked_at: null });
      return [{ success: true }, { success: true }, { success: true }];
    }
    if (firstSql.includes("INSERT INTO app_session_families")) {
      const [familyId, userId, createdAt] = statements[0].values;
      const [tokenHash, sessionUserId, sessionFamilyId, sessionCreatedAt, expiresAt] = statements[1].values;
      assert.equal(sessionUserId, userId);
      assert.equal(sessionFamilyId, familyId);
      this.families.set(familyId, { user_id: userId, created_at: createdAt, revoked_at: null });
      this.sessions.set(tokenHash, { user_id: userId, family_id: familyId, created_at: sessionCreatedAt, expires_at: expiresAt, revoked_at: null });
      return [{ success: true }, { success: true }];
    }
    if (firstSql.includes("INSERT INTO app_sessions")) {
      const [newHash, createdAt, expiresAt, oldHash, now] = statements[0].values;
      const oldSession = this.sessions.get(oldHash);
      const user = oldSession && this.users.get(oldSession.user_id);
      const family = oldSession && this.families.get(oldSession.family_id);
      const valid = oldSession && oldSession.revoked_at === null && oldSession.expires_at > now &&
        user?.status === "active" && family?.revoked_at === null;
      if (!valid) return [{ success: true, meta: { changes: 0 } }, { success: true, meta: { changes: 0 } }];
      this.sessions.set(newHash, { user_id: oldSession.user_id, family_id: oldSession.family_id, created_at: createdAt, expires_at: expiresAt, revoked_at: null });
      oldSession.revoked_at = now;
      return [{ success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 1 } }];
    }
    if (firstSql.includes("UPDATE app_session_families")) {
      const [now, familyId] = statements[0].values;
      const family = this.families.get(familyId);
      if (family && family.revoked_at === null) family.revoked_at = now;
      for (const session of this.sessions.values()) {
        if (session.family_id === familyId && session.revoked_at === null) session.revoked_at = now;
      }
      return [{ success: true }, { success: true }];
    }
    throw new Error("Unexpected batch SQL: " + firstSql);
  }
}
function setup() {
  return {
    DB: new FakeD1(),
    SESSION_PEPPER: "test-only-pepper-with-at-least-32-characters",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "test-supabase-anon-key",
    ALLOWED_ORIGINS: "https://artistlevelup.com.ng",
  };
}

const request = (path, method = "GET", headers = {}) =>
  new Request("https://auth.example.test" + path, { method, headers });


const ownerBridgeRequest = token => new Request("https://auth.example.test/auth/bridge/supabase", {
  method: "POST",
  headers: { Origin: "https://artistlevelup.com.ng", "Content-Type": "application/json" },
  body: JSON.stringify({ access_token: token })
});

test("rejects every legacy Supabase identity while no Cloudflare account is approved", async () => {
  const env = setup();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "11111111-1111-4111-8111-111111111111", is_anonymous: false
  }), { status: 200 });
  try {
    const response = await worker.fetch(ownerBridgeRequest("s".repeat(80)), env);
    assert.equal(response.status, 403);
    assert.equal(env.DB.users.size, 0);
    assert.equal(env.DB.sessions.size, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("keeps owner bootstrap disabled and validates the new password-auth routes", async () => {
  const env = setup();
  assert.equal((await worker.fetch(request("/auth/register-admin", "POST", {
    "Content-Type": "application/json"
  }), env)).status, 404);

  const login = await worker.fetch(new Request("https://auth.example.test/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{"
  }), env);
  assert.equal(login.status, 400, "password login route must reject malformed JSON");

  const register = await worker.fetch(new Request("https://auth.example.test/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "artist@example.com", password: "a-secure-password-123" })
  }), env);
  assert.equal(register.status, 503, "registration must fail closed until email delivery is configured");

  const verify = await worker.fetch(new Request("https://auth.example.test/auth/verify-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "too-short" })
  }), env);
  assert.equal(verify.status, 400, "verification route must reject invalid tokens");
});

test("creates an anonymous identity and returns a usable opaque session", async () => {
  const env = setup();
  const response = await worker.fetch(request("/auth/anonymous", "POST", {
    Origin: "https://artistlevelup.com.ng"
  }), env);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.userId, /^[0-9a-f-]{36}$/i);
  assert.match(body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(typeof body.expiresAt, "number");
  assert.equal(env.DB.users.size, 1);
  assert.equal(env.DB.sessions.size, 1);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("anonymous artist sessions cannot access any protected admin API", async () => {
  const env = setup();
  const created = await worker.fetch(request("/auth/anonymous", "POST"), env);
  assert.equal(created.status, 201);
  const session = await created.json();
  const headers = { Authorization: "Bearer " + session.token };
  for (const path of [
    "/api/admin/songs",
    "/api/admin/videos",
    "/api/admin/withdrawals",
    "/api/admin/marketplace/commissions"
  ]) {
    const response = await worker.fetch(request(path, "GET", headers), env);
    assert.equal(response.status, 403, path + " must reject an anonymous artist session");
  }
});

test("validates a created session and rejects it after logout", async () => {
  const env = setup();
  const created = await worker.fetch(request("/auth/anonymous", "POST"), env);
  const session = await created.json();

  const check = () => worker.fetch(request("/auth/session", "GET", {
    Authorization: "Bearer " + session.token
  }), env);
  const valid = await check();
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).userId, session.userId);

  const logout = await worker.fetch(request("/auth/logout", "POST", {
    Authorization: "Bearer " + session.token
  }), env);
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.equal((await check()).status, 401);
});

test("rejects unapproved origins", async () => {
  const env = setup();
  const response = await worker.fetch(request("/auth/anonymous", "POST", {
    Origin: "https://attacker.example"
  }), env);
  assert.equal(response.status, 403);
  assert.equal(env.DB.users.size, 0);
});

test("rejects missing bearer tokens and unknown routes", async () => {
  const env = setup();
  assert.equal((await worker.fetch(request("/auth/session"), env)).status, 401);
  assert.equal((await worker.fetch(request("/not-a-route"), env)).status, 404);
});

test("fails closed when required configuration is missing", async () => {
  const env = { DB: new FakeD1(), ALLOWED_ORIGINS: "https://artistlevelup.com.ng" };
  const response = await worker.fetch(request("/auth/anonymous", "POST"), env);
  assert.equal(response.status, 503);
});

test("rotates a live session and keeps the replacement token valid", async () => {
  const env = setup();
  const created = await worker.fetch(request("/auth/anonymous", "POST"), env);
  const oldSession = await created.json();
  const refresh = await worker.fetch(request("/auth/refresh", "POST", { Authorization: "Bearer " + oldSession.token }), env);
  assert.equal(refresh.status, 200);
  const nextSession = await refresh.json();
  assert.match(nextSession.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(nextSession.token, oldSession.token);
  assert.equal(typeof nextSession.expiresAt, "number");
  const oldCheck = await worker.fetch(request("/auth/session", "GET", { Authorization: "Bearer " + oldSession.token }), env);
  assert.equal(oldCheck.status, 401);
  const newCheck = await worker.fetch(request("/auth/session", "GET", { Authorization: "Bearer " + nextSession.token }), env);
  assert.equal(newCheck.status, 200);
  assert.equal(env.DB.families.size, 1);
  assert.equal([...env.DB.sessions.values()].every(s => s.family_id === [...env.DB.families.keys()][0]), true);
});

test("replaying a rotated token revokes every token in its family", async () => {
  const env = setup();
  const created = await worker.fetch(request("/auth/anonymous", "POST"), env);
  const original = await created.json();
  const firstRefresh = await worker.fetch(request("/auth/refresh", "POST", { Authorization: "Bearer " + original.token }), env);
  const replacement = await firstRefresh.json();
  assert.equal(firstRefresh.status, 200);

  const replay = await worker.fetch(request("/auth/refresh", "POST", { Authorization: "Bearer " + original.token }), env);
  assert.equal(replay.status, 401);

  const replacementCheck = await worker.fetch(request("/auth/session", "GET", {
    Authorization: "Bearer " + replacement.token
  }), env);
  assert.equal(replacementCheck.status, 401);
  assert.equal([...env.DB.families.values()][0].revoked_at !== null, true);
});

test("rejects refresh attempts without a live session", async () => {
  const env = setup();
  const response = await worker.fetch(request("/auth/refresh", "POST", { Authorization: "Bearer " + "x".repeat(43) }), env);
  assert.equal(response.status, 401);
});


test("creates a separate R2 audio upload intent for an active artist", async () => {
  const env = setup();
  env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  env.R2_ACCESS_KEY_ID = "test-access";
  env.R2_SECRET_ACCESS_KEY = "test-secret";
  env.R2_PUBLIC_BASE_URL = "https://media.example.test";
  env.DB.artist = { id: "artist-123" };
  const created = await worker.fetch(request("/auth/anonymous", "POST"), env);
  const session = await created.json();
  const upload = await worker.fetch(new Request("https://auth.example.test/api/me/videos/upload-intent", {
    method: "POST",
    headers: { Authorization: "Bearer " + session.token, "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: "audio", filename: "track.mp3", contentType: "audio/mpeg", size: 1024 })
  }), env);
  assert.equal(upload.status, 200);
  const body = await upload.json();
  assert.match(body.objectKey, /^artist-123\/audio\/[0-9a-f-]+\.mp3$/i);
  assert.equal(body.contentType, "audio/mpeg");
  assert.equal(body.expiresIn, 300);
  assert.match(body.uploadUrl, /^https:\/\//);
});

test("rejects unsupported audio types and audio files above the size limit", async () => {
  const env = setup();
  env.DB.artist = { id: "artist-123" };
  const created = await worker.fetch(request("/auth/anonymous", "POST"), env);
  const session = await created.json();
  const send = (contentType, size) => worker.fetch(new Request("https://auth.example.test/api/me/videos/upload-intent", {
    method: "POST",
    headers: { Authorization: "Bearer " + session.token, "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: "audio", filename: "track.bin", contentType, size })
  }), env);
  assert.equal((await send("application/octet-stream", 1024)).status, 415);
  assert.equal((await send("audio/mpeg", 100 * 1024 * 1024 + 1)).status, 413);
});
