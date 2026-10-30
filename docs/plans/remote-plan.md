# Shinsa from anywhere

**Built** (LOC-40). How it behaves is `docs/engine.md` → Remote access, the wire format and the handshake are
`docs/protocol.md` → Remote access, the commands are `docs/cli.md` (`shinsa remote …`) and the hosted side is
`apps/cloud/CLAUDE.md`. This file keeps the decisions it was built on, the risks that remain and what is still to
come.

Reference: Kanna's cloud mode, `/Users/christo/Developer/Projects/kanna/src/server/cloud/` and
`kanna/src/shared/cloud-api.ts`. Shinsa copied its machine side (tunnel supervisor, request classes, pairing loop)
and changed the rest: one URL instead of a URL per machine, GitHub sign-in, and end-to-end encryption.

## Decisions

1. **One URL per login: `https://shinsa.dev/app`.** Everyone opens the same address and signs in. It is a path of
   the site, not a subdomain: the site's Worker hands `/app` to the dashboard's Worker. Kanna gives each
   machine its own subdomain (`‹sub›.kanna.sh`); Shinsa never does. A machine's tunnel host exists only as plumbing
   the browser connects to after sign-in, never as an address you type or share.
2. **Machines are a first-class part of one dashboard.** There is nothing to open: the dashboard is the same whether
   you have one Mac or 20. It connects to every Mac this browser was added to at once, each over its own sealed
   channel, merges their tasks, queue and gates into one view, and shows each task's Mac on the task, as Kanna does.
   A new task runs on the Mac of the project you pick. Settings → Machines lists every Mac with its status and
   Remove.
3. **GitHub is the only sign-in.** On the machine, turning remote access on opens GitHub sign-in in your browser and
   that is what creates the instance and its tunnel. On shinsa.dev/app, GitHub sign-in shows your instances. An
   instance belongs to one GitHub account and is never shared.
4. **Each machine dials out through its own Cloudflare tunnel.** `cloudflared` runs with a token for that machine's
   named tunnel; no inbound port is ever opened.
5. **The hosted web app is the same web app.** `apps/web` built in remote mode and served by the Worker; it talks to
   your local engine and holds no state of its own. Nothing is copied to the cloud.
6. **End to end encrypted, with each device enrolled at the Mac.** Cloudflare terminates TLS at its edge, so TLS alone
   would let it read chat, gate answers and code. Every byte between an enrolled browser and the engine is sealed
   with keys only those two hold. A browser is trusted once, by scanning a QR the Mac shows; a GitHub account alone
   opens nothing.
7. **Webhooks get a stable public URL through the hosted side**:
   `https://shinsa.dev/app/hooks/‹instance›/‹schedule›/‹token›`, forwarded to the machine's tunnel. Outside
   services (Maple alerts, GitHub, Stripe) call it; the URL does not change when the tunnel does.

## The pieces

```
browser on shinsa.dev/app ──HTTPS──► Worker (apps/cloud, D1)   sign-in, instances,
        │                                  │                    pairing, connect tokens,
        │ wss + connect token              │ Cloudflare API     webhooks, the web build
        ▼                                  ▼
t-‹instance›.shinsa.dev ◄── outbound tunnel ── cloudflared ── the engine
        sealed frames only                                    (127.0.0.1)
```

## Risks

- **The code's origin is trusted.** The web app's JavaScript comes from shinsa.dev/app through Cloudflare. Whoever
  controls that deploy, or Cloudflare acting against you, could serve code that sends keys away. Browser E2E cannot
  remove this; it protects against reading traffic, not against altered code. An installed app would.
- **A second public entry point.** The request class is decided once, first, from `cf-connecting-ip`, and every route
  test runs as local and as remote.
- **`cloudflared` is a downloaded binary**, so it is pinned and checksummed rather than whatever the package fetches.
- **Metadata stays visible**: when you use Shinsa, from where, and how much.

## Later

- Push notifications on a phone, and a smaller phone surface.
- Terminals over remote access.
- Sharing an instance with another GitHub account.
