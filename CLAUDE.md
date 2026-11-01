# Shinsa

A control plane for coding agents. Agents do the work end to end; the human only appears at gates: reviewing a change, approving a merge, answering a question (and approving a plan, when switched on). Everything between gates is Shinsa's job. The product spec and its status are `docs/spec.md`; the agent engine (roles, lifecycle, outbox, recovery, accounts, delegation, schedules) is `docs/engine.md`; every object, its schema and its name (the glossary, commands, events, effects, the naming decisions) is `docs/protocol.md`; the design system is `docs/design.md` and the `design` skill, and `docs/design-system.md` is the same system as one self-contained file for agents outside the repo (served as `shinsa.dev/design.md`, its token, icon and lint tables generated at build; `apps/marketing/CLAUDE.md`); where each harness feature comes from (T3 Code, Kanna, Paperclip) and how far it is built is `docs/harness-plan.md`.

## Project structure

```
apps/engine/      → @shinsa/engine  The engine and the `shinsa` command. The engine (`shinsa engine`, which the Mac app
                                    runs in the background from a compiled bundle, scripts/build-engine.ts) runs the event log
                                    (SQLite), effect outbox, agent runs (behind a provider interface: the Claude
                                    Agent SDK and Codex), accounts, the MCP servers, plugins and skills agents load,
                                    schedules and webhooks, git worktrees, GitHub, your terminals (PTYs), HTTP +
                                    WebSocket, onboarding and the built web app;
                                    `shinsa [folder]|open|do|import|status` and `shinsa <group> <action>` (src/cli, generated
                                    from src/surface; docs/cli.md) talk to it over HTTP, so agents can hand work to
                                    and manage Shinsa too; every task agent gets the same surface as tools
                                    (src/agents/manage: tools, client). See apps/engine/CLAUDE.md
apps/engine/plugin/                 The Claude Code plugin every agent loads: review, evidence, handover skills
apps/web/         → @shinsa/web     React 19 + Vite + Tailwind 4, laid out like Buzzkit's app (routes/, components/
                                    <domain>/, hooks/, lib/). Renders server state; owns nothing. See apps/web/CLAUDE.md
apps/desktop/     → @shinsa/desktop Shinsa for Mac, how Shinsa runs: carries the compiled engine, registers it as a launchd
                                    job, shows its interface, and adds the Dock badge, notifications, `shinsa://` links,
                                    the menu and its own updates. See apps/desktop/CLAUDE.md
apps/cloud/       → @shinsa/cloud   The Worker on app.shinsa.dev that remote access runs through: GitHub sign-in,
                                    pairing, each machine's Cloudflare tunnel, connect tokens, webhooks, the Slack bot's
                                    relay, the web app's remote build. Holds no task state and can read none. See
                                    apps/cloud/CLAUDE.md
apps/marketing/   → @shinsa/marketing The one-page site: Astro, static, whose demos are the web app's own components on
                                    sample data, against a stand-in server in the browser. See apps/marketing/CLAUDE.md
packages/core/    → @shinsa/core    Pure domain, one folder per concern under src/ (domain, agent-models, events,
                                    commands, effects, state, decide, accounts, costs, schedules, queue, briefing,
                                    report, chat, prompts, progress, protocol); tests under test/ at 100% coverage.
                                    No I/O. See packages/core/CLAUDE.md
packages/ui/      → @shinsa/ui      The design system: Buzzkit's kit (tokens, components, icons), docs/design.md
docs/                               spec.md, engine.md, protocol.md, design.md, design-system.md, cli.md, harness-plan.md
```

## How it works

```
web ──WebSocket──► shinsa engine
                    Engine.dispatch(command)
                      └─ decide(state, command) ─► events + effects      (packages/core, pure)
                         events → SQLite log → the decided state → a patch to every socket
                         effects → EffectRunner: triage, worktrees, agent runs, PRs, briefings
                                    └─ results come back as commands (run.end, pull_request.record…)
