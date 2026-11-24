// Email alerts for new pet sitting requests, sent through Cloudflare Email Routing.
// Needs the ALERT_EMAIL send_email binding (see wrangler.jsonc) and a verified destination address.

const fmtDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return new Date(Date.UTC(+m[1], m[2] - 1, +m[3])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
const dayNum = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 864e5 : NaN;
};
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
// Header values must never contain line breaks.
const oneLine = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim();

export function sittingSummary(r) {
  const pets = [];
  if (r.dogs && r.dogs !== "0") pets.push(r.dogs + " dog" + (r.dogs === "1" ? "" : "s"));
  if (r.cats && r.cats !== "0") pets.push(r.cats + " cat" + (r.cats === "1" ? "" : "s"));
  if (r.others) pets.push(r.others);
  const a = dayNum(r.sitStart), b = dayNum(r.sitEnd), n = b - a;
  let len = "";
  if (!isNaN(n) && n >= 0) len = r.sitVisit === "overnight" ? (n ? plural(n, "night") : "") : plural(n + 1, "day");
  const dates = [fmtDay(r.sitStart), fmtDay(r.sitEnd)].filter(Boolean);
  return {
    pets: pets.join(", "),
    care: r.sitVisit === "overnight" ? "Overnight stays" : r.sitVisit === "day" ? "Daytime check-ins" + (r.sitCheckins ? ", " + r.sitCheckins + " a day" : "") : "",
    dates: (dates.length === 2 && dates[0] !== dates[1] ? dates[0] + " – " + dates[1] : dates[0] || "") + (len ? " (" + len + ")" : ""),
    shortDates: dates.length === 2 && dates[0] !== dates[1] ? dates[0] + " – " + dates[1] : dates[0] || "",
  };
}

export function sittingEmail(r, siteUrl) {
  const s = sittingSummary(r);
  const how = { text: "Text", call: "Call", email: "Email" }[r.contact] || "Call";
  const line = (k, v) => (v ? k + ": " + v + "\n" : "");
  const text =
    "New pet sitting request from the website.\n\n" +
    line("Name", r.name) + line("Phone", r.phone) + line("Email", r.email) + line("Best way to reach", how) + line("Home address", r.address) + "\n" +
    line("Pets", [r.pet, s.pets ? "(" + s.pets + ")" : ""].filter(Boolean).join(" ")) + line("Care", s.care) + line("Dates", s.dates) +
    line("Check-in times", (r.sitTimes || []).join(", ")) +
    (r.petNotes ? "\nAbout the pets:\n" + r.petNotes + "\n" : "") +
    (r.notes ? "\nAnything else:\n" + r.notes + "\n" : "") +
    "\nConfirm or decline it in the owner panel: " + (siteUrl || "").replace(/\/+$/, "") + "/#admin\n";
  return { subject: "New pet sitting request: " + oneLine(r.name) + (s.shortDates ? ", " + s.shortDates : ""), text };
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function mimeMessage({ from, fromName, to, replyTo, subject, text, domain }) {
  const headers = [
    "From: =?UTF-8?B?" + b64(oneLine(fromName)) + "?= <" + oneLine(from) + ">",
    "To: <" + oneLine(to) + ">",
    replyTo ? "Reply-To: <" + oneLine(replyTo) + ">" : "",
    "Subject: =?UTF-8?B?" + b64(oneLine(subject)) + "?=",
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@" + domain + ">",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = b64(text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// Sends the alert. Never throws: a failed email must not lose the request, which is already saved.
export async function emailNewSitting(env, r) {
  if (!env.ALERT_EMAIL || !env.ALERT_TO) return false;
  try {
    const from = env.ALERT_FROM || "requests@roospurrfectpaws.store";
    const { subject, text } = sittingEmail(r, env.SITE_URL || "https://roospurrfectpaws.store");
    const replyTo = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(r.email || "") ? r.email : "";
    const raw = mimeMessage({ from, fromName: "Roo's Purrfect Paws website", to: env.ALERT_TO, replyTo, subject, text, domain: from.split("@")[1] || "roospurrfectpaws.store" });
    const { EmailMessage } = await import("cloudflare:email");
    await env.ALERT_EMAIL.send(new EmailMessage(from, env.ALERT_TO, raw));
    return true;
  } catch (e) {
    console.error("Pet sitting alert email failed:", e && e.message);
    return false;
  }
}
