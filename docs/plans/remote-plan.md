# Shinsa from anywhere

**Approved, being built** (LOC-40). This file is the design; once a part is built, its behaviour moves to
`docs/engine.md` → Remote access, the wire format to `docs/protocol.md` → Remote access and the commands to
`docs/cli.md`, and this file keeps only what is still to come.

Reference: Kanna's cloud mode, `/Users/christo/Developer/Projects/kanna/src/server/cloud/` and
`kanna/src/shared/cloud-api.ts`. Shinsa copies its machine side (tunnel supervisor, request classes, pairing loop)
and changes the rest: one URL instead of a URL per machine, GitHub sign-in, and end-to-end encryption.

## Decisions

1. **One URL per login: `https://app.shinsa.dev`.** Everyone opens the same address and signs in. Kanna gives each
   machine its own subdomain (`‹sub›.kanna.sh`); Shinsa never does. A machine's tunnel host exists only as plumbing
   the browser connects to after sign-in, never as an address you type or share.
2. **Each machine is an instance.** After sign-in the dashboard lists your instances: name, online or offline, last
   seen, and whether this browser is enrolled on it. Opening one runs the full web app against that machine. One
   machine is the common case; the list is ready for several.
3. **GitHub is the only sign-in.** On the machine, turning remote access on opens GitHub sign-in in your browser and
   that is what creates the instance and its tunnel. On app.shinsa.dev, GitHub sign-in shows your instances. An
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
   `https://app.shinsa.dev/hooks/‹instance›/‹schedule›/‹token›`, forwarded to the machine's tunnel. Outside
   services (Maple alerts, GitHub, Stripe) call it; the URL does not change when the tunnel does.

## The pieces

```
browser on app.shinsa.dev ──HTTPS──► Worker (apps/cloud, D1)          sign-in, instances, pairing, connect tokens,
        │                                  │                           webhook forwarding, the web build
        │ wss + connect token              │ Cloudflare API: tunnel, DNS
        ▼                                  ▼
t-‹instance›.shinsa.dev ◄──outbound tunnel── cloudflared ── shinsa engine (127.0.0.1)
        sealed frames only                                   apps/engine/src/remote
```

- **`apps/cloud`** (`@shinsa/cloud`), a Cloudflare Worker on `app.shinsa.dev`, in this repo. D1 holds users (GitHub
  id and login), sessions, instances (owner, name, tunnel id, the hash of the machine token, the connect key, the
  machine's public key fingerprint, last heartbeat) and pair sessions. Secrets: the GitHub OAuth app's client id and
  secret, a Cloudflare API token scoped to Tunnel edit and DNS edit on the shinsa.dev zone, and the session signing
  key. It serves `apps/web/dist` (the remote build) as its assets and answers `/__remote/*` and `/hooks/*` itself.
- **`packages/core/src/remote/`** holds what both ends share and that has no I/O: the wire contract between the
  machine and the Worker, the handshake, frame sealing and the channel's messages, and the list of commands that are
  local only. It uses WebCrypto (`crypto.subtle`), which the browser, Bun and Workers all have.
- **`apps/engine/src/remote/`** is the machine side: the identity file, the control-plane client, the `cloudflared`
  install and supervisor, the tunnel request guard, connect tokens, the sealed endpoint, pairing and enrolled devices.
  The engine (`shinsa engine`, the launchd job the Mac app registers) starts it when `remote.json` says enabled, so it
  stays up through a closed window and a reboot.
- **`apps/web/src/lib/remote/`** and **`routes/remote/`** are the remote mode of the web app: the dashboard (sign-in,
  instances), the enroll page, the device key and the sealed channel client.

## Pairing a machine (GitHub sign-in on the machine)

1. Settings → General → Remote access → Turn on (or `shinsa remote pair`). The engine creates its identity key pair
   (ECDH P-256) if it has none and calls `POST /__remote/pair/start` with the machine's name and public key. The
   Worker returns a short claim code, a poll secret and a URL.
2. The engine opens `https://app.shinsa.dev/pair?code=‹claim›` in your browser. You sign in with GitHub, see the
   machine's name and its key fingerprint (the same fingerprint Settings shows), and approve.
3. The Worker creates the instance: a named Cloudflare tunnel, its ingress to `http://127.0.0.1:‹port›`, the DNS record
   `t-‹instance›.shinsa.dev`, a machine token and a connect key.
4. The engine, polling with the poll secret (which never leaves the machine), gets them once, writes `remote.json` and
   starts `cloudflared`. Polling lives on the engine, so pairing finishes even if you approve on another device.

Pairing, turning remote off and removing it are local only. The claim code travels in the URL; it is never enough to
collect the credentials, which need the poll secret too.

`remote.json` (data directory, written atomically with mode 600, never in the event log): instance id, machine token,
tunnel token, tunnel host, connect key, the machine's private key, the enrolled devices (name, public key, enrolled
at, last seen) and the `enabled` flag. A file with a missing field reads as not paired.

## Enrolling a device (at the Mac)

1. Settings → Remote access → Add device (local only). The engine makes a one-time enrollment secret that expires in
   10 minutes and shows a QR and a link: `https://app.shinsa.dev/enroll#‹instance›.‹machine public key›.‹secret›`.
   The part after `#` is a fragment, so it never reaches the Worker or Cloudflare.
2. On the phone or browser you open it, sign in with GitHub if you have not, and the page creates a device key pair
   (ECDH P-256, non-extractable, kept in IndexedDB) and pins the machine's public key from the fragment.
