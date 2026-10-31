import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

class DataD1 {
  users = new Map();
  sessions = new Map();
  families = new Map();
  profiles = new Map();
  artists = new Map();
  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...v) { this.values = v; return this; },
      async first() {
        const v = this.values;
        if (sql.includes("SELECT s.user_id")) {
          const s = db.sessions.get(v[0]);
          const u = s && db.users.get(s.user_id);
          const f = s && db.families.get(s.family_id);
          return s && s.revoked_at === null && s.expires_at > v[1] && u?.status === "active" && f?.revoked_at === null
            ? { user_id: s.user_id, expires_at: s.expires_at } : null;
        }
        if (sql.includes("FROM profiles WHERE id")) return db.profiles.get(v[0]) || null;
        if (sql.includes("SELECT id FROM artists WHERE user_id")) {
          const a = [...db.artists.values()].find(x => x.user_id === v[0]);
          return a ? { id: a.id } : null;
        }
        if (sql.includes("FROM artists WHERE user_id")) {
          return [...db.artists.values()].find(x => x.user_id === v[0]) || null;
        }
        if (sql.includes("FROM artists WHERE id")) return db.artists.get(v[0]) || null;
        throw new Error("Unexpected first SQL: " + sql);
      },
      async run() {
        const v = this.values;
        if (sql.includes("INSERT INTO profiles")) {
          const [id, display_name, avatar_url, created_at, updated_at] = v;
          const old = db.profiles.get(id);
          db.profiles.set(id, { id, display_name, avatar_url, role: old?.role || "artist", created_at: old?.created_at || created_at, updated_at });
          return { success: true };
        }
        if (sql.includes("INSERT INTO artists")) {
          const [id,user_id,artist_name,bio,genre,country,created_at,updated_at] = v;
          db.artists.set(id,{id,user_id,artist_name,bio,genre,country,status:"pending",created_at,updated_at});
          return { success: true };
        }
        throw new Error("Unexpected run SQL: " + sql);
      }
    };
  }
  async batch(stmts) {
    const [u,f,s] = stmts.map(x => x.values);
    this.users.set(u[0], { status: "active" });
    this.families.set(f[0], { user_id:f[1], created_at:f[2], revoked_at:null });
    this.sessions.set(s[0], { user_id:s[1], family_id:s[2], created_at:s[3], expires_at:s[4], revoked_at:null });
  }
}
const env = () => ({ DB:new DataD1(), SESSION_PEPPER:"test-pepper-long-enough-for-authentication-123", ALLOWED_ORIGINS:"https://artistlevelup.com.ng" });
async function signedIn(e) {
  const r=await worker.fetch(new Request("https://worker.test/auth/anonymous",{method:"POST"}),e);
  return await r.json();
}
function req(path, method, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request("https://worker.test"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}

test("profile API requires a valid session and scopes the record to that session", async () => {
  const e=env(), session=await signedIn(e);
  assert.equal((await worker.fetch(req("/api/me/profile","GET",null),e)).status,401);
  const save=await worker.fetch(req("/api/me/profile","PUT",session.token,{display_name:"Stage Name",avatar_url:"https://cdn.example/avatar.png",role:"admin"}),e);
  assert.equal(save.status,200);
  const profile=(await save.json()).profile;
  assert.equal(profile.id,session.userId);
  assert.equal(profile.display_name,"Stage Name");
  assert.equal(profile.role,"artist");
  const read=await worker.fetch(req("/api/me/profile","GET",session.token),e);
  assert.equal((await read.json()).profile.display_name,"Stage Name");
});

test("artist API creates a pending artist owned by the authenticated user and prevents duplicates", async () => {
  const e=env(), session=await signedIn(e);
  const created=await worker.fetch(req("/api/me/artist","POST",session.token,{artist_name:"Test Artist",bio:"Hello",genre:"Afrobeats",country:"Nigeria",user_id:"attacker",status:"approved"}),e);
  assert.equal(created.status,201);
  const artist=(await created.json()).artist;
  assert.equal(artist.user_id,session.userId);
  assert.equal(artist.status,"pending");
  assert.equal((await worker.fetch(req("/api/me/artist","POST",session.token,{artist_name:"Second"}),e)).status,409);
  assert.equal((await worker.fetch(req("/api/me/artist","GET",session.token),e)).status,200);
});

test("profile API rejects malformed and oversized payloads", async () => {
  const e=env(), session=await signedIn(e);
  const invalid= new Request("https://worker.test/api/me/profile",{method:"PUT",headers:{Authorization:"Bearer "+session.token,"Content-Type":"application/json"},body:"{"});
  assert.equal((await worker.fetch(invalid,e)).status,400);
  const long=await worker.fetch(req("/api/me/profile","PUT",session.token,{display_name:"x".repeat(81)}),e);
  assert.equal(long.status,400);
});
