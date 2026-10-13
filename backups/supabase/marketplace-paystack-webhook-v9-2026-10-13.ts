import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function hmac(secret:string, body:string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-512"}, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", {status:200});
  try {
    const raw = await req.text();
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) return new Response("not configured",{status:500});
    const signature = req.headers.get("x-paystack-signature") || "";
    const expected = await hmac(secret, raw);
    if (signature !== expected) return new Response("invalid signature",{status:401});

    const event = JSON.parse(raw);
    if (event.event !== "charge.success") return new Response("ignored",{status:200});

    const reference = String(event.data?.reference || "");
    if (!reference) return new Response("missing reference",{status:400});

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order } = await admin.from("marketplace_orders")
      .select("id,status")
      .eq("paystack_reference", reference)
      .single();
    if (!order) return new Response("order not found",{status:404});

    await admin.from("marketplace_orders").update({
      status:"paid",
      paid_at:new Date().toISOString()
    }).eq("id", order.id);

    return new Response("ok",{status:200});
  } catch (e) {
    return new Response(String(e?.message || e),{status:400});
  }
});