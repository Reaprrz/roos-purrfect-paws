import { json, isOwner, missingBindings } from "../../lib/auth.js";
import { recordKey, MAX_FILES } from "../../lib/records.js";

// GET /api/records?id=<request id>&n=<0..2>   owner only → one vaccine record file
const ID_RE = /^\d{13}-[a-z0-9]{8}$/;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

export async function onRequestGet({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const n = parseInt(url.searchParams.get("n") || "", 10);
  if (!ID_RE.test(id) || !(n >= 0 && n < MAX_FILES)) return json({ error: "That file couldn't be found." }, 404);

  const { value, metadata } = await env.SITE.getWithMetadata(recordKey(id, n), { type: "arrayBuffer" });
  if (!value) return json({ error: "That file couldn't be found. It may have been deleted." }, 404);
  const type = metadata && TYPES.includes(metadata.type) ? metadata.type : "application/octet-stream";
  const name = (metadata && metadata.name) || "record";
  return new Response(value, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": 'inline; filename="' + name.replace(/"/g, "") + '"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    },
  });
}
