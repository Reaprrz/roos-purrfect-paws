# Roo's Purrfect Paws — website

Dog and cat grooming + pet sitting site for Roo's Purrfect Paws, 5380 E Lake Road, Sheffield Lake, Ohio.
Hosted on **Cloudflare Pages**, deployed automatically from this **GitHub** repo.
The owner edits text and photos from the site itself (footer → **Owner login**), and changes are saved to Cloudflare:

- **KV** (binding `SITE`) stores everything the owner edits: the text and the uploaded photos.
  It's on Cloudflare's free plan, so no credit card is needed.
- **ADMIN_PASSWORD** (secret) is the owner's login password.
- Optional: bind an **R2** bucket as `IMAGES` and photos go there instead (R2 asks for a card on file).

```
public/index.html            the whole site (page + owner edit panel)
functions/api/settings.js    GET site content / PUT saves it (owner only)
functions/api/upload.js      POST uploads a photo / DELETE removes one (owner only)
functions/api/login.js       checks the owner password (locks out after 10 wrong tries for 15 min)
functions/api/img/[[path]].js serves uploaded photos
lib/auth.js                  shared password + helper code
```

## Setup (one time, about 10 minutes, free, no domain needed)

1. **Push this folder to a new GitHub repo** (e.g. `roos-purrfect-paws`).
2. **Create the storage:** Cloudflare dashboard → Storage & Databases → **KV** → Create → name it `roos-purrfect-paws-site`.
3. **Create the site:** Workers & Pages → Create → **Pages** tab → **Connect to Git** → pick the repo.
   - Project name: `roos-purrfect-paws` (this becomes the free address `roos-purrfect-paws.pages.dev`)
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `public`
   - Save and Deploy.
4. **Connect storage + password:** open the project → **Settings**:
   - **Bindings** → Add → KV namespace → Variable name `SITE` → choose `roos-purrfect-paws-site`.
   - **Variables and Secrets** → Add → Type **Secret** → Name `ADMIN_PASSWORD` → the owner's password.
   - Do this for **Production** (and Preview if you use preview branches).
5. **Redeploy** (Deployments → latest → ⋯ → Retry deployment) so the binding and password take effect.
6. Open `roos-purrfect-paws.pages.dev`, scroll to the footer, tap **Owner login** (or go to `…pages.dev/#admin`), enter the password, edit, and press **Save changes**.

**Adding a domain later:** buy it (Cloudflare Registrar or anywhere), then project → **Custom domains** → Set up a custom domain.
The `.pages.dev` address keeps working too, and nothing in the code changes.

## Editing

Everything the owner can change lives in the edit panel, grouped into sections:

- **Top of page:** name, label, intro, main photo
- **Contact & hours:** phone, address, Facebook, Instagram, email, hours (one day per line, e.g. `Tue–Fri | 9am – 5pm`)
- **Grooming prices:** size tiers with short/long-haired prices and example breeds, cat price, what a full groom includes, notes
- **Pet sitting:** how visits work, the per-day/overnight rate table, add-ons, notes
- **Policies & payment:** late, no-show and cancellation policies, accepted payment methods, tip note
- **Photos** and **About**

Booking is by phone only, so there are no online booking buttons. Until the owner saves once, the site shows the
starter content built into `public/index.html`, which matches their current price list, pet sitting rates,
payment methods and cancellation policy.

Code changes: edit files, commit, push to `main`; Cloudflare redeploys in about a minute.
Saved text and photos in KV are untouched by redeploys.

## Local testing (optional)

```
npx wrangler pages dev public --kv SITE --binding ADMIN_PASSWORD=test
```
Then open http://localhost:8788 and log in with `test`.
