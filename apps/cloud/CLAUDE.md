# @shinsa/cloud

The Worker on `https://app.shinsa.dev` that remote access runs through (`docs/engine.md` → Remote access, the design in
`docs/plans/remote-plan.md`). It signs you in with GitHub, pairs a machine, makes that machine's Cloudflare tunnel,
lists your machines and the ones shared with you, keeps who belongs to each machine, mints the short connect token a browser opens a machine's channel with, forwards webhooks, and
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
├── members.ts     A machine's members: its invite, who asked through it, adding and removing members, Leave
├── teams.ts       Teams: made by a machine for its owner, one reusable invite, requests, members, Leave, team
│                  connect tokens to a teammate's /team channel, and the teams in the heartbeat
├── cloudflare.ts  The Cloudflare API: a named tunnel, its ingress, its DNS record, removing both
├── hooks.ts       /hooks/<instance>/<schedule>/<token> forwarded to the machine's tunnel
├── slack-link.ts  Connecting Slack: Sign in with Slack, adding the app to a workspace, the link to a machine
├── slack.ts       Slack's events (signature, dedupe, uninstall), a mention forwarded to its author's machine with
│                  the thread, a question's choice clicked, and the machine's links, unlink and posts
├── slack-api.ts   The Slack Web API (requestSlack, SlackApiError) and the scopes
├── http.ts        CloudError, JSON bodies, cookies, the same-origin check, the security headers
├── crypto.ts      Random tokens, claim codes and instance ids, token hashes, the bot tokens sealed with AES-GCM,
│                  Slack's request signature (hex and constant-time comparison are core's serializeHex, isSameSecret)
└── log.ts         recordFailure: the one console call (Workers Logs)
migrations/        D1's schema (wrangler d1 migrations), applied in order
slack-manifest.json The Slack app to create (api.slack.com → Create New App → From a manifest); test/slack.test.ts
                   keeps its scopes, redirects and events in step with the code
test/              One file per route group, against harness.ts: D1 on bun:sqlite with every migration, and
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
  Any GitHub account may sign in: an account reaches only the machines it paired itself or was invited to, and even
  those open only to a browser the machine enrolled, so a stranger signed in sees an empty list and can reach nothing.
  Each sign-in keeps the account's GitHub login, name and avatar (`users`), which is how an owner and a member show
  everywhere (`RemoteUser`: id, login, name, avatar). The return path is parsed against
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
  Removing an instance, from its owner's dashboard or by the machine, deletes its DNS record and tunnel, then the row
  with its members and invites. The heartbeat answers `{ ok, owner, members }` (`HeartbeatResponse`), the machine's
  owner and its members as users, so the machine keeps its own copy and forgets the devices of anyone no longer listed.
- **Members.** A machine has one owner, the account that paired it, and up to 20 members (`MAX_INSTANCE_MEMBERS`,
  `instance_members`), who reach it exactly as its owner does. Only the machine invites, and only it lets someone
  in. `POST /__remote/machine/invites` (machine token) answers the machine's one reusable invite token, replacing the
  one before, of which D1 keeps only the SHA-256 (`instance_invites`, one row per machine);
  `/__remote/machine/invites/remove` turns it off. The machine puts it in its one invite link, for its owner's devices and other people alike; whoever opens the
  link signs in with any GitHub account and the page sends `POST /__remote/invites/accept { token }`, which records
  that this account asked (`instance_requesters`), makes it no member, and answers the machine's id, name and owner,
  the account's user and a connect token for that account alone, so the browser can ask the machine over the sealed
  channel (an unknown or turned-off token is 404 `invite_invalid`). The machine checks who asked with `POST
  /__remote/machine/requesters/find { userId }`, which answers the user only for an account that asked, a member,
  the owner or someone who shares a team with the owner (`sharesTeam`), and when you accept the request, or give a
  teammate the machine from Settings → Teams, it sends `/__remote/machine/members/add { userId }`, which makes that
  account a member (only one of those; 409 `members_full` past the limit; the owner is never one) and drops its
  request row. A member sees the machine in their list with `role: 'member'` and its `owner`, gets connect tokens for
  it and can `POST /__remote/instances/<id>/leave`; only the owner removes it (403 `not_owner`), and the owner cannot
  leave (409). The machine removes a member with `POST /__remote/machine/members/remove { userId }`. Shared machines
  do not count toward the 5 machines a member may pair.
