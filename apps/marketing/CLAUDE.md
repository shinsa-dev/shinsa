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
  components/layout/        Header (solid, with a fade under it once you scroll; its links point at `/#section`, so they work from every page), Section (centred title, text, then the
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
  lib/design.ts             `/design.md`, the whole design system in one file (below)
  pages/                    index, 404, open (where a pull request's "Open it in Shinsa" lands: the pull request's
                            own review as a page, the task page's header pinned on top (title, the two buttons, and the web's TaskSharedFacts:
                            handle, status, repository, branch, pull request, checks, coverage, started; under the title
                            the summary, cut to two lines, and where the review comes from), the web's Review tab under it without its summary card, Download Shinsa as an outline button and then Open in Shinsa, `shinsa://task/<id>` from `?task=` (resolveTaskInvite,
                            lib/open.ts, which refuses anything else), and Download Shinsa; the review read from the
                            link's `#review=` fragment (readReviewFragment in lib/open.ts; the task built in
                            lib/open-scene.ts on OPEN_TASK_ID, which the demo server gives no repository;
                            components/demos/open-review.tsx, the page's only content, rendered at build time as the header
                            with an empty title and description and no handle; worker/open.ts fills them, the Open in Shinsa
                            link and the tab's title from the query before the page is sent (resolvePendingHeader), and
                            the island's first render in the browser computes the same header, so hydration matches the
                            Worker's HTML; both Download buttons are rendered and the Worker only toggles `hidden`, so
                            the first paint is already the title and buttons, and everything the review adds appears
                            under them, so nothing painted moves). Without a review the same pinned header stays as
                            painted, with the handle and "This link carries no review" under it and no Review tab, and Download alone and primary under "This link does
                            not lead to a review" when the link names no task. The page is the window's height and
                            never scrolls itself; copy in content.ts `openTask`; left out of the sitemap, never indexed (`noindex` meta and
                            `X-Robots-Tag` in public/_headers) and sends no referrer), og.png, llms.txt and design.md; public/ holds the
                            PNG icons, site.webmanifest, robots.txt and _headers; @astrojs/sitemap writes the sitemap
  lib/guard.ts              Runs `apps/engine/src/agents/policy.ts` at build time on a fixed list of commands
  worker/                   The Worker in front of the assets: index.ts wires Cloudflare's globals and the R2 bucket
                            into download.ts, which answers the download paths, and open.ts, which fills the open
                            page's header from the query with HTMLRewriter (tested in test/worker/ at 100%,
                            `bun run test`)
```

## The design system file

`/design.md` is Shinsa's whole design system as one Markdown file, for an agent that has nothing else: an agent given
only it should build UI that matches Shinsa to the pixel and follows every rule. `pages/design.md.ts` writes it at
build time (`dist/design.md`) with `serializeDesign` (`lib/design.ts`). The prose is `docs/design-system.md`, written
by hand; every `<!-- design:NAME -->` line in it is replaced by a part generated from the source, so the parts that
can drift never do:

| Marker | Generated from |
| --- | --- |
| `toc` | the file's own `##` headings |
| `tokens` | every custom property in `:root`, `.dark, :root` and `.dark` of the kit's `globals.css`, light and dark, grouped, with the stylesheet's own comments; and any block that redefines tokens inside a region |
| `theme` | the kit's `@theme inline` block: the colour utilities and every other theme variable |
| `scales` | the effective type, weight, tracking, leading, corner, spacing, breakpoint, container and easing scales: the kit's theme over `tailwindcss/theme.css`, with px worked out |
| `utilities` | every `@custom-variant`, `@utility`, `@property` and `@keyframes` in `globals.css`, verbatim |
| `icons` | `ICON_NAMES` (`@shinsa/ui/components/icon`), the filled twins and the marks drawn in `custom.ts` |
| `lint` | `CLASS_RULES`, every `*_MESSAGE`, `BANNED_VERB_PATTERN` and `VERB_CATALOG` from `scripts/lint-rules.ts` (the data half of `scripts/lint-conventions.ts`) |
| `kit-stylesheet`, `web-stylesheet` | `globals.css`, and the web's `app.css` and `desktop.css`, verbatim |

`serializeDesign` throws on an unknown marker or a missing one. `test/lib/design.test.ts` builds the real file and
fails when a token in `globals.css`, an export of a `packages/ui` component, an icon or a lint rule is missing from it,
or when a section is missing from the contents. It also holds a few key phrases from each of the `design`, `copy`,
`conventions` and `review` skills and the engine plugin's `evidence`, `handover` and `review` skills (`SKILL_RULES`),
and fails when one leaves either the skill or the file. A change to the design system updates `docs/design-system.md`
in the same change as `docs/design.md` and the skills; the test catches a new token, component or icon, or a dropped
key skill phrase, not a changed rule.

