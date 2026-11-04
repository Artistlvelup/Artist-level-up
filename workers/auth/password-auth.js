const PASSWORD_ITERATIONS = 210000;
const VERIFY_TTL_SECONDS = 60 * 60 * 24;
const RATE_WINDOW_SECONDS = 15 * 60;
const RATE_MAX_ATTEMPTS = 8;

function response(data, status, cors) {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256
  );
  return encode(new Uint8Array(bits));
}

function requirePepper(env) {
  const pepper = String(env.SESSION_PEPPER || "");
  if (pepper.length < 32) throw new Error("SESSION_PEPPER_NOT_CONFIGURED");
  return pepper;
}

async function hashToken(token, pepper) {
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(pepper + ":" + token)
  );
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 12 &&
    value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function readBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 8192) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function rateAllowed(env, key, now) {
  const row = await env.DB.prepare(
    "SELECT window_started_at, attempts, blocked_until FROM app_auth_rate_limits WHERE bucket_key = ? LIMIT 1"
  ).bind(key).first();
  if (row?.blocked_until && row.blocked_until > now) return false;
  if (!row || now - row.window_started_at >= RATE_WINDOW_SECONDS) {
    await env.DB.prepare(
      "INSERT INTO app_auth_rate_limits (bucket_key, window_started_at, attempts, blocked_until) VALUES (?, ?, 1, NULL) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1, blocked_until = NULL"
    ).bind(key, now).run();
    return true;
  }
  if (row.attempts >= RATE_MAX_ATTEMPTS) {
    await env.DB.prepare(
      "UPDATE app_auth_rate_limits SET blocked_until = ? WHERE bucket_key = ?"
    ).bind(now + RATE_WINDOW_SECONDS, key).run();
    return false;
  }
  await env.DB.prepare(
    "UPDATE app_auth_rate_limits SET attempts = attempts + 1 WHERE bucket_key = ?"
  ).bind(key).run();
  return true;
}

async function sendVerificationEmail(env, email, token) {
  const apiKey = String(env.RESEND_API_KEY || "");
  const from = String(env.AUTH_EMAIL_FROM || "");
  const appUrl = String(env.APP_PUBLIC_URL || "");
  if (!apiKey || !from || !/^https:\/\//i.test(appUrl)) {
    throw new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
  }
  const verifyUrl = appUrl.replace(/\/$/, "") + "/?auth_verify=" + encodeURIComponent(token);
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Verify your Artist Level Up account",
      html: "<p>Welcome to Artist Level Up.</p><p><a href=\"" + verifyUrl +
        "\">Verify your email address</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this email.</p>"
    })
  });
  if (!result.ok) throw new Error("EMAIL_DELIVERY_FAILED");
}

export async function registerPasswordAccount(request, env, cors) {
  const body = await readBody(request);
  if (!body) return response({ error: "INVALID_JSON" }, 400, cors);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  if (!validEmail(email) || !validPassword(password)) {
    return response({ error: "Use a valid email and a password of at least 12 characters." }, 400, cors);
  }
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.APP_PUBLIC_URL) {
    return response({ error: "Email verification is not configured yet." }, 503, cors);
  }
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateAllowed(env, "register:ip:" + ip, now)) ||
      !(await rateAllowed(env, "register:email:" + email, now))) {
    return response({ error: "Too many attempts. Please try again later." }, 429, cors);
  }
  const existing = await env.DB.prepare(
    "SELECT user_id FROM app_credentials WHERE email_normalized = ? LIMIT 1"
  ).bind(email).first();
  if (existing) return response({ error: "An account with this email already exists." }, 409, cors);

  const userId = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePassword(password, salt);
  const saltText = encode(salt);
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = encode(tokenBytes);
  const tokenHash = await hashToken(token, requirePepper(env));
  const expiresAt = now + VERIFY_TTL_SECONDS;

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO app_users (user_id, is_anonymous, status, created_at, updated_at) VALUES (?, 0, 'active', ?, ?)"
      ).bind(userId, now, now),
      env.DB.prepare(
        "INSERT INTO app_credentials (user_id, email_normalized, password_hash, password_salt, password_iterations, email_verified_at, password_changed_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
      ).bind(userId, email, passwordHash, saltText, PASSWORD_ITERATIONS, now),
      env.DB.prepare(
        "INSERT INTO app_email_verification_tokens (token_hash, user_id, email_normalized, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)"
      ).bind(tokenHash, userId, email, now, expiresAt)
    ]);
    await sendVerificationEmail(env, email, token);
  } catch (error) {
    // Roll back only the account created by this request if email delivery fails.
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM app_email_verification_tokens WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM app_credentials WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM app_users WHERE user_id = ? AND is_anonymous = 0").bind(userId)
      ]);
    } catch (cleanupError) {
      console.error("V101 registration rollback error", cleanupError?.message || cleanupError);
    }
    console.error("V101 registration delivery error", error?.message || error);
    return response({ error: error?.message === "EMAIL_DELIVERY_NOT_CONFIGURED"
      ? "Email verification is not configured yet."
      : "We could not complete registration. Please try again." }, 503, cors);
  }
  return response({ ok: true, verificationRequired: true }, 202, cors);
}

