# Shinsa from anywhere

**Deferred.** Nothing here is built or scheduled. Start it only once the desktop app has fully replaced Kanna and
the IDE for daily work. Until then Shinsa stays on `127.0.0.1` and this file is the plan to pick up.

Research only, nothing edited in the code. Paths are relative to `/Users/christo/Developer/Projects/shinsa` unless
absolute. Reference: Kanna's cloud mode, `/Users/christo/Developer/Projects/kanna/src/server/cloud/` (every file),
`kanna/src/shared/cloud-api.ts` and the Cloud contract section of `kanna/CLAUDE.md`.

## Decision in one paragraph

Reach the whole local `shinsa engine` (HTTP and the `/ws` socket) from a phone or another machine through a **named
Cloudflare tunnel** under a Shinsa domain, the way Kanna does it: the machine runs `cloudflared` with a token for its
own tunnel, a small hosted service on the Shinsa domain signs you in and forwards HTTP, and the browser's socket
connects straight to the tunnel with a short-lived token. The server stays the only place state lives; nothing is
copied to the cloud. Remote requests are the human, so they may close gates, but only after a real sign-in, and the
decisions that need you at the keyboard (accounts, secrets, MCP sign-in, the background service, pairing itself)
stay local only. On a phone Shinsa shows a smaller surface with no code views: the queue, the gates you can close by
reading and tapping, reports and the chat.

## Why a Cloudflare tunnel, not Tailscale

`docs/spec.md` used to say "remote access later through Tailscale". Tailscale was the alternative considered:

| Need | Cloudflare tunnel (Kanna's way) | Tailscale |
|---|---|---|
| Open Shinsa on any device | any browser, nothing to install | the Tailscale app on every device, signed in to your Tailscale network |
| An address you remember | `‹machine›.‹shinsa domain›`, the same everywhere | a MagicDNS name, or Funnel's `*.ts.net` |
| Inbound ports | none, the connector dials out | none |
| Who sees the traffic | Cloudflare terminates TLS, so it sees plain HTTP and socket frames | end to end inside your Tailscale network; Funnel also terminates at Tailscale |
| Already built once | yes, in Kanna, with tests and a cross-repo wire e2e | no |
| Also gives webhooks a public URL | yes (`/api/hooks/‹id›/‹token›` on the tunnel host) | only with Funnel |

The deciding facts: it works from any browser without a client install (a borrowed laptop, a phone without the VPN
on), it gives Shinsa its own domain, and Kanna already ships the machine side. The price is that Cloudflare sees the
traffic in clear text; the security model below keeps secrets off the tunnel for that reason.

## How Kanna does it

- **Identity file.** `~/.kanna/cloud.json` (`identity.ts`), written atomically (temp file and rename) with mode 600:
  `controlUrl`, `machineToken` (bearer for the control plane), `proxySecret` (what the proxy sends on every forwarded
  request), `subdomain`, `appOrigin` (`https://‹sub›.kanna.sh`), `tunnelToken` (the connector credential, scoped to
  this machine's tunnel), `tunnelHost` (the permanent `tun-‹machineId›.kanna.sh`) and a sticky `enabled` flag. A file
  with a missing field reads as "not paired", with a warning to pair again.
- **Pairing.** Two ways. A code from the dashboard (`kanna pair ‹code›`, `POST {controlUrl}/pair`), or the device-code
  flow (`pair-session.ts`): the machine asks for a claim code, shows a link and a QR, and polls with a separate
  `deviceToken` until a signed-in browser claims it at `kanna.sh/machine?pair=…`. The code travels through the QR, so
  it is never enough to collect credentials; the poll secret never leaves the machine. Polling lives on the server, so
  pairing finishes even if you complete it on your phone and close the tab that started it. The pair-session route
  answers local requests only: claiming a machine is done at the keyboard.
- **Control-plane client.** `api-client.ts`: pair, device code and poll, heartbeat (carries the local URL the
  connector fronts, so the control plane can re-sync the tunnel's ingress when the port moves), mark offline, remove.
  The control URL can be overridden by an environment variable for tests and self-hosting.
- **Tunnel supervisor.** `tunnel-supervisor.ts` runs `cloudflared` through the `cloudflared` npm package
  (`share.ts`: installs the binary on first use, `Tunnel.withToken(token, { '--url': localUrl })`, resolves on
  "connected"). Once up it heartbeats, then self-pings `https://‹tunnelHost›/health` every 30 seconds and heartbeats
  every fourth ping (about 2 minutes). Three failed pings in a row restart the connector. Restarts retry every second
  for the first minute of a failure streak (a laptop waking up, a network blip), then back off 2, 4, 10 and 30
  seconds. A 401 from the control plane means the machine was revoked: it stops and says to pair again. On shutdown
  it tells the control plane it is offline, capped at 2 seconds so quitting never hangs. The hostname never changes,
  so there is no URL to register on each boot.
- **Request guard.** `guard.ts` sorts every request into three classes: `proxied` (the proxy header matches
  `proxySecret`, compared in constant time; the proxy strips any inbound copy, so the header cannot be forged from
  outside), `local` (a loopback Host and no `cf-connecting-ip`, which `cloudflared` stamps on everything it forwards)
  and `untrusted` (anything else that came in through the tunnel). Untrusted traffic sees only `/health` and a
  token-gated `/ws` upgrade; every other path is 404, so the tunnel host leaks no surface.
- **HTTP through the proxy, the socket direct.** The hosted proxy on `‹sub›.kanna.sh` checks your account session and
  forwards HTTP with the proxy header. Before each socket connect, the page calls `GET /api/cloud/ws-endpoint`: a
  proxied request gets `wss://‹tunnelHost›/ws` and a 60 second, single-machine connect token (`connect-token.ts`,
  32 random bytes, in memory only, so a restart invalidates them and the page fetches a new one); a local request gets
  `null` and connects same-origin. The upgrade on the tunnel needs the token and an Origin that is the app origin, a
  loopback origin or none. So the proxy sees HTTP and never a socket frame, and the long-lived socket does not pay for
  a hop through a Worker.
- **Feature detection.** The proxy answers `/__cloud/*` itself (the account's machines, sign-in); the machine 404s
  that prefix explicitly, so the page can tell cloud mode from the SPA fallback.
- **Wire contract.** `src/shared/cloud-api.ts` is the contract with the hosted side (kanna-site, a private repo that
  deploys on its own), mirrored verbatim there. It is append-only: no field or constant is ever removed or renamed,
  only optional fields added, because machines in the wild update on their own schedule. `bun run test:cloud` runs a
  wire e2e against a local `wrangler dev` of the hosted repo.
- **Also in Kanna, not needed here.** A "direct" mode for E2B dev boxes (heartbeat only, no connector, no self-ping
  so the box can pause) and the fleet list (`fleet.ts`, the account's other machines for a picker).

## What Shinsa reuses, copies and changes

**Copy, close to as is** (into `apps/server/src/remote/`, Shinsa's verbs and no comments, 100% coverage like the rest):

- The tunnel supervisor and its timings, the `cloudflared` package and its install-on-first-use, the connect tokens,
  the device-code pairing loop and the identity file's shape and atomic, mode-600 write (as `remote.json` under the
  data directory, `~/.config/shinsa`).
- The three-way request classification and the "untrusted sees only `/health` and the token-gated `/ws`" rule.
- The split: HTTP through the proxy, the socket direct to the tunnel host with a connect token.
- An append-only wire contract file, `packages/core/src/remote/contract.ts` (no Bun or node imports), mirrored in
  the hosted repo, with a wire e2e behind a `.e2e.ts` suffix.

**Change:**

- **The daemon owns it, not a launch flag.** Kanna brings the tunnel up from the CLI. Shinsa's daemon runs as a
  launchd user agent (`docs/plans/desktop-plan.md`), so the remote runtime starts with `shinsa engine` when
  `remote.json` says enabled, and the background service keeps it up through a closed window and a reboot.
- **One person, so a smaller hosted side.** Kanna's control plane serves accounts with fleets of machines. Shinsa's
  hosted side (a Cloudflare Worker on the Shinsa domain, its own private repo) needs: sign-in for one person with a
  passkey, pairing, creating the named tunnel and its DNS record, heartbeat and offline, and the proxy. No fleet
  picker at first; a second machine is a second subdomain.
- **Guard order.** Shinsa's `http/guard.ts` refuses any Host it does not know. The remote classification runs first;
  a `proxied` request then passes the existing guard with the app origin (`‹machine›.‹shinsa domain›`) and the tunnel
  host added to the allowed hosts from `remote.json`, never through `SHINSA_ALLOWED_HOSTS` by hand. The webhook route
  keeps its own rules and becomes reachable on the tunnel host, which gives schedules a stable public URL
  (`docs/engine.md` → Webhooks).
- **Surface on hello.** The socket's `hello` already names a surface (`desktop` or `browser`). A remote page says
  `remote`, so the server knows which sockets are off the machine (for the rules below) and the desktop app stays the
  one surface that notifies while it is connected.
- **Settings, not a terminal step.** Pairing lives in Settings → General → Remote access (link and QR, status, turn
  off, remove) and in `shinsa remote pair|status|enable|disable|remove`. Both are human-only.

## The security model

Today Shinsa has no keys on purpose: it binds to `127.0.0.1`, anything that passes the Host and Origin guard is you,
and the human-only list (`docs/engine.md` → Who can change Shinsa) is enforced by agents having no tool for those
decisions and by core refusing them on an agent's behalf. A tunnel removes "nothing off the machine reaches it", so
remote access must put a real credential in front of every request without weakening any of those locks.

- **Nothing reaches Shinsa from the internet without a sign-in.** HTTP must come through the proxy, which checks your
  passkey session and sends the proxy secret. The socket must carry a connect token, which is minted only for a
  proxied request. Everything else on the tunnel is `/health`, a webhook with its token, or 404.
- **The local guard does not move.** A local request is still judged by the loopback rules. A request with
  `cf-connecting-ip` is never local, whatever its Host says.
- **Remote is the human, through the same commands.** A signed-in remote page is you, so its commands are yours and
  can close gates, exactly like the web app on the machine. Nothing new is added to the agent surface: remote changes
  who can reach the server, not what an agent can do. `humanOnly` specs stay out of every agent's tools,
  `agents/policy.ts` keeps refusing the human-only `shinsa` commands in an agent's shell, and core keeps refusing
  `gate.answer`, stepping past an open gate and human-only settings on an agent's behalf (`assertHumanDecides`,
  `assertGatesStayOpen`).
- **Some human-only decisions stay at the keyboard.** These are refused for a remote request (a new `local_only`
  refusal in the HTTP layer, from the request class, with a plain message): giving or declining a secret (`gates
  secret`, `gates decline-secret`, `schedules webhook-secret`), since Cloudflare sees the traffic in clear text;
  signing in and the accounts Shinsa runs on; MCP sign-in and every MCP, plugin and skill switch; `versions update`;
  `tasks open`; the background service; and pairing, turning remote off and removing it. The human-only settings that
  spend money or merge (`HUMAN_ONLY_SETTINGS`) and a repository's checks (`HUMAN_ONLY_REPO_FIELDS`) are local only as
  well at first. On a phone such a gate shows what it needs and says to finish it on the Mac.
- **Agents never get the remote credentials.** `remote.json` holds the tunnel token, the proxy secret and the
  machine token. Agents run as you with a shell, so a file cannot be hidden from them; `agents/policy.ts` refuses
  reading it in an agent's shell as a guard rail. An agent on the machine gains nothing from them (it can already
  reach `localhost`); the danger is a leak off the machine, since the proxy secret sent straight to the tunnel host
  passes as proxied. So rotating all three is one action in Settings (the hosted side issues new ones), and the
  machine could also require the proxy to sign each request with a timestamp instead of a fixed secret (question 6).
- **Revoke from anywhere.** The hosted dashboard can revoke the machine; the next heartbeat gets 401 and the tunnel
  stops. Turning remote off on the machine stops the connector and marks it offline at once.
- **Merges still rest on branch protection.** A phone that can approve a merge is the same person as the Mac. The
  real lock on merges stays GitHub's branch protection, as today.

## The phone surface

The phone gets the same app, served by the same daemon, laid out for a phone (`docs/design.md` → Where Shinsa
differs, 12: mobile is a first-class target). What changes on a remote phone is what is offered, not a second app.

- **In:** Home (the briefing and the queue: Needs you, In progress, Waiting on another task), All tasks, the new-task
  box, a task's Overview and Chat, and every gate that is read and decided: answer a question, approve a plan or say
  what to change, approve or decline a proposed change, approve a merge, retry or cancel a failure, read a work report
  (sections, judgement calls, checks, evidence) and a diagnosis or report, send a message, start, pause and cancel
  tasks and change their priority, and the focus.
- **Out:** the Code tab and every code view (the review split, the file tree, diffs, the editor and its suggested
  changes, line comments), opening a worktree, and Settings beyond Remote access status and Appearance. A review gate
  on a phone shows the work report and offers Request changes with a message; approving a review that has spots to
  read waits for a screen with the code (question 2).
- **Notifications.** A phone tab only notifies while open. Push (Web Push with a service worker, or a small iOS
  wrapper) is a later phase, and only when no desktop surface is connected.

## Phases

0. **Prerequisites (no network).** `surface: 'remote'` on hello, the request class in the HTTP layer, the
   `local_only` refusal and its tests, and the phone surface's In and Out rules behind a flag so they can be checked
   on a phone on the local network first.
1. **Machine side.** `apps/server/src/remote/`: identity file, control-plane client, supervisor, connect tokens,
   pairing, the guard integration, `shinsa remote …`, Settings → General → Remote access. Tested against a fake
   control plane, as Kanna's tests do.
2. **Hosted side.** The Worker on the Shinsa domain: passkey sign-in, pairing claim page, named tunnel creation,
   heartbeat, the proxy and `/__remote/*`. The contract file mirrored and the wire e2e green.
3. **Phone polish.** Every In surface checked at phone width with real data, the gates' "finish it on the Mac" state,
   install as a home-screen web app.
4. **Later.** Push notifications, a second machine, webhooks on the tunnel host by default.

## Risks

- Cloudflare terminates TLS on both the proxy and the tunnel, so it can read gate answers, chat messages and code
  shown in the chat. Acceptable for a personal tool only with secrets kept local, as above.
- A second public entry point is a second place to get the guard wrong. The request class must be decided once,
  first, and every route test must run in all three classes.
- `cloudflared` is a binary downloaded on first use; pin its version and check it like Claude Code and Codex
  (`versions`), rather than taking whatever the package fetches.
- The hosted side is a second repo that deploys on its own; the append-only contract and the wire e2e are what keep
  an older machine working.

## Questions only you can answer

1. Which domain, and one subdomain per machine (`mac.‹domain›`) or a fixed one?
2. Can a review be approved from a phone after reading the work report alone, or does approval always need the code?
3. Should merges be approved remotely too, or local only like the settings that merge?
4. Hosted sign-in: a passkey on a small Worker (Kanna's shape), or Cloudflare Access in front of the tunnel (no
   sign-in code to write, but tied to a Cloudflare Zero Trust account and less like Kanna)?
5. Push notifications on the phone: a web app on the home screen, or a small iOS wrapper later?
6. Keep Kanna's fixed proxy secret, or have the proxy sign each request (an HMAC over the method, path and a
   timestamp) so a leaked value expires within a minute?
