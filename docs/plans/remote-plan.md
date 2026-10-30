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
   project you picked, then to a machine whose placement policy (such as `iOS, simulator` or `benchmark`) the request names, then
   to the one with the most room under its task capacity; picking one overrides it. Settings → Machines lists every
   machine with its status, its open tasks, its task capacity and Remove, and Settings → Policies says which machine runs which work. On the machine a
   device was added from, the dashboard calls that machine This machine.
3. **GitHub is the only sign-in.** On the machine, turning remote access on opens GitHub sign-in in your browser and
   that is what creates the instance and its tunnel. On app.shinsa.dev, GitHub sign-in shows your instances. An
   instance belongs to one GitHub account and is never shared.
4. **Each machine dials out through its own Cloudflare tunnel.** `cloudflared` runs with a token for that machine's
   named tunnel; no inbound port is ever opened.
5. **The hosted web app is the same web app.** `apps/web` built in remote mode and served by the Worker; it talks to
   your local engine and holds no state of its own. Nothing is copied to the cloud.
6. **End to end encrypted, with each device enrolled at the machine.** Cloudflare terminates TLS at its edge, so TLS alone
   would let it read chat, gate answers and code. Every byte between an enrolled browser and the engine is sealed
   with keys only those two hold. A browser is trusted once, by scanning a QR the machine shows; a GitHub account alone
   opens nothing.
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

## Later

- Push notifications on a phone, and a smaller phone surface.
- Terminals over remote access.
- Sharing an instance with another GitHub account.
- Placement policies a project or a kind of task asks for (macOS for simulators) beyond words in the request, and a
  machine's own engine on Linux and Windows.
- Moving a task to another machine, and running one run of a task (a check, a delegation) on another machine.