export async function resendPasswordVerification(request, env, cors) {
  const body = await readBody(request);
  if (!body) return response({ error: "INVALID_JSON" }, 400, cors);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return response({ ok: true, message: "If the account needs verification, an email will be sent." }, 202, cors);
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateAllowed(env, "resend:ip:" + ip, now)) || !(await rateAllowed(env, "resend:email:" + email, now))) {
    return response({ error: "Too many attempts. Please try again later." }, 429, cors);
  }
  const row = await env.DB.prepare(
    "SELECT c.user_id FROM app_credentials c JOIN app_users u ON u.user_id = c.user_id WHERE c.email_normalized = ? AND c.email_verified_at IS NULL AND u.status = 'active' AND u.is_anonymous = 0 LIMIT 1"
  ).bind(email).first();
  if (row) {
    const token = encode(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashToken(token, requirePepper(env));
    // Keep existing verification links valid until the replacement email is confirmed sent.
    await env.DB.prepare(
      "INSERT INTO app_email_verification_tokens (token_hash, user_id, email_normalized, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)"
    ).bind(tokenHash, row.user_id, email, now, now + VERIFY_TTL_SECONDS).run();
    try {
      await sendVerificationEmail(env, email, token);
      await env.DB.prepare(
        "UPDATE app_email_verification_tokens SET consumed_at = ? WHERE user_id = ? AND token_hash <> ? AND consumed_at IS NULL"
      ).bind(now, row.user_id, tokenHash).run();
    } catch (error) {
      // A failed send must not invalidate the user's previous working link.
      await env.DB.prepare(
        "UPDATE app_email_verification_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL"
      ).bind(now, tokenHash).run();
      console.error("V101 resend verification error", error?.message || error);
    }
  }
  return response({ ok: true, message: "If the account needs verification, an email will be sent." }, 202, cors);
}

export async function verifyPasswordAccount(request, env, cors) {
  const body = await readBody(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (token.length < 40 || token.length > 128) {
    return response({ error: "Invalid or expired verification link." }, 400, cors);
  }
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await hashToken(token, requirePepper(env));
  const row = await env.DB.prepare(
    "SELECT user_id FROM app_email_verification_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1"
  ).bind(tokenHash, now).first();
  if (!row) return response({ error: "Invalid or expired verification link." }, 400, cors);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE app_credentials SET email_verified_at = ? WHERE user_id = ? AND email_verified_at IS NULL"
    ).bind(now, row.user_id),
    env.DB.prepare(
      "UPDATE app_email_verification_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL"
    ).bind(now, tokenHash)
  ]);
  return response({ ok: true, verified: true }, 200, cors);
}

