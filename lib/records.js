// Vaccine record files attached to appointment requests.
// Stored privately in the SITE KV namespace next to the request ("rec:<request id>:<n>")
// and only ever served to the owner.

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB each
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024; // whole request

export function recordKey(id, n) {
  return "rec:" + id + ":" + n;
}

// Work out the file type from its first bytes, never from what the browser claims.
// Only photos and PDFs are accepted (no SVG/HTML, which could carry scripts).
export function sniff(bytes) {
  const b = bytes;
  const ascii = (from, len) => String.fromCharCode(...b.slice(from, from + len));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { type: "image/png", ext: "png" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { type: "image/webp", ext: "webp" };
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return { type: "application/pdf", ext: "pdf" };
  if (b.length >= 12 && ascii(4, 4) === "ftyp" && ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 4))) {
    return { type: "image/heic", ext: "heic" };
  }
  return null;
}

export function safeName(name, ext) {
  const base = String(name || "record").replace(/\.[^.]*$/, "").replace(/[^\w .()-]+/g, "").trim().slice(0, 60) || "record";
  return base + "." + ext;
}

export async function deleteRecords(env, id, count) {
  const n = Math.max(0, Math.min(MAX_FILES, count | 0));
  await Promise.all(Array.from({ length: n }, (_, i) => env.SITE.delete(recordKey(id, i))));
}
