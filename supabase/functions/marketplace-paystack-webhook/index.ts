import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha512(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const reply = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-paystack-signature",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
  if (req.method !== "POST") return reply("method not allowed", 405);

  try {
    const raw = await req.text();
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceRole) {
      console.error("Webhook configuration is incomplete");
      return reply("temporarily unavailable", 503);
    }

    const signature = req.headers.get("x-paystack-signature") || "";
    const expectedSignature = await hmacSha512(secret, raw);
    if (!safeEqual(signature.toLowerCase(), expectedSignature)) return reply("invalid signature", 401);

    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return reply("invalid payload", 400);
    }

    if (event?.event !== "charge.success") return reply("ignored", 200);
    const tx = event?.data;
    if (!tx || tx.status !== "success") return reply("payment not successful", 400);

    const reference = String(tx.reference || "").trim();
    if (!reference) return reply("missing reference", 400);

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: order, error: orderError } = await admin
      .from("marketplace_orders")
      .select("id,status,amount_ngn,currency,paystack_reference")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (orderError) {
      console.error("Could not load marketplace order", orderError.code);
      return reply("temporarily unavailable", 503);
    }
    if (!order) {
      console.warn("Paystack reference has no matching marketplace order");
      return reply("order not found", 404);
    }

    if (String(order.paystack_reference || "") !== reference) return reply("reference mismatch", 409);
    if (String(tx.currency || "").toUpperCase() !== String(order.currency || "").toUpperCase()) {
      console.warn("Paystack currency mismatch for order", order.id);
      return reply("currency mismatch", 409);
    }

    const expectedKobo = Math.round(Number(order.amount_ngn) * 100);
    const paidKobo = Number(tx.amount);
    if (!Number.isFinite(expectedKobo) || expectedKobo <= 0 ||
        !Number.isFinite(paidKobo) || paidKobo !== expectedKobo) {
      console.warn("Paystack amount mismatch for order", order.id);
      return reply("amount mismatch", 409);
    }

    if (order.status === "paid") return reply("ok", 200);
    if (order.status !== "pending_payment") {
      console.warn("Order is not awaiting payment", order.id, order.status);
      return reply("order is not awaiting payment", 409);
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("marketplace_orders")
      .update({ status: "paid", paid_at: now, updated_at: now })
      .eq("id", order.id)
      .eq("status", "pending_payment")
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("Could not update marketplace order", updateError.code);
      return reply("temporarily unavailable", 503);
    }
    // A duplicate webhook may race with another valid callback. Re-read before deciding.
    if (!updated) {
      const { data: latest, error: latestError } = await admin
        .from("marketplace_orders")
        .select("status")
        .eq("id", order.id)
        .maybeSingle();
      if (latestError) return reply("temporarily unavailable", 503);
      if (latest?.status === "paid") return reply("ok", 200);
      return reply("order state changed", 409);
    }

    return reply("ok", 200);
  } catch (error) {
    console.error("Paystack webhook internal error", String((error as Error)?.name || "Error"));
    return reply("temporarily unavailable", 503);
  }
});
