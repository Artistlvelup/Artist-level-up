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
  legacyAdminIds = new Set();
  profileIds = new Set();
  withdrawals = [];
  bootstrapClaimedAt = null;
  batchStatements = [];

  prepare(sql) {
    const db = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (sql.includes("FROM auth_bootstrap_state")) return { claimed_at: db.bootstrapClaimedAt };
        if (sql.includes("FROM platform_admins pa JOIN profiles")) {
          const [userId] = this.values;
          return db.legacyAdminIds.has(userId) && db.profileIds.has(userId) ? { user_id: userId } : null;
        }
        if (sql.includes("FROM app_users WHERE user_id =")) {
          const [userId] = this.values;
          return db.users.get(userId) || null;
        }
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
            ? { user_id: s.user_id, expires_at: s.expires_at, role: db.legacyAdminIds.has(s.user_id) ? "admin" : u.role }
            : null;
        }
        throw new Error("Unexpected first SQL: " + sql);
      },
      async all() {
        if (sql.includes("FROM withdrawals w LEFT JOIN profiles")) {
          return { results: [{ id: "withdrawal-1", user_id: "d6eaf421-fcad-44ec-beb0-d6a7f676db8a", display_name: "Owner", amount: 2500, bank_name: "Example Bank", account_name: "Owner", account_number: "0123456789", status: "pending", created_at: "2026-10-31T10:00:00.000Z" }] };
        }
        if (sql.includes("FROM songs s LEFT JOIN artists")) {
          return { results: [{ id: "22222222-2222-4222-8222-222222222222", title: "Test Song", status: "pending", artist_name: "Test Artist" }] };
        }
        if (sql.includes("FROM artist_videos")) {
          return { results: [{ id: "11111111-1111-4111-8111-111111111111", title: "Review this video", status: "pending" }] };
        }
        if (sql.includes("FROM marketplace_orders WHERE status = 'paid'")) {
          return { results: [
            { id: "order-1", beat_title: "Test Beat", producer_name: "Producer", amount_ngn: 5000,
              status: "paid", platform_fee_percent: 10, platform_fee_ngn: 500,
              producer_payout_ngn: 4500, paid_at: "2026-10-30T10:00:00.000Z", paystack_reference: "ref-1" }
          ] };
        }
        throw new Error("Unexpected all SQL: " + sql);
      },
      async run() {
        if (sql.includes("INSERT INTO app_users") && sql.includes("SELECT ?, 0, 'active'")) {
          const [userId, createdAt, updatedAt, adminId, profileId] = this.values;
          if (!db.legacyAdminIds.has(adminId) || !db.profileIds.has(profileId)) return { success: true, meta: { changes: 0 } };
          if (!db.users.has(userId)) db.users.set(userId, {
            user_id: userId, is_anonymous: 0, status: "active", created_at: createdAt,
            updated_at: updatedAt, role: "artist", email: null
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE songs SET status = ?, updated_at = ? WHERE id = ?")) {
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE artist_videos SET status = ? WHERE id = ?")) {
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO withdrawals")) {
          db.withdrawals.push(this.values);
          return { success: true, meta: { changes: 1 } };
        }
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
    this.batchStatements = statements.map(x => ({ sql: x.sql, values: x.values }));
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
    ALLOWED_ORIGINS: "https://artistlevelup.com.ng",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "test-publishable-key"
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
  assert.equal(e.DB.users.has("d6eaf421-fcad-44ec-beb0-d6a7f676db8a"), true);
  assert.equal(e.DB.batchStatements.filter(x => x.sql.includes("INSERT INTO artist_videos")).length, 2);
  assert.equal(e.DB.batchStatements.some(x => x.values.some(v => typeof v === "string" && v.includes(".supabase.co/storage/"))), false);
  assert.equal(e.DB.batchStatements.filter(x => x.sql.includes("INSERT INTO picture_posts")).length, 3);
  assert.equal(e.DB.batchStatements.filter(x => x.sql.includes("INSERT INTO songs")).length, 1);
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


test("withdrawal API creates only a pending request for the authenticated user", async () => {
  const e = env();
  const registered = await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com",
    display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!",
    bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const { token } = await registered.json();
  const response = await worker.fetch(new Request("https://worker.example/api/me/withdrawals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      amount: 2500, bank_name: "Example Bank",
      account_name: "Owner Name", account_number: "0123456789",
      user_id: "attacker-controlled-id", status: "approved"
    })
  }), e);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.withdrawal.status, "pending");
  assert.equal(result.withdrawal.user_id, "d6eaf421-fcad-44ec-beb0-d6a7f676db8a");
  assert.equal(e.DB.withdrawals.length, 1);
  assert.equal(e.DB.withdrawals[0][1], "d6eaf421-fcad-44ec-beb0-d6a7f676db8a");
  assert.equal(e.DB.withdrawals[0][2], 2500);
  assert.equal(result.withdrawal.status, "pending");
});

