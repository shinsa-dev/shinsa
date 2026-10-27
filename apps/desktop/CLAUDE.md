# @shinsa/desktop

Shinsa for Mac: an Electron window around the engine, never the other way round. The engine (`shinsa engine`, from the
bundle) runs on its own as a launchd job the app registers; the app finds it, loads the UI from its URL and adds only what a page cannot do:
the Dock badge, notifications that open the task, `shinsa://` links, the menu and the window. Quitting the app never
stops the server. What it looks like and how it behaves is `docs/design.md` → Where Shinsa differs, 31; the plan
behind it is `docs/plans/desktop-plan.md`.

## Layout

```
src/
├── lib/            Pure logic, Bun-tested at 100% (test/lib/): deep-link.ts (shinsa:// → a page path), badge.ts,
│                   notice.ts (checks a notification the page sends), navigation.ts (what stays in the window, what
│                   opens in the browser, the permissions the page gets, the Go menu's Back and Forward steps:
│                   resolveHistoryStep), server-url.ts (which server to load),
│                   health.ts (GET /api/health, with or without `version`), bounds.ts (window place on connected
│                   displays), service.ts (starting the service), bridge.ts (the bridge's types and IPC channels),
│                   dev-bundle.ts (the app's name, and the renamed Electron.app `bun run dev` runs), update.ts
│                   (the updater's states, its menu item, notice and answers, the go-back dialog, which download
│                   a switch to Stable discards, where macOS stages one), update-channel.ts (Stable or Beta, the
│                   updater options each sets, when a beta on Stable is offered the latest stable)
├── main/           The Electron glue, kept thin and outside coverage: index.ts (single instance, deep links,
│                   connecting to the server, its first health check sent before the app is ready, IPC, the
│                   session's permissions), window.ts (MainWindow: hide on close, navigation, Back and Forward,
│                   the waiting page; V8's code cache without the heat check), menu.ts (the app menu, with Go:
│                   Back ⌘[, Forward ⌘], Home ⇧⌘H), notifications.ts, server.ts (health, starting
│                   the service in the login shell), prefs.ts (window bounds, the update channel and the beta you
│                   chose to stay on in userData/prefs.json),
│                   updater.ts (Updater: electron-updater, checked at start and every four hours)
└── preload/        index.ts: exposes `window.shinsaDesktop` (version, protocol, update, channel, windowState,
                    updateBadge, notify, installUpdate, checkForUpdates, applyUpdateChannel, answerDowngrade, onNavigate,
                    onWindowState, onUpdate) to the server's page
                    only; `protocol` is core's ENGINE_PROTOCOL, and the page compares both with the engine's
static/waiting.html The "Shinsa is not running" page
resources/          The app icon: icon.svg (the source), icon.png (1024px), icon.icns (electron-builder's `mac.icon`),
                    all three written by scripts/icon.ts
```

## Rules

- **The page owns what it shows.** The web decides what is new, what the badge says and where a notification goes
  (`apps/web/src/lib/desktop.ts`); the app only carries it out. The bridge's shape is mirrored in `src/lib/bridge.ts`
  and `apps/web/src/lib/desktop.ts`: change both together.
- **Trust nothing from the page.** Every IPC message is checked against the window's own top frame on the server's
  origin (`MainWindow.isAppSender`) and parsed in `lib/` (`parseNotice`, `resolveBadgeText`); a `shinsa://` link is
  parsed into a known page path, never loaded or passed to a shell. The page gets only the clipboard and full screen;
  notifications are denied to it, so the page in the app notifies only through the bridge.
- **Only the app notifies.** Its page says `hello` with surface `desktop` on every socket (`resolveSurface` in
  `apps/web/src/lib/desktop.ts`, from `window.shinsaDesktop`), and while it is connected the server tells every other
  page, browser tabs and Floaty, to stay quiet: no sound and no notification, while the count in the title and
  Floaty's tags stay (`docs/engine.md` → The socket). Nothing in `main/` decides this; it follows from the preload bridge being there.
