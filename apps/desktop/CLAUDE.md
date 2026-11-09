# @shinsa/desktop

Shinsa for Mac: an Electron window around the engine, never the other way round. The engine (`shinsa engine`, from the
bundle) runs on its own as a launchd job the app registers; the app finds it, loads the UI from its URL and adds only what a page cannot do:
the Dock badge, notifications that open the task, `shinsa://` links, the menu, the menu bar item and the window.
Quitting the app never stops the server. What it looks like and how it behaves is `docs/design.md` → Where Shinsa differs, 31; the plan
behind it is `docs/plans/desktop-plan.md`.

## Layout

```
src/
├── <module>/       One folder per concern, the same layout as apps/cloud and packages/core (the effect skill → File
│                   layout): its shapes, tagged errors, constants and named Schedules in schema.ts, its Effect service
│                   and layer in service.ts, and its pure logic in a module named for it, Bun-tested at 100% under
│                   test/<module>/ through the fakes in test/support/desktop.ts and TestClock
│   away/           tracker.ts (time away: from 10 minutes after your last input, or your last input before a lock
│                   or sleep, to your next); AwayWatch polls the idle time every 30 s and sends each span to the page
│   app/            dev-bundle.ts (the app's name, its userData folder, the renamed Electron.app `bun run dev` runs);
│                   AppLifecycle (shinsa:// links at launch and later, a second instance, Activate, quitting)
│   bridge/         The bridge's types and IPC channels; PageBridge answers the page's messages
│   command-line/   install.ts (the link and profile decisions); CommandLine puts `shinsa` on your PATH
│   connection/     Connection: the connect loop (2 s retries for the dev servers or an approval), the 5 s watch,
│                   three misses, the status page's buttons
│   deep-links/     links.ts (shinsa:// → a page path)
│   engine/         launchd.ts (the job, its plist, its state), screen.ts (the status page's views);
│                   EngineSupervisor (register, wait 25 s kicking after 3 s, restart, the log tail)
│   engine-actions/ EngineActions, the status page's and the menu's requests as a Stream
│   first-health/   FirstHealth, the health check sent before the app is ready
│   menu/           template.ts (the app menu: File, Go and Help; no View menu, so no zoom, Reload or developer tools);
│                   AppMenu (the page's actions over `shinsa:action`, the help links, the engine log)
│   navigation/     origin.ts (what stays in the window, what opens in the browser, the page's permissions,
│                   resolveHistoryStep)
│   notifications/  notice.ts (the badge text, the settings pane); Notifications (the Dock badge, banners)
│   page-channel/   PageRequest, every IPC message the page may send, decoded by schema
│   prefs/          Prefs: window bounds, the update channel and the kept version in userData/prefs.json
│   server/         url.ts (which server to load; resolveConfigHome, the config folder launchd.ts reads too);
│                   EngineServer: health and the queue through core's EngineApi `server` group client, decoded,
│                   1.5 s each
│   tray/           menu.ts (the menu bar item's status line, count and menu); StatusTray
│   update-log/     log.ts (lines and rotation); UpdateLog, `~/Library/Logs/<app>/updater.log`
│   updates/        state.ts (states, menu item, notices, the go-back dialog), channel.ts (the channels, their
│                   options, when a version ahead is offered the latest there); Updater (start, every four hours,
│                   download, install with a 15 s timeout, channel switches)
│   window/         bounds.ts, close.ts (close or hide), context-menu.ts (the right-click text menu); AppWindow
│                   (the page, navigation, Back and Forward, the waiting page)
│   dialogs/ files/ host/ launchctl/ login-items/ login-shell/ native-notices/ native-tray/ native-window/
│   power-monitor/ shell/ update-client/
│                   The outside world as services with no logic: Electron, the file system, launchctl, a login
│                   shell, electron-updater. Their Electron events arrive as Streams; tests replace each with a fake
├── main/           Outside coverage: index.ts, the composition root (one ManagedRuntime, disposed on `will-quit`),
│                   and the Electron and Node layers of the outside-world services (`*Live`)
└── preload/        index.ts: exposes `window.shinsaDesktop` (version, protocol, update, channel, windowState,
                    updateBadge, notify, openNotificationSettings, onNotifyFailed, installUpdate, checkForUpdates, applyUpdateChannel, answerDowngrade, onNavigate,
                    onWindowState, onUpdate, onAway, onAction) to the server's page
                    only; `protocol` is core's ENGINE_PROTOCOL, and the page compares both with the engine's
static/waiting.html The "Shinsa is not running" page; trayTemplate.png and @2x, the menu bar item's icon (scripts/icon.ts)
resources/          The app icons: icon.svg (the source), icon.png (1024px), icon.icns (electron-builder's `mac.icon`),
                    all written by scripts/icon.ts; the engine's job in LaunchAgents/; app-update.yml, the updater's
                    config the build copies into Contents/Resources (Updates, below)
scripts/            build.ts (bundles main and preload), dev.ts, icon.ts, dmg-background.ts, each one Effect program run
                    with BunRuntime.runMain; kit/ holds what they share (runScriptCommand, readMarkPaths, ScriptStepFailed)
electron-builder.shared.yml    The build settings; electron-builder.yml extends it with what names the app (its id,
                               scheme, icon and engine job). Every channel builds this one app, so a stable, beta or
                               canary release updates the same Shinsa in place
```

