# ZipFit Find-My-Fit — Railway deploy

One Railway service hosts both:
- The static quiz (everything under `public/`)
- A small Express API (`server.js`) that receives the lead + match and writes to **Shopify** and **Odoo**

## Layout

```
railway/
├── package.json        # Node 20+, Express only
├── server.js           # Static + /api/fit-quiz/submit
├── .env.example        # Copy to .env locally — set real values in Railway
├── .gitignore
└── public/
    ├── index.html      # Was "Fit Quiz V1.html"
    ├── data.js
    ├── variant1.jsx    # POSTs to /api/fit-quiz/submit on the result step
    ├── shared.jsx
    ├── colors_and_type.css
    └── assets/         # Logos + liner photography
```

## Local dev

```sh
cd railway
cp .env.example .env       # fill in real values, or leave blank to skip
npm install
npm run dev                # node --watch server.js
```

Open <http://localhost:3000>. The quiz works without env vars set — the submit endpoint logs the payload and returns `{ ok: true, shopify: { skipped: ... }, odoo: { skipped: ... } }` so you can wire integrations later.

## Deploy to Railway

1. `git init` inside `railway/` (or commit this whole project and point Railway at the `railway/` subpath).
2. Create a new Railway project → **Deploy from GitHub repo** → pick the repo.
3. If you committed at the project root, set **Root Directory** to `railway` in the service settings.
4. In **Variables**, paste in:
   - `SHOPIFY_STORE_DOMAIN` (e.g. `zipfit.myshopify.com`)
   - `SHOPIFY_ADMIN_TOKEN` (custom-app token with `write_customers`)
   - `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY`
   - `ALLOWED_ORIGINS` (only needed if you POST cross-origin)
5. Railway auto-detects the Node app and runs `npm start` — visit the generated `*.up.railway.app` URL to confirm.
6. Hook a custom domain (e.g. `quiz.zipfit.com`) in **Settings → Domains**.

## Embedding in Shopify

In the Shopify theme editor, add a page section with an iframe:

```liquid
<iframe
  src="https://quiz.zipfit.com/"
  loading="lazy"
  style="border:0;width:100%;height:920px;max-width:880px;display:block;margin:0 auto"
  title="Find my ZipFit"
></iframe>
```

Use [iframe-resizer](https://github.com/davidjbradshaw/iframe-resizer) (or a small `postMessage` listener) if you want the iframe to auto-fit content height.

Because Shopify and Railway are on different origins, set `ALLOWED_ORIGINS=https://zipfit.com,https://www.zipfit.com` so the submit fetch is allowed.

## What the endpoint does

`POST /api/fit-quiz/submit` expects this shape (built by `Result` in `variant1.jsx`):

```json
{
  "lead":  { "name": "Sven", "email": "sven@…", "optIn": true },
  "boot":  { "b": "Atomic", "m": "Hawx Prime 130 S BOA", "y": "2026", "l": 100, "f": 130, "v": "MV", "w": 0 },
  "match": { "id": "gara_lv", "name": "Gara LV" },
  "answers": { "ff": "medium", "ins": "low", "ank": "medium", "cal": "low", "fit_problem": ["cold_feet"], "ability": 3 }
}
```

It fans this out:

- **Shopify** — creates a Customer with `tags: "fit-quiz, liner:gara_lv, boot-brand:atomic"`, sets a note with the match, attaches `fit_quiz.match_liner` + `fit_quiz.boot` metafields, and respects `accepts_marketing`.
- **Odoo** — authenticates via XML-RPC and creates a `crm.lead` row with the full answer summary in the description.

Missing env vars for an integration just skip it (each integration is independent, fault-tolerant).

## Customising

- **Liner → product handle map**: if you want the result page to deep-link to the matched product, add a `LINER_SHOPIFY_HANDLE` map in `public/data.js` and update the "Shop the {top.name}" button in `variant1.jsx`.
- **Lead tags**: edit `tags` in `pushToShopify()` in `server.js`.
- **Odoo fields**: extend `leadVals` in `pushToOdoo()` to populate stage_id, team_id, custom fields, etc.

## Notes

- React + Babel are loaded from `unpkg` with pinned versions + SRI — no build step.
- `data.js` is large (~825 KB of boot DB). Express's static middleware sends it with gzip if the client supports it.
- `submit` is fire-and-forget from the frontend; the user sees the match immediately and never waits on Shopify/Odoo round-trips.
- `sessionStorage` guards against double-posts when the user navigates back/forward on the result page.
