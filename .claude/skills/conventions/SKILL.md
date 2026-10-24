---
name: conventions
description: Shinsa code conventions — load before writing or reviewing code anywhere in this monorepo (packages/core, apps/server, apps/web, packages/ui). The verb catalog, where things live, the core's event-sourcing rules, tests and coverage, errors and logs, and readability style, with right/wrong examples. Complements the terse rules in CLAUDE.md.
---

# Shinsa conventions

`CLAUDE.md` carries the law; this skill carries the worked examples. When they disagree, `CLAUDE.md` wins, and fix the drift in the same change. For UI work also load `design`; for any string a person or an agent reads, load `copy`. Adapted from Buzzkit's `conventions`; when this is silent, do what Buzzkit does.

## Where things live

| Path | What it is |
|---|---|
| `packages/core` | Pure domain: one folder per concern under `src/` (`domain`, `agent-models`, `events`, `commands`, `effects`, `state`, `decide`, `accounts`, `costs`, `schedules`, `queue`, `briefing`, `report`, `chat`, `prompts`, `progress`, `protocol`). No `node:*`, no Bun, no I/O. See `packages/core/CLAUDE.md` |
| `apps/server` | All I/O: event log, effect runner, agent runs, git, GitHub, HTTP. Folder per concern; see `apps/server/CLAUDE.md` |
| `apps/web` | Renders server state, owns nothing. Every action is a `UserCommand` through `sendCommand`. `routes/`, `components/<domain>/`, `hooks/`, `lib/` (all non-JSX logic, 100% covered); see `apps/web/CLAUDE.md` |
| `packages/ui` | The design system. Reusable beyond Shinsa, imports nothing from the workspace |

- **A folder is a concern with an `index.ts` barrel.** Importers outside the folder use the barrel (`../state/index.ts`) or, inside one package where a barrel would cycle, the concrete file (`../state/queries.ts`). Files inside a folder import each other directly, never their own barrel. Packages import each other only by package name (`@shinsa/core`), never by path.
- **The package barrel is the contract.** Everything `packages/core/src/index.ts` exports stays importable by the same name. Moving a file is free; renaming or removing an export changes every consumer and needs their updates in the same change.
- **Tests follow `src/`**: one test folder per source folder and a test file per module with behaviour of its own (`packages/core/test/decide/gates.test.ts` ↔ `src/decide/gates.ts`); a module that only serves another is covered through it. Shared helpers live beside them (`test/harness.ts`, `test/briefing/fixtures.ts`), never in `src/`.
- **No single-use constants.** A value gets a name when it is reused or is a tunable (`MAX_STALLED_FIXES`, `ACTIVITY_LIMIT`). A lookup table (`Record<GateType, string>`) beats a `switch` that only returns strings.

## Function verbs — one catalog, no synonyms

| Verb | Contract |
|---|---|
| `find*` | one value, **throws** `DomainError` when absent (`findTask`) |
| `select*` | one value, returns `null` when absent (`selectTask`) |
| `list*` / `count*` | many values / a total |
| `resolve*` | derive a value: a queue, a label, a fallback (`resolveQueue`, `resolveModelLabel`) |
| `create*` / `update*` | plain writes; in core, `create*` also builds a fresh value (`createState`, `createSettings`) |
| `upsert*` / `write*` / `replace*` | idempotent writes |
| `remove*` | take something away |
| `assert*` | invariant check that throws, returns `void` |
| `serialize*` / `parse*` / `validate*` | to text or wire shape / from untrusted text / check a hand-over and return `{ ok, errors }` |
| `describe*` | a sentence for a person (`describeChecks`, `describeError`) |
| `request*` · `sync*` · `apply*` · `record*` | ask for an effect · reconcile with the outside · fold an event · store a fact reported from outside |
| `is*` / `has*` / `needs*` | boolean predicates |

Banned in `apps/server/src`, `apps/web/src` and `packages/core` (lint-enforced): `get*`, `fetch*`, `load*`, `set*`, `delete*`, `destroy*`.

**The `find*`/`select*` split is a contract callers rely on.** If you null-check the result it must be `select*`; if absence is an error it must be `find*`.

**The decider has its own vocabulary**, one verb per kind of step, so a reader can tell what a function does to a task without opening it: `start*` begins a step (`startPlanning`, `startFix`), `reactTo*` decides what a fact means (`reactToPullRequest`), `answer*` handles a gate, `settle*` ends a task, `retry*` restarts the current step, `open*` / `withdraw*` gates, `request*` asks for an effect (`requestPush`).

**Name collisions across folders are bugs.** If two folders need a helper with the same name and different behaviour (`quoteTitles` for the decider's curly quotes, `listQuotedTitles` for an agent prompt's straight ones), the names must differ. If an import needs an alias, the name is wrong.

## packages/core — decide, events, state

```ts
// right: a command handler validates, emits facts, and asks for effects
export function waitOnTasks(decider: Decider, command: CommandOf<'task.wait_on'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished.');
  changeDependencies(decider, task.id, resolveDependencies(decider, task, command.waitsOn), 'you');
}
```

