# Shinsa desktop app

Research only, nothing edited in the repo. Paths are relative to `/Users/christo/Developer/Projects/shinsa` unless
absolute. References: T3 Code `/tmp/refs/t3code/apps/desktop` (commit a12d6ed9), Kanna's mac app
`/Users/christo/Developer/Projects/kanna/macos`, Floaty `/Users/christo/Developer/Projects/Floaty`.

## Decision in one paragraph

**Electron**, as a thin shell around the daemon, never the other way round. The daemon (`shinsa serve`) runs as a
**launchd user agent** so it lives through the window closing, the app quitting, a crash and a reboot; the app
finds it, starts it if needed, and loads the UI **from the daemon's own URL** (`http://127.0.0.1:5180`), so the
app, a browser tab and Floaty always show the same version. The app adds only what a page cannot do: dock badge,
notifications that focus the task, `shinsa://` links, a summon shortcut, a menu, window state and updates. Start from
Kanna's `macos/` (same shape: an Electron window around a local server, bundled with `bun build`, koffi for the
AppKit bits), not from T3's 4,000-line build script.

## Why Electron, not Tauri or Electrobun

| Need | Electron | Tauri 2 | Electrobun 2.0.4 |
|---|---|---|---|
| Renders Shinsa as designed | Chromium: `corner-shape` (41 uses of `corner-superellipse`, `packages/ui/src/styles/globals.css`) and `field-sizing` work | WKWebView: both missing, corners fall back to round | system WebKit, or CEF if bundled (then no size win) |
| Bun daemon | separate process either way | sidecar; Bun's JIT needs entitlements that clash with deep-link entitlements (tauri #16211, Killed: 9) | Bun is the main process, but the daemon must outlive the window anyway, so that buys nothing |
| Auto-update | electron-updater, proven (T3, Kanna) | updater plugin, fine | bsdiff updater, young |
| Single instance, deep links | `requestSingleInstanceLock`, `open-url` | plugins | no single-instance lock; URL schemes only from /Applications |
| Notifications that focus on click | yes | plugin | click does not focus the window (channels #757) |
| Signing and notarizing | electron-builder + notarytool, done twice already (Kanna, T3) | doable, sidecar pitfalls | 2.x signing reported untested (channels #784) |
| Maturity | the default | solid | one maintainer; 2.0.4 stable is arm64 only |
| Cost | ~200 MB on disk, ~150 MB RAM per window | ~15 MB | small with system WebKit |

Size is Electron's only loss and it does not matter for a personal tool. The deciding facts: Shinsa's look depends on
Chromium-only CSS, the daemon has to be its own process regardless of shell, and the user already ships an Electron
wrapper of exactly this shape (Kanna).

## Floaty

Floaty (`/Users/christo/Developer/Projects/Floaty`) is the user's own menubar app: one WKWebView page floating above
everything, ⌃Space to summon, Dock to window (`WindowDock.swift`, Accessibility API), and tab states read from
`<meta name="floaty:status">` / `floaty:badge` (`Sources/Floaty/Tab.swift`). Shinsa already publishes those tags
(`apps/web/src/lib/notifications/page.ts`, `docs/design.md` → The tab), same values as Kanna's
`getBrowserPageStatus` (`kanna/src/client/app/chatNotifications.ts:97`, written in `App.tsx:457`).

So the floating, docked, tablet-sized window **already works** with Shinsa in Floaty, as long as the daemon is up.
The plan keeps that path first-class and does not re-implement docking in Electron:

- The daemon runs without the app, so Floaty keeps working when the Shinsa app is closed.
- Notifications and sound are owned by one surface: when the desktop app is connected, browser and Floaty pages stay
  quiet: no OS notification and no sound, while the title's count and Floaty's `floaty:badge` and `floaty:status`
  stay, since Floaty reads them (the web sends `hello { surface: 'desktop' | 'browser' }` on connect; the server tells every socket whether a desktop
  surface is connected). Otherwise a decision rings twice. Built in phase 2 (`docs/engine.md` → The socket).
- Phase 4 offers an optional Float mode in the app (always on top, all Spaces, a tablet-sized frame), for the day
  the user wants one app instead of two. Docking to the focused window stays Floaty's (question 1).
- Floaty is WebKit, so corners there are round, not superellipse; nothing to fix, worth knowing.

## How the app finds and runs the daemon

Today: `apps/server/package.json` `bin: { shinsa: 'src/main.ts' }` (bun-linked from the checkout); port
`SHINSA_PORT` → `config.json` `port` → 5180, host 127.0.0.1 (`apps/server/src/config/index.ts:37,69`); data
`~/.config/shinsa` (`config/paths.ts`); `webDir` and `pluginDir` resolve from `import.meta.dirname`
(`config/index.ts:107-108`); no auth beyond the loopback Host and same-site Origin guard (`http/guard.ts`); and
**no lock on the data directory**, so two daemons on one data dir would both run effects (two agents per run).

**The daemon becomes a service.** New CLI group `shinsa service install|uninstall|status|restart|logs` writes
`~/Library/LaunchAgents/studio.overclock.shinsa.plist` (`RunAtLoad`, `KeepAlive` on crash, `ThrottleInterval 5`,
stdout/stderr to `~/.config/shinsa/data/serve.log`) and runs `launchctl bootstrap gui/<uid>` / `kickstart -k`.
It is the CLI's, not the app's, so a CLI-only user gets the same thing; the app just calls it.

Server changes that come with it:

- **Data-dir lock**: `serve` takes an exclusive lock on `data/serve.lock` (pid, port, version, executable path) and
  refuses to start if another live daemon holds it, printing where that one runs.
- **Login environment**: launchd starts with a bare `PATH`; agents need git, gh, bun, claude, codex. `serve` reads
  the login shell's environment once at start (`$SHELL -lic`, as Kanna's `server-agent.ts` does, then `-lc` when an
  interactive shell prints nothing, as a `.zshrc` that execs fish does, plus `fish -lc` when the shell handed off to
  fish) when it was not started from a terminal.
- **`GET /api/health`** gains `version`, `pid`, `executable` and `startedAt`, so the app can tell which daemon it
  found.
- `SHINSA_WEB_DIR` and `SHINSA_PLUGIN_DIR` overrides beside the `import.meta.dirname` defaults.

**Which `shinsa` runs.** Two installs exist on this machine: the checkout (bun-linked, what the user develops) and,
later, the app's bundled copy. Rule: the service runs whichever `shinsa` installed it; the app never fights it.

App start-up, in order:
1. Read the port like the CLI does; `GET /api/health` (1 s timeout). Healthy → load it. If its `executable` is not
   the bundled one, the app says so once in Settings → Desktop ("Running the Shinsa from ~/Developer/…") and does
   nothing else.
2. No answer, service installed → `launchctl kickstart`, poll health every 200 ms for 15 s (T3 polls at 100 ms with
   a 1 s request timeout and treats a slow cold boot as alive).
3. No service → first run: a one-screen "Keep Shinsa running in the background" with Install (runs `service install`
   with the bundled binary) and Not now (spawn `serve` detached, as Kanna does, and ask again next launch).
4. While the window is open: health every 5 s; two misses show "Reconnecting" (the web's own socket banner does most
   of this already) and kick the service.

Quitting the app (⌘Q) never stops the daemon; Settings → Desktop has Stop Shinsa, which says how many agents are
running. Closing the window hides it (macOS convention, and the renderer keeps the socket, so badge and
notifications keep working); clicking the Dock icon brings it back.

## What ships in the .app

`Contents/Resources/shinsa/`: a pinned `bun` binary (arm64 and x64, or a universal app), `apps/server` (TypeScript
sources; Bun runs them directly), `packages/core`, production `node_modules` (the Claude Agent SDK with its bundled
CLI and ripgrep, eunoe, Codex), `apps/server/plugin`, `apps/web/dist`. Not `bun build --compile`: the server
resolves files and packages through `import.meta.dirname` and `import.meta.resolve` (config, `claude/executable.ts:39`,
`eunoe/proxy.ts:57`), which a compiled single file breaks; revisit once those go through explicit paths.

A `shinsa` shim (`#!/bin/sh` → bundled bun + `main.ts`) is offered for `~/.local/bin` (T3 does the same with its
`cliCommand.install`), so `shinsa do` from any terminal and the agents' own `shinsa` calls hit the same version.

## Native features

| Feature | How |
|---|---|
| Dock badge "N need you" | the web already computes n (`lib/notifications/attention.ts`, the `[n] Shinsa` title); `hooks/use-attention` also calls `desktop.setBadge(n)` → `app.setBadgeCount`. While no renderer exists (after a crash), main polls `GET /api/queue` (`resolveQueueSummary`, exists) every 10 s. |
| Notifications | the web's (`lib/notifications/browser.ts`, sounds, settings) stay; in the app the bridge's `notify` makes a main-process `Notification` whose click shows the window and navigates to the task. |
| Deep links `shinsa://task/LOC-4` | register `shinsa` (dev build: `shinsa-dev`). `open-url` and `second-instance` map `task/<handle>` through the web's `resolveTaskPath` (`apps/web/src/router.ts`); Shinsa already writes `shinsa://task/...` in chat references, so those links work from any app too. Unknown targets open Home with a toast. |
| Summon shortcut | `globalShortcut`, default ⌃⌥Space (⌃Space is Floaty's), rebindable in Settings → Desktop; shows and focuses, or hides when already front. |
| Menu | standard app menu: New task (opens ⌘K's compose frame), Command menu ⌘K, Settings ⌘, , Reload, Toggle full screen. Menu items send the web a command through the bridge; no new in-app shortcuts. |
| Menu bar (phase 4) | a tray icon with the count as its title and the Needs you items from `/api/queue`; click opens the task. T3 has none; useful when the window is hidden. |
| Window | `titleBarStyle: 'hiddenInset'`, traffic lights inset to the top bar's centre, bounds and display saved and restored only onto a connected display (T3 `DesktopWindow.ts:366`), default 900×1100 (the ~900px layout Shinsa already supports). Kanna's `native-window.ts` (koffi NSToolbar for macOS 26 corners) can come along. |
| Updates | electron-updater, `generic` provider on a static bucket (Kanna: `kanna.sh/downloads/mac`; a private GitHub repo needs a token, so prefer the bucket). After an update installs, the app restarts the service (`kickstart -k`): the daemon's files were replaced under it. Shinsa's restart recovery resumes running agents (`docs/engine.md` → recovery). |
| Signing | Developer ID Application, hardened runtime, notarytool with an App Store Connect API key (T3's CI env names). Entitlements: `cs.allow-jit`, `cs.allow-unsigned-executable-memory` (Bun's JavaScriptCore), `cs.disable-library-validation` if a bundled native module needs it. Every Mach-O in Resources is signed: bun, the SDK's claude and ripgrep, codex. Check with `codesign --verify --deep --strict`, `spctl -a -vv`, and a launch from a fresh user account. |

## Web changes

- `apps/web/src/lib/desktop.ts`: reads `window.shinsaDesktop` (the preload bridge; absent in a browser and in
  Floaty) and wraps it: `setBadge`, `notify`, `onNavigate`, `onMenuCommand`, `version`. Unit-tested with a fake bridge.
- `main.tsx` sets `data-desktop` on `<html>`; the Cards top bar and the Sidebar rail top get
  `-webkit-app-region: drag` with no-drag on controls, and room for the traffic lights.
- Settings → Desktop (only in the app): summon shortcut, open at login, the daemon (where it runs, version,
  Restart, Stop), updates (channel, Check now), install the `shinsa` command.
- The surface handshake for notifications (above); core: the socket hello carries `surface`.
- Docs in the same change: `docs/spec.md` (desktop leaves "planned"), `docs/engine.md` (service, lock, health),
  `docs/design.md` (the drag region, Settings → Desktop), `docs/cli.md` (`shinsa service`).

## Layout and dev workflow

```
apps/desktop/                 @shinsa/desktop
  src/main/                   index.ts (lifecycle, single instance), daemon.ts (find/start/health),
                              window.ts (bounds, hide on close), deep-links.ts, badge.ts, menu.ts,
                              shortcut.ts, updates.ts, notifications.ts
  src/preload/index.ts        contextBridge.exposeInMainWorld('shinsaDesktop', …), ~8 methods
  src/lib/                    pure logic (link parsing, start-up state machine, bounds on displays), Bun-tested
  scripts/stage.ts            assembles Resources/shinsa (bun, sources, prod node_modules, web dist, plugin)
  electron-builder.yml        dmg + zip, mac only, entitlements.plist, publish generic
```

- `bun dev:desktop`: assumes `bun dev` is running; `bun build` main and preload to CJS on watch (Kanna's approach),
  launches Electron as "Shinsa Dev" (`studio.overclock.shinsa.dev`, scheme `shinsa-dev`, its own userData) pointed
  at Vite on :5181. It never installs or kicks the service.
- `bun run --cwd apps/desktop dist`: stage, `electron-builder --mac`, sign, notarize, DMG and zip.
- The coverage floor applies to `src/lib/` (pure); the Electron glue is covered by a smoke test that launches the
  packaged app against a scratch `SHINSA_HOME` and checks the window reaches Home (T3 has `test:desktop-smoke`).

## Phases and acceptance checks

0. **Server prerequisites (1 day). Done.** Data-dir lock, health fields, login environment, `SHINSA_WEB_DIR` /
   `SHINSA_PLUGIN_DIR`, `shinsa service`. Pass: a second `serve` on the same data dir refuses with the first one's
   port; `shinsa service install` survives `kill -9` (back within 5 s) and a reboot; agents started by the service
   find `gh` and `claude`.
   - Built: `apps/server/src/instance/lock.ts` (`serve.lock`; the refusal names the holder's address; a server the
     service started that finds the lock held logs the holder and exits 0, so launchd does not restart it every 5 s;
     inspect mode takes no lock and is read-only, so it can serve a running server's data beside it), health with
     `version`, `pid`, `startedAt` and `installPath` (in place of `executable`; `docs/engine.md` → Health),
     `shell/login.ts`, both directory overrides (`config/index.ts`), `service/launchd.ts` (`RunAtLoad`, `KeepAlive`
     on an unsuccessful exit, `ThrottleInterval` 5).
   - Checked: the refusal, by `test/instance/lock.test.ts`. Not checked on a machine: back within 5 s after
     `kill -9` and after a reboot (the plist asks launchd for both), and agents finding `gh` and `claude` under
     launchd. The login environment is unit-tested and was read once with the real zsh under a bare, TTY-less
     environment (`-lic` printed nothing, `-lc` returned `PATH` with Homebrew, nvm and `~/.bun/bin`); it has not run
     under a real service.
1. **Shell (1-2 days). Done, with a smaller start-up.** `apps/desktop` (written fresh, Kanna's `bun build` to CJS):
   window on the daemon's URL, hidden-inset title bar, drag region (`data-window-drag`), single instance, window
   state, hide on close. Pass: with `bun dev` running, the app opens on it; ⌘Q leaves agents running; reopening
   restores size and position; a second launch focuses the first.
   - All four hold in code (`main/index.ts`, `main/window.ts`, `lib/bounds.ts`); quitting never touches the server.
   - Start-up differs from the order above: health, then the "Shinsa is not running" page, which polls every 2 s;
     the packaged app offers Start Shinsa once a launch (`shinsa service restart`, then `install`). Not built: the
     first-run Install / Not now screen, the detached `serve` for Not now, and the 5 s health watch that kicks the
     service while the window is open (the page's own reconnecting socket covers a server restart).
2. **Native integration (2 days). Done, without the summon shortcut.** Badge, notifications with click-through,
   `shinsa://` links (cold and warm start), menu, the notification handshake. Pass: 3 decisions → Dock shows 3,
   only the app notifies, and Floaty's tab stays quiet (no sound, no notification, its badge kept) while the app is
   connected;
   `open shinsa://task/LOC-4` opens that task from a closed app and from a hidden window.
   - Built: `lib/badge.ts`, `lib/notice.ts` with `main/notifications.ts`, `lib/deep-link.ts` (`open-url`,
     `second-instance`, and a link held until the window exists), `main/menu.ts` (macOS's menu with Settings… ⌘,
     and Reload ⌘R), and the handshake (`hello` and `surfaces` on the socket, `isPageQuiet` in the web).
   - Changed by decision: no summon shortcut and no other key (`docs/design.md`, 31; Floaty's ⌃Space summons
     Shinsa), so its check is dropped; the menu has no New task or Command menu items. Floaty's badge shows 3 as
     well: only sound and notifications are the app's alone.
   - Not built: main polling `/api/queue` for the badge while no page is loaded; the badge clears instead while the
     server is unreachable.
3. **Ship (2 days).** Staging, signing, notarizing, DMG, updates, the `shinsa` shim, Settings → Desktop. Pass: DMG
   installs on a fresh macOS user with no Gatekeeper prompt; version N updates to N+1 in place and the running
   agent resumes; `shinsa status` from a terminal answers from the same daemon.
4. **Optional (1-2 days).** Menu bar item; Float mode (always on top, all Spaces, compact frame). Pass: with the
   window hidden the menu bar lists what needs you and opens it.

## Risks

- **Two installs, one data dir.** The checkout's `shinsa` and the app's could both try to own `~/.config/shinsa`;
  the lock makes that a clear refusal instead of duplicate agents. The user decides which one is the service.
- **Updates under a running daemon.** Squirrel replaces the bundle on quit; Bun may load a file lazily from the new
  bundle into the old process. Restart the service right after install, and keep the shell/daemon bridge tiny.
- **launchd environment** (PATH, SSH agent, keychain access for `gh`): read the login shell, test on a fresh login.
- **Notarizing nested binaries** (bun, claude, ripgrep, codex) is where first notarizations fail; script the
  `codesign` pass over every Mach-O before electron-builder's.
- **Security**: the app adds no new port. The window loads loopback, so the existing Host and Origin guard holds;
  `shinsa://` input is parsed into a known route, never passed to the shell or loaded as a URL.

## Questions only you can answer

1. Should the Shinsa app also float and dock to the focused window (replacing Floaty for Shinsa), or stay the full
   window while Floaty remains the floating surface? The plan assumes the second, with Float mode as an option.
2. Which `shinsa` should run as the background service on your machine: the checkout you develop in, or the app's
   bundled copy (and the checkout only under `bun dev` with a scratch `SHINSA_HOME`)?
3. When the app is open and you also have Shinsa in Floaty, should only the app notify (the plan), or both?
4. Is ⌃⌥Space fine for the summon shortcut, or none at all since Floaty's ⌃Space already summons Shinsa?
5. Distribution: a Developer ID you already have (team id?) and where updates live (a bucket like Kanna's
   `kanna.sh/downloads/mac`, or GitHub releases)? Apple Silicon only, or universal?
6. Bundle id and scheme: `studio.overclock.shinsa` and `shinsa://` (matching the in-chat `shinsa://` references)?
