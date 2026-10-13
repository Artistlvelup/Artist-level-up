import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"};
const esc=(v:string)=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="GET")return new Response("OK",{status:200,headers:cors});
 const fail=(msg:string,status=400)=>new Response("ARTIST LEVEL UP\n\nPAYMENT CHECK\n\n"+msg+"\n\nYou can close this page.",{status,headers:{"content-type":"text/plain; charset=utf-8",...cors}});
 try{
  const url=new URL(req.url),reference=String(url.searchParams.get("reference")||url.searchParams.get("trxref")||"").trim();
  if(!reference)return fail("Payment reference was not returned by Paystack.");
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!,serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),paystackSecret=Deno.env.get("PAYSTACK_SECRET_KEY"),resendKey=Deno.env.get("RESEND_API_KEY");
  if(!serviceRole||!paystackSecret)return fail("Payment verification is not configured.",500);
  const admin=createClient(supabaseUrl,serviceRole);
  const {data:order,error:orderError}=await admin.from("marketplace_orders").select("id,beat_title,producer_name,license,amount_ngn,currency,status,paystack_reference,paid_at,customer_email,receipt_email_sent_at,receipt_email_id").eq("paystack_reference",reference).maybeSingle();
  if(orderError)return fail(orderError.message,500);
  if(!order)return fail("Order not found for this payment reference.",404);
  const payRes=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+paystackSecret,"Content-Type":"application/json"}});
  const pay=await payRes.json().catch(()=>null);
  if(!payRes.ok||pay?.data?.status!=="success")return fail("Paystack has not confirmed this payment yet. Status: "+String(pay?.data?.status||"pending"));
  const paidKobo=Number(pay.data?.amount||0),expectedKobo=Math.round(Number(order.amount_ngn||0)*100);
  if(!Number.isFinite(expectedKobo)||expectedKobo<=0||paidKobo!==expectedKobo)return fail("The payment amount does not match this order.",409);
  if(String(pay.data?.currency||"").toUpperCase()!==String(order.currency||"").toUpperCase())return fail("The payment currency does not match this order.",409);
  if(order.status!=="pending_payment"&&order.status!=="paid")return fail("This order is not awaiting payment.",409);
  const payEmail=String(pay.data?.customer?.email||"").trim().toLowerCase();
  const patch:any={status:"paid",paid_at:order.paid_at||new Date().toISOString(),updated_at:new Date().toISOString()};
  if(!order.customer_email&&payEmail)patch.customer_email=payEmail;
  const {data:finalOrder,error:updateError}=await admin.from("marketplace_orders").update(patch).eq("id",order.id).select("id,beat_title,producer_name,license,amount_ngn,currency,status,paystack_reference,paid_at,customer_email,receipt_email_sent_at,receipt_email_id").single();
  if(updateError)return fail(updateError.message,500);
  let emailNote="Receipt email not sent.";
  const recipient=String(finalOrder.customer_email||payEmail||"").trim().toLowerCase();
  if(!finalOrder.receipt_email_sent_at&&resendKey&&recipient){
   const amount=Number(finalOrder.amount_ngn||0).toLocaleString("en-NG",{maximumFractionDigits:0}),from=Deno.env.get("RESEND_FROM_EMAIL")||"Artist Level Up <onboarding@resend.dev>";
   const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px"><div style="max-width:620px;margin:auto;background:#fff;padding:28px;border-radius:14px"><h1>ARTIST LEVEL UP</h1><h2>Payment Successful</h2><p>Your beat order has been confirmed.</p><hr><p><b>Beat:</b> ${esc(finalOrder.beat_title)}</p><p><b>Producer:</b> ${esc(finalOrder.producer_name)}</p><p><b>Licence:</b> ${esc(finalOrder.license)}</p><p><b>Amount:</b> NGN ${esc(amount)}</p><p><b>Reference:</b> ${esc(finalOrder.paystack_reference)}</p><p><b>Paid:</b> ${esc(finalOrder.paid_at)}</p><hr><p>Thank you for using Artist Level Up.</p></div></body></html>`;
   const mailRes=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from,to:[recipient],subject:"Artist Level Up — Payment Receipt",html,text:"ARTIST LEVEL UP\n\nPAYMENT SUCCESSFUL\n\nBeat: "+String(finalOrder.beat_title||"Beat")+"\nProducer: "+String(finalOrder.producer_name||"Producer")+"\nLicence: "+String(finalOrder.license||"Premium")+"\nAmount: NGN "+amount+"\nReference: "+String(finalOrder.paystack_reference||reference)+"\nPaid: "+String(finalOrder.paid_at||""),headers:{"X-Entity-Ref-ID":String(finalOrder.paystack_reference||reference)}})});
   const mail=await mailRes.json().catch(()=>null);
   if(mailRes.ok&&mail?.id){await admin.from("marketplace_orders").update({receipt_email_sent_at:new Date().toISOString(),receipt_email_id:String(mail.id),updated_at:new Date().toISOString()}).eq("id",finalOrder.id);emailNote="Receipt email sent to "+recipient+"."}else emailNote="Receipt email could not be sent yet: "+String(mail?.message||"Resend rejected the email request.");
  }else if(finalOrder.receipt_email_sent_at)emailNote="Receipt email was already sent.";
  else if(!recipient)emailNote="No customer email was available from the Paystack transaction.";
  else if(!resendKey)emailNote="RESEND_API_KEY is not configured.";
  const appUrl="https://artistlvelup.github.io/Artist-level-up/";
  return new Response(null,{status:302,headers:{...cors,Location:appUrl+"?payment=success&reference="+encodeURIComponent(String(finalOrder.paystack_reference||reference))}});
 }catch(e){return fail(String((e as any)?.message||e),500)}
});