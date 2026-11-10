# @shinsa/cloud

The Worker on `https://app.shinsa.dev` that remote access runs through (`docs/engine.md` → Remote access, the design in
`docs/plans/remote-plan.md`). It signs you in with GitHub, pairs a machine, makes that machine's Cloudflare tunnel,
lists your machines and the ones shared with you, keeps who belongs to each machine, mints the short connect token a browser opens a machine's channel with, forwards webhooks, passes a
shared preview on `*.shinsa.page` through to its machine, and serves the web app's remote build. It never sees what a browser and a machine say to each other: the channel is
sealed end to end (core's `remote/`), and the Worker holds no key that opens it. Everything it stores is in D1, and
none of it is task data: a shared task is read live from its machine, never stored here.

## Layout

Every line is Effect 4 (the `effect` skill). The API the pages and machines call is core's `RemoteApi`
(`@shinsa/core/remote/api`): each `/__remote/*` endpoint declared once with its params, payload, answer and failures,
which `routes/` implements with `HttpApiBuilder.group`. What no API can declare (redirects, raw bodies, a whole host)
is a plain `HttpRouter` route beside it. Every request passes the same three gates, in this order: the `Ingress`
(`http/ingress/`), the sign-in middleware its group names (`PageSession` or `MachineSession`, `auth/`) and the
`RequestGate` (`http/gate/`), so a body is read only once the caller is known.

**A module is a folder of a `schema.ts` and one logic file** (the `effect` skill → File layout, lint-enforced):
`schema.ts` holds the module's schemas, the types from them, its errors, interfaces and constants and no function;
`handler.ts`, `service.ts` and `middleware.ts` hold one export with its steps inside its body, after the services it
yields once. Untrusted input (Slack's events, GitHub's answers, the OAuth cookie) is read with a schema, never by
hand, and a row that becomes another shape is a schema transform (`store/shared/schema.ts`: `Count`, `MemberRow`).

```
src/
├── index.ts         The Worker's entry: one handler per isolate's bindings (D1 through @effect/sql-d1, ASSETS, the
│                    variables and secrets as the ConfigProvider), and each request's waitUntil as its
│                    WorkerContext. The only file outside coverage
├── app.ts           makeCloudHandler: the API's groups with the three middlewares, the plain routes and the Ingress
│                    over CloudServices, given the platform (the SQL client and the assets), as one web handler
├── layers.ts        CloudServices: every service below as one Layer, needing only the SQL client and the
│                    configuration provider (the Worker gives D1 and its bindings, the tests SQLite and TEST_ENV)
├── config/          CloudConfig (service.ts): every variable read once with Effect's Config (CLOUD_CONFIG in
│                    schema.ts), the secrets Redacted, the defaults in one place, the OAuth callback URLs GitHub and
│                    Slack must see the same on authorize and exchange derived once from APP_ORIGIN; an unreadable
│                    MAX_INSTANCES stops the Worker instead of falling back
├── crypto/          CloudCrypto (service.ts): random tokens (Redacted), claim codes and the instance and team ids,
│                    PKCE challenges, the bot tokens sealed with AES-GCM under SLACK_TOKEN_KEY (imported once),
│                    a pairing's credentials sealed to the machine's key (sealCredentials: the ephemeral key and IV
│                    for core's sealPairingCredentials),
│                    Slack's request signature (none without a signing secret, so an empty key cannot be forged);
│                    schema.ts: TokenHash (the only shape a table keeps a token in), CryptoFailed, the alphabets
├── http/            The edge. ingress/ (Ingress: a preview host goes to PreviewHost before any route; a route that
│                    is not there is the app's page for a GET, 404 under /__remote/ and 405 otherwise; every failure
│                    becomes its { error: { code, message } } through core's serializeRemoteFailure, anything
│                    unexpected the plain server_error, logged; the security headers on all but /hooks/*), gate/
│                    (RequestGate: application/json, the endpoint's BodyLimit in bytes, 16 KB unless it says more,
│                    refused from its Content-Length before it is read, and a body
│                    or path id its schema refuses as body_invalid or not_found; every failure of 500 or more
│                    logged); the edge's own modules: cookies.ts (the one cookie format: Path=/, Max-Age,
│                    HttpOnly, Secure, SameSite=Lax), responses.ts (redirects with their cookies, the one
│                    redirect to sign in and back, respondSignInRedirect, a failure as JSON,
│                    text, a header on an API answer), request.ts (the request's URL and a cookie), forward.ts (what
│                    never reaches a machine: hop-by-hop, Cloudflare's and proxies' headers; the tunnel statuses that
│                    mean offline; requestOnlineMachine and recordMachineOffline, the one warn line
│                    `[Cloud] Machine offline`), worker.ts (WorkerContext and deferWork, Assets, WorkerLogger: Workers
│                    Logs' console, errors to console.error, warnings to console.warn)
├── auth/            page-session/ (PageSession: the bearer, or the session cookie with the same-origin check on a
│                    POST and never when a bearer was sent), machine-session/ (MachineSession: the machine token),
│                    tokens.ts (the session's steps: selectSessionToken, selectRequestUser for the routes that work
│                    signed out too, assertPageRequest, createSession), access.ts (the one access check:
│                    selectMachineRole, owner, member or guest; selectTeamRole, owner or member; findMachineAccess
│                    and findTeamAccess on them, else not_found; findOwnMachine and findOwnTeam; findReachableMachine,
│                    which also admits the owner's teammates, for preview open and the channel's connect), schema.ts (the
│                    access grants, TeamRole, BEARER, SESSION_TTL, OAUTH_STATE_BYTES and the messages several
│                    files answer: NO_SUCH_MACHINE, NO_SUCH_TEAM, NOT_PAIRED, SIGN_IN_EXPIRED)
├── domain/          The Worker's own steps several routes share: machines.ts (isMachineOnline, a machine row as a
│                    RemoteInstance or a TeamMachine, a connect token's answer for the /remote or /team channel,
│                    findOwner: a machine's or a team's owner, a machine's members and guests, removeMachine: its
│                    tunnel, then its row), teams.ts (a RemoteTeam with its machines and,
│                    for its owner, the requests; a user's teams; an invite replaced, a team found by its invite,
│                    joining, leaving and a team connect token), schema.ts (ONLINE_WINDOW, CONNECT_NONCE_BYTES)
├── routes/          One folder per group of the API and per set of plain routes, each a handler.ts and, when it has
│                    shapes of its own, a schema.ts: session/, sign-in/ (GitHub OAuth, the native app's code and
│                    token), pairing/ (pair start and poll, the machine's), pairs/ (the pair view and approval,
│                    yours), instances/ (your machines, connect, remove, leave, accepting an invite or a hand-off),
│                    shares/ (a share's connect), machine/ (every machine-token route: heartbeat, offline, removal,
│                    invites, hand-offs, members, guests), teams/ and machine-teams/ (a page's teams and the
│                    machine's), slack-relay/ (a machine's links, posts, thread status and reactions), slack-link/
│                    (Sign in with Slack, adding the app), slack-events/ (events, a card's decision buttons and
│                    forms, who may decide; each Slack payload a schema: EventEnvelope, MentionEnvelope,
│                    UninstallEvent, ThreadMessage, BlockActions, ViewSubmission), hooks/ (/hooks/<instance>/<schedule>/<token> to the machine), preview-open/ (the
│                    open route for a private address), previews/ (PreviewHost, service.ts: *.shinsa.page forwarded
│                    to its machine; address.ts: isPreviewHost and resolveForwardCookie)
├── slack/           What the Slack routes share: signed-body.ts (readSignedBody: its size, Slack's signature within
│                    five minutes), workspace.ts (a workspace's bot token, opened; a request to a machine signed with
│                    its connect key), schema.ts (the limits)
├── store/           The D1 tables as services over SqlClient, one folder each (schema.ts: the row schemas and
│                    column lists; service.ts: the service), every row decoded and every value encoded by a Schema
│                    (SqlSchema), ids branded, `orDie` at each method: accounts/ (users, sessions, sign-in codes),
│                    pairings/, machines/ (machines, with SharedMachine for a user's list), access/ (invites,
│                    requesters, members, guests, hand-offs), teams/ (and their invites, requesters, members),
│                    slack/; shared/ (schema.ts: SQL_NAMES, USER_COLUMNS, Found, Count and MemberRow as schema
│                    transforms; membership.ts and invites.ts: createMembership and createInvites, the two shapes
│                    several tables share); index.ts StoreLayer. A method that records a time reads Clock itself
└── integrations/    The outside world, each a folder (schema.ts: its answers as schemas; service.ts: the service)
                     over HttpClient (http.ts: OutboundHttp, fetch with trace headers off, so no request to GitHub,
                     Cloudflare or Slack carries ours): github/ (signIn: the code and verifier to an account, the
                     answer decoded straight to a RemoteUser by GitHubUser, SignInFailed when refused, a defect when
                     unreachable), cloudflare/ (createTunnel, which removes a half-made tunnel, updateIngress,
                     removeTunnel; the zone looked up once; every refusal a CloudflareFailed naming the call),
                     slack/ (SlackApi: call with the answer's Schema, SlackCallFailed with Slack's code,
                     selectUserName, hasBotScopes; the scopes), tunnels/ (Tunnels: the one way anything reaches a
                     machine's t-<instance>.shinsa.dev: webhooks, previews and Slack, never following a redirect;
                     TunnelUnreachable when it does not answer)
migrations/          D1's schema (wrangler d1 migrations): 0001_schema.sql is the whole of it; test/store/schema.test.ts
                     pins its rules (How it works → The schema)
slack-manifest.json  The Slack app to create (api.slack.com → Create New App → From a manifest); test/slack.test.ts
                     keeps its scopes, redirects and events in step with the code
test/                gates.test.ts reads every RemoteApi route with HttpApi.reflect and proves each sign-in gate:
                     the routes open to anyone are a fixed list, every signed-in route refuses no session, a machine
                     token and a cross-site cookie, every machine route refuses no token and a page session, and a
                     machine's and a team's routes answer each role (owner, member, guest, teammate, stranger) as
                     they should. One file per route group, against harness.ts: makeCloudHandler on a SQLite file with every
                     migration in a temporary folder test/preload.ts removes (it also gives every test 30 s, since CI runs every workspace at once; harness.db.sqlite reads the same rows), a clock a test moves
                     (harness.clock.now), the configuration a test may change (harness.world.config, which builds
                     the handler again), waitUntil collected for settle(), and GitHub, the Cloudflare API, Slack and
                     a machine's tunnel as fakes behind one fetch (harness.world.fetch, its calls in harness.calls,
                     answers in handlers); http/ tests the logger and deferWork; config/, crypto/, store/ and
                     integrations/ test each service against layers.ts: runTest and flipTest provide CloudServices on
                     SQLite in memory with every migration, TEST_ENV, a TestClock at TEST_NOW and an Upstream (the
                     fetch every outbound call reaches, its calls recorded, its answers in handlers);
                     createLogRecorder keeps what a test logs
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
  included, can set or overwrite either cookie. D1 keeps only the SHA-256 of the session token, and removes the expired ones each time it makes one.
  Any GitHub account may sign in: an account reaches only the machines it paired itself or was invited to, and even
  those open only to a browser the machine enrolled, so a stranger signed in sees an empty list and can reach nothing.
  Each sign-in keeps the account's GitHub login, name and avatar (`users`), which is how an owner and a member show
  everywhere (`RemoteUser`: id, login, name, avatar). The return path is parsed against
  this origin and kept only when it stays on it and its path does not start with `//` once parsed (a tab, a newline, a
  backslash or a dot segment such as `/.//elsewhere` cannot turn it into `//elsewhere`).
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
  the hash of a new machine token and a new connect key. A failed step removes the half-made tunnel. The credentials
  (machine token, tunnel token, connect key) are sealed to the machine's own public key from `pair/start` before
  they are stored (`CloudCrypto.sealCredentials`, core's `pairing-seal.ts`), so the waiting row in D1 holds nothing the
  Worker or a copy of D1 can open. The machine's next poll with the right secret collects them once as
  `sealedCredentials`, opens them with its private key, and the row is then gone. Only a machine whose `pair/start`
  names `sealed-pairing` in `features` (kept in `pairings.features` and then `machines.features`) is sealed to; an older engine that names nothing collects them in the clear as
  `credentials`, as it always has. At most 5 machines per account, and at most `MAX_INSTANCES` (50 by default, a
  variable in `wrangler.jsonc`) on the whole service, each one a tunnel and a DNS record on our Cloudflare account; past
  it an approval is 503 `service_full`.
- **Machines.** A heartbeat (machine token as bearer) records the `features` the engine names (`machines.features`)
  and marks the instance online and, when the machine's loopback
  address changed, moves the tunnel's ingress there; any address but loopback is refused. Online means a heartbeat in
  the last 5 minutes and no offline call since. An unknown machine token is 401, which the machine reads as revoked.
  Removing an instance, from its owner's dashboard or by the machine, deletes its DNS record and tunnel, then the row
  with its members, guests, invites and hand-off links. The heartbeat answers `{ ok, owner, members, guests, teams }`
  (`HeartbeatResponse`), the machine's owner, its members and its guests as users, so the machine keeps its own copy
  and forgets the devices of anyone no longer listed.
- **Members.** A machine has one owner, the account that paired it, and up to 20 members (`MAX_INSTANCE_MEMBERS`,
  `machine_members`), who reach it exactly as its owner does. Only the machine invites, and only it lets someone
  in. `POST /__remote/machine/invites` (machine token) answers the machine's one reusable invite token, replacing the
  one before, of which D1 keeps only the SHA-256 (`machine_invites`, one row per machine);
  `/__remote/machine/invites/remove` turns it off. The machine puts it in its one invite link, for its owner's devices and other people alike; whoever opens the
  link signs in with any GitHub account and the page sends `POST /__remote/invites/accept { token }`, which records
  that this account asked (`machine_requesters`), makes it no member, and answers the machine's id, name and owner,
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
- **Guests.** A guest is someone a task was handed to (`docs/engine.md` → Handing off a task): they reach the machine
  only for that task, which the machine enforces; here they are only an account allowed connect tokens, up to 20 a
  machine (`MAX_INSTANCE_GUESTS`, `machine_guests`). `POST /__remote/machine/handoffs` (machine token) answers a new
  hand-off token, one per hand-off and many at once, of which D1 keeps only the SHA-256 (`machine_handoffs`) and
  never the task it is for; `/__remote/machine/handoffs/remove { token }` turns that one off. Whoever opens the
  hand-off link signs in and the page sends `POST /__remote/handoffs/accept { token }`, which records that this
  account asked and answers as an invite does (an unknown or removed token is 404 `handoff_invalid`). An invite token
  is never a hand-off token, nor the other way round. Once the machine checked the claim it sends
  `/__remote/machine/guests/add { userId }`: only an account that asked or is a guest already, so a retry succeeds; 409
  `guests_full` past the limit; an owner or member stays what they are. A guest sees the machine with
  `role: 'guest'`, gets connect tokens for it and can leave it; the machine removes one with
  `/__remote/machine/guests/remove { userId }`.
- **Teams** (`routes/teams/`, `routes/machine-teams/`; `docs/engine.md` → Teams). Who is in which team, and nothing else: no task,
  project, title or key is ever sent here. A team (`teams`) has one owner, the account whose machine made it with
  `POST /__remote/machine/teams { name }` (machine token; at most 10 owned, 409 `teams_full`), a name of 60 characters
  at most and up to 20 members (`team_members`, 409 `members_full`). It mirrors a machine's members: one reusable
  invite kept as its SHA-256 (`team_invites`; `…/<team>/invite` replaces it, `…/invite/remove` turns it off), and
  whoever opens the join link and signs in sees the team's name and owner (`POST /__remote/teams/preview { invite }`,
  which records nothing), then sends `POST /__remote/teams/join { invite }` (or the engine
  `/__remote/machine/teams/join`), which records that the account asked (`team_requesters`) and makes it no member
  (404 `invite_invalid` for a link turned off). An account with no paired machine may join too: it shares
  nothing and reaches the team only through machines shared with it, whose grant makes it a member there
  (`/__remote/machine/members/add`, allowed by `sharesTeam`). Only the owner's machine answers a request (`members/add` and
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
  What teammates may do on each other's machines is the team's `scopes` (`teams.scopes`) and each member's
  own (`team_members.scopes`), both a JSON list of core's `AccessScope`s, null for the default or the team's. Only the
  owner changes them, from their machine with `POST /__remote/machine/teams/<team>/scopes { userId?, scopes }` or from
  a page with `POST /__remote/teams/<team>/scopes`, the same body, so a browser that reaches none of their machines can
  too; machines learn it on their next heartbeat (403 `not_owner`
  for anyone else, 404 for a `userId` that is not a member, 400 for a scope core does not know): without a `userId`
  it sets the team's, with one that member's, and `null` puts the default or the team's back. It answers the team.
  Every `RemoteTeam` carries the team's list, or `DEFAULT_TEAM_SCOPES` (Collaborate: everything but `message`), as
  `scopes`, and each member set apart as `overrides`; a removed member's go with their row. The Worker only keeps them: each machine enforces them for its own tasks.
