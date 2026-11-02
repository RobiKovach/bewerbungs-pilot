# BewerbungsPilot Worker (`cloud/`)

The small server of BewerbungsPilot on Cloudflare Workers (spec 0.11.0). It receives:

- `POST /v1/ping` `{ installId, version }` — the anonymous daily "the app is used" ping (a random number and the version);
- `POST /v1/feedback` `{ installId, version, language, email, kind, text }` — feedback, stored and mailed to the developer.

It stores only that (Cloudflare D1, `schema.sql`), keeps feedback 12 months, pings 400 days, and keeps IP addresses
only hashed with the day in rate-limit rows that are deleted after 2 hours.

This folder is its own npm project. It is **not** part of the app, its workspaces or its release zip.

## Develop

```
cd cloud
npm ci
npm run typecheck
npm test
```

The tests run in plain Node (Node 22.13+): the store is tested against `node:sqlite` with the real `schema.sql`.

## First deploy (once, by the developer)

Every step in the Cloudflare and mail accounts is done by the account owner.

1. Create a free Cloudflare account and a free Resend account (with the address the feedback should go to).
2. `npx wrangler login` — confirm in the browser.
3. `npx wrangler d1 create bewerbungspilot` — copy the printed `database_id` into `wrangler.toml`.
4. `npx wrangler d1 execute bewerbungspilot --remote --file schema.sql`
5. Secrets (typed in when asked, never written into a file):
   - `npx wrangler secret put ROBERT_EMAIL`
   - `npx wrangler secret put RESEND_API_KEY`
6. `npm run deploy` — prints the Worker address (`https://bewerbungspilot.<account>.workers.dev`).

Later deploys: `npm run deploy`. Schema changes: run the new `CREATE … IF NOT EXISTS` lines with step 4.
