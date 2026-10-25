# @shinsa/server

The local server and the `shinsa` command. Everything with I/O lives here; every decision lives in `@shinsa/core`.
One package on purpose: `shinsa serve` is the server, and the client commands are a hundred lines of HTTP calls
that share its config and types, so a separate `apps/cli` would only add a workspace to keep in step. How the
engine behaves (receipts, the outbox, the pull request watch, providers, the agent loop, accounts, schedules,
restarts) is `docs/engine.md`; this file is where things live and the rules for writing code here.

## Layout

```
src/
├── main.ts              The `shinsa` binary: argv → cli/ (the only file outside coverage; test/main.test.ts runs it)
├── serve.ts             startShinsa: takes the data directory's lock (not in inspect mode, which is read-only and
│                        starts nothing), wires the pieces, recovers in-flight work, returns { url, engine, stop }
├── cli/                 index.ts routes the commands (`serve` reads the login shell's environment first unless
│                        started from a terminal, and exits 0 when the service finds the lock held); commands.ts
│                        do / import / status / open; surface.ts every `shinsa <group> <action>` (help, --json, the
│                        idempotency key, the service control for `shinsa service`); api.ts the HTTP client and
│                        the surface client; session.ts reads a Claude Code session for `shinsa import`
├── instance/            Which Shinsa this is and the one-server rule (docs/engine.md → Configuration and data):
│                        install.ts (version, commit, install path, the server entry, resolveHealth for
│                        /api/health), lock.ts (data/serve.lock: atomic create, the live-holder check, takeover,
│                        ServerRunningError naming the holder), inspect.ts (the `inspect_read_only` refusal every
│                        command gets under SHINSA_INSPECT)
├── service/             `shinsa service`: the macOS LaunchAgent (launchd.ts: the plist, reading `launchctl print`)
│                        and ServiceControl (index.ts: install, uninstall, status, restart, logs over `launchctl`;
│                        SERVICE_MARKER, the `SHINSA_SERVICE=1` the plist sets, and isStartedByService)
├── surface/             Everything you can do, as specs both the command line and every task agent's management
│                        tools are generated from (docs/engine.md → The command surface, docs/cli.md): fields.ts
│                        (argv, MCP schemas and tool input), spec.ts (defineCommand / defineRead / defineAction),
│                        resolve.ts (task, account, repository and project references), client.ts (SurfaceClient,
│                        the seam the command line and the management tools both run through), one file per group
│                        (tasks, gates, work, schedules, config: projects and focus, extensions: mcp, skills and
│                        plugins, system, service: the background service, through `SurfaceClient.service`),
│                        index.ts (SURFACE, listAgentSpecs, listUncoveredCommands, help text, the docs/cli.md
│                        reference)
├── config/              paths.ts (where ~/.config/shinsa, config.json and data/ are), file.ts (config.json: read
│                        leniently, written atomically, ConfigStore), index.ts (ServerConfig from the environment and config.json; every SHINSA_*
│                        variable is read here, except SHINSA_QUICK and SHINSA_SERVICE (service/); prepareDataDir)
├── log/                 One JSON line per entry; describeError and redactSecrets (URL credentials, GitHub and
│                        Anthropic tokens never reach a log, a failure gate or the event log)
├── shell/               runCommand: argv only (never a shell string), its own process group, a timeout that kills
│                        the whole group, and a failed result (not a throw) when the program is missing; login.ts
│                        reads the login shell's environment once (`-lic`, then `-lc` when that prints nothing, plus
│                        `fish -lc` when the interactive shell handed off to fish) and
│                        merges it into the server's, and
│                        isStartedFromTerminal (a TTY on stdin or stdout) decides whether `serve` needs it
├── store/               EventLog (event-log.ts: the SQLite events, effects and receipts tables; readEvents reports a
│                        damaged row instead of throwing) and EvidenceStore (evidence.ts: files under /api/evidence)
├── runtime/             Engine (engine.ts: serialised dispatch → receipt → decide → commit → apply → broadcast, the
│                        effect pump, cancellation, settle), EffectRunner (effects.ts: one handler per
│                        ShinsaEffect, the pull request watcher), StateClock (clock.ts: the
│                        base of every timer that fires from state) and MonitorClock (monitors.ts)
├── agents/              RunSupervisor (supervisor.ts: the run loop, and where each run works: the worktree, the
│   │                    repository, or data/scratch/<task> for a task with no repository, resolveScratchPath in
│   │                    config/paths.ts, removed by the scratch.remove effect once the task settles), the live state of a run (active.ts), resume or
│   │                    hand over per turn, the house rules only to a session without them and the round's
│   │                    whole brief to an agent session that may not hold the round (turns.ts), the
│   │                    tool calls (tool-calls.ts), questions and their waiters (questions.ts), idle release
│   │                    (idle.ts), delegated reports in and out of a turn (deliveries.ts, delegations.ts), the
│   │                    account seam: leases and rejections (accounts.ts), idle
│   │                    compaction (compaction.ts), quiet runs (silence.ts), hand-over checks and evidence
│   │                    (handover.ts), RunClock (clock.ts), the commands no agent may run (policy.ts: also the
│   │                    human-only `shinsa` commands, read from the surface), what `read_task` reads (reading.ts),
│   │                    the other open work in a task's repository and the files two tasks both change
│   │                    (repository-work.ts: `list_repository_work` and task.record_overlaps before a hand-over),
│   │                    the MCP servers and skills each session last ran with, its pin (extension-sets.ts)
│   ├── manage/          The surface as every task agent's tools (docs/engine.md → Agents manage Shinsa): tools.ts
│   │                    (one tool per spec but the human-only ones and those with an `agentTool`, such as
│   │                    `tasks create`, whose agent files a task with `create_task`), client.ts (reads over HTTP, commands through
│   │                    the server's router on your behalf with byTask, so a message is classified; adding a
│   │                    repository or folder to a project runs in process through the project changes);
│   │                    ManageAccess ({ baseUrl, projects, route }) is what serve.ts hands the supervisor as `manage`
│   ├── providers/       types.ts (AgentProvider, capabilities, AgentSession), index.ts (ProviderRegistry),
│   │                    instructions.ts (what every session is told about Shinsa and its skills), versions.ts
│   │                    (reading and comparing a program's version)
│   │   └── claude/      The Claude Agent SDK provider: the session (session.ts: prompt ids, steering), result
│   │                    classification (classify.ts), the user's `claude` (executable.ts), the SDK runtime (sdk.ts),
│   │                    session files (artifacts.ts), the PreToolUse guard (guard.ts), the recorder (recorder.ts: the
│   │                    chat mapping in map.ts, notices), usage and the cache lifetime (usage.ts, context.ts),
│   │                    session import (import.ts), one-shot and structured completion (complete.ts), the model
│   │                    catalog (models.ts), the prompt queue the SDK reads from (async-queue.ts), the MCP servers
│   │                    and skills a run loads (extensions.ts), the route to the API per compaction setting: eunoe
│   │                    or direct, and the fallback notice (route.ts)
│   │   └── codex/       The `codex app-server` provider: the JSON-RPC client (client.ts), the session (session.ts:
│   │                    turns, steering, the agents Codex starts, compaction), the chat mapping (map.ts), failure
│   │                    classes (classify.ts), the HTTP MCP endpoint (mcp.ts), the price table and what a turn costs
│   │                    (pricing.ts, meter.ts), usage windows read like CodexBar and fast mode credits (usage.ts),
│   │                    one-shot calls (complete.ts), models, sign-in, executable, MCP servers and skills
│   │                    (extensions.ts)
│   ├── tools/           The `shinsa` MCP server (index.ts: an MCP `Server` each provider exposes its own way) and the
│   │                    tool schemas (specs.ts, schema.ts): hand-over and process tools (process.ts), the hand-overs
│   │                    of each task shape: answer, report_diagnosis, submit_report, report_outcome, reshape_task
│   │                    (shapes.ts), delegation and couriers (orchestration.ts), schedules (schedules.ts). The plan
│   │                    parameters in `propose_plan` (verification, impact, evidence, checks, approval) and the
│   │                    steps `reshape_task` offers are generated from core's VERIFICATION_RULES, PROTOCOL_LIMITS,
│   │                    PLAN_EVIDENCE_KINDS and STEP_SCHEMA, never hand-written
│   ├── transcripts/     Per-run JSONL transcripts, live listeners, tailing a file another writer appends to
│   └── quick/           One-shot calls (triage, briefing, the setup chat) on the classifier and writer models:
│                        structured output with a fallback across the registry's providers, the default one
│                        first (index.ts, createQuickCalls), the typed decision questions (decide.ts: choice and
│                        choices) triage, the briefing and the setup chat answer
├── accounts/            Claude accounts and usage limits: store.ts (accounts.json, one CLAUDE_CONFIG_DIR per
│                        account, shared entries linked), paths.ts (folders, the Claude config dir and
│                        resolveAccountEnv, the environment every command for an account runs with), login.ts
│                        (`claude auth login` in a PTY), status.ts, credentials.ts (the keychain entry per folder),
│                        usage.ts and limits.ts (reading and caching usage), rotation.ts (leases, the spent marks in
│                        account-marks.json and the one retry budget; the picker itself is core's `pickAccount`),
│                        imports.ts and cswap.ts (imports), patch.ts (an account's settings from the API),
│                        resume.ts (the usage-wait clock), routes.ts (/api/accounts), index.ts (the Accounts
│                        service: sign-ins, snapshot, notices, the weekly reading a run is charged against)
├── eunoe/               The eunoe proxy Shinsa runs for its Claude sessions: proxy.ts (EunoeProxy: start on a port
│                        of its own in data/eunoe, config.json, health, adopt an orphan, stop; resolveEunoeCommand),
│                        requests.ts (tails eunoe's request log into compaction notices per session)
├── schedules/           Schedules: the clock (clock.ts), the agent tools (tools.ts), the webhook receiver
│                        (webhook.ts), signature checks (verify.ts), the prompt template and redaction (template.ts),
│                        the routes for the webhook URL and secrets (routes.ts), the Schedules service (index.ts)
├── secrets/             SecretStore (store.ts): secrets.json, webhook tokens and signing secrets, one-use secret refs,
│                        MCP sign-ins
├── extensions/          MCP servers, plugins and skills (docs/engine.md → MCP servers, plugins and skills): what
│                        Claude Code, Codex, plugins and repositories set up (discover.ts, definitions.ts, skills.ts,
│                        plugins.ts), one row per server however many places define it (catalog.ts),
│                        extensions.json (store.ts), checking and redacting what you send (input.ts), health checks
│                        and the MCP client (health.ts), sign-in (oauth.ts, and sign-in.ts: the callback page),
│                        when agents last used each server and skill (usage.ts: Claude Code sessions and Shinsa's
│                        transcripts, read incrementally), what a run loads and leaves out and what it is told about
│                        it (session.ts), loading what the context optimizer left out mid-run, by any name
│                        (loader.ts), /api/extensions (routes.ts), the Extensions service (index.ts)
├── versions/            The agent programs' versions and their updates (docs/engine.md → Versions and updates):
│                        the latest from the npm registry (registry.ts), each program's own updater, found from
│                        where its binary lives (updaters.ts), /api/versions with the streamed update
│                        (routes.ts), the Versions service: snapshot, the 3-hour cache, updates (index.ts)
├── git/                 refs (assertRefName, slugify), repo, worktree, commit, diff, isolation.ts (detached
│                        checkouts for isolated delegations), run.ts (git writes that wait out another process's
│                        index.lock); the Code tab's reads: read.ts (readGit: raw bytes, a 5 s timeout, a byte or line cap,
│                        each chunk as it comes, the request's abort, literal pathspecs), files.ts (paths, a folder, a file at a commit or in
│                        the working copy, `git grep` with case folded into the pattern and its matches streamed), task-refs.ts (a task's head, base and commits, also once its
│                        worktree is gone), objects.ts (ObjectCache, the 64 MB cache of what a commit addresses),
│                        diff.ts (commit to commit, and the working copy against a base: the file list from
│                        `--raw --numstat`, the patches of the small files only, or of the files named), changed-files.ts (the
│                        files a task's branch committed since its base plus what its checkout has not committed)
├── workspaces/          Where agents work (docs/engine.md → Where agents work): one WorkspaceStrategy per mode
│                        (types.ts: prepare, claim, commit, push, remove, writeEdit, listConflicted, update: `but
│                        pull` for GitButler only), worktrees.ts,
│                        main-checkout.ts and gitbutler.ts (a branch per task through `but`, one writing agent at a
│                        time, stacked on another task's branch when its commit needs that branch's lines, taken out
│                        of its stack before it is unapplied, never pushed while a commit on it is conflicted:
│                        ConflictedBranchError), but.ts (the
│                        `but` runner, isGitButlerWorkspace), ledger.ts (which uncommitted paths are whose, in
│                        data/workspaces/), lock.ts (WorkspaceLock), index.ts (Workspaces.resolve, the setup check's
│                        describeWorkspaceProblem, listWorkspaceSupport for GET /api/repos/workspaces)
├── github/              `gh` for pull requests: read (the view with the merge commit, then one GraphQL read for
│                        checks, comments, threads, the reader and the merge queue), create, retarget, merge
├── checks/              The repository's check commands, then the plan's own `checks`, each run the same way
│                        (`sh -c` in the worktree, one timeout, the result named by its command; a repeat runs once)
├── repos/               Finds repositories in the chosen folders, registers one on first use in its project, or
│                        names a new project after its GitHub owner (index.ts); discover.ts (scans the home folder for the folders that hold repositories),
│                        roots.ts (chosen folders, SHINSA_ROOTS, or discovery until onboarding is done), setup.ts
│                        (setup verification before a task's first agent)
├── onboarding/          Status, folder suggestions, saving the setup (index.ts, roots.ts), the prerequisite checks
│                        (prerequisites.ts: git, gh, claude, bun, and codex and its sign-in as optional), the setup
│                        chat: the fixed questions (questions.ts),
│                        the conversation, its saved state and the follow-up the writer model writes for an unclear
│                        answer (chat.ts), reading an answer without the model (answers.ts: yes or no, a skip, an
│                        option by name), the Claude accounts it offers (accounts.ts)
├── projects/            routes.ts: GET /api/repos/local (repositories in the chosen folders and every project's
│                        folders, registered or not), POST /api/projects/<id>/repos and /folders, and
│                        createProjectChanges, which those routes and the management client share; folders.ts
│                        (resolving a folder you add)
├── triage/              Title, repository (or none), size, branch and dependencies for a new task, and the parts the human left
│                        to Shinsa (Auto): its shape, priority and dependencies, each with a reason. A task in a
│                        project chooses among that project's repositories, each named with its path, plus any outside
│                        it the request names (resolveCandidatePool); repositories are listed by name, never by recent
│                        use; resolveRepoProject files a repository triage registers. message.ts:
│                        the message classifier (nothing to do, feedback or a follow-up, a new round with its kind of
│                        work, or another task, as a typed decision read against each round's outcome) and
│                        routeUserCommand, which the socket and POST /api/commands send every command through: your
│                        message is accepted into the task's inbox at once (message.receive) and inbox.ts
│                        (MessageInbox) classifies and routes it after, in order; the receipt is taken over the
│                        command as sent; createCommandRouter, the same route for an agent's management commands,
│                        which classifies before it dispatches; a new round or a kept suggestion that names no kind
│                        of task is shaped first (resolveRoundShape); resolveRoundRepository finds the repository a
│                        task with none needs once its work needs one (the setup check calls it)
├── briefing/            The Home guide, debounced
└── http/                server.ts (Bun.serve), guard.ts (Host / Origin / content type), body.ts (JSON bodies),
                         routes.ts, reads.ts (the read endpoints the command line and the agents use), socket.ts,
                         static.ts, paths.ts (resolveInside, resolveWritableInside, assertRepoPath), code.ts (the
                         Code tab's routes: refs, paths, tree, blob, raw images, search and diff; a GitButler task's
                         working copy is the files it owns in the ledger, from disk, over its branch), edits.ts (POST
                         /api/tasks/<id>/file: saving a file you edit, against the text the editor expects on disk)
```