- **Signing keys** (`machines.signing_key`). Each machine's heartbeat may send
  `signingKey`, its ECDSA P-256 public key (raw, base64url; anything else is 400 `body_invalid`, and one left out keeps
  the stored key), and the team listing returns it on each machine (`TeamMachine.signingKey`). Teammates verify a
  machine's signed task list with it when another teammate passes it on while the machine is offline
  (`docs/engine.md` → Teams → Offline teammates). The Worker stores the public half only and never sees a list.
- **Connect tokens.** `/__remote/instances/<id>/connect`, signed in and same-origin, for the owner, a member, a guest or a teammate of the owner (`findReachableMachine`), answers
  `wss://t-<id>.shinsa.dev/remote?token=…` with a token from `createConnectToken` (the instance's connect key, 60
  seconds), signed for the account that asked. It only keeps random traffic off the machine's endpoint; the machine
  still needs an enrolled device key, and a teammate's is scoped to the team's projects.
- **Share links.** `POST /__remote/shares/<instance>/connect`, with no session, tells a share page where the machine is:
  `{ url: "wss://t-<instance>.shinsa.dev", online }` (`ShareConnectResponse`), 404 for an instance that does not
  exist. The page then opens the machine's `/share?id=…` channel itself, sealed with the key in the link's fragment,
  which never reaches the Worker (`docs/engine.md` → Sharing a task). That answer and every `/share/t/…` page carry
  `X-Robots-Tag: noindex, nofollow, noarchive`.