3. It connects to the instance and runs the handshake with an enrollment proof: an HMAC with the secret over the
   handshake transcript. The engine checks it, records the device's public key and spends the secret.
4. From then on that browser opens the instance with GitHub sign-in alone. Settings lists the devices; Remove takes
   one off at once and closes its open channel.

On the Mac itself, Add device has "Trust this browser", which opens the same link in the default browser.

## The sealed channel

The browser gets `wss://t-‹instance›.shinsa.dev/remote?token=‹connect token›` from
`POST /__remote/instances/‹id›/connect`. The connect token is an HMAC with the instance's connect key over the
instance, the GitHub user and an expiry 60 seconds out; the engine checks it before the upgrade. It keeps random
traffic off the endpoint, but trust does not rest on it: the Worker could mint one at will, and still gets nowhere
without an enrolled device key.

**Handshake** (Noise KK in spirit, built on WebCrypto):

- The browser sends its device public key, a fresh ephemeral public key and, when enrolling, the enrollment proof.
- The engine refuses a device key it does not know (unless the proof is valid), answers with its own ephemeral public
  key, and both sides compute `ee`, `es` (the browser's ephemeral with the machine's static key) and `se` (the
  device's static key with the engine's ephemeral).
- HKDF-SHA-256 over the three secrets and the transcript hash gives one AES-256-GCM key per direction. Each side's
  first sealed frame confirms the key. Only the holder of the machine's private key and an enrolled device's private
  key can finish it; a fresh ephemeral on each side gives forward secrecy.

**Frames.** Every message after the handshake is one binary WebSocket frame: AES-GCM with a 96-bit nonce from a
counter per direction; a frame out of order, repeated or that fails to open closes the channel. Inside, the channel
carries:

- the app socket: the same `ClientMessage` and `ServerMessage` the web app speaks on `/ws`, so the web app gets a
  socket-shaped object and does not know the difference;
- HTTP: a request (`id`, method, path, headers, body in chunks) and its response (status, headers, body in chunks,
  end), so streamed answers (`application/x-ndjson`) and uploads work. `<img src="/api/…">` and other plain loads go
  through a service worker that hands each `/api/` request to the page, which sends it over the channel.

The Worker and Cloudflare see the connection, its timing and its sizes, never its content.

## What the tunnel host answers

Every request that arrives through the tunnel carries `cf-connecting-ip` and is never local, whatever its Host says.
It sees:

- `/health`;
- `/api/hooks/‹schedule›/‹token›`, with the webhook's own checks (token, rate limit, size, signature);
- `/remote`, with a valid connect token and an Origin of `https://app.shinsa.dev`.

Every other path is 404, so the tunnel host leaks no surface. A request on loopback is judged by today's Host and
Origin guard, unchanged.

## Remote is you, minus what stays at the keyboard

A request inside a sealed channel is you, through the same commands, so it can close gates like the web app on the
machine. Nothing changes for agents: `humanOnly` specs stay out of every agent's tools, `agents/policy.ts` keeps
refusing human-only `shinsa` commands, and core keeps refusing gate decisions on an agent's behalf.

The engine knows a socket or request is remote from how it arrived, never from what the client says. These are
refused for remote with a `local_only` error ("Finish this on your Mac."):

- giving or declining a secret, and a webhook's signing secret;
- signing in, and the Claude accounts Shinsa runs on;
- MCP sign-in and every MCP, plugin and skill switch;
- `versions update`, `tasks open` and the background service;
- terminals;
- pairing, turning remote off, removing it, adding and removing devices.

`agents/policy.ts` refuses reading `remote.json` in an agent's shell as a guard rail.

## Revoking

- Remove a device on the Mac: its key is dropped and its open channel closed.
- Remove the instance on app.shinsa.dev: the Worker deletes the tunnel and its DNS record; the next heartbeat gets 401
  and the engine stops the connector and says to pair again.
- Turn remote off on the Mac: the connector stops and the instance shows offline at once.

## Webhooks

When remote access is on, a webhook schedule's URL is `https://app.shinsa.dev/hooks/‹instance›/‹schedule›/‹token›`.
The Worker forwards it to `https://t-‹instance›.shinsa.dev/api/hooks/‹schedule›/‹token›` with the method, headers and
body as they came, and passes the answer back. The engine's webhook checks are unchanged. A webhook is not end to end
encrypted: the sender speaks plain HTTPS to Cloudflare, as it would to any public endpoint. When the machine is
offline the Worker answers 503, so a sender that retries delivers later.

## The tunnel supervisor (copied from Kanna)

`cloudflared` is a pinned release downloaded on first use into the data directory and checked against its SHA-256
before it runs. The supervisor starts it with the tunnel token, waits for it to connect, heartbeats the Worker, pings
`https://‹tunnel host›/health` every 30 seconds and heartbeats every fourth ping. Three failed pings in a row restart
it; restarts retry every second for the first minute of a failure streak, then back off 2, 4, 10 and 30 seconds. A 401
means the instance was revoked: it stops. On shutdown it tells the Worker it is offline, capped at 2 seconds.

## The wire contract

`packages/core/src/remote/contract.ts` is the contract between the machine and the Worker. Both live in this repo, but
a machine updates on its own schedule and the Worker deploys on merge, so it is append-only: no field or path is
removed or renamed, only optional fields added.

## Risks

- **The code's origin is trusted.** The web app's JavaScript comes from app.shinsa.dev through Cloudflare. Whoever
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
