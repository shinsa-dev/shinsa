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
├── session.ts     GitHub OAuth (sign-in, callback, sign-out), the session cookie
├── pairing.ts     Pair start and poll (the machine), the pair view and approval (you, signed in)
├── instances.ts   Your machines, connect tokens, removal; the machine's heartbeat, offline and removal
├── cloudflare.ts  The Cloudflare API: a named tunnel, its ingress, its DNS record, removing both
├── hooks.ts       /hooks/<instance>/<schedule>/<token> forwarded to the machine's tunnel
├── slack-link.ts  Connecting Slack: Sign in with Slack, adding the app to a workspace, the link to a machine
├── slack.ts       Slack's events (signature, dedupe, uninstall), a mention forwarded to its author's machine with
│                  the thread, and the machine's links, unlink and posts
├── slack-api.ts   The Slack Web API (requestSlack, SlackApiError) and the scopes
├── http.ts        CloudError, JSON bodies, cookies, the same-origin check, the security headers
├── crypto.ts      Random tokens, claim codes and instance ids, token hashes, constant-time comparison, the bot
│                  tokens sealed with AES-GCM, Slack's request signature
└── log.ts         recordFailure: the one console call (Workers Logs)
migrations/        D1's schema (wrangler d1 migrations)
slack-manifest.json The Slack app to create (api.slack.com → Create New App → From a manifest); test/slack.test.ts
                   keeps its scopes, redirects and events in step with the code
test/              One file per route group, against harness.ts: D1 on bun:sqlite with the real migrations, and
                   GitHub, the Cloudflare API, Slack and a machine's tunnel as fakes
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
- **Webhooks.** `/hooks/<instance>/<schedule>/<token>` is forwarded to `https://t-<instance>.shinsa.dev/api/hooks/…`
  with its method, query, body (1 MB at most) and headers, minus cookies and Cloudflare's and proxies' own. The
  machine checks the token. A tunnel that does not answer (a network error, 502, 503, 504, 530) is 503 with
  `Retry-After: 60`.
- **The Slack bot** (`docs/engine.md` → Slack). One Slack app for everyone, on the Events API at `/slack/events`.
  Connecting (`/slack/connect?instance=<id>`, signed in with GitHub, the machine one of yours, else the one seen last)
  signs you in with Slack (OpenID Connect, `openid profile`), and when the workspace has no Shinsa yet goes on to add
  the app (OAuth v2, the bot scopes in `SLACK_BOT_SCOPES`); either way it writes the link of your Slack user to that
  machine and lands on `/slack/linked?team=` or `?error=`. The state rides in a 10-minute `__Host-shinsa_slack`
  cookie, checked in constant time. A bot token is kept sealed with AES-GCM under `SLACK_TOKEN_KEY`, never in clear.
  An event is checked against Slack's signature (`SLACK_SIGNING_SECRET`, five minutes), kept by id for a day so a
  redelivery does nothing, and answered at once; the work runs after (`world.defer`, `waitUntil`). Removing the app
  or revoking its bot token forgets the workspace and its links. A mention from someone with no link gets a private
  reply with the link to connect; from someone linked, the Worker reads the thread (100 messages), names the people
  in it, turns Slack's markup into text and posts it to `https://t-<instance>.shinsa.dev/api/slack/events`, signed
  with an HMAC over the time and the body keyed by the machine's connect key (`createSlackForwardSignature`); a
  machine offline, or a tunnel that does not answer, gets "offline" in the thread instead. A machine posts and edits
  through `/__remote/slack/post` with its machine token, only in a thread it was sent and only editing what it
  posted (`slack_threads`, `slack_posts`); `/__remote/slack/links` and `/unlink` read and remove its links. Message
  text passes through the Worker on its way and is never stored: D1 keeps ids, names and the sealed tokens.
- **Requests from a page.** Every POST a page makes (sign-out, approve, connect, remove) needs an `Origin` of the
  Worker's own origin. Every response carries a strict content security policy (scripts only from the site, sockets
  only to `wss://*.shinsa.dev`, no framing), Strict-Transport-Security, `nosniff` and `Referrer-Policy: no-referrer`.

## Running and deploying

- `bun test test` (100% line and function coverage, `bunfig.toml`) and `bun run check-types`.
- `bun run dev:worker` builds the web app's remote build, then runs `wrangler dev` on :5183; `APP_ORIGIN` points the
  Worker at that origin, and `SHINSA_REMOTE_ORIGIN` points an engine at it (its channel origin check, enroll and webhook
  links follow). It is not called `dev`, so the root `bun dev` (turbo) never starts it.
- The assets are `../web/dist-remote`, the web app's remote build: `bun run --cwd apps/web build:remote` before a deploy.
- Before the first deploy: a D1 database `shinsa-cloud` (`wrangler d1 create shinsa-cloud`, its id in
  `wrangler.jsonc`) with the migrations applied (`bun run migrate`), a GitHub OAuth app whose callback is
  `https://app.shinsa.dev/__remote/sign-in/callback`, and the secrets `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and
  `CLOUDFLARE_API_TOKEN` (`wrangler secret put`; the token needs Cloudflare Tunnel edit on the account and DNS edit on
  the `shinsa.dev` zone). The Slack bot needs the app made from `slack-manifest.json`, with public distribution on
  (Manage Distribution) so other workspaces can add it, the `0002_slack.sql` migration, and the secrets
  `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (the app's Basic Information) and `SLACK_TOKEN_KEY`
  (32 random bytes in base64url: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`). Changing `SLACK_TOKEN_KEY`
  later makes every stored bot token unreadable, so each workspace has to add the app again.
- The custom domain `app.shinsa.dev` is created by `wrangler deploy` (it needs the `shinsa.dev` zone on the same
  account). The GitHub OAuth app's callback URL must be exactly `https://app.shinsa.dev/__remote/sign-in/callback`.
