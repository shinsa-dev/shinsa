---
name: design
description: Shinsa's design system (paywall-next's Application register on Buzzkit's kit) — type roles, the radius tokens, control heights, spacing, colour, Central icons and the shared components. Load before building or restyling any UI in apps/web or packages/ui.
---

# Shinsa design

The rules live in `docs/design.md` (paywall-next's DESIGN.md plus "Where Shinsa differs", which wins);
the live reference is `/ui`. `docs/design-system.md` is the same system as one self-contained file for agents
outside the repo (`shinsa.dev/design.md`): a change to a rule, a component or a pattern updates it too. This skill is
the checklist.

Before writing UI:

1. Is there already a component? Primitives in `@shinsa/ui/components/*` (Button, Badge, Card,
   Dialog, Sheet, DropdownMenu, Select, Command, Tabs, Tooltip, Truncate,
   ScrollArea, EmptyState, Field, Checklist…; docs/design.md → Where Shinsa differs, 18). Shinsa
   composites in `apps/web/src/components/<domain>` (layout/page: PageHeading, Toolbar, SectionLabel;
   layout: ListRow; layout/surface: CARD, Panel, StepNumber; controls: Choice, ChoiceButtons, SelectField,
   CopyButton, OptionsTrigger (every `•••`), ChecklistBlock and ItemChecklist (every list of things to do, merge
   steps included; a Markdown task list draws the same rows read-only); overlays: InfoPopover, Hint, ConfirmDialog; text: TimeAgo, Markdown;
   status: StatusTile, CheckMark, CheckOutcomeIcon; links:
   TaskLink, PrLink, RepoChip, BranchChip, FileLink). Use them.
2. Every text gets a type role (docs/design.md → Sizing → Type roles). Size, weight and colour come
   from the role.
3. Heights come from the kit's control ramp (22 / 24 / 26 / 30, docs/design.md → Where Shinsa
   differs, 20), spacing from the closed scale. Primitives own their heights; don't write `h-*` on
   them.

Checklist:

- [ ] No `text-[Npx]`, a weight other than normal, `font-medium` or `font-semibold`, a Tailwind shadow
      (`shadow-sm`…), a raw `shadow-[…]` or `ring-[…]`, or `gap-0.5` in apps/web (lint fails; the
      one 2px gap, between a section header's buttons, is `SectionLabel`'s); depth comes
      from the shadow tokens (`shadow-1…4`, `shadow-control*`). No `rounded-[Npx]` in apps/web or packages/ui.
- [ ] No focus states: no ring, outline, border recolour or wash (lint fails on `focus:` variants, in packages/ui too).
- [ ] Checkmarks are the accent (`CheckMark`, `CHECK_TEXT`), never green (lint fails); only the progress track's
      done steps are green.
- [ ] Every `hover:` has an `active:` on the same line, with the same value (lint checks only that one is there).
- [ ] Fill or border for controls, both for panels.
- [ ] A state change never changes weight: `data-[active=true]:faux-medium`.
- [ ] An icon draws in a solid icon ink a step under its text, never an opacity: `icon-N` beside
      `fg-N`, the tone itself beside a tone. The text colour sets it (`text-*` utilities set
      `--icon-color`), so put the icon inside its label's colour or give it the label's class; never
      an ink brighter than its text, a call-site `opacity-*` other than a reveal (`opacity-0` →
      `opacity-100`), `[&_svg]:` colour or opacity, or `[--icon-color:…]` (lint fails;
      docs/design.md → Where Shinsa differs, 19, and Iconography → Icon colour).
- [ ] Three icon sizes: `size='sm'` 14 (12–13px text, rows, 22/24 controls, every button and select), `'md'` 16
      (14px+ text, 26/30 inputs), `'lg'` 20 (empty states, full-page waits). Inside a primitive pass nothing;
      elsewhere pass `size`. Never `size-*`/`w-*`/`h-*` on an icon (lint fails). Every icon in one row
      is the same size and ink, chevrons and spinners included.
