# Shinsa from anywhere

**Built** (LOC-40). How it behaves is `docs/engine.md` → Remote access, the wire format and the handshake are
`docs/protocol.md` → Remote access, the commands are `docs/cli.md` (`shinsa remote …`) and the hosted side is
`apps/cloud/CLAUDE.md`. This file keeps the decisions it was built on, the risks that remain and what is still to
come.

Reference: Kanna's cloud mode, `/Users/christo/Developer/Projects/kanna/src/server/cloud/` and
`kanna/src/shared/cloud-api.ts`. Shinsa copied its machine side (tunnel supervisor, request classes, pairing loop)
and changed the rest: one URL instead of a URL per machine, GitHub sign-in, and end-to-end encryption.

## Decisions

1. **One URL per login: `https://app.shinsa.dev`.** Everyone opens the same address and signs in. It is one fixed
   subdomain with the app at its root, an origin of its own apart from the marketing site. Kanna gives each
   machine its own subdomain (`‹sub›.kanna.sh`); Shinsa never does. A machine's tunnel host exists only as plumbing
   the browser connects to after sign-in, never as an address you type or share.
2. **Machines are a first-class part of one dashboard.** There is nothing to open: the dashboard is the same whether
   you have one machine or 20. It connects to every machine this device was added to at once, each over its own sealed
   channel, merges their tasks, queue and gates into one view, and shows each task's machine on the task, as Kanna does.
   A machine is a computer that runs the engine and the only place tasks run; a device (a browser or a phone) is only
   a way in. With two machines or more, New task has a Machine picker: Automatic sends a task to the machine of the
   project you picked, then where your routing policies send it: sentences in plain English per machine, such as "Run Xcode simulator tests here.", that the classifier reads with the request, then
   to the one with the most room under its task capacity; picking one overrides it. Settings → Machines lists every
   machine with its status, its open tasks, its task capacity and Remove, and Settings → Routing policies says which machine runs which work. On the machine a
   device was added from, the dashboard calls that machine This machine.
3. **GitHub is the only sign-in.** On the machine, turning remote access on opens GitHub sign-in in your browser and
   that is what creates the instance and its tunnel. On app.shinsa.dev, GitHub sign-in shows your instances. An
   instance has one owner, the GitHub account that paired it, and may have members, who reach it exactly as the owner
   does, so a team can share one machine, such as a server everyone uses. Nobody gets in by holding a link: the
   machine's one reusable invite link lets any device, yours or someone else's with their own GitHub account, ask
   for access, and you accept or decline each request on the machine or from any device that already reaches it.
   Accepting a request from an account not yet on the machine makes it a member. Only the machine invites or removes a member; a member
   can leave.
4. **Each machine dials out through its own Cloudflare tunnel.** `cloudflared` runs with a token for that machine's
   named tunnel; no inbound port is ever opened.
5. **The hosted web app is the same web app.** `apps/web` built in remote mode and served by the Worker; it talks to
   your local engine and holds no state of its own. Nothing is copied to the cloud, shared tasks included: a task you
   share is read live from the machine, by read-only remote access to that one task. Its link
   (`app.shinsa.dev/share/t/‹token›#‹key›`, one opaque token rather than a readable machine or task name) opens a channel through the machine's tunnel that is sealed with
   the key in the link's fragment, which no server sees; the machine pushes the task down it the moment it changes and
   reads nothing back. A link shows what its owner sees on its Overview, Review and Code: the request, plan, phase
   reports, walkthrough, review, checks with their output, evidence, activity, notes, gates without their answers, who
   worked and when, the pull request whole, its diff and its changed files whole from GitHub, for a private repository
   too, on the owner's own task page with every control taken away. Chats, transcripts, tool calls, live agent output,
   messages to agents, gate answers, attachments and accounts never leave the machine (`docs/engine.md` → Sharing a
   task). Teams use the same projection, channel and page for whole projects: you put your projects in a team, and
   every member watches their tasks live and read-only, next to their own and marked with their owner. A team is
   only who is in it on app.shinsa.dev; its views are sealed with a team key kept on members' machines and browsers,
   carried in the join link's fragment, and a member must also be one in the machine's own copy of the team. Joining
   is a request the owner accepts, as for a machine (`docs/engine.md` → Teams).
