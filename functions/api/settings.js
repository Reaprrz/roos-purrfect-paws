import { json, isOwner, missingBindings } from "../../lib/auth.js";

const KEY = "settings";
const MAX_BYTES = 200 * 1024; // site text is small; photos live in R2

// Only these fields are stored. Anything else sent by the browser is dropped.
// Text fields: name → max length.
const TEXT_FIELDS = {
  name: 120, eyebrow: 200, intro: 800, phone: 40, address: 200, instagram: 200, facebook: 300, email: 200,
  hours: 1000, hoursNote: 600, about: 4000, heroImg: 500, aboutImg: 500,
  groomIntro: 600, catPrice: 60, catNote: 200, groomIncludes: 1000, groomNotes: 2000,
  sitIntro: 800, sitIncluded: 800, sitNote: 1200,
  payments: 400, tipNote: 200, policyNote: 1200,
};

// List fields: name → { field: max length }, plus the field that must be filled for a row to count.
const LIST_FIELDS = {
  groomTiers: { keep: "name", max: 20, fields: { name: 80, size: 60, short: 40, long: 40, breeds: 1000 } },
  sitVisits: { keep: "title", max: 12, fields: { title: 80, body: 500 } },
  sitRows: { keep: "label", max: 40, fields: { group: 60, label: 120, day: 40, night: 40 } },
  sitAddons: { keep: "label", max: 30, fields: { label: 160, price: 80 } },
  policies: { keep: "title", max: 20, fields: { title: 120, body: 2000 } },
};

function str(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function clean(input) {
  const out = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) if (k in input) out[k] = str(input[k], max);
  for (const [k, spec] of Object.entries(LIST_FIELDS)) {
    if (!Array.isArray(input[k])) continue;
    out[k] = input[k].slice(0, spec.max).map((row) => {
      const r = {};
      for (const [f, max] of Object.entries(spec.fields)) r[f] = str(row && row[f], max);
      return r;
    }).filter((r) => r[spec.keep].trim() || (k === "sitVisits" && r.body.trim()));
  }
  if (Array.isArray(input.gallery)) {
    out.gallery = input.gallery.slice(0, 200)
      .map((g) => ({ src: str(g && g.src, 500), cap: str(g && g.cap, 160) }))
      .filter((g) => g.src.startsWith("/api/img/") || g.src.startsWith("https://"));
  }
  return out;
}

// GET /api/settings → the saved site content ({} until the owner saves once)
export async function onRequestGet({ env }) {
  const miss = missingBindings(env, ["SITE"]);
  if (miss) return miss;
  const data = (await env.SITE.get(KEY, "json")) || {};
  return json(data);
}

// PUT /api/settings (owner only) → replace the saved content
export async function onRequestPut({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ error: "That's too much text to save at once." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Couldn't read the changes. Reload and try again." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Nothing to save." }, 400);

  const data = clean(body);
  data.updatedAt = new Date().toISOString();
  await env.SITE.put(KEY, JSON.stringify(data));
  return json({ ok: true, updatedAt: data.updatedAt });
}