- **Previews on `shinsa.page`.** A shared preview (`docs/engine.md` → Sharing a preview) lives at
  `https://<label>.shinsa.page/`, a domain apart from `shinsa.dev` so the dev server's cookies and scripts cannot reach
  app.shinsa.dev. Until `shinsa.page` is on the Public Suffix List previews are each other's same site, so the Worker
  drops the `Domain` attribute from every `Set-Cookie` a dev server sends (a page's script can still set one).
  `respond` matches a preview host (`isPreviewHost`, the zone from
  `PREVIEW_ZONE`) before any other route, so nothing of the app is ever served there, and skips the app's security
  headers, which would break most dev servers. Listing `shinsa.page` makes each label a site of its own, which stops
  that; until then the gap is a page's own script, never a dev server's header. `PreviewHost.respond` answers
  `/robots.txt` on every host, the bare zone and unknown labels included, with `User-agent: *` and `Disallow: /` before
  any key or machine is checked, so a dev server's own robots file is never served there. It then reads the instance
  and the preview id from the label (`parsePreviewHost`); a `?key=` on any path is set as `__Host-shinsa_preview` (HttpOnly, Secure, SameSite=Lax, 30
  days, that host only) and answered with a 303 to the same address without it, written in full so a path starting `//` stays on the host. With the cookie, a request to an
  instance that is online is forwarded to `https://t-<instance>.shinsa.dev/__preview/<id><path>` with its method,
  query, body and headers, minus the preview cookie, Cloudflare's and proxies' own, and with the key in
  `x-shinsa-preview-key`; a WebSocket upgrade passes through as Cloudflare's 101. The machine checks the key. No
  cookie, a malformed key or an unknown instance is "This preview is not shared" (404); an instance offline or
  a tunnel that does not answer (a network error, 502, 503, 504, 530 without the machine's
  `x-shinsa-preview-page` mark, `PREVIEW_PAGE_HEADER`) is the offline page (503, `Retry-After: 30`), and a tunnel
  that fails for an online instance is logged as the warn line `[Cloud] Machine offline` with `surface: preview`
  (below); the machine's own
  pages, such as a stopped service's, pass through with the mark removed. Every answer carries `X-Robots-Tag: noindex, nofollow, noarchive`, the Worker's own error page included.
  Traffic is plain to the Worker: unlike a task's share, a preview is not sealed end to end, and nothing of it is kept.
- **Private service addresses.** Every running service of a machine with remote access has a private address on
  `shinsa.page` too (`docs/engine.md` → Private service addresses). `GET /__remote/previews/open?url=<address>`
  (`routes/preview-open/`, `REMOTE_PATHS.previewOpen`) takes only a `shinsa.page` preview address, sends a signed-out
  browser to sign in and back, answers 404 to anyone but the machine's owner, a member, a guest or someone who shares a
  team with the owner (`findReachableMachine`; the machine then decides whether that teammate may open that run's
  service), and otherwise redirects
  (303) to the address with `?access=` a token from `createPreviewAccessToken` signed with the instance's connect key,
  valid 60 seconds. On the preview host the Worker checks that token against the instance's connect key and sets a
  new one, valid 12 hours, as `__Host-shinsa_preview_access` (HttpOnly, Secure, SameSite=Lax, that host only),
  redirecting without it; that cookie is forwarded as `x-shinsa-preview-access`, the same way as the link key, and
  the machine checks the token, the run and the member list on every request. Any `x-shinsa-preview-key` or
  `x-shinsa-preview-access` a browser sends is dropped before forwarding, and the preview cookies never reach the dev
  server. An expired or forged token is the not-shared page.
- **Webhooks.** `/hooks/<instance>/<schedule>/<token>`, the schedule and the token each 1 to 128 characters of
  `A-Z a-z 0-9 _ -` (anything else, an encoded slash, `?` or dot segment included, is 404 before the tunnel is
  called, so a hook never reaches another path of the machine), is forwarded to `https://t-<instance>.shinsa.dev/api/hooks/…`
  with its method, query, body (1 MB at most) and headers, minus cookies and Cloudflare's and proxies' own. The
  machine checks the token. A tunnel that does not answer (a network error, 502, 503, 504, 530) is 503 with
  `Retry-After: 60`, so the sender tries again.
- **An offline machine is a warning, not an error.** A webhook, a Slack mention or a preview whose tunnel does not
  answer writes one warn line, `[Cloud] Machine offline` (`recordMachineOffline` in `http/forward.ts`), with
  `surface` (`webhook`, `slack` or `preview`), `instanceId` and `reason`: `unreachable` with the fetch's `error`, or
  `status` with the tunnel's status. A machine asleep or off its network is expected, so a watch counts this line
  on its own. Workers Logs still marks the webhook's 503 request itself as error level, as it does any 5xx, with no
  `console.error` behind it, so a watch on the Worker's errors must leave out a 503 on `/hooks/` (and on a preview
  host) that comes with this warn line, and count the warn line apart.