## Rules

- **The page owns what it shows.** The web decides what is new, what the badge says and where a notification goes
  (`apps/web/src/lib/desktop.ts`); the app only carries it out. The bridge's shape is mirrored in `src/bridge/schema.ts`
  and `apps/web/src/lib/desktop.ts`: change both together.
- **Trust nothing from the page.** Every IPC message is checked against the window's own top frame on the server's
  origin (`AppWindow.isAppSender`) and decoded by `PageRequest` (`page-channel/schema.ts`, the notice's own
  `NoticePayload`), and anything unknown or malformed is dropped; a `shinsa://` link is
  parsed into a known page path, never loaded or passed to a shell. The page gets only the clipboard and full screen;
  notifications are denied to it, so the page in the app notifies only through the bridge.
- **Only the app notifies.** Its page says `hello` with surface `desktop` on every socket (`resolveSurface` in
  `apps/web/src/lib/desktop.ts`, from `window.shinsaDesktop`), and while it is connected the server tells every other
  page, browser tabs and Floaty, to stay quiet: no sound and no notification, while the count in the title and
  Floaty's tags stay (`docs/engine.md` → The socket). Nothing in the app decides this; it follows from the preload bridge being there.
- **macOS decides whether anything shows.** Banners and the Dock badge appear only while System Settings →
  Notifications allows Shinsa; once you deny it (or dismiss the first prompt), macOS takes notifications without
  showing them and never asks again, and Electron has no way to read that setting. So Settings → Notifications in the
  app always has a macOS notifications row whose Open settings sends `shinsa:notification-settings`, and main opens
  that pane for `APP_ID` (`resolveNotificationSettingsUrl` in `notifications/notice.ts`). When Electron reports a notification
  `failed`, `Notifications` tells the page on `shinsa:notify-failed` and the page shows a toast with the same
  action. macOS asks only when the first notification arrives, so the page sends one welcome notification on its
  first load with notifications on (`showNotificationWelcome` in `apps/web/src/lib/notifications/welcome.ts`), while
  you are looking at the app. Signed builds only: an unsigned dev build delivers no notifications at all.
