// Shared helpers for the owner edit panel.
// The owner password lives in the ADMIN_PASSWORD environment variable (set as a secret in Cloudflare).

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return new Uint8Array(buf);
}

// Compare hashes byte by byte so timing doesn't reveal how much of the password matched.
export async function passwordMatches(given, env) {
  const real = env.ADMIN_PASSWORD;
  if (!real || !given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(real)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function isOwner(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return passwordMatches(token, env);
}

// Simple brute-force guard: max 10 failed logins per IP per 15 minutes (stored in KV).
export async function tooManyFailures(request, env) {
  if (!env.SITE) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const n = parseInt((await env.SITE.get("fail:" + ip)) || "0", 10);
  return n >= 10;
}

export async function recordFailure(request, env) {
  if (!env.SITE) return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = "fail:" + ip;
  const n = parseInt((await env.SITE.get(key)) || "0", 10);
  await env.SITE.put(key, String(n + 1), { expirationTtl: 900 });
}

export function missingBindings(env, needs) {
  const missing = needs.filter((k) => !env[k]);
  return missing.length
    ? json({ error: "Site setup isn't finished: add " + missing.join(", ") + " in Cloudflare Pages → Settings → Bindings." }, 500)
    : null;
}
