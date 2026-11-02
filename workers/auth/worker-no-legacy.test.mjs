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


test("picture-post routes enforce ownership and reuse existing R2 URLs", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/public\/picture-posts/);
  assert.match(source, /\/api\/me\/picture-posts/);
  assert.match(source, /WHERE id = \? AND user_id = \?/);
  assert.match(source, /IMAGE_URL_MUST_REFERENCE_EXISTING_R2_MEDIA/);
  assert.match(source, /R2_PUBLIC_BASE_URL/);
  assert.doesNotMatch(source, /(?:env\.)?R2_BUCKET\.(?:put|delete)\(/i);
});


test("music routes require artist-owned Cloudflare R2 audio and cover objects", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/me\/songs\/upload-intent/);
  assert.match(source, /AUDIO_URL_MUST_BE_AN_OWNED_R2_UPLOAD/);
  assert.match(source, /COVER_URL_MUST_BE_AN_OWNED_R2_UPLOAD/);
  assert.match(source, /audio_url, cover_url, duration_seconds/);
  assert.match(source, /"audio"\s*\)/);
});

test("streaming distribution draft routes are authenticated and owner-scoped", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.ok(source.includes("/api/me/streaming-distribution"));
  assert.ok(source.includes('operation !== "create_draft"'));
  assert.ok(source.includes('operation === "list_mine"'));
  assert.ok(source.includes("streaming_distribution_requests"));
  assert.ok(source.includes("rights_confirmed !== true"));
  assert.ok(source.includes("WHERE id = ? AND user_id = ?"));
  assert.ok(source.includes('status !== "draft"'));
  assert.doesNotMatch(source, /supabase|\/auth\/bridge/i);
});

test("streaming release uploads are signed, release-scoped, and verified before submission", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.ok(source.includes('operation === "upload_intent"'));
  assert.ok(source.includes('operation === "submit"'));
  assert.ok(source.includes('"/streaming-releases/" + requestId'));
  assert.ok(source.includes('method: "HEAD"'));
  assert.ok(source.includes('status = \'submitted\''));
  assert.ok(source.includes('WHERE id = ? AND user_id = ? AND status = \'draft\''));
  assert.ok(source.includes("R2 upload service is not configured"));
});
