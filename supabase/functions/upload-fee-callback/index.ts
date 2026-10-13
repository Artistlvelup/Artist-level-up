/* Verify Paystack and Flutterwave upload-fee payments before marking a fee paid. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":"no-store"};
const success=(type:string,ref:string,provider:string)=>Response.redirect("https://artistlvelup.github.io/Artist-level-up/?upload_fee=paid&type="+encodeURIComponent(type)+"&reference="+encodeURIComponent(ref)+"&provider="+encodeURIComponent(provider),302);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const fail=(m:string,s=400)=>new Response("ARTIST LEVEL UP\n\nUPLOAD FEE PAYMENT\n\n"+m+"\n\nReturn to Artist Level Up and retry.",{status:s,headers:{...cors,"content-type":"text/plain; charset=utf-8"}});
 try{
  if(req.method!=="GET")return fail("GET required.",405);
  const u=new URL(req.url),ref=String(u.searchParams.get("reference")||u.searchParams.get("trxref")||u.searchParams.get("tx_ref")||"").trim(),tid=String(u.searchParams.get("transaction_id")||"").trim();
  if(!ref)return fail("Payment reference was not returned.");
  const url=Deno.env.get("SUPABASE_URL")!,role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!role)return fail("Server-side payment verification is not configured.",500);
  const admin=createClient(url,role);
  const {data:p,error}=await admin.from("upload_fee_payments").select("id,user_id,upload_type,amount_ngn,amount_major,currency,provider,status,payment_reference").eq("payment_reference",ref).maybeSingle();
  if(error)throw error;
  if(!p)return fail("Upload fee payment reference not found.",404);
  const provider=String(p.provider||"paystack").toLowerCase(),currency=String(p.currency||"NGN").toUpperCase(),expected=Number(p.amount_major??p.amount_ngn);
  if(!Number.isFinite(expected)||expected<=0)return fail("The expected payment amount is invalid.",409);
  if(p.status==="paid")return success(p.upload_type,p.payment_reference,provider);
  if(p.status!=="pending")return fail("This payment is no longer pending. Contact support if you were charged.",409);
  if(provider==="paystack"){
   const secret=Deno.env.get("PAYSTACK_SECRET_KEY");if(!secret)return fail("Paystack verification is not configured.",500);
   const pr=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(p.payment_reference),{headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"}});
   const v=await pr.json().catch(()=>null),d=v?.data;
   if(!pr.ok||v?.status!==true||d?.status!=="success")return fail("Paystack has not confirmed this payment. Check your transaction status before retrying.");
   if(String(d.reference)!==String(p.payment_reference)||String(d.currency).toUpperCase()!==currency||currency!=="NGN"||Number(d.amount)!==Math.round(expected*100))return fail("Verified payment amount, currency or reference does not match this upload fee.",409);
   const meta=d.metadata||{};
   if(meta.upload_fee_payment!==true||String(meta.user_id)!==String(p.user_id)||String(meta.upload_type)!==p.upload_type)return fail("Payment metadata does not match this upload fee record.",409);
  }else if(provider==="flutterwave"){
   const secret=Deno.env.get("FLW_SECRET_KEY");if(!secret)return fail("Flutterwave verification is not configured.",500);
   const verifyUrl=tid?"https://api.flutterwave.com/v3/transactions/"+encodeURIComponent(tid)+"/verify":"https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref="+encodeURIComponent(p.payment_reference);
   const vr=await fetch(verifyUrl,{headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"}}),v=await vr.json().catch(()=>null),d=v?.data;
   if(!vr.ok||v?.status!=="success"||d?.status!=="successful")return fail("Flutterwave has not confirmed this payment. Check your transaction status before retrying.");
   if(String(d.tx_ref)!==String(p.payment_reference)||String(d.currency).toUpperCase()!==currency||Math.abs(Number(d.amount)-expected)>0.01)return fail("Verified payment amount, currency or reference does not match this upload fee.",409);
  }else return fail("Unsupported payment provider.",409);
  const {data:updated,error:up}=await admin.from("upload_fee_payments").update({status:"paid",paid_at:new Date().toISOString()}).eq("id",p.id).eq("status","pending").select("id").maybeSingle();
  if(up)throw up;
  if(!updated){
   const {data:latest,error:le}=await admin.from("upload_fee_payments").select("status").eq("id",p.id).maybeSingle();
   if(le)throw le;
   if(latest?.status!=="paid")return fail("Payment status changed before confirmation. Contact support before trying again.",409);
  }
  return success(p.upload_type,p.payment_reference,provider);
 }catch(e){console.error("upload-fee-callback:",e);return fail(String((e as any)?.message||"Payment verification failed."),500);}
});