```ts
// wrong: mutating state, reading the clock, doing I/O
export function waitOnTasks(state: ShinsaState, command: CommandOf<'task.wait_on'>) {
  state.tasks[command.taskId].waitsOn = command.waitsOn;
  state.tasks[command.taskId].updatedAt = Date.now();
}
```

- **State is the event log.** `decide` is pure given `now` and `newId`; it never mutates its input (the `Decider` works on a clone) and every change is an event folded by `applyEvent`. Replaying the log must rebuild the same state, so `applyEvent` reads only the event and the state before it, and never stores a shared constant by reference (`createSettings()`, not `DEFAULT_SETTINGS`).
- **Events are facts, past tense** (`task.staged`, `pull_request.push_requested`). Shinsa has never shipped, so it keeps no backwards compatibility: a renamed or removed event, field or value changes everywhere at once, with no reader for the old shape, no migration and no default that only an old log needs.
- **Commands are idempotent where the world can repeat them.** A system or agent command that arrives twice (a retried effect, a duplicate tool call) is a no-op the second time: `checks.record` outside `checking` is ignored, an `agent.ask` with a known gate id opens nothing, a write that changes nothing emits nothing.
- **Validation throws `DomainError(code, message)` before anything is emitted.** The code is `snake_case`; the message is a sentence the human or the agent can act on (`copy` skill).
- **Exhaustive switches over unions.** `decide`'s `apply` lists every command type; `applyEvent` every event type. Don't add a `default` that swallows a new member; let the type checker and `useExhaustiveSwitchCases` fail instead.
- **No dead branches.** If an invariant makes a branch unreachable (no decision gate can be open while an agent runs), delete the branch and let `test/decide/invariants.test.ts` hold the invariant. Code kept only for event logs from an older version is deleted.
- **The invariants** are listed in `packages/core/CLAUDE.md` and checked after every random command in `invariants.test.ts`. A change that needs to break one changes the invariant, its test and `docs/engine.md` together.

## Readability

1. **No comments.** Names and structure carry the meaning; the reasons live in `CLAUDE.md` and `docs/`. Only functional directives (`biome-ignore`, `@ts-expect-error`) are allowed (lint-enforced everywhere but `packages/ui`, a reusable kit that keeps Buzzkit's comments).
2. **Never wrap a call chain in a ternary.** Guards and early returns; ternaries are for small value picks.
3. **Multi-line arrow bodies get a block and an explicit `return`.** One-liners stay expressions.
4. **Blank lines separate phases in long functions only.** A guard and a return read as one unit.
5. **No dead parameters.** When an argument stops meaning anything (a `required = true` nobody passes), remove it.
6. **Narrow types, no `any`.** Untrusted input is `unknown` and narrowed once (`readField` in `briefing/parse.ts`, `Reader` in `report/validate.ts`); a cast is allowed only right after the runtime check that justifies it.

## Errors and logs (apps/server)

- One JSON line per log entry: `log.info/warn/error('[Area] Sentence', fields)` with every id in scope and `error: describeError(error)`. Never `console` outside `scripts/`.
- A `catch` rethrows, converts to a typed result, or logs with context. `.catch(() => undefined)` is a silent swallow and is not allowed.
- An effect never writes state: it reports back with a command (`effect.fail`, `pull_request.record`). An effect a task depends on that gives up becomes a failure gate (give its kind a title in `FAILURE_TITLE`), never just a log line.

## Tests and coverage

- All four packages (`packages/core`, `apps/server`, `apps/web`, `packages/ui`) enforce 100% line and function coverage in their `bunfig.toml`; `bun test` fails below it. The web leaves `.tsx` components out of the count and `packages/ui` its `components/` (they are checked by rendering, not by coverage); everything in `lib/` and `hooks/` counts. Coverage is the floor, not the goal: every test names a behaviour in its title and asserts what a person or an agent would see.
- A bug fix comes with the test that fails without it. Prove it: revert the fix, watch the test fail, restore.
- `decide` tests go through `createHarness()` with real commands (`test/harness.ts`: `reachReviewGate`, `reachShipping`, `pushFix`, `shipAndMerge`), never by building state by hand, except for state an older version could have written.
- When a test needs git, it creates a throwaway repository; in sandboxes set `GIT_CONFIG_GLOBAL` to a clean file.
- A test waits on a condition, never on time, and leaves no process or timer running (`apps/server/CLAUDE.md` → Testing has the tools).

## Docs — in the same change

A behaviour change updates `docs/engine.md` (core and server rules), `docs/spec.md` (what the product does), `docs/design.md` (UI) and the `CLAUDE.md` of every package it touches, in the same change. A settled pattern goes into `CLAUDE.md` or this skill.

## Before you finish

```sh
bunx biome check --write .     # lint, format, Grit plugins
bun lint                       # + comments ban, verb catalog, class checks
bun check-types
bun run test                   # every workspace, with the coverage floor
bunx knip                      # dead exports: run it after exporting anything
bun deps                       # dependency drift (sherif)
```

Other agents work in this tree. Check `git status --short`, leave their files alone, and say in your report which changes are yours.
