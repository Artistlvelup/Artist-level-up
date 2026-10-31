import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

class SongsD1 {
  users = new Map(); sessions = new Map(); families = new Map(); artists = new Map(); songs = new Map();
  prepare(sql) {
    const db=this;
    return {
      values:[], bind(...v){this.values=v;return this;},
      async first(){
        const v=this.values;
        if(sql.includes("SELECT s.user_id")) {
          const s=db.sessions.get(v[0]), u=s&&db.users.get(s.user_id), f=s&&db.families.get(s.family_id);
          return s&&s.revoked_at===null&&s.expires_at>v[1]&&u?.status==="active"&&f?.revoked_at===null?{user_id:s.user_id,expires_at:s.expires_at}:null;
        }
        if(sql.includes("SELECT id FROM artists WHERE user_id")) {
          const a=[...db.artists.values()].find(x=>x.user_id===v[0]&&x.suspended===0); return a?{id:a.id}:null;
        }
        if(sql.includes("SELECT id, artist_id")&&sql.includes("FROM songs")) {
          const song=db.songs.get(v[0]); return song&&song.artist_id===v[1]?song:null;
        }
        if(sql.includes("SELECT id FROM songs")) {
          const song=db.songs.get(v[0]); return song&&song.artist_id===v[1]?{id:song.id}:null;
        }
        throw new Error("Unexpected first SQL "+sql);
      },
      async run(){
        const v=this.values;
        if(sql.includes("INSERT INTO songs")) {
          const [id,artist_id,title,genre,cover_url,duration_seconds,created_at,updated_at]=v;
          db.songs.set(id,{id,artist_id,title,genre,audio_url:null,cover_url,duration_seconds,status:"draft",created_at,updated_at});
          return {success:true};
        }
        if(sql.startsWith("UPDATE songs SET")) {
          const id=v[v.length-2], artistId=v[v.length-1], song=db.songs.get(id);
          if(song&&song.artist_id===artistId) {
            const sets=sql.slice("UPDATE songs SET ".length).split(", ");
            sets.forEach((part,i)=>{const col=part.split(" = ")[0];song[col]=v[i];});
          }
          return {success:true};
        }
        throw new Error("Unexpected run SQL "+sql);
      },
      async all(){
        if(sql.includes("FROM songs WHERE artist_id")) {
          return {results:[...db.songs.values()].filter(x=>x.artist_id===this.values[0])};
        }
        if(sql.includes("status IN")) return {results:[...db.songs.values()].filter(x=>["published","approved"].includes(x.status)).slice(0,this.values[0])};
        throw new Error("Unexpected all SQL "+sql);
      }
    };
  }
  async batch(stmts){
    const u=stmts[0].values,f=stmts[1].values,s=stmts[2].values;
    this.users.set(u[0],{status:"active"});
    this.families.set(f[0],{user_id:f[1],created_at:f[2],revoked_at:null});
    this.sessions.set(s[0],{user_id:s[1],family_id:s[2],created_at:s[3],expires_at:s[4],revoked_at:null});
  }
}
const env=()=>{const DB=new SongsD1();return {DB,SESSION_PEPPER:"test-pepper-long-enough-for-authentication-123",ALLOWED_ORIGINS:"https://artistlevelup.com.ng"};};
async function session(e){
  const r=await worker.fetch(new Request("https://worker.test/auth/anonymous",{method:"POST"}),e);
  const body=await r.json();
  const id=crypto.randomUUID();
  e.DB.artists.set(id,{id,user_id:body.userId,suspended:0});
  return {token:body.token,userId:body.userId,artistId:id};
}
function req(path,method,token,body){
  const headers={};if(token)headers.Authorization="Bearer "+token;if(body!==undefined)headers["Content-Type"]="application/json";
  return new Request("https://worker.test"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}

test("song creation is scoped to the session artist and ignores client status or artist IDs",async()=>{
  const e=env(),s=await session(e);
  const r=await worker.fetch(req("/api/me/songs","POST",s.token,{title:"My Track",genre:"Afrobeats",artist_id:"other",status:"published",audio_url:"https://evil.example/file"}),e);
  assert.equal(r.status,201);
  const song=(await r.json()).song;
  assert.equal(song.artist_id,s.artistId);
  assert.equal(song.status,"draft");
  assert.equal(song.audio_url,null);
  assert.equal((await worker.fetch(req("/api/me/songs","GET",s.token),e)).status,200);
});

test("song update cannot change status or modify another artist's song",async()=>{
  const e=env(),s=await session(e),other=await session(e);
  const created=await worker.fetch(req("/api/me/songs","POST",s.token,{title:"Original"}),e);
  const song=(await created.json()).song;
  assert.equal((await worker.fetch(req("/api/me/songs/"+song.id,"PATCH",other.token,{title:"Hijack"}),e)).status,404);
  const update=await worker.fetch(req("/api/me/songs/"+song.id,"PATCH",s.token,{title:"Updated",status:"published"}),e);
  assert.equal(update.status,200);
  const saved=(await update.json()).song;
  assert.equal(saved.title,"Updated");
  assert.equal(saved.status,"draft");
});

test("song API rejects missing authentication and invalid duration",async()=>{
  const e=env(),s=await session(e);
  assert.equal((await worker.fetch(req("/api/me/songs","GET",null),e)).status,401);
  assert.equal((await worker.fetch(req("/api/me/songs","POST",s.token,{title:"Bad",duration_seconds:-3}),e)).status,400);
});
