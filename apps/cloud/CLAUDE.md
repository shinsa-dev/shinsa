# @shinsa/cloud

The Worker on `https://app.shinsa.dev` that remote access runs through (`docs/engine.md` → Remote access, the design in
`docs/plans/remote-plan.md`). It signs you in with GitHub, pairs a machine, makes that machine's Cloudflare tunnel,
lists your machines, mints the short connect token a browser opens a machine's channel with, forwards webhooks, and
serves the web app's remote build. It never sees what a browser and a machine say to each other: the channel is
sealed end to end (core's `remote/`), and the Worker holds no key that opens it. Everything it stores is in D1, and
none of it is task data: a shared task is read live from its machine, never stored here.

## Layout

```
src/
├── index.ts       The Worker's entry: the bindings (DB, ASSETS, the variables and secrets) into a CloudWorld. The only
│                  file outside coverage
├── router.ts      respond: /__remote/* routes (JSON, errors as { error: { code, message } }), /hooks/*, and every other
│                  GET to the assets with the security headers; createWorld
├── world.ts       CloudWorld (store, fetch, assets, now, config) and resolveCloudConfig from the Worker's environment
├── database.ts    The D1 queries (createStore) over the Database interface D1 and the tests' SQLite both meet
├── session.ts     GitHub OAuth (sign-in, callback, sign-out), the native app's code and token, the session cookie
│                  or bearer
├── pairing.ts     Pair start and poll (the machine), the pair view and approval (you, signed in)
├── instances.ts   Your machines, connect tokens, removal; the machine's heartbeat, offline and removal
├── cloudflare.ts  The Cloudflare API: a named tunnel, its ingress, its DNS record, removing both
├── hooks.ts       /hooks/<instance>/<schedule>/<token> forwarded to the machine's tunnel
├── http.ts        CloudError, JSON bodies, cookies, the same-origin check, the security headers
├── crypto.ts      Random tokens, claim codes and instance ids, token hashes, constant-time comparison
└── log.ts         recordFailure: the one console call (Workers Logs)
migrations/        D1's schema (wrangler d1 migrations), applied in order
test/              One file per route group, against harness.ts: D1 on bun:sqlite with every migration, and
                   GitHub, the Cloudflare API and a machine's tunnel as fakes
```

## How it works

- **Where it lives.** On its own custom domain, `app.shinsa.dev` (`routes` in `wrangler.jsonc`, `workers_dev` off),
  with the app at the root. Its own origin keeps the session cookie, the service worker and each browser's device keys
  apart from the marketing site on `shinsa.dev`, which knows nothing of it.
- **Sign-in.** Our own GitHub OAuth, about 150 lines, rather than an auth library: one provider, nothing else to
  audit. `/__remote/sign-in?return=<path>` sends you to GitHub with a random `state` and a PKCE `S256` challenge, the
  state and the verifier kept in a 10-minute `__Host-shinsa_oauth` cookie; the callback checks the state in constant
  time, redeems the code with the verifier (a code stolen from the redirect cannot be redeemed without it), reads who
  you are from GitHub and sets `__Host-shinsa_session` (Path=/, HttpOnly,
  Secure, SameSite=Lax, 30 days). The `__Host-` prefix means no other host, a machine's `t-<id>.shinsa.dev`
  included, can set or overwrite either cookie. D1 keeps only the SHA-256 of the session token.
  Any GitHub account may sign in: an account owns only the machines it paired itself, and even its own machine opens
  only to a browser that machine enrolled, so a stranger signed in sees an empty list and can reach nothing. The return path is parsed against
  this origin and kept only when it stays on it (a tab, a newline or a backslash cannot turn it into `//elsewhere`).
  A failed callback sends you to `/?sign_in_error=<code>`, which the sign-in page says in words.
- **Native sign-in.** The iPhone app has no cookie jar of its own, so `/__remote/sign-in?client=native` also takes a
  `redirect` (only `shinsa:` or `shinsa-dev:`, 200 characters at most, else 400 `invalid_redirect`) and the app's own
  `code_challenge` (S256, else 400 `invalid_challenge`), both kept in the OAuth cookie (base64url JSON, read back
  with the same checks). Its callback sets no session cookie: it stores the SHA-256 of a one-time code with the user,
  the app's challenge and a 60-second expiry (`sign_in_codes`, expired rows cleared on each insert) and sends the
  app to `<redirect>?code=<code>`, or `<redirect>?error=<code>` when the sign-in fails, so the system sheet closes.
  `POST /__remote/sign-in/token { code, codeVerifier }` deletes the row before it checks the verifier in constant time
  and the expiry, so a code works once even when the first try is wrong, then answers `{ token, user }` with a
  normal 30-day session. The app then sends the token as `Authorization: Bearer`.
- **Pairing.** The machine posts its name and public key to `pair/start` (no account yet; at most 10 waiting pairings
  per address, each for 10 minutes) and gets an 8-character claim code, a poll secret (kept only as a hash) and the
  `/pair?code=` link. You open it signed in, see the machine's name and key fingerprint (`/__remote/pairs/<code>`),
  and approve (`…/approve`), which first reserves the code in one conditional update so two approvals at once pair
  it only once (a failed approval releases it): the Worker makes the tunnel `shinsa-<instance>`, its ingress to `http://127.0.0.1:7446`
  with a 404 for anything else, its token and the proxied CNAME `t-<instance>.shinsa.dev`, then the instance with
  the hash of a new machine token and a new connect key. A failed step removes the half-made tunnel. The machine's
  next poll with the right secret collects the credentials once; the row is then gone. At most 5 machines per account, and at most `MAX_INSTANCES` (50 by default, a
  variable in `wrangler.jsonc`) on the whole service, each one a tunnel and a DNS record on our Cloudflare account; past
  it an approval is 503 `service_full`.
- **Machines.** A heartbeat (machine token as bearer) marks the instance online and, when the machine's loopback
  address changed, moves the tunnel's ingress there; any address but loopback is refused. Online means a heartbeat in
  the last 5 minutes and no offline call since. An unknown machine token is 401, which the machine reads as revoked.
  Removing an instance, from the dashboard or by the machine, deletes its DNS record and tunnel, then the row.
- **Connect tokens.** `/__remote/instances/<id>/connect`, signed in and same-origin, answers
  `wss://t-<id>.shinsa.dev/remote?token=…` with a token from `createConnectToken` (the instance's connect key, 60
  seconds). It only keeps random traffic off the machine's endpoint; the machine still needs an enrolled device key.
- **Share links.** `POST /__remote/shares/<instance>/connect`, with no session, tells a share page where the machine is:
  `{ url: "wss://t-<instance>.shinsa.dev", online }` (`ShareConnectResponse`), 404 for an instance that does not
  exist. The page then opens the machine's `/share?id=…` channel itself, sealed with the key in the link's fragment,
  which never reaches the Worker (`docs/engine.md` → Sharing a task). That answer and every `/share/…` page carry
  `X-Robots-Tag: noindex, nofollow, noarchive`.
- **Webhooks.** `/hooks/<instance>/<schedule>/<token>` is forwarded to `https://t-<instance>.shinsa.dev/api/hooks/…`
  with its method, query, body (1 MB at most) and headers, minus cookies and Cloudflare's and proxies' own. The
  machine checks the token. A tunnel that does not answer (a network error, 502, 503, 504, 530) is 503 with
  `Retry-After: 60`.
- **Requests from a page.** Every signed-in route reads the session from `Authorization: Bearer` first, then the
  cookie (`findSessionUser`). Every POST a page makes (sign-out, approve, connect, remove) needs an `Origin` of the
  Worker's own origin, unless it carries a bearer token (`findPageUser`, `assertPageRequest`): a forged cross-site
  request can send the cookie but never the token. Every response carries a strict content security policy (scripts only from the site, sockets
  only to `wss://*.shinsa.dev` (and `blob:` reads and media, a share page's files), no framing), Strict-Transport-Security, `nosniff` and `Referrer-Policy: no-referrer`.

## Running and deploying

- `bun test test` (100% line and function coverage, `bunfig.toml`) and `bun run check-types`.
- `bun run dev:worker` builds the web app's remote build, then runs `wrangler dev` on :5183; `APP_ORIGIN` points the
  Worker at that origin, and `SHINSA_REMOTE_ORIGIN` points an engine at it (its channel origin check, enroll and webhook
  links follow). It is not called `dev`, so the root `bun dev` (turbo) never starts it.
- The assets are `../web/dist-remote`, the web app's remote build, which `bun run build` makes (`build:remote` in
  `apps/web`): Cloudflare's Workers Builds runs it in `apps/cloud` before every deploy and preview.
- Before the first deploy: a D1 database `shinsa-cloud` (`wrangler d1 create shinsa-cloud`, its id in
  `wrangler.jsonc`) with the migrations applied (`bun run migrate`), a GitHub OAuth app whose callback is
  `https://app.shinsa.dev/__remote/sign-in/callback`, and the secrets `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and
  `CLOUDFLARE_API_TOKEN` (`wrangler secret put`; the token needs Cloudflare Tunnel edit on the account and DNS edit on
  the `shinsa.dev` zone).
- The custom domain `app.shinsa.dev` is created by `wrangler deploy` (it needs the `shinsa.dev` zone on the same
  account). The GitHub OAuth app's callback URL must be exactly `https://app.shinsa.dev/__remote/sign-in/callback`.
