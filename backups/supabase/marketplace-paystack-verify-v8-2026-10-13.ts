import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
 try{
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return json({ok:false,error:"Authentication required"},401);
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!,serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),paystackSecret=Deno.env.get("PAYSTACK_SECRET_KEY");
  if(!serviceRole||!paystackSecret)return json({ok:false,error:"Payment verification is not configured"},500);
  const admin=createClient(supabaseUrl,serviceRole);
  const {data:{user},error:userError}=await admin.auth.getUser(auth.slice(7).trim());
  if(userError||!user)return json({ok:false,error:"Invalid session"},401);
  const body=await req.json().catch(()=>({}));
  let reference=String(body?.reference||body?.trxref||"").trim();
  const orderId=String(body?.order_id||"").trim();
  let order:any=null;
  if(reference){
   const r=await admin.from("marketplace_orders").select("id,buyer_user_id,beat_id,beat_title,producer_name,license,amount_ngn,currency,status,paystack_reference,paid_at").eq("paystack_reference",reference).maybeSingle();
   if(r.error)throw r.error; order=r.data;
  }else if(orderId){
   const r=await admin.from("marketplace_orders").select("id,buyer_user_id,beat_id,beat_title,producer_name,license,amount_ngn,currency,status,paystack_reference,paid_at").eq("id",orderId).maybeSingle();
   if(r.error)throw r.error; order=r.data;
  }else{
   const r=await admin.from("marketplace_orders").select("id,buyer_user_id,beat_id,beat_title,producer_name,license,amount_ngn,currency,status,paystack_reference,paid_at").eq("buyer_user_id",user.id).in("status",["pending_payment","paid"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
   if(r.error)throw r.error; order=r.data;
  }
  if(!order)return json({ok:false,error:"Order not found"},404);
  if(String(order.buyer_user_id)!==String(user.id))return json({ok:false,error:"Order does not belong to this account"},403);
  reference=String(order.paystack_reference||reference).trim();
  if(!reference)return json({ok:false,error:"Payment reference is missing"},400);
  if(order.status==="paid")return json({ok:true,status:"paid",order});
  const payRes=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+paystackSecret,"Content-Type":"application/json"}});
  const payData=await payRes.json().catch(()=>null);
  if(!payRes.ok||!payData?.status||payData?.data?.status!=="success")return json({ok:false,status:payData?.data?.status||"pending",error:payData?.message||"Payment is not confirmed yet"});
  const paidAmountKobo=Number(payData.data?.amount||0),expectedKobo=Math.round(Number(order.amount_ngn||0)*100);
  if(expectedKobo&&paidAmountKobo!==expectedKobo)return json({ok:false,error:"Payment amount does not match this order"},409);
  const {data:updated,error:updateError}=await admin.from("marketplace_orders").update({status:"paid",paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",order.id).select("id,beat_id,beat_title,producer_name,license,amount_ngn,currency,status,paystack_reference,paid_at").single();
  if(updateError)throw updateError;
  return json({ok:true,status:"paid",order:updated});
 }catch(e){return json({ok:false,error:String(e?.message||e)},500);}
});