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
│                   dev-bundle.ts (the app's name, its userData folder, and the renamed Electron.app `bun run dev`
│                   runs), flavor.ts (which app this build is, Shinsa or Shinsa Canary: core's APP_FLAVORS, picked by
│                   the build), update.ts (the updater's states, its menu item, notice and answers, the go-back
│                   dialog, which download a channel switch discards, where macOS stages one), update-channel.ts
│                   (the channels each app offers, the updater options each sets, when a version ahead of its
│                   channel is offered the latest there)
├── main/           The Electron glue, kept thin and outside coverage: index.ts (single instance, deep links,
│                   connecting to the server, its first health check sent before the app is ready, IPC, the
│                   session's permissions), window.ts (MainWindow: hide on close, navigation, Back and Forward,
│                   the waiting page; V8's code cache without the heat check), menu.ts (the app menu, with Go:
│                   Back ⌘[, Forward ⌘], Home ⇧⌘H), notifications.ts, server.ts (health, starting
│                   the service in the login shell), prefs.ts (window bounds, the update channel and the version you
│                   chose to stay on in userData/prefs.json),
│                   updater.ts (Updater: electron-updater, checked at start and every four hours)
└── preload/        index.ts: exposes `window.shinsaDesktop` (version, protocol, update, channel, windowState,
                    updateBadge, notify, installUpdate, checkForUpdates, applyUpdateChannel, answerDowngrade, onNavigate,
                    onWindowState, onUpdate) to the server's page
                    only; `protocol` is core's ENGINE_PROTOCOL, and the page compares both with the engine's
