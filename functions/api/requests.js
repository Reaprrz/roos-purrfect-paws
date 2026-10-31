import { json, isOwner, missingBindings } from "../../lib/auth.js";
import { MAX_FILES, MAX_FILE_BYTES, MAX_UPLOAD_BYTES, recordKey, sniff, safeName, deleteRecords } from "../../lib/records.js";

// Appointment requests from the website's "Request an appointment" form.
//   POST   /api/requests              anyone   → saves a new request (validated, spam-guarded, rate limited).
//                                              JSON, or multipart with a "data" JSON field plus up to 3 "records" files
//   GET    /api/requests              owner    → newest requests first
//   PATCH  /api/requests?id=…         owner    → { status: "new" | "confirmed" | "declined", ownerNote }
//   DELETE /api/requests?id=…         owner    → removes a request
// Requests and their vaccine record files are stored in the SITE KV namespace and expire after a year.

const PREFIX = "req:";
const KEEP_SECONDS = 365 * 24 * 60 * 60;
const MAX_BODY = 16 * 1024;
const MAX_LIST = 100;
const PER_HOUR = 6; // requests per visitor per hour
const STATUSES = ["new", "confirmed", "declined"];
const ID_RE = /^\d{13}-[a-z0-9]{8}$/;

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function oneOf(v, options) {
  return options.includes(v) ? v : "";
}
function list(v, maxItems, maxLen) {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}
function day(v) {
  v = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function clean(b) {
  return {
    name: str(b.name, 80),
    phone: str(b.phone, 30),
    email: str(b.email, 120),
    contact: oneOf(b.contact, ["call", "text", "email"]) || "call",
    pet: str(b.pet, 60),
    species: oneOf(b.species, ["dog", "cat"]) || "dog",
    breed: str(b.breed, 80),
    size: str(b.size, 80),
    coat: oneOf(b.coat, ["short", "long"]),
    catType: str(b.catType, 120),
    catVax: b.catVax === true,
    dogVax: oneOf(b.dogVax, ["yes", "no", "unsure"]),
    recordsPlan: oneOf(b.recordsPlan, ["upload", "bring"]),
    firstVisit: oneOf(b.firstVisit, ["yes", "no"]),
    petNotes: str(b.petNotes, 600),
    services: list(b.services, 20, 80),
    haircut: str(b.haircut, 80),
    haircutNotes: str(b.haircutNotes, 500),
    shampoo: str(b.shampoo, 80),
    date1: day(b.date1),
    date2: day(b.date2),
    times: list(b.times, 4, 20),
    notes: str(b.notes, 1000),
    estimate: str(b.estimate, 80),
  };
}

function problems(r) {
  const out = [];
  if (!r.name) out.push("your name");
  if (r.phone.replace(/\D/g, "").length < 10) out.push("a phone number with area code");
  if (r.contact === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) out.push("an email address");
  if (!r.pet) out.push("your pet's name");
  if (!r.services.length) out.push("at least one service");
  if (r.species === "cat" && !r.catVax) out.push("a check that your cat's rabies vaccine is current");
  if (r.species === "cat" && !r.recordsPlan) out.push("how you'll share your cat's rabies record");
  return out;
}

function newId() {
  const inverted = String(1e13 - Date.now()).padStart(13, "0"); // newest sorts first
  const rand = crypto.getRandomValues(new Uint8Array(8));
  return inverted + "-" + Array.from(rand, (n) => "abcdefghijklmnopqrstuvwxyz0123456789"[n % 36]).join("");
}

function later(context, promise) {
  const wait = context.waitUntil || (context.ctx && context.ctx.waitUntil && context.ctx.waitUntil.bind(context.ctx));
  if (wait) wait(promise.catch(() => {}));
}

// POST: a visitor sends a request
export async function onRequestPost(context) {
  const { request, env } = context;
  const miss = missingBindings(env, ["SITE"]);
  if (miss) return miss;

  const oops = () => json({ error: "Something went wrong sending your request. Please try again." }, 400);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > MAX_UPLOAD_BYTES) return json({ error: "Those files are too large. Please attach smaller photos or PDFs (up to 10 MB each)." }, 413);

  let raw = "", uploads = [];
  if ((request.headers.get("Content-Type") || "").toLowerCase().startsWith("multipart/form-data")) {
    let form;
    try { form = await request.formData(); } catch { return oops(); }
    raw = String(form.get("data") || "");
    uploads = form.getAll("records").filter((f) => f && typeof f !== "string");
  } else {
    raw = await request.text();
  }
  if (raw.length > MAX_BODY) return json({ error: "That request is too long. Please shorten the notes and try again." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return oops(); }
  if (!body || typeof body !== "object") return oops();

  // Spam guards: a hidden field people never fill in, and forms sent within seconds of opening the page.
  // Bots get a normal-looking reply so they don't retry; nothing is saved.
  if (str(body.website, 200) || (typeof body.elapsed === "number" && body.elapsed < 3000)) {
    return json({ ok: true });
  }
  if (body.agree !== true) return json({ error: "Please confirm you've read our policies." }, 400);

  const r = clean(body);
  const missing = problems(r);
  if (r.recordsPlan === "upload" && !uploads.length) missing.push("your vaccine record files (or choose to bring them in)");
  if (missing.length) return json({ error: "Please add " + missing.join(", ") + "." }, 400);

  // Vaccine records: photos or PDFs only, checked by their contents
  if (uploads.length > MAX_FILES) return json({ error: "Please attach up to " + MAX_FILES + " files." }, 400);
  const files = [];
  if (r.recordsPlan === "upload") {
    for (const f of uploads) {
      if (f.size > MAX_FILE_BYTES) return json({ error: "\"" + safeName(f.name, "").slice(0, -1) + "\" is over 10 MB. Please attach a smaller photo or PDF." }, 413);
      const buf = await f.arrayBuffer();
      const kind = sniff(new Uint8Array(buf.slice(0, 16)));
      if (!kind) return json({ error: "Vaccine records need to be photos (JPG, PNG, HEIC) or PDFs." }, 415);
      files.push({ buf, type: kind.type, name: safeName(f.name, kind.ext), size: buf.byteLength });
    }
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = "rl:req:" + ip;
  const count = parseInt((await env.SITE.get(rlKey)) || "0", 10);
  if (count >= PER_HOUR) {
    return json({ error: "You've already sent a few requests. We'll be in touch soon, or give us a call." }, 429);
  }

  const id = newId();
  const now = Date.now();
  const record = { id, ...r, records: files.map((f, n) => ({ n, name: f.name, type: f.type, size: f.size })), status: "new", ownerNote: "", createdAt: new Date(now).toISOString() };
  const expiration = Math.floor(now / 1000) + KEEP_SECONDS;
  await Promise.all(files.map((f, n) => env.SITE.put(recordKey(id, n), f.buf, { expiration, metadata: { type: f.type, name: f.name } })));
  await env.SITE.put(PREFIX + id, JSON.stringify(record), {
    expiration,
    metadata: { status: "new", expiration },
  });
  await env.SITE.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  // Optional phone alert through ntfy (free). Set NTFY_TOPIC to a long, hard-to-guess name.
  // Only a generic message is sent, never the client's details.
  if (env.NTFY_TOPIC) {
    const server = (env.NTFY_URL || "https://ntfy.sh").replace(/\/+$/, "");
    later(context, fetch(server + "/" + encodeURIComponent(env.NTFY_TOPIC), {
      method: "POST",
      headers: { Title: "New appointment request", Tags: "dog", Priority: "high" },
      body: "Someone sent an appointment request on your website. Open the owner panel to see it.",
    }));
  }

  return json({ ok: true, id });
}

// GET: the owner's inbox
export async function onRequestGet({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);

  const listed = await env.SITE.list({ prefix: PREFIX, limit: MAX_LIST });
  const items = await Promise.all(listed.keys.map((k) => env.SITE.get(k.name, "json")));
  return json({ requests: items.filter(Boolean), more: !listed.list_complete });
}

function idFrom(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  return ID_RE.test(id) ? id : "";
}

// PATCH: mark confirmed / declined / new, with an optional private note
export async function onRequestPatch({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);
  const id = idFrom(request);
  if (!id) return json({ error: "That request couldn't be found." }, 404);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const { value, metadata } = await env.SITE.getWithMetadata(PREFIX + id, { type: "json" });
  if (!value) return json({ error: "That request couldn't be found. It may have been deleted." }, 404);

  if ("status" in body) {
    if (!STATUSES.includes(body.status)) return json({ error: "Unknown status." }, 400);
    value.status = body.status;
  }
  if ("ownerNote" in body) value.ownerNote = str(body.ownerNote, 600);
  value.updatedAt = new Date().toISOString();

  const nowSec = Math.floor(Date.now() / 1000);
  // keep the original one-year expiry; fall back to a fresh year if it's missing or about to lapse
  const expiration = metadata && metadata.expiration > nowSec + 120 ? metadata.expiration : nowSec + KEEP_SECONDS;
  await env.SITE.put(PREFIX + id, JSON.stringify(value), { expiration, metadata: { status: value.status, expiration } });
  return json({ ok: true, request: value });
}

// DELETE: remove a request
export async function onRequestDelete({ request, env }) {
  const miss = missingBindings(env, ["SITE", "ADMIN_PASSWORD"]);
  if (miss) return miss;
  if (!(await isOwner(request, env))) return json({ error: "Please log in again." }, 401);
  const id = idFrom(request);
  if (!id) return json({ error: "That request couldn't be found." }, 404);
  const existing = await env.SITE.get(PREFIX + id, "json");
  await env.SITE.delete(PREFIX + id);
  await deleteRecords(env, id, existing && Array.isArray(existing.records) ? existing.records.length : 3);
  return json({ ok: true });
}