6. **End to end encrypted, with each device enrolled at the machine.** Cloudflare terminates TLS at its edge, so TLS alone
   would let it read chat, gate answers and code. Every byte between an enrolled browser and the engine is sealed
   with keys only those two hold. A browser is trusted once: it asks for access through a link the machine shows, and
   the machine takes its key only once you accept; a GitHub account alone opens nothing.
7. **Webhooks get a stable public URL through the hosted side**:
   `https://app.shinsa.dev/hooks/‹instance›/‹schedule›/‹token›`, forwarded to the machine's tunnel. Outside
   services (Maple alerts, GitHub, Stripe) call it; the URL does not change when the tunnel does.

## The pieces

```
browser on app.shinsa.dev ──HTTPS──► Worker (apps/cloud, D1)   sign-in, instances,
        │                                  │                    pairing, connect tokens,
        │ wss + connect token              │ Cloudflare API     webhooks, the web build
        ▼                                  ▼
t-‹instance›.shinsa.dev ◄── outbound tunnel ── cloudflared ── the engine
        sealed frames only                                    (127.0.0.1)

anyone with a share link ──wss, sealed with the link's key──► t-‹instance›.shinsa.dev/share
        the machine pushes one task, reads nothing back; app.shinsa.dev stores nothing
```

## Risks

- **The code's origin is trusted.** The web app's JavaScript comes from app.shinsa.dev through Cloudflare. Whoever
  controls that deploy, or Cloudflare acting against you, could serve code that sends keys away. Browser E2E cannot
  remove this; it protects against reading traffic, not against altered code. An installed app would.
- **The dashboard has its own origin.** app.shinsa.dev is not shinsa.dev, so nothing the marketing site runs can
  reach the enrolled device keys (IndexedDB), the session cookie or `/__remote/instances/<id>/connect`.
- **Machines' hosts are same-site with the dashboard.** `t-<id>.shinsa.dev` is served by whichever machine owns it,
  so the cookies carry the `__Host-` prefix (no other host can set or replace them) and every POST a page makes needs
  the dashboard's exact `Origin`; SameSite alone would not keep a sibling host out.
- **Who can get in.** Sign-in is GitHub OAuth with PKCE, open to any GitHub account: an account
  lists only the machines it paired, and even a signed-in account reaches no machine: the tunnel answers only the sealed channel,
  which needs a device key that machine enrolled and proves the machine's own key, pinned from its QR.
- **Anyone can make a tunnel on our account.** Any GitHub account can pair up to 5 machines, and each is a named
  Cloudflare tunnel and a proxied `t-<id>.shinsa.dev` host on our account, serving whatever that machine answers (the
  engine answers only health, webhooks and the sealed channel, but a modified engine could serve anything under our
  domain). The Worker caps the whole service at `MAX_INSTANCES` (50 by default) so the account's tunnel and DNS quotas
  hold; past it an approval is refused with `service_full`. Abuse is handled by removing the instance.
- **A second public entry point.** The request class is decided once, first, from `cf-connecting-ip`, and every route
  test runs as local and as remote.
- **`cloudflared` is a downloaded binary**, so it is pinned and checksummed rather than whatever the package fetches.
- **Metadata stays visible**: when you use Shinsa, from where, and how much.
- **A share link is a key.** Whoever holds the link reads the task, live, for as long as it is shared; Stop sharing
  ends every open link at once. app.shinsa.dev and Cloudflare never see the key (it is in the fragment) and carry
  only sealed frames, but the trusted-origin risk above applies: altered code on app.shinsa.dev could read a page's
  key. Check output and text an agent wrote are shown as written. A share ends by itself when the task is done, by
  default, or when its time runs out, and the task's page shows a banner for as long as it lasts.

## Parity with the machine

