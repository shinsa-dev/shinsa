# Shinsa is a Mac app

**Decided 2026-10-25; phases 1 to 3 built 2026-10-26** (Phases, below, says what each one holds and what is left).
On your Mac, Shinsa is one app. There is no server to start, no port to know and
no web page to open. The engine still runs as its own process, out of sight, because some work has to go on while
the app is closed. This plan replaces the parts of `docs/plans/desktop-plan.md` that treat `shinsa engine` as
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
  `reviews`, `schedules`…) stay for you and for agents. `serve` and `service` go away; the engine's controls are
  `shinsa start`, `stop`, `restart`, `logs`, `status` and `version` (`docs/cli.md`).

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
├── Resources/engine/bin/shinsa          the engine, the command line and Eunoe, one executable
├── Resources/engine/plugin/             the plugin agents load
├── Resources/engine/web/                the interface, built from apps/web, served by the engine
└── Library/LaunchAgents/
    └── studio.overclock.shinsa.engine.plist
```

- **The engine is compiled with `bun build --compile`** into one executable, so the Mac needs no Bun. The same
  executable is the command line: with no arguments under launchd it runs the engine, with arguments it is a
  command. Bun's SQLite is built in. What the compile has to carry beside it, the Claude Agent SDK's own CLI and
  the plugin agents load (`apps/engine/plugin`), goes into `Resources/` and is found relative to the executable.
  Proving this compile is the first step, since everything else depends on it.
- **The interface ships in the app**, beside the engine, which serves it on its loopback port as before; the app and
  the engine are one build, so they are always the same version. Built that way rather than from a custom scheme
  (`shinsa-app://`): the page's socket, its API calls and Codex's tool server all speak HTTP to the engine already,
  and a custom scheme would have to proxy every one of them for no change you can see. The hosted dashboard is the
  same `apps/web` build, deployed there.
