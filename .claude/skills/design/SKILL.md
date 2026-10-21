---
name: design
description: Shinsa's design system (paywall-next's Application register, copied) — type roles, the one 3px corner, control heights, spacing, colour and the shared components. Load before building or restyling any UI in apps/web or packages/ui.
---

# Shinsa design

The rules live in `docs/design.md` (paywall-next's DESIGN.md plus Shinsa's five differences); the live
reference is `/ui`. This skill is the checklist.

Before writing UI:

1. Is there already a component? Primitives in `@shinsa/ui/components/*` (Button, Badge, Card,
   Dialog, Menu, Tabs, FilterTabs, SegmentedControl, SettingRow, PageSection, Empty, StatusDot,
   IconTile, Alert, Notice…). Shinsa composites in `apps/web/src/components` (PageHeader, Toolbar,
   ListRow, SectionLabel, Banner, StatusGlyph, Choice, ViewTabs, StageBadge). Use them.
2. Every text gets a type role (docs/design.md → Sizing → Type roles). Size, weight and colour come
   from the role.
3. Heights come from the control ramp (24 / 28 / 32 / 36 / 40) by context, header strips are 48,
   spacing from the closed scale. Primitives own their heights; don't write `h-*` on them.

Checklist:

- [ ] No `text-[Npx]`, `rounded-[Npx]`, `font-bold`, `shadow-*`, `ring-*` in apps/web (lint fails).
- [ ] Focus is the control's own border turning `primary`; every focusable control has a 1px border,
      transparent where not drawn.
- [ ] Fill or border for controls, both for panels.
- [ ] A state change never changes weight: `data-[active=true]:faux-medium`.
- [ ] Icons are Lucide, sized by their primitive; muted icons take `icon-tertiary`.
- [ ] Looked at it on `/ui` and in the app, light and dark, desktop and ~900px.
