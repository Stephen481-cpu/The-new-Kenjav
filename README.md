# KENJAV backend

A small, dependency-free Node.js API for the KENJAV website: it stores real orders,
and lets you edit the menu and offers without touching code.

**Why no Express / database install?** I built and tested this inside a sandbox where
`npm install` is blocked, so it only uses Node's built-in modules — nothing to install,
nothing to compile. That also means it's genuinely simple to deploy: any host that can
run `node server.js` will run this. If you later want a "real" database (Postgres, etc.)
instead of the JSON files, the API routes are written so the frontend wouldn't need to
change — only the inside of `server.js` would.

## What it does

- `GET  /api/menu` — the current menu
- `PUT  /api/menu` — replace the menu (admin only)
- `GET  /api/offers` — current offers
- `PUT  /api/offers` — replace offers, e.g. toggle one on/off (admin only)
- `POST /api/orders` — create an order (this is what the website calls at checkout)
- `GET  /api/orders` — list all orders (admin only)
- `PATCH /api/orders/:id` — update an order's status (admin only)
- `GET  /admin.html` — a simple dashboard to view orders and edit offers

"Admin only" routes are protected by a single shared key (see `ADMIN_KEY` below) —
enough for one shop owner, not a substitute for real accounts if you later have staff
logins with different permissions.

Orders and offers are stored as plain JSON files in `/data`. That's genuinely fine for
a shop's order volume — just be aware some free hosts wipe the disk on redeploy (see
Deploying, below).

## Run it locally

```
node server.js
```

That's it — no install step. It starts on port 4000 by default.

- Health check: http://localhost:4000/api/health
- Admin dashboard: http://localhost:4000/admin.html (key is `change-me-admin-key` until you set your own)

## Before you go live

1. Copy `.env.example` to `.env` and set a real `ADMIN_KEY` (long, random, not the default).
2. Update `WHATSAPP_NUMBER` and `SHOP_ADDRESS` in the website's `kenjav.html` (search for `TODO`).
3. Edit `data/menu.json` and `data/offers.json` with your real items and prices, or do it
   later from `/admin.html` once deployed.
4. In `kenjav.html`, set `API_BASE_URL` to wherever you deploy this backend (step below).
   Leave it blank and the site still works fine — it just won't record orders in the
   admin dashboard or let you edit the live menu/offers remotely.

## Deploying

Any of these work; pick based on budget and how much you care about the order history
surviving redeploys:

- **Render.com / Railway.app (easiest)** — free tier works for testing, but the
  filesystem can reset on redeploy or after inactivity, which would wipe `data/*.json`.
  For real production use, add a persistent disk/volume (small paid add-on on both
  platforms) and point it at this project's `data/` folder.
- **A cheap VPS (DigitalOcean, etc.)** — a bit more setup, but the disk is genuinely
  persistent by default, and you can run `node server.js` behind `pm2` or a systemd
  service so it restarts if it crashes.

Whichever you pick, once it's live:
- Set `ADMIN_KEY` (and any other vars in `.env.example`) as environment variables on
  the host — don't commit your real `.env` file anywhere public.
- Update `API_BASE_URL` in `kenjav.html` to the live URL.
- The API allows requests from any origin (`Access-Control-Allow-Origin: *`) so it'll
  work regardless of where you host the frontend itself.

## M-Pesa (not wired up yet)

Real M-Pesa payment collection (STK Push via Safaricom's Daraja API) needs credentials
only Safaricom can issue to KENJAV directly — I can't obtain or test these for you.
`mpesa-stub.js` has the request-building code written to Daraja's documented spec, ready
for real `MPESA_*` credentials once you register at https://developer.safaricom.co.ke.
It is **not** wired into `/api/orders` yet, and I haven't been able to test it against
Safaricom's actual servers — treat it as a solid starting point, not a finished feature.