test("withdrawal API rejects unauthenticated and invalid requests", async () => {
  const e = env();
  const unauthenticated = await worker.fetch(post("/api/me/withdrawals", {
    amount: 2500, bank_name: "Example Bank",
    account_name: "Owner Name", account_number: "0123456789"
  }), e);
  assert.equal(unauthenticated.status, 401);
  const registered = await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const { token } = await registered.json();
  const invalid = await worker.fetch(new Request("https://worker.example/api/me/withdrawals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      amount: -10, bank_name: "Example Bank",
      account_name: "Owner Name", account_number: "12"
    })
  }), e);
  assert.equal(invalid.status, 400);
  assert.equal(e.DB.withdrawals.length, 0);
});


test("marketplace commission report is available to admin only", async () => {
  const e = env();
  const registered = await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const { token } = await registered.json();
  const response = await worker.fetch(new Request("https://worker.example/api/admin/marketplace/commissions?limit=20", {
    headers: { Authorization: "Bearer " + token }
  }), e);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].platform_fee_ngn, 500);
  assert.equal(result.orders[0].status, "paid");

  const unauthenticated = await worker.fetch(new Request("https://worker.example/api/admin/marketplace/commissions"), e);
  assert.equal(unauthenticated.status, 401);
});


test("admin can list and moderate videos; non-admin cannot", async () => {
  const e = env();
  const registered = await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const { token } = await registered.json();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const list = await worker.fetch(new Request("https://worker.example/api/admin/videos?status=pending", { headers }), e);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).videos[0].status, "pending");

  const id = "11111111-1111-4111-8111-111111111111";
  const moderate = await worker.fetch(new Request("https://worker.example/api/admin/videos/" + id, {
    method: "PATCH", headers, body: JSON.stringify({ status: "approved" })
  }), e);
  assert.equal(moderate.status, 200);
  assert.equal((await moderate.json()).status, "approved");

  const invalid = await worker.fetch(new Request("https://worker.example/api/admin/videos/" + id, {
    method: "PATCH", headers, body: JSON.stringify({ status: "deleted" })
  }), e);
  assert.equal(invalid.status, 400);

  const denied = await worker.fetch(new Request("https://worker.example/api/admin/videos"), e);
  assert.equal(denied.status, 401);
});


test("admin can review withdrawals; non-admin and unauthenticated users cannot", async () => {
  const e = env();
  const registered = await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const { token } = await registered.json();
  const headers = { Authorization: "Bearer " + token };
  const list = await worker.fetch(new Request("https://worker.example/api/admin/withdrawals?status=pending", { headers }), e);
  assert.equal(list.status, 200);
  const result = await list.json();
  assert.equal(result.withdrawals.length, 1);
  assert.equal(result.withdrawals[0].status, "pending");
  assert.equal(result.withdrawals[0].account_number, "0123456789");

  const invalidStatus = await worker.fetch(new Request("https://worker.example/api/admin/withdrawals?status=processing", { headers }), e);
  assert.equal(invalidStatus.status, 400);
  const denied = await worker.fetch(new Request("https://worker.example/api/admin/withdrawals"), e);
  assert.equal(denied.status, 401);
});

