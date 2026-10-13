import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const fail=(m:string,s=400)=>new Response("ARTIST LEVEL UP\n\nUPLOAD FEE PAYMENT\n\n"+m+"\n\nReturn to Artist Level Up and retry.",{status:s,headers:{...cors,"content-type":"text/plain; charset=utf-8"}});
 try{
  const u=new URL(req.url),ref=String(u.searchParams.get("reference")||u.searchParams.get("trxref")||"").trim();
  if(!ref)return fail("Paystack did not return a payment reference.");
  const url=Deno.env.get("SUPABASE_URL")!,role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("PAYSTACK_SECRET_KEY");
  if(!role||!secret)return fail("Server-side payment verification is not configured.",500);
  const admin=createClient(url,role);
  const {data:p,error}=await admin.from("upload_fee_payments").select("id,user_id,upload_type,amount_ngn,status,payment_reference").eq("payment_reference",ref).maybeSingle();
  if(error)throw error;if(!p)return fail("Upload fee payment reference not found.",404);
  const pr=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(ref),{headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"}});
  const verified=await pr.json().catch(()=>null);
  if(!pr.ok||verified?.status!==true||verified?.data?.status!=="success")return fail("Paystack has not confirmed this payment. Do not retry payment until you check your transaction status.");
  if(String(verified.data.reference)!==ref||Number(verified.data.amount)!==1500000||String(verified.data.currency)!=="NGN")return fail("Verified payment amount, currency or reference does not match the required ₦15,000 upload fee.",409);
  const meta=verified.data.metadata||{};
  if(meta.upload_fee_payment!==true||String(meta.user_id)!==String(p.user_id)||String(meta.upload_type)!==p.upload_type)return fail("Payment metadata does not match this upload fee record.",409);
  const {error:up}=await admin.from("upload_fee_payments").update({status:"paid",paid_at:new Date().toISOString()}).eq("id",p.id).neq("status","paid");
  if(up)throw up;
  return Response.redirect("https://artistlvelup.github.io/Artist-level-up/?upload_fee=paid&type="+encodeURIComponent(p.upload_type)+"&reference="+encodeURIComponent(ref),302);
 }catch(e){return fail(String((e as any)?.message||e),500)}
});