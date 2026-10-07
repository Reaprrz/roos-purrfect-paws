import { json, passwordMatches, tooManyFailures, recordFailure } from "../../lib/auth.js";

// POST /api/login  { password }  → 200 if it matches ADMIN_PASSWORD
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: "No owner password is set yet. Add ADMIN_PASSWORD in Cloudflare Pages → Settings → Variables and Secrets." }, 500);
  }
  if (await tooManyFailures(request, env)) {
    return json({ error: "Too many tries. Wait 15 minutes and try again." }, 429);
  }
  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  if (await passwordMatches(body.password, env)) return json({ ok: true });
  await recordFailure(request, env);
  return json({ error: "Wrong password." }, 401);
}