- **The icon** follows macOS's 1024px grid: a light 824px squircle (continuous corners of about 185px) inset 100px,
  with room for its shadow, and the Shinsa mark from `packages/ui/src/components/logo.tsx` in near-black at 488px,
  centred. Change `scripts/icon.ts`, never the outputs, and run `bun run icon` (needs `rsvg-convert` from Homebrew's
  librsvg, and `iconutil`). The unpackaged app sets `resources/icon.png` as its Dock icon.
- **Logic in `lib/`, Electron in `main/`.** Anything that decides goes in `lib/` with a test; `main/` wires it.
- **The engine is the app's to run.** Packaged, the app removes the old `shinsa service` LaunchAgent once
  (`studio.overclock.shinsa`, so two engines never share a data folder), then registers the bundle's job with
  `app.setLoginItemSettings({ type: 'agentService' })` (`SMAppService`). macOS's records can say enabled while launchd
  has no job, so the app checks `launchctl print`, registers again when it is missing, and where registration is
  refused writes the same job to `~/Library/LaunchAgents` with the program's full path (carrying `SHINSA_HOME` and
  `SHINSA_DATA_DIR`) and bootstraps it. It waits up to 25 s for the engine, kicking it after 3 s, and otherwise shows
  why on the status page. While the window shows Shinsa it checks the engine every 5 s; three misses in a row bring
  the status page back, and the page opens Shinsa again by itself once the engine answers. There is no dialog.
