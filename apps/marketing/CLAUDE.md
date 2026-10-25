# @shinsa/marketing

The one-page site. Astro 7, static output, React islands for every demo, rendered at build
time so the static HTML already holds them (the hero hydrates on load, the rest as they near the screen). Dev and preview on
**5182**; the scripts run Astro under Bun (`bun --bun astro`) because Astro 7 needs a newer Node than the repo pins.

The demos are not drawings of Shinsa: they render `apps/web`'s own components (the `@/` alias points at
`apps/web/src`) from sample state built with `apps/web/src/routes/ui/samples.ts`. `lib/demo-server.ts` stands in for
`shinsa serve` in the browser: it answers the web's one WebSocket (acks every command and hands it to the demo that
listens, streams transcripts) and `/api/tasks/<id>/<read>` from the in-memory repository in `lib/demo-repo.ts`, so
the real cards, toasts, live feeds and the Code workbench work unchanged. It also keeps the page's path fixed while the
web's router writes its query (`?tab=chat`, the Code tab's position), and supplies `crypto.randomUUID` where the
browser withholds it on plain HTTP (a Tailscale preview). Nothing leaves the page.

Rendering the web app at build time needs three things. `astro.config.mjs` imports `lib/server-dom.ts` first, which
gives the build process the browser globals the web's modules read when they load (`location`, `history`,
`localStorage`, `matchMedia`); it has to run before any page chunk, so it lives in the config, not in a component. A
plugin in the config points every `react` import at `lib/react-snapshots.ts`, whose `useSyncExternalStore` uses the
client snapshot as the server one, since React refuses to render or hydrate that hook without it and the web app never
passes one. And the server half of the stand-in (`installDemoApi`) runs at build too, so `review.tsx` can load the
workbench's reads with a top-level await before it renders, in the build and in the browser alike. Keep a demo's first
render a function of its sample state: anything read from the clock or the URL during render shows up as a hydration
mismatch.

The page reads as one story down the screen: sections follow each other closely, the windows size themselves to the
screen's height and width in CSS alone (`components/layout/DemoWindow.astro`, `lib/window-size.ts`, `.demo-window` in
`global.css`), and every demo's box is reserved in the static HTML, so nothing moves when the islands mount. From 640px
up a window is the desktop app scaled to fit; below it, on a phone, it renders the web app at the phone's own width
and its `narrow` height, since the web app is responsive and a scaled desktop is too small to read. Keep it
that way: a demo whose height depends on its content gets fixed inner heights and a reserved height in `index.astro`.
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
                            kinds (the six kinds of task, cycling until you pick one), review (the Code workbench), roadmap (All tasks), loop (the
                            pull request activity), guard (agent commands and the policy's verdicts); frame.tsx holds
                            DemoRoot (installs the stand-in server), Window and Stage; focus.ts (`useFocus`) plays a demo only
                            while it is the main thing on screen (70% of it in view, or 60% of the screen)
  lib/content.ts            Every headline and paragraph on the page, the principles and the feature grid
  lib/site.ts               Name, URL, description, the download and GitHub links
  lib/scene.ts              The sample project (Northwind) and the Home and roadmap state
  lib/*-scene.ts            One file of sample state per demo; onboarding-code.ts is the change the review shows
  lib/og.tsx                The share image (`/og.png`, 1200×630): Satori and resvg at build time, in Areal from
                            `src/assets/fonts/` (static Regular and Medium cut from the kit's variable font, since Satori
                            reads neither WOFF2 nor variable fonts), with the kit's own logo and icons
  lib/llms.ts               `/llms.txt`, written from `content.ts` so it never drifts from the page
  pages/                    index, 404, og.png, llms.txt; public/ holds the
                            PNG icons, site.webmanifest and robots.txt; @astrojs/sitemap writes the sitemap
  lib/guard.ts              Runs `apps/server/src/agents/policy.ts` at build time on a fixed list of commands
```

## Rules

- The repo's conventions apply: no comments, the verb catalog, `bun lint`, `bunx knip`, `bun check-types`.
- Never copy a web component into this app to change it for the page. Feed it different sample state, or change it in
  `apps/web` where it belongs.
- A demo shows only what Shinsa does today. When a behaviour changes, its demo and copy change with it.
- Copy follows the `copy` skill: sentence case, no em dashes, no selling words.
