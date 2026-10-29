# Shinsa design system

This one file is Shinsa's whole design system: every token with its light and dark value, every component with its
exact classes, every pattern, every copy rule and every rule the linter enforces. It is written for someone who has
only this file. Build from it and the result should match Shinsa to the pixel and follow every rule.

How to read it:

- **The values are exact.** Every number, colour and class string is copied from the code that renders Shinsa. Where
  a sentence says "quiet", "muted" or "small", the number behind it is next to it. When this file names a class,
  write that class.
- **The generated parts can't drift.** The tables in Tokens, the icon list, the linter's rules (verbatim, in
  Enforced rules) and both appendices are produced from Shinsa's source each time the site is built. The prose around
  them is written by hand and checked by a test that fails when a token, a kit component or an icon is missing.
- **Shinsa's own rules win.** Shinsa's system grew from Superwall's application register (paywall-next) on Buzzkit's
  component kit. Where those disagree, this file states only Shinsa's version: one blue accent, the ABC Areal
  typeface, both themes, a 22 / 24 / 26 / 30px control ramp and no focus states.
- **Names are the API.** `Button`, `SectionLabel`, `CARD` and the like are the names of components and constants in
  Shinsa's kit (`@shinsa/ui`) and web app. Rebuild them under the same names, so the rules that mention them still
  read true.
- **One pattern, one example.** Product screens appear only as examples of a general rule, so the rule is what to
  copy and the example shows what it looks like in Shinsa.
- **Read this first, then look things up.** The next section holds the rules that never bend, the values you need
  on every screen, the copy rules and the checklist. Every later section is the long form of something in it.

## Read this first

The core of the system in one place. If you read nothing else, read this: it is enough to build a screen that looks
and reads like Shinsa. The sections after it hold every exact class, every component and every pattern; when a line
here and a section disagree, the section wins and this core is fixed.

### The principles

These are the rules every other section applies. When a case is not covered anywhere, decide it by these.

1. **A native Mac app, not a web page.** Shinsa is desktop first and calm: dense rows, quiet chrome, nothing that
   moves unless something moved. Chrome is never selected and shows the arrow cursor; only content a person would
   copy is selectable. Screens are built for a full desktop window and must still work in a floating window about
   900px wide.
2. **Consistency comes from shared pieces, not from care at the call site.** Every repeated shape (a card, an inset,
   a row, a section label, a tooltip, a time, a checkmark, a status tile) is one component or one constant. Use it;
   never rebuild it by hand, and never copy a component to change it for one screen.
3. **Tokens, not values.** No hex, no hand-picked grey, no raw opacity for colour, no `text-[13px]`, no
   `rounded-[6px]`, no `shadow-[…]`. Every value comes from a token, and a new need gets a new token.
4. **One accent.** Blue `primary` is the primary button, links, selection, checked controls and every checkmark. The
   status tones (green, amber, red, blue, purple…) carry state only. Checkmarks are never green; only a progress
   track's done steps are.
5. **Depth from surfaces, one hairline.** Surfaces step from `bg-1` to `bg-4`; the only edge is the 1px `bg-3`
   hairline (`border-border`). No drop shadows, no glow, no blur on surfaces. The shadow tokens are hairline rings
   and the control recipes (the primary and destructive buttons' edge and highlight, the switch knob), nothing else.
6. **Concentric corners.** Corners come from the radius tokens, and a nested corner equals its parent's minus the
   padding between them. Never a free number.
7. **Fill or border for controls, both for panels.** A field is filled (`bg-input`) and has no border. A card has a
   surface and a hairline.
8. **Two weights, and state never changes width.** Text is 400 or medium (450). An active label keeps its 400 weight
   and gains a 0.011em stroke (`faux-medium`), so nothing beside it shifts.
9. **State is instant; only movement eases.** Hover, press, selection, text and icon colour change in the frame they
   happen. Only things that move (a sliding highlight, a tab pill, a popup, a sheet, a turning chevron) ease. Every
   `hover:` has the same `active:` twin.
10. **No focus states.** No ring, outline, border recolour or wash marks keyboard focus. The keyboard still reaches
    everything (see Accessibility).
11. **Icons are Central, at three sizes, in a solid ink.** 14, 16 or 20px. An icon draws in an ink one step quieter
    than its text, never an opacity, never brighter than its text. The current tab or nav item shows its filled
    twin.
12. **A tooltip adds what the screen doesn't show, or it goes.** Every tooltip waits 600ms. None repeats its
    control's label.
13. **Acting never moves you.** An action changes the thing in place; nothing jumps to another page, and a view in
    place beats a dialog. In normal use there is no loading state: data is prefetched, and a wait that could not be
    foreseen stays blank for 300ms before it shows anything. A render error stays inside the part that failed.
14. **One keyboard shortcut.** ⌘K opens the command menu everywhere. Only three workspaces bind keys of their own,
    and only while open: the Code tab (⌘P, ⇧⌘F, ⌘F, ⌘G), the Review tab (J, K) and the Terminal page (⌘T, ⌘W);
    the image viewer takes Esc, ←, →, `+`, `-` and `0` while it is open, and the Mac app's menu has its own
    (⌘, ⌘R ⌘[ ⌘] ⇧⌘H). Invent no others.
15. **Every collapsible remembers.** Open or folded, it comes back as you left it.
16. **Each string has one job.** Sentence case, a full sentence, plain words, no exclamation marks, no em dashes, no
    selling. A button is a verb and its object.
17. **Both themes ship, each tuned.** Every token that differs by theme is defined in both; check light and dark.
18. **Accessibility is part of the look.** Body text clears 4.5:1, icon-only controls are named, motion stops under
    reduced motion, and nothing relies on colour alone.

### The values you need on every screen

The full tables are generated in Tokens; these are the ones nearly every component reads. L is OKLCH lightness at
near-zero chroma on one cool hue.

**Type.** ABC Areal for everything, ABC Areal Mono for code only; `letter-spacing: -0.02em` on everything; upright
only, no eyebrows.

| Utility | Size / line | Role |
| --- | --- | --- |
| `text-2xs` | 12px / 15px | Meta, counts, badges, section labels, tooltips, code, paths |
| `text-xs` | 13px / 15.6px | The body size: rows, buttons, inputs, tabs, card titles, descriptions, prose |
| `text-sm` | 14px / 17.5px | Dialog, sheet and empty-state titles, the `lg` button |
| `text-base` | 16px on a 20px line | The page title (`PageHeading`) only |
| `font-normal` 400 · `font-medium` 450 · `font-semibold` 550 | | 400 body; 450 titles, buttons, labels, rows in menus; 550 only `strong` in prose |

**Text and surfaces.**

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `fg-4` | L 0.21 | L 0.946 | Titles, values, typed text, a hovered or current row |
| `fg-3` | L 0.443 | L 0.787 | Body (the default), menu and nav rows at rest |
| `fg-2` | L 0.543 | L 0.655 | Descriptions, meta, hints, placeholders, section labels |
| `fg-1` | L 0.764 | L 0.54 | Never text: dividers, disabled glyphs and disabled field text |
| `background` | white | L 0.174 | The page; dialogs and sheets |
| `bg-1` (`card`) | white | L 0.197 | Cards |
| `bg-2` (`input`) | L 0.973 | L 0.228 | Field fills, code and image insets, the tab track, dark popovers |
| `bg-3` (`border`) | L 0.955 | L 0.257 | The one hairline; field hover; fields inside a dark popover |
| `bg-4` | L 0.928 | L 0.299 | The most recessed step |
| `bg-a1` / `bg-a2` | black 2.7% / 4.7% | white 3.9% / 7.1% | Bands, notes, shelves / the sliding highlight, chips, a row's hover |
| `primary` | `oklch(0.6 0.215 256)` | `oklch(0.62 0.2 256)` | The one accent; its text is `primary-text` |

An icon draws in `icon-N` beside `fg-N` (one step quieter, set for it by the text colour) and in the tone itself
beside a tone. Hover moves text one step up to `fg-4`. Tones mean a status and nothing else: blue (needs your
answer, working), purple (plan to approve), amber (changes to review), green (ready to merge), orange (paused, sign
in needed), red (errors, destructive), neutral (waiting, unknown). A toned box takes its tone's `-a2` fill and
`-a3` edge, never the grey hairline.

**Shape.**

| Token | px | On |
| --- | --- | --- |
| `rounded-control-sm` | 6 | `xs` and `sm` controls (22, 24) |
| `rounded-control` | 7 | `default` and `lg` controls (26, 30), inputs, list rows, tooltips |
| `rounded-item` | 6 | A row inside a popup, and its sliding highlight |
| `rounded-popup` | 10 | Menus, selects, popovers, ⌘K, toasts |
| `rounded-segment` | 5 | A tab inside a track |
| `rounded-lg` / `rounded-xl` / `rounded-3xl` | 7 / 9 / 15 | Insets / cards and dialogs / sheets |

Controls and surfaces add `corner-superellipse/1.125`. A card is `CARD` (`corner-superellipse/1.125 rounded-xl
border border-border bg-card`, 12px inset, a list card `p-1`); anything nested in it is `INSET`
(`corner-superellipse/1.125 rounded-lg border border-border` plus its fill).

**Size.** The control ramp is 22 / 24 / 26 / 30 (`xs`, `sm`, `default`, `lg`); menu rows, section labels and `sm`
fields are 24, `Input` and `SelectTrigger` 26, one-line list and nav rows 28, card header bands 36, settings rows
and the ⌘K input 40. Primitives own their heights: never `h-*` on a control. Every control in one row shares one
height.

**Spacing.** Tailwind's 4px base, a closed scale where each step means one thing: `gap-px` title over its
description (always) and adjacent icon buttons; `gap-1` popup list padding and icon to label in small controls;
`gap-1.25` from a 20px icon slot to its text (8px from glyph to text); `gap-1.5` icon to label in default
controls; `gap-2` icon to label in rows and controls in one set; `p-2.5` popover padding; `p-3` card inset;
`p-4` dialog padding; `gap-6` section to section. The parent owns spacing, never a child's margin.

**Icons.** `size='sm'` 14px (12 to 13px text, rows, 22/24 controls, every button, the default), `'md'` 16px (14px+ text,
`lg` and `icon` buttons, 26/30 inputs and selects), `'lg'` 20px (empty states, full-page waits). Inside a primitive pass nothing.

**Motion and timing.** State 0ms. Movement 200ms on `cubic-bezier(0.22, 1, 0.36, 1)`. Menus and popovers 200ms,
tooltips 150ms, dialogs 150ms in and 100ms out (`DIALOG_MOTION`), ⌘K 75ms (`COMMAND_MOTION`). Every tooltip opens
after `TOOLTIP_DELAY` (600ms). A wait shows nothing for `LOADING_DELAY_MS` (300ms). Never `transition-all`, never
`ease-in`.

**Layout.** The page column is `PAGE_COLUMN` (`mx-auto w-full max-w-3xl px-6`, top `pt-6`). Dialogs are 420px
(`sm` 320px, ⌘K 520px), never sized by their content. A popover is `w-64`, a grouped popover list
`COMPACT_POPOVER` (320px). Check every surface at about 900px and at 1280px.

### Copy in one screen

The long form is Content and copy; these are the rules that catch most mistakes.

- **One job per string, in a full sentence, then stop.** A stage reason says what is happening now, a decision's
  title what is being decided, a toast what just happened, an error what went wrong and what to do.
- **Sentence case everywhere**, proper nouns as their owners write them (GitHub, macOS), acronyms upper (CI, PR,
  ID, URL). Shinsa's own words are ordinary words: task, plan, round, phase, decision, pull request.
- **A button is the verb and its object**: "Approve changes", "Remove project", "Run in terminal". Never "Submit",
  "OK", "Yes", "Confirm". A confirm dialog's button repeats verb and object; its cancel reads "Keep it".
- **You** for the human; agents speak as themselves in the first person. Calm and factual: no "!", no "magic", no
  selling words, no apology theatre.
- **Characters:** `’` and `“ ”` in every string a person reads, `…` as one character, `·` between facts, `−` in a
  diff count, `→` for a change or a path. No em dash in any UI string: use a colon, a comma or a second sentence.
- **Numbers agree with their nouns** ("1 task is", "2 tasks are"); "N of M" for progress; every changing number
  `tabular-nums`. Failures read "Couldn’t {verb} {object}". A disabled control always says why. An action that
  asks for more ends in "…".
- **Say** task, plan, request, kind of task, suggested task, delegation, diagnosis, findings (the reviewer's only),
  judgement calls, check-in, pull request; **never** job, spec, intent, shape, gate, PR in prose, delegated task.
- **Agents speak as themselves** ("I found…", never "Shinsa found…"), and the hand-over is the reply: nothing after
  it, never "My answer is above". Prompts are imperative, one instruction per sentence, tools in backticks, limits as
  numbers; a prompt calls the person "the human".

### Hand-overs and review in one screen

The long form is Content and copy → Hand-overs, evidence and review findings, and Pre-ship checklist → How to review
a UI change.

- **Work is handed over only through the tools** (`propose_plan`, `complete_phase`, `complete_fix`,
  `report_review`, `attach_evidence`, `answer`, `report_diagnosis`, `submit_report`, `report_outcome`,
  `reshape_task`), within their limits: 2 to 8 plan phases, 8 spots and 5 judgement calls a phase, 10 manual test
  steps, 12 findings (title 80, message 280, fix 600 characters).
- **A spot's `why` says what could go wrong, never what the code does.** A judgement call is titled by the decision
  ("Poll instead of webhooks"). A change with structure or flow carries a text diagram, at most 72 columns.
- **A test step's `expect` tells pass from fail**: never "it works". A merge step is an instruction with the exact
  command and never a secret's value.
- **A command the human runs is fenced ```` ```bash run ````** (Run in terminal); any other fence is an example.
  Code is linked as `[file.ts](shinsa://file/src/file.ts#L12-L20)`.
- **Evidence before review**: each changed view as one before and after `comparison`, at 1280px and the narrow
  width, light and dark; a recording of 5 to 20 seconds for behaviour; the focused test as `test`, linked to its check (never its output pasted). Before shots
  first; the console read on every page; never claim what was not seen working.
- **A review proves every blocking finding** (`file:line`, what breaks, how it was seen), runs what CI runs, judges
  earlier comments as valid, stale or a nitpick, leads with the verdict, and says nothing about what is fine. Taste
  is optional; UI work without evidence is blocking.

### The checklist

Run through this before calling any UI done. Each line is a rule from this file; the linter catches the ones marked
(lint), and you catch the rest. The full checklist per component is Pre-ship checklist.

**Pieces**

- [ ] Every repeated shape is the shared component or constant: `Button`, `Badge`, `CARD`, `INSET`, `ListRow`,
      `SectionLabel`, `PageHeading`, `Toolbar`, `Hint`, `TimeAgo`/`Duration`, `CheckMark`, `StatusTile`,
      `OptionsTrigger` (every `•••`), `SelectField`, `Choice`, `ChoiceButtons`, `CopyButton`, `InfoPopover`,
      `ConfirmDialog`, `ChecklistBlock` and `ItemChecklist` (every list of things to do), `CheckOutcomeIcon`, and the
      link chips `TaskLink`, `PrLink`, `RepoChip`, `BranchChip`, `FileLink`. Nothing rebuilt by hand (lint for cards
      and insets).
- [ ] No component copied and changed for one screen; change the shared one or pass different props.
- [ ] Every row of tabs is the kit's `Tabs` (or `Choice` for a labelled switch) (lint).
- [ ] Every list you pick from (menu, select, command, rail, queue, option list) shares one sliding highlight
      (`HighlightList` or `HoverHighlight`) (lint).
- [ ] A popover list grouped in sections is `CompactSections` and `CompactSection` in `COMPACT_POPOVER`, never a
      look-alike; a section header's fold chevron sits right after its text and count, never at the end.
- [ ] A field is the kit's `Input`, `Textarea` or `SelectTrigger` on `bg-input`, never given a border or a fill of
      its own. Inside a popover a list of boxes is `Checkbox variant='outline'`; a quiet action in a row that washes
      on its own is `Button variant='bare'`; adjacent icon buttons sit 1px apart (`gap-px`).

**Type and colour**

- [ ] Every text has a type role; no `text-[Npx]` (lint), no weight but normal and medium in practice (lint rejects
      all but normal, `font-medium`, `font-semibold`).
- [ ] Body text is `text-xs` (13px); `text-2xs` (12px) only for meta lines, badges and counts.
- [ ] A state change never changes weight: `data-[active=true]:faux-medium`.
- [ ] Colours are tokens: text `fg-1`…`fg-4` (`fg-1` never carries readable text, only decorative marks and
      disabled text), surfaces `bg-1`…`bg-4`, washes `bg-a1`…`bg-a4`, tones only for state.
- [ ] One accent: primary blue for the primary button, links, selection, checked controls, checkmarks
      (`CheckMark`, `CHECK_TEXT`). No green checkmark (lint).
- [ ] A tinted fill takes its tone's edge (`border-‹tone›-a3`), never the grey hairline (lint).

**Shape and depth**

- [ ] Heights come from the control ramp (22 / 24 / 26 / 30); no `h-*` written on a primitive.
- [ ] Spacing from the closed scale; no `gap-0.5` (lint) outside a section header's buttons (`SectionLabel`).
- [ ] Corners from the radius tokens, nested corners concentric; no `rounded-[…]` (lint, in the kit too).
- [ ] No Tailwind shadow, raw `shadow-[…]` or `ring-[…]` (lint); depth from surface steps, the hairline and the
      shadow tokens (`shadow-1`…`shadow-4`, `shadow-control*`).
- [ ] Fill or border for controls, both for panels. A field is `bg-input`, never bordered.
- [ ] No focus state: no `focus:`, `focus-visible:`, `focus-within:` or `ring-offset-*` (lint, in the kit too).

**Icons**

- [ ] Central icons through `Icon` only; no hand-drawn `<svg>` (lint); the name exists in the icon list, and the
      generator ran after a new name was used.
- [ ] Size `sm` 14 / `md` 16 / `lg` 20 through the `size` prop, or nothing inside a primitive; never `size-*`,
      `w-*`, `h-*` on an icon (lint). A glyph that draws small in Central's box is matched in `MATCHED_SCALE`, never
      sized at the call site.
- [ ] Ink a step under its text through the text colour; never an opacity other than a reveal (`opacity-0` →
      `opacity-100`), never brighter than its text, never `[&_svg]:` or `[--icon-color:…]` (lint).
- [ ] Every icon in one row has the same size and ink, chevrons and spinners included.
- [ ] The current tab or nav item shows the `…Filled` twin (`NavItem` and `NavButton` take `activeIcon`);
      everything else the outline, a state glyph anywhere but the tab in front included.
- [ ] Icon-only buttons have an `aria-label`, and a tooltip only when the glyph doesn't say it.

**Behaviour**

- [ ] Every `hover:` has the same `active:` on the same line, with the same value (lint checks only that one is
      there); no colour transition on hover, press or highlight (lint).
- [ ] Only movement eases; no `transition-all`.
- [ ] Every tooltip adds information the screen doesn't show (none on a `•••` trigger, a `+N −N` count or a
      self-evident number), opens after the one 600ms delay with no `delay` of its own (lint), doesn't repeat its
      trigger (lint), wraps only inline or `w-fit` content (lint), and goes through `Hint`, `TimeAgo`/`Duration`,
      `Truncate` or `useTooltipTrigger`, served by the page's one `TooltipProvider`.
- [ ] Every time renders through `TimeAgo` or `Duration` (lint).
- [ ] No keyboard shortcut but ⌘K and a workspace's own while it is open (lint).
- [ ] Acting never moves the person; no dialog where a view in place will do: a popover turns to its next view, a
      removal asks in its own footer. A list popover is as tall as its content and scrolls past the room it has; a
      view that loads or grows in place keeps one height. A dialog still needed is the kit's `Dialog` or
      `AlertDialog` as it is.
- [ ] No loading state in normal use: render and read ahead; an unforeseen wait stays blank for 300ms first.
- [ ] Every collapsible persists its state (`persistId`, the shared disclosure store) (lint).
- [ ] Content a person would copy is `selectable`; everything else is chrome. No `select-text`, `cursor-text` or
      `user-select` by hand (lint).
- [ ] A render error is caught where it happened, not by the page.
- [ ] Reduced motion: nothing moves but a spinner and dialog fades.

**Copy**

- [ ] Sentence case; a full sentence; one job per string.
- [ ] Buttons are verb + object; a destructive confirm repeats the verb and object, and its cancel reads "Keep it".
- [ ] No em dashes, no exclamation marks, no selling words, no playful labels.
- [ ] `…` as one character, curly quotes, numbers agree with their nouns.
- [ ] Failures read "Couldn’t {verb} {object}".

**Look at it**

- [ ] On the `/ui` catalog and in the app, in light and dark.
- [ ] At about 900px and at 1280px.
- [ ] Next to the existing screens: same row heights, same left edge, same gaps.
- [ ] With the browser console open: no error you introduced.
- [ ] Handed over in Shinsa: proven with evidence, a before and after comparison of each view you changed (see
      Hand-overs, evidence and review findings).

**Ship it**

- [ ] What CI runs passes: `bunx biome ci .`, `bun lint:conventions`, `bun lint:spelling`, `bunx knip`,
      `bun check-types`, `bun run test` (100% line and function coverage).
- [ ] This file and the `/ui` catalog changed in the same change as the code.

The rest of this file, section by section:

<!-- design:toc -->

## 0. The stack

Shinsa's interface is React 19 on Tailwind CSS v4, with these libraries under the kit. Every class in this file is
a Tailwind v4 utility, a custom utility defined in the Tokens section, or an arbitrary value written out in full.

| Library | Version | What the kit uses it for |
| --- | --- | --- |
| `react`, `react-dom` | ^19.2.8 | Everything |
| `tailwindcss`, `@tailwindcss/vite` | ^4.3.3 | Utilities, the theme (`@theme`), custom utilities (`@utility`) and variants (`@custom-variant`) |
| `@base-ui/react` | ^1.4.0 | The headless primitives: dialog, alert dialog, popover, preview card, menu, context menu, select, tabs, tooltip, checkbox, switch, scroll area, separator, field |
| `cmdk` | 1.1.1 | The command menu's filtering and keyboard model |
| `sonner` | ^2.0.7 | Toasts |
| `motion` | ^12.43.0 | `SizeAnimator`, `ShimmeringText` and reduced-motion reads |
| `class-variance-authority` | ^0.7.1 | Variant tables (`buttonVariants`, `badgeVariants`) |
| `clsx`, `tailwind-merge` | ^2.1.1, ^3.5.0 | `cn()` |
| `tw-animate-css` | ^1.4.0 | `animate-in`, `animate-out`, `fade-*`, `zoom-*`, `slide-in-from-*` |
| `shadcn` (its `tailwind.css` only) | ^4.2.0 | The `data-open`, `data-closed`, `data-checked`… variants |
| Central Icons (`@central-icons-react/all`) | ^1.1.303 | The only icon set, pre-rendered into SVG paths at build time |

### 0.1 The stylesheet

The kit's stylesheet is reproduced verbatim in Appendix A; the web app's own stylesheets are in Appendix B. Load
them in that order, Appendix A first. Appendix A begins with three imports:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
```

and its `@source` lines point at the kit's own folders; point yours at the folders that hold your components.

`shadcn/tailwind.css` contributes the state variants every component relies on. They match both Base UI's and
Radix's attributes:

```css
@custom-variant data-open {
  &:where([data-state="open"]),
  &:where([data-open]:not([data-open="false"])) {
    @slot;
  }
}
@custom-variant data-closed {
  &:where([data-state="closed"]),
  &:where([data-closed]:not([data-closed="false"])) {
    @slot;
  }
}
@custom-variant data-checked {
  &:where([data-state="checked"]),
  &:where([data-checked]:not([data-checked="false"])) {
    @slot;
  }
}
@custom-variant data-unchecked {
  &:where([data-state="unchecked"]),
  &:where([data-unchecked]:not([data-unchecked="false"])) {
    @slot;
  }
}
@custom-variant data-selected {
  &:where([data-selected="true"]) {
    @slot;
  }
}
@custom-variant data-disabled {
  &:where([data-disabled="true"]),
  &:where([data-disabled]:not([data-disabled="false"])) {
    @slot;
  }
}
@custom-variant data-active {
  &:where([data-state="active"]),
  &:where([data-active]:not([data-active="false"])) {
    @slot;
  }
}
@custom-variant data-horizontal {
  &:where([data-orientation="horizontal"]) {
    @slot;
  }
}
@custom-variant data-vertical {
  &:where([data-orientation="vertical"]) {
    @slot;
  }
}
```

`tw-animate-css` supplies the entry and exit animations. `animate-in` runs the `enter` keyframes and `animate-out`
the `exit` keyframes, for `var(--tw-duration, 150ms)` on `var(--tw-ease, ease)`, so a `duration-200` or an
`ease-out` class on the same element changes their timing. The keyframes animate from (`enter`) or to (`exit`) an opacity,
scale and translate that these classes set: `fade-in-0` / `fade-out-0` (opacity 0), `zoom-in-95` / `zoom-out-95`
(scale 0.95), `slide-in-from-top-2` (translate-y −0.5rem), `slide-in-from-bottom-2` (+0.5rem),
`slide-in-from-left-2` (translate-x −0.5rem), `slide-in-from-right-2` (+0.5rem). A class without a number uses the
full size (`slide-in-from-bottom` is 100%).

### 0.2 The document

```html
<html lang="en" class="font-sans antialiased">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <script>
      document.documentElement.classList.add(
        matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      );
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

The inline script sets the theme class before the first paint, so the page never flashes the wrong theme. After that
the app owns the class: the theme preference is `system`, `light` or `dark` (Settings → Appearance; labels "System",
"Light", "Dark", icons `IconWindow`, `IconSun`, `IconMoon`), kept in `localStorage` under `shinsa.theme`.
`system` follows `(prefers-color-scheme: dark)` live. Applying a theme toggles `dark` and `light` on `<html>`
together, never one without the other.

The body takes its defaults from Appendix A: `background-color: var(--color-background)`, `color: var(--fg-3)`,
`--icon-color: var(--icon-3)`, `font-family: var(--font-sans)`, `letter-spacing: -0.02em`, `user-select: none` and
`cursor: default`. Text is `fg-3` until a role steps it up.

### 0.3 `cn()`

Every component merges its classes with `cn()`. `tailwind-merge` knows only Tailwind's stock scales, so it is
extended with the kit's own radius, shadow and leading names; without this a caller's `rounded-popup` would not
replace a component's `rounded-control`, and whichever came later in the stylesheet would win.

```ts
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'control-sm', 'item', 'popup', 'segment'],
      shadow: [
        '1', '2', '3', '4',
        'control', 'control-destructive', 'control-elevated', 'control-elevated-hover', 'control-knob', 'control-dot',
      ],
      leading: ['tighter'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 0.4 Fonts

The typeface is ABC Areal (variable, weights 400 to 700) for everything and ABC Areal Mono (variable) for code, both
from Dinamo. They are licensed and do not ship with this file. Until they load, and without them, text is set in
"ABC Areal Fallback" (Arial) and "ABC Areal Mono Fallback" (Menlo), system fonts scaled and given Areal's vertical
metrics so lines break and stand where Areal's will; past those the stacks fall back to
`ui-sans-serif, system-ui, sans-serif` and `ui-monospace, "SF Mono", Menlo, monospace`. The layout holds, but the
result is not pixel-identical. Areal's weights are tuned: medium sits at 450, semibold at 550, bold at 600 (see
Typography). Box-drawing characters and geometric shapes (U+2500 to U+257F, U+25A0 to U+25FF) come from Menlo at a
`size-adjust` of 101.38%, so text diagrams keep one cell per column.

## 1. Principles

The eighteen principles open this file, in Read this first → The principles, so that an agent with room for only
the first pages still has them. Every section below applies them; decide a case none of them covers by them.

## 2. Tokens

Every custom property the kit declares, generated from its stylesheet (Appendix A). Light is `:root`; dark is
`.dark`. An alias (`var(--…)` or `color-mix(…)`) resolves where it is used, in that element's theme. The Tailwind
names below are how you reach a token in a class: `--color-bg-2` is `bg-bg-2`, `text-bg-2` and `border-bg-2`;
`--radius-control` is `rounded-control`; `--shadow-1` is `shadow-1`; `--text-xs` is `text-xs`.

<!-- design:tokens -->

<!-- design:theme -->

### The effective scales

What each Tailwind scale resolves to with Shinsa's theme over Tailwind's defaults. "Tailwind" rows are Tailwind
v4.3's own values, unchanged; use them only where a rule below allows it.

<!-- design:scales -->

<!-- design:utilities -->

## 3. Typography

Shinsa is a dense, native-feeling app. Almost all text is 13px or 12px; the larger sizes exist but are rare. Hierarchy comes from colour steps (`fg-1` to `fg-4`) and one medium weight, not from size.

### Font families

| Role | Family stack (`--font-sans` / `--font-mono`) | Utility |
| --- | --- | --- |
| Everything: headings, body, labels, buttons, data, ids, numbers, dates | `"ABC Areal", "ABC Areal Fallback", ui-sans-serif, system-ui, sans-serif` | default (`font-sans`) |
| Code only: code blocks, inline code, commands, paths shown as code, terminal, editor, diffs | `"ABC Areal Mono", "ABC Areal Mono Fallback", ui-monospace, "SF Mono", Menlo, monospace` | `font-mono` |

Both are variable fonts with a weight axis from 400 to 700, licensed from Dinamo. The `@font-face` rules declare `100 900`, so a weight outside the axis is clamped to 400 or 700 rather than faked. ABC Areal Mono has no box-drawing glyphs and draws its triangles two cells wide, so the mono family takes the box-drawing (U+2500 to 257F) and geometric-shape (U+25A0 to 25FF) blocks from Menlo (or DejaVu Sans Mono, which shares its metrics), scaled from Menlo's 0.602em advance to Areal Mono's 0.61em cell. A text diagram therefore keeps every column one cell wide.

Each family's second entry is a metric-matched fallback: a local system font (Arial, or Liberation Sans and Arimo, which share its widths; Menlo, DejaVu Sans Mono or Courier New) with `size-adjust` set so its average advance equals Areal's (Capsize's English letter weighting) and `ascent-override`, `descent-override` and `line-gap-override` set to Areal's own 878, 210 and 0 per 1000 (hhea and OS/2 agree, and the fonts set USE_TYPO_METRICS). Text drawn in it before Areal arrives breaks into the same lines at the same heights, so nothing moves when Areal swaps in. Its `unicode-range` lists only characters Areal has, so once Areal loads the fallback draws nothing, and a character Areal lacks still falls through to the rest of the stack. The marketing site preloads `ABCArealVariable.woff2`; the mono file is not used above the fold there.

```css
@font-face {
  font-family: "ABC Areal";
  src: url("./fonts/ABCArealVariable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "ABC Areal Mono";
  src: url("./fonts/ABCArealMonoVariable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
/* Box drawing and triangles for text diagrams come from Menlo, scaled to the Areal Mono cell. */
@font-face {
  font-family: "ABC Areal Mono";
  src: local("Menlo"), local("Menlo-Regular"), local("DejaVu Sans Mono"), local("DejaVuSansMono");
  unicode-range: U+2500-257F, U+25A0-25FF;
  size-adjust: 101.38%;
  font-weight: 100 900;
  font-style: normal;
}
/* Metric-matched fallbacks: a system font scaled to Areal's average advance, with Areal's vertical metrics. */
@font-face {
  font-family: "ABC Areal Fallback";
  src: local("Arial"), local("ArialMT"), local("Liberation Sans"), local("LiberationSans-Regular"), local("Arimo");
  unicode-range: U+20-7E, U+A0-AB, U+AE-B4, U+B6-137, U+139-148, U+14A-17E, U+2013-2014, U+2018-201A, U+201C-201E,
    U+2020-2022, U+2026, U+2030, U+2039-203A, U+20AC, U+2122, U+2190-2193, U+2212;
  size-adjust: 100.49%;
  ascent-override: 87.37%;
  descent-override: 20.9%;
  line-gap-override: 0%;
}
@font-face {
  font-family: "ABC Areal Mono Fallback";
  src: local("Menlo"), local("Menlo-Regular"), local("DejaVu Sans Mono"), local("DejaVuSansMono"),
    local("Courier New"), local("CourierNewPSMT");
  unicode-range: U+20-7E, U+A0-AB, U+AE-B4, U+B6-137, U+139-148, U+14A-17E, U+2013-2014, U+2018-201A, U+201C-201E,
    U+2020-2022, U+2026, U+2030, U+2039-203A, U+20AC, U+2122, U+2190-2193, U+2212;
  size-adjust: 101.32%;
  ascent-override: 86.66%;
  descent-override: 20.73%;
  line-gap-override: 0%;
}
```

Rules:

- Mono is for code, never for data. Ids, task keys ("SW-142"), counts, times and figures are ABC Areal; numbers that must line up or hold still take `tabular-nums`.
- Upright only. No italic anywhere in product UI.
- No eyebrows: no mono, uppercase or accent-coloured kicker above a heading.

### Base text

Set once on `html` and `body`; everything inherits it.

```css
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  -webkit-tap-highlight-color: transparent;
}
body {
  background-color: var(--color-background);
  color: var(--fg-3);          /* body copy is fg-3; headings and emphasis step up to fg-4 explicitly */
  --icon-color: var(--icon-3); /* the icon ink that pairs with fg-3 */
  font-family: var(--font-sans);
  letter-spacing: -0.02em;     /* every text, every size */
}
```

`body` sets no font size, so an element with no size class is 16px; in practice every text in the app carries a size class or inherits one from its primitive (most primitives set `text-xs`).

### Size scale

Shinsa redefines the bottom of Tailwind's scale and tightens the leading of the sizes it uses. The values below are the rendered ones.

| Utility | Size | Line height | Line box | Where |
| --- | --- | --- | --- | --- |
| `text-2xs` | 0.75rem, 12px | 1.25 | 15px | Meta lines, badges, counts, section labels, tooltips, code, paths, timestamps, the second line of a row. Never for anything a person must read to decide. |
| `text-xs` | 0.8125rem, 13px | 1.2 | 15.6px | The body size: buttons, inputs, menu rows, tabs, row titles, card titles, descriptions, prose |
| `text-sm` | 0.875rem, 14px | 1.25 | 17.5px | Dialog and sheet titles, the `lg` button, a fieldset legend, the empty-state title, a few emphasised titles (the now card, a task popover title) |
| `text-base` | 1rem, 16px | 1.35 | 21.6px | The page title (`PageHeading`, on a 20px `leading-tight` line) |
| `text-lg` | 1.125rem, 18px | 1.5556 (Tailwind default) | 28px | Only the `/ui` catalog's section headings |
| `text-xl` | 1.25rem, 20px | 1.4 (Tailwind default) | 28px | Catalog specimen only |
| `text-2xl` | 1.5rem, 24px | 1.3333 (Tailwind default) | 32px | Catalog page title only |

```css
@theme inline {
  --text-2xs: 0.75rem;
  --text-2xs--line-height: 1.25;
  --text-xs: 0.8125rem;
  --text-xs--line-height: 1.2;
  --text-sm--line-height: 1.25;
  --text-base--line-height: 1.35;
  --tracking-tight: -0.0175em;
  --leading-tighter: 1.15;
}
```

Leading and tracking utilities in use:

| Utility | Value | Use |
| --- | --- | --- |
| `leading-tighter` | 1.15 | Titles: `CardTitle`, `DialogTitle`, `AlertDialogTitle`, `EmptyState` title, `Field` label and legend, the now-card title |
| `leading-tight` | 1.25 (Tailwind default) | The page title, so 16px sits on a 20px line |
| `leading-4` | 16px | Menu, select and command rows (so a `py-1` row is exactly 24px; 1.2 would give 23.6px rows with fractional edges), `SectionLabel`, a stacked second line |
| `leading-5` | 20px | A row's trailing meta (`text-2xs tabular-nums leading-5`) |
| `leading-relaxed` | 1.625 | Code fences, Home's guide copy |
| `leading-3.5` | 14px | A text diagram inside a code fence (`data-diagram`) |
| `leading-normal` | 1.5 | A shimmering live line (`SHIMMER_LINE`) |
| `leading-none` | 1 | `ShimmeringText`'s inline box |
| `leading-[1.35]` | 1.35 | Tooltip text (kit-internal) |
| `tracking-tight` | -0.0175em | Large titles (catalog only) |
| `tracking-widest` | 0.1em | A menu item's shortcut (`DropdownMenuShortcut`) |

No `text-[Npx]` anywhere in the app (lint fails). A text that needs another size is a missing type role, not a one-off.

### Weights

ABC Areal is variable; Shinsa maps the weight utilities to its own stops:

| Utility | Weight | Use |
| --- | --- | --- |
| `font-normal` | 400 | Body, descriptions, meta, values, row titles, nav rows, underline tabs at rest |
| `font-medium` | 450 | Headings and titles, buttons, labels, menu and select rows, tabs, badges, `Kbd`, group labels, section labels |
| `font-semibold` | 550 | Inline emphasis only (`strong` in prose) |
| `font-bold` | 600 | Defined but banned in the app (lint fails); the ceiling |

```css
@theme inline {
  --font-weight-normal: 400;
  --font-weight-medium: 450;
  --font-weight-semibold: 550;
  --font-weight-bold: 600;
}
```

- `font-thin`, `font-extralight`, `font-light`, `font-bold`, `font-extrabold`, `font-black` and `font-[…]` fail the lint in the app. Only `font-normal`, `font-medium` and `font-semibold` are allowed.
- More emphasis means a stronger colour step (`fg-3` to `fg-4`), never a heavier weight.
- **A weight change on state never moves layout.** A label that reads medium when it becomes active keeps 400 and takes `faux-medium` under the state variant, e.g. `data-[active=true]:faux-medium` or the kit tabs' `data-active:faux-medium`. Never toggle `font-medium` on state.

`faux-medium` is a hairline text stroke in the text's own colour. Stroke is paint-only, so the advance width is identical in both states and no neighbour shifts. Never a text-shadow: a shadow repaints a second anti-aliased copy and reads 5 to 8% heavier than the real weight. The stroke inherits, so it can go on the row. Override the stroke with `--faux-medium-stroke` if the medium weight is recalibrated.

```css
@utility faux-medium {
  -webkit-text-stroke: var(--faux-medium-stroke, 0.011em) currentColor;
}
```

The underline tab list is the canonical user: its tabs are `font-normal` and the selected one is `faux-medium`. (The task page's header uses `Choice`, the segmented track, whose tabs are `font-medium` in every state and change only their ink from `fg-2` to `fg-4`.) Nav rows in the rail do not use it: the current row only steps its colour from `fg-3` to `fg-4`.

### Type roles

Every text in the app has a role. Size, weight, colour and line come from the role; a call site never picks them freely. The owner is the API that renders it.

| Role | Size / line | Weight | Colour | Owner |
| --- | --- | --- | --- | --- |
| Page title | `text-base` on a 20px line (`leading-tight`), `text-balance` | 450 | `fg-4` | `PageHeading` (`PAGE_TITLE`), Home's greeting |
| Page description or count | `text-xs`, `max-w-2xl`, `text-pretty`, 1px under the title (`gap-px`) | 400 | `fg-2` | `PageHeading` (`PAGE_DESCRIPTION`) |
| Task page heading | `text-base` medium title over the request as `text-xs` `fg-2` (two lines at most, `gap-px`) | 450 / 400 | `fg-4` / `fg-2` | task page header |
| Canvas section label | `text-2xs` on a 16px line (`leading-4`), in a 24px row (`h-6`), the count in normal weight `tabular-nums` 6px after it | 450 (count 400) | `fg-2` | `SectionLabel` |
| Card header strip title | `text-xs` | 450 | `fg-4` | `CARD_HEADER` (`Panel`) |
| Card title | inherits the card's size (`text-xs`), `leading-tighter` | 450 | `fg-4` | `CardTitle` |
| Card description, body description | `text-xs`, `text-pretty` | 400 | `fg-2` | `CardDescription` |
| Dialog and alert dialog title | `text-sm`, `leading-tighter`, centred, `text-balance` | 450 | `fg-4` | `DialogTitle`, `AlertDialogTitle` |
| Sheet title | `text-sm` | 450 | `fg-4` | `SheetTitle` |
| Empty-state title | `text-sm` (`text-xs` at `size='sm'`), `leading-tighter`, `text-balance` | 450 | `fg-4` | `EmptyState` |
| Field label / fieldset legend | `text-xs` / `text-sm`, `leading-tighter`, 6px above the control (`mb-1.5`) | 450 | `fg-4` | `Field` (`data-variant=label` / `legend`) |
| Button label | `text-xs` (`lg`: `text-sm`) | 450 | variant's colour | `Button` |
| Field text | `text-xs`, placeholder `fg-2` at 400 | 400 | `fg-4` | `Input`, `Textarea`, the command input (450 typed text) |
| Menu, select, command row | `text-xs` on a 16px line | 450 | `fg-3`, `fg-4` while highlighted | `DropdownMenuItem`, `SelectItem`, `CommandItem` |
| Menu group label | `text-xs` | 450 | `fg-2` | `DropdownMenuLabel`, `SelectGroupLabel`, cmdk group heading |
| Menu shortcut | `text-xs`, `tracking-widest`, pushed right (`ml-auto`) | 450 | `fg-2` | `DropdownMenuShortcut` |
| Tab | `text-xs` | 450 (underline tabs: 400, `faux-medium` when selected) | `fg-2` at rest | `TabsTrigger` |
| List row title / meta | `text-xs` / `text-2xs`, stacked with `gap-px` | 400 | `fg-4` / `fg-2` | `ListRow` (`LIST_ROW_TITLE`, `LIST_ROW_META`) |
| Row trailing meta (a time, a count) | `text-2xs` `tabular-nums` on a 20px line | 400 | `fg-2` | `ListRow` `trailing` |
| Nav row (rail) | `text-xs` | 400 | `fg-3`; `fg-4` hovered or current | `NavItem` |
| Badge | `text-2xs` | 450 | variant's `-text` or `fg-2` | `Badge` |
| Keycap | `text-xs`, `font-sans` | 450 | `fg-2` | `Kbd` |
| Tooltip | `text-2xs` on a 1.35 line | 400 | `fg-4` | `TooltipPopup` |
| Info popover header | title over a `text-2xs` description, `gap-px` | 450 / 400 | `fg-4` / `fg-2` | `InfoHeader` |
| Inset note label | `text-2xs` | 450 | `fg-2` or the tone's `-text` | `InsetNote` |
| Path or file name | `text-2xs`, truncated | 400 | inherits (usually `fg-2`) | `FilePath`, `PathRow` |
| Code (fence) | mono `text-2xs`, `leading-relaxed`, `px-3.5 py-2.5` | 400 | `fg-4` | `CodeFence`, `CodeBlock` |
| Code (editor) | mono 12px (`var(--text-2xs)`) on an 18px line | 400 | `--code-*` | Code tab editor |
| Inline code in prose | mono 0.92em, `px-1`, `rounded-sm`, `bg-bg-a2` | 400 | `fg-4` | `.prose-shinsa code` |
| Chat agent text | 13px on a 1.625 line, paragraphs `margin: 1.25rem 0 0.75rem` | 400 | `fg-4` | `.prose-chat` (`Markdown` in the chat) |
| Other markdown | `text-xs` on a 1.45 line | 400 | `fg-3`, headings and `strong` `fg-4` | `.prose-shinsa` |

Rules:

- Nothing inside a card is larger than its card title, except a state title.
- The only sizes below 13px are `text-2xs` (12px) roles: meta, counts, badges, tooltips, code, section labels.
- A title over its description is always `gap-px`, with no exceptions (page headings, list rows, popover headers, findings, steps). A title beside its description on one line is `gap-1.5` (6px).
- A heading is `fg-4`; body text is `fg-3`; secondary text (descriptions, meta, hints, labels) is `fg-2`; `fg-1` is never text (Colour usage rules).

### Numerals

- `tabular-nums` only where digits must line up or hold still: counts beside a label, a row's trailing time, diff stats (`+12 −3`), usage percentages, task keys in a list, a live running clock. A figure alone in its cell stays proportional, since tabular digits pad a narrow "1" to the width of a "0".
- Digits, a space and a unit that agrees with the number in labels and prose ("3 days", "1 task"); compact forms in dense meta ("5m ago", "120ms").

### Wrapping and truncation

- Titles that wrap use `text-balance`; descriptions and paragraphs use `text-pretty`.
- A single clipped line is `Truncate`, never a bare `truncate` span: it ends with an ellipsis and, only when the text actually is cut, shows the full text in a tooltip. Its parent must bound its width (`min-w-0` on a flex child). `middle` cuts in the centre so both ends of an identifier or path stay readable. `lines={2}` or `lines={3}` clamps to two or three lines instead (`line-clamp-2 whitespace-normal`).
- `line-clamp-2` / `line-clamp-4` directly is used for multi-line previews that need no tooltip (a task title in a popover, the live card's latest text).
- "…" (one character) for truncation and in-progress labels ("Loading…"), never three dots.

### Prose

Two prose styles, both plain CSS in the app stylesheet. They set the icon ink next to every colour so an icon inside a heading or link draws in its pair.

```css
.prose-shinsa { font-size: var(--text-xs); line-height: 1.45; color: var(--fg-3); --icon-color: var(--icon-3); }
.prose-shinsa :where(h1, h2, h3, h4) {
  margin: 0.875rem 0 0.25rem; font-weight: var(--font-weight-medium); font-size: var(--text-xs);
  color: var(--fg-4); --icon-color: var(--icon-4);
}
.prose-shinsa :where(strong) { font-weight: var(--font-weight-semibold); color: var(--fg-4); --icon-color: var(--icon-4); }
.prose-shinsa :where(p, ul, ol, table, blockquote) { margin: 0.375rem 0; }
.prose-shinsa :where(ul, ol) { padding-left: 1rem; }
.prose-shinsa :where(ul) { list-style: disc; }
.prose-shinsa :where(ol) { list-style: decimal; }
.prose-shinsa :where(ul.contains-task-list) { padding-left: 0; list-style: none; }
.prose-shinsa :where(li)::marker { color: var(--fg-2); }
.prose-shinsa :where(code) {
  font-family: var(--font-mono); font-size: 0.92em; padding: 0 0.25rem; border-radius: var(--radius-sm);
  background: var(--bg-a2); color: var(--fg-4); --icon-color: var(--icon-4);
}
.prose-shinsa :where(pre code) { padding: 0; font-size: inherit; background: transparent; }
.prose-shinsa :where(a:not([data-smart])) {
  color: var(--primary-text); --icon-color: var(--primary-text);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklch, var(--primary-text) 40%, transparent);
  text-underline-offset: 2px;
}
.prose-shinsa :where(table) { width: 100%; border-collapse: collapse; }
.prose-shinsa :where(th, td) { padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); text-align: left; }
.prose-shinsa :where(th) { font-weight: var(--font-weight-medium); color: var(--fg-2); --icon-color: var(--icon-2); }
.prose-shinsa :where(blockquote) { padding-left: 0.625rem; border-left: 2px solid var(--bg-3); color: var(--fg-2); --icon-color: var(--icon-2); }
.prose-shinsa > :first-child { margin-top: 0; }
.prose-shinsa > :last-child { margin-bottom: 0; }

.prose-chat { line-height: 1.625; color: var(--fg-4); --icon-color: var(--icon-4); }
.prose-chat :where(p, table, blockquote) { margin: 1.25rem 0 0.75rem; }
.prose-chat :where(ul, ol) { margin: 1rem 0; }
.prose-chat :where(li + li) { margin-top: 0.25rem; }
.prose-chat :where(li > ul, li > ol) { margin: 0.25rem 0; }
.prose-chat :where(h1, h2, h3, h4, h5, h6) { margin: 1.25rem 0 0.75rem; line-height: 1.25; }
.prose-chat :where(h1) { font-size: 1.125rem; }
.prose-chat :where(h2) { font-size: 1rem; }
.prose-chat :where(h3, h4, h5, h6) { font-size: 0.875rem; }
.prose-chat :where(:not(pre) > code) { padding: 0.0625rem 0.25rem; }
.prose-chat > :first-child { margin-top: 0; }
.prose-chat > :last-child { margin-bottom: 0; }
```

`.prose-chat` is applied together with `.prose-shinsa` in the chat (it overrides colour, leading and margins; the 13px size comes from `.prose-shinsa`). Prose is content, so it is `selectable`; links marked `data-smart` are smart links styled by their own component.

### Custom utilities and variants

What each custom variant and utility is for. The CSS of every one the kit defines (the `dark`, `disabled` and `enabled` variants, every `@utility`, the registered properties and the keyframes) is listed verbatim in Tokens, under Custom variants, Custom utilities, Registered properties and Keyframes; this section shows only the rules those lists leave out.

The app adds one variant of its own, for the Mac app's window:

```css
@custom-variant desktop (&:where([data-desktop="window"] *));
```

`dark` is class-based (`.dark` on `<html>` or any region, such as a dark image viewer on a light page). `disabled` and `enabled` match both the native attribute and Base UI's `data-disabled`. The built-in `starting:` variant (`@starting-style`) is used for entry motion of elements that mount already open.

**Text colour sets the icon ink.** Every `text-*` colour utility also sets `--icon-color` (the `text-*` utility in Tokens → Custom utilities): a grey step resolves to its paired `icon-N` through the `--icon-ink-*` theme variables (Tokens → Theme variables: `fg-1` to `icon-1` … `fg-4`, `foreground`, `card-foreground` and `popover-foreground` to `icon-4`, `muted-foreground` to `icon-2`), any other colour to itself. The rule below makes `Icon` and `Spinner` draw in that ink, unlayered so it wins over a colour utility placed on the icon itself (which then changes the ink through the same utility).

```css
:where([data-slot="icon"], [data-slot="spinner"]) {
  color: var(--icon-color, currentColor);
}
```

**Medium without a shift:** `faux-medium` (above).

**Selection.** `::selection` reads an inherited variable, so a tinted surface re-colours selection for its whole subtree with one class: `selection-inverse` (white at 35%, `color-mix(in oklch, var(--primary-foreground) 35%, transparent)`) or `selection-<tone>` (the tone's `-a3`) for `purple`, `sky`, `blue`, `green`, `amber`, `orange`, `red`, `pink` and `yellow`.

```css
:root { --selection: var(--bg-a4); }
::selection { background-color: var(--selection); }
```

**Content opts into selection.** The desktop app (`html[data-desktop]`) is chrome by default (`body` is unselectable with the arrow cursor, base layer below; a browser, the web app and the site, keeps native selection); real content opts back in with the one class `selectable` (text selection and the text cursor), which a drag (`body[data-dragging]`) switches off again.

**Disclosure chevron turn.** `transition-disclosure` eases `rotate` and `transform` over 200ms on `cubic-bezier(0.22, 1, 0.36, 1)`, the movement clock (Motion).

**Muted file marks.** A row that is done with (a viewed file) puts `file-icons-muted` on itself, which sets `--file-icon-ink: currentColor`, so its language-tinted file marks draw in the row's own ink.

**Scrollbars.** No native scrollbar is ever drawn inside the page; scrolling inside a component is signalled by edge fades. `scrollbar-hide` hides one element's scrollbar; the rule below hides every one except the document's, which the kit leaves alone.

```css
*:not(html):not(body) { scrollbar-width: none; }
*:not(html):not(body)::-webkit-scrollbar { display: none; }
```

**Scroll edge fades.** `scroll-fade` is a mask, never a gradient overlay (an overlay would have to guess the surface behind it and would paint over a card's edge). Each axis is one mask layer, intersected. Where the browser has scroll timelines the scroll position drives the fade, so it is right on the first painted frame; otherwise `data-overflow-*` attributes set by the components switch each edge on, with a 150ms `ease` transition of the registered `--fade-t`, `--fade-b`, `--fade-l` and `--fade-r`. The fade size is 1.5rem (24px). `data-fade-orientation` picks `horizontal` or `both` instead of the default vertical axis. On a scroller, the mask goes on a still wrapper (`data-fade-scope`) with `scroll-fade-source` on the scroller inside, so the mask is painted once and content scrolls under it on the compositor; timeline names come from `--fade-timeline-y` / `--fade-timeline-x`, made unique per instance by the components.

`--row-tint` is registered (a `<color>` that inherits, initially `transparent`) so a sticky first cell that paints a row's hover wash from it animates with the row instead of jumping.

**Superellipse corners:** `corner-superellipse/1.125`, `/1.25`, `/1.5` and `/2` set `corner-shape: superellipse(N)` on the element and its `::before` and `::after` (Radius and shape).

**Base layer** (focus, cursors, selection, borders), reproduced because every primitive relies on it:

```css
@layer base {
  input[type="search"]::-webkit-search-cancel-button,
  input[type="search"]::-webkit-search-decoration { -webkit-appearance: none; appearance: none; display: none; }

  * { border-color: var(--color-border); }

  :focus, :focus-visible { outline: none; }

  :where(html[data-desktop]) body { -webkit-user-select: none; user-select: none; cursor: default; }
  :where(html[data-desktop]) :where(a, img) { -webkit-user-drag: none; }

  :where(html[data-desktop]) :where(.selectable) :where(button, select, label, [role="button"], [role="tab"], [role="checkbox"],
    [role="switch"], [role="radio"], [data-slot="badge"], [data-slot="kbd"]) {
    -webkit-user-select: none; user-select: none;
  }

  :where([data-slot="badge"], [data-slot="kbd"], [data-slot="tooltip-content"], .select-none, svg) { cursor: default; }

  :where(button, select, summary, label[for], input[type="checkbox"], input[type="radio"], input[type="file"],
    [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"],
    [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [role="treeitem"],
    a[href], a[href] *, button *):where(:not(:disabled, [aria-disabled="true"], [data-disabled])) {
    cursor: pointer;
  }

  :where(button, input, select, textarea, summary, a, [role="button"], [role="tab"], [role="menuitem"],
    [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"])
    :where(:disabled, [aria-disabled="true"], [data-disabled]) {
    cursor: not-allowed;
  }

  input:not([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"], [type="file"]),
  textarea { cursor: text; }

  [contenteditable]:not([contenteditable="false"]) { -webkit-user-select: text; user-select: text; cursor: text; }
}
```

## 4. Spacing and layout

Spacing uses Tailwind's 4px base (`--spacing: 0.25rem`, so `p-3` is 12px and `gap-1.25` is 5px). Each step means one relationship; a relationship always takes the same step. The parent owns spacing (`gap-*`, `space-y-*`); children carry no outer margin.

### The scale and what each step means

| px | Class | Meaning in Shinsa |
| --- | --- | --- |
| 0 | `gap-0` | Fused parts that share one border |
| 1 | `gap-px` | Title over its description, everywhere. Adjacent icon buttons in a row (like an input addon's). |
| 2 | `p-0.5`, `gap-0.5` | The padding of a tab track (`TabsList` default). `gap-0.5` is banned in the app except between the buttons of a `SectionLabel` action, which owns it. |
| 4 | `gap-1`, `p-1` | Popup list padding (menus, selects, command, `HighlightList`). A list card's padding around its rows. Badge, `Kbd` and xs/sm button icon to label. Gap between tabs in a track. `SectionLabel` to its card. |
| 5 | `gap-1.25` | A 20px icon slot to the title beside it (`ICON_SLOT_GAP`), which makes 8px from glyph to text |
| 6 | `gap-1.5`, `p-1.5` | Icon to label in default and lg buttons, menu rows, tabs and selects. An inline annotation after text (a count, ⓘ, a status glyph and its label). Title beside its description on one line. A settings card's padding (`SettingsCard`); settings blocks apart; a composer footer around its control (`COMPOSER_FOOTER`). |
| 8 | `gap-2` | Icon to label in rows (`ListRow`, `NavItem`, `CommandInput`). Controls in one set (a footer pair, popover actions). Popover content to its parts. |
| 10 | `py-2.5`, `px-2.5`, `p-2.5` | Row and strip inset: a list row with no leading tile (`px-2.5`), a card header's vertical inset (`py-2.5`), a card footer band (`CARD_FOOTER` `py-2.5`), popover padding (`p-2.5`), a list card's empty line. Default button and input side padding. |
| 12 | `p-3`, `px-3` | Card inset (`CARD_INSET`, `CardHeader`, `CardContent`, `CardFooter`, `CARD_HEADER`, `CARD_FOOTER`). Text inset of a composer field (`px-3 pt-2.5`). Command input sides. Gaps inside a dialog or sheet (`gap-3`). |
| 16 | `gap-4`, `p-4` | Dialog padding (`p-4`). Minimum gap between a left block and a right-pushed item (`justify-between`, label and value in `InfoRow`). |
| 24 | `gap-6`, `px-6`, `pt-6` | Section to section on every page. The page column's side padding and top padding. |

Rules:

- **Sanctioned margins only:** `mb-1.5` under a field label, small negative margins that cancel half-leading or hang an affix into a field's padding (`-mt-1`, `-me-0.75`, `-mx-1`), and `-m-px` to merge borders.
- **No arbitrary `[Npx]` spacing** at call sites. The kit itself writes a few derived values inside primitives (a chevron button's 5px end padding `pr-[5px]`, `--spacing(3.25)` for the chat column inset, `pe-[calc((var(--strip-height)-var(--trailing-size))/2)]` for a disclosure's trailing chevron).
- **Don't tighten a primitive at the call site.** If its rhythm is wrong, fix the primitive.
- **Where a 1px border sits inside a control,** write the padding 1px under the visible value so the text lands on the step.
- **A row that ends in a boxed control** drops its end padding to that control's vertical inset, so the control sits as far from the end as from the top and bottom. A collapsible header's trailing chevron is placed by `(strip height − chevron box) / 2`.

### Control insets (inside primitives only)

An icon on either side of a button or badge trims that side's padding by 2px, so the glyph's empty box doesn't read as an indent.

| Control | Height | Side padding | Side with an icon | Icon ↔ label | Icon size |
| --- | --- | --- | --- | --- | --- |
| Button `xs` | 22 | 8 (`px-2`) | 6 | 4 | `sm` 14 |
| Button `sm` | 24 | 8 | 6 | 4 | `sm` 14 |
| Button `default` | 26 | 10 (`px-2.5`) | 8 | 6 | `sm` 14 |
| Button `lg` | 30 | 12 (`px-3`) | 10 | 6 | `sm` 14 |
| Button with a chevron as its icon | as size | 5 on the chevron's side (`pr-[5px]` / `pl-[5px]`) | | 2 (`gap-0.5`) | `sm` 14 |
| `Input` `sm` / default | 24 / 26 | 8 / 10 | | | |
| `SelectTrigger` `sm` / default | 24 / 26 | 6 / 10 | | | `sm` 14 |
| Menu, select, command row | 24 | 8 start (`pl-2`); select row 28 end (`pr-7`) for the check | | 6 | `sm` 14 |
| Tab (default track) | 22 inside a 26 track | 8 (`px-2`) | | 6 | `sm` |
| `Badge` `sm` / default | 18 / 20 | 6 / 8 | 4 on the icon side (2px trimmed) | 4 | `sm` 14 |
| `Kbd` | 20, min width 20 | 4 | | 4 | `sm` |
| `Textarea` | min 64 | 10 × 6 (`px-2.5 py-1.5`) | | | |

### Control height ramp

Shinsa's controls are a step denser than a usual web app: 22 / 24 / 26 / 30. Primitives own their heights; never write `h-*`, `size-*` or a height-changing `py-*` on a control at the call site.

| Height | Button | Field | Also on this step |
| --- | --- | --- | --- |
| 18 | `icon-2xs` (only a close mark inside a 24px row, such as a terminal tab) | | `Badge` `sm` |
| 20 | | | `Badge` default, `Kbd`, `StepNumber` tile, `Switch` (20 × 32), a 20px icon slot |
| 22 | `xs`, `icon-xs` | | |
| 24 | `sm`, `icon-sm` | `Input` `sm`, `SelectTrigger` `sm` | menu, select and command rows, tooltip minimum height, `SectionLabel` row, disclosure `line` strip |
| 26 | `default`, `icon` | `Input`, `SelectTrigger` | default and ghost tab lists |
| 28 | | | `ListRow` single line, `NavItem`, command footer, disclosure `strip`, `InfoRow` |
| 30 | `lg`, `icon-lg` | | |
| 32 | | | underline tab list, a settings block header, disclosure `block` |
| 36 | | | `CARD_HEADER` band, disclosure `band` |
| 40 | | | command input row, `CardFooter` minimum, a settings row minimum |

- Glyphs are `sm` (14px) in `xs` and `sm` controls, rows and badges, `md` (16px) from `default` up.
- `Checkbox` is 14px (`sm`) or 16px (`md`, default); its hit area grows 6px on every side through `after:-inset-1.5`, never a bigger box.
- **No touch step-up.** Every size is the same on a phone; a narrow window gets room by stacking and dropping, never by growing.
- Every control in one row shares one height.

### Content rows

| Row | Height | Build |
| --- | --- | --- |
| Menu / select / command row | 24 | `py-1` around a 16px line (`leading-4`), `pl-2`, `gap-1.5`, `rounded-item`, inside a `p-1` list |
| List row, one line | 28 | `LIST_ROW` + `h-7 items-center`; `px-2.5`, or `px-1.5` with a leading tile; `gap-2`; `rounded-control` |
| List row, two lines | ≈ 37 | `items-start pt-1.5 pb-1`: a `text-xs` `fg-4` title over a `text-2xs` `fg-2` meta line, `gap-px`; the row keeps 2px less under its text because a line already carries about 3px below its baseline |
| Nav row (rail) | 28 | `h-7`, `ps-1.5 pe-2.5`, `gap-2`, a 20px icon slot, `text-xs` `fg-3` |
| Settings row | 40 minimum | `pl-2 pr-1.5`, `py-1` (so a wrapped line keeps 4px), text 14px from the card's left edge, control 12px from its right |
| Card header band | 36 | `CARD_HEADER`: `h-9 bg-bg-a1 ps-3 pe-3 gap-1.25`, a 14px icon in a 20px slot on the 12px inset, 8px glyph to a `text-xs` medium `fg-4` title |
| Card footer band | ≈ 36 | `CARD_FOOTER`: `border-t bg-bg-a1 px-3 py-2.5`; the kit `CardFooter` is `min-h-10 px-3 py-1.5 border-t` |

Rows inside a card never borrow a stat value's size; a figure in a row is `text-xs` or `text-2xs` with `tabular-nums` when it updates.

### Structures and page layout

| Structure | Value |
| --- | --- |
| Page column (Home, Settings, the task page, All tasks) | `PAGE_COLUMN`: `mx-auto w-full max-w-3xl px-6` (768px cap, 24px sides), top padding `PAGE_TOP` `pt-6` |
| Wide card frame (the Cards layout) | `CARDS_FRAME`: `mx-auto w-full max-w-[90rem] px-3 sm:px-5` (1440px cap, 12px sides, 20px from `sm`) |
| Section to section on a page | 24px (`gap-6`) |
| Dialog | `w-[min(26.25rem,calc(100vw-2rem))]` (420px), `p-4`, `gap-3`, `max-h-[calc(100dvh-2rem)]`; small dialogs 320px; ⌘K `w-[min(32.5rem,calc(100vw-2rem))]` (520px), `top-[max(3rem,14vh)]` |
| Sheet | `w-3/4`, `sm:max-w-sm` (384px) at the left or right, `max-h-[85dvh]` at the top or bottom, `gap-3` |
| Popover | `w-64` (256px), `p-2.5`, `gap-2`, 8px from its trigger |
| Preview card (`InfoPopover`) | `w-72` (288px) |
| Tooltip | `min-h-6`, `max-w-72`, `px-2 py-1`, `gap-1` |
| Toast | `padding: 6px 10px`, `gap: 8px` (6px from the icon, whose box takes 2px back), `min-height: 34px`, `width: fit-content`, `max-width: 420px`; with a description `padding: 10px`; with an action the end padding is 5px (10px with a description) |
| Command menu | 40px input row (`h-10 px-3 gap-2`, bottom hairline), list in a `SizeAnimator`, 28px footer (`h-7 px-3 gap-3`, top hairline) |
| Card | `CARD`: `corner-superellipse/1.125 rounded-xl border border-border bg-card`; inset 12px (`p-3`) on all four sides; a list card `p-1` |
| Inset (anything nested in a card or the chat column) | `INSET`: `corner-superellipse/1.125 rounded-lg border border-border` with its fill on top |

- **No sidebars inside a page.** A page with parts (Settings, the task page) switches them with a tab bar under its heading at every width, never with a rail of links at the side.
- **Breakpoints:** Tailwind's defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536); no arbitrary `min-[…]` breakpoints. Check every surface at about 900px and at 1280px.
- **A figure beside text centres on that text** (`items-center` on the block the title and description form), never `items-start`.
- **A label and its value sit apart:** label left, value right, `justify-between gap-4`, never run on after the label with a space.

## 5. Radius and shape

### The law

A nested corner is concentric with its parent: **inner radius = outer radius − the padding between the two edges**, at any depth (a row in a popup, a segment in a tab track, a highlight in a list). The semantic radii are derived from each other with `calc()`, so the law holds by construction. When the padding is larger than the outer radius, the inner corner is free again and takes its own token.

```css
@theme inline {
  --radius-control-sm: 0.375rem;                         /* 6px  */
  --radius-control: calc(var(--radius-control-sm) + 1px); /* 7px  */
  --radius-item: var(--radius-control-sm);                /* 6px  */
  --radius-popup: calc(var(--radius-item) + 4px);         /* 10px = item + p-1 */
  --radius-segment: calc(var(--radius-control) - 2px);    /* 5px  = control − p-0.5 */
  --radius-checkbox: calc(var(--radius-sm) - 1px);        /* 4px  */
  --radius-sm: 0.3125rem;                                 /* 5px  */
  --radius-md: var(--radius-control-sm);                  /* 6px  */
  --radius-lg: var(--radius-control);                     /* 7px  */
  --radius-xl: 0.5625rem;                                 /* 9px  */
  --radius-2xl: 0.6875rem;                                /* 11px */
  --radius-3xl: 0.9375rem;                                /* 15px */
}
```

| Utility | px | Use |
| --- | --- | --- |
| `rounded-control-sm` | 6 | `xs` and `sm` buttons (22/24), `sm` inputs and select triggers, `StepNumber`, inline chips (`CHIP`), a disclosure's glyph box |
| `rounded-control` | 7 | `default` and `lg` buttons (26/30), inputs, select triggers, the default tab track, list rows, nav rows, tooltips |
| `rounded-item` | 6 | A row inside a popup (menu, select, command), the sliding highlight behind it, task rows in a popover's `p-1` frame |
| `rounded-popup` | 10 | Menus, selects, popovers, preview cards, the command dialog, toasts |
| `rounded-segment` | 5 | A tab inside the `p-0.5` track and its sliding pill |
| `rounded-checkbox` | 4 | The `Checkbox` box at 14 and 16px |
| `rounded-sm` | 5 | `Kbd`, the `icon-2xs` button, inline code in prose, a keycap inside a tooltip |
| `rounded-lg` | 7 | Insets (`INSET`): everything nested in a card or the chat column (code fences, notes, images, a finding card), `Textarea` |
| `rounded-xl` | 9 | Cards (`CARD`, kit `Card`), dialogs, the live card |
| `rounded-2xl` | 11 | Large specimen tiles only |
| `rounded-3xl` | 15 | A sheet's inner edge (`rounded-r-3xl` on a left sheet, `rounded-t-3xl` on a bottom one), the user's chat bubble |
| `rounded-full` | 50% | Circles and pills only: badges, `Switch` and its knob, status dots, avatars, the overlay scrollbar thumb, the underline tab's 2px line, usage bars |
| `rounded-[inherit]` | | A `::before` or `::after` layer that must match its element (a button's fill, a card's ring) |

- Never write `rounded-[Npx]` or a free `calc()` in a class; the lint fails on any raw corner in the kit, the app and the catalog. A new nesting gets a new derived token, written as parent − padding.
- `tailwind-merge` is taught the corner tokens, so `cn('rounded-control', 'rounded-popup')` keeps only the later one.
- `rounded-none` is not used on controls.

### Superellipse corners

Every rounded surface and control carries `corner-superellipse/1.125` (`corner-shape: superellipse(1.125)`), a squircle a little fuller than a circular arc. The class also applies to the element's `::before` and `::after`, so a press layer or a ring drawn on a pseudo-element keeps the same corner. It is progressive enhancement: a browser without `corner-shape` ignores the property and draws the plain circular `border-radius`, with nothing else to fall back on. Steps `1.25`, `1.5` and `2` exist; only `1.125` is used. Put it on every element that has a radius other than `rounded-full`, including the `::before` fill layers (`before:corner-superellipse/1.125`).

### Icon corners

Central icons come in four corner radii, `radius='0'` to `'3'` on `Icon`. The default is `3` (rounded); chevrons are always drawn at `0` (square-cornered). Other radii are only generated when a call site asks for one.

## 6. Elevation and borders

### No shadows

Shinsa draws no drop shadows. Depth comes from three things only: the surface steps (`bg-1` to `bg-4`, the page background), one 1px hairline in `bg-3`, and type. There is no blur on any UI surface, and no gradient on chrome.

The shadow tokens exist so components never hardcode an edge colour and so dark mode can swap the recipe:

| Utility | Light | Dark | Use |
| --- | --- | --- | --- |
| `shadow-1` … `shadow-4` | `0 0 0 1px var(--bg-3)` | `inset 0 0 0 1px var(--bg-3)` | The hairline ring of a surface: the selected tab pill (`shadow-1`), specimen tiles |
| `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg` | same as `shadow-1` … `shadow-4` | same | Pinned to the hairline inside the kit: popovers, menus, selects and preview cards (`shadow-md`), dialogs (`shadow-md`), sheets (`shadow-lg`) |
| `shadow-control` | `0 1px 1px oklch(0 0 0 / 0.1), 0 0 0 1px oklch(0 0 0 / 0.08), inset 0 1px 0 oklch(1 0 0 / 0.16)` | same | The `primary` button: a 1px edge and a white inner highlight on the top edge |
| `shadow-control-destructive` | `0 1px 1px oklch(0 0 0 / 0.1), 0 0 0 1px oklch(0 0 0 / 0.06), inset 0 1px 0 oklch(1 0 0 / 0.2)` | same | The `destructive` button |
| `shadow-control-elevated` | `0 0 0 1px var(--bg-3)` | `inset 0 0 0 1px var(--bg-3)` | The `outline` button's edge at rest |
| `shadow-control-elevated-hover` | `0 0 0 1px var(--bg-4)` | `inset 0 0 0 1px var(--bg-4)` | The `outline` button's edge on hover and press |
| `shadow-control-knob` | `0 2px 2px oklch(0 0 0 / 0.1), 0 2px 3px oklch(0 0 0 / 0.1)` | same | A switch knob |
| `shadow-control-dot` | `0 1px 2px oklch(0 0 0 / 0.15)` | same | A raised dot; defined, but no component uses it |

- **The control recipes are the only shadows in the system:** the primary and destructive buttons' edge and white highlight, and the switch knob's 2px drop. Everything else that looks raised is the `bg-3` hairline.
- **Why `shadow-xs…lg` are pinned, not `none`:** Tailwind composes shadows and rings into one `box-shadow`, and a `none` in that list invalidates the whole declaration. They resolve to the hairline instead.
- **Why dark inverts:** a drop shadow or an outer ring reads as nothing on a near-black page, so in dark the ring becomes an inner line of light (`inset`), keeping edges visible in a bright room.
- In the app, the lint rejects Tailwind's own shadows (`shadow-2xs` … `shadow-2xl`, `shadow-inner`) and any raw `shadow-[…]` or `ring-[…]`; app code writes only `shadow-1…4` and `shadow-control*`.
- No `backdrop-blur` on surfaces. Modal scrims dim with `bg-black/10` in light and `dark:bg-black/55`, no blur.

### One border

There is one border colour: `--border` = `bg-3`. The base layer sets `* { border-color: var(--color-border); }`, so a bare `border`, `border-t` or `divide-y` is already the hairline. A card's edge, the dividers inside it, a header strip's underline, an inset's edge, a table's row lines and the scroll-thumb's track all use it. `--input` (`bg-2`) is a field's fill, not an edge.

- **Popups draw their edge with the shadow ring alone** on the `popover` fill (`rounded-popup bg-popover shadow-md`); never add `border` as well, or ring and border stack into a 2px edge. **Tooltips and toasts are the inverse:** a `border border-border` (toast: `border: 1px solid var(--bg-3)`) and no shadow.
- **The kit `Card`** draws its edge as an `::after` ring (`after:shadow-[inset_0_0_0_1px_var(--bg-3)]`, `z-30`, `rounded-[inherit]`, `pointer-events-none`) so content clipped by `overflow-hidden` never covers it. The app's `CARD` constant is `corner-superellipse/1.125 rounded-xl border border-border bg-card`; a hand-built copy of that string fails the lint.
- **Fill or border for controls, both for panels.** A control picks one (an `outline` button has its ring and a page-coloured fill; a field is filled, never bordered). Cards, popovers, menus and dialogs keep their fill and their edge, because the fill alone is too faint to define an edge.
- **Everything nested in a card or the chat column is an inset:** `INSET` (`rounded-lg border border-border`) with its fill on top. A nested box with a fill and no edge fails the lint, and so does a hand-built `rounded-lg border border-border`.
- **A toned box takes its tone's edge:** a box filled in a tone is edged in the same hue at its `-a3` step (`border-primary-a3`, `border-amber-a3`), never the grey hairline. A tone fill on a line that draws the grey edge fails the lint. A badge or tile in a tone has no border at all.
- **Where regions meet, draw one shared line**; never double a border. Adjacent bordered parts merge with `-m-px`.
- **Selection is never a ring:** a picked card is `border-primary`; a checked choice card is the kit's `primary-a1` fill on a `primary-a3` border; an app box in the accent tone is `TONE_INSET.blue` (`bg-primary-a2` on `border-primary-a3`).
- **Invalid** is a 1px `red-4` ring on `Input` and `Textarea`, the one ring in the system.
- **Knockout edges:** a dot or badge laid over another element is cut out by a 2px border in the surface colour (`border-card`, `border-popover`), never a ring.

### Surfaces as depth

| Layer | Light | Dark |
| --- | --- | --- |
| Page (`bg-background`) | white | L 0.174 |
| Card (`bg-card`) | white, separated by the hairline | L 0.197 (`bg-1`) |
| Dialog and sheet (`bg-background`) | white | the page colour, L 0.174, over the scrim |
| Popover, menu, select, preview card (`bg-popover`) | the page colour, white | one step up, `bg-2` (L 0.228) |
| Field fill (`bg-input`) | `bg-2` | `bg-2`, and `bg-3` inside a dark popover |
| Inset fills | `bg-bg-a1` (note), `bg-bg-2` (code, images), `bg-card` (a message link) | same tokens |

Inside a dark popover a field would vanish (popover and field both `bg-2`), so the stylesheet raises it a step:

```css
.dark [data-slot="popover-content"] {
  --input: var(--bg-3);
  --input-hover: var(--bg-4);
}
```

Never give a field a border or a call-site fill to make it show.

## 7. Colour usage rules

Every colour is a token. No hex, no Tailwind palette colours (`text-emerald-400`), no `white`/`black` utilities except the destructive button's `text-white` and the scrim's `bg-black/N`. Mix with `color-mix(in oklch, …)`, never `in srgb`. Both themes ship, and every token is defined in both; a separate section lists every value.

### Neutral surfaces

| Token | Light | Dark | May be used for |
| --- | --- | --- | --- |
| `background` | `oklch(1 0 0)` | `oklch(0.174 0.004 285.97)` | The page canvas; dialogs and sheets |
| `background-subtle` (= `--sidebar`) | L 0.985 | L 0.192 | The sidebar surface |
| `bg-1` | white | L 0.197 | Cards (`--card`), the page-coloured step in dark |
| `bg-2` | L 0.973 | L 0.228 | Field fills (`--input`), code and image insets, the tab track, `Kbd`, dark popovers |
| `bg-3` | L 0.955 | L 0.257 | The hairline (`--border`), field hover (`--input-hover`), the outline button's dark fill, the switch track at rest |
| `bg-4` | L 0.928 | L 0.299 | The most recessed step; the outline button's hover edge, dark field hover inside a popover, the tab pill in dark |

The ramp steps lightness only, at one cool hue with near-zero chroma, so equal steps read as equal lifts.

### Text ladder

| Token | Light | Dark | Use | Never |
| --- | --- | --- | --- | --- |
| `fg-4` (= `foreground`) | L 0.21 | L 0.946 | Titles, headings, values, typed text, labels you act on, a hovered or current row | |
| `fg-3` | L 0.443 | L 0.787 | Body copy (the inherited default), menu rows at rest, nav rows at rest | |
| `fg-2` (= `muted-foreground`) | L 0.543 | L 0.655 | Descriptions, meta, hints, timestamps, placeholders, section and group labels, secondary buttons at rest | |
| `fg-1` | L 0.764 | L 0.54 | Decorative only: dividers, watermarks, disabled glyphs, a checkbox's hover edge | Body copy, labels or placeholders |

`fg-2` and up clear 4.5:1 on `bg-1` and `bg-2` (light: `fg-2` 5.01 / 4.64, `fg-3` 7.67 / 7.10). Use the step utility, never `text-foreground/70`; never stack an opacity modifier on a token that is already a tint.

**Hover and active move one step:** a quiet text goes to `fg-4` on hover and press (`text-fg-2 hover:text-fg-4 active:text-fg-4`). Every `hover:` class has the same `active:` value on the same line (lint checks that one is there); `group-hover:` pairs with `group-active:` unless it only reveals from `opacity-0`.

### Icon inks

Icons never use the text colour or an opacity. Each grey text step has a solid icon ink one step quieter (values in Iconography):

| Text | Icon ink |
| --- | --- |
| `fg-4`, `foreground`, `card-foreground`, `popover-foreground` | `icon-4` |
| `fg-3` | `icon-3` |
| `fg-2`, `muted-foreground` | `icon-2` |
| `fg-1` | `icon-1` |
| Any tone (`*-text`, `*-4`, `primary-*`, white on a fill) | the tone itself |

`icon-1` also draws the checkbox's resting edge (`border-icon-1`).

### Alpha washes

Translucent steps that layer on any surface, so a wash reads the same on the page, a card or a popover.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg-a1` | black 2.7% | white 3.9% | A note inset's fill, the card header and footer bands, the default badge, a list row's hover in a light list, Settings' shelf |
| `bg-a2` | black 4.7% | white 7.1% | The sliding highlight behind menu, select, command and list rows; a row's hover wash; inline code and chips; `StepNumber`; the neutral tone surface; secondary button hover (at 70%: `before:bg-bg-a2/70`) |
| `bg-a3` | black 7.5% | white 11% | Hover on a neutral toned surface |
| `bg-a4` | black 11.8% | white 16.9% | The default text selection |
| `fg-a1` | black 29% | white 29% | The overlay scrollbar thumb (at 60%, 100% on hover) |
| `fg-a2` … `fg-a4` | black 38.8 / 56.1%, `fg-4` at 85.9% | white 40 / 63.9 / 91% | Text-strength alphas for unknown backgrounds; rarely used |

### The accent

One blue, `primary`: `--primary-4` is `oklch(0.6 0.215 256)` in light and `oklch(0.62 0.2 256)` in dark, with a white label (`--primary-foreground: oklch(1 0 0)`). `--primary-text` is `primary-4` in light and the lighter `oklch(0.72 0.17 256)` in dark. The rest of its ramp is mixed from it:

```css
.dark, :root {
  --primary-text: var(--primary-4);  /* .dark overrides to oklch(0.72 0.17 256) */
  --primary-1: color-mix(in oklch, var(--primary-4) 10%, var(--background));
  --primary-2: color-mix(in oklch, var(--primary-4) 40%, var(--background));
  --primary-3: color-mix(in oklch, var(--primary-4) 70%, var(--background));
  --primary-a1: color-mix(in oklch, var(--primary-4) 8%, transparent);
  --primary-a2: color-mix(in oklch, var(--primary-4) 14%, transparent);
  --primary-a3: color-mix(in oklch, var(--primary-4) 22%, transparent);
  --primary-a4: color-mix(in oklch, var(--primary-4) 32%, transparent);
  --primary: var(--primary-4);
  --ring: var(--primary-2);
}
```

Aliases are declared on `.dark` as well as `:root` because a custom property resolves where it is declared: an alias on `:root` alone would keep light values inside a `.dark` region.

**What the accent is for:** the primary button (`before:bg-primary`, hover and press `before:bg-primary/80`), links and inline link buttons (`text-primary-text`), every checkmark (the current value in a menu or select, done steps, copy confirmations, to-do glyphs), checked controls (`Checkbox`, `Switch` on, `data-checked:bg-primary-4`), the underline tab's line (`bg-primary`), "Needs your answer" and working statuses, a spotlight or focused row (`primary-a1`), a selected item's edge (`border-primary`), a checked choice card (`primary-a1` fill on a `primary-a3` border), the terminal selection (`primary-a2`), the first series of any chart.

**Rules:**

- One accent per view: the single most important beat. The same action repeated (a header button and a closing call to action) keeps the same look everywhere.
- **Checkmarks are the accent, never green.** A green checkmark icon fails the lint. The one green check is the progress track's done steps (a 15px check on `green` at 29%), so done reads apart from the blue pulse of the current step.
- The accent is a fill only on the primary button, a checked control and the tab line; otherwise it is text, an edge or a wash.

### Status tones

Nine hue ramps (`purple`, `sky`, `blue`, `green`, `amber`, `orange`, `red`, `pink`, `yellow`) each have four solid steps (`-1` tint to `-4` solid), four alpha steps (`-a1` 7.1%, `-a2` 14.9%, `-a3` 38.8%, `-a4` 100% of the `-4` colour) and a `-text` step.

| Step | What it is for |
| --- | --- |
| `-1` | A tint surface (a badge's fill: `bg-purple-1 text-purple-text`) |
| `-2`, `-3` | Lighter and stronger tints; rarely used directly |
| `-4` | A solid fill: a dot, a bar, the destructive button (`red-4`), invalid ring (`red-4`). Never text on its own tint (it lands at 1.7:1 to 2.4:1 there). |
| `-a1` | Diff added / removed washes (`--code-added: var(--green-a1)`, `--code-removed: var(--red-a1)`) |
| `-a2` | A toned box's fill (`TONE_WASH`, `TONE_SURFACE`), the strong diff washes, a find match in the terminal (`amber-a2`) |
| `-a3` | A toned box's edge (`TONE_EDGE`), a toned surface's hover, the tone's text selection |
| `-text` | Text and icons in a tone, on its `-1` tint or a neutral surface |

`-text` in light keeps the ramp's hue at maximum chroma while dropping lightness until it clears APCA Lc 60 (non-body text such as chips); it is vivid on purpose, since a WCAG-4.5 version turns amber and orange into mud. In dark the `-4` step already clears 4.5:1 on dark tints, so every `-text` equals its `-4`.

Tones have meanings, from one map (`TONE_*`, nowhere else):

| Tone | Text | Wash | Edge | Surface (tile, badge) | Meaning |
| --- | --- | --- | --- | --- | --- |
| neutral | `text-fg-2` | `bg-bg-a1` | `border-border` | `bg-bg-a2 text-fg-3` | Waiting on another task, unknown |
| blue (the accent) | `text-primary-text` | `bg-primary-a2` | `border-primary-a3` | `bg-primary-a2 text-primary-text` | Needs your answer, working stages, waiting to check in, waiting for a usage limit or delegations |
| amber | `text-amber-text` | `bg-amber-a2` | `border-amber-a3` | `bg-amber-a2 text-amber-text` | Changes to review; usage from 75% |
| orange | `text-orange-text` | `bg-orange-a2` | `border-orange-a3` | `bg-orange-a2 text-orange-text` | Paused, setup incomplete, sign in needed; an agent review that disagrees |
| green | `text-green-text` | `bg-green-a2` | `border-green-a3` | `bg-green-a2 text-green-text` | Ready to merge, added lines |
| red | `text-red-text` | `bg-red-a2` | `border-red-a3` | `bg-red-a2 text-red-text` | Errors, failures, destructive actions; usage from 90% |
| purple | `text-purple-text` | `bg-purple-a2` | `border-purple-a3` | `bg-purple-a2 text-purple-text` | Plan to approve |

A toned surface hovers one alpha step up (`hover:bg-<tone>-a3 active:bg-<tone>-a3`, neutral `bg-bg-a3`). A status speaks in its tone: icon and text both in the tone, never a coloured frame around neutral copy. `destructive` is `red-4` with white text.

### Selection and code colours

- Text selection is `--selection` (`bg-a4` by default), translucent so the text keeps its colour. A tinted surface re-colours selection for its subtree: a toned `Badge` sets `selection-<tone>` (the tone's `-a3`), a solid `fg-4` surface sets `selection-inverse` (white at 35%).
- Syntax colours read the tone tokens: keyword `purple-text`, string `green-text`, number `orange-text`, comment `fg-2`, function `primary-text`, type `amber-text`, property `blue-text`, tag `red-text`, punctuation `fg-3`, meta `fg-2`. Comment highlights: alert `red-text`, query `blue-text`, todo `orange-text`, highlight `green-text`, strike `fg-1`. The terminal maps its ANSI colours onto the same code tokens.
- File and folder marks in the Code tab draw in fifteen softer file tints (`--file-red` … `--file-slate`; light at L 0.6 to 0.77 and chroma 0.1 to 0.14, dark lifted to L 0.74 to 0.9 at chroma 0.085 to 0.12; `--file-slate` is the grey one, chroma 0.035 / 0.03), so a tree of fifty files reads as gentle colour, not warning lights. `file-icons-muted` turns them into the row's ink.

### Charts

Shinsa has no chart palette and no charts. Usage figures are bars (`h-1.5 rounded-full bg-bg-a2` filled in the usage tone). If a chart is ever needed, its first series is the accent.

### Never

- A tone for decoration. A tone always means a status.
- `bg-accent` (shadcn's wash) as a brand colour; Shinsa's washes are `bg-a1`/`bg-a2`.
- An icon brighter than its text, or faded with `opacity-*`.
- A hover colour change that transitions (Motion).

## 8. Iconography

### One set: Central Icons

Every glyph is a Central Icon (`@central-icons-react/all`), drawn through one component: `<Icon name='Icon…' />`. `Icon`, `Spinner` and `Logo` are the only things that draw an `<svg>`; a hand-drawn `<svg>` anywhere else fails the lint. Marks Central lacks are drawn into the kit's custom set (below) and go through `Icon` like everything else.

Central's stroke style: outline, 2px stroke on the 24-unit grid, round joins, corner radius 3 by default. Filled glyphs are the same name with `Filled` appended (`IconListBullets` / `IconListBulletsFilled`).

### The `Icon` component

```tsx
type IconSize = 'sm' | 'md' | 'lg';

<Icon
  name='IconBell'        // required, an IconName from the generated set
  size='md'              // optional; without it the icon takes --icon-size (its primitive's, else sm)
  radius='3'             // optional, '0' | '1' | '2' | '3'; default '3', chevrons always '0'
  ariaLabel='Notifications' // optional; with it role="img", without it aria-hidden
/>
```

It renders `<svg data-slot="icon" viewBox="0 0 24 24" fill="none" class="shrink-0 size-(--icon-size)">` with the pre-rendered paths inside. A size maps to `size-(--icon-size-sm|md|lg)`; with no size it is `size-(--icon-size)`. Any name starting `IconChevron` or `IconCross` is always drawn in the 14px `sm` box, whatever `size` it is given, so every chevron and every X is one size.

The module also exports the two class maps a primitive uses:

| Export | `sm` | `md` | `lg` | Used by |
| --- | --- | --- | --- | --- |
| `ICON_SIZE_CLASS` | `size-(--icon-size-sm)` | `size-(--icon-size-md)` | `size-(--icon-size-lg)` | `Icon` itself, for an explicit `size` |
| `ICON_SIZE_CONTEXT` | `[--icon-size:var(--icon-size-sm)]` | `[--icon-size:var(--icon-size-md)]` | `[--icon-size:var(--icon-size-lg)]` | A primitive's root, so every unsized icon inside it takes that size |

`ICON_SIZE_CONTEXT` belongs in the kit's own primitives. App code never writes `[--icon-size:…]` (the lint rejects
it); it passes `size` or relies on the primitive.

### Sizes

Three sizes, and only three, tied to the text an icon sits with:

```css
:root {
  --icon-size-sm: 0.875rem; /* 14px */
  --icon-size-md: 1rem;     /* 16px */
  --icon-size-lg: 1.25rem;  /* 20px */
  --icon-size: var(--icon-size-sm);
}
```

| Size | px | Where |
| --- | --- | --- |
| `sm` | 14 | Beside 12 to 13px text: every row (chat, list, menu, select, command, nav), facts, notices, toasts, badges, `Kbd`, every button (icon-only ones too), every select, status tiles' glyphs, card header icons. The default. |
| `md` | 16 | Beside 14px+ text and in 26/30px controls: default inputs |
| `lg` | 20 | Rare and alone: an empty-state tile (the `size='sm'` empty state uses `md`), a full-page wait's spinner, an evidence recording's play glyph, catalog specimens |

- A primitive sets `--icon-size` for the glyphs inside it (`Button`, `Badge`, `Tabs`, `Select`, menu and command rows, `Kbd` set `[--icon-size:var(--icon-size-sm)]` or `-md`), so an icon there passes nothing. Anywhere else the call site passes `size`.
- Never a `size-*`, `w-*` or `h-*` class on an icon, never `[&_svg]:size-*`, colour or opacity on a parent, never `[--icon-size:…]` or `[--icon-color:…]` in app code (all fail the lint).
- **One row, one size and one ink.** Every icon in a row (a menu row, a toolbar, the chat's run header) is the same size and pairs with the same text. Spinners and chevrons are on the same scale.
- 12, 18 and 24px icons do not exist: a 12px glyph beside 12px text read a size smaller than a 14px one in the next row.
- A 20px icon slot (`ICON_SLOT`: `grid size-5 shrink-0 place-items-center`) holds a 14px icon wherever rows share an icon column; 5px (`gap-1.25`) after it puts the text 8px from the glyph.
- A glyph beside text is flex-centred on the text's line box, with no optical nudge (`translate-y-px` was tried and read too low).

### Ink: a solid colour a step under its text

An icon is taken in passively and the text is read, so the icon draws one step quieter than its text, in a solid ink, never at an opacity.

| Text | Icon ink | Light | Dark |
| --- | --- | --- | --- |
| `fg-4`, `foreground`, `card-`/`popover-foreground` | `icon-4` | `oklch(0.538 0.008 274.53)` | `oklch(0.66 0.004 286.37)` |
| `fg-3` (body) | `icon-3` | `oklch(0.631 0.008 277)` | `oklch(0.58 0.007 286.24)` |
| `fg-2`, `muted-foreground` | `icon-2` | `oklch(0.665 0.009 278.5)` | `oklch(0.5 0.009 286.15)` |
| `fg-1` | `icon-1` | `oklch(0.831 0.004 271.36)` | `oklch(0.44 0.008 286.14)` |
| a tone | the tone itself | | |

- In light, each `icon-N` sits at 72% of its `fg-N`'s APCA contrast on `bg-1` (Lc 75 / 62 / 54 / 30). `icon-2` is held at 3:1 (WCAG non-text contrast) because an icon-only secondary button carries its meaning by the glyph alone. Dark needs a bigger step: `icon-4` matches `fg-2`, and each step below follows it down. Chroma and hue are the matching `fg` step's.
- **Automatic.** Every `text-*` colour utility sets `--icon-color`, it inherits, and `Icon` and `Spinner` draw in it (Typography, Custom utilities). So a menu row's icon is `icon-3` and turns `icon-4` with its label when highlighted; a secondary button's is `icon-2` and turns `icon-4` on hover.
- **Same row, same ink.** Where an icon and its label are separate elements, put the icon inside the label's colour or give it the label's class, hover included. A class on the icon changes its ink, never its strength: `text-fg-3` on an `Icon` draws `icon-3`.
- **Never brighter than its text** (lint fails on a higher step on an icon inside lower-step text).
- **Tones keep the tone:** beside `text-red-text`, `text-primary-text`, a badge's tone or the white of a filled button, the icon is the same colour as its text. A status tile gives its glyph `TONE_TEXT[tone]`.
- **Opacity on an icon is a reveal only** (`opacity-0` to `group-hover:opacity-100`), or a disabled control's own opacity. The spinner's faint track is part of its drawing.
- `Logo` draws in its text's colour, not the icon ink: the mark beside "Shinsa" is as strong as the word.

### Outline at rest, filled where you are

Every glyph is an outline. A state is said by colour, never by filling the glyph. The one exception: **a tab or navigation item that carries an icon swaps it for its filled twin while it is the current one, and only then.**

| Place | Outline (at rest) | Filled (current) |
| --- | --- | --- |
| Rail: New task | `IconPlusMedium` | `IconPlusMediumFilled` |
| Rail and top bar: All tasks / Tasks | `IconListBullets` | `IconListBulletsFilled` |
| Rail and top bar: Settings | `IconSettingsGear4` | `IconSettingsGear4Filled` |
| Top bar (Mac app): Home | `IconHomeRoundDoor` | `IconHomeRoundDoorFilled` |
| Services, while on the Terminal page | `IconServer` | `IconServerFilled` |
| A shell's terminal tab in front | `IconConsole` | `IconConsoleFilled` |
| A service's terminal tab in front | its state glyph | `IconPlayFilled`, `IconHourglassFilled`, `IconExclamationCircleFilled`, `IconCircleDashedFilled`, in its tone |

`NavItem` and `NavButton` take `icon` and `activeIcon`, both required, so a new row cannot leave the filled twin out. Both names are written out at the call site, because the generator reads names from source. A glyph that says a state anywhere else (a row's tile, a status tile) keeps its outline; filled never means on or off. Home is always `IconHomeRoundDoor`, never the door-less house. Brand marks and the custom priority and file marks are drawn as their artwork (some filled).

### How icons are generated

The bundle carries only the icons the workspace references. A generator pre-renders their SVG markup into a generated paths module; `Icon` looks a name up there and injects the markup.

1. **Scan.** Every `.ts`, `.tsx`, `.js`, `.jsx`, `.mdx` and `.astro` file under `apps/` and `packages/` (skipping `node_modules`, `dist`, `build`, `test`, `release`, dot folders and `*.test.*` files). A name counts when it appears as `name='Icon…'` / `icon='Icon…'`, as `name: 'Icon…'` / `icon: 'Icon…'`, or as any string literal that names a real icon. A `radius='N'` in the same JSX tag adds that radius. Every icon gets radius `3`; chevrons also get `0`.
2. **Known names.** Central's catalog (its `icons-index.json`, outline names; `Filled` picks the filled style), plus the custom and toned names.
3. **Render.** Each icon through `CentralIcon` with `join: 'round'`, `fill: 'outlined'` or `'filled'`, `radius`, `stroke: '2'`, `mode: 'raw'`, then the corrections below.
4. **Write** the generated module: `ICON_NAMES` (sorted), the `IconName` type, `IconRadius`, `DEFAULT_ICON_RADIUS = '3'`, and `ICON_PATHS[name][radius]` = inner SVG markup. `--check` fails when the file is stale; tests check it too. Run the generator after using a new name.

Corrections, all applied by scaling about the box's centre (`<g transform="translate(12 12) scale(s) translate(-12 -12)">`):

| Table | Values | Why |
| --- | --- | --- |
| `STROKE_OVERRIDES` | `IconCheckmark1`: stroke 2.5 | Central ships 1 / 1.5 / 2; the checkmark's 2 reads too thin at small sizes |
| `CHEVRON_SCALE` | `…Small` 1.4×, `…Medium` 0.9333×, stroke divided by the scale (1.4286 / 2.1429) | A `Small` chevron spans 8 of 24 units and a `Medium` one 12, where an icon spans about 18, so a chevron read a size smaller. Every chevron is drawn 11.2 units long (6.5px in its 14px box) at the weight of every other icon. |
| `CROSS_SCALE` | `IconCrossSmall` 1.4×, `IconCrossMedium` 1.0182×, stroke divided by the scale (1.4286 / 1.9643) | A cross is the same kind of glyph as a chevron, but a `Small` one spans 8 × 8 units and a `Medium` one 11 × 11, so an X beside a chevron or the queue's pen read smaller. Every cross is drawn 11.2 units on both axes, so its ink (7.7 × 7.7px at 14px, round caps included) is as wide and tall as a chevron's long side (7.7 × 4.45px). |
| `MATCHED_SCALE` | `IconHomeRoundDoor` 1.025, `IconListBullets` 1.15, `IconServer` 1.15, `IconSettingsGear4` 1.1132, and the same for each `Filled` twin; stroke divided by the scale | Icons that sit side by side in the top bar must draw the same size. The usage gauge sets it (its ink is 20 of 24 units tall, 11.67px at 14px); each other icon is scaled until its ink is as tall, unless that brings it within half a unit of the box's sides (where it would clip). Settings' gear (18 × 16.17 units) matches at 1.1132; the server (18 × 14) stops at 1.15; Home (16 × 16.06) and Tasks (17 × 15) are set by eye at 1.025 and 1.15. A filled twin takes its outline's scale so the icon keeps its size when it fills. |
| `OPTICAL_SCALE` | `IconPaperPlaneTopRight` and its `Filled` twin 0.9 | Reads large at the same box |
| `OPTICAL_OFFSET` | `IconApple` (0.14, −1.03), `IconAndroid` (0, −0.92) | Centres the ink's alpha-weighted centroid, damped, instead of the bounding box |

An icon that sits beside others at one size but draws smaller in Central's box is matched in `MATCHED_SCALE` after measuring its ink, never sized at the call site.

### Custom icons

Drawn in the same 24 × 24 box, each foreign mark scaled so its glyph spans about 17 of the 24 units (the optical size of a Central icon), in `currentColor`:

- Brand marks: `IconBuzzkit`, `IconApple`, `IconAndroid`, `IconResend`.
- Priority: `IconPriorityUrgent` (a 17 × 17 rounded square, 3.5 radius, with a cut-out `!`), `IconPriorityHigh`, `IconPriorityMedium`, `IconPriorityLow` (three 3.5-wide bars 6 / 10 / 14 units tall at x 4.5 / 10.25 / 16, `rx 1`; unused bars at 0.3 opacity as part of the drawing).
- Search toggles: `IconRegex`, `IconWholeWord`.
- Language marks Central lacks: `IconGo`, `IconPython`, `IconDocker`, `IconDatabase` (2px strokes, round caps and joins).

**Toned file and folder marks.** Fifty `IconFileType…` and `IconFolder…` names, each a base icon wrapped in `<g style="color:var(--file-icon-ink,var(--file-<tint>))">`. For example `IconFileTypeTypescript` is `IconTypescript` in `blue`, `IconFileTypeJson` is `IconBrackets2` in `amber`, `IconFolderSource` is `IconFolder1Filled` in `blue` and `IconFolderOpenSource` is `IconFolderOpen` in `blue`. Folders are the filled folder when closed and the outline open folder when open.

### Naming

- Every name is `Icon` + PascalCase Central name (`IconCircleInfo`, `IconArrowCornerDownRight`); the filled style appends `Filled`; chevrons are `IconChevron<Direction><Small|Medium>` (`IconChevronDownSmall`, `IconChevronRightMedium`).
- Custom names follow the same pattern; toned file marks are `IconFileType<Language>` and `IconFolder[Open]<Kind>`.

### Spinner and other glyph-like pieces

- `Spinner` is on the icon scale and in the icon ink: a 16-unit viewBox, a full circle r 6.25 at stroke-opacity 0.3 (its track) and a quarter arc at full ink, both 1.5 wide with round caps, spinning with `animate-spin`. It takes `--icon-size` or `size`, and is `role="status"` with `aria-label="Loading"` by default. A button's spinner takes the button's icon size.
- `Checkbox` draws `IconCheckmark1Small` (or `IconMinusSmall` when indeterminate) at `sm`.
- Decorative icons are `aria-hidden` (the default); a meaningful icon gets `ariaLabel`, which makes it `role="img"`.

### Every icon name

<!-- design:icons -->

## 9. Motion

### The principle: state is instant, only motion eases

Every click and hover lands in the frame it happens, as in a Mac app. A hover, press or highlight wash, a text, border or icon colour change, a group seam and a control revealed on hover appear at once, with no transition. Transitions are only for things that move: a popup, dialog or sheet entering, a turning chevron, a sliding selection indicator, a height that opens or closes. Every state change also has a static cue (colour, icon, position), so motion is pure enhancement and can be removed wholesale.

- `transition-colors`, `transition-shadow`, a bare `transition`, or a colour property (`color`, `background-color`, `border-color`, `outline-color`, `box-shadow`, `fill`, `stroke`) inside `transition-[…]` on a line with a `hover:` or `active:` fails the lint, in the kit, the app and the catalog.
- **Never `transition-all`.** Name the properties.
- A colour that changes for a reason other than hover or press may ease: a chat run you jump to (`data-focused`), a review note being selected, a switch turning on.
- **Hover is colour, not motion.** No hover scale or translate.
- **A press is state too.** A control's fill lives on `::before` and deflates by a fixed inset, never a ratio, so every control presses the same whatever its width: `--press-inset-x: 1px`, `--press-inset-y: 0.5px` (`active:before:inset-x-(--press-inset-x) active:before:inset-y-(--press-inset-y)`, also under `data-[pressed]`). The label, icons and layout don't move. The `link` button has no fill, so its content scales to 0.975 on press; a checkbox scales to 0.95. All of these land in the frame of the press and lift in the frame of the release, never eased. A sliding highlight deflates by the same inset and holds its slide off while the press lands and lifts.

### Clocks and curves

| Role | Duration | Easing | Used by |
| --- | --- | --- | --- |
| State feedback | 0ms | | Hover, press, highlight, open fill, selection, colour, a revealed control |
| Movement | 200ms | `cubic-bezier(0.22, 1, 0.36, 1)` | The shared list highlight (`INDICATOR_TRANSITION`), the underline tab line, the default tab pill, `transition-disclosure` |
| Fold chevron (app composites) | 150ms (a chat run's chevron: 200ms) | Tailwind's default `cubic-bezier(0.4, 0, 0.2, 1)` | `SectionChevron`, `DisclosureHeader`'s chevron, the review index (`transition-[rotate] duration-150`, `-rotate-90` when closed); a chat run row's chevron (`transition-[rotate] duration-200`, `rotate-90` when open) |
| Height | 180ms default (240ms in the live card) | `cubic-bezier(0.22, 1, 0.36, 1)` | `SizeAnimator`: the command list as it filters, the live card's text swap |
| Menu and popover | 200ms | `tw-animate-css` default `ease` | `DropdownMenu`, `Popover`: `data-open:animate-in fade-in-0 zoom-in-95` plus an 8px slide from the trigger's side (`data-[side=bottom]:slide-in-from-top-2` etc.); `data-closed:animate-out fade-out-0 zoom-out-95` |
| Tooltip, preview card | 150ms | `ease` | Same fade and zoom from 95%; the tooltip also slides 8px from its trigger's side, the preview card does not; `data-instant` drops the animation |
| Select | 150ms | `ease-out` | Entry only, on the surface's `::before` so text lands at once: `fade-in-0 zoom-in-95` beside the trigger; over the trigger (side `none`) it grows from 0.975 in place with no fade. Closing is instant. |
| Dialog, alert dialog | 150ms in, 100ms out | `ease-out` | `DIALOG_MOTION`: opacity and scale from 0.96; the scrim fades with it (`DIALOG_SCRIM_MOTION`) |
| ⌘K | 75ms in, 75ms out | `ease-out` | `COMMAND_MOTION`: scale from 0.98 and opacity; its scrim in step |
| Sheet | 200ms | `ease-out` | `transition-[translate]` from fully off its side; its scrim fades over 150ms |
| Icon swap | 200ms | `cubic-bezier(0.2, 0, 0, 1)` | `iconSwap`: the copy button's clipboard to check |
| Switch | track 200ms, knob 150ms | `ease-out` | `transition-[background-color,box-shadow]` on the track, `transition-transform` on the knob |
| Scroll fade (fallback) | 150ms | `ease` | `scroll-fade` without scroll timelines |
| Overlay scrollbar | 200ms, after a 300ms delay; thumb opacity 150ms | default | `ScrollArea`: shows on hover or scroll, lingers 700ms, widens under the pointer |
| Spotlight | holds 1.5s, fades over 600ms | | `useSpotlight`: the row you jumped to keeps a `primary-a1` wash, then lets go |
| Focused or selected flash | 500ms | default | A chat line's `bg` and outline (`transition-[background-color,outline-color] duration-500`), a review note's outline, a review card's `bg-primary-a1` |
| Chat text swap | in 360ms after 80ms, out 240ms | `cubic-bezier(0.23, 1, 0.32, 1)` | The live card's latest line: in from 0.625rem below with 2px blur, out to 0.625rem above |
| Onboarding step | 420ms | `cubic-bezier(0.32, 0.72, 0, 1)` | The step you leave slides out to the left as the next slides in from the right (the other way back), the column's full width with no fade of their own; the track masks its 24px edges. The first step has no entry |
| Image viewer | 240ms open and close; swaps 200ms slide 10px or 150ms fade | `cubic-bezier(0.22, 1, 0.36, 1)`; swaps `cubic-bezier(0.23, 1, 0.32, 1)` | The flight from a thumbnail, backdrop and chrome fades; `SHRUNK` 0.96 |
| Toast | shake 350ms `cubic-bezier(0.36, 0.07, 0.19, 0.97)`; bump 300ms `ease-out`; loader out 200ms; result icon in 240ms `cubic-bezier(0.22, 1, 0.36, 1)` | | Sonner (stacking keeps Sonner's own 500ms) |
| Update button | 200ms | | Scales in: `animate-in fade-in-0 zoom-in-95 duration-200` |
| Shimmering text | 1s per cycle, characters staggered across it, a rest of 50ms per character between cycles, `easeInOut`; stops over 0.5s `easeOut` | | A running agent's line (`ShimmeringText`, `muted-foreground` to `foreground`) |
| Pulse | `animate-ping` at 60% opacity | | A status dot for work in progress (`motion-reduce:animate-none`) |
| Spinner | `animate-spin` (1s linear) | | Loading |

Easing rules: decelerating curves only. The movement curve `cubic-bezier(0.22, 1, 0.36, 1)` is the default for anything that slides or resizes; `cubic-bezier(0.23, 1, 0.32, 1)` is used for text and image swaps. Never `ease-in` and never `ease-linear` on UI (a spinner, a progress fill or a scroll-driven fade may be linear).

### Named constants

```ts
export const INDICATOR_TRANSITION = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out';

export const DIALOG_MOTION =
  'transition-[opacity,scale] duration-150 ease-out data-ending-style:duration-100 starting:scale-96 starting:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 motion-reduce:starting:scale-100 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100';
export const DIALOG_SCRIM_MOTION =
  'transition-opacity duration-150 ease-out data-ending-style:duration-100 starting:opacity-0 data-starting-style:opacity-0 data-ending-style:opacity-0';

const COMMAND_MOTION =
  'duration-75 data-ending-style:duration-75 starting:scale-98 data-starting-style:scale-98 data-ending-style:scale-98';
const COMMAND_SCRIM_MOTION = 'duration-75 data-ending-style:duration-75';

export const iconSwap = 'transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]';
export const iconSwapIn = 'scale-100 opacity-100 blur-none';
export const iconSwapOut = 'scale-[0.65] opacity-0 blur-[2px]';
```

- **Dialogs enter visibly.** A dialog mounted already open never gets Base UI's `data-starting-style`; the `starting:` variant (`@starting-style`) gives it the same entry. Each size has a fixed width (420px, `sm` 320px, ⌘K 520px), never one its content decides, so nothing that loads late changes it.
- **⌘K comes and goes in a blink** because you open it many times an hour. Both directions are written out (`duration-75 data-ending-style:duration-75`), since the dialog's `data-ending-style:duration-100` would otherwise win the close. It is merged over `DIALOG_MOTION`, and its scrim's class goes in through `DialogContent`'s `overlayClassName`.
- **The icon swap:** keep both icons mounted, stacked absolutely, and toggle each between `iconSwapIn` and `iconSwapOut`, so a swap mid-swap retargets. Both move at once over one duration.

Keyframes used by the app stylesheet:

```css
@keyframes chat-swap-in { from { opacity: 0; transform: translateY(0.625rem); filter: blur(2px); } }
@keyframes chat-swap-out { to { opacity: 0; transform: translateY(-0.625rem); filter: blur(2px); } }
.chat-swap-in { animation: chat-swap-in 360ms cubic-bezier(0.23, 1, 0.32, 1) 80ms both; }
.chat-swap-out { animation: chat-swap-out 240ms cubic-bezier(0.23, 1, 0.32, 1) both; }

@keyframes onboarding-in { from { transform: translateX(var(--onboarding-from)); } }
@keyframes onboarding-out { to { transform: translateX(var(--onboarding-to)); } }
.onboarding-track { mask-image: linear-gradient(to right, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent); }
.onboarding-in, .onboarding-in-back { animation: onboarding-in 360ms cubic-bezier(0.4, 0, 0.2, 1) both; will-change: transform; }
.onboarding-out, .onboarding-out-back { animation: onboarding-out 360ms cubic-bezier(0.4, 0, 0.2, 1) both; will-change: transform; pointer-events: none; }
.onboarding-in { --onboarding-from: calc(100% + 1.5rem); }
.onboarding-in-back { --onboarding-from: calc(-100% - 1.5rem); }
.onboarding-out { --onboarding-to: calc(-100% - 1.5rem); }
.onboarding-out-back { --onboarding-to: calc(100% + 1.5rem); }
@media (prefers-reduced-motion: reduce) {
  .onboarding-in, .onboarding-in-back, .onboarding-out, .onboarding-out-back { --onboarding-from: 0; --onboarding-to: 0; animation-duration: 1ms; }
  .onboarding-out, .onboarding-out-back { visibility: hidden; }
}

@keyframes bk-toast-shake { 0%, 100% { translate: 0 0; } 25% { translate: -2px 0; } 50% { translate: 2px 0; } 75% { translate: -1px 0; } }
@keyframes bk-toast-bump { 0%, 100% { scale: 1; } 50% { scale: 1.015; } }
[data-sonner-toast].bk-toast-shake { animation: bk-toast-shake 0.35s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
[data-sonner-toast].bk-toast-bump { animation: bk-toast-bump 0.3s ease-out; }
[data-sonner-toast].bk-toast .sonner-loader { width: 100%; height: 100%; transition: opacity 200ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1); }
[data-sonner-toast].bk-toast .sonner-loader[data-visible="false"] { opacity: 0; transform: scale(0.85) translate(-50%, -50%); }
@keyframes bk-toast-icon-in { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
[data-sonner-toast][data-styled="true"].bk-toast [data-icon] > svg {
  transform: none; transform-origin: center; animation: bk-toast-icon-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
```

### Highlights slide

Every list of rows you pick from shares one highlight surface that slides to the hovered or keyboard-highlighted row: `HighlightList` (rows marked `data-highlighted` by the primitive) or `HoverHighlight` (rows marked `data-highlight-item`, resting on the `data-active="true"` one), both on `useAnimatedIndicator`. The indicator is `pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0` with `will-change: transform, opacity; contain: layout paint; transform-origin: center`, inside a `relative isolate p-1` list.

- It moves only through `transform`: a translate, and a scale from the box it was laid out at when the next row is another size, so no frame of the slide lays out or paints. When a slide ends on a row of another size it is laid out once at that size and its scale returns to 1, so its corners never rest stretched.
- The item selected when the list mounts shows at once, with no fade or slide.
- A row draws no hover, highlighted or selected background of its own; it only changes its text colour (`data-indicator-here:text-fg-4`, `data-hovered`), in the frame it happens. The indicator mirrors the row's `data-variant`, so a destructive row can tint it.
- The indicator carries `data-slot="highlight-indicator"` and `data-motion="move"`, so a subtree that turns transitions off (the Code tab's file tree: `[&_*:not([data-motion=move])]:transition-none! [&_*::before]:transition-none! [&_*::after]:transition-none!`) spares it. A subtree that kills transitions without sparing `[data-motion=move]` fails the lint.
- It slides in every dropdown and context menu, `Select`, `Command` (⌘K and Go to file), the rail's nav, the queue, Home's lists, setup's option lists and task rows in popovers. The Code tab's trees and search results are instant on purpose.
- A row that draws its own highlight background, or an option or menu item rendered outside `HighlightList` / `HoverHighlight` in the app, fails the lint.

The default tab track's pill (`rounded-segment bg-background dark:bg-bg-4 shadow-1`) and the underline tabs' 2px line (`bg-primary`, `transition-[width,translate] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`) slide the same way.

### Delays and timing constants

| Constant | Value | What it times |
| --- | --- | --- |
| `TOOLTIP_DELAY` | 600ms | Pointer rest before a tooltip opens; every tooltip, no per-call delay (lint fails on one) |
| `TOOLTIP_SKIP_DELAY` | 400ms | After one closes, the next opens at once and without its entrance (`data-instant`) |
| `PreviewCard` open / close | 80ms / 120ms | `InfoPopover` on hover |
| `GROUP_GRACE_MS` / `SETTLE_MS` | 300ms / 90ms | Moving between grouped preview cards |
| `SAMPLE_WINDOW_MS` | 80ms | Pointer-intent path toward an open preview card |
| `LOADING_DELAY_MS` | 300ms | A wait stays empty this long before it shows a spinner, so a fast load never flashes |
| `HOVER_INTENT_MS` | 40ms | Hover before a page prefetches |
| `LONG_PRESS_MS` | 500ms | A long press opens a lazy menu |
| `LINGER_MS` | 700ms | The overlay scrollbar stays after scrolling stops |
| `SPOTLIGHT_HOLD_MS` / `SPOTLIGHT_FADE_MS` | 1500ms / 600ms | A jumped-to row's highlight |
| `HOLD_MS` / `HOLD_STEP_MS` | 1200ms / 100ms | Press-and-hold confirmation on the Review page |
| `DOUBLE_TAP_MS` | 300ms | Image viewer double tap |

### Reduced motion

Global and unlayered, so it beats Sonner's injected stylesheet and inline styles:

```css
@media (prefers-reduced-motion: reduce) {
  *:not(.animate-spin, [data-reduced-motion="fade"]),
  *:not(.animate-spin)::before,
  *:not(.animate-spin)::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- Exempt: `.animate-spin` (a spinner that stops stops saying "working"), and dialogs and their scrims (`data-reduced-motion="fade"`), which drop their scale (`motion-reduce:…:scale-100`) and keep their fade.
- Looping movement opts out explicitly too: `motion-reduce:animate-none` on the pulse, `motion-reduce:transition-none` on the tab line. `ShimmeringText` stops (reads `useReducedMotion`). The image viewer only fades: it animates through the Web Animations API, which the global reset does not reach, so it drops the flight from the thumbnail for a 240ms fade and swaps with a 150ms fade and no slide. An onboarding step's own rule (`--onboarding-shift: 0`, 160ms) loses to the global reset's `!important`, so under reduced motion a step appears at once.

### What never animates

- Any hover, press, highlight or selection colour, wash, border, seam or icon ink.
- A press (the deflate and the press scales land in one frame).
- A select closing: it is instant. (Menus and popovers are not on this list: they fade and zoom out over their 200ms.)
- A control revealed on hover (it appears at once).
- Layout properties during a slide (`width`, `height`, `top`, `left` of the highlight); only the indicator's `transform` and the tab line's `width` and `translate` move.
- The Code tab's trees and search results.
- The first frame of a list: the selected row's highlight is there at once.

## 10. Components

The kit's primitives first, then their hooks and helpers, then the composites Shinsa builds its screens from. Each
entry gives the exact classes; a screen that needs one of these shapes uses the component, never a copy.

### 10.1 Kit primitives

Every component below is a kit primitive: one export per part, each part stamped with a `data-slot` attribute so parents can style children by slot. Styles and tests key off these names, so a rebuild must keep them. Classes are merged with `cn()` (clsx plus a tailwind-merge that knows the theme's own radius tokens `control`, `control-sm`, `item`, `popup`, `segment`, shadow tokens `1`…`4`, `control`, `control-destructive`, `control-elevated`, `control-elevated-hover`, `control-knob`, `control-dot` and the leading token `tighter`), so a caller's `className` always wins over the part's own class of the same kind (`cn('rounded-control', 'rounded-popup')` keeps only `rounded-popup`). A caller's `className` is always merged last.

Values used throughout this section (defined in the tokens section, repeated here only as px so the tables read). Spacing uses the Tailwind v4 unit of 4px (`p-1` = 4px, `h-6.5` = 26px).

| Token | px |
| --- | --- |
| `text-2xs` | 12px, line-height 1.25 (15px) |
| `text-xs` | 13px, line-height 1.2 (15.6px) |
| `text-sm` | 14px, line-height 1.25 (17.5px) |
| `leading-tighter` | 1.15 |
| `leading-4` | 16px |
| `font-medium` | weight 450 (ABC Areal is variable) |
| `rounded-sm` / `rounded-segment` | 5px |
| `rounded-checkbox` | 4px |
| `rounded-control-sm` / `rounded-item` / `rounded-md` | 6px |
| `rounded-control` / `rounded-lg` | 7px |
| `rounded-xl` | 9px |
| `rounded-popup` | 10px |
| `rounded-3xl` | 15px |
| `--icon-size-sm` / `-md` / `-lg` | 14px / 16px / 20px |
| `--press-inset-x` / `--press-inset-y` | 1px / 0.5px |

Shared behaviour every part in this section obeys (Shinsa rules):

- **No focus states.** Nothing marks keyboard focus: no ring, outline, border recolour or wash. Every part sets `outline-none` (or `outline-hidden`) and none has a `focus-visible:` style.
- **State is instant.** Hover, press, highlight and colour changes land in the frame they happen, with no transition. Only things that move ease: dialogs entering and leaving, popups, the sliding highlight, height changes.
- **Hover is never the only feedback.** Every `hover:` class has the same value on `active:` on the same element.
- **Icons are sized by the primitive.** Button, Badge, menu rows and command rows set `--icon-size` for the glyphs inside them; a call site never passes `size` to an icon inside them. `Icon` draws every chevron (`IconChevron…`) at 14px whatever the context.
- **Icons draw in the icon ink paired with their text colour** (`text-fg-3` sets the `icon-3` ink, and so on); a tone (`text-red-4`, `text-primary-text`, white on a filled button) keeps its own colour for the icon.

#### MenuIcon (the `icon` prop shared by Button, Badge, menu and command rows)

`MenuIcon` is not a visible component. It is the type and two helpers behind the `icon` prop that `Button`, `Badge`, `DropdownMenuItem`, `CommandItem` and `SelectItem` take, so every primitive places an icon the same way.

**API**

```ts
type IconPosition = 'inline-start' | 'inline-end';
type MenuItemIcon = IconName | (IconProps & { position?: IconPosition });

function renderMenuIcon(icon: MenuItemIcon | undefined, wantedPosition: IconPosition): JSX.Element | null;
function menuIconPosition(icon: MenuItemIcon | undefined): IconPosition | undefined;
```

- A bare name (`icon='IconBell'`) is a leading icon (`inline-start`).
- An object (`icon={{ name: 'IconChevronDownMedium', position: 'inline-end' }}`) takes every `Icon` prop plus `position`; `position` defaults to `inline-start`.
- `menuIconPosition` returns `undefined` with no icon, else the side. The primitive writes it to `data-icon` on itself, which is what trims that side's padding.
- `renderMenuIcon(icon, side)` renders `<Icon {...props} />` only when the icon belongs on `side`, else `null`. The primitive calls it twice, before and after its children. `position` is stripped before it reaches the `<svg>`, so it never leaks as a DOM attribute.

Rebuilt without the library:

```tsx
function renderMenuIcon(icon, wanted) {
  if (!icon) return null;
  const props = typeof icon === 'string' ? { name: icon } : icon;
  const position = (typeof icon === 'string' ? 'inline-start' : icon.position) ?? 'inline-start';
  if (position !== wanted) return null;
  const { position: _drop, ...rest } = props;
  return <Icon {...rest} />;
}
```

Do: pass icons through `icon`, never as a hand-placed `<Icon>` child, so `data-icon` (and the padding trim) is set. Don't: pass `size` or a colour class inside the object; the primitive sets size and the text sets ink.

#### AlertDialog

**For:** a confirmation that interrupts: "Cancel this task?", "Remove this account?". It has the ARIA role `alertdialog`, and unlike `Dialog` a press outside it does not close it; only its two buttons and Escape do. In Shinsa every confirmation goes through one app composite, `ConfirmDialog`, built on these parts (title, one sentence, "Keep it" and a destructive action named verb plus object). **Not for:** forms or anything that takes input (use `Dialog`), information without a decision (use a toast or a popover).

Wraps Base UI `AlertDialog` (`@base-ui/react/alert-dialog`). Motion and scrim are shared with `Dialog` (`DIALOG_MOTION`, `DIALOG_SCRIM_MOTION`, below).

**Anatomy**

```
AlertDialog (Root, no DOM)
├─ AlertDialogTrigger (button)
└─ AlertDialogContent           → renders AlertDialogPortal > AlertDialogOverlay + Popup
   ├─ AlertDialogHeader
   │  ├─ AlertDialogTitle
   │  └─ AlertDialogDescription
   └─ AlertDialogFooter
      ├─ AlertDialogCancel      (Base UI Close rendered as a Button)
      └─ AlertDialogAction      (a plain Button; closes nothing by itself)
```

Exports: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`. `AlertDialogContent` always renders its own portal and overlay; never add them yourself.

**Props**

| Part | Props | Default |
| --- | --- | --- |
| `AlertDialog` | Base UI Root props: `open`, `defaultOpen`, `onOpenChange(open, details)`, `onOpenChangeComplete(open)` | uncontrolled, closed |
| `AlertDialogContent` | Base UI Popup props plus `size: 'default' \| 'sm'` | `size='default'` |
| `AlertDialogAction` | every `Button` prop (`variant`, `size`, `icon`, `loading`) | `variant='primary'`, `size='default'` (Button's defaults) |
| `AlertDialogCancel` | Base UI Close props plus `variant`, `size` | `variant='secondary'`, `size='default'` |

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| Overlay | `alert-dialog-overlay` (also `data-reduced-motion="fade"`) | `fixed inset-0 isolate z-50 bg-black/10 dark:bg-black/55` + `DIALOG_SCRIM_MOTION` |
| Content | `alert-dialog-content` (also `data-reduced-motion="fade"`, `data-size`) | `group/alert-dialog-content corner-superellipse/1.125 fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-xl bg-background p-4 text-fg-3 shadow-md outline-none data-[size=default]:w-[min(26.25rem,calc(100vw-2rem))] data-[size=sm]:w-[min(20rem,calc(100vw-2rem))]` + `DIALOG_MOTION` |
| Header | `alert-dialog-header` | `flex flex-col items-center gap-px text-center` |
| Footer | `alert-dialog-footer` | `flex w-full gap-2 *:flex-1` |
| Title | `alert-dialog-title` | `text-balance text-center font-medium text-fg-4 text-sm leading-tighter` |
| Description | `alert-dialog-description` | `text-pretty text-center text-fg-2 text-xs *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-fg-4 *:[a]:active:text-fg-4` |
| Action | `alert-dialog-action` | `Button` classes only |
| Cancel | `alert-dialog-cancel` | `Button` classes only |

**Geometry**

| | Value |
| --- | --- |
| Width, `default` | `min(420px, 100vw − 32px)`, fixed: never set by content, so text that loads late cannot change it |
| Width, `sm` | `min(320px, 100vw − 32px)` |
| Max height | `100dvh − 32px`, then the popup scrolls (`overflow-y-auto`) |
| Padding | 16px on every side |
| Gap between header, body and footer | 12px (`grid gap-3`) |
| Title to description | 1px (`gap-px`) |
| Footer button gap | 8px; every child `flex: 1`, so two buttons split the width evenly and one button spans it |
| Corner | 9px, superellipse 1.125 |
| Surface | `bg-background` (the page colour), `shadow-md` (in Shinsa this is the `bg-3` hairline, not a drop shadow) |
| Scrim | black at 10% in light, 55% in dark |
| Title | 14px medium `fg-4`, line-height 1.15, balanced |
| Description | 13px `fg-2`, pretty wrapping; a link inside is underlined 3px below the baseline and turns `fg-4` on hover and press |

**Motion:** identical to `Dialog`: 150ms in, 100ms out, fade plus scale from 0.96, `ease-out`; scrim fades in step. Reduced motion keeps only the fade.

**Composition rules**

- The footer is Cancel first (left), action second (right). In Shinsa's confirmations Cancel reads "Keep it" and the action is `variant='destructive'`, named for what it does ("Cancel task", "Remove account", "Delete schedule").
- `AlertDialogAction` is a plain `Button`: it does not close the dialog. Close it yourself (`onOpenChange(false)`) and run the destructive work once the exit animation has ended (`onOpenChangeComplete(false)`), so nothing visible changes while it fades.
- Mount a page's dialog from `useDialogState` (the `useDialogState`/`useHeldValue` hooks): `show(value)` opens, closing flips only `open`, the value is cleared on `onOpenChangeComplete`. Text that comes from outside the dialog goes through `useHeldValue(value, open)` so it cannot change during the exit.
- Header text is centred; there is no close X.

```tsx
<AlertDialog open={dialog.open} onOpenChange={dialog.control.onOpenChange} onOpenChangeComplete={onComplete}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Cancel this task?</AlertDialogTitle>
      <AlertDialogDescription>
        The running agent stops and its worktree is removed. The branch and any pull request stay on GitHub.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Keep it</AlertDialogCancel>
      <AlertDialogAction variant='destructive' onClick={() => dialog.control.onOpenChange(false)}>
        Cancel task
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Do: one sentence of what will happen in the description. Don't: put a form in it, add a third button, or style the action by hand.

#### Badge

**For:** a short status or label chip: "Default" on an account, a project's key, "Recommended" on an option, a count, a check result ("1 failing"). Non-interactive by default. **Not for:** an action (use `Button`), a keyboard key (use `Kbd`), a long sentence.

Built on Base UI `useRender` (so `render` can swap the element, e.g. `render={<a href=… />}`) and a CVA.

**Props**

| Prop | Values | Default |
| --- | --- | --- |
| `variant` | `default`, `purple`, `blue`, `sky`, `green`, `amber`, `orange`, `red`, `pink`, `solid` | `default` |
| `size` | `sm`, `default` | `default` |
| `icon` | `MenuItemIcon` (`'IconBell'` leads, `{ name, position: 'inline-end' }` trails) | none |
| `render` | element or render function | `<span>` |
| any `span` prop | | |

`data-slot="badge"` is set through `useRender`'s state.

**CVA**

Base:

```
group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap font-medium outline-none [&>svg]:pointer-events-none [&>svg]:shrink-0
```

| `variant` | Classes |
| --- | --- |
| `default` | `bg-bg-a1 text-fg-2` |
| `purple` | `selection-purple bg-purple-1 text-purple-text` |
| `blue` | `selection-blue bg-blue-1 text-blue-text` |
| `sky` | `selection-sky bg-sky-1 text-sky-text` |
| `green` | `selection-green bg-green-1 text-green-text` |
| `amber` | `selection-amber bg-amber-1 text-amber-text` |
| `orange` | `selection-orange bg-orange-1 text-orange-text` |
| `red` | `selection-red bg-red-1 text-red-text` |
| `pink` | `selection-pink bg-pink-1 text-pink-text` |
| `solid` | `selection-inverse bg-fg-4 text-background` |

| `size` | Classes | Height | Side padding | Padding on the icon's side | Type | Icon |
| --- | --- | --- | --- | --- | --- | --- |
| `sm` | `h-4.5 rounded-full px-1.5 text-2xs` | 18px | 6px | `pl-1` / `pr-1`: 4px | 12px medium | 14px |
| `default` | `h-5 rounded-full px-2 text-2xs` | 20px | 8px | `pl-1.5` / `pr-1.5`: 6px | 12px medium | 14px |

Icon-to-text gap is 4px (`gap-1`). The icon side trims 2px because a glyph's box carries empty space; trimmed, it sits optically level with the text edge. The corner is fully round.

**Colour rule:** each tone is its `-1` tint as the fill with its `-text` step on top; the `-4` step is a fill, never text (on its own tint it lands near 2:1). The `selection-*` utility makes selected text inside the chip take the chip's hue. An icon in a toned badge draws in the tone itself, not a lighter step.

**States:** none. No hover, press or focus style. A badge rendered as a link gets the link's behaviour, not a visual state.

Rebuild:

```css
.badge { display:inline-flex; width:fit-content; flex-shrink:0; align-items:center; justify-content:center;
  gap:4px; overflow:hidden; white-space:nowrap; font-weight:450; border-radius:9999px;
  height:20px; padding:0 8px; font-size:12px; line-height:1.25; --icon-size:14px; }
.badge[data-size=sm] { height:18px; padding:0 6px; }
.badge.icon-start { padding-left:6px; }   /* sm: 4px */
.badge.icon-end { padding-right:6px; }    /* sm: 4px */
.badge > svg { pointer-events:none; flex-shrink:0; }
```

Heights sit on the control ramp: `sm` 18px and `default` 20px (Shinsa's Badge 18/20).

```tsx
<Badge variant='green' icon='IconApiConnection'>Connected</Badge>
<Badge variant='red' size='sm'>1 failing</Badge>
<Badge size='sm'>Recommended</Badge>
```

Do: sentence case ("Default", "Recommended"), never all caps. Don't: restate the geometry in a wrapper, give it a hover, or print a status the icon beside it already says ("Done" next to a check), or put a checkmark in a green badge (checkmarks are the accent, never green).

#### Button

**For:** every pressable action and every trigger that looks like a button (menu triggers via `render={<Button … />}`). Wraps Base UI `Button` (`@base-ui/react/button`, a native `<button>`), styled with a CVA.

**Which variant** (Shinsa has exactly six):

| Variant | Use | Never |
| --- | --- | --- |
| `primary` (default) | the one filled accent action of a group: Approve, Save limit, Create project | two in one group |
| `secondary` | the only variant that sits beside a primary (Cancel, Back, Request changes); every icon-only button that isn't `bare`; every button on an already-filled surface (Settings shelf) | |
| `outline` | a standalone action or trigger with no primary near it (a picker, a menu button, "Try again" in an empty state) | next to a primary, except a decision or now card's alternatives (Review, Resume now, Check in now) |
| `destructive` | the confirming action of something irreversible; its companion is `secondary` | beside `outline` |
| `bare` | an icon-only quiet action inside a row that already has its own hover wash (a row's edit pencil) | anywhere a row doesn't wash |
| `link` | inline text action in `primary-text`, no box | |

**Props**

| Prop | Values | Default |
| --- | --- | --- |
| `variant` | `primary`, `secondary`, `outline`, `destructive`, `bare`, `link` | `primary` |
| `size` | `xs`, `sm`, `default`, `lg`, `icon-2xs`, `icon-xs`, `icon-sm`, `icon`, `icon-lg` | `default` |
| `icon` | `MenuItemIcon` | none |
| `loading` | boolean | `false` |
| `disabled`, `onClick`, `type`, `render`, every Base UI Button / `button` prop | | |

**Attributes it sets on itself**

| Attribute | When |
| --- | --- |
| `data-slot="button"` | always |
| `data-icon="inline-start"` / `"inline-end"` | it has children and an icon on that side; with `loading` and no icon, `inline-start`. Absent on icon-only buttons |
| `data-chevron=""` | it has children, is not loading, and the icon's name starts with `IconChevron` |
| `data-loading=""` + `aria-busy="true"` | `loading` |
| `data-disabled`, `disabled` | `disabled` (Base UI) |
| `data-pressed` | set by Base UI menu/select triggers that render through it, while pressed |

A button is icon-only when `children` is `undefined`, `null` or `false`; give it an `aria-label`.

**CVA base**

```
group/button relative isolate flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium
corner-superellipse/1.125
before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:content-['']
not-disabled:active:before:inset-x-(--press-inset-x) not-disabled:active:before:inset-y-(--press-inset-y)
not-disabled:data-[pressed]:before:inset-x-(--press-inset-x) not-disabled:data-[pressed]:before:inset-y-(--press-inset-y)
outline-none
disabled:cursor-not-allowed disabled:opacity-45 data-loading:pointer-events-none
[&_svg]:pointer-events-none [&_svg]:shrink-0
data-chevron:data-[icon=inline-end]:pr-[5px] data-chevron:data-[icon=inline-start]:pl-[5px] data-chevron:gap-0.5
```

(`disabled:` matches `:disabled` and `[data-disabled]`; `not-disabled:` is its negation.)

How the base works:

- **The fill and shadow live on `::before`**, not on the button. Pressing (`:active`, or `data-pressed` while a trigger is held) moves the `::before` in by a fixed 1px left and right and 0.5px top and bottom, so only the background deflates: label, icons and layout stay still. A fixed inset, never a ratio, so a full-width button presses exactly like a short one. No transition: the press lands in the frame it happens and lifts on release.
- **Disabled**: 45% opacity, `not-allowed` cursor, and every hover and press rule is gated by `not-disabled:`, so a disabled button is fully inert.
- **Chevrons**: a chevron is a tiny glyph in a roomy viewbox, so a button with a text label and a chevron icon gets 5px on the chevron's side and a 2px gap instead of the size's normal values. Chevrons draw at 14px in every size.

**Variants**

| `variant` | Classes |
| --- | --- |
| `primary` | `text-primary-foreground before:bg-primary before:shadow-control not-disabled:hover:before:bg-primary/80 not-disabled:active:before:bg-primary/80` |
| `secondary` | `text-fg-2 not-disabled:hover:text-fg-4 not-disabled:hover:before:bg-bg-a2/70 not-disabled:active:text-fg-4 not-disabled:active:before:bg-bg-a2/70` |
| `outline` | `text-fg-4 before:bg-background dark:before:bg-bg-3 before:shadow-control-elevated not-disabled:hover:before:shadow-control-elevated-hover not-disabled:active:before:shadow-control-elevated-hover not-disabled:active:before:bg-bg-1 not-disabled:data-[pressed]:before:bg-bg-1 dark:not-disabled:data-[pressed]:before:bg-bg-4 dark:not-disabled:active:before:bg-bg-4` |
| `destructive` | `text-white before:bg-red-4 before:shadow-control-destructive not-disabled:hover:before:bg-red-4/90 not-disabled:active:before:bg-red-4/90` |
| `bare` | `text-fg-2 before:hidden not-disabled:hover:text-fg-4 not-disabled:active:text-fg-4` |
| `link` | `text-primary-text before:hidden not-disabled:hover:opacity-80 not-disabled:active:opacity-80 px-0! [backface-visibility:hidden] [will-change:scale] not-disabled:active:scale-[0.975] not-disabled:data-[pressed]:scale-[0.975]` |

Per state, in words:

| Variant | Rest | Hover | Press | Icon ink |
| --- | --- | --- | --- | --- |
| `primary` | blue `primary` fill, white label, `shadow-control` (a 1px edge plus a white inner highlight on the top edge: the one shadow in the system) | fill at 80% | fill at 80% and deflated | white |
| `secondary` | no fill, `fg-2` label | `bg-a2` at 70% wash, `fg-4` label | same wash, deflated | `icon-2` at rest, `icon-4` on hover and press |
| `outline` | `background` fill (dark: `bg-3`), `shadow-control-elevated` ring | `shadow-control-elevated-hover` (fill unchanged) | fill `bg-1` (dark: `bg-4`), hover shadow, deflated; a menu trigger held open stays at the pressed fill | `icon-4` |
| `destructive` | `red-4` fill, white label, `shadow-control-destructive` | fill at 90% | fill at 90%, deflated | white |
| `bare` | no fill ever, `fg-2` glyph | `fg-4` | `fg-4` | `icon-2` then `icon-4` |
| `link` | `primary-text`, no padding, no box | 80% opacity | 80% opacity and the whole content scales to 0.975 (no background to deflate, so the content takes the press) | `primary-text` |

There is no open-popup style: a trigger whose menu is open looks like the button at rest (outline shows its pressed fill only while `data-pressed`).

**Sizes**

| `size` | Classes | Height | Side padding | Icon side | Gap | Type | Corner | Icon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `xs` | `h-5.5 gap-1 rounded-control-sm px-2 text-xs data-[icon=inline-end]:pr-1.5 data-[icon=inline-start]:pl-1.5` | 22px | 8px | 6px | 4px | 13px | 6px | 14px |
| `sm` | `h-6 gap-1 rounded-control-sm px-2 text-xs data-[icon=inline-end]:pr-1.5 data-[icon=inline-start]:pl-1.5` | 24px | 8px | 6px | 4px | 13px | 6px | 14px |
| `default` | `h-6.5 gap-1.5 rounded-control px-2.5 text-xs data-[icon=inline-end]:pr-2 data-[icon=inline-start]:pl-2` | 26px | 10px | 8px | 6px | 13px | 7px | 14px |
| `lg` | `h-7.5 gap-1.5 rounded-control px-3 text-sm data-[icon=inline-end]:pr-2.5 data-[icon=inline-start]:pl-2.5` | 30px | 12px | 10px | 6px | 14px | 7px | 14px |
| `icon-2xs` | `size-4.5 rounded-sm px-0` | 18×18 | 0 | | | | 5px | 14px |
| `icon-xs` | `size-5.5 rounded-control-sm px-0` | 22×22 | 0 | | | | 6px | 14px |
| `icon-sm` | `size-6 rounded-control-sm px-0` | 24×24 | 0 | | | | 6px | 14px |
| `icon` | `size-6.5 rounded-control px-0` | 26×26 | 0 | | | | 7px | 14px |
| `icon-lg` | `size-7.5 rounded-control px-0` | 30×30 | 0 | | | | 7px | 14px |

With a chevron icon beside a label, the chevron side is 5px and the gap 2px at every size. `icon-2xs` exists only for a close mark inside a 24px row (a terminal tab). Every size is the same at every viewport width.

**Loading** (`loading`): the button keeps its variant colours and its width, sets `aria-busy="true"` and `data-loading`, ignores pointer input (`pointer-events: none`) and cancels its own `click` (`event.preventDefault()`), so a busy submit cannot fire twice, by mouse, Enter or Space. It is **never** `disabled` (a busy button is working, not unavailable, so it does not fade). The icon on its side is replaced by a `Spinner` (an svg, `role="status"`, `aria-label="Loading"`, `size-(--icon-size)`, so the spinner takes the button's icon size); with no icon, the spinner leads (`data-icon="inline-start"`, so the left padding trims as if an icon were there). Exactly one svg is in the button while loading. The spinner keeps spinning under reduced motion.

**Rebuild without the library** (primary, default size):

```css
.btn { position:relative; isolation:isolate; display:flex; flex-shrink:0; align-items:center; justify-content:center;
  white-space:nowrap; user-select:none; cursor:pointer; font-weight:450; font-size:13px; line-height:1.2;
  height:26px; padding:0 10px; gap:6px; border-radius:7px; corner-shape:superellipse(1.125); outline:none;
  color:var(--primary-foreground); --icon-size:16px; }
.btn::before { content:''; position:absolute; inset:0; z-index:-1; pointer-events:none; border-radius:inherit;
  corner-shape:superellipse(1.125); background:var(--primary); box-shadow:var(--control-shadow); }
.btn:not(:disabled):hover::before, .btn:not(:disabled):active::before { background:color-mix(in oklab, var(--primary) 80%, transparent); }
.btn:not(:disabled):active::before, .btn:not(:disabled)[data-pressed]::before { inset:0.5px 1px; }
.btn:disabled { opacity:.45; cursor:not-allowed; }
.btn[data-loading] { pointer-events:none; }
.btn[data-icon=inline-start] { padding-left:8px; }
.btn[data-icon=inline-end] { padding-right:8px; }
.btn[data-chevron] { gap:2px; }
.btn[data-chevron][data-icon=inline-end] { padding-right:5px; }
.btn svg { pointer-events:none; flex-shrink:0; }
/* no transition on anything above */
```

```tsx
<Button icon='IconPlusMedium'>New task</Button>
<Button variant='secondary'>Cancel</Button>
<Button variant='outline' icon={{ name: 'IconChevronDownMedium', position: 'inline-end' }}>Superwall</Button>
<Button size='icon-sm' variant='secondary' icon='IconCrossMedium' aria-label='Close' />
<Button size='icon-sm' variant='bare' icon='IconPencil' aria-label='Edit' />
<Button type='submit' form={formId} loading={busy} disabled={!text.trim()}>Save limit</Button>
```

Do: one primary per group, `secondary` beside it; icons through `icon`; `loading` for pending work. Don't: hand-write `{busy ? <Spinner/> : …}`, set `disabled` while busy, give an icon inside a button a size, colour or opacity, put `outline` beside `primary` (a decision or now card's alternatives are the exception), or add a transition to any state.

#### Card

**For:** the kit's card shell: a rounded, hairline-ringed surface on the page. In Shinsa the app's cards almost always use the app's `CARD` surface constant or a composite on top of this shell (`SettingsCard` is `Card` with `gap-0 p-1.5`; setup's option list is `Card` with `gap-0 p-0` around a `HighlightList`). The header, title, description, action, content and footer parts are reference parts, shown in the kit's catalog page. **Not for:** a box nested inside a card or the chat column (that is an inset, a different recipe: `rounded-lg`, a 1px `border-border`, its own fill).

Plain `div`s, no primitive. `CardAction` adds a horizontal `ScrollFade` (16px) after itself.

**Anatomy**

```
Card
├─ CardHeader (divider?)
│  ├─ CardTitle
│  ├─ CardDescription
│  └─ CardAction        (+ a sibling ScrollFade, 16px, horizontal)
├─ CardContent
└─ CardFooter
```

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| `Card` | `card` | `group/card corner-superellipse/1.125 relative flex w-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground after:corner-superellipse/1.125 after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--bg-3)] after:content-['']` |
| `CardHeader` | `card-header` | `grid auto-rows-min items-start gap-px px-3 py-2.5 has-data-[slot=card-description]:grid-rows-[auto_auto] group-has-data-[slot=card-content]/card:pb-2.5 sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] sm:has-data-[slot=card-action]:gap-x-4` + `relative sm:[&>[data-slot=card-description]]:col-start-1 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:col-start-2 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:row-span-2 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:row-start-1 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:self-center` + `max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:[&>[data-slot=card-description]]:order-last max-sm:[&>[data-slot=card-title]]:w-auto max-sm:[&>[data-slot=card-title]]:min-w-0 max-sm:[&>[data-slot=card-title]]:flex-auto max-sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:max-w-full max-sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:overflow-x-auto max-sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:py-1`; with `divider`: `border-bg-3 [&:has(+_:not([data-slot=empty-state]))]:border-b` |
| `CardTitle` | `card-title` | `flex w-full items-center gap-1 font-medium text-fg-4 leading-tighter` |
| `CardDescription` | `card-description` | `w-full text-pretty text-fg-2 text-xs` |
| `CardAction` | `card-action` | `flex min-w-0 items-center` |
| `CardContent` | `card-content` | `flex flex-col gap-3 px-3 pb-3` |
| `CardFooter` | `card-footer` | `flex min-h-10 items-center justify-between border-bg-3 border-t px-3 py-1.5` |

**Geometry and behaviour**

- Corner 9px, superellipse 1.125, fill `bg-card` (the page white in light).
- **The ring is drawn on top.** The 1px `bg-3` edge is an inset box-shadow on `::after` at `z-index: 30` covering the card, so a sticky table column or any filled child can never paint over the card's edge. The card clips its children (`overflow: hidden`).
- `Card` itself has no padding and no gap; the parts pad themselves. A caller who uses the shell directly sets one padding for all four sides (`p-1.5` for a settings card, `p-3` for a body card).
- Header: 12px sides, 10px top and bottom; title over description 1px apart. With a `CardAction`, from 640px up the header is a two-column grid (`minmax(0,1fr) auto`, 16px column gap): title and description in column 1, the action in column 2 spanning both rows, vertically centred. Below 640px it becomes a wrapping flex row (12px gap): title flexes, the action follows it (scrolls sideways with a 4px top and bottom pad and a 16px scroll fade when it overflows), the description drops to the last line.
- `divider` draws a 1px `bg-3` line under the header only when the next sibling is not an `EmptyState` (an empty state under a header reads as one block).
- `CardTitle` sets weight, colour and leading but no font size: it inherits. Give it `text-xs` or `text-sm` from its context.
- Content: 12px sides and bottom, 12px between children. Footer: at least 40px tall, 12px sides, 6px top and bottom, a 1px `bg-3` line on top, children spread `justify-between`.

```tsx
<Card className='max-w-sm'>
  <CardHeader>
    <CardTitle className='text-sm'>Checks</CardTitle>
    <CardDescription>3 passing, 1 failing.</CardDescription>
    <CardAction>
      <Badge variant='red' size='sm'>1 failing</Badge>
    </CardAction>
  </CardHeader>
  <CardFooter>
    <span className='text-fg-2 text-xs'>Max. 100 characters</span>
    <Button size='xs'>Save</Button>
  </CardFooter>
</Card>
```

Do: one padding on all four sides; let the `::after` ring be the only edge. Don't: add a `border` to a card (the ring is already there), add a hover shadow, or nest a card in a card (use an inset).

#### Checkbox

**For:** a box the user ticks: a checklist row, a list of choices inside a popover ("Manage services"), a setting in a form row. **Not for:** a boolean inside a menu (that is `DropdownMenuCheckboxItem`, a trailing check, never a box or a switch), an on/off setting that applies at once (use `Switch`), a read-only state (use `ChecklistMark`).

Wraps Base UI `Checkbox` (`Checkbox.Root` + `Checkbox.Indicator`). Base UI sets `data-checked` / `data-unchecked`, `data-indeterminate`, `data-disabled`, `role="checkbox"` and `aria-checked`, and renders a hidden native input for forms. The indicator (the check glyph) is mounted only while checked or indeterminate.

**Props**

| Prop | Values | Default |
| --- | --- | --- |
| `size` | `sm` (14px box), `md` (16px box) | `md` |
| `variant` | `filled`, `outline` | `filled` |
| `indeterminate` | boolean | `false` |
| `checked`, `defaultChecked`, `onCheckedChange(checked, details)`, `disabled`, `name`, `id`, … | Base UI Root props | |

Sets `data-slot="checkbox"`, `data-variant`.

**Classes**

Root:

```
peer relative inline-grid shrink-0 place-items-center rounded-checkbox border border-icon-1 outline-none
not-data-disabled:cursor-pointer after:absolute after:-inset-1.5
not-data-disabled:not-data-checked:hover:border-fg-1 not-data-disabled:not-data-checked:active:border-fg-1
not-data-disabled:active:scale-95 not-data-disabled:[label:active_&]:scale-95
data-disabled:cursor-not-allowed data-disabled:opacity-45
```

| `variant` | Classes |
| --- | --- |
| `filled` | `bg-background text-primary-foreground data-checked:border-primary-4 data-checked:bg-primary-4 data-indeterminate:border-primary-4 data-indeterminate:bg-primary-4` |
| `outline` | `bg-transparent text-primary-foreground data-checked:border-primary-4 data-checked:bg-primary-4 data-indeterminate:border-primary-4 data-indeterminate:bg-primary-4` |

| `size` | Class | Box |
| --- | --- | --- |
| `sm` | `size-3.5` | 14×14 |
| `md` | `size-4` | 16×16 |

Indicator (`data-slot="checkbox-indicator"`): `absolute -inset-px grid place-items-center`, containing `<Icon name='IconCheckmark1Small' size='sm' />` (or `IconMinusSmall` when `indeterminate`), 14px, drawn in white (`text-primary-foreground` makes the icon ink white).

**States**

| State | Look |
| --- | --- |
| Unchecked | 4px corner, 1px `icon-1` edge, fill `background` (`filled`) or none (`outline`) |
| Unchecked hover / press | edge `fg-1` |
| Press (any) | the whole box scales to 0.95, also while its `<label>` is pressed; instant, no transition (a contentless control has no label to shift, so it scales fully) |
| Checked | edge and fill `primary-4`, white 14px check |
| Indeterminate | same fill, white 14px minus |
| Disabled | 45% opacity, `not-allowed` cursor, no hover or press |

- **The hit area reaches past the box**: `::after` with `inset: -6px`, so a 14px box has a 26px target and a 16px box a 28px target.
- **The glyph is centred over the whole box, border included** (`-inset-px` on the indicator): at 14px the inside is 12px, and a 14px glyph placed inside it would sit 1px right and low.
- The root has the `peer` class so a following sibling `Label` can read its disabled state (`peer-disabled:`).

Rebuild:

```css
.cb { position:relative; display:inline-grid; place-items:center; flex-shrink:0; width:16px; height:16px;
  border:1px solid var(--icon-1); border-radius:4px; background:var(--background); cursor:pointer; outline:none; }
.cb::after { content:''; position:absolute; inset:-6px; }
.cb:not([data-disabled]):not([data-checked]):is(:hover,:active) { border-color:var(--fg-1); }
.cb:not([data-disabled]):active, label:active .cb:not([data-disabled]) { scale:.95; }
.cb:is([data-checked],[data-indeterminate]) { border-color:var(--primary-4); background:var(--primary-4); }
.cb[data-disabled] { opacity:.45; cursor:not-allowed; }
.cb > .indicator { position:absolute; inset:-1px; display:grid; place-items:center; color:#fff; }
```

```tsx
<div className='flex items-center gap-2'>
  <Checkbox id='viewed' size='sm' checked={viewed} onCheckedChange={setViewed} />
  <Label htmlFor='viewed'>Viewed</Label>
</div>
```

Do: `sm` in dense rows and checklists, `outline` for a list of boxes inside a popover (a filled box on every row reads heavier than the rows). Don't: recolour the check, put a checkbox in a menu row, or draw a box by hand for a read-only state.

#### Checklist

**For:** anything that is a list of things to do, ticked or only shown: a merge's remaining steps, a release checklist, a Markdown task list (`- [ ]` / `- [x]`) in agent prose. One look everywhere; a hand-built list of checkboxes is a bug. The kit draws the rows; reading items, ticking them and any action a row offers belong to the app (Shinsa's `ChecklistBlock` and `ItemChecklist` composites render data items with markdown titles, a shell code block for a command, and a 14px `Checkbox` that waits for the save to finish).

Plain elements, no primitive.

**Anatomy**

```
ChecklistHeader (title, progress?)            ← optional, above the list
Checklist (ul)
└─ ChecklistItem (li; done, check)
   ├─ [checklist-check]   ← the `check` node: a Checkbox size='sm' or a ChecklistMark
   └─ [checklist-content]
      ├─ ChecklistTitle (meta?)
      ├─ ChecklistDetail
      └─ ChecklistActions
```

**Props**

| Part | Props |
| --- | --- |
| `Checklist` | `ul` props |
| `ChecklistHeader` | `title: ReactNode` (required), `progress?: ReactNode`, `div` props |
| `ChecklistItem` | `done: boolean` (required), `check: ReactNode` (required), `li` props |
| `ChecklistTitle` | `meta?: ReactNode`, `div` props; children are the title |
| `ChecklistDetail` | `div` props |
| `ChecklistActions` | `div` props |
| `ChecklistMark` | `done: boolean` (required), `label?: string` (default `'Done'` when done, else `'Not done'`), `span` props |

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| `Checklist` | `checklist` | `flex flex-col gap-3` |
| `ChecklistHeader` | `checklist-header` | `flex items-baseline justify-between gap-3`; title span `font-medium text-fg-4 text-xs leading-5`; progress span (only when `progress !== undefined`) `text-2xs text-fg-2 tabular-nums` |
| `ChecklistItem` | `checklist-item`, `data-done` when done | `flex gap-2.5` |
| check column | `checklist-check` | `flex h-5 shrink-0 items-center` |
| content column | `checklist-content` | `flex min-w-0 flex-1 flex-col gap-1` |
| `ChecklistTitle` | `checklist-title` | `flex min-w-0 flex-wrap items-center gap-x-2 gap-y-px`; title span `font-medium in-data-done:text-fg-3 text-fg-4 text-xs leading-5`; meta span (only when `meta` is truthy) `flex items-center gap-1 text-2xs text-fg-2` |
| `ChecklistDetail` | `checklist-detail` | `text-fg-3 text-xs` |
| `ChecklistActions` | `checklist-actions` | `flex flex-col items-start gap-1.5` |
| `ChecklistMark` | `checklist-mark`, `data-done`, `role="img"`, `aria-label` | `relative inline-grid size-3.5 shrink-0 place-items-center rounded-checkbox border border-icon-1 bg-background text-primary-foreground data-done:border-primary-4 data-done:bg-primary-4`; when done a child `span.absolute.-inset-px.grid.place-items-center` holding `<Icon name='IconCheckmark1Small' size='sm' aria-hidden />` |

**Geometry**

| | Value |
| --- | --- |
| Rows apart | 12px |
| Check to content | 10px |
| Check column | 20px tall (the title's line height), check centred in it, so the check sits on the title's first line even when the title wraps |
| Title | 13px medium on a 20px line, `fg-4`; `fg-3` once the row is done |
| Meta (the row's kind: "Config", "Deploy") | 12px `fg-2`, 8px after the title, wraps under it when narrow (1px row gap), icons in it 4px from text |
| Content rows (title, detail, actions) | 4px apart |
| Detail | 13px `fg-3` |
| Actions | stacked, left-aligned, 6px apart |
| Header | title 13px medium `fg-4` on a 20px line left; progress 12px `fg-2` tabular right ("1 of 2 done", "All done"); baseline-aligned, 12px min gap |
| `ChecklistMark` | the 14px compact checkbox drawn without a control: 4px corner, 1px `icon-1` edge, `background` fill; done: `primary-4` edge and fill with a white 14px `IconCheckmark1Small`. Named "Done" / "Not done" for screen readers |

A Markdown task list renders as these rows, read-only, with `ChecklistMark`s, nested content kept, rows 4px apart (`gap-1`) instead of 12px, and the mark lined up with the first line through a `1lh` tall check column. Nothing in Markdown ticks.

```tsx
<ChecklistHeader title='Release' progress='1 of 2 done' />
<Checklist>
  <ChecklistItem done check={<Checkbox size='sm' checked onCheckedChange={(next) => tick(item, next === true)} />}>
    <ChecklistTitle meta='Config'>Set the region</ChecklistTitle>
    <ChecklistDetail>eu-west-1 for every service.</ChecklistDetail>
  </ChecklistItem>
  <ChecklistItem done={false} check={<ChecklistMark done={false} />}>
    <ChecklistTitle>Rotate the key</ChecklistTitle>
    <ChecklistActions>
      <Button size='xs' variant='secondary'>Run</Button>
    </ChecklistActions>
  </ChecklistItem>
</Checklist>
```

Do: a `Checkbox size='sm'` when the row can be ticked, `ChecklistMark` when it cannot; a disabled box says why in its tooltip. Don't: strike through done titles (they step down to `fg-3`), or hand-build rows.

#### Command

**For:** a searchable list of commands: the command menu (⌘K), Go to file (⌘P). Built on cmdk (`Command as CommandPrimitive`), with the kit's sliding highlight and height animation, and `CommandDialog` on the kit's `Dialog`. **Not for:** a value picker in a form (use `Select`), a menu of actions on one object (use `DropdownMenu`).

cmdk attributes it relies on: `[cmdk-item]` with `data-selected="true"` on the highlighted row and `data-disabled="true"` on disabled rows (disabled rows are skipped by the keyboard), `[cmdk-group]` (gets `hidden` when every row in it is filtered out), `[cmdk-group-heading]`.

**Anatomy**

```
CommandDialog (Dialog + DialogContent, sr-only title and description)
└─ Command (cmdk root, loop)
   ├─ CommandInput (start?, end?)        → wrapper div > [search icon][start][input][end]
   ├─ CommandList (page?)                → SizeAnimator > cmdk List > [highlight indicator] + children
   │  ├─ CommandEmpty
   │  ├─ CommandGroup (heading)
   │  │  └─ CommandItem (icon?, variant?)
   │  │     ├─ label (a Truncate in Shinsa)
   │  │     ├─ CommandHint
   │  │     └─ CommandShortcut (keys) / trailing check / chevron
   │  └─ CommandSeparator
   └─ CommandFooter
```

**Props**

| Part | Props | Default |
| --- | --- | --- |
| `Command` | cmdk root props (`value`, `onValueChange`, `filter`, `shouldFilter`, `loop`) | `loop` on (Shinsa's ⌘K passes `loop={false}`) |
| `CommandDialog` | Dialog Root props, `title`, `description`, `className`, `finalFocus`, `children` | `title='Command menu'`, `description='Search for a page or an action.'` |
| `CommandInput` | cmdk Input props, `start?: ReactNode`, `end?: ReactNode` | |
| `CommandList` | cmdk List props, `page?: string` | |
| `CommandItem` | cmdk Item props (`value`, `keywords`, `onSelect`, `disabled`), `icon?: MenuItemIcon`, `variant?: 'default' \| 'destructive'` | `variant='default'` |
| `CommandShortcut` | `keys: string[]`, `className?` | |
| `CommandEmpty`, `CommandGroup` (`heading`, `value`), `CommandSeparator`, `CommandHint` (`span`), `CommandFooter` (`div`) | | |

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| `Command` | `command` | `flex h-full w-full flex-col overflow-hidden bg-popover text-popover-foreground` |
| `CommandDialog` content | (`dialog-content`) | `DialogContent` classes, then `top-[max(3rem,14vh)] w-[min(32.5rem,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden rounded-popup bg-popover p-0 *:data-[slot=command]:bg-transparent` + `COMMAND_MOTION`; scrim gets `COMMAND_SCRIM_MOTION` through `overlayClassName` |
| input wrapper | `command-input-wrapper` | `flex h-10 shrink-0 items-center gap-2 border-bg-3 border-b px-3` |
| search icon | | `<Icon name='IconMagnifyingGlass' size='md' className='text-fg-2' />` |
| input | `command-input` | `min-w-0 flex-1 bg-transparent font-medium text-fg-4 text-xs outline-none placeholder:font-normal placeholder:text-fg-2 disabled:cursor-not-allowed disabled:opacity-50` |
| list | `command-list` | `scrollbar-hide relative isolate max-h-[min(--spacing(96),60dvh)] scroll-py-1 overflow-y-auto overscroll-contain p-1` |
| highlight | `highlight-indicator`, `data-motion="move"`, `aria-hidden` | `pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0 data-[variant=destructive]:bg-red-a2`; style `will-change: transform, opacity; contain: layout paint; transform-origin: center` |
| `CommandEmpty` | `command-empty` | `py-6 text-center text-fg-2 text-xs` |
| `CommandGroup` | `command-group` | `scroll-my-1 overflow-hidden [&_[cmdk-group-heading]]:select-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-2 [&_[cmdk-group-heading]]:text-xs [[cmdk-group]:not([hidden])~&]:mt-1` |
| `CommandSeparator` | `command-separator` | `-mx-1 my-1 h-px bg-bg-3` |
| `CommandItem` | `command-item`, `data-icon`, `data-variant` | `relative flex cursor-pointer select-none items-center gap-1.5 rounded-item py-1 pr-2 pl-2 font-medium text-fg-3 text-xs leading-4 outline-hidden [--icon-size:var(--icon-size-sm)] data-[disabled=true]:pointer-events-none data-indicator-here:text-fg-4 data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none` + `data-[variant=destructive]:text-red-4/90 data-[variant=destructive]:data-indicator-here:text-red-4 data-[variant=destructive]:[--icon-color:currentColor]` |
| `CommandHint` | `command-hint` | `truncate font-normal text-fg-2` |
| `CommandShortcut` | `command-shortcut` | a `KbdGroup` with `ml-auto pl-3`, one `Kbd` per key |
| `CommandFooter` | `command-footer` | `flex h-7 shrink-0 items-center gap-3 border-bg-3 border-t px-3 text-fg-2 text-xs [&_kbd]:bg-bg-2` |

**Geometry**

| | Value |
| --- | --- |
| Dialog width | `min(520px, 100vw − 32px)`, fixed |
| Dialog top | `max(48px, 14vh)` from the viewport top, not vertically centred (`translate-y-0`) |
| Dialog corner | 10px (`rounded-popup`), superellipse 1.125; surface `bg-popover` (page white in light, `bg-2` in dark), `shadow-md` hairline, no padding |
| Input row | 40px tall, 12px sides, 8px gaps, 1px `bg-3` line under it; 16px magnifying glass in `icon-2`; query 13px medium `fg-4`, placeholder 13px regular `fg-2` |
| List | 4px padding, max height `min(384px, 60dvh)`, scrolls with no visible scrollbar, overscroll contained, keeps 4px scroll padding so a row scrolled into view clears the edge |
| Group heading | 8px sides, 4px top and bottom, 13px medium `fg-2`; a group after a visible group sits 4px lower |
| Row | 24px (4px + 16px line + 4px), 8px sides, 6px icon gap, 6px corner, 13px medium `fg-3`, icon 14px in `icon-3`. Highlighted: `fg-4` text and `icon-4` ink over the shared `bg-a2` highlight. Disabled: 50% opacity, no pointer |
| Destructive row | text `red-4` at 90%, full `red-4` while highlighted; icon in the same colour; the highlight under it turns `red-a2` |
| Hint | regular-weight `fg-2`, truncates; 6px after the label (row gap) |
| Shortcut | right edge, at least 12px from what precedes it, keys 4px apart |
| Separator | full-bleed across the list padding, 1px `bg-3`, 4px above and below |
| Empty | 24px top and bottom, centred 13px `fg-2` |
| Footer | 28px, 12px sides, 12px gap, 13px `fg-2`, 1px `bg-3` line on top; keys inside on `bg-2` |

**Motion**

- `COMMAND_MOTION` = `duration-75 data-ending-style:duration-75 starting:scale-98 data-starting-style:scale-98 data-ending-style:scale-98`, merged over `DIALOG_MOTION`: ⌘K opens many times an hour, so it comes in over 75ms from a scale of 0.98 plus opacity and leaves over 75ms. Both directions are written out because the dialog's `data-ending-style:duration-100` would otherwise win the close.
- `COMMAND_SCRIM_MOTION` = `duration-75 data-ending-style:duration-75`, so the scrim fades in step.
- Reduced motion keeps only the fade (the dialog's `motion-reduce:*:scale-100` rules still apply).
- **Height**: `CommandList` sits in a `SizeAnimator`: an outer `overflow-hidden` div whose pixel height transitions over 180ms `cubic-bezier(0.22, 1, 0.36, 1)` to its inner div's measured height (ResizeObserver); the first measurement snaps without a transition. So filtering grows and shrinks the menu instead of snapping.
- **Highlight**: one indicator slides to the row with `data-selected="true"` (see `HighlightList` for the mechanics: transform only, 200ms `cubic-bezier(0.22, 1, 0.36, 1)`, opacity 120ms `ease-out`, press deflate). It mirrors the row's `data-variant`, which is how a destructive row tints it.
- **Pages** (`page`): pass a string that changes when the list shows another nested page (Shinsa passes the breadcrumb path, `'root>settings>theme'`). Entering a new page scrolls the list to the top; going back restores the scroll that page had. The indicator is held where it was on screen during the scroll jump (its transform shifted by the scroll delta with transitions off), so it slides from there to the new page's highlighted row instead of travelling through the list. One animation frame later the highlighted row is scrolled into view (`block: 'nearest'`), because cmdk does not scroll a controlled value into view itself.

**Composition rules (Shinsa's ⌘K)**

- Rows are 24px; icons are plain glyphs, never on a tile. Label first as a `Truncate` (`min-w-0`), then a `CommandHint` (`min-w-12 shrink-[4]`, so the hint gives way before the label), then a status or trailing mark at the right edge (`ms-auto`): a 14px check in `primary` on the current value, `IconChevronRightMedium` on a row that opens a page or a choice, `IconArrowUpRight` on an external link.
- A trailing status is `ms-auto shrink-0 ps-3 font-normal text-fg-2`.
- A disabled row always says why: its reason replaces its hint.
- `CommandInput` `start` holds the crumb of the current page: `-ms-1 inline-flex h-5.5 min-w-0 max-w-48 shrink-0 items-center rounded-control-sm bg-bg-2 px-1 font-medium text-fg-3 text-xs` (22px tall, 192px max, 4px sides, the text truncating), placed so its text sits as far from the search icon as the query does. `end` holds `<Kbd>esc</Kbd>`. Backspace on an empty input goes back a page.
- The app menu has no footer; `CommandFooter` is for inline specimens and pickers that show key hints.
- `CommandDialog`'s title and description are visually hidden but always present for screen readers; pass a description that says what this menu does.
- Closing resets to the root after the exit has finished (`onOpenChangeComplete(false)`), never while it fades. `finalFocus` lets a command that moves focus decline the restore.

```tsx
<CommandDialog open={open} onOpenChange={setOpen} description='Act on the task in front of you, jump anywhere, or start a new task.'>
  <Command loop={false} value={selected} onValueChange={setSelected}>
    <CommandInput placeholder='Search tasks, or describe new work…' end={<Kbd>esc</Kbd>} />
    <CommandList page={pagePath}>
      <CommandEmpty>No matches.</CommandEmpty>
      <CommandGroup heading='Go to'>
        <CommandItem icon='IconInboxEmpty' onSelect={goHome}>
          <Truncate className='min-w-0'>Needs you</Truncate>
        </CommandItem>
        <CommandItem icon='IconSettingsGear4Filled' disabled>
          <Truncate className='min-w-0'>Desktop app</Truncate>
          <CommandHint className='min-w-12 shrink-[4]'>Soon</CommandHint>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading='This task'>
        <CommandItem icon='IconMagnifyingGlass' onSelect={openGoToFile}>
          <Truncate className='min-w-0'>Go to file</Truncate>
          <CommandShortcut keys={['⌘', 'P']} />
        </CommandItem>
        <CommandItem icon='IconTrashCan' variant='destructive' onSelect={openCancelPage}>Cancel task</CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
</CommandDialog>
```

Do: icons through `icon`, and only a shortcut that exists (⌘P for Go to file, which works on the Code tab). The kit's `CommandShortcut` (one `Kbd` per key) and `CommandSeparator` appear only on the catalog page: Shinsa's own ⌘K menu has no separators and shows a view's key as plain trailing text ("⌘F") in the row's muted ink. Don't: give a row its own hover or selected background (the shared highlight draws it), or animate the dialog at the dialog's pace.

#### ContextMenu

**For:** the right-click (and long-press) menu on a row: All tasks' task rows. Its items are exactly the dropdown's. **Not for:** a menu opened by a visible button (use `DropdownMenu`).

The kit exports only the root and trigger, wrapping Base UI `ContextMenu`:

| Export | Wraps | `data-slot` |
| --- | --- | --- |
| `ContextMenu` | `ContextMenu.Root` | `context-menu` |
| `ContextMenuTrigger` | `ContextMenu.Trigger` | `context-menu-trigger` |

The popup and rows are `DropdownMenuContent` and the `DropdownMenu*` items (Base UI's context menu reuses the menu's portal, positioner, popup and items), so a context menu looks and behaves exactly like a dropdown: same surface, same 24px rows, same sliding highlight, same entry animation. It opens at the pointer; `DropdownMenuContent`'s defaults (`side='bottom'`, `align='start'`, `sideOffset={4}`) put its top-left corner 4px below the pointer, growing down and right, flipping at viewport edges.

**Composition rules**

- A row that carries a context menu usually also has a dropdown with the same items (the `•••` trigger). Both read one item list, so every action carries the same label and icon in both.
- A long list of rows mounts no menu until one is asked for. Shinsa's `LazyMenu` composite renders only the trigger with the closed menu's attributes (`data-slot="context-menu-trigger"`, and `-webkit-touch-callout: none` so a long press does not open the system callout) until a right click, a long press (500ms, cancelled by a move of more than 10px), a click or an ArrowUp/ArrowDown asks for it; then it mounts `ContextMenu`, and replays that same event on the trigger so the menu opens where and how it was asked.

```tsx
<ContextMenu>
  <ContextMenuTrigger render={<div className='…row classes…' />}>{row}</ContextMenuTrigger>
  <DropdownMenuContent className='min-w-48'>
    <DropdownMenuItem icon='IconArrowRight'>Open</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant='destructive' icon='IconTrashCan'>Cancel task</DropdownMenuItem>
  </DropdownMenuContent>
</ContextMenu>
```

#### Dialog

**For:** a focused task in a window over the page: a form that takes a typed value (a percentage, a delegation limit, a sign-in code, a new project), a short read (keyboard shortcuts). **Not for:** a yes/no confirmation (use `AlertDialog` through `ConfirmDialog`), a side panel (use `Sheet`), the command menu (use `CommandDialog`), hover information (use a popover).

Wraps Base UI `Dialog` (`@base-ui/react/dialog`). Base UI sets `data-starting-style` on the first frame of opening and `data-ending-style` while closing, closes on Escape and on a press outside, and traps focus.

**Anatomy**

```
Dialog (Root)
├─ DialogTrigger
└─ DialogContent (showCloseButton?, overlayClassName?)   → DialogPortal > DialogOverlay + Popup
   ├─ DialogHeader
   │  ├─ DialogTitle
   │  └─ DialogDescription
   ├─ (body: a <form className='w-full'> with Fields)
   ├─ DialogFooter (showCloseButton?)
   │  ├─ DialogClose render={<Button variant='secondary' />}
   │  └─ Button (primary, type='submit', form=…)
   └─ DialogCloseButton          (when showCloseButton)
```

Exports: `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogCloseButton`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, and the motion strings `DIALOG_MOTION`, `DIALOG_SCRIM_MOTION`.

**Props**

| Part | Props | Default |
| --- | --- | --- |
| `Dialog` | `open`, `defaultOpen`, `onOpenChange`, `onOpenChangeComplete`, `modal`, … | |
| `DialogContent` | Popup props, `showCloseButton?: boolean`, `overlayClassName?: string`, `initialFocus`, `finalFocus` | `showCloseButton=false` |
| `DialogFooter` | `div` props, `showCloseButton?: boolean` (appends a `secondary` "Close") | `false` |
| `DialogCloseButton` | Close props, `className` | |

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| Overlay | `dialog-overlay`, `data-reduced-motion="fade"` | `fixed inset-0 isolate z-50 bg-black/10 dark:bg-black/55` + `DIALOG_SCRIM_MOTION` + `overlayClassName` |
| Content | `dialog-content`, `data-reduced-motion="fade"` | `corner-superellipse/1.125 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(26.25rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 overflow-y-auto rounded-xl bg-background p-4 text-fg-3 shadow-md outline-none` + `DIALOG_MOTION` |
| `DialogCloseButton` | `dialog-close`, `aria-label="Close"` | `Button variant='secondary' size='icon-sm'` with `absolute top-3 right-3`, child `<Icon name='IconCrossMedium' />` (14px) |
| Header | `dialog-header` | `flex w-full flex-col items-center gap-px text-center` |
| Footer | `dialog-footer` | `flex w-full gap-2 *:flex-1` |
| Title | `dialog-title` | `text-balance text-center font-medium text-fg-4 text-sm leading-tighter` |
| Description | `dialog-description` | `text-pretty text-center text-fg-2 text-xs *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-fg-4 *:[a]:active:text-fg-4` |
| `DialogClose`, `DialogTrigger`, `DialogPortal` | `dialog-close`, `dialog-trigger`, `dialog-portal` | none |

**Geometry**

| | Value |
| --- | --- |
| Width | `min(420px, 100vw − 32px)`, fixed from the first frame; never set by content |
| Max height | `100dvh − 32px`, then scrolls |
| Position | centred on both axes |
| Padding | 16px |
| Children | a centred column, 12px apart |
| Corner | 9px superellipse 1.125, `bg-background`, `shadow-md` (the hairline) |
| Title / description | 14px medium `fg-4` (line-height 1.15) over 13px `fg-2`, 1px apart, centred; the description is the quiet context two steps under the title, its links `fg-4` on hover |
| Footer | full width, buttons split it evenly, 8px apart |
| Close X | 24px `secondary` icon button 12px from the top and right edges, 14px cross, named "Close", no tooltip (the X says it) |
| Scrim | black 10% (light) / 55% (dark), no blur |

**Motion**

```
DIALOG_MOTION = 'transition-[opacity,scale] duration-150 ease-out data-ending-style:duration-100
  starting:scale-96 starting:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0
  data-ending-style:scale-96 data-ending-style:opacity-0
  motion-reduce:starting:scale-100 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100'

DIALOG_SCRIM_MOTION = 'transition-opacity duration-150 ease-out data-ending-style:duration-100
  starting:opacity-0 data-starting-style:opacity-0 data-ending-style:opacity-0'
```

- In: 150ms, opacity 0 → 1 and scale 0.96 → 1, `ease-out` (Tailwind's `cubic-bezier(0, 0, 0.2, 1)`; the theme does not override it). Out: 100ms to opacity 0 and scale 0.96.
- `starting:` (CSS `@starting-style`) covers a dialog that mounts already open, which never receives Base UI's `data-starting-style`; without it such dialogs appeared in one frame.
- Reduced motion: the global reset spares elements with `data-reduced-motion="fade"`, and the `motion-reduce:` rules hold scale at 1, so dialogs and scrims keep only their fade.

Plain CSS:

```css
.dialog { transition-property: opacity, scale; transition-duration: 150ms; transition-timing-function: cubic-bezier(0,0,0.2,1); }
@starting-style { .dialog { opacity: 0; scale: .96; } }
.dialog[data-starting-style], .dialog[data-ending-style] { opacity: 0; scale: .96; }
.dialog[data-ending-style] { transition-duration: 100ms; }
@media (prefers-reduced-motion: reduce) {
  .dialog, .dialog[data-starting-style], .dialog[data-ending-style] { scale: 1; }
  @starting-style { .dialog { scale: 1; } }
}
```

**Composition rules**

- A dialog that takes a typed value is one pattern: header (title, one-sentence description), the field in a `<form className='w-full'>` (Enter submits), and a footer of `DialogClose render={<Button variant='secondary' />}` "Cancel" then a primary submit button named for what it does ("Save limit"), wired with `type='submit' form={formId}`. A value the dialog can check itself shows as the field's `FieldError`; a value the server refuses comes back as an error toast and stays in the field. The submit button shows `loading` while saving and the dialog closes only on success.
- A page's dialog mounts from `useDialogState` and closes without a visible change (see `AlertDialog`).
- `showCloseButton` only for a dialog without a footer (a read-only panel).

```tsx
<Dialog {...dialog.control}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delegations at once</DialogTitle>
      <DialogDescription>How many agents a step may have working for it at once, counting the ones they delegate to.</DialogDescription>
    </DialogHeader>
    <form id={formId} className='w-full' onSubmit={onSubmit}>
      <Field data-invalid={invalid || undefined}>
        <Input aria-label='Delegations' inputMode='numeric' aria-invalid={invalid || undefined} value={text} onChange={onChange} />
        {invalid && <FieldError>Enter a whole number of 1 or more.</FieldError>}
      </Field>
    </form>
    <DialogFooter>
      <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
      <Button type='submit' form={formId} loading={busy}>Save limit</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Do: fixed width, one primary. Don't: let content set the width, put a tooltip on the close X, or change anything inside while it closes.

#### DropdownMenu

**For:** a click-opened list of actions or choices: the `•••` menu of a task, a project, an account; the Focus menu; a priority picker with actions. Also every context menu's popup. **Not for:** a form value with no actions (use `Select`), information on hover (use an info popover), a search (use `Command`).

Wraps Base UI `Menu` (`@base-ui/react/menu`). Base UI sets `data-highlighted` on the item under the pointer or keyboard, `data-open` / `data-closed` and `data-side` on the popup, `data-popup-open` on an open sub-menu trigger, `data-disabled`, `data-checked`, and the CSS variables `--available-height`, `--anchor-width`, `--transform-origin` on the positioner.

**Anatomy**

```
DropdownMenu (Root, open state controllable)
├─ DropdownMenuTrigger (render={<Button variant='outline' />} or an OptionsTrigger)
└─ DropdownMenuContent (Portal > Positioner > Popup > HighlightList)
   ├─ DropdownMenuGroup
   │  ├─ DropdownMenuLabel (inset?)
   │  ├─ DropdownMenuItem (icon?, variant?, inset?)
   │  │  └─ DropdownMenuShortcut
   │  └─ DropdownMenuSub
   │     ├─ DropdownMenuSubTrigger (inset?)
   │     └─ DropdownMenuSubContent
   ├─ DropdownMenuSeparator
   ├─ DropdownMenuCheckboxItem (checked)
   └─ DropdownMenuRadioGroup (value)
      └─ DropdownMenuRadioItem (value)
```

Exports also `DropdownMenuPortal` and the class string `DESTRUCTIVE_ITEM` (reused by `CommandItem`).

**Open behaviour**

- `DropdownMenu` keeps its own open state through `useControllableOpen`: controlled when `open` is passed (the caller owns it and only hears about changes), uncontrolled otherwise (from `defaultOpen`); every change reports through `onOpenChange(open, details)`.
- **It opens on click, not on mousedown.** The trigger blocks Base UI's mousedown handler (`preventBaseUIHandler()`) and toggles on `click`, reporting `reason: 'trigger-press'`, so it behaves like a button and the press deflate shows first.

**Content props**

| Prop | Default |
| --- | --- |
| `side` | `'bottom'` |
| `align` | `'start'` |
| `sideOffset` | `4` (px) |
| `alignOffset` | `0` |
| `anchor` | the trigger |

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| Positioner | | `isolate z-50 outline-none` |
| Popup | `dropdown-menu-content` | `corner-superellipse/1.125 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) min-w-[max(8rem,var(--anchor-width))] origin-(--transform-origin) overflow-y-auto overflow-x-hidden whitespace-nowrap rounded-popup bg-popover text-popover-foreground shadow-md outline-none duration-200 data-closed:animate-out data-open:animate-in data-closed:overflow-hidden` |
| list wrapper | | `HighlightList` with `indicatorClassName='data-[variant=destructive]:bg-red-a2'` (adds `relative isolate p-1`) |
| `DropdownMenuLabel` | `dropdown-menu-label`, `data-inset` | `select-none px-2 pt-1.5 pb-0.5 font-medium text-fg-2 text-xs data-inset:pl-7` |
| `DropdownMenuItem` | `dropdown-menu-item`, `data-inset`, `data-variant`, `data-icon` | `ITEM_BASE` + `pr-2` + `DESTRUCTIVE_ITEM` |
| `DropdownMenuSubTrigger` | `dropdown-menu-sub-trigger` | `ITEM_BASE` + `pr-2 data-open:text-fg-4 data-popup-open:text-fg-4`, then `<Icon name='IconChevronRightMedium' className='ml-auto' />` (14px) |
| `DropdownMenuSubContent` | `dropdown-menu-sub-content` | the content with `w-auto min-w-[96px] shadow-lg`; defaults `side='right'`, `align='start'`, `alignOffset={-3}`, `sideOffset={12}` |
| `DropdownMenuCheckboxItem` / `RadioItem` | `dropdown-menu-checkbox-item` / `dropdown-menu-radio-item` | `ITEM_BASE` + `pr-7`; indicator span `pointer-events-none absolute right-2 flex items-center justify-center` holding `<Icon name='IconCheckmark1' className='rotate-[4deg] text-primary-text' />` inside Base UI's `CheckboxItemIndicator` / `RadioItemIndicator` (shown only when checked) |
| `DropdownMenuSeparator` | `dropdown-menu-separator` | `-mx-1 my-1 h-px bg-bg-3` |
| `DropdownMenuShortcut` | `dropdown-menu-shortcut` | `ml-auto text-fg-2 text-xs tracking-widest` |
| `DropdownMenuGroup`, `RadioGroup`, `Sub`, `Portal` | `dropdown-menu-group`, … | none |

```
ITEM_BASE = relative flex cursor-pointer items-center gap-1.5 rounded-item py-1 pl-2 font-medium text-fg-3 text-xs leading-4
  outline-hidden select-none data-indicator-here:text-fg-4 data-inset:pl-7 data-disabled:pointer-events-none
  data-disabled:opacity-50 [--icon-size:var(--icon-size-sm)] [&_svg]:pointer-events-none

DESTRUCTIVE_ITEM = data-[variant=destructive]:text-red-4/90 data-[variant=destructive]:data-indicator-here:text-red-4
  data-[variant=destructive]:[--icon-color:currentColor]
```

**Geometry**

| | Value |
| --- | --- |
| Popup | min width `max(128px, trigger width)` (the trigger width is a floor, not a cage: long items grow it); max height the space available, then scrolls; 10px corner, superellipse; `bg-popover` (page white in light, `bg-2` in dark); `shadow-md` hairline; labels never wrap (`whitespace-nowrap`) |
| List padding | 4px, owned by `HighlightList` so the highlight sits flush inside the popup edge (6px item corner + 4px = 10px popup corner, concentric) |
| Row | 24px (`leading-4` keeps it an integer: a 1.2 line-height gave 23.6px rows whose fractional edges antialiased the bottom padding away), 8px left, 8px right (28px on checkbox and radio rows to make room for the check), 6px icon gap, 6px corner, 13px medium `fg-3`, icon 14px in `icon-3` |
| Highlighted row | text `fg-4`, icon `icon-4`, over the shared `bg-a2` highlight |
| Inset row / label | 28px left (8px + 14px icon + 6px gap), so a row without an icon lines up with rows that have one |
| Destructive row | `red-4` at 90%, full `red-4` highlighted, icon the same colour, highlight `red-a2` |
| Disabled row | 50% opacity, no pointer |
| Group label | 8px sides, 6px top, 2px bottom, 13px medium `fg-2` |
| Separator | full-bleed across the 4px padding, 1px `bg-3`, 4px above and below |
| Check (checkbox and radio items) | trailing, 8px from the right, 14px `IconCheckmark1` in `primary-text`, rotated 4°; checkmarks are the accent everywhere |
| Shortcut | right edge, 13px `fg-2`, letter-spacing 0.1em |
| Sub-menu | opens to the right, 8px clear of the parent popup (12px from the item, which is inset 4px by the list padding), top aligned with the item (−3px), min width 96px, `shadow-lg`; its trigger stays `fg-4` while the sub-menu is open |

**Motion**

- Enter and exit use tw-animate-css keyframes over 200ms (`duration-200`) with its default `ease` timing: in, opacity 0 → 1 and scale 0.95 → 1 from the `--transform-origin` (the trigger side), plus an 8px slide from the trigger side (from above when it opens below, from the left when it opens to the right); out, opacity → 0 and scale → 0.95. Scrolling is hidden while it closes.
- The highlight slides between rows (`HighlightList`); rows themselves only change text colour, instantly.
- Under reduced motion the animations are cut to nothing.

**Composition rules**

- Rows draw no background of their own (no `hover:bg-*`, no `data-highlighted:bg-*`); the indicator does. A lint rejects a menu item written outside the kit's lists.
- A boolean in a menu is a `DropdownMenuCheckboxItem` (trailing check), never a switch.
- The current value of a choice is a `DropdownMenuRadioGroup`; a picker that also needs actions ("Copy", "Enter manually") is a menu: the radio group, a separator, then plain items.
- Destructive actions go last, after a separator, with `variant='destructive'`.
- Every action reads its label and icon from one shared source so the `•••` menu, the context menu and ⌘K agree.
- Callers set width with `className` (`min-w-48`, `min-w-56 max-w-80`).
- A generic `•••` trigger has no tooltip.
- `DropdownMenuShortcut` shows only a shortcut that exists; no menu in Shinsa's app shows one today.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant='outline' />}>Options</DropdownMenuTrigger>
  <DropdownMenuContent className='w-56'>
    <DropdownMenuGroup>
      <DropdownMenuLabel>Task</DropdownMenuLabel>
      <DropdownMenuItem icon='IconArrowRotateClockwise'>Restart the current step</DropdownMenuItem>
      <DropdownMenuItem icon='IconCode'>Open in editor</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger inset>Priority</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem>Urgent</DropdownMenuItem>
          <DropdownMenuItem>Normal</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuCheckboxItem checked={showMerged} onCheckedChange={setShowMerged}>Show merged</DropdownMenuCheckboxItem>
    <DropdownMenuRadioGroup value={order} onValueChange={setOrder}>
      <DropdownMenuRadioItem value='newest'>Newest first</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value='oldest'>Oldest first</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant='destructive' icon='IconTrashCan'>Cancel task</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

#### EmptyState

**For:** every blank slate: an empty list or page ("Nothing needs you"), a section with nothing yet ("No evidence yet"), a place to pick from ("Select a task"), a failed region ("Couldn’t read the changes"), the page-sized error fallback. One treatment; never hand-roll another. **Not for:** a one-line empty row inside a list card (a short `text-xs fg-2` line in the row's padding).

Plain elements.

**Props**

| Prop | Type | Default |
| --- | --- | --- |
| `icon` | `IconName` (required) | |
| `title` | `string` (required) | |
| `description` | `string` | none |
| `size` | `'default' \| 'sm'` | `'default'` |
| `className` | | |
| `children` | at most one action (a `Button`) | none |

**Anatomy and classes**

```
div[data-slot=empty-state][data-size]   flex flex-1 flex-col items-center justify-center text-center
│                                        default: gap-2.5 p-8   ·   sm: gap-2 p-6
├─ div[data-slot=empty-state-media]      relative   default: mb-1   ·   sm: mb-0.5
│  ├─ span (ghost, left)  aria-hidden    absolute bottom-px left-0 size-full origin-bottom-left -translate-x-1.5 -rotate-12 scale-88 rounded-lg bg-bg-2 shadow-[inset_0_0_0_1px_var(--bg-3)]
│  ├─ span (ghost, right) aria-hidden    absolute right-0 bottom-px size-full origin-bottom-right translate-x-1.5 rotate-12 scale-88 rounded-lg bg-bg-2 shadow-[inset_0_0_0_1px_var(--bg-3)]
│  └─ span (tile)                        relative flex items-center justify-center rounded-lg bg-bg-2 text-fg-3 shadow-[inset_0_0_0_1px_var(--bg-4)]   default: size-9  ·  sm: size-8
│     └─ <Icon name={icon} size='lg' | 'md' />
├─ div                                   flex flex-col gap-px
│  ├─ h2                                 text-balance font-medium text-fg-4 leading-tighter   default: text-sm  ·  sm: text-xs
│  └─ p (when description)               max-w-md text-pretty text-fg-2 text-xs
└─ {children}
```

**Geometry**

| | `default` | `sm` |
| --- | --- | --- |
| Padding | 32px | 24px |
| Gap between figure, text, action | 10px | 8px |
| Extra space under the figure | 4px (14px total) | 2px (10px total) |
| Tile | 36×36 | 32×32 |
| Glyph | 20px (`lg`) in `icon-3` | 16px (`md`) in `icon-3` |
| Title | 14px medium `fg-4`, line-height 1.15, balanced | 13px medium `fg-4` |
| Description | 13px `fg-2`, max 448px, pretty wrapping | same |
| Title to description | 1px | 1px |

The figure: a 7px-corner `bg-2` tile with a 1px inset `bg-4` ring, over two ghost copies of itself (same size, `bg-2` with a 1px inset `bg-3` ring), each scaled to 0.88 and rotated 12° outwards from its bottom corner (left copy `-12°` pivoting on its bottom-left, shifted 6px left; right copy `+12°` pivoting on its bottom-right, shifted 6px right), both raised 1px, so it reads as a small fanned stack of cards. The state fills its parent (`flex-1`) and centres in it. No motion.

Rebuild of the figure:

```css
.es-media { position:relative; margin-bottom:4px; }
.es-ghost { position:absolute; bottom:1px; width:100%; height:100%; border-radius:7px; background:var(--bg-2);
  box-shadow:inset 0 0 0 1px var(--bg-3); }
.es-ghost.left { left:0; transform-origin:bottom left; transform:translateX(-6px) rotate(-12deg) scale(.88); }
.es-ghost.right { right:0; transform-origin:bottom right; transform:translateX(6px) rotate(12deg) scale(.88); }
.es-tile { position:relative; display:flex; align-items:center; justify-content:center; width:36px; height:36px;
  border-radius:7px; background:var(--bg-2); color:var(--fg-3); box-shadow:inset 0 0 0 1px var(--bg-4); }
```

**Composition rules**

- `sm` inside a card section or a narrow column; `default` for a page or a pane.
- One action at most, as children: `Button variant='outline' size='sm'` ("Try again"). The page error fallback is the exception: Try again (primary `sm`), Reload and Copy details (`secondary sm`).
- Copy: the title says what is (not) here, the description says what the place is for in one sentence ("Agents are working. You see a task again when it needs a decision.").
- A `CardHeader divider` followed by an `EmptyState` drops its divider line.

```tsx
<EmptyState
  icon='IconExclamationCircle'
  title='Couldn’t read the changes'
  description='The worktree for this task is gone.'
>
  <Button variant='outline' size='sm'>Try again</Button>
</EmptyState>

<EmptyState size='sm' icon='IconImages1' title='No evidence yet'
  description='Screenshots, recordings and test runs the agent attaches appear here.' />
```

#### Field

**For:** composing a label, a control, a description and an error into one accessible unit: the building block of every form row. **Not for:** a Settings row (that is the app's titles-only setting row), a layout grid.

Plain elements plus the kit `Label` and `Separator`. One CVA (`fieldVariants`).

**Exports and anatomy**

```
FieldSet (fieldset)
├─ FieldLegend (variant 'legend' | 'label')
├─ FieldDescription
└─ FieldGroup (@container/field-group)
   ├─ Field (orientation)                ← role="group"
   │  ├─ FieldLabel (a Label)
   │  ├─ control (Input, Textarea, SelectTrigger, Checkbox, Switch)
   │  ├─ FieldDescription
   │  └─ FieldError
   ├─ FieldSeparator ("or")
   └─ Field orientation='horizontal'
      ├─ FieldContent
      │  ├─ FieldLabel / FieldTitle
      │  └─ FieldDescription
      └─ Switch
```

Every export: `Field`, `FieldContent`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLabel`, `FieldLegend`, `FieldSeparator`, `FieldSet`, `FieldTitle`.

**Classes**

| Part | `data-slot` | Classes |
| --- | --- | --- |
| `FieldSet` | `field-set` | `flex flex-col gap-3 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3` |
| `FieldLegend` | `field-legend`, `data-variant` | `mb-1.5 font-medium text-fg-4 leading-tighter data-[variant=label]:text-xs data-[variant=legend]:text-sm` (default `variant='legend'`) |
| `FieldGroup` | `field-group` | `group/field-group @container/field-group flex w-full flex-col gap-3.5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4` |
| `Field` | `field`, `role="group"`, `data-orientation` | `fieldVariants({ orientation })` |
| `FieldContent` | `field-content` | `group/field-content flex flex-1 flex-col leading-tighter` |
| `FieldLabel` | `field-label` | `Label` classes + `group/field-label peer/field-label corner-superellipse/1.125 flex w-fit gap-2 leading-tighter has-[>[data-slot=field]]:rounded-xl has-[>[data-slot=field]]:border has-[>[data-slot=field]]:border-bg-3 has-data-checked:border-primary-a3 has-data-checked:bg-primary-a1 *:data-[slot=field]:p-2.5 group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col` |
| `FieldTitle` | `field-label` (same slot as `FieldLabel`) | `flex w-fit items-center gap-2 font-medium text-xs leading-tighter group-data-[disabled=true]/field:opacity-50` |
| `FieldDescription` | `field-description` | `text-pretty text-left text-fg-2 text-xs [[data-variant=legend]+&]:-mt-1.5 nth-last-2:-mt-1 last:mt-0 [&>a:active]:text-fg-4 [&>a:hover]:text-fg-4 [&>a]:underline [&>a]:underline-offset-4` |
| `FieldSeparator` | `field-separator`, `data-content` | `relative -my-2 h-5 text-xs`; inside, `<Separator className='absolute inset-0 top-1/2' />` (1px `bg-3`) and, with children, `span[data-slot=field-separator-content]` `relative mx-auto block w-fit bg-bg-1 px-2 text-fg-2` |
| `FieldError` | `field-error`, `role="alert"` | `text-red-text text-xs`; several messages as `ul.ml-4.flex.list-disc.flex-col.gap-1` |

`fieldVariants`:

| Part | Classes |
| --- | --- |
| base | `group/field flex w-full gap-2 data-[invalid=true]:text-red-text` |
| `orientation: vertical` (default) | `flex-col *:w-full [&>.sr-only]:w-auto` |
| `orientation: horizontal` | `flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px` |
| `orientation: responsive` | `@md/field-group:flex-row flex-col @md/field-group:items-center *:w-full @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px` |

**Geometry and behaviour**

| | Value |
| --- | --- |
| Inside a `Field` | 8px between label, control, description and error |
| Vertical | every child full width (a visually hidden child keeps its own width) |
| Horizontal | one row, items centred; with a `FieldContent` (label over description) items align to the top and a checkbox or radio drops 1px to sit on the label's first line; the label part flexes |
| Responsive | vertical until the enclosing `FieldGroup` is at least 448px wide (`@md` container query, 28rem), then horizontal |
| `FieldGroup` | full width, fields 14px apart; a nested group 16px |
| `FieldSet` | 12px between children |
| `FieldLegend` | 6px under it; `legend` 14px, `label` 13px, medium `fg-4`, line-height 1.15. A description straight after a legend is pulled up 6px (net 6px under the legend) |
| `FieldDescription` | 13px `fg-2`, left-aligned, pretty wrapping; pulled up 4px when it is second to last (an error follows it); links underlined 4px below the baseline, `fg-4` on hover and press |
| `FieldSeparator` | a 20px band with −8px margins top and bottom (so it adds 4px between its neighbours beyond their gap), a 1px line through its middle, an optional label ("or") centred on it, 13px `fg-2`, 8px sides, on a `bg-1` patch that masks the line |
| `FieldError` | 13px `red-text`, `role="alert"` so it is announced. `errors` (an array of `{ message }`) is deduplicated by message: none renders nothing at all, one renders as plain text, several as a bulleted list (16px indent, 4px apart). `children` wins over `errors` |
| Choice card | a `FieldLabel` wrapping a `Field` becomes a full-width card: 9px corner, 1px `bg-3` border, the inner field padded 10px; when anything inside is checked, border `primary-a3` and fill `primary-a1` (a toned box takes its tone's edge) |
| Invalid | `data-invalid="true"` on `Field` turns every text inside it `red-text` (label included); put `aria-invalid` on the control itself for its 1px `red-4` ring |
| Disabled | `data-disabled="true"` on `Field`: label and title at 50% opacity, the label ignores the pointer; disable the control itself too |

```tsx
<FieldGroup className='max-w-sm'>
  <Field data-invalid={invalid || undefined}>
    <FieldLabel htmlFor='check-command'>Check command</FieldLabel>
    <Input id='check-command' defaultValue='bun lnit' aria-invalid={invalid || undefined} aria-describedby='check-command-error' />
    {invalid && <FieldError id='check-command-error'>No script named lnit in package.json.</FieldError>}
  </Field>
  <FieldSeparator>or</FieldSeparator>
  <Field orientation='horizontal'>
    <FieldContent>
      <FieldLabel htmlFor='plan-first'>Plan first for large work</FieldLabel>
      <FieldDescription>Large tasks wait for you to approve the plan before anything is built.</FieldDescription>
    </FieldContent>
    <Switch id='plan-first' defaultChecked />
  </Field>
</FieldGroup>
```

Do: `aria-invalid` on the control plus a `FieldError` with its id in `aria-describedby`. Don't: hand-style an error paragraph, add a border or fill to make a field show, or nest `Field` inside `Field` except in a choice card.

#### HighlightList (and HoverHighlight)

**For:** the one shared highlight behind every list of rows you pick from. Rows never draw a hover, highlighted or selected background of their own; one absolutely positioned indicator slides to the current row. Used by every `DropdownMenu` and context menu (built in), `Select`, `Command` (its own copy of the same mechanics), setup's option lists, list cards, and through `HoverHighlight` the rail's nav, queue rows and popover task rows. **Not for:** a single control (a button has its own fill), the Code tab's file tree and search results (instant on purpose).

Exports: `HighlightList`, `HoverHighlight`, and `useAnimatedIndicator` (the hook both use, for a container that cannot take a wrapper div, such as a tab list).

**Props**

| Component | Prop | Default | Meaning |
| --- | --- | --- | --- |
| `HighlightList` | `children` | | the rows |
| | `className` | | added to the wrapper |
| | `indicatorClassName` | | added to the indicator (menus pass `data-[variant=destructive]:bg-red-a2`) |
| | `attribute` | `'data-highlighted'` | the attribute that marks the current row (Base UI and the caller set it) |
| | `press` | `true` | deflate the indicator on press |
| `HoverHighlight` | `children`, `className`, `indicatorClassName` | | rows are `[data-highlight-item]`; the resting row is `[data-active="true"]` |

**Markup**

```html
<div class="relative isolate p-1 {className}">                      <!-- HighlightList; HoverHighlight has no p-1 -->
  <div data-slot="highlight-indicator" data-motion="move" aria-hidden
       class="pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0 {indicatorClassName}"
       style="transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out;
              will-change: transform, opacity; contain: layout paint; transform-origin: center"></div>
  …rows…
</div>
```

`HoverHighlight`'s indicator is `rounded-control` (7px) instead of `rounded-item` (6px), and its wrapper is `relative isolate` with no padding.

**How the indicator moves** (`useAnimatedIndicator`, imperative DOM, no React re-render per hover):

1. A MutationObserver (subtree, `childList`, and the marking attribute) and a ResizeObserver on the root find the first `[attribute]` (or `[attribute="value"]`) row.
2. The row gets `data-indicator-here`; the previous row loses it. Rows style only their text and icon colour from it (`data-indicator-here:text-fg-4`), instantly. The indicator copies the row's `data-variant` (so a destructive row tints it `red-a2`).
3. The row's box is measured with `offsetLeft`/`offsetTop` walked up to the root (never `getBoundingClientRect`, which drifts during the popup's zoom-in).
4. **First appearance**: laid out at the row's size with transitions off, opacity 1, no fade or slide. The row highlighted when the list mounts shows at once.
5. **After that, transform only**: `translate(x, y) scale(row.width / laidOut.width, row.height / laidOut.height) scale(var(--hl-press-scale, 1))`, centred on the row, on the movement clock (200ms `cubic-bezier(0.22, 1, 0.36, 1)`). No `width`, `height`, `top`, `left` or `background` animates, so no frame of a slide lays out or paints.
6. When a slide ends on a row of another size (`transitionend` on `transform`), the indicator is laid out once at that size with transitions off and its scale returns to 1, so its corners never rest stretched.
7. **Press** (`press`): on `pointerdown` on a row, `--hl-press-scale` is set to `1 − 2·1px/width, 1 − 2·0.5px/height` (the same fixed inset every button presses by, read from `--press-inset-x`/`-y`), with transitions held off so it lands in the frame of the press; it lifts the same way on `pointerup`/`pointercancel`.
8. With no marked row the indicator stays where it was (`HighlightList`), or, with `parkWhenEmpty` (`HoverHighlight`), fades to opacity 0 and resets.

`HoverHighlight` marks rows itself: on `pointerover` the row under the pointer (`closest('[data-highlight-item]')`) gets `data-hovered`; when the pointer leaves the container, or the `data-active` row changes while the pointer is outside, the mark returns to the `[data-highlight-item][data-active="true"]` row. Keyboard focus never moves it (focus draws no state).

**Reduced motion:** the slide is cut to nothing (the indicator jumps). A subtree that turns transitions off spares the indicator through `data-motion="move"`.

```tsx
<Card className='gap-0 p-0'>
  <div role='listbox' tabIndex={0} aria-label='Agents' onKeyDown={onKeyDown} className='outline-none'>
    <HighlightList className='flex flex-col gap-px'>
      {options.map((option, index) => (
        <div key={option.value} role='option' aria-selected={option.value === value}
          data-highlighted={index === highlighted || undefined}
          onPointerMove={() => setHighlighted(index)} onClick={() => pick(option.value)}
          className='flex h-7 cursor-pointer items-center gap-2 rounded-item px-2.5 text-fg-4 text-xs'>
          {option.label}
        </div>
      ))}
    </HighlightList>
  </div>
</Card>
```

Do: mark the current row with the attribute and let the list draw it. Don't: give a row `hover:bg-*`, `data-highlighted:bg-*`, `aria-selected:bg-*` or `data-indicator-here:bg-*` (lint rejects it), or animate width and height.

#### Input

**For:** a one-line text field. **Not for:** multi-line text (`Textarea`), a value from a list (`Select`), search inside ⌘K (`CommandInput`).

Wraps Base UI `Input` (`@base-ui/react/input`, a native `<input>` that works inside Base UI `Field`).

**Props**

| Prop | Values | Default |
| --- | --- | --- |
| `size` | `'sm'` (24px), `'default'` (26px) | `'default'` (the native numeric `size` attribute is not available) |
| `loading` | `boolean \| undefined` | `undefined` |
| every `input` prop (`type`, `readOnly`, `disabled`, `aria-invalid`, …) | | |

**Classes** (`data-slot="input"`)

```
corner-superellipse/1.125 w-full min-w-0 bg-input font-medium text-fg-4 backdrop-blur-md
{size sm: h-6 rounded-control-sm px-2 text-xs | default: h-6.5 rounded-control px-2.5 text-xs}
outline-none placeholder:text-fg-2
file:inline-flex file:h-5.5 file:border-0 file:bg-transparent file:font-medium file:text-fg-4 file:text-xs
disabled:cursor-not-allowed disabled:text-fg-1 disabled:opacity-50
read-only:cursor-default read-only:border read-only:border-bg-4 read-only:text-fg-2
aria-invalid:ring-1 aria-invalid:ring-red-4
{className, or pr-9 when loading is defined}
```

| `size` | Height | Side padding | Corner | Type |
| --- | --- | --- | --- | --- |
| `sm` | 24px | 8px | 6px | 13px medium |
| `default` | 26px (the default button's height and corner) | 10px | 7px | 13px medium |

**States**

| State | Look |
| --- | --- |
| Rest | filled, never bordered: `bg-input` (`bg-2`, a step above the page, a card and a dialog; inside a dark popover, which is itself `bg-2`, the token becomes `bg-3`), value 13px medium `fg-4`, placeholder `fg-2` (same weight), 12px backdrop blur |
| Hover | no change |
| Focus | no change (no focus states) |
| Disabled | text `fg-1`, 50% opacity, `not-allowed` cursor |
| Read-only | a 1px `bg-4` border, text `fg-2`, default cursor: it reads as a value to copy rather than a field to type into |
| Invalid (`aria-invalid`) | a 1px `red-4` ring (box-shadow ring, so the size does not change) |
| File input | the file button is 22px, borderless, transparent, 13px medium `fg-4` |

**Loading:** when `loading` is passed at all (true or false), the input is wrapped in `span[data-slot=input-frame].relative.inline-flex.w-full` (which takes `className` instead of the input), the input gets 36px of right padding (`pr-9`), and a `Spinner` sits 12px from the right edge, vertically centred: 16px (`md`) for a default field, 14px (`sm`) for a small one, `text-fg-2`, `pointer-events-none`. It fades between visible (`loading`) and `opacity-0` (`loading={false}`) over 150ms (`transition-opacity duration-150`). Pass `loading={false}` from the start on a field that will become busy, so the frame and padding exist before and nothing shifts. The hidden spinner is `aria-hidden`.

```tsx
<Field>
  <FieldLabel htmlFor='branch-prefix'>Branch prefix</FieldLabel>
  <Input id='branch-prefix' placeholder='christo/' />
  <FieldDescription>Every branch an agent creates starts with this.</FieldDescription>
</Field>
<Input aria-label='Find a repository' value={query} onChange={onChange} loading={searching} />
<Input readOnly defaultValue='~/.shinsa/worktrees/…' />
```

Do: give it a label (`FieldLabel` with `htmlFor`, or `aria-label`). Don't: add a border or a call-site fill to make it show, or style focus.

#### Kbd

**For:** a keyboard key beside a label: ⌘K's `esc`, a shortcut in a tooltip ("Search in files ⇧⌘F" on the Code tab's search button), keys in a command row. **Not for:** inline code (use a code chip), a badge.

Plain `<kbd>` elements.

**Classes**

| Part | `data-slot` | Element | Classes |
| --- | --- | --- | --- |
| `Kbd` | `kbd` | `kbd` | `pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-bg-2 px-1 font-medium font-sans text-fg-2 text-xs [--icon-size:var(--icon-size-sm)]` |
| `KbdGroup` | `kbd-group` | `kbd` | `inline-flex items-center gap-1` |

**Geometry:** 20px tall, at least 20px wide (a single glyph is a 20px square; a word key like `esc` grows with 4px sides), 5px corner, `bg-2` fill, no border, 13px medium in the sans face (overriding the browser's monospace `kbd`), `fg-2`, icons inside 14px, 4px between glyphs. In a list row (`CommandShortcut`) or a standalone key hint a chord is one `Kbd` per key inside a `KbdGroup`, 4px apart. In a tooltip the whole chord is one `Kbd` (`Hint` renders its `shortcut` string as a single cap: `⇧⌘F`, `⌘K`). Keys ignore the pointer and never join a text selection.

```tsx
<KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
<Hint label='Search in files' shortcut='⇧⌘F'>      {/* the tooltip ends with <Kbd className='ms-1'>⇧⌘F</Kbd> */}
  <Button variant='secondary' size='icon-sm' icon='IconMagnifyingGlass' aria-label='Search in files' />
</Hint>
```

Do: pass the plain character (`↵`, `⌘`, `esc`). Don't: put a border on it or make it clickable.

#### Label

**For:** the visible name of a form control: beside a checkbox or switch, above an input. `FieldLabel` is a `Label` with field styling. **Not for:** a section title (a section label composite), a static text line.

A plain `<label>`, `data-slot="label"`.

```
flex cursor-pointer select-none items-center gap-2 font-medium text-xs leading-tighter
peer-disabled:cursor-not-allowed peer-disabled:opacity-50
group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50
```

13px medium, line-height 1.15, flex row with 8px between a nested control and text, pointer cursor (the label is the control's hit target; pressing it also scales a `Checkbox`). No colour of its own: it inherits (the body's `fg-3`, or `red-text` inside an invalid `Field`). Disabled when a preceding sibling marked `peer` (the `Checkbox` root is) is disabled, or when an ancestor `group` has `data-disabled="true"`: 50% opacity.

```tsx
<div className='flex items-center gap-2'>
  <Switch id='claude' defaultChecked />
  <Label htmlFor='claude'>Claude</Label>
</div>
```

Do: always `htmlFor` or wrap the control. Don't: give it a size or weight override.

#### Logo

**For:** the Shinsa mark beside the word "Shinsa" (the brand link in the top bar, the setup shell). One of three things that may draw an `<svg>` (with `Icon` and `Spinner`).

An `<svg viewBox="0 0 365 365" fill="currentColor" role="img" aria-label="Shinsa">` with three paths (the full path data is the brand asset), class `shrink-0` plus `size-(--icon-size)` by default or the `ICON_SIZE_CLASS` of `size` (`sm` 14, `md` 16, `lg` 20).

**Props:** `size?: 'sm' | 'md' | 'lg'`, `className?`.

**Colour:** it draws in its **text colour** (`currentColor`), not the quieter icon ink: the brand mark beside "Shinsa" is as strong as the word.

Shinsa's brand link: a button `flex cursor-pointer items-center gap-1.5 font-medium text-fg-4 text-sm outline-none`, holding a 20px slot `grid size-5 shrink-0 place-items-center` with `<Logo className='size-3.25' />` (13px) and the word "Shinsa" 6px after it.

```tsx
<button type='button' onClick={goHome} className='flex cursor-pointer items-center gap-1.5 font-medium text-fg-4 text-sm outline-none'>
  <span className='grid size-5 shrink-0 place-items-center'>
    <Logo className='size-3.25' />
  </span>
  Shinsa
</button>
```

Don't: recolour it with an icon ink, draw it at an opacity, or hand-draw another copy of the mark.

Conventions used in this section (the type scale, radii and `data-slot` names are in the table and notes at the top of 10.1):

- `shadow-md` and `shadow-lg` are not drop shadows: both resolve to a 1px `bg-3` ring (`0 0 0 1px var(--bg-3)` in light, `inset 0 0 0 1px var(--bg-3)` in dark). `shadow-1` is the same ring.
- Popup enter and exit animations use the tw-animate-css vocabulary. Without the library they are:

```css
/* animate-in: enter; animate-out: exit. Duration = --tw-duration (set by duration-N), else 150ms; easing = --tw-ease (set by ease-*), else the CSS keyword `ease`. */
@keyframes enter {
  from {
    opacity: var(--tw-enter-opacity, 1);
    transform: translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0)
      scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), var(--tw-enter-scale, 1));
  }
}
@keyframes exit {
  to {
    opacity: var(--tw-exit-opacity, 1);
    transform: translate3d(var(--tw-exit-translate-x, 0), var(--tw-exit-translate-y, 0), 0)
      scale3d(var(--tw-exit-scale, 1), var(--tw-exit-scale, 1), var(--tw-exit-scale, 1));
  }
}
/* fade-in-0 → --tw-enter-opacity: 0; zoom-in-95 → --tw-enter-scale: .95;
   slide-in-from-top-2 → --tw-enter-translate-y: -8px; slide-in-from-bottom-2 → +8px;
   slide-in-from-left-2 → --tw-enter-translate-x: -8px; slide-in-from-right-2 → +8px;
   fade-out-0 / zoom-out-95 are the same values on --tw-exit-*. */
```

- The state variants come from Base UI's attributes: `data-open:` matches `[data-open]` (or `[data-state=open]`), `data-closed:` `[data-closed]`, `data-checked:` `[data-checked]`, `data-active:` `[data-active]`, `data-disabled:` `[data-disabled]`, `data-horizontal:` / `data-vertical:` `[data-orientation=…]`, `data-[side=…]:` the side Base UI placed the popup on. `enabled:` is `:not(:disabled, [data-disabled])`; `disabled:` is `:is(:disabled, [data-disabled])`.

#### Popover

**For:** a small interactive panel that opens on click from a trigger and holds controls (switches, a short form, a list of actions with toggles). Example: the "Agents" popover on a toolbar button, a heading "Agents", a one-line description, then one `Label` + `Switch` row per agent.

**Not for:** content that should show on hover without a click (use `PreviewCard`); a list of destinations or actions (use `DropdownMenu`); a single line of explanation (use a tooltip); a picker of one value (use `Select`).

**Wraps:** Base UI `Popover` (`Root`, `Trigger`, `Portal`, `Positioner`, `Popup`, `Title`, `Description`).

**Anatomy:**

```
Popover                      (Root, data-slot=popover)
├─ PopoverTrigger            (Trigger, data-slot=popover-trigger; usually render={<Button …/>})
└─ PopoverContent            (Portal > Positioner > Popup, data-slot=popover-content)
   ├─ PopoverHeader          (div, data-slot=popover-header)
   │  ├─ PopoverTitle        (Title, data-slot=popover-title)
   │  └─ PopoverDescription  (Description, data-slot=popover-description)
   └─ …body rows
```

**Props:**

| Part | Prop | Default | Notes |
| --- | --- | --- | --- |
| `Popover` | all Base UI `Popover.Root` props (`open`, `defaultOpen`, `onOpenChange`, `modal`…) | Base UI's | No styling. |
| `PopoverTrigger` | Base UI `Popover.Trigger` props, `render` | | Render the kit `Button` through `render`. |
| `PopoverContent` | `side` | `'bottom'` | `top`, `bottom`, `left`, `right`, `inline-start`, `inline-end` |
| | `sideOffset` | `4` (px) | |
| | `align` | `'center'` | `start`, `center`, `end` |
| | `alignOffset` | `0` | |
| | `anchor`, `collisionAvoidance` | Base UI's | Passed to the Positioner. |
| | `className` | | Merged last onto the Popup (`cn`, so `w-80` replaces `w-64`). |

**Classes:**

- Positioner: `isolate z-50`.
- Popup: `corner-superellipse/1.125 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 flex w-64 origin-(--transform-origin) flex-col gap-2 rounded-popup bg-popover p-2.5 text-popover-foreground text-xs shadow-md outline-hidden duration-200 data-closed:animate-out data-open:animate-in`
- PopoverHeader: `flex flex-col text-xs`
- PopoverTitle: `font-medium text-fg-4`
- PopoverDescription: `text-pretty text-fg-2`

**Geometry:** 256px wide (`w-64`), 10px padding on every side (`p-2.5`), 8px between children (`gap-2`), 10px corners, 13px text, 1px `bg-3` ring as its edge, 4px from the trigger. Title and description sit flush (no gap) in the header.

**Motion:** enter 200ms (CSS `ease`): opacity 0 → 1, scale 0.95 → 1 from `--transform-origin` (the side facing the trigger), and an 8px slide toward its side (from 8px above when it opens below). Exit 200ms: opacity → 0 and scale → 0.95, no slide. Base UI sets `data-open` / `data-closed` and keeps the popup mounted until the exit animation ends.

**Inside a dark popover fields fill one step up.** The dark popover fill is `bg-2`, which is also a field's fill, so the stylesheet raises it inside any popover:

```css
.dark [data-slot="popover-content"] {
  --input: var(--bg-3);
  --input-hover: var(--bg-4);
}
```

**Do:** let the content decide its height; widen with a `w-*` class on `PopoverContent` when rows need it; keep a heading plus at most a short body.

**Don't:** put a menu's rows inside (use `DropdownMenu`); add a border or shadow (the ring is the edge); give a field inside its own fill.

```tsx
<Popover>
  <PopoverTrigger render={<Button variant='outline' />}>Agents</PopoverTrigger>
  <PopoverContent>
    <PopoverHeader>
      <PopoverTitle>Agents</PopoverTitle>
      <PopoverDescription>Pause an agent without losing its tasks.</PopoverDescription>
    </PopoverHeader>
    <div className='flex items-center justify-between'>
      <Label htmlFor='agent-claude'>Claude</Label>
      <Switch id='agent-claude' defaultChecked />
    </div>
    <div className='flex items-center justify-between'>
      <Label htmlFor='agent-codex'>Codex</Label>
      <Switch id='agent-codex' />
    </div>
  </PopoverContent>
</Popover>
```

#### PreviewCard

**For:** anything that shows more on hover: a task fact, a smart link's preview, "2 more", related tasks, a cost breakdown. In Shinsa it is always wrapped by the app's `InfoPopover` composite (below). A click does nothing to it: it never toggles or sticks open.

**Not for:** a real menu or anything with controls the user must reach by click (priority, the task menu, Focus, the queue button stay click `DropdownMenu`s); a one-line label (tooltip).

**Wraps:** Base UI `PreviewCard` (`Root`, `Trigger`, `Portal`, `Positioner`, `Popup`). Shinsa owns its open state: `open` and `defaultOpen` are not accepted.

**Anatomy:**

```
PreviewCard              (Root, data-slot=preview-card)
├─ PreviewCardTrigger    (Trigger, data-slot=preview-card-trigger)
└─ PreviewCardContent    (Portal > Positioner > Popup, data-slot=preview-card-content, data-instant when swapped in)
```

**Props:**

| Part | Prop | Default | Notes |
| --- | --- | --- | --- |
| `PreviewCard` | Base UI Root props except `open`, `defaultOpen` | | `onOpenChange` still reports. |
| `PreviewCardTrigger` | `delay` | `80` ms | Becomes `0` while the group is warm. |
| | `closeDelay` | `120` ms | |
| | `render` | | The element that is hovered. |
| `PreviewCardContent` | `side` | `'bottom'` | |
| | `sideOffset` | `8` px | |
| | `align` | `'start'` | |
| | `className` | | |

**Classes:**

- Positioner: `isolate z-50`.
- Popup: `corner-superellipse/1.125 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 flex w-72 origin-(--transform-origin) flex-col rounded-popup bg-popover text-popover-foreground text-xs shadow-md outline-hidden data-closed:animate-out data-open:animate-in` plus `data-instant:animate-none! data-instant:duration-0!`.

**Geometry:** 288px wide (`w-72`), no padding (the content supplies its own), 10px corners, 13px text, 1px `bg-3` ring, 8px below the trigger, start-aligned.

**Motion:** enter 150ms `ease`: opacity 0 → 1, scale 0.95 → 1 from the transform origin, no slide. Exit the same in reverse. `data-instant` (set when the card replaced another one) removes the animation and its duration entirely.

**Group behaviour (module-level, shared by every preview card on the page):**

| Constant | Value | Meaning |
| --- | --- | --- |
| `OPEN_DELAY_MS` | 80 | Rest on a trigger before the first card opens. |
| `CLOSE_DELAY_MS` | 120 | Pointer away before it closes. |
| `GROUP_GRACE_MS` | 300 | After the last card closes, the group stays warm this long. |
| `SETTLE_MS` | 90 | While the pointer heads for the open card, re-check after this. |
| `MAX_DEFERS` | 6 | At most 6 re-checks (540ms), then switch anyway. |
| `SIDE_OFFSET_PX` | 8 | Gap to the trigger. |

1. Only one card is open at a time. Opening a card closes the previous one immediately (no exit animation: it is closed with `instant` set).
2. While the group is warm (a card is open, or closed less than 300ms ago) every trigger's open delay is 0 and the new card opens with `data-instant`, so hopping between rows reads as one card moving.
3. **Pointer intent:** when the pointer crosses another trigger on its way to the open card, the switch waits. Every `pointermove` on the document (one passive capture listener, installed once) is sampled; if the ray along the last 80ms of travel enters the open card's box (`isHeadingInto`, below), the switch is deferred by 90ms and re-checked, up to 6 times, and only happens if the new trigger is still `:hover`. Once the pointer settles on the new trigger, it switches at once.
4. Unmounting the open card releases the group and starts the 300ms cool-down, so the next card animates again.

**The `InfoPopover` composite (app layer) fills it:**

- `InfoHeader`: `flex flex-col gap-px px-3 py-2.5`; title `min-w-0 font-medium text-fg-4 text-xs`; description `min-w-0 text-2xs text-fg-2`.
- `InfoSection`: `flex flex-col border-border border-t py-1 first:border-t-0`; optional heading `flex h-7 items-center gap-1.5 px-3 font-medium text-2xs text-fg-2` (28px).
- `InfoRow`: `flex min-h-7 items-center justify-between gap-4 px-3 text-xs` (28px, 16px minimum between label and value); label `flex min-w-0 items-center gap-2 text-fg-3` with an optional `Icon size='sm'` (14px) and `min-w-0 truncate` text; value `shrink-0 text-fg-2`.
- `InfoAction` (a footer link or button): `flex h-8 w-full cursor-pointer items-center gap-1.5 border-border border-t px-3 text-left text-primary-text text-xs no-underline outline-none hover:opacity-80 active:opacity-80`; an external link ends with `Icon size='sm' name='IconArrowUpRight'`.

**Do:** pass the hovered element as `render`; build the body from the Info parts so every hover card matches.

**Don't:** make the trigger a `Truncate` (two overlays would stack: a trigger keeps a plain `truncate`); control it with `open`; put anything that needs a click inside it.

```tsx
<PreviewCard>
  <PreviewCardTrigger render={<button type='button' className='w-fit text-fg-2 text-xs' />}>
    2 more
  </PreviewCardTrigger>
  <PreviewCardContent>
    <div className='flex flex-col gap-px px-3 py-2.5'>
      <div className='min-w-0 font-medium text-fg-4 text-xs'>Also running</div>
      <div className='min-w-0 text-2xs text-fg-2'>Two tasks in this project</div>
    </div>
    <section className='flex flex-col border-border border-t py-1'>
      <div className='flex min-h-7 items-center justify-between gap-4 px-3 text-xs'>
        <span className='flex min-w-0 items-center gap-2 text-fg-3'>
          <Icon size='sm' name='IconAgents' />
          <span className='min-w-0 truncate'>Fix the scroll jump</span>
        </span>
        <span className='shrink-0 text-fg-2'>Building</span>
      </div>
    </section>
  </PreviewCardContent>
</PreviewCard>
```

#### ScrollArea

**For:** a long pane that needs a visible but quiet overlay scrollbar: the task chat, and every page whose body scrolls under a header (Home, Settings, the task's Overview, through the app's `PageScroll`). Scrolling stays the browser's own (wheel, trackpad, keyboard, momentum).

**Not for:** small inner scrollers (lists inside popovers, code blocks, side lists): they keep the global hidden-scrollbar rule and use `ScrollFade` when they need edge fades. Horizontal scrolling (ScrollArea is vertical only: `overflow-x-hidden`).

**Wraps:** nothing; it is plain DOM. Geometry comes from the kit's scroll helpers (Kit hooks and helpers → scroll).

**Anatomy:**

```
div[data-slot=scroll-area]                  relative overflow-hidden + className
├─ div[data-slot=scroll-area-fade]          the still, masked box (data-fade-scope when fade)
│  └─ div[data-slot=scroll-area-viewport]   the scroller (viewportRef, viewportClassName)
│     └─ children
└─ div[data-slot=scroll-area-scrollbar]     aria-hidden track (group/scrollbar)
   └─ div[data-slot=scroll-area-thumb]
```

**Props:**

| Prop | Default | Notes |
| --- | --- | --- |
| `fade` | `true` | Fade the content out (24px) at whichever edge still hides content. |
| `viewportRef` | | Ref (object or callback) to the scrolling element, for reading or setting `scrollTop`. |
| `viewportClassName` | | Classes on the scroller (padding for the content goes here or on a child). |
| `onScroll` | | Fires from the scroller. |
| `className` and any `div` props | | On the root; give it a height (`h-40`, `flex-1 min-h-0`). |

**Classes:**

- Root: `relative overflow-hidden`.
- Fade box: `size-full rounded-[inherit]`, plus `scroll-fade` when `fade`; inline style sets `--fade-timeline-y: --fade-y<id>` and `--fade-timeline-x: --fade-x<id>` (unique per instance).
- Viewport: `size-full overflow-y-auto overflow-x-hidden rounded-[inherit] outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`, plus `scroll-fade-source` when `fade`.
- Track: `group/scrollbar absolute inset-y-0 right-0 z-20 w-3 py-1 pr-0.75 pl-1 opacity-0 transition-[opacity,padding] delay-300 duration-200 hover:pl-0.5 hover:opacity-100 hover:delay-0 active:pl-0.5 active:opacity-100 active:delay-0 data-hidden:hidden data-dragging:pl-0.5 data-dragging:opacity-100 data-scrolling:opacity-100 data-scrolling:delay-0`
- Thumb: `w-full touch-none rounded-full bg-fg-a1 opacity-60 transition-opacity duration-150 will-change-transform group-hover/scrollbar:opacity-100 group-active/scrollbar:opacity-100 group-data-dragging/scrollbar:opacity-100`

**Geometry:**

| Thing | Value |
| --- | --- |
| Track | 12px wide (`w-3`), full height, on the right edge, 4px top and bottom padding (`py-1`) |
| Thumb width at rest | 5px (12 − 4 left − 3 right) |
| Thumb width under the pointer, pressed or dragging | 7px (left padding drops to 2px) |
| Thumb colour | `fg-a1` (`oklch(0 0 0 / 0.29)` light, `oklch(1 0 0 / 0.29)` dark) at 60% opacity, 100% while the track is hovered, pressed or dragged |
| Thumb length | visible share of the content times (viewport − 8px), never under 24px |
| Thumb travel | inset 4px from each end |
| Track hidden | `data-hidden` (display none) while content overflows by 1px or less |

**Behaviour and timing:**

- The thumb is moved straight on the DOM in the scroll event (`height` and `transform: translate3d(0, offset, 0)`), batched to one `requestAnimationFrame`, so scrolling never re-renders React.
- Scrolling sets `data-scrolling` on the track (opacity 1 at once). It is removed 700ms (`LINGER_MS`) after the last scroll event, unless a drag is in progress; the track then waits 300ms (`delay-300`) and fades out over 200ms.
- Hover shows the track at once (`hover:delay-0`) and widens the thumb (the padding change also eases over 200ms).
- Dragging the thumb: pointer capture, `data-dragging` on the track (held visible and wide); content moves by `delta × scrollable / travel` pixels.
- Pressing the bare track scrolls (`behavior: 'smooth'`) so the thumb centres on the pointer, clamped to both ends.
- A `ResizeObserver` on the viewport and each direct child, and a `MutationObserver` on the viewport's child list, repaint the thumb when content changes size.

**The fade:** see ScrollFade for the full mechanism. In ScrollArea the mask sits on the still box around the scroller (`data-fade-scope`), so scrolling never repaints the masked content; the scroller names the scroll timelines (`scroll-fade-source`) and the box scopes them (`timeline-scope`). Edge attributes (`data-overflow-y-start`, `data-overflow-y-end`) are also toggled on the box on each paint as the fallback for browsers without scroll timelines.

**Do:** put padding on a child or via `viewportClassName`, not on the root (the root clips); leave `fade` on wherever content scrolls under a header or composer.

**Don't:** add a gradient overlay to fake a fade; use it for a horizontal scroller; put a mask on the scrolling element itself (that repaints the whole scroller every frame).

```tsx
<ScrollArea className='h-40 w-64 rounded-xl bg-bg-2' viewportClassName='p-3'>
  <div className='flex flex-col gap-2'>
    {runs.map((run) => (
      <div key={run.id} className='text-fg-3 text-sm'>
        {run.label}
      </div>
    ))}
  </div>
</ScrollArea>
```

#### ScrollFade

**For:** fading the scrollable edges of a native overflow container (no custom scrollbar): a list inside a popover, a row of chips that scrolls sideways, a code block. Either it renders its own scroller around `children`, or it decorates an existing scroller through `targetRef`.

**Not for:** a long pane that also wants a scrollbar (use `ScrollArea`); a container that never scrolls.

**Anatomy (own scroller):**

```
div                                      relative + className
└─ div[data-slot=scroll-fade]            scroll-fade size-full rounded-[inherit]; data-fade-scope, data-fade-orientation, --fade-size
   └─ div[data-slot=scroll-fade-viewport] scroll-fade-source scrollbar-hide size-full rounded-[inherit] + overflow class
      └─ children
```

With `targetRef` nothing renders: in a layout effect the target gets the class `scroll-fade`, `data-fade-orientation`, `--fade-size` and the edge attributes; all of it is removed on unmount. Render `ScrollFade` after its target in the tree, so the target's ref is set when the effect runs.

**Props:**

| Prop | Default | Notes |
| --- | --- | --- |
| `orientation` | `'vertical'` | `vertical` (`overflow-y-auto`), `horizontal` (`overflow-x-auto`), `both` (`overflow-auto`). Only the named axes fade. |
| `size` | `24` | Fade length; a number is px, a string any CSS length. |
| `targetRef` | | Decorate this element instead of rendering a scroller. |
| `className`, `div` props | | On the outer div (own-scroller mode). |

**The `scroll-fade` utility (component-local CSS, exact):**

```css
@property --fade-t { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-b { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-l { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-r { syntax: "<length>"; inherits: false; initial-value: 0px; }

.scroll-fade {
  --fade-size: 1.5rem;
  --fade-timeline-y: --scroll-fade-y;
  --fade-timeline-x: --scroll-fade-x;
  mask-image:
    linear-gradient(to bottom, transparent, oklch(0 0 0) var(--fade-t), oklch(0 0 0) calc(100% - var(--fade-b)), transparent),
    linear-gradient(to right, transparent, oklch(0 0 0) var(--fade-l), oklch(0 0 0) calc(100% - var(--fade-r)), transparent);
  mask-composite: intersect;
  transition: --fade-t 150ms ease, --fade-b 150ms ease, --fade-l 150ms ease, --fade-r 150ms ease;
}
.scroll-fade[data-overflow-y-start] { --fade-t: var(--fade-size); }
.scroll-fade[data-overflow-y-end]   { --fade-b: var(--fade-size); }
.scroll-fade[data-overflow-x-start] { --fade-l: var(--fade-size); }
.scroll-fade[data-overflow-x-end]   { --fade-r: var(--fade-size); }

@supports (animation-timeline: scroll()) {
  .scroll-fade {
    transition: none;
    animation: scroll-fade-t linear both, scroll-fade-b linear both;
    animation-timeline: var(--fade-timeline-y), var(--fade-timeline-y);
    animation-range: 0 var(--fade-size), calc(100% - var(--fade-size)) 100%;
    scroll-timeline: var(--fade-timeline-y) block, var(--fade-timeline-x) inline;
  }
  .scroll-fade[data-fade-orientation="horizontal"] {
    animation: scroll-fade-l linear both, scroll-fade-r linear both;
    animation-timeline: var(--fade-timeline-x), var(--fade-timeline-x);
    animation-range: 0 var(--fade-size), calc(100% - var(--fade-size)) 100%;
  }
  .scroll-fade[data-fade-orientation="both"] {
    animation: scroll-fade-t linear both, scroll-fade-b linear both, scroll-fade-l linear both, scroll-fade-r linear both;
    animation-timeline: var(--fade-timeline-y), var(--fade-timeline-y), var(--fade-timeline-x), var(--fade-timeline-x);
    animation-range: 0 var(--fade-size), calc(100% - var(--fade-size)) 100%, 0 var(--fade-size), calc(100% - var(--fade-size)) 100%;
  }
  .scroll-fade[data-fade-scope] {
    scroll-timeline: none;
    timeline-scope: var(--fade-timeline-y), var(--fade-timeline-x);
  }
}
.scroll-fade-source { scroll-timeline: var(--fade-timeline-y) block, var(--fade-timeline-x) inline; }

@keyframes scroll-fade-t { from { --fade-t: 0px; } to { --fade-t: var(--fade-size); } }
@keyframes scroll-fade-b { from { --fade-b: var(--fade-size); } to { --fade-b: 0px; } }
@keyframes scroll-fade-l { from { --fade-l: 0px; } to { --fade-l: var(--fade-size); } }
@keyframes scroll-fade-r { from { --fade-r: var(--fade-size); } to { --fade-r: 0px; } }
```

**How it works, and why:**

- **A mask, never a gradient overlay.** An overlay must guess the colour behind it and paints over the container's own edge (a card border). A mask makes no assumption, so it works on every surface.
- **The mask sits on a still box, not on the scroller.** A mask on the scrolling element repaints the whole scroller every scroll frame. The wrapper (`data-fade-scope`) is masked once and the content scrolls under it on the compositor.
- **Right on the first painted frame.** Where scroll timelines exist, the scroll position drives each edge: the start fade grows over the first 24px of travel, the end fade shrinks over the last 24px. No measure, observer or transition is involved.
- **Unique timeline names per instance** (`--fade-y<id>`, `--fade-x<id>`, from React's `useId` with every character other than word characters and `-` stripped), so a scroller nested inside another never answers for it.
- **Fallback:** the component toggles `data-overflow-{y,x}-{start,end}` on the masked element on scroll, on resize (a `ResizeObserver` on the scroller and each child) and on DOM changes (a `MutationObserver`, subtree), and the registered properties ease between 0 and the fade size over 150ms.
- A bare `scroll-fade` on an element that clips but does not scroll (a card action row) reads its own timelines (inactive) and relies on the attributes.

**Do:** use `ScrollFade` inside popups and short lists; pass `orientation='horizontal'` for a sideways strip so content clipped vertically never fades.

**Don't:** paint a gradient; put padding that should scroll on the outer div in `targetRef` mode; render `ScrollFade` before its target.

```tsx
const listRef = React.useRef<HTMLDivElement>(null);

<div ref={listRef} className='max-h-64 overflow-y-auto p-1'>
  {items}
</div>
<ScrollFade targetRef={listRef} />

// or, owning the scroller:
<ScrollFade orientation='horizontal' size={16} className='w-full'>
  <div className='flex w-max gap-1.5'>{chips}</div>
</ScrollFade>
```

#### Select

**For:** choosing one value from a short list of options in a form field, a settings row or a toolbar (a stage, a model, a workspace mode). The popup opens over the trigger like a native select, with the selected row sitting exactly on the trigger.

**Not for:** a choice that also needs actions ("Copy prompt", "Enter manually"): that is a `DropdownMenu` with a radio group and plain items after a separator. Navigation. Search-as-you-type (use the command or combobox pattern). A boolean (use `Switch`).

**Wraps:** Base UI `Select` (`Root`, `Trigger`, `Value`, `Icon`, `Portal`, `Positioner`, `Popup`, `List`, `Group`, `GroupLabel`, `Item`, `ItemText`, `ItemIndicator`, `Separator`, `ScrollUpArrow`, `ScrollDownArrow`) plus the kit's `HighlightList` (the sliding highlight) and `useControllableOpen`.

**Anatomy:**

```
Select                          (Root; provides open state and items)
├─ SelectTrigger                (Trigger, data-slot=select-trigger, data-variant)
│  ├─ SelectValue               (Value, data-slot=select-value)
│  └─ chevron                   (Icon render=<Icon name='IconChevronDownMedium'/>)
└─ SelectContent                (Portal > Positioner > Popup, data-slot=select-content)
   ├─ SelectScrollUpButton      (ScrollUpArrow, data-slot=select-scroll-up-button)  [rendered by SelectContent]
   ├─ List (scrolls) > HighlightList (p-1 + sliding indicator)
   │  ├─ SelectGroup            (Group, data-slot=select-group)
   │  │  ├─ SelectLabel         (GroupLabel, data-slot=select-label)
   │  │  └─ SelectItem          (Item, data-slot=select-item, data-icon)
   │  │     ├─ ItemText (leading icon + label)
   │  │     ├─ trailing icon (when icon.position='inline-end')
   │  │     └─ ItemIndicator (checkmark)
   │  └─ SelectSeparator        (Separator, data-slot=select-separator)
   └─ SelectScrollDownButton    (ScrollDownArrow, data-slot=select-scroll-down-button) [rendered by SelectContent]
```

**Props:**

| Part | Prop | Default | Notes |
| --- | --- | --- | --- |
| `Select` | `value`, `defaultValue`, `onValueChange`, `multiple`, `disabled`, `name`… | Base UI's | Generic over `Value`. |
| | `items` | | `{ value, label?, icon? }[]`. Base UI maps value → label; the kit also reads it to mirror the selected item's icon in the trigger. Always pass it. |
| | `open`, `defaultOpen`, `onOpenChange` | uncontrolled, closed | Controlled when `open` is passed: the caller owns it and only hears about changes (`useControllableOpen`). |
| `SelectTrigger` | `variant` | `'default'` | `default` (filled field) or `ghost` (no fill at rest). |
| | `size` | `'default'` | `default` 26px or `sm` 24px. |
| | `onMouseDown`, `onClick` | | Chained after the kit's own handlers. |
| `SelectValue` | `placeholder` | | Shown for `null`, `undefined` or `''`. |
| | `children` | render function | Pass children to override the rendering. |
| `SelectContent` | `side` | `'bottom'` | |
| | `sideOffset` | `4` | |
| | `align` | `'start'` | |
| | `alignOffset` | `0` | |
| | `alignItemWithTrigger` | `true` | The selected item lands on the trigger. |
| `SelectItem` | `value`, `disabled`, `label` | | Base UI's. |
| | `icon` | | An icon name (leading) or `Icon` props plus `position: 'inline-start' \| 'inline-end'`. |
| `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` | `className` | | |

**Trigger classes:**

- Base: `group/select-trigger relative isolate flex w-fit cursor-pointer select-none items-center justify-between gap-1.5 whitespace-nowrap font-medium text-fg-4`
- `size='default'`: `corner-superellipse/1.125 h-6.5 rounded-control px-2.5 text-xs [--icon-size:var(--icon-size-sm)]`
- `size='sm'`: `corner-superellipse/1.125 h-6 rounded-control-sm px-1.5 text-xs [--icon-size:var(--icon-size-sm)]`
- Fill layer (the fill lives on `::before` so it can deflate on press): `before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:content-[''] enabled:active:before:inset-x-(--press-inset-x) enabled:active:before:inset-y-(--press-inset-y)`
- `variant='default'`: `before:bg-input enabled:active:before:bg-input-hover/80 enabled:hover:before:bg-input-hover/80 aria-expanded:before:bg-input-hover/80`
- `variant='ghost'`: `enabled:active:before:bg-bg-a2/70 enabled:hover:before:bg-bg-a2/70 aria-expanded:before:bg-bg-a2`
- States: `outline-none disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-fg-2`
- Value child: `*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none`
- Chevron: `IconChevronDownMedium` with `pointer-events-none`; chevrons always draw in a 14px box whatever `--icon-size` is.

| Size | Height | Corner | Padding x | Text | Icon size (`--icon-size`) | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| `default` | 26px | 7px | 10px | 13px, 450 | 16px | 6px |
| `sm` | 24px | 6px | 6px | 13px, 450 | 14px | 6px |

| State | `default` fill | `ghost` fill |
| --- | --- | --- |
| Rest | `--input` (`bg-2`) | none |
| Hover / pressed (enabled) | `--input-hover` (`bg-3`) at 80% | `bg-a2` at 70% |
| Open (`aria-expanded`) | `--input-hover` at 80% | `bg-a2` |
| Pressed | the fill box insets 1px left and right, 0.5px top and bottom (`--press-inset-x/y`), in the frame of the press, no transition | same |
| Disabled | 50% opacity, `cursor-not-allowed` | same |
| Placeholder shown | text `fg-2` | same |

**It opens on click, not on mousedown.** The kit blocks Base UI's mousedown handler (`preventBaseUIHandler`) and toggles open in `onClick` with reason `'trigger-press'`, so the press deflate is visible before the popup covers the trigger.

**Value rendering:** for `null`/`''` the placeholder; for a value found in `items`, the item's leading icon then `<span className='truncate'>{label}</span>`; for a value not in `items`, `String(value)` (never blank). Value classes: `flex min-w-0 flex-1 items-center gap-2 text-left`.

**Popup classes** (the popup is a static shell; the surface lives on `::before` so only the background animates while text lands at once):

- Positioner: `isolate z-50`.
- Popup: `corner-superellipse/1.125 relative isolate z-50 flex max-h-(--available-height) min-w-(--anchor-width) flex-col whitespace-nowrap rounded-popup text-popover-foreground`
- Surface: `before:corner-superellipse/1.125 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-popover before:shadow-md before:content-['']`
- Entry only (closing is instant): `before:origin-(--transform-origin) before:duration-150 before:ease-out data-open:before:animate-in data-open:before:fade-in-0 data-open:before:zoom-in-95`
- Over the trigger (Base UI reports `data-side="none"` when it aligned the selected item with the trigger): `data-open:data-[side=none]:before:fade-in-100 data-open:data-[side=none]:before:zoom-in-[0.975] data-[side=none]:before:origin-center`
- List: `min-h-0 flex-1 overflow-y-auto overflow-x-hidden`, wrapping a `HighlightList` (`relative isolate p-1` with an indicator `pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0`, moved by `useAnimatedIndicator` on `data-highlighted`).

**Popup geometry and motion:**

- Width: at least the trigger's width (`--anchor-width`), growing to the widest row (rows never wrap: `whitespace-nowrap`). Height capped at the available height; the list scrolls.
- 10px corners, `bg-popover` with the 1px `bg-3` ring.
- 4px list padding. Item text starts 12px in (4px list padding + 8px item padding) against the trigger's 10px, so the aligned popup's edge lands 2px outside the trigger's. This is why `pl-2` on items is load-bearing.
- Beside the trigger: the surface fades 0 → 1 and grows 0.95 → 1 over 150ms `ease-out` (Tailwind's `cubic-bezier(0, 0, 0.2, 1)`). Over the trigger: no fade; the surface grows 0.975 → 1 from its centre, taking over from the trigger's press. Rows and text appear at once. Closing is instant.

**Item classes:**

- Item: `relative flex w-full cursor-pointer select-none items-center gap-1.5 rounded-item py-1 pr-7 pl-2 font-medium text-fg-3 text-xs leading-4 outline-hidden [--icon-size:var(--icon-size-sm)] data-disabled:pointer-events-none data-indicator-here:text-fg-4 data-disabled:opacity-50 [&[data-indicator-here]_span]:text-fg-4 [&_svg]:pointer-events-none *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2`
- ItemText: `flex flex-1 shrink-0 items-center gap-2 whitespace-nowrap` (leading icon, then the label).
- Indicator box: `pointer-events-none absolute right-2 flex size-(--icon-size-md) items-center justify-center`, holding `Icon name='IconCheckmark1'` with `pointer-events-none rotate-[4deg] text-primary-text`.
- SelectLabel: `select-none px-2 pt-1.5 pb-0.5 font-medium text-fg-2 text-xs`
- SelectSeparator: `pointer-events-none -mx-1 my-1 h-px bg-bg-3` (full-bleed across the 4px list padding, 4px above and below).
- SelectGroup: `scroll-my-1`.
- Scroll arrows: `top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1` (up, `IconChevronTopMedium`) and the same with `bottom-0` (down, `IconChevronDownMedium`).

| Item measure | Value |
| --- | --- |
| Row height | 24px (16px line + 4px top and bottom) |
| Padding | 8px left, 28px right (room for the check) |
| Icon | 14px, 6px to the label |
| Text | 13px, 450, `fg-3`; `fg-4` while the highlight sits on it (`data-indicator-here`, set by the indicator hook) |
| Highlight | the shared sliding `bg-a2` surface, 6px corners, never a background of the row's own |
| Check | 16px box 8px from the right edge, glyph rotated 4°, `primary-text` (the accent) |
| Disabled | 50% opacity, not clickable |
| Group label | 13px, 450, `fg-2`, 8px left, 6px top, 2px bottom |

**Do:** pass `items` to `Select` so the trigger shows label and icon from the first paint; use `ghost` in a toolbar or a settings row where a filled field would be too heavy (the coverage and workspace pickers in a project row are ghost `sm`); use `default` in a form.

**Don't:** put actions in a select; draw a row highlight background (the lint rejects it); pass `min-w-*` to `SelectContent` (it replaces the anchor-width floor); open on mousedown.

```tsx
const STAGES = [
  { value: 'gate', label: 'Waiting on you', icon: 'IconInboxEmpty' },
  { value: 'build', label: 'Building', icon: 'IconAgents' },
] as const;

<Select defaultValue='gate' items={STAGES}>
  <SelectTrigger className='w-44'>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Stage</SelectLabel>
      {STAGES.map((item) => (
        <SelectItem key={item.value} value={item.value} icon={item.icon}>
          {item.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
</Select>
```

#### Separator

**For:** a hairline between two blocks or two inline groups.

**Not for:** a separator inside a menu or select (use their own `*Separator`); a card edge (cards draw their own ring).

**Wraps:** Base UI `Separator` (`role="separator"`, `data-orientation` → the `data-horizontal` / `data-vertical` variants).

**Props:** `orientation` `'horizontal'` (default) or `'vertical'`; `className`.

**Classes:** `shrink-0 bg-bg-3 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch`

1px of `bg-3`: full width when horizontal, full height of a flex row when vertical (the row needs a height or stretched items).

```tsx
<div className='flex h-10 items-center gap-3'>
  <span className='text-fg-3 text-sm'>Left</span>
  <Separator orientation='vertical' />
  <span className='text-fg-3 text-sm'>Right</span>
</div>
```

#### Sheet

**For:** a side panel over the page that keeps a header and footer pinned while its body scrolls (every run of a task, a long form on a narrow screen).

**Not for:** a confirmation (alert dialog); a short form (dialog); anything you hover (preview card).

**Wraps:** Base UI `Dialog` (`Root`, `Trigger`, `Close`, `Portal`, `Backdrop`, `Popup`, `Title`, `Description`). The corner close button is the kit's `DialogCloseButton`.

**Anatomy:**

```
Sheet                      (Root, data-slot=sheet)
├─ SheetTrigger            (Trigger, data-slot=sheet-trigger)
└─ SheetContent            (Portal > [Backdrop data-slot=sheet-overlay] + Popup data-slot=sheet-content, data-side, data-close-button)
   ├─ SheetHeader          (div, data-slot=sheet-header)
   │  ├─ SheetTitle        (Title, data-slot=sheet-title)
   │  └─ SheetDescription  (Description, data-slot=sheet-description)
   ├─ SheetBody            (div, data-slot=sheet-body; the one scroller)
   ├─ SheetFooter          (div, data-slot=sheet-footer)
   └─ close X              (DialogCloseButton with data-slot=sheet-close; when showCloseButton)
SheetClose                 (Close, data-slot=sheet-close) for your own close buttons
```

**Props:**

| Part | Prop | Default | Notes |
| --- | --- | --- | --- |
| `SheetContent` | `side` | `'right'` | `top`, `right`, `bottom`, `left` |
| | `showCloseButton` | `true` | The corner X. |
| | `initialFocus` | the popup itself | Focus lands on the panel, not on its first control. |
| Others | Base UI props, `className` | | |

**Classes:**

- Overlay: `fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/55`
- Popup: `group/sheet-content corner-superellipse/1.125 fixed z-50 flex flex-col gap-3 bg-background bg-clip-padding text-fg-3 text-xs shadow-lg outline-none transition-[translate] duration-200 ease-out` plus, per side:
  - slide: `data-[side=left]:data-ending-style:-translate-x-full data-[side=left]:data-starting-style:-translate-x-full data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full data-[side=top]:data-ending-style:-translate-y-full data-[side=top]:data-starting-style:-translate-y-full`
  - placement: `data-[side=bottom]:inset-x-0 data-[side=top]:inset-x-0 data-[side=left]:inset-y-0 data-[side=right]:inset-y-0 data-[side=top]:top-0 data-[side=right]:right-0 data-[side=bottom]:bottom-0 data-[side=left]:left-0`
  - size: `data-[side=bottom]:h-auto data-[side=left]:h-full data-[side=right]:h-full data-[side=top]:h-auto data-[side=bottom]:max-h-[85dvh] data-[side=top]:max-h-[85dvh] data-[side=left]:w-3/4 data-[side=right]:w-3/4 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm`
  - corners: `data-[side=bottom]:rounded-t-3xl data-[side=left]:rounded-r-3xl data-[side=top]:rounded-b-3xl data-[side=right]:rounded-l-3xl`
- SheetHeader: `flex shrink-0 flex-col p-3 group-data-[close-button]/sheet-content:pr-12`
- SheetBody: `min-h-0 flex-1 overflow-y-auto px-3`
- SheetFooter: `mt-auto flex shrink-0 flex-col gap-1.5 p-3`
- SheetTitle: `font-medium text-fg-4 text-sm`
- SheetDescription: `text-pretty text-fg-2 text-xs`
- Close X: `Button variant='secondary' size='icon-sm'` (24px square, 6px corners, 14px glyph) at `absolute top-3 right-3` (12px from the top and right), glyph `IconCrossMedium`, `aria-label="Close"`, no tooltip.

**Geometry:**

| Side | Size | Rounded edge (15px) |
| --- | --- | --- |
| `right` / `left` | full height, 75% of the viewport wide, at most 384px from the `sm` breakpoint (640px) up | the edge facing the page |
| `top` / `bottom` | full width, as tall as content, at most 85% of the dynamic viewport height | the edge facing the page |

Sections are 12px apart (`gap-3`); header and footer have 12px padding; the header reserves 48px on the right for the close X; the body has 12px side padding and is the only scroller; footer buttons stack with 6px between them. Surface `bg-background` with the 1px `bg-3` ring; body text 13px `fg-3`.

**Motion:** the panel slides its full size in from its side over 200ms `ease-out` (`cubic-bezier(0, 0, 0.2, 1)`) using Base UI's `data-starting-style` / `data-ending-style`; the scrim fades over 150ms. Scrim: black at 10% in light, 55% in dark, never a blur.

**Do:** put scrolling content in `SheetBody`; keep the title short.

**Don't:** give the close X a tooltip (the X says it); scroll the whole popup.

```tsx
<Sheet>
  <SheetTrigger render={<Button variant='outline' />}>Agent runs</SheetTrigger>
  <SheetContent side='right'>
    <SheetHeader>
      <SheetTitle>Agent runs</SheetTitle>
      <SheetDescription>Every run on this task, newest last.</SheetDescription>
    </SheetHeader>
    <SheetBody className='flex flex-col gap-3'>
      {runs.map((run) => (
        <div key={run.id} className='flex flex-col'>
          <span className='font-medium text-fg-4 text-sm'>{run.title}</span>
          <span className='text-fg-2 text-xs'>Worked for <Duration from={run.startedAt} to={run.endedAt} /></span>
        </div>
      ))}
    </SheetBody>
    <SheetFooter>
      <Button className='w-full'>Restart task</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

#### ShimmeringText

**For:** the one line that says an agent is working right now: the live card's current step ("Reading app.tsx"), a running tool's label, a message being delivered ("Starting"), "Waiting for the result…". The shimmer is what says "live".

**Not for:** a loading state of a read (that is a spinner after a 300ms wait); static labels; anything that is paused (render the plain text instead).

**Wraps:** `motion` (`motion.span`, `useReducedMotion`).

**Props:**

| Prop | Default | Notes |
| --- | --- | --- |
| `text` | required | A string; each character animates on its own. |
| `duration` | `1` (s) | One shimmer cycle. |
| `paused` | `false` | Stop the shimmer (for example when off screen). |
| `className` and `motion.span` props | | |

**Markup and classes:**

- Outer `motion.span`: `inline-flex select-none items-center leading-none [--color:var(--muted-foreground)] [--shimmering-color:var(--foreground)]` + `className`.
- One `motion.span` per character: `inline-block whitespace-pre leading-none`, `aria-hidden`.
- A trailing `<span className='sr-only'>{text}</span>` so assistive tech reads the whole string once.

**Animation per character** (state `running`):

- `color` keyframes: `var(--color)` → `var(--shimmering-color)` → `var(--color)` (`muted-foreground` = `fg-2` → `foreground` = `fg-4` → `fg-2`).
- duration `duration` s, `easeInOut`, repeat forever (`loop`), `repeatDelay` = `text.length × 0.05` s, `delay` = `charIndex × duration / text.length` s. With the defaults the bright band sweeps the whole string left to right in 1s, then the line rests for 50ms per character.
- `stopped` (when `paused` or the user prefers reduced motion): `color: var(--color)` over `duration × 0.5` s `easeOut`. Initial state is `stopped`.

**In Shinsa** the line class is `SHIMMER_LINE` = `block truncate leading-normal`, and a changed step remounts the component (`key={step}`) so the sweep restarts. Override the two colour variables to shimmer on another surface.

```tsx
<ShimmeringText key={step} text={step} className='block truncate leading-normal' />
<ShimmeringText text='Waiting for the result…' className='text-2xs text-fg-2' />
```

#### SizeAnimator

**For:** content whose height changes and should ease instead of snapping: a popup whose list filters, the live card swapping its step, a section that reveals more rows.

**Not for:** disclosures with their own height animation (collapsibles); width changes (it animates height only).

**Wraps:** nothing (a `ResizeObserver`).

**Props:** `children`; `className` (on the outer box); `duration` in ms, default `180`.

**Markup:** an outer `div` (`overflow-hidden` + `className`, inline `transition: height <duration>ms cubic-bezier(0.22, 1, 0.36, 1)`) around an inner `div` whose natural height is observed. On the first measure the outer height is set with the transition off (no animation on mount); every later change sets `height: <inner offsetHeight>px` and the transition runs.

The live card uses `duration={240}`; the default 180ms is for popup content.

```tsx
<SizeAnimator className='w-72 rounded-xl bg-bg-2'>
  <div className='flex flex-col gap-2 p-3'>
    <span className='text-fg-3 text-sm'>Always visible</span>
    {expanded && <span className='text-fg-3 text-sm'>Revealed row</span>}
  </div>
</SizeAnimator>
```

#### Toaster and toast

**For:** a short message about something the app or an agent did that the screen does not already show: "Copied", a merge finished, an action refused by the server, a loading step that settles ("Updating Claude Code…" → "Updated"). Every copy action toasts "Copied".

**Not for:** form validation (inline `FieldError`); persistent state (badges, the page itself); anything the user must decide (dialog).

**Wraps:** `sonner` (`Toaster`, `toast`), with Shinsa's styling, dedupe and attention cues on top.

**Mount `<Toaster />` once at the app root.** Its fixed settings:

| Setting | Value |
| --- | --- |
| `position` | `top-center` |
| `offset` / `mobileOffset` | `{ top: 12 }` (12px from the top, over the empty middle of the top bar) |
| `gap` | 8px between stacked toasts |
| `className` | `toaster group` |
| `--width` | 420px (`--normal-bg: var(--popover)`, `--normal-text: var(--popover-foreground)`, `--normal-border: transparent` as fallbacks) |
| toast class | `bk-toast corner-superellipse/1.125 cursor-default rounded-popup font-medium` |
| toast inline style | `font-size: 13px; background-color: var(--popover); user-select: none` (inline beats sonner's injected stylesheet) |
| action button | `bk-toast-button corner-superellipse/1.125 !h-6 !cursor-pointer !rounded-control-sm !bg-primary !px-2.5 !font-medium !text-primary-foreground !text-xs` |
| cancel button | `bk-toast-button corner-superellipse/1.125 !h-6 !cursor-pointer !rounded-control-sm !bg-bg-a2 !px-2.5 !font-medium !text-fg-3 !text-xs` |
| close button | `bk-toast-button corner-superellipse/1.125 !cursor-pointer !rounded-control !bg-bg-2 !text-fg-3` |

Icons (14px, `size='sm'`, the size beside the toast's 13px text): success `IconCheckCircle2Filled` `text-primary-4` (checkmarks are the accent), info `IconInfoSimple` `text-primary-4`, warning `IconExclamationTriangleFilled` `text-amber-4`, error `IconExclamationCircleFilled` `text-red-4`, loading `Spinner size='sm'` `text-fg-2`. The kind sets only the icon; the surface is always neutral.

**Toast box CSS** (unlayered, so it beats sonner's own unlayered stylesheet). Unlayered is not enough: sonner appends its `<style>` to `<head>` when its module runs, after the app's stylesheet `<link>` in a production build (the dev server injects ours later, which hides this), so a tie in specificity goes to sonner. **Every rule that replaces one of sonner's must be strictly more specific than it:** the toast's parts are scoped under `[data-sonner-toast][data-styled="true"].bk-toast` (0,4,0), one step above sonner's `[data-sonner-toast][data-styled=true] [data-icon]` (0,3,0). `packages/ui/test/styles/toast-cascade.test.ts` reads sonner's injected stylesheet and fails on any toast rule that only ties.

```css
[data-sonner-toast][data-styled="true"].bk-toast {
  border-radius: var(--radius-popup);   /* 10px */
  border: 1px solid var(--bg-3);
  box-shadow: none;
  gap: 8px;
  padding: 6px 10px;
  min-height: 34px;
  width: fit-content;
  max-width: 420px;
}
[data-sonner-toaster][data-x-position="center"] [data-sonner-toast].bk-toast {
  left: 0; right: 0; margin-inline: auto;   /* fit-content toasts stay centred */
}
[data-sonner-toast][data-styled="true"].bk-toast:has([data-description]) {
  padding: 10px; gap: 8px; min-height: 0;
}
/* With an action: the button sits against the right edge. 34px toast, 24px button → 5px. */
[data-sonner-toast][data-styled="true"].bk-toast:has([data-content] + *) { padding-right: 5px; }
[data-sonner-toast][data-styled="true"].bk-toast:has([data-description]):has([data-content] + *) { padding-right: 10px; }
[data-sonner-toast][data-styled="true"].bk-toast [data-content] { gap: 0; flex: 1 1 auto; min-width: 0; }
[data-sonner-toaster] [data-sonner-toast].bk-toast [data-description] {
  color: var(--fg-2); margin-top: 6px; font-size: var(--text-2xs); line-height: 1.2;
}
[data-sonner-toast][data-styled="true"].bk-toast [data-icon] {
  width: 14px; height: 14px; flex-shrink: 0;
  margin: 0 -2px 0 0;   /* the 8px gap less 2px: 6px to the text, as a menu row; the action stays 8px away */
  display: flex; align-items: center; justify-content: center; position: relative;
}
[data-sonner-toast][data-styled="true"].bk-toast [data-icon] svg { margin: 0; }   /* sonner's -1px nudge, the loader's svg too */
[data-sonner-toaster] [data-sonner-toast].bk-toast [data-title],
[data-sonner-toaster] [data-sonner-toast].bk-toast [data-description] {
  text-box: trim-both cap alphabetic;   /* glyph edges line up with flex alignment */
}
[data-sonner-toast][data-styled="true"].bk-toast:has([data-description]) [data-icon] { align-self: flex-start; margin-top: -2.5px; }
```

So a one-line toast is 34px tall: 11px from the edge a 14px icon, 6px, the 13px medium title in `popover-foreground`, then (optionally) a 24px action button 5px from the right edge. With a description the toast pads 10px all round, the icon top-aligns with the title's cap height, and the description is 12px `fg-2` 6px under the title.

**Loading → result cross-fade:** the loader stays absolutely centred in the icon box so the result icon lands in the same spot. It takes the box's full size (sonner's `left: 50%` would shrink it to 13px and leave the spinner half a pixel off). The result icon's animation fills `both`: sonner hides a promise toast's icon with `opacity: 0` and only its own fade-in (replaced here) brings it back, so without the fill a settled loading toast shows no icon.

```css
[data-sonner-toast].bk-toast .sonner-loader {
  width: 100%; height: 100%;
  transition: opacity 200ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
[data-sonner-toast].bk-toast .sonner-loader[data-visible="false"] {
  opacity: 0; transform: scale(0.85) translate(-50%, -50%);
}
@keyframes bk-toast-icon-in { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
[data-sonner-toast][data-styled="true"].bk-toast [data-icon] > svg {
  transform: none; transform-origin: center;
  animation: bk-toast-icon-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
```

**Attention cues** (animate `translate` and `scale`, which compose with sonner's own `transform` stacking):

```css
@keyframes bk-toast-shake { 0%, 100% { translate: 0 0; } 25% { translate: -2px 0; } 50% { translate: 2px 0; } 75% { translate: -1px 0; } }
@keyframes bk-toast-bump { 0%, 100% { scale: 1; } 50% { scale: 1.015; } }
[data-sonner-toast].bk-toast-shake { animation: bk-toast-shake 0.35s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
[data-sonner-toast].bk-toast-bump  { animation: bk-toast-bump 0.3s ease-out; }
```

`error` and `warning` shake; `default`, `success` and `info` bump. A cue restarts by removing both classes, forcing a reflow and adding the class again.

**The `toast` API:**

| Call | Behaviour |
| --- | --- |
| `toast(message, options?)` | default kind |
| `toast.success`, `.error`, `.warning`, `.info` | that kind |
| `toast.loading(message, options?)` | a sonner promise toast with id `options.id` or `loading-<n>`; returns the id. Settle it later with `toast.success(msg, { id })` (or `.info`, `default`), which resolves it; `toast.error` / `toast.warning` with the id reject it. Either way it cross-fades in place to the result kind and plays the result's cue (shake for error and warning). |
| `toast.promise(promise, options)` | sonner's promise toast; returns its id, or `undefined` when it shows nothing. |
| `toast.dismiss(id?)` | dismiss one (or all), forgetting pending loading handles. |
| `toast.custom(jsx, options?)`, `toast.message(message, options?)` | passed straight to sonner. |
| any call with `options.id` that is not a pending loading toast | passed straight to sonner (update in place). |

**Dedupe:** a string message with the same kind and text as a live toast never stacks a copy. If that toast is at the top of the stack it is updated in place and pinged (shake or bump) once sonner has rendered (after a zero-delay timeout and one animation frame). If it is buried, the old one is dismissed and a new one is shown at the top and pinged. A toast is forgotten when it is dismissed or closes itself, and the caller's own `onDismiss` / `onAutoClose` still run. A React-node message never dedupes. The `Toaster` watches every toast's `data-type` (a `MutationObserver` on the body with `attributeOldValue`) and plays the cue when it changes from `loading` to a result, so a sonner promise toast settling cues too.

Sonner's own defaults stand for everything not listed (auto-close time, stack behaviour, enter and exit motion, swipe to dismiss).

**Copy rules that bind toasts:** a toast states the outcome, in sentence case, with a period when it is a sentence ("Approved. Opening the pull request."), a short fragment otherwise ("Copied"). An error says what failed and, in the description, what to do.

```tsx
// Root
<Toaster />

// Anywhere
toast.success('Approved. Opening the pull request.');
toast.error('Couldn’t reach Shinsa', { description: 'Run shinsa status to see whether the engine is running.' });
toast('Task cancelled', {
  description: 'The agent stopped and the worktree is gone.',
  action: { label: 'Undo', onClick: () => restore() },
});

const id = toast.loading('Merging…');
await merge();
toast.success('Merged #4512', { id });
```

#### Spinner

**For:** work in progress where an icon would stand: a busy button's icon, a loading row after the 300ms wait, the loading toast, a file the Code tab is still reading. It sits on the icon scale and in the icon ink.

**Not for:** a read that usually finishes fast (show nothing for 300ms first); a whole page waiting on its first paint (pages render their static parts at once); an agent working (that is `ShimmeringText`).

**Wraps:** nothing (an inline SVG; `Icon`, `Spinner` and `Logo` are the only things that draw an SVG).

**Props:** `size` `'sm'` (14px) / `'md'` (16px) / `'lg'` (20px), default none (draws at the inherited `--icon-size`, 14px unless a primitive set it); `aria-label`, default `"Loading"`; `className`; `style`.

**Markup:**

```tsx
<svg data-slot='spinner' role='status' aria-label='Loading' viewBox='0 0 16 16' fill='none'
     className='shrink-0 animate-spin size-(--icon-size)'>
  <circle cx='8' cy='8' r='6.25' stroke='currentColor' strokeOpacity='0.3' strokeWidth='1.5' />
  <path d='M14.25 8A6.25 6.25 0 0 0 8 1.75' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
</svg>
```

A 12.5px ring at 30% of the ink with a quarter arc at full ink, 1.5px strokes (in the 16px box), rotating once per second, linear (`animate-spin`). The colour comes from the icon ink (`color: var(--icon-color, currentColor)` on `[data-slot=spinner]`), so `text-fg-2` on the spinner or its parent draws it in `icon-2`. `animate-spin` is the one animation exempt from reduced motion: a spinner that stops stops saying anything.

```tsx
<span className='flex items-center gap-2 text-fg-2 text-xs'>
  <Spinner size='sm' />
  Reading the changes
</span>
```

#### Switch

**For:** an on/off setting that applies immediately, in a settings row or a popover row with a `Label` (turn an agent off, use an MCP for Shinsa's agents).

**Not for:** a boolean inside a menu (a checkbox item with a trailing check); a list of boxes to pick several (Checkbox); a choice that needs Save.

**Wraps:** Base UI `Switch` (`Root` renders the `role="switch"` element with a hidden input; `Thumb`). Relies on `data-checked`, `data-disabled`.

**Props:** Base UI `Switch.Root` props (`checked`, `defaultChecked`, `onCheckedChange`, `disabled`, `id`, `name`…) and `className`. One size only.

**Classes:**

- Root: `peer group/switch relative inline-flex h-5 w-8 shrink-0 items-center rounded-full border border-transparent bg-bg-3 transition-[background-color,box-shadow] duration-200 ease-out outline-none after:absolute after:-inset-x-3 after:-inset-y-2 not-data-disabled:cursor-pointer data-checked:bg-primary-4 data-disabled:cursor-not-allowed data-disabled:[&>span]:opacity-50`
- Thumb: `pointer-events-none flex size-4 items-center justify-center rounded-full bg-background text-primary-4 ring-0 transition-transform duration-150 ease-out shadow-control-knob translate-x-px data-checked:translate-x-[calc(100%-3px)]`

**Geometry:** track 32 × 20px, fully round, 1px transparent border; knob 16px, 2px from every edge (1px border + 1px translate); checked, its translate becomes 13px (`100% − 3px`), 12px further right, so it sits 2px from the right edge. The invisible `::after` extends the hit area 12px left and right and 8px up and down (56 × 36px).

| State | Track | Knob |
| --- | --- | --- |
| Off | `bg-3` | `background` with the knob shadow, 1px in |
| On | `primary-4` (the accent) | moved right |
| Disabled | `cursor-not-allowed` | 50% opacity |

**Motion:** the track colour eases over 200ms `ease-out` (a switch turning on is a change allowed to ease); the knob slides over 150ms `ease-out`. The knob deliberately does not create its own compositor layer (no `will-change`), because in a long card hundreds of layered switches stopped painting past the GPU's texture limit.

**Do:** pair with a `Label` (`htmlFor`); put it at the right end of a row.

```tsx
<div className='flex items-center justify-between'>
  <Label htmlFor='notify-digest'>Daily digest</Label>
  <Switch id='notify-digest' defaultChecked />
</div>
```

#### Tabs

**For:** switching between views of the same thing in place: the task's views, the Code explorer's Changes and Files, Settings' tabs, a finding's Fix and Dismiss, the terminal tabs. Every tab bar in Shinsa is this component (or the app's `Choice`, built on it, for a labelled switch).

**Not for:** navigation between pages; filters that are really a select; a stack of pages (the command menu's pages are a stack, not tabs).

**Wraps:** Base UI `Tabs` (`Root`, `List`, `Tab`, `Panel`, `Indicator`), plus `useAnimatedIndicator` for the segmented pill. Relies on `data-orientation`, `data-active` on the selected tab, and Base UI's `--active-tab-width` / `--active-tab-left` for the underline.

**Anatomy:**

```
Tabs                 (Root, data-slot=tabs, data-orientation; group/tabs)
├─ TabsList          (List, data-slot=tabs-list, data-variant; group/tabs-list)
│  ├─ indicator      (default: a div moved by useAnimatedIndicator; underline: Base UI Indicator; ghost: none)
│  └─ TabsTrigger…   (Tab, data-slot=tabs-trigger)
└─ TabsContent…      (Panel, data-slot=tabs-content)
```

`tabsListVariants` (the cva) is exported for a list-shaped element that must match.

**Props:** `Tabs` takes Base UI Root props (`value`, `defaultValue`, `onValueChange`) and `orientation` (`'horizontal'` default, or `'vertical'`). `TabsList` takes `variant` (`'default'`, `'ghost'`, `'underline'`). There is no size prop.

**Classes:**

- Root: `group/tabs flex gap-2 data-horizontal:flex-col` (8px between list and panel).
- List base: `group/tabs-list relative isolate inline-flex w-fit items-center justify-center group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col`
  - `default`: `corner-superellipse/1.125 gap-1 rounded-control bg-bg-2 p-0.5 group-data-horizontal/tabs:h-6.5`
  - `ghost`: `gap-3 bg-transparent group-data-horizontal/tabs:h-6.5`
  - `underline`: `gap-1 bg-transparent group-data-horizontal/tabs:h-8`
- Segmented pill (`default` only): `corner-superellipse/1.125 pointer-events-none absolute top-0 left-0 -z-10 rounded-segment bg-background opacity-0 shadow-1 dark:bg-bg-4` with inline `will-change: transform, opacity; contain: layout paint; transform-origin: center`, `aria-hidden`, `data-slot=tab-indicator`, `data-motion=move`; moved by `useAnimatedIndicator(list, { attribute: 'data-active', press: false })`.
- Underline line (`underline` only): `absolute bottom-0 left-0 z-10 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-px rounded-full bg-primary transition-[width,translate] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`, `data-slot=tab-indicator`, `data-motion=move`. It is placed from the list's top-left by the tab's own offsets, not Base UI's bottom offset, which a touch target's overflow would inflate.
- Trigger: `relative inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium text-fg-2 text-xs outline-none hover:text-fg-4 active:text-fg-4 data-active:text-fg-4 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start [--icon-size:var(--icon-size-md)] [&_svg]:pointer-events-none` plus
  - in `default`: `group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:rounded-segment group-data-[variant=default]/tabs-list:px-2`
  - in `underline`: `group-data-[variant=underline]/tabs-list:data-active:faux-medium group-data-[variant=underline]/tabs-list:h-full group-data-[variant=underline]/tabs-list:px-2 group-data-[variant=underline]/tabs-list:font-normal`
  - in `ghost`: `group-data-[variant=ghost]/tabs-list:enabled:active:scale-[0.975] group-data-[variant=ghost]/tabs-list:[will-change:scale]`
- Panel: `flex-1 text-sm outline-none`

| Variant | List height | Frame | Tab height | Tab padding x | Between tabs | Selected marker |
| --- | --- | --- | --- | --- | --- | --- |
| `default` (segmented) | 26px | `bg-2`, 7px corners, 2px padding | 22px | 8px | 4px | a sliding pill: `background` (light) / `bg-4` (dark), 5px corners, 1px `bg-3` ring |
| `ghost` | 26px | none | 26px (content) | 0 | 12px | none: text colour only; the tab scales to 0.975 while pressed |
| `underline` | 32px | none | 32px | 8px | 4px | a 2px `primary` line under the tab, 1px below the list's bottom edge; the selected label gains `faux-medium` (weight 400 plus a 0.011em stroke) so its width never changes |

Text: 13px, 450 (`underline` tabs 400), `fg-2`; `fg-4` on hover, press and when selected, in the frame it happens. Icons in tabs are 16px.

**Motion:** the pill moves on the movement clock: `transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out` (`INDICATOR_TRANSITION`), only through `transform` (translate plus a scale from the box it was laid out at), landing on the selected tab without travelling when it mounts. The underline animates `width` and `translate` over 200ms on the same curve. Colours never transition. Both indicators carry `data-motion="move"`, so a subtree that turns transitions off spares them (the selector to spare is `[data-motion=move]`).

**Do:** use `underline` only where its line meets a rule under it (a card's header strip, a frame's top edge); use `default` for a switcher floating in content.

**Don't:** write `role="tab"` or `role="tablist"` by hand or import Base UI tabs outside the kit; turn transitions off for a subtree without sparing `[data-motion=move]`.

```tsx
<Tabs defaultValue='walkthrough'>
  <TabsList>
    <TabsTrigger value='walkthrough'>Walkthrough</TabsTrigger>
    <TabsTrigger value='attention'>By attention</TabsTrigger>
  </TabsList>
  <TabsContent value='walkthrough'>The change in the order to read it.</TabsContent>
  <TabsContent value='attention'>Every spot, riskiest first.</TabsContent>
</Tabs>
```

#### Textarea

**For:** multi-line text a person types: a description, notes, an environment block, a reply.

**Not for:** a one-line value (`Input`); code editing (the editor).

**Wraps:** a native `<textarea>`.

**Props:** every `textarea` prop; `className`. `aria-invalid` turns on the invalid ring.

**Classes:** `corner-superellipse/1.125 field-sizing-content min-h-16 w-full rounded-lg bg-input px-2.5 py-1.5 text-fg-4 text-xs backdrop-blur-md outline-none placeholder:text-fg-2 disabled:cursor-not-allowed disabled:text-fg-1 disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-red-4`

**Geometry:** full width, at least 64px tall, grows with its content (`field-sizing: content`), 7px corners, 10px horizontal and 6px vertical padding, 13px `fg-4` text, placeholder `fg-2`. Filled with `--input` (`bg-2`, raised to `bg-3` inside a dark popover), never bordered; a 12px backdrop blur. No hover or focus change (no focus states). Invalid: a 1px `red-4` ring. Disabled: `fg-1` text at 50% opacity, `cursor-not-allowed`.

```tsx
<div className='flex flex-col gap-1.5'>
  <Label htmlFor='task-notes'>Notes</Label>
  <Textarea id='task-notes' placeholder='Describe the work' aria-invalid={!!error || undefined} />
</div>
```

#### Tooltip

**The rule first:** a tooltip must add information the screen doesn't show, and every tooltip is delayed.

- **No tooltip** when it would repeat the screen: a control whose tooltip would restate its own label, self-evident numbers ("+12 −3"), a generic `•••` menu trigger, the corner X of a dialog or sheet. Each keeps its `aria-label` when it has no visible text.
- **A labelled control keeps a tooltip that says what its label can't:** what pressing it leads to ("Opens the pull request"), or why a disabled control is disabled when the reason is not on screen.
- **A delayed tooltip** everywhere else hovering has more to tell: icon-only buttons whose glyph is not plain (it repeats the `aria-label`), keyboard shortcuts (even on a labelled button, since the key is not on screen), copy feedback ("Copy the task’s handle", flipping to "Copied" in place), small marks that carry meaning without a label (status glyphs, risk dots, project dots), text that hides more than it shows, every time stamp (the exact moment), and clipped text (`Truncate`).
- **Nothing opens instantly** under the pointer. Keyboard focus opens one at once; on a device without hover a tap opens it.
- **A tooltip opens over its text, never over the row it sits in.** The trigger is the text and its icon only: inline, or `w-fit` (`max-w-full` so it still truncates), never a block stretched across a full-width row. `Truncate` is the one block trigger, because its tooltip only exists while the text fills its box and is clipped.
- **Content:** a label, not prose. The value first in `fg-4`, the qualifier muted in `TooltipLabel` (`fg-2`), a state in its status colour (`*-text`), a list one item per line, mixed bright and muted text inside one `whitespace-nowrap` span. Never a sentence where a value and its label will do. A label-and-value pair sits apart (`justify-between gap-4`). A second line of detail stacks under the label (`flex-col items-start gap-px`).

**Architecture: one tooltip serves the page.** The outermost `TooltipProvider` mounts a single Base UI tooltip root and listens on the document (capture phase) for `pointerover`, `pointerout`, `pointermove`, `pointerdown`, `click`, `focusin`, `focusout` and `keydown`. A trigger is only its own element, registered in a `WeakMap` through a ref and marked `data-tooltip-trigger`: no component, state or listener of its own, so a page full of hints costs nothing until one opens. What a tooltip shows is read when it opens (a function source is called then), so costly content (a formatted exact time) is built only then. A nested `TooltipProvider` adds nothing; without a provider nothing opens.

**Exports:**

| Export | What it is |
| --- | --- |
| `TOOLTIP_DELAY` | `600` ms: how long the pointer rests on a trigger before its tooltip opens. |
| `TOOLTIP_SKIP_DELAY` | `400` ms: after a tooltip closes, the next trigger reached within this opens at once, without its entrance. |
| `TooltipProvider` | Mount once at the root (`{ children }`). |
| `useTooltipTrigger(element, source)` | Returns `element` cloned with a ref that registers it, `data-tooltip-trigger` (only when `source` is not null), and `data-slot="tooltip-trigger"` unless the element names its own slot. `source` is `TooltipOptions`, a function returning `TooltipOptions \| null` (read on open), or `null` (no tooltip). Refreshes an open tooltip when its source changes; closes it when the source turns null or the element unmounts. The element's own ref is kept. |
| `Tooltip` | Pairs one `TooltipTrigger` with one `TooltipContent`. Prop: `trackCursorAxis?: 'y'`. |
| `TooltipTrigger` | The trigger: `render` (an element) or, by default, `<button type='button'>`. Takes button props; handlers merge with the rendered element's own (the element's runs first, then the trigger's); both refs are kept. |
| `TooltipContent` | Renders nothing where it is written; registers its `children` and options with its `Tooltip`. Props: `side`, `align`, `sideOffset`, `alignOffset`, `className`, `children`. |
| `TooltipLabel` | `<span data-slot='tooltip-label' className='text-fg-2'>`: the muted qualifier. |

`TooltipOptions`: `content` (ReactNode), `className`, `side` (`'top'` default, `bottom`, `left`, `right`, `inline-start`, `inline-end`), `align` (`'center'` default, `start`, `end`), `sideOffset` (`4` px default), `alignOffset` (`0`), `trackCursorAxis` (`'y'`: follow the pointer down a tall trigger instead of centring on it; the anchor is a zero-height rect at the pointer's y across the trigger's width, updated once per animation frame).

There is no `delay` prop anywhere, by design: one delay for every tooltip.

**Open and close rules:**

| Event | Result |
| --- | --- |
| Pointer (mouse or pen) enters a trigger | after 600ms it opens; if the group is warm (a tooltip open, or closed less than 400ms ago) it opens at once with `data-instant` (no entrance). Leaving before 600ms opens nothing. Nested triggers: the innermost wins. Touch hovers are ignored. |
| Pointer moves to another trigger | the current one closes and the next one opens (instantly, since the group is warm). |
| Pointer moves onto the tooltip itself | it stays open. |
| Pointer moves to the rest of the page | it closes; the marks it set on the trigger are removed. |
| Pointer leaves the window | it closes. |
| Press on the trigger (device with hover) | it closes and the group cools (next one waits 600ms again). That trigger stays closed until the pointer leaves it and comes back. |
| Press elsewhere | it closes. |
| Escape | it closes, the group cools, and the trigger stays closed until the pointer leaves it. |
| Keyboard focus (`:focus-visible`, after a key press) | opens at once. A focus caused by a press never opens one. Focus leaving the trigger closes it. |
| Tap on a device without hover (`(hover: hover)` false) | toggles it; the trigger's own click still runs. A tap elsewhere closes it; a tap inside it does not. |
| Trigger unmounts or its source becomes null | it closes. |

While open, the trigger carries `aria-describedby` (the tooltip's id) and `data-popup-open`, unless it already had them; both are removed on close.

**Popup classes** (Base UI `Tooltip.Root` controlled, `Portal`, `Positioner` with `className='isolate z-50'`, `Popup` with `data-slot=tooltip-content`):

`corner-superellipse/1.125 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex min-h-6 w-fit max-w-72 origin-(--transform-origin) items-center gap-1 rounded-control border border-border bg-popover px-2 py-1 text-2xs text-fg-4 leading-[1.35] has-data-[slot=kbd]:py-0.5 has-data-[slot=kbd]:pr-0.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:h-4 **:data-[slot=kbd]:rounded-sm **:data-[slot=kbd]:bg-bg-a2 **:data-[slot=kbd]:text-fg-3`, then the option's `className`. When `instant`, inline `animation: none` and `data-instant`.

**Geometry:**

| Measure | Value |
| --- | --- |
| Surface | `bg-popover` with a 1px `border-border` edge, 7px corners, no arrow (the 4px offset alone reads as attached) |
| Text | 12px, 400, `fg-4`, line-height 1.35 |
| Padding | 8px left and right, 4px top and bottom → at least 24px tall |
| Width | fits its content, at most 288px (wraps beyond) |
| Children | inline-flex, centred, 4px apart |
| With a keycap | padding drops to 2px top, bottom and right; the `Kbd` is 16px tall, 5px corners, `bg-a2` fill, `fg-3` text (the tooltip stays 24px: 16 + 2 × 2 + its line box) |

**Motion:** opening fades 0 → 1, scales 0.95 → 1 from the transform origin and slides 8px toward its side, over 150ms `ease`; closing fades out and scales to 0.95 over 150ms. An instant open (within 400ms of the last) has no animation at all, so running along a row of hints reads as one tooltip moving.

**The app's `Hint`** wraps `useTooltipTrigger` for icon buttons: `label`, optional `detail` (a muted `TooltipLabel` second line; the popup gets `flex-col items-start gap-px`), optional `shortcut` (a `Kbd` with `ms-1`, so 8px from the label), `side`, `followCursor` (→ `trackCursorAxis: 'y'`).

**Do:** wrap only the text and icon; build content as value + muted qualifier; use `useTooltipTrigger` directly in a composite that already renders its own element.

**Don't:** set a delay; repeat the trigger's text; put a tooltip on a menu trigger or a close X; wrap a block element that stretches across a row; stack a tooltip on a preview-card or popover trigger.

```tsx
// Root, once
<TooltipProvider>
  <App />
</TooltipProvider>

// An icon-only button: the tooltip names it (the glyph alone doesn't) and adds its shortcut
<Tooltip>
  <TooltipTrigger
    render={<Button variant='secondary' size='icon-sm' icon='IconMagnifyingGlass' aria-label='Search in files' />}
  />
  <TooltipContent>
    Search in files
    <Kbd className='ms-1'>⇧⌘F</Kbd>
  </TooltipContent>
</Tooltip>

// A labelled button: the tooltip says what pressing it leads to
<Tooltip>
  <TooltipTrigger render={<Button />}>Approve changes</TooltipTrigger>
  <TooltipContent>Opens the pull request</TooltipContent>
</Tooltip>

// A composite registering its own element, with content built only on open
function ExactTime({ at, children }: { at: Date; children: React.ReactElement<Record<string, unknown>> }) {
  return useTooltipTrigger(children, () => ({
    content: (
      <span className='whitespace-nowrap'>
        {formatDay(at)} <TooltipLabel>{formatClock(at)}</TooltipLabel>
      </span>
    ),
  }));
}
```

#### Truncate

**For:** any single line (or 2 to 3 lines) of text from data that can meet a narrow container: task titles in every row, previews, repository names and paths, branch and file paths, check names, tool targets, attachment names. It ends in an ellipsis and, only while the text really is cut off, shows the full text in a tooltip after the one tooltip delay. A drop-in for `<span className='truncate'>`.

**Not for:** text that is already a tooltip, popover or preview-card trigger (two overlays would stack: keep a plain `truncate`); rows inside a chart tooltip that follows the pointer.

**Wraps:** nothing; it registers itself through `useTooltipTrigger`.

**Props:**

| Prop | Default | Notes |
| --- | --- | --- |
| `middle` | `false` | Cut in the centre (`task_9RmZ…pN7s`) so both ends of an id stay readable. Only for plain string children; other children fall back to an end cut. |
| `lines` | | `2` or `3`: clamp to that many lines (`line-clamp-N whitespace-normal`) instead of one. |
| `className`, `span` props | | |

**Classes:** `block min-w-0` plus `truncate` (one line), `line-clamp-2 whitespace-normal` / `line-clamp-3 whitespace-normal` (lines), or `overflow-hidden whitespace-nowrap` (middle). `data-slot="truncate"`.

**Tooltip it offers when clipped:** `className: 'max-w-72 whitespace-normal text-pretty [overflow-wrap:anywhere]'` (wraps at 288px, breaking unbroken ids anywhere), content the full text.

**Measuring:**

- End cut and lines: clipped when `scrollWidth > clientWidth` (one line) or `scrollHeight > clientHeight + 1` (lines, ignoring sub-pixel rounding). Re-checked by a `ResizeObserver` on the span and a `MutationObserver` on its text, so new text that overflows without a size change is noticed.
- Middle cut: measured in a layout effect while the full string is rendered (then `scrollWidth` is the natural width and `clientWidth` the room). Candidates are measured on a shared canvas in the element's computed `font`, scaled by `natural / canvasWidth` so canvas and DOM agree, and the longest cut that fits is found by binary search (`resolveMiddleTruncation`). A cut belongs to the text it was measured for: new text renders in full and is measured again, and so does a change in the parent's width (a `ResizeObserver` on the parent; a resize to the same width is ignored). A hidden parent (zero width) is measured again once it gets a width.

**Composition:** the parent must bound the width (`min-w-0` on a flex child, or a fixed width). Several ids sharing one line each take `min-w-0 flex-1 basis-0`. A heading keeps its element and wraps the text (`<h2 className='min-w-0'><Truncate>…</Truncate></h2>`). Inside a stretched link (a title whose `::after` covers its row), lift the text above the overlay with `className='relative z-1'` so the tooltip sees the pointer.

```tsx
<div className='flex w-56 flex-col rounded-xl bg-bg-2 px-3 py-2'>
  <Truncate className='font-medium text-fg-4 text-sm'>{task.title}</Truncate>
  <Truncate middle className='text-fg-2 text-xs'>
    {task.worktreePath}
  </Truncate>
</div>
```

### 10.2 Kit hooks and helpers

##### `cn(...inputs)`

`clsx` joined, then `tailwind-merge` extended with the theme's own tokens, so a caller's override replaces the primitive's class instead of both staying and the stylesheet order deciding:

| Group | Extra values merged |
| --- | --- |
| radius (`rounded-*`) | `control`, `control-sm`, `item`, `popup`, `segment` |
| shadow (`shadow-*`) | `1`, `2`, `3`, `4`, `control`, `control-destructive`, `control-elevated`, `control-elevated-hover`, `control-knob`, `control-dot` |
| leading (`leading-*`) | `tighter` |

So `cn('rounded-control', 'rounded-popup')` is `rounded-popup`, `cn('shadow-md', 'shadow-control')` is `shadow-control`, a text size and a text colour both survive, and a shadow colour stays apart from a shadow size.

##### `icon-swap`: `iconSwap`, `iconSwapIn`, `iconSwapOut`

The one way an icon changes into another (copy → check, play → pause): a symmetric cross-fade with both icons mounted, stacked absolutely, each toggled between the two states so the transition retargets mid-swap.

| Constant | Classes |
| --- | --- |
| `iconSwap` | `transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]` |
| `iconSwapIn` | `scale-100 opacity-100 blur-none` |
| `iconSwapOut` | `scale-[0.65] opacity-0 blur-[2px]` |

The outgoing icon scales to 0.65 and fades out behind a 2px blur while the incoming one scales in from 0.65, both over 200ms.

```tsx
<Button variant='secondary' size='icon-xs' aria-label={copied ? 'Copied' : 'Copy'} onClick={copy}>
  <Icon name='IconClipboard2' className={cn(iconSwap, copied ? iconSwapOut : iconSwapIn)} />
  <Icon
    name='IconCheckmark1'
    className={cn('absolute inset-0 m-auto text-primary-text', iconSwap, copied ? iconSwapIn : iconSwapOut)}
  />
</Button>
```

##### `pointer-intent`: `appendSample`, `isHeadingInto`, `SAMPLE_WINDOW_MS`, `MIN_TRAVEL_PX`

- `SAMPLE_WINDOW_MS = 80`, `MIN_TRAVEL_PX = 3`.
- `appendSample(samples, sample)` returns the samples no older than 80ms before `sample.t`, plus `sample`.
- `isHeadingInto(samples, box)` is true when the latest point is inside `box`, or when the ray from the latest point along the direction from the oldest to the latest sample enters the box ahead of the pointer (a slab test per axis). Under 3px of travel there is no direction yet, so it is false. Used by `PreviewCard` to hold a card while the pointer crosses other triggers on the way to it.

##### `scroll`: overlay thumb and edge fades

| Export | Value or behaviour |
| --- | --- |
| `THUMB_EDGE` | `4` px inset of the thumb's travel at both ends |
| `THUMB_MIN_SIZE` | `24` px minimum thumb length |
| `resolveOverflowEdges(position, viewport, content)` | `{ start: position > 0, end: Math.ceil(position + viewport) < content }`; the `ceil` absorbs fractional positions on zoomed pages, so a scroller resting at its end keeps no end fade. |
| `resolveFadeTimelines(id)` | `{ '--fade-timeline-y': '--fade-y<name>', '--fade-timeline-x': '--fade-x<name>' }`, `name` = `id` with every character other than `[A-Za-z0-9_-]` removed. |
| `resolveThumb({ scrollTop, scrollHeight, clientHeight })` | `null` when `scrollHeight − clientHeight ≤ 1`. Else `room = clientHeight − 8`, `size = max(24, clientHeight / scrollHeight × room)`, `travel = max(0, room − size)`, `offset = clamp(scrollTop / scrollable, 0, 1) × travel` (an overscroll keeps the thumb on the track). |
| `resolveDragScrollTop(metrics, startTop, delta)` | `startTop + delta × scrollable / max(1, travel)`; unchanged when nothing scrolls. |
| `resolveTrackScrollTop(metrics, pointer)` | centres the thumb on the pointer (`pointer` from the track's top): `offset = clamp(pointer − 4 − size / 2, 0, travel)`, result `offset / travel × scrollable`; `0` when the thumb fills the track; unchanged when nothing scrolls. |

##### `selection`: `SELECTABLE`, `resolveSelectionRegion`, `scopeSelectAll`

The app is chrome by default: `body` is `user-select: none` with the arrow cursor, and real content a person may want to copy (prose, code, output, an error) opts back in with the `selectable` class (`user-select: text; cursor: text`, and back to none while `body[data-dragging]`). Controls, badges and keycaps inside a selectable region stay unselectable.

- `SELECTABLE = 'selectable'`.
- `resolveSelectionRegion(node)` returns the outermost `.selectable` ancestor of `node` (or of its parent element, for a text node), or `null` in chrome.
- `scopeSelectAll(event)` makes ⌘A (Ctrl A; no Alt, no Shift) behave like a native app: in an `input`, `textarea`, `select`, a `contenteditable` that is not `"false"`, an `.xterm` terminal or a `.cm-editor` editor it keeps its own meaning; otherwise it prevents the default and selects the children of the region holding the current selection's anchor, or else the region the key was pressed in; in chrome it selects nothing, never the page. An event already `defaultPrevented` and any other key are ignored.

##### `truncate`: `ELLIPSIS`, `resolveMiddleTruncation`, `isClipped`

- `ELLIPSIS = '…'` (one character, U+2026).
- `resolveMiddleTruncation(text, available, measure)`: binary search over how many characters to keep (0 to `length − 1`, so it always cuts); for `kept` characters the head gets `ceil(kept / 2)` and the tail the rest (the extra one goes to the head); returns the longest `head + '…' + tail` whose `measure` fits `available`, else the bare `'…'`.
- `isClipped(box, axis)`: `'inline'` → `scrollWidth > clientWidth`; `'block'` → `scrollHeight > clientHeight + 1`.

##### `useAnimatedIndicator(rootRef, options)` and `INDICATOR_TRANSITION`

The sliding highlight behind menus, selects, the command list, the rail, list rows and the segmented tabs. Pure imperative DOM: no React re-render on hover or selection.

- `INDICATOR_TRANSITION = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out'`.
- Options: `attribute` (default `'data-highlighted'`), `value` (match `[attribute="value"]` instead of presence), `press` (default `true`), `parkWhenEmpty` (default `false`). Returns the ref for the indicator element, which the caller renders `absolute` inside the `relative` root.
- It finds the marked item (a `MutationObserver` on the root's subtree for that attribute and child changes, a `ResizeObserver` on the root), measures it with `offsetLeft` / `offsetTop` summed up the `offsetParent` chain to the root (not `getBoundingClientRect`, which drifts during a popup's zoom-in), and moves the indicator only through `transform`: `translate(x, y) scale(sx, sy) scale(var(--hl-press-scale, 1))`, where the scale maps the box it was last laid out at onto the target.
- When a slide ends on an item of another size (`transitionend` on `transform`), it lays the indicator out once at the new `width` / `height` with the transition off and the scale back to 1, so its corners never rest stretched. An indicator with no size yet is laid out at once.
- The item marked when it mounts shows at once: no fade, no slide. After it parks, the next marked item fades in (opacity over 120ms) without travelling.
- The current item gets `data-indicator-here` (rows colour their own text from it); the indicator copies the item's `data-variant` (a destructive row can tint it).
- With nothing marked it stays on the last item until that item leaves the DOM; with `parkWhenEmpty` it parks at once (opacity 0, size 0).
- Press: on `pointerdown` on a marked item the indicator deflates by the press inset in the frame of the press, `scaleX = 1 − 2 × insetX / width`, `scaleY = 1 − 2 × insetY / height`, with `insetX` / `insetY` read from `--press-inset-x` / `--press-inset-y` on the root (1px and 0.5px, the same inset every control presses by). The scale lands and lifts with the transition held off; the release listens for `pointerup` / `pointercancel` on the document.

```tsx
const rootRef = React.useRef<HTMLDivElement>(null);
const indicatorRef = useAnimatedIndicator(rootRef, { attribute: 'data-active' });
return (
  <div ref={rootRef} className='relative isolate'>
    <div
      ref={indicatorRef}
      aria-hidden
      data-motion='move'
      className='pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0'
      style={{ transition: INDICATOR_TRANSITION, willChange: 'transform, opacity', contain: 'layout paint', transformOrigin: 'center' }}
    />
    {children}
  </div>
);
```

##### `useControllableOpen({ open, defaultOpen = false, onOpenChange })`

Returns `[open, change(next, details)]`. Controlled when `open !== undefined` (the caller owns it and only hears through `onOpenChange`); uncontrolled otherwise, starting from `defaultOpen`. Every change calls `onOpenChange` when given. Used by `Select` and `DropdownMenu`.

##### `useDialogState<Value>()`, `useHeldValue(value, open)`, `DialogControl`

A dialog that closes without a visible change of content:

- `useDialogState()` returns `{ value, open, show(value), close(), control }`. `show` opens on a value; `close` flips only `open`, so `value` (and everything the dialog renders from it) stays put during the exit animation; `control.onOpenChangeComplete(false)` clears it to `null` once Base UI reports the exit ended (unless it was reopened meanwhile). Mount the dialog while `value` is set and spread `control` (`open`, `onOpenChange`, `onOpenChangeComplete`) on its root: it stays mounted through the exit and remounts fresh next time.
- `useHeldValue(value, open)` returns `value` while open and the last open value while closed, so content from outside the dialog (a store, a server push) cannot change under the exit animation.

```tsx
const rename = useDialogState<Task>();
// …
<Button onClick={() => rename.show(task)}>Rename…</Button>
{rename.value && (
  <Dialog {...rename.control}>
    <DialogContent>…{rename.value.title}…</DialogContent>
  </Dialog>
)}
```

##### `useMediaQuery(query, fallback = false)`

`useSyncExternalStore` over `window.matchMedia(query)`, following its `change` event and unsubscribing on unmount. `fallback` is the answer on the server (no window): pick the value that renders the safer layout. The tooltip reads `(hover: hover)` through `window.matchMedia` directly (not this hook) to decide between hover and tap.

##### `useSelectAllScope()`

Mount once at the app root: adds `scopeSelectAll` as a window `keydown` listener and removes it on unmount, so ⌘A selects a content region, never the page.

### 10.3 Shinsa composites

The kit gives primitives (Button, Card, Tabs, Select, PreviewCard, Tooltip, Checklist and so on). Shinsa's screens are
not built from those directly: they are built from a second layer of shared composites that fix the class strings,
spacing and behaviour once. Each composite below has one owner and is the only way to draw that thing; a hand-built
copy is a bug, even if it looks identical today. Before writing UI, check this list first, then the kit.

Rules that hold for every composite:

- **Use the composite, not a look-alike.** A page title is `PageHeading`, a section header `SectionLabel`, a card
  `CARD`, a nested box `INSET`, every `•••` an `OptionsTrigger`, every remove confirmation a `ConfirmDialog`, every
  time a `TimeAgo` or `Duration`, every tooltip a `Hint` (or `TimeAgo`, `Truncate`, `useTooltipTrigger`), every
  checkmark `CheckMark` / `CHECK_TEXT`, every list of things to do `ItemChecklist` / `ChecklistBlock`, every
  collapsible header `DisclosureHeader`, every render error region an `ErrorBoundary`.
- **A composite that reads live state has a presentational part** that takes props and callbacks (`HealthCard`,
  `EngineCard`, `UpdateButtonView`), so the specimen page can render it from sample data without a connection.
- **Class constants are exported** where other files must line up with a composite (`LIST_ROW`, `NAV_ITEM`, `CARD`,
  `SETTING_ROW`, `COMPACT_POPOVER`, `PAGE_COLUMN`, `CHECK_TEXT`, `SMART_LINK`). Reuse the constant; never retype its
  classes.
- **Title over description is `gap-px`** inside every composite that stacks them (page heading, list row, popover
  header, note head, now card eyebrow). A title beside its description or count on one line is `gap-1.5` (6px).
- **Every `hover:` has the same `active:` on the same line** (`group-hover/x:` pairs with `group-active/x:`, unless it
  only reveals from `opacity-0`). The composites below already follow it; keep it when you extend them.
- **No colour transitions** on hover, press or highlight. The only transitions in composites are `rotate` on
  chevrons, the image viewer's transform, the selection wash's `background-color`/`outline-color` (500ms), the
  kit's own indicators and the kit's icon swap (`opacity`, `scale`, `filter`).

#### Tones (`Tone` and its class maps)

Seven tones carry every status colour in the composites. A composite takes a `tone` and looks its classes up in
these maps; it never writes a hue by hand.

| Tone | `TONE_SURFACE` (tile fill + ink) | `TONE_SURFACE_HOVER` | `TONE_WASH` (inset fill) | `TONE_EDGE` (inset border) | `TONE_TEXT` (ink) | `TONE_FILL` (solid dot/bar) |
| --- | --- | --- | --- | --- | --- | --- |
| `neutral` | `bg-bg-a2 text-fg-3` | `hover:bg-bg-a3 active:bg-bg-a3` | `bg-bg-a1` | `border-border` | `text-fg-2` | `bg-fg-2` |
| `blue` | `bg-primary-a2 text-primary-text` | `hover:bg-primary-a3 active:bg-primary-a3` | `bg-primary-a2` | `border-primary-a3` | `text-primary-text` | `bg-primary-4` |
| `amber` | `bg-amber-a2 text-amber-text` | `hover:bg-amber-a3 active:bg-amber-a3` | `bg-amber-a2` | `border-amber-a3` | `text-amber-text` | `bg-amber-4` |
| `orange` | `bg-orange-a2 text-orange-text` | `hover:bg-orange-a3 active:bg-orange-a3` | `bg-orange-a2` | `border-orange-a3` | `text-orange-text` | `bg-orange-4` |
| `green` | `bg-green-a2 text-green-text` | `hover:bg-green-a3 active:bg-green-a3` | `bg-green-a2` | `border-green-a3` | `text-green-text` | `bg-green-4` |
| `red` | `bg-red-a2 text-red-text` | `hover:bg-red-a3 active:bg-red-a3` | `bg-red-a2` | `border-red-a3` | `text-red-text` | `bg-red-4` |
| `purple` | `bg-purple-a2 text-purple-text` | `hover:bg-purple-a3 active:bg-purple-a3` | `bg-purple-a2` | `border-purple-a3` | `text-purple-text` | `bg-purple-4` |

Blue is the accent (`primary`), not a separate hue. What each task status maps to: Needs your answer blue, Paused
orange, Changes to review amber, Plan to approve purple (and Change to approve), Ready to merge green, every working
stage blue, Waiting on another task neutral, Setup incomplete and Sign in needed orange, Waiting to check in again,
Waiting for the usage limit and Waiting for delegations blue. Status tones come only from the task status resolver
and these maps.

#### Page column and frame constants

| Constant | Classes | Meaning |
| --- | --- | --- |
| `PAGE_COLUMN` | `mx-auto w-full max-w-3xl px-6` | The page column: 768px wide at most, 24px side padding, centred. Home, Settings, the task page and the banners all sit on this axis. |
| `PAGE_TOP` | `pt-6` | 24px from the top of the scroller to the page heading. |
| `CARDS_FRAME` | `mx-auto w-full max-w-[90rem] px-3 sm:px-5` | The Desk top bar's inner frame: 1440px at most, 12px sides, 20px from 640px up. |

```tsx
<PageScroll>
  <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col gap-6 pb-12')}>
    <PageHeading title='All tasks' description='19 open · 2 done' />
    {/* sections, 24px apart */}
  </div>
</PageScroll>
```

Section to section is 24px (`gap-6`) on every page.

#### PageHeading

The one page title, for Task, All tasks, Settings, setup steps, the finished page. Home's greeting reuses its
`PAGE_TITLE` string. Use it instead of a raw `h1`.

- Anatomy: a `div` `flex min-w-0 flex-col gap-px` holding an `h1` and an optional description.
- `PAGE_TITLE` = `text-balance font-medium text-base text-fg-4 leading-tight` (a 20px line).
- `PAGE_DESCRIPTION` = `max-w-2xl text-pretty text-fg-2 text-xs` (672px max).
- Props: `title: ReactNode`, `description?: ReactNode` (a string renders in a `p` with `PAGE_DESCRIPTION`; any other
  node renders as given, so you can pass your own line), `className?`.
- Flush with the column's left edge; no icon, no padding of its own.
- The page heading names what the page shows. On Settings it is the open tab's name ("General", "Agents"), never
  "Settings".

```tsx
<PageHeading title='All tasks' description='19 open · 2 done' />
```

#### PageScroll

A page body that scrolls under a header. A kit `ScrollArea` with its 24px edge fade (on by default) and
`className='min-h-0 flex-1'`. Props: `children`, `viewportRef?` (the scrolling element). Every page whose body
scrolls under a header uses it (Home, Settings, the task Overview), so content fades out as it passes under the top
bar. Never add a gradient overlay of your own.

```tsx
<PageScroll viewportRef={scroller}>
  <div className={cn(PAGE_COLUMN, PAGE_TOP)}>…</div>
</PageScroll>
```

#### Toolbar

The 36px strip on top of an editor-like pane (the Code tab's file toolbar, the Terminal page's toolbar, the `/ui`
sample under a file path).

- Classes: `flex h-9 shrink-0 items-center gap-2 border-border border-b ps-3 pe-2` (36px tall, hairline under it,
  12px in at the start, 8px at the end, 8px between items; a 24px button sits 6px from the top and bottom).
- Props: `children`, `className?`.
- Contents: a `FilePath` or label first, a `<span className='flex-1' />` spacer, then `secondary` `sm` or `icon-sm`
  buttons. Every icon in a toolbar is the same size (14px).

```tsx
<Toolbar>
  <FilePath path='src/chat/mcp-session.ts' />
  <span className='flex-1' />
  <Button variant='secondary' size='sm' icon='IconCode'>Open file</Button>
</Toolbar>
```

#### SectionLabel

The label over a canvas section (Home's sections, every Settings group, Rounds and other in-page groups).

- Base: `flex shrink-0 items-center gap-1.5 font-medium text-2xs text-fg-2 leading-4` plus `h-6` (24px header, a
  16px line).
- `count?: number` renders after the label as `<span className='font-normal text-fg-2 tabular-nums'>`, 6px after it.
- `action?: ReactNode` sits at the right, after a `flex-1` spacer, in `flex shrink-0 items-center gap-0.5`. The
  action's buttons sit 2px apart: this `gap-0.5` is the one 2px gap allowed in the web app, and `SectionLabel` owns
  it, so pass several buttons as a fragment (Refresh beside Add account). The lint rejects `gap-0.5` anywhere else.
- Settings uses it with `className='px-1'` (4px in) and 4px over its card (`gap-1`).
- `disclosure?: Disclosure` makes it fold: it becomes a `DisclosureHeader as='h2'` with
  `h-6 gap-1.5 hover:text-fg-4 active:text-fg-4`, and a glyph chevron right after the label and count (never at the
  end, which is the action's). The whole header is the button, so the empty rest of the row folds it too.
- `SectionChevron({ open })` is the bare chevron: `IconChevronDownSmall` `size='sm'` with
  `transition-[rotate] duration-150`, `-rotate-90` when closed.

```tsx
<SectionLabel
  count={3}
  action={
    <>
      <RefreshButton label='Refresh usage' onRefresh={refresh} />
      <Button size='sm' variant='secondary'>Add account</Button>
    </>
  }
>
  Accounts
</SectionLabel>
```

#### Card and surface constants

Every card, nested box, header band and footer is one of these strings. Never write `rounded-xl border border-border
bg-card` by hand (the lint rejects it), never a `rounded-lg` box with a fill and no border, and never a tone fill on
a grey edge.

| Constant | Classes | Use |
| --- | --- | --- |
| `CARD` | `corner-superellipse/1.125 rounded-xl border border-border bg-card` | The only card surface. Pads the same on all four sides; the content decides the padding (`p-3` default, `p-1` for a list card, `p-1.5` for Settings). |
| `INSET` | `corner-superellipse/1.125 rounded-lg border border-border` | The edge of every box nested in a card or in the chat column. Add its fill on top. |
| `TONE_INSET[tone]` | `corner-superellipse/1.125 rounded-lg border` + `TONE_EDGE[tone]` + `TONE_WASH[tone]` | A box filled in a tone: the tone's `-a2` fill on its `-a3` border. Neutral is `bg-bg-a1` on `border-border`. |
| `ICON_SLOT` | `grid size-5 shrink-0 place-items-center` | The 20px box every leading icon sits in. |
| `ICON_SLOT_GAP` | `gap-1.25` | 5px; with the slot's 3px of air around a 14px glyph this puts the label 8px from the glyph. |
| `CARD_INSET` | `px-3` | A card's 12px side inset. |
| `CARD_HEADER` | `flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 font-medium text-fg-4 text-xs` | The one card header band: 36px, `bg-bg-a1`, 12px in, the title `text-xs` medium `fg-4`, 8px after the glyph. |
| `CARD_FOOTER` | `border-border border-t bg-bg-a1 px-3 py-2.5` | The one card footer: hairline above, 12px by 10px. |
| `CHAT_COLUMN` | `[--chat-inset:--spacing(3.25)]` | Sets the chat's 13px inset (a card's 1px border plus its 12px). |
| `CHAT_NESTED` | `[--chat-inset:--spacing(3)]` | 12px inset inside an opened delegation card. |
| `CHAT_INSET` | `ps-(--chat-inset)` | Chat lines, errors and the round divider. |
| `CHAT_PROSE_INSET` | `px-(--chat-inset)` | The agent's text. |
| `COMPOSER_FIELD` | `field-sizing-content w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-fg-4 text-xs outline-none placeholder:text-fg-2` | Every composer's text area: 12px in, 10px from the top, grows with its content. |
| `COMPOSER_FOOTER` | `flex items-center gap-2 p-1.5` | Every composer's control row: 6px around a 24px `sm` control, no divider. |
| `CHIP` | `corner-superellipse/1.125 w-fit rounded-control-sm bg-bg-a2 px-1 py-px text-fg-3` | A small inline chip (a short sha, a mono value). |

Inset fills say what the box holds: `bg-bg-a1` for a note, `bg-bg-2` for code and images, `bg-card` for a message
link, `bg-bg-a1` for Settings' shelf. Not an inset, so no edge: rows in a list, highlights and hover washes, controls
(fields, segmented controls, buttons) and tiles (`StepNumber`, `StatusTile`, an avatar). A tile or badge in a tone has
no border, so it has no edge to tint. Never put a fill on a fill: a control on an inset has no fill at rest
(`secondary` buttons, `ghost` selects).

```tsx
<section className={cn(CARD, 'flex flex-col gap-3 p-3')}>…</section>
<div className={cn(INSET, 'bg-bg-2 px-3 py-2')}>…</div>
<div className={cn(TONE_INSET.orange, 'px-3 py-2.5')}>…</div>
```

#### IconSlot

`<span data-icon-slot className={cn(ICON_SLOT, className)}>` around one icon. Props: `children`, `className?`. Use it
for every icon that leads a row inside a card, a chat line or a header band, so every icon in a column shares one
centre: the header's icon and every row icon under it line up. A 20px tile (`StatusTile` `md`, `StepNumber`) is
already that slot and needs none.

```tsx
<IconSlot><Icon size='sm' name='IconCodeLines' /></IconSlot>
```

#### DisclosureHeader, DisclosureChevron, DisclosureAction

Every collapsible header (Overview and Review panels, change snippets, the live card's row, a delegation's spawn card,
a round's row, Home's sections, the compact queue's sections, the roadmap's groups, Settings' folding blocks). The
whole header is the trigger.

Props of `DisclosureHeader`:

| Prop | Type | Meaning |
| --- | --- | --- |
| `as` | `'div' \| 'h2' \| 'h3' \| 'figcaption'` | The element; default `div`. On a plain header any other tag wraps the button: `<Tag className='flex min-w-0'><button className='… w-full'/></Tag>`; on a header with controls the tag is the header itself. |
| `disclosure` | `{ open, toggle }` from `useDisclosure` | Required. The header never owns its open state. |
| `label` | `string?` | Names the toggle: `aria-label` "Expand ‹label›" / "Collapse ‹label›". |
| `strip` | `'line' \| 'strip' \| 'block' \| 'band'` | The header height, 24 / 28 / 32 / 36px. |
| `chevron` | `'glyph' \| 'box'` | A trailing chevron: the bare 14px glyph, or the kit's `secondary` `icon-xs` (22px) `Button`. |
| `chevronClassName` | `string?` | Extra classes on the trailing chevron. |
| `action` | `ReactNode?` | A control in the header (a link, Stop, a select); wrapped in `DisclosureAction` at `ms-auto shrink-0`. |
| `interactive` | `boolean?` | The header holds its own controls in its children. |
| `className` | `string?` | The header's own classes (height, padding, type). |

Behaviour:

- Base classes: `group/disclosure flex min-w-0 cursor-pointer select-none items-center text-left` plus `outline-none`
  when it is a button.
- **Plain header** (no `action`, not `interactive`): one `<button type='button'>` with `aria-expanded`, carrying
  `data-disclosure-header='<strip>'`. Any chevron inside renders as an `aria-hidden` `<span>` (the box chevron as a
  kit `Button` with `nativeButton={false}`, `render={<span />}`, `tabIndex={-1}`), so no button is ever nested.
- **Header with controls** (`action` or `interactive`): the click is taken on the header element itself; its
  controls sit in `DisclosureAction`, a `<span data-disclosure-action className='flex min-w-0 items-center'>` that
  stops the click from reaching the header; the chevron becomes the one focusable trigger, a real `<button>` with
  `aria-expanded` and the "Expand/Collapse ‹label›" name.
- The chevron is always last, after the header's controls. Without an `action` it takes `ms-auto`.
- **A trailing chevron's end inset equals its vertical inset**, so it wraps the header's corner evenly:
  end padding = (strip height − chevron box) ÷ 2. `strip` and `chevron` set `--strip-height` and `--trailing-size`
  and the header gets `h-(--strip-height) pe-[calc((var(--strip-height)-var(--trailing-size))/2)]`.

| `strip` | Height | With `box` (22px) | With `glyph` (14px) |
| --- | --- | --- | --- |
| `line` | 24px | 1px | 5px |
| `strip` | 28px | 3px | 7px |
| `block` | 32px | 5px | 9px |
| `band` | 36px | 7px | 11px |

Used combinations: card bands `band` + `box` (7px), change snippets `strip` + `box` (3px), Settings folding blocks
`block` + `glyph` (9px), the compact queue's section headers 24px with a glyph after the count (5px from top and
bottom).

- The glyph chevron (`DisclosureChevron kind='glyph'`): `IconChevronDownSmall` in
  `corner-superellipse/1.125 grid size-3.5 shrink-0 place-items-center rounded-control-sm outline-none group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4`,
  the glyph `transition-[rotate] duration-150`, `-rotate-90` when closed. Placed right after the label it belongs to
  (section labels, the compact queue), it has no trailing inset.
- The box chevron (`kind='box'`): the kit `Button` `variant='secondary'` `size='icon-xs'`, `size-(--trailing-size)`,
  `data-disclosure-chevron`. Its wash shows only while the pointer is on the chevron itself (hovering the rest of
  the header leaves it bare), pressing it deflates its fill like every kit button, and colours change in the frame,
  with no transition.
- No fold or chevron animates on load: the open state is right on the first render.

Do: build every collapsible header with this. Don't: write `aria-expanded` by hand outside it (the listed row
disclosures excepted: chat lines, tree items, Show more), end a header in a chevron without a `strip`, put a hover
or press colour on the whole header for the box chevron, or nest a button in a button.

```tsx
const disclosure = useDisclosure(createDisclosureId('task', task.id, 'overview', 'panel', 'changes'), true);
<DisclosureHeader
  as='h2'
  disclosure={disclosure}
  label='what changed'
  strip='band'
  chevron='box'
  action={<Button variant='link' size='sm'>Read the review</Button>}
  className={CARD_HEADER}
>
  <IconSlot><Icon size='sm' name='IconCodeLines' /></IconSlot>
  What changed
</DisclosureHeader>
```

#### Persisted open state (`useDisclosure`)

Every collapsible remembers whether it is open. Its state is `useDisclosure(persistId, defaultOpen)`, never
`useState`. Ids come from what the thing shows, never an index: `createDisclosureId(scope, …parts)` joins a scope
(`task`, `home`, `queue`, `services`, `roadmap`, `settings`, `ui`) and parts with `:`, for example
`task:<taskId>:overview:panel:<panel>`, `home:section:<section>`, `queue:section:<section>`,
`services:project:<id>`, `settings:mcp:server:<id>`. A fold that should be forgotten passes `notPersisted('why')`.
Every collapsible composite (`Panel`, `CompactSection`, `FoldingBlock`, `ExpandRow`, and the feature ones) takes a
required `persistId`.

#### Panel

A collapsible card with a header band: the Overview's panels (What changed, Activity, Delegations, Rounds), the
Review tab's panels.

- Root: `<section className={cn(CARD, 'flex flex-col overflow-hidden')}>`.
- Header: `DisclosureHeader as='h2' strip='band' chevron='box'` with `className={CARD_HEADER}` and
  `label={title.toLowerCase()}`. Inside: `IconSlot` with `<Icon size='sm' name={icon} />`, the title, then
  `count` as `<span className='shrink-0 font-normal text-fg-2 tabular-nums'>` right after the title (never pushed to
  the middle), then `meta` as `<span className='ms-auto shrink-0 ps-3'>`, then the action, then the 22px box chevron
  7px from the end.
- Body (when open): `flex flex-col gap-3 border-border border-t p-3`.
- Props: `persistId` (required), `title: string`, `icon: IconName`, `count?: number`, `meta?: ReactNode` (a passive
  figure; a click on it folds the panel like the rest of the header), `action?: ReactNode` (a control; it stays in
  the header whether the panel is open or closed), `defaultOpen = true`, `children`.

```tsx
<Panel
  persistId={createDisclosureId('task', task.id, 'overview', 'panel', 'changes')}
  title='What changed'
  icon='IconCodeLines'
  action={<Button variant='link' size='sm'>Read the review</Button>}
>
  …
</Panel>
```

#### StepNumber

Numbered steps (the plan, What changed, the chat's plan card, Try it yourself).
`<span className='corner-superellipse/1.125 grid size-5 shrink-0 place-items-center rounded-control-sm bg-bg-a2 font-medium text-2xs text-fg-3 tabular-nums'>{index + 1}</span>`.
A 20px tile, no border. Prop: `index` (zero-based; it prints `index + 1`). Pair it with its content `gap-2.5`
(10px).

```tsx
<div className='flex gap-2.5'>
  <StepNumber index={0} />
  <div className='flex min-w-0 flex-1 flex-col gap-2'>
    <span className='font-medium text-fg-4 text-xs'>Open an MCP session per chat</span>
  </div>
</div>
```

#### NowFrame, Eyebrow, FooterNote, QuietLink

The frame every "now" card on the Overview shares (a wait, a question, a sign-in, a setup step, a usage wait, a
secret, an operation). Every new waiting state is one of these, not a new card.

- `NowFrame` root: `<section className={cn(CARD, 'flex flex-col overflow-hidden')}>`; body `flex flex-col gap-3 p-3`;
  top row `flex items-start gap-3`: a column `flex min-w-0 flex-1 flex-col gap-px` with the eyebrow
  (`text-2xs text-fg-2`) over the title (`InlineMarkdown`, `font-medium text-fg-4 text-sm leading-tighter`), and the
  `action` at the right in `flex shrink-0 items-center gap-1.5`. `children` follow; `footer` renders in
  `CARD_FOOTER`.
- Props: `eyebrow: ReactNode`, `title: string` (inline markdown), `action?`, `children?`, `footer?`.
- `Eyebrow({ state, task, extra })`: `flex flex-wrap items-center gap-x-1.5`: the status in its tone
  (`StatusText`, `whitespace-nowrap text-2xs`), then ` · ` and the round count (`tabular-nums`), then ` · ` and
  `extra`, each part `whitespace-nowrap`.
- `FooterNote({ note, children })`: `flex items-center gap-3 text-2xs text-fg-2`, the note (a plain string, so it
  never carries a formatted time), a spacer, then the footer's controls.
- `QuietLink({ busy, onClick })`: a text-only action in a footer:
  `cursor-pointer whitespace-nowrap hover:text-fg-4 active:text-fg-4 disabled:pointer-events-none disabled:opacity-50`.

```tsx
<NowFrame
  eyebrow={<Eyebrow state={state} task={task} />}
  title='Approve the plan to start building'
  action={<Button size='sm'>Approve plan</Button>}
  footer={<FooterNote note='Building starts once you approve'><QuietLink onClick={revise}>Ask for changes</QuietLink></FooterNote>}
/>
```

#### Chat line family: ChatLine, FoldLine, ExpandRow, DetailRail, CardLine

Every one-line row in the chat (the role header, every notice, the worked-for row, the brief, tool rows, delegation
report rows, the round divider) is the same line, so they share height, text size, ink step, icon box and the 8px
gap.

- Line: `flex h-5 min-w-0 max-w-full items-center gap-px self-start text-left text-xs` (20px, 13px text). It is
  `self-start` and fitted, so a tooltip or hover never covers the empty rest of the row.
- Icon: an `IconSlot` with `me-1` (the slot's 3px plus `me-1` plus `gap-px` put the label 8px from the glyph),
  holding a `size='sm'` (14px) icon in the label's ink.
- Ink (`LINE_INK`): `text-fg-3 group-hover/row:text-fg-4 group-active/row:text-fg-4`.
- Label: `min-w-0 truncate font-medium` plus the ink.
- Meta: `flex min-w-0 shrink whitespace-pre text-fg-2`, after " · " (a string meta truncates first, ending in an
  ellipsis; an element meta keeps its own truncation).
- Trailing: `ms-1.5 flex shrink-0 items-center`.
- `ChatLine` is the static row (`div data-chat-line`). Props: `icon` (name or element), `iconClassName?`, `label`,
  `meta?`, `trailing?`, `className?`.
- `FoldLine` is a fold (a group of tool calls, the worked-for row): a `button` with `aria-expanded`, the chevron in
  the icon slot (`IconChevronRightSmall` `size='sm'`, `text-fg-3 transition-[rotate] duration-200` with the hover
  and press step, `rotate-90` when open), `disabled:cursor-default`.
- `ExpandRow` is a row that opens: the row's own icon in the slot and a trailing chevron that shows only on hover
  (`opacity-0 group-hover/row:opacity-100` while closed, always shown while open). Its detail hangs off
  `DetailRail`. Images under a closed row show as a strip indented `ps-6.25` (`ROW_INDENT`, 25px). Requires
  `persistId`.
- `DetailRail`: `flex min-w-0 gap-1.25 pt-3 pb-1`, a 20px column (`flex w-5 shrink-0 justify-center`) with a 1px
  `bg-border` rail centred under the icon slot, and the detail in `flex min-w-0 flex-1 flex-col gap-2.5` starting on
  the label's line.
- `CardLine` (`CARD_LINE` = `flex h-9 min-w-0 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 text-xs`): the 36px
  header band of a chat card (hand-over cards, the spawn card, the live card's row), an `h3`; a 14px `text-fg-4`
  icon in an `IconSlot`, the title `min-w-0 truncate font-medium text-fg-4`, the meta `ms-auto shrink-0 ps-3
  text-fg-2`. The same band as `CARD_HEADER`.
- `SHIMMER_LINE` = `block truncate leading-normal`: a shimmering line's truncating box keeps `leading-normal`,
  since the kit's `leading-none` clips descenders.
- `SELECTED_WASH` = `outline-2 outline-transparent transition-[background-color,outline-color] duration-500 data-focused:bg-primary-a1 data-focused:outline-primary-a1`:
  the fading mark on a place you jump to.

```tsx
<ChatLine icon='IconConsole' label='Ran bun test' meta='42 passed' />
<ExpandRow persistId={createDisclosureId('task', task.id, 'chat', 'tool', call.key)} icon='IconFileText' label='Read' meta='app.tsx'>
  <CodeFence code={output} language='ts' />
</ExpandRow>
```

#### ListRow

A pressable row with an optional leading tile, a title, an optional meta line and an optional trailing value: Home's
sections, the queue, the Services popover, setup's pick lists, the found-services list. Use it, or its `LIST_ROW*`
classes, for any list of things you open.

| Constant | Classes |
| --- | --- |
| `LIST_ROW` | `corner-superellipse/1.125 flex w-full cursor-pointer gap-2 rounded-control text-left outline-none` |
| `LIST_ROW_LINES` | `items-start pt-1.5 pb-1` (title over meta) |
| `LIST_ROW_LINE` | `h-7 items-center` (a title alone, 28px) |
| `LIST_ROW_TITLE` | `text-fg-4 text-xs` |
| `LIST_ROW_META` | `text-2xs text-fg-2` |

- Anatomy: `button` with `LIST_ROW`, `LIST_ROW_LINES` when there is a meta else `LIST_ROW_LINE`, and `px-1.5` with a
  leading tile (the tile's centre on the 6px axis every sidebar icon shares) or `px-2.5` without one. Leading (a
  `StatusTile`, 20px), then `flex min-w-0 flex-1 flex-col gap-px` with the title and meta each in a kit `Truncate`
  (full text in a tooltip only when clipped), then trailing in
  `shrink-0 text-2xs text-fg-2 tabular-nums leading-5` (typically `<TimeAgo compact />`).
- Props: `leading?`, `title`, `meta?`, `trailing?`, `active = false`, `revealWhenActive = false` (scrolls the active
  row into view, `block: 'nearest'`), `onClick` (required).
- State: `aria-current` and `data-active` when active; `data-highlight-item=''` so the surrounding kit
  `HoverHighlight` (`relative isolate`, an indicator `absolute rounded-control bg-bg-a2` that slides between rows)
  draws the hover wash. The row has no background of its own.
- A list card is `CARD` with `p-1` around a `HoverHighlight className='flex flex-col gap-px'` of rows, rows 1px
  apart; its empty line is `p-2.5`. So the tile, the time at the right and the last line's text sit 10px from the
  card on all four sides (the row keeps 2px less under its text because a line already carries about 3px below its
  baseline).
- Don't: give a row its own hover background, a border, or put a `Hint` around the whole row.

```tsx
<div className={cn(CARD, 'w-80 p-1')}>
  <HoverHighlight className='flex flex-col gap-px'>
    <ListRow
      leading={<StatusTile icon='IconEyeOpen' tone='amber' label='Changes to review' />}
      title='Run the embedded chat on MCP v2'
      meta='Changes to review · The embedded chat now runs on MCP v2'
      trailing={<TimeAgo at={updatedAt} compact />}
      onClick={() => navigate(path)}
    />
  </HoverHighlight>
</div>
```

#### NavItem

A row of the sidebar rail's navigation and of other vertical nav lists.

- `NAV_ITEM` = `corner-superellipse/1.125 flex h-7 w-full cursor-pointer items-center gap-2 rounded-control ps-1.5 pe-2.5 text-left text-fg-3 text-xs outline-none data-[active=true]:text-fg-4 data-hovered:text-fg-4`
  (28px, 6px in at the start so the icon slot shares the sidebar's icon axis, 10px at the end).
- Anatomy: `<span className='grid size-5 shrink-0 place-items-center'><Icon size='md' name={active ? activeIcon : icon} /></span>`
  then `<span className='flex-1 truncate'>{label}</span>`. The icon is 16px here.
- Props: `label`, `icon`, `activeIcon` (both required, so a new row cannot forget the filled twin), `active`,
  `onClick`.
- State: `aria-current='page'` and `data-active` when active; `data-highlight-item=''` for the parent
  `HoverHighlight className='flex flex-col gap-px'`. Active is `fg-4` with the filled icon; the weight never
  changes.
- The rail's items: New task (`IconPlusMedium` / `IconPlusMediumFilled`, active on Home), Tasks (`IconListBullets` /
  `IconListBulletsFilled`), Services, Settings (`IconSettingsGear4` / `IconSettingsGear4Filled`).

```tsx
<HoverHighlight className='flex flex-col gap-px'>
  <NavItem label='Tasks' icon='IconListBullets' activeIcon='IconListBulletsFilled'
    active={route.name === 'tasks'} onClick={() => navigate('/tasks')} />
</HoverHighlight>
```

#### NavButton

The Desk top bar's place buttons: Home (in the Mac app), Tasks and the icon-only Settings.

- A kit `Button` `variant='secondary'`, `size='sm'` (24px) with a label, or `size='icon-sm'` (24px square) with
  `iconOnly`. Icon: `activeIcon` on its own page, else `icon`. Ink: `text-fg-4` on its own page, else `text-fg-3`.
- `aria-current='page'` on its page; `aria-label={label}` when icon-only.
- Props: `page: 'home' | 'tasks' | 'settings'` (paths `/`, `/tasks`, `/settings`), `label`, `icon`, `activeIcon`,
  `iconOnly = false`, `shortcut?`, `className?`, `onNavigate?`.
- Tooltip: only when icon-only (the label) or with a `shortcut` (label plus the `Kbd`), through `Hint`. A labelled
  button without a shortcut has none, since it would repeat its label.
- The bar's icons draw at one size. The Agent usage gauge sets it: its ink is 20 of the 24 units tall (11.67px at
  14px). The kit's icon set scales each place icon about its centre, stroke kept, to match: `IconSettingsGear4` 1.1132
  (as tall as the gauge), `IconServer` 1.15 (as large as the box allows), `IconHomeRoundDoor` 1.025 and
  `IconListBullets` 1.15 (both set by eye under the gauge's height). A filled twin takes its outline's scale.

```tsx
<NavButton page='tasks' label='Tasks' icon='IconListBullets' activeIcon='IconListBulletsFilled' />
<NavButton page='settings' label='Settings' icon='IconSettingsGear4' activeIcon='IconSettingsGear4Filled' iconOnly className='me-0.5' />
```

#### BrandLink and HomeLink

- `BrandLink`: the logo and wordmark that goes home in a browser.
  `flex cursor-pointer items-center gap-1.5 font-medium text-fg-4 text-sm outline-none`; the `Logo` at `size-3.25`
  (13px) inside `grid size-5 shrink-0 place-items-center`, then "Shinsa".
- `HomeLink`: in the Mac app (or under `DesktopChrome`) it is a `NavButton page='home' label='Home'
  icon='IconHomeRoundDoor' activeIcon='IconHomeRoundDoorFilled'` with the Home shortcut (⇧⌘H) in its tooltip; in a
  browser it is the `BrandLink`. A Mac app's toolbar carries its controls, not its name. Props: `onNavigate?`,
  `brandClassName?` (the Desk bar passes `me-2`).

#### AppFrame and the two shells

One frame, `AppFrame({ layout, state, children })`, around one `main`. Switching layout adds or drops the top bar or
the rail and never remounts the pages.

- Root: `flex h-dvh overflow-hidden bg-background text-fg-3`, plus `flex-col` in Desk (Cards).
- `main`: `flex flex-1 flex-col`, plus `min-w-0` (Shelf) or `min-h-0` (Desk).

**Desk top bar (`CardsTopBar`).** `<header data-window-drag className='shrink-0 select-none desktop:ps-16'>`
(64px start padding in the Mac window, for the traffic lights), inner `CARDS_FRAME` + `flex h-11 items-center gap-1`
(44px, 4px between items). Order: `HomeLink` (`me-2`); Tasks `NavButton`; Services menu; on a task page the queue
button ("3 need you"); the connection status; a `flex-1` spacer; the Update button; Settings (`NavButton iconOnly`,
`me-0.5`); the usage menu; the Focus menu (hidden below 640px, `max-sm:hidden`). On `/onboarding` only the home link,
the connection status and Update show. Every widget that reads live state sits in `ErrorBoundary size='icon'`.

**Shelf rail (`Rail`).** `<nav className='flex h-full w-full select-none flex-col bg-sidebar'>`:

1. Top row `data-window-drag` `flex h-11 shrink-0 items-center gap-2 desktop:ps-20 ps-3.5 pe-2`: `HomeLink`, connection
   status, spacer, Update, usage menu (not on `/onboarding`), the ⌘K button.
2. Nav `flex flex-col px-2 pb-2` with `HoverHighlight className='flex flex-col gap-px'`: the `NavItem`s New task and
   Tasks, the Services menu in its `variant='rail'` (not on `/onboarding`, in an inline `ErrorBoundary`), and the
   `NavItem` Settings.
3. `flex flex-col border-border border-t px-2 py-2`: the Focus menu (not on `/onboarding`).
4. `flex min-h-0 flex-1 flex-col overflow-y-auto border-border border-t`: the compact queue, in an inline
   `ErrorBoundary` with `p-2`.

From 768px (`md`) up the rail sits beside the page in `<aside className='relative hidden shrink-0 border-border border-r md:flex'>`
with its stored width and a `ResizeHandle`; below that it opens in a kit `Sheet` (`side='left'`,
`showCloseButton={false}`, `className='w-72 gap-0 p-0'`, an `sr-only` title "Queue").

**Compact bar (`CompactBar`, Shelf below 768px).** `<header data-window-drag className='flex h-11 shrink-0 select-none items-center gap-2 border-border border-b px-2 desktop:ps-20 md:hidden'>`:
an `icon-sm` secondary `IconSidebar` button ("Open the queue", with that tooltip), `HomeLink`, spacer, the ⌘K button,
an `icon-sm` secondary `IconPlusMedium` "New task" button with that tooltip.

**`ResizeHandle`.** `absolute inset-y-0 z-10 w-2 cursor-col-resize`, `-right-1` (or `-left-1` for a left edge), a
1px line `after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent` that
turns `bg-primary-4` on hover and press. Its `Hint` follows the pointer down the edge (`followCursor`, on the handle's
side): "Resize the sidebar · Double-click to reset" (the qualifier muted). Props: `label?`, `edge = 'right'`,
`onPointerDown`, `onDoubleClick` (resets the width).

#### CompactSections, CompactSection, COMPACT_POPOVER

A popover list grouped in sections: the queue button's popover, the sidebar's compact queue, the Services popover.
Never build a look-alike.

- `COMPACT_POPOVER` = `max-h-(--available-height) w-80 gap-0 p-0`: 320px wide, as
  tall as its content up to the room under the trigger, then it scrolls. (The Services popover, `SERVICES_PANEL`, is
  `COMPACT_POPOVER` plus `flex w-88 max-w-[calc(100vw-1rem)] flex-col overflow-hidden`: 352px, never wider than the
  window less 16px; a view of it that needs a fixed height takes `h-[min(var(--available-height),28rem)]`, 448px at
  most.)
- `COMPACT_POPOVER_INSET` = `pt-1.5`: the list's top inset 6px more, so the first header's icon sits as far from the
  popover's top as from its side (measured 20px and 20px).
- `CompactSections({ className, children })`: a kit `HoverHighlight` with `flex flex-col`, so one hover wash serves
  every row in every section.
- `CompactSection` root: `<section className='flex flex-col border-border border-t px-2 py-1.5 first-of-type:border-t-0'>`
  (a hairline between sections, none above the first).
- Header: `DisclosureHeader` with
  `w-full gap-2 rounded-control ps-1.5 font-medium text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4 h-6 pe-1`:
  the `leading` icon or dot in an `ICON_SLOT`, the title `min-w-0 truncate`, then
  `flex min-w-0 items-center gap-1.5 font-normal tabular-nums` with the `count` and the glyph chevron right after it,
  revealed on hover (`opacity-0 group-hover/disclosure:opacity-100`), 6px after the count. The chevron belongs to what
  it folds, so it never sits at the header's end; the end is the `action`'s (a play button that starts all). The
  header ends 4px in (`pe-1`), so an action stands in the column of each row's last button.
- Body (open): `flex flex-col pt-0.5`, rows with no gap between them.
- Props: `persistId` (required), `defaultOpen = true`, `label?`, `leading`, `title`, `count`, `action?`, `children`.
- A popover's footer pads the same on every side, and a view's header starts as far from the top as from the side.

```tsx
<PopoverContent align='start' className={COMPACT_POPOVER}>
  <CompactSections className={COMPACT_POPOVER_INSET}>
    <CompactSection
      persistId={createDisclosureId('queue', 'section', 'needs')}
      leading={<Icon size='sm' name='IconInboxEmpty' />}
      title='Needs you'
      count={3}
    >
      {rows}
    </CompactSection>
  </CompactSections>
</PopoverContent>
```

#### Choice

The segmented control: task tabs, Settings tabs, setup's stepper, the layout choice, the image viewer's state switch.
Use it for 2 to about 6 short mutually exclusive options shown at once.

- Built on the kit's `Tabs` + `TabsList aria-label={label}` + `TabsTrigger` (26px tall, the pill slides between
  items).
- Items: `{ value, label, hint?, checked?, disabled? }`. `checked` puts the accent check
  (`IconCheckmark1Small`, `aria-hidden`, `CHECK_TEXT`) before the label (a setup step you answered). `hint` wraps the
  trigger in a `Hint` (a layout's one-line description); a trigger whose label says it all has none.
- Props: `items`, `value`, `onValueChange`, `label` (required, the list's accessible name), `onItemIntent?` (called
  on pointer enter and focus, to prefetch the tab), `className?`.
- The selected item never changes weight: every segmented trigger is `font-medium` at rest and selected alike; only
  its ink steps from `text-fg-2` to `text-fg-4` (hovered, pressed or selected).

```tsx
<Choice
  label='Task view'
  items={[{ value: 'overview', label: 'Overview' }, { value: 'code', label: 'Code' }, { value: 'chat', label: 'Chat' }]}
  value={tab}
  onValueChange={setTab}
  onItemIntent={prefetchTab}
/>
```

#### ChoiceButtons and ChoiceButton

A row of answer buttons: an agent's question with options, setup picks. Use it instead of a `Choice` when one click
answers (and acts), or when several can be picked.

- `ChoiceButtons`: `flex flex-wrap gap-1.5` (6px apart, wraps).
- `ChoiceButton({ option, pressed, disabled, onClick })`: a kit `Button` `size='sm'`, `variant='primary'` while
  `pressed`, else `outline`, with `aria-pressed`. `option` is `{ label, detail? }`; the detail follows the label as
  `<span className='font-normal'>` in `opacity-70` while pressed, else `text-fg-2`.
- An agent's question: none starts pressed; a multi-pick: pressed while picked.

```tsx
<ChoiceButtons>
  {options.map((option) => (
    <ChoiceButton key={option.label} option={option} pressed={picked === option.label} onClick={() => pick(option.label)} />
  ))}
</ChoiceButtons>
```

#### SelectField

Every select built from data: model, merge method, coverage, workspace, "Not used for", a project picker.

- A kit `Select` with `SelectTrigger aria-label={label} size variant className={cn('w-fit', className)}` (26px
  default, `sm` 24px; `variant='ghost'` on a shelf or inline in prose), and
  `SelectContent align={align} alignItemWithTrigger={false}` (default `align='end'`; the list opens under the
  trigger, never over it).
- Items: `{ value, label, icon?, dot?, hint?, disabled?, group? }`.
  - `icon` is a menu icon, shown in the trigger before the label too.
  - `dot` is a project colour: trigger and option render `ProjectOption` (the dot in a 14px box, then the name), so a
    project's label starts where every other option's does.
  - `hint` shows after the label in `font-normal text-fg-2`.
  - `disabled` is a string, the reason; it disables the option and shows in place of the hint. There is no boolean.
  - `group`: consecutive items with the same group sit under a `SelectLabel` (Claude, then Codex).
- The trigger shows the current item (icon and label, or the dot) and falls back to the raw value, truncated.

```tsx
<SelectField
  label='Merge with'
  items={[{ value: 'squash', label: 'Squash' }, { value: 'rebase', label: 'Rebase', disabled: 'The repository blocks rebases' }]}
  value={merge}
  onValueChange={setMerge}
  size='sm'
  variant='ghost'
/>
```

#### CopyButton and useCopyText

- `CopyButton({ text, className })`: a kit `Button` `variant='secondary'` `size='icon-xs'` (22px) whose
  `aria-label` and `Hint` read "Copy", then "Copied" for 1500ms after a successful copy.
- Icons: `IconClipboard2` and, absolutely centred over it (`absolute inset-0 m-auto text-primary-text`),
  `IconCheckmark1`; the kit's `iconSwap` / `iconSwapIn` / `iconSwapOut` classes cross-fade them. The check is the
  accent, never green.
- `useCopyText(text)` returns `{ copied, copy }` for any other trigger that swaps to a Copied state (the error
  fallback's Copy details). Both go through the one copy helper, which writes the clipboard and toasts "Copied", or
  "Couldn’t copy to the clipboard" when the browser refuses. Never call `navigator.clipboard` elsewhere.
- On a shelf or inset it stays `secondary` (no fill at rest).

```tsx
<CopyButton text={task.branch} />
```

#### OptionsTrigger

The one trigger for every `•••` menu (a task, a project, an account, a schedule, an MCP server).
`<DropdownMenuTrigger render={<Button variant='secondary' size='icon-sm' icon='IconDotGrid1x3Horizontal' aria-label={label} />} />`.
Prop: `label` (the accessible name, for example "Task actions"). No tooltip: its menu is one click away and names
every action. Must sit inside a `DropdownMenu`.

```tsx
<DropdownMenu>
  <OptionsTrigger label='Project actions' />
  <DropdownMenuContent align='end'>…</DropdownMenuContent>
</DropdownMenu>
```

#### LazyMenu and LazyMenuTrigger

A dropdown or context menu that mounts its Base UI root only on first intent, so a long list of rows each with a
menu stays cheap. `LazyMenu({ kind: 'dropdown' | 'context', content, children })` and
`LazyMenuTrigger({ render, ...props })`. Until mounted, the trigger is the `render` element with the closed
trigger's attributes (`data-slot`, `aria-haspopup='menu'`, `aria-expanded={false}` for a dropdown) and
`-webkit-touch-callout: none` for a context menu; once mounted it is the real trigger. Use it for per-row menus in
long lists (All tasks rows).

#### ItemChecklist and ChecklistBlock

Anything that is a list of things to do, ticked or only shown (merge steps, post-merge steps, setup lists), is this
one look on the kit's `Checklist`, never a hand-built list of checkboxes.

- Items are `{ key, title, detail?, command?, done }`.
- Each row is the kit's `ChecklistItem done check` (`flex gap-2.5`): the check in a 20px tall slot (`h-5`) level with
  the title's first line, 10px before the content, a `gap-1` column. Rows are `gap-3` (12px) apart.
- Title: `ChecklistTitle` (`text-xs` medium `fg-4`, `fg-3` once done) holding `InlineMarkdown`; `meta(item)` renders
  beside it in `text-2xs fg-2`, wrapping under it when narrow.
- Detail: `ChecklistDetail` (`text-xs fg-3`) holding `Markdown`.
- Command: in `ChecklistActions` (`gap-1.5`), a full-width shell `CodeFence` with `runnable` (Copy and, where a task
  can run it, Run in terminal in its corner). `actions(item)` adds buttons in the same row.
- `onTick(item, done)` makes each check a kit `Checkbox size='sm'` (14px) with `aria-label={item.title}` that waits
  for the returned promise (disabled while pending). Without `onTick` each check is a read-only `ChecklistMark` (the
  box without a control, the accent with a white check once done, named "Done" or "Not done").
- `describeBlock(item)` returns a reason string to disable a box; the reason is its tooltip (`Hint` around a
  `flex w-fit` span).
- `ChecklistBlock({ title, ...props })`: `flex flex-col gap-2` with the kit's `ChecklistHeader` (title `text-xs`
  medium `fg-4` left, progress `text-2xs fg-2 tabular-nums` right: "1 of 2 done", "All done") over the list. Renders
  nothing when there are no items.
- A GFM task list inside `Markdown` renders as the same rows, read-only (see Markdown).

```tsx
<ChecklistBlock
  title='Post-merge'
  items={steps}
  onTick={(item, done) => sendCommand({ type: 'step.tick', key: item.key, done })}
  describeBlock={(item) => (item.key === 'flag' && !migrated ? 'Tick it once the migration ran' : null)}
  meta={(item) => item.kind}
/>
```

#### Hint

The one tooltip wrapper for anything that is not a time or truncated text. It registers its child with the page's
single tooltip (no tooltip root per row).

- Props: `label: ReactNode`, `detail?: string | null` (a muted second line: the tooltip becomes
  `flex-col items-start gap-px` and the detail is a `TooltipLabel`), `shortcut?: string` (a `Kbd` with `ms-1` after
  the label), `side?: 'top' | 'bottom' | 'left' | 'right'`, `followCursor = false` (tracks the pointer on the y axis,
  for a resize edge), `children` (one element).
- Delay: none to set. Every tooltip opens after the kit's `TOOLTIP_DELAY` (600ms), at once within
  `TOOLTIP_SKIP_DELAY` (400ms) of the last one closing (with no entrance), on keyboard focus at once and on a tap
  where there is no hover. A press or Escape closes it and it stays closed until the pointer leaves.
- What it wraps is the text and its icon only: inline, or `w-fit` (`max-w-full` to keep truncating), never a block
  across a full-width row.
- When to use: an icon-only button whose glyph doesn't say it (the label repeats the `aria-label`), a key hint
  (`shortcut`, even on a labelled button), a small mark that carries meaning without a label, text that hides more
  than it shows, a disabled control whose reason is not on screen, or a labelled control whose label can't say what
  pressing it leads to. When not: a tooltip equal to its trigger's text (the lint rejects it), a `•••` trigger, a
  dialog's X, self-evident numbers ("+12 −3").
- Content follows the scanning rules: the value first in `fg-4`, the qualifier muted in `TooltipLabel`, states in
  their `*-text` colour, mixed bright and muted text inside one `whitespace-nowrap` span, never a sentence where a
  value and its label will do.

```tsx
<Hint label='Run in terminal' detail='~/Developer/shinsa'>
  <Button variant='secondary' size='icon-xs' aria-label='Run in terminal' icon='IconConsole' />
</Hint>
<Hint label='Search and actions' shortcut='⌘K'>
  <Button variant='secondary' size='icon-sm' aria-label='Search and actions' icon='IconMagnifyingGlass' />
</Hint>
```

#### InfoPopover and its parts

Anything that shows more on hover (task facts, smart-link preview cards, "2 more", related tasks, the health
banner's Details) is an `InfoPopover`, built on the kit's `PreviewCard`. Real menus (priority, the task menu, Focus,
the queue button) stay click dropdowns.

- Behaviour: opens on hover after 80ms, closes 120ms after the pointer leaves, sits 8px from its trigger (bottom,
  start). A click does nothing to it: it never toggles or sticks open. Moving to another info trigger swaps the card
  at once with no exit or entrance.
- Popup: `corner-superellipse/1.125 flex w-72 origin-(--transform-origin) flex-col rounded-popup bg-popover text-popover-foreground text-xs shadow-md outline-hidden`,
  entering with `fade-in-0 zoom-in-95` and leaving with `fade-out-0 zoom-out-95`. Width defaults to 288px; callers
  set `w-64` (repo), `w-72` (pull request), `max-w-72` (branch), `w-80` (task, health).
- `InfoPopover({ render, trigger, children, className })`: `render` is the trigger element (a smart link `a`, a
  button), `trigger` its contents, `className` goes on the popup.
- `InfoHeader({ title, description })`: `flex flex-col gap-px px-3 py-2.5`; title `min-w-0 font-medium text-fg-4 text-xs`;
  description `min-w-0 text-2xs text-fg-2`.
- `InfoSection({ title, children })`: `flex flex-col border-border border-t py-1 first:border-t-0`; an optional
  title `h3` `flex h-7 items-center gap-1.5 px-3 font-medium text-2xs text-fg-2`.
- `InfoRow({ icon, iconClassName, label, value, valueClassName })`: a 28px label/value row,
  `flex min-h-7 items-center justify-between gap-4 px-3 text-xs`; left `flex min-w-0 items-center gap-2 text-fg-3`
  with a 14px icon and the label `min-w-0 truncate`; right `shrink-0 text-fg-2` (or `valueClassName`, a tone).
- `InfoLine({ label, value })`: the same label left, value right pair for a tooltip
  (`flex items-center justify-between gap-4`).
- `InfoAction({ label, href | onClick })`: the card's last line, `flex h-8 w-full cursor-pointer items-center gap-1.5 border-border border-t px-3 text-left text-primary-text text-xs no-underline outline-none hover:opacity-80 active:opacity-80`;
  an `href` opens in a new tab with a trailing 14px `IconArrowUpRight`.
- Label and value always sit apart (`justify-between`, 16px minimum), never run together with a space. A status the
  icon already says is not printed ("Passed" next to a check); "In progress", "Failed", "Running", "Waiting on you"
  stay. So passing CI is the accent check with no value, while failing CI prints "Failing" (`IconCircleXFilled`,
  `text-red-4`), running "Running" (`IconCircleDotted`, `text-amber-4`) and no checks "None" (`IconCircleDotted`,
  `text-fg-2`).

```tsx
<InfoPopover
  className='w-72'
  render={<button type='button' className='cursor-pointer text-fg-3 text-xs underline' />}
  trigger='Pull request #4531'
>
  <InfoHeader title='Pull request #4531' description='Open into main' />
  <InfoSection>
    <InfoRow icon='IconCheckCircle2Filled' iconClassName='text-primary-4' label='CI checks' />
    <InfoRow icon='IconBubbleText' label='Unresolved comments' value='None' />
  </InfoSection>
  <InfoAction label='Open on GitHub' href={url} />
</InfoPopover>
```

#### ConfirmDialog

Every remove or delete asks first through this, on the kit's `AlertDialog` as it is (its entry motion and fixed
width come with it).

- Header: `AlertDialogTitle` (the question, "Remove agents@superwall.com?") over `AlertDialogDescription` (what
  happens).
- Footer: `AlertDialogCancel` "Keep it", then `AlertDialogAction variant='destructive'` with the `action` text
  ("Remove account", "Delete schedule").
- Props: `control` (from the kit's `useDialogState`: `open`, `onOpenChange`, `onOpenChangeComplete`), `title`,
  `body`, `action`, `onConfirm`.
- The text is held while the dialog closes (`useHeldValue`), so it never changes mid-exit; `onConfirm` runs once
  the dialog has finished closing, not on the click. Mount it with the dialog state's value
  (`{dialog.value === 'remove' && <ConfirmDialog … />}`) so it opens fresh each time.
- Prefer no dialog where a view in place does (a popover's footer can ask the removal itself).

```tsx
const dialog = useDialogState<'remove'>();
<Button variant='outline' size='sm' onClick={() => dialog.show('remove')}>Remove account</Button>
{dialog.value === 'remove' && (
  <ConfirmDialog
    control={dialog.control}
    title='Remove agents@superwall.com?'
    body='Shinsa signs this account out. Runs on it move to the next account.'
    action='Remove account'
    onConfirm={removeAccount}
  />
)}
```

#### ImageViewer

The full-window viewer for evidence images, recordings and chat attachments.

- Backdrop: `fixed inset-0 z-50 bg-black/85 backdrop-blur-sm`. Popup:
  `dark fixed inset-0 z-50 select-none overflow-hidden text-foreground outline-none` (always the dark theme); a
  click on the empty stage closes.
- Chrome: Close (`IconCrossMedium`, `Esc`) top right in `p-3`; Previous (`IconChevronLeftMedium`, `←`) and Next
  (`IconChevronRightMedium`, `→`) at `top-1/2 left-3` / `right-3`, each a kit `Button variant='outline' size='icon'`
  with a `Hint` naming it and its key.
- Caption bar at the bottom (`p-4`):
  `corner-superellipse/1.125 pointer-events-auto flex h-8 min-w-0 max-w-full items-center gap-2 rounded-popup bg-popover ps-3 text-popover-foreground text-xs shadow-3 sm:max-w-xl`
  (`w-xl` with several images; `pe-0.75` with a state `Choice`, else `pe-3`): the name (medium, `Truncate`), "2 of 5"
  and the zoom (`text-fg-2 tabular-nums`), and for a comparison a `Choice` "Which state".
- Media: `corner-superellipse/1.125 block max-w-none rounded-lg object-contain`; a video adds `bg-black` and plays
  with its controls (`autoPlay`, `playsInline`).
  The gutter is 72px with several images, 24px with one.
- Motion: the image flies from its thumbnail to the fit size over 240ms `cubic-bezier(0.22, 1, 0.36, 1)` while the
  backdrop and chrome fade in; without a thumbnail it scales from 0.96 with a fade; a video or reduced motion only
  fades. Swapping images uses `cubic-bezier(0.23, 1, 0.32, 1)`; zoom and pan ease `transform 260ms` on the opening
  curve, `cubic-bezier(0.22, 1, 0.36, 1)`.
  A double tap is within 300ms. `cursor-zoom-in`, and `cursor-grab` / `active:cursor-grabbing` when zoomed.

#### TimeAgo and Duration

Every time on screen. A bare formatted age or duration in JSX is a bug (the lint rejects it).

- `TimeAgo({ at, text?, compact = false, detail? })` renders `<time dateTime=… className='cursor-default'>`:
  - default: "Just now" (under 45s), "5m ago", "3h ago", "4d ago" (minutes under 60, hours under 24, days under 14),
    then "Oct 22";
  - `compact`: the bare "5m" / "3h" / "4d" / "just now" a row ends with;
  - `text(now)`: a phrase around the age ("Started 2h ago", "Resets in 3h"), re-run every minute.
  - It re-renders once a minute (one shared minute clock).
- Tooltip: the exact moment, the date bright and the clock muted: "Wed, Oct 22, 2026 <muted>2:14 PM</muted>". `detail`
  adds a muted second line naming what the time is when the row doesn't say it ("Waiting on you", "Step started").
- `Duration({ from, to, ongoing = false })`: "42s", "3m", "1h", "1h 20m"; tooltip "2:14 PM <muted>to</muted> 2:17 PM
  <muted>Wed, Oct 22, 2026</muted>", or "<muted>Since</muted> 2:14 PM …" while `ongoing`.
- Inherits size and colour from its parent; wrap it in the row's text class.

```tsx
<span className='text-fg-3 text-xs'><TimeAgo at={task.updatedAt} compact detail='Waiting on you' /></span>
<span className='text-fg-3 text-xs'>Worked for <Duration from={run.startedAt} to={now} /></span>
```

#### Markdown and InlineMarkdown

Every block of agent or user prose: the chat's agent text, review prose, plan and spec bodies, findings, a suggested
fix, the request, notes, checklist details.

- `Markdown({ text, className })`: GitHub-flavoured markdown in
  `<div className='prose-shinsa selectable min-w-0 break-words'>` (see Web stylesheet for `prose-shinsa`). It is
  `selectable`: prose is content a person copies. Pass `className` for a different size or ink
  (`text-fg-4 text-xs`); the chat adds `prose-chat`.
- Inline code spans are detected and marked before parsing; references in the text (task titles, `#N`, file paths,
  `shinsa://` links) become smart links (`TaskLink`, `PrLink`, `RepoChip`, `BranchChip`, `FileLink`), the current task
  excluded.
- Blocks: a fenced block is a `CodeFence` (highlighted, Copy, and Run in terminal when its info string marks it
  `run`); an external link opens in a new tab; a GFM task list (`- [ ]` / `- [x]`) is the kit's `Checklist` (rows
  `gap-1`, list `padding-left: 0`) of `ChecklistItem`s with a read-only `ChecklistMark` aligned to the first line
  (`[&>[data-slot=checklist-check]]:h-[1lh]`), its text and nested lists kept; nothing in markdown ticks.
- `InlineMarkdown({ text, className })`: one line in `<span className='prose-shinsa min-w-0 break-words'>`, only
  `code`, `strong`, `em`, `a`, `del` (others unwrapped). References show as plain medium text
  (`font-medium text-fg-4`, a task as its title) instead of nested links, and an external link is
  `font-medium text-fg-4` text. It is not `selectable` by itself (it is mostly titles and row text); a prose use adds
  the class.
- Parsed output is cached by text (400 entries each).

```tsx
<Markdown text={finding.body} className='text-fg-3' />
<InlineMarkdown text={task.title} className='font-medium text-fg-4' />
```

#### CodeBlock and CodeFence

Every code block outside the Code tab: markdown fences, the chat's tool-call blocks, test and check output, a
checklist command.

- `CodeBlock({ copy, command, corner = 'top', className, children })`: `INSET` +
  `group/code selectable relative min-w-0 overflow-hidden bg-bg-2` (plus `flex items-center` when centred).
  When `copy` is set, a corner holds Copy and, when the block has a `command` and a runner is provided, Run in
  terminal (`secondary` `icon-xs`, `IconConsole`, tooltip "Run in terminal" with the folder as detail, `~` for home).
  The two buttons sit in `pointer-events-auto flex items-center rounded-control border border-border bg-bg-2`.
- The corner is `pointer-events-none flex opacity-0 pointer-coarse:opacity-100 group-hover/code:opacity-100 has-[:focus-visible]:opacity-100`:
  shown on hover, focus inside, or always on touch.
  - One line (`corner='centre'`): `shrink-0 pe-1.5`, centred at the right edge beside the code.
  - Several lines (`corner='top'`):
    `absolute top-0 right-0 bg-linear-to-r from-transparent to-[12px] to-bg-2 ps-3 pe-1.5 pt-1.5` (a 12px fade
    so it sits over long lines cleanly).
- `CommandRunnerProvider({ runner, children })` supplies `{ run(command), folder }`; with `runner={null}` a runnable
  block shows Copy alone.
- `CodeFence({ code, language, runnable = false, capped = false })`: `CodeBlock` with `className='my-3 first:mt-0 last:mb-0'`
  around `<pre className='overflow-x-auto px-3.5 py-2.5 font-mono text-2xs text-fg-4 leading-relaxed data-capped:max-h-80 data-capped:overflow-y-auto data-diagram:leading-3.5'>`;
  each line a `block min-h-[1lh] whitespace-pre` span, highlighted on the `--code-*` tokens. `capped` limits it to
  320px and scrolls; a text diagram tightens to a 14px line. A shell block is runnable only when marked `run`; a
  plain block, or one that only opens on a `$ ` prompt, is copy-only and copies without its prompts.

```tsx
<CommandRunnerProvider runner={runner}>
  <CodeFence code='bun run db:migrate' language='sh' runnable />
</CommandRunnerProvider>
```

#### CodeDiff

The one wrapper for every diff outside the Code tab (review snippets, the Overview, `/ui`), on the lazily loaded
`@pierre/diffs` view. Props: `source` (files before/after, or a patch), `numbered?`, `selected?`. A note line (a
rename, a binary file) renders as `px-3 py-2 text-2xs text-fg-2`; while the view loads, a delayed `LoadingLine`
"Reading the changes" in the same classes; on failure "The changes did not load. Reload the page to try again." Put it
inside an `INSET` with `overflow-hidden bg-bg-a1`.

#### InsetNote and SuggestedFix

A labelled note nested in a card (a disagreement, a warning, a suggested fix).

- `InsetNote({ label, icon?, text, tone = 'neutral' })`: `TONE_INSET[tone]` + `flex flex-col px-3 py-2.5`, `gap-1`
  with an icon, `gap-px` without. Label row `flex items-center gap-1.5 text-2xs` in `TONE_TEXT[tone]` with a 14px
  icon; body `Markdown` in `text-fg-4 text-xs`.
- A toned note takes its tone's edge, never the grey hairline.
- `SuggestedFix({ text })` = `InsetNote label='Suggested fix' icon='IconBandage'`, neutral.

```tsx
<InsetNote tone='orange' icon='IconEyeSparkle' label='The agent review disagrees' text={reason} />
```

#### NoteHead

The head every finding and review card opens on: `flex min-w-0 flex-col gap-px text-xs`; a top row
`flex min-w-0 items-start justify-between gap-3` with label (`flex min-w-0 items-center gap-1.5 text-2xs`) over title
(`InlineMarkdown`, `font-medium text-fg-4 leading-5`) left and the action (`flex shrink-0 items-center gap-1.5`,
Fix / Dismiss) right; then the body `Markdown`, `text-fg-3` under a title, `text-fg-4` without one. Props: `label`,
`title`, `body`, `action?`.

#### FilePath, DiffStats, TaskHandle

- `FilePath({ path, className })`: a `Truncate` in `text-2xs`, the folders in `text-fg-2` and the file name in
  `text-fg-4`.
- `DiffStats({ added, removed, muted = false })`: `flex w-fit shrink-0 items-center gap-1.5 font-normal text-2xs tabular-nums`,
  `+N` in `text-green-text` and `−N` (a real minus) in `text-red-text`, both `text-fg-1` when muted. No tooltip.
- `TaskHandle({ task })`: the handle ("SW-142") in `shrink-0 text-2xs text-fg-2 tabular-nums`; nothing before
  triage gives one. `TaskHandlePrefix` is "SW-142 · " in `tabular-nums`.

#### StatusTile and the task glyphs

A 20px (or 18px) rounded square carrying a 14px state glyph in a tone: queue and row tiles, gate tiles, roadmap group icons, smart
link tiles, service rows.

- Classes: `corner-superellipse/1.125 inline-grid shrink-0 place-items-center rounded-control-sm` + size + 
  `TONE_SURFACE[tone]`; the glyph `<Icon size='sm' className={TONE_TEXT[tone]} />` (14px, the tone's ink: a tone
  keeps its tone).
- Sizes: `md` `size-5` (20px, default, an icon slot itself), `sm` `size-4.5` (18px, inline in text and popovers).
- Props: `icon`, `tone`, `size?`, `label?`, `detail?`, `className?`. With a `label` it is `role='img'` with that
  `aria-label` and a `Hint`: the label in its tone, then ` · detail` muted, `whitespace-nowrap` ("Building · Agent
  working"). Without a label it is `aria-hidden`.
- Glyphs keep their outline everywhere (filled means "you are here", only on tabs and nav).
- Never a border on a tile.
- `GateGlyph({ gate })` and `TaskGlyph({ state, task })` resolve icon, tone and label from the status resolver.
  `WorkingGlyph({ task })` adds a `Pulse` at the tile's corner:
  `pointer-events-none absolute -top-px -right-px`, inside
  `relative grid size-5 shrink-0 place-items-center`.

```tsx
<StatusTile icon='IconEyeOpen' tone='amber' label='Changes to review' />
<StatusTile icon='IconPullRequest' tone='green' size='sm' className={INLINE_TILE} />
```

#### CheckMark, SelectedMark, CHECK_TEXT, CheckOutcomeIcon

Checkmarks are the accent everywhere (check and to-do glyphs, the current value in a menu, a select or ⌘K, copy
confirmations, done tiles, toasts, popovers, tooltips, markdown task lists). Never green (the lint rejects a green
checkmark); the only green check is the progress track's done steps.

- `CHECK_TEXT` = `text-primary-text`: the class for any check ink.
- `CheckMark({ label?, className })`: `IconCheckmark1Small` `size='sm'` in `CHECK_TEXT`; named by `aria-label` when
  `label` is given, else `aria-hidden`.
- `SelectedMark({ className })`: `IconCheckmark1` `size='sm'` in `CHECK_TEXT`, `aria-label='Selected'`.
- `CheckOutcomeIcon({ outcome, label?, className })`: a check run's result in
  `inline-grid shrink-0 place-items-center`, with a `Hint` naming it in its colour:

| Outcome | Icon | Icon class | Tooltip text class | Default name |
| --- | --- | --- | --- | --- |
| `pass` | `IconCheckCircle2Filled` | `text-primary-4` | `text-primary-text` | Passed |
| `fail` | `IconCircleXFilled` | `text-red-4` | `text-red-text` | Failed |
| `skipped` | `IconCircleDotted` | `text-fg-2` | `text-fg-2` | Skipped |

```tsx
<CheckOutcomeIcon outcome='fail' label='Failed after 2m' />
```

#### Pulse, ToneLabel, StatusText

- `Pulse({ tone = 'blue', className })`: a 6px dot (`relative flex size-1.5 shrink-0`) with a ping ring behind it:
  `absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none` + `TONE_FILL[tone]`, over
  `relative size-full rounded-full` + `TONE_FILL[tone]`. `aria-hidden`. It means "working now" or "reconnecting".
- `ToneLabel({ label, tone })`: `inline-flex shrink-0 items-center gap-1.5 font-medium text-2xs` in `TONE_TEXT`, a
  6px `rounded-full` `TONE_FILL` dot before the label.
- `StatusText({ state, task })`: the status label `font-medium` in its tone. `TaskMeta` is the status then
  " · now" (what is happening), dropping the second part when it repeats the status.

#### ProjectDot, ProjectDotIcon, ProjectOption

- `ProjectDot({ color, label?, className })`: `size-2 shrink-0 rounded-full` (8px) filled
  `var(--<color>-4, var(--fg-2))` (`gray` is `var(--fg-2)`). With a `label` its tooltip is "‹name› <muted>project</muted>".
- `ProjectDotIcon({ color })`: the dot centred in a 14px box (`grid size-3.5 shrink-0 place-items-center`), the size
  of a menu icon, so the label after it starts where every other item's label does.
- `ProjectOption({ color, name })`: `ProjectDotIcon` then `<span className='truncate'>{name}</span>`. Every place
  you pick a project (Focus menu, the Terminal page's picker, the new-task composer, any `SelectField` with a `dot`,
  ⌘K's choices) renders through it, in the trigger and every option. "All work" is grey.

#### PriorityIcon

`<Icon size='sm' name={…} />`: urgent `IconPriorityUrgent` in `text-red-4` (a red square with `!`), high
`IconPriorityHigh`, normal `IconPriorityMedium`, low `IconPriorityLow` (bars, in the surrounding ink). The priority
menu's items carry the same marks.

#### LoadingLine, LoadingSpinner, CodeLoading

A wait for a read nothing could foresee shows only after 300ms (`LOADING_DELAY_MS`), so a fast read never flashes a
spinner.

- `LoadingLine({ label, className })`: `flex items-center gap-2 text-fg-2`, a `Spinner size='sm'` and the label;
  `invisible` and `aria-hidden` until 300ms have passed (it keeps its space, so nothing moves when it appears).
- `LoadingSpinner({ label })`: nothing for 300ms, then `inline-flex text-fg-2` with a `Spinner size='lg'`
  (`aria-label` the label), for full-page waits.
- `CodeLoading({ label })`: the centred wait every Code tab read shows,
  `flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center font-sans text-fg-2 text-xs`,
  a `Spinner size='sm'` over the label after 300ms (nothing before).
- Each carries `data-loading-state={label}` once shown and `data-loading-pending={label}` while it waits unseen.
- Not a loading state: a busy button (the kit's `loading`), the live agent's shimmering line, an update's toast.

```tsx
<LoadingLine label='Reading the changes' className='px-3 py-2 text-2xs' />
```

#### ConnectionStatus and UpdateButton

- `ConnectionStatus`: nothing while connected; while reconnecting an amber `Pulse` in
  `grid size-5 place-items-center`, `role='status'`, `aria-label` and tooltip "Reconnecting".
- `UpdateButtonView({ version, onClick })`: a primary `sm` Button "Update" entering with
  `fade-in-0 zoom-in-95 animate-in duration-200`; tooltip "Shinsa ‹version› is ready. Only the app restarts: agents keep
  working, and the engine moves to the new version once they hand over." `UpdateButton` shows it only once the desktop app has an update downloaded.

#### HealthCard and EngineCard (the banner card)

A one-line notice card in the page column above a page: `CARD` + `flex min-w-0 items-center gap-2 py-1.5 ps-3 pe-1.5 text-xs`,
`role='status'`. The banner wrapper is `cn(PAGE_COLUMN, 'shrink-0 pt-3')` (12px above). Use this shape for any
app-level notice.

- `HealthCard({ banner, onDismiss })`: a 14px `IconExclamationTriangle` in `text-orange-text`, the text
  `min-w-0 flex-1 text-fg-3`, a quiet "Details" trigger (`shrink-0 cursor-default text-fg-2 hover:text-fg-4 active:text-fg-4`)
  for a `w-80` `InfoPopover` (an `InfoHeader` and one `InfoRow` per problem with the orange warning icon), and a
  `secondary` `icon-xs` `IconCrossSmall` dismiss with its `Hint`.
- `EngineCard({ banner, onAction })`: a 14px `IconExclamationTriangle` (`text-orange-text`) for a warning or
  `IconArrowsRepeat` (`text-fg-2`), the text `min-w-0 flex-1 py-0.5 text-fg-3`, then one `sm` button per action, the
  last `primary` and the others `secondary`, each `shrink-0`.

```tsx
<div className={cn(PAGE_COLUMN, 'shrink-0 pt-3')}>
  <HealthCard banner={banner} onDismiss={dismiss} />
</div>
```

#### Usage bars and figures

- `UsageBar({ row: { percent, tone }, className })`: `relative block h-1.5 overflow-hidden rounded-full bg-bg-a2`
  (6px tall track), the fill `absolute inset-y-0 start-0 rounded-full` + `TONE_FILL[tone]` at `width: percent%`.
  `aria-hidden` (the percentage beside it says it). The context meter uses it at `w-10` (40px).
- `UsagePercent({ percent, className })`: `shrink-0 text-xs tabular-nums` and the usage ink: `text-fg-3` under 75%,
  `text-amber-text` from 75%, `text-red-text` from 90% (the bar's tone uses the same thresholds: neutral, amber,
  red).
- `ResetTime({ at })`: a `TimeAgo` with "Resets in 3h"-style text.
- `RefreshButton({ label, onRefresh })`: `secondary` `icon-sm` `IconArrowRotateClockwise` with `aria-label` and
  `Hint` = label; `loading` while the promise runs (keeps its look, swaps the icon for a spinner, never disabled).

```tsx
<div className='flex items-center gap-2'>
  <UsageBar row={{ percent: 82, tone: 'amber' }} className='flex-1' />
  <UsagePercent percent={82} />
</div>
```

#### Smart links

One inline component per entity, shared by Home's guide, the chat, every markdown block and the task facts:
`TaskLink`, `PrLink`, `RepoChip`, `BranchChip`, `FileLink`. Text turns into them through the reference syntax
(`shinsa://` links, a quoted task title, an exact title of 12 characters or more, a bare `#N` only one pull request
has); `ReferenceText({ text, state })` does it for plain strings and `Markdown` for prose. An unknown or malformed
reference renders as its plain label, never a broken link. The current task (the page's route) is the scope: its own
title is not linked and file links resolve against it.

Shared parts:

| Part | Classes / behaviour |
| --- | --- |
| `SMART_LINK` | `group/link cursor-pointer font-medium text-fg-4 no-underline outline-none` |
| Link underline | `underline decoration-transparent underline-offset-3 group-hover/link:decoration-fg-a3 group-active/link:decoration-fg-a3` (shows on hover and press) |
| `INLINE_TILE` | `relative -top-px me-1 align-middle`: an inline tile 1px up, centred between x-height and cap height, 4px before the text |
| `InlineMark({ icon })` | a 14px icon with `relative -top-px me-1 inline align-middle` (inherits the link's ink) |
| `GlyphLabel({ glyph, text, className })` | the glyph and the first word in one `whitespace-nowrap` span, so the tile and first word never part at a wrap; the rest after it; both underlined on hover |
| `InAppLink({ path, … })` | an `a data-smart href={path}` that navigates in place on a plain left click and opens normally with ⌘, Ctrl, Shift, Alt or a middle click |

Smart anchors carry `data-smart`, so prose link styling (blue, underlined) never applies to them.

- **`TaskLink({ state, task })`**: a `sm` (18px) state `StatusTile` with `INLINE_TILE` and the title, `SMART_LINK`.
  It goes where the work is (`?tab=review` for a review, `?tab=chat&run=` for a question or running agent). On hover a
  `w-80` `InfoPopover` preview: `flex flex-col gap-2.5 p-3` with the tile (`sm`, `mt-px`) beside the title
  (`line-clamp-2 font-medium text-fg-4 text-sm`); under it, indented `ps-6` and `text-xs`, the status `font-medium` in
  its tone over what is happening now (`line-clamp-3 text-fg-3`, left out when it repeats the status); then a
  `flex flex-wrap items-center gap-x-3 gap-y-1 ps-6 text-2xs text-fg-2` line with the handle (`tabular-nums`), the
  repository (`RepoIcon`: `IconGithub` or `IconFolder1` in its project's colour), the branch (`IconBranch`, mono) and `IconPullRequest` `#N`, each icon
  14px `gap-1`. A footer `flex items-center justify-between gap-3 border-border border-t px-3 py-2`: how long it has
  waited (`TimeAgo`, `text-2xs text-fg-2`) and its one action as an `outline` `sm` button.
- **`TaskPopoverRows({ state, tasks })`**: task lists inside a popover, a `HoverHighlight` (`flex flex-col gap-px`,
  indicator `rounded-item`) of buttons
  `corner-superellipse/1.125 flex w-full cursor-pointer items-start gap-2 rounded-item px-2 py-1.5 text-left text-xs outline-none`:
  a `sm` tile (`mt-px`), then the title (`Truncate`, `font-medium text-fg-4`) over `TaskMeta` (`Truncate`,
  `text-2xs text-fg-2`), `gap-px`. Framed in `p-1`.
- **`PrLink({ state, task })`**: a `sm` tile (`IconMerged` when merged, else `IconPullRequest`) in the pull request's
  tone (green open, red failing, amber running, purple merged, neutral closed) and `#N` (`tabular-nums`). It opens GitHub in a new
  tab; its `w-72` card (`PullRequestDetails`) is an `InfoHeader` ("Pull request #N" over its state), the task's row,
  an `InfoSection` of CI checks, Unresolved comments ("None", or the count in `text-amber-text tabular-nums`) and,
  while open, Mergeable in its tone; then `CheckList` and `InfoAction` "Open on GitHub".
- **`CheckList({ checks })`**: an `InfoSection` titled "Checks" with `passing/total` (`font-normal tabular-nums`,
  `CHECK_TEXT` when all pass, else `text-red-text`); a `ul` `flex flex-col gap-1.5 px-3 pb-1.5` of
  `flex min-w-0 items-start gap-2` rows: `CheckOutcomeIcon`, then the name (`Truncate`, `text-fg-4 text-xs leading-4`)
  over the detail (`text-2xs text-fg-2`), `gap-px`.
- **`RepoIcon({ state, repo, icon?, className })`**: a 14px icon, `IconGithub` (remote) or `IconFolder1` (local) unless
  `icon` names one, whose ink (`--icon-color`) is its project's colour (`resolveProjectInk`, the dot's own ink) and
  `data-project-ink` the colour name; without a project it keeps its text's ink. Every mark of a repository is one.
- **`RepoChip({ state, repo })`**: `RepoIcon` placed as `InlineMark` is (`INLINE_MARK`) and the name; links to
  All tasks filtered by the repository. Its `w-64` card: `InfoHeader` (name over the path, `break-all font-mono`),
  an `InfoSection` with Project (`IconLayersTwo`, a 6px `ProjectDot` and the name, `gap-1.5`) and Default branch
  (`IconBranch`), and `InfoAction` "Show its tasks".
- **`BranchChip({ state, task, name })`**: `InlineMark` `IconBranch` and the name in `font-mono`. With a task it links
  to the task, and its `max-w-72` card is `InfoHeader` (the branch `break-all font-mono` over "Branched from ‹base›")
  and `<p className='border-border border-t px-3 py-2 text-2xs text-fg-2'>The branch of ‹title›.</p>`; without a
  task it is plain `font-medium text-fg-4`.
- **`FileLink({ task, path, line?, end?, label?, spot? })`**: inline code
  (`rounded-sm bg-bg-a2 px-1 font-mono text-fg-4`). On a task with a repository it is an `InAppLink`
  (`group/link inline-flex cursor-pointer items-center gap-1 align-bottom no-underline outline-none`) with the file's
  14px icon before the code, underlined on hover, opening the file in the Code tab at its lines; its tooltip is
  "<muted>Open in Code</muted> ‹path› <muted>· lines 4–9</muted>". Elsewhere it is plain code.

```tsx
<p className='text-fg-3 text-sm leading-relaxed'>
  Start with <TaskLink state={state} task={task} />: it unblocks two others.
</p>
```

#### Settings: SettingsGroup, SettingsCard, SettingRow and the shelf

Settings is titles only: the group label and each row's title with its control. Groups and rows take no
descriptions; the title and its options must say what a setting does.

| Constant | Classes | Meaning |
| --- | --- | --- |
| `ROW_INSET` | `pr-[calc(--spacing(1.5)-var(--shelf-edge,0px))] pl-[calc(--spacing(2)-var(--shelf-edge,0px))]` | 8px left, 6px right, minus the shelf's 1px edge when inside one |
| `SETTING_ROW` | `flex min-h-10 items-center gap-4 py-1` + `ROW_INSET` | A 40px minimum row; `py-1` only so a wrapped line keeps 4px from the edge |
| `SETTINGS_SHELF` | `INSET` + `flex flex-col divide-y divide-border bg-bg-a1 [--shelf-edge:1px]` | The inset that groups rows, hairlines between them |
| `TOKEN_TEXT` | `shrink-0 text-2xs text-fg-2 tabular-nums` | A muted figure (token counts, a detail) |

- `SettingsGroup({ title, action?, className?, children })`: `<section id={resolveSectionId(title)} className='flex scroll-mt-6 flex-col gap-1'>`
  with a `SectionLabel` (`px-1`, the action at its right) 4px over a `SettingsCard` (which takes the `className`). The `id` lets `/settings#limits`
  scroll to it (24px margin).
- `SettingsCard({ className, children })`: the kit `Card` with `gap-0 p-1.5` (6px on every side).
- `SettingRow({ title, children })`: `SETTING_ROW`; the title `flex min-w-0 flex-1 items-center gap-1.5 truncate text-fg-4 text-xs`;
  the control `flex shrink-0 items-center gap-1.5`. So text sits 14px from the card's left edge and a control 12px
  from its right.
- `PathRow({ icon, iconLabel, title, path?, action? })`: `SETTING_ROW` with `gap-2`: a 14px icon in
  `grid size-3.5 shrink-0 place-items-center` with a `Hint` (`iconLabel`, "GitHub repository"), then
  `flex min-w-0 flex-1 items-baseline gap-1.5` with the title (`Truncate`, `min-w-0 shrink-0 text-fg-4 text-xs`) and
  the path (`Truncate`, `min-w-0 text-2xs text-fg-2`), then the action.
- `SettingsEmpty({ children, action? })`: `SETTING_ROW` with the line in `min-w-0 flex-1 text-fg-2 text-xs`
  ("No repositories or folders yet.").
- `SettingsBlock({ header, children? })`: one grouped item (a project, an account): a 32px header row with no fill
  (`flex h-8 items-center gap-1.5 pr-1.5 pl-2`) and its rows on one `SETTINGS_SHELF`. Blocks sit 6px apart
  (`gap-1.5`) with no hairline between them.
- `FoldingBlock({ persistId, title, detail, status?, startsOpen = false, forcedOpen = false, children })`: a block
  whose shelf folds: `DisclosureHeader strip='block' chevron='glyph'` (32px, chevron 9px from the end) with
  `gap-1.5 pl-2 text-xs`: an optional 14px status icon in its tone (`-translate-y-px`), the title
  (`min-w-0 truncate font-medium text-fg-4`), the detail in `TOKEN_TEXT`. `forcedOpen` keeps it open (a search hit).
- Geometry: the shelf's 1px edge sits 6px from the card on three sides, and its rows give that pixel back
  (`--shelf-edge`), so a row's text still sits 14px from the card and 8px inside the edge, in line with the block
  header's, and its control 12px from the card's right.
- Controls on the shelf have no fill at rest (it is already the second surface): buttons `secondary`, selects
  `ghost`, `CopyButton` as is. The one exception is an MCP server's Connect, primary `xs`.

```tsx
<SettingsGroup title='Appearance'>
  <SettingRow title='Theme'>
    <Choice label='Theme' items={THEME_ITEMS} value={theme} onValueChange={setTheme} />
  </SettingRow>
</SettingsGroup>

<SettingsCard>
  <div className='flex flex-col gap-1.5'>
    <SettingsBlock header={<><ProjectDot color='blue' /><span className='font-medium text-fg-4 text-xs'>Superwall</span></>}>
      <PathRow icon='IconGithub' iconLabel='GitHub repository' title='paywall-next' path='~/Developer/paywall-next' />
    </SettingsBlock>
  </div>
</SettingsCard>
```

#### ErrorBoundary and ErrorFallback

A render error stays in its region. Without a boundary one broken widget blanks the window.

- `ErrorBoundary({ size, resetKey?, title?, description?, className?, onError?, children })`. `size`:
  - `page`: a routed page, the app root (the fallback replaces the page under a shell that keeps working);
  - `inline`: a region (a task tab's content, a rail section);
  - `icon`: a trigger in a bar (top bar menus, the connection status, the Update button);
  - `silent`: renders nothing (banners, attention signals, prefetch).
- It resets when `resetKey` changes (the route, or the task for a tab), so going away and back recovers. Every caught
  error is logged with `console.error('[ErrorBoundary] A render error was caught', error, componentStack)`.
  `className` wraps the fallback in a `div` (the rail's queue uses `p-2`).
- Copy: page "This page hit an error." / "The rest of Shinsa keeps working. Try again, or reload if it keeps
  happening."; app root "Shinsa hit an error." / "Reload to start again. If it keeps happening, copy the details and
  report it."; inline and icon "This part of Shinsa hit an error."; buttons "Try again", "Reload", "Copy details".
- **Page**: `role='alert'` `flex min-h-0 flex-1 flex-col` around the kit's `EmptyState`
  (`IconExclamationTriangle`, title, description) holding `mt-1 flex w-full max-w-md flex-col items-center gap-3`: the
  message block and the actions at `sm`.
- **Inline**: `role='alert'` `CARD` + `flex min-w-0 flex-col gap-2 p-3`: a row `flex min-w-0 items-center gap-2` with
  a 14px `IconExclamationTriangle` in `text-orange-text` and the title `min-w-0 flex-1 font-medium text-fg-4 text-xs`,
  then the message block and the actions at `xs`.
- **Icon**: keeps the trigger's place as a `secondary` `icon-sm` button, `role='alert'`, with the orange warning
  icon; its `Hint` is the title over the message (`detail`); a press opens a `Popover`
  (`align='start' sideOffset={6}`, `flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 p-3`) with the inline body.
- Message block: `INSET` + `selectable max-h-32 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words bg-bg-2 px-3 py-2 text-left font-mono text-2xs text-fg-3 leading-relaxed`
  (128px at most, scrolls, selectable).
- Actions: `flex flex-wrap items-center gap-1`: Try again (primary, `IconArrowRotateClockwise`) renders the region
  again; Reload (`secondary`) reloads the page; Copy details (`secondary`, `IconClipboard2`, swapping to an accent
  `IconCheckmark1` once copied) copies the message, the stack and the component stack.
- A new top-level region, or a shell widget that reads live state, gets a boundary of the right size.

```tsx
<ErrorBoundary size='inline' resetKey={task.id}>
  <TaskTabContent task={task} />
</ErrorBoundary>
```

### 10.4 The web stylesheet

The web app's own stylesheet sits on the kit's tokens. It imports the kit's global CSS, xterm's CSS and the desktop
cursor rules, scans the app's sources, and adds a `desktop` variant, the code-comment and terminal tokens, the
terminal scrollbar, the two prose styles, the chat and setup motion and the window drag regions. Both files
(`app.css` and the `desktop.css` it imports) are reproduced verbatim in Appendix B; load them as they are. The
sections below explain each part; the short blocks are repeated here, the long ones live only in the appendix.

```css
@import "@shinsa/ui/styles/globals.css";
@import "@xterm/xterm/css/xterm.css";
@import "./desktop.css";

@source "./";

@custom-variant desktop (&:where([data-desktop="window"] *));
```

`desktop:` applies only inside the Mac app's window (`<html data-desktop="window">`): the top bars use
`desktop:ps-16` (Desk) and `desktop:ps-20` (the rail's top row, the compact bar) to clear the traffic lights.

##### Code comment and terminal tokens

```css
:root {
  --code-comment-alert: var(--red-text);
  --code-comment-query: var(--blue-text);
  --code-comment-todo: var(--orange-text);
  --code-comment-highlight: var(--green-text);
  --code-comment-strike: var(--fg-1);
  --terminal-background: var(--background);
  --terminal-foreground: var(--fg-4);
  --terminal-cursor: var(--fg-4);
  --terminal-cursor-text: var(--background);
  --terminal-selection: var(--primary-a2);
  --terminal-find-match: var(--amber-a2);
  --terminal-find-active: var(--amber-a4);
  --terminal-ansi-0: var(--fg-4);
  --terminal-ansi-1: var(--code-tag);
  --terminal-ansi-2: var(--code-string);
  --terminal-ansi-3: var(--code-type);
  --terminal-ansi-4: var(--code-function);
  --terminal-ansi-5: var(--code-keyword);
  --terminal-ansi-6: var(--code-property);
  --terminal-ansi-7: var(--code-punctuation);
  --terminal-ansi-8: var(--code-comment);
  --terminal-ansi-9: var(--code-tag);
  --terminal-ansi-10: var(--code-string);
  --terminal-ansi-11: var(--code-number);
  --terminal-ansi-12: var(--code-function);
  --terminal-ansi-13: var(--code-keyword);
  --terminal-ansi-14: var(--code-property);
  --terminal-ansi-15: var(--code-meta);
}

.dark {
  --terminal-ansi-0: var(--bg-4);
  --terminal-ansi-15: var(--fg-4);
}
```

The terminal's ANSI colours are the Code tab's `--code-*` syntax colours, so a shell reads in the same palette as the
editor; black and bright white swap for the dark theme.

##### Terminal scrollbar

xterm's own slider is hidden and redrawn as `ScrollArea`'s thumb: 5px wide, 4px from the top and bottom, 3px from the
end, `fg-a1` at 60%; it widens to 7px at full opacity while hovered, pressed or dragged, and fades out 500ms after
scrolling stops.

```css
.xterm .xterm-scrollable-element > .scrollbar.vertical > .slider,
.xterm .xterm-scrollable-element > .scrollbar.vertical > .slider:hover,
.xterm .xterm-scrollable-element > .scrollbar.vertical > .slider.active {
  background: transparent;
}

.xterm .xterm-scrollable-element > .scrollbar.vertical > .slider::before {
  content: "";
  position: absolute;
  inset-block: 4px;
  inset-inline-end: 3px;
  width: 5px;
  border-radius: 9999px;
  background: var(--fg-a1);
  opacity: 0.6;
  transition:
    opacity 150ms,
    width 200ms;
}

.xterm .xterm-scrollable-element > .scrollbar.vertical:hover > .slider::before,
.xterm .xterm-scrollable-element > .scrollbar.vertical:active > .slider::before,
.xterm .xterm-scrollable-element > .scrollbar.vertical > .slider.active::before {
  width: 7px;
  opacity: 1;
}

.xterm .xterm-scrollable-element > .visible {
  transition: opacity 200ms;
}

.xterm .xterm-scrollable-element > .invisible.fade {
  transition: opacity 200ms 500ms;
}
```

##### `prose-shinsa`

The prose style of every `Markdown` and `InlineMarkdown`: 13px (`--text-xs`) on a 1.45 line in `fg-3`, headings the
same size in medium `fg-4` (hierarchy by weight and ink, not size), 6px block margins, 16px list indent, inline code
in mono at 0.92em on `bg-a2`, prose links in the accent with a 40% underline (smart links excluded by `data-smart`),
tables full width with hairline rows, blockquotes on a 2px `bg-3` rule in `fg-2`. Every ink also sets `--icon-color`
to the matching icon ink (`fg-3` text gets `--icon-3`, and so on), so an icon in prose draws in the icon ink of its
text. All selectors are `:where()` so a utility on the
element still wins.

| Element | Values |
| --- | --- |
| root | `font-size: var(--text-xs)`, `line-height: 1.45`, `color: var(--fg-3)`, `--icon-color: var(--icon-3)` |
| `h1`–`h4` | `margin: 0.875rem 0 0.25rem` (14px above, 4px below), `font-weight: var(--font-weight-medium)`, `--text-xs`, `fg-4`, `--icon-4` |
| `strong` | `font-weight: var(--font-weight-semibold)`, `fg-4`, `--icon-4` |
| `p, ul, ol, table, blockquote` | `margin: 0.375rem 0` (6px) |
| `ul, ol` | `padding-left: 1rem`; `ul` disc, `ol` decimal; a task list `padding-left: 0`, no markers |
| `li::marker` | `fg-2` |
| `code` | `var(--font-mono)`, `0.92em`, `padding: 0 0.25rem`, `border-radius: var(--radius-sm)`, `bg-a2`, `fg-4`, `--icon-4` |
| `pre code` | `padding: 0`, `font-size: inherit`, `background: transparent` |
| `a:not([data-smart])` | `primary-text` (and `--icon-color`), underlined, `text-decoration-color: color-mix(in oklch, var(--primary-text) 40%, transparent)`, `text-underline-offset: 2px` |
| `table` | `width: 100%`, `border-collapse: collapse` |
| `th, td` | `padding: 0.25rem 0.5rem`, `border-bottom: 1px solid var(--border)`, left aligned; `th` medium `fg-2`, `--icon-2` |
| `blockquote` | `padding-left: 0.625rem` (10px), `border-left: 2px solid var(--bg-3)`, `fg-2`, `--icon-2` |
| first / last child | no top / bottom margin |

The rules are `.prose-shinsa` on the root and `.prose-shinsa :where(…)` for each element above (the task list is
`:where(ul.contains-task-list)`, the marker `:where(li)::marker`, the prose links `:where(a:not([data-smart]))`, the
first and last child `.prose-shinsa > :first-child` / `> :last-child`); the CSS is verbatim in Appendix B.

##### `prose-chat`

Added on top of `prose-shinsa` for the agent's text in the task chat (the same 13px size): a roomier reading
rhythm in the brightest ink and real heading sizes.

| Element | Values |
| --- | --- |
| root | `line-height: 1.625`, `color: var(--fg-4)`, `--icon-color: var(--icon-4)` |
| `p, table, blockquote` | `margin: 1.25rem 0 0.75rem` (20px above, 12px below) |
| `ul, ol` | `margin: 1rem 0` (16px) |
| `li + li` | `margin-top: 0.25rem` (4px) |
| nested `li > ul, li > ol` | `margin: 0.25rem 0` |
| `h1`–`h6` | `margin: 1.25rem 0 0.75rem`, `line-height: 1.25` |
| `h1` | `font-size: 1.125rem` (18px) |
| `h2` | `font-size: 1rem` (16px) |
| `h3`–`h6` | `font-size: 0.875rem` (14px) |
| inline code (`:not(pre) > code`) | `padding: 0.0625rem 0.25rem` (1px by 4px) |
| first / last child | no top / bottom margin |

The rules are `.prose-chat` and `.prose-chat :where(…)` for each element above (`.prose-chat > :first-child` /
`> :last-child` for the ends); the CSS is verbatim in Appendix B.

```tsx
<Markdown text={message.text} className={cn('prose-chat', CHAT_PROSE_INSET)} />
```

##### Keyframes and animations

| Class | Keyframes | Duration | Easing | Delay / fill | Used for |
| --- | --- | --- | --- | --- | --- |
| `chat-swap-in` | from `opacity: 0; transform: translateY(0.625rem); filter: blur(2px)` | 360ms | `cubic-bezier(0.23, 1, 0.32, 1)` | 80ms, `both` | The live card's new interim message rising in from 10px below |
| `chat-swap-out` | to `opacity: 0; transform: translateY(-0.625rem); filter: blur(2px)` | 240ms | `cubic-bezier(0.23, 1, 0.32, 1)` | `both` | The old message sliding up and fading |
| `onboarding-in` | from `opacity: 0; transform: translateX(var(--onboarding-shift))` | 220ms | `cubic-bezier(0.23, 1, 0.32, 1)` | `both` | A setup step arriving from 8px to the right |
| `onboarding-in-back` | the same with a −8px shift | 220ms | same | `both` | Going back: from 8px to the left |

The new message waits 80ms so the old one has started leaving; together they read as one swap. Under reduced motion
setup steps only fade, over 160ms. (The live card itself simply changes under reduced motion.)

The `chat-swap-in` and `chat-swap-out` classes each run the keyframes of the same name. Both onboarding classes run one `onboarding-in` keyframe that reads the shift from `--onboarding-shift` (`0.5rem`
on `.onboarding-in`, `-0.5rem` on `.onboarding-in-back`); under `prefers-reduced-motion: reduce` the shift is `0` and
the duration `160ms`. The CSS is verbatim in Appendix B.

Other motion inside composites (for reference, all in their own classes above): chevrons rotate over 150ms
(section, disclosure) or 200ms (chat rows); `Pulse` uses Tailwind's `animate-ping` and stops under reduced motion; the
Update button enters with `fade-in-0 zoom-in-95 animate-in duration-200`; the jump-to wash fades over 500ms.

##### Window drag regions (Mac app)

In the Mac app the top bars are the window's title bar: anything marked `data-window-drag` drags the window, while its
controls and every overlay stay clickable.

```css
[data-desktop] [data-window-drag] {
  -webkit-app-region: drag;
}

[data-desktop] [data-window-drag] :is(button, a, input, [role="button"], [role="status"]),
[data-desktop]
  :is([data-sonner-toaster], [role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"]) {
  -webkit-app-region: no-drag;
}
```

Mark every bar that sits where a title bar would (`CardsTopBar`'s header, the rail's top row, `CompactBar`, setup's
44px bar) with `data-window-drag`, and keep it `select-none`.

##### Desktop cursors

The Mac app shows the arrow where a browser shows the pointer hand, keeps every other cursor, and has no
rubber-band on the page root.

The CSS is `desktop.css`, verbatim in Appendix B. Its five rules, all under `html[data-desktop]`:

| Rule | Selector | Effect |
| --- | --- | --- |
| Arrow on interactive elements | `button`, `select`, `summary`, `label[for]`, checkbox, radio and file inputs, the roles `button`, `tab`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `switch`, `checkbox`, `radio`, `link`, `treeitem`, `a[href]`, `area[href]`, `.cursor-pointer`, an inline `cursor: pointer` style, and CodeMirror's fold gutter, fold placeholder, collapsed lines, autocomplete items and diagnostic actions; each only when not disabled (`:disabled`, `aria-disabled="true"`, `data-disabled`) and not carrying `.cursor-default`, `-text`, `-move`, `-grab`, `-grabbing`, `-col-resize`, `-row-resize`, `-ew-resize`, `-ns-resize`, `-zoom-in`, `-zoom-out`, `-not-allowed`, `-wait`, `-progress`, `-help` or `-crosshair`. Also every descendant of a link, button, `label[for]`, `summary`, the roles `button`, `tab`, `link`, `option`, `menuitem`, `treeitem` or `.cursor-pointer`, except `input`, `textarea`, an editable `contenteditable`, `.cm-content` and its children, and `.cursor-text`, `-grab`, `-grabbing`, `-col-resize`, `-not-allowed`; and the `::before` / `::after` of `a[href]`, `button`, `[role="button"]`, `.cursor-pointer` | `cursor: default !important` |
| Disabled controls | every descendant of `:disabled`, `[aria-disabled="true"]`, `[data-disabled]` | `cursor: inherit !important` |
| Pane drag | `body[style*="col-resize"]`, everything in it and their `::before` / `::after` | `cursor: col-resize !important` |
| Slider drag | `body:has([data-slot="slider-thumb"][data-dragging])` and everything in it | `cursor: grabbing !important` |
| No rubber-band | `html[data-desktop]` and its `body` | `overscroll-behavior: none` |

Every `!important` carries a `biome-ignore lint/complexity/noImportantStyles` comment naming why.

What each rule does: interactive elements and their descendants show the arrow (`!important` beats every utility,
kit rule, inline style and third-party sheet) unless they ask for a specific cursor (default, text, move, grab,
resize, zoom, not-allowed, wait, progress, help, crosshair) or are text inputs or the editor; inside a disabled control everything shows the
control's own not-allowed cursor; while a pane is dragged the whole page keeps `col-resize`; while a slider is dragged
the whole page keeps `grabbing`; the page root never rubber-bands. In a browser none of this applies and
`cursor-pointer` shows the hand.

## 11. Patterns

How the pieces combine. Each pattern states its rules, the exact values, the reason and one example from Shinsa.

### 11.1 Pages, surfaces and controls

These are the general layout and component patterns, in Shinsa's values. The accent is the one blue `primary`, controls run on the dense ramp (22 / 24 / 26 / 30px), nothing draws a focus state, and menus, selects, popovers, dialogs and sheets are edged by the `shadow-*` hairline ring (`0 0 0 1px var(--bg-3)` in light, `inset 0 0 0 1px var(--bg-3)` in dark) rather than a `border`. Tooltips and toasts are the exception: a 1px `border` in `bg-3`. Every pattern names its rule, the exact classes, the reason, a do and a don't, and one example from Shinsa. Where a pattern is also covered in 11.2, the fuller statement is kept in one place and the other points to it.

#### Page layout: one centred column, no side navigation

**Rules**

- Every page is one centred column. A page with parts (Settings, the task page) switches them with a horizontal tab bar under its heading, at every width. Never a rail of links or a list of sections at the side of a page, however wide the window: tabs, tables of contents and details panels all go above or inside the column. The Shelf layout's task rail is app chrome the user picks in Settings, not a page's own navigation.
- App chrome owns the frame. Pages never set their own outer width or side padding: they sit in one of two named containers.

| Container | Classes | Width | Use |
| --- | --- | --- | --- |
| Page column | `mx-auto w-full max-w-3xl px-6` | 768px cap, 24px gutters | Home, the task page (heading, tabs, Overview, chat), All tasks, Settings |
| Page top | `pt-6` | 24px above the heading | every page column |
| Top bar frame | `mx-auto w-full max-w-[90rem] px-3 sm:px-5` | 1440px cap, 12px gutters, 20px from `sm` | the Desk top bar's contents |
| Setup column | `ONBOARDING_COLUMN` = `mx-auto flex w-full max-w-xl flex-col gap-6 px-6`, with `PAGE_TOP`, `md:pt-12` (48px from the top from `md`) and `pb-16` | 576px cap | the one-step-at-a-time setup flow |

- Use the same container for a page's loading, error and populated states, so nothing jumps when data lands.
- The page heading, its tab row and the content share one left edge (One page column and one left edge, in 11.2); sections are 24px apart (Section labels and section rhythm, in 11.2).
- Breakpoints are Tailwind's (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Never add an arbitrary `min-[…]` breakpoint.

**Why.** Shinsa is compact and used in a tablet-sized floating window as often as full screen. A side list of sections wastes the width it needs and makes one long page; a tab bar keeps every part one click away.

**Do** put a page's parts behind a segmented tab bar under its heading. **Don't** add a table of contents, a scroll-spy or a list of section links beside the column.

**Example.** Settings is six panes (General, Agents, Agent usage, Projects, Integrations, Automations) behind a segmented `Choice` under the heading, the tab in the URL (`?tab=agents`, General is bare `/settings`). The heading reads the open tab's name ("Agents"), never "Settings", and switching tabs swaps only the pane under the bar.

#### Page heading

**Rules**

- One heading component, `PageHeading`, for every page: never a hand-built `h1`.
- Title: `text-balance font-medium text-base text-fg-4 leading-tight` (a 20px line).
- Description or count: `max-w-2xl text-pretty text-fg-2 text-xs`, directly under the title with `gap-px` (never more), flush with the column's left edge.
- The task page's heading adds the request as a `text-xs` `fg-2` description clamped to two lines (a long request expands on click), with the task view tabs at the end of the row.
- A heading carries no decision buttons. A decision sits on the card it decides about.

**Why.** One component keeps every page's first line on the same 20px line and the same edge, and keeps "Approve" from floating away from what it approves.

**Do** pass the title and description to `PageHeading`. **Don't** set a heading's size, weight or gap at the call site, or put Approve or Merge in the header.

**Example.** All tasks renders `PageHeading` with title "All tasks" and its count as the description; the status filter and search sit in the row under it.

#### Where actions go

**Rules**

- An action sits on the thing it acts on.
  - Creating or adding an item to a list acts on the list, so it sits at the end of the list's own header strip (the card's toolbar or section label action), last after sort and view controls, at every width.
  - An action on one section of a page is that section's label action.
  - An action on one card is in the card's header strip (its action slot).
  - An action on one item is on its row: a trailing control, a hover-revealed icon button, or its `•••` menu.
- The page heading holds page-level controls only, never a create action and never a gate decision.
- When the list is truly empty (not filtered to nothing), the empty state holds the create action and the strip drops it, so the action never shows twice.
- Acting never moves the user (Your message, and acting never moves you, in 11.2).

**Why.** An action beside its object says what it acts on without a label; an action in the header is ambiguous once a page holds two lists.

**Do** put "Add account" on the Accounts section label. **Don't** put it in the page heading.

**Example.** Settings → Agent usage puts Refresh and Add account as the Accounts `SectionLabel`'s action, 2px apart (`gap-0.5`, the one 2px gap in the web, which `SectionLabel` owns).

#### A short flow is an overlay, not a page

**Rules**

- A task of a few fields or a few steps that starts from somewhere in the app opens over it and returns the user there.
  - A `Dialog` for a form or a short wizard.
  - A `Sheet` for a long form the user reads beside the page.
- A route of its own is only for a surface people land on, bookmark or share. Never a route for a detour.
- An old route to a flow that became an overlay stays as a redirect that opens the overlay; a page nothing reaches any more is deleted.
- A wizard's step back is the first footer item, split to the far left; the first step has no Back, its way out is Cancel beside the forward action.

**Why.** A detour page loses the user's place and scroll; an overlay keeps both.

**Do** open "Custom test coverage" as a dialog from the coverage select. **Don't** give it a route.

**Example.** Settings → Projects: choosing Custom in a repository's coverage select opens the Custom test coverage dialog (command, report path, format); closing it leaves the user on the same row.

#### Split button: a menu beside its call to action

**Rules**

- A `…` menu that belongs to a call to action is fused with it into one split control: the CTA, a seam, then the icon-only menu trigger in the CTA's own variant and size.
- A lone `•••` with no CTA beside it (a row's menu) is `OptionsTrigger`: `Button variant='secondary' size='icon-sm' icon='IconDotGrid1x3Horizontal'` with an `aria-label`, no tooltip.
- A fused seam changes colour in the same frame as the border beside it (no transition). Draw a seam as the part's own start border over its own fill, never as a bare line over the canvas: a translucent line only matches another when both composite over the same fill.

**Why.** Two adjacent buttons that do related things read as one decision; fusing them stops the menu reading as a separate, unrelated control.

**Do** give the generic `•••` an `aria-label` ("Task actions"). **Don't** give it a tooltip; its menu is one click away and names every action.

**Example.** The task page's `•••` (`OptionsTrigger`) opens the task menu in three groups: Open the pull request on GitHub and Copy branch name; Open in editor, Open a terminal and Show in Finder; Restart the current step, Mark as done, and Cancel task in the destructive style.

#### Header strips and toolbars

**Rules**

- A card's header is a 36px band: `CARD_HEADER` = `flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 font-medium text-fg-4 text-xs`. A leading 14px icon sits in a 20px `IconSlot` (`grid size-5 shrink-0 place-items-center`) on the card's 12px inset, 8px from the glyph to the title. Its count and meta are in 11.2, Cards.
- A list's toolbar strip is `Toolbar`: `flex h-9 shrink-0 items-center gap-2 border-border border-b ps-3 pe-2`, 36px, controls 8px apart. Controls in it are `sm` (24px).
- **Trailing controls set the end inset.** When a strip ends in a button or other boxed control, the end padding equals the control's vertical inset, so the control sits equally far from the top, bottom and end: end padding = (strip height − control height) ÷ 2. Band 36 with a 22px chevron box: 7px. A 28px strip with a 22px box: 3px. Block 32: 9px. Line 24: 5px.
- A strip that folds keeps its height open and closed; its divider is drawn by the content under it (`border-t`), so the band never jumps.
- Tabs that grow with the data get a strip of their own, and search and sort share a second strip under it, so a new tab never pushes the search off the edge.

**Why.** One band height and one icon column let a card header and every row under it share an icon centre.

**Do** let the chevron box's inset follow from the strip height. **Don't** hand-pad a strip that ends in a control at the title's 12px.

**Example.** The Overview's `Panel` header: `IconSlot` with a 14px icon, the title, its count, the folding chevron (`secondary` `icon-xs`, 22px) 7px from the end of the 36px band.

#### Section labels on the canvas

**Rules**

- A titled group on the page canvas is `SectionLabel`, 4px over its card; its classes, its actions (2px apart, `gap-0.5`) and the rhythm between sections are in 11.2, Section labels and section rhythm.
- With a disclosure the whole label is one button (`DisclosureHeader`); the empty rest of the row folds it too.
- A heading inside a card is a card title, never a section label.

**Why.** A quiet 12px label lets the cards carry the page; a bold heading over every card would compete with the page title.

**Do** fold a Home section from anywhere on its label row. **Don't** add a description line under a section label.

**Example.** Home's sections ("Needs you", "In progress", "Recently finished") are folding `SectionLabel`s over list cards; Settings groups use the plain label.

#### Cards

**Rules**

- One card surface. App code uses `CARD` = `corner-superellipse/1.125 rounded-xl border border-border bg-card`; the kit's `Card` draws the same edge as an inset ring on `::after` (`shadow-[inset_0_0_0_1px_var(--bg-3)]`, `z-30`) so a sticky or filled child never paints over it.
- Insets, the header strip `CARD_HEADER`, the footer strip `CARD_FOOTER`, list cards and settings cards: 11.2, Cards. The kit's `CardFooter` is `flex min-h-10 items-center justify-between border-bg-3 border-t px-3 py-1.5`.
- Kit card parts: `CardHeader` `px-3 py-2.5 gap-px` (with `divider`, a `border-b border-bg-3`), `CardTitle` `font-medium text-fg-4 leading-tighter`, `CardDescription` `text-fg-2 text-xs`, `CardContent` `flex flex-col gap-3 px-3 pb-3`. A `CardAction` centres on the title block and fades horizontally (16px) when it overflows.
- A card never repeats its page's name as its title.
- `bun lint:conventions` rejects a hand-built card (`rounded-xl border border-border bg-card` instead of `CARD`).

**Why.** One edge, one inset and one band make every card read as the same object in both themes.

**Do** use `CARD` and its header and footer constants. **Don't** write `rounded-xl border border-border bg-card p-4`.

**Example.** The error fallback's inline look is a `CARD` with `p-3`: a 14px orange warning icon, "This part of Shinsa hit an error." in `font-medium text-fg-4 text-xs`, the message in a scrolling mono block, then Try again, Reload and Copy details at `xs`.

#### Insets: boxes nested in a card or the chat

**Rules**

- Anything nested in a card or in the chat column (an answer box, code fences, tool blocks, images, message links, a suggested fix, notes, an error's details) is an inset: `INSET` = `corner-superellipse/1.125 rounded-lg border border-border`, with its fill on top. The fills, the tone table, what is not an inset and the lint rules are in 11.2, Insets and toned boxes.
- A toned box is `TONE_INSET[tone]`: `corner-superellipse/1.125 rounded-lg border`, the tone's `-a3` border and its `-a2` wash (neutral: `border-border` and `bg-bg-a1`).
- Never a fill on a fill: a control on an inset or shelf has no fill at rest (`secondary` buttons, `ghost` selects).

**Why.** A fill step alone is too faint to define an edge in light mode; a grey edge round an orange fill reads as two things.

**Do** give the review's orange "The agent review disagrees" note `TONE_INSET.orange`. **Don't** put `border-border` round a toned fill.

**Example.** `InsetNote`: a `text-2xs` label (with or without an icon) over the text, on `bg-bg-a1`, its `tone` prop taking any status tone.

#### List rows

**Rules**

- A row you pick from is `ListRow`: `LIST_ROW` = `corner-superellipse/1.125 flex w-full cursor-pointer gap-2 rounded-control text-left outline-none`, one line `LIST_ROW_LINE` (`h-7 items-center`, 28px) or two `LIST_ROW_LINES` (`items-start pt-1.5 pb-1`, title `LIST_ROW_TITLE` over meta `LIST_ROW_META`). Its full anatomy is in 11.2, List rows.
- A row draws no hover, highlighted or selected background of its own. Rows sit in `HoverHighlight` (plain lists, a `rounded-control` highlight) or `HighlightList` (menus and popover lists, `rounded-item`), which slides one shared `bg-bg-a2` highlight to the hovered or keyboard row (11.2, Sliding highlight); the row only changes its text colour.
- **A row that opens something is one line and the whole row opens it.** Its title is the link; secondary facts share a line joined by " · "; row actions sit in a trailing column, icon-only, revealed on hover (always shown on touch with `pointer-coarse:opacity-100`). Never a second line held open for controls.
- **A hover-revealed control is always the last thing on its line.** It keeps its box while hidden (`opacity-0`, not `hidden`), so revealing it never shifts the row.
- Only a row that responds to a click reacts to the pointer: one with an `onClick` or a link role gets the pointer cursor and the highlight. A static row gets neither.
- A selected row in a divided list draws its primary edge on `::before` (`before:absolute before:inset-0 before:border before:border-primary`), so it neither doubles the dividers nor changes the row's height.
- `bun lint:conventions` rejects a row that draws its own highlight (`data-highlighted:`, `data-hovered:` or `data-indicator-here:` with a `bg-`, or a `data-highlight-item` / `role="option"` / `role="menuitem"` row with a `hover:`, `active:`, selected or active `bg-`).

**Why.** One sliding surface reads as one cursor moving down a list and costs no layout or paint per frame; a row-owned wash flickers between rows.

**Do** put rows in `HoverHighlight` and mark them `data-highlight-item`. **Don't** write `hover:bg-bg-a2` on a row.

**Example.** Home's Recently finished section: `ListRow`s with a finished tile, the task title over its repository, and "2h" (`TimeAgo compact`) at the right, in a `p-1` list card.

#### Settings rows and grouped shelves

**Rules**

- One setting is a row: its title on the left, its control on the right, in a settings card (40px minimum row).
- Settings is titles only. `SettingsGroup` and `SettingRow` take no description; a title and its options must say what a setting does. The one exception is the Agents tab's model groups and roles, whose titles cannot say which work they cover: each row carries one `text-2xs text-fg-2` sentence under its title. A row may still show data (an account's reset time, a path).
- Information never hides in a tooltip on a disabled control; the reason goes where touch can read it, or in the control's own disabled-with-reason tooltip only when it says why.
- A grouped setting is a block of a 32px header row over a shelf of rows, and a control on the shelf has no fill at rest; the measurements (`SETTING_ROW`, `SETTINGS_SHELF`, `--shelf-edge`) are in 11.2, Cards.

**Why.** The setting's name and its options are the whole message; descriptions under every row turned Settings into reading.

**Do** name a setting so its options explain it ("Setup steps" with Run setup again). **Don't** add a grey sentence under a setting row.

**Example.** Settings → Projects: one block per project, 6px apart: the colour dot, the name, the key as a mono `Badge`, then a `secondary` `xs` Add and the `•••`; the shelf lists each repository and folder as a path row with ghost `sm` selects.

#### Tables and divided lists

Shinsa's kit has no `Table` primitive today; lists are rows. When tabular data is needed, these rules hold.

**Rules**

- Rows divide with the one hairline (`divide-y divide-border`).
- Rows follow List rows (above): only an interactive row reacts to the pointer, and a row that opens something is one line whose title is the row's link (so row and title cannot open different places), with its actions in a trailing icon-only column revealed on hover.
- Numbers right-align with `tabular-nums`.
- A badge in a cell must not grow the row.
- An empty body keeps the header row and holds one full-width cell with a compact empty state, never a hand-set muted line.
- A loading table renders the real header labels and each bar inside a box of its line's height, so loading never shifts the table.
- A table inside a card needs no wrapper scroller; it scrolls and fades sideways on its own, and the card only clips (`overflow-hidden`). A capped table is frame (`overflow-hidden`, edge, fill), then scroller (`max-h-*`, `overflow-y-auto`, fade), then the table.
- The sorted column is the only one showing an arrow; a sortable header reads in the same label role as a plain one.

**Why.** Hover promises a click; a table that washes on every row tells the user every row opens.

**Do** make the whole row the link. **Don't** add a second line under the title just to hold row actions.

**Example.** The roadmap (All tasks) follows these rules with rows instead of a table: each row is one line that opens its task, status and pull request are trailing columns, and a nested row's corner arrow is a 20px button that opens the Waits on menu.

#### Buttons: variant and size by context

**Rules**

- Six variants: `primary` (the default; blue fill, white label, `shadow-control` highlight, the fill at 80% on hover and press), `secondary` (no fill at rest, `text-fg-2`, hover and press lay `bg-bg-a2/70` and brighten to `text-fg-4`), `outline` (`text-fg-4` on `bg-background`, `dark:bg-bg-3`, edged by `shadow-control-elevated`), `destructive` (`text-white` on `bg-red-4`, `shadow-control-destructive`, the fill at 90% on hover and press), `bare` (icon-only, no wash at all, glyph `fg-2` to `fg-4`) and `link` (`text-primary-text`, no box, `opacity-80` on hover and press, the content scales to 0.975 on press).
- At most one `primary` per group of actions. Its companion is `secondary`. `outline` stands alone (a trigger, a standalone action) and never sits next to a primary, with one exception in the code: a decision or now card's alternatives. A review's decision card puts Review (`outline`, it opens the review) beside its primary decision (Decision cards and action naming, in 11.2), and a now card's alternatives are `outline` beside its one primary (Resume now, Check in now). A `destructive` confirm's companion is `secondary`.
- An icon button is `secondary` everywhere, except a quiet action in a row that already washes on its own, which is `bare`.
- Sizes are one value at every width; there is no touch step-up.

| Size | Height | Classes | Icon | Use |
| --- | --- | --- | --- | --- |
| `xs` | 22 | `h-5.5 gap-1 rounded-control-sm px-2 text-xs` | `sm` 14 | dense inline: hover-revealed row actions, actions in a nested card, a shelf's Add |
| `sm` | 24 | `h-6 gap-1 rounded-control-sm px-2 text-xs` | `sm` 14 | header strips, toolbars, section-label actions, popovers, composer footers, the top bar |
| `default` | 26 | `h-6.5 gap-1.5 rounded-control px-2.5 text-xs` | `sm` 14 | card bodies, dialog footers, a form's submit |
| `lg` | 30 | `h-7.5 gap-1.5 rounded-control px-3 text-sm` | `sm` 14 | the rare primary call to action on an empty page |
| `icon-2xs` | 18 | `size-4.5 rounded-sm` | `sm` | a close mark inside a 24px row (a terminal tab) |
| `icon-xs` | 22 | `size-5.5 rounded-control-sm` | `sm` | a chevron box on a card band, a code block's copy |
| `icon-sm` | 24 | `size-6 rounded-control-sm` | `sm` | `•••` triggers, the dialog close X, strip icon actions |
| `icon` | 26 | `size-6.5 rounded-control` | `sm` | icon actions beside `default` buttons |
| `icon-lg` | 30 | `size-7.5 rounded-control` | `sm` | beside `lg` |

- An icon on either side of a label trims that side's padding by 2px (`data-[icon=inline-start]:pl-1.5` at `xs`/`sm`, `pl-2` at `default`, `pl-2.5` at `lg`) so the glyph sits optically level with the text edge. A chevron trims to 5px and pulls 2px closer (`gap-0.5`).
- Pass icons through the `icon` prop (`icon='IconPlusMedium'`, or `{ name, position: 'inline-end' }`). Every size draws its icons and its spinner at 14px (`sm`), and a default select's chevron matches; a call site never sizes, colours or fades a button's icon.
- Every control in one row shares one height.
- **Actions that don't fit lose their labels, not their buttons.** A row or card's actions with no room for labels go icon-only at the matching icon size, each with an `aria-label` and a delayed tooltip, never into a `…` overflow menu. An overflow menu is for secondary actions, not for narrow ones.
- **Pending is `loading`.** The button keeps its colours and width, swaps its leading icon for a `Spinner` (or adds one when it has no icon), sets `aria-busy` and ignores presses and keys, so it can't fire twice. It is never `disabled`, and never fades.
- Disabled is `opacity-45` and `cursor-not-allowed`, no other colour change.
- The press deflates only the fill (`::before` insets 1px sideways and 0.5px vertically) in the frame of the press; the label never moves.

**Why.** A control's height matches the line it sits beside; two filled buttons side by side make the user stop and compare them.

**Do** pair one `primary` with `secondary` companions, and name each for what it decides. **Don't** put an `outline` button next to a primary outside a review's decision card, or hand-write `{pending ? <Spinner /> : label}`.

**Example.** The plan gate's now card: Approve plan (`primary`, `sm`) alone at the card's top right, `loading` while it sends; revising goes through the chat, named in the card's footer ("Want something different? Say it in the chat and the agent revises it." with Open the chat). The merge gate's card puts Review (`outline`, `sm`) before Merge #4531 (`primary`, `sm`).

```tsx
<Button size='sm' loading={busy === approve} onClick={approvePlan}>Approve plan</Button>

<Button variant='outline' size='sm' onClick={openReview}>Review</Button>
<Button size='sm' icon='IconMerged' loading={merging} onClick={merge}>Merge #4531</Button>
```

#### Badges

**Rules**

- Pills, `rounded-full`, `font-medium`, `text-2xs` (12px).

| Size | Classes | Icon trim |
| --- | --- | --- |
| `sm` | `h-4.5 px-1.5` (18px) | `pl-1` / `pr-1` on the icon's side |
| `default` | `h-5 px-2` (20px) | `pl-1.5` / `pr-1.5` |

- Variants: `default` (`bg-bg-a1 text-fg-2`), one per hue (`purple`, `blue`, `sky`, `green`, `amber`, `orange`, `red`, `pink`: `bg-{hue}-1 text-{hue}-text`) and `solid` (`bg-fg-4 text-background`). A toned badge has no border.
- Icons go through `icon`; the badge sets them at 14px in the label's ink.
- Labels are sentence case ("Beta", never "BETA").
- `Badge` owns its geometry: never restate height or padding in a wrapper.

**Why.** A badge annotates; at 12px on a pill it stays a step quieter than the 13px row it sits in.

**Do** show a project's key as a mono `Badge` with its tooltip ("Tasks in this project are named SW-1, SW-2…"). **Don't** add a border to a toned badge.

**Example.** The pull request badge in All tasks: the pull request's number on its tone's soft surface, one step stronger on hover.

#### Fields

**Rules**

- A field (`Input`, `Textarea`, a default `SelectTrigger`) is filled, never bordered: `bg-input` (`bg-2`, a step above the page, a card and a dialog). `Input` and `Textarea` have no hover; a default `SelectTrigger` lays `--input-hover` (`bg-3`) at 80% on hover, press and while open. Inside a dark popover (itself `bg-2`) a field fills `bg-3` and its hover is `bg-4`. Never a border or a call-site fill to make a field show.
- `Input`: `sm` `h-6 rounded-control-sm px-2 text-xs`, `default` `h-6.5 rounded-control px-2.5 text-xs`; `font-medium text-fg-4`, placeholder `text-fg-2`, disabled `text-fg-1 opacity-50`.
- A read-only `Input` swaps its role: a 1px `border-bg-4` edge and `text-fg-2`, so it reads as a value to copy rather than a field to type into.
- `Input loading` reserves the spinner's room (`pr-9`) and fades a spinner in at `right-3` (`sm` or `md` to match the field), so the field never changes width.
- `Textarea`: `field-sizing-content min-h-16 rounded-lg bg-input px-2.5 py-1.5 text-fg-4 text-xs`. A `max-h-*` caps it; it scrolls and fades inside, with the fade on the textarea itself so its edge stays solid.
- **Invalid** is a 1px `red-4` ring (`aria-invalid:ring-1 aria-invalid:ring-red-4`). `FieldError` (`role="alert"`, `text-red-text text-xs`) announces each distinct message once.
- Field layout: `Field` stacks label, control and hint 8px apart (`gap-2`); `FieldGroup` stacks fields 14px apart (`gap-3.5`); `FieldSet` 12px (`gap-3`); `FieldLegend` `mb-1.5 font-medium text-fg-4 leading-tighter`, `text-sm` (legend) or `text-xs` (label); `FieldDescription` `text-pretty text-fg-2 text-xs`; `FieldTitle` `font-medium text-xs`.
- A choice card is a `FieldLabel` holding a `Field`: `rounded-xl border border-bg-3`, `p-2.5` inside, checked `border-primary-a3 bg-primary-a1`.
- Search is one shape per context: a field with the search glyph as its leading affix, swapped for a `Spinner` while results load, `type="search"` with the native clear hidden. A popup's own search row stays the popup's input.
- A file field is a "Choose file" button plus the file's name, the browser's control hidden underneath as the labelled form control.
- Text sits on a normal line box: height comes from the box, never from a line-height equal to it (a full-height line-height paints a selection as a slab).

**Why.** A filled field reads as a field on any surface without a second edge; a ring for invalid is the only state a field shows.

**Do** leave a field's fill to the token. **Don't** add `border` to an `Input` to make it visible on a card.

**Example.** The Services popover's form: fields on `bg-3` inside the dark popover, measured `oklch(0.257 …)` against the popover's `oklch(0.228 …)`.

#### Selects and list popups

**Rules**

- `SelectTrigger` `default` is a form field (`before:bg-input`, hover and open `before:bg-input-hover/80`). `ghost` has no fill at rest and lays `before:bg-bg-a2/70` on hover, `before:bg-bg-a2` while open: for a picker in a toolbar, a shelf or any already-filled surface.
- Heights match the button's: `sm` `h-6 rounded-control-sm px-1.5 text-xs` (icon 14), `default` `h-6.5 rounded-control px-2.5 text-xs` (icon 16). Placeholder `text-fg-2`. The trigger ends in `IconChevronDownMedium`.
- The trigger opens on click (mouseup), not mousedown, so the press shows.
- **The popup opens over the trigger**, the selected item lined up on the trigger's value, like a native select (`alignItemWithTrigger`, the default). The item's text starts 12px in (list `p-1` + item `pl-2`) against the trigger's 10px, so the popup's edge lands 2px outside the trigger's. When it can't align, it drops below, 4px from the trigger, start-aligned.
- The popup: `rounded-popup`, `bg-popover`, edged by `shadow-md` (the hairline ring, never a `border` too), `min-w-(--anchor-width)` (the trigger's width is a floor; long rows grow it), `max-h-(--available-height)`, the list scrolling inside. It animates in only (150ms `ease-out`): beside the trigger it fades and grows from 95%; over the trigger it grows 0.975 to 1 in place with no fade. Closing is instant.
- Rows: `rounded-item py-1 pr-7 pl-2 font-medium text-fg-3 text-xs leading-4` (24px), highlighted text `text-fg-4`. The selected check is a **trailing** `IconCheckmark1` at `right-2`, `rotate-[4deg]`, `text-primary-text`, the one accent in the popup. Rows stay flush-left; never a leading check gutter.
- Group label: `select-none px-2 pt-1.5 pb-0.5 font-medium text-fg-2 text-xs`. Separator: `-mx-1 my-1 h-px bg-bg-3`, full bleed across the list's padding.
- A project picker shows the project's dot in a 14px box on every row (11.2, Menus, selects and project dots).
- **A picker with actions is a menu, not a select.** A select popup holds only options. When a choice also needs an action that isn't a value ("Folder by its path…", "Copy prompt"), it is a menu: the choices as radio items, a separator, then the actions as plain items. An action never changes the value. A control never shows a dropdown and a text field at once: a "type it in" action swaps the trigger for a field of the same size.
- Never pass a `min-w-*` to a popup (tailwind-merge lets it replace the anchor floor and the popup opens narrower than its trigger), and never force `w-(--anchor-width)` (it wraps rows that would fit).

**Why.** Over-the-trigger keeps the eye on the value being changed; a trailing check keeps every label on one edge.

**Do** use `SelectField` with items that carry a `dot` for a project picker. **Don't** hide the check with a CSS override, or pad a row taller at the call site.

**Example.** Settings → Agents → Models: each role's model select shows the display name ("Opus 5.5") from the first paint, opens over its trigger, and checks the current model at the row's right in blue.

#### Menus

**Rules**

- `DropdownMenuContent`: `rounded-popup bg-popover shadow-md`, `min-w-[max(8rem,var(--anchor-width))]`, `max-h-(--available-height)`, scrolling inside. It opens and closes with a fade, a zoom from 95% and an 8px slide from its side, over 200ms. Default placement `side='bottom' align='start'`, 4px offset.
- Rows share the select row: `rounded-item py-1 pl-2 pr-2 font-medium text-fg-3 text-xs leading-4` (24px), 14px icons 6px from the label (`gap-1.5`), highlighted text `text-fg-4`, the icon taking its row's ink (`icon-3`, `icon-4` when highlighted). The highlight is the shared sliding surface (`bg-bg-a2`), never a row wash.
- `destructive` items are `text-red-4/90`, `text-red-4` when highlighted, the highlight `bg-red-a2`, and the icon keeps the text's colour.
- Group label `px-2 pt-1.5 pb-0.5 font-medium text-fg-2 text-xs` (`pl-7` when inset to the icon column). Separator `-mx-1 my-1 h-px bg-bg-3`.
- Submenu trigger ends in `IconChevronRightMedium` (`ml-auto`) and stays bright (`text-fg-4`) while its submenu is open. A submenu opens to the right, anchored to its row.
- `DropdownMenuShortcut`: `ml-auto text-fg-2 text-xs tracking-widest`.
- **A boolean in a menu is a checkbox item**: a trailing `IconCheckmark1` in `text-primary-text` (`pr-7` reserves its column), never a switch drawn in the row. The row is the control.
- A list of destinations is a menu of real links (so ⌘-click and copy-link work), not rows hand-styled in a popover. An external link row ends with a 14px external-link icon.
- A menu that should stay open while the user ticks several items (Wait for another task) keeps itself open on click; every other item closes it.
- **Context menu** opens like a native one: its top-left corner at the pointer, growing down and right, flipping at the viewport edges. It reuses the menu's rows and popup.
- Real menus (priority, the task menu, Focus, the queue button) are click dropdowns. Something that only shows more on hover is an info popover, never a menu.

**Why.** A switch inside a row is a second thing to click; a check says on or off on the row that toggles it.

**Do** put Cancel task in the destructive item style at the end of the task menu. **Don't** draw a `Switch` inside a menu row.

**Example.** The Wait for another task submenu: open tasks with a trailing check on each one this task waits on, the ticked ones sorted first; a click ticks or unticks one and the menu stays open.

#### Command menu

**Rules**

- Opened by ⌘K (Ctrl K elsewhere) from anywhere, inputs included. It is one dialog (520px, `rounded-popup bg-popover p-0`) with no inner panels, coming and going in 75ms with its scrim in step.
- Groups have no separators and the menu has no footer.
- **Disabled always says why**: a command is disabled only with a reason string.
- The dialog's classes, the input row, the list, the rows, pages, ranking and disabled commands in full: 11.2, The command menu.

**Why.** It is opened many times an hour, so it never waits on a dialog's pace, and it adds no commands of its own: every row runs what a button on the page runs.

**Do** register a page's commands while it is mounted. **Don't** give the command menu a footer of hints.

**Example.** On a task page the task's decision leads (Approve the changes, disabled with "Send or clear your comments first" while line comments are drafted), then View, then This task, then Next and Previous task that needs you.

#### Popovers and info popovers

**Rules**

- `PopoverContent`: `flex w-64 flex-col gap-2 rounded-popup bg-popover p-2.5 text-xs shadow-md`, opening and closing with a fade, a zoom from 95% and an 8px slide over 200ms. A popover header is `flex flex-col text-xs`, its title `font-medium text-fg-4`, its description `text-pretty text-fg-2`.
- In light mode popovers sit on the page colour; in dark mode a step up on `bg-2`.
- **Anything that shows more on hover is an info popover**, built on the preview card: it opens on hover, a click does nothing to it, and it never toggles or sticks open. Its timings, popup and parts (header, section, `InfoRow`, action row) are in 11.2, Info popovers and label/value pairs; label and value pairs follow Label and value lists (below); a status its icon already says is not printed (11.2, Checkmarks).

**Why.** Hover detail that needs a click to dismiss gets in the way of reading the row under it.

**Do** show a pull request's checks in an info popover on the facts row. **Don't** make a hover card a click toggle, or a real menu a hover card.

**Example.** The pull request fact: hovering it opens an info popover with CI, unresolved comments and mergeable as rows, each check with its state, and a link to GitHub.

#### Tooltips

**Rules**

- A tooltip must add something the screen doesn't show. When one is allowed, what it says, its delay and where it opens are in 11.2 (Tooltips: when a tooltip is allowed, content, delay and mechanics, placement).
- Icon-only buttons whose meaning isn't plain from the glyph get a `Hint` whose label repeats the `aria-label`. A `Hint` with `shortcut` adds the key as one `Kbd` 4px after the label (`ms-1`, "Search and actions ⌘K"); with `detail` it stacks a muted second line (`TooltipLabel`, the tooltip `flex-col items-start gap-px`).
- **Every tooltip is delayed**: `TOOLTIP_DELAY` (600ms), and within `TOOLTIP_SKIP_DELAY` (400ms) of the last one the next opens at once with no entrance. Nothing else sets a delay.
- A tooltip is edged by a `border` (`border-border`), not the popup ring.
- **A tooltip opens over its text, never over the row.**

**Why.** A tooltip that opens the moment the pointer passes is noise; one that repeats the label is noise twice.

**Do** give the facts row's handle a `Hint` that flips "Copy the task’s handle" to "Copied". **Don't** wrap a whole row in a `TooltipTrigger`.

**Example.** Approve changes carries "Opens the pull request"; while line comments are drafted it is disabled and its tooltip reads "Send your line comments to the agent or remove them first".

#### Dialogs and confirmations

**Rules**

- `DialogContent`: centred on both axes (`top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`), `w-[min(26.25rem,calc(100vw-2rem))]` (420px), `max-h-[calc(100dvh-2rem)] overflow-y-auto`, `flex flex-col items-center gap-3 rounded-xl bg-background p-4 text-fg-3 shadow-md`. The width is fixed per size, never decided by content, so late content never changes it. Alert dialogs come in `default` (420px) and `sm` (`w-[min(20rem,calc(100vw-2rem))]`, 320px).
- Header: `flex w-full flex-col items-center gap-px text-center`. Title `text-balance text-center font-medium text-fg-4 text-sm leading-tighter`. Description `text-pretty text-center text-fg-2 text-xs`, links in it underlined (`underline-offset-3`) and brightening on hover.
- Footer: `flex w-full gap-2 *:flex-1`. The buttons share the width equally, Cancel or Keep it first (`secondary`), the action last.
- Close X: off by default (`showCloseButton`). When shown it is `Button variant='secondary' size='icon-sm'` at `absolute top-3 right-3`, `IconCrossMedium`, `aria-label='Close'`, no tooltip.
- Scrim: `bg-black/10`, `dark:bg-black/55`, never blur.
- Motion: in over 150ms `ease-out` from scale 0.96 and opacity 0, out over 100ms. A dialog mounted already open gets the same entry (`starting:`). Under reduced motion it keeps only the fade.
- **Confirmations are `ConfirmDialog`**: a title, a body saying what will happen, Keep it (`secondary`) and an action that repeats verb and object in `destructive`. The action closes the dialog, and the confirmed work runs once the close completes. Text stays held while it closes, so the dialog never changes as it fades.
- A dialog that closes without a visible change holds its text through the exit (`useHeldValue`).

**Why.** A short, centred, equal-width pair reads as one decision; a fixed width keeps late-loading content from resizing the box under the pointer.

**Do** write the action as verb and object ("Cancel task"). **Don't** label it "OK" or "Yes".

**Example.** Cancel task opens `ConfirmDialog`: title "Cancel this task?", a body naming what stops, Keep it on the left and Cancel task in red on the right, equal widths.

#### Sheets

**Rules**

- `SheetContent` slides from its `side` (default `right`): `bg-background bg-clip-padding text-fg-3 text-xs shadow-lg`, `flex flex-col gap-3`, the far corners `rounded-l-3xl` (right), `rounded-r-3xl` (left), `rounded-t-3xl` (bottom), `rounded-b-3xl` (top). Side sheets are `w-3/4 sm:max-w-sm` (384px) and full height; top and bottom sheets `max-h-[85dvh]`.
- Slide: `translate` over 200ms `ease-out`, from fully off-screen. Scrim as a dialog's, fading over 150ms.
- Header `flex shrink-0 flex-col p-3` (`pr-12` when the close X shows), title `font-medium text-fg-4 text-sm`, description `text-pretty text-fg-2 text-xs`. Body `min-h-0 flex-1 overflow-y-auto px-3`. Footer `mt-auto flex shrink-0 flex-col gap-1.5 p-3`.
- The close X shows by default, the same button as the dialog's, no tooltip.
- Below `md` the Shelf layout's rail opens as a left sheet.

**Why.** A sheet is read beside the page, so it keeps the page in view and slides rather than pops.

**Do** use a sheet for a long form the user reads beside the page. **Don't** use one for a two-field confirm.

**Example.** In the Shelf layout below 768px the task rail opens as a sheet from the left, closing on a choice.

#### Toasts

**Rules**

- Top centre, 12px from the top (`position='top-center'`, `offset={{ top: 12 }}`), 8px apart, over the empty middle of the top bar.
- A compact single line: `width: fit-content`, `max-width: 420px`, `min-height: 34px`, `padding: 6px 10px`, `gap: 8px`, `border-radius: var(--radius-popup)`, `border: 1px solid var(--bg-3)`, no shadow, `bg-popover`, 13px medium. With a description it pads 10px all round, the description `color: var(--fg-2)`, `font-size: var(--text-2xs)`, `line-height: 1.2`, 6px under the title. With an action the end padding drops to 5px (10px with a description).
- Icons are 16px: success `IconCheckCircle2Filled` and info `IconInfoSimple` in the accent (`text-primary-4`), warning `IconExclamationTriangleFilled` in `text-amber-4`, error `IconExclamationCircleFilled` in `text-red-4`, loading a `Spinner` in `text-fg-2`. The type sets only the icon; the surface stays neutral.
- Action: `h-6 rounded-control-sm bg-primary px-2.5 font-medium text-primary-foreground text-xs`; cancel `h-6 rounded-control-sm bg-bg-a2 px-2.5 font-medium text-fg-3 text-xs`.
- A repeat of an identical toast (same kind and text) does not stack: the existing one bumps (scale 1.015 over 300ms `ease-out`) for success and info, or shakes (±2px over 350ms) for warning and error.
- A loading toast turns into its result in place: the spinner shrinks away to 0.85 as the result icon scales in from 0.85 over 240ms.
- **Every copy says "Copied"** in a toast, and "Couldn’t copy to the clipboard" when the browser refuses. A failure toast is "Couldn’t {verb} {object}".
- Toasts are the only times without a tooltip.

**Why.** Acting never moves the user, so the toast is the confirmation; a compact line in the top bar's empty middle covers nothing the user is working on.

**Do** confirm an approve with a toast and stay on the task. **Don't** navigate away after an action to show it worked.

**Example.** Copying a task's handle from the facts row toasts "Copied" with the accent check.

#### Empty states

**Rules**

- An empty region is `EmptyState`: `flex flex-1 flex-col items-center justify-center text-center`, `gap-2.5 p-8` (default) or `gap-2 p-6` (`sm`).
- Figure: a `rounded-lg bg-bg-2` tile, `size-9` (36px; `size-8` at `sm`), edged `shadow-[inset_0_0_0_1px_var(--bg-4)]`, the glyph `lg` 20px (`md` 16 at `sm`) in `text-fg-3`, flanked by two copies of the tile behind it, scaled 0.88, rotated ∓12° about their bottom corners and offset 6px out, each `bg-bg-2` with a `bg-3` inset edge. 4px under the figure (`mb-1`; 2px, `mb-0.5`, at `sm`).
- Text: title `text-balance font-medium text-fg-4 leading-tighter`, `text-sm` (`text-xs` at `sm`), over the description `max-w-md text-pretty text-fg-2 text-xs`, `gap-px`.
- Actions are `children`, under the text. The one call to action is the right-most button; a secondary action sits on its left on the same row.
- A truly empty list's create action moves into its empty state (Where actions go, above). An empty line inside a list card is a single `p-2.5` line ("No repositories or folders yet."), not a full empty state.
- **No results** (a search or filter that matched nothing) says so in one place: "No {noun} match “{query}”" with Clear search, or "No {noun} match your filters" with Clear filters, a `secondary` `sm` button.
- An empty body in a table keeps the header row (Tables, above).

**Why.** A blank card reads as broken; the figure says "nothing here yet" before the words do.

**Do** use the `sm` size inside a narrow card. **Don't** hand-compose an empty state with a search glyph and a muted line.

**Example.** The error fallback's page look is `EmptyState` with `IconExclamationTriangle`, the title, the line under it, then Try again (primary `sm`), Reload and Copy details (`secondary` `sm`).

#### Loading

**Rules**

- **No loading state in normal use.** Whatever a click shows is already on the page: rendered ahead, read ahead on hover (40ms) or highlight, or the last answer kept while a newer one loads. A spinner or skeleton is a design bug unless the work could not be foreseen.
- **A wait shows only after 300ms** (`LOADING_DELAY_MS`): the place stays empty, then shows the spinner and its line, so a fast read never flashes one.
- A busy button is `loading`, never a hand-swapped spinner. A field that is busy is `Input loading`.
- The live agent's shimmering line and an update's toast report work being done, not a read, and are not loading states.
- Placeholders keep the geometry they stand in for: a text placeholder is a bar inside a box of its line's height, never a bare bar that collapses the line.
- Never `animate-pulse` on a placeholder; a looping placeholder opts out under reduced motion (`motion-reduce:animate-none`).

**Why.** A native app shows the next view in the next frame; a skeleton that flashes for 50ms reads as jank.

**Do** read a task's Code tab data on hover. **Don't** show a spinner the moment a read starts.

**Example.** Opening a file nothing pointed at in the Code tab: the pane stays empty for 300ms, then shows `CodeLoading` with its line.

#### Errors in place

**Rules**

- A render error stays where it happened: every region that reads live state sits in an error boundary of its size, in layers.
- Three looks, one owner (`ErrorFallback`):
  - **page**: `EmptyState` with `IconExclamationTriangle`, title, line, the error's message in a bordered mono block (`rounded-lg border-border bg-bg-2 text-2xs`, at most 128px tall, scrolling), Try again (primary `sm`), Reload and Copy details (`secondary` `sm`).
  - **inline**: a `CARD` (`p-3`) with a 14px orange warning icon and "This part of Shinsa hit an error." (`font-medium text-fg-4 text-xs`), the same block and buttons at `xs`.
  - **icon**: keeps a trigger's place as a `secondary icon-sm` button with the orange warning icon; its tooltip is the title over the message; a press opens the inline content in a popover.
- A field error is `FieldError` under its field. A section that failed to load shows an error state in place of its content, never a line of red text.

**Why.** Without a boundary, one broken widget blanks the whole window.

**Do** give a new top-level region a boundary of the right size. **Don't** let a widget's error take down the page around it.

**Example.** The Services menu in the top bar renders the icon fallback when it throws; the rest of the bar keeps working.

#### Truncation

**Rules**

- Text that comes from data and can be cut off (titles in every row, previews, repository names and paths, branch and file paths, check names, tool targets, run headlines, attachment names, captions) is `Truncate`: one line by default, an ellipsis, and the full text in a tooltip only when it is actually clipped. The tooltip wraps at 288px.
- The parent must bound the width (`min-w-0`).
- `middle` cuts in the centre for identifiers (plain-string children only).
- A heading keeps its element and wraps the text: `<h2 className="min-w-0"><Truncate>…</Truncate></h2>`.
- Inside a stretched link (a title whose `::after` covers its row), lift the text above the overlay (`<Truncate className="relative z-1">`) so the tooltip sees the pointer.
- Two places keep a plain `truncate`: text that is already a tooltip, popover or menu trigger (two overlays would stack), and rows that follow the pointer and can't be hovered.

**Why.** An ellipsis with no way to read the rest hides data; a tooltip on text that fits is noise.

**Do** wrap a task title in a row in `Truncate`. **Don't** add a `truncate` span with a `title` attribute.

**Example.** A branch path in the facts row is a menu trigger, so it keeps a plain `truncate`; the same branch in a roadmap row is `Truncate`.

#### Times

**Rules**

- Every time goes through one component: `TimeAgo` ("2h ago"; `compact` for the bare "2h" a row ends with; `text` for a phrase around the age such as "Started 2h ago", re-rendered each minute) or `Duration` ("Worked for 3m", a live running clock).
- Each renders a `<time dateTime=ISO class='cursor-default'>` whose tooltip shows the exact moment, the date bright and the clock muted ("Wed, Oct 22, 2026 2:14 PM"); a duration shows "2:14 PM to 2:17 PM" ("Since 2:14 PM" while it runs), with "to", "Since" and the day muted. `detail` adds a muted second line naming what the time is when the row doesn't say it ("Waiting on you", "Step started", "Finished", "Last message").
- Times are `tabular-nums`. Toasts are the only times without a tooltip.
- A bare `formatAge(…)` or `formatDuration(…)` in JSX is a bug, and the lint rejects it.

**Why.** "2h ago" is enough to scan; the exact moment is one hover away when it matters.

**Do** end a list row with `<TimeAgo compact />`. **Don't** print a formatted age string by hand.

**Example.** A queue row ends in "12m"; hovering it shows "Tue, Oct 27, 2026 9:41 AM" over "Waiting on you".

#### Copy

**Rules**

- One interaction: a copy trigger names what it copies in its tooltip ("Copy the task’s handle", "Copy the full commit" with the sha as its detail line), flips to "Copied" in place while it is open, swaps its glyph for a check, and toasts "Copied", or "Couldn’t copy to the clipboard" when the browser refuses. One helper writes the clipboard and shows the toast; nothing calls `navigator.clipboard` directly.
- The copy glyph takes the trigger's own ink. The check is the accent (checkmarks are the accent everywhere), except inside a filled primary button, where it keeps the label's white.
- The glyph swap: the outgoing glyph to scale 0.65, opacity 0 and a 2px blur, the incoming one back from the same, over 200ms on `cubic-bezier(0.2, 0, 0, 1)` (`transition-[opacity,scale,filter]`); both glyphs share one grid cell. The check holds 1.5s.
- A copy button in a code block's corner or a field's end is `icon-xs`; in nested UI `icon-sm`; a copy button on an inset or shelf is always `secondary`.
- A hover-revealed copy is the last thing on its line.

**Why.** One feedback everywhere means the user never wonders whether a copy landed.

**Do** route every copy through the shared helper. **Don't** show a success state without the toast, or recolour the check at a call site.

**Example.** A shell code block's corner holds Copy (`icon-xs`) and, for a runnable command, Run in terminal beside it.

#### Keycaps

**Rules**

- `Kbd`: `pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-bg-2 px-1 font-medium font-sans text-fg-2 text-xs` (20px; a single glyph is a 20px square, word keys grow). Icons inside at 14px.
- In a tooltip the keycap is `h-4 rounded-sm bg-bg-a2 text-fg-3`.
- In a row of shortcuts a chord is one `Kbd` per key inside a `KbdGroup` (`inline-flex items-center gap-1`). A `Hint`'s `shortcut` is the exception: it renders one `Kbd` holding the whole chord ("⌘K").
- A keycap annotates a label, so it stays smaller and quieter than the line it sits on.

**Why.** Equal-sized caps line up in a row of shortcuts whatever the glyph's width.

**Do** pass `shortcut` to a `Hint`. **Don't** type a shortcut into a tooltip's text.

**Example.** The Search and actions button's tooltip ends in a ⌘K keycap.

#### Disclosures and folding headers

**Rules**

- The whole header is the trigger (`DisclosureHeader`, with its controls in `DisclosureAction`). Its two shapes, its heights (`strip`), its chevrons (`chevron`) and the derived end inset are in 11.2, Collapsible headers.
- A chevron turns over 150ms (`transition-[rotate] duration-150`); its colour follows the header at once.
- **Every collapsible remembers whether it is open** across refreshes and visits (`useDisclosure(persistId, defaultOpen)`), read synchronously on the first render so nothing is drawn open and then snapped shut, and nothing animates on load. Ids are built from what the collapsible shows, never an array index. A fold that should be forgotten says why (`notPersisted('…')`).
- A one-way "Show more" on a long block is a reveal, not a fold.

**Why.** A tiny chevron as the only target makes the user aim; a fold that forgets makes them redo it on every visit.

**Do** pass a `persistId` like `task:<taskId>:overview:panel:<panel>`. **Don't** keep fold state in `useState`.

**Example.** The Overview's What changed panel: the 36px band folds from a click anywhere, "Read the review" stays in the header when closed, and the 22px chevron box sits 7px from the end.

#### Edge fades and scrolling

**Rules**

- Scrollbars are hidden app-wide. Long panes that scroll in a `ScrollArea` (the task chat) draw a thin overlay thumb (11.2, Overlay scrollbar).
- **Anything that scrolls inside a component fades at the edge it can scroll toward**: the 24px `scroll-fade` mask (its CSS, its still wrapper and `PageScroll` are in 11.2, Page scroll and edge fades). It is on menus, select and command lists, popovers, `ScrollArea`, code blocks, toolbars, tab strips and any fixed-height scroller in a page.
- **A fade is a mask, so it never goes on a bordered element.** Put the edge and fill on a frame and the overflow and fade on an inner element.
- A scroller fades the axis its content overflows (a `wrap="off"` textarea fades sideways).
- A vertical mouse wheel scrolls a short sideways row (a tab strip, a toolbar, a chip row, no taller than 96px) and hands the wheel back to the page at the row's end.
- Dialogs scroll inside the content, never by putting `overflow-y-auto` on a frame that also draws the edge.

**Why.** With scrollbars hidden, the fade is the only sign there is more; a mask needs no colour, so it works on every surface.

**Do** wrap a capped list in frame, then scroller. **Don't** put `scroll-fade` on an element with a border.

**Example.** The task chat: its `ScrollArea` fades content under the header at the top and into the composer at the bottom, and the composer draws no gradient of its own.

#### Tab bars and segmented controls

**Rules**

- Every row of tabs is the kit's `Tabs`, or `Choice` for a labelled switch. Never `role="tab"` written by hand.
- `default` (segmented): `rounded-control bg-bg-2 p-0.5 h-6.5 gap-1` (26px track), tabs `h-full rounded-segment px-2 font-medium text-fg-2 text-xs`, hover and selected `text-fg-4`, icons 16px. The selected pill is a sliding indicator, `rounded-segment bg-background shadow-1`, `dark:bg-bg-4`. The track carries the fill and no edge.
- `ghost`: bare text tabs, `h-6.5 gap-3`, no indicator; the tab's content takes the press (scale 0.975).
- `underline`: `h-8 gap-1` (32px), tabs `px-2 font-normal`, the selected one `faux-medium` so it reads medium without changing width, under a 2px `bg-primary` line that slides. **An underline list only sits on a rule** (a header strip, a frame's top edge). A switcher floating in content is the segmented list.
- The pill and the line slide on the movement clock (200ms `cubic-bezier(0.22, 1, 0.36, 1)`); the tab colours change at once.
- A `Choice` item may carry a `hint` (shown as its tooltip) and `checked` (a 14px accent check before the label).
- A short, fixed tab set may fold into a select on a narrow window; tabs that grow with the data get a strip of their own.
- The current tab of a navigation set with icons swaps to the icon's filled twin.

**Why.** One tab control keeps the slide, the press and the selected look the same everywhere, and a tab bar under the heading is Shinsa's only in-page navigation.

**Do** use the segmented `Choice` for the task tabs and Settings' tabs. **Don't** float an underline list in the middle of a card body.

**Example.** The task page's tabs (Overview, Review, Code, Chat) are the segmented `Choice` at the end of the heading row.

#### Charts and figures (generic rules)

Shinsa has no charts page; these rules hold wherever a figure or a trend is drawn (a usage bar, a context meter, a coverage figure).

**Rules**

- A series' colour says what the metric means, fixed, never by position and never by how the period went. The chart's first series is the accent.
- A trend's polarity follows its meaning: for a loss metric a rise is the negative delta.
- A value that doesn't fit abbreviates before it shrinks, trying the most precise compact form first (`134,612,000` to `134.6M`); an abbreviated value shows the exact figure in a tooltip, an exact one has none.
- A figure in a row is the row's own text size, never a stat-tile figure.
- Lay a sparkline out in measured pixels, never a stretched viewBox, so dots stay circles. Missing buckets are bridged, never drawn through a fabricated zero; a series longer than 32 buckets averages down to 32. A smooth curve is monotone (it never overshoots a bucket).
- Numbers are `tabular-nums`.
- A loading figure draws the shape it replaces, in the placeholder tint.

**Why.** A colour that tracks meaning is learnt once; one that tracks position or mood has to be read every time.

**Do** keep usage in one hue whatever its level. **Don't** turn a line red because the period went down.

**Example.** Agent usage's bars and figures read the same tone for the same limit on every account, the figures in `tabular-nums`.

#### Mode and environment markers

**Rules**

- A setting that changes what every number or list on screen means is flagged once, in the chrome, in the same place on every page, never as a per-page banner each page has to remember.
- The default state shows nothing; only the non-default state gets a marker.
- The marker reads the same state the picker writes, so the two can never disagree. The picker stays where it is.
- The marker's explanation is its tooltip.

**Why.** A per-page banner gets forgotten on the next page; a marker in the chrome is always in the same place.

**Do** show the focus project's dot in the top bar's Focus control. **Don't** add a "You’re viewing project X" banner to each list.

**Example.** Focus: the top bar's Focus control carries the focus project's colour dot, and every list (the queue, ⌘K's Recent, the compact queue) is scoped to it; "All work" is the neutral state.

#### Highlights slide

**Rules**

- Every list of rows you pick from shares one highlight surface (`HighlightList` for primitive rows marked `data-highlighted`, `HoverHighlight` for rows marked `data-highlight-item` resting on `data-active="true"`). It slides to the hovered or keyboard row; its classes and timing are in 11.2, Sliding highlight.
- It slides in menus, selects, the command menu, Go to file, the rail, the queue, Home's lists, setup's option lists and the rows inside info popovers.
- Instant on purpose: the Code tab's file tree, changes tree and search results, and single controls that are not rows.
- A row only changes its text colour, and does it in the frame it happens.

**Why.** One surface moving reads as one cursor; a wash per row flickers.

**Do** mark a row you pick from `data-highlight-item`. **Don't** give a menu item a `hover:bg-*`.

**Example.** Moving the arrow keys in ⌘K slides one `bg-bg-a2` pill from row to row, and entering a page restores the scroll and slides from where it was.

#### Label and value lists

**Rules**

- Key and value facts are label left, value right, in popovers and tooltips alike: `justify-between gap-4` (16px at least between them), the label in the row's quieter ink, the value `tabular-nums` (identifiers are data). Never a value run on after its label.
- An empty value is a word that says why, in the muted ink ("Not configured", "Unknown"), never a dash: an em dash never appears in a UI string.
- Facts joined on one line use " · " with the separator muted; a missing fact never leaves a doubled or dangling dot.
- A fact that opens something turns `text-fg-4` on hover; a status glyph or a warning note keeps its own colour while the words around it stay `fg-2`.

**Why.** Labels on one column and values on the other let the eye run down either.

**Do** use `InfoRow` in a popover. **Don't** run a value on after its label with a space.

**Example.** The task facts row: handle, status, repository, branch, priority and times, each `text-xs text-fg-2`, wrapping as one quiet row under the heading.

#### Text links

**Rules**

- A link that reads as text is underlined and turns bright on hover; a `Button variant='link'` (`text-primary-text`, no box) is the same look among controls.
- A link that is its row's title keeps the title's ink and weight and underlines only on hover.
- An external link opens a new tab (`target='_blank'`) with `rel='noreferrer'`, which also implies `noopener`.
- Never hand-style a link with colour classes at the call site.

**Why.** One link look means the user never has to guess which blue text is clickable.

**Do** use the link button for "Read the review". **Don't** write `text-primary hover:underline` on an anchor.

**Example.** A dialog description's links are underlined (`underline-offset-3`) and brighten to `text-fg-4` on hover.

### 11.2 Lists, tooltips, the transcript and the command menu

These patterns are Shinsa's own and win over any general rule elsewhere in this file. Each one gives the rule, the exact values, the reason, what to do and avoid, and one example from Shinsa. Sizes assume the kit's type scale: `text-2xs` is 12px (line height 1.25), `text-xs` is 13px (line height 1.2, the body size), `text-sm` 14px, `text-base` 16px. Spacing is Tailwind's 4px unit (`gap-1.25` is 5px, `ps-3.25` is 13px).

#### Consistency comes from shared pieces

- Every recurring look has exactly one owner: a constant (class string) or a component. A hand-built copy of something a shared piece already draws is a bug, even when it looks identical today.
- Values in this section were measured in the browser at 900px and 1280px wide, in both themes. When you build a screen, measure the same way.
- Shared class-string constants used throughout this section:

| Constant | Classes |
| --- | --- |
| `CARD` | `corner-superellipse/1.125 rounded-xl border border-border bg-card` |
| `INSET` | `corner-superellipse/1.125 rounded-lg border border-border` (fill added on top) |
| `ICON_SLOT` | `grid size-5 shrink-0 place-items-center` |
| `ICON_SLOT_GAP` | `gap-1.25` |
| `CARD_HEADER` | `flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 font-medium text-fg-4 text-xs` |
| `CARD_FOOTER` | `border-border border-t bg-bg-a1 px-3 py-2.5` |
| `CARD_INSET` | `px-3` |
| `CHIP` | `corner-superellipse/1.125 w-fit rounded-control-sm bg-bg-a2 px-1 py-px text-fg-3` |
| `PAGE_COLUMN` | `mx-auto w-full max-w-3xl px-6` |
| `PAGE_TOP` | `pt-6` |
| `CARDS_FRAME` | `mx-auto w-full max-w-[90rem] px-3 sm:px-5` |
| `PAGE_TITLE` | `text-balance font-medium text-base text-fg-4 leading-tight` |
| `PAGE_DESCRIPTION` | `max-w-2xl text-pretty text-fg-2 text-xs` |
| `COMPOSER_FIELD` | `field-sizing-content w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-fg-4 text-xs outline-none placeholder:text-fg-2` |
| `COMPOSER_FOOTER` | `flex items-center gap-2 p-1.5` |

Example: the Home section card, the Overview panel, the chat's hand-over card and the live card all use `CARD`; none writes its own `rounded-xl border`.

#### Two layouts, one frame

- The app has two layouts, chosen in Settings, both rendered by one frame around one `main`. Switching adds or removes the top bar and the side rail; it never remounts the pages inside, so scroll and state survive.
- Each layout has a display name, a one-line hint and an icon, kept in one constant. Code, URL params and docs keep the internal ids (`cards`, `sidebar`); the screen shows the names. Renaming is a one-constant change.
  - Desk (`cards`, the default): "Pages sit centred with nothing at the sides, and a button at the top opens what needs you."
  - Shelf (`sidebar`): "A rail at the side lists every task and stays open, so each one is a click away."
  - The hint shows as the tooltip of each layout's option in Settings and as the hint of the command menu's Switch layout.
- Desk: no rail. A top bar holds navigation at the left (logo, Home button in the Mac app, Tasks, Services, then the "3 need you" queue button) and Update, Settings, Agent usage and Focus at the right. Pages are centred on the same axis as Home. The queue button sits after Services so that nothing on the right moves when it appears or disappears; it shows on every task page at every width and is Desk's only queue outside Home.
- Shelf: a permanent rail with the queue that never hides. From `md` (768px) up it sits beside the page; below 768px it opens as a sheet. Its nav names the same places in the same words as Desk's bar (New task, Tasks, Services, Settings), each showing its filled icon on its own page.
- Nav buttons: `Button` `variant='secondary'`, `size='sm'` with icon and label, or `size='icon-sm'` with the icon alone (Settings: the cog only, tooltip "Settings"). Inactive `text-fg-3`; on its own page `text-fg-4`, the filled twin of the icon, and `aria-current="page"`.
- The queue button is a `sm` secondary button at rest in `fg-3`, one step brighter than a muted control (`fg-2`).
- No rail of any kind beside the content column, however wide the window (Page layout, in 11.1).

Example: on a task page in Desk, the "3 need you" button sits top left after Services and opens the compact queue in a popover with the current task highlighted.

#### Matched icon sizes in a bar

- Icons in one bar draw at one optical size: each icon is scaled about its centre (stroke divided by the same factor, so weight is kept) until its ink, stroke included, is as tall as the reference icon's ink (20 of 24 units). If that would bring the ink within 0.5 unit of the box's sides (where the svg clips), it scales only as far as that allows. A filled twin takes its outline's scale.
- Wide or dotted glyphs are set by eye under the reference, since at full height they read too large: Home at 1.025 and Tasks' bulleted list at 1.15 (inks 10.79px and 10.06px tall against the gauge's 11.67px).
- Measured at 14px, ink box width x height (before then after, scale): Home 10.50 x 10.53 then 10.76 x 10.79 (1.025); Tasks (bulleted list) 10.50 x 8.75 then 12.08 x 10.06 (1.15); Services (server) 11.67 x 9.33 then 13.24 x 10.56 (1.15, its width at the box edge); Settings (gear) 12.86 x 11.67 (1.1132); Agent usage (gauge) 11.67 x 11.67, the unscaled reference.
- Marks that are not places are left out of the matched set: the queue button's inbox icon (12.83 x 9.33) is a labelled count, Focus's project dot (8 x 8) is a colour.
- The scale lives with the icon, never at the call site, so it applies everywhere the icon draws.

Example: the gear beside the Agent usage gauge draws exactly as tall as the gauge.

#### One page column and one left edge

- Page content sits in `PAGE_COLUMN` (`max-w-3xl`, 768px, centred, `px-6`) with `PAGE_TOP` (`pt-6`). Home, Settings, All tasks and the task page share the same centre axis.
- A page's title, its tab row and its content start on the same left edge at every width and on every tab. Switching tabs never moves the heading. When a page has a full-width header strip (the task page in Shelf), compute the header's start padding from the centred column instead of placing it differently.
- `CARDS_FRAME` (`max-w-[90rem]`, `px-3`, `sm:px-5`) is not a page column: it is the Desk top bar's inner frame (`CARDS_FRAME` plus `flex h-11 items-center gap-1`), 1440px at most.
- No details side panel: what it would hold becomes one wrapped facts row under the heading (see Facts row).

Example: on a task, the title, the tab labels (Overview, Review, Code, Chat) in their 36px row, and the Overview cards all start at the same x; switching to Code does not shift the title.

#### Page headings

- One heading component for every page: the title `PAGE_TITLE` (`text-base` 16px, medium, `fg-4`, `leading-tight`, a 20px line), the description or count under it `PAGE_DESCRIPTION` (`text-xs` `fg-2`), `gap-px` between, in `flex min-w-0 flex-col`, flush with the column's left edge.
- A long description clamps to two lines and expands on click.
- The heading is the open view's name, never the app area's name: Settings' heading reads "General" or "Agents", never "Settings".
- The page's tabs are the segmented `Choice` under the heading at every width; switching keeps the heading and tab bar still and swaps only the pane under them. The tab is in the URL.
- A header carries no generic decision action: an action whose label cannot say what it decides ("Approve") does not belong in a header. Put it next to the thing it decides on.
- A card never repeats its page's name (Cards, in 11.1).

Example: the task page heading is the task title over its request in `text-xs fg-2`, two lines at most, with the tabs at the end of the row.

#### Page scroll and edge fades

- Every page whose body scrolls under a header scrolls in a `ScrollArea` with the fade on (`PageScroll`: `min-h-0 flex-1`). Long panes (chats) keep their own `ScrollArea`, fade on, so content fades under the header at the top and into the composer at the bottom. The composer draws no gradient of its own.
- There is one fade: a CSS mask (`scroll-fade`), 24px (`--fade-size: 1.5rem`) at each edge that still hides content. Never a gradient overlay: an overlay must guess the surface behind it and eats card borders; a mask needs no colour and works on any surface.
- Scrolling never repaints the fade: the mask sits on a still wrapper (`data-fade-scope`) around the scroller (`scroll-fade-source`), so the mask paints once and content scrolls under it on the compositor.
- A fade is right on the first painted frame: the scroll position drives it through a scroll timeline, each edge's fade growing over the first 24px of travel toward that edge, decided by CSS alone, never by a measure, an observer or a transition after render. Timeline names are unique per instance so a nested scroller never answers for its parent.
- Fallback (no scroll timelines, or a clipping element that does not scroll): `data-overflow-y-start`, `data-overflow-y-end`, `data-overflow-x-start`, `data-overflow-x-end` set the fade, with a 150ms `ease` transition. An edge counts as overflowing when `scrollTop > 0` (start) or `ceil(scrollTop + clientHeight) < scrollHeight` (end).

```css
@property --fade-t { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-b { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-l { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-r { syntax: "<length>"; inherits: false; initial-value: 0px; }

@utility scroll-fade {
  --fade-size: 1.5rem;
  --fade-timeline-y: --scroll-fade-y;
  --fade-timeline-x: --scroll-fade-x;
  mask-image:
    linear-gradient(to bottom, transparent, oklch(0 0 0) var(--fade-t),
      oklch(0 0 0) calc(100% - var(--fade-b)), transparent),
    linear-gradient(to right, transparent, oklch(0 0 0) var(--fade-l),
      oklch(0 0 0) calc(100% - var(--fade-r)), transparent);
  mask-composite: intersect;
  transition: --fade-t 150ms ease, --fade-b 150ms ease, --fade-l 150ms ease, --fade-r 150ms ease;
  &[data-overflow-y-start] { --fade-t: var(--fade-size); }
  &[data-overflow-y-end] { --fade-b: var(--fade-size); }
  &[data-overflow-x-start] { --fade-l: var(--fade-size); }
  &[data-overflow-x-end] { --fade-r: var(--fade-size); }

  @supports (animation-timeline: scroll()) {
    transition: none;
    animation: scroll-fade-t linear both, scroll-fade-b linear both;
    animation-timeline: var(--fade-timeline-y), var(--fade-timeline-y);
    animation-range: 0 var(--fade-size), calc(100% - var(--fade-size)) 100%;
    &[data-fade-orientation="horizontal"] {
      animation: scroll-fade-l linear both, scroll-fade-r linear both;
      animation-timeline: var(--fade-timeline-x), var(--fade-timeline-x);
      animation-range: 0 var(--fade-size), calc(100% - var(--fade-size)) 100%;
    }
    &[data-fade-orientation="both"] {
      animation: scroll-fade-t linear both, scroll-fade-b linear both,
        scroll-fade-l linear both, scroll-fade-r linear both;
      animation-timeline: var(--fade-timeline-y), var(--fade-timeline-y),
        var(--fade-timeline-x), var(--fade-timeline-x);
      animation-range: 0 var(--fade-size), calc(100% - var(--fade-size)) 100%,
        0 var(--fade-size), calc(100% - var(--fade-size)) 100%;
    }
    scroll-timeline: var(--fade-timeline-y) block, var(--fade-timeline-x) inline;
    &[data-fade-scope] {
      scroll-timeline: none;
      timeline-scope: var(--fade-timeline-y), var(--fade-timeline-x);
    }
  }
}

@utility scroll-fade-source {
  scroll-timeline: var(--fade-timeline-y) block, var(--fade-timeline-x) inline;
}

@keyframes scroll-fade-t { from { --fade-t: 0px; } to { --fade-t: var(--fade-size); } }
@keyframes scroll-fade-b { from { --fade-b: var(--fade-size); } to { --fade-b: 0px; } }
@keyframes scroll-fade-l { from { --fade-l: 0px; } to { --fade-l: var(--fade-size); } }
@keyframes scroll-fade-r { from { --fade-r: var(--fade-size); } to { --fade-r: 0px; } }
```

Structure (unique timeline names per instance, set as inline style on the wrapper, e.g. `--fade-timeline-y: --fade-y<id>`):

```tsx
<div data-slot='scroll-area' className='relative overflow-hidden min-h-0 flex-1'>
  <div data-fade-scope style={timelines} className='size-full rounded-[inherit] scroll-fade'>
    <div className='size-full overflow-y-auto overflow-x-hidden rounded-[inherit] outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden scroll-fade-source'>
      {children}
    </div>
  </div>
  {/* overlay scrollbar, next pattern */}
</div>
```

Example: on Home, the greeting and sections fade out over 24px as they pass under the top bar; at rest at the top there is no fade at all.

#### Overlay scrollbar

- Long panes (the task chat) get a thin overlay thumb; native wheel, trackpad and keyboard scrolling are untouched and the native scrollbar is hidden. Other scrollers keep scrollbars hidden entirely.
- Track: `absolute inset-y-0 right-0 z-20 w-3 py-1 pr-0.75 pl-1`, `opacity-0`, shown (`opacity-100`) while scrolling, on hover and while dragging; it fades in over 200ms with no delay and fades out over 200ms after a 300ms delay. Scrolling keeps it visible for 700ms after the last scroll event. Under the pointer the track's left padding drops to `pl-0.5`, widening the thumb from 4px to 6px.
- Thumb: `w-full rounded-full bg-fg-a1`, `opacity-60` at rest, `opacity-100` when the track is hovered, pressed or dragged, `transition-opacity duration-150`. Length is the visible share of the content, at least 24px, travelling the track inset 4px at both ends. It is draggable; a press on the bare track scrolls (smoothly) so the thumb centres on the pointer, clamped to the ends.
- Hidden (`data-hidden`) when nothing scrolls (scrollable distance of 1px or less).

Example: in a long task chat, a 4px grey thumb appears at the right edge while you scroll and is gone 0.7s after you stop.

#### Section labels and section rhythm

- A canvas section is a `SectionLabel` 4px over its card: `h-6` (24px) row, `flex shrink-0 items-center gap-1.5 font-medium text-2xs text-fg-2 leading-4` (a 16px line), the count after the title in `font-normal text-fg-2 tabular-nums`, 6px apart (`gap-1.5`). Home passes `px-1` so the label sits 4px in from the card's edge.
- An optional action sits at the right end (`ms-auto`/spacer). Several action buttons in it sit 2px apart (`flex shrink-0 items-center gap-0.5`); this is the one 2px gap in the app and the section label owns it, so callers pass the buttons as a fragment.
- Foldable sections: the whole header is one button (label, count, then a 14px chevron right after the count, rotated `-90deg` when closed, `transition-[rotate] duration-150`), `aria-expanded`, `hover:text-fg-4 active:text-fg-4`. The empty rest of the row folds it too. Settings keeps the plain, non-folding label.
- Rhythm: sections stack with `gap-6` (24px), on every page. A folded section is just its 24px header whose 16px title keeps 4px under it, so an open section adds the same 4px under its card (`pb-1`). From a folded title, or an open card's bottom, to the next title is always 32px, in every combination; folding never changes the rhythm.
- Every section folds, starts open until you fold it, and remembers the choice per section in `localStorage` (a key like `home:section:<section>`).

Example: on Home, "In progress 3" is a 12px medium grey label with a lighter count; clicking anywhere on that row folds its card, and the next label stays exactly 32px below.

#### Collapsible headers

- Every collapsible header folds from a click anywhere on it: panels, snippets, the live card's row, delegation cards, round rows, Home's sections, compact queue sections, roadmap groups, settings blocks.
- Header with nothing interactive inside: one `<button>` with `aria-expanded` (inside its `h2` or `figcaption` when it has one), `group/disclosure flex min-w-0 cursor-pointer select-none items-center text-left outline-none`, `w-full` when wrapped.
- Header with its own controls (a link, Stop, a select): the click handler sits on the header element itself; its controls are wrapped in `DisclosureAction`, a span that stops click propagation (`flex min-w-0 items-center`, placed `ms-auto shrink-0`); the chevron becomes the single focusable trigger, a `<button>` with `aria-expanded` and the label "Expand ‹label›" or "Collapse ‹label›". Never nest a button inside a button.
- The chevron is always last, after the header's controls.
- A trailing chevron's end inset equals its vertical inset, so it wraps the corner evenly: end padding = (header height - chevron box) / 2. Heights: `line` 24px, `strip` 28px, `block` 32px, `band` 36px. Chevron boxes: `glyph` (the bare 14px chevron, on section and group headers) and `box` (a real `Button` `variant='secondary'` `size='icon-xs'`, 22px, on card bands and snippets). Resulting end insets: band + box 7px, strip (snippet) + box 3px, block + glyph 9px, line + glyph 5px.

```tsx
// header height and chevron size as variables; end padding derived
'[--strip-height:--spacing(9)] [--trailing-size:--spacing(5.5)] h-(--strip-height) pe-[calc((var(--strip-height)-var(--trailing-size))/2)]'
// chevron box
'size-(--trailing-size)'
```

- The box chevron is a real kit `Button` so it looks and presses like every other: its wash shows only while the pointer is on the chevron itself (hovering the rest of the header leaves it bare), pressing deflates its fill by the kit's press inset, its colours change in the frame with no transition. In a one-button header it renders as an `aria-hidden` `<span>` with `tabIndex={-1}`, out of the tab order.
- The glyph chevron: `grid size-3.5 shrink-0 place-items-center rounded-control-sm`, `group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4`, rotating `-90deg` when closed over 150ms.
- Section labels and a round's row keep the chevron right after the label with no trailing inset.
- A header never takes a header-wide hover, press or colour transition on its box chevron. Building `aria-expanded` by hand outside the shared header is rejected (allowed exceptions: chat line rows, tree items, Show more, a request under a title, small inline detail rows).

Example: an Overview panel's 36px header band ends in a 22px secondary icon button 7px from the top, bottom and right edges.

#### Cards

- `CARD` is the only card surface: `rounded-xl`, the grey hairline, `bg-card`, superellipse corners.
- A card pads the same on all four sides; the shared card slot carries no padding of its own, so nothing doubles up. Every card's inset is 12px (`p-3`).
- The one card header strip is `CARD_HEADER`: 36px (`h-9`), `bg-bg-a1`, `ps-3 pe-3` (the end padding replaced by the 7px trailing inset when it folds), a 14px icon in a 20px icon slot on the 12px inset, 8px from glyph to title (`gap-1.25` plus the slot's 3px of air), title `text-xs` medium `fg-4`, a count right after the title in `font-normal text-fg-2 tabular-nums`, meta at the right (`ms-auto shrink-0 ps-3`, `text-fg-2`). The body under it: `flex flex-col gap-3 border-border border-t p-3`.
- The one footer is `CARD_FOOTER` (`px-3 py-2.5`, `bg-bg-a1`, hairline above).
- Panels keep their header action when collapsed. A passive figure beside the title is `meta`, not an action, so clicking it folds the panel like the rest of the header. A plain count goes right after the title in `fg-2`, never pushed to the middle of the band.
- A panel can start collapsed and remembers what you leave it at.
- List card: `CARD` with `p-1` around list rows; its empty line is `p-2.5 text-2xs text-fg-2`. What you see (the tile, the right-hand time, the last line's text) then sits 10px from the card on all four sides.
- Settings card: `p-1.5` (6px every side). Rows inside are `min-h-10 items-center gap-4 py-1`, `pl-2 pr-1.5`, so text sits 14px from the card's left edge and a control 12px from its right; `py-1` keeps a wrapped line 4px from the row's edge.
- Grouped settings (one pattern): a 32px header row with no fill (`flex h-8 items-center gap-1.5 pr-1.5 pl-2`), then the rows that belong to it on one shelf: an inset with `bg-bg-a1`, hairlines between rows (`divide-y divide-border`), blocks 6px apart (`gap-1.5`), no hairline between blocks. The shelf's 1px edge sits 6px from the card on three sides; its rows give that pixel back (`--shelf-edge: 1px`, subtracted from the row's padding) so a row's text still sits 14px from the card and 8px inside the edge, in line with the header.
- Never a fill on a fill: a control on a shelf has no fill at rest. Buttons there are `secondary` (the kit's ghost), selects `ghost`. The one exception is a single primary `xs` action that is the only thing to act on (an MCP's Connect).

```ts
const ROW_INSET = 'pr-[calc(--spacing(1.5)-var(--shelf-edge,0px))] pl-[calc(--spacing(2)-var(--shelf-edge,0px))]';
const SETTING_ROW = `flex min-h-10 items-center gap-4 py-1 ${ROW_INSET}`;
const SETTINGS_SHELF = `${INSET} flex flex-col divide-y divide-border bg-bg-a1 [--shelf-edge:1px]`;
```

Example: the Overview's "What changed" panel is a `CARD` whose 36px header holds the icon, the title and "Read the review" at the right, with the 22px chevron box after it; folded, "Read the review" is still there.

#### Insets and toned boxes

- Anything nested in a card or in the chat column is an inset: `INSET` (`rounded-lg` plus the card's own hairline, `border border-border`) with a fill on top, so every nested box has the same edge in both themes. Never a fill alone.
- The fill says what it holds: `bg-bg-a1` for a note, `bg-bg-2` for code and images, `bg-card` for a message link. Settings' shelf is an inset too.
- Not insets (no edge): rows in a list, highlights and hover washes, controls (fields, segmented controls, buttons), tiles (a step number, an avatar).
- A toned box takes its tone's edge: a box filled in a tone (a warning, an error, a disagreement, a checked choice card) is `rounded-lg border` in the tone's `-a3` border over the tone's `-a2` fill, never the grey hairline. Neutral is `bg-bg-a1` on `border-border`. The kit's checked choice card is `primary-a1` on `primary-a3`.
- A tile or badge in a tone has no border, so there is no edge to tint.
- Note inset: `px-3 py-2.5`, a `text-2xs` label in the tone's text colour (with a 14px icon, `gap-1.5`), over the text in `text-fg-4 text-xs`; label to text `gap-px`, or `gap-1` when the label has an icon.

| Tone | Edge | Wash |
| --- | --- | --- |
| neutral | `border-border` | `bg-bg-a1` |
| blue | `border-primary-a3` | `bg-primary-a2` |
| amber | `border-amber-a3` | `bg-amber-a2` |
| orange | `border-orange-a3` | `bg-orange-a2` |
| green | `border-green-a3` | `bg-green-a2` |
| red | `border-red-a3` | `bg-red-a2` |
| purple | `border-purple-a3` | `bg-purple-a2` |

- Rejected by lint: a `rounded-lg` box with a fill and no `border`; a hand-built `rounded-lg border border-border`; a tone fill on an element that draws the grey edge (`border`, `border-border`, `border-bg-N`) without a toned border.

Example: a review's "The agent review disagrees" note is an orange wash with an orange `-a3` edge; a code fence inside a card is `bg-bg-2` with the grey hairline.

#### Icon slots and one icon column

- Every leading icon sits in a 20px slot (`ICON_SLOT`: `grid size-5 shrink-0 place-items-center`) holding a 14px (`sm`) icon. The slot's 3px of air plus 5px of gap (`gap-1.25`) puts 8px between glyph and label everywhere.
- Inside a card, every row-leading icon sits in that slot on the card's 12px inset, and a 20px tile (a `md` status tile, a step number) is that slot. So a card header's icon and every row icon under it share one vertical centre.
- In a sidebar, every leading icon (nav items, the focus dot, section icons, row tiles) sits in a 20px slot 6px in from the row (`ps-1.5`), so all centres share one axis.
- In the chat column, see Transcript column.

Example: in a hand-over card, the header's 14px icon and the 20px numbered step tiles under it line up on one centre 23px into the column.

#### List rows

- One list row: a button, `corner-superellipse/1.125 flex w-full cursor-pointer gap-2 rounded-control text-left outline-none`.
  - With a meta line: `items-start pt-1.5 pb-1`; title `text-fg-4 text-xs` over meta `text-2xs text-fg-2`, both `Truncate`, `gap-px` between, in `flex min-w-0 flex-1 flex-col`.
  - Title only: `h-7 items-center`.
  - With a leading tile: `px-1.5`; without: `px-2.5`.
  - Trailing (a time): `shrink-0 text-2xs text-fg-2 tabular-nums leading-5`.
  - The row keeps 2px less under its text (`pb-1` vs `pt-1.5`) because a line already carries about 3px below its baseline.
- Rows in a list card sit `gap-px` apart inside the sliding hover highlight.
- The current row is `aria-current` and `data-active="true"`; the highlight rests on it. In a compact list it scrolls itself into view (`block: 'nearest'`).
- Long lists render progressively: the first 24 rows, then the rest.

Example: a Home queue row is a 20px stage tile, the task title over one line reading "SW-142 · Building", five dots (two green, a blue pulse, two hollow) and "Running bun test apps/web" shimmering, and "2h" at the right.

#### Sliding highlight

- Lists, menus and nav draw no hover or selected background on their items. One absolutely positioned indicator slides to the hovered item (`data-highlight-item`) and, when the pointer leaves, rests on the current one (`data-active="true"`); with no current item it parks (fades out).
- Indicator: `pointer-events-none absolute top-0 left-0 -z-10 bg-bg-a2 opacity-0`, `rounded-control` for plain lists, `rounded-item` in menus and popover lists; style `will-change: transform, opacity; contain: layout paint; transform-origin: center`. Transition `transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out`. Only transform and opacity animate. The container is `relative isolate`; a menu list owns its `p-1` so the indicator sits flush inside the popup edge.
- A destructive item's indicator is `bg-red-a2`.
- An item's text brightens when the indicator is on it (`data-indicator-here:text-fg-4`).
- The command menu uses the same indicator for its keyboard selection; when the page changes, the highlight slides from where it was on screen to the new row rather than travelling through the list's scroll.

Example: moving the pointer down Home's In progress card, one grey block glides from row to row; leaving the card, it fades out.

#### The queue

- One list of tasks by what they need, in two sizes, `wide` and `compact`, from one component. Nothing else lists tasks by need.
- Sections: Needs you (every open decision in priority order, then what it unblocks, then the kind of decision, then age), In progress, Waiting on another task (in chain order, collapsed by default in compact). The latter two take title, icon and tone from the same source as All tasks' groups, so the two never disagree.
- Every section holds only the focus project's tasks: the focus is the filter; to see other work, switch focus. Only a search of every task reaches past it.
- A task shows in one section only. Sections that summarise (Recently finished, Recent conversations) leave out tasks another section holds, but not the tasks the page's guide names; their own counts (five at most) are picked after that.
- Wide (Home): under the composer, each section a `text-2xs` label over a `rounded-xl` list card; each row a 20px gate or stage tile, title, status line, age. The guide above summarises these sections; a task it names is still listed in its section.
- A queue row is a small overview card on two lines: the title, then one summary line laid out across the row: the handle and status (the stage, not "Waiting to check in again", which the row's tile already shows), a mini track, then what is happening. The mini track is the task's steps as 6px dots joined by 8px hairlines (`h-px w-2`), `bg-green-4` done, a blue pulse current, `bg-amber-4` waiting on you, a dashed `fg-2` ring skipped, a `bg-a3` ring not started; one image labelled "Step 4 of 7: Build 1/2", no tooltip per dot. After it, while an agent works and no decision is open, the agent's latest action in the present tense, shimmering (still when the run is paused); otherwise the current step's count when it has one and the status does not already name the step ("Checks 2/5"), and nothing more. No static description or stage reason: the status and the dots already say it. While the steps can still change a spinner stands in for the dots, then the planning agent's latest action or "Working out the steps".
- Home order: greeting, guide, composer, then Needs you, In progress, Recently finished (merged or done in the last 24 hours, five at most), Recent conversations (latest agent message of five tasks, opening their chat), Waiting on another task. Reason: what needs you, what is moving, what just happened, then the long tail, so a long list never pushes the timely ones off screen.
- Compact (sidebar and queue popover): collapsible `h-6` headers, the whole header folds. Header: `w-full gap-2 rounded-control ps-1.5 pe-1 font-medium text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4`; a 14px section icon in its tone in a 20px slot; the title truncating; the count in `font-normal tabular-nums`; the chevron shown only on hover (`opacity-0 group-hover/disclosure:opacity-100`) 6px after the count (`gap-1.5`), 5px from the header's top and bottom, never at the header's end: the chevron belongs to what it folds, and the end is where a section's action goes. Section: `flex flex-col border-border border-t px-2 py-1.5`, no top border on the first; rows `pt-0.5` below the header; the same rows as wide without the age; empty text `py-1 ps-8.5 pe-2.5 text-2xs text-fg-2`.
- Open and closed state is shared by sidebar and popover through `localStorage` (key per section). A section can always be collapsed, including the one holding the task on screen. Until you have toggled a section yourself it opens when it holds the task on screen; after that your choice wins everywhere.
- Queue popover: `max-h-(--available-height) w-80 gap-0 p-0` (320px, as tall as its content up to the room under the button, then it scrolls), list inset 6px more at the top (`pt-1.5`) so the first header's icon is as far from the top as from the side.
- A status tile under a pulse is masked (`PULSE_CUTOUT`, a radial-gradient `mask-image` 2px wider than the dot), so the cut is transparent and stays clean on any surface, hovered rows included. Never a ring in the surface colour: it shows as a box when the row's hover wash changes the background.

Example: the "3 need you" popover shows Needs you, In progress and a folded Waiting section, each header a 12px grey label with a coloured 14px icon, the current task's row highlighted.

#### Status tones

- Tones come from one source, nowhere else: `neutral`, `blue`, `amber`, `orange`, `green`, `red`, `purple`.

| Tone | Surface (tile) | Surface hover | Text | Fill (dots, pulse) |
| --- | --- | --- | --- | --- |
| neutral | `bg-bg-a2 text-fg-3` | `bg-bg-a3` | `text-fg-2` | `bg-fg-2` |
| blue | `bg-primary-a2 text-primary-text` | `bg-primary-a3` | `text-primary-text` | `bg-primary-4` |
| amber | `bg-amber-a2 text-amber-text` | `bg-amber-a3` | `text-amber-text` | `bg-amber-4` |
| orange | `bg-orange-a2 text-orange-text` | `bg-orange-a3` | `text-orange-text` | `bg-orange-4` |
| green | `bg-green-a2 text-green-text` | `bg-green-a3` | `text-green-text` | `bg-green-4` |
| red | `bg-red-a2 text-red-text` | `bg-red-a3` | `text-red-text` | `bg-red-4` |
| purple | `bg-purple-a2 text-purple-text` | `bg-purple-a3` | `text-purple-text` | `bg-purple-4` |

(Hover classes are written `hover:X active:X`.)

- Meaning: something that needs your answer is blue; paused, setup incomplete and sign-in needed are orange; work to review is amber; a plan, a proposed change or an operation to confirm (things that decide what gets built) are purple; ready to merge is green; working stages and system waits (waiting to check in, waiting on a usage limit, waiting on delegations) are blue; waiting on another task is neutral. A post-merge step left to do is amber.
- Section icons, gate tiles, command-menu task icons and status labels all read the same mapping.

Example: "Plan to approve" is a purple tile with a document glyph in the queue, a purple icon in All tasks' group header and a purple label in the preview card.

#### Status tiles, glyphs and the pulse

- Status tile: `corner-superellipse/1.125 inline-grid shrink-0 place-items-center rounded-control-sm` plus the tone's surface, a 14px icon in the tone's text colour. Sizes: `md` 20px (`size-5`, it is the icon slot), `sm` 18px (`size-4.5`, inline and in popover rows). A labelled tile is `role='img'` with `aria-label`, and gets a tooltip: the label in its tone, then " · detail" muted, in one `whitespace-nowrap` span. An unlabelled tile is `aria-hidden`.
- A working glyph is a tile with a pulse in its top right (`absolute -top-px -right-px`, the tile masked by `PULSE_CUTOUT`), tooltip "Building · Agent working".
- Pulse: a 6px dot (`relative flex size-1.5 shrink-0`), a ping layer `absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none` in the tone's fill, over a solid `relative size-full rounded-full` in the same fill. Blue for working, amber for waiting.
- Each status has its own icon; a gate's status takes the gate's glyph, each wait its own (snooze clock, gauge for a usage limit, agents for delegations, hourglass for another task), each stage its own (hammer for building, eye with sparkle for agent review, check circle for done). In a facts row the icon is the tone's text colour at 70% and the label stays `fg-2`; a working agent adds the pulse after the label.
- A task's kind is not shown as a fact: the task's steps and screens already show it.

Example: a queue row for a review shows a 20px amber tile with an eye glyph; hovering it reads "Changes to review" in amber.

#### Checkmarks

- Checkmarks are the accent everywhere: check and to-do glyphs, the current value in a menu, a select or the command menu, copy confirmations, done tiles, settled tasks, toasts, popovers, tooltips, task lists rendered from markdown.
- Shapes: a small check (`IconCheckmark1Small`, 14px, `text-primary-text`) inline; the selected mark (`IconCheckmark1`, 14px, `text-primary-text`, `aria-label='Selected'`) at the end of the chosen menu row (`ms-auto`); outcomes: pass `IconCheckCircle2Filled` in `text-primary-4` (label "Passed", text `text-primary-text`), fail `IconCircleXFilled` in `text-red-4` (label "Failed", `text-red-text`), skipped `IconCircleDotted` in `text-fg-2` (label "Skipped"). Outcome icons carry a tooltip with the label in its colour.
- The one exception: a progress track's done steps (a 14px `IconCheckmark1Small` in `text-green-text` on a 16px circle of `bg-green-4/29`) and the line between them (`bg-green-4`) are green, so done reads apart from the blue pulse of the current step.
- A status the icon already says is not printed beside it: no "Done", "Complete", "Passed" or "Passing" next to a check. "In progress", "Failed", "Running", "Waiting on you" stay. (The progress track's step tooltips are the exception: every step states its status, Done included.)

Example: in a select, the chosen option ends in a 14px blue check; a passing CI check shows a filled blue circle with a check and no "Passed" text.

#### Checklists

- Anything that is a list of things to do, ticked or only shown, is one checklist look, never a hand-built list of checkboxes.
- Parts: list `ul` with rows `gap-3`; header: title `text-xs` medium `fg-4` at the left, progress `text-2xs fg-2 tabular-nums` at the right ("1 of 2 done", "All done"); item: the check in a 20px column so it sits on the title's first line, content in a `gap-1` column; title `text-xs` medium `fg-4`, `fg-3` once done, with meta beside it in `text-2xs fg-2` (wraps under when narrow); detail `text-xs fg-3` (markdown); actions under it `gap-1.5`; a command as a shell code block with Copy on hover and Run in terminal in its corner.
- Interactive rows: a 14px `Checkbox` that waits for the server's answer; a refusal is a toast. A row that cannot be ticked yet is disabled with its reason as the tooltip.
- Read-only rows: the compact checkbox's box with no control, the accent with a white check once done, named "Done" or "Not done".
- A markdown task list (`- [ ]`, `- [x]`) anywhere renders as read-only checklist rows, rows `gap-1`, the mark lined up with the first line (`1lh` tall), nested lists kept. Nothing in markdown ticks.
- An item's kind (meta) carries its icon: environment variable (key), secret (lock), migration (database), deploy (rocket), config (sliders), generic step (checklist).

Example: a merge gate shows "Pre-merge steps · 1 of 2 done" with a "Set STRIPE_KEY" row ticked and greyed, and a migration row with its command in a code block.

#### Facts row

- What a details panel would hold is one quiet wrapped row under the page heading, on every tab: handle, state, repository, branch, pull request, priority, times, and when they apply what it waits on, what it unblocks, checks, coverage, agents.
- One colour: every fact is `inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-control-sm px-1.5 text-fg-2 text-xs` (a 14px icon 6px from the text). Facts pull out by their `px-1.5` so the first icon sits on the column edge.
- A fact that opens something adds `corner-superellipse/1.125 cursor-pointer outline-none hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2 data-popup-open:text-fg-4`.
- A state glyph or warning note (failing checks, conflicts, a budget gone over) keeps its own colour; the words around it do not.
- Facts with more to say open an info popover on hover, never a tooltip. Facts that change something open a click menu. Each fact's menu is its override (priority menu, waits-on menu).
- Each fact says why once: a value the system chose shows once and its tooltip says why ("Shinsa chose this: …", or "You changed this. Shinsa chose “normal priority”: …"). No "Auto" label, no separate triage line.
- A fact that does not apply is absent, not empty (a task with no repository has no repository or branch fact).
- The handle (`SW-142`) leads the row in `tabular-nums`; a click copies it and toasts "Copied".

Example: under a task title: "SW-142 · (amber eye) Changes to review · (repo icon) shinsa · (branch) fix/login · #4531 · (bars) High · Started 2h ago · 3 agents", all in 13px `fg-2`.

#### Smart links

- One inline component per entity, shared by prose, the chat, rendered markdown and facts. Base: `group/link cursor-pointer font-medium text-fg-4 no-underline outline-none`; the underline is transparent at rest and `fg-a3` on hover and press (`underline decoration-transparent underline-offset-3 group-hover/link:decoration-fg-a3 group-active/link:decoration-fg-a3`). Smart anchors carry `data-smart` so prose link styling (blue, underlined) never applies.
- The leading glyph and the first word never part at a wrap (wrapped together in `whitespace-nowrap`). An inline tile or icon sits `relative -top-px me-1 align-middle` (centred between x-height and cap height).
- Task link: 18px state tile and the title. Goes where the work is (the review tab for a review, the chat at the run for a question or running agent). Hover opens a preview card (`w-80`): an 18px tile and the title `line-clamp-2 font-medium text-fg-4 text-sm` (`gap-2`, the tile `mt-px`), then indented 24px (`ps-6`) the status in its tone (medium) over what is happening now (`line-clamp-3 text-fg-3`), then a wrapping meta line (`gap-x-3 gap-y-1 text-2xs text-fg-2`: handle, repository (its mark in its project's colour), branch in mono, each with a 14px icon `gap-1`), body `p-3 gap-2.5`; a footer `border-t px-3 py-2` with how long it waited (`text-2xs fg-2`, a time with exact tooltip) and its one action as a button.
- Pull request link: a tile in the pull request's tone (green open, red failing, amber running, purple merged) and `#N` in `tabular-nums`; opens the host; its card (`w-72`) shows the task, CI, unresolved comments, conflicts and each check.
- Repository and branch chips: a 14px `fg-2` icon and the name (the branch in mono); their cards are the repository and branch facts.
- File link: inline code (`rounded-sm bg-bg-a2 px-1 font-mono text-fg-4`); with a repository it opens the file in the code view at its lines with a tooltip naming path and lines ("Open in Code ‹path› · lines 4-9"); elsewhere plain code.
- Parsing: explicit internal links, a quoted task title, an exact title of 12 or more characters, a bare `#N` that matches exactly one pull request. Unknown or malformed references render as plain labels, never broken links. The current page's own entity is not auto-linked. In one-line previews (inside rows and buttons) references are plain medium text, never nested links.

Example: in Home's guide, "Start with (blue tile) Fix login redirect: the reviewer found a race." where hovering the title shows the preview card with Review as its action.

#### Prose guide lines

- An editorial briefing is prose, not a card: no border, no tint. The page's one heading (`text-base` medium `fg-4`) above; each line a step quieter: `text-sm text-fg-3 leading-relaxed`, task links `fg-4`, lines 6px apart (`gap-1.5`).
- Each line names one thing and says why in one sentence: "Start with ‹task›: why.", "Then ‹task›: why.", "After that, …", "Finally, …". No status words, chips, numbers or separate action links: the tile says the state, the link opens the place to act, the preview card holds the rest.
- Asides follow in `fg-2` (`flex gap-2`, a marker in an `h-lh` box): what is running (a pulse, two named items with their verb, the rest as a dotted-underline "2 more" opening a popover: `text-fg-3 underline decoration-fg-a3 decoration-dotted underline-offset-3 hover:text-fg-4 active:text-fg-4`), then a note behind an info glyph. Left out when empty or redundant with what follows.
- Every line starts on the column's left edge, markers included. Inline tiles sit `align-middle` 1px up.
- Empty state: "Nothing needs you right now." in `fg-4` medium and one calm sentence.

Example: the Home guide under "Good morning, Christo".

#### Info popovers and label/value pairs

- Anything that shows more on hover (facts, smart-link cards, "2 more", related items) is an info popover on a preview card. It opens on hover after 80ms, closes 120ms after the pointer leaves, sits 8px from its trigger (bottom, start), and a click does nothing to it: it never toggles or sticks open. Once one is open, moving to another trigger swaps instantly (no delay, no animation) and the group stays warm for 300ms after the last closes. A trigger the pointer crosses on its way toward the open card does not steal it.
- Popup: `corner-superellipse/1.125 flex w-72 flex-col rounded-popup bg-popover text-popover-foreground text-xs shadow-md`, fade and zoom from 95%, no animation when swapped instantly.
- Real menus stay click dropdowns (Menus, in 11.1).
- Parts (`InfoHeader`, `InfoSection`, `InfoRow`, `InfoAction`): header (title `font-medium text-fg-4 text-xs` over a `text-2xs text-fg-2` description, `gap-px`, `px-3 py-2.5`); section (`flex flex-col border-border border-t py-1`, no border on the first, optional title `flex h-7 items-center gap-1.5 px-3 font-medium text-2xs text-fg-2`); row (`flex min-h-7 items-center justify-between gap-4 px-3 text-xs`: 14px icon and label left in `text-fg-3` with `gap-2`, value right in `shrink-0 text-fg-2`); action row (`flex h-8 w-full items-center gap-1.5 border-border border-t px-3 text-primary-text text-xs hover:opacity-80 active:opacity-80`, an up-right arrow for external links).
- Task lists inside: rows `rounded-item px-2 py-1.5 gap-2 text-xs items-start`, an 18px tile (`mt-px`), title (medium `fg-4`) over status (`text-2xs fg-2`) `gap-px`, in a `p-1` frame with the sliding highlight (`rounded-item`).
- Label and value pairs sit apart (Label and value lists, in 11.1).

Example: hovering a pull request fact shows "CI · Passing", "Unresolved comments · 2", "Mergeable · Yes" as left/right rows, then each check, then "Open on GitHub" in blue.

#### Tooltips: when a tooltip is allowed

A tooltip must add information the screen does not show. One that repeats what is visible goes.

- No tooltip:
  - a control whose tooltip would restate its own label (Copy on a button reading Copy, a labelled menu item, a segmented option or tab whose name says it all);
  - self-evident numbers (diff counts "+12 −3", a count beside its label);
  - a generic options trigger (`•••`), since its menu is one click away;
  - a dialog or sheet's corner X.
  Each keeps its `aria-label` when it has no visible text.
- A labelled control keeps a tooltip only for what its label cannot say: what pressing it leads to or covers ("Opens the pull request", "Sends the findings you kept and your line comments to the agent", an update's restart note), a choice item's hint line, and a disabled control whose reason is not on screen ("Send your line comments to the agent or remove them first").
- A delayed tooltip everywhere else hovering has more to tell:
  - icon-only buttons whose meaning is not plain from the glyph (copy, run in terminal with the folder as detail, collapse/expand "Collapse summary", previous/next, send, remove "Remove folder", dismiss, stop); the tooltip repeats the `aria-label`;
  - keyboard shortcuts, even on a labelled button, since the key is not on screen ("Search and actions ⌘K", the viewer's Esc, ←, →);
  - copy feedback (see Copy);
  - small marks that carry meaning without a label: status tiles, project dots ("Superwall project"), check icons, progress-track steps, a file's risk dot ("High risk" and the reason), a file's status letter ("Added"), comment counts ("2 comments from you"), a pull request badge ("Pull request #4531 · Checks passing"), a context meter, a key badge, a reconnecting pulse;
  - text that hides more than it shows: a value the system chose, a round fact, a list of dependencies, a smart link's target, a setting's one-line explanation, an item's origin;
  - every time (see Times);
  - text from data that can be clipped (see Truncation).
- Instant tooltips: none. Keyboard focus is not hover: a tooltip opens at once on keyboard focus, and on a tap where there is no hover.

Example: the copy icon beside a commit sha shows "Copy the full commit" with the sha as a muted second line, then "Copied".

#### Tooltips: content

- Value first in `fg-4`; the qualifier muted (`text-fg-2`, the `TooltipLabel` span); states in their status colour (`*-text`); lists one item per line in the foreground; mixed bright and muted text inside one `whitespace-nowrap` span. Never a sentence where a value and its label will do.
- A tooltip with a detail stacks a muted second line under its label (`flex-col items-start gap-px`). A shortcut renders as a `Kbd` `ms-1` after the label.
- Popup: `corner-superellipse/1.125 z-50 inline-flex min-h-6 w-fit max-w-72 items-center gap-1 rounded-control border border-border bg-popover px-2 py-1 text-2xs text-fg-4 leading-[1.35]`, no arrow (the offset alone reads as attached); with a kbd inside: `py-0.5 pr-0.5`, the kbd `h-4 rounded-sm bg-bg-a2 text-fg-3`. Placement: `side='top'` by default, `sideOffset` 4px, `alignOffset` 0. Entrance: fade in, zoom from 95%, slide 8px (`slide-in-from-*-2`) from the trigger side; exit fade and zoom out; none when opened instantly.
- Lint rejects a tooltip that repeats its control's text (a hint whose label equals the trigger's text or value). A hint with a shortcut or a detail adds something and passes.

Example: a queue tile tooltip "Building · Agent working": "Building" in blue, " · Agent working" muted, on one line.

#### Tooltips: delay and mechanics

- One delay, in the kit: `TOOLTIP_DELAY`, 600ms resting on a trigger before it opens. After one closes, the next opens at once, with no entrance (`data-instant`), for `TOOLTIP_SKIP_DELAY` (400ms), so running along a row of hints reads as one tooltip moving. Nothing else sets a delay; lint rejects a `delay` on any tooltip part.
- A press or Escape cools the group so the next tooltip waits again; a tooltip closed by a press or Escape stays closed until the pointer leaves its trigger.
- One tooltip serves the page: the provider at the root mounts the only tooltip and listens on the document (pointer over/out/move/down, click, focus in/out, keydown, in capture). A trigger is just its own element, registered by a ref and marked `data-tooltip-trigger`, with no component, state or listener of its own, so a page full of hints stays cheap. Content is built when it opens (a time's exact moment is formatted only then).
- It closes when the pointer leaves, on a press of the trigger, on Escape and when focus leaves. While open, the trigger carries `aria-describedby` (the tooltip's id) and `data-popup-open`.
- A tooltip can follow the pointer along the trigger's vertical axis (a resize handle).

Example: hovering the Settings cog waits 0.6s; sliding straight onto the Agent usage gauge swaps the tooltip with no wait and no animation.

#### Tooltips: placement

- A tooltip opens over its text, never over the row it sits in. The element a tooltip wraps is the text and its icon only: inline, or `w-fit` with `max-w-full` so it still truncates, never a block stretched across a full-width row. Hovering the empty right of a divider or a feed line opens nothing.
- The truncating text component is the one block trigger, because its tooltip opens only while the text is clipped, when the text fills its box.
- Lint rejects a tooltip trigger around a block element (`div`, `p`, `li` or a `flex`, `grid`, `block` class) with no `w-fit`, `inline-*`, `size-*` or fixed width.

Example: a round divider's tooltip wraps only "Round 2 · Fix login · Done" (an `inline-flex`), not the hairline that runs to the right edge.

#### Times

- Every time is a `TimeAgo` or a `Duration` with the exact moment in its tooltip, and a bare formatted age or duration in markup is a bug that lint rejects; the components, their tooltips and their details are in 11.1, Times.

Example: a queue row's "2h" shows "Wed, Oct 22, 2026 2:14 PM" over "Waiting on you".

#### Truncation

- Text from data that can be cut off is `Truncate`, whose tooltip with the full text appears only when the text really is clipped; where it applies and the two places that keep a plain `truncate` are in 11.1, Truncation.

Example: a long task title in the sidebar ends in an ellipsis and shows in full after 600ms; a short one shows no tooltip.

#### Copy

- Every copy goes through one helper that writes the clipboard and always shows the toast ("Copied", or "Couldn’t copy to the clipboard"); the trigger's tooltip, glyph swap and sizes are in 11.1, Copy.

Example: clicking the handle in the facts row copies "SW-142" and shows a "Copied" toast.

#### Transcript column and rows

- The chat is one centred column the composer's width. Every item is a row box `py-2 mb-1` (20px from item to item) on the column's left edge.
- One icon column: the column sets `--chat-inset` to 13px (`[--chat-inset:--spacing(3.25)]`), a card's 1px border plus its 12px inset, so a chat line's 20px icon slot and the icon of a card header below share their centre, 23px into the column. Everything that is not a card takes it: chat lines, errors and dividers `ps-(--chat-inset)`; the agent's prose `px-(--chat-inset)`, so it starts on a card body's text. Cards and your bubble stay on the column's edges. Inside a nested card the inset is 12px (`[--chat-inset:--spacing(3)]`).
- Run sections: top margin `mt-2` for the first, `mt-6` when the run opens with your message, `mt-5` otherwise; `mb-3`; the section's first child loses its top margin and padding and the last its bottom (`[&>:first-child]:mt-0 [&>:first-child]:pt-0 [&>:last-child]:mb-0 [&>:last-child]:pb-0`) so the box hugs its content.
- Off-screen sections skip rendering where supported: `[content-visibility:auto] [contain-intrinsic-block-size:auto_600px]` behind `supports-[overflow-anchor:auto]`.
- Runs are set apart by space alone: no hairline, no model name, no time.
- The transcript renders a neutral chat protocol, never a provider's own tool names.

Example: a tool row's icon, the card header icon of the plan card below it and the agent's paragraph text all start on the same 13px line.

#### Chat line anatomy

- Every one-line row in a run is the same line: a 20px row (`flex h-5 min-w-0 max-w-full items-center gap-px self-start text-left text-xs`), a 20px icon slot (`me-1`) with a 14px icon in its text's ink, the label `min-w-0 truncate font-medium text-fg-3`, then the meta `text-fg-2` after " · ", truncating first (a string meta ends in an ellipsis; an element meta truncates its own way). Glyph to label is 8px: the slot's 3px plus `me-1` (4px) plus `gap-px` (1px). Optional trailing `ms-1.5 flex shrink-0 items-center`.
- Clickable lines: `group/row ... cursor-pointer`, ink `text-fg-3 group-hover/row:text-fg-4 group-active/row:text-fg-4`.
- Rows that open show a 14px chevron right (`IconChevronRightSmall`, rotate 90deg when open, 200ms) after the content, hidden until hover while closed (`opacity-0 group-hover/row:opacity-100`). Their detail hangs off a hairline rail centred under the icon slot: `flex min-w-0 gap-1.25 pt-3 pb-1`, a 20px column holding a 1px `bg-border` line, content `flex min-w-0 flex-1 flex-col gap-2.5` starting on the label's line. Images in a closed row show as a strip under it indented `ps-6.25` (25px).
- A fold (a group of tool calls, the worked-for row) puts its chevron in the icon slot.
- Measured: 20px high, 13px text, label `fg-3`, meta `fg-2`, 14px icon in a 20px slot, 8px glyph to label. At 4px instead of 8px the labels sat 4px left of every card title.
- The role header, every notice, the worked-for row, the brief, tool rows, delegation report rows and the round divider are all this line.

Example: "(terminal icon) Ran bun test · 12 passed", 13px, label grey-3, meta grey-2.

#### Card lines inside the transcript

- Hand-over cards ("Asked you", "Set the steps", "Proposed the plan") open with one 36px band: `flex h-9 min-w-0 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 text-xs`, the 20px slot with a 14px `fg-4` icon, title `min-w-0 truncate font-medium text-fg-4`, meta `ms-auto shrink-0 ps-3 text-fg-2`. Body `flex min-w-0 flex-col gap-3 border-border border-t p-3`.
- A delegation's spawn card and the live card's row are the same band and slot.
- Inside a card, an icon that leads a row sits in the same slot on the same 12px inset; a 20px tile is that slot.
- Card body sub-labels: `text-2xs text-fg-2` over content, `gap-px` (or `gap-1.5` above a list). Numbered steps: a step number tile, `flex gap-2.5`, title medium `fg-4` over detail `fg-3`, `gap-px`, `pt-px`. Choices offered: `CHIP`s with `px-1.5`, wrapping `gap-1.5`. An answered question: a hairline (`border-t pt-2.5`), "Your answer" in `fg-2` then the answer alone in `fg-4`, `gap-2`; framing text the agent saw around the answer is stripped.

Example: "Proposed the plan · 3 phases" band, then numbered phases.

#### Run headers

- A run is introduced by a chat line: the role's icon and its plain-word name as the label, then what it did as meta, plus the account it used ("· a@b.com"); `mb-2 w-full`, `mt-2` first, `mt-5` otherwise. A failed run appends " · Failed" in `text-red-text`; a stopped one " · Stopped". The headline truncates and shows in full in its tooltip when cut.
- A round has one agent: every run of it is headed "Agent", and its meta says what that run did ("Planning the work" / "Planned 3 phases", "Phase 2 of 3: …", "Fixing the failing checks", "Running the operation" / "Reported the outcome").
- Role icons: Agent (agent), Reviewer (shield check), Answerer (speech bubble), Investigator (magnifying glass), Researcher (book), and for delegated helpers Planner (map) and Builder (hammer).
- When your message started the run, your bubble sits above its header: you speak, then the agent answers.
- A delegated agent never gets a header; it is a card inside the turn of the agent that delegated it, with the same role mark.
- A message belongs to the run that answers it. One no agent answers stays under the run before it. A finished run's summary is never repeated under a message the next run has not picked up yet.

Example: "(agent icon) Agent · Phase 1 of 2: Add the login guard · a@b.com".

#### Live card

- While a run works, it shows one live card: `CARD`, `flex min-w-0 flex-col overflow-hidden`.
  - Top (`px-3 pt-3`): the agent's latest interim message, `text-xs` prose, four lines at most (`line-clamp-4`), `aria-live='polite'`.
  - Then a 36px disclosure band (`strip='band' chevron='box'`, `gap-1.25 ps-3 text-2xs`): a pulse in the 20px slot (blue working, amber waiting), the latest step in the words its tool row uses ("Running bun test", "Reading app.tsx") shimmering (`min-w-0 flex-1 truncate text-fg-3 leading-normal`), then the clock and step count (`shrink-0 text-fg-2 tabular-nums`, `fg-4` on header hover/press), " · 14 steps".
  - Opened: `border-border border-t p-3`, everything so far.
- The step stays named after it finished until the next one starts, so the line never flickers. "Thinking" only once the agent wrote after its last step; "Starting" before anything happened. A paused or parked run shows its label without shimmer.
- Shimmering text sets `leading-normal` on its truncating box (`block truncate leading-normal`): the kit's `leading-none` would clip descenders.
- Swapping messages: the old slides up 10px, blurs 2px and fades (240ms, `cubic-bezier(0.23, 1, 0.32, 1)`); the new rises 10px from below, unblurring and fading in (360ms, same curve, 80ms delay); the card's height eases over 240ms. Under reduced motion it simply changes.
- Opened, the newest folded group keeps one row for its latest call, and each new call takes that row's place, so a step never grows then shrinks the card.

```css
@keyframes chat-swap-in { from { opacity: 0; transform: translateY(0.625rem); filter: blur(2px); } }
@keyframes chat-swap-out { to { opacity: 0; transform: translateY(-0.625rem); filter: blur(2px); } }
.chat-swap-in { animation: chat-swap-in 360ms cubic-bezier(0.23, 1, 0.32, 1) 80ms both; }
.chat-swap-out { animation: chat-swap-out 240ms cubic-bezier(0.23, 1, 0.32, 1) both; }
```

Example: a card reading "I'll add a guard to the login route…" over "(pulse) Reading app.tsx ……… 1m 12s · 6 steps".

#### Finished work folds

- When a run ends, its work folds into one line: the chevron, "Worked for 3m", meta "14 steps". The final reply sits under it as the main content (the last interim text when there is none).
- Hand-over cards and errors stay outside the fold; the system's brief lives inside it.
- A turn that ends in a hand-over shows that card as its reply and nothing under it: text the agent wrote around it ("Done.") folds into the work, so the same reply never shows twice. A question or suggested tasks keep the reply under them.
- A message from you starts a new turn with its own fold.
- The detail is the full log on a hairline rail: interim messages, then tool calls as chat lines; two or more in a row fold into one row ("Ran 3 commands and read 2 files").
- A hand-over the system rejected and the agent retried folds quietly as an ordinary row with meta "Retried" ("Retrying" while pending), its own icon; opened, the reasons show under "Handed back" in normal ink. Only a failure nobody recovered from is red: the icon, "Failed" and the reasons. A question is never folded.
- Commands, reads, writes and edits render highlighted (language from the file extension); edits and writes as a diff; long output capped with "Show N more lines"; images as thumbnails that open the image viewer.

Example: "(chevron) Worked for 3m · 14 steps" over the agent's final paragraph, and a "Proposed the plan" card with nothing after it.

#### Your message, and acting never moves you

- Your message is its bubble: `corner-superellipse/1.125 rounded-3xl border border-border bg-muted px-3.5 py-1.5 text-fg-4 text-xs leading-relaxed` inside a `relative min-w-0 max-w-4/5` frame that also holds the delivery light, right-aligned (`flex flex-col items-end gap-2`), `whitespace-pre-wrap break-words`. Over 12 lines (or 1080 characters) it clamps to 12 with a "Show more"/"Show less" toggle (`px-1 text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4`).
- Attachments sit above the bubble: images as a large thumbnail strip (`max-w-4/5 justify-end`), other files as chips (`CARD`, `h-10 max-w-64 gap-2 p-1 pr-3`, a 32px `rounded-lg bg-muted` icon box with a 16px icon, name `text-xs fg-4` over meta `text-2xs fg-2`, `gap-px`), wrapping `gap-2`.
- Acting never moves you: approving, merging, answering, replying or cancelling stays on the page and confirms with a toast. There is no previous/next stepper; the queue and the command menu move between items.
- A sent message shows at once, and while it is delivered (on its way to the server, then routed into the task) the bubble stays at full opacity and a blue light travels around its border: a 1px ring over the border (`message-delivery`), a conic gradient of `primary-4` (both themes) with a soft tail turning once every 2.4s, only `transform`. No text line. It fades in; when the message is delivered the light fades out over 400ms on the strong ease-out. Under reduced motion the ring is a still `primary-4` border. Delivered: no line. "Noted. It needs no reply." in `text-fg-2` when nothing will answer it. "Not delivered. ‹reason›" in `text-red-text`, and the message stays. Every message ends in a visible state.
- A message that waits for the round in progress to finish (it asked for new work, so it is the next round) is not a bubble: it sits in a queue docked above the composer, a `CARD` with a 32px `text-2xs` header ("Queued · Sends once round 2 is finished.", an hourglass; while round 2 waits for you it names what you do first: "Sends after you merge round 2.") over one row per message (`text-xs fg-3`, three lines at most, an up arrow, a pencil and a cross 1px apart). The arrow sends it now, to the round in progress, as a message; the pencil turns the row into a `Textarea` with Cancel and Save (Enter saves, Escape cancels); the cross removes it. When the round starts, the message moves into the chat under its round's divider, delivering until the round's agent starts.
- A deep link to a run scrolls to it and washes it: `outline-2 outline-transparent transition-[background-color,outline-color] duration-500 data-focused:bg-primary-a1 data-focused:outline-primary-a1`, the 2px outline outside the box so the wash wraps full-width content instead of sitting flush; it fades with the wash. Because the run's box hugs its content, the wash is the same 2px on all four sides.

Example: you type "also handle logout", it appears at once right-aligned with a light circling its border, which fades once the agent has it. "Then add a logout page" while round 2 works goes to the queue above the composer instead, and joins the chat when round 3 starts.

#### Round divider

- A task in rounds stays one chat; a quiet divider marks where each round starts; nothing folds, so every run stays on the page.
- `flex h-5 min-w-0 items-center gap-2 ps-(--chat-inset)`, `mt-2 mb-2` for the first, `mt-7 mb-2` otherwise. Content: an `inline-flex h-5 gap-1.25 text-fg-2 text-xs cursor-default` chat line with a 14px `fg-3` icon in the slot, "Round 2" (medium `fg-3` `tabular-nums`) " · title" truncating, then " · status" in its tone, not truncating. Then a hairline `h-px min-w-6 flex-1 bg-border`.
- Tooltip on the text only: the heading with the time as detail.

Example: "(icon) Round 2 · Handle logout too · In progress", followed by a hairline to the right edge.

#### Image viewer

- One viewer opens every image (attachments, tool results, evidence) and plays recordings (controls, autoplay, no zoom or pan).
- Backdrop `black/85`; image fitted to the window, never upscaled. An image that knows the width it was taken at (an evidence shot's width in CSS pixels) is laid out at that width, so a 2x screenshot keeps two file pixels to a CSS pixel and stays sharp on a Retina screen; its 100% is that size. It is laid out under the dark theme so its chrome reads the same on black in both themes.
- Open and close are one run in reverse: backdrop and chrome fade over 240ms on `cubic-bezier(0.22, 1, 0.36, 1)` while the image, opaque the whole way, flies between its thumbnail and the window on the same curve and duration. The flight is one transform keeping the aspect (translate plus a single scale, never a stretch) onto the thumbnail's drawn box (its `object-fit` box) with a `clip-path` inset to what the thumbnail shows, each corner rounded like the thumbnail's (or its clipping card's) corner. Closing starts from where the image is (zoom and pan included) and lands on the thumbnail of the image open now, measured at that moment; the thumbnail stays hidden until the image lands and shows in that frame. With no thumbnail in view, the image fades while shrinking to 96% in place, and opens the same way. The open waits for the portal to mount. A recording, and anything under reduced motion, only fades. A recording never morphs: it mounts at its fitted size (from the thumbnail's `videoWidth` or a hidden probe), with width and height set, so its controls lay out once at the right width.
- Zoom: click or double-click toggles between fit and the larger of 100% and twice the fitted size, around the pointer; wheel and pinch zoom toward the pointer; drag pans while zoomed; `+` (or `=`) and `-` step by 1.5x and `0` returns to fit.
- Stepping (on-screen arrows and arrow keys) moves through the images of one message or tool group, or item by item in evidence. Stepping is a cross-fade, never the open run again: the incoming image appears at its own fitted size from the first frame (size from its thumbnail, or held until loaded while the outgoing stays), fades in over the outgoing, which fades out as it was; both move 10px in the direction of travel over 200ms on `cubic-bezier(0.23, 1, 0.32, 1)`; zoom and pan reset to fit at once. Switching parts of one comparison does not slide: the incoming part fades in over 150ms on top of the outgoing, which stays opaque under it when they share a rect, so the stage never dims. Under reduced motion every swap is the 150ms fade with no slide. A press during a swap takes over from where the images are, with no queued or stacked animation.
- Chrome: Close, Previous, Next are `Button` `outline` `icon` (26px, 14px glyph), with shortcut hints (Esc, ←, →). The bar at the bottom: `rounded-popup bg-popover shadow-3`, `h-8`, `text-xs`, `popover-foreground`, never a pill, with the caption (truncating), "2 of 5" (items, not files), the zoom level, and on a comparison a segmented choice of its parts. While there is more than one image it keeps one width (`w-xl`), so text swaps without moving it. Close button, Esc or a click on the backdrop closes.

Example: clicking a screenshot thumbnail in a tool row flies it to fill the window; the right arrow cross-fades to the next screenshot sliding 10px.

#### Prose in the chat

- Agent text is full-width markdown at 13px, line height 1.625, `fg-4`, icons `--icon-4`.

```css
.prose-chat { line-height: 1.625; color: var(--fg-4); --icon-color: var(--icon-4); }
.prose-chat :where(p, table, blockquote) { margin: 1.25rem 0 0.75rem; }
.prose-chat :where(ul, ol) { margin: 1rem 0; }
.prose-chat :where(li + li) { margin-top: 0.25rem; }
.prose-chat :where(li > ul, li > ol) { margin: 0.25rem 0; }
.prose-chat :where(h1, h2, h3, h4, h5, h6) { margin: 1.25rem 0 0.75rem; line-height: 1.25; }
.prose-chat :where(h1) { font-size: 1.125rem; }
.prose-chat :where(h2) { font-size: 1rem; }
.prose-chat :where(h3, h4, h5, h6) { font-size: 0.875rem; }
.prose-chat :where(:not(pre) > code) { padding: 0.0625rem 0.25rem; }
.prose-chat > :first-child { margin-top: 0; }
.prose-chat > :last-child { margin-bottom: 0; }
```

- Code fences are highlighted in the code view's colours (the `--code-*` tokens), in a `bg-bg-2` inset with Copy on hover; a fence marked to run gets Run in terminal in its corner.
- Prose links (not smart links) are blue and underlined; smart links override via `data-smart`.

Example: an agent reply with a heading at 14px, a list and an inline `code` span with 1px by 4px padding.

#### The command menu

- One menu reaches the whole app, opened by ⌘K (Ctrl K elsewhere) from anywhere, inputs included, or a magnifying-glass button. Every action goes through the same command path the buttons use; the menu adds no commands of its own.
- Dialog: `top-[max(3rem,14vh)] w-[min(32.5rem,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden rounded-popup bg-popover p-0`. It opens and closes in 75ms (scale from 0.98 in, 0.98 out, scrim in step), faster than a dialog (150ms in, 100ms out) because it opens many times an hour; reduced motion keeps only the fade.
- Input row: `flex h-10 shrink-0 items-center gap-2 border-bg-3 border-b px-3`, a 16px `IconMagnifyingGlass` in `fg-2`, input `font-medium text-fg-4 text-xs`, placeholder normal weight `fg-2`. Pages show a crumb in the input (`-ms-1 inline-flex h-5.5 max-w-48 items-center rounded-control-sm bg-bg-2 px-1 font-medium text-fg-3 text-xs`, truncating) whose text sits as far from the icon as the query does.
- List: `scrollbar-hide relative isolate max-h-[min(--spacing(96),60dvh)] scroll-py-1 overflow-y-auto overscroll-contain p-1` (384px or 60% of the viewport height), height animated; the sliding highlight follows the selection. Group headings `px-2 py-1 font-medium text-fg-2 text-xs`, groups `mt-1` apart, with no separators between them (the kit's separator, `-mx-1 my-1 h-px bg-bg-3`, is not used here). Empty `py-6 text-center text-fg-2 text-xs`. No footer.
- Rows: 24px (`py-1` plus `leading-4`), `relative flex cursor-pointer select-none items-center gap-1.5 rounded-item py-1 pr-2 pl-2 font-medium text-fg-3 text-xs`, `fg-4` under the highlight, disabled `opacity-50`. Icons plain (never on a tile), 14px. A row: icon, label as truncating text, hint (`truncate font-normal text-fg-2`, `min-w-12 shrink-[4]` so the label wins), then at the right edge: a trailing label (`ms-auto shrink-0 ps-3 font-normal text-fg-2`) for a status or a view's key (the Code tab's "Find in this file" shows "⌘F" this way, as text, not keycaps), then one of the selected check (`IconCheckmark1`, accent) for the current value, page or view, a right chevron (`IconChevronRightMedium`) for a nested page or a choice, or an up-right arrow (`IconArrowUpRight`) for a link.
- A task row: its status icon in the status colour, the title, the repository as the hint, the handle (`shrink-0 tabular-nums` hint), the status at the right.
- Command kinds: run, go (a path), link (new tab), page (a nested list, or a compose page whose input becomes a message field), choice (a value list, current checked; multi-value choices check every current one), search (types the query into the page's own search).
- Pages contribute what they know: a mounted component registers ranked sections and drops them on unmount; the menu re-renders only when the serialised sections change. Order: the current context first, then the queue (next and previous item that needs you), then global groups.
- Context: on an item's page its decision leads, each named for what it does ("Approve the plan", "Merge #4531", "Answer the question"), then View (its tabs), then tab-specific groups while that tab is open (with their keys), then actions on this item, then next/previous. Global groups: Tasks, Go to, Focus, Appearance, Accounts, Schedules, Integrations, Versions. With an empty query, Recent lists the last items visited that no group already shows. Commands that only make sense while typing (`searchOnly`) appear only then.
- Disabled always says why: `disabled` is the reason string (no boolean). The row greys, cannot be run by click or Enter, keyboard navigation skips it, and the reason replaces its hint. Typing never ranks a group by a disabled match; the first highlighted row is the first enabled one; a choice page opens on the current value only when it is enabled. Reasons are plain sentences: "Send or clear your comments first", "Updating…", "Unavailable: needs usage credits", "Kept until it merges or is cancelled".
- Typing matches by word: whole label, label prefix, word prefix, then substring; hints and keywords count at 0.7. Groups are ordered by their best match (cmdk's own group sort does not work). Choices flatten into their options ("dark", "urgent"); items match by title, repository, branch and status; decisions match across items ("merge" finds Merge #4531 wherever it is). Always at the bottom: "Create task: …" (starts it) and "Edit it before starting" (opens the composer filled in). "Create task: …" and "Search all tasks for “…”" keep the query in `fg-4`.
- Navigation: entering a page scrolls the list to the top; Backspace on an empty input goes back and re-selects the row that opened the page, restoring the scroll it had; the highlight slides from its on-screen position to the new row (the list scrolls the controlled value into view itself, since cmdk does not). A choice page opens on the current value. Closing resets to the root. Escape restores focus to where it was; a command that runs declines the restore so what it focuses keeps focus.
- Filters and searches a command sets live in the URL; an active filter shows as a removable button beside the page's search.

Example: on a task page, ⌘K opens with "Approve the plan" first; typing "dark" offers Change theme's Dark option with a check if current.

#### Menus, selects and project dots

- Real menus open on click; hover-only information uses info popovers (Menus, in 11.1).
- A generic options trigger (`•••`) has no tooltip.
- A project's dot lines up with menu icons: in any menu or select the 8px dot sits in a 14px box (`grid size-3.5 shrink-0 place-items-center`), the size of a menu icon, so its label starts where every other item's label does. Every place you pick a project shows the dot before each name, in the trigger and every option, through one renderer. "All work" is a grey dot.
- A project and a repository are never mixed up: a project is its dot and name, a repository its own name after its GitHub or folder mark, tinted in its project's colour (`RepoIcon`). The task's facts row shows the folder the agent works in; the task card on hover, the roadmap's Repository column and repository links show GitHub with a remote. A folder never stands for a project.
- Priority shows its level's mark everywhere: bars for low, normal, high, a red square with `!` for urgent; the priority menu's items carry the same marks.
- Item actions have one source (label and icon), read by the page's `•••` menu, the list's context menu and the command menu, so every action carries the same icon everywhere; destructive actions (Cancel task) use the destructive style.
- Dependency editing has one source too and is the same everywhere: a "Wait for another task" submenu of open tasks with a check on each current one (current ones sorted first; a click ticks or unticks one and the menu stays open) and "Stop waiting" (clears all). Several at once is the normal case: every list adds or removes one and never replaces the others. The label changes to "Merge after another task" once building has started. A locked dependency shows ticked and disabled with its reason, and Stop waiting is not offered when it is the only one.

Example: the Focus menu lists "(grey dot) All work", then each project with its colour dot in a 14px box, the current one checked in blue.

#### Decision cards and action naming

- A decision lives on the first card of the item's overview, next to what it decides on, never in the page header.
- Actions sit at the card's top right and are named for what they decide: "Approve changes" (primary), "Review" (outline, opens the review), "Merge #N", "Approve plan", "Run the operation", "Retry". Never a bare "Approve".
- Status labels name what waits on you the same way: "Plan to approve", "Changes to review" (never "Ready for review"), "Ready to merge", "Post-merge · 2 steps left".
- A disabled decision states its blocker in its tooltip ("Tick the 2 pre-merge steps first").
- Anything a person must do around the action is a checklist, never prose.

Example: a merge gate's card with "Review" and "Merge #4531" at its top right, Merge disabled until the two pre-merge steps are ticked.

#### Activity order

- Activity reads newest first: newest entry at the top; entries of the same moment keep the log's order, reversed. Every place that lists an item's activity uses the same ordering.

Example: the Overview's Activity panel starts with "Merged #4531 · 2m".

#### Attribution trees

- "Who worked on this" is a fact ending the facts row (`IconAgents`, "3 agents") whose info popover is a small tree: each role once in the order it first worked, its role icon (`fg-3`), name (medium `fg-4`), label (`fg-3`, truncating) and "2 runs" at the right (`ms-auto gap-1.5 ps-3 text-2xs text-fg-2`; "· working now" with a pulse while running); delegated agents nested under it with a corner-down-right arrow in `fg-2`, indented by level (`ps-2`, `ps-6`, `ps-10`, `ps-14`), with their status. The list sits in `border-t p-1` with the sliding highlight (`rounded-item`). A row opens the chat at that run.
- The same role names lead every run in the chat, so you always know who is speaking.

Example: "Agent · 3 runs", under it "↳ Builder · Add the guard · Finished".

#### Settings is titles only

- Settings rows are a title and its control (a 40px row). No section or row descriptions: a title and its options must say what a setting does on their own. The only exception is a group whose title cannot say which work it covers; it carries one sentence.
- A row may still show data under or beside its name (a reset time, a summary, a path in `text-2xs fg-2`).
- Selects show human display names from the first paint, never raw ids or aliases.
- Settings is split into tabs, each its own pane, not one long scroll with a table of contents (the main use is a floating tablet-sized window). Links to a section open its tab and scroll to it.
- Path rows: a 14px icon 8px from the name, the path after it in `text-2xs fg-2`, then ghost `sm` selects and a remove ×.

Example: Settings → General → Appearance: "Theme" with a select, "Layout" with Desk and Shelf, each option's hint in its tooltip.

#### Composers

- Every composer (the task composer, the new-task box, an answer box) shares the field (`COMPOSER_FIELD`: text 12px from the side, 10px from the top, `pb-1`, `text-xs fg-4`, `field-sizing-content`, placeholder `fg-2`) and the footer (`COMPOSER_FOOTER`: 6px around a row of `sm` controls, 24px tall, `gap-2`, no divider).
- Enter sends (One keyboard shortcut, below).
- Selects in a composer start on Auto ("Auto start", "Auto priority"), which sends nothing so the system decides; the primary button names what will happen ("Start", or "Add" for a task that waits).

Example: Home's new-task box with Project, When to start and Priority selects and Start in its footer.

#### Title over description

- Title over description is always `gap-px` (1px), with no exceptions: page headings, eyebrow over title, list rows, activity rows, steps, check rows, popover headers, task rows, findings, message links.
- A title next to its description on one line (command rows, a section label and its count, "Waits on ‹task›") is 6px (`gap-1.5`).

Example: a list row's 13px title sits 1px above its 12px meta line.

#### Numbered steps

- Numbered steps use one tile: `corner-superellipse/1.125 grid size-5 shrink-0 place-items-center rounded-control-sm bg-bg-a2 font-medium text-2xs text-fg-3 tabular-nums`, 20px, showing the 1-based index. It is an icon slot, so it lines up with header icons.

Example: the plan card's phases numbered 1, 2, 3 in grey squircle tiles.

#### Hover always has a press twin

- Every `hover:` class has the same `active:` value on the same line; `group-hover:` pairs with `group-active:`. The only exception is a hover that merely reveals something from `opacity-0`. Reason: touch and press must show the same feedback as hover. Lint checks that the `active:` exists.

Example: `hover:text-fg-4 active:text-fg-4` on a section header.

#### No focus states

- Nothing marks keyboard focus: no ring, outline, border recolour or wash. Elements use `outline-none`. Keyboard focus still opens tooltips at once.

Example: tabbing onto a list row shows no ring; its tooltip, if any, appears immediately.

#### One keyboard shortcut

- The app binds one global key: ⌘K (Ctrl K) for the command menu. Views bind their own keys only while they are open (a code view's ⌘P, ⇧⌘F, ⌘F, ⌘G; a review's J and K; a terminal's ⌘T, ⌘W; the image viewer's Esc, ← and →, and `+`, `-`, `0` for zoom). Enter sends in every input. A focused list box takes arrows, Home, End, Enter and Space. The Mac app's menu adds its own (Settings ⌘,, Reload ⌘R, Back ⌘[, Forward ⌘], Home ⇧⌘H).

Example: pressing J on the Review tab moves to the next point; pressing J elsewhere does nothing.

#### Handles

- A user-facing short id (`SW-142`: project key and number) is how people name an item. It leads the facts row, and shows in rows, command rows and preview cards in `tabular-nums fg-2`. The command menu finds an item by it. The document title reads "SW-142 Fix login · Shinsa". URLs use it, built by one function; other forms (raw id, any case) still open the item and are replaced by the canonical URL. Until an item has a handle, nothing shows one.

Example: `/tasks/SW-142` in the address bar, "SW-142" in grey at the start of the queue row's meta.

### 11.3 Settings, forms, process states and resources

These patterns turn Shinsa's screen rules into reusable recipes. Each names the rule, the exact classes and values,
the reason, what to do and what not to do, and one Shinsa example. Shared constants are written out the first time
they appear and referred to by name after that:

| Constant | Classes |
| --- | --- |
| `CARD` | `corner-superellipse/1.125 rounded-xl border border-border bg-card` |
| `INSET` | `corner-superellipse/1.125 rounded-lg border border-border` |
| `CARD_HEADER` | `flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 font-medium text-fg-4 text-xs` |
| `CARD_FOOTER` | `border-border border-t bg-bg-a1 px-3 py-2.5` |
| `ICON_SLOT` | `grid size-5 shrink-0 place-items-center` (the 20px icon slot), with `gap-1.25` to its text |
| `ROW_INSET` | `pr-[calc(--spacing(1.5)-var(--shelf-edge,0px))] pl-[calc(--spacing(2)-var(--shelf-edge,0px))]` |
| `SETTING_ROW` | `flex min-h-10 items-center gap-4 py-1` + `ROW_INSET` |
| `SETTINGS_SHELF` | `INSET` + `flex flex-col divide-y divide-border bg-bg-a1 [--shelf-edge:1px]` |
| `TOKEN_TEXT` | `shrink-0 text-2xs text-fg-2 tabular-nums` |
| `PAGE_COLUMN` | `mx-auto w-full max-w-3xl px-6` |
| `PAGE_TOP` | `pt-6` |
| `PAGE_TITLE` | `text-balance font-medium text-base text-fg-4 leading-tight` |
| `PAGE_DESCRIPTION` | `max-w-2xl text-pretty text-fg-2 text-xs` |
| `LIST_ROW` | `corner-superellipse/1.125 flex w-full cursor-pointer gap-2 rounded-control text-left outline-none` |
| `LIST_ROW_LINE` | `h-7 items-center` (a label alone, 28px) |
| `LIST_ROW_LINES` | `items-start pt-1.5 pb-1` (label over its meaning) |
| `LIST_ROW_TITLE` / `LIST_ROW_META` | `text-fg-4 text-xs` / `text-2xs text-fg-2` |

The tone maps every toned element reads from (seven tones: neutral, blue, amber, orange, green, red, purple):

| Map | neutral | blue | amber | orange | green | red | purple |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TONE_TEXT` | `text-fg-2` | `text-primary-text` | `text-amber-text` | `text-orange-text` | `text-green-text` | `text-red-text` | `text-purple-text` |
| `TONE_SURFACE` | `bg-bg-a2 text-fg-3` | `bg-primary-a2 text-primary-text` | `bg-amber-a2 text-amber-text` | `bg-orange-a2 text-orange-text` | `bg-green-a2 text-green-text` | `bg-red-a2 text-red-text` | `bg-purple-a2 text-purple-text` |
| `TONE_SURFACE_HOVER` | `hover:bg-bg-a3 active:bg-bg-a3` | `…primary-a3` | `…amber-a3` | `…orange-a3` | `…green-a3` | `…red-a3` | `…purple-a3` |
| `TONE_WASH` | `bg-bg-a1` | `bg-primary-a2` | `bg-amber-a2` | `bg-orange-a2` | `bg-green-a2` | `bg-red-a2` | `bg-purple-a2` |
| `TONE_EDGE` | `border-border` | `border-primary-a3` | `border-amber-a3` | `border-orange-a3` | `border-green-a3` | `border-red-a3` | `border-purple-a3` |
| `TONE_FILL` | `bg-fg-2` | `bg-primary-4` | `bg-amber-4` | `bg-orange-4` | `bg-green-4` | `bg-red-4` | `bg-purple-4` |

A toned inset is `INSET` with the tone's edge and wash (`TONE_INSET`).

#### Disclosure headers: strip heights and the chevron inset

Every header that folds something (a section, a block, a panel, a group of rows) is one `DisclosureHeader` with a
strip height and a chevron kind, and the chevron sits as far from the end as it does from the top and bottom.

| Strip | Height | Used for |
| --- | --- | --- |
| `line` | 24px (`--strip-height: --spacing(6)`) | section labels in a page or popover |
| `strip` | 28px | the change snippet's header |
| `block` | 32px | list section headers, Settings folding blocks |
| `band` | 36px | `Panel` and card headers |

| Chevron | Box | Trailing inset on a `block` | on a `band` |
| --- | --- | --- | --- |
| `glyph` | 14px, `IconChevronDownSmall` in a `size-3.5 rounded-control-sm` box | 9px | 11px |
| `box` | 22px, a `secondary` `icon-xs` button | 5px | 7px |

The inset is `pe-[calc((var(--strip-height)-var(--trailing-size))/2)]` and the header is `h-(--strip-height)`.
Closed, the chevron is `-rotate-90`; it turns with `transition-[rotate] duration-150`. The whole header toggles
(`group/disclosure flex min-w-0 cursor-pointer select-none items-center text-left`), its label reads "Expand ‹label›"
or "Collapse ‹label›", and the chevron goes `fg-4` with the header's hover and press. When the header also carries
an action, the action's click never folds the header, and the chevron becomes its own button with `aria-expanded`.

- Do: pick the strip from the table; the chevron then lines up with any chevron in the rows below it.
- Don't: hand-pad a chevron, or put a chevron at a different distance from the end than from the top.
- Example: a Settings folding block is `block` + `glyph`, so its chevron sits 9px from the end, in the same column
  as the rows' own chevrons below it.

#### Grouped status lists (a roadmap)

A list of everything of one kind is split into sections by status, in the order a person should act on them, each
with a sticky header.

- Order the sections by what needs the user first, finished work last. Shinsa's order: Ready to merge, Changes to
  review, Plan to approve, Change to approve, Operation to confirm, Needs your answer, Paused, In progress, Waiting
  on another task, Done, Cancelled. Done and Cancelled start collapsed.
- A new kind of decision gets its own section, placed by what it decides, not merged into the nearest one (a
  proposed change decides what gets built, like a plan, but is not a plan yet, so it sits right after Plan to
  approve with its own icon and tone).
- Section header: sticky, `block` strip with a `glyph` chevron:
  `sticky top-0 z-10 w-full gap-2 bg-bg-1 ps-3 font-medium text-2xs text-fg-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border hover:text-fg-4 active:text-fg-4`.
  Inside: the section's icon at `size='sm'` in its tone (`TONE_TEXT`), the title, the count
  (`font-normal text-fg-2 tabular-nums`), the chevron. An empty section renders nothing.
- Sort inside a section by priority, then oldest first; finished sections show the latest first.
- Rows are 36px (`h-9`), a grid with a hairline under each:
  `grid h-9 w-full cursor-pointer items-center gap-4 border-border border-b px-3 text-left text-xs outline-none hover:not-has-[a:hover,button:hover]:bg-bg-a1 active:not-has-[a:active,button:active]:bg-bg-a1 data-popup-open:bg-bg-a1`,
  columns `grid-cols-[minmax(0,1fr)_7.5rem_12rem_4.5rem_4.5rem] max-md:grid-cols-[minmax(0,1fr)_auto]`. The row
  washes only when the pointer is not on a link or button inside it, and stays washed while its menu is open.
- Every row starts with the same leading mark (Shinsa: the priority mark in a `size-4` slot), and its status column
  starts with the kind's icon in the status's tone, named for screen readers, whose tooltip lists the steps that
  kind takes ("Investigation: find the repository, investigate, then your OK to change.").
- Long lists are windowed (fixed row height, see Windowed long lists).
- The command menu's "Filter by status" offers the same sections with the same icons.
- Example: All tasks.

#### Dependency trees inside a list

When items wait on other items, draw the waiting section as a tree in which each item appears exactly once.

- An item's depth is its longest path from an item outside the section. It sits under the parent, at the level
  above, that comes last on screen. In a diamond (B and C wait on A, D on B and C) D sits under whichever of B and C
  is shown second, after both. Fan-out siblings sit side by side under their parent.
- Indent 26px per level: `ps-6.5` for level 2, `ps-13` for level 3 (level 0 and 1 have none).
- A nested row's corner arrow sits under its parent's leading mark and is a 20px button:
  `grid size-5 shrink-0 cursor-pointer place-items-center rounded-control-sm text-fg-2 hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2 data-popup-open:text-fg-4`,
  the same while its menu is open. Its tooltip is "Waits on" and the parents; it opens the Waits on menu
  (`min-w-56 max-w-80`).
- The status column names every parent: "Waits on ‹A›, ‹B›" (`text-fg-2 text-xs`), each parent a link
  (`min-w-0 truncate text-fg-3 underline-offset-2 hover:text-fg-4 hover:underline active:text-fg-4 active:underline`)
  that truncates on its own, all of them one per line in the tooltip, and "‹task› was cancelled" for a cancelled one.
- Example: the Waiting on another task section of All tasks.

#### Toned soft badges (a linked count)

A small fact that carries a state, such as a pull request number, is drawn on its tone's soft surface, the same tint
as a status tile, one step stronger on hover.

- Classes: `corner-superellipse/1.125 inline-flex h-5 items-center gap-1 rounded-control-sm px-1.5 font-medium text-2xs tabular-nums`
  + `TONE_SURFACE[tone]` + `TONE_SURFACE_HOVER[tone]`, the glyph at `size='sm'`.
- Its tooltip names the state in its tone. A click on it never triggers the row under it.
- Example: the pull request badge in All tasks (`IconPullRequest`, or `IconMerged` once merged, then the number).

#### Status tiles

A glyph that says a state sits on a tile of its tone.

- `corner-superellipse/1.125 inline-grid shrink-0 place-items-center rounded-control-sm` + `TONE_SURFACE[tone]`,
  `size-5` (20px, `md`, the default) or `size-4.5` (18px, `sm`). The glyph is `size='sm'` in `TONE_TEXT[tone]`.
- With a label it is `role='img'` with that label and a tooltip "‹label in its tone› · ‹detail›"; without one it is
  `aria-hidden`.
- A tile always keeps the outline glyph (filled glyphs mean "where you are", never a state).
- Example: a round's 20px tile in the Rounds panel; a 16px round tile inside the round fact's tooltip.

#### Defaults that say "Auto"

A form whose fields Shinsa can decide for itself starts every such field on an Auto item, and sending the form with
Auto sends nothing for that field, so the server decides.

- Each select starts on what Shinsa would pick: a value Shinsa knows (the focus project, with its dot; "No project"
  without one) or an explicit Auto item ("Auto start" with `IconCalenderSparkle`, "Auto priority" with
  `IconChart3`). Leaving a field on Auto sends nothing for it; picking a value sends it; picking "none" sends an
  explicit empty value (Start now sends an empty wait list, No project sends `null`).
- Order the selects by how much they change the outcome (Project, When to start, Priority).
- The submit button names what will happen: Start, or Add when the item will wait for another.
- No select for something the system decides better; the placeholder says it decides ("Shinsa decides what kind of
  task it is").
- Example: Home's new task composer. A "When to start" select offers Start now and "After ‹task›" for each open
  task in the composer's project.

#### The control ramp

Shinsa's controls run one step denser than the Application register's. Read every sizing table with these heights.

| Control | Heights |
| --- | --- |
| `Button` | `xs` 22, `sm` 24, `default` 26, `lg` 30; icon-only sizes are the same squares, plus `icon-2xs` 18 only for a close mark inside a 24px row (a terminal tab) |
| `Input`, `SelectTrigger` | 26 (`Input size='sm'` is 24) |
| Tab lists | `default` and `ghost` 26; `underline` 32, with no size prop |
| Menu, select and command rows | 24 |
| `Badge` | 18 (`sm`), 20 (default) |
| Glyphs | `sm` (14px) in every button and select, rows and badges; `md` (16px) in `default` inputs |

- Example: a Settings row action is a `secondary` `sm` button (24px, 14px glyph); a step's footer buttons are
  `default` (26px, 14px glyph).

#### Fields are filled, never bordered

A field (`Input`, `Textarea`, a default `SelectTrigger`) shows itself by its fill, never by a border or a fill set at
the call site.

- The fill is `bg-input` (`--input`, `bg-2` in both themes' mapping, a step above the page, a card and a dialog),
  its hover `--input-hover` (`bg-3`).
- A dark popover is itself `bg-2`, so inside one the field fills a step higher:
  ```css
  .dark [data-slot="popover-content"] {
    --input: var(--bg-3);
    --input-hover: var(--bg-4);
  }
  ```
  Without it the field drew as bare text (measured: popover and field both `oklch(0.228 …)`, the field now
  `oklch(0.257 …)`).
- `Input`: `corner-superellipse/1.125 w-full min-w-0 bg-input font-medium text-fg-4 backdrop-blur-md outline-none placeholder:text-fg-2`,
  default `h-6.5 rounded-control px-2.5 text-xs`, `sm` `h-6 rounded-control-sm px-2 text-xs`. Disabled:
  `disabled:cursor-not-allowed disabled:text-fg-1 disabled:opacity-50`.
- Read-only is the one exception: it trades the fill for a hairline so it reads as a value to copy, not a field to
  type into: `read-only:cursor-default read-only:border read-only:border-bg-4 read-only:text-fg-2`.
- `Textarea`: `corner-superellipse/1.125 field-sizing-content min-h-16 w-full rounded-lg bg-input px-2.5 py-1.5 text-fg-4 text-xs backdrop-blur-md`.
- An `Input` with `loading` adds `pr-9` and a spinner `absolute top-1/2 right-3 -translate-y-1/2 text-fg-2` that
  fades with `transition-opacity duration-150` (`sm` spinner in an `sm` input, `md` otherwise).
- Don't: add `border`, `bg-bg-*` or a ring at the call site to make a field show.
- Example: the Services popover's add form, whose fields fill `bg-3` inside the dark popover.

#### Invalid fields and field errors

- Invalid is a 1px `red-4` ring, set by `aria-invalid` on the field: `aria-invalid:ring-1 aria-invalid:ring-red-4`
  on `Input` and `Textarea`.
- Wrap the field in `Field` with `data-invalid` (the group turns `data-[invalid=true]:text-red-text`), and put the
  message in `FieldError` under it: `role="alert"`, `text-red-text text-xs`. Given a list of errors it shows each
  distinct message once (deduplicated by message; one alone is plain text, several a
  `ml-4 flex list-disc flex-col gap-1` list).
- Check on submit, and clear the invalid state as soon as the value changes.
- A value the client can check itself shows as the field's `FieldError`. A value only the server can refuse comes
  back as an error toast, and the typed value stays in the field.
- Example: the "Switch accounts at" percentage dialog: typing "150" and pressing Enter rings the field red with the
  hint under it; editing clears it.

#### Checkboxes: filled and outline

- `filled` (the default): the page's fill at rest (`bg-background`), an accent fill and a white check once ticked
  (`data-checked:border-primary-4 data-checked:bg-primary-4`, the same for indeterminate with a dash).
- `outline`: no fill at rest (`bg-transparent`), only its edge (`border-icon-1`, `fg-1` on hover); ticked it fills
  like `filled`. Use it for a list of boxes inside a popover, where a filled box on every row reads heavier than the
  rows.
- Both: hit area extended 6px (`after:absolute after:-inset-1.5`), `active:scale-95`, disabled
  `cursor-not-allowed opacity-45`.
- A box in a list row sits in the row's 20px icon slot at `size='sm'`, and the whole row toggles it.
- Example: Add services in the Services popover (`outline`); the folder list in setup (`filled`, `sm`).

#### Icon buttons: secondary, or bare inside a row that washes

- Everywhere, an icon-only button is `secondary`.
- `bare` is for a quiet action in a row that already washes on hover: no wash at all, only its glyph going from
  `text-fg-2` to `fg-4` under the pointer and while pressed
  (`text-fg-2 before:hidden not-disabled:hover:text-fg-4 not-disabled:active:text-fg-4`).
- Every icon-only button carries a tooltip with its name, except the dialog and sheet close X (next pattern).
- Example: the edit pencil on a service row in the Services popover's Manage view is `bare`.

#### The dialog close X

The dialog and sheet corner X has no tooltip: the X says it. Its `aria-label` is "Close".

#### Busy buttons stay themselves

A button that is working stays the same button.

- `Button loading` keeps its colours and its width, swaps its icon for a spinner (or, without an icon, adds a
  leading spinner), sets `aria-busy` and `data-loading`, and ignores presses and keys
  (`data-loading:pointer-events-none`, and its click is prevented), so a busy submit cannot fire twice.
- It is never `disabled` while busy. Disabled means "you can't"; busy means "working on it".
- Neighbouring buttons that would conflict with the running action are disabled while it runs (Back while a step
  saves), but the busy one is not.
- A busy button inside a dialog stays busy until the dialog has gone.
- Example: Continue in setup shows a spinner where its arrow was while the answer saves.

#### Where you are shows filled

A tab or navigation item that carries an icon swaps it for the icon's filled twin (the same name with `Filled`) while
it is the current one, and only then. Both names are written out at the call site, and a nav item requires both
(`icon` and `activeIcon`), so a new one cannot leave the active one out. A glyph that says a state anywhere else keeps
its outline, and filled never means on or off.

- Example: the rail's All tasks row is `IconListBullets`, and `IconListBulletsFilled` while you are on All tasks.

#### Settings layout: groups, cards, rows

Settings is titles only: no section descriptions. Every list of facts or choices uses these pieces.

- **Group**: a `<section>` with `flex scroll-mt-6 flex-col gap-1` and an id made from its title (so `#title` links
  land on it). On top, a section label, then the card.
- **Section label**: an `h2`, `flex shrink-0 items-center gap-1.5 font-medium text-2xs text-fg-2 leading-4 h-6 px-1`.
  Its actions sit at the right after a `flex-1` spacer in `flex shrink-0 items-center gap-0.5`: a `secondary` icon
  refresh button (with its tooltip, "Refresh usage", "Check for updates", "Check all MCPs") and then the add action
  ("Add account", "Add MCP"). An optional count follows the title in `font-normal text-fg-2 tabular-nums`.
- **Card**: `Card` with `gap-0 p-1.5` (6px padding). When it holds blocks, `gap-1.5` puts them 6px apart.
- **Row** (`SETTING_ROW`, at least 40px): the title on the left
  (`flex min-w-0 flex-1 items-center gap-1.5 truncate text-fg-4 text-xs`), the control on the right
  (`flex shrink-0 items-center gap-1.5`). A titles-only row is just that.
- **Described row**: the title (`flex min-w-0 items-center gap-1.5 text-fg-4 text-xs`) over one sentence in
  `text-2xs text-fg-2` (it wraps rather than truncate), the controls at the right.
- **Two-line row**: a name over a `text-2xs text-fg-2` line, both `Truncate`, state at the right. Use it for any
  listed resource (a schedule: "Starts a new task · every hour"; a version: "Latest 2.1.310 · Shinsa needs 2.1.280
  or newer").
- **Path row**: `SETTING_ROW` with `gap-2`: a 14px icon slot (`grid size-3.5 shrink-0 place-items-center`, the icon
  at `size='sm'` with its meaning as a tooltip), then the title (`Truncate`, `min-w-0 shrink-0 text-fg-4 text-xs`)
  and its path or source (`Truncate`, `min-w-0 text-2xs text-fg-2`) on one baseline (`items-baseline gap-1.5`),
  then the action.
- **Token text** (`TOKEN_TEXT`) for any version, count, estimate or time at the right of a row.
- **Empty row**: `SETTING_ROW` holding one sentence (`min-w-0 flex-1 text-fg-2 text-xs`) and the action that fills
  it. A card with nothing in it holds that one row and nothing else.
- **Block**: a 32px header row (`flex h-8 items-center gap-1.5 pr-1.5 pl-2`) over a shelf
  (`SETTINGS_SHELF`). Rows on a shelf subtract the shelf's 1px edge from their inset (`--shelf-edge: 1px`), so their
  text stays in the column of the rows outside it.
- **Folding block**: the same 32px header as a `block`/`glyph` disclosure (`gap-1.5 pl-2 text-xs`): an optional
  status icon at `size='sm'` in its tone (`-translate-y-px`, no background), the title (`min-w-0 truncate font-medium
  text-fg-4`), its detail in `TOKEN_TEXT` right after it, the chevron at the far right 9px from the end. Its open
  state persists. The shelf shows only while open.
- A group's card does not repeat its tab's name: on the Agent usage tab the first card is "Accounts", on Agents it is
  "Models".
- Every select in a column of rows has a fixed width that fits its longest value (model `w-40`, speed `w-30`), so
  values and chevrons line up. A row that shows text in a select's place gives it the selects' combined width
  (`w-71.5 truncate ps-2.5 text-fg-2 text-xs`, "Follows the answerer").
- Example: Settings → Agents → Models: two described rows, Task agents and Quick jobs, each with a model select and a
  speed select.

#### Secondary detail behind a quiet disclosure

A setting that most people leave alone folds away under its row.

- The toggle is a quiet text button right after the row's title:
  `flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-control-sm text-2xs text-fg-2 outline-none hover:text-fg-4 active:text-fg-4`
  with the section chevron (`IconChevronDownSmall`, `-rotate-90` closed).
- It starts folded, unless the folded values differ (then the group's select reads "Set per role" and the shelf
  starts open).
- Opened, a `SETTINGS_SHELF` sits straight under the row: one described row per item, with the same controls at the
  same widths but `ghost` (no fill on the shelf's fill).
- Items that have no setting of their own are listed last, with their sentence and, in place of the controls, which
  item they follow (`fg-2`).
- Example: "Per role" under Task agents: Agent, Reviewer, Answerer, then Investigator and Researcher, "Follows the
  answerer".

#### Resource blocks: a header row and a shelf of readings

A listed resource with several readings (an account and its usage windows) is one block: a header row, then its
readings on a shelf.

- Header row (32px, `flex min-w-0 flex-1 items-center gap-1.5 text-xs`): the resource named with its provider
  (provider icon at `size='sm'`, then "Claude · a@b.com" as a `Truncate`, `font-medium text-fg-4`), its plan in
  `fg-2`, a `Badge size='sm'` "Default" (`ms-0.5`) when it is the default, and only when something is wrong a status
  in its tone ("Needs sign-in" orange, "Paused" `fg-2`, "Out of usage until 3:40 PM" red, from the moment a window
  hits 100%). Then at the right "Updated 2m ago" (`text-2xs text-fg-2`, a live relative time, `hidden sm:inline`)
  and the `•••` menu.
- Blocks sit 6px apart in the card, in the user's order (the menu has Move up / Move down).
- One reading per row, 40px (`SETTING_ROW`): the label over "Resets in 3h" (`text-2xs text-fg-2`, the exact time on
  hover), a usage bar `w-24 shrink-0 sm:w-40`, and the percentage `w-9 text-right`.
- Without readings the row holds the server's detail as a muted line ("No usage reported yet." before the first
  read).
- A resource listed twice shows once; a muted empty row after the list says which copy is used.
- A provider Shinsa does not manage itself uses the same block: its plan in `fg-2` or, without one, its state
  ("Signed in with ChatGPT", "Not signed in", "Not installed", "Too old for Shinsa"), and, on its shelf when there
  is something to do, a row with the fix as inline markdown and a `CopyButton` for its command. Its menu offers only
  what makes sense (Copy the sign-in command, Check the sign-in again); no version is shown.
- Example: Settings → Agent usage → Accounts.

#### Status words appear only when something is wrong

A row or header names a state only when it needs attention; a healthy resource shows no status at all. A positive
state never takes the accent checkmark, which belongs to "selected" and "passed".

- Example: an account row shows no "Signed in"; it shows "Needs sign-in" in orange only when it does.

#### Every resource names its provider

Wherever a resource from one of several providers is listed, it reads "‹Provider› · ‹identity›" after the provider's
icon ("Claude · a@b.com", "Codex · a@b.com", "Codex" alone without an identity, `IconRobot` for an unknown provider),
from one helper and one component, so the wording never drifts between screens.

#### Usage meters and their tones

Any "how full is it" reading uses the same bar, the same percentage and the same tones.

- Tones by percentage: neutral below 75, amber from 75, red from 90. The percentage text is `text-fg-3` when neutral,
  else `TONE_TEXT`; the bar fill is `TONE_FILL` (neutral `bg-fg-2`). Percentages are rounded and clamped 0 to 100.
- Bar: `relative block h-1.5 overflow-hidden rounded-full bg-bg-a2` with a fill
  `absolute inset-y-0 start-0 rounded-full` at `width: N%`, `aria-hidden`. The width comes from the call site
  (`w-10` in a footer, `w-24 sm:w-40` in a row, full width in a popover).
- Percentage: `shrink-0 text-xs tabular-nums` ("42%"), `text-2xs` in a footer meter.
- A compact meter is `flex w-fit items-center gap-1.5 px-1.5`, `role='img'` with a label, and its tooltip gives the
  numbers over a muted sentence ("84k of 200k tokens" over "Context 42% full").
- Show nothing rather than a guess when the maximum is unknown, or right after a hand-over until the new session
  reports.
- Example: the context meter in the chat composer's footer (`w-10` bar, `text-2xs` percentage).

#### A glance button and its popover

A top-bar reading that opens more on hover.

- Trigger: a `secondary` `sm` button with the icon (`IconGauge`) and the one figure that matters next, in the usage
  tone from 75%; without a figure it reads its name ("Agent usage"). Hidden when there is nothing to read.
- Pick the figure the way the server picks: of the windows that apply to what the next run uses, the one closest to
  running out (the fullest; the 5-hour one when two are as full once rounded). An empty 5-hour window never hides a
  nearly spent weekly one, and the row's label says which limit binds.
- Popover (`w-72`), titled with the name alone, no description; one shared row per resource:
  `flex flex-col gap-1.5 px-3 py-1.5`: name and percentage
  (`flex items-center justify-between gap-4 text-xs`), the bar, then the window's label and its reset or its status
  (`flex items-center justify-between gap-4 text-2xs text-fg-2`).
- The resource the next run uses carries a 6px blue dot right after its name
  (`size-1.5 shrink-0 rounded-full bg-primary-4`, `role='img'`, "Used for the next turn" as its label and tooltip).
- A click goes to the full settings section.
- Example: the Agent usage button before Focus in the Cards top bar.

#### Overflow menus (•••)

- One trigger for every `•••` menu: a `secondary` `icon-sm` button with `IconDotGrid1x3Horizontal` and an
  `aria-label` naming the thing ("Schedule options", "MCP options").
- Content `align='end'`, `min-w-52` (or `min-w-64` when items carry details).
- Order: the actions on the thing, then a separator, then the destructive item last (`variant='destructive'`,
  `IconTrashCan`), which opens a confirm dialog.
- Each item has its icon. Toggles read as the action they take now (Pause / Resume, Leave out of new work / Use for
  new work). A choice of values is a submenu of radio items with the current one checked, ending in "Other…" when
  any value is allowed (which opens a typed-value dialog).
- Example: a schedule's menu: Pause, Copy webhook URL, Open the task, separator, Delete schedule.

#### Confirming a destructive action

- One shared `ConfirmDialog` (an `AlertDialog`): a title that asks ("Finish without running the operation?"), one
  sentence of consequence, and a footer of "Keep it" (cancel) and a `destructive` button named for what it does
  ("Delete schedule", "Remove account", "Remove MCP").
- The action runs once the dialog has finished closing, not when the button is pressed.
- The dialog's text is held while it closes (see Dialogs close without a visible change).
- Remove from Shinsa, never from the outside world: a login Shinsa did not create is "Remove from Shinsa" and is
  never signed out.
- Inside a popover, confirm inline in its footer instead (next pattern).
- Example: Delete schedule.

#### Add, manage and remove inside a popover

A popover that lists resources also adds, edits and removes them, as views of the same popover.

- Popover: `w-88 max-w-[calc(100vw-1rem)] flex flex-col overflow-hidden`; a view that scrolls is fixed at
  `h-[min(var(--available-height),28rem)]`, a short one fits its content.
- Each view: a header, a scrolling body, a footer.
  - Header: `flex shrink-0 items-center gap-2 border-border border-b py-3 ps-3 pe-1.5`, title
    (`truncate font-medium text-fg-4 text-xs`) over an optional description (`text-2xs text-fg-2`), and at the right a
    `ghost` `sm` select when there is a scope to choose (only with two or more).
  - Footer: `flex h-10.25 shrink-0 items-center gap-1 border-border border-t px-2`, `sm` buttons, Back or the
    destructive action on the left, a `flex-1` spacer, the primary on the right.
- List view footer: Manage (`IconSettingsSliderHor`) and Add… (`IconPlusMedium`), both `secondary`; a way out on the
  right.
- Add view: a `SectionLabel` ("Found in the project", with its count and, with more than one, a `secondary` `xs`
  select-all) over rows of `outline` checkboxes in the 20px slot, the recommended ones pre-checked, the whole row
  toggling; the last row is "Custom service…" with `IconPlusMedium` in the slot (`text-fg-3 text-xs`). The primary
  counts what it adds ("Add 2 services") and is disabled with nothing picked. While the list loads, a delayed
  `LoadingLine` (`h-10 px-3 text-xs`). With nothing found, the view becomes the custom form and its description
  says so.
- Edit and custom views: a form (`px-3 py-3`) whose submit is the footer's primary (`type='submit' form={id}`),
  busy while it saves.
- Manage view: rows with a `bare` edit pencil and `outline` checkboxes; footer: a `destructive` `sm`
  "Remove 2 services" (`IconTrashCan`, disabled with nothing picked) and Done on the right. Pressing Remove turns the
  footer into the confirmation: the question (`truncate text-fg-4 text-xs`) over a note (`truncate text-2xs
  text-fg-2`) in `flex min-w-0 flex-1 flex-col ps-1.5`, then Cancel (`secondary`) and Remove (`destructive`, busy
  while it runs).
- Example: the Services popover.

#### Dialogs that take a typed value

Every dialog that takes one typed value (a code, a percentage, a count) is one pattern.

- A left-aligned header (title in `fg-4`, description in `fg-2`), the field inside a `<form>` so Enter submits, and a
  right-aligned footer of a `secondary` Cancel and a primary named for what it does ("Submit code", "Save
  percentage", "Add MCP", "Save MCP", "Save copy").
- The primary is `type='submit' form={formId}`, disabled while the field is empty, busy while it saves; the dialog
  closes only when the save succeeds.
- Client-checkable mistakes are the field's `FieldError`; a server refusal is an error toast with the value kept.
- Cancel while something runs cancels it.
- Multi-line values take one item per line, with the format named in the label ("Arguments (one per line)",
  "Environment (`NAME=value` lines)", "Headers (`Name: value` lines)").
- Editing something with secrets shows the saved keys with empty values and "Leave a value empty to keep the saved
  one."; the web never receives a secret.
- The title names the act ("Add an MCP", "Edit ‹name›", "Copy ‹name› to Shinsa").
- Example: the "Switch accounts at" dialog behind "Other…".

#### Dialogs close without a visible change

Nothing a dialog shows changes while it animates out; every change lands after the exit ends.

- A dialog a page opens is mounted from `useDialogState`: `show(value)` opens it, closing only flips `open`, the value
  stays while it fades and is cleared on Base UI's `onOpenChangeComplete`, so the dialog unmounts after its exit and
  opens fresh next time:
  ```tsx
  {dialog.value === 'remove' && <ConfirmDialog control={dialog.control} … />}
  ```
- Text from outside the dialog (a store, a server push, a prop) goes through `useHeldValue(value, open)`, which keeps
  what it showed while open.
- A busy button stays busy until the dialog is gone; a confirm runs its action once closed; the command menu resets
  to its root after it has faded, not while.
- Example: the sign-in dialog keeps its current step after Cancel instead of falling back to "Starting sign-in…".

#### A dialog's description is quiet

A dialog's, confirm dialog's and sheet's description is `fg-2`, two steps under the `fg-4` title, set once in the
kit: the title and the fields lead, the sentence under the title is context. A link inside it turns `fg-4` on hover.

#### Multi-step dialogs

A dialog that walks through a process shows one state at a time in the same frame: "Starting sign-in…" with a
spinner, the step's form ("Sign in to Claude", the note, the page as a link, a code field, "Submit code"),
"Finishing sign-in…", the result ("Signed in as a@b.com." with Done) or the failure with Try again.

#### Setup and onboarding: one calm step at a time

Setup shows one step at a time in one column, built only from the pieces Settings and Home already use, with no
style of its own.

- **Shell**: a focus page with nothing that leads elsewhere: a 44px drag bar
  (`flex h-11 shrink-0 select-none items-center gap-2 px-3.5 sm:px-5`, `data-window-drag`, `desktop:ps-20`) with the
  logo and name in a browser (`font-medium text-fg-4 text-sm`, the logo `size-3.25` in a 20px slot) and the traffic
  lights in the app, the connection status, a spacer, and the Update button. No Home button or logo link, no rail, no
  queue, no usage glance, no Focus, and the command menu is not mounted (and is closed on the way in). The page is
  `flex h-dvh flex-col overflow-hidden bg-background text-fg-3`.
- **Locked until done**: while setup is not complete every route replaces itself with setup, so a link, the address
  bar, Back or the app's menu all land there. A run started again from Settings is not locked: every step's footer
  then has "Close setup" (`secondary`), which goes to Settings. Opening setup once it is finished goes Home.
- **Column**: `mx-auto flex w-full max-w-xl flex-col gap-6 px-6` + `pt-6 pb-16 md:pt-12` (48px from the top from
  `md` up). Everything starts on the column's left edge. The stepper, the step and its footer are 24px apart.
- **Stepper**: one segmented `Choice` in a 26px slot (`flex h-6.5 items-center`), each step's label, no numbers, no
  circles. The current step is the selected segment and the pill slides to the next one (the stepper sits outside
  the step, so it is not remounted). An answered step has the accent checkmark before its label and its answer as
  the tooltip ("Opus 5.5"); a reached but unanswered step is plain; both open their step; a step not reached yet is
  disabled. A click while an answer saves does nothing. Below `sm` the segments give way to one `PAGE_DESCRIPTION`
  line in the same slot ("Step 2 of 6: Model"). The finished page keeps the 26px slot empty, so the title sits at the
  same height on every step.
- **Step**: `flex flex-col gap-6`: an inner `flex flex-col gap-4` with the heading (the question itself as
  `PAGE_TITLE`, "How should pull requests be merged?", and one line of `PAGE_DESCRIPTION` under it, `gap-px`), then
  the body 16px under it, then a refused answer's reason as an error line; then the footer 24px under.
- **Footer**: `flex items-center justify-between gap-3`, no hairline above. Left: Back (`secondary`,
  `IconArrowLeft`), or an empty span on the first step. Right (`flex items-center gap-1.5`, 6px apart): Close setup
  on a re-run, the step's own secondary action ("Add account", "Check again" with `IconArrowRotateClockwise`), and
  the primary named for the step ("Continue", "Skip for now", "Finish setup", "Finish anyway") with `IconArrowRight`
  at its end. All `default` size.
- **Error line**: `flex min-w-0 items-start gap-1.25 text-red-text text-xs leading-relaxed`, `IconExclamationCircle`
  at `size='sm'` in the 20px slot, the text `selectable min-w-0 whitespace-pre-wrap break-words`.
- **Motion**: the step enters with a 0.5rem slide and a fade, 220ms on `cubic-bezier(0.23, 1, 0.32, 1)`, from the left when going
  back; nothing leaves, so two steps never overlap. Under reduced motion the step appears at once: the stylesheet asks for
  a 160ms fade without the slide, but the global reduced-motion reset (`animation-duration: 0.01ms !important`) wins.
  ```css
  @keyframes onboarding-in {
    from { opacity: 0; transform: translateX(var(--onboarding-shift)); }
  }
  .onboarding-in, .onboarding-in-back {
    animation: onboarding-in 220ms cubic-bezier(0.23, 1, 0.32, 1) both;
  }
  .onboarding-in { --onboarding-shift: 0.5rem; }
  .onboarding-in-back { --onboarding-shift: -0.5rem; }
  @media (prefers-reduced-motion: reduce) {
    .onboarding-in, .onboarding-in-back { --onboarding-shift: 0; animation-duration: 160ms; }
  }
  ```
- **Imports happen, they are not asked**: anything the server can bring in by itself is already there when the step
  opens, marked "Added". Until the data arrives, the card holds one row with a delayed loading line, never "none
  found". A failed import is an amber line under the card.
- **Finished page**: "Shinsa is ready", one line ("Start your first task from Home. You can change any of this in
  Settings."), a Settings card of what was set up (one `SettingRow` each, the answer at the right as
  `max-w-64 text-fg-3 text-xs` `Truncate`) and "Go to Home" (primary, arrow at its end).
- No folder path or other machine-specific value is ever written into the UI code; the ones on screen come from the
  server.
- **Ask before you need it, and never as an error**: a permission the app needs only for some choices (a folder the
  system keeps private) is a card above the list naming it, with the way to allow it, Check again and Leave it out;
  the choices stay as picked, and coming back to the window checks again by itself.
- **Suggest, then let them edit**: what the app can work out (projects from repositories) is shown worked out and
  kept, each row with a name to change and a box to untick, and the primary button counts what will be made ("Create 6 projects").
- Example: Shinsa's five-step setup (Folders, Projects, Defaults, Accounts, Tools).

#### Pick-one and pick-many option lists

A list to choose from is a list card: a `Card` (`gap-0 p-0`) around a `HighlightList` (`flex flex-col gap-px`) of
list rows.

- Row: `LIST_ROW` + `LIST_ROW_LINE` (28px, a label alone) or `LIST_ROW_LINES` (label over meaning, `gap-px`), with
  `ps-2.5 pe-1.5` for pick-one and `px-1.5` for pick-many. Label `LIST_ROW_TITLE truncate`, meaning
  `LIST_ROW_META text-pretty`.
- The recommended option has a quiet `Badge size='sm'` "Recommended" after its label (`gap-1.5`).
- Pick-one: the chosen option is marked with the accent `SelectedMark` (`IconCheckmark1`, `size='sm'`,
  `text-primary-text`, labelled "Selected") in a 20px slot at the row's end (`self-center`), as a select or menu
  marks its value. The recommended option starts chosen, so one Continue keeps it; several pick-one lists can share a
  step, each under its section label, and a click moves only its own list's mark.
- Pick-many: a `filled` `sm` `Checkbox` in the 20px leading slot, the defaults already checked; the last row can be
  an add field (`sm` `Input` + `secondary` `sm` "Add folder" with `IconPlusMedium`, disabled while empty) that adds
  the typed value checked. Continue is disabled with nothing checked.
- The hover and keyboard highlight are the menus' one sliding surface, moving on the movement clock.
- Keyboard: the list is a `listbox` (`aria-multiselectable` for pick-many) that takes focus when the step opens; the
  arrows, Home and End move the highlight via `aria-activedescendant`, Enter or Space picks. These keys belong to the
  list, not the page, so setup runs from the keyboard alone.
- Example: setup's Merging step.

#### Checks lists

A list of checks is a Settings card of rows (`SETTING_ROW` with `gap-2`):

- The outcome icon in a 14px slot: passed `IconCheckCircle2Filled` `text-primary-4`, failed `IconCircleXFilled`
  `text-red-4`, skipped `IconCircleDotted` `text-fg-2`; its tooltip names the outcome in its text tone
  (`text-primary-text`, `text-red-text`, `text-fg-2`).
- The name (`text-fg-4 text-xs`) over its fix as inline markdown (`text-2xs text-fg-3`), `flex-col gap-px`.
- Version or state at the right: `TOKEN_TEXT` + `min-w-0 max-w-1/2 shrink text-end`, truncated.
- An optional check that fails is "skipped", never "failed", and never holds the flow back.
- "Check again" sits in the footer, busy while it runs.
- Example: setup's Tools step.

#### The now card: one frame for every process state

Every waiting or result state of a running process is one card on the same frame, never a new surface.

- Frame: a `section` with `CARD` + `flex flex-col overflow-hidden`. Body `flex flex-col gap-3 p-3`. Top row
  `flex items-start gap-3`: on the left (`flex min-w-0 flex-1 flex-col gap-px`) the eyebrow (`text-2xs text-fg-2`)
  over the title (inline markdown, `font-medium text-fg-4 text-sm leading-tighter`); on the right the actions
  (`flex shrink-0 items-center gap-1.5`), the primary last. Then the body. Then an optional footer (`CARD_FOOTER`).
- Eyebrow: one sentence-case fact per segment, joined by `·` (`flex flex-wrap items-center gap-x-1.5`, each segment
  `whitespace-nowrap`): "Building · Round 2 of 3 · Agent · Started just now". A countdown or arrival time is a live
  relative time.
- Footer note: `flex items-center gap-3 text-2xs text-fg-2`: who takes the next step or what happens, a spacer, then
  quiet links.
- Quiet link: a text button
  `cursor-pointer whitespace-nowrap hover:text-fg-4 active:text-fg-4 disabled:pointer-events-none disabled:opacity-50`,
  disabled while a sibling action runs. Cancel, veto and "not now" actions are quiet links, never buttons.
- Name a retry for what it does: "Allow another 10%", "Allow another $5.00", "Check the Codex sign-in again", not
  "Retry", wherever the action appears (card and command menu).
- One primary at the top right; alternatives are `outline` (Resume now, Check in now) or quiet
  links.
- The variants, with the shape each teaches:

| State | Tone and icon | Title / body | Actions |
| --- | --- | --- | --- |
| Paused (a failure) | orange, Paused group | the gate's title, a link to the agent's last message or the body | Retry (primary, named for what it does); Cancel task as a quiet link |
| Setup incomplete | orange, `IconToolbox` tile | the body (each problem and its fix) as markdown | Verify again (primary); Cancel task quiet. Nothing configured to check is never a setup problem |
| Sign-in needed | orange, `IconUserKey` | the title ("Paused: a@b.com needs signing in", one status for the cause) and body | Sign in (primary); Retry anyway / Cancel task quiet. When the user must act outside the app, the fix on an inset strip with a `CopyButton` and the primary re-checks |
| A wait | blue, "Waiting to check in again" | "The agent is waiting on something outside the repository", the notes (`selectable text-fg-4`) over "Check-in 2 of 10 · gives up in 3 hours" (`text-2xs text-fg-2`) | Check in now (`outline`); eyebrow counts down |
| Waiting on a limit | blue, In progress | "Waiting for usage: continues at 3:40 PM on a@b.com" (when and where it carries on, in one line), the reset in the eyebrow | Resume now (`outline`); "Don’t resume automatically" / "Resume at the reset" quiet |
| A revised plan | | eyebrow "Version 2 · 4 phases", an inset with "You asked" and your words alone, then the plan: "What changed" and the summary right before the goal, a quiet "New" or "Changed" `Badge` `sm` beside each added or reworked phase (the chat's plan card the same) | Approve plan sends the version on screen |
| A proposed change | | eyebrow names who proposes it, title the question, the why, "What it would change" on an inset | Make it a change (primary); "Keep it as an investigation" quiet |
| An operation to run | | the merge line with a mono copyable commit chip, the steps and impact as markdown, one editable notes box | Run the operation (primary); "Finish without it" quiet, behind a confirm |
| A secret request | | eyebrow "The agent asked for the ‹label›", the reason, a password `Input` ("Paste the ‹label›") with Save | footer note "It goes to Shinsa’s secret store. The agent and the chat never see it." and "Don’t give it" quiet |
| A result | status, round, arrival | a title in the agent's words ("Answered your question") over the result as markdown (`text-fg-4 text-xs`) | footer note on who answers a follow-up, "Open the chat" quiet |

- Body text inside a card is markdown at `text-fg-3 text-xs`; numbered steps are `flex flex-col gap-1.5`, each
  `flex gap-2.5`; a sub-heading is `font-medium text-fg-4 text-xs leading-5`.
- A gate that ends the process ("Finish without it") always goes through a confirm dialog.
- One editable box replaces separate "with notes" buttons: the primary sends approval when the box still holds the
  saved text, else the text (an empty box clears it). Toasts say which happened ("Running the operation with your
  notes.").
- Example: the Overview's now card.

#### Inset notes inside a card

A secondary block inside a card sits on an inset: `INSET` + `bg-bg-a1`.

| Use | Classes |
| --- | --- |
| A block of context (a revised plan's "You asked") | `flex flex-col gap-px px-3 py-2.5 text-xs`: the label `text-2xs text-fg-2`, the person's words `selectable text-fg-3`; only their words go here, the agent's summary belongs to the card's body |
| A one-line strip with quiet links | `flex items-center gap-2 px-3 py-2 text-2xs text-fg-2`: icon and sentence (`text-fg-3`, `text-orange-text` once it is serious), a spacer, then quiet links |
| A fix with a command to copy | `flex items-center gap-1.5 py-1 pr-1 pl-2`: the fix as inline markdown (`min-w-0 flex-1 text-fg-3 text-xs`) and a `CopyButton` |

- An inset note never changes the process's status; it informs.
- Example: "No output for 23 minutes" above the live feed (`IconClock`, `fg-3`, orange from 15 minutes) with Snooze
  and Dismiss.
- Say what is happening when you know it: while a tool call is still running the strip reads "A command has been
  running for 23 minutes" with the command's first line in mono (`font-mono text-fg-2`, truncated), not "No output".

#### Choice buttons

Questions with a few known answers offer them as buttons above the free answer box.

- A wrapping row `flex flex-wrap gap-1.5` of `outline` `sm` buttons; a pressed one is `primary` with
  `aria-pressed`. A detail inside a button is `font-normal`, `text-fg-2` (or `opacity-70` on a pressed one): the
  recommended one carries a muted "Recommended".
- One click answers. All are disabled while one is sent.
- The answer box's placeholder becomes "Or write your own answer."
- Example: an agent's question with three suggested answers.

#### A live feed of the latest steps

Show a running process as its last few steps, at a fixed height.

- An `ol` of the last four steps, each `flex h-6 min-w-0 items-center gap-1.25 text-2xs` (24px), so the card holds
  its height once four have arrived and a new step swaps in at the bottom.
- Earlier rows are still: `text-fg-2`, the step's icon in the 20px slot, the verb in `font-medium` in the past tense
  ("Read app.tsx").
- The newest row is `text-fg-4`, carries a blue pulse in the icon slot, names its step in the present ("Reading
  app.tsx") and shimmers while live (`ShimmeringText`). "Starting" before anything has happened shimmers too.
- A parked process (waiting on others or on an answer) holds still: no shimmer.
- Example: the live feed in the now card while an agent builds.

#### Settling states: say "working it out", never flash a guess

While the system has not settled what a process will look like, show one neutral line instead of a provisional
structure.

- The card's footer is a `Spinner` and "Working out the steps", with why in its tooltip; facts that depend on it name
  nothing yet (a dotted circle, "Kind not chosen yet").
- Example: a task that becomes a plain answer never flashes the plan-to-merge progress strip.

#### Stage strips that fold their labels

A progress strip lists only the steps this process takes, in order, and stays on one line.

- Steps are 16px marks (done: `grid size-4 shrink-0 place-items-center rounded-full bg-green-4/29` with a
  `text-green-text` check, the one green check in Shinsa: every other checkmark is the accent; current: `bg-primary-a3` with a blue pulse; waiting on you: `bg-amber-a3` with a `size-1.5 rounded-full bg-amber-4` dot; skipped:
  `IconCircleDotted` `text-fg-2`; not reached: `size-4 rounded-full border border-bg-a3`), joined by
  `h-px min-w-2 flex-1` connectors (`bg-green-4` once the step is done or skipped, else `bg-bg-a3`) in
  `flex w-full min-w-0 items-center gap-1.5`.
- A strip of more than 6 steps (the Pre-merge and Post-merge steps count twice, for their long labels) folds the
  labels of done and skipped steps below `lg`; one of more than 8 folds them at every width, so both fit a 900px and a
  1280px window. A folded step keeps its label in its tooltip.
- Show a step only when it applies (no "Find the repository" for work with no repository, and no copy about one).
- Example: Answer, Research, Your OK to change, Plan, Build, Checks and agent review, Your review, Pull request, Merge.

#### Panels under the main card

Secondary sections of a page are `Panel`s stacked under the main card.

- `section` with `CARD` + `flex flex-col overflow-hidden`; header a `band` disclosure with a `box` chevron and
  `CARD_HEADER`: the icon at `size='sm'` in the 20px slot, the title, an optional count
  (`shrink-0 font-normal text-fg-2 tabular-nums`), optional meta at the right (`ms-auto shrink-0 ps-3`, "2 working · 1
  done"), an optional action. Body `flex flex-col gap-3 border-border border-t p-3`. Open state persists; opens by
  default.
- A list in a panel is `flex flex-col divide-y divide-border` with items `py-2 first:pt-0 last:pb-0`.
- A suggestion row: title (`font-medium text-fg-4 leading-5`) over why (`text-fg-3`), `gap-px text-xs`; at the right
  (`flex shrink-0 items-center gap-1.5`) a `ghost` `sm` select of when to start (the agent's pick first, preselected
  and marked Suggested), then Dismiss (`secondary`) and Add (`outline`).
- Order: the main card, then panels about what is happening now, then history (Rounds after What changed, before
  Activity), never above the answer.
- Never two cards for one result: a result shows in the main card; a result panel shows only while the main card
  shows other work.
- Example: the Suggested tasks and Delegations panels under the now card.

#### Nested live children: a spawn card

A child process started from inside a conversation lives where it was started, as a card, never as a section of its
own.

- A 36px row (`flex h-9 min-w-0 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 text-xs`): a status mark (a pulse
  in the status tone while it works or waits, amber while it waits for an answer; once ended, the check outcome
  icon), the role in `fg-2`, the title in `font-medium text-fg-4`, the status in its tone with a running duration, a
  `secondary` `icon-xs` Stop (×) while live, and the chevron box last on the 7px trailing inset. The whole row folds.
- Stop's tooltip and `aria-label` say exactly what stops ("Stop “‹title›” and what it delegated").
- An open question sits under the row on a hairline; opening the row shows the child's own conversation, its own
  children nested the same way.
- Its end is a chat line: "Reported back: ‹title›", "Failed: ‹title›", "Stopped: ‹title›".
- In a summary panel, children are indented under their parent with `IconArrowCornerDownRight`.
- Example: a Reviewer delegated from a build step.

#### Notice lines in a conversation

System events in a conversation are one-line rows on the chat line anatomy: the label says what happened, the meta
the value, opening it shows the reason.

- Each kind has one icon and fixed words: "Account switched · a@b.com" (`IconArrowsRepeatRightLeft`), "Conversation
  compacted" (`IconBubbleText`), "Fast mode unavailable" (`IconSpeedMiddle`), "Loaded 4 MCPs, 23 skills, 3 plugins ·
  ~38k tokens" (`IconBlocks`, kinds with none left out; opened, each group's items one per line, biggest first, 8 per
  group then "and 12 more"), "Conversation handed over · Codex" (`IconArrowsRepeat`).
- Events another surface already shows are kept in the record but not drawn (a rate limit the usage menu shows).
- Example: an account switch mid-run.

#### Rounds and progressive structure

Structure that only matters once there is more than one of something stays invisible until then.

- Nothing about rounds shows until a second round exists; then every round, the first included, gets a divider, so
  scrolling to the top lands on a label.
- One icon for the concept on every surface (`IconArrowsRepeatCircle`).
- A divider in a conversation is a `separator` named "Round 2 · ‹title› · In progress":
  `flex h-5 min-w-0 items-center gap-2`, the first `mt-2 mb-2`, later ones `mt-7 mb-2` (20px more, so a round break
  reads stronger than the space between two runs). Inside: the icon (`text-fg-3`) in the 20px slot and one line
  `inline-flex h-5 min-w-0 max-w-full cursor-default items-center gap-1.25 text-fg-2 text-xs`: "Round 2"
  (`font-medium text-fg-3 tabular-nums`) · the title (`truncate`) · the status in its tone; then a hairline
  `h-px min-w-6 flex-1 bg-border` to the column's edge. Its tooltip (on the text only): "Round 2: ‹title›" over when
  it started or ended.
- The divider carries nothing the header and summary panel already say (no pull request, no progress).
- In a summary panel, one disclosure row per round (`gap-2 text-xs`): the icon as a 20px status tile, "Round 3"
  (`shrink-0 font-medium text-fg-4 tabular-nums`), the title (`fg-3`, `Truncate`, `fg-4` on the row's hover), the
  status in its tone (`text-2xs`), the chevron (`text-fg-3`), and at the right its pull request tile and a `ghost`
  `sm` select while a choice is open. Opened: `flex flex-col gap-1.5 ps-7 pt-1.5`, a summary (`text-fg-3 text-xs`),
  then a quiet "Open in chat" with `IconChevronRightSmall` at `size='sm'` after it
  (`flex cursor-pointer items-center gap-1 self-start text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4`).
- A header fact: "Round 2 of 3" with the icon; its tooltip has the round and its title, a line with a 16px tile and
  the status in its tone, and the time muted at the right in sentence case ("Started just now", "Finished 2h ago").
- Example: a task with four rounds.

#### Loading lines and empty states

- A loading line is a `sm` `Spinner` and a label (`flex items-center gap-2 text-fg-2`) shown only after 300ms; until
  then it is `invisible` (taking its space) so a fast answer never flashes a spinner. A larger wait uses a `lg`
  spinner alone with its label as `aria-label`.
- Never say "none" before the data has arrived: hold a loading row until then ("Checking the versions…", "Reading
  which MCPs and skills agents used…").
- An empty card holds one sentence and, when there is one, the action that fills it ("No MCPs yet.").
- A search with no match shows "Nothing matches." alone (`px-1 text-fg-2 text-xs`), with every non-matching section
  hidden.
- An empty state that is good news says so ("Agents used everything turned on here.").
- Example: Settings → Agents → Versions before the first read.

#### Settings search

A full-width `Input type='search'` at the top of a long settings page ("Search MCPs, plugins and skills"), kept in
the URL (`?q=`). Every word must appear in the item's searchable fields. While it holds text, recommendations are
hidden, sections without a match are hidden, every group that matches opens, and "Nothing matches." stands alone when
nothing does.

#### Status-grouped resource lists

A long list of resources with health states is grouped by status, each group a folding block.

- Groups in order of what needs attention, each with its icon at `size='sm'` in its tone, no background:
  Connected (green, `IconApiConnection`), Needs sign-in (orange, `IconUserKey`), Failing (red, `IconCircleX`), Not
  checked yet (neutral, `IconCircleDotted`, only while a check is due), Off (neutral, `IconCircleMinus`). Title, tone
  and icon come from one table on the shared tones. A healthy group never takes a checkmark (that is the accent's).
- Groups that need attention start open; quiet groups start open only when the whole list is short (six items or
  fewer).
- A problem reading the list is a quiet warning row first:
  `flex min-h-8 items-start gap-1.5 py-1.5 text-2xs text-fg-3` + `ROW_INSET`, `IconExclamationTriangle`
  `mt-px text-orange-text`.
- Example: Settings → Integrations → MCPs.

#### Resource rows with details inside

One row per resource, whatever number of places define it, with its details opening inside the row.

- Row: `SETTING_ROW` with `gap-1.5`. The left part is the details toggle
  (`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-xs hover:text-fg-4 active:text-fg-4`):
  the section chevron, the name (`Truncate`, `min-w-0 shrink-0 font-medium text-fg-4`), its sources
  (`min-w-0 truncate text-fg-2`, every file in the tooltip). Then its cost in `TOKEN_TEXT` (`hidden sm:inline`), a
  primary `xs` action when one is needed now ("Connect"), the `Switch`, and the `•••` menu.
- What it costs, or plainly why it can't say: "~4.2k tokens", "Sign in to measure", "Can’t measure while failing",
  "Checking…", "Not measured while off", "Loads when needed · ~4.2k tokens". Never a blank.
- Details sit inside the row, indented to the name, with no surface of their own:
  `flex flex-col gap-1.5 pr-2 pb-2.5 pl-7`: an error in `text-2xs text-red-text break-words`, then a grid of names
  (`grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-1`, each `font-mono text-fg-3 text-xs
  truncate`, its description as tooltip) or one quiet line saying why there are none, and last one `text-2xs text-fg-2`
  line of notes joined by " · ", whose tooltip is the full command or URL.
- A switch that only affects Shinsa says so in its tooltip and in the toast when turned off ("Only for Shinsa’s
  agents. Claude Code and Codex keep their own settings.").
- Example: an MCP row.

#### Recommendations with a fix per row

A recommendation section shows switches for the policy, then a block of what the policy would act on.

- Policy rows: a `Switch` row, a `SelectField` row (`w-28`; the current value added when it is not in the list), a
  second `Switch` row. The title's tooltip explains the effect.
- Then a block headed by a 32px header (`font-medium text-2xs text-fg-2`, "Not used lately") over a shelf of at most
  five rows, costliest first: name (`font-medium text-fg-4 text-xs`), the reason and cost (`text-right text-2xs
  text-fg-2 tabular-nums`), and a `secondary` `sm` fix ("Turn off"), or "Loads when needed" in `TOKEN_TEXT` once the
  policy handles it. Many small items fold into one row ("37 skills").
- Example: the context optimizer.

#### Windowed long lists

A list that can hold hundreds of rows renders only the rows in view.

- Fixed row height (40px in Settings, 36px in All tasks); a spacer as tall as the list
  (`relative`, `height: count × rowHeight`); each visible row `absolute inset-x-0` at `top: index × rowHeight`;
  measured against the page scroller, re-measured on scroll, resize and content resize. Rows beyond the view are
  kept as margin: eight on each side in Settings; twelve in All tasks, with the window snapped to blocks of eight rows.
- Windowed rows draw their own separators (`border-border border-t` on all but the first) since `divide-y` cannot
  see them.
- Reason: a `Card` is `overflow-hidden` with a superellipse corner, so its children's compositor layers are clipped
  with a mask the size of the card, and a card taller than the GPU's largest texture (16,384px, about 400 rows) loses
  the mask: past it, rows and switches did not paint. So no card may grow that tall, and the `Switch` knob does not
  ask for a layer (no `will-change: transform`).
- Groups of such rows start closed, with "3 of 12 on · ~4k tokens" as their detail.
- Example: Skills, one folding group per source.

#### Signing in through another tab

- Open a blank tab on the click itself (so the browser allows it), then point it at the server's page.
- Watch until the server reads as done: on a `BroadcastChannel` message and a `window.opener` post from the callback
  page, whenever the window gets focus or becomes visible, and every 2 seconds for up to 2 minutes.
- Confirm with a toast ("Signed in to ‹name›.").
- Example: Connect on an MCP that needs a sign-in.

#### Toasts

- After every action a toast says what happened, in a full sentence ending in a full stop ("Kept in this task. It
  starts as the next round.", "Running this step again on a@b.com.", "Finished without running the operation.").
  The same action from a card, a menu or the command menu gives the same toast, from one table.
- A long-running action opens a loading toast titled with the action ("Updating Claude Code") whose description is
  the first line of what runs ("Running claude update.") and then each line of output as it prints; it settles in
  place into the outcome: success ("Updated Claude Code to 2.1.310.") or the failure as an error.
- A server refusal is an error toast with the server's message; the user's input stays.
- A toast that warns about a consequence outside the app says what to do ("take the login out of claude-swap,
  since refresh tokens are single-use").

#### Banners at the top of the page

A problem with the app itself is a one-line card at the top of the page column, never a modal.

- Placement: `PAGE_COLUMN` + `shrink-0 pt-3` (12px above the page), once, in every layout.
- Card: `CARD` + `flex min-w-0 items-center gap-2 py-1.5 ps-3 pe-1.5 text-xs`, `role='status'`: a 14px icon
  (`IconExclamationTriangle` `text-orange-text` when the user must act, `IconArrowsRepeat` `text-fg-2` while it
  waits), one `fg-3` sentence (`min-w-0 flex-1`), then a quiet "Details" (`shrink-0 text-fg-2 hover:text-fg-4 active:text-fg-4`) that opens an
  info popover (`w-80`, a header and one info row per problem), and a `secondary` `icon-xs` dismiss (×) with a
  tooltip.
- A banner that needs an action has `sm` buttons at the end instead of a dismiss, the last one `primary` as macOS
  orders them: one alone is primary; of two, the first is `secondary` and the last `primary`. It goes away when its
  cause does.
- Dismissing hides it for the session, until the problem changes.
- Example: "Shinsa skipped 2 damaged entries in its log at start. Everything else loaded."

#### Something new in the toolbar

A control that appears because something became available (a downloaded update) fades and scales in
(`fade-in-0 zoom-in-95 animate-in duration-200`), as a `primary` `sm` button in the header's trailing group, with a
tooltip saying what it does and what to expect ("only the app restarts: agents keep working"). Nothing
shows before it is ready.

#### Rows for updatable things

A row per installed program: the name (`fg-4`), the version in `TOKEN_TEXT`, and only when there is something to
say a status in its tone ("Update available" blue, "Update needed" orange, others `fg-2`), over one `text-2xs fg-2`
line ("Latest 2.1.310 · Shinsa needs 2.1.280 or newer"). A `secondary` `sm` Update (`IconArrowDown`) at the right
only when it is behind, busy while it runs. Something the app cannot update at runtime has no button.

#### Attention signals

- The tab title carries the count of decisions waiting: "[n] Shinsa", "Shinsa" otherwise, with the item on screen
  before the name ("[2] SW-142 Fix login · Shinsa").
- Sounds are Web Audio oscillators, never an `<audio>` element, so they never take the media keys. One chime per
  burst (repeated up to three times for several); one notification per decision.
- A notification is the item's title over the pending question, on one line, cut at 180 characters with `…`; a
  secret request names only what it asks for. Clicking it focuses the window and opens the item.
- Nothing chimes on the first load, for something outside the focus, or for something that only came into view
  because the focus changed. While the desktop app is connected, browser pages stay quiet.
- A test button (`secondary` `sm`, `IconPlay`) plays the sound and, when notifications are allowed, shows a test
  notification; its tooltip says which it will do.
- Turning notifications on asks the browser first, and stays off with a toast when it is blocked.

#### Acting on the user's behalf

An entry an agent caused through its management tools reads "‹handle› agent (on your behalf)" (the quoted title until
it has a handle), a link to the acting task, and "Shinsa (on your behalf)" when no task is named. Its tool calls show
in its turn like any tool, folded with the other Shinsa tools as "Used 2 Shinsa tools".

#### A task's cost

A task's cost shows in one place only: the cost control in its facts row, the unit's icon and the amount (a gauge icon
and "1.8%" on a subscription, a coins icon and "$18.55" on an API key), whose popover on hover holds the rest. No other
surface repeats it: not a now card, a run or round divider, a task row, an activity entry, the review, a preview card
or the command menu. An account's usage (its weekly window, in the top bar's usage menu and Settings) is not a task's cost and
stays. A limit's gate names the limit it reached, never what the task spent.

In that popover the cost is in one unit: its share of the weekly window when it ran on a subscription ("1.8% of the
weekly limit"), dollars on an API key, a provider with no weekly window or an account whose rate is still being
learned ("$1.75"). The other unit goes in the line under the popover's header ("$4.31 and 8.2M tokens,
as estimated by the agent provider."), never beside the total as a second number. A share is an estimate, said once
and quietly in that same line ("The share is learned from 12 tasks on this account."), never as a badge. It follows
the account's current rate, so it can move a little as the rate improves. Shares show a tenth below 10% ("0.4%") and whole percentages above.

A cost that cannot be priced reads "Unknown", or "$0.30 + unknown" for a partial, never "$0". A cost against a limit
names both ("$1.75 of $5.00", "12% of the weekly limit, 10% allowed"). A cost past its limit turns the icon orange.

### 11.4 The desktop window, code, review, navigation, errors, selection and folding

These patterns cover the desktop window, the code workbench, how code and diffs are shown, the report layout for a technical review, navigation speed, loading, terminals, error containment, text selection and remembered disclosure. They follow the same rules as the rest of the system; where a value repeats a token defined elsewhere, the class is used as written.

#### Desktop app: the same page in a native window

**Rules**

- The desktop app is a thin native shell that loads the same web UI from the local server (`http://127.0.0.1:7446` by default). The app window, a browser tab and the floating companion window always show one version of the UI; the companion stays the small floating window and the app is the full one.
- The page learns it runs in the app only from a preload bridge object on `window` (`window.shinsaDesktop`). A browser and the floating window have no bridge, and nothing in the desktop patterns below applies there.
- On start, the page sets `data-desktop` on `<html>` to `window`, or `fullscreen` while the window is full screen (the traffic lights are gone), and keeps it in sync with the bridge's window-state events.
- A Tailwind custom variant holds every desktop-only adjustment:

```css
@custom-variant desktop (&:where([data-desktop="window"] *));
```

  It matches only `window`, so in full screen the room kept for the traffic lights disappears with them.
- Marketing demos that never have the bridge may ask for the app's look through a React context (`DesktopChrome`) and render the bar at the demo's route; nothing else reads it.

**Why.** One build, one version everywhere; the desktop look is opt-in by a single attribute, so a browser never inherits native-only behaviour.

**Do** branch on `data-desktop` / the `desktop:` variant. **Don't** sniff the user agent or ship a second UI bundle for the app.

**Example.** The Cards layout's top bar is `desktop:ps-16` so its first control clears the traffic lights in the app, and starts at its normal inset in a browser or in full screen.

#### Window chrome: the title bar is the top bar

**Rules**

- There is no separate title bar. The traffic lights sit inset over the 44px top bar, vertically centred on it.
- Room for the traffic lights, by bar:

| Bar | Class |
| --- | --- |
| Top bar of the card layout | `desktop:ps-16` (64px) |
| Sidebar rail header | `desktop:ps-20` (80px) |
| Sidebar compact bar | `desktop:ps-20` (80px) |

- A bar that should drag the window carries `data-window-drag`. Inside it, controls stay clickable. The CSS:

```css
[data-desktop] [data-window-drag] {
  -webkit-app-region: drag;
}

[data-desktop] [data-window-drag] :is(button, a, input, [role="button"], [role="status"]),
[data-desktop]
  :is([data-sonner-toaster], [role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"]) {
  -webkit-app-region: no-drag;
}
```

  `[role="status"]` keeps a live indicator (the reconnecting dot) clickable and hoverable. Toasts, dialogs, menus, listboxes and tooltips never drag, even when they overlap a drag bar.
- Drag bars are chrome: never selectable, so a drag across them never selects text (see "Text selection"). Content under them (chat, overview, code) stays selectable.

**Why.** A Mac app's toolbar is its title bar; dragging anywhere empty in it must move the window, and nothing interactive may be swallowed by the drag region.

**Do** mark the whole bar and rely on the `no-drag` list. **Don't** put `-webkit-app-region` on individual elements by hand, or let a popup inherit `drag`.

**Example.** The rail header in the sidebar layout: `data-window-drag`, `desktop:ps-20`, its buttons and the connection dot still respond to the pointer.

#### Toolbar identity: a Home control, not the wordmark

**Rules**

- A native toolbar carries controls, not the product's name (the menu bar and Dock already name it). In the app the wordmark's slot becomes a Home button; in a browser and the floating window it stays the wordmark link. This applies in the top bar, the rail header and the compact bar alike.
- The Home button is the same nav button as its siblings: `secondary`, size `sm`, icon `IconHomeRoundDoor` and the label "Home". On the Home page itself the icon is `IconHomeRoundDoorFilled` in `fg-4` with `aria-current="page"` (the filled-icon rule for the current place). Tooltip: "Home ⇧⌘H".
- Optical spacing in a toolbar: every adjacent pair is 19px apart measured between what each control draws (glyph or text), not between boxes. To get there:
  - the wordmark, which has no padding of its own, keeps `me-2` (8px) after it;
  - an icon-only button next to labelled buttons keeps `me-0.5` (2px) more after it, because a square icon button pads its glyph less than a labelled button does.
  - Verified from pixels at 1440px and 900px wide, light and dark, browser and app: every gap 19px (one tolerated 18px in the browser between two specific controls).

**Why.** Equal visual gaps read as one row of peers; box gaps lie when paddings differ.

**Do** measure gaps between drawn ink and compensate with small end margins. **Don't** show a product logo in the app's own toolbar.

**Example.** Top bar, left to right: Home (app only), Tasks, Services, the queue; right side: Settings (icon-only, `me-0.5`), usage, Focus. All 19px apart.

#### Native menus, window behaviour and app keys

**Rules**

- The menu is the OS's own: Settings… ⌘, (opens settings) and Restart Engine in the first menu; View has Reload ⌘R, zoom and full screen; Go has Back ⌘[, Forward ⌘] and Home ⇧⌘H, as in Finder and Safari. No other app-level shortcut.
- A menu bar (status) item shows while the app runs: the product mark as a template image with the count of decisions waiting beside it, and a menu with the engine's state, what needs you and what is working (each task opens its page), Open and Quit, Quit saying the engine and its agents keep running.
- Back and Forward step through the page's own history and never onto the engine's waiting page.
- A focused code editor keeps ⌘[ and ⌘] for outdent and indent: the page sees the key before the menu does.
- Closing the window hides it; the page keeps its socket, so badges and notifications continue. The Dock icon or Window → (app name) brings it back. ⌘Q quits the app and never stops the background engine.
- Window size and position are kept and restored onto a connected display; default 900 × 1100.
- The app is named the product everywhere the OS shows a name (menu bar, first menu: About, Hide, Quit; About panel; Dock; notifications), in development too: dev runs a renamed copy of the Electron bundle so the OS reads the right bundle name.

**Example.** ⌘[ in the Code tab's editor moves the line one indent left; ⌘[ anywhere else goes Back.

#### Notifications: only one surface notifies

**Rules**

- In the app, the page never creates a browser `Notification` (the app denies that permission). It hands the decision to the app, which shows a silent native notification (the page plays its own sound); clicking it shows and focuses the window and opens the item.
- Default "Show a notification": "When the app is in the background" in the app, "Never" in a browser. The browser permission is never requested.
- Every page announces its surface on connect (`desktop` or `browser`; the floating window counts as browser). The server tells every page whether the app is connected. While it is, browser tabs and the floating window stay quiet: no sound, no notification. Title count and the companion's meta tags (`floaty:badge`, `floaty:status`) keep updating.
- The notification settings in a browser then show one line instead of their rows: "The Shinsa app is open and handles notifications, so this page stays quiet."
- When the app quits, the next decision rings in the browser again; decisions raised while the app was open never ring later.
- Dock badge = the tab's attention count; clears at 0 and while the server is unreachable.

**Why.** Two surfaces chiming for one event is noise; the native one wins.

**Example.** An agent needs input while both the app and a browser tab are open: only the app notifies; the tab's title still starts with "[1]".

#### Deep links

**Rules**

- An app URL scheme opens inside the window, from any other app or from inside the page: `shinsa://task/LOC-4` (a handle or id) opens the task, `shinsa://tasks`, `shinsa://settings` and `shinsa://` their pages, anything else Home.
- Links to other sites open in the default browser, never inside the app window.

#### Startup and engine status page

**Rules**

- The app starts its own background engine, so there is no setup dialog. While it starts, the window shows one quiet page titled "Starting Shinsa", with a 13px spinner before the title and one sentence under it ("Shinsa’s engine is starting. It keeps running in the background, also when this window is closed.").
- When the engine cannot run, the same page states why and offers the fix, the first button `primary`:

| Problem | Buttons |
| --- | --- |
| Allow Shinsa to run in the background | Open Login Items, Try again |
| Port 7446 is taken | Start engine, Copy details (the sentence says to quit the other program or set another `port` in Shinsa's config) |
| The engine keeps stopping | Start engine, Copy details; the engine log's warnings and errors under them |
| The engine is not running | Start engine, Open Privacy & Security, Copy details |

- The page opens the app UI by itself as soon as the engine answers, and the window switches back to this page if the engine stops answering for 15s while you work (checked every 5s, three misses in a row).

**Do** state the cause and the one action that fixes it. **Don't** show a blocking modal or ask the user to run a command.

#### Cursors in the desktop app: no pointer hand

**Rules**

- In a browser, clickable elements show `cursor: pointer` (kit base rule). Inside the app (`html[data-desktop]`) every element a browser would give the hand gets the arrow instead, as on macOS: buttons, links, tabs, rows.
- The override is `!important` so it beats utilities, kit rules, inline styles and third-party style sheets, and it stops at any other cursor utility. Full rule:

```css
html[data-desktop]
  :where(
    button, select, summary, label[for],
    input[type="checkbox"], input[type="radio"], input[type="file"],
    [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"],
    [role="menuitemradio"], [role="option"], [role="switch"], [role="checkbox"],
    [role="radio"], [role="link"], [role="treeitem"],
    a[href], area[href], .cursor-pointer,
    [style*="cursor: pointer"], [style*="cursor:pointer"],
    .cm-foldGutter span, .cm-foldPlaceholder, .cm-collapsedLines,
    .cm-tooltip-autocomplete li, .cm-diagnosticAction
  ):where(
    :not(
      :disabled, [aria-disabled="true"], [data-disabled],
      .cursor-default, .cursor-text, .cursor-move, .cursor-grab, .cursor-grabbing,
      .cursor-col-resize, .cursor-row-resize, .cursor-ew-resize, .cursor-ns-resize,
      .cursor-zoom-in, .cursor-zoom-out, .cursor-not-allowed, .cursor-wait,
      .cursor-progress, .cursor-help, .cursor-crosshair
    )
  ),
html[data-desktop]
  :where(
    a[href], area[href], button, label[for], summary,
    [role="button"], [role="tab"], [role="link"], [role="option"],
    [role="menuitem"], [role="treeitem"], .cursor-pointer
  )
  :where(
    :not(
      input, textarea, [contenteditable]:not([contenteditable="false"]),
      .cm-content, .cm-content *,
      .cursor-text, .cursor-grab, .cursor-grabbing, .cursor-col-resize, .cursor-not-allowed
    )
  ),
html[data-desktop] :where(a[href], button, [role="button"], .cursor-pointer)::before,
html[data-desktop] :where(a[href], button, [role="button"], .cursor-pointer)::after {
  cursor: default !important;
}

html[data-desktop] :where(:disabled, [aria-disabled="true"], [data-disabled]) :where(*) {
  cursor: inherit !important;
}

html[data-desktop] body[style*="col-resize"],
html[data-desktop] body[style*="col-resize"] *,
html[data-desktop] body[style*="col-resize"] *::before,
html[data-desktop] body[style*="col-resize"] *::after {
  cursor: col-resize !important;
}

html[data-desktop] body:has([data-slot="slider-thumb"][data-dragging]),
html[data-desktop] body:has([data-slot="slider-thumb"][data-dragging]) * {
  cursor: grabbing !important;
}
```

- Every other cursor is kept: text and inputs the I-beam; a resize handle, and the whole page while a pane is dragged, `col-resize`; draggable things `grab`/`grabbing` (the whole page while a slider is dragged); `zoom-in` images the magnifier; a disabled control `not-allowed`, including everything inside it.
- A browser and the floating window keep the pointer hand.
- A test renders the kit's clickable controls under the app attribute and fails if any computes `pointer`, or if text, resize, grab or not-allowed is lost.

**Example.** A task row in the app shows the arrow on hover and still washes; the same row in Safari shows the hand.

#### Native scroll feel

**Rules**

- In the app the page root never rubber-bands: `overscroll-behavior: none` on `html[data-desktop]` and its `body`. A scroller inside still bounces like any Mac list.
- No focus rings anywhere (system-wide rule). Navigation is instant (see "Instant navigation").

#### Workbench layout: explorer column plus editor

**Rules**

- A code workbench is two parts: an explorer column and the editor. No editor tabs: one file is open at a time; you switch from the file list, a review link, a search result or the go-to-file dialog.
- Explorer side: left by default; a setting (also a ⌘K command, "Move the file list to the right") puts it on the right. Remembered in `localStorage` key `shinsa.code-explorer-side`.
- Explorer width: 280px default, resizable 200 to 480px by the same handle the sidebar rail uses, on whichever edge faces the code; width kept in `shinsa.code-explorer-width`. Its floor is never narrower than its header row needs: the explorer measures its mode tabs and search button at natural width and adds the row's padding, so the search button never covers a tab, whatever the modes or the font.
- Below `md` (767px and narrower) the explorer is a sheet opened from the toolbar's "Show the files", closed by picking a file, Escape or a click outside.
- The editor pane: a 36px `Toolbar` (file icon, path, diff counts, "Saving…" while an edit is in flight, and on a diff the layout toggle), then the code. No "Open in editor" button in the toolbar: the workbench is where you read and edit (the external-editor action lives in ⌘K and the task's menu).
- Explorer header: the mode `Choice` (for example Changes, Files; a single mode shows as its plain label), the search button (`icon-sm`, shown pressed while search is open), then under them a ref picker: `SelectField` size `sm`, full width. Ref options: Head of the branch (or the default branch's name), Working copy (only while the worktree exists; its hint says whether there are uncommitted edits), Base, and every earlier commit by its subject with its short id as the hint.
- The chosen ref is the "after" side of everything in the workbench: trees, files, search and diffs (base against it).
- The workbench opens on Changes when the task has changes, else on Files (the repository at its default branch).

**Example.** A task with edits opens the Code tab on Changes, explorer left at 280px, ref Head of the branch.

#### Instant interaction inside a workbench

**Rules**

- A tree row acts on mouse press, not release (a file opens, a folder opens or closes). Touch and the keyboard still act on click. Implementation: on `pointerdown` with `pointerType === 'mouse'`, primary button, no ⌘/Ctrl/Shift, run the action and swallow the following click.
- Nothing in the workbench animates: hover and selected backgrounds, indent guides, chevrons and kit buttons inside it change in the frame they are asked to. The workbench root carries:

```ts
const INSTANT =
  '[&_*:not([data-motion=move])]:transition-none! [&_*::before]:transition-none! [&_*::after]:transition-none!';
```

- The one exception is a sliding tab indicator: the kit marks every `Tabs` indicator `data-motion="move"`, `INSTANT` skips it, so a tab pill still slides on the movement duration while its colours change instantly.
- Turn off pseudo-element transitions with the `[&_*::before]` arbitrary variant, never the `before:` variant: `before:` also gives every element an empty `content` box, which becomes a flex item and pushes rows apart.
- Instrument opens and toggles with User Timing marks (for example `shinsa:code-open` / `shinsa:code-shown`, `shinsa:tree-toggle` / `shinsa:tree-toggled`).

**Why.** A workbench is a tool used hundreds of times an hour; any easing reads as lag.

**Do** keep the tab indicator's slide. **Don't** add `transition-colors` to a row inside the workbench.

**Example.** Clicking a folder in the Files tree flips its chevron and shows its rows in the same frame the button goes down.

#### Compact tree rows

**Rules** (shared by every tree: changes, files, search results)

| Property | Value |
| --- | --- |
| Row height | 22px (`h-5.5`) |
| Text | `text-2xs` |
| Start padding | 4px plus 8px per depth level (inline style `paddingInlineStart: 4 + depth * 8`) |
| End padding | `pe-1.5` |
| Chevron slot | 14px (`w-3.5`), empty for a file so a level's icons share one column; `IconChevronDownSmall` at `sm`, `-rotate-90` when closed, no transition |
| Icon | 14px (`size='sm'`) |
| Name | `ms-0.5`, `gap-1.5` to trailing items |
| Corner | `corner-superellipse/1.125 rounded-control-sm` |
| Rest | `text-fg-3` |
| Hover | `hover:bg-bg-a2 active:bg-bg-a2` |
| Selected (open file) | `bg-primary-a1 text-fg-4` |
| List | `flex flex-col px-1 py-1` (4px in from the column) |

Row class:

```tsx
'corner-superellipse/1.125 relative flex h-5.5 w-full shrink-0 cursor-pointer select-none items-center gap-1 rounded-control-sm pe-1.5 text-2xs outline-none'
```

- Hover and selected must never look the same (`bg-bg-a2` vs `primary-a1`).
- Indent guides, as in VS Code: a 1px absolutely positioned line under each ancestor's chevron (at `4 + level * 8 + 7 - 1` px from the start), `opacity-0` until the pointer is anywhere over the explorer column (`group/tree` on the column, `group-hover/tree:opacity-100`, shown at once), colour `bg-bg-a4`. The guide of the folder holding the open file is `bg-fg-1`, one step stronger, over that folder's rows only.
- Rows are `role='treeitem'` with `aria-selected`, `aria-expanded` for folders, `tabIndex={-1}`, Enter opens.
- Chains of single folders collapse into one row (`apps/web`). Folders sort first.
- Long trees are virtual lists of 22px rows; only rows in view render.

**Example.** The Changes tree at depth 2: 20px start padding, guides appear when the pointer enters the column, the open file `primary-a1` with `fg-4` text.

#### File and folder icons

**Rules**

- Every file reference (trees, review spots, search results, go-to-file, the editor toolbar, every file link) carries a file icon drawn at `sm` (14px) as a normal `Icon`.
- Resolution order: well-known names first (package.json, lockfiles, tsconfig, Dockerfile and compose files, `.gitignore`, README, LICENSE, CHANGELOG, CLAUDE.md with Claude's mark, AGENTS.md as a purple sparkle meaning agent instructions, `.env*`, tool configs, test files), then the extension, then a plain page `IconFileText`.
- Icon sources: the icon set's own language marks (TypeScript, JavaScript, React, Markdown, Rust, Swift, Java, PHP, C++, Vue, Svelte, npm, Git); glyphs for the rest (`{}` JSON, `#` CSS, `</>` HTML, console for shell, key for `.env`, lock for lockfiles, test tube for tests, gear for configs); custom marks for Python, Go, Docker and databases.
- A mark that helps tell languages apart carries a soft pastel tint, `--file-<tint>` (fifteen tints kept apart from the tone ramps; mid-light in the light theme, lifted and less saturated in dark, for example blue `oklch(0.63 0.13 260)` light and `oklch(0.76 0.1 262)` dark):

| Tint | Used for |
| --- | --- |
| blue | TypeScript, tsconfig |
| gold | JavaScript, `.env` |
| azure | React, Docker |
| yellow | Python |
| cyan | Go |
| orange | Rust |
| amber | JSON, SVG |
| purple | CSS |
| coral | HTML, Swift, Svelte, Git |
| slate | Markdown |
| pink | YAML |
| green | shell, tests |
| teal | Vue, databases |
| indigo | PHP, C |
| red | Java, npm, PDF |

  Everything else draws in the row's icon ink.
- Each tinted mark's colour is written as `var(--file-icon-ink, var(--file-<tint>))`, so a row that sets `file-icons-muted` (which defines `--file-icon-ink`) draws even tinted marks in its ink.
- Folders: closed solid (`IconFolder1Filled`), open outlined (`IconFolderOpen`). Folders that say what they hold use a tinted folder glyph (solid while closed): `src`/`lib` blue, tests green, docs azure, `scripts`/`bin` gold, assets purple, `.git`/`.github`/`.husky` coral.
- Outside the code workbench (for example a terminal's place menu), folders use plain icons in the row's grey ink, never these tinted marks.

**Example.** A viewed `index.ts` in the Changes tree draws its TypeScript mark in `icon-1`, not blue.

#### Go-to-file dialog

**Rules**

- ⌘P opens the command dialog over every path at the current ref.
- Ranking: names containing the query first, then word starts, then consecutive letters. Matched letters in `primary-text`; the folder as the hint; with no query, the open file first.
- The path list is read when the workbench opens, not when ⌘P is pressed.

#### Code search field with toggles

**Rules**

- One search field shared by file search, the in-file find bar and terminal find.
- Toggles inside the field's right end: Match case (`IconTitleCase`), Match whole word (`IconWholeWord`), Use a regular expression (`IconRegex`); `icon-xs` buttons with 14px glyphs.
- Off: the field's quiet ink. On: `primary-text` on a `primary-a2` fill, so the state reads without hovering.
- File search adds a "Files to include" pattern, a one-line summary ("12 results in 4 files." plus whether it stopped early) and matches grouped under a collapsible row per file, the match marked `amber-a2`. A result opens its file at its line.
- A search runs 250ms after the last keystroke. Search streams: matches show as found, the summary line when it ends. The last results stay on screen while the next search runs, with "Searching" under the field only after 300ms.
- Search result groups are not remembered (they are new with every query).

#### Code editor theme and highlighting

**Rules**

- Editor: CodeMirror 6, coloured from `--code-*` tokens so both themes need no override:

| Token | Colour |
| --- | --- |
| keyword | purple |
| string | green |
| number | orange |
| comment | `fg-2` |
| function | `primary-text` |
| type | amber |
| property | blue |
| tag | red |
| punctuation | `fg-3` |
| diff lines | `--code-added` / `--code-removed`, changed words their strong steps |

- Font: 12px ABC Areal Mono on an 18px line.
- Highlighting uses VS Code's own TextMate grammars (via Shiki's language pack and the Oniguruma engine), tokenized in a worker line by line from each line's state, a slice at a time, visible lines first, and from the first changed line only after an edit. Tokens render as classes (`tm-code-keyword`…).
- One theme maps TextMate scopes to `--code-*` for the editor and every other highlighted code (chat fences, tool output, snippets), so a fence and the editor read identically.
- Comment tags (Better Comments): a comment starting with `!`, `?`, `TODO`, `*` or a second `//` (after the marker or a doc comment's margin star) takes, from the tag to end of line: `--code-comment-alert` red, `-query` blue, `-todo` orange, `-highlight` green, `-strike` `fg-1` struck through. In the editor and every fence.
- Markdown is rich: bold headings, emphasis, code spans, fences in their own language (each fence's grammar loaded first), underlined links, lists, tables, front matter as YAML.
- Language from path, as VS Code decides: name first (`Dockerfile`, `Makefile`, git message files, `git-rebase-todo`, `*ignore` files with a small ignore grammar, `.env*` as dotenv, `tsconfig*.json` and `.vscode/*.json` as JSON with comments, `Cargo.lock` as TOML), then folder (`.husky/*` as shell), then extension, then shebang.
- A line over 20,000 characters stays plain.
- A file shows as plain text the frame it arrives and takes its colours from the worker a moment later, or at once when tokens are cached (by language and text). The structural language (folding, indent) joins when the browser is idle.

#### Diffs in the editor

**Rules**

- A diff opens side by side: old file left. Unified is a toggle at the toolbar's end (`icon-sm`, hidden below `md`), showing the layout it switches to: `IconLayoutTopBottom` "Show unified", `IconLayoutColumn` "Show side by side"; also in ⌘K. Remembered in `shinsa.code-unified`.
- Unified puts removed lines above where they were, highlighted from a parse of the whole old file (a removed line inside a block comment reads as a comment), numbered in red.
- A changed line has exactly two layers: the full-width line wash (`--code-added` / `--code-removed`) with a 2px bar at the code's left edge in `green-4` / `red-4`, and the strong wash on changed words. Nothing boxes the text. The bar is on the code, not the gutter, so it slides with horizontal scroll.
- A coloured bar on a line of code always means added (green) or removed (red); never use one for anything else in code.
- Unchanged stretches of 4 lines or more fold into "N unchanged lines", keeping 3 lines of context next to each change; a click opens them. They are no place for the cursor: arrow keys step over the fold in the direction of travel (selections and edits are left alone).
- Each side scrolls sideways on its own: line numbers pinned at its left on the page background, code sliding under. Fold labels and notes under lines are block widgets, `position: sticky` at the gutter width (`--cm-gutter-width`, measured on geometry change, never on scroll) and as wide as the visible side, so they move with the text in the same frame and never widen the scroll width.
- A file added or deleted whole has one side: shown at full width (unified, no empty half), layout toggle hidden.
- Below `md`, every diff is unified and the toggle is hidden.
- Binary file: no text; an image shows before and after on a checkerboard.
- Large file guards: over 2 MB says its size and that it is too large to show as text. Over 1 MB, or with a line over 10,000 characters, stops before the editor with "Opening this file may slow the page", the reason ("‹path› has a line of 900,000 characters, too long to show as text.") and Open anyway.
- Merge diff computation gives up after 20ms.

#### Annotation gutter and spot marks

**Rules**

- Annotated line ranges ("spots") get a 3px mark in their attention tone in a gutter of their own, left of the line numbers: Critical red, Read carefully amber, Context `fg-2`.
- Hovering the mark names the attention and why ("Read carefully: …") in the app's `Hint` tooltip, beside the mark and following the pointer down it; never the browser `title`.
- A line two spots share takes the stronger tone and both reasons, one per line.
- The selected spot from the URL washes `primary-a1` and scrolls into view.
- The code itself carries only diff marks; annotations live in their own gutter.

#### Jump to a line: flash then hold

**Rules**

- Any link to a file and line (file links, review snippets, chat file references, finding cards) opens the workbench on that file, whatever was open, even if the kept view last showed another file (the address wins).
- It scrolls the line to the centre, opens any fold over it (both sides in side by side), washes the line or range `primary-a3` for 2000ms, then leaves it `primary-a1` while the file stays open.

#### Change list with viewed state

**Rules**

- Each changed file row: a red risk dot with its reason, your comment count, diff counts (or Binary), its status letter (Added green, Deleted red, Modified and Renamed `fg-2`; the full name in a tooltip) and a viewed box.
- Viewed box: kit `Checkbox` at `sm` (14px), quiet `icon-1` edge turning `fg-1` on hover, `rounded-checkbox`; ticked: `primary-4` fill with a white check centred over the whole box including border. No tooltip: the box says what it does.
- Tooltips only where meaning is not on screen: diff counts none; status letter its name ("Added"); comment count what it counts ("2 comments from you").
- A folder has a viewed box: ticking marks every file under it at any depth; it reads ticked when all are viewed, indeterminate (a dash) when some are.
- Viewed rows read as done, greyed to the disabled step: name, letter, counts, comment count and risk dot `fg-1`; icon `icon-1` even when tinted (`file-icons-muted`). The open file keeps its selected look either way.
- Header line: "2 files · 1 viewed" beside total counts and a Hide viewed files toggle (`icon-xs`, an eye; remembered in `shinsa.code-hide-viewed`; also in ⌘K). Hiding keeps the open file and reads "2 files · 1 viewed hidden".
- All viewed: only the calm line "Every file is viewed." in the tree's place, no button; the open file stays open in the editor.
- Viewed state is kept per task and commit.

#### Direct editing with autosave

**Rules**

- An editable file is edited by typing: no edit mode, nothing to confirm. In a diff the new side is editable (right side by side, the whole editor unified), and the diff follows each keystroke.
- Save after each 600ms pause; immediately when leaving or closing the file, and on ⌘S. "Saving…" in the toolbar meanwhile.
- A save never rebuilds the editor: keep the text on screen until the new read lands, so cursor, focus and undo stay.
- A save names the text it expects on disk. If the file changed on disk, take the disk version; keep an unsaved edit that touches other lines, otherwise show the disk version with a one-line strip under the toolbar: `IconCircleInfo`, `text-2xs` `fg-2`, "This file changed on disk where you were typing, so it shows the new version."
- Read-only files show the same strip with `IconLock` and why (for example "This is an earlier commit, so it is read-only. Pick Head of the branch to edit."), also for merged, finished or checkout-less tasks and a refused save.
- Comments are words only; to change code, edit it.

#### Inline notes under code lines

**Rules**

- Notes (findings, comments) sit under their last line as the compact review card: no snippet, no place (the line above is the place).
- Each note renders into an element kept per note; the editor's block widget only moves that element in and out, so a note scrolled back into view is already drawn at its height and nothing trails the scroll.
- At a review gate a click on a line number opens a comment box under it (on the selected lines if the click is inside a selection). A removed line's number does the same; its comment sits under the removed block.
- A comment is kept per gate in `localStorage`, anchored to the commit it was made at.
- Comment box and notes: at most 36rem wide and never wider than the side less its gutter: `100cqw - 6rem`, each editor being its own inline-size container. Long selections wrap inside the visible pane.

#### Keyboard shortcuts policy

**Rules**

- ⌘K is the one global shortcut and the one complete list of commands. Every other shortcut is also a ⌘K command shown with its key at the right.
- Allowed exceptions, each scoped to one view and active only while it is open: the code workbench's ⌘P (go to file), ⇧⌘F (search in files), ⌘F (find in file), ⌘G (go to line), Ctrl off the Mac; the review report's J and K (next and previous point, only while not typing); the terminal page's ⌘T and ⌘W.
- A lint rejects a global `keydown`/`keyup` listener anywhere else.
- Editor keys are the editor's keymap, active only while it has focus, so they are no global listener. They match VS Code (Ctrl for ⌘ off the Mac where VS Code does): ⌘S save, ⌘Z undo, ⇧⌘Z and ⌘Y redo, ⌘F find, ⌥⌘F (Ctrl H) replace, ⌃G and ⌘G go to line, ⌘D add next occurrence, ⇧⌘L select every occurrence, ⌥⌘↑ / ⌥⌘↓ (Ctrl Alt) add cursor above or below, ⌥-click add cursor, ⇧⌥-drag column select, ⌥↑ / ⌥↓ move line, ⇧⌥↑ / ⇧⌥↓ copy line, ⇧⌘K delete line, ⌘] / ⌘[ indent and outdent (Tab and ⇧Tab too), ⌘/ toggle line comment, ⌘L select line, ⌃⇧⌘→ / ⌃⇧⌘← (⇧Alt → / ←) expand and shrink selection by syntax, ⌥⌘[ / ⌥⌘] (Ctrl ⇧[ / ]) fold and unfold block, ⌃⌥[ / ⌃⌥] fold and unfold all, Escape back to one cursor. ⌘K lists every one in an Editor group; the editing ones are disabled, with the reason, on a read-only file.
- A focused terminal's keys go through the terminal's own key handler on its element, never a page listener.

#### Code folding

**Rules**

- A fold gutter after the line numbers holds a chevron for every line that starts a block, shown while the pointer is over the gutter and always on a folded line. A click folds or unfolds.
- A folded block shows `⋯` on a `bg-a2` pill (3px corner, 4px padding and 4px margin on each side) that turns `bg-a3` with `fg-4` text under the pointer and unfolds on click.
- Blocks come from the syntax tree when the language has one, else from indentation (a line folds what is indented under it, across blank lines). Fold keys and ⌘K's fold command act on the same blocks.

#### In-file find bar

**Rules**

- The find bar replaces the editor library's own panel and sits in its top panel: the shared search field (up to 320px), Previous match / Next match right after it, then "3 of 12" (or "No results"; counted up to 999), Close at the far end.
- Enter and ⇧Enter step; Escape closes and returns focus to the code.
- On an editable file a chevron before the field (Show replace, or ⌥⌘F) opens a second row: Replace with, Replace, Replace all. Enter replaces the next, ⌘Enter all.

#### No layout shift on switch

**Rules**

- Switching ref or mode measures zero layout shift.
- Keep the previous result on screen until the next is ready: the changes tree holds the diff until the next ref's diff arrives; the files tree keeps its last fully read rows until every open folder of the new ref is read, then swaps the whole list; a new editor stays hidden until it has measured its lines, so its gutter never slides into place.
- A folder not yet read opens in the one render its rows arrive in (synchronously flushed), never with a loading frame. Closed folders in view are read at idle, up to 64 at a time.
- No main-thread task over 50ms on open, scroll or switch.

#### Every position in the URL

**Rules**

- The workbench's full position lives in the URL: mode, open file and whether it is a diff, line and range, ref, spot, order and search. A reload or Back puts you where you were.
- Files are read and cached by commit, so a merged task whose worktree is gone keeps its code, a review never shifts while an agent types, and nothing is reread because the task changed otherwise.

#### Two ways to show code: an editor, and one diff renderer

**Rules**

- The full workbench is an editor (CodeMirror 6, merge view included): it edits, finds, goes to line, folds and holds a 10,000-line file.
- Every other small diff in the app goes through one wrapper, `CodeDiff`, built on `@pierre/diffs`: chat edit and write rows (a write is a new file, every line added), hand-over card spots, review points and finding code. Never hand-build `+`/`−` rows or add a second diff renderer.
- Lazy but not `React.lazy`: the wrapper is a few lines in the entry bundle; the library (its own chunk, about 81 KB gzipped, plus the grammars it shares with code fences) loads the first time a diff shows, or ahead at idle and on hover of a task. The language grammar loads before first paint, so a diff never shows uncoloured. If still loading, the space stays empty and "Reading the changes" appears only after 300ms.
- Look: the same `--code-*` theme; changed lines wash `--code-added` / `--code-removed`, changed words their strong steps; line numbers `fg-2` (green or red on a changed line); transparent background; ABC Areal Mono `text-2xs` on an 18px line; follows the page's light or dark class. No file header, border or background of its own: the containing card is the chrome.
- Always unified. A diff over 16 rows shows 14 and "Show N more lines" (a one-way reveal, not a remembered fold).
- A snippet (old and new text of an edit) has no line numbers and marks lines `+`/`−`, since its numbers would not be the file's. A whole file or a slice of the real diff is numbered with a 2px bar on changed lines.
- Empty cases: "A binary file, not shown as text."; "Renamed from ‹path›." above the lines; identical text "No line changed."

#### Change snippet: a file slice in a folding frame

**Rules**

- A `figure` with the inset shape (`corner-superellipse/1.125 rounded-lg border`, neutral edge), `flex min-w-0 flex-col overflow-hidden`.
- Header: 28px, `DisclosureHeader` with `strip='strip'`, `chevron='box'`, `gap-1.5 bg-bg-a1 ps-2 text-2xs`: the file icon, path (`fg-3`), line range (`fg-2`), optionally a leading label (a spot's attention). The chevron box sits 3px from the header's top, bottom and end. A click anywhere on the header except the place folds it.
- The place is a link into the workbench at those lines (with the spot key so it washes there; "Open in Code" on hover) when the task has a repository.
- Body (under `border-border border-t`): the task diff narrowed to hunks around the lines with 2 lines of context, the lines themselves washed `primary-a1`. If the change does not reach them, the file at head around them as unchanged lines. A long removal before replaced lines shows only as many removed lines as the point marks new ones, plus two; a pure removal shows whole.
- An optional "why" under it: markdown, `border-border border-t px-2 py-1.5 text-fg-3 text-xs`.
- Starts open for a Blocking or Should fix finding; Optional findings and spots start folded. The fold is remembered.
- A finding with a snippet drops its separate place chip: the snippet header is the place.

#### Code block and its action corner

**Rules**

- Every block of code (markdown fences in chat, reports and cards; diagrams; evidence text; test commands; chat tool-call blocks) is one `CodeBlock`: inset shape (`corner-superellipse/1.125 rounded-lg border`, neutral edge), `bg-bg-2`, `group/code selectable relative min-w-0 overflow-hidden`. The hairline border keeps its edge on a card in both themes.
- A block never wraps; it scrolls sideways inside.
- One corner owns every action: Copy, then Run in terminal, both `secondary icon-xs`, side by side on one surface: `pointer-events-auto flex items-center rounded-control border border-border bg-bg-2`.
- Corner position by logical line count:
  - one line: centred at the right edge in the block's own row, so the line ends before it and never runs under it (`flex items-center` on the block, code in `min-w-0 flex-1`, corner `shrink-0 pe-1.5`);
  - several lines: top-right, 6px from top and end, with a 12px fade from the code into the corner's surface: `absolute top-0 right-0 bg-linear-to-r from-transparent to-[12px] to-bg-2 ps-3 pe-1.5 pt-1.5`.
- Reveal: `opacity-0 group-hover/code:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100` (hover, keyboard focus on a button as a reveal not a focus mark, always on touch). The wrapper is `pointer-events-none`.
- Copy is a `CopyButton`: its tooltip is the shared `Hint` (no delay of its own), and a press swaps `IconClipboard2` for the accent checkmark (`IconCheckmark1`, `text-primary-text`) and the label to "Copied" for 1500ms.
- Run in terminal (`IconConsole`) appears only on a command meant to run: a fence marked `run` after its language (```` ```bash run ````, also `sh`, `zsh`, `fish`, `shell`, `console`; in `console` only `$` lines count), test commands and merge steps. The mark is read from the fence info string, never shown, never changes highlighting. A plain ```` ```bash ```` fence or a `$`-prompted block is an example with Copy alone.
- Run appears only when a runner is provided (the item has a folder to open a terminal in); tool-call records keep Copy alone. Its tooltip is "Run in terminal" over the folder it runs in. Pressing opens a terminal there and runs the command; nothing runs without the press.
- Copy and Run both drop a leading `$ `.
- Text diagrams: a fence drawn with box-drawing characters is set on a 14px line (`leading-3.5`) so vertical lines join.
- A command or log block outside prose is at most 320px tall and scrolls inside.

**Example.** A one-line `bun test` fence marked `run` in a test plan: Copy and Run centred at its right edge, visible on hover.

#### Report tab versus decision layer

**Rules**

- Split a technical read from a decision. The decision layer (the task Overview) holds the quick decision: findings with verdicts, suggestions, checks, a short "what changed" without code, and one line pointing to the report. The report (Review tab) is the in-depth read: what the change does, its structure and flow, the key code explained simply, and above all the judgement calls with alternatives and why. Forty or fifty marked points on a large change is normal.
- The two never say the same thing twice. Evidence is shown once: on the decision layer it is one card whose only content is its 36px header band ("4 pieces of evidence in the review" with "See the evidence" at the right); activity rows carry no thumbnail. An item with no report shows the evidence panel on the decision layer instead.
- The report tab appears only once there is something to review. Tab order: Overview, Review, Code, Chat.
- The report reads top to bottom as a document in the same centred column, never a split with a file list.
- It opens with a summary frame: status and diff counts as eyebrow, the headline as title, and counts of what matters ("40 points to read, 1 blocking, 4 critical, 10 judgement calls, 2 disputed by the agent review."). The decision actions sit at its top right, identical to the decision layer's (one shared component). Verdicts and comments live in one shared draft so every surface agrees.
- Without a report, points come from the riskiest changes; without a walkthrough, the review is the marked points; a quiet line says which.

#### Evidence panel

**Rules**

- A `Panel` with `IconImages1`, the count right after the title, placed before the code.
- Items grouped by kind, in order: Comparison, Recording, Screenshot, Test, Check, Note, Preview. Each group under a `SectionLabel` naming its kind (plural with the count when more than one). 20px between groups, 4px from a label to its items.
- A comparison is one item: title and facts ("1280px · Dark"), what to look at, then its parts side by side (three across from `sm` when more than two), each labelled Before, After or its state. A light/dark pair is a comparison labelled Light and Dark with only the width as facts.
- Recordings and screenshots: a two-column grid (one below `sm`), each with title, facts and what to look at. A lone screenshot shows no before/after stage.
- A test or check is a reference to one of the task's checks, never a text blob of its own: the agent links a check (its id) instead of pasting test output, and the output the product keeps each time it runs a check belongs to that check. Every piece of one check folds into one item, a Test when the agent linked it as one, else a Check, drawn as that check's row from the Checks list (below): label, who added it, command, outcome, the agent's note on what it proves, and "Show the output" on the latest output kept this round. A check the task no longer has reads "No longer one of the task’s checks".
- A note: `IconNote1`, the shared markdown renderer at `text-xs` in an inset (`px-3.5 py-2.5`).
- A run with no command is a code block (monospace, copy on hover, max 320px tall). A preview is a link row.
- Last line: where the files are on disk ("Stored in ~/…/evidence/<task>/round-1", `IconFolder1`, a copy button).
- Every thumbnail: a 16:10 frame, `object-contain`, `bg-bg-2`, a 1px border so a dark shot keeps its edge on a dark card. A click opens the image viewer; its arrows step item by item ("1 of 4") and its bar switches Before/After inside a comparison.
- A recording shows its first frame (muted, metadata preloaded) under a round play glyph and plays only in the viewer with controls (server supports byte ranges).
- Evidence from the reviewer, not the author, carries a purple "From the agent review" badge.
- Empty: "No screenshots, recordings or test runs were attached this round. Request changes to ask the agent for them." A missing proof is visible, not silent.
- Decision layer summary line counts by kind, a check once: "1 comparison, 1 recording and 2 tests in the review".

#### Chaptered reading order

**Rules**

- Chapters follow how a reader comes to understand a change: How it's built (Approach, How it works, How to test, then Pre-merge steps and Post-merge steps when present), Key code, Judgement calls, Read carefully (critical spots, then risks), then Agent review. Then your comments (each with Remove), then Everything else, collapsed (changed files nothing points at, with counts; findings dismissed in earlier rounds, compact).
- A chapter with more than one block opens with a `SectionLabel` (count beside it) 4px over its cards; 8px between cards; 20px between chapters.
- Every point appears in exactly one chapter; no duplicate attention list or phase walkthrough, and the Checks list only in How to test.
- Every section is a `Panel` card (36px `CARD_HEADER` band, icon slot, title, count right after the title, disclosure header with the box chevron), never loose text under a heading.
- Walkthrough prose includes a text diagram in a code fence whenever the change has structure or flow worth drawing.
- Judgement call cards: tag Judgement call (purple), titled by the decision in a few words, then the call and reason, "Also considered" with each alternative and why rejected, then the snippet. If the reviewer disagrees, the card is Disputed (orange) and carries "The agent review disagrees" with its reason on an orange inset note (`orange-a2` on the inset's hairline).
- Risks panel: one row per risk with title, risk and snippet; the current row washed `primary-a1`.
- Agent review panel: the reviewer's summary in its own words, what it found, "A signal for you, never the approval.", then each finding's card (`rounded-lg`, nested) with Fix / Dismiss at a review gate; "The agent review has not run yet." before it ran.

#### Test plan panel

**Rules**

- Two parts, each under a quiet `text-2xs` label; never a checklist.
- Covered by tests: one or two lines of plain text, then the Checks list in both stages. When measured, changed-line coverage in one `fg-2` line ("85% of changed lines are covered (36 of 42) · 2 files have uncovered lines." or "All 42 changed lines are covered.") and a quiet `text-2xs` toggle "Show 3 files" listing each file link, "10 of 14 lines" and, if missed, "Not covered:" with each range a file link. Nothing at all when coverage is off, unmeasurable or no changed line is code.
- Try it yourself: ordered steps, each a `StepNumber`, the action (markdown), its target, and "You should see" over the expected result. Targets render by kind: an `http`/`https` address is a link with `IconGlobe` opening in the browser; a file a file link at its lines; a command a shell code block with Copy and Run; a screen, or an unreadable address or file, plain text with its icon.
- Shown when either part exists, there are checks, or coverage was measured.

#### Checks list

**Rules**

- One list, two stages, read as a bonus, never a wall: **Building** (before the pull request: the checks the plan chose and the agent added as it built, then the repository's optional "Always run before review" commands) and **CI** (after the pull request: its CI checks).
- Each stage opens on a `text-2xs` line: the stage's title (medium `fg-2`) and its summary in its state's colour ("All 4 passed" in the check ink, "1 of 4 failed" in red, "Running 2 checks" in blue, "2 passed, 2 not run yet" in `fg-2`). Its rows sit in one inset with hairlines between them.
- A row: the state glyph on the first line, the label (`text-xs fg-4`) with who added it beside it (`text-2xs fg-2`: "From the plan · phases 1 to 3", "Added by the agent · phase 3", "Repository · before review"; a CI check "Required" or "Optional", its name a link to the run), the command under it (mono `text-2xs fg-3`, selectable), then a note or what failed, and at the end the state's word and "Show the output" when the product kept the check's output (the latest run only, never one block per run).
- States: Passed (the check ink, never green), Failed (red, with what failed under the command), Not run yet (dotted circle), Running (a spinner in the accent: a check in the current run is never shown as its old result, so a run of the checks never looks stuck), Passed with "Passed when re-run alone" under it, and "Already failing on main, so it does not block" (a grey failed glyph, "Not blocking").
- While the checks run between phases, the now card's title is the stage reason ("Running the checks for phase 1 of 3"), never the next phase's title, and the card shows the list.
- Where it shows: the review card, the now card while the checks run, How to test, and compact (no output) in the checks fact's and the pull request's popovers.
- The plan names its checks the same way: a "Checks" parameter with each label, its phases ("Phases 1 to 3") and its command as a mono chip.
- A repository's "Always run before review" is a setting with a default of nothing: nothing configured means nothing extra runs, and it is never a setup problem.

#### Pinned index line

**Rules**

- A long report keeps one compact line fixed above the scrolling column: a card whose only content is a `Panel` header band (36px, `IconListBullets`, "Every point" and the count right after, box chevron at the right).
- While reading it says where you are: "12 of 40 · Judgement calls · the point's title", or chapter and section for walkthrough parts ("How it's built · Approach").
- Point in view: the last one whose top passed a line 48px under the scroller's top, or the last in view once scrolled to the end. A jump holds its point for 1200ms (scrolled back to the top every 100ms); a wheel, touch, key or pointer press hands control back to the line sooner.
- The line has one edge (the card border); the popover one edge (its ring).
- Click opens the whole index as a popover the width of the line, over the content so nothing moves: grouped by chapter, labelled, one 28px row each (number, tag as dot and label, title or first sentence, place `path:lines` from `md`). Walkthrough parts are unnumbered rows carrying their panel icon at 14px in the number's 20px slot, right-aligned like the numbers (Approach `IconLightbulbGlow`, How it works `IconLayersThree`, How to test `IconTestTube`, Pre-merge `IconChecklist`, Post-merge `IconMerged`). The current point carries the shared sliding hover highlight and is scrolled into view. A row jumps and closes the list.
- No sidebar, no Previous / Next buttons: J, K and ⌘K step.

#### Review card: two variants

**Rules**

- One card for every point and every comment anywhere, picked by what it is:
- A point or comment: opens on a header bar: 36px `bg-bg-a1` band, disclosure header `strip='band'`, box chevron right. Icon slot holds the author's icon (Agent `IconAgent`, You `IconBubbleText`). Then what the card is (`text-xs` medium `fg-4`): the point's short title (never an "Agent" label, since every point is the agent's); "You" on your comment. Then the tag (dot and label), the section (`text-2xs` `fg-2`, truncated), and an action before the chevron (Remove on a comment). The whole bar folds the card ("Collapse judgement call"); clicking the action does not. Starts open, remembers its fold, and reopens when jumped to. Body 12px in: a judgement call's call (`text-xs` medium `fg-4`), then markdown (`fg-3` under a call, `fg-4` without).
- A finding: no bar, never folds, so its verdict is always in view. A full-width `justify-between` head row: label line (`text-2xs`: "Agent review" `fg-2`, the tag) over the title (`text-xs` medium `fg-4`) on the left, Fix / Dismiss on the right aligned to the row's top; body full width below.
- Both then show full width: Why it matters, Also considered, the disagreement, the snippet (open, header linking into code with the point's key), the suggested fix on an inset note headed "Suggested fix" (`IconBandage`).
- There is one finding layout with Fix / Dismiss; never a variant with the toggle in a header band.
- In the code editor the same card is compact: no snippet, no place.

#### Spotlight on a jumped-to card

**Rules**

- The target gets a 2px `primary-a3` outline 2px outside it and scrolls into view.
- On the report it holds 1.5s and fades over 500ms (a risk row's `primary-a1` wash too); the URL keeps the place.

#### Stepping and links into a report

**Rules**

- The current point is a URL parameter (`?spot=`), with stable keys per kind (`0:1` a spot, `call:0`, `risk:0`, `finding:0`, `comment:<id>`; `approach`, `flow`, `testing`, `pre_merge`, `post_merge` for walkthrough parts). The same key opens the code workbench marked like a spot.
- J and K step to the next and previous stop in reading order from the one in view, only while the report is open and you are not typing. Each is also a ⌘K command (Next point, Previous point).
- Every entry point (decision layer buttons, ⌘K "Review the changes", a task link action, a queue action, a hand-over's "Read the walkthrough") opens `?tab=review`.
- Instant: snippets are slices of a diff already held; prefetching loads the diff view and every point's grammar, so the first frame paints every snippet.

#### Instant navigation: kept views

**Rules**

- A click paints its page in the next frame or two.
- Pages once visited stay mounted inside React's `Activity`, hidden (`display: none`), not unmounted: the hub pages (Home, All tasks, Settings, Terminal) and the last 3 item pages. Going back shows the same page, scroll and open sections.
- A hidden page runs no effects (no commands, key bindings, subscriptions or reads); they restart when it shows.
- Rendered ahead: once the browser is idle after the first state arrives, the hub pages render hidden (the terminal page opens its socket so its screen is ready), and an item page renders its other tabs hidden.
- Hidden pages get state as of the last idle moment, not every push; the visible page gets every push at once. Pages and tabs are memoised on state and route.
- No route waits on a chunk: pages are in the main bundle, never behind `React.lazy` and `Suspense` (React 19 holds a revealed Suspense boundary for 300ms). Only the component catalog and the code editor load apart, and the editor is prefetched.
- Budget: on the seed, an item page with three hubs kept and two tabs warm holds 20 MB of JS heap (pre-rendered hubs 3.3 MB, hidden tabs 0.6 MB). So a row in a kept list mounts no overlay of its own: hints, times and clipped text share the page's one tooltip. Visiting more items never grows past the 3 kept.
- Idle scheduling uses `requestIdleCallback` with a 2000ms timeout.

#### No loading state in normal use

**Rules**

- Whatever a click shows is already on the page: rendered ahead, read ahead, or the last answer kept while a newer one loads. A spinner, skeleton or "Reading…" line is a design bug unless the work could not be foreseen.
- Read before the click: hovering an item anywhere for 40ms (hover intent; cancelled on leave), focusing it, or highlighting it in ⌘K reads what its page shows (code refs, diff summary, root folder, path list and first file, review snippets, the diff view chunk, evidence with images decoded ahead, the last two transcripts). At idle, the first 4 queue items get the same code reads and settings reads happen. Inside the workbench: hovering a file row 40ms reads and tokenizes it (both sides of a changed file) and prebuilds the side-by-side pair at idle; opening a file reads the two files after it and one before at idle (300ms idle timeout); the other refs of the open file, the folders above it, ⌘P's top match as you type and a hovered search match are read too.
- Keep it, then refresh it: a read shows its last answer at once while a newer version loads.
- Every cache is bounded:

| Cache | Limit |
| --- | --- |
| Code reads | 300 |
| Finished searches | 20 |
| Evidence texts | 32 |
| Evidence images prefetched | last 64 |
| Review snippets read ahead | 8 per item |
| Transcripts | every followed run plus the 24 read last |
| Editor states kept (scroll, folds, cursor, undo) | last 24 files |

- One editor instance per workbench: opening a file swaps its state in rather than building a new editor.
- Never put the workbench or the editor behind `React.lazy`/Suspense.

#### Delayed loading indicator (the 300ms rule)

**Rules**

- For a wait that could not be foreseen (a file nothing pointed at, a new search, the first state after reload, a sign-in), the place stays empty for 300ms and only then shows a spinner and its line.
- Hook:

```ts
export const LOADING_DELAY_MS = 300;

export function useDelayed(active: boolean, delayMs: number = LOADING_DELAY_MS) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}
```

- Three shapes:

| Component | Markup |
| --- | --- |
| Inline line | `flex items-center gap-2 text-fg-2`, `invisible` until shown (keeps its space); `Spinner size='sm'` then the label |
| Spinner only | nothing until shown, then `inline-flex text-fg-2` with `Spinner size='lg'` labelled |
| Pane loader | `flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center font-sans text-fg-2 text-xs`, centred in the pane it holds; `Spinner size='sm'` over the label once shown |

- Each carries `data-loading-state="<label>"` once shown and `data-loading-pending="<label>"` while waiting unseen (a test walk looks for them).
- Labels are sentence verbs with an ellipsis where the source has one: "Reading the code…", "Opening the code…", "Reading the changes…", "Reading the files…", "Opening ‹path›…", "Looking for services", "Searching".
- Not a loading state, and kept as is: a busy button, a live agent's shimmering line, "Working out the steps" on a progress track, an update toast. They report work being done, not a read.

#### Compact popover with a list, built from the queue's pieces

**Rules**

- A status trigger in a toolbar: `secondary sm`, icon and label, a trailing chevron, popover from its start edge. In a rail it is a row with its popover to the right.
- The trigger's label says the worst state first, in that state's tone: "1 failed" red text, "1 starting" blue, "2 running" in the button's own ink, else the plain name ("Services"). No status dot: state is a status tile and a tone in text.
- Icon outline normally, filled while you are on the related page (`IconServer` / `IconServerFilled`).
- Popover width 352px (`w-88`) when content includes mono commands and forms; 320px for a plain list.
- The list reuses the compact queue's sections: each group a section (`px-2 py-1.5`, a hairline between sections) whose header is 24px: the group's dot in a 20px icon slot, its name (`text-2xs` medium `fg-2`, `fg-4` under the pointer), its counts in normal weight, worst first in their tones, and the fold chevron revealed on hover 6px after the counts. The whole header folds the group; each fold is remembered.
- A group action (for example a play button, `icon-sm`, `IconPlay`, no text, tooltip "Start all services in ‹project›", shown when 2 or more items are not running) ends the header, which then ends 4px in (`pe-1`) so the action lines up with each row's last button. A press on it never folds.
- Rows follow each other with no gap. The list's top is inset 6px more than a section's own padding (`pt-1.5`), so the first header's dot sits as far from the top as from the side (measured 20px and 20px).
- A row is a `ListRow`: the state's tile, the name over the state in its tone ("Running for 12m", "Failed with code 1"), and the command in mono. State glyphs: running `IconPlay` green, starting `IconHourglass` blue, failed `IconExclamationCircle` red, stopped and exited `IconCircleDashed` neutral (an idle mark that never reads as a checkbox). The rows tick every second when they show a running time.
- Row actions at its end, `icon-sm`: the primary one (Start, `IconPlay`) always on an item that is not running; secondary pair (Restart `IconArrowRotateClockwise`, Stop `IconStop`) revealed on a running row while hovered (the shared highlight's `data-hovered`), 1px apart (`gap-px`), each 24px, each hover wash its own edge. No `•••` on a row: edit and remove live in Manage. Measured: the header's action and every row's last button share one x, 12px from the popover end.
- Height: the list sizes to its content up to the room under the trigger (`max-h-(--available-height)`), then scrolls with the footer fixed. Sub-views (add, forms) keep one fixed height, `min(28rem, room under the trigger)`, so loading, opening Advanced or showing a problem never moves the edges; switching from list to a sub-view moves only the bottom edge, once. Manage keeps the list's height.
- Footer always there: `flex h-10.25 shrink-0 items-center gap-1 border-border border-t px-2` (41px with its hairline; each 24px button 8px from top, bottom and sides). Here: Manage (`IconSettingsSliderHor`, disabled with nothing listed), Add… (`IconPlusMedium`, disabled with nowhere to add), and at the end a link to the full page.
- Empty: the kit's `EmptyState` at `sm` with the section's icon, a title naming the scope ("No services in ‹project› yet"), one sentence defining the thing ("A service is a command you keep running for a project, like its dev server."), and the creation action in the empty state only when a prerequisite is missing ("Create a project…").

#### Views inside a popover, never a dialog

**Rules**

- Add, edit and remove are views of the same popover, driven by a small reducer; a view lacking what it needs falls back to the list. After the popover has fully closed (`onOpenChangeComplete`), it resets to the list so the next open starts there. ⌘K commands can open the mounted popover straight on a view.
- Every sub-view header is padded `py-3 ps-3` (12px top, bottom and start, so the title is as far from the top as from the side) and 6px at the end, which a ghost select's own 6px inset brings to 12px from its glyph. An optional ghost `sm` select (with dots) sits at its end.
- A picker view: a `SectionLabel` with count and Select all / Deselect all, then `ListRow`s with a checkbox in the icon slot (`outline` variant), name over command in mono and its folder ("bun run dev in shop/apps/api"), last a "Custom…" row (`IconPlusMedium`). Recommended items start ticked so the common case is one press of the primary "Add 2 services" (disabled at none) beside Back. Already-added items are not listed. When nothing is found, open straight on the form with a sentence saying so, and Back goes to the list.
- A form is short and uses the kit's `Field`, `FieldLabel`, `Input`, `SelectTrigger`, `Textarea`: filled, never bordered. A path is a select of known places, never typed. Rare fields fold under Advanced (open by itself when it has a value or a problem). The form sets the dialog ink `fg-3`, so labels read as in dialogs (13px, weight 450). Inside a popover whose surface is `bg-2`, the kit fills a field one step above the popover so it still reads as a field in both themes.
- Validation: a field shows its problem only once you have typed in it and left it, or tried to submit; from then on it follows typing, so fixing clears it at once.
- Manage mode: the list turns into a picker. Each row's tile becomes a checkbox (`outline`: empty at rest, since filled boxes on every row outweigh the rows; accent fill when ticked); pressing anywhere on the row toggles it. Edit is its own always-shown button at the row's end (`icon-sm`, `IconPencil`, "Edit ‹name›", `bare` variant: no wash, only the pencil `fg-2` to `fg-4` on hover, since the row already washes); it opens the form in place and Back or Save returns with ticks kept. Run buttons go. Footer: destructive "Remove 2 services" (disabled at none) and Done.
- Confirm in the footer, not a dialog: "Remove 2 services?" over the consequence ("They stop and their terminals close."), Cancel and Remove. One call removes all and clears ticks; a refusal keeps them.

#### Terminal surface

**Rules**

- A full-page terminal fills the space under the top bar edge to edge, no column: a 36px `Toolbar` (project picker, tabs, New terminal `icon-sm` `IconPlusMedium`, a divider, then context actions: the front service's Restart and Stop or Start, else a start-all play button while any service is idle, and Find `IconMagnifyingGlass`), then the terminal on its own background, 8px from the top and 12px from the left.
- The URL is the view (`?project=…&terminal=…`); the page is a kept hub rendered ahead at idle.
- The project picker reuses the focus menu's trigger and radio rows (dot, name, chevron; closes on pick).
- No terminal: `EmptyState` with "Open a terminal" (`primary sm`, no tooltip).
- Tabs are the kit's segmented `Tabs`, each trigger rendered as a `div` because it holds a close button: 22px inside the 26px list; the mark, the label (user name, else the shell's title, else the folder name), and a close button (`icon-2xs`, 18px) revealed on hover and always on the active tab. The close button sits in an even 2px inset: 2px from top and bottom, and the tab's end padding is 2px (`pe-0.5` over the kit's `px-2`), so the × is centred in its corner. A shell's mark is `IconConsole`, `IconConsoleFilled` on the front tab; a service tab's mark is its state glyph in its tone, filled when in front. An ended shell's label is `fg-2`. The tooltip names the folder and how it ended, or the service's state and command. Double-click renames in place (Enter keeps, Escape restores, empty reverts to the title); drag reorders; middle-click closes. The selected pill slides like every tab bar.
- Closing: an ended terminal closes at once; a running shell closes at once unless a program other than the shell is in front, then "Close this terminal?" naming it ("vim is still running in “Dev server”."); a running service asks "Stop api?" with "Stop and close". The tab to the right shows next.
- New terminal: one click opens it in the only place; with several, a menu groups Repositories, Folders and Task worktrees (`IconFolder1` in the project's colour, `IconFolders` and `IconBranch` plain grey).
- Ended: the last screen stays, and a bar under it says why ("The shell exited with code 1.", "Shinsa’s engine restarted, so this shell ended. Its last output is above.", "api exited with code 1.") with Close (`secondary sm`) and Start again (`primary sm`, `IconArrowRotateClockwise`), which starts below the old output and takes the keyboard.
- Look: the editor's mono font at 12px, line height 1.25, a non-blinking block cursor, and the editor's colours. `--terminal-*` tokens are the editor's (its background, `fg-4` text and cursor, `primary-a2` selection, the same with or without focus). ANSI palette from the syntax tokens:

| ANSI | Token |
| --- | --- |
| black | the text colour (`bg-4` in dark) |
| red | `--code-tag` |
| green | `--code-string` |
| yellow | `--code-type` |
| blue | `--code-function` |
| magenta | `--code-keyword` |
| cyan | `--code-property` |
| white | `--code-punctuation` |
| bright black | `--code-comment` |
| bright yellow | `--code-number` |
| bright white | `--code-meta` (`fg-4` in dark) |

  Only the standard 256-colour cube beyond the sixteen comes from the library. Colours are converted from OKLCH and `color-mix(…, transparent)` to hex for the renderer, and switch with the theme. Find matches use the editor's find colours: `--terminal-find-match` = `amber-a2`, `--terminal-find-active` = `amber-a4`.
- Scrollbar is the app's: 5px of `fg-a1` at 60%, 3px from the right, 4px from the ends, 7px and full strength under the pointer or while dragged, on a 14px strip. It shows while scrolling and while the pointer is on its strip (never merely over the terminal), fading 200ms after 500ms.
- Font size: ⌘+ / ⌘− a step between 9 and 24px; ⌘0 resets; applies to every terminal.
- Rendering: xterm.js 6 with WebGL, Unicode 11 widths, clickable links (plain URLs and OSC 8, opened in the browser), 5,000 lines of scrollback, refit on pane resize. One view object per terminal lives outside React for the terminal's life. The last 6 shown keep their WebGL renderer; the oldest gives its context back. While it connects or reconnects, a delayed `LoadingSpinner` (`lg`, labelled "Connecting" or "Reconnecting") sits in its top-right corner (`pointer-events-none absolute end-3 top-2`).
- Find (⌘F or the button): the shared find bar searching the scrollback; Enter next, ⇧Enter previous, Escape closes and returns focus.
- Keys, through the terminal's own handler while it has focus: every key a Mac terminal takes, Ctrl ones included (Ctrl-K is the shell's). Mac: ⌘⌫ `^U`, ⌘← / ⌘→ `^A` / `^E`, ⌥⌫ `ESC DEL`, ⌥← / ⌥→ `ESC b` / `ESC f`, ⌥ is Meta unless the layout types a character with it (⌥L is @ on a German Mac), ⇧⏎ and ⌥⏎ send `ESC CR` (a new line, not run), ⌘C copies a selection (nothing without one), ⌘V pastes (bracketed when asked), ⌘A selects all, ⌘F finds, ⌘L clears the scrollback (and sends `^L` outside a full-screen program), ⌘+ ⌘− ⌘0 font size, ⌘Home / ⌘End / ⌘PageUp / ⌘PageDown scroll; plain Home, End, PageUp, PageDown go to the program. Every other ⌘ key belongs to the app (⌘K stays the command menu, where Clear the scrollback is a command). Off the Mac: Ctrl+Shift+C, V, A, F, L, and Ctrl K goes to the shell.
- ⌘T opens a tab where the front tab is (else the project's first place) and ⌘W closes the front one, only while the terminal page is open. The desktop menu has no Close Window, so ⌘W reaches the page; a browser keeps both.

#### Errors stay where they happen

**Rules**

- A render error unmounts everything up to the nearest boundary, so every region that reads live state sits in an error boundary, layered so a failure takes down only its own region:

| Layer | Fallback |
| --- | --- |
| App root | full page: "Shinsa hit an error.", "Reload to start again. If it keeps happening, copy the details and report it." |
| Each routed page (inside its kept-view `Activity`) | page fallback in place of the page, under a working shell: "This page hit an error.", "The rest of Shinsa keeps working. Try again, or reload if it keeps happening." |
| Each tab's content | inline card in the page column, under the header and tabs |
| Toolbar widgets reading live state | icon fallback |
| Rail top-row widgets | icon fallback; larger rail entries the inline card |
| Banners, attention signals, prefetch | `silent` (nothing in their place) |
| Command menu | silent, but it closes and shows a toast with Copy details; starts over on next open |

- Three looks, one owner:
  - **page**: the kit's `EmptyState` with `IconExclamationTriangle`, title, line, then (`mt-1 flex w-full max-w-md flex-col items-center gap-3`) the message block and the buttons at `sm`.
  - **inline**: a card (`CARD`, `flex min-w-0 flex-col gap-2 p-3`, `role='alert'`): a row with a 14px `IconExclamationTriangle` in `text-orange-text` and "This part of Shinsa hit an error." (`font-medium text-fg-4 text-xs`), the message block, buttons at `xs`.
  - **icon**: keeps the trigger's place as a `secondary icon-sm` button with the orange warning icon, `role='alert'`; its tooltip is the title over the message; a press opens the inline content in a popover (`align='start'`, `sideOffset={6}`, `flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 p-3`).
- Message block:

```tsx
<pre className='corner-superellipse/1.125 rounded-lg border border-border selectable max-h-32 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words bg-bg-2 px-3 py-2 text-left font-mono text-2xs text-fg-3 leading-relaxed'>
  {message}
</pre>
```

- Buttons (`flex flex-wrap items-center gap-1`): Try again (primary, `IconArrowRotateClockwise`) re-renders the region; Reload (`secondary`) reloads the page; Copy details (`secondary`, `IconClipboard2`, flips to a checkmark in `text-primary-text`) copies the message, the stack and the component stack.
- Every caught error is logged with `console.error` and its component stack.
- A boundary resets on a key (the route, or the item for a tab), so leaving and returning recovers.
- A new top-level region or widget reading live state gets a boundary of the right size.

**Example.** If the usage menu throws, the top bar keeps working and that slot shows an orange warning icon button.

#### Text selection: chrome is never selected, content opts in

**Rules**

- The desktop app is chrome by default, as in a native app: no drag or ⌘A selects toolbars, lists or labels, and they show the arrow, not the I-beam. Only under `html[data-desktop]`: in a browser (the web app, shinsa.dev) a page selects and drags the way every page does.

```css
:where(html[data-desktop]) body {
  -webkit-user-select: none;
  user-select: none;
  cursor: default;
}

:where(html[data-desktop]) :where(a, img) {
  -webkit-user-drag: none;
}
```

- Content opts back in through one class, `selectable`, which turns on selection and the I-beam together. There is no other way in:

```css
@utility selectable {
  -webkit-user-select: text;
  user-select: text;
  cursor: text;

  :where(body[data-dragging]) & {
    -webkit-user-select: none;
    user-select: none;
  }
}
```

- Controls inside content stay chrome:

```css
:where(.selectable)
  :where(
    button, select, label,
    [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"],
    [data-slot="badge"], [data-slot="kbd"]
  ) {
  -webkit-user-select: none;
  user-select: none;
}

:where([data-slot="badge"], [data-slot="kbd"], [data-slot="tooltip-content"], .select-none, svg) {
  cursor: default;
}
```

- Base cursors: clickable elements and their descendants (`a[href] *`, `button *`) `pointer` when not disabled; disabled controls `not-allowed`; text inputs and textareas `text`; anything `contenteditable` (not `false`) selects natively with `cursor: text`.
- What is content (selectable): every markdown block's root; every code block; the diff renderer and change snippets; and prose lines that are not markdown blocks opt in where they render (a user's chat bubble, the live agent text, an agent error line, a failed tool message, hand-over summaries, phase details, judgement calls, question and answer, a review note's Why it matters and Also considered, plan revision lines, check-in notes, delegated questions, evidence comparison detail, an error fallback's message). Inline markdown (titles, row text) is not selectable by itself; a prose use adds the class.
- What is chrome: buttons and button-styled links, every list row, tabs, menus, rail and top bar, headings and card titles, labels, badges, status lines, times, greetings and guides, settings descriptions and hints, toasts, tooltips, empty states, and line numbers inside code.

| Element | Selectable | Cursor |
| --- | --- | --- |
| Prose (markdown, chat messages, review prose, plan bodies, findings, notes, error messages) | Yes, `selectable` | I-beam |
| Code blocks, command and test output, diffs | Yes, `selectable` | I-beam |
| Inputs, text areas, the code editor | Natively | I-beam |
| The terminal | its own selection | its own |
| Buttons, links, tabs, menu and select items, list rows, chips (branch, PR, file, commit) | No | Pointer in a browser, arrow in the app |
| Headings, card and section titles, labels, badges, `Kbd`, status, times, hints, greeting, toasts, tooltips, empty states | No | Arrow |
| Line numbers and controls inside content | No | Arrow (pointer on a control in a browser) |

- ⌘A is scoped (one hook mounted at the root): in a field, editor or terminal it is theirs; inside a content region (where the selection or focus is) it selects that region alone, the outermost `selectable` around it; anywhere else it selects nothing, never the page.
- A drag selects nothing: while a pane edge is dragged, `body[data-dragging]` turns content off too; a drag that starts on chrome never starts a selection.
- Lint: `select-text`, `select-all`, `select-auto` and `cursor-text` are rejected in the app, the kit and the catalog; `user-select` / `userSelect` / `WebkitUserSelect` set by hand are rejected in app code and style sheets. A test renders content and chrome and checks which is selectable; another covers ⌘A.

**Example.** Dragging across a task's card title selects nothing; dragging across the agent's reply in the chat selects it with the I-beam; ⌘A inside that reply selects only the reply.

#### Remembered disclosure: every collapsible remembers whether it is open

**Rules**

- Fold any panel, card, section, test output, chat tool row or settings group, then refresh, leave and come back: it is as you left it.
- One store: `useDisclosure(persistId, defaultOpen)` returns `{ open, replaceOpen, toggle }`. It reads `localStorage` key `shinsa.disclosures`, shape `{ version: 1, entries: [[id, open], …] }`, synchronously on first render, so a folded panel is never drawn open then snapped shut, and no fold or chevron animates on load.
- The default holds until you toggle; after that your choice wins.
- Writes are kept in memory, saved 250ms after the last toggle and on `pagehide`. Another tab's save (the `storage` event) is merged in, keeping this tab's unsaved toggles.
- Only the 600 most recently toggled entries are kept: a toggle moves its entry to the end and the oldest fall off.
- Trees use the same store with one entry per folder (`useDisclosureSet(prefix, marked)`).
- Stable ids from what it shows, never an array index: `createDisclosureId(scope, …parts)` joins a scope (`task`, `home`, `queue`, `services`, `roadmap`, `settings`, `ui`) and parts with `:` (a `:` inside a part is escaped as `%3A`). Content that has no stable id is hashed (FNV-1a, base 36). Examples: `task:<taskId>:review:card:<point>`, `task:<taskId>:review:panel:<prose>`, `task:<taskId>:overview:panel:<panel>`, `task:<taskId>:overview:round:<n>`, `task:<taskId>:evidence:<evidenceId>:output`, `task:<taskId>:chat:tool:<callKey>`, `task:<taskId>:code:files:<path>`, `home:section:<section>`, `queue:section:<section>`, `services:project:<id>`, `roadmap:group:<group>`, `settings:mcp:server:<id>`, `ui:…`.
- Required: every collapsible primitive takes a `persistId` (`Panel`, `CompactSection`, `WideSection`, `FoldingBlock`, `RoadmapSection`, `ChangeSnippet`, `ReviewNote`, `ExpandRow`, `ToolGroup`, `UserMessage`, `TestingPanel`, `MergeStepsPanel`, `EvidencePanel`). `DisclosureHeader` takes the `disclosure` the hook returns, never its own open state.
- Opting out says why: `notPersisted('…')`. Used for a finding card (it never folds) and search result groups (new with every query).
- Not collapsibles: popovers, menus and dialogs. A one-way "Show more" on a long diff, code block or tool output is a reveal, not a fold, and is not remembered.
- A card that is jumped to opens again even if it was folded.
- Lint rejects: a collapsible primitive without `persistId`; a `DisclosureHeader` without `disclosure`; and fold state named `open`, `expanded`, `folded` or `collapsed` held in `useState` in any file that folds (it sets `aria-expanded` or renders a `DisclosureHeader`).

**Example.** A user folds the "How to test" panel on one task's report; next week, after many reloads, that panel on that task is still folded while the same panel on other tasks starts open.

## 12. Content and copy

Every string in Shinsa is read by someone deciding what to do next: you at a decision, or an agent in the middle of a
step. The bar is Stripe's dashboard: plain, specific, complete, exactly as long as the job needs. When a string
disagrees with this section, fix the string. The strings agents write (hand-overs, findings, evidence, prompts) follow
the same rules, with the fields and limits in Writing for agents and Hand-overs, evidence and review findings below.

### The one rule

**Each string has one job. Do that job in a full sentence, then stop.**

| Kind | Its one job |
| --- | --- |
| Stage reason | What is happening to the task now |
| Decision (gate) title | What is being decided |
| Toast | What just happened, and what follows when that is not obvious |
| Error | What went wrong and what to do about it |
| Tooltip | What the screen does not already show |
| Empty state | Why there is nothing here, and how something gets here |

None of them sell, reassure, explain the architecture, or give a verdict on work Shinsa has not checked (a review
is never "ready to merge" unless the merge gate says so).

Mistakes that were made before and must not come back:

| Wrong | Why | Right |
| --- | --- | --- |
| "Approve it, ask for changes or reject it." under an agent's question | The answer options of another kind of decision | "Answer the question." |
| "opening the pull request" while pushing to one already open | Says the wrong thing is happening | "pushing the changes" |
| "Building started" logged for every phase | Activity repeats a stage that did not change | Log a stage only when it changes; a phase has its own "Finished: …" line |
| "All 1 checks passed" | The count does not fit its noun | "The check passed" |
| "The same problems came back after 3 fix rounds" after two | An off-by-one the reader can count | "after 2 fix rounds" |
| "Needs the spec approved before work starts" | The screen calls it a plan | "Needs the plan approved before building starts" |
| "gitHub is down" from lower-casing a sentence start | Lower-casing broke a proper noun | Lower-case only an ordinary first word (see Case) |
| "Approve" alone in a task header | Never said whether it approved a plan, the changes or a merge | "Approve plan", "Approve changes", "Merge #4512" |
| "Ready for review" | Does not say who it waits on | "Changes to review" |

### Voice

- **You** for the human in product copy and in activity ("Waiting on you", "Your answer", "You changed this").
  **The human** only inside prompts written for an agent.
- **Agents speak as themselves**, in the first person, and the hand-over is their reply. No string has an agent
  say "Shinsa knows…" about itself, and no prompt or tool text invites a line after the hand-over (`VOICE_RULE` in
  the core's prompt rules). Name Shinsa to the human only where they act in Shinsa ("Shinsa chose this: …",
  "Shinsa’s engine restarted, so this shell ended.").

  | Wrong | Right |
  | --- | --- |
  | "Shinsa found two projects that use this API." (an agent writing) | "I found two projects that use this API." |
  | "I have handed over the plan. Let me know if you need anything else." | Nothing: the plan card is the reply |
  | "My answer is above." | Nothing after the hand-over |
- **Calm and factual.** No exclamation marks, no "magic", no playful labels, no selling words ("seamless",
  "powerful", "effortless", "supercharge", "awesome", "simply", "just"), no apology theatre ("Oops", "Uh oh",
  "Something went wrong!"). A thing that went wrong says what went wrong.
- **Name things by what the reader calls them, not by the field they live in.** "Retry", not "approve the failure
  gate"; "Plan to approve", not "awaiting_plan".
- **Plain words over jargon.** "Waits on" not "depends on"; "Kind of task" not "shape"; "Request" not "intent".
- The two layout names, **Desk** and **Shelf**, are the only names chosen for flavour, and each always carries a
  plain hint line beside it: Desk "Pages sit centred with nothing at the sides, and a button at the top opens what
  needs you." / Shelf "A rail at the side lists every task and stays open, so each one is a click away."

### Language and spelling

- **British spelling** in product copy: "Cancelled", "colour" (the project menu's "Colour"), "summarised",
  "behaviour", "centre", "licence". The spell checker runs `en-GB,en-US`, so both pass the linter; the screen uses
  the British form.
- **US formats for dates and times**, because they come from `Intl.DateTimeFormat('en', …)`: month before day
  ("Oct 22"), a 12-hour clock with AM/PM ("2:14 PM"). Never write a date by hand (see Times and dates).
- Code, routes, stored values and API fields keep their own spelling (`cancelled` as a stage, `?layout=cards`).

### Case

- **Sentence case everywhere**: page titles, headings, card and panel titles, section labels, buttons, tabs, menu
  and select items, ⌘K commands, field labels, placeholders, table headers, badges, tooltips, toasts, empty
  states, dialog titles, status labels. Capitalise the first word and proper nouns only: "All tasks", "Agent
  usage", "Pre-merge steps", "Run in terminal", "Add a Claude account".
- **Proper nouns keep their casing**: Shinsa, GitHub, Claude, Claude Code, Codex, macOS, Finder,
  Electron, Ghostty, Terminal.app, Desk, Shelf. A product's own term keeps its owner's casing.
- **Acronyms stay upper**: CI, MCP, PR, ID, URL, API, SDK, JSON, CLI. Write "ID", never "Id" or "id"; "MCPs" for
  the plural.
- **Shinsa's own words are ordinary words**, lower case mid-sentence: task, decision, plan, round, phase, step,
  check-in, delegation, suggested task, pull request, agent, reviewer.
- **A stage reason is written lower case** ("waiting for CI", "fixing the pull request", "merging", "sizing up
  the work"); the web capitalises its first letter where it starts a line.
- **Lower-casing a sentence start** (to splice one string into another) uses `lowerFirst`: it lower-cases the
  first letter only when the first word has no other capital, so "GitHub is down" stays "GitHub is down" and "The
  checks failed" becomes "the checks failed". Upper-casing uses `capitalise` (first character only).

  ```ts
  function lowerFirst(text: string) {
    const [first = ''] = text.split(/\s/, 1);
    if (/[A-Z]/.test(first.slice(1))) return text;
    return text.charAt(0).toLowerCase() + text.slice(1);
  }
  ```

- **Raw enum values never reach the screen.** Every stage, priority and kind has a display map. The stage labels:

  | Stage | Label | Stage | Label |
  | --- | --- | --- | --- |
  | `triage` | Starting | `shipping` | Pull request |
  | `waiting_on_tasks` | Not started | `awaiting_merge` | Ready to merge |
  | `planning` | Planning | `answering` | Answering |
  | `awaiting_plan` | Plan to approve | `investigating` | Investigating |
  | `building` | Building | `researching` | Researching |
  | `checking` | Checking | `operating` | Running the operation |
  | `reviewing` | Agent review | `awaiting_proposal` | Change to approve |
  | `fixing` | Fixing | `awaiting_operation` | Operation to confirm |
  | `awaiting_review` | Changes to review | `merged` / `done` / `cancelled` | Merged / Done / Cancelled |

  Priorities: Urgent, High, Normal, Low; in a picker the non-urgent ones read "High priority", "Normal priority",
  "Low priority", Urgent stays "Urgent".

### Actions

- **A button is the verb and the object**: "Cancel task", "Request changes", "Approve plan", "Approve changes",
  "Merge the pull request", "Add folder", "Remove project", "Run in terminal", "Copy details", "Start engine".
  Never "Submit", "OK", "Yes", "Confirm", "Go" or a bare noun ("New project").
- **A decision's action is named for what it decides.** A review gate's primary is "Approve changes", a merge
  gate's "Merge #4512", a plan gate's "Approve plan", an operation's "Run the operation". A status label says what
  waits on you the same way: "Plan to approve", "Changes to review", "Ready to merge", "Operation to confirm",
  "Post-merge · 2 steps left".
- **A bare verb is allowed only where the object is already on screen**: a row or card action inside the thing it
  acts on ("Retry" on a paused task's card, "Review" beside the review it opens, "Add" on a project's shelf,
  "Update" on the update row, "Copy" on a code block, "Pause" / "Resume" in a schedule's menu), and an icon-only
  button whose `aria-label` carries the full verb and object. Everywhere else name the object.
- **One verb per object**, in every place the action appears (page, menu, ⌘K, dialog title, confirm button):

  | Verb | Means | Shinsa objects |
  | --- | --- | --- |
  | Create | Make a new thing | task ("Create task: …"), project ("Create a project…") |
  | Add | Put an existing or new thing into a parent | account, folder, repository, MCP, service, suggested task |
  | Remove | Take it out of Shinsa; the thing itself lives on elsewhere | account, project, folder, MCP |
  | Delete | Destroy it for good | schedule |
  | Cancel | Stop a task for good | task ("Cancel task") |
  | Stop | Halt something running | service, a delegated agent, a terminal program |
  | Dismiss | Hide a suggestion or warning | suggested task, the quiet-agent warning, a finding |
  | Retry | Re-run a step that stopped | a paused step ("Retry", "Retry with guidance") |
  | Try again | Recover from an error that is not a step | error fallbacks, a failed sign-in |
  | Open … | Go to or launch something | "Open the pull request on GitHub", "Open in editor", "Open a terminal", "Open the task" |
  | Copy … | Put on the clipboard | "Copy branch name", "Copy webhook URL", "Copy details" |
  | Jump to | Move within the app | "Jump to a task" |

- **A confirm dialog's button repeats verb and object**, and the cancel button says what not confirming keeps:

  | Title (a question, ends in "?") | Body (sentences, full stops) | Confirm | Cancel |
  | --- | --- | --- | --- |
  | "Remove agents@superwall.com?" | "Shinsa signs this account out. Runs on it move to the next account." | Remove account | Keep it |
  | "Stop api?" | what stopping ends | Stop and close | Keep it |
  | "Finish without running the operation?" | "The change stays merged and the task is done. The operation does not run." | Finish without it | Keep it |

  The confirm button is `destructive`; the cancel is `secondary` and always reads "Keep it".
- **A disabled control always says why**, in its tooltip on the page and as its hint in ⌘K, as a plain
  sentence: "Send or clear your comments first", "Tick the 2 pre-merge steps first", "Updating…", "Unavailable:
  needs usage credits", "Kept until it merges or is cancelled". A disabled control with no reason is a bug.
- **An ellipsis on an action means it asks for more before it acts**: it opens a dialog, a page, a field or a
  submenu ("Rename…", "Change key…", "Edit description…", "Other…", "Custom…", "Custom service…", "Add services…",
  "Manage services…", "Wait for another task…", "Run on account…", "Go to file…", "Create a project…"). An action
  that acts at once has none ("Copy branch name", "Mark as done").
- **A progress label is the verb in -ing with an ellipsis**: "Saving…", "Merging…", "Updating…", "Checking for
  updates…", "Reading the code…", "Starting sign-in…".

### Each kind of string

| Kind | Form | Full stop | Example |
| --- | --- | --- | --- |
| Button | Verb + object, sentence case | No | "Approve changes", "Run in terminal" |
| Menu item, ⌘K command | Verb + object; "…" when it asks for more | No | "Copy branch name", "Rename…", "Restart the current step" |
| ⌘K inline action | Verb + quoted object or typed text | No | "Add the suggested task “Fix login”", "Create task: …", "Ask: …" |
| Tab, section label, card title | Noun phrase | No | "Overview", "Recently finished", "Pre-merge steps" |
| Status label | What waits, or what is happening | No | "Changes to review", "Waiting to check in again", "Needs sign-in" |
| Stage reason | Lower case, a few words, now | No | "waiting for CI", "waiting for “Base” to finish" |
| Status line under a row | Short phrase, may join facts with " · " | No | "Building · Agent working", "Started 2h ago" |
| Activity entry | Past-tense sentence, sentence case | No | "Opened pull request #42", "Agent review found 2 issues, 1 blocking", "Finished: Phase 1" |
| Toast, a word or label | The outcome | No | "Copied", "Merged #4512", "Task cancelled", "Sent to the agent" |
| Toast, a sentence | Outcome, then one line of consequence | Yes | "Answered. The agent carries on.", "Approved. Opening the pull request.", "Notes saved." |
| Failure toast | "Couldn’t {verb} {object}" | No when one phrase | "Couldn’t copy to the clipboard", "Couldn’t read the version" |
| Empty state title | What is missing, short | No | "No tasks yet", "Nothing matches", "No terminals in Shop", "Nothing needs you" |
| Empty state description | One or two sentences: why, and how to fill it | Yes | "A terminal keeps running when you close Shinsa." |
| Error title | What happened | Yes when a sentence | "This page hit an error.", "This part of Shinsa hit an error." |
| Error message (domain) | What is wrong and, when not obvious, what to do | Yes | "“Base” was cancelled, so there is nothing to wait for.", "This task is finished. Start a new one." |
| Failure decision | Title says what stopped; body says why and what Retry does | Title no, body yes | "Out of automatic fix rounds" |
| Tooltip | What the screen does not show; a value and its label over a sentence | No for a phrase, yes for a sentence | "Opens the pull request", "Shinsa 0.7.0 is ready. Only the app restarts: agents keep working, and the engine moves to the new version once they hand over." |
| Disabled reason | Plain sentence | No | "Send your line comments to the agent or remove them first" |
| Dialog title | Noun phrase or a question | Question ends "?", else none | "Add an MCP", "Edit api", "Remove project?" |
| Dialog description | Full sentences | Yes | "Shinsa signs this account out. Runs on it move to the next account." |
| Field label | Noun phrase | No | "Folder path", "Project name", "Notes for the agent" |
| Field hint, setting description | Full sentence | Yes | "Leave it empty to keep the saved one." |
| Placeholder | What to type, or an example | Yes when a sentence, else no | "Describe the work", "Add a folder by its path, like ~/code", "What should change here? It goes to the agent with your review." |
| Message status line | One or two short sentences | Yes | "Noted. It needs no reply.", "Not delivered. ‹reason›", the queue's "Sends once round 2 is finished." |
| Home guide line | One sentence a person would say out loud | Yes | "Start with ‹task›: why.", "Then ‹task›: why." |
| `aria-label` | The control's name, verb + object for an action | No | "Copy the task’s handle", "Collapse summary", "Remove folder" |
| Agent prompt | Imperative, one instruction per sentence, tools in backticks, limits as numbers | Yes | (not shown on screen) |

Rules that sit behind the table:

- **Toasts confirm in place.** Acting never navigates; approving, merging, answering, replying or cancelling stays
  on the page and confirms with a toast. Toasts carry no time of their own.
- **Copying always toasts "Copied"**, and a copy trigger flips its own label to "Copied" while its tooltip is open;
  the trigger's name says what it copies ("Copy the task’s handle", "Copy the full commit").
- **Empty states are calm.** Nothing to decide reads "Nothing needs you right now." and one calm sentence. A list
  that has never had anything says "No … yet"; a filter that matches nothing says "Nothing matches".
- **The Home guide** names one task per line and says why in one sentence, nothing else: no status words, no
  repository chips, no pull request numbers, never a position ("item three"), never an id, never a claim the
  decision does not support. Lines read "Start with ‹task›: why.", "Then ‹task›: why.", "After that, …",
  "Finally, …". Model-written text has em and en dashes replaced with ", ", runs of "!" replaced with ".",
  straight double quotes turned curly, and its first letter capitalised before it is shown.
- **Activity is written when something changed**, never for a step that did not move.
- **A count only beside a noun it fits**; never "All 1 checks".
- **Unknown values say so in words**: a cost with no price reads "Unknown" or "$0.30 + unknown", never "$0".
- **When you change a string that a test, a prefix match or a saved value depends on**, change them together. The
  first words of each fix prompt are read back to label a run ("The checks failed", "The agent review found",
  "The human looked at the work", "Pull request #"), so they never change on their own.

### Punctuation and characters

| Character | Use | Never |
| --- | --- | --- |
| `’` (U+2019) | Every apostrophe a person reads: "Don’t", "Couldn’t", "Shinsa’s", "task’s" | `'` |
| `“ ”` (U+201C, U+201D) | Every quotation and every quoted task title: "waiting for “Base” to finish" | `"` |
| `…` (U+2026) | Truncation, in-progress labels, actions that ask for more, an elided value ("Create task: …") | `...` |
| `·` (U+00B7), spaced | Separator between facts on one line: "Building · Round 2", "Claude · a@b.com" | `•`, `|`, ` - ` |
| `–` (U+2013), no spaces around it, in a number range | Ranges: "lines 4–9" | `-` |
| `−` (U+2212) | The minus of a diff count: "+12 −3" | `-` |
| `→` | A change from one value to another, or a path through the app: "2.1.287 → 2.1.310", "Settings → Agent usage" | `->` |
| `⌘ ⇧ ⌥` | Key names, joined with no space: "⌘K", "⇧⌘H", "⇧⌘F"; Ctrl spelled out with a space elsewhere: "Ctrl K" | "Cmd+K" |
| `—` (em dash) | Never in a UI string. Use a colon, a comma or a second sentence | |
| `!` | Never | |
| `?` | Ends a question, in a confirm title or a question placeholder | |
| `:` | Introduces what follows: "Shinsa chose this: …", "Finished: Phase 1", "Phase 2 of 3: Wire the API", "Unavailable: needs usage credits" | A dash |
| `‹ ›` | Placeholders in this document only, never on screen | |

- **Straight quotes and three dots appear only in what a person copies or types**: code, commands, a shell block,
  an agent prompt.
- **Full stops follow the kind** (table above): a single phrase has none (labels, buttons, tabs, badges, status,
  activity, word-toasts, tooltips that are a phrase); a full sentence has one (descriptions, hints, dialog bodies,
  empty-state bodies, sentence toasts, error messages, placeholders written as sentences). A string of two
  sentences ends both. `endSentence` adds a full stop to a string that does not already end in `.`, `?`, `!` or
  `…` (allowing a closing quote or bracket after it).
- **Lists in a sentence** read "A, B and C" (no comma before "and"; "or" when it is a choice). A list of quoted
  titles joins with ", ": "“Base”, “Login”".
- **A colon heads a choice the agent made**: "Shinsa chose this: …", "You changed this. Shinsa chose “normal
  priority”: …".
- **Hyphenate compound adjectives**: "pre-merge", "post-merge", "5-hour limit", "one-line", "real-time".

### Numbers and units

- **Digits, a space, a unit that agrees with the number**: "1 task", "2 tasks", "1 step", "14 steps", "3 phases",
  "2 comments from you". Built with one helper so the noun always agrees:

  ```ts
  function formatCount(count: number, one: string, many: string) {
    return `${count} ${count === 1 ? one : many}`;
  }
  ```

- **Verbs agree too**: "1 task is", "2 tasks are"; "2 pre-merge steps for you"; "3 need you" (the queue button).
- **Progress and position** use "N of M": "1 of 2 done" (and "All done" when complete), "Phase 2 of 3", "Check-in 2
  of 10", "2 of 5" (images in the viewer, counting items, not files), "Version 2 · 4 phases".
- **Compact counts** go after the label in `fg-2` with no word when the label names the noun ("Delegations 3").
  "+N" for a remainder in a list: "2 more".
- **Percent attaches**: "12%", "<1%" for anything between 0 and 1. Usage settings offer 80 / 90 / 95 / 98%.
- **Money**: "$1.75" (two decimals), "<$0.01" for anything between 0 and one cent, "$1.75 of $5.00" against a limit.
- **Tokens**: under 1,000 as is ("812"), then "12k" (rounded), then "1.2M" (one decimal), with " tokens" when
  standing alone.
- **Bytes**: "512 B", "48 KB" (rounded), "1.3 MB" (one decimal).
- **Lines**: "line 12", "lines 4–9".
- **Pull requests**: "#4512" after a word that names it ("Merge #4512", "Pull request #4531"), "PR #42" only where
  space is tight (a chip, a status line).
- **Versions**: bare numbers "1.3.1", "2.1.287"; a channel in brackets "1.2.0 (stable)".
- **Task handles**: the project key, a hyphen and the number, upper case: "SW-142".
- **Every changing number is `tabular-nums`**, so it never shifts its neighbours.

### Times and dates

Every time on screen goes through two components: `TimeAgo` (an age) and `Duration` (a span). Each renders a
`<time dateTime="…ISO…">` with a tooltip giving the exact moment. A bare formatted time in markup is a bug, and the
linter rejects `formatAge(…)` and `formatDuration(…)` rendered anywhere else. Toasts are the only times without a
tooltip.

| Output | Form | Examples |
| --- | --- | --- |
| Age, compact (a row's end) | under 45s "just now"; then minutes, hours, days rounded; from 14 days a date | "just now", "2m", "3h", "5d", "Oct 22" |
| Age, full (`TimeAgo` default) | the compact age plus " ago"; a date stays a date | "Just now", "2m ago", "3h ago", "Oct 22" |
| Age in a phrase (`text`) | a prefix and the age; a date takes "on" | "Started 2h ago", "Finished just now", "Started on Oct 22", "Updated 2m ago" |
| Time ahead | "in" and the gap | "in 3m", "in under a minute", "on Oct 30" |
| Duration | seconds under a minute (at least 1s), minutes, then hours and minutes | "45s", "3m", "1h", "1h 20m", "Worked for 3m" |
| Span in prose | whole words | "3 minutes", "1 hour", "2 days" |
| Clock | 12-hour, minutes always two digits | "2:14 PM", "9:00 AM" |
| Day | weekday, month, day, year | "Wed, Oct 22, 2026" |
| Moment (a schedule's next run) | today: clock; within the next 6 days: weekday and clock; else month, day and clock | "2:14 PM", "Thu 2:14 PM", "Oct 30, 2:14 PM" |
| Age tooltip | the day bright, the clock muted, on one line | "Wed, Oct 22, 2026 **2:14 PM**" (clock in `TooltipLabel`) |
| Duration tooltip | clock to clock, the day muted; "Since" while it runs | "2:14 PM to 2:17 PM Wed, Oct 22, 2026", "Since 2:14 PM Wed, Oct 22, 2026" |
| Tooltip detail | a muted second line naming what the time is when the row does not | "Waiting on you", "Step started", "Finished", "Last message" |
| Limit reset | "until" and the clock | "Out of usage until 3:40 PM" |
| Recurring | "weekdays at 9:00 AM", "… · when its webhook is called" |  |

A time that ticks re-renders once a minute (a shared minute clock), a live duration once a second.

### Abbreviations and short forms

- Spell words out in prose: "pull request", "repository", "configuration". "PR" only in a tight chip or status
  line; "repo" never on screen.
- Kept short on purpose: CI, MCP, ID, URL, "5-hour limit" (Claude's and Codex's 5-hour window, everywhere).
- No dotted abbreviations ("e.g.", "etc.", "approx."): write "such as" or "like" ("Files to include, such as
  src/**/*.ts", "Add a folder by its path, like ~/code").
- Key combinations use the Mac glyphs on a Mac ("⌘K") and "Ctrl K" elsewhere.

### Vocabulary

| Say | Never say | Notes |
| --- | --- | --- |
| task | job, ticket, issue | One piece of work you asked for |
| decision, or the decision's own name ("Review", "Merge", "Plan to approve", "Question", "Paused") | gate | "gate" is the code's word |
| Needs you | inbox, action items | The list of decisions |
| plan | spec | Everywhere, prompts and code included |
| kind of task | shape, type | |
| request | intent, prompt | What you asked for |
| suggested task | follow-up task, recommendation | "Suggested tasks", "Add the suggested task “…”" |
| follow-up | | Only a message to a finished answer, investigation or report |
| delegation | delegated task, subtask | "waiting for 2 delegations", "Delegations" |
| diagnosis | findings | What an investigation hands over |
| findings | issues, comments | Only the reviewer's ("Fix 2 findings") |
| judgement calls | decisions | Choices the agent made in a phase; a decision is only yours |
| check-in | poll, ping | A waiting agent's next look ("Check in now", "Check-in 2 of 10") |
| verify | check | For the setup ("Verify again") |
| CI | checks | The pull request's checks; "checks" are the repository's own |
| pull request | PR, merge request | "PR #42" only where space is tight |
| agent | bot, AI, assistant, worker | Whatever is working, and a round's own agent, which plans, builds, fixes and runs the operation in one conversation. The role (reviewer, answerer, investigator, researcher, and planner or builder for a delegated agent) only where it matters: "The reviewer paused" |
| waiting on another task, Waits on | blocked by, depends on | Stage reason: "waiting for “Title” to finish" |
| round | iteration, cycle | "Round 3", "Started round 3: …" |
| phase | stage, milestone | Within a plan: "Phase 2 of 3" |
| step | | A unit of work an agent does, or a setup step, or a pre-/post-merge step |
| project | workspace, org | The focus filter's unit |
| focus | filter | "Switch focus project", "All work" |
| You | the user | In copy and activity |
| Shinsa | the app, the system, we | Only where you act in it |

### Banned outright

- Exclamation marks, emojis, "magic", "oops", "awesome", "simply", "just" (as a softener), "please", "sorry".
- "Submit", "OK", "Yes", "No" as button labels.
- "Could not…", "Unable to…", "Failed to…" in a failure message; write "Couldn’t …".
- "N/A": a missing value is a word that says why ("Unknown", "No repository", "Not measured while off"), never a dash.
- Em dashes in any UI string.
- Repeating "Try again." in prose right above a Try again button.

### Writing for agents: prompts and tool text

Agents read strings too: the prompts that brief them, the descriptions of their tools and the errors a rejected
hand-over returns. They follow every rule above, plus these.

- **Imperative, one instruction per sentence**, the tool to call named in backticks, limits stated as numbers:
  "Call `complete_phase` once per phase. Mark at most 8 spots." Never "try to keep it short" or "a few spots".
- **The human** is the person in a prompt; an agent writing to the person in the chat says **you**, the way a
  colleague writes in a chat.
- **Never narrate tool calls**, and the hand-over is the reply: no prompt asks for a summary after it, and no tool
  text has the agent announce, point at, repeat or summarise it, say Shinsa received it, or say its turn is over.
- **The first words of each fix prompt are fixed**, because the web reads them to label the run: "The checks
  failed", "The agent review found", "The human looked at the work", "Pull request #". Change one only together
  with the label that reads it.
- **An error a program returns to an agent is a sentence it can act on**: what is wrong and what to do, every
  problem at once. The code (`task_settled`) is for programs; the message (`DomainError(code, message)`) is for
  people and agents. "phases: at least 2 phases." beats "invalid input".
- **Plan everywhere**, prompts and code included (`Plan`, `planFirst`); "spec" means only a command-surface spec in
  the engine.

| Wrong | Right |
| --- | --- |
| "Please try to summarise what you did, and keep it brief!" | "Call `complete_phase` with a `summary` of one or two sentences." |
| "Shinsa needs the spec approved." | "The human approves the plan before you build." |

### Hand-overs, evidence and review findings

An agent hands work over only through Shinsa's tools, never in its final message, and each tool is a fixed shape
with hard limits. The screens that show them are in Patterns (Report tab versus decision layer, Evidence panel,
Chaptered reading order, Test plan panel, Review card); this is how their text is written. Shinsa rejects a
hand-over that breaks a limit and lists every problem; the agent fixes them all and calls the tool again.

**Copy in every field:** sentence case, plain words, no em dashes, no exclamation marks, no filler, no markdown
inside a short field (a title, a label, a `why`). Identifiers go in backticks.

**Commands in text.** A Markdown field can hold a fenced block. A command the human should run themselves is
fenced with `run` after its language (```` ```bash run ````; also `sh`, `zsh`, `fish`, `shell`, `console`), and
the block gets Run in terminal beside Copy. Any other fence is an example and can only be copied. A structured
command (a `command` target in `testing`, a merge step's `command`) is always runnable, so it is never fenced.

````md
Start the preview and open it in Safari:

```bash run
bun run --cwd apps/dashboard dev
```

A retry resumes from the saved offset, for example:

```bash
bun run export --app app_9f2c --from-offset 150000
```
````

**Links to code** use the reference syntax, so the human opens the lines in the Code tab:
`[duplicate.ts](shinsa://file/src/paywalls/duplicate.ts#L12-L20)`. A path in a step target is repository-relative,
with `:line` or `:start-end` (`src/a.ts:12-20`).

**The limits** (characters unless counted), from the protocol's validator:

| Hand-over | Field | Limit |
| --- | --- | --- |
| `propose_plan` | `goal` · `phases` (each `title` · `detail`) · `behaviour` items · `approach` · `files` (each change) · `questions` (options each, option) · `checks` (command) | 300 · 2 to 8 (60 · 160) · 8 of 200 · 700 · 20 (140) · 4 of 200 (up to 4 options of 100) · 6 (200) |
| `complete_phase` | `summary` · `spots` (`why`, `title`, `explain`) · `judgement_calls` (`title`, `call`, `reason`, `alternatives` with `option` and `rejected`) | 240 · 8 (180, 80, 400) · 5 (60, 120, 240, 3 of 100 and 200) |
| `walkthrough` | `approach` · `flow` · `risks` (`title`, `risk`) · `testing.automated` · `testing.manual` (`action`, `expect`, target) · `steps` (`title`, `detail`, `command`) | 1,200 · 2,400 · 8 (60, 280) · 4 of 240 · 10 (240, 240, 400) · 8 (80, 400, 400) |
| `report_review` | `findings` (`title`, `message`, `fix`) · `summary` · `disagreements` (`reason`) | 12 (80, 280, 600) · 400 · 8 (280) |
| `attach_evidence` | `title` · `detail` · comparison `parts` (`label`) · `width` | 80 · 280 · 2 to 6 (40) · up to 7,680px |

#### The plan

| Field | Fill it with |
| --- | --- |
| `goal` | The outcome for the user, one or two sentences |
| `phases` | The work in the order it is built, each a `title` of a few words and a one-sentence `detail`; Shinsa commits each phase on its own |
| `behaviour` | One observable behaviour per item, as true after the change |
| `approach` | How it is built and the choices on the way: modules and data, not code |
| `files` | Each file that changes and what changes in it |
| `out_of_scope` | What this deliberately does not do |
| `verification` | How the change is proven: the failing test, the checks, the runs, the screenshots. Required for any code change |
| `questions` | Only decisions the human must make, 2 to 4 concrete options each, the recommendation worded exactly as one option |

Set only when they apply: `impact` (an operation: what it changes, how much, the dry run or why there is none, how
to undo it), `operation` (its steps in order, each with how to check it worked), `evidence` (the kinds to attach
before review: `screenshot`, `recording`, `test`, `note`, `preview`; a change the user sees asks for a screenshot,
and Shinsa refuses the last phase until each kind is attached), `checks` (commands Shinsa runs after the
repository's own, when those do not prove the change), `approval` (a risky change, so the human approves the plan
first), `change_summary` (only when revising a plan: what changed and why). When the steps Shinsa chose do not fit
the request, the agent calls `reshape_task` with a one-sentence `reason` instead of a plan.

#### A phase

The human reads the work as a technical walkthrough Shinsa builds from every phase, in plan order. The agent that
built it writes the explanation; a separate reviewer says where it disagrees. Forty marked points on a large change
is fine.

- **`summary`**: what this phase changed, one or two sentences.
- **`spots`**: the exact line ranges in the new file the human must read. `why` says what could go wrong or which
  judgement call it holds, **never what the code does**. `critical` could break something, touches data, money, auth
  or a public API, or encodes a judgement call; `high` is worth a careful read; `normal` is context. The key pieces
  of new logic add a `title` (what it is, a few words) and an `explain` (how it works, in plain words a reader new to
  the code follows). Keep each range to the few lines that carry the idea; leave out boilerplate, renames,
  formatting and mechanical edits.
- **`judgement_calls`**: the choices a reader might make differently, each titled by the decision ("Poll instead of
  webhooks", the heading of its card), with the `call`, the `reason`, the `alternatives` rejected and why, and the
  `file`, `line` and `end` when it has them. They matter more than the code: name every one a reader would ask
  about.
- **`walkthrough`**, on the last phase: `approach` (the idea and the structure, a few short paragraphs), `flow` (how
  it works behind the scenes, step by step through the new code), `risks` (each titled: "Offsets shift during an
  export"), `testing` and `steps`.
- **Draw it.** Whenever the change has structure or a flow, `flow` (or `approach`) carries a text diagram in a code
  fence, because reviewers read it first: a tree for structure, boxes and arrows for flow, at most 72 columns, aligned
  for a monospace font, a few words beside each step. It renders on a 14px line so the box lines join. Skip it only
  for one small edit.

  ```
  complete_phase { spots }        the agent's hand-over
          │
          ▼
  assembleReport ──► WorkReport   one report, plan order
          │
          ▼
  Review tab ──► Code tab         a spot opens its lines
  ```

| Wrong | Right |
| --- | --- |
| `why`: "Loops over the rows and sums the totals." | `why`: "Sums before the currency is converted, so mixed currencies add up wrong." |
| A judgement call titled "Decision 1" | "Poll instead of webhooks" |

#### How to test it (`walkthrough.testing`)

Two parts, so the human tells what is proven from what to try. `automated`: one or two lines on which test files
cover what ("`src/paywalls/duplicate.test.ts` covers both paywall kinds and the empty name"). `manual`: a guide of
up to 10 steps, each an `action` (an instruction), a `target` when it happens in one place, and an `expect` concrete
enough to tell pass from fail. Start from where to go (the preview URL, or the command that starts the app and its
local URL), one concrete step each, then the edge cases worth trying (an empty field, a narrow window, a slow
network, a second tab). Leave `manual` empty only when nothing can be tried, and say so in `automated`.

| Target `kind` | `value` | The human gets |
| --- | --- | --- |
| `url` | An http or https address | A link that opens in the browser (`IconGlobe`) |
| `file` | A repository path with `:line` or `:start-end` | The file in the Code tab at those lines |
| `command` | The exact shell command | A shell block with Copy and Run in terminal |
| `screen` | The name of a screen (`Settings → Billing`) | The name, as text |

| Wrong `expect` | Right `expect` |
| --- | --- |
| "It works." | "A copy named “Copy of …” opens with the same code." |
| "Looks right." | "Save is refused with “Give it a name”." |

#### Steps around the merge (`walkthrough.steps`)

The agent first does everything it can in the repository (code, tests, docs, `.env.example`, the migration file, a
config default) and lists only what needs a person with production access. Each step: `when` (`pre_merge` when the
merged code needs it in place, `post_merge` when it needs the merged code), `kind` (`env`, `secret`, `migration`,
`deploy`, `config`, `other`), a `title` that is an instruction naming the thing ("Set `STRIPE_WEBHOOK_SECRET` on the
API in production"), a `detail` (where and how, where a value comes from, what happens without it) and the exact
`command` when there is one ("bun run db:migrate", never "run the migrations"). Never a secret's value: say where to
find it. No step for what happens anyway (CI, the merge). The merge waits until every pre-merge step is ticked; a
post-merge step keeps the task open until the human ticks it, across rounds. A step keeps its tick only while it is
sent unchanged.

#### A fix

`complete_fix` takes a `summary`: what changed and, for anything not changed, why. When the fix changes how the
change works, it sends `walkthrough` with only the parts that changed, each whole (the full new `risks`, `testing` or
`steps`, never just the new item).

#### Review findings

At most 12 findings, one per problem, most severe first, each anchored to a `file` and `line`/`end`. `blocking` is a
bug, a missed requirement, a broken rule, a check the change makes fail, a test that encodes the old behaviour or
passes either way, or UI work without evidence of the changed flow. `should_fix` is not proven broken but worth holding
the merge for (an unhandled edge case, untested logic that decides something, a duplicated helper); it reaches the human
with Fix chosen. `optional` is taste or polish, shown with Dismiss chosen. Taste is never blocking. A check that fails because of the change is always a blocking finding; one already failing on the
base branch is not the change's and does not count against it. Each finding has a `title` (what is wrong, a few words), a `message` (what is wrong and why it matters) and,
when known, a `fix` (a sentence or a short code block). A `summary` of one or two sentences says what was checked and
the overall view. `disagreements` names a judgement call by its number with the `reason` and what the reviewer would
do instead; calls it agrees with are left out. Nothing about what is fine, and nothing restated after the call. The
screen frames all of it as "A signal for you, never the approval."

| Wrong | Right |
| --- | --- |
| title: "Possible issue" | title: "Retry drops the saved offset" |
| message: "This might not work in all cases." | message: "A retry starts from 0, so a 2-hour export repeats every row it already wrote." |

#### Inquiries and operations

`answer` leads with the answer, then the evidence as `shinsa://` links to files and lines. `report_diagnosis` gives
the cause, or what was ruled out, then the evidence (worktree edits are thrown away). `submit_report` puts the
conclusion or recommendation first, then the options and the evidence. `report_outcome` says what ran, what changed
and anything left to do or undo. The first three take `propose_change` (`request`, `why`) only when the finding calls
for a code change.

#### Evidence

The human reviews the evidence before the diff. Every item is attached with `attach_evidence`, which copies the
files into Shinsa's store (`<data>/evidence/<task id>/round-<n>/`), and is counted as an item, not a file: "4 pieces
of evidence" may be eight images.

| The change | Attach | Kind |
| --- | --- | --- |
| A screen looks different | Each view changed, before and after, at the wide and the narrow width, light and dark | `comparison` |
| One view in several states | One comparison, a part per state named by its `label` ("Empty", "Loading") | `comparison` |
| One view in light and dark | One comparison with parts `Light` and `Dark`, never two screenshots | `comparison` |
| A new screen with nothing before it | Per width, its light and dark as one comparison | `comparison` |
| Something moves or responds | A recording of the flow, 5 to 20 seconds, at 1280px | `recording` |
| Logic, an API, a script | The run of the focused test that fails without the change, the command on its first line | `test` |
| What a run cannot show | A short markdown note; measurements in a table, the changed file linked | `note` |
| A preview deployment | Its URL | `preview` |

- **Widths**: 1280px and the narrow width the product supports: 390px for a responsive web app, about 900px for
  Shinsa's own screens. Skip a width or theme only when it cannot differ, and say so in `detail`.
- **Fields**: `title` says what it shows ("Settings, appearance section"), never a file name; `detail` is one
  sentence on what to look at ("The muted labels now pass 4.5:1 contrast."); `width` in CSS pixels; `theme` `light`
  or `dark`, left off a comparison whose labels say it. A before shot attached alone (`stage: "before"`) pairs with
  its after by the same title, width and theme.
- **Before shots first**, before any edit (or from `git worktree add --detach /tmp/before <base commit>`
  on another port); the app started as the repository says, on a free port, never a server someone else started;
  the browser console read on every page (an error you introduced is a bug, not evidence); every image looked at
  before it is attached.
- **Test and check output** is attached as `test` or `check`, shown as plain text, never as a note.
- **The reviewer's own evidence** is independent and shows a purple "From the agent review" badge.
- **When the app cannot run** here, say so plainly and attach what could be shown: a test, a type check, a rendered
  component. Never claim something works that was not seen working.

```json
{ "kind": "comparison", "title": "Review tab, a finding with its fix", "width": 1280,
  "parts": [{ "path": "/tmp/evidence/review-light.png", "label": "Light" },
            { "path": "/tmp/evidence/review-dark.png", "label": "Dark" }] }
```

| Wrong | Right |
| --- | --- |
| title "settings-after.png" | title "Settings, appearance section" |
| Two screenshots, one light and one dark | One comparison with parts `Light` and `Dark` |
| A note pasting the test output | A `test` item with the command on the first line |

## 13. Accessibility

Accessibility is part of the look: the rules below are built into the kit's components, so a screen built from
them gets them for free. Never hand-build a control the kit already has.

### Contrast

| Token | Light | Dark | Use | Target |
| --- | --- | --- | --- | --- |
| `fg-4` | `oklch(0.21 0.008 274.53)` | `oklch(0.946 0.001 286.37)` | Titles, values, emphasis | 7.67:1 on `bg-1`, 7.10:1 on `bg-2` (light) |
| `fg-3` | `oklch(0.443 0.008 277)` | `oklch(0.787 0.007 286.24)` | Body | above 4.5:1 |
| `fg-2` | `oklch(0.543 0.009 278.5)` | `oklch(0.655 0.009 286.15)` | Meta, hints, placeholders, timestamps | 5.01:1 on `bg-1`, 4.64:1 on `bg-2` (light): the lowest step that may carry text |
| `fg-1` | `oklch(0.764 0.004 271.36)` | `oklch(0.54 0.008 286.14)` | Decorative only: dividers, watermarks, line-number gutters, disabled glyphs and a disabled field's text | never readable text, labels or placeholders |
| `icon-2` | `oklch(0.665 0.009 278.5)` | `oklch(0.5 0.009 286.15)` | Icon beside `fg-2` text | held at 3:1 (WCAG non-text) in light, because an icon-only secondary button carries its meaning by glyph alone |
| `icon-1…4` | `0.831 / 0.665 / 0.631 / 0.538` L | `0.44 / 0.5 / 0.58 / 0.66` L | Icon ink a step under its text | each at 72% of its `fg-N`'s APCA contrast on `bg-1` (Lc 75 / 62 / 54 / 30) |
| `*-text` (tones) | tuned per hue | the `-4` step | Text on its own `-a2` tint or the page | clears APCA Lc 60 in light; 4.96–10.4:1 in dark |

- **Body text clears 4.5:1, large text 3:1, meaningful non-text (icons, control edges) 3:1.**
- **Never stack an opacity on a token that is already a tint** (`text-fg-2/70`): it drops under 4.5:1. One layer
  owns the muting; there is no opacity on an icon at all except a reveal (`opacity-0` → `opacity-100`).
- **A tone's `-4` step is a fill, not text**: on its own tint it lands at 1.7–2.4:1. Text on a tint is `*-text`.
- **Disabled** controls drop to `opacity-45` (buttons, checkboxes) or `opacity-50` (inputs and textareas, which also
  turn their text `fg-1`; select triggers and items, menu items, tabs, labels, the command input and command rows; a
  switch fades its parts), all with `cursor-not-allowed`. They are exempt from the contrast floor, and their reason
  is always available in a tooltip.

### No focus states, and how the keyboard still works

Shinsa draws **no focus states**: no `ring-*`, no `outline`, no border recolour and no background wash marks
keyboard focus, on controls, rows, tabs, fields or links. Every interactive kit element carries `outline-none`,
and the base layer removes the browser's own outline for anything that does not:

```css
@layer base {
  :focus,
  :focus-visible {
    outline: none;
  }
}
```

The linter rejects `focus:`, `focus-visible:`, `focus-within:` and `ring-offset-*` anywhere in the kit and the
app. The app is built to feel like a native Mac app, whose toolbars and lists show no focus rings; what keeps the
keyboard usable instead:

- **Lists show their highlight.** In a menu, select, command list, setup option list or any `HighlightList`, the
  arrow keys move the list's sliding highlight surface (`bg-bg-a2`), the same one the pointer moves. That
  highlight is the list's selection, not a focus mark, so it stays.
- **Tooltips open on keyboard focus at once** (no 600ms wait), so tabbing onto an icon-only button names it on
  screen.
- **Hover-only reveals also reveal on focus**: a code block's Copy and Run in terminal corner shows on hover, when
  one of its buttons has keyboard focus (`has-[:focus-visible]:opacity-100`, a reveal, not a focus mark) and
  always on touch (`pointer-coarse:opacity-100`). Any new hover reveal follows the same three conditions.
- **Text fields show a caret**, the native signal of focus.
- **Selected things are marked, focused things are not.** A picked card, tile or swatch has a `border-primary`;
  a selected row in a `divide-y` list draws its edge on `::before`
  (`before:absolute before:inset-0 before:border before:border-primary`) so it neither doubles the dividers nor
  changes the row's height.

### Keyboard model

- **Everything is reachable by Tab** in DOM order: buttons, links, fields, tab lists, list boxes. Never a
  positive `tabIndex`. A purely decorative duplicate (the chevron inside a header that is already one button) is
  an `aria-hidden` `<span>` out of the tab order.
- **One global shortcut: ⌘K** (Ctrl K elsewhere) opens the command menu from anywhere, inputs included. It reaches
  every action in the app, so anything a mouse can do the keyboard can do through it. Nothing else is bound to a
  key on the page, except while a surface that owns keys is open:

  | Where | Keys |
  | --- | --- |
  | Anywhere | ⌘K / Ctrl K: command menu |
  | Any input | Enter sends |
  | Code tab, while open | ⌘P go to file, ⇧⌘F search in files, ⌘F find in this file, ⌘G go to line |
  | Review tab, while open | J next point, K previous point |
  | Terminal page, while open | ⌘T new terminal, ⌘W close it; a focused terminal takes every key a terminal would (Ctrl K included) |
  | Image viewer | Esc close, ← → previous / next, `+` `-` zoom, `0` fit |
  | Find bar | Enter next match, ⇧Enter previous, Escape closes and returns focus to what it searched |
  | Mac app menu | ⌘[ back, ⌘] forward, ⇧⌘H Home, ⌘, Settings, ⌘R reload |

  The linter rejects any `addEventListener('keydown' | 'keyup')` in the app outside the four hooks that own these
  shortcuts; every other key handler sits on the element that has focus (`onKeyDown`). A shortcut that
  exists is shown in its tooltip ("Search and actions ⌘K", "Home ⇧⌘H"), since the key is not on screen.
- **Command menu (cmdk)**: typing filters, ↑ ↓ move the highlight and loop at the ends, Enter runs, Backspace on
  an empty input goes back a page and re-selects the row that opened it, Escape closes and restores focus to where
  it was (a command that moves focus on purpose declines the restore). Disabled rows are skipped by the arrows and
  cannot be run by Enter; the first highlighted row is the first enabled one.
- **Menus and selects (Base UI)**: Enter, Space or ↓ opens from the trigger; ↑ ↓ move with typeahead by first
  letters; Home / End jump; Enter or Space picks; Escape closes and returns focus to the trigger; → opens a
  submenu, ← closes it.
- **Tabs and the segmented `Choice` (Base UI Tabs)**: one tab stop for the whole list; ← → move between tabs
  (roving focus) and activate them. Never write `role="tab"` or `role="tablist"` by hand; the linter rejects it.
- **List boxes built in the app** (setup's option list): the list takes focus when the step opens and is one tab
  stop (`tabIndex={0}`, rows `tabIndex={-1}`); ↑ ↓ Home End move the highlight through `aria-activedescendant`;
  Enter or Space picks. These keys belong to the list while it has focus, not to the page.
- **Disclosure headers**: a header with nothing interactive inside is one `<button aria-expanded>`, so Enter or
  Space folds it. A header holding its own controls makes the chevron the single focusable trigger, a
  `<button aria-expanded>` named "Expand ‹label›" / "Collapse ‹label›". Never a button inside a button.
- **Dialogs** trap focus while open, Escape closes them, and focus returns to the element that opened them.
- **Tooltips** close on Escape and on a press; one closed that way stays closed until the pointer leaves.

### Names and labels

- **Every icon-only button has an `aria-label`** naming its action as verb and object: "Copy", "Run in terminal",
  "Remove folder", "Collapse summary", "Open the queue", "New task", "Search and actions", "Close". When the glyph
  does not say the action plainly, its tooltip repeats the `aria-label` exactly.
- **A labelled control has no `aria-label`** that differs from its visible text; the visible label is its name.
- **A state that changes changes the name**: a copy button reads "Copy", then "Copied"; a disclosure reads
  "Expand …", then "Collapse …".
- **A generic options trigger** (`•••`) is named for whose options it holds: "Task actions", "Project options",
  "Schedule options".
- **The dialog and sheet close X** is named "Close" and has no tooltip.
- **Groups of controls get a name**: a `Choice` or tab list takes `aria-label` from its label ("Sections",
  "Terminals"); a search field without a visible label is named by its purpose ("Search tasks", "Search in
  files", "Go to file").
- **Icons**: decorative icons are `aria-hidden` (the default for `<Icon />` without a label). An icon that alone
  carries meaning gets `role="img"` and an `aria-label`: a task's kind icon in the status column, the context
  meter ("Used for the next turn"), the usage gauge, a checklist mark ("Done" / "Not done"), the logo ("Shinsa").
- **Small marks that carry meaning without a label** (queue tiles, check icons, a risk dot, a status letter) also
  carry a tooltip saying it: "Changes to review", "Passed", "High risk".
- **Where you are**: the current nav item or rail row carries `aria-current="page"` (and shows its filled icon);
  the Review tab's current point `aria-current="location"`.
- **Visually hidden titles**: a dialog, sheet or command menu without a visible title still has one, `sr-only`
  (`SheetTitle className='sr-only'` "Files", "Queue"; the command menu's "Command menu" with the description
  "Search for a page or an action.").
- **Inputs are labelled.** A field has a `FieldLabel` (rendered as its `<label>`), or, where the design has no
  visible label, an `aria-label` equal to what a label would say ("Folder path", "Sign-in code", "Terminal
  name"). A placeholder is never the only name. A `Label` wrapping a checkbox, radio or switch makes the whole
  label its hit target and its name.

### Live regions and announcements

| What | Role | Behaviour |
| --- | --- | --- |
| Toasts (sonner) | sonner's own polite live region | Every toast is announced; position top centre, 12px from the top, 8px apart |
| `FieldError` | `role="alert"` | Rendered only while there is an error; each distinct message once (duplicates are folded, several become a bulleted list) |
| Error fallbacks (page, inline card, icon popover) | `role="alert"` | The region that broke announces itself |
| `Spinner` | `role="status"`, `aria-label="Loading"` by default | Name it for what loads when that is not obvious |
| Reconnecting dot | `role="status"`, `aria-label="Reconnecting"` | |
| Health and engine banners | `role="status"` | |
| Find match counts (Code tab, terminal, search panel) | `aria-live="polite"` | The "3 of 12" updates are read |
| Live card's latest agent text | `aria-live="polite"` | Interim messages are read as they arrive |
| Shimmering text ("Starting", "Thinking") | per-character spans `aria-hidden`, the whole string in an `sr-only` span | Read once as a word, not letter by letter |
| A message being delivered | the light `aria-hidden`, "Sending" in an `sr-only` span | The state has no visible word, so it is read |
| Busy `Button` (`loading`) | `aria-busy="true"` | Keeps its label; presses and keys are ignored; never `disabled` |
| Invalid field | `aria-invalid` | Draws a 1px `red-4` ring (`aria-invalid:ring-1 aria-invalid:ring-red-4`) on `Input` and `Textarea` |
| Tooltip | the trigger gets `aria-describedby` pointing at it while open | |

- **An error is announced where it happened**: a wrong field's message is its `FieldError`; a refusal from the
  server is the server's message in a toast; a refused setup answer is an error line under the step.
- An error that has no field root to drive it (a checkbox group, a form-level message) still renders with
  `role="alert"`, only while the error exists, and its `id` goes on the control's `aria-describedby`.

### Reduced motion

Under `prefers-reduced-motion: reduce` every transition and animation is cut to nothing, globally, except spinners
and dialogs:

```css
@media (prefers-reduced-motion: reduce) {
  *:not(.animate-spin, [data-reduced-motion="fade"]),
  *:not(.animate-spin)::before,
  *:not(.animate-spin)::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`!important` is the only lever that beats inline styles from third-party code (sonner, the highlight indicator),
and the user's setting has to win.

- **Dialogs, alert dialogs, the command menu and their scrims** carry `data-reduced-motion="fade"`: they drop their
  scale (`motion-reduce:starting:scale-100 motion-reduce:data-starting-style:scale-100
  motion-reduce:data-ending-style:scale-100`) and keep only their fade.
- **Looping motion stops**: `ShimmeringText` reads `useReducedMotion()` and stops; skeletons and progress shimmers
  carry `motion-reduce:animate-none`; the tab indicator `motion-reduce:transition-none`.
- **Swaps become a change or a fade**: the live card's new message simply replaces the old one; the image viewer
  opens, closes and steps with a 150ms fade and no slide or flight; a setup step enters with a fade only.
- **Spinners keep spinning** (`.animate-spin`), since a frozen spinner reads as a hang.

### Hit targets and sizes

- Sizes are the desktop sizes at every width; nothing grows on touch. The kit's interactive sizes:

  | Control | Size |
  | --- | --- |
  | Button `xs` / `sm` / `default` / `lg` | 22 / 24 / 26 / 30px tall |
  | Icon button `icon-2xs` / `icon-xs` / `icon-sm` / `icon` / `icon-lg` | 18 / 22 / 24 / 26 / 30px square (`icon-2xs` only for a close mark inside a 24px row) |
  | Menu, select and command rows | 24px |
  | Input, select trigger, default tab list | 26px |
  | Underline tab list | 32px |
  | Checkbox `sm` / `md` | 14 / 16px |
  | Switch | 32 × 20px track, 16px thumb |

- **Whole rows and tiles are the target**: a list row, a task row, a disclosure header is one click target end to
  end, never a small link inside a row.
- **A label is part of its control's target**: a `Label` around a checkbox, radio or switch takes the click.
- **Nothing is hover-only on touch**: anything revealed on hover is shown on `pointer-coarse`; a tooltip is never
  the only way to reach information (the same text is in ⌘K, a popover or the page).
- **A tree row in the Code tab acts on the press**, not the release, for speed with the mouse; touch and the
  keyboard still act on the click.

### Semantic roles

| Element | Markup |
| --- | --- |
| Page and section titles | `h1` / `h2` (the empty state's title is an `h2`; a panel header's button sits inside its `h2`) |
| Every clickable thing | a real `<button>` or `<a>` (Base UI `Button` renders a `<button>`); never a `div` with `onClick` |
| A link styled as a button | stays an `<a>` with `href` |
| Collapsible header | `<button aria-expanded>` |
| Tabs, segmented choice | Base UI Tabs: `tablist` / `tab` / `tabpanel` |
| Option list | `role="listbox"` with `role="option"` rows, `aria-selected`, `aria-multiselectable` when several may be picked |
| Menus | Base UI `menu` / `menuitem` / `menuitemcheckbox`; options and menu items are written only inside the kit's `HighlightList` |
| Field group | `role="group"` (`FieldSet`) with a legend |
| Round divider | a `separator` named by its round |
| Times | `<time dateTime>` |
| Read-only check | `role="img"` named "Done" or "Not done" |

### Dialogs and alert dialogs

- **`Dialog`** (forms, sign-in, Add an MCP): Base UI dialog, modal, focus trapped, Escape and a click on the scrim
  close it, focus returns to the trigger. It always has a `DialogTitle` (visible, or `sr-only`) and usually a
  `DialogDescription`; the corner Close is a `secondary icon-sm` button named "Close".
- **`AlertDialog`** (every confirmation, through `ConfirmDialog`): `role="alertdialog"`, focus trapped, Escape
  cancels, a click on the scrim does nothing, so a destructive choice is never made by accident. Its title is a
  question, its description says what happens, the confirm button is `destructive` with verb and object, the
  cancel `secondary` "Keep it". The action runs only after the close animation completes (`onOpenChangeComplete`).
- **`Sheet`** focuses the sheet itself on open (`initialFocus` defaults to the popup), not its first field.
- **Text from outside a dialog is held while it closes**, so the title and buttons never change under the fading
  dialog.

### Selection

- The app is chrome by default: `body` is `user-select: none` with `cursor: default`; links and images never
  ghost-drag (`-webkit-user-drag: none`). Content a person may want to copy opts in with one class, `selectable`
  (I-beam cursor and selection together): prose, code blocks, diffs, messages, error messages.
- ⌘A selects only the content region the selection or focus is in, never the whole page; in a field, editor or
  terminal it is theirs.

## 14. Responsive and narrow widths

Shinsa is built for a full desktop window and must still work in a floating window about 900px wide. Measure every
screen at 900px and 1280px, in light and dark. There is no separate phone design: below 640px the same screens wrap
and stack, and nothing is hidden that a person needs.

### 14.1 Breakpoints

Tailwind's defaults, unchanged: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px (the generated
table in Tokens has them). Write mobile-first (`sm:`, `md:`) or as an upper bound (`max-sm:`, `max-md:`); both appear
below. A component that sits in containers of different widths uses a container query instead of a viewport
breakpoint: a named container on the parent and its variant on the child, as `FieldGroup`
(`@container/field-group`) and `Field orientation='responsive'` (`@md/field-group:flex-row`) do. Where a component
needs the width in script, it reads `useMediaQuery('(max-width: 767px)')`, the same 768px line.

### 14.2 What changes at each width

| Below | What changes | Classes |
| --- | --- | --- |
| 1024px (`lg`) | A stage strip of 7 or 8 steps (pre-merge and post-merge count as two each) hides the labels of its finished and skipped steps and keeps their marks; on a strip longer than 8 they are hidden at every width. A renamed file's "renamed from …" note in the code pane hides | `max-lg:hidden` on the label (`hidden` past 8); note `max-lg:hidden` |
| 768px (`md`) | The Shelf layout's rail leaves the page and opens as a 288px sheet from the left | rail `hidden md:flex`; sheet `side='left'` with `w-72` |
| 768px (`md`) | In the Shelf layout a 44px compact bar appears at the top: Open the queue (opens the rail sheet), Home, ⌘K, New task | compact bar `h-11 md:hidden` |
| 768px (`md`) | The task list drops its Repository, Status and Pull request columns and the waits-on links, keeping the title and Updated; its search field narrows from 208px to 128px | grid `grid-cols-[minmax(0,1fr)_7.5rem_12rem_4.5rem_4.5rem] max-md:grid-cols-[minmax(0,1fr)_auto]`, columns `max-md:hidden`; search `w-52 max-md:w-32` |
| 768px (`md`) | A code workbench turns its explorer column into a sheet, every diff becomes unified and the layout toggle hides | `useMediaQuery('(max-width: 767px)')`; toggle `max-md:hidden` |
| 768px (`md`) | A report index shows the `path:lines` of each point only from `md` | `hidden md:inline` |
| 640px (`sm`) | The Desk frame's side gutters go from 20px to 12px | `px-3 sm:px-5` |
| 640px (`sm`) | A card header stops being a two-column grid: title and actions wrap in a flex row, the description goes last, the actions scroll sideways | `max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3`; actions `max-sm:overflow-x-auto max-sm:py-1` |
| 640px (`sm`) | A stage strip shows only the current or waiting step's label | other labels `max-sm:hidden` |
| 640px (`sm`) | The Desk top bar's Focus menu hides | `max-sm:hidden` |
| 640px (`sm`) | An account's usage header hides its "Updated 2m ago"; an MCP server row hides its cost text | `hidden sm:inline` |
| 640px (`sm`) | The setup stepper becomes one description line ("Step 2 of 6: ‹step›") | stepper `max-sm:hidden`, line `sm:hidden` |
| 640px (`sm`) | Usage bars shrink from 160px to 96px | `w-24 sm:w-40` |
| 640px (`sm`) | Evidence: comparisons with more than two parts go two across instead of three; screenshot and recording grids drop to one column | `grid-cols-2 sm:grid-cols-3`, `sm:grid-cols-2` |
| 640px (`sm`) | The image viewer's caption bar stops capping at 576px | `sm:max-w-xl` |

### 14.3 Overlays at narrow widths

- A dialog is `w-[min(26.25rem,calc(100vw-2rem))]` (420px, or the viewport less 16px a side) and at most
  `max-h-[calc(100dvh-2rem)]` tall. The small alert dialog is `w-[min(20rem,calc(100vw-2rem))]`.
- The command menu is `w-[min(32.5rem,calc(100vw-2rem))]`, sits `top-[max(3rem,14vh)]` and its list is at most
  `min(384px, 60dvh)` tall.
- Popovers and menus are placed by Base UI with collision handling, so they flip and shift to stay on screen. A
  popover that could exceed the viewport caps itself (`max-w-[calc(100vw-1rem)]`).
- A side sheet is `w-3/4` of the viewport, capped at 384px from `sm` (`sm:max-w-sm`); a top or bottom sheet is at
  most `max-h-[85dvh]`. The rail's sheet sets its own `w-72` (288px).

### 14.4 Rules

- **Fit, then wrap, then hide.** First let text truncate (`min-w-0` on the flex child, `truncate` on the text), then
  wrap rows, then hide only secondary detail (a timestamp, a cost, a secondary column). Never hide the action a
  person came for.
- **Labels drop before actions do.** A toolbar that runs out of room drops its buttons' labels to icon-only buttons
  (each keeps an `aria-label` with the full verb and object and gains the tooltip that says it, as the compact bar's
  "Open the queue" and "New task" do). Actions never fold into an overflow menu because of width.
- **Hover-only controls must still show on touch.** A control revealed on hover (`opacity-0 group-hover:opacity-100
  group-active:opacity-100`) also shows when the device has no hover: add `pointer-coarse:opacity-100`.
- **Every select fits at 900px.** A select or menu trigger with a long value truncates inside its own width; it never
  pushes its row wider than the window.
- **No touch step-up.** Controls keep the 22 / 24 / 26 / 30px ramp at every width; the only enlarged hit areas are
  invisible ones: the checkbox's (the box plus 6px on every side, `after:-inset-1.5`) and the switch's (12px at the
  sides, 8px above and below, `after:-inset-x-3 after:-inset-y-2`).
- **Inline notes and media scale with their container**, not the viewport: an inline note is
  `max-w-[min(36rem,calc(100cqw-6rem))]`.
- **The desktop window keeps its traffic-light room at every width**: inside the Mac app's window the Desk top bar
  carries `desktop:ps-16`, and the rail's top row and the compact bar `desktop:ps-20`.

## 15. Dark mode

Both themes ship, and each is tuned rather than inverted. The dark palette is a warm grey at hue 286, its surfaces
at chroma 0.004 to 0.007 (`--background` `oklch(0.174 0.004 285.97)`, a step darker than `bg-1`
`oklch(0.197 0.004 286.03)`); light is a white page (`--background` and `bg-1` both `oklch(1 0 0)`) with near-neutral
greys at chroma 0.001 to 0.003. Every value is in the Tokens tables.

### 15.1 How the theme is applied

- `.dark` on `<html>` switches the tokens (`.dark { … }` in Appendix A). The `dark:` variant is
  `@custom-variant dark (&:is(.dark *))`, so `dark:` classes apply to everything inside a `.dark` element.
- `color-scheme` follows the theme (`light` on `:root`, `dark` on `.dark`), so native scrollbars, form controls and
  the caret match.
- Every alias (a token defined from another, such as `--primary-1`, `--foreground` or `--code-keyword`) is declared on
  `.dark, :root` together. A custom property resolves where it is declared, so an alias declared only on `:root` would
  keep light values inside a `.dark` region. Declared on both, a `.dark` region inside a light page resolves its own
  dark values. This is how the image viewer is dark in both themes: its popup carries `dark`. The one alias declared
  on `:root` alone is `--selection` (`var(--bg-a4)`), so a `.dark` region inside a light page keeps the light
  selection wash.

### 15.2 What differs in dark, beyond the colour values

| Thing | Light | Dark |
| --- | --- | --- |
| Elevated control edge (`shadow-control-elevated`, hover `-hover`) | `0 0 0 1px var(--bg-3)`, hover `var(--bg-4)` | `inset 0 0 0 1px var(--bg-3)`, hover `var(--bg-4)` |
| Surface rings (`shadow-1` to `shadow-4`) | outer ring `0 0 0 1px var(--bg-3)` | inner ring `inset 0 0 0 1px var(--bg-3)` |
| Popover surface (`--popover`) | `bg-1`, the page colour | `bg-2`, above both the page (`--background`) and `bg-1` |
| A field inside a popover (`--input`, `--input-hover`) | `bg-2`, hover `bg-3` | `bg-3`, hover `bg-4` (the popover is already `bg-2`) |
| Text on a tint (`--*-text`) | a tuned darker colour per tone that clears APCA Lc 60 | the tone's own `-4` fill, which already clears 4.5:1 |
| Primary | `--primary-4` `oklch(0.6 0.215 256)`, `--primary-text` the same | `--primary-4` `oklch(0.62 0.2 256)`, `--primary-text` `oklch(0.72 0.17 256)` |
| Outline button fill / pressed | `before:bg-background` / `before:bg-bg-1` | `before:bg-bg-3` / `before:bg-bg-4` |
| Selected tab pill | `bg-background` | `bg-bg-4` |
| Scrim behind a dialog or sheet | `bg-black/10` | `bg-black/55` |
| File marks (`--file-*`) | lightness 0.6 to 0.77, chroma 0.035 to 0.14 | lightness 0.74 to 0.9, chroma 0.03 to 0.12 |
| Terminal black and white | ANSI 0 `fg-4`, ANSI 15 `--code-meta` | ANSI 0 `bg-4`, ANSI 15 `fg-4`, so black and white stay readable on the dark background |
| Neutral selection (`--selection`) | `bg-a4`, `oklch(0 0 0 / 0.118)` | `bg-a4`, `oklch(1 0 0 / 0.169)` |

### 15.3 Rules

- **Every mode branch or it didn't happen.** A value that differs by theme is a token defined in both `:root` and
  `.dark`. Never write a colour that only works in one theme, and never add a `dark:` override where a token would
  do.
- **Edges survive in the dark.** A drop shadow reads as nothing on a dark page, so dark draws edges as inner
  hairlines of `bg-3`. Never rely on a shadow to separate surfaces.
- **Popovers float by a surface step in dark** (`bg-2` on the darker `--background` page) and by their ring in
  light.
- **Status colour keeps its meaning.** The tone ramps keep their hues; the `-1` and `-2` tints darken and the `-4`
  fills stay vivid, so a red badge reads as red in both themes.
- **Check both.** Look at every screen in light and dark before calling it done.

## 16. Enforced rules

Most rules in this file are taste. The ones below are also machine-checked: a change that breaks one fails
`bun lint`, the pre-commit hook or CI. They come from five places:

| Gate | Command | What runs |
| --- | --- | --- |
| Biome | `biome check .` locally, `bunx biome ci .` in CI | Biome 2.5.9 lint and format, the `useSortedClasses` class order, one GritQL plugin |
| Conventions | `bun lint:conventions` (`bun scripts/lint-conventions.ts`) | A Babel-parsed custom linter: comment ban, verb catalog, every design and class rule below |
| Spelling | `bun lint:spelling` | cspell 10.4.0, British and American English |
| Hygiene and types | `bunx knip`, `bunx sherif -i @types/node`, `bun check-types` | Dead files, exports and dependencies; workspace dependency drift; strict TypeScript |
| Tests | `bun run test` | Every workspace's `bun test` with a 100% line and function coverage floor |

`bun lint` is `biome check . && bun lint:conventions && bun lint:spelling`.

### How the conventions linter reads code

These mechanics decide what each rule below can and cannot see. Get them right before trusting a rule to catch
something.

- **Files.** It walks these roots and checks every `.ts` and `.tsx` file in them, skipping any `node_modules` or
  `dist` folder and every `.d.ts` file: `apps/engine/src`, `apps/engine/test`, `apps/web/src`, `apps/web/test`,
  `apps/desktop/src`, `apps/desktop/test`, `apps/marketing/src`, `packages`, `scripts`. A root that does not exist
  is skipped. Separately it reads every `.css` file under `apps/web/src`, for the raw `user-select` rule only.
- **Two kinds of check.**
  - **Line rules** ("class rules") run a regular expression over each source line of a `.tsx` file. They see
    text, not meaning: a class split across two lines, built in a `.ts` file or assembled from a variable is
    invisible to them, and a matching string that is not a class (a prop value, a JS key) is caught all the same.
    A rule with an `unless` pattern passes when that pattern also matches **the same line**.
  - **Syntax rules** walk the Babel AST (`typescript` plugin, plus `jsx` for `.tsx`). They read JSX element
    names, attribute values and every string literal or template chunk inside an attribute (so `cn(...)`, ternaries
    and template literals in a `className` are all read).
- **Scopes.** Three scope names recur below:
  - **app**: `apps/web/src`.
  - **app and kit**: `apps/web/src` and `packages/ui/src`.
  - **the `/ui` catalog**: the five specimen pages `apps/web/src/routes/ui/index.tsx`, `tokens.tsx`,
    `inputs.tsx`, `overlays.tsx`, `surfaces.tsx`. They draw deliberately wrong examples, so a class rule runs on
    them only when it is marked "runs on the catalog", and none of the icon, checkmark or own-row-background syntax
    rules runs on them. The tab bar, lone option, tooltip and disclosure syntax rules do run on them.
- **Scope test is a string prefix.** A file is "under" a root when its path starts with the root string, so
  `packages/ui` also matches a hypothetical `packages/ui-extra`.
- **A file that does not parse** is itself a violation: `Could not parse: <reason>` at line 1.
- **Output.** One line per violation, `path:line message`, then `N convention violation(s).` and exit code 1.

### Design and class rules

#### Type: raw font sizes

- **Matches** (line rule, app): `/(?:^|[\s:'"`])text-\[\d/`. A `text-[` arbitrary value whose first character is
  a digit, at the start of a line or after whitespace, a colon or a quote: `text-[13px]`, `text-[0.8rem]`,
  `md:text-[11px]`. Not matched: `text-[var(--x)]`, `text-[length:…]`.
- **Exempt:** the kit (`packages/ui`), every non-`.tsx` file.
- **Why:** every text gets a type role, and size, weight and colour come from the role.

```tsx
// bad
<span className='text-[13px] text-fg-3'>Draft</span>
// good
<span className='text-fg-3 text-xs'>Draft</span>
```

#### Type: weights

- **Matches** (line rule, app): `/(?:^|[\s:'"`])font-(?:thin|extralight|light|bold|extrabold|black|\[)/`. Banned
  weight classes: `font-thin`, `font-extralight`, `font-light`, `font-bold`, `font-extrabold`, `font-black`, and any
  arbitrary `font-[…]`. Allowed: normal (no class, or `font-normal`), `font-medium`, `font-semibold`.
- **Exempt:** the kit, non-`.tsx` files.
- **Why:** those three are the only weights the lint allows, and in practice text is normal or `font-medium`;
  semibold (550) appears only as `strong` in prose, never as a class. A state change never changes weight
  (`data-[active=true]:faux-medium` instead).

```tsx
// bad
<h2 className='font-bold text-sm'>Review</h2>
// good
<h2 className='font-medium text-sm'>Review</h2>
```

#### Spacing: the 2px gap

- **Matches** (line rule, app): `/(?:^|[\s:'"`])gap(?:-[xy])?-0\.5\b/`: `gap-0.5`, `gap-x-0.5`, `gap-y-0.5`, with
  any variant before it.
- **Exempt:** the kit; the one file allowed to use it, `SectionLabel` (`apps/web/src/components/layout/page/section-label.tsx`).
- **Why:** a title over its description is `gap-px`, anything wider is `gap-1` or more. The one 2px gap is between
  the buttons of a section header, and `SectionLabel` owns it.

```tsx
// bad
<div className='flex flex-col gap-0.5'>
// good: title over description
<div className='flex flex-col gap-px'>
```

#### Depth: Tailwind shadows

- **Matches** (line rule, app): `/(?:^|[\s:'"`])shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)\b/`. Banned: `shadow-2xs`,
  `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-inner`. Allowed:
  `shadow-1`, `shadow-2`, `shadow-3`, `shadow-4`, `shadow-control*`. `drop-shadow-*` is not matched.
- **Exempt:** the kit (where `shadow-xs…lg` are redefined to the hairline), non-`.tsx` files.
- **Why:** Shinsa draws no shadows. Surfaces separate by fill step and a 1px hairline; the shadow tokens are that
  ring and nothing else.

```tsx
// bad
<div className='rounded-xl bg-card shadow-md'>
// good
<div className='rounded-xl bg-card shadow-2'>
```

#### Depth: raw shadows and rings

- **Matches** (line rule, app): `/(?:^|[\s:'"`])(?:shadow|ring)-\[/`: any `shadow-[…]` or `ring-[…]`.
- **Exempt:** the kit, non-`.tsx` files.
- **Why:** the same as above; depth comes from `shadow-1…4` and `shadow-control*` only.

```tsx
// bad
<div className='shadow-[0_0_0_1px_var(--bg-3)]'>
// good
<div className='shadow-1'>
```

#### Corners: raw radii

- **Matches** (line rule, app and kit, runs on the catalog):
  `/(?:^|[\s:'"`])(?:[a-z]+:)*rounded(?:-[trblse]{1,2})?-\[(?!inherit\])/`. Any arbitrary radius, on every side or
  corner (`rounded-[8px]`, `rounded-t-[6px]`, `rounded-tl-[calc(…)]`, `rounded-se-[4px]`), with any lowercase
  variants before it. The single exception: `rounded-[inherit]`.
- **Exempt:** nothing outside the two roots is checked; non-`.tsx` files.
- **Why:** corners come from the radius tokens, and a nested corner is concentric (inner = outer minus padding).
  Use `rounded-control`, `rounded-control-sm`, `rounded-popup`, `rounded-item`, `rounded-segment`
  (`rounded-checkbox` for the checkbox), or add a derived token.

```tsx
// bad
<button className='rounded-[5px] p-1'>
// good
<button className='rounded-segment p-1'>
```

#### Focus: no focus states

- **Matches** (line rule, app and kit):
  `/(?:^|[\s'"`])[^\s'"`]*\b(?:focus|focus-visible|focus-within)(?:\/[\w-]+)?:(?=[^\s'"`])|(?:^|[\s'"`:])ring-offset-/`.
  Any class token containing a `focus:`, `focus-visible:` or `focus-within:` variant (with or without a group
  name, and wherever it sits in the token: `group-focus:`, `peer-focus-visible:`, `md:focus:`,
  `group-focus-within/row:`) followed directly by a class, and any `ring-offset-*`. Not matched: an arbitrary
  selector such as `[&:focus]:…`, or `focus:` followed by a space.
- **Exempt:** the `/ui` catalog pages, non-`.tsx` files.
- **Why:** Shinsa draws no focus rings, outlines, border recolours or focus washes; every interactive element keeps
  `outline-none`. Keyboard movement in a floating list still moves its highlight, which is selection, not focus.

```tsx
// bad
<button className='outline-none focus-visible:ring-2 focus-visible:ring-primary'>
// good
<button className='outline-none'>
```

#### Hover: never the only feedback

- **Matches** (line rule, app): a line matching `/(?:^|[\s'"`])hover:/` (a `hover:` at the start of a token)
  with no `/(?:^|[\s'"`])active:/` on the same line.
- **Exempt:** the kit, non-`.tsx` files. Because the `hover:` must start a token, a variant-prefixed one such as
  `md:hover:` or `data-[x]:hover:` is not seen.
- **Why:** hover is never the only feedback; every `hover:` class has the same `active:` value on the same line.
  The lint checks only that an `active:` is there, not that its value matches.

```tsx
// bad
<a className='text-fg-3 hover:text-fg-4'>
// good
<a className='text-fg-3 hover:text-fg-4 active:text-fg-4'>
```

#### Hover: group-hover pairing

- **Matches** (line rule, app): `/(?:^|[\s'"`])group-hover(?:\/[\w-]+)?:/` with neither
  `/(?:^|[\s'"`])group-active(?:\/[\w-]+)?:/` nor `/(?:^|[\s'"`])opacity-0\b/` on the same line.
- **Exempt:** the kit; any line that also has an `opacity-0` token (a reveal).
- **Why:** as above; a reveal from `opacity-0` is not feedback, so it needs no pair.

```tsx
// bad
<span className='text-fg-2 group-hover:text-fg-3'>
// good
<span className='text-fg-2 group-hover:text-fg-3 group-active:text-fg-3'>
// good: a reveal
<OptionsTrigger className='opacity-0 group-hover:opacity-100' />
```

#### Motion: no transition on a hover, press or highlight colour

Two line rules with one message, both on app and kit, both run on the catalog.

1. `/(?:^|[\s'"`:])transition-(?:colors|shadow)(?=[\s'"`]|$)/`: `transition-colors` or `transition-shadow`
   anywhere, as a whole token.
2. A line that has both a hover or press variant, `(?:^|[\s'"`:])(?:group-|peer-)?(?:hover|active)(?:\/[\w-]+)?:`,
   and either a bare `transition` token or a `transition-[…]` that names `color`, `background-color`,
   `border-color`, `outline-color`, `box-shadow`, `fill` or `stroke`. Literally:
   `/^(?=.*(?:^|[\s'"`:])(?:group-|peer-)?(?:hover|active)(?:\/[\w-]+)?:)(?=.*(?:^|[\s'"`:])transition(?:-\[[^\]]*\b(?:color|background-color|border-color|outline-color|box-shadow|fill|stroke)\b[^\]]*\])?(?=[\s'"`]|$))/`.

- **Why:** washes, text and border colours on hover, press and selection appear at once; only motion (a sheet, a
  popup, a turning chevron, a sliding indicator) eases. A colour that changes for another reason (a flashed
  `data-focused` run, a switch turning on) may still ease, on a line with no `hover:`/`active:`.

```tsx
// bad
<button className='bg-bg-a1 transition-colors hover:bg-bg-a2 active:bg-bg-a2'>
// bad
<button className='transition hover:bg-bg-a2 active:bg-bg-a2'>
// good
<button className='bg-bg-a1 hover:bg-bg-a2 active:bg-bg-a2'>
// good: a transform eases, colours do not
<Icon name='IconChevronRightSmall' size='sm' className='transition-[rotate] duration-200 data-[open]:rotate-90' />
```

#### Motion: turning transitions off for a subtree

Two line rules, app only.

1. **The pseudo-element variant.** `/\]:(?:[\w-]+:)*(?:before|after):transition-none/`, for example
   `[&_*]:before:transition-none`. Why: the `before:`/`after:` variant also sets `content`, so every element in the
   subtree gains an empty box that a flex row lays out as an item. Name the pseudo-element in the selector instead.
2. **The sliding indicator.** `/\[&_\*(?!::)[^\]\s'"`]*\]:(?:[\w-]+:)*transition-none/` unless the line contains
   `data-motion=move`. A subtree-wide `transition-none` on `[&_*…]` (not on `[&_*::before]`) that does not spare the
   indicators. Why: a selected tab pill or list highlight still slides; it carries `data-motion="move"`.

```tsx
// bad
const INSTANT = '[&_*]:transition-none! [&_*]:before:transition-none!';
// good
const INSTANT =
  '[&_*:not([data-motion=move])]:transition-none! [&_*::before]:transition-none! [&_*::after]:transition-none!';
```

#### Motion: rows never draw their own highlight

Three checks share the rule "a list of rows you pick from shares one highlight that slides to the row; the row
only changes its text colour".

1. **Line rule** (app and kit, runs on the catalog):
   `/(?:^|[\s'"`:])(?:data-indicator-here|data-hovered|data-highlighted|data-\[highlighted\]|data-\[hovered\]):(?:[\w-]+:)*bg-/`.
   A background on `data-indicator-here:`, `data-hovered:`, `data-highlighted:`, `data-[highlighted]:` or
   `data-[hovered]:`, with any variants between.
2. **Syntax rule** (app and kit, not the catalog, `.ts` and `.tsx`): a JSX element that is a picked row (it has a
   `data-highlight-item` attribute, or `role` is `option`, `menuitem`, `menuitemradio` or `menuitemcheckbox`) whose
   `className` strings match
   `/(?:^|\s)(?:[\w-]+:)*(?:hover|active|data-selected|aria-selected|data-\[selected=true\]|data-active|data-\[active=true\]):bg-/`.
3. **Syntax rule, lone option** (app only): an element with `role` `option`, `menuitem`, `menuitemradio` or
   `menuitemcheckbox` that has no `HighlightList` or `HoverHighlight` element among its ancestors.

- **Why:** one indicator slides on the movement clock (200ms `cubic-bezier(0.22, 1, 0.36, 1)`, transform only);
  a row painting its own wash would flash under it. Use the kit's menu, select and command items, or put the rows
  in `HighlightList`/`HoverHighlight` and mark them `data-highlight-item`.

```tsx
// bad
<div role='option' className='rounded-item px-2 hover:bg-bg-a2 active:bg-bg-a2'>{label}</div>
// good
<HoverHighlight>
  {rows.map((row) => (
    <div key={row.id} data-highlight-item className='px-2 text-fg-3 data-indicator-here:text-fg-4'>
      {row.label}
    </div>
  ))}
</HoverHighlight>
```

#### Components: every tab bar is the kit's `Tabs`

- **Matches** (syntax rule, app): an `import … from '@base-ui/react/tabs'`, or any JSX attribute
  `role` whose string value is `tab` or `tablist`.
- **Exempt:** the kit (where `Tabs` is built).
- **Why:** every row of tabs is the kit's `Tabs` (`Choice` for a labelled switch), whose selected pill or line
  slides on the movement clock.

```tsx
// bad
<div role='tablist'>{tabs.map((tab) => <button role='tab' key={tab}>{tab}</button>)}</div>
// good
<Tabs value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value='overview'>Overview</TabsTrigger>
    <TabsTrigger value='review'>Review</TabsTrigger>
  </TabsList>
</Tabs>
```

#### Surfaces: hand-built card

- **Matches** (line rule, app): `/(?:^|[\s'"`])rounded-xl border border-border bg-card\b/`, that exact class
  sequence.
- **Why:** consistency comes from shared pieces. Use `CARD` (which is
  `corner-superellipse/1.125 rounded-xl border border-border bg-card`; it lives in a `.ts` file, which line rules
  do not scan).

```tsx
// bad
<section className='rounded-xl border border-border bg-card p-3'>
// good
<section className={cn(CARD, 'p-3')}>
```

#### Surfaces: hand-built inset

- **Matches** (line rule, app): `/(?:^|[\s'"`])rounded-lg border border-border\b/`.
- **Why:** `INSET` (`corner-superellipse/1.125 rounded-lg border border-border`) is the one edge of
  everything nested in a card or the chat column.

```tsx
// bad
<div className='rounded-lg border border-border bg-bg-a1 px-3'>
// good
<div className={cn(INSET, 'bg-bg-a1 px-3')}>
```

#### Surfaces: nested fill with no edge

- **Matches** (line rule, app): a line with `rounded-lg` and a fill token in either order, where the fill is
  `bg-bg-1`, `bg-bg-2`, `bg-bg-3`, `bg-bg-a1`, `bg-bg-a2`, `bg-bg-a3`, `bg-muted`, `bg-card`, `bg-background` or
  any `bg-<hue>-a1`/`bg-<hue>-a2`; unless the same line has a whole `border`, `size-<…>` or `opacity-0` token.
  Literally:
  `/(?:^|[\s'"`])(?:rounded-lg\b.*[\s'"`]bg-(?:bg-a?[1-3]|muted|card|background|[a-z]+-a[12])(?=[\s'"`]|$)|bg-(?:bg-a?[1-3]|muted|card|background|[a-z]+-a[12])(?=[\s'"`]|$).*[\s'"`]rounded-lg\b)/`,
  unless `/(?:^|[\s'"`])(?:border|size-[\w.]+|opacity-0)(?=[\s'"`]|$)/`.
- **Why:** everything nested in a card or the chat column has the card's hairline; put `INSET` under the fill.
  Fixed-size tiles (`size-*`) and reveals are boxes that are not nested panels.

```tsx
// bad
<div className='rounded-lg bg-bg-a1 px-3 py-2'>
// good
<div className={cn(INSET, 'bg-bg-a1 px-3 py-2')}>
```

#### Surfaces: a tone fill takes its tone's edge

- **Matches** (line rule, app and kit, runs on the catalog). A line that has both:
  - a **tone fill**: `bg-<hue>-<step>` where hue is one of `red`, `orange`, `amber`, `green`, `blue`, `primary`,
    `purple`, `sky`, `yellow`, `pink` and step is `a1`, `a2`, `a3`, `1`, `2` or `3`, optionally with `/<opacity>`;
    or a lookup into `TONE_WASH[` or `TONE_SURFACE[`;
  - and a **neutral edge**: `INSET` as a whole name (not `CARD_INSET`, not `INSET_SHAPE`), a bare `border`,
    `border-t|r|b|l|x|y|s|e`, `border-border`, or `border-bg-1…4`;
  - unless the line also has a toned border `border-<hue>-…` (same hue list) or `TONE_EDGE`/`TONE_INSET`.

  Literally: `HUE = (?:red|orange|amber|green|blue|primary|purple|sky|yellow|pink)`;
  fill `(?:(?:^|[\s'"`:])bg-HUE-(?:a[1-3]|[1-3])(?:/\d+)?(?=[\s'"`]|$)|\bTONE_(?:WASH|SURFACE)\[)`;
  edge `(?:(?:^|[\s'"`(,:{$])INSET\b(?!_)|(?:^|[\s'"`:])border(?:-[trblxyse])?(?=[\s'"`]|$)|(?:^|[\s'"`:])border-(?:border|bg-[1-4])(?=[\s'"`]|$))`;
  pattern `^(?=.*FILL)(?=.*EDGE)`; unless `(?:^|[\s'"`:])border-HUE-|\bTONE_(?:EDGE|INSET)\b`.
- **Why:** a box filled in a tone (a warning, an error note, a checked choice card) is edged in the same hue at its
  `-a3` step, never the grey hairline. A tile or badge in a tone has no border and is not caught.

```tsx
// bad
<div className={cn(INSET, 'bg-orange-a2 px-3')}>
// bad
<div className='rounded-lg border border-border bg-amber-a2'>
// good
<div className='rounded-lg border border-orange-a3 bg-orange-a2'>
// good
<div className={cn(TONE_INSET[tone], 'px-3')}>
// good: checked choice card
<label className='border border-bg-3 has-data-checked:border-primary-a3 has-data-checked:bg-primary-a1'>
// not caught: neutral box, toned tile with no edge
<div className={cn(INSET, 'bg-bg-a1')}>
<span className='rounded-full bg-amber-a3'>
```

#### Selection: one class for selectable content

- **Matches** (line rule, app and kit, runs on the catalog):
  `/(?:^|[\s'"`:])(?:select-(?:text|all|auto)|cursor-text)(?=[\s'"`]|$)/`: `select-text`, `select-all`,
  `select-auto`, `cursor-text`, with any variant. Allowed: `selectable`, `select-none`, other cursors.
- **Why:** the app is chrome and never selected; real content (prose, code, output, an error) opts back in through
  the kit's one class, `selectable`, which sets the selection and the I-beam together.

```tsx
// bad
<pre className='cursor-text select-text'>{output}</pre>
// good
<pre className='selectable'>{output}</pre>
```

#### Selection: no hand-set `user-select`

- **Matches** (line rule, app only, every `.ts`, `.tsx` and `.css` file under `apps/web/src`):
  `/\b(?:user-select|userSelect|WebkitUserSelect)\b/`, in code, inline styles and style sheets.
- **Why:** selection follows one policy: chrome never, content `selectable`, and a drag sets `body[data-dragging]`
  to stop it everywhere.

```tsx
// bad
document.body.style.userSelect = 'none';
// good
document.body.dataset.dragging = '';
```

#### Icons: no opacity, colour or size through `[&_svg]`

- **Fade** (line rule, app and kit): `/svg[^\s'"`]*\]:(?:[\w-]+:)*(?:opacity|text|fill|stroke)-/`, for example
  `[&_svg]:opacity-60`, `[&>svg]:text-fg-2`, `[&_svg]:hover:fill-…`.
- **Size** (line rule, app and kit): `/svg[^\s'"`]*\]:(?:[\w-]+:)*(?:size|w|h)-/`, for example `[&_svg]:size-3.5`.
- **Exempt:** the `/ui` catalog pages.
- **Why:** icons draw in a solid icon ink (`icon-1…4`) that their text colour sets, and come in three sizes set by
  the primitive or the `size` prop.

```tsx
// bad
<Button className='[&_svg]:size-3 [&_svg]:opacity-60'>
// good
<Button><Icon name='IconPlusSmall' />Add</Button>
```

#### Icons: no hand-set icon variables

- **Matches** (line rule, app): `/\[--icon-(?:color|size)[\w-]*:/`, for example `[--icon-color:var(--fg-2)]`,
  `[--icon-size:12px]`, `[--icon-size-sm:…]`.
- **Why:** the text colour sets the ink and the `size` prop (or the primitive) the size.

```tsx
// bad
<span className='[--icon-color:var(--icon-2)]'><Icon name='IconClock' size='sm' />2h</span>
// good
<span className='text-fg-2'><Icon name='IconClock' size='sm' />2h</span>
```

#### Icons: no faded icon

- **Matches** (syntax rule, app and kit, not the catalog): an icon element whose `className` has an opacity other
  than `0` or `100`: `/(?:^|\s)(?:[\w/-]+:)*opacity-(?!(?:0|100)(?:\s|$))\S+/`.
  **Icon elements** are `Icon`, `Spinner`, `Logo`, `PriorityIcon`, `CheckMark`, `SelectedMark`, and any element whose
  name ends in `Chevron`.
- **Why:** the only opacity on an icon is a reveal, `opacity-0` to `opacity-100`.

```tsx
// bad
<Icon name='IconChevronRightSmall' className='opacity-50' />
// good: a reveal
<Icon name='IconPencil' className='opacity-0 group-hover:opacity-100' />
```

#### Icons: no class-sized icon

- **Matches** (syntax rule, app and kit, not the catalog): an icon element (as above, but `Logo` is exempt) whose
  `className` has a `size-*`, `w-*` or `h-*` token with any variants: `/(?:^|\s)(?:[\w/-]+:)*(?:size|w|h)-[\w.()-]+(?=\s|$)/`.
- **Why:** three sizes only, `size='sm'` 14px, `'md'` 16px, `'lg'` 20px; inside a primitive pass nothing.

```tsx
// bad
<Icon name='IconCheckmark2Small' className='size-3' />
// good
<Icon name='IconCheckmark2Small' size='sm' />
```

#### Icons: never brighter than its text

- **Matches** (syntax rule, app and kit, not the catalog): an icon element whose own `className` sets a text step,
  where that step is higher than its row's. **Steps** read from the first matching class:
  `text-fg-N` or `text-icon-N` is N (1 quietest, 4 strongest); `text-foreground`, `text-card-foreground`,
  `text-popover-foreground` are 4; `text-muted-foreground` is 2. The **row** is the nearest ancestor JSX element that
  sets a step; its step is the highest of its own and every other element's inside it. Literal pattern:
  `/(?:^|\s)text-(?:fg|icon)-([1-4])(?=\s|$)|(?:^|\s)text-((?:card-|popover-|muted-)?foreground)(?=\s|$)/`.
- **Why:** an icon takes its text's ink (`icon-N` beside `fg-N`) or a quieter one, never a higher step.

```tsx
// bad
<span className='text-fg-2'><Icon name='IconClock' size='sm' className='text-fg-4' />2h</span>
// good
<span className='text-fg-2'><Icon name='IconClock' size='sm' />2h</span>
```

#### Icons: no hand-drawn svg

- **Matches** (syntax rule, app and kit, not the catalog): any `<svg>` JSX element.
- **Exempt files:** the kit's `Icon`, `Spinner` and `Logo` components, which draw the glyphs.
- **Why:** glyphs come from `Icon` (a mark Central lacks is added to the kit's custom icon set), so they take the
  icon size and ink.

```tsx
// bad
<svg viewBox='0 0 16 16'><path d='…' /></svg>
// good
<Icon name='IconArrowUpRight' size='sm' />
```

#### Icons: no green checkmark

- **Matches** (syntax rule, app and kit, not the catalog, `.ts` and `.tsx`): a JSX element or an object literal
  whose `name` or `icon` value matches `/^IconCheck(?:mark|Circle)/` (any `IconCheckmark…` or `IconCheckCircle…`
  glyph) and is green: a `tone` or `variant` of exactly `green`, or a `className` string matching
  `/(?:^|\s)(?:\S+:)?[a-z]+-(?:green(?:-\d+)?|success)(?:\/\d+)?(?=\s|$)/` (`text-green`, `text-green-9`,
  `text-success`, `bg-success/20`, `hover:text-green-11`). For a JSX icon, its parent element's props count too.
- **Why:** checkmarks are the accent; only the progress track's done steps are green. Use `CheckMark` or the
  `CHECK_TEXT` class (`text-primary-text`).

```tsx
// bad
<Icon name='IconCheckmark2Small' className='text-success' />
// bad
<span className='text-green-11'><Icon name='IconCheckCircle2' /></span>
// good
<CheckMark />
// good
<span className={CHECK_TEXT}><Icon name='IconCheckmark2Small' size='sm' /></span>
```

#### Tooltips: one delay

- **Matches** (syntax rule, app and kit): a `delay` prop on `Hint`, `Tooltip`, `TooltipProvider`, `TooltipTrigger`
  or `TooltipContent`, or a `delay` key in the second (options) argument of `useTooltipTrigger(…)`.
- **Why:** every tooltip waits `TOOLTIP_DELAY` (600ms) and moves on within `TOOLTIP_SKIP_DELAY` (400ms); nothing
  else sets a delay.

```tsx
// bad
<Hint label='Opens the pull request' delay={200}>…</Hint>
// good
<Hint label='Opens the pull request'>…</Hint>
```

#### Tooltips: no echo

- **Matches** (syntax rule, app and kit): a tooltip whose text equals, ignoring case and collapsing whitespace, the
  one text shown by its trigger.
  - `Hint`: its `label` (a string, an identifier or a dotted member such as `task.title`) against the shown text of
    its first child element. A `Hint` with a `shortcut` or `detail` prop is never an echo.
  - `Tooltip`: the shown text of its `TooltipContent` child against that of its `TooltipTrigger` child.
  - "Shown text" is collected through nested elements and fragments; it counts only when it is exactly one piece
    (one text run or one `{expression}`).
- **Why:** a tooltip that repeats the text it sits on adds nothing. Say what the screen does not, or drop it,
  keeping an `aria-label` only on an icon-only button.

```tsx
// bad
<Hint label='Approve changes'><Button>Approve changes</Button></Hint>
// good
<Hint label='Opens the pull request'><Button>Approve changes</Button></Hint>
```

#### Tooltips: the trigger fits its text

- **Matches** (syntax rule, `.tsx` in the app, except the `TimeAgo`/`Duration` file). The element a tooltip
  wraps: for `Hint`, its first child element; for `TooltipTrigger`, the JSX passed in its `render` prop. It must be a
  lowercase (DOM) tag. It fails when it is block, either by tag
  (`/^(?:div|p|section|article|header|footer|nav|form|label|li|ul|ol|h[1-6])$/`) or by a class token `flex`, `grid`,
  `block` or `table`, and has no fitted width: none of `w-fit`, `w-max`, `w-<digit>…`, `size-<…>`, `inline`,
  `inline-flex`, `inline-grid`, `inline-block`.
- **Why:** hovering the empty right of a full-width row must open nothing. `Truncate` is the one block trigger
  (its tooltip opens only while clipped), and component triggers (uppercase names) are not checked.

```tsx
// bad
<Hint label='Started by the queue'><div className='flex items-center gap-1'>…</div></Hint>
// good
<Hint label='Started by the queue'><div className='flex w-fit max-w-full items-center gap-1'>…</div></Hint>
```

#### Tooltips: every time has its tooltip

- **Matches** (syntax rule, `.tsx` in the app, except the file that defines `TimeAgo` and `Duration`): a call to
  `formatAge(…)` or `formatDuration(…)` anywhere inside JSX, unless it sits in an attribute of a `TimeAgo` or
  `Duration` element.
- **Why:** every time goes through `TimeAgo` or `Duration`, whose tooltip shows the exact moment. A time built
  another way is not caught.

```tsx
// bad
<span className='text-fg-2 text-xs'>{formatAge(task.updatedAt, now)}</span>
// good
<TimeAgo at={task.updatedAt} compact />
```

#### Keyboard: the only shortcuts

- **Matches** (syntax rule, app, `.ts` and `.tsx`): any call to `addEventListener` (bare or as a method) whose first
  argument is the string `'keydown'` or `'keyup'`.
- **Exempt files:** the four shortcut hooks, `use-command-key.ts`, `use-code-keys.ts`, `use-review-keys.ts`,
  `use-terminal-keys.ts`.
- **Why:** ⌘K (Ctrl K) is the only global shortcut. The Code tab adds ⌘P, ⇧⌘F, ⌘F and ⌘G, the Review tab J and K,
  the Terminal page ⌘T and ⌘W, while they are open; a terminal keeps its own keys through xterm.js's handler on its
  element, and the editor uses CodeMirror's keymap.

```tsx
// bad
window.addEventListener('keydown', onKey);
// good: a key handler on the element that has focus
<div onKeyDown={onKey}>…</div>
```

#### Disclosure: every collapsible remembers whether it is open

Three syntax checks on every `.tsx` file in the app.

1. **`persistId` required.** Any of these elements without a `persistId` attribute: `Panel`, `CompactSection`,
   `WideSection`, `FoldingBlock`, `RoadmapSection`, `ChangeSnippet`, `ReviewNote`, `ExpandRow`, `ToolGroup`,
   `UserMessage`, `TestingPanel`, `MergeStepsPanel`, `EvidencePanel`. A spread (`{...parts}`) does not count.
2. **`DisclosureHeader` takes a `disclosure`.** A `DisclosureHeader` without a `disclosure` attribute.
3. **No fold state in `useState`.** In a file that folds (it has an `aria-expanded` attribute or renders a
   `DisclosureHeader`), any `const [x, …] = useState(…)` or `React.useState(…)` whose first name is exactly `open`,
   `expanded`, `folded` or `collapsed` (`/^(open|expanded|folded|collapsed)$/`). Other names, object destructuring
   and indirect calls pass, and a file that folds nothing (a popover's `open`) is not checked.

- **Why:** fold a panel, refresh, leave and come back, and it is as you left it. `persistId` is built with
  `createDisclosureId(scope, …parts)` from what the panel shows, never an index; `notPersisted(reason)` opts out
  with a reason.

```tsx
// bad
<Panel title='Summary' icon='IconNote1'>…</Panel>
const [open, setOpen] = useState(false);
return <button aria-expanded={open} onClick={() => setOpen(!open)} />;
// good
<Panel persistId={createDisclosureId('task', taskId, 'overview', 'panel', 'summary')} title='Summary'>…</Panel>
<ReviewNote persistId={notPersisted('a finding never folds')} item={item} />
const disclosure = useDisclosure(createDisclosureId('home', 'section', section), true);
return <DisclosureHeader disclosure={disclosure}>…</DisclosureHeader>;
```

#### Class order (Biome)

- **Rule:** `nursery/useSortedClasses`, level error, safe fix, in `packages/ui/src/**`, `apps/web/src/**`,
  `apps/marketing/src/**`. It sorts `className`/`class` strings and the arguments of `cn`, `cva` and `clsx`.
- **Why:** one order, so a diff shows only real class changes. `biome check --write` (and the pre-commit hook)
  fixes it.

```tsx
// bad
<div className='text-xs px-2 flex'>
// good
<div className='flex px-2 text-xs'>
```

#### Icons come from Central only (Biome)

- **Rule:** `style/noRestrictedImports` with `lucide-react` banned everywhere: "Icons come exclusively from
  @shinsa/ui <Icon /> (Central Icons)."

```tsx
// bad
import { Check } from 'lucide-react';
// good
import { Icon } from '@shinsa/ui/components/icon';
<Icon name='IconCheckmark2Small' size='sm' />
```

### Code conventions

#### No comments

- **Matches** (conventions linter, every checked file in every root): any comment, line or block, whose trimmed
  text is not empty and does not start with `biome-ignore` or `@ts-` (`/^\s*(biome-ignore|@ts-)/`).
- **Exempt:** `packages/ui` (a reusable kit that keeps its upstream comments). Empty comments pass. CSS files are not
  checked. Biome's `suspicious/noCommentText` separately rejects comment-like text written as JSX children.
- **Why:** names and structure carry the meaning, and the docs carry the reasons.

```ts
// bad
// retry once because the socket may still be opening
await send(command);
// good
await sendWhenOpen(command);
// allowed
// biome-ignore lint/suspicious/noConsole: build script output
console.log(summary);
```

#### The verb catalog

- **Matches** (conventions linter): a declared function whose name matches `/^(get|fetch|load|set|delete|destroy)[A-Z]/`.
  "Declared function" means a `function` declaration, a class method, an object method (`{ getX() {} }`), or a
  `const`/`let` initialised with an arrow function or function expression.
- **Scope:** `apps/engine/src`, `apps/web/src`, `apps/desktop/src`, `apps/marketing/src`, `packages/core` (its
  tests included). Not checked: `packages/ui`, `scripts`, app test folders.
- **Exempt names:** the React class lifecycle methods `getDerivedStateFromError`, `getDerivedStateFromProps`,
  `getSnapshotBeforeUpdate`, as class methods only. Not seen by the check: an arrow in an object property
  (`{ getX: () => … }`), a class property arrow, a getter (`get x()`), a name that is exactly the verb (`load`).
- **Why:** one catalog, no synonyms, so a reader knows what a function does from its first word.

Banned prefixes (the full list): `get*`, `fetch*`, `load*`, `set*`, `delete*`, `destroy*`.

Allowed catalog, as the lint's message lists it: `find*, select*, list*, count*, resolve*, create*, update*,
upsert*, write*, replace*, remove*, assert*, serialize*, parse*, validate*, describe*, request*, sync*, apply*,
record*, is*, has*, needs*`. The linter enforces only the ban; the contracts are convention:

| Verb | Contract |
| --- | --- |
| `find*` | one value, throws a `DomainError` when absent (`findTask`) |
| `select*` | one value, returns `null` when absent (`selectTask`) |
| `list*` / `count*` | many values / a total |
| `resolve*` | derives a value: a queue, a label, a fallback (`resolveQueue`, `resolveModelLabel`) |
| `create*` / `update*` | plain writes; in the core, `create*` also builds a fresh value (`createState`) |
| `upsert*` / `write*` / `replace*` | idempotent writes |
| `remove*` | takes something away |
| `assert*` | invariant check that throws and returns `void` |
| `serialize*` / `parse*` / `validate*` | to text or wire shape / from untrusted text / check a hand-over and return `{ ok, errors }` |
| `describe*` | a sentence for a person (`describeError`) |
| `request*` / `sync*` / `apply*` / `record*` | ask for an effect / reconcile with the outside / fold an event / store a fact reported from outside |
| `is*` / `has*` / `needs*` | boolean predicates |

If the caller null-checks the result it must be `select*`; if absence is an error it must be `find*`. The decider
adds its own unenforced verbs: `start*`, `reactTo*`, `answer*`, `settle*`, `retry*`, `open*`, `withdraw*`, `request*`.

```ts
// bad
export function getTask(state: ShinsaState, id: string) { … }
const loadSettings = async () => { … };
// good
export function selectTask(state: ShinsaState, id: string): Task | null { … }
export function findTask(state: ShinsaState, id: string): Task { … }
const readSettings = async () => { … };
```

#### No await in a ternary (GritQL plugin)

- **Rule:** the Biome plugin `no-await-in-ternary.grit`, applied to every file Biome checks:

```grit
language js

`$condition ? $consequence : $alternative` where {
  or { $consequence <: contains `await $_`, $alternative <: contains `await $_` },
  register_diagnostic(span=$condition, message="Ternaries never wrap awaited calls. Branch with an if or an early return instead (the conventions skill).")
}
```

- **Matches:** any conditional expression whose consequence or alternative contains an `await`. The condition may
  contain one.
- **Why:** ternaries are for small value picks; guards and early returns carry control flow.

```ts
// bad
const task = cached ? cached : await readTask(id);
// good
if (cached) return cached;
return await readTask(id);
```

#### Imports

| Rule (Biome) | Where | Matches | Why |
| --- | --- | --- | --- |
| `style/noRestrictedImports` | everywhere | `lucide-react` | Icons come only from `Icon` (Central) |
| `style/noRestrictedImports` | `packages/core/src/**` | `node:fs`, `node:child_process`, `node:path`, `bun` | The core is pure: the server does I/O and hands the core events; side effects run in the server's effect workers; paths are the server's; the core runs in the browser too, Bun is the server's |
| `correctness/noPrivateImports` | everywhere | importing a symbol marked private to its module | Folders expose a barrel |
| `correctness/noUnusedImports` | everywhere but `*.astro` | unused imports | |
| `style/useImportType` | everywhere | a value import used only as a type | |
| `style/useNodejsImportProtocol` | everywhere | `fs` instead of `node:fs` | |
| `assist/source/organizeImports` | everywhere | unsorted imports or imported names (an assist; `biome ci` fails on it) | |

The `packages/core/src` override replaces the root `noRestrictedImports` options there, so its list is the four
Node/Bun modules only.

Not lint-checked but stated next to these rules: packages import each other only by package name
(`@shinsa/core`), importers outside a folder use its `index.ts` barrel, and files inside a folder import each other
directly, never their own barrel.

#### Every Biome rule set in the config

The base is Biome's `recommended` preset. These are set explicitly (error unless noted):

| Group | Rule | Level |
| --- | --- | --- |
| a11y | `noSvgWithoutTitle` | off |
| correctness | `noChildrenProp`, `useHookAtTopLevel`, `useJsxKeyInIterable`, `noUnusedImports`, `noUnusedVariables`, `noUnusedFunctionParameters`, `noUnusedPrivateClassMembers`, `noPrivateImports` | error |
| correctness | `useExhaustiveDependencies` | off |
| security | `noBlankTarget` | error |
| security | `noDangerouslySetInnerHtml` | off |
| suspicious | `noConsole`, `noCommentText`, `noDuplicateJsxProps`, `useAwait`, `useErrorMessage`, `noEvolvingTypes`, `noShadow` | error |
| suspicious | `noThenProperty` | off |
| style | `noUselessElse`, `useCollapsedElseIf`, `useSingleVarDeclarator`, `useTemplate`, `noYodaExpression`, `useNodejsImportProtocol`, `useAtIndex`, `useExplicitLengthCheck`, `useThrowOnlyError`, `noParameterAssign`, `useImportType`, `noRestrictedImports` (lucide-react) | error |
| style | `noNonNullAssertion` | off |
| complexity | `noForEach` | warn |
| complexity | `noUselessTernary`, `noStaticOnlyClass` | error |
| complexity | `noExcessiveCognitiveComplexity`, `maxAllowedComplexity: 25` | warn |
| performance | `noAccumulatingSpread` | error |
| nursery | `noFloatingPromises`, `noMisusedPromises`, `useExhaustiveSwitchCases` | error |

Overrides, in order:

| Files | Change |
| --- | --- |
| `**/test/**`, `**/*.test.*` | `suspicious/noExplicitAny` off, `suspicious/useAwait` off |
| `packages/core/src/**` | `noRestrictedImports`: `node:fs`, `node:child_process`, `node:path`, `bun` |
| `packages/ui/src/**`, `apps/web/src/**`, `apps/marketing/src/**` | `nursery/useSortedClasses` error, safe fix, functions `cn`, `cva`, `clsx` |
| `**/*.astro` | `noUnusedImports` off, `noUnusedVariables` off |
| `scripts/**` | `suspicious/noConsole` off, `suspicious/noUndeclaredEnvVars` off |
| `packages/ui/**` | `complexity/noExcessiveCognitiveComplexity` off |
| `packages/ui/src/**/*.css` | `style/noDescendingSpecificity`, `complexity/noImportantStyles`, `correctness/noUnknownTypeSelector` off |
| `packages/ui/src/**` | `suspicious/noArrayIndexKey`, `suspicious/useIterableCallbackReturn`, `suspicious/noShadow`, `complexity/noForEach`, `a11y/useSemanticElements`, `a11y/noStaticElementInteractions`, `a11y/useAriaPropsSupportedByRole`, `a11y/useValidAriaValues`, `a11y/noLabelWithoutControl`, `nursery/noFloatingPromises` off |

What the less obvious ones mean in practice:

- `noConsole`: never `console` outside `scripts/`; the engine logs one JSON line per entry
  (`log.info/warn/error('[Area] Sentence', fields)`). A build script that must print uses
  `// biome-ignore lint/suspicious/noConsole: build script output`.
- `noFloatingPromises` / `noMisusedPromises`: every promise is awaited, returned or explicitly handled;
  `.catch(() => undefined)` is not allowed by convention (a catch rethrows, converts or logs with context).
- `useExhaustiveSwitchCases`: a `switch` over a union lists every member; no `default` that swallows a new one.
- `useAwait`: an `async` function awaits something (off in tests).
- `noShadow`: no variable shadows an outer one (off in the kit).
- `useAtIndex`: `list.at(-1)`, not `list[list.length - 1]`.
- `useExplicitLengthCheck`: `list.length > 0`, not `list.length`.
- `useThrowOnlyError`, `useErrorMessage`: throw `Error` subclasses (`DomainError(code, message)`) with a message.

Formatter (enforced by `biome ci`): 2-space indent, LF, line width 110, single quotes in JS and JSX
(`jsxQuoteStyle: 'single'`), semicolons always, trailing commas `es5`, arrow parentheses always, bracket spacing on,
`bracketSameLine: false`, quote properties as needed. CSS parses Tailwind directives. Biome follows `.gitignore` and
skips `.claude`, every `dist`, every `.astro` folder and the kit's `globals.css`.

#### Unenforced conventions that sit beside these

Stated as law in the project's conventions but with no checker: multi-line arrow bodies get a block and an explicit
`return`; no single-use constants (a value gets a name when reused or tunable); no dead parameters; narrow types, no
`any`, untrusted input is `unknown` narrowed once; a name collision across folders is a bug; a lookup table beats a
`switch` that only returns strings.

#### Where UI code lives and how it reads

The conventions that decide where a screen's code goes and how it is written. None is lint-checked beyond the rules
above; a reviewer holds them.

- **The web app renders server state and owns nothing.** Every action is a `UserCommand` sent through
  `sendCommand` (or `sendCommandWithToast`, which confirms in place); a screen never changes state itself and
  renders what the engine sends back. The connection may apply a listed command at once by running the core's own
  pure `decide` on its copy (`lib/connection/optimistic.ts`), so the answer still comes from the core. A decision that replaying the event log
  must reproduce lives in the pure core, anything that talks to the outside world in the engine, and nothing in the
  web.
- **Folders**: `routes/` (one file per page), `components/<domain>/` (JSX only), `hooks/`, and `lib/` for every
  piece of logic that is not JSX, 100% covered by tests. `packages/ui` is the reusable kit and imports nothing from
  the workspace.
- **A folder is a concern with an `index.ts` barrel.** Importers outside it use the barrel; files inside import each
  other directly, never their own barrel; packages import each other by name (`@shinsa/core`), never by path. A
  package's barrel is its contract: renaming or removing an export updates every consumer in the same change.
- **Tests follow the source**: one test folder per source folder, one test file per module with behaviour of its
  own, helpers beside the tests, never in `src/`. Each test names a behaviour and asserts what a person would see; a
  bug fix comes with the test that fails without it.
- **Never wrap a call chain in a ternary**; guards and early returns carry control flow, ternaries pick small
  values. A multi-line arrow gets a block and an explicit `return`. Blank lines separate phases in long functions
  only; a guard and its return read as one unit.
- **Docs ship with the behaviour.** A UI change updates this file (and `docs/design.md` in the repository) in the
  same change; a settled pattern goes back into the rules, so the next change starts where this one ended.
- **Before calling it done**: `bunx biome check --write` on your own files, `bun lint`, `bun check-types`,
  `bun run test`, `bunx knip` after exporting anything, `bun deps`.

```tsx
// bad: the screen decides and mutates
const [stage, setStage] = useState(task.stage);
<Button onClick={() => setStage('cancelled')}>Cancel</Button>
// good: the screen sends a command and renders the state that comes back
<Button onClick={() => sendCommandWithToast({ type: 'task.cancel', taskId: task.id }, 'Cancelled.')}>Cancel task</Button>
```

### Tooling gates

#### Spelling

- **Command:** `cspell --no-progress --no-summary --locale en-GB,en-US` over `apps/*/src/**/*.{ts,tsx}`,
  `packages/*/src/**/*.{ts,tsx}`, `docs/*.md`, `*.md`, `apps/*/*.md`, `packages/*/*.md`, `.claude/skills/**/*.md`,
  `apps/engine/plugin/**/*.md`. Tests, scripts and CSS are not spell-checked.
- **Settings:** `version: '0.2'`, `language: 'en-GB,en-US'` (either spelling passes), `ignorePaths`:
  `**/node_modules/**`, `**/dist/**`, the generated icon paths file; `ignoreRegExpList`: `gh\[[a-z]+\]_` (GitHub
  token prefixes such as `gh[pousr]_`); a project word list (160 words).
- **Fix:** correct the word, or add a real word to the project word list. Never disable the check inline.

#### Dead code (knip)

- **Command:** `bunx knip` (CI). Fails on unused files, exports, types and dependencies. Run it after exporting
  anything.
- **Entries per workspace:** root: `scripts/*.ts`, `scripts/perf/*.ts`, `scripts/seed-media/*.ts`,
  `scripts/screenshots/*.ts`; web: `test/**/*.test.{ts,tsx}`, ignoring the `tailwindcss` dependency; kit:
  `src/**/*.{ts,tsx}` (every file is public API); desktop: `src/main/index.ts`, `src/preload/index.ts`,
  `test/**/*.test.ts`; engine: `test/**/*.test.ts`, `test/e2e/soak/child.ts`, `test/helpers/mcp/stdio-server.ts`,
  `scripts/*.ts`; marketing: `test/**/*.test.ts`, ignoring the `@shinsa/web` dependency.

#### Workspace hygiene (sherif)

- **Command:** `bunx sherif -i @types/node` (`bun deps`). Fails on dependency version drift and workspace
  `package.json` problems across the monorepo; `@types/node` may differ.

#### Types

- **Command:** `bun check-types` = every workspace's `check-types` (turbo) plus `tsc --noEmit -p tsconfig.json` for
  `scripts/`.
- **Settings:** `strict: true` and `noUncheckedIndexedAccess: true` everywhere (an indexed read is `T | undefined`
  until narrowed), `isolatedModules`, `allowImportingTsExtensions` (imports name `.ts` files), `noEmit`.

#### Coverage floor

- **Rule:** every workspace's `bunfig.toml` sets `coverage = true`, `coverageSkipTestFiles = true` and
  `coverageThreshold = { lines = 1.0, functions = 1.0 }`: 100% of lines and functions, or `bun test` fails.
- **Excluded from the count:**

| Workspace | Not counted |
| --- | --- |
| root (`scripts/`, test root `scripts`) | `packages/**`, `apps/**` |
| `packages/core` | `test/**` |
| `packages/ui` | `src/components/**`, `scripts/generate-icons.ts`, `test/**` |
| `apps/web` | `src/**/*.tsx`, `test/**`, `../../packages/**` |
| `apps/engine` | `test/**`, `../../packages/**`, `src/main.ts` |
| `apps/desktop` | `test/**`, `src/main/**`, `src/preload/**`, `../../packages/**` |
| `apps/marketing` | `test/**`, `src/worker/index.ts` |

- **Why:** components are checked by rendering, not by coverage; everything in `lib/` and `hooks/` counts.
  Coverage is the floor, not the goal: every test names a behaviour and asserts what a person or agent would see,
  and a bug fix comes with the test that fails without it.

#### Git hooks and CI

| Stage | Runs |
| --- | --- |
| `commit-msg` | The first line must match `^(feat\|fix\|docs\|refactor\|test\|chore\|perf\|ci\|build\|style\|revert)(\([a-z0-9./-]+\))?!?: .{1,100}$`; lines starting `Merge`, `Revert`, `fixup!`, `squash!` pass. The hook reads only the first line; by convention a commit message is that one subject line and nothing else. |
| `pre-commit` | `lint-staged` (`biome check --write --no-errors-on-unmatched --files-ignore-unknown=true` on staged `*.{ts,tsx,js,jsx,json,jsonc,css}`), `bun lint:conventions`, `bunx sherif -i @types/node` |
| `pre-push` | `bun check-types` (Turbo-cached, seconds). A hook stays a short validation: anything that takes minutes, like the full test suite, runs in CI. |
| CI Lint | `bunx biome ci .`, `bun lint:conventions`, `bun lint:spelling`, `bunx sherif -i @types/node`, `bunx knip`; separately `bun check-types` |
| CI Test | `bun run test`; and the loading walk: a production build, seeded and served, must show no loading state in normal use (two attempts) |

Copy a command from CI rather than approximating it: CI runs `biome ci`, which checks lint, formatting and import
order and writes nothing; `biome check --write` (what the pre-commit hook runs on staged files) fixes formatting,
import order and class order in place.

### Every rule the linter runs, verbatim

Generated from the linter's own source, so it always matches what fails a build. Messages are the linter's own
words.

<!-- design:lint -->

## 17. Pre-ship checklist

The short checklist, by area, is in Read this first → The checklist: run it first. This section is the long one,
for any component you build or touch, then the do's and don'ts and how to review a UI change (17.3).

### 17.1 The full component checklist

Apply every line to any component you build or touch. When a line and a section disagree, the section wins and this list gets fixed.

**Tokens**

- Surfaces: `bg-background` (page), `bg-card`, `bg-popover`, the alpha fills `bg-bg-a1` (bands, notes, shelves) and `bg-bg-a2` (highlights, chips, step tiles), `bg-bg-2` (code, images, keycaps, segmented tracks), `bg-input` for fields. Text: `text-fg-4` (primary), `text-fg-3` (rows, menus), `text-fg-2` (descriptions, meta, counts), `text-fg-1` (disabled field text). Edges: `border-border` (`bg-3`).
- Icons take their text's ink automatically (`icon-1`…`icon-4` beside `fg-1`…`fg-4`); a tone keeps its tone.
- Status colours come from the tone tokens (`{hue}-1` fills, `{hue}-text` ink, `{hue}-a2` washes, `{hue}-a3` edges, `{hue}-4` solid), never Tailwind's palette (`text-emerald-400`).
- No hex, no `white` or `black` text utilities in app code (the destructive button's `text-white` and the scrim's `bg-black/10` are the kit's).
- Never stack an opacity modifier on a token that is already a tint.

**Geometry**

- Corners from the derived tokens: `rounded-control-sm` 6px (`xs`/`sm` controls), `rounded-control` 7px (`default`/`lg` controls, inputs, tab tracks), `rounded-item` 6px (a row in a popup), `rounded-popup` 10px (menus, selects, command, popovers, toasts), `rounded-segment` 5px (a tab inside a track), `rounded-checkbox` 4px. Insets `rounded-lg`, cards and dialogs `rounded-xl`, sheets `rounded-3xl`. `rounded-full` for circles and badges.
- Every corner is concentric with its parent (inner = outer − padding). Never `rounded-[Npx]` or a free `calc()`; a new nesting gets a new derived token.
- Controls and surfaces carry `corner-superellipse/1.125`.
- No drop shadows: only the hairline tokens `shadow-1…4` and `shadow-control*` (control edges); inside the kit, `shadow-md` (the popup ring, the lint rejects it in app code). No `ring-*` except a field's invalid `ring-1 ring-red-4`.

**Size** (the control ramp)

- Heights: 18 (`icon-2xs`, `Badge sm`), 20 (`Badge`, `Kbd`, switch track), 22 (`xs`, `icon-xs`), 24 (`sm`, `icon-sm`, menu, select and command rows, section labels, the `line` header), 26 (`default`, `icon`, `Input`, `SelectTrigger`, `default` and `ghost` tab lists), 28 (one-line list rows, the `strip` header, info popover rows), 30 (`lg`, `icon-lg`), 32 (`underline` tab list, the `block` header), 36 (card header bands, toolbars), 40 (settings rows, the command input row).
- Never hand-set a height on a control, strip or row; the primitive owns it. Every control in one row shares one height.
- Icons: `sm` 14 in every button and select, rows and badges; `md` 16 in `default` inputs; `lg` 20 for empty-state figures and full-page waits. No other size.

**Spacing**

- Title over description: `gap-px`, with no exceptions. A title next to its description on one line: 6px (`gap-1.5`).
- `gap-0.5` is banned in app code except inside `SectionLabel`; the next step is `gap-1`.
- Card inset 12px; list card `p-1`; settings card `p-1.5`; page sections 24px apart.
- An icon slot is 20px, 8px from the glyph to its label.
- Spacing belongs to the parent's `gap-*`, never a child's margin; no call-site tightening of a primitive.

**Type**

- Sizes: `text-2xs` 12px (meta, badges, section labels, tooltips), `text-xs` 13px (body, rows, controls), `text-sm` 14px (card and dialog titles, `lg` buttons), `text-base` 16px (page titles).
- Weights: normal (400) and `font-medium` (450); semibold (550) only for `strong` in prose, never as a class in a component. A label that turns medium on state uses `faux-medium`, so its width never changes.
- No eyebrows, no italic. Data that can clip uses `Truncate`.

**State**

- Hover only on things that respond to a click, and every `hover:` has the same `active:` on its line (`group-hover:` pairs with `group-active:`, unless it reveals from `opacity-0`).
- Hover is colour, never motion: secondary controls lay `bg-bg-a2/70`, a primary steps to `bg-primary/80`, rows only brighten their text under the sliding highlight.
- **No focus states.** No ring, outline, border recolour or wash marks keyboard focus; every interactive element carries `outline-none`. Keyboard movement inside a floating list still moves its highlight.
- Selected: a `primary` edge (on `::before` in a divided list) or the accent ink, never a ring. Selected items have no hover state.
- Invalid: a 1px `red-4` ring on the field and `FieldError` under it.
- Disabled: `opacity-45` on buttons and checkboxes, `opacity-50` on fields, selects, tabs and menu rows, with `cursor-not-allowed`. A disabled control keeps its pointer events so a tooltip can say why.
- Pending: `loading`, never `disabled`.
- Every colour change on hover, press or highlight is instant: no `transition-colors`, `transition-shadow`, bare `transition` or colour in `transition-[…]` beside a `hover:` or `active:`.
- The whole app is chrome by default (not selectable, arrow cursor); prose and code opt in with `selectable`.

**Scroll**

- Anything that scrolls inside a component fades at its edges, on an element without a border (frame outside, scroller inside).

**Overlays**

- Popups (popover, menu, select, preview card, command) are `bg-popover`, dialogs and sheets `bg-background`; all are edged by the `shadow-*` ring, never a `border` as well. Tooltips and toasts are the inverse: a `border` and no shadow.
- Scrims are `bg-black/10` (`dark:bg-black/55`), never blur.
- A dialog or sheet's close X has no tooltip; its `aria-label` is "Close".

**Documentation**

- Every primitive and composite is on `/ui` in every state, built from sample data, with every action a callback that only shows a toast. Change the design file in the same change as the code.

### 17.2 Do's and don'ts

1. **No drop shadows, no focus rings, no blur on surfaces.** Depth comes from the fill steps, the `bg-3` hairline and type. The primary and destructive buttons keep their inner top highlight (`inset 0 1px 0 oklch(1 0 0 / 0.16)`, `0.2` on destructive), the one exception. Selection recolours an edge; focus draws nothing.
2. **Concentric corners.** Use the derived corner tokens; a nested corner is the parent's minus the padding between them. Circles round fully. No raw corner values.
3. **One hairline.** `border-border` (`bg-3`) everywhere, never doubled; a popup's edge is the ring alone, a toned box's edge is its tone's `-a3`.
4. **Fill or edge for controls, both for panels.** A field is a fill with no border; an outline button is an edge on the page colour; a card or popup has its fill and its edge. Never a fill on a fill.
5. **Tokens, not values.** No hex, no hand-picked greys, no raw opacities on text. An icon takes its text's ink, never an opacity, a size or a colour set at the call site.
6. **One accent.** The blue `primary` for the single most important beat in a view: the primary button, the selected check, the underline, the current value. The same action repeated keeps the same look everywhere; never demote a copy to grey. Checkmarks are the accent, never green (the progress track's done steps are the one exception).
7. **State is instant, only motion eases.** A hover, press or highlight lands in the frame it happens with no transition; only things that move (a sliding indicator, a turning chevron, a popup or dialog entering, an opening height) ease. No hover scale or translate; the only press shapes are the fixed fill deflate, the 0.975 scale of the link button and a ghost tab, and the checkbox's 0.95.
8. **Both themes, every branch.** A token that differs by theme is defined in every cascade branch; light mode ships and is tuned, not a placeholder.
9. **Accessibility is part of the look.** 4.5:1 body text, 3:1 large text; icon-only buttons carry an `aria-label`; decorative icons are `aria-hidden`; no focus ring does not mean no keyboard: every control stays reachable and operable.
10. **Narrow windows and touch are first-class.** Shinsa runs in a floating window about 900px wide and in the Mac app; check every surface narrow.
    - **What does touch do with no hover?** Anything revealed on hover is always shown on touch (`pointer-coarse:opacity-100`). A tooltip is never the only way to reach information.
    - **What gives way when it doesn't fit?** Labels drop to icons, rows stack, controls take a strip of their own. Actions never vanish behind hover, never move into the page heading, and never fold into a `…` menu just for being narrow.
    - **Can a thumb hit it?** Sizes stay the desktop sizes; hit areas grow invisibly (a switch's `after:-inset-x-3 after:-inset-y-2`, a checkbox's `after:-inset-1.5`). Keep whole rows tappable.
11. **No side navigation in a page.** A page's parts are a tab bar under its heading.
12. **Shared pieces, not care at the call site.** Cards, insets, headers, rows, times, copies, confirmations and tooltips each have one owner; a hand-built copy is a bug and most are lint failures.

### 17.3 How to review a UI change

A finding you cannot reproduce is a guess; a fix you have not watched fail without it is a hope. Keep both out of
the report. A reviewer is a signal for the person who decides, never the approval.

1. **Scope before reading.** Read the request and the approved plan first; the change is judged against them, then
   against the rules in this file. Diff against the base (`git diff $(git merge-base HEAD origin/main)`), or only a
   later round's commits. Read the porcelain columns right: `M ` is staged, ` M` is worktree only, `??` untracked.
   Other agents work in the same tree: say which changes are whose, and never revert a file you did not write.
2. **Run what CI runs**, copied from the workflows, never an approximation: `bunx biome ci .` (not `check`),
   `bun lint:conventions`, `bun lint:spelling`, `bunx sherif -i @types/node`, `bunx knip`, `bun check-types` and
   `bun run test`. A claim in a summary that something passes is not evidence. A failing check is always blocking.
3. **Look at it.** A green type check proves nothing about a screen: open every changed page with the console
   visible, in light and dark, at about 900px and at 1280px, on `/ui` and in the app, next to the existing screens.
   Then walk the checklist (Read this first → The checklist and 17.1) line by line.
4. **Check the evidence against the diff**: the right screens, both themes, both widths, the states it claims. A
   user-visible change without evidence, or with evidence that does not show the changed flow, is blocking: capture
   your own as Evidence says, so the human has independent proof either way.
5. **Check the hand-over.** Each judgement call: read the code it is about and decide whether you would have made
   it; a call that breaks the request or a rule is blocking. The testing guide: follow the steps you can; a step you
   cannot follow, or a vague expected result, is a finding; a claim in `automated` the tests do not back is
   blocking. The steps around the merge: a missing variable, secret, migration or deploy is blocking, a secret's
   value in a step is blocking, a step the agent could have done itself is a finding.
6. **Read what the tests miss.** Uncovered changed lines that decide something (a branch, error handling, a
   calculation) are a finding; a log line or a type is not. A covered line with no assertion on its result is still
   worth a suggestion.
7. **Prove it.** Each blocking finding names `file:line`, what breaks and how you saw it. For a fix, revert it and
   watch the test fail, then restore it; a test that passes either way covers nothing. For a clean baseline copy the
   files aside or use `git worktree add`; never let `git stash` guess which stash.
8. **Know the traps.** A test that asserts the old behaviour encodes the bug: rewrite it to the corrected contract
   and say so. Coverage counts arrow functions (an uncovered callback is often dead code, to delete rather than
   cover) and sees only files a test imports. Turbo caches `check-types` and `build`: a type check that looks too
   fast replayed, so run `tsc --noEmit` in the package.
9. **Judge findings, do not obey them.** Bots, earlier reviews and your own instincts are input: decide for each
   whether it is valid, stale or a nitpick, and say which. Fix a nitpick only when the fix is free and buys
   something real.
10. **Report.** Lead with the verdict. Then confirmed problems, most severe first, each with what breaks and why;
    then the structural finding, if one explains several; then what you verified, with real numbers; then what you
    could not verify and why. Nothing about what is fine. A settled pattern goes back into this file in the same
    change.

| Wrong | Right |
| --- | --- |
| "Looks good to me." | "Blocking: the empty state uses a green checkmark (`queue.tsx:88`); `bun lint:conventions` fails on it." |
| A blocking finding on a spacing taste | An optional finding, with the scale step it should use |

## Appendix A. The kit stylesheet

The kit's whole stylesheet, verbatim: tokens, theme mapping, utilities, base rules, reduced motion, toasts,
selection. Load it first.

<!-- design:kit-stylesheet -->

## Appendix B. The web app's stylesheets

Loaded after Appendix A by the web app: prose, chat, terminal and code colours, the desktop window.

<!-- design:web-stylesheet -->