- **The engine is a LaunchAgent the app registers**, with `app.setLoginItemSettings({ type: 'agentService' })`
  (Electron's wrapper for `SMAppService`, macOS 13 and later), pointing at the plist inside the bundle. macOS lists
  it in System Settings → Login Items as Shinsa; moving or deleting the app takes it with it. The plist keeps
  today's behaviour (`docs/engine.md` → The background service): started at login, restarted after a crash, logs in
  the data directory.

### Who talks to the engine

- **Locally, on the loopback port** (`127.0.0.1:7446`, `port` in `config.json`), as before, behind the request
  guard (`docs/engine.md` → Who can change Shinsa: loopback Host only, same-site Origin, JSON bodies), so a website in
  your browser cannot reach it. A Unix socket (mode 600, no port at all) stays the stricter option; it is left for
  when the remote tunnel lands, since the tunnel's connector needs the same change.
- **Remotely, through the tunnel** in `docs/plans/remote-plan.md`. The connector forwards to the same socket and
  the request guard there stays as planned: only signed-in, proxied requests get through.
- **Webhooks** arrive through the tunnel too, on `/api/hooks/<id>/<token>`, so a webhook schedule needs remote
  access switched on. Until then it is offered only with that note.

### The command line

- **The app puts `shinsa` on your PATH by itself** (built): on every launch it links `~/.local/bin/shinsa` to its own
  `Resources/engine/bin/shinsa` and adds `~/.local/bin` to any shell (zsh, bash, fish) that lacks it, with no
  password; `apps/desktop/CLAUDE.md` has the rules. Agents need nothing: the engine puts its own `bin/` on their `PATH`.
- `shinsa` alone opens the app; `shinsa .` and `shinsa <folder>` open it focused on the project of the repository
  the folder is in (or say Shinsa has not worked there yet); `shinsa open <task>` opens it on a task.
- Every other command talks to the engine. If it does not answer, the command asks launchd to start it
  (`launchctl kickstart`), waits for it, then carries on; otherwise it says to open the Shinsa app.
- Removed: `serve`, `service install|uninstall|status|restart|logs`, and `open` in the browser. The engine's own
  entry is `shinsa engine`, which launchd and `bun dev` run; it is not in the help. The app keeps what `service` was
  for (the status page shows why the engine is not running and its log, and Shinsa → Restart Engine restarts it),
  and so does the command line, Tailscale's and Docker Desktop's way (`docs/cli.md` → How it is shaped): `shinsa
  status`, `start`, `stop`, `restart [--when-idle]`, `logs` and `version`, on the bundle's job.

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
- **The engine follows the app, when it is safe** (built: `ENGINE_PROTOCOL` and `resolveEngineFit` in
  `packages/core/src/protocol/engine.ts`, the engine's `EngineRestarter` in `apps/engine/src/instance/restart.ts`,
  the page's `lib/connection/engine.ts` and `components/status/engine-banner.tsx`). The app tells its page its own
  version and protocol over the bridge; the engine reports its version, `protocol`, whether an agent is mid-turn
  (`busy`) and a restart it waits for (`restart`) in `/api/health`. `protocol` goes up only when the contract
  between the interface and the engine breaks (an HTTP route, a socket message, the state's shape), so most releases
  keep it. The page compares the two and acts:
  - **An older engine, on any protocol:** it restarts the engine at once (`POST /api/engine/restart` with
    `when: now`), with no banner and nothing to click: a run it cuts off resumes on its own session. Settings →
    Updates shows "Moving to 0.5.0…" in its Engine row meanwhile. The drain for `when: idle` stays for the
    command line's `--when-idle` (`docs/engine.md` → Health).
  - **An engine on a newer protocol** (an app put back to an older version): the banner asks you to update the app,
    with **Update Shinsa**. A newer engine on the same protocol only gets the header's Update button.
  - The engine restarts itself through launchd (`launchctl kickstart -k`, as `shinsa restart`), and only
    when it runs as the background service; otherwise the banner says to stop and start it. A development build
    (version `0.0.0`) is compared by protocol only, so running from source never restarts anything.
  - The engine is restart-safe by construction (`docs/engine.md` → Recovery): the event log holds everything, and a
    run cut off by the restart resumes on its own session with a line in its chat.
  - Until phase 2 bundles the engine, the engine runs from source (`0.0.0`), so in practice only a protocol change
    acts; with the bundle, every release does.
- **The Update button.** Once an update is downloaded, a small blue **Update** button fades into the header (both
  layouts, `components/status/update-button.tsx`); its hint says the version and that agents keep working, and it
  installs and relaunches the app.
- **Why not update the engine separately:** two version numbers means a compatibility matrix to keep and to explain,
  and every bug report starts with "which engine?". With one bundle the app is the thing you install and update, and
  updating the engine is a restart.
- **Releasing** (built: `.github/workflows/release.yml`, the whole procedure in `docs/release.md`). Actions →
  Release → Run workflow, choosing the channel (stable or beta) and patch, minor or major (or
  `gh workflow run release.yml -f channel=beta -f bump=minor`). Stable raises the last stable tag; a beta is
  `<that raised version>-beta.N`, a GitHub pre-release, so it always sorts between the stable before it and the stable
  it leads to. It builds the DMG and the zip with that version in the app and the engine alike, signs and notarizes
  when the Apple secrets are set, and publishes the release with the update files of both channels (`latest-mac.yml`
  and `beta-mac.yml` for a stable release, `beta-mac.yml` for a beta) and notes from the merged pull requests.
  Nothing to bump by hand: the version lives in the tag, not in `package.json`.
- **Two update channels** (built: `apps/desktop/src/lib/update-channel.ts`). Stable follows the release marked
  latest; Beta follows the newest release, pre-releases included, so it gets every stable release once it is newer.
  Leaving Beta on a beta newer than the latest stable offers to go back to that stable (Settings → General →
  Updates, and a dialog after the switch); otherwise, and if you stay, the beta stays until a stable release passes
  it, and downgrades are off in every other case (`docs/release.md` → Channels and updates). The channel
  is the app's own setting (Settings → General → Updates), kept in its `prefs.json`, and a new install starts on the
  channel of the version it is.
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
  `shinsa.dev/download` serves the newest stable `Shinsa-mac-arm64.dmg` through the site's Worker, from a copy in
  Cloudflare R2 the release workflow makes (`docs/release.md` → Downloads), and electron-updater reads the releases.
- **Artifacts**: `Shinsa-mac-arm64.dmg` for the download, and the `zip` and `latest-mac.yml` electron-updater
  needs, on every release.

## Permissions

Running in the background needs no prompt of its own, but three things can stop the engine without a word, so
the app and setup check each and say how to fix it (built: the status page for the login item, `roots_unreadable` at
setup for a private folder; not yet: the same rows in Settings):

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
| The engine is older than the app, after an update | `version` and `protocol` in `/api/health` | Shinsa ‹version› finishes updating once the working agents hand over; **Restart now** (Versions and updates, above) |

Built as the app's status page (`apps/desktop/src/lib/engine.ts`), each state with its fix button and the engine
log's warnings and errors; the version row is the web's engine banner. Not yet: a short guide per row
(`docs/troubleshooting.md`, and the same text on shinsa.dev) with the steps by hand, for when the button is not
enough. A crash also leaves a line in the task's chat for any run it cut off ("The engine
stopped during this run; it resumed when the engine came back"), as recovery does today. While the app is closed
nothing can warn you on the Mac; the hosted dashboard shows that your Mac is offline, and the Dock badge shows a
warning sign the next time the app opens.

## What goes away

- `shinsa engine` as something you run, and the CLI's default of running it (built: `shinsa` opens the app).
- `shinsa service`, and `shinsa open` in the browser (built).
- The desktop app's "Shinsa is not running" page and its Start Shinsa dialog (built: the app starts the engine itself
  and shows the status page only when it cannot).
- Later, with the remote tunnel: the TCP port, for the Unix socket.
- The surface handshake for browser tabs (`hello { surface }`, quiet pages): with no local browser surface, the app
  is the only one that notifies. The hosted dashboard notifies only while the app is not connected.
- The README's and onboarding's "open http://localhost".

## Phases

1. **The compiled engine** (built). `apps/engine/scripts/build-engine.ts`: one executable with Eunoe inside, the
   plugin and the interface beside it, the version, commit, state version and SDK versions baked in. Checked: a
   question task ran end to end on the compiled engine (triage, a Claude run through the SDK, the hand-over tools).
2. **The bundle and the job** (built). The engine inside `Shinsa.app`, registered by the app through `SMAppService`
   with a LaunchAgent where that is refused, the status page instead of the dialog, the engine following the app
   after an update (`protocol` in `/api/health`, the restart when agents are idle, exit 75 for launchd). Checked on a
   test copy of the packaged app: it registers and starts the engine in about 4 s, quitting leaves the engine
   running, `kill -9` brings it back in a second, a restart comes back on its own, a taken port shows its page, and a
   job macOS lost is registered again. Left for a signed build: an update installed over a running engine.
3. **The command line** (built). `shinsa`, `shinsa .`, `shinsa open <task>`, waking the engine, Install the shinsa
   Command…, the removals above, and the engine's controls (`start`, `stop`, `restart`, `logs`, `version`).
4. **Signed releases.** The Developer ID certificate and notarization secrets, after which auto-update installs
   (the updater and the release workflow are already built).
5. **Remote.** `docs/plans/remote-plan.md`, with the Unix socket, and the hosted dashboard deployed from `apps/web`.

Docs change with each phase, not before it: `docs/spec.md` → Architecture, `docs/engine.md` → The engine in the
background and Configuration and data, `docs/cli.md`, the desktop and server `CLAUDE.md` files and the README.

## Open questions

- **Floaty.** It shows Shinsa as a page in its own window, which needs a local page. Either Floaty gets a way to
  show the app's window, or it uses the hosted dashboard, or it is dropped for Shinsa.
- **Other Macs and Linux.** The engine is Bun and runs anywhere; only the LaunchAgent and the app are macOS. A
  headless engine on a Linux box, reached only through the hosted dashboard, would need a supervisor of its own
  (systemd). Not planned until someone needs it.
- **Intel Macs.** Builds are Apple Silicon only, as today.
