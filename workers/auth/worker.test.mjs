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

  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (sql.includes("SELECT s.user_id")) {
          const [hash, now] = this.values;
          const session = db.sessions.get(hash);
          if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
          const user = db.users.get(session.user_id);
          return user?.status === "active"
            ? { user_id: session.user_id, expires_at: session.expires_at }
            : null;
        }
        throw new Error("Unexpected SQL in first(): " + sql);
      },
      async run() {
        if (sql.includes("UPDATE app_sessions SET revoked_at")) {
          const [revokedAt, hash] = this.values;
          const session = db.sessions.get(hash);
          if (session && session.revoked_at === null) session.revoked_at = revokedAt;
          return { success: true };
        }
        throw new Error("Unexpected SQL in run(): " + sql);
      }
    };
  }

  async batch(statements) {
    // The Worker batches exactly one app_users insert followed by one session insert.
    const userValues = statements[0].values;
    const sessionValues = statements[1].values;
    const [userId, createdAt, updatedAt] = userValues;
    const [tokenHash, sessionUserId, sessionCreatedAt, expiresAt] = sessionValues;
    assert.equal(sessionUserId, userId);
    this.users.set(userId, { status: "active", created_at: createdAt, updated_at: updatedAt });
    this.sessions.set(tokenHash, {
      user_id: sessionUserId,
      created_at: sessionCreatedAt,
      expires_at: expiresAt,
      revoked_at: null
    });
    return [{ success: true }, { success: true }];
  }
}

function setup() {
  return {
    DB: new FakeD1(),
    SESSION_PEPPER: "test-only-pepper-with-at-least-32-characters",
    ALLOWED_ORIGINS: "https://artistlevelup.com.ng"
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
