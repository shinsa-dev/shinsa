# Shinsa

A human-assisted coding harness. Agents do the work end to end; the human only appears at gates: reviewing a change, approving a merge, answering a question (and approving a plan, when switched on). Everything between gates is the harness's job. The product spec is `docs/spec.md`; the agent engine (roles, lifecycle, outbox, recovery) is `docs/engine.md`; the design system is `docs/design.md` and the `design` skill.

## Project structure

```
apps/server/      → @shinsa/server  The local server and the `shinsa` command. `shinsa serve` runs the event log
                                    (SQLite), effect outbox, agent runs (Claude Agent SDK), git worktrees, GitHub,
                                    HTTP + WebSocket and the built web app; `shinsa do|import|status|open` (src/cli)
                                    talk to it over HTTP, so agents can hand work to Shinsa too. See apps/server/CLAUDE.md
apps/server/plugin/                 The Claude Code plugin every agent loads: review, evidence, handover skills
apps/web/         → @shinsa/web     React 19 + Vite + Tailwind 4. Renders server state; owns nothing
packages/core/    → @shinsa/core    Pure domain, one folder per concern under src/ (model, events, commands, effects,
                                    state, decide, queue, briefing, report, chat, prompts, progress, protocol); tests
                                    mirror it under test/ at 100% coverage. No I/O. See packages/core/CLAUDE.md
packages/ui/      → @shinsa/ui      The design system (from Polis and Buzzkit): tokens, components, icons
docs/                               spec.md, engine.md, design.md
```

## How it works

```
web ──WebSocket──► shinsa serve
                    Engine.dispatch(command)
                      └─ decide(state, command) ─► events + effects      (packages/core, pure)
                         events → SQLite log → applyEvent → state → broadcast to every socket
                         effects → EffectRunner: triage, worktrees, agent runs, PRs, briefings
                                    └─ results come back as commands (run.end, pull_request.record…)
```

- **State is the event log.** `decide` is pure and deterministic given `now` and `newId`; every state change is an event; replaying the log rebuilds state exactly. Never mutate state outside `applyEvent`.
- **The task lifecycle** lives in `packages/core/src/decide/` (one file per area: `lifecycle`, `fixes`, `pull-requests`, `dependencies`, `gates`, `runs`…): triage → (waiting on the tasks it depends on, until every one of them merges) → (planning → spec gate) → building → checking (agent review, automatic fix rounds) → review gate → shipping (PR opened, CI and review bots fixed automatically) → merge gate → merged. Failures open a `failure` gate; agent questions open a `question` gate.
- **The hand-over protocol** (`packages/core/src/report/`): specs, work reports and review findings have fixed
  fields with hard length limits. The tools publish the limits in their schemas; `validate*` rejects a hand-over that
  breaks one and tells the agent what to fix. The work report *is* the review screen: phases in reading order, each
  pointing at line ranges ranked `critical` / `high` / `normal`.
- **No repositories to set up.** Triage picks a git repository from `~/Developer`, `~/Projects`, `~/code`, `~/src`
  (plus `SHINSA_ROOTS`), or the directory `shinsa do` ran in. A repository is registered the first time Shinsa works
  in it and filed into an area named after its GitHub owner (`Personal` for the user's own).
- **Agents hand over only through Shinsa's MCP tools** (`propose_plan`, `complete_phase`, `complete_fix`, `report_review`, `ask`, `attach_evidence`, `find_tasks`, `note`), never through their final message. Shinsa commits on `complete_phase` and `complete_fix` and owns pushes, PRs and merges; a PreToolUse hook denies `git commit`, `git push`, `gh pr create|merge` inside agent runs.
- **Nothing reaches the default branch without the human.** The merge gate is the only path to `gh pr merge`.

## Commands

| Command | Description |
|---|---|
| `bun dev` | `shinsa serve` on :5180 and the web app on :5181 (proxies `/api` and `/ws`) |
| `bun run build` then `bun start` | Production: `shinsa serve` serves `apps/web/dist` on :5180 |
| `bun lint` | Biome (with the Grit plugins) and `scripts/lint-conventions.ts` |
| `bun check-types` | TypeScript in every workspace and `scripts/` |
| `bun run test` | Unit tests (Bun); `apps/server` fails below 100% line and function coverage |
| `bunx knip` / `bun deps` | Dead code / workspace dependency drift |

`SHINSA_DATA_DIR` (default `~/.shinsa`) holds the database, worktrees, transcripts and evidence. Use a scratch directory when testing: `SHINSA_DATA_DIR=/tmp/shinsa-dev bun --cwd apps/server start`. `SHINSA_INSPECT=1` serves a data directory without running agents, syncing pull requests or recovering runs, for looking at seeded state.

## Key conventions

- **No comments.** Names and structure carry the meaning; the reasons live here and in `docs/`. `bun lint:conventions` enforces it (`biome-ignore` and `@ts-` are allowed).
- **The verb catalog**: `find*` throws, `select*` returns null, `list*`, `count*`, `resolve*` derives, `create*`/`update*`, `upsert*`/`write*`/`replace*`, `remove*`, `assert*`, `serialize*`, `request*`/`sync*`/`apply*`/`record*`. No `get*`, `fetch*`, `load*`, `set*`, `delete*`, `destroy*` (lint-enforced). The `conventions` skill has the examples.
- **Skills** (`.claude/skills`): `conventions` is the pattern catalog, load it before writing code; `review` is the method for a cleanup or review pass (scope the diff, prove every finding by reverting its fix); `copy` for any string a person or an agent reads; `design` for UI.
- **`packages/core` stays pure**: no `node:*`, no Bun, no I/O (Biome bans the imports). New behaviour is a command, events and effects there, and the I/O for the effect in `apps/server`.
- **Icons** are Central Icons through `<Icon name='Icon…' />` (`@shinsa/ui/components/icon`); run `bun run --cwd packages/ui generate:icons` after using a new name. Primitives size their icons; don't pass a size inside a Button, Badge, tab or menu row.
- **UI copy** follows the `copy` skill: sentence case, full sentences, no em dashes, plain professional words (task, review, workspace), never playful labels.
- **Desktop first, responsive.** Screens are built for a full desktop window and must still work in an ~900px
  floating window. Cards is the default layout (no rail, centred pages, a "3 need you" button opens the queue);
  Sidebar, picked in Settings → Appearance, adds a permanent rail that moves into a sheet below `md`.
- **One keyboard shortcut.** ⌘K (Ctrl K) opens the command menu (`apps/web/src/features/command`); nothing else
  is bound to a key. Pages add their own actions with `useRegisterCommands` while mounted, and every action
  dispatches through the same `sendCommand` as the buttons (`docs/design.md`, Where Shinsa differs, 14).
- **The design system is paywall-next's**, on Buzzkit's kit in `packages/ui` (`docs/design.md` → Where Shinsa
  differs, which wins). One blue accent (`primary`) for the primary button, links, selection and checkmarks; `success`,
  `warning`, `destructive` and `info` carry state only.
- Ternaries never wrap an awaited call; multi-line arrows get a block; no single-use constants; `.catch(() => undefined)` is not allowed.

**Docs ship in the same change as the behaviour, or the change is not done.**

## Git

Agents working on this repo never commit or push; the user reviews and commits. Commit messages are conventional commits, one subject line, nothing else.