`test/` has one folder per source folder and a test file per module with behaviour of its own; a few modules are
covered through the module that drives them (for example `agents/policy.ts` through the guard, `runtime/clock.ts`
through the clocks built on it, `http/routes.ts` and `socket.ts` through `test/http/server.test.ts`).
`test/e2e/` runs the whole server against scripted agents; `test/e2e/soak.test.ts` kills a real `shinsa` process at
random points of a task's life; `test/http/fuzz.test.ts` throws malformed requests and socket messages at it.
`test/live/smoke.ts` (`bun run test:live`) uses real Claude agents and costs tokens, so it is never part of
`bun test`. `docs/engine.md` → Testing says what each suite covers.

## Rules

- **Effects report back as commands.** An effect never writes state; it dispatches `run.end`, `pull_request.record`,
  `effect.fail` and so on. One that gives up becomes a failure gate when its kind has one, never a silent log line
  (`docs/engine.md` → Guarantees).
- **Every command the server sends gets a fixed id from its cause** (`Engine.dispatch(command, { id })`), unique for
  distinct causes and identical for a repeat, naming everything the decision depends on; the list is
  `docs/engine.md` → Command receipts → Deterministic server ids.
- **Timers that fire from state extend `StateClock`** (`runtime/clock.ts`; `MonitorClock`, `ScheduleClock`,
  `UsageResumeClock`). The subclass lists what is due (`listEntries`); the base keeps one timer for the earliest,
  re-arms on every state change, fires each due entry once at a time, and skips an entry core refused with a
  `DomainError`, or answered with no events (`refuse`), until it leaves `listEntries`, so a refused or no-op command
  is never sent again and again.
