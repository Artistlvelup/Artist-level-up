import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

class AuthD1 {
  users = new Map();
  families = new Map();
  sessions = new Map();
  attempts = new Map();
  bootstrapClaimedAt = null;

  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (sql.includes("FROM auth_bootstrap_state")) return { claimed_at: db.bootstrapClaimedAt };
        if (sql.includes("FROM app_users WHERE email =")) {
          const [email] = this.values;
          return [...db.users.values()].find(x => x.email === email && x.is_anonymous === 0) || null;
        }
        if (sql.includes("FROM auth_login_attempts")) {
          return db.attempts.get(this.values[0]) || null;
        }
        if (sql.includes("SELECT s.user_id")) {
          const [hash, now] = this.values;
          const s = db.sessions.get(hash);
          const u = s && db.users.get(s.user_id);
          const f = s && db.families.get(s.family_id);
          return s && !s.revoked_at && s.expires_at > now && u?.status === "active" && f?.revoked_at === null
            ? { user_id: s.user_id, expires_at: s.expires_at, role: u.role }
            : null;
        }
        throw new Error("Unexpected first SQL: " + sql);
      },
      async run() {
        if (sql.includes("INSERT INTO app_sessions")) {
          const [hash, userId, familyId, createdAt, expiresAt] = this.values;
          db.sessions.set(hash, { user_id: userId, family_id: familyId, created_at: createdAt, expires_at: expiresAt, revoked_at: null });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO auth_login_attempts")) {
          const [key, attempts, windowStarted, lockedUntil] = this.values;
          db.attempts.set(key, { attempts, window_started_at: windowStarted, locked_until: lockedUntil });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("DELETE FROM auth_login_attempts")) {
          db.attempts.delete(this.values[0]);
          return { success: true, meta: { changes: 1 } };
        }
        throw new Error("Unexpected run SQL: " + sql);
      }
    };
  }

  async batch(statements) {
    const first = statements[0].sql;
    if (first.includes("INSERT INTO app_users")) {
      const [userId, createdAt, updatedAt, email, passwordHash, passwordSalt, iterations] = statements[0].values;
      if (this.bootstrapClaimedAt !== null || [...this.users.values()].some(u => u.role === "admin" && u.status === "active")) {
        return [{ meta: { changes: 0 } }];
      }
      if ([...this.users.values()].some(u => u.email === email)) return [{ meta: { changes: 0 } }];
      this.users.set(userId, {
        user_id: userId, email, password_hash: passwordHash, password_salt: passwordSalt,
        password_iterations: iterations, status: "active", is_anonymous: 0, role: "admin",
        created_at: createdAt, updated_at: updatedAt
      });
      this.bootstrapClaimedAt = statements[1].values[0];
      const [familyId, familyCreatedAt] = statements[4].values;
      this.families.set(familyId, { user_id: userId, created_at: familyCreatedAt, revoked_at: null });
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }
    if (first.includes("INSERT INTO app_session_families")) {
      const [familyId, userId, createdAt] = statements[0].values;
      const [hash, sessionUserId, sessionFamilyId, sessionCreatedAt, expiresAt] = statements[1].values;
      assert.equal(sessionUserId, userId);
      assert.equal(sessionFamilyId, familyId);
      this.families.set(familyId, { user_id: userId, created_at: createdAt, revoked_at: null });
      this.sessions.set(hash, { user_id: userId, family_id: familyId, created_at: sessionCreatedAt, expires_at: expiresAt, revoked_at: null });
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }
    throw new Error("Unexpected batch SQL: " + first);
  }
}

function env() {
  return {
    DB: new AuthD1(),
    SESSION_PEPPER: "test-session-pepper-at-least-thirty-two-characters",
    BOOTSTRAP_SECRET: "test-bootstrap-secret-at-least-thirty-two-characters",
    ALLOWED_ORIGINS: "https://artistlevelup.com.ng"
  };
}
function post(path, body) {
  return new Request("https://worker.example" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("first-admin setup creates one admin and a D1 session", async () => {
  const e = env();
  const response = await worker.fetch(post("/auth/register-admin", {
    email: "Owner@Example.com",
    display_name: "Platform Owner",
    password: "A-Strong-Owner-Password-2026!",
    bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.role, "admin");
  assert.match(result.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(e.DB.users.size, 1);
  assert.equal(e.DB.sessions.size, 1);
  assert.equal(e.DB.bootstrapClaimedAt > 0, true);
});

test("first-admin setup cannot be claimed twice", async () => {
  const e = env();
  const payload = {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  };
  assert.equal((await worker.fetch(post("/auth/register-admin", payload), e)).status, 201);
  const again = await worker.fetch(post("/auth/register-admin", {
    ...payload, email: "second@example.com"
  }), e);
  assert.equal(again.status, 409);
  assert.equal(e.DB.users.size, 1);
});

test("owner can log in with the new password and receive a valid session", async () => {
  const e = env();
  await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const response = await worker.fetch(post("/auth/login", {
    email: "OWNER@example.com", password: "A-Strong-Owner-Password-2026!"
  }), e);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.role, "admin");
  const check = await worker.fetch(new Request("https://worker.example/auth/session", {
    headers: { Authorization: "Bearer " + result.token }
  }), e);
  assert.equal(check.status, 200);
});

test("owner login rejects an incorrect password", async () => {
  const e = env();
  await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const response = await worker.fetch(post("/auth/login", {
    email: "owner@example.com", password: "wrong-password"
  }), e);
  assert.equal(response.status, 401);
});
