# @shinsa/marketing

The one-page site. Astro 7, static output, React islands for every demo, rendered at build
time so the static HTML already holds them (the hero hydrates on load, the rest as they near the screen). Dev and preview on
**5182**; the scripts run Astro under Bun (`bun --bun astro`) because Astro 7 needs a newer Node than the repo pins.

The demos are not drawings of Shinsa: they render `apps/web`'s own components (the `@/` alias points at
`apps/web/src`) from sample state built with `apps/web/src/routes/ui/samples.ts`. `lib/demo-server.ts` stands in for
`shinsa engine` in the browser: it answers the web's one WebSocket (acks every command and hands it to the demo that
listens, streams transcripts) and `/api/tasks/<id>/<read>` from the in-memory repositories in `lib/demo-repo.ts` (one per task: Shinsa's for the Review demo, Northwind's for the rest), so
the real cards, toasts, live feeds and the Code workbench work unchanged. It also keeps the page's path fixed while the
web's router writes its query (`?tab=chat`, the Code tab's position), and supplies `crypto.randomUUID` where the
browser withholds it on plain HTTP (a Tailscale preview). Nothing leaves the page.

Rendering the web app at build time needs three things. `astro.config.mjs` imports `lib/server-dom.ts` first, which
gives the build process the browser globals the web's modules read when they load (`location`, `history`,
`localStorage`, `matchMedia`, and a 1440×1000 window so row windows such as All tasks' render their rows); it has to run before any page chunk, so it lives in the config, not in a component. A
plugin in the config points every `react` import at `lib/react-snapshots.ts`, whose `useSyncExternalStore` uses the
client snapshot as the server one, since React refuses to render or hydrate that hook without it and the web app never
passes one. And the server half of the stand-in (`installDemoApi`) runs at build too, so `code.tsx` and `review.tsx` can load the
workbench's reads with a top-level await before it renders, in the build and in the browser alike: `review-prime.ts`
reads every folder and file at both commits and the diff, and the stand-in answers at once, so the Code tab never
shows a loading state. The stand-in calls `connection.flush()` after it opens, since the connection otherwise applies state on the next frame and the build would render the composer without its project. Keep a demo's first
render a function of its sample state: anything read from the clock or the URL during render shows up as a hydration
mismatch.

The page reads as one story down the screen: sections follow each other closely, the windows size themselves to the
screen's height and width in CSS alone (`components/layout/DemoWindow.astro`, `lib/window-size.ts`, `.demo-window` in
`global.css`), and every demo's box is reserved in the static HTML, so nothing moves when the islands mount. From 640px
up a window is the desktop app scaled to fit; below it, on a phone, it renders the web app at the phone's own width
and its `narrow` height, since the web app is responsive and a scaled desktop is too small to read. Keep it
that way: a demo whose height depends on its content gets fixed inner heights and a reserved height in `index.astro`.
A window's height is the whole window, its top bar included.