- **The icon** follows macOS's 1024px grid: a light 824px squircle (continuous corners of about 185px) inset 100px,
  with room for its shadow, and the Shinsa mark from `packages/ui/src/components/logo.tsx` in near-black at 488px,
  centred, on every channel. Change `scripts/icon.ts`, never the outputs, and run `bun run icon` (needs `rsvg-convert` from
  Homebrew's librsvg, and `iconutil`). The unpackaged app sets `resources/icon.png` as its Dock icon.
- **The disk image** opens on a 660×400 window (`dmg` in `electron-builder.shared.yml`): Shinsa.app on the left, the
  Applications link on the right, 112pt icons, on a light background in the site's look (the dot grid, circuit traces
  with the blue signal running from the app to Applications, the mark and "Shinsa" in Areal, and a "Drag Shinsa into
  Applications to install" line). Finder never themes a disk image's background and draws the labels dark in light and
  dark mode alike, so it stays light. The backgrounds are `resources/dmg/background-stable.png`,
  `background-beta.png` and `background-canary.png`, each with an `@2x` (electron-builder joins the pair into a Retina
  TIFF); the beta one adds a blue Beta pill and the canary one an amber Canary pill. `electron-builder.yml` names the stable
  one, and a beta or canary release swaps in its own with `-c.dmg.background=dmg/background-<channel>.png`
  (`release.yml`). They are 660×432: Finder's window is the image's size,
  title bar included, so its bottom 32px never show. Change `scripts/dmg-background.ts`,
  never the outputs, and run `bun run dmg-background` (needs `rsvg-convert` from Homebrew's librsvg; the text is set in
  Areal from `apps/marketing/src/assets/fonts`, and the script holds the words' measured widths, so remeasure if you
  change them). The icon positions in the script and in `electron-builder.shared.yml` must agree. The volume is named
  `Shinsa <version>`: Finder caches a disk image's background and layout by volume name, so a new name per version
  keeps an old one from showing. To try a change, build a disk image from the packaged app with a version you have not
  opened yet: `bunx electron-builder --mac dmg --arm64 --publish never --prepackaged release/mac-arm64/Shinsa.app
  -c.mac.identity=null -c.extraMetadata.version=0.0.1-test.1 -c.directories.output=/tmp/shinsa-dmg`.
- **Logic in the module folders, Electron in `main/`.** Anything that decides is an Effect service or a pure module in
  its folder, with a test; `main/` only holds the `*Live` layers that reach Electron, Node and launchctl, and the
  composition root. Every answer from the engine and the update feed and every IPC payload is decoded by a schema;
  every expected failure is a tagged error (`EngineUnreachable`, `FileWriteFailed`, `UpdateCheckFailed`…); every
  poll, retry and repeat is a named Schedule (`START_SCHEDULE`, `LOAD_SCHEDULE`, `RETRY_SCHEDULE`,
  `WATCH_SCHEDULE`, `UPDATE_CHECK_SCHEDULE`, `AWAY_POLL_SCHEDULE`). One `ManagedRuntime` runs the app: the engine services are built
  first, so the first health check goes out before Electron is ready, the native window, tray and IPC layers wait
  for `app.whenReady()`, and `will-quit` disposes the runtime, which closes every listener, the watch and the update
  schedule. The engine keeps running. The main bundle imports from `@shinsa/core` only the engine API and the app's identity.
- **The engine is the app's to run.** Packaged, the app first boots out and deletes a standalone engine's LaunchAgent
  (`~/Library/LaunchAgents/studio.overclock.shinsa.engine.plist` running a program other than its own, written by a
  `shinsa start` from npm or the install script, `isStandaloneAgent`), since it holds the label the app's job needs. It removes the old `shinsa service` LaunchAgent once
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
- **The `shinsa` command** is on your PATH without asking (`CommandLine`, the decisions in
  `command-line/install.ts`). On
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
  `port` in the app's `config.json`, then core's `APP_IDENTITY.port`, 7446, always on 127.0.0.1, whatever the update channel.
- The app is "Shinsa" everywhere, packaged or not (`app.setName`, the first menu, the About panel, the window, the
  status page and the updater's messages), on every channel. The menu bar and
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
| `bun run build` | Bundles `src/main` and `src/preload` to `dist/` (`scripts/build.ts`) |
| `bun run dev` | Bundles `src/main` and `src/preload` to `dist/` and opens the app, as `.electron/Shinsa.app`, on the Vite dev server (start `bun dev` first); `SHINSA_URL=http://127.0.0.1:5180 bun run dev` for the built server |
| `bun run package` | Builds the web app and the engine (`SHINSA_VERSION` sets its version), then `release/mac-arm64/Shinsa.app` with the engine and its job inside, signed ad hoc so it runs on this Mac (electron-builder, `electron-builder.yml`) |
| `bun run icon` | Writes `resources/icon.svg`, `icon.png` and `icon.icns` from the logo, and the menu bar item's `static/trayTemplate.png` and `@2x` (`scripts/icon.ts`) |
| `bun run dmg-background` | Writes the disk image backgrounds, `resources/dmg/background-stable.png`, `background-beta.png`, `background-canary.png` and their `@2x` (`scripts/dmg-background.ts`) |
| `bun test` | The module tests under `test/`, 100% line and function coverage |
| `bun run check-types` | `tsc` over `src`, `test` and `scripts` |

**Updates.** The packaged app updates itself (`Updater`, over `UpdateClient`, electron-updater's layer in `main/update-client.ts`): electron-updater reads the update files at
`https://shinsa.dev/updates`, its `generic` provider (`publish` in `electron-builder.shared.yml`; the same feed in `UPDATE_FEED` and in `resources/app-update.yml`, which
electron-updater reads from `Contents/Resources` before every download and `test/release/build.test.ts` keeps equal), downloads a new version in the background and installs it
when you quit, or at once from Shinsa → Restart to Update. Quitting never stops the server, so an update never
interrupts an agent. Everything that waits happens before Restart is offered, so the click only quits and the swap
and relaunch follow: the updater goes `downloading` (with its percent) → `preparing` (electron-updater has the zip,
Squirrel.Mac pulls it from electron-updater's local proxy, unpacks and verifies it and stages ShipIt; about 10 s) →
`ready` only on Squirrel.Mac's own `update-downloaded` → `installing` after the click. The menu, Settings → General →
Updates and the page's bridge (`DesktopUpdate`) show each state, and Restart appears only at `ready`.
`quitAndInstall()` closes every window before `before-quit`, so `Updater` marks the window quitting before it calls it and on the built-in
updater's `before-quit-for-update`; without it the close would hide the window, cancel the quit and leave ShipIt
refusing to replace a running app (`App Still Running Error`). If the app still runs `INSTALL_TIMEOUT` (15 s)
after the click, it goes back to `ready` with a notice to quit Shinsa; an error while preparing or installing also
shows a notice, while a failed background check stays in the menu. electron-updater's lines and each state change
go to `~/Library/Logs/Shinsa/updater.log`, started afresh past 1 MB, beside
ShipIt's own `~/Library/Caches/<bundle id>.ShipIt/ShipIt_stderr.log`. Squirrel.Mac installs only an update signed by the same Developer ID, so ad hoc builds download
but do not install. Squirrel.Mac also installs an update only into the same bundle id, so every channel builds the
one app (`studio.overclock.shinsa`) and you switch between them (`updates/channel.ts`): Stable, Beta and Canary. Stable
reads `latest-mac.yml`, the newest stable release; Beta reads `beta-mac.yml`, the newest beta or stable release by
semver; and Canary reads `canary-mac.yml`, the newest canary only. The release workflow writes them to the site's R2
bucket, each naming its version's own zip, and every version stays there forever (`docs/release.md` → Channels and
updates); every canary is built above the newest beta and stable release, so Canary never misses what they shipped.
All three read the one feed (`UPDATE_FEED`, set with `setFeedURL`), with `useMultipleRangeRequest` off, since R2
serves one byte range per request. `allowDowngrade` stays false (electron-updater turns it on when `channel` is set) except for one accepted
go-back: on Stable or Beta, a beta or canary newer than the latest there is offered that version ("Go back to 1.2.0
(stable)?",
update status `downgrade`, `answerDowngrade` over the bridge, a dialog once after the switch), and accepting
downloads it with `allowDowngrade` on for that check only. Switching to a channel below a beta or canary that is
downloading or staged discards it (the download is cancelled; Squirrel.Mac's ShipIt job and folder are removed).
`test/updates/feed.test.ts` runs electron-updater's generic provider over fake channel files to pin what each channel
offers. The channel is the app's, not the engine's: it lives in `userData/prefs.json` (`updateChannel`), since the
updater runs before any page loads and while the engine is down, and a browser tab has no updater; a new install
starts on the channel of its own version, and a stored channel the app does not offer is ignored. The page shows and
switches it through the bridge (`channel`, `applyUpdateChannel`; Settings → General → Updates), and switching checks
again at once. The About panel and the manual check's answer name the channel. Releasing is
Actions → Release (`.github/workflows/release.yml`, `docs/release.md`): channel stable or beta, bump patch, minor or
major, and a canary of every merge to `main` that passes Test; it builds `Shinsa-mac-arm64.dmg` and `.zip` with that version in the app and its engine, signs, then notarizes
and staples in a step of its own that retries Apple's flaky services (`scripts/release-notarize.ts`) when the `CSC_LINK` and Apple secrets are set, publishes the release, and copies the DMG to the site's R2 bucket,
from which `shinsa.dev/download` (stable), `shinsa.dev/download/beta` and `shinsa.dev/download/canary` serve it. The version lives in the tag, never in `package.json`. The plan for the engine
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

