# BewerbungsPilot Worker (`cloud/`)

The small server of BewerbungsPilot on Cloudflare Workers (spec 0.11.0). It receives:

- `POST /v1/ping` `{ installId, version }` — the anonymous daily "the app is used" ping (a random number and the version);
- `POST /v1/feedback` `{ installId, version, language, email, kind, text }` — feedback, stored and mailed to the developer.

It stores only that (Cloudflare D1, `schema.sql`), keeps feedback 12 months, pings 400 days, and keeps IP addresses
only hashed with the day in rate-limit rows that are deleted after 2 hours (an hourly cron cleans up).

Limits: a ping writes at most once per install per UTC day, at most 20 installs never seen before per IP within
2 hours; feedback at most 5 per install per day and 10 per IP per hour. A refused request writes nothing.

Feedback is mailed through [Resend](https://resend.com) (`onboarding@resend.dev`; without an own domain Resend
delivers only to the account owner — the developer) with the person's address as Reply-To.

## Admin page

`https://<worker>/admin` — users in the last 1 / 7 / 30 days, users per version, all feedback. Sign-in: type the
admin address (the `ROBERT_EMAIL` secret) and get a 6-digit code by mail (valid 10 minutes, once, at most 5 wrong
attempts per code and 10 wrong codes per UTC day over all codes; at most 5 code requests per IP per hour and 20 code
mails per day). Any other address gets the same answer and no mail. The session cookie lasts 12 hours (`HttpOnly`,
`Secure`, `SameSite=Strict`). The page has no scripts.

- Someone who knows the admin address can use up these limits on purpose; then signing in works again the next UTC
  day (the data is not at risk, only the page is locked for the rest of the day). Without a code requested, failed
  sign-ins do not count, so a stranger cannot lock the page.
- The admin address is kept out of the code, the repo and the logs (secret `ROBERT_EMAIL`), and every failed sign-in
  gets the same answer, but it is not treated as a secret against timing or limit side channels.
- The cookie is `Secure`, so signing in needs https: it works on `*.workers.dev`, but `wrangler dev` over plain http
  does not keep the session.

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
   - optional, recommended: `npx wrangler secret put IP_PEPPER` (any long random text) — mixed into the IP hash of
     the rate-limit rows, so a leaked row cannot be matched to an IP by trying all addresses. Without it everything
     works as before.
6. `npm run deploy` — prints the Worker address (`https://bewerbungspilot.<account>.workers.dev`).

Later deploys: `npm run deploy`. Schema changes: run the new `CREATE … IF NOT EXISTS` lines with step 4.
