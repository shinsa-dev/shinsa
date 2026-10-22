---
name: design
description: Shinsa's design system (paywall-next's Application register on Buzzkit's kit) — type roles, the radius tokens, control heights, spacing, colour, Central icons and the shared components. Load before building or restyling any UI in apps/web or packages/ui.
---

# Shinsa design

The rules live in `docs/design.md` (paywall-next's DESIGN.md plus "Where Shinsa differs", which wins);
the live reference is `/ui`. This skill is the checklist.

Before writing UI:

1. Is there already a component? Primitives in `@shinsa/ui/components/*` (Button, Badge, Card,
   Dialog, Sheet, DropdownMenu, Select, Combobox, Command, Tabs, PillTabs, Tooltip, Truncate,
   ScrollArea, EmptyState, IconTile, Field…; docs/design.md → Where Shinsa differs, 18). Shinsa
   composites in `apps/web/src/components` (PageHeading, Toolbar, ListRow, SectionLabel, Banner,
   Choice, Panel, InfoPopover, TimeAgo, Hint). Use them.
2. Every text gets a type role (docs/design.md → Sizing → Type roles). Size, weight and colour come
   from the role.
3. Heights come from the kit's control ramp (22 / 24 / 26 / 30, docs/design.md → Where Shinsa
   differs, 20), spacing from the closed scale. Primitives own their heights; don't write `h-*` on
   them.

Checklist:

- [ ] No `text-[Npx]`, `rounded-[Npx]`, `font-bold`, `shadow-*`, `ring-*` in apps/web (lint fails).
- [ ] No focus states: no ring, outline, border recolour or wash (lint fails on `focus:` variants).
- [ ] Every `hover:` has its `active:` pair on the same line.
- [ ] Fill or border for controls, both for panels.
- [ ] A state change never changes weight: `data-[active=true]:faux-medium`.
- [ ] Icons are Central (`<Icon name='Icon…' />`), sized by their primitive; run
      `bun run --cwd packages/ui generate:icons` after using a new name.
- [ ] Icon-only buttons name their action in an `aria-label` and the same tooltip.
- [ ] Looked at it on `/ui` and in the app, light and dark, desktop and ~900px.