- **Effects can be cancelled.** A running effect's `context.signal` aborts when a decision cancels it or the server
  stops. A handler that does outside work checks the signal before the step it must not take after a cancel (a merge,
  a push, opening a pull request) and passes it to the commands it runs (checks, `git push`, `gh`).
- **Effects that touch the outside world must be safe to run twice** (a worktree is reused, an open pull request is
  reused, a merge reads GitHub first): replay-safe effects run again after a crash (`docs/engine.md` → Recovery).
- **Rounds share the task's worktree and push where their round says** (`docs/engine.md` → Rounds): a later round's
  worktree is never reset to the default branch (only its uncommitted scratch edits are dropped), a push goes to the
  task's branch, which a stacked round has changed to its own, a pull request opens on the round's base
  (`resolveRoundBase`), and a merge merges the stack below the task's pull request top down
  (`listStackedPullRequests`), reading each first.
- **The pull request watch reads, core decides**: the server dispatches a read only when `evaluatePullRequestWatch`
  (core) says it matters, and syncs of one task queue behind each other (`docs/engine.md` → The pull request watch).
- **The HTTP surface is for this machine only.** Every route goes through `http/guard.ts` (what it checks, and the
  routes that skip part of it, are `docs/engine.md` → Who can change Shinsa). `parseUserCommand` (core) is the single
  gate for commands from outside: it accepts only `UserCommand` types and checks each field by field; never add an
  allowlist of your own. A socket message needs a string `id` or `runId`; request bodies are capped at 8 MB and read as
  JSON through `http/body.ts`; files are read through `resolveInside` (real paths, so a symlink cannot leave the
  worktree) and evidence by plain name only.
