# @shinsa/desktop

Shinsa for Mac: an Electron window around `shinsa serve`, never the other way round. The server runs on its own (a
launchd service, `shinsa service`); the app finds it, loads the UI from its URL and adds only what a page cannot do:
the Dock badge, notifications that open the task, `shinsa://` links, the menu and the window. Quitting the app never
stops the server. What it looks like and how it behaves is `docs/design.md` → Where Shinsa differs, 31; the plan
behind it is `docs/plans/desktop-plan.md`.

## Layout

```
src/
├── lib/            Pure logic, Bun-tested at 100% (test/lib/): deep-link.ts (shinsa:// → a page path), badge.ts,
│                   notice.ts (checks a notification the page sends), navigation.ts (what stays in the window, what
│                   opens in the browser, the permissions the page gets), server-url.ts (which server to load),
│                   health.ts (GET /api/health, with or without `version`), bounds.ts (window place on connected
│                   displays), service.ts (starting the service), bridge.ts (the bridge's types and IPC channels)
├── main/           The Electron glue, kept thin and outside coverage: index.ts (single instance, deep links,
│                   connecting to the server, IPC, the session's permissions), window.ts (MainWindow: hide on
│                   close, navigation, the waiting page), menu.ts, notifications.ts, server.ts (health, starting
│                   the service in the login shell), prefs.ts (window bounds in userData/prefs.json)
└── preload/        index.ts: exposes `window.shinsaDesktop` (version, windowState, updateBadge, notify, onNavigate,
                    onWindowState) to the server's page only
static/waiting.html The "Shinsa is not running" page
```

## Rules

- **The page owns what it shows.** The web decides what is new, what the badge says and where a notification goes
  (`apps/web/src/lib/desktop.ts`); the app only carries it out. The bridge's shape is mirrored in `src/lib/bridge.ts`
  and `apps/web/src/lib/desktop.ts`: change both together.
- **Trust nothing from the page.** Every IPC message is checked against the window's own top frame on the server's
  origin (`MainWindow.isAppSender`) and parsed in `lib/` (`parseNotice`, `resolveBadgeText`); a `shinsa://` link is
  parsed into a known page path, never loaded or passed to a shell. The page gets only the clipboard and full screen;
  notifications are denied to it, so only the app notifies.
- **Logic in `lib/`, Electron in `main/`.** Anything that decides goes in `lib/` with a test; `main/` wires it.
- Which server: `SHINSA_URL` (an origin) wins; unpackaged, the Vite dev server on 5181; packaged, `SHINSA_PORT`, then
  `port` in Shinsa's `config.json`, then 5180, always on 127.0.0.1.
- Unpackaged runs as "Shinsa Dev" with its own userData (`~/Library/Application Support/Shinsa Dev`) and registers no
  URL scheme; pass a link as an argument to try one (`electron . shinsa://task/LOC-4` while it runs).
- Bundle id `studio.overclock.shinsa`, scheme `shinsa`, Apple Silicon only, unsigned (ad hoc) for now.

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Bundles `src/main` and `src/preload` to `dist/` and opens the app on the Vite dev server (start `bun dev` first); `SHINSA_URL=http://127.0.0.1:5180 bun run dev` for the built server |
| `bun run package` | `release/mac-arm64/Shinsa.app`, signed ad hoc so it runs on this Mac (electron-builder, `electron-builder.yml`); not run in CI |
| `bun test` | The `lib/` tests, 100% line and function coverage |
| `bun run check-types` | `tsc` over `src` and `test` |

The root `bun dev` skips this package (`--filter=!@shinsa/desktop`), so it never opens a window by itself.
