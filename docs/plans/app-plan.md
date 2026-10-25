# Shinsa is a Mac app

**Decided 2026-10-25, not built.** On your Mac, Shinsa is one app. There is no server to start, no port to know and
no web page to open. The engine still runs as its own process, out of sight, because some work has to go on while
the app is closed. This plan replaces the parts of `docs/plans/desktop-plan.md` that treat `shinsa serve` as
something you run, and it is the local half of `docs/plans/remote-plan.md`.

## What you see

- **You download Shinsa, open it, and it works.** The first launch sets up the engine in the background, asks which
  folders hold your repositories, and offers to install the `shinsa` command. Nothing else to install or run.
- **On your Mac you only ever use the app.** Every decision, every review and every setting is in the app. A browser
  on the same Mac gets nothing from Shinsa.
- **Closing the app stops nothing.** Agents keep working, schedules keep firing and webhooks keep arriving. Opening
  the app again shows where everything is, and the Dock badge counts what needs you.
- **Away from your Mac** you use the hosted dashboard, the same interface on a Shinsa domain, reaching your Mac
  through `docs/plans/remote-plan.md`. A phone app comes later. Both only ever talk to your Mac's engine; nothing
  about your work is stored in the cloud.
- **The `shinsa` command is for doing things, not for running Shinsa.** `shinsa .` opens the app on the project
  you are in, the way `code .` opens an editor. `shinsa do "…"` starts a task, and the existing groups (`tasks`,
  `reviews`, `schedules`…) stay for you and for agents. `serve`, `service` and `open` go away.

## Why the engine still runs on its own

The question was whether Shinsa needs a process that outlives the app at all. It does, for three reasons, each
enough alone:

1. **Automations.** Schedules and webhooks are fired by the engine's own clock and receiver (`ScheduleClock`,
   `docs/engine.md` → Schedules and webhooks), not by macOS. A nightly task that only runs while a window is open is
   not a schedule. Handing each schedule to launchd as its own calendar job was considered and rejected: webhooks
   still need a listener, and the rules (missed runs fire once, skip while the last task is open, `max_runs`) live in
   core and would have to be split across two places.
2. **Agent runs are long.** A task can build for an hour. Quitting the app, or the app crashing or updating, must
   not stop or restart a run.
3. **Remote access.** The hosted dashboard and the phone reach your Mac through the engine; with the app closed there
   would be nothing to reach.

So the engine stays one process with the event log, the agents, git and GitHub, exactly as today. What changes is
who starts it (the app, never you), how it is shipped (inside the app) and who may talk to it (the app, the
`shinsa` command and agents on this Mac, and the hosted dashboard through the tunnel).

## How it is built

### One bundle

```
Shinsa.app/Contents/
├── MacOS/Shinsa                         Electron, the window
├── Resources/bin/shinsa                 the engine and the command line, one executable
├── Resources/app/                       the interface, built from apps/web
└── Library/LaunchAgents/
    └── studio.overclock.shinsa.engine.plist
```

- **The engine is compiled with `bun build --compile`** into one executable, so the Mac needs no Bun. The same
  executable is the command line: with no arguments under launchd it runs the engine, with arguments it is a
  command. Bun's SQLite is built in. What the compile has to carry beside it, the Claude Agent SDK's own CLI and
  the plugin agents load (`apps/server/plugin`), goes into `Resources/` and is found relative to the executable.
  Proving this compile is the first step, since everything else depends on it.
- **The interface ships in the app.** The window loads `Resources/app` from a custom scheme (`shinsa-app://`), not
  from an HTTP port, so the app's interface and engine are always the same version and no page is served on
  localhost. The hosted dashboard is the same `apps/web` build, deployed there.
