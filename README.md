# Roo's Purrfect Paws — website

Dog and cat grooming + pet sitting site for Roo's Purrfect Paws, 5380 E Lake Road, Sheffield Lake, Ohio.
Hosted on **Cloudflare Workers** (static assets + a small Worker for the edit panel), deployed automatically
from this **GitHub** repo by Workers Builds on every push to `main`.
The owner edits text and photos from the site itself (footer → **Owner login**), and changes are saved to Cloudflare:

- **KV** (binding `SITE`, namespace `roos-purrfect-paws-site`) stores everything the owner edits (the text and the
  uploaded photos) plus the appointment requests clients send. It's on Cloudflare's free plan, so no credit card is needed. The binding is set in `wrangler.jsonc`.
- **ADMIN_PASSWORD** (secret) is the owner's login password. Set it in the dashboard; deploys never remove it.
- Optional: bind an **R2** bucket as `IMAGES` and photos go there instead (R2 asks for a card on file).

```
wrangler.jsonc               Worker config: name, static assets folder, KV binding
src/worker.js                serves the site and routes /api/* to the handlers below
public/index.html            the whole site (page + owner edit panel)
functions/api/settings.js    GET site content / PUT saves it (owner only)
functions/api/upload.js      POST uploads a photo / DELETE removes one (owner only)
functions/api/requests.js    appointment requests: POST from the public form; GET / PATCH / DELETE (owner only)
functions/api/login.js       checks the owner password (locks out after 10 wrong tries for 15 min)
functions/api/img/[[path]].js serves uploaded photos
lib/auth.js                  shared password + helper code
```

## Setup (one time, free, no domain needed)

1. **Storage** already exists: KV namespace `roos-purrfect-paws-site` (its id is in `wrangler.jsonc`).
2. **Worker:** Cloudflare dashboard → Workers & Pages → **Create** → **Import a repository** → pick this repo.
   - Project name: `roos-purrfect-paws`
   - Build command: *(leave empty)*
   - Deploy command: `npx wrangler deploy` (the default)
   - If the Worker already exists, connect it instead: Worker → **Settings** → **Build** → **Connect** → this repo, branch `main`.
3. **Owner password:** Worker → **Settings** → **Variables and Secrets** → **Add** → Type **Secret**,
   Name `ADMIN_PASSWORD`, Value = the owner's password → **Deploy**.
4. Open the site at `roos-purrfect-paws.<your-subdomain>.workers.dev` (shown on the Worker's overview page),
   scroll to the footer, tap **Owner login** (or add `#admin` to the address), enter the password, edit, and **Save changes**.

**Prefer Cloudflare Pages?** The same repo works as a Pages project: Workers & Pages → Create → **Pages** →
Import the repo, build command empty, output directory `public`. Pages runs the `functions/` folder automatically
(it ignores `wrangler.jsonc`). Then in the Pages project's **Settings**, add the KV binding `SITE` →
`roos-purrfect-paws-site` and the secret `ADMIN_PASSWORD`, and retry the deployment. The address is
`roos-purrfect-paws.pages.dev`.

**Adding a domain later:** buy it (Cloudflare Registrar or anywhere), then Worker → **Settings** → **Domains & Routes** →
**Add** → **Custom domain**. The `workers.dev` address keeps working too, and nothing in the code changes.

## Editing

Everything the owner can change lives in the edit panel, grouped into sections:

- **Top of page:** name, label, intro, main photo
- **Contact & hours:** phone, address, Facebook, Instagram, email, hours (one day per line, e.g. `Tue–Fri | 9am – 5pm`)
- **Grooming prices:** size tiers with short/long-haired prices and example breeds, cat price, what a full groom includes, notes
- **Pet sitting:** how visits work, the per-day/overnight rate table, add-ons, notes
- **Appointment requests** (inbox): every request clients send, newest first, with New / Confirmed / Declined
  filters, Call / Text / Email buttons, a private note, and Confirm, Decline and Delete. These save right away.
- **Request form:** the services, haircut and shampoo choices clients pick from (one per line; add
  ` | short description` after a name), the intro, the note beside the Send button, and a **Pause requests** message
  that replaces the form while she's booked up
- **Policies & payment:** late, no-show and cancellation policies, accepted payment methods, tip note
- **Photos** and **About**

Until the owner saves once, the site shows the starter content built into `public/index.html`, which matches their
current price list, pet sitting rates, payment methods and cancellation policy.

## Appointment requests

Clients fill in the **Request an appointment** form (their contact details, pet, services, haircut, shampoo, two
preferred dates and time of day). A request is not a booking: the owner confirms by call or text. Requests are
saved in KV, appear in the owner panel, and are deleted automatically after a year.

- **No fees:** nothing is charged online; clients pay at pickup with cash, check, Cash App or Venmo.
- **Estimate:** when a client picks a service whose name includes "Full groom" plus a size and coat, the form shows
  the matching range from the Grooming prices table (or the cat price).
- **Spam protection:** a hidden trap field, a minimum time on the page, and at most 6 requests per visitor per hour.
- **Optional phone alert (free):** install the **ntfy** app, subscribe to a long, hard-to-guess topic name (e.g.
  `roos-paws-7f3k9q2m`), then add a secret `NTFY_TOPIC` with that name in Cloudflare (Settings → Variables and Secrets).
  Each new request then sends a push saying a request arrived. It never includes the client's details.
- **Free-plan limits:** each request uses 2 of KV's 1,000 free daily writes, so ~500 requests a day.

Code changes: edit files, commit, push to `main`; Workers Builds redeploys in about a minute.
Saved text and photos in KV are untouched by redeploys.

## Local testing (optional)

```
echo 'ADMIN_PASSWORD=test' > .dev.vars && npx wrangler dev
```
Then open http://localhost:8787 and log in with `test`.
