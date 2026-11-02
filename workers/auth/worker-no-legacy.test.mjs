import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { loadWorker } from "./worker-test-loader.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const worker = await loadWorker(import.meta.url);

test("legacy session bridge endpoint is not exposed", async () => {
  const request = new Request("https://worker.example/auth/bridge/supabase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: "not-a-valid-token" })
  });
  const response = await worker.fetch(request, {
    DB: { prepare() { throw new Error("D1 should not be reached"); } },
    SESSION_PEPPER: "test-session-pepper-that-is-longer-than-32-characters",
    ALLOWED_ORIGINS: ""
  });
  assert.equal(response.status, 404);
});

test("worker source does not contain external legacy auth/database references", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /supabase|\/auth\/bridge/i);
});