- **The Slack bot** (`docs/engine.md` → Slack). One Slack app for everyone, on the Events API at `/slack/events`.
  Connecting (`/slack/connect?instance=<id>`, signed in with GitHub, the machine one you own or are a member of, never a guest's, a member's only on a machine that names `slack-task-owner`; else your own seen last, then one you are a member of)
  signs you in with Slack (OAuth v2, the read-only user scopes in `SLACK_USER_SCOPES`: `channels:history`,
  `groups:history`, `channels:read`, `groups:read`, never a direct message's), and when the workspace has no Shinsa yet, or its bot
  token lacks one of the scopes (`SlackApi.hasBotScopes`, Slack's `x-oauth-scopes` on `auth.test`), goes on to add
  the app (OAuth v2, the bot scopes in `SLACK_BOT_SCOPES` and the same user scopes); either way it writes the link of your Slack user to that
  machine as the GitHub account that signed in (`slack_links.user_id`), with your user token sealed beside it (`slack_links.sealed_user_token`), and lands on `/slack/linked?team=` or `?error=`. The state rides in a 10-minute `__Host-shinsa_slack`
  cookie, checked in constant time. A bot token and a user token are kept sealed with AES-GCM under `SLACK_TOKEN_KEY`, never in clear. A user token is
  revoked (`auth.revoke`, best effort, `slack/user-tokens.ts`) on unlink, on machine removal and when connecting
  again brings a different one; a user `tokens_revoked` clears it and keeps the link.
  An event is checked against Slack's signature (`SLACK_SIGNING_SECRET`, five minutes), kept by id for a day so a
  redelivery does nothing, and answered at once; the work runs after (`deferWork`, `waitUntil`). Removing the app
  or revoking its bot token forgets the workspace and its links. A mention from someone of another organisation
  (`user_team` not the workspace) is dropped. A mention from someone with no link gets a private
  reply with the link to connect, and so does one whose linked account is no longer the machine's owner or a member; from someone linked, the Worker reads the thread (100 messages), reads up to three
  threads the mention links to with that person's user token and never the bot's (only for a machine that names
  `slack-linked-threads`; one it cannot read gets a private note, or "Connect Slack again" when the token is missing
  or refused), names the people
  in them, turns Slack's markup into text, adds the linked account (`linkedUserId`, whose task it starts) and posts it to `https://t-<instance>.shinsa.dev/api/slack/events`, signed
  with an HMAC over the time and the body keyed by the machine's connect key (`createSlackForwardSignature`); a
  machine offline, or a tunnel that does not answer, gets "offline" in the thread instead. A machine posts and edits
  through `/__remote/slack/post` with its machine token, only in a thread it was sent and only editing what it
  posted (`slack_threads`, `slack_posts`, kept until their workspace or machine is removed), `/__remote/slack/react` moves the one reaction on a mention it was sent (`reactions.remove` then `reactions.add`, best effort),
  `/slack/interactions` takes a card's decision buttons and forms (signed, acknowledged at once). It lets through
  only the owner or a member of the machine that posted the card (`selectPoster`, then the linked account's role
  there; a guest, someone not connected and anyone else get a private refusal, `SLACK_DECISION_REFUSALS`, and
  nothing reaches the machine). A decide click is forwarded signed to that machine's `/api/slack/interactions` as a
  `SlackDecision`, and the click's `response_url` gets the card with "@you approved the plan" in place of the
  buttons, or a private refusal. A write click opens a form (`views.open`), checked again when it is sent; its
  refusal comes as `chat.postEphemeral` in the thread. `/__remote/slack/session` sets the thread's status
  (`agents.sessions.setStatus`, best effort: `applied: false`, not logged, for `not_authorized` from an app not on
  Agent Sessions (`agent_view` stays off) and `feature_disabled`; any other refusal is logged and answered 502); `/__remote/slack/links` (each with the GitHub account that linked it, `accountId`) and `/unlink` read and remove its links. Message
  text passes through the Worker on its way and is never stored: D1 keeps ids, names and the sealed tokens.
- **A watched channel's messages go to its machines** (`docs/engine.md` → Slack, Schedules and webhooks). An engine
  lists the channels the bot is in for its linked workspaces (`GET /__remote/slack/channels`,
  `users.conversations`) and replaces the channels it watches (`POST /__remote/slack/watches`,
  `SlackStore.replaceMachineWatches`, only workspaces linked to it); the rows (`slack_channel_watches`,
  `migrations/0003_slack_channel_watches.sql`: workspace, channel, machine) go with their workspace or machine,
  and unlinking empties them. A `message` event (`message.channels`, `message.groups`, `MessageEnvelope`) that is
  a new top-level message, not Shinsa's own and not a mention of it, is forwarded signed to `POST
  /api/slack/messages` on every watching machine that is online and names `slack-channel-triggers`
  (`handleChannelMessage`); a channel nobody watches costs one D1 read and no Slack call. No message text is
  stored. A failure after the acknowledgement is logged as `[Cloud] A Slack channel message could not be
  forwarded` with its `teamId` and `eventId`, and a machine's refusal as `[Cloud] A machine refused a Slack
  channel message`.
- **Requests from a page.** Every signed-in route reads the session from `Authorization: Bearer` first, then the
  cookie (`PageSession`; a bearer that does not open a session is refused, never retried as the cookie). Every POST a page makes (sign-out, approve, connect, remove, accept, leave) needs an `Origin` of the
  Worker's own origin, unless it carries a bearer token (`PageSession`'s cookie half, `assertPageRequest`): a forged cross-site
  request can send the cookie but never the token. Every response carries a strict content security policy (scripts only from the site, sockets
  only to `wss://*.shinsa.dev` (and `blob:` reads and media, a share page's files), no framing), Strict-Transport-Security, `nosniff` and `Referrer-Policy: no-referrer`.

## Threat model

The whole model, with every gate and what each stolen credential reaches, is `docs/engine.md` → Remote access, Threat
model. The Worker's part of it:

- **Trusted for identity, never for content.** The Worker decides who is signed in, which machines and teams an
  account reaches, and mints the connect tokens that say so. It holds no key that opens a sealed channel, and no task
  data, so a Worker or a D1 copy in the wrong hands can mint a token naming anyone yet cannot read a task: a channel
  also needs a device key the machine enrolled. Previews, webhook bodies and Slack text pass through it in the clear,
  and none of them is stored.
- **Three gates in, one gate out.** Every request passes `Ingress`, the sign-in middleware its group names
  (`PageSession` or `MachineSession`) and `RequestGate`, in that order, and nothing else decides who may call a route
  (`test/gates.test.ts`, which reads every route from `RemoteApi` and fails on a new one open to anyone until it is
  added to the open list on purpose). Everything that reaches a machine goes through `Tunnels`, with a path built only
  from checked parts (a webhook's schedule and token, 1 to 128 base64url characters, `test/hooks.test.ts`), never
  following a redirect.
- **What D1 keeps.** Hashes of sessions, sign-in codes, poll secrets, machine tokens and invite and hand-off tokens;
  Slack bot tokens sealed with `SLACK_TOKEN_KEY`; a waiting pairing's credentials sealed to the machine's own key. The
  one secret kept plain is each machine's connect key, which the Worker signs connect, preview and Slack tokens with:
  a D1 copy can therefore act as the Worker toward that machine's previews and Slack, though still not open its
  channel. Sealing it needs a Worker secret of its own and a rewrite of every row, left for a change of its own.
- **The schema** (`migrations/0001_schema.sql`, `test/store/schema.test.ts`). One file holds every table. Every table
  is `STRICT`, so a value of the wrong type fails the write; a table keyed by a token hash or by two or more columns is
  `WITHOUT ROWID`, stored by its key alone; every foreign key has an index that starts with its column, so removing a
  user, a machine, a team or a Slack workspace cascades without scanning a table; every expiry is indexed and swept
  when a row of its kind is made (`sessions` in `createSession`, `sign_in_codes`, `pairings`); a column nothing
  reads is not kept. Names say what a row is: `machines` (the API's "instance"), a machine's own tables
  `machine_*` keyed by `machine_id`, `owner_id` for the account that owns a machine or a team and `user_id` for any
  other account, a Slack workspace's id as `workspace_id` (never `team_id`, which is one of our teams), a sealed
  value as `sealed_*`; a JSON column (`features`, `scopes`) is checked with `json_valid`. The test fails on a table missing from its list, one not strict, a foreign key without an index
  a value of the wrong type and text that is not JSON. A change to the schema is a new file after it (`0002_…`), never an edit to one D1
  has applied.
- **What logs keep.** Failures of 500 or more with their cause, and the ids and statuses of what a machine or Slack
  refused (`WorkerLogger`); never a body, and every secret is `Redacted`, so a cause prints it as `<redacted>`.
  Workers Logs record each request's URL too, which for a webhook includes its token.
- **Older engines.** A connect token is bound to its channel and nonce, and pairing credentials sealed, only for a
  machine whose last heartbeat or pairing start named `bound-connect-tokens` or `sealed-pairing`
  (`createConnectAnswer`, `domain/machines.ts`; the pairing routes). A machine that names nothing gets the old token
  and clear credentials, so the Worker can deploy from `main` before every engine updates. A hardened engine accepts
  only the new token and refuses clear credentials, so a forged empty heartbeat downgrades nothing it runs
  (`test/instances.test.ts`, `test/pairing.test.ts`).
- **Known limits.** Rate limits only on pairing start (10 waiting per address); signing out ends that one session, not every session of the account; an older engine keeps the old
  token and clear pairing credentials until it updates.

## Running and deploying

- `bun test test` (100% line and function coverage, `bunfig.toml`) and `bun run check-types`.
- `bun run dev:worker` builds the web app's remote build, then runs `wrangler dev` on :5183; `APP_ORIGIN` points the
  Worker at that origin, and `SHINSA_REMOTE_ORIGIN` points an engine at it (its channel origin check, enroll and webhook
  links follow). It is not called `dev`, so the root `bun dev` (turbo) never starts it.
- The assets are `../web/dist-remote`, the web app's remote build, which `bun run build` makes (`build:remote` in
  `apps/web`): Cloudflare's Workers Builds runs it in `apps/cloud` before every deploy and preview.
- The schema is `migrations/0001_schema.sql`, which production D1 runs and records as applied. A change to it is a
  new numbered file beside it, applied with `bun run migrate` before the Worker that needs it deploys. `bun run
  deploy` builds first (`bun run build && wrangler deploy`), so a checkout without `../web/dist-remote` never fails
  halfway and leaves the Worker before it serving a schema it cannot read.
- A Worker and the schema it reads roll back together. Every Worker built from code before #184 (the change that
  brought `0001_schema.sql` and renamed `instances` to `machines`) reads the old table names (`instances`,
  `pair_sessions`). In `wrangler deployments list` those are the Worker versions deployed before 2026-11-04 21:44 UTC,
  the first on the new schema being version `d2e271eb` (a Worker version id, not a commit). Rolling the Worker back to
  one of them, or restoring D1 to before its rebuild (`wrangler d1 time-travel restore`), fails every request that
  reads D1 with `no such table`. Undo one only with the other, in the same minute.
- Before the first deploy: a D1 database `shinsa-cloud` (`wrangler d1 create shinsa-cloud`, its id in
  `wrangler.jsonc`) with the migrations applied (`bun run migrate`), a GitHub OAuth app whose callback is
  `https://app.shinsa.dev/__remote/sign-in/callback`, and the secrets `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and
  `CLOUDFLARE_API_TOKEN` (`wrangler secret put`; the token needs Cloudflare Tunnel edit on the account and DNS edit on
  the `shinsa.dev` zone). The Slack bot needs the app made from `slack-manifest.json` (a change to its events or scopes is made again in the app's settings on api.slack.com, which no deploy does), with public distribution on
  (Manage Distribution) so other workspaces can add it, and the secrets
  `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (the app's Basic Information) and `SLACK_TOKEN_KEY`
  (32 random bytes in base64url: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`). Changing `SLACK_TOKEN_KEY`
  later makes every stored bot token unreadable, so each workspace has to add the app again.
- Previews need the `shinsa.page` zone on the same Cloudflare account, with a proxied wildcard DNS record `*` (an
  `AAAA` to `100::` is enough, the Worker answers) so every label resolves; the `*.shinsa.page/*` route in
  `wrangler.jsonc` sends them to the Worker, and `wrangler deploy` fails while the zone is missing. `PREVIEW_ZONE`
  (`shinsa.page`) names it; an engine reads the same origin from `SHINSA_PREVIEW_ORIGIN`.
- The custom domain `app.shinsa.dev` is created by `wrangler deploy` (it needs the `shinsa.dev` zone on the same
  account). The GitHub OAuth app's callback URL must be exactly `https://app.shinsa.dev/__remote/sign-in/callback`.
