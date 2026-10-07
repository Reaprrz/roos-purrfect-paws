import { json, isOwner, missingBindings } from "../../lib/auth.js";

// Photos are stored in the SITE KV namespace (free plan, no card needed).
// If an R2 bucket is bound as IMAGES, it is used instead.
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

// POST /api/upload (owner only, multipart "file") → { url: "/api/img/<key>" }
export async function onRequestPost({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "No photo was received. Try again." }, 400); }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "No photo was received. Try again." }, 400);

  const ext = TYPES[file.type];
  if (!ext) return json({ error: "Use a JPG, PNG or WebP photo. iPhone HEIC photos: set Camera → Formats → Most Compatible, or send as JPG." }, 415);
  if (file.size > MAX_SIZE) return json({ error: "That photo is over 10 MB. Try a smaller one." }, 413);

  const key = `photos/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  if (env.IMAGES) {
    await env.IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  } else {
    await env.SITE.put("img:" + key, await file.arrayBuffer(), { metadata: { type: file.type } });
  }
  return json({ ok: true, url: "/api/img/" + key });
}

// DELETE /api/upload?key=photos/... (owner only) → removes a photo that's no longer used
export async function onRequestDelete({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!/^photos\/[\w.-]+$/.test(key)) return json({ error: "Unknown photo." }, 400);
  if (env.IMAGES) await env.IMAGES.delete(key);
  else await env.SITE.delete("img:" + key);
  return json({ ok: true });
}