- **Human-only decisions have no agent path**: a `humanOnly` spec is left out of the agents' tools
  (`listAgentSpecs`) and its `shinsa` command is refused in an agent's shell (`agents/policy.ts`), and so are
  `shinsa settings set` naming one of core's `HUMAN_ONLY_SETTINGS` and `shinsa repos update` changing the checks;
  which decisions those are is `docs/engine.md` → Who can change Shinsa. Core refuses them on your behalf as well. There are no keys, codes or cookies and no per-caller routes;
  never add one, since an agent's shell reads whatever the user can.
- **Nothing reaches git or gh as an option.** Branch names pass `assertRefName` (no leading `-`, no `..`), fetches put
  `--` before the ref, `gh api` gets strings with `-f`, and the merge method is checked against core's
  `MERGE_METHODS`.
- **Agent runs are unattended**: `bypassPermissions`, the user's `claude` binary, user/project/local settings, the
  plugin in `plugin/`, the MCP servers, skills and plugins Settings → Integrations has on (`extensions/`; a provider
  never reads MCP config on its own, Claude runs with `strictMcpConfig`), and the PreToolUse guard in
  `agents/providers/claude/guard.ts`. The rules themselves are in
  `agents/policy.ts`, so every provider enforces the same ones; a run is read-only by core's `isReadOnlyRun` (a
  read-only role, or the task's agent while it plans), which reaches the provider as `AgentSessionInput.readOnly`.