export async function loginPasswordAccount(request, env, cors, createSession) {
  const body = await readBody(request);
  if (!body) return response({ error: "INVALID_JSON" }, 400, cors);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  if (!validEmail(email) || typeof password !== "string" || password.length > 128) {
    return response({ error: "Invalid email or password." }, 400, cors);
  }
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateAllowed(env, "login:ip:" + ip, now)) ||
      !(await rateAllowed(env, "login:email:" + email, now))) {
    return response({ error: "Too many attempts. Please try again later." }, 429, cors);
  }
  const row = await env.DB.prepare(
    "SELECT c.user_id, c.password_hash, c.password_salt, c.password_iterations, c.email_verified_at, u.status, u.is_anonymous FROM app_credentials c JOIN app_users u ON u.user_id = c.user_id WHERE c.email_normalized = ? LIMIT 1"
  ).bind(email).first();
  if (!row) return response({ error: "Invalid email or password." }, 401, cors);
  const actual = await derivePassword(password, decode(row.password_salt), row.password_iterations);
  if (actual !== row.password_hash || row.status !== "active" || row.is_anonymous !== 0) {
    return response({ error: "Invalid email or password." }, 401, cors);
  }
  if (!row.email_verified_at) return response({ error: "Please verify your email before signing in." }, 403, cors);
  const session = await createSession(env, row.user_id);
  return response({ ...session, role: "artist" }, 200, cors);
}

export async function requestPasswordlessLogin(request, env, cors) {
  const body = await readBody(request);
  if (!body) return response({ error: "INVALID_JSON" }, 400, cors);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return response({ error: "Enter a valid email address." }, 400, cors);
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.APP_PUBLIC_URL) {
    return response({ error: "Email login is not configured yet." }, 503, cors);
  }
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateAllowed(env, "magic-login:ip:" + ip, now)) ||
      !(await rateAllowed(env, "magic-login:email:" + email, now))) {
    return response({ error: "Too many attempts. Please try again later." }, 429, cors);
  }
  const row = await env.DB.prepare(
    "SELECT c.user_id FROM app_credentials c JOIN app_users u ON u.user_id = c.user_id WHERE c.email_normalized = ? AND c.email_verified_at IS NOT NULL AND u.status = 'active' AND u.is_anonymous = 0 LIMIT 1"
  ).bind(email).first();
  // Avoid disclosing whether an email has an account.
  if (row) {
    const token = encode(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashToken(token, requirePepper(env));
    const expiresAt = now + 15 * 60;
    await env.DB.prepare(
      "INSERT INTO app_login_link_tokens (token_hash, user_id, email_normalized, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)"
    ).bind(tokenHash, row.user_id, email, now, expiresAt).run();
    const loginUrl = env.APP_PUBLIC_URL.replace(/\/$/, "") + "/?auth_login=" + encodeURIComponent(token);
    try {
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM,
          to: [email],
          subject: "Your Artist Level Up sign-in link",
          html: "<p>Use the secure link below to sign in to Artist Level Up.</p><p><a href=\"" + loginUrl + "\">Sign in to Artist Level Up</a></p><p>This link expires in 15 minutes and can only be used once. If you did not request it, ignore this email.</p>"
        })
      });
      if (!sent.ok) throw new Error("EMAIL_DELIVERY_FAILED");
    } catch (error) {
      await env.DB.prepare("UPDATE app_login_link_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL")
        .bind(now, tokenHash).run();
      console.error("V101 login link delivery error", error?.message || error);
      return response({ error: "We could not send your login link. Please try again." }, 503, cors);
    }
  }
  return response({ ok: true, message: "If a verified account exists for this email, a sign-in link will be sent." }, 202, cors);
}

export async function verifyPasswordlessLogin(request, env, cors, createSession) {
  const body = await readBody(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (token.length < 40 || token.length > 128) {
    return response({ error: "This sign-in link is invalid or has expired." }, 400, cors);
  }
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await hashToken(token, requirePepper(env));
  const row = await env.DB.prepare(
    "SELECT t.user_id, u.status, u.is_anonymous, c.email_verified_at FROM app_login_link_tokens t JOIN app_users u ON u.user_id = t.user_id JOIN app_credentials c ON c.user_id = t.user_id WHERE t.token_hash = ? AND t.consumed_at IS NULL AND t.expires_at > ? LIMIT 1"
  ).bind(tokenHash, now).first();
  if (!row || row.status !== "active" || row.is_anonymous !== 0 || !row.email_verified_at) {
    return response({ error: "This sign-in link is invalid or has expired." }, 400, cors);
  }
  const consumed = await env.DB.prepare(
    "UPDATE app_login_link_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?"
  ).bind(now, tokenHash, now).run();
  if (!consumed?.meta?.changes) return response({ error: "This sign-in link has already been used." }, 400, cors);
  const session = await createSession(env, row.user_id);
  return response({ ...session, ok: true }, 200, cors);
}
