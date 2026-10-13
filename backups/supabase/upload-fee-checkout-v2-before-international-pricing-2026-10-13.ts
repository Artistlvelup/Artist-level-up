import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json"}});
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 try{
  const auth=req.headers.get("Authorization")||"",token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({ok:false,error:"Sign in first."},401);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,secret=Deno.env.get("PAYSTACK_SECRET_KEY");
  if(!role||!secret)return json({ok:false,error:"Upload fee payment is not configured."},500);
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}}}),admin=createClient(url,role);
  const {data:{user},error:ue}=await client.auth.getUser(token);if(ue||!user)return json({ok:false,error:"Invalid session."},401);
  const body=await req.json().catch(()=>({})),type=String(body.upload_type||"");
  if(!["music","beat"].includes(type))return json({ok:false,error:"Upload type must be music or beat."},400);
  const {data:paid,error:pe}=await admin.from("upload_fee_payments").select("id,payment_reference,paid_at").eq("user_id",user.id).eq("upload_type",type).eq("status","paid").is("consumed_at",null).order("paid_at",{ascending:false}).limit(1).maybeSingle();
  if(pe)throw pe;if(paid)return json({ok:true,paid:true,amount_ngn:15000,fee_payment_id:paid.id});
  const reference="ALU-UP-"+crypto.randomUUID().replaceAll("-","").slice(0,24);
  const {error:ie}=await admin.from("upload_fee_payments").insert({user_id:user.id,upload_type:type,amount_ngn:15000,payment_reference:reference,status:"pending"});
  if(ie)throw ie;
  const callback=url+"/functions/v1/upload-fee-callback";
  const r=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount:"1500000",currency:"NGN",reference,callback_url:callback,metadata:{upload_fee_payment:true,upload_type:type,user_id:user.id}})});
  const j=await r.json().catch(()=>null);
  if(!r.ok||j?.status!==true||!j?.data?.authorization_url){await admin.from("upload_fee_payments").update({status:"failed"}).eq("payment_reference",reference);return json({ok:false,error:String(j?.message||"Could not initialize Paystack payment.")},502)}
  return json({ok:true,paid:false,amount_ngn:15000,reference,authorization_url:j.data.authorization_url});
 }catch(e){return json({ok:false,error:String((e as any)?.message||e)},500)}
});