- **Restarting** the engine is `launchctl kickstart -k` (the status page's Start engine, Shinsa → Restart Engine); the
  engine restarts itself for an update (`POST /api/engine/restart`). `shinsa start`, `stop` and `restart` do the same
  from a terminal, on the same job (`docs/cli.md` → The engine).
- **The `shinsa` command** is on your PATH without asking (`main/command-line.ts`, the decisions in
  `lib/command-line.ts`). On every launch the packaged app links `~/.local/bin/shinsa` to its own
  `Contents/Resources/engine/bin/shinsa`, the folder Claude Code, pipx and uv use, with no password: it makes the link
  when there is none, moves it when it points into another `Shinsa.app` (the app moved or a copy made it), and never
  touches a `shinsa` it did not make (a file, or a link to your checkout). Then it asks each shell you use (zsh, bash
  when you have a `.bash_profile` or it is your shell, and fish when installed) for the PATH an interactive login sees,
  and where `~/.local/bin` is missing it adds it once: `conf.d/shinsa.fish` for fish, a marked block at the end of
  `.zprofile` or `.bash_profile`. A failure leaves things as they were and is tried again at the next launch. The
  job runs that executable as `shinsa engine`
  (`serializeEngineAgent`, and the checked-in `resources/LaunchAgents` plist a test compares with it).
- Which server: `SHINSA_URL` (an origin) wins; unpackaged, the Vite dev server on 5181; packaged, `SHINSA_PORT`, then
  `port` in Shinsa's `config.json`, then 5180, always on 127.0.0.1.
- The app is "Shinsa" everywhere, packaged or not (`app.setName`, the first menu, the About panel). The menu bar and
  the Dock read the bundle's `CFBundleName`, so `bun run dev` (`scripts/dev.ts`) runs a copy of Electron.app at
  `.electron/Shinsa.app` (git-ignored) with `CFBundleName`/`CFBundleDisplayName` Shinsa, bundle id
  `studio.overclock.shinsa.dev` and Shinsa's icon, signed ad hoc; it is rebuilt only when Electron's version or the
  icon changes (`.electron/Shinsa.json`).
- Unpackaged keeps its own userData (`~/Library/Application Support/Shinsa Dev`) and registers no URL scheme; pass a
  link as an argument to try one (`bun run dev shinsa://task/LOC-4` while it runs).
- Bundle id `studio.overclock.shinsa`, scheme `shinsa`, Apple Silicon only, unsigned (ad hoc) until the Developer
  ID secrets are set. `SHINSA_APP_ID` changes the id the app uses for its job, its old service and its userData, for a
  test copy beside the real app (below).

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Bundles `src/main` and `src/preload` to `dist/` and opens the app, as `.electron/Shinsa.app`, on the Vite dev server (start `bun dev` first); `SHINSA_URL=http://127.0.0.1:5180 bun run dev` for the built server |
| `bun run package` | Builds the web app and the engine (`SHINSA_VERSION` sets its version), then `release/mac-arm64/Shinsa.app` with the engine and its job inside, signed ad hoc so it runs on this Mac (electron-builder, `electron-builder.yml`) |
| `bun run icon` | Writes `resources/icon.svg`, `icon.png` and `icon.icns` from the logo (`scripts/icon.ts`) |
| `bun test` | The `lib/` tests, 100% line and function coverage |
| `bun run check-types` | `tsc` over `src`, `test` and `scripts` |

**Updates.** The packaged app updates itself (`main/updater.ts`): electron-updater reads the GitHub releases of
`shinsa-dev/shinsa` (`publish` in `electron-builder.yml`), downloads a new version in the background and installs it
when you quit, or at once from Shinsa → Restart to Update. Quitting never stops the server, so an update never
interrupts an agent. Squirrel.Mac installs only an update signed by the same Developer ID, so ad hoc builds download
but do not install. There are two channels (`lib/update-channel.ts`): Stable reads `latest-mac.yml` from the release
marked latest, Beta reads `beta-mac.yml` from the newest release, pre-releases included (`allowPrerelease`), and
`allowDowngrade` stays false (electron-updater turns it on when `channel` is set) except for one accepted go-back: on
Stable, a beta newer than the latest stable is offered that stable ("Go back to 1.2.0 (stable)?", update status
`downgrade`, `answerDowngrade` over the bridge, a dialog once after the switch), and accepting downloads it with
`allowDowngrade` on for that check only. Switching to Stable discards a beta that is downloading or staged (the
download is cancelled; Squirrel.Mac's ShipIt job and folder are removed). `test/lib/update-feed.test.ts` runs
electron-updater's GitHub provider over fake feeds to pin what each channel offers. The channel is the app's, not the
engine's: it lives in `userData/prefs.json` (`updateChannel`), since the updater runs before any page loads and while
the engine is down, and a browser tab has no updater; a new install starts on Beta when its own version is a beta.
The page shows and switches it through the bridge (`channel`, `applyUpdateChannel`; Settings → General → Updates),
and switching checks again at once. The About panel and the manual check's answer name the channel. Releasing is
Actions → Release (`.github/workflows/release.yml`, `docs/release.md`): channel stable or beta, bump patch, minor or
major; it builds `Shinsa-mac-arm64.dmg` and `.zip` with that version in the app and its engine, signs and notarizes
when the `CSC_LINK` and Apple secrets are set, publishes the release, and copies the DMG to the site's R2 bucket,
from which `shinsa.dev/download` (stable) and `shinsa.dev/download/beta` serve it. The version lives in the tag, never in `package.json`. The plan for the engine
following the app is `docs/plans/app-plan.md` → Versions and updates.

The root `bun dev` skips this package (`--filter=!@shinsa/desktop`), so it never opens a window by itself.

## Testing the packaged app

Never on the real app's identity: its first launch takes over the engine you use. Make a copy with its own bundle id
and job, pointed at a scratch folder, and run it with the same id:

```sh
T="/tmp/ShinsaTest/Shinsa Test.app"; mkdir -p /tmp/ShinsaTest /tmp/shinsa-e2e
cp -R release/mac-arm64/Shinsa.app "$T"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier studio.overclock.shinsa.test" "$T/Contents/Info.plist"
A="$T/Contents/Library/LaunchAgents"; P="$A/studio.overclock.shinsa.test.engine.plist"
mv "$A/studio.overclock.shinsa.engine.plist" "$P"
/usr/libexec/PlistBuddy -c "Set :Label studio.overclock.shinsa.test.engine" \
  -c "Set :AssociatedBundleIdentifiers:0 studio.overclock.shinsa.test" \
  -c "Add :EnvironmentVariables:SHINSA_HOME string /tmp/shinsa-e2e" "$P"
codesign --force --deep --sign - "$T"
echo '{"port":5199}' > /tmp/shinsa-e2e/config.json
SHINSA_APP_ID=studio.overclock.shinsa.test SHINSA_HOME=/tmp/shinsa-e2e "$T/Contents/MacOS/Shinsa"
```

Then quit it and see the engine still answer on 5199, `kill -9` the engine and see it back, take the port and see the
status page, and `launchctl bootout gui/$(id -u)/studio.overclock.shinsa.test.engine` when done.