test("admin can list and moderate songs; non-admin cannot", async () => {
  const e = env();
  const registered = await worker.fetch(post("/auth/register-admin", {
    email: "owner@example.com", display_name: "Owner",
    password: "A-Strong-Owner-Password-2026!", bootstrap_secret: e.BOOTSTRAP_SECRET
  }), e);
  const { token } = await registered.json();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const list = await worker.fetch(new Request("https://worker.example/api/admin/songs?status=pending", { headers }), e);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).songs[0].status, "pending");

  const id = "22222222-2222-4222-8222-222222222222";
  const moderate = await worker.fetch(new Request("https://worker.example/api/admin/songs/" + id, {
    method: "PATCH", headers, body: JSON.stringify({ status: "approved" })
  }), e);
  assert.equal(moderate.status, 200);
  assert.equal((await moderate.json()).status, "approved");

  const invalid = await worker.fetch(new Request("https://worker.example/api/admin/songs/" + id, {
    method: "PATCH", headers, body: JSON.stringify({ status: "paid" })
  }), e);
  assert.equal(invalid.status, 400);

  const denied = await worker.fetch(new Request("https://worker.example/api/admin/songs"), e);
  assert.equal(denied.status, 401);
});


test("Supabase bridge links only the verified existing owner and creates a D1 session without seeding content", async () => {
  const e = env();
  const ownerId = "d6eaf421-fcad-44ec-beb0-d6a7f676db8a";
  e.DB.legacyAdminIds.add(ownerId);
  e.DB.profileIds.add(ownerId);
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  try {
    globalThis.fetch = async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.headers.apikey, e.SUPABASE_ANON_KEY);
      assert.equal(options.headers.Authorization, "Bearer " + "s".repeat(50));
      return new Response(JSON.stringify({ id: ownerId, is_anonymous: false }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    };
    const response = await worker.fetch(post("/auth/bridge/supabase", {
      access_token: "s".repeat(50), user_id: "attacker-id", role: "admin"
    }), e);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.userId, ownerId);
    assert.equal(result.role, "admin");
    assert.match(result.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(requestedUrl, e.SUPABASE_URL + "/auth/v1/user");
    assert.equal(e.DB.users.get(ownerId).is_anonymous, 0);
    assert.equal(e.DB.users.get(ownerId).role, "artist");
    assert.equal(e.DB.sessions.size, 1);

    const adminCheck = await worker.fetch(new Request("https://worker.example/api/admin/marketplace/commissions", {
      headers: { Authorization: "Bearer " + result.token }
    }), e);
    assert.equal(adminCheck.status, 200);
    assert.equal(e.DB.batchStatements.some(x => x.sql.includes("INSERT INTO artist_videos")), false);
    assert.equal(e.DB.batchStatements.some(x => x.sql.includes("INSERT INTO songs")), false);
    assert.equal(e.DB.batchStatements.some(x => x.sql.includes("INSERT INTO picture_posts")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Supabase bridge rejects anonymous and unapproved identities", async () => {
  const e = env();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "d6eaf421-fcad-44ec-beb0-d6a7f676db8a", is_anonymous: true
    }), { status: 200 });
    const anonymous = await worker.fetch(post("/auth/bridge/supabase", { access_token: "s".repeat(50) }), e);
    assert.equal(anonymous.status, 403);

    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "00000000-0000-4000-8000-000000000000", is_anonymous: false
    }), { status: 200 });
    const unknown = await worker.fetch(post("/auth/bridge/supabase", { access_token: "s".repeat(50) }), e);
    assert.equal(unknown.status, 403);
    assert.equal(e.DB.sessions.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Supabase bridge rejects missing anonymous-status proof and malformed tokens", async () => {
  const e = env();
  const ownerId = "d6eaf421-fcad-44ec-beb0-d6a7f676db8a";
  e.DB.legacyAdminIds.add(ownerId);
  e.DB.profileIds.add(ownerId);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: ownerId }), { status: 200 });
    const missingFlag = await worker.fetch(post("/auth/bridge/supabase", {
      access_token: "s".repeat(50)
    }), e);
    assert.equal(missingFlag.status, 403);
    assert.equal(e.DB.sessions.size, 0);

    const malformed = await worker.fetch(post("/auth/bridge/supabase", {
      access_token: "not a valid token"
    }), e);
    assert.equal(malformed.status, 400);
    assert.equal(e.DB.sessions.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
