import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source=readFileSync(new URL("./worker.js",import.meta.url),"utf8");
const {default:worker}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
class PromoD1{
 users=new Map();sessions=new Map();families=new Map();artists=new Map();videos=new Map();promotions=new Map();
 prepare(sql){const db=this;return{values:[],bind(...v){this.values=v;return this;},async first(){
  const v=this.values;
  if(sql.includes("SELECT s.user_id")){const s=db.sessions.get(v[0]),u=s&&db.users.get(s.user_id),f=s&&db.families.get(s.family_id);return s&&s.revoked_at===null&&s.expires_at>v[1]&&u?.status==="active"&&f?.revoked_at===null?{user_id:s.user_id}:null;}
  if(sql.includes("SELECT id FROM artists")){const a=[...db.artists.values()].find(x=>x.user_id===v[0]&&x.suspended===0);return a?{id:a.id}:null;}
  if(sql.includes("SELECT id FROM artist_videos")){const x=db.videos.get(v[0]);return x&&x.artist_id===v[1]?{id:x.id}:null;}
  throw new Error("Unexpected SQL "+sql);
 },async run(){const v=this.values;if(sql.includes("INSERT INTO promotions")){const [id,artist_id,title,description,budget,status,starts_at,ends_at,created_at,target_type,video_id]=[v[0],v[1],v[2],v[3],v[4],"pending",v[5],v[6],v[7],v[8],v[9]];db.promotions.set(id,{id,artist_id,title,description,budget,status,starts_at,ends_at,created_at,target_type,video_id});return{success:true};}throw new Error("Unexpected run "+sql);}};}
 async batch(stmts){const u=stmts[0].values,f=stmts[1].values,s=stmts[2].values;this.users.set(u[0],{status:"active"});this.families.set(f[0],{user_id:f[1],created_at:f[2],revoked_at:null});this.sessions.set(s[0],{user_id:s[1],family_id:s[2],created_at:s[3],expires_at:s[4],revoked_at:null});}}
const env=()=>({DB:new PromoD1(),SESSION_PEPPER:"test-pepper-long-enough-for-authentication-123",ALLOWED_ORIGINS:"https://artistlevelup.com.ng"});
async function signin(e){const r=await worker.fetch(new Request("https://worker.test/auth/anonymous",{method:"POST"}),e);const b=await r.json();const id=crypto.randomUUID();e.DB.artists.set(id,{id,user_id:b.userId,suspended:0});return b;}
function post(token,body){return new Request("https://worker.test/api/me/promotions",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});}
test("promotion creation derives artist ownership and forces pending status",async()=>{const e=env(),s=await signin(e);const r=await worker.fetch(post(s.token,{title:"Launch campaign",budget:5000,artist_id:"forged",status:"approved"}),e);assert.equal(r.status,201);const p=(await r.json()).promotion;assert.equal(p.artist_id,[...e.DB.artists.keys()][0]);assert.equal(p.status,"pending");assert.equal(e.DB.promotions.size,1);});
test("promotion endpoint rejects unauthenticated and invalid campaign data",async()=>{const e=env(),s=await signin(e);assert.equal((await worker.fetch(post("",{title:"X",budget:1}),e)).status,401);assert.equal((await worker.fetch(post(s.token,{title:"X",budget:-1}),e)).status,400);});