- **The engine is a LaunchAgent the app registers**, with `app.setLoginItemSettings({ type: 'agentService' })`
  (Electron's wrapper for `SMAppService`, macOS 13 and later), pointing at the plist inside the bundle. macOS lists
  it in System Settings → Login Items as Shinsa; moving or deleting the app takes it with it. The plist keeps
  today's behaviour (`docs/engine.md` → The background service): started at login, restarted after a crash, logs in
  the data directory.

### Who talks to the engine

- **Locally, over a Unix socket** in the data directory (`~/.config/shinsa/engine.sock`, mode 600), not a TCP port.
  Only processes running as you can open it, which covers the app, the command line and agents, and there is no
  port for a browser or another user to find. The HTTP and WebSocket protocol on it are unchanged.
- **Remotely, through the tunnel** in `docs/plans/remote-plan.md`. The connector forwards to the same socket and
  the request guard there stays as planned: only signed-in, proxied requests get through.
- **Webhooks** arrive through the tunnel too, on `/api/hooks/<id>/<token>`, so a webhook schedule needs remote
  access switched on. Until then it is offered only with that note.

### The command line

- On first launch the app offers **Install the `shinsa` command**, which links `Resources/bin/shinsa` into
  `/usr/local/bin` (asking for your password once) or `~/.local/bin` when that is on `PATH`, as VS Code does.
  Settings → General can install or remove it later.
- `shinsa .` and `shinsa <path>` open the app (`open -b studio.overclock.shinsa shinsa://project?path=…`) on that
  project, registering the repository if Shinsa has not worked there yet.
- Every other command talks to the engine over the socket. If the engine is not running it asks launchd to start
  it (`launchctl kickstart`), waits for it, then carries on; if the app was never opened it says to open Shinsa
  once.
- Removed: `serve`, `service install|uninstall|status|restart|logs` and `open`. Settings → Advanced keeps what
  `service` was for: whether the engine is running, its version and log, and Restart.

### Versions and updates

- **One version for everything.** Shinsa has one version number (semver, tags `v0.4.2`) for the app, the engine, the
  interface and the command line, because they ship in one bundle. That is how VS Code and its server, Docker
  Desktop and its engine, and Tailscale's app and `tailscaled` do it: no separate engine release, no table of which
  app works with which engine. Some changes touch only the app, some only the engine, some both; all of them ship as
  the next Shinsa version.
- **The app updates itself** (built: `apps/desktop/src/main/updater.ts`, `lib/update.ts`). electron-updater checks
  the release feed when the app starts and every four hours, downloads a new version in the background and installs
  it the next time you quit; Shinsa → Restart to Update installs it now, and a notification says it is ready. Shinsa
  → Check for Updates… checks by hand and says when you are up to date. Quitting or restarting the app never stops
  the engine, so an app update cannot interrupt an agent.
- **The engine follows the app, when it is safe** (phase 2, with the bundle). After the app restarts on a new
  version, the engine inside it is newer than the one running. The engine reports its version and a `protocol`
  number in `/api/health`; `protocol` goes up only when the contract between the interface and the engine breaks
  (an HTTP route, a socket message, the state's shape), so most releases keep it.
  - **Same protocol:** the app keeps working with the running engine and restarts it (`launchctl kickstart -k`) the
    next time no agent run is mid-turn and no effect is in flight. The health banner says "Shinsa 0.5.0 finishes
    updating when agents are idle", with **Restart now**.
  - **New protocol:** the interface cannot talk to the old engine. If nothing is running the app restarts the engine
    at once; otherwise the banner asks: **Restart now** (runs resume on their own sessions afterwards) or **When
    agents are idle**, and only the banner shows until then.
  - **An engine newer than the app** (an app put back to an older version): the app does not talk to it and asks you
    to update.
  - The engine is restart-safe by construction (`docs/engine.md` → Recovery): the event log holds everything, and a
    run cut off by the restart resumes on its own session with a line in its chat.
- **Why not update the engine separately:** two version numbers means a compatibility matrix to keep and to explain,
  and every bug report starts with "which engine?". With one bundle the app is the thing you install and update, and
  updating the engine is a restart.
- **Releasing** (built: `.github/workflows/release.yml`). Actions → Release → Run workflow, choosing patch, minor or
  major (or `gh workflow run release.yml -f bump=minor`). It takes the latest `v*` tag, raises it, builds the DMG
  and the zip with that version, signs and notarizes when the Apple secrets are set, and publishes the GitHub
  release with `latest-mac.yml`, the file the updater reads, and notes from the merged pull requests. Nothing to bump
  by hand: the version lives in the tag, not in `package.json`.
- **Installing an update needs a signed app.** macOS's updater (Squirrel.Mac) installs a new version only when it is
  signed by the same Developer ID as the running one. Ad hoc builds download updates but cannot install them, so
  auto-update works from the first release signed with the secrets in Distribution, below. The feed is the releases
  of `shinsa-dev/shinsa`, which the app reaches without signing in once the repository is public.

### Development

Developing Shinsa keeps today's loop: `bun dev` runs the engine from source and Vite for the interface, and
`bun run dev` in `apps/desktop` opens the window on it. That is a developer tool in `package.json`, not a command
the product has, so it is the one place an HTTP port and a browser tab still exist. `SHINSA_HOME` keeps a separate
data directory for it.

## Distribution

- **Signed and notarized.** A Developer ID certificate and notarization are needed, not optional: Gatekeeper blocks
  an unsigned download, and `SMAppService` will not register the engine from an unsigned app. The release workflow
  (`.github/workflows/release.yml`) gets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
  and `APPLE_TEAM_ID` as secrets and drops `mac.identity=-`.
- **Releases live in this repository.** `shinsa-dev/shinsa` goes public, under MIT, when Shinsa launches; until
  then its release files cannot be downloaded without signing in, which is fine while nothing is published.
  `shinsa.dev/download` points at `releases/latest/download/Shinsa-mac-arm64.dmg`, GitHub counts every download, and
  electron-updater reads the same releases.
- **Artifacts**: `Shinsa-mac-arm64.dmg` for the download, and the `zip` and `latest-mac.yml` electron-updater
  needs, on every release.

## Permissions

Running in the background needs no prompt of its own, but three things can stop the engine without a word, so
onboarding checks each and says how to fix it, and Settings shows the same rows afterwards:

- **Login item.** Registering the LaunchAgent shows macOS's own "Background item added" notice, and you can turn it
  off in System Settings → General → Login Items. The app reads the registration's status (`enabled`,
  `requiresApproval`, `notRegistered`) on every launch; anything but `enabled` is an onboarding step and a health
  banner with a button that opens Login Items (`SMAppService.openSystemSettingsLoginItems`).
- **Folders macOS protects.** Desktop, Documents, Downloads and iCloud Drive need consent per app, and a background
  process cannot ask for it well. When a folder chosen at onboarding is inside one, the step asks for Full Disk
  Access for Shinsa's engine, with the button that opens Privacy & Security; repositories anywhere else, such as
  `~/Developer`, need nothing.
- **Notifications.** The app asks once, the first time it has something to tell you, and onboarding offers to ask
  up front. Denied notifications still leave the Dock badge.

Nothing else: no accessibility, screen recording or network permission. Agents' own tools (a browser for evidence,
a simulator) ask for theirs when they first use them.