- **One session per task, two kinds of access.** The task's agent plans, builds every phase, fixes, runs the
  operation and answers, investigates or researches in later rounds as separate runs on one resumed session, so its
  access changes between turns without changing its prompt-cache prefix (`docs/engine.md` → Caching): Claude keeps
  the same tools and system prompt for every turn of the task's session (`excludeDynamicSections` and `snapshot` on
  the preset) and, while a turn only reads, denies `Edit`, `Write`, `NotebookEdit` and `MultiEdit` through a
  PreToolUse hook (`listReadOnlyHooks` in `guard.ts`, one matcher per tool, naming the turn's hand-over), never
  through `permissionMode: 'plan'` or `disallowedTools`, which only the reviewer and delegated read-only roles get;
  Codex resumes the same thread in the `read-only` sandbox (`approvalPolicy: never`) to plan and with
  `danger-full-access` and `untrusted` to build. A resumed turn in another directory than the session's last one
  (a round after a merge, an answer in the repository) is told where it works now (`resolveMovedNote`, from
  `run.attempt`'s `cwd`).
- **Where a run works follows its role** (`#resolveCwd` in `agents/supervisor.ts`): the answerer in the repository
  itself, the researcher in the task's worktree when it has one and otherwise the repository, every other role in the
  task's worktree. Edits a read-only run leaves (the agent's while it plans included) are set aside, never in the
  repository itself: that is the human's own checkout. Setup verification asks for a default branch only when the
  pipeline needs a worktree and for check commands only when it builds (`runtime/effects.ts`); a worktree reused
  before any phase report is reset, which is how an investigation's scratch edits are dropped before its fix is
  planned.
- **One agent at a time in a worktree.** `RunSupervisor` registers a run before it waits, and a run waits only for the
  runs of its task that registered before it (60 s, then they are cancelled). Checks and pushes wait for all of them.
- **Workspaces go through their strategy.** Making, committing in, pushing and removing a task's checkout goes through
  `Workspaces.resolve(task)` (`workspaces/`), never through `git/` directly, and every place shares the one
  `Workspaces` the supervisor owns (`runs.workspaces`), since the GitButler claim and ledger live in it. A run that
  can write claims its task's checkout before its session starts (`#claimWorkspace`); only GitButler makes it wait.
  Nothing Shinsa runs in a GitButler workspace may `git commit` or switch its branch: that takes it out of GitButler.
- **The two-hour clock stops while a question is open**, counted per question, so parallel `ask` calls cannot
  double-count the pause or leave a stray timer.
- **Shutdown order.** `stop()` interrupts every live run first (`RunSupervisor.interruptForShutdown`), then stops
  the pull request syncs, the clocks and every running effect, and waits for them and for every running effect
  handler (`Engine.settle`) before it closes
  the log, so no `claude`, check or `gh` outlives the server (`docs/engine.md` → The agent loop → Restart
  continuation). The eunoe proxy stops after the effects, once no `claude` can still talk to it. Anything new that
  starts a process or a timer is stopped there too.
- **Hand-overs are validated here** (`agents/handover.ts`, `assertProtocol`): a plan, report or findings list that
  breaks the protocol is returned to the agent as a tool error listing every problem, and nothing reaches the event
  log. An evidence path is absolute or relative to the worktree; evidence URLs must be http or https.
- **Code reads are pinned and confined** (`http/code.ts`, `docs/engine.md` → The Code tab's reads): only the task's
  registered repository, a ref is a full commit id the repository has or `working`, paths are relative with no `.`
  or `..` segment and pass git as literal pathspecs after `--`, working-copy reads go through `resolveInside`, and
  every read has a timeout and a size cap. A read named by a commit is immutable (`ETag`, a year's cache, the
  ObjectCache); the working copy is never cached.
- **The diff never touches the worktree's index**: `resolveWorkingDiff` adds intent-to-add entries to a copy of it, so a
  diff request cannot collide with an agent's own git commands. The copy keeps the index's modification time: git
  only re-reads a file whose size and time match the index when the entry is as new as the index itself ("racy git"),
  and a copy with a fresh time would hide an edit of the same size made in the same second.
- **A plan's rules come back to the agent as the tool error.** `propose_plan`, `reshape_task` and the last
  `complete_phase` dispatch straight to the engine, so a `plan_invalid`, `pipeline_invalid` or `evidence_missing`
  refusal from core reaches the agent as the tool's error with every problem in it, and the run carries on. The
  agent composes steps and sets plan parameters; there is no command, for an agent or for you, that adds a step
  or a gate, and no user command reshapes a task.
- Agents already hand work over through MCP tools; `shinsa do` exists for an agent working outside Shinsa (in the
  user's own Claude Code session) to hand work in. A CLI that marks steps complete would bypass the run binding and
  the protocol checks, so there is none: the command line does what you can do, never what a task agent hands over.
- **The surface is the one list.** A new user command gets a spec in `src/surface/` (the test that every command
  has a command-line path fails until it does), and anything the web can do that is not a command gets a read
  route in `http/reads.ts` or its own route and a spec. The agents' management tools and `docs/cli.md` (`bun run
  docs:cli`, checked by a test) follow from the specs; never hand-write one.
- **Providers.** The supervisor never names a provider: it talks to one only through `AgentProvider`
  (`agents/providers/types.ts`) and branches on its `capabilities`, never on its id. A new provider is a folder under
  `agents/providers/` and one entry in the registry; the supervisor, tools, transcripts, handover and the web do not
  change. Account rotation and usage-limit resume hang off the supervisor's rejection seam (`onRejection`), which
  owns the only retry budget, not off the provider (`docs/engine.md` → Providers, The agent loop).
- **Machine config versus events**: a value replaying the log must reproduce is a `settings.change` event, one that
  only describes this machine is `config.json` (`docs/engine.md` → Configuration and data).
- Never edit the data directory while the server runs.
- **One server per data directory.** `startShinsa` takes `data/serve.lock` before anything opens the log and gives it
  back in `stop()` after the log is closed, or at once when the server cannot start listening. Code that starts a
  second engine on a data directory in one process (a test that simulates a restart) stops the first through
  `stop()`, or builds the pieces itself as `test/e2e/harness.ts` does.
- **Spawned programs inherit the server's environment**, which `shinsa serve` fills in from the login shell before
  anything starts; never read the shell profile again elsewhere, and pass a command's own variables through
  `runCommand`'s `env`.

## Testing

- **Tests need no network and no real agents.** `test/helpers/preload.ts` gives every test a clean git identity, the
  fake `gh`, `open` and `launchctl` on `PATH`, `SHINSA_QUICK=off`, a scratch `CLAUDE_CONFIG_DIR` and `SHELL` set to
  the fake login shell (`test/helpers/bin/login-shell`: `FAKE_LOGIN_SHELL_EXPORT` adds variables and a `PATH` entry,
  `FAKE_LOGIN_SHELL_HANG`, `FAKE_LOGIN_SHELL_SILENT` and `FAKE_LOGIN_SHELL_LOG` hang, fail or record the call,
  `FAKE_LOGIN_SHELL_EXEC_INTERACTIVE` prints nothing for `-lic`, as a `.zshrc` that execs fish does; a fake fish
  in `test/helpers/fish`, off the `PATH`, that `FAKE_FISH_SILENT` fails and `FAKE_FISH_LOG` records);
  `test/helpers/bin` also holds fake `claude`, `codex`, `cswap` and `eunoe` and a `but` that runs the real GitButler CLI
  with its own `HOME` (`FAKE_BUT_HOME`, so tests never touch your GitButler projects; `FAKE_BUT_MISSING` makes it
  missing; the GitButler tests need `but` installed) (every config's `eunoe.command`,
  `createConfigAt`), so no test runs the real ones, and nothing reaches the real launchd. `test/helpers/mcp` has an MCP server over HTTP (`http.ts`) and over stdio (`stdio-server.ts`). The Claude adapter takes a `ClaudeRuntime` (`runQuery`,
  `resolveExecutable`; `createFakeRuntime` in `test/helpers/query.ts`). Inject fakes through the optional last
  parameters (`startSession`, `providers`, `triage`, `resolveLogin`, `ask`, `runQuery`, `launch`, `discover`,
  `runPrerequisite`, `accounts`, `interpret`, `clarify`, `accountOptions`).
- **A test leaves no process running.** Every fake `gh`, `codex` and `eunoe` and the MCP stdio fake registers itself
  with the preload, and a test that ends with one still running fails (the stray is killed): stop and await the work that runs it (`await runner.stop()`,
  `engine.settle()`). The fake `gh` gives up on a state folder that is gone and breaks a lock its killed holder left
  behind.
- The fake `gh` answers `pr view` with a `mergeCommit`: the one a test puts on the pull request, or the head's sha
  once it merges one, so a test can follow a task past the merge (the operation gate shows that commit).
- **Tests wait on conditions, never on time.** Use `awaitEffect(log, key)` from `test/helpers` (keys come from
  `log.listEffectStatuses()`, or are fixed: `run.execute:<runId>`, `run.cancel:<runId>`), a deferred the fake
  resolves, `until(condition)` for another process or the file system, or `spyOn(log, …)` for a failure that is only
  logged. A `Bun.sleep` that decides whether a line runs makes the coverage floor fail on a busy machine.
- **A test file that starts the whole server** (`test/e2e/`) sets `setDefaultTimeout(30_000)`: alone it takes a
  second, but `bun run test` runs every workspace at once and Bun's own 5 s limit then fails it at random.
- **Scripted agents are keyed by what a run does**: `FakeAgents.queue` and `of` take the round agent's purpose
  (`plan`, `build`, `fix`, `operate`, read from the live run through `agents.state`, or from the prompt and the
  session's last step when no state is wired, as in the soak child) or any other role (`reviewer`, a delegated
  `planner` or `builder`); the fake `codex` picks its script the same way, `plan` by the read-only sandbox.
- `SHINSA_SETTLE_DELAY_MS` sets how long the watch waits before it reads a pull request Shinsa just pushed to or
  opened (15 s); tests set it low.
- `bun run test` fails below 100% line and function coverage (`bunfig.toml`).