```

- **State is the event log.** `decide` is pure and deterministic given `now` and `newId`; every state change is an event (except the Home guide, kept beside the log: `docs/engine.md` → The briefing); replaying the log rebuilds state exactly (a snapshot only saves replaying it). Never mutate state outside `applyEvent`, and a fold writes a record only through `writeEntry`/`removeEntry` (`docs/engine.md` → State in memory).
- **A task is a conversation of rounds.** Each round is one piece of work with its own steps, plan, build, review and
  pull request; a new idea in the chat starts the next round on the same branch, worktree and agent sessions, shipped
  onto the open pull request or stacked on it. Merge ends a round, not the task; you (or an agent, once nothing is open)
  mark the task done (`docs/engine.md` → Rounds).
- **One agent session per task; a separate agent only for isolated context** (the engine's first rule,
  `docs/engine.md` → Agents). A task's Agent (`RunRole` `agent`) is one provider session for the task's whole life:
  planning is its round zero, then it builds every phase, takes every fix and runs the operation, and every later round
  and kind of work (an answer, an investigation, research) resumes the same session (`Decider.taskSession`); an Agent's
  runs differ only by `purpose`. A fresh session only when the old one cannot go on (context full, lost, image error,
  provider changed); a changed model resumes the session on the new model. Each build phase, fix and operation folds
  the turns before it through eunoe and starts from the round brief (`docs/engine.md` → Compaction and fast mode,
  Boundary folds). The reviewer keeps a session of its own per task, and so do watchdog checks (a watch session), checks stay commands (the Agent chooses scoped ones in its plan and keeps them current, Shinsa runs them, `docs/engine.md` → Checks), and delegation is
  only for work whose context must stay apart or that runs truly in parallel. Never add a role per step or per problem
  type.
- **Cache first: an agent session's prefix never changes** (`docs/engine.md` → Caching). The system prompt and the
  tool list are byte-identical across every turn, purpose, kind of work and round of a session: no time, stage, round,
  account, setting, task list, id, port or token in them; everything that changes goes into the user turn, at its
  tail. Every task-session role is served one tool list (`listToolNames`) and `decide` refuses what a role may not
  call; read-only steps use hooks, never `disallowedTools`; the extension set is decided once per session. Quick calls
  keep a fixed system prompt and put the call's data in the user prompt. A change that breaks this fails
  `providers/claude/session.test.ts` and `test/e2e/prompt-cache.test.ts`.
- **The task lifecycle** lives in `packages/core/src/decide/`, one file per area (`lifecycle`, `fixes`, `pull-requests`, `dependencies`, `gates`, `runs`…; the table is `packages/core/CLAUDE.md`): triage → waiting on other tasks → setup verification → planning → building and checking, phase by phase (each phase's checks, the agent's choice) → review gate → shipping → merge gate → merged, for a change. Each task follows its own pipeline of fixed building-block steps (answer, research, investigate, your OK, plan, operate, build, checks, agent review, your review, pull request, merge) under guards in core, so a question, an investigation, research or an operation never opens a pull request, and turning one into a change goes through your OK. Every step and gate is an instance of a typed schema in core (`domain/steps.ts`), and a rule set over it (`domain/verification.ts`) makes verification strict for any work that changes code or runs an operation and never applies to a pure inquiry. Six kinds are presets ("kind of task" on screen, shape in code) and the kind is never yours to change; the planner may compose other steps and set plan parameters, which core's rules checker (`validateComposition`, `validatePlanRules`) accepts or hands back. The path, the shapes, each gate and what opens it are `docs/engine.md` → A task's path, Task shapes, Gates; the schema and the rules are `docs/protocol.md` → Steps and gates, Verification.
- **The hand-over protocol** (`packages/core/src/report/`): plans, phase hand-overs, fixes, review findings and
  inquiry results have fixed fields with hard length limits. The tools publish the limits in their schemas;
  `validate*` rejects a hand-over that breaks one and tells the agent what to fix. Shinsa assembles the work report
  you review from the phase hand-overs, in plan order, each pointing at line ranges ranked `critical` / `high` /
  `normal`, with the decisions and their alternatives and, on the last phase, the Agent's walkthrough of the whole
  change; the reviewer, on its own session, adds findings and the decisions it disagrees with (`docs/protocol.md` →
  Hand-overs, `docs/engine.md` → The review report).
- **Projects, not setup.** A task belongs to a project (repositories and folders, a key, a description; the focus
  project by default). Triage finds the repository within it, or in the folders chosen at onboarding, and Shinsa
  registers it the first time it works there. Agents are told the project. A task's handle (`SW-142`) is for people
  and never changes; its UUIDv7 id is the key of everything stored (`docs/engine.md` → Projects and task identity).
- **Agents hand over only through Shinsa's MCP tools** (`isHandOverTool`), never through their final message; which
  role has which tool is `listToolNames` (`packages/core/src/domain/tools.ts`), tabled in `docs/protocol.md` → Agent
  tools. Every task agent also has the command surface as tools (`tasks_done`, `tasks_prioritize`…) but the human-only
  specs: what it does to another task is logged as on your behalf from its task (`docs/engine.md` → Agents manage
  Shinsa). Shinsa commits on `complete_phase` and `complete_fix` and owns pushes, PRs and merges; every command an agent runs is checked against `apps/engine/src/agents/policy.ts` (no commit, push, rebase, `git pull` without `--no-rebase`, `reset --hard`, `gh pr create|merge`, checkout of the default branch, a human-only `shinsa` command, or a whole test suite), through a PreToolUse hook for Claude and command approvals for Codex.
- **Nothing reaches the default branch without the human.** The merge gate is the only path to `gh pr merge` Shinsa
  takes; GitHub branch protection is what stops a shell from taking another (`docs/engine.md` → Who can change Shinsa).
- **Some decisions are human-only**: closing any gate, the settings in `HUMAN_ONLY_SETTINGS` and a repository's
  own check commands, workspace and coverage (`HUMAN_ONLY_REPO_FIELDS`); a task's own checks are its agent's. Their surface specs are `humanOnly`, so no agent has a tool or a shell command for
  them, and core refuses them on your behalf: nothing sent for you closes a gate, and a message an agent sends to a
  task at a gate is kept for its next agent (`docs/engine.md` → Who can change Shinsa has the list and the HTTP guard).
- **No backwards compatibility in code.** Shinsa has never shipped: a rename or a removal is done everywhere at once,
  with no readers for old events, stored shapes or transcripts and no redirects for old routes or ids
  (`docs/protocol.md` → Naming decisions). The one exception is the user's own event log: when a change would leave
  old event shapes in it, `apps/engine/src/store/legacy.ts` rewrites them once on start, versioned by SQLite's
  `user_version` (bump `LOG_VERSION` in `store/event-log.ts`), so code never reads an old shape (`docs/engine.md` →
  State in memory).
- **The hosted page can be newer than the engine it reaches.** app.shinsa.dev serves the web app built from `main`
  while each machine's engine updates on its own channel, so every engine announces what it speaks on connect
  (`engine { version, protocol, commands, features }`) and the page offers only that, per task's machine. A new user
  command is announced by itself; add it to `GATED_COMMANDS` (core's `test/protocol/engine.test.ts`, which fails until
  you do) and give its UI a command the menus filter by (`TASK_ACTION_COMMAND`) or `useEngineCommand(type, taskId)`. A
  new `/api` route, or a setting an older engine would ignore, needs a name in `ENGINE_FEATURES` and its routes in
  `ENGINE_FEATURE_ROUTES` (`apps/engine/src/http/features.ts`; `test/http/engine-features.test.ts` fails on a route in
  neither that nor its frozen baseline), and the UI asks `useEngineFeature`. Never edit the baselines to make a test
  pass. Raise `ENGINE_PROTOCOL` only when an older page and engine cannot talk at all (`docs/engine.md` → Remote access,
  What each machine speaks).

## Commands

| Command | Description |
|---|---|
| `bun dev` | `shinsa engine` on :5180 and the web app on :5181 (proxies `/api` and `/ws`); the engine's `dev` and `start` scripts pass `SHINSA_PORT=5180` (an exported `SHINSA_PORT` wins), so a checkout never takes the Mac app's port |
| `bun run build` then `bun start` | Production: `shinsa engine` serves `apps/web/dist` on :5180 |
| `bun lint` | Biome (with the Grit plugins), `bun lint:conventions` (`scripts/lint-conventions.ts`, its rule tables and messages in `scripts/lint-rules.ts`: comments outside `packages/ui`, the verb catalog, the class checks in `apps/web/src` and, for icon fades, green checkmarks, corners and focus states, `packages/ui/src` too) and `bun lint:spelling` (cspell; add a real word to `cspell.json`) |
| `bun format` | Biome's formatter only (`bun format:fix` writes) |
| `bun check-types` | TypeScript in every workspace and `scripts/` |
| `bun run test` | Unit tests (Bun) in every workspace plus `scripts/*.test.ts` (`bun run test:scripts`, the root `bunfig.toml`); each workspace and `scripts/` fails below 100% line and function coverage. Every test script runs `bun test --randomize`, which shuffles the files and the tests in each file and prints the order's `--seed=N`: tests must not depend on order, within a file or across files (rerun a failing order with `bun test --randomize --seed N` in that package) |
| `bunx knip` / `bun deps` | Dead code / workspace dependency drift |
| `bun run --cwd apps/marketing dev` | The site on :5182 (`build`, `preview` likewise; Astro runs under Bun) |
| `bun scripts/remote-preview.ts` | Remote access to click through without a deploy (the `remote-preview` service builds the web app first): two engines on seeded copies, Studio (the full seed) and Laptop (three tasks), each with remote access on, fixed numbers for how busy each is (`resources`), and no agents or effects (but making a share link, and `POST /api/placement`, which asks your own Claude's classifier about the routing policies you write, a few hundred tokens a task), behind a local stand-in for app.shinsa.dev on `PORT` (5195) whose start page links adding this device on each machine (each accepts it at once), the merged dashboard, Settings and pairing; the browser speaks the real sealed channel to each engine, and only GitHub sign-in and the tunnel are stood in for. Each start reseeds `/tmp/shinsa-remote-preview-<port>` (`SHINSA_REMOTE_PREVIEW_DIR`) with new keys |
| `bun run seed` | Seeded state to look at: writes `~/.shinsa-seed` (`SHINSA_SEED_DIR` overrides it) and prints the command that serves it under `SHINSA_INSPECT`; `SHINSA_SEED_SESSION` (a Claude session `.jsonl`) replaces one task's synthetic transcript; `bun scripts/seed-media/generate.ts [origin]` renders its screenshots and recording again (Chromium and ffmpeg) |
| `gh workflow run release.yml -f channel=beta -f bump=minor` | A release of the Mac app (Actions → Release): channel `stable` or `beta`, bump `patch`, `minor` or `major` of the last stable version; every merge to `main` that passes the Test workflow also publishes a canary (`X.Y.Z-canary.N`, for Shinsa's Canary update channel, `shinsa.dev/download/canary`); the version scheme, the update channels and the signing secrets are `docs/release.md` |
| `bun scripts/screenshots/readme.ts` | The README's two screenshots, `.github/assets/shinsa-light.png` and `shinsa-dark.png`, taken again from the real Mac app: seeds `/tmp/shinsa-shots` (`SHINSA_SHOTS_DIR`), serves it in inspect mode on a free port with the web app built there, opens the dev app (`apps/desktop`, `scripts/dev.ts`) on it at 1000 × 700, switches its `nativeTheme` through the main process's inspector (so the page, the traffic lights and the window edge follow, and the system's appearance stays), and captures the window of the process it started with its shadow (`screencapture -l`, the window id from `windows.swift`), shrunk by `pngquant` when installed. It focuses the window for a moment, restores the dev app's `prefs.json` and stops everything it started |

Everything Shinsa keeps lives in `~/.config/shinsa` (`$XDG_CONFIG_HOME/shinsa`): `config.json`, the Claude accounts
and `data/`; the Mac app's engine runs on 7446 (`APP_IDENTITY`, `port` in `config.json` changes it), on every update channel. `docs/engine.md` → Configuration and data has the layout, the overrides (`SHINSA_HOME`,
`SHINSA_DATA_DIR`, `SHINSA_INSPECT` for looking at seeded state) and the split between `config.json` and the event
log. Use a scratch directory when testing: `SHINSA_HOME=/tmp/shinsa-dev bun --cwd apps/engine start`.

## Key conventions

- **No comments.** Names and structure carry the meaning; the reasons live here and in `docs/`. `bun lint:conventions` enforces it (`biome-ignore` and `@ts-` are allowed; `packages/ui`, a reusable kit, is exempt).
- **The verb catalog**: `find*` throws, `select*` returns null, `list*`, `count*`, `resolve*` derives, `create*`/`update*`, `upsert*`/`write*`/`replace*`, `remove*`, `assert*`, `serialize*`, `request*`/`sync*`/`apply*`/`record*`. No `get*`, `fetch*`, `load*`, `set*`, `delete*`, `destroy*` (lint-enforced). The `conventions` skill has the examples.
- **Skills** (`.claude/skills`): `conventions` is the pattern catalog, load it before writing code; `review` is the method for a cleanup or review pass (scope the diff, prove every finding by reverting its fix); `copy` for any string a person or an agent reads; `design` for UI.
- **`packages/core` stays pure**: no `node:*`, no Bun, no I/O (Biome bans the imports). New behaviour is a command, events and effects there, and the I/O for the effect in `apps/engine`.
- **Icons** are Central Icons through `<Icon name='Icon…' />` (`@shinsa/ui/components/icon`); run `bun run --cwd packages/ui generate:icons` after using a new name. Primitives size their icons; don't pass a size inside a Button, Badge, tab or menu row.
- **UI copy** follows the `copy` skill: sentence case, full sentences, no em dashes, plain professional words (task, review, workspace), never playful labels (the two layout names in `LAYOUT_NAMES`, Desk and Shelf, are names chosen on purpose, each with a plain hint line).
- **Desktop first, responsive.** Screens are built for a full desktop window and must still work in an ~900px
  floating window. Cards is the default layout (no rail, centred pages, a "3 need you" button opens the queue;
  on screen its name comes from `LAYOUT_NAMES`, Desk, and Sidebar's is Shelf);
  Sidebar, picked in Settings → Appearance, adds a permanent rail that moves into a sheet below `md`.
- **One keyboard shortcut, and the Code tab's, Review tab's and Terminal page's own.** ⌘K (Ctrl K) opens the command
  menu; nothing else is bound to a key, except that the Code tab binds ⌘P, ⇧⌘F, ⌘F and ⌘G, the Review tab J and K and
  the Terminal page ⌘T and ⌘W while they are open, and a focused terminal keeps a Mac terminal's own keys
  (`docs/design.md`, Where Shinsa differs, 14, 32, 34 and 37; `bun lint:conventions` enforces it).
- **The design system is paywall-next's**, on Buzzkit's kit in `packages/ui` (`docs/design.md` → Where Shinsa
  differs, which wins). One blue accent (`primary`) for the primary button, links, selection and checkmarks; `success`,
  `warning`, `destructive` and `info` carry state only.
- Ternaries never wrap an awaited call; multi-line arrows get a block; no single-use constants; `.catch(() => undefined)` is not allowed.

**Docs ship in the same change as the behaviour, or the change is not done.**

## Git

Agents working on this repo never commit or push; the user reviews and commits. Commit messages are conventional commits, one subject line, nothing else.