- [ ] Icons are Central (`<Icon name='Icon…' />`), never a hand-drawn `<svg>`; run
      `bun run --cwd packages/ui generate:icons` after using a new name.
- [ ] A tab or nav item with an icon shows the icon's filled twin (`…Filled`) while it is the current one, and the
      outline otherwise (`NavItem`'s and `NavButton`'s `activeIcon`, Home, Tasks, Settings, Services, the terminal tab
      in front, a service's tab included, whose state glyph fills in its tone; docs/design.md → Where Shinsa differs,
      19). A state glyph anywhere but the tab in front (a row's tile, a status tile) keeps its outline.
- [ ] Icon-only buttons name their action in an `aria-label`, and the same tooltip when the glyph doesn't say it.
- [ ] A tooltip adds information the screen doesn't show, or it goes: none that repeats a control's label, on
      `+N −N`, on a self-evident count or on a `•••` menu trigger; a labelled control keeps one that says what its
      label can't (Approve changes: "Opens the pull request"). Never a `delay`: every tooltip waits `TOOLTIP_DELAY`
      (lint fails on a delay and on a tooltip equal to its trigger's text; docs/design.md → Where Shinsa differs, 13).
- [ ] No keyboard shortcut but ⌘K, and the Code tab's ⌘P, ⇧⌘F, ⌘F and ⌘G while it is open (lint fails on a global
      key listener anywhere else; docs/design.md → Where Shinsa differs, 32).
- [ ] A tooltip opens over its text and icon only: what a `Hint` or `TooltipTrigger` wraps is inline or
      `w-fit`, never a block across a full-width row (lint fails; docs/design.md → Where Shinsa differs, 13).
- [ ] A new tooltip goes through `Hint`, `TimeAgo`/`Duration`, `Truncate` or `useTooltipTrigger`; never a
      tooltip root per row. The page has one (`TooltipProvider` in `root.tsx`).
- [ ] No dialog where a view in place does: a popover turns to its next view (the Services popover's Add, Manage
      and forms), a removal asks in its own footer. A list popover is as tall as its content and scrolls past the room
      it has (the queue's and Services' `COMPACT_POPOVER`); a view that loads or grows in place (a form) keeps one
      height, so nothing it does moves the popover's edges. A dialog that is still needed is the kit's `Dialog` or
      `AlertDialog` as it is: its entry (`DIALOG_MOTION`) and fixed width come with it; only ⌘K is quicker
      (`COMMAND_MOTION`, docs/design.md → Motion).
- [ ] A popover list grouped in sections is the compact queue's (`CompactSections`, `CompactSection`), never a
      look-alike; a footer's padding is the same on every side and a view's header starts as far from the top as
      from the side (measure them). A section header's fold chevron sits right after its text and counts, never at
      the end, which is the action's.
- [ ] A field is the kit's `Input`, `Textarea` or `SelectTrigger`, filled with `bg-input` (raised a step inside a
      dark popover by `globals.css`), never given a border or a fill of its own to make it show.
- [ ] Inside a popover a list of boxes is `Checkbox variant='outline'`; a quiet action in a row that washes on its
      own is `Button variant='bare'`; adjacent icon buttons in a row are 1px apart (`gap-px`), like an `InputGroup`
      addon's (docs/design.md → Where Shinsa differs, 21 and 37).
- [ ] An icon that sits beside others at one size but draws smaller in Central's box is matched in
      `MATCHED_SCALE` (`packages/ui/scripts/icons.ts`), never sized at the call site; measure its ink.
- [ ] Text a person would copy (prose, code, output, an error) is `selectable`, the kit's one class; everything
      else is chrome, never selected and under the arrow in the desktop app (a browser keeps native selection). No `select-text`, `cursor-text` or `user-select` by hand
      (lint fails; docs/design.md → Where Shinsa differs, 39).
- [ ] Looked at it on `/ui` and in the app, light and dark, desktop and ~900px.
