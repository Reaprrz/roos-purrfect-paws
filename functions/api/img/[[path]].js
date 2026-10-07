// GET /api/img/photos/<file> → serves an uploaded photo (from KV, or from R2 if IMAGES is bound)
const LONG_CACHE = "public, max-age=31536000, immutable"; // keys are unique per upload

export async function onRequestGet({ params, env, request }) {
  const key = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  if (!/^photos\/[\w.-]+$/.test(key)) return new Response("Not found", { status: 404 });

  if (env.IMAGES) {
    const obj = await env.IMAGES.get(key, { onlyIf: request.headers });
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("Cache-Control", LONG_CACHE);
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers });
  }

  if (!env.SITE) return new Response("Photo storage isn't set up.", { status: 500 });
  const { value, metadata } = await env.SITE.getWithMetadata("img:" + key, { type: "arrayBuffer", cacheTtl: 86400 });
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, {
    headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": LONG_CACHE },
  });
}