It is served as `text/markdown; charset=utf-8`: Wrangler already types `.md` that way, and `public/_headers` says so
for `/design.md` in case that ever changes (a static endpoint's own headers are not kept in a static build, and the
Worker runs only for the download paths and `/open`, which sets its own two headers). `bun run preview` (Astro's static server) sends `text/markdown` without the
charset; `bunx wrangler dev` serves `dist` as production does.

## Rules

- The repo's conventions apply: no comments, the verb catalog, `bun lint`, `bunx knip`, `bun check-types`.
- Never copy a web component into this app to change it for the page. Feed it different sample state, or change it in
  `apps/web` where it belongs.
- A demo shows only what Shinsa does today. When a behaviour changes, its demo and copy change with it.
- Copy follows the `copy` skill: sentence case, no em dashes, no selling words.

## Deploy

Cloudflare Workers Builds deploys the site from the Git repository; no workflow deploys it (the repository's
`CLOUDFLARE_API_TOKEN` is used only by the Release workflow, to fill the download bucket below). The
`shinsa-marketing` Worker (`wrangler.jsonc`) serves `dist` as static assets on `shinsa.dev` and `www.shinsa.dev`. Its build settings, set in the Cloudflare dashboard: root directory `apps/marketing`, build command
`bun install --frozen-lockfile && bun run build` (the install runs at the workspace root, since the site builds the
web app's components), deploy command `bun run deploy` (`wrangler deploy`) on `main`, and preview command
`bun run deploy:preview` (`wrangler preview`) on every other branch. A preview is its own copy of the Worker on
workers.dev with a URL per branch and per deployment (`previews` turns it on, and repeats the R2 binding, since a
preview inherits no binding). Wrangler comes from this package's `devDependencies`, as Workers Builds requires. There
is no server and no analytics. The Worker (`main` in `wrangler.jsonc`, `src/worker/`) runs only for `/download`,
`/download/*` and `/open` (`assets.run_worker_first`); every other request is a plain static asset hit. `bun run
preview` serves `/open` without the Worker, so its header fills in only once the island hydrates; `bunx wrangler dev`
after a build shows it as production does.

The downloads are served from Cloudflare R2, so they never wait on GitHub and have no request limit and no egress fee.
The bucket is `shinsa-releases` on the Overclock Studio account (`account_id` in `wrangler.jsonc`), bound as
`DOWNLOADS`. The Release workflow fills it (`docs/release.md`), so the site never changes for a release:

```
releases/<version>/Shinsa-mac-arm64.dmg   every release's disk image, never overwritten
channels/stable.json                      what /download serves
channels/beta.json                        what /download/beta serves
channels/canary.json                      what /download/canary serves
```

A channel file is a pointer, `{version, key, size, sha256, publishedAt}` (`parseDownloadPointer`), written after the
GitHub release is published and only when its version is not older than the one there by semver (so a stable release
moves `stable.json` and `beta.json`, a beta only `beta.json`, a canary only `canary.json`, and a stable hotfix below a
running beta moves only `stable.json`). `canary.json` only ever points at a canary and the other two never do, so
`/download` and `/download/beta` never hand out a build of `main`. Only the newest five canaries keep their disk image in the bucket;
the Release workflow deletes the older ones.

- **Serving.** The Worker reads the channel's pointer (kept 60 seconds in the edge cache, `caches.default` under a
  made-up URL; the cache works on the custom domains, not on a workers.dev preview) and streams the object from the
  binding, never buffered and never through a redirect: `Content-Type: application/x-apple-diskimage`,
  `Content-Disposition: attachment; filename="Shinsa-<version>.dmg"` (`Shinsa-1.0.0-beta.1.dmg`),
  `Accept-Ranges: bytes`, `Cache-Control: public, max-age=300`, `X-Content-Type-Options: nosniff`, `Content-Length`,
  an `ETag` that is the file's SHA-256 and a `Last-Modified` that is the release's publish time. A single `Range`
  (`bytes=a-b`, `a-`, `-n`) reads only those bytes from R2 and answers 206 with `Content-Range`; a range past the end
  answers 416 with `Content-Range: bytes */<size>`, a multi-range or malformed one gets the whole file, and `If-Range`
  sends the whole file when the validator does not match. `If-None-Match` and `If-Modified-Since` answer 304,
  `If-Match` and `If-Unmodified-Since` 412, all from the pointer without touching the file. A HEAD answers from the
  pointer and a `head` of the object, reading no bytes. With no stable release yet (`stable.json` missing),
  `/download` serves the beta pointer directly rather than redirecting to `/download/beta`. `/download/canary` never
  serves another channel's pointer in place of a missing `canary.json`.
- **When R2 cannot serve**: no binding (a Worker deployed before it), no pointer, an unreadable pointer, the object
  missing, or any R2 error. The answer is then always a `302` to GitHub with `Cache-Control: no-store`, never a page.
  The Worker reads the public Atom feed `github.com/shinsa-dev/shinsa/releases.atom` (not the REST API and its 60
  requests an hour; kept 60 seconds in the edge cache, nothing kept on a failure). `/download/beta` goes to the
  newest beta or stable version in it, by semver, as `releases/download/<tag>/Shinsa-mac-arm64.dmg`, and
  `/download/canary` to the newest canary in it, or to the releases page when the feed fails or holds none.
  `/download` goes to `releases/latest/download/Shinsa-mac-arm64.dmg` (GitHub's own redirect, no API), except that a
  feed listing betas and no stable release sends it to the newest beta, since GitHub's `latest` has nothing before the
  first stable release. A canary is never a fallback for `/download` or `/download/beta`, and nothing but a canary is
  one for `/download/canary`. The feed lists the last 10 releases, so ten betas after a stable release would send a
  fallback `/download` to a beta: a working file, in a case that needs R2 down too.
- **Workers limits that apply.** A streamed response has no size limit, an R2 body costs no CPU time per byte, and an
  HTTP request has no wall-clock limit while the client stays connected. A download is two R2 operations (the pointer,
  on a cache miss, and the object), both Class B reads, of which ten million a month are free. Memory (128 MB) is never
  at risk, since nothing is buffered. The disk image itself is not kept in the edge cache: R2 serves it directly, and
  teeing a 170 MB stream into the Cache API would hold it in memory behind a slow client and cannot store a 206.

The Worker needs no secret: Workers Builds deploys it, with the assets and the binding, from the same `wrangler
deploy`. The binding names a bucket that must exist, or the deploy fails.
