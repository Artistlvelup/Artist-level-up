/* Upload pricing: artist music upload ₦5,000 per song; Nigerian beat marketplace upload remains ₦5,000. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
const allowedHosts=new Set(["artistlvelup.github.io","artist-level-up.vercel.app","artist-level-up-v101-launch-hardening-vwiq.onrender.com","artistlevelup.com.ng","www.artistlevelup.com.ng"]);
const safeReturnBase=(candidate:string)=>{
 try{const u=new URL(candidate),path=u.pathname.replace(/\/+$/,"")||"/";if(u.protocol==="https:"&&allowedHosts.has(u.hostname)&&(["/","/Artist-level-up"].includes(path)))return u.origin+(path==="/Artist-level-up"?"/Artist-level-up/":"/");}catch(_){}
 return "https://artistlvelup.github.io/Artist-level-up/";
};
const countryPrices:Record<string,{countryCode:string;currency:string;amount:number;provider:"flutterwave"|"paystack";label:string}> = {
  "Nigeria":{countryCode:"NG",currency:"NGN",amount:5000,provider:"paystack",label:"₦5,000"},
  "Ghana":{countryCode:"GH",currency:"GHS",amount:70,provider:"flutterwave",label:"GH₵70"},
  "South Africa":{countryCode:"ZA",currency:"ZAR",amount:100,provider:"flutterwave",label:"R100"},
  "Kenya":{countryCode:"KE",currency:"KES",amount:780,provider:"flutterwave",label:"KSh 780"},
  "United Kingdom":{countryCode:"GB",currency:"GBP",amount:4.5,provider:"flutterwave",label:"£4.50"},
  "United States":{countryCode:"US",currency:"USD",amount:6,provider:"flutterwave",label:"US$6.00"},
  "France":{countryCode:"FR",currency:"EUR",amount:5.5,provider:"flutterwave",label:"€5.50"},
  "Spain":{countryCode:"ES",currency:"EUR",amount:5.5,provider:"flutterwave",label:"€5.50"},
  "Canada":{countryCode:"CA",currency:"CAD",amount:8.5,provider:"flutterwave",label:"C$8.50"},
  "Australia":{countryCode:"AU",currency:"USD",amount:6,provider:"flutterwave",label:"US$6.00"},
  "Brazil":{countryCode:"BR",currency:"USD",amount:6,provider:"flutterwave",label:"US$6.00"}
};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 try{
  const auth=String(req.headers.get("Authorization")||""),token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({ok:false,error:"Sign in first."},401);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:ue}=await client.auth.getUser(token);
  if(ue||!user?.id||!user.email)return json({ok:false,error:"Your sign-in session is invalid. Sign in again."},401);
  const body=await req.json().catch(()=>({})),type=String(body.upload_type||""),action=String(body.action||"checkout"),returnBase=safeReturnBase(String(body.return_url||""));
  const admin=createClient(url,role,{auth:{persistSession:false,autoRefreshToken:false}});
  if(action==="consume"){
   if(type!=="music")return json({ok:false,error:"Only artist music upload fees can be consumed here."},400);
   const feeId=String(body.fee_payment_id||"").trim(),songId=String(body.song_id||"").trim();
   if(!feeId||!songId)return json({ok:false,error:"A paid fee ID and saved song ID are required."},400);
   const {data:credit,error:ce}=await admin.from("upload_fee_payments").select("id,user_id,upload_type,status,paid_at,consumed_at,consumed_song_id").eq("id",feeId).eq("user_id",user.id).eq("upload_type","music").eq("status","paid").maybeSingle();
   if(ce)throw ce;
   if(!credit)return json({ok:false,error:"No verified music-upload payment was found for this account."},409);
   const {data:artist,error:ae}=await admin.from("artists").select("id").eq("user_id",user.id).maybeSingle();
   if(ae)throw ae;
   if(!artist?.id)return json({ok:false,error:"Artist profile not found for this account."},403);
   const {data:song,error:se}=await admin.from("songs").select("id,artist_id,created_at").eq("id",songId).eq("artist_id",artist.id).maybeSingle();
   if(se)throw se;
   if(!song)return json({ok:false,error:"The saved song does not belong to this artist."},403);
   if(!credit.paid_at||new Date(song.created_at).getTime()<=new Date(credit.paid_at).getTime())return json({ok:false,error:"This song was not created after the verified payment."},409);
   if(credit.consumed_at)return credit.consumed_song_id===song.id?json({ok:true,consumed:true,already_consumed:true}):json({ok:false,error:"This music-upload payment has already been used."},409);
   const {data:used,error:ue2}=await admin.from("upload_fee_payments").update({consumed_at:new Date().toISOString(),consumed_song_id:song.id}).eq("id",credit.id).eq("status","paid").is("consumed_at",null).select("id").maybeSingle();
   if(ue2)throw ue2;
   if(!used){
    const {data:latest,error:le}=await admin.from("upload_fee_payments").select("consumed_at,consumed_song_id").eq("id",credit.id).maybeSingle();
    if(le)throw le;
    if(latest?.consumed_song_id!==song.id)return json({ok:false,error:"This music-upload payment has already been used."},409);
   }
   return json({ok:true,consumed:true});
  }
  if(!["music","beat"].includes(type))return json({ok:false,error:"Upload type must be music or beat."},400);
  const {data:paid,error:pe}=await admin.from("upload_fee_payments").select("id,payment_reference,paid_at,amount_major,currency,provider,country_code").eq("user_id",user.id).eq("upload_type",type).eq("status","paid").is("consumed_at",null).order("paid_at",{ascending:false}).limit(1).maybeSingle();
  if(pe)throw pe;
  if(paid){
   const amount=Number(paid.amount_major||0),currency=String(paid.currency||"NGN");
   const label=currency==="NGN"?"₦"+amount.toLocaleString("en-NG"):currency+" "+amount.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
   return json({ok:true,paid:true,amount,currency,fee_display:label,fee_payment_id:paid.id});
  }
  let country=String(body.country||user.user_metadata?.country||"Nigeria").trim();
  const {data:artist,error:ae}=await admin.from("artists").select("country").eq("user_id",user.id).maybeSingle();
  if(ae)throw ae;
  if(artist?.country)country=String(artist.country).trim();
  const countryAliases:Record<string,string>={NG:"Nigeria",GH:"Ghana",ZA:"South Africa",KE:"Kenya",GB:"United Kingdom",UK:"United Kingdom",US:"United States",USA:"United States",FR:"France",ES:"Spain",CA:"Canada",AU:"Australia",BR:"Brazil"};
  const countryKey=countryPrices[country]?country:(countryAliases[country.toUpperCase()]||country);
  let price:{countryCode:string;currency:string;amount:number;provider:"flutterwave"|"paystack";label:string};
  if(countryKey==="Nigeria")price=countryPrices.Nigeria;
  else price=countryPrices[countryKey]||{countryCode:/^[A-Z]{2}$/.test(countryKey.toUpperCase())?countryKey.toUpperCase():"",currency:"USD",amount:6,provider:"flutterwave",label:"US$6.00"};
  const secret=price.provider==="paystack"?Deno.env.get("PAYSTACK_SECRET_KEY"):Deno.env.get("FLW_SECRET_KEY");
  if(!secret)return json({ok:false,error:(price.provider==="paystack"?"Paystack":"Flutterwave")+" is not configured. Please try again later."},503);
  const reference="ALU-UP-"+crypto.randomUUID().replaceAll("-","").slice(0,24);
  const {error:ie}=await admin.from("upload_fee_payments").insert({user_id:user.id,upload_type:type,amount_ngn:price.currency==="NGN"?price.amount:5000,amount_major:price.amount,currency:price.currency,provider:price.provider,country_code:price.countryCode||null,payment_reference:reference,status:"pending"});
  if(ie)throw ie;
  if(price.provider==="paystack"){
   const callback=url+"/functions/v1/upload-fee-callback?return_url="+encodeURIComponent(returnBase);
   const r=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount:String(Math.round(price.amount*100)),currency:price.currency,reference,callback_url:callback,metadata:{upload_fee_payment:true,upload_type:type,user_id:user.id,country_code:price.countryCode,amount_major:price.amount,currency:price.currency,return_url:returnBase}})});
   const j=await r.json().catch(()=>null);
   if(!r.ok||j?.status!==true||!j?.data?.authorization_url){await admin.from("upload_fee_payments").update({status:"failed"}).eq("payment_reference",reference).eq("status","pending");return json({ok:false,error:String(j?.message||"Paystack could not start checkout. Please try again.")},502);}
   return json({ok:true,paid:false,provider:price.provider,amount:price.amount,currency:price.currency,fee_display:price.label,reference,authorization_url:j.data.authorization_url});
  }
  const callback=url+"/functions/v1/upload-fee-callback?return_url="+encodeURIComponent(returnBase);
  const r=await fetch("https://api.flutterwave.com/v3/payments",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({tx_ref:reference,amount:price.amount,currency:price.currency,redirect_url:callback,payment_options:"card",customer:{email:user.email,name:String(user.user_metadata?.name||user.email)},customizations:{title:"Artist Level Up",description:"Music upload fee"},meta:{upload_fee_payment:true,upload_type:type,user_id:user.id,country_code:price.countryCode,amount_major:price.amount,currency:price.currency,return_url:returnBase}})});
  const j=await r.json().catch(()=>null);
  if(!r.ok||j?.status!=="success"||!j?.data?.link){await admin.from("upload_fee_payments").update({status:"failed"}).eq("payment_reference",reference).eq("status","pending");return json({ok:false,error:String(j?.message||"Flutterwave could not start checkout. Please try again.")},502);}
  return json({ok:true,paid:false,provider:price.provider,amount:price.amount,currency:price.currency,fee_display:price.label,reference,authorization_url:j.data.link});
 }catch(e){console.error("upload-fee-checkout:",e);return json({ok:false,error:String((e as any)?.message||"Could not start upload-fee checkout.")},500);}
});