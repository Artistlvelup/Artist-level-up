import test from "node:test";
import assert from "node:assert/strict";
import { loadWorker } from "./worker-test-loader.mjs";

const worker = await loadWorker(import.meta.url);
const env = () => ({
  DB: { prepare() { throw new Error("D1 should not be reached for invalid requests"); } },
  SESSION_PEPPER: "test-session-pepper-that-is-longer-than-32-characters",
  ALLOWED_ORIGINS: "https://artistlevelup.com.ng"
});
const post = (path, body, raw = false) => new Request("https://worker.example" + path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: raw ? body : JSON.stringify(body)
});

test("registration rejects malformed JSON and weak passwords before touching D1", async () => {
  assert.equal((await worker.fetch(post("/auth/register", "{", true), env())).status, 400);
  const weak = await worker.fetch(post("/auth/register", {
    email: "artist@example.com", password: "short"
  }), env());
  assert.equal(weak.status, 400);
});

test("registration fails closed when verification email delivery is not configured", async () => {
  const response = await worker.fetch(post("/auth/register", {
    email: "artist@example.com", password: "a-long-secure-password-123"
  }), env());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /email verification is not configured/i);
});

test("verification rejects missing and malformed tokens without touching D1", async () => {
  assert.equal((await worker.fetch(post("/auth/verify-email", {}), env())).status, 400);
  assert.equal((await worker.fetch(post("/auth/verify-email", { token: "too-short" }), env())).status, 400);
});

test("login rejects malformed credentials before touching D1", async () => {
  const response = await worker.fetch(post("/auth/login", {
    email: "not-an-email", password: "anything"
  }), env());
  assert.equal(response.status, 400);
});