## When the engine is not running

The engine is what does the work, so the app never lets it stop without saying so. The app's main process watches it
and every page shows what it finds in the health banner at the top (`lib/connection/health.ts`, the same banner
`GET /api/health` fills today), above whatever page you are on, until the engine is back:

| What happened | How the app knows | What the banner says and offers |
|---|---|---|
| The login item is off or waits for approval | `SMAppService` status on launch and on every reconnect | Shinsa cannot run in the background; **Open Login Items** |
| The engine crashed and launchd is restarting it | the socket drops, launchd's last exit status | The engine stopped and is restarting; it clears itself, or after three crashes in ten minutes becomes the next row |
| The engine keeps crashing | repeated exits, the engine's crash file in `data/` | The engine keeps stopping, with the last error; **Restart engine**, **Copy details** |
| The engine was killed and is not coming back | no socket, the job not loaded | The engine is not running; **Start engine** (registers and kicks the job) |
| A folder it needs is blocked | the engine reports `EPERM` on a chosen folder | Shinsa cannot read ‹folder›; **Open Privacy & Security** |
| The engine is older than the app, after an update | `version` and `protocol` in `/api/health` | Shinsa ‹version› finishes updating when agents are idle; **Restart now** (Versions and updates, above) |

Each row links to a short guide (`docs/troubleshooting.md`, and the same text on shinsa.dev) with the steps by hand,
for when the button is not enough. A crash also leaves a line in the task's chat for any run it cut off ("The engine
stopped during this run; it resumed when the engine came back"), as recovery does today. While the app is closed
nothing can warn you on the Mac; the hosted dashboard shows that your Mac is offline, and the Dock badge shows a
warning sign the next time the app opens.

## What goes away

- `shinsa serve` as a command, and the CLI's default of running it.
- `shinsa service` and `shinsa open`, with their specs in `apps/server/src/surface/` and `docs/cli.md`.
- The engine's TCP port, `port` in `config.json`, `SHINSA_PORT` and `SHINSA_URL` outside development.
- The desktop app's "Shinsa is not running" page and its health polling of `127.0.0.1:5180`: the app starts the
  engine itself and connects over the socket.
- The surface handshake for browser tabs (`hello { surface }`, quiet pages): with no local browser surface, the app
  is the only one that notifies. The hosted dashboard notifies only while the app is not connected.
- The README's and onboarding's "open http://localhost".

## Phases

1. **The compiled engine.** `bun build --compile` of `apps/server` with the Agent SDK, the plugin and Eunoe beside
   it; a release workflow artifact that runs a task end to end on a clean Mac without Bun.
2. **The bundle and the LaunchAgent.** The engine inside `Shinsa.app`, registered by the app, the Unix socket, the
   interface from `shinsa-app://`, the engine's rows in the health banner, and the engine following the app after an
   update (`protocol` in `/api/health`, the restart when agents are idle). Pass: install from the DMG, open, finish
   onboarding, quit, and a schedule still fires; update, and a run in progress finishes before the engine restarts.
3. **The command line.** Install the `shinsa` command, `shinsa .`, socket transport, the removals above.
4. **Signed releases.** The Developer ID certificate and notarization secrets, after which auto-update installs
   (the updater and the release workflow are already built).
5. **Remote.** `docs/plans/remote-plan.md`, against the socket, with the hosted dashboard deployed from `apps/web`.

Docs change with each phase, not before it: `docs/spec.md` → Architecture, `docs/engine.md` → The background
service and Configuration and data, `docs/cli.md`, the desktop and server `CLAUDE.md` files and the README.

## Open questions

- **Floaty.** It shows Shinsa as a page in its own window, which needs a local page. Either Floaty gets a way to
  show the app's window, or it uses the hosted dashboard, or it is dropped for Shinsa.
- **Other Macs and Linux.** The engine is Bun and runs anywhere; only the LaunchAgent and the app are macOS. A
  headless engine on a Linux box, reached only through the hosted dashboard, would need a supervisor of its own
  (systemd). Not planned until someone needs it.
- **Intel Macs.** Builds are Apple Silicon only, as today.