A window looks like the Mac app, which has no title strip: `Window` (`frame.tsx`) starts with the web's own
`CardsTopBar`, fed the demo's state and rendered at the demo's page through `RouteScope` (so All tasks marks Tasks and
a task page shows its queue menu), inside `data-desktop="window"` and `DesktopChrome` so it takes the app's look (the
room for the lights, Home in place of the wordmark). The traffic lights are drawn over it where macOS puts them
(`.demo-lights` in `global.css`), measured from Shinsa.app on macOS 27 at 2x: 14px circles, centres 23px apart, the
first centre 23px from the left and 22px down (the bar's middle), each a top-to-bottom gradient with a darker 0.5px
edge on its sides and a faint glow under it. Below 640px the page shows the web app as a phone's browser would: a
second copy of the bar without `data-desktop`, the wordmark and no lights, swapped in by the container query in CSS so
nothing changes when the islands mount. Both bars are `inert`; the demo below them is the part you use.
`Backdrop.astro` draws a circuit board behind it (`lib/board.ts`): each demo
window is a chip, two traces per side run from one chip to the next, and a signal travels down them as you scroll.

## Layout

```
src/
  pages/index.astro         The page: hero, then one Section per feature, then Closing
  layouts/Site.astro        Meta, the theme class from the system setting, Header (no footer)
  components/layout/        Header (solid, with a fade under it once you scroll), Section (centred title, text, then the
                            demo), Backdrop (the circuit board and its scroll signal)
  components/sections/      Hero, Closing (principles and the last call)
  components/ui/Button.astro  An anchor with the kit's buttonVariants
  components/demos/         One island per demo: hero (Home), gates (the real task page, walked through its gates by
                            your answers, with its chat),
                            kinds (the six kinds of task, cycling until you pick one), review (the Review tab: the
                            walkthrough, judgement calls, risks and testing, with the Evidence section first; static but for
                            its point index, its evidence and scrolling), code (the Code workbench, side by side and
                            editable: the stand-in keeps your saves in memory), roadmap (All tasks), loop (the
                            pull request activity), guard (agent commands and the policy's verdicts); frame.tsx holds
                            DemoRoot (installs the stand-in server), Window (the app's top bar and traffic lights over
                            the demo's page) and Stage; focus.ts (`useFocus`) plays a demo only
                            while it is the main thing on screen (half of it in view, or 45% of the screen), and its first step comes 300ms after
  lib/content.ts            Every headline and paragraph on the page, the principles and the feature grid
  lib/site.ts               Name, URL, description, the download and GitHub links
  lib/scene.ts              The sample project (Northwind) and the Home and roadmap state
  lib/*-scene.ts            One file of sample state per demo. onboarding-code.ts is the Northwind change the gates and
                            Code demos show. tint-scene.ts is the Review demo's task, a real Shinsa change (SW-214, the
                            tinted kind icons and pull request badges on All tasks): its code is the commit's real files,
                            snapshotted as text in src/assets/shinsa-change/ (before, after and a few unchanged
                            neighbours, read with `?raw` through tint-code.ts, so nothing lints or type-checks them), and
                            evidence-scene.ts its evidence: shots of Shinsa's own All tasks page in public/evidence/
                            (1280px light and dark, before recreated with the commit's old classes), a hover recording,
                            the roadmap tests' real run and the checks, and a dev-server link
  lib/og.tsx                The share image (`/og.png`, 1200×630): Satori and resvg at build time, in Areal from
                            `src/assets/fonts/` (static Regular and Medium cut from the kit's variable font, since Satori
                            reads neither WOFF2 nor variable fonts), with the kit's own logo and icons
  lib/llms.ts               `/llms.txt`, written from `content.ts` so it never drifts from the page
  pages/                    index, 404, og.png, llms.txt; public/ holds the
                            PNG icons, site.webmanifest and robots.txt; @astrojs/sitemap writes the sitemap
  lib/guard.ts              Runs `apps/engine/src/agents/policy.ts` at build time on a fixed list of commands
  worker/                   The Worker in front of the assets: index.ts wires Cloudflare's globals into download.ts,
                            which answers the download paths (tested in test/worker/ at 100%, `bun run test`)
```

## Rules

- The repo's conventions apply: no comments, the verb catalog, `bun lint`, `bunx knip`, `bun check-types`.
- Never copy a web component into this app to change it for the page. Feed it different sample state, or change it in
  `apps/web` where it belongs.
- A demo shows only what Shinsa does today. When a behaviour changes, its demo and copy change with it.
- Copy follows the `copy` skill: sentence case, no em dashes, no selling words.

## Deploy

Cloudflare Workers Builds deploys the site from the Git repository; there is no workflow and no API token in the
repository. The `shinsa-marketing` Worker (`wrangler.jsonc`) serves `dist` as static assets on `shinsa.dev` and
`www.shinsa.dev`. Its build settings, set in the Cloudflare dashboard: root directory `apps/marketing`, build command
`bun install --frozen-lockfile && bun run build` (the install runs at the workspace root, since the site builds the
web app's components), deploy command `bun run deploy` (`wrangler deploy`) on `main`, and preview command
`bun run deploy:preview` (`wrangler preview`) on every other branch. A preview is its own copy of the Worker on
workers.dev with a URL per branch and per deployment (`"previews": {}` turns it on; the site has no bindings, so the
block is empty). Wrangler comes from this package's `devDependencies`, as Workers Builds requires. There is no server and no analytics.
The Worker (`main` in `wrangler.jsonc`, `src/worker/`) runs only for `/download` and `/download/*`
(`assets.run_worker_first`); every other request is a plain static asset hit. Every release, stable or beta, carries
`Shinsa-mac-arm64.dmg`, so the site never changes for a release and GitHub counts the downloads:

- `/download` redirects (302) to `releases/latest/download/Shinsa-mac-arm64.dmg`, the newest stable release, since
  GitHub's `latest` never names a pre-release. It needs no lookup; it lives in the Worker rather than in a
  `_redirects` file so both channels and their fallback are in one tested module.
- `/download/beta` redirects to the disk image of the newest release, pre-releases (`v1.3.0-beta.2`) included. The
  Worker reads `api.github.com/repos/shinsa-dev/shinsa/releases?per_page=10` unauthenticated, skips drafts and
  releases without the disk image, and picks the highest version by semver order rather than the list's order
  (1.3.0-beta.2 < 1.3.0-beta.11 < 1.3.0). The answer is kept 5 minutes in the edge cache (`caches.default`, under a
  made-up URL), so GitHub's limit of 60 requests an hour per address is never reached; the cache works on the custom
  domains, not on a workers.dev preview, which asks GitHub every time. On any failure (the rate limit, the network,
  an answer that is not a list, no release with the disk image) it redirects to the releases page instead and keeps
  nothing.

The Worker needs no secret, no binding but `ASSETS` and nothing in the dashboard: Workers Builds deploys it with the
assets from the same `wrangler deploy`.
