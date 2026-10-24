---
name: design
description: Shinsa's design system (paywall-next's Application register on Buzzkit's kit) — type roles, the radius tokens, control heights, spacing, colour, Central icons and the shared components. Load before building or restyling any UI in apps/web or packages/ui.
---

# Shinsa design

The rules live in `docs/design.md` (paywall-next's DESIGN.md plus "Where Shinsa differs", which wins);
the live reference is `/ui`. This skill is the checklist.

Before writing UI:

1. Is there already a component? Primitives in `@shinsa/ui/components/*` (Button, Badge, Card,
   Dialog, Sheet, DropdownMenu, Select, Command, Tabs, Tooltip, Truncate,
   ScrollArea, EmptyState, Field…; docs/design.md → Where Shinsa differs, 18). Shinsa
   composites in `apps/web/src/components/<domain>` (layout/page: PageHeading, Toolbar, SectionLabel;
   layout: ListRow; layout/surface: CARD, Panel, StepNumber; controls: Choice, ChoiceButtons, SelectField,
   CopyButton, OptionsTrigger (every `•••`); overlays: InfoPopover, Hint, ConfirmDialog; text: TimeAgo, Markdown;
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
- [ ] An icon takes its text's colour at `--icon-alpha`, 85% (90% in menu rows), so the text reads
      first; `Icon` applies it. Equal strength is a context (`icon-solid`: ghost and icon-only buttons,
      errors), never a call-site `opacity-*` or a lighter step (docs/design.md → Where Shinsa differs, 19).
- [ ] Icons are Central (`<Icon name='Icon…' />`), sized by their primitive; run
      `bun run --cwd packages/ui generate:icons` after using a new name.
- [ ] Icon-only buttons name their action in an `aria-label` and the same tooltip.
- [ ] Looked at it on `/ui` and in the app, light and dark, desktop and ~900px.
