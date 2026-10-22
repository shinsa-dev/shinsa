# @shinsa/server

The local server and the `shinsa` command. Everything with I/O lives here; every decision lives in `@shinsa/core`.
One package on purpose: `shinsa serve` is the server, and the client commands are a hundred lines of HTTP calls
that share its config and types, so a separate `apps/cli` would only add a workspace to keep in step.

## Layout

```
src/
├── main.ts              The `shinsa` binary: argv → cli/ (the only file outside coverage; test/main.test.ts runs it)
├── serve.ts             startShinsa: wires the pieces, recovers in-flight work, returns { url, engine, stop }
├── cli/                 index.ts routes the commands; commands.ts do / import / status / open; api.ts the HTTP
│                        client; session.ts reads a Claude Code session for `shinsa import`
├── config/              ServerConfig from the environment (every SHINSA_* variable is read here, except SHINSA_QUICK)
├── log/                 One JSON line per entry; describeError and redactSecrets (URL credentials, GitHub and
│                        Anthropic tokens never reach a log, a failure gate or the event log)
├── shell/               runCommand: argv only (never a shell string), its own process group, a timeout that kills
│                        the whole group, and a failed result (not a throw) when the program is missing
├── store/               EventLog (the SQLite events and effects tables) and EvidenceStore (files under /api/evidence)
├── runtime/             Engine (serialised dispatch → decide → commit → apply → broadcast, the effect pump) and
│                        EffectRunner (one handler per ShinsaEffect, the pull request watcher)
├── agents/              RunSupervisor (supervisor.ts), hand-over checks and evidence (handover.ts), RunClock (clock.ts)
│   ├── claude/          The Claude Agent SDK session, the PreToolUse guard, the recorder, the chat mapping, imports
│   ├── tools/           The `shinsa` MCP server and the tool schemas (specs.ts)
│   ├── transcripts/     Per-run JSONL transcripts, live listeners, tailing a file another writer appends to
│   ├── quick/           One-shot Haiku calls (triage, briefing), thinking off
│   └── models/          The model catalog from the SDK, with the built-in list as fallback
├── git/                 refs (assertRefName, slugify), repo, worktree, commit, diff
├── github/              `gh` for pull requests: read, create, retarget, merge
├── checks/              The repository's check commands
├── repos/               Finds repositories on the machine, registers one on first use, names its area
├── triage/              Title, repository, size, branch and dependencies for a new task
├── briefing/            The Home guide, debounced
└── http/                server.ts (Bun.serve), guard.ts (Host / Origin / content type), routes.ts, socket.ts,
                         static.ts, paths.ts (resolveInside)
```

`test/` mirrors `src/` folder for folder. `test/e2e/` runs the whole server against scripted agents; `test/live/smoke.ts`
(`bun run test:live`) uses real Claude agents and costs tokens, so it is never part of `bun test`.

## Rules

- **Effects report back as commands.** An effect never writes state; it dispatches `run.end`, `pull_request.record`,
  `effect.fail` and so on. A failing effect is retried with backoff and becomes a `failure` gate once it gives up
  (`EffectRunner.reportExhausted`), never a silent log line.
- **The HTTP surface is for this machine only.** `http/guard.ts` refuses a Host that is not loopback, `SHINSA_HOST` or
  `SHINSA_ALLOWED_HOSTS` (DNS rebinding), any Origin or `Sec-Fetch-Site: cross-site` from another site, a POST that is
  not `application/json` (so no cross-site form or `text/plain` post is ever "simple"), and a WebSocket without an
  Origin. Only the `UserCommand` types in `routes.ts` are accepted from outside; files are read through
  `resolveInside` (real paths, so a symlink cannot leave the worktree) and evidence by plain name only.
- **Nothing reaches git or gh as an option.** Branch names pass `assertRefName` (no leading `-`, no `..`), fetches put
  `--` before the ref, `gh api` gets strings with `-f`, and the merge method is checked against the known three.
- **Agent runs are unattended**: `bypassPermissions`, the user's `claude` binary, user/project/local settings, the
  plugin in `plugin/`, and the PreToolUse guard in `agents/claude/guard.ts`. Planner and reviewer runs cannot edit
  files; anything they change anyway is stashed.
- **One agent at a time in a worktree.** `RunSupervisor` registers a run before it waits, and a run waits only for the
  runs of its task that registered before it (60 s, then they are cancelled). Checks and pushes wait for all of them.
- **The two-hour clock stops while a question is open**, counted per question, so parallel `ask` calls cannot
  double-count the pause or leave a stray timer.
- **Restart safety**: `RunSupervisor.recover` resumes runs that have a session id with "continue where you left off",
  starts the others again and skips runs waiting on a question (the answer restarts them); unfinished `task.triage` and `worktree.create` effects run again from the outbox, and
  `EffectRunner.recover` syncs every pull request in flight. Effect keys are unique even for a command that emits
  effects but no events (`EventLog.commit`).
- **Hand-overs are validated here** (`agents/handover.ts`, `assertProtocol`): a spec, report or findings list that
  breaks the protocol is returned to the agent as a tool error listing every problem, and nothing reaches the event
  log. Evidence paths are read relative to the worktree; evidence URLs must be http or https.
- **The diff never touches the worktree's index**: `resolveTaskDiff` adds intent-to-add entries to a copy of it, so a
  diff request cannot collide with an agent's own git commands.
- Agents already hand work over through MCP tools; `shinsa do` exists for an agent working outside Shinsa (in the
  user's own Claude Code session) to hand work in. A CLI that marks steps complete would bypass the run binding and
  the protocol checks, so there is none.
- **Tests need no network and no real agents.** `test/helpers/preload.ts` gives every test a clean git identity, the
  fake `gh` and `open` on `PATH` and `SHINSA_QUICK=off`. Inject fakes through the optional last parameters
  (`startSession`, `triage`, `resolveLogin`, `ask`, `runQuery`, `launch`); `bun run test` fails below 100% line and
  function coverage.
- Never edit `SHINSA_DATA_DIR` while the server runs.