- **Teams** (`teams.ts`, `0005_teams.sql`; `docs/engine.md` → Teams). Who is in which team, and nothing else: no task,
  project, title or key is ever sent here. A team (`teams`) has one owner, the account whose machine made it with
  `POST /__remote/machine/teams { name }` (machine token; at most 10 owned, 409 `teams_full`), a name of 60 characters
  at most and up to 20 members (`team_members`, 409 `members_full`). It mirrors a machine's members: one reusable
  invite kept as its SHA-256 (`team_invites`; `…/<team>/invite` replaces it, `…/invite/remove` turns it off), and
  whoever opens the join link and signs in sends `POST /__remote/teams/join { invite }` (or the engine
  `/__remote/machine/teams/join`), which records that the account asked (`team_requesters`) and makes it no member
  (404 `invite_invalid` for a link turned off). Only the owner's machine answers a request (`members/add` and
  `requests/decline` with `{ userId }`, only of an account that asked), removes a member (`members/remove`) or the
  team (`remove`), each 403 `not_owner` for anyone else; a member leaves with `…/leave` from the engine or
  `/__remote/teams/<team>/leave` from a page, and the owner cannot (409). The team key lives in the join link's
  fragment, so it never reaches the Worker. `GET /__remote/teams` lists your teams for a page; every heartbeat's
  answer carries them as `teams` (`RemoteTeam`), with every member's machines and whether each is online, and the
  owner's requests. A team connect token (`/__remote/teams/<team>/connect` from a page,
  `/__remote/machine/teams/<team>/connect` from the engine, `{ instanceId }`) is minted only for the owner or a member
  and a machine of one of them, as `wss://t-<instance>.shinsa.dev/team?token=…`, signed with that machine's connect
  key for the account that asked; the machine then checks the account against its own copy of the members and the
  team key's proof. Removing a user, a team or a machine cascades its rows.
- **Connect tokens.** `/__remote/instances/<id>/connect`, signed in and same-origin, for the owner or a member, answers
  `wss://t-<id>.shinsa.dev/remote?token=…` with a token from `createConnectToken` (the instance's connect key, 60
  seconds), signed for the account that asked. It only keeps random traffic off the machine's endpoint; the machine
  still needs an enrolled device key.
- **Share links.** `POST /__remote/shares/<instance>/connect`, with no session, tells a share page where the machine is:
  `{ url: "wss://t-<instance>.shinsa.dev", online }` (`ShareConnectResponse`), 404 for an instance that does not
  exist. The page then opens the machine's `/share?id=…` channel itself, sealed with the key in the link's fragment,
  which never reaches the Worker (`docs/engine.md` → Sharing a task). That answer and every `/share/t/…` page carry
  `X-Robots-Tag: noindex, nofollow, noarchive`.
- **Webhooks.** `/hooks/<instance>/<schedule>/<token>` is forwarded to `https://t-<instance>.shinsa.dev/api/hooks/…`
  with its method, query, body (1 MB at most) and headers, minus cookies and Cloudflare's and proxies' own. The
  machine checks the token. A tunnel that does not answer (a network error, 502, 503, 504, 530) is 503 with
  `Retry-After: 60`.
- **The Slack bot** (`docs/engine.md` → Slack). One Slack app for everyone, on the Events API at `/slack/events`.
  Connecting (`/slack/connect?instance=<id>`, signed in with GitHub, the machine one you own, never one shared with you, else the one you own seen last)
  signs you in with Slack (OpenID Connect, `openid profile`), and when the workspace has no Shinsa yet, or its bot
  token lacks one of the scopes (`hasSlackBotScopes`, Slack's `x-oauth-scopes` on `auth.test`), goes on to add
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
  posted (`slack_threads`, `slack_posts`), `/__remote/slack/react` moves the one reaction on a mention it was sent (`reactions.remove` then `reactions.add`, best effort),
  `/slack/interactions` takes a question's choice button (signed, acknowledged at once): from a linked person on a
  message their own machine posted it is forwarded signed to that machine's `/api/slack/interactions`, and the
  click's `response_url` gets the post with "@you answered" in place of the buttons, or a private refusal, `/__remote/slack/session` sets the thread's status
  (`agents.sessions.setStatus`, best effort: `applied: false`, not logged, for `not_authorized` from an app not on
  Agent Sessions (`agent_view` stays off) and `feature_disabled`; any other refusal is logged and answered 502); `/__remote/slack/links` and `/unlink` read and remove its links. Message
  text passes through the Worker on its way and is never stored: D1 keeps ids, names and the sealed tokens.
- **Requests from a page.** Every signed-in route reads the session from `Authorization: Bearer` first, then the
  cookie (`findSessionUser`). Every POST a page makes (sign-out, approve, connect, remove, accept, leave) needs an `Origin` of the
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
  the `shinsa.dev` zone). The Slack bot needs the app made from `slack-manifest.json`, with public distribution on
  (Manage Distribution) so other workspaces can add it, the `0003_slack.sql` migration, and the secrets
  `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (the app's Basic Information) and `SLACK_TOKEN_KEY`
  (32 random bytes in base64url: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`). Changing `SLACK_TOKEN_KEY`
  later makes every stored bot token unreadable, so each workspace has to add the app again.
- The custom domain `app.shinsa.dev` is created by `wrangler deploy` (it needs the `shinsa.dev` zone on the same
  account). The GitHub OAuth app's callback URL must be exactly `https://app.shinsa.dev/__remote/sign-in/callback`.
