# Shinsa

A human-assisted coding harness. Agents do the work end to end; the human only appears at gates: approving a spec, reviewing a change, approving a merge, answering a question. Everything between gates is the harness's job. The product spec is `docs/spec.md`; the design system is `docs/design.md` and the `design` skill.

## Project structure

```
apps/cli/         → @shinsa/cli     The `shinsa` command. `shinsa serve` is the server on the user's machine: event
                                    log (SQLite), effect runner, agent runs (Claude Agent SDK), git worktrees, GitHub,
                                    HTTP + WebSocket, the built web app. `shinsa do|status|open` talk to it, so agents
                                    can hand work to Shinsa too. See apps/cli/CLAUDE.md
apps/cli/plugin/                    The Claude Code plugin every agent loads: review, evidence, handover skills
apps/web/         → @shinsa/web     React 19 + Vite + Tailwind 4. Renders server state; owns nothing
packages/core/    → @shinsa/core    Pure domain: model, events, commands, decide(), queue ranking, prompts,
                                    wire protocol, the hand-over protocol (report.ts), diff parsing. No I/O
packages/ui/      → @shinsa/ui      The design system (from Polis and Buzzkit): tokens, components, icons
docs/                               spec.md, design.md
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
- **The task lifecycle** lives in `packages/core/src/decide.ts`: triage → (planning → spec gate) → building → checking (agent review, automatic fix rounds) → review gate → shipping (PR opened, CI and review bots fixed automatically) → merge gate → merged. Failures open a `failure` gate; agent questions open a `question` gate.
- **The hand-over protocol** (`packages/core/src/report.ts`): specs, work reports and review findings have fixed
  fields with hard length limits. The tools publish the limits in their schemas; `validate*` rejects a hand-over that
  breaks one and tells the agent what to fix. The work report *is* the review screen: phases in reading order, each
  pointing at line ranges ranked `critical` / `high` / `normal`.
- **No repositories to set up.** Triage picks a git repository from `~/Developer`, `~/Projects`, `~/code`, `~/src`
  (plus `SHINSA_ROOTS`), or the directory `shinsa do` ran in. A repository is registered the first time Shinsa works
  in it and filed into an area named after its GitHub owner (`Personal` for the user's own).
- **Agents hand over only through Shinsa's MCP tools** (`propose_spec`, `submit_work`, `report_review`, `ask`, `attach_evidence`, `note`), never through their final message. Shinsa commits on `submit_work` and owns pushes, PRs and merges; a PreToolUse hook denies `git commit`, `git push`, `gh pr create|merge` inside agent runs.
- **Nothing reaches the default branch without the human.** The merge gate is the only path to `gh pr merge`.

## Commands

| Command | Description |
|---|---|
| `bun dev` | `shinsa serve` on :5180 and the web app on :5181 (proxies `/api` and `/ws`) |
| `bun run build` then `bun start` | Production: `shinsa serve` serves `apps/web/dist` on :5180 |
| `bun lint` | Biome (with the Grit plugins) and `scripts/lint-conventions.ts` |
| `bun check-types` | TypeScript in every workspace and `scripts/` |
| `bun run test` | Unit tests (Bun) |
| `bunx knip` / `bun deps` | Dead code / workspace dependency drift |

`SHINSA_DATA_DIR` (default `~/.shinsa`) holds the database, worktrees, transcripts and evidence. Use a scratch directory when testing: `SHINSA_DATA_DIR=/tmp/shinsa-dev bun --cwd apps/cli start`. `SHINSA_INSPECT=1` serves a data directory without running agents, syncing pull requests or recovering runs, for looking at seeded state.

## Key conventions

- **No comments.** Names and structure carry the meaning; the reasons live here and in `docs/`. `bun lint:conventions` enforces it (`biome-ignore` and `@ts-` are allowed).
- **The verb catalog**: `find*` throws, `select*` returns null, `list*`, `count*`, `resolve*` derives, `create*`/`update*`, `upsert*`/`write*`/`replace*`, `remove*`, `assert*`, `serialize*`, `request*`/`sync*`/`apply*`/`record*`. No `get*`, `fetch*`, `load*`, `set*`, `delete*`, `destroy*` (lint-enforced). The `conventions` skill has the examples.
- **`packages/core` stays pure**: no `node:*`, no Bun, no I/O (Biome bans the imports). New behaviour is a command, events and effects there, and the I/O for the effect in `apps/cli`.
- **Icons** are Lucide (`lucide-react`), like paywall-next, imported directly; the redrawn glyphs (the X) come from `@shinsa/ui/components/icons`. Primitives size their icons; don't pass a size inside a Button, Badge, tab or menu row.
- **UI copy** follows the `copy` skill: sentence case, full sentences, no em dashes, plain professional words (task, review, workspace), never playful labels.
- **Desktop first, responsive.** Screens are built for a full desktop window (rail, then panes that scroll on their
  own) and must still work in an ~900px floating window. Below `lg` the rail moves into a sheet.
- **The design system is paywall-next's**, copied into `packages/ui` (`docs/design.md` lists the five places
  Shinsa differs). One blue accent (`primary`) for the primary button, links, selection and focus; `success`,
  `warning`, `destructive` and `info` carry state only.
- Ternaries never wrap an awaited call; multi-line arrows get a block; no single-use constants; `.catch(() => undefined)` is not allowed.

**Docs ship in the same change as the behaviour, or the change is not done.**

## Git

Agents working on this repo never commit or push; the user reviews and commits. Commit messages are conventional commits, one subject line, nothing else.