static/waiting.html The "Shinsa is not running" page
resources/          The app icons: icon.svg (the source), icon.png (1024px), icon.icns (electron-builder's `mac.icon`),
                    and the same three as icon-canary.* for Shinsa Canary, all written by scripts/icon.ts; the
                    engine's job, LaunchAgents/ for Shinsa and LaunchAgents-canary/ for Shinsa Canary
scripts/            build.ts (bundles main and preload with the flavor baked in), dev.ts, icon.ts, dmg-background.ts
electron-builder.shared.yml    What both builds share; electron-builder.yml (Shinsa) and electron-builder.canary.yml
                               (Shinsa Canary) extend it with what names each app (electron-builder joins the lists an
                               extended file holds, so the names, schemes and engine jobs stay out of the shared one)
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
  centred. Shinsa Canary's (`icon-canary.*`) is the same on a canary-yellow squircle, so the two never look alike in
  the Dock or Finder. Change `scripts/icon.ts`, never the outputs, and run `bun run icon` (needs `rsvg-convert` from
  Homebrew's librsvg, and `iconutil`). The unpackaged app sets `resources/icon.png` as its Dock icon.
- **The disk image** opens on a 660×400 window (`dmg` in `electron-builder.shared.yml`): Shinsa.app on the left, the
  Applications link on the right, 112pt icons, on a light background in the site's look (the dot grid, circuit traces
  with the blue signal running from the app to Applications, the mark and "Shinsa" in Areal, and a "Drag Shinsa into
  Applications to install" line). Finder never themes a disk image's background and draws the labels dark in light and
  dark mode alike, so it stays light. The backgrounds are `resources/dmg/background-stable.png`,
  `background-beta.png` and `background-canary.png`, each with an `@2x` (electron-builder joins the pair into a Retina
  TIFF); the beta one adds a blue Beta pill, and the canary one an amber Canary pill and "Drag Shinsa Canary into
  Applications". `electron-builder.yml` names the stable one, a beta release swaps in its own with
  `-c.dmg.background=dmg/background-beta.png` (`release.yml`), and `electron-builder.canary.yml` names the canary one. They are 660×432: Finder's window is the image's size,
  title bar included, so its bottom 32px never show. Change `scripts/dmg-background.ts`,
  never the outputs, and run `bun run dmg-background` (needs `rsvg-convert` from Homebrew's librsvg; the text is set in
  Areal from `apps/marketing/src/assets/fonts`, and the script holds the words' measured widths, so remeasure if you
  change them). The icon positions in the script and in `electron-builder.shared.yml` must agree. The volume is named
  `Shinsa <version>`: Finder caches a disk image's background and layout by volume name, so a new name per version
  keeps an old one from showing. To try a change, build a disk image from the packaged app with a version you have not
  opened yet: `bunx electron-builder --mac dmg --arm64 --publish never --prepackaged release/mac-arm64/Shinsa.app
  -c.mac.identity=null -c.extraMetadata.version=0.0.1-test.1 -c.directories.output=/tmp/shinsa-dmg`.
- **Logic in `lib/`, Electron in `main/`.** Anything that decides goes in `lib/` with a test; `main/` wires it.
- **The engine is the app's to run.** Packaged, the app removes the old `shinsa service` LaunchAgent once
  (`studio.overclock.shinsa`, so two engines never share a data folder), then registers the bundle's job with
  `app.setLoginItemSettings({ type: 'agentService' })` (`SMAppService`). macOS's records can say enabled while launchd
  has no job, so the app checks `launchctl print`, registers again when it is missing, and where registration is
  refused writes the same job to `~/Library/LaunchAgents` with the program's full path (carrying `SHINSA_HOME` and
  `SHINSA_DATA_DIR`) and bootstraps it. When its own job's engine holds the data folder's `serve.lock` on another
  port (the port a version before an update used), it restarts the job first (`isOnOtherPort`), so the app and its
  engine move to a new default port together. It waits up to 25 s for the engine, kicking it after 3 s, and otherwise
  shows why on the status page. While the window shows Shinsa it checks the engine every 5 s; three misses in a row bring
  the status page back, and the page opens Shinsa again by itself once the engine answers. There is no dialog.
- **Restarting** the engine is `launchctl kickstart -k` (the status page's Start engine, Shinsa → Restart Engine); the
  engine restarts itself for an update (`POST /api/engine/restart`). `shinsa start`, `stop` and `restart` do the same
  from a terminal, on the same job (`docs/cli.md` → The engine).
- **The `shinsa` command** is on your PATH without asking (`main/command-line.ts`, the decisions in
  `lib/command-line.ts`); Shinsa Canary's is `shinsa-canary`, linked the same way, and it never touches `shinsa`. On
  every launch the packaged app links `~/.local/bin/shinsa` to its own
  `Contents/Resources/engine/bin/shinsa`, the folder Claude Code, pipx and uv use, with no password: it makes the link
  when there is none, moves it when it points into another `Shinsa.app` (the app moved or a copy made it), and never
  touches a `shinsa` it did not make (a file, or a link to your checkout). Then it asks each shell you use (zsh, bash
  when you have a `.bash_profile` or it is your shell, and fish when installed) for the PATH an interactive login sees,
  and where `~/.local/bin` is missing it adds it once: `conf.d/shinsa.fish` for fish, a marked block at the end of
  `.zprofile` or `.bash_profile`. A failure leaves things as they were and is tried again at the next launch. The
  job runs that executable as `shinsa engine`
  (`serializeEngineAgent`, and the checked-in `resources/LaunchAgents` plist a test compares with it).
- Which server: `SHINSA_URL` (an origin) wins; unpackaged, the Vite dev server on 5181; packaged, `SHINSA_PORT`, then
  `port` in the app's `config.json`, then `FlavorIdentity.port`, 7446 (7447 for Shinsa Canary), always on 127.0.0.1. The app takes an
  engine only of its own flavor (`/api/health`'s `flavor`, `parseHealth`), so neither app ever shows the other's.
- The app is "Shinsa" everywhere, packaged or not (`app.setName`, the first menu, the About panel, the window, the
  status page and the updater's messages), and "Shinsa Canary" in a canary build. The menu bar and
  the Dock read the bundle's `CFBundleName`, so `bun run dev` (`scripts/dev.ts`) runs a copy of Electron.app at
  `.electron/Shinsa.app` (git-ignored) with `CFBundleName`/`CFBundleDisplayName` Shinsa, bundle id
  `studio.overclock.shinsa.dev` and Shinsa's icon, signed ad hoc; it is rebuilt only when Electron's version or the
  icon changes (`.electron/Shinsa.json`).
- Unpackaged keeps its own userData (`~/Library/Application Support/Shinsa Dev`) and registers no URL scheme; pass a
  link as an argument to try one (`bun run dev shinsa://task/LOC-4` while it runs).
- Bundle id `studio.overclock.shinsa`, scheme `shinsa`, Apple Silicon only, unsigned (ad hoc) until the Developer
  ID secrets are set. `SHINSA_APP_ID` changes the id the app uses for its job, its old service and its userData, for a
  test copy beside the real app (below). The app opens `shinsa://` links its pages carry (core's reference scheme)
  as well as its own scheme's.

## Commands

| Command | Description |
|---|---|
| `bun run build` | Bundles `src/main` and `src/preload` to `dist/` (`scripts/build.ts`); `SHINSA_FLAVOR=canary` bakes in Shinsa Canary |
| `bun run dev` | Bundles `src/main` and `src/preload` to `dist/` and opens the app, as `.electron/Shinsa.app`, on the Vite dev server (start `bun dev` first); `SHINSA_URL=http://127.0.0.1:5180 bun run dev` for the built server |
| `bun run package` | Builds the web app and the engine (`SHINSA_VERSION` sets its version), then `release/mac-arm64/Shinsa.app` with the engine and its job inside, signed ad hoc so it runs on this Mac (electron-builder, `electron-builder.yml`) |
| `bun run package:canary` | The same as Shinsa Canary, engine and app built with `SHINSA_FLAVOR=canary`: `release/mac-arm64/Shinsa Canary.app` (`electron-builder.canary.yml`) |
| `bun run icon` | Writes `resources/icon.svg`, `icon.png` and `icon.icns` from the logo, and their `icon-canary.*` (`scripts/icon.ts`) |
| `bun run dmg-background` | Writes the disk image backgrounds, `resources/dmg/background-stable.png`, `background-beta.png`, `background-canary.png` and their `@2x` (`scripts/dmg-background.ts`) |
| `bun test` | The `lib/` tests, 100% line and function coverage |
| `bun run check-types` | `tsc` over `src`, `test` and `scripts` |

**Updates.** The packaged app updates itself (`main/updater.ts`): electron-updater reads the GitHub releases of
`shinsa-dev/shinsa` (`publish` in `electron-builder.shared.yml`), downloads a new version in the background and installs it
when you quit, or at once from Shinsa → Restart to Update. Quitting never stops the server, so an update never
interrupts an agent. Squirrel.Mac installs only an update signed by the same Developer ID, so ad hoc builds download
but do not install. Squirrel.Mac also installs an update only into the same bundle id, so each app has its own
channels (`lib/update-channel.ts`): Shinsa offers Stable and Beta, and Shinsa Canary is always on Canary. Stable
reads `latest-mac.yml` from the release marked latest, Beta reads `beta-mac.yml` from the newest beta or stable
release (`allowPrerelease`; a canary is skipped), and Canary reads `canary-mac.yml` from the newest canary only
(electron-updater's GitHub provider treats any pre-release word but `alpha` and `beta` as a channel of its own), so
Shinsa Canary is never offered Shinsa's build. All three read the `github` feed (`UPDATE_FEED`, set with `setFeedURL`). `allowDowngrade` stays false (electron-updater turns it on when `channel` is set) except for one accepted
go-back: on Stable, a beta newer than the latest stable is offered that version ("Go back to 1.2.0 (stable)?",
update status `downgrade`, `answerDowngrade` over the bridge, a dialog once after the switch), and accepting
downloads it with `allowDowngrade` on for that check only. Switching to Stable below a beta that is downloading or
staged discards it (the download is cancelled; Squirrel.Mac's ShipIt job and folder are removed).
`test/lib/update-feed.test.ts` runs electron-updater's GitHub provider over fake feeds to pin what each channel
offers. The channel is the app's, not the engine's: it lives in `userData/prefs.json` (`updateChannel`), since the
updater runs before any page loads and while the engine is down, and a browser tab has no updater; a new install
starts on the channel of its own version, and a stored channel the app does not offer is ignored. The page shows and
switches it through the bridge (`channel`, `applyUpdateChannel`; Settings → General → Updates), and switching checks
again at once; a page told `canary` shows it fixed and offers no switch, and Shinsa's page links to
`shinsa.dev/download/canary` instead. The About panel and the manual check's answer name the channel. Releasing is
Actions → Release (`.github/workflows/release.yml`, `docs/release.md`): channel stable or beta, bump patch, minor or
major, and a Shinsa Canary build of every merge to `main` that passes Test; it builds `Shinsa-mac-arm64.dmg` and `.zip` with that version in the app and its engine, signs and notarizes
when the `CSC_LINK` and Apple secrets are set, publishes the release, and copies the DMG to the site's R2 bucket,
from which `shinsa.dev/download` (stable), `shinsa.dev/download/beta` and `shinsa.dev/download/canary` serve it. The version lives in the tag, never in `package.json`. The plan for the engine
following the app is `docs/plans/app-plan.md` → Versions and updates.

**Shinsa Canary.** Canary builds are a separate app, "Shinsa Canary", that installs and runs beside Shinsa (the Beta
you use every day is never replaced). One build-time switch picks the app: `SHINSA_FLAVOR=canary` for the engine
(`build-engine.ts`) and the app (`scripts/build.ts`) bakes `process.env.SHINSA_BUILD_FLAVOR` in, and both read their
identity from core's `APP_FLAVORS` (`packages/core/src/protocol/flavor.ts`). Everywhere two installs could meet,
Shinsa Canary has its own:

| | Shinsa | Shinsa Canary | Where |
|---|---|---|---|
| Bundle id, name, icon | `studio.overclock.shinsa`, Shinsa, `icon.icns` | `studio.overclock.shinsa.canary`, Shinsa Canary, `icon-canary.icns` | `electron-builder.canary.yml` (both extend `electron-builder.shared.yml`) |
| Engine job | `studio.overclock.shinsa.engine` | `studio.overclock.shinsa.canary.engine` | `resources/LaunchAgents-canary/`, `serializeEngineAgent`'s test compares both |
| Engine data | `~/.config/shinsa` | `~/.config/shinsa-canary` | `resolveShinsaPaths` (engine), `resolveDataDir`/`resolveConfigPath` (app) |
| Port | 7446 | 7447 | `FlavorIdentity.port`, engine and app; a dev engine pins 5180 instead (`apps/engine/package.json`) |
| Command | `~/.local/bin/shinsa` | `~/.local/bin/shinsa-canary` | `resolveCommandLink` |
| URL scheme | `shinsa://` | `shinsa-canary://` | `protocols`, `URL_SCHEME`, the engine's `resolveTaskLink` |
| userData, single-instance lock, prefs | `~/Library/Application Support/Shinsa` | `~/Library/Application Support/Shinsa Canary` | `resolveUserDataDir` |
| ShipIt (staged updates) | `studio.overclock.shinsa.ShipIt` | `studio.overclock.shinsa.canary.ShipIt` | `resolveStagedUpdate` with `APP_ID` |
| Update channel | Stable or Beta | Canary, fixed | `listUpdateChannels` |

The launchd plist cannot name `~`, so the canary engine's data folder is baked into its build, not set in the plist;
its data folder lock (`serve.lock`) is in that folder, so the two engines never share one, and the canary has its own
config, Claude accounts (their keychain entries are named after each account's folder), extensions and event log:
you sign in and onboard again there. `/api/health` and `shinsa version --json` report the engine's `flavor`, and the
app takes only its own (`parseHealth`). Notifications, the Dock and Login Items follow the bundle id and name, and
neither app registers anything under the other's. The canary app never removes or replaces Shinsa's job: the old
`shinsa service` LaunchAgent it retires is its own id's.

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