**In progress** (LOC-170). Everything the dashboard does at the machine it does from app.shinsa.dev too. The line
that keeps it safe: the machine's **owner** on a sealed channel counts as the keyboard, so what was local-only
becomes owner-only (`OwnerOnlyRoute`, 403 `not_owner`); a member, a guest, a share link and every agent stay refused.
Only what would end the channel you are using, or needs a program on the machine's screen, stays local.

Where a gate lives: a route's `LocalOnlyRoute` or `OwnerOnlyRoute` in core's `EngineApi` (`packages/core/src/engine-api/api.ts`,
listed by `listEngineRoutes`), checked by `TunnelGate.admitEndpoint` (`apps/engine/src/remote/gate/service.ts`); a
command's fields in core's `isOwnerOnlyCommand` (`packages/core/src/remote/local-only.ts`), checked by
`dispatchUserCommand` (`apps/engine/src/http/commands.ts`); and every `isRemoteBuild()` branch in `apps/web`.

### What the page cannot do today

| Area | Gate | Today from app.shinsa.dev | Fix | Phase |
|---|---|---|---|---|
| Code highlighting (Code tab, diffs, chat and review code blocks) | The hosted page's CSP, `script-src 'self'` (`apps/cloud/src/http/ingress/schema.ts`) | Shiki's WebAssembly regex engine is refused, so every file and diff is plain text; the theme boot script in `index.html` was refused too | `'wasm-unsafe-eval'` in `script-src`, the boot script moved to `public/color-scheme.js`; the sandbox sends the same headers | 1, done |
| Browser notifications | `isPageQuiet` → core's `isQuietSurface`, fed by `Fleet.isDesktopConnected` (`apps/web/src/lib/remote/fleet.ts`) | The page stays silent whenever the Mac app is open on any machine, since it assumes the desktop app notifies; on Android `new Notification()` throws (only a service worker may show one) | Done: the remote build never defers to a machine's desktop app; it shows notifications through the service worker's registration, and a click on one focuses or opens the task | 3 |
| Human-only settings (`HUMAN_ONLY_SETTINGS`: plan approval, merge method, budgets, usage limits, auto-resume, snoozing at a limit, account switching, fast mode, delegation and share limits, the share preset) | `isOwnerOnlyCommand`, `settings.change` | Refused, `local_only` | Owner-only | 4, done |
| A repository's checks, workspace and coverage (`HUMAN_ONLY_REPO_FIELDS`) | `isOwnerOnlyCommand`, `repo.update` | Refused | Owner-only | 4, done |
| Binding a task to an account | `isOwnerOnlyCommand`, `task.bind_account` | Refused | Owner-only | 4, done |
| Retrying a task on a chosen account | `isOwnerOnlyCommand`, `task.retry` with `account` | Allowed to any member | Owner-only, as binding an account | 4, done |
| Claude accounts: refresh, sign in (with the pasted code), cancel, import, update, remove | `OwnerOnlyRoute` (was `LocalOnlyRoute`), `accounts` group | Refused | Owner-only; sign-in uses the code you paste, since the browser that signs in is yours | 4, done |
| MCPs, plugins, skills, the context optimizer: check, add, update, remove, choose, sign out | `OwnerOnlyRoute` (was `LocalOnlyRoute`), `extensions` group | Refused | Owner-only | 4, done |
| An MCP's OAuth sign-in | `LocalOnlyRoute` and `TunnelGate.admitChannelRequest` refusing the callback path | Refused | Stays local: the provider redirects to the machine's own address | stays |
| Agent versions: update Claude Code and Codex | `OwnerOnlyRoute` (was `LocalOnlyRoute`), `POST /api/versions/update` | Refused | Owner-only | 4, done |
| Secrets and webhook signing secrets | `OwnerOnlyRoute` (was `LocalOnlyRoute`), `secrets` group | Refused, so a gate asking for a secret cannot be answered away from the machine | Owner-only; the value travels sealed end to end | 4, done |
| Restarting the engine | `OwnerOnlyRoute` (was `LocalOnlyRoute`), `POST /api/engine/restart` | Refused | Owner-only; the page reconnects as it does after any drop | 4, done |
| Onboarding and Settings → Folders: folders, privacy, flow | `OwnerOnlyRoute` (was `LocalOnlyRoute`), `onboarding` group | Refused | Owner-only | 4, done |
| Installing the command line | `LocalOnlyRoute`, `POST /api/onboarding/install` | Refused | Stays local: it writes into the machine's own `PATH` | stays |
| Teams: create, invite link, renew, requests, members, leave, remove | `LocalOnlyRoute`, `teams` group; the remote build shows `HostedTeamsSettings`, and the focus menu hides Edit teams | Read only | Owner-only (`OwnerOnlyRoute`): Settings → Teams for each machine you own (`MachineTeamsSettings`), its changes sent to that machine; the focus menu offers Edit teams; with no machine of yours, the read-only view stays | 5, done |
| Joining a team | `OwnerOnlyRoute`, `POST /api/remote/teams/join` | Owner only already | Unchanged, and now shown in the remote build's Teams | 5, done |
| Sharing (`SharingSettings`) | Hidden by `isRemoteBuild()` in `routes/settings.tsx` | Not shown | Shown, on the first machine like the rest of Settings; both settings owner-only (`HUMAN_ONLY_SETTINGS`) | 5, done |
| Slack | `LocalOnlyRoute`, `POST /api/slack/disconnect`; `SlackGroup onMachine={false}` | Connect worked; Disconnect hidden and refused | Disconnect owner-only (`OwnerOnlyRoute`) and shown as on the machine | 5, done |
| Remote access: invite link, members, revoke a device | `LocalOnlyRoute`, `remote` group; the remote build shows Settings → Machines instead | Only access requests can be answered | Owner-only (`OwnerOnlyRoute`): Remote access on <machine> in Settings → Machines for each machine you own (`MachineAccessGroup`), its changes sent to that machine | 5, done |
| Remote access: pair, cancel, pause, resume, remove | `LocalOnlyRoute`, `remote` group | Refused | Stays local: each one ends or replaces the channel you are using | stays |
| Services: start, stop, restart, start all | `LocalOnlyRoute`, `services` group | Read only; previews already open through the preview socket | Allowed to the owner and members, as any task control; with several machines, each request goes to the machine that runs the service (`Fleet`, `mergeFleetTerminals`) | 6, done |
| Services: add, change a command, remove, suggestions | `LocalOnlyRoute` and `BrowserOnlyRoute`, `services` group | Refused | Owner-only (`OwnerOnlyRoute`): a service's command runs on the machine; a channel request counts as Shinsa's own page for `BrowserOnlyRoute` | 6, done |
| Terminals | `LocalOnlyRoute`, `terminals` group; `TerminalPage` shows "Terminals stay on your machine"; the PTY stream is a local socket only | Not available | Owner-only, with terminal frames on the existing sealed channel; no new tunnel route | 7 |
| Opening a task in an editor on the machine | `LocalOnlyRoute`, `POST /api/tasks/:taskRef/open` | Refused | Stays local: it opens a window on the machine's screen | stays |
| Settings with more than one machine | Settings' reads and writes go to the first reachable machine (`Fleet.#memberOf`) | One machine's settings, accounts and MCPs only | A machine picker in Settings, routed with `?machine=` as access requests are | later |
| Web Push to a closed tab | None: not built | No notification once every tab is closed | A follow-up task: Shinsa Cloud relays sealed pushes | later |

Already the same in both: the overview, the queue, chat, every task action and its menu, the Code tab's reads
and edits, review, previews, statistics, models, memory, projects and schedules.

## Later

- Push notifications on a phone, and a smaller phone surface.
- Terminals over remote access.
- Sharing an instance with another GitHub account.
- A machine's own engine on Linux and Windows, and what it can do (macOS for simulators) told to the classifier
  without a policy saying it.
- Moving a task to another machine, and running one run of a task (a check, a delegation) on another machine.
