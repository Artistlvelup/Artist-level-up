import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { loadWorker } from "./worker-test-loader.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const worker = await loadWorker(import.meta.url);

class DataD1 {
  users = new Map();
  sessions = new Map();
  families = new Map();
  profiles = new Map();
  artists = new Map();
  videos = new Map();
  songs = new Map();
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
        if (sql.includes("FROM artist_videos WHERE id")) {
          const row = db.videos.get(v[0]);
          return row && (!sql.includes("artist_id = ?") || row.artist_id === v[1]) ? { ...row } : null;
        }
        throw new Error("Unexpected first SQL: " + sql);
      },
      async all() {
        const v = this.values;
        if (sql.includes("FROM artist_videos WHERE status IN")) {
          const allowed = new Set(["approved", "published"]);
          return { results: [...db.videos.values()].filter(x => allowed.has(x.status)).slice(0, v[0]).map(x => ({ ...x })) };
        }
        if (sql.includes("FROM artist_videos WHERE artist_id")) {
          return { results: [...db.videos.values()].filter(x => x.artist_id === v[0]).map(x => ({ ...x })) };
        }
        if (sql.includes("FROM artist_videos v LEFT JOIN artists a")) {
          const allowed = new Set(["approved", "published"]);
          return { results: [...db.videos.values()].filter(x => allowed.has(x.status)).slice(0, v[0]).map(x => ({ ...x })) };
        }
        if (sql.includes("FROM songs s LEFT JOIN artists a")) {
          const allowed = new Set(["approved", "published"]);
          return { results: [...db.songs.values()].filter(x => allowed.has(x.status)).slice(0, v[0]).map(x => ({ ...x })) };
        }
        throw new Error("Unexpected all SQL: " + sql);
      },
      async run() {
        const v = this.values;
        if (sql.includes("UPDATE app_sessions SET expires_at = ?")) {
          const [expiresAt, hash, now] = v;
          const session = db.sessions.get(hash);
          if (!session || session.revoked_at !== null || session.expires_at <= now) return { success: true, meta: { changes: 0 } };
          session.expires_at = expiresAt;
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO profiles")) {
          const [id, display_name, avatar_url, created_at, updated_at] = v;
          const old = db.profiles.get(id);
          db.profiles.set(id, { id, display_name, avatar_url, role: old?.role || "user", created_at: old?.created_at || created_at, updated_at });
          return { success: true };
        }
        if (sql.includes("INSERT INTO artists")) {
          const [id,user_id,artist_name,bio,genre,country,created_at,updated_at] = v;
          db.artists.set(id,{id,user_id,artist_name,bio,genre,country,status:"pending",created_at,updated_at,suspended:0});
          return { success: true };
        }
        if (sql.includes("INSERT INTO artist_videos")) {
          const [id,artist_id,title,description,video_url,thumbnail_url,tiktok_url,instagram_url,facebook_url,youtube_url,created_at] = v;
          db.videos.set(id,{id,artist_id,title,description,video_url,thumbnail_url,status:"pending",tiktok_url,instagram_url,facebook_url,youtube_url,views:0,likes:0,created_at});
          return { success: true };
        }
        if (sql.startsWith("UPDATE artist_videos SET")) {
          const setClause = sql.split(" SET ")[1].split(" WHERE ")[0];
          const fields = setClause.split(", ").map(x => x.split(" = ")[0]);
          const id = v[v.length - 2], artistId = v[v.length - 1];
          const row = db.videos.get(id);
          if (row && row.artist_id === artistId) fields.forEach((field, i) => { row[field] = v[i]; });
          return { success: true };
        }
        if (sql.startsWith("DELETE FROM artist_videos")) {
          const [id, artistId] = v;
          const row = db.videos.get(id);
          if (row && row.artist_id === artistId) db.videos.delete(id);
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
const env = () => ({ DB:new DataD1(), SESSION_PEPPER:"test-pepper-long-enough-for-authentication-123", ALLOWED_ORIGINS:"https://artistlevelup.com.ng", R2_PUBLIC_BASE_URL:"https://media.example.test" });
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
  assert.equal(profile.role,"user");
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


test("video metadata API is session- and artist-scoped and never deletes the R2 object", async () => {
  const e = env(), session = await signedIn(e);
  assert.equal((await worker.fetch(req("/api/me/videos","GET",null),e)).status,401);
  const artistResponse = await worker.fetch(req("/api/me/artist","POST",session.token,{artist_name:"Video Artist"}),e);
  assert.equal(artistResponse.status,201);
  const artist = (await artistResponse.json()).artist;
  const videoUrl = "https://media.example.test/" + artist.id + "/videos/upload-1.mp4";
  const rejected = await worker.fetch(req("/api/me/videos","POST",session.token,{title:"Bad source",video_url:"https://evil.example/video.mp4"}),e);
  assert.equal(rejected.status,400);
  const created = await worker.fetch(req("/api/me/videos","POST",session.token,{title:"My upload",description:"First cut",video_url:videoUrl,tiktok_url:"https://www.tiktok.com/@artist"}),e);
  assert.equal(created.status,201);
  const video = (await created.json()).video;
  assert.equal(video.artist_id,artist.id);
  assert.equal(video.status,"pending");
  assert.equal(video.views,0);
  const listed = await worker.fetch(req("/api/me/videos","GET",session.token),e);
  assert.equal((await listed.json()).videos.length,1);

  const otherSession = await signedIn(e);
  const otherArtistResponse = await worker.fetch(req("/api/me/artist","POST",otherSession.token,{artist_name:"Other Artist"}),e);
  assert.equal(otherArtistResponse.status,201);
  const otherList = await worker.fetch(req("/api/me/videos","GET",otherSession.token),e);
  assert.equal((await otherList.json()).videos.length,0);
  assert.equal((await worker.fetch(req("/api/me/videos/" + video.id,"PATCH",otherSession.token,{title:"Hijack"}),e)).status,404);
  assert.equal((await worker.fetch(req("/api/me/videos/" + video.id,"DELETE",otherSession.token),e)).status,404);

  const patched = await worker.fetch(req("/api/me/videos/" + video.id,"PATCH",session.token,{title:"Updated title",status:"published",video_url:"https://evil.example/replaced.mp4"}),e);
  assert.equal(patched.status,200);
  const updated = (await patched.json()).video;
  assert.equal(updated.title,"Updated title");
  assert.equal(updated.status,"pending");
  assert.equal(updated.video_url,videoUrl);
  const deleted = await worker.fetch(req("/api/me/videos/" + video.id,"DELETE",session.token),e);
  assert.equal(deleted.status,200);
  const deletion = await deleted.json();
  assert.equal(deletion.record_deleted,true);
  assert.equal(deletion.media_object_deleted,false);
  const afterDelete = await worker.fetch(req("/api/me/videos","GET",session.token),e);
  assert.equal((await afterDelete.json()).videos.length,0);
});


test("public video feed returns only approved or published videos", async () => {
  const e = env();
  e.DB.videos.set("pending-video", { id:"pending-video", status:"pending", title:"Waiting" });
  e.DB.videos.set("approved-video", { id:"approved-video", status:"approved", title:"Approved" });
  e.DB.videos.set("published-video", { id:"published-video", status:"published", title:"Published" });
  const response = await worker.fetch(req("/api/public/videos?limit=10","GET",null),e);
  assert.equal(response.status,200);
  const videos = (await response.json()).videos;
  assert.deepEqual(videos.map(x => x.id).sort(),["approved-video","published-video"]);
  assert.equal((await worker.fetch(req("/api/public/videos?limit=0","GET",null),e)).status,400);
});


test("public song feed returns only approved or published songs and validates limits", async () => {
  const e = env();
  e.DB.songs.set("draft-song", { id:"draft-song", status:"draft", title:"Draft" });
  e.DB.songs.set("approved-song", { id:"approved-song", status:"approved", title:"Approved" });
  e.DB.songs.set("published-song", { id:"published-song", status:"published", title:"Published" });
  const response = await worker.fetch(req("/api/public/songs?limit=10","GET",null),e);
  assert.equal(response.status,200);
  const songs = (await response.json()).songs;
  assert.deepEqual(songs.map(x => x.id).sort(),["approved-song","published-song"]);
  assert.equal((await worker.fetch(req("/api/public/songs?limit=0","GET",null),e)).status,400);
  assert.equal((await worker.fetch(req("/api/public/songs?limit=invalid","GET",null),e)).status,400);
});
