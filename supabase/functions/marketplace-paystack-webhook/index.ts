import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
const reply = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return reply("method not allowed", 405);

  try {
    const raw = await req.text();
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!secret || !url || !serviceRole) return reply("webhook not configured", 500);

    const signature = (req.headers.get("x-paystack-signature") || "").toLowerCase();
    if (!signature || !safeEqual(await hmacSha512(secret, raw), signature)) {
      return reply("invalid signature", 401);
    }

    const event = JSON.parse(raw);
    if (event?.event !== "charge.success") return reply("ignored", 200);

    const data = event?.data || {};
    const reference = String(data.reference || "").trim();
    if (!reference || String(data.status || "").toLowerCase() !== "success") {
      return reply("invalid successful-charge payload", 400);
    }

    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: order, error: orderError } = await admin
      .from("marketplace_orders")
      .select("id,status,amount_ngn,currency,paystack_reference")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (orderError) {
      console.error("Paystack webhook order lookup failed", orderError.message);
      return reply("order lookup failed", 500);
    }
    if (!order) return reply("order not found", 404);

    const expectedMinor = Math.round(Number(order.amount_ngn) * 100);
    const receivedMinor = Number(data.amount);
    const expectedCurrency = String(order.currency || "NGN").toUpperCase();
    const receivedCurrency = String(data.currency || "").toUpperCase();
    if (!Number.isFinite(expectedMinor) || expectedMinor <= 0 ||
        !Number.isFinite(receivedMinor) || receivedMinor !== expectedMinor ||
        receivedCurrency !== expectedCurrency ||
        String(order.paystack_reference || "") !== reference) {
      console.error("Paystack webhook payment mismatch", reference, {
        expectedMinor,
        receivedMinor,
        expectedCurrency,
        receivedCurrency,
      });
      return reply("payment amount, currency, or reference mismatch", 409);
    }

    if (order.status === "paid") return reply("already processed", 200);
    if (order.status !== "pending_payment" && order.status !== "pending") {
      console.error("Paystack webhook ignored non-pending order", reference, order.status);
      return reply("order is not awaiting payment; manual reconciliation required", 200);
    }

    const paidAt = data.paid_at && !Number.isNaN(Date.parse(String(data.paid_at)))
      ? new Date(String(data.paid_at)).toISOString()
      : new Date().toISOString();

    const { data: updated, error: updateError } = await admin
      .from("marketplace_orders")
      .update({ status: "paid", paid_at: paidAt, updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", order.status)
      .select("id,status")
      .maybeSingle();

    if (updateError) {
      console.error("Paystack webhook order update failed", updateError.message);
      return reply("order update failed", 500);
    }
    if (!updated) {
      const { data: latest, error: latestError } = await admin
        .from("marketplace_orders")
        .select("status")
        .eq("id", order.id)
        .maybeSingle();
      if (latestError) return reply("order reconciliation failed", 500);
      if (latest?.status === "paid") return reply("already processed", 200);
      console.error("Paystack webhook order state changed unexpectedly", reference, latest?.status);
      return reply("order state changed; manual reconciliation required", 200);
    }

    return reply("ok", 200);
  } catch (e) {
    console.error("Paystack webhook failed", e instanceof Error ? e.message : String(e));
    return reply("webhook processing failed", 500);
  }
});