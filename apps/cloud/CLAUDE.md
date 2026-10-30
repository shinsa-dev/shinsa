# @shinsa/cloud

The Worker on `https://app.shinsa.dev` that remote access runs through (`docs/engine.md` → Remote access, the design in
`docs/plans/remote-plan.md`). It signs you in with GitHub, pairs a machine, makes that machine's Cloudflare tunnel,
lists your machines, mints the short connect token a browser opens a machine's channel with, forwards webhooks, and
serves the web app's remote build. It never sees what a browser and a machine say to each other: the channel is
sealed end to end (core's `remote/`), and the Worker holds no key that opens it. Everything it stores is in D1.

## Layout

```
src/
├── index.ts       The Worker's entry: the bindings (DB, ASSETS, the variables and secrets) into a CloudWorld. The only
│                  file outside coverage
├── router.ts      respond: /__remote/* routes (JSON, errors as { error: { code, message } }), /hooks/*, and every other
│                  GET to the assets with the security headers; createWorld
├── world.ts       CloudWorld (store, fetch, assets, now, config) and resolveCloudConfig from the Worker's environment
├── database.ts    The D1 queries (createStore) over the Database interface D1 and the tests' SQLite both meet
├── session.ts     GitHub OAuth (sign-in, callback, sign-out), the session cookie, ALLOWED_GITHUB_LOGINS
├── pairing.ts     Pair start and poll (the machine), the pair view and approval (you, signed in)
├── instances.ts   Your machines, connect tokens, removal; the machine's heartbeat, offline and removal
├── cloudflare.ts  The Cloudflare API: a named tunnel, its ingress, its DNS record, removing both
├── hooks.ts       /hooks/<instance>/<schedule>/<token> forwarded to the machine's tunnel
├── http.ts        CloudError, JSON bodies, cookies, the same-origin check, the security headers
├── crypto.ts      Random tokens, claim codes and instance ids, token hashes, constant-time comparison
└── log.ts         recordFailure: the one console call (Workers Logs)
migrations/        D1's schema (wrangler d1 migrations)
test/              One file per route group, against harness.ts: D1 on bun:sqlite with the real migration, and
                   GitHub, the Cloudflare API and a machine's tunnel as fakes
```

## How it works

- **Sign-in.** `/__remote/sign-in?return=<path>` sends you to GitHub with a random `state` kept in a short
  `__Host-shinsa_oauth` cookie; the callback checks it, reads who you are from GitHub, refuses a login not in
  `ALLOWED_GITHUB_LOGINS` when that list is set, and sets `__Host-shinsa_session` (HttpOnly, Secure, SameSite=Lax, 30
  days). D1 keeps only the SHA-256 of the session token. The return path stays on this site. A failed callback
  sends you to `/?sign_in_error=<code>`.
- **Pairing.** The machine posts its name and public key to `pair/start` (no account yet; at most 10 waiting pairings
  per address, each for 10 minutes) and gets an 8-character claim code, a poll secret (kept only as a hash) and the
  `/pair?code=` link. You open it signed in, see the machine's name and key fingerprint (`/__remote/pairs/<code>`),
  and approve (`…/approve`): the Worker makes the tunnel `shinsa-<instance>`, its ingress to `http://127.0.0.1:7446`
  with a 404 for anything else, its token and the proxied CNAME `t-<instance>.shinsa.dev`, then the instance with
  the hash of a new machine token and a new connect key. A failed step removes the half-made tunnel. The machine's
  next poll with the right secret collects the credentials once; the row is then gone. At most 5 machines per account.
- **Machines.** A heartbeat (machine token as bearer) marks the instance online and, when the machine's loopback
  address changed, moves the tunnel's ingress there; any address but loopback is refused. Online means a heartbeat in
  the last 5 minutes and no offline call since. An unknown machine token is 401, which the machine reads as revoked.
  Removing an instance, from the dashboard or by the machine, deletes its DNS record and tunnel, then the row.
- **Connect tokens.** `/__remote/instances/<id>/connect`, signed in and same-origin, answers
  `wss://t-<id>.shinsa.dev/remote?token=…` with a token from `createConnectToken` (the instance's connect key, 60
  seconds). It only keeps random traffic off the machine's endpoint; the machine still needs an enrolled device key.
- **Webhooks.** `/hooks/<instance>/<schedule>/<token>` is forwarded to `https://t-<instance>.shinsa.dev/api/hooks/…`
  with its method, query, body (1 MB at most) and headers, minus cookies and Cloudflare's and proxies' own. The
  machine checks the token. A tunnel that does not answer (a network error, 502, 503, 504, 530) is 503 with
  `Retry-After: 60`.
- **Requests from a page.** Every POST a page makes (sign-out, approve, connect, remove) needs an `Origin` of the
  Worker's own origin. Every response carries a strict content security policy (scripts only from the site, sockets
  only to `wss://*.shinsa.dev`, no framing), Strict-Transport-Security, `nosniff` and `Referrer-Policy: no-referrer`.

## Running and deploying

- `bun test test` (100% line and function coverage, `bunfig.toml`) and `bun run check-types`.
- `bun run dev` runs `wrangler dev` on :5183; `APP_ORIGIN` points the Worker at that origin.
- The assets are `../web/dist-remote`, the web app's remote build: `bun run --cwd apps/web build:remote` before `wrangler dev` or a deploy.
- Before the first deploy: a D1 database `shinsa-cloud` (`wrangler d1 create shinsa-cloud`, its id in
  `wrangler.jsonc`) with the migrations applied (`bun run migrate`), a GitHub OAuth app whose callback is
  `https://app.shinsa.dev/__remote/sign-in/callback`, and the secrets `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and
  `CLOUDFLARE_API_TOKEN` (`wrangler secret put`; the token needs Cloudflare Tunnel edit on the account and DNS edit on
  the `shinsa.dev` zone). `ALLOWED_GITHUB_LOGINS`, a comma-separated list, keeps the dashboard to those accounts.
