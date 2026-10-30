import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
const workerSource = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(workerSource).toString("base64"));

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeD1 {
  users = new Map();
  sessions = new Map();
  families = new Map();

  prepare(sql) {
    const db = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (sql.includes("SELECT status FROM app_users")) {
          const [userId] = this.values;
          const user = db.users.get(userId);
          return user ? { status: user.status } : null;
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
            ? { user_id: session.user_id, expires_at: session.expires_at }
            : null;
        }
        throw new Error("Unexpected SQL in first(): " + sql);
      },
      async run() {
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
    ALLOWED_ORIGINS: "https://artistlevelup.com.ng",
    SUPABASE_URL: "https://example-project.supabase.co",
    SUPABASE_ANON_KEY: "test-publishable-key"
  };
}

const request = (path, method = "GET", headers = {}) =>
  new Request("https://auth.example.test" + path, { method, headers });

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

test("bridges a verified Supabase user without changing the user's UUID", async () => {
  const env = setup();
  const originalFetch = globalThis.fetch;
  const userId = "a8f27e84-cd57-4cdd-8f00-09b865a7bb6d";
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://example-project.supabase.co/auth/v1/user");
    assert.equal(options.headers.Authorization, "Bearer valid-supabase-access-token");
    assert.equal(options.headers.apikey, "test-publishable-key");
    return new Response(JSON.stringify({ id: userId, is_anonymous: true }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://auth.example.test/auth/bridge/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://artistlevelup.com.ng" },
      body: JSON.stringify({ access_token: "valid-supabase-access-token" })
    }), env);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.userId, userId);
    assert.match(body.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(env.DB.users.size, 1);
    assert.equal(env.DB.users.has(userId), true);
    assert.equal(env.DB.sessions.size, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not bridge an invalid Supabase token or create a D1 identity", async () => {
  const env = setup();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
  try {
    const response = await worker.fetch(new Request("https://auth.example.test/auth/bridge/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: "invalid-supabase-access-token" })
    }), env);
    assert.equal(response.status, 401);
    assert.equal(env.DB.users.size, 0);
    assert.equal(env.DB.sessions.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not restore a disabled D1 identity", async () => {
  const env = setup();
  const userId = "a8f27e84-cd57-4cdd-8f00-09b865a7bb6d";
  env.DB.users.set(userId, { status: "disabled" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: userId }), { status: 200 });
  try {
    const response = await worker.fetch(new Request("https://auth.example.test/auth/bridge/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: "valid-supabase-access-token" })
    }), env);
    assert.equal(response.status, 403);
    assert.equal(env.DB.sessions.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
