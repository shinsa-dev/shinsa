# @shinsa/engine

The engine and the `shinsa` command. Everything with I/O lives here; every decision lives in `@shinsa/core`.
One package on purpose: `shinsa engine` is the server, and the client commands are a few hundred lines of HTTP calls
that share its config and types, so a separate `apps/cli` would only add a workspace to keep in step. How the
engine behaves (receipts, the outbox, the pull request watch, providers, the agent loop, accounts, schedules,
restarts) is `docs/engine.md`; this file is where things live and the rules for writing code here.

## Layout

```
src/
├── main.ts              The `shinsa` binary from source: argv → cli/ (the only file outside coverage;
│                        test/main.test.ts runs it). The compiled bundle starts from scripts/engine-main.ts, the same
│                        plus `shinsa eunoe …`, which runs Eunoe from the one executable
├── serve.ts             startShinsa: one ManagedRuntime over the Serve layer, returns { url, engine, stop }; stop
│                        disposes the runtime, and a start that fails disposes it too
├── serve/               service.ts (Serve: takes the data directory's lock as the scoped ServeLock layer, not in
│                        inspect mode, which is read-only and starts nothing; opens the log, wires the pieces, listens,
│                        recovers in-flight work; each step a finalizer, so closing the scope runs the shutdown order
│                        below in reverse of the start), wiring.ts (the pieces not moved to Effect yet: createServices,
│                        startHttp, startWork, stopWork), schema.ts (ShinsaOptions, Shinsa)
├── cli/                 The command line (docs/cli.md: why it is shaped like Tailscale's and Docker's).
│                        index.ts routes the commands (`engine`, hidden from the help, runs the engine: it reads
│                        the login shell's environment first unless started from a terminal, exits 0 when its
│                        service (launchd or systemd) started it and finds the lock held, and in the bundle writes
│                        data/engine.log and puts its bin/ on PATH; createPlatformService picks launchd on the Mac
│                        and systemd on Linux, and waking the engine kicks that service; createOpenApp opens the
│                        app on the Mac, a browser elsewhere, or prints the URL with no display); help.ts the top-level
│                        commands as one table (OPEN_COMMANDS, ENGINE_COMMANDS) that the help (describeHelp,
│                        describeHelpAll), each command's --help and docs/cli.md's generated half
│                        (replaceReference) come from; commands.ts open
│                        (the app, a task, or a folder's project) / do / import / status; engine.ts start / stop /
│                        restart / version through the platform's EngineService (EngineControl, readHealth,
│                        HUMAN_ONLY_ENGINE_COMMANDS); launchd.ts the Mac's EngineService on the app's launchd job
│                        (createLaunchdService); logs.ts `shinsa logs`; app.ts the app's bundle id, the
│                        engine's label and `shinsa://` links; surface.ts every `shinsa <group> <action>` (help,
│                        --json, the idempotency key); client/ (EngineClient in service.ts: HttpApiClient.makeWith(EngineApi),
│                        every call typed from core's EngineApi; a request that does not connect wakes the engine
│                        once and is sent again, else EngineNotRunning (NOT_RUNNING); an error answer becomes a
│                        DomainError with the engine's code, or request_failed, and one without JSON
│                        EngineAnswerInvalid; index.ts createEngineCalls, the same calls as promises, the
│                        client the web and desktop apps move to); api.ts (createSurfaceClient and
│                        createApiClient over those calls); session.ts reads a Claude Code session for
│                        `shinsa import`
├── terminal/            How the command line draws (docs/cli.md → How it looks): style.ts (when there is colour and
│                        which symbols: TTY, NO_COLOR, FORCE_COLOR, TERM; the 16-colour tones; code in backticks),
│                        text.ts (visible width, wrapping, truncation, ~ for home, splitHint for an error's hint),
│                        layout.ts (Display, aligned lists, tables that fit the width, usage lines, fields),
│                        closest.ts (did you mean), spinner.ts (progress on a terminal's stderr), index.ts
│                        (resolveTerminal: the process's Terminal). The surface's formatters take a Display too; an
│                        agent's tool gets PLAIN_DISPLAY
├── instance/            Which Shinsa this is and the one-server rule (docs/engine.md → Configuration and data):
│                        install.ts (version, commit, install path, the server entry, resolveHealth for
│                        /api/health), lock/ (data/serve.lock as the scoped ServeLock layer: atomic create, the
│                        live-holder check, takeover, released when its scope closes; ServerRunning and LockContended
│                        in schema.ts, the file steps in file.ts; index.ts is the edge: acquireDataDirLock,
│                        selectLockHolder and ServerRunningError naming the holder), inspect.ts (the `inspect_read_only` refusal every
│                        command gets under SHINSA_INSPECT), bundle.ts (BUNDLE: the version, commit, state and SDK
│                        versions a compiled engine carries, and where its plugin and web folders are; null from
│                        source), targets.ts (ENGINE_TARGETS, the darwin and Linux builds scripts/build-engine.ts
│                        accepts, and each one's dist folder), service.ts (SERVICE_MARKER, the `SHINSA_SERVICE=1`
│                        the launchd job and the systemd unit set; EngineService, what start, stop, restart and
│                        waking need from either), systemd.ts (createSystemdService: the `shinsa.service` user
│                        unit with Restart=on-failure, written or refreshed on Linux by the start command and driven
│                        through `systemctl --user`), restart.ts (EngineRestarter, createServiceRestarter: stop
│                        cleanly and exit 75 for the service to start it again, now or after draining: new runs
│                        held until the working ones hand over, 15 minutes at most)
├── surface/             Everything you can do, as specs both the command line and every task agent's management
│                        tools are generated from (docs/engine.md → The command surface, docs/cli.md): fields.ts
│                        (argv, MCP schemas and tool input), spec.ts (defineCommand / defineRead / defineAction),
│                        resolve.ts (task, account, repository and project references), client.ts (SurfaceClient,
│                        the seam the command line and the management tools both run through: `calls`, the
│                        EngineApi calls a spec makes, never a path), one file per group
│                        (tasks, gates, work, schedules, config: projects and focus, extensions: mcp, skills and
│                        plugins, services, remote, system),
│                        index.ts (SURFACE, listAgentSpecs, listUncoveredCommands, help text, the docs/cli.md
│                        reference)
├── config/              schema.ts (ServerConfig, SettingInvalid and ENGINE_SETTINGS:
│                        every SHINSA_* setting as a Config with its default), service.ts (EngineConfig: ServerConfig
│                        read once through the ConfigProvider of provider.ts, the environment first, then config.json,
│                        then the default; settings.ts reads the port, lists and numbers, a bad value the typed
│                        SettingInvalid), machine/ (MachineConfigFile in service.ts: read, an Effect.fn reading
│                        config.json, unreadable text or JSON a MachineConfigUnreadable answered as the defaults; the
│                        pure parseMachineConfig in decode.ts decodes it field by field, a bad field dropped and
│                        named; the shapes and each field's schema in schema.ts; readMachineConfig the edge), paths.ts (where ~/.config/shinsa, config.json and data/
│                        are), file.ts (ConfigStore: config.json written atomically), index.ts (the edge:
│                        resolveConfig, resolveServerAddress, prepareDataDir). The port defaults to core's
│                        APP_IDENTITY: 7446; package.json's dev and start scripts pin 5180 so a checkout never meets
│                        the Mac app's engine; every SHINSA_* variable is read here, except SHINSA_QUICK and
│                        SHINSA_SERVICE (instance/service.ts) and the SHINSA_BUILD_* a compiled engine carries
│                        (instance/bundle.ts). A secret added later is Config.Redacted
├── log/                 service.ts (JsonLogger: Effect's Logger writing one JSON line per entry, `at`, `level`,
│                        `message` and the log's annotations, errors on stderr, the whole line through
│                        redactSecrets), schema.ts (LOG_LEVEL_NAMES: Effect's levels as info, warn, error),
│                        redact.ts (describeError and redactSecrets: URL credentials, GitHub and Anthropic tokens
│                        never reach a log, a failure gate or the event log), index.ts (the edge: `log.info`, `warn`,
│                        `error` run Effect.log* with the fields as annotations through runtime/edge.ts)
├── shell/               service.ts (Shell on Effect's ChildProcessSpawner: run(request) takes argv only, never a shell
│                        string, in its own process group; a timeout or an interrupt kills the whole group and still
│                        answers its output, and a command that ends on its own leaves what it started running (the
│                        spawner's own clean-up gets GROUP_LEFT_RUNNING_SIGNAL, SIGCONT, which stops nothing, and runs in the Shell layer's
│                        scope after the answer, so its one-second wait on the group never delays the caller); a missing program is the typed CommandNotFound; stopTree), schema.ts
│                        (CommandRequest, CommandResult, CommandNotFound, COMMAND_TIMEOUT, QUIET_ENV, the exit
│                        codes), processes.ts (stopping a group or a process, the ps table's descendants), errno.ts
│                        (selectErrnoCode: a system error's code, read by the SystemError schema; the lock uses it too),
│                        index.ts
│                        (the edge: runCommand, runCommandOrThrow, killProcessGroup, killProcessTree, the same
│                        results as before, CommandNotFound answered as exit code 127); login.ts
│                        reads the login shell's environment once (`-lic`, then `-lc` when that prints nothing, plus
│                        `fish -lc` when the interactive shell handed off to fish) and
│                        merges it into the server's, and
│                        isStartedFromTerminal (a TTY on stdin or stdout) decides whether `shinsa engine` needs it
│                        (the default shell is zsh on the Mac, /bin/sh elsewhere); browser.ts
│                        (resolveBrowserCommand: `open` on the Mac, `xdg-open` with a display, null without one)
├── store/               The event log on @effect/sql-sqlite-bun, one folder per table with its row schemas in schema.ts
│                        and its service in service.ts, every row decoded: events/ (Events: read reports a damaged row
│                        instead of failing and reads from a position), outbox/ (Outbox: the effects table, claimed
│                        per lane, settled, retried, reconciled after a restart), receipts/, briefings/ (the Home
│                        guide), snapshot/ (Snapshots: the state snapshot, verified by version, anchor and checksum;
│                        version.ts: resolveStateVersion, a hash of @shinsa/core's source), commands/ (CommandLog: a
│                        command's events, effects, cancellations and receipt in one transaction) and migrations/
│                        (LogMigrator over LOG_BASELINE and the ordered LOG_MIGRATIONS in list.ts, the log's version in
│                        user_version, an older log refused with LogVersionError, inspect mode refusing a log that needs
│                        migrating); layers.ts (StoreLayer(path): the tables, the services and the empty-log stamp on
│                        one SqlClient; a command's events and its effects are each written in one statement, the
│                        effects' status is the closed set EffectRowStatus, and shared/payload.ts reads a stored event
│                        or effect for both tables). event-log.ts is the edge: EventLog, the same methods as before, each running
│                        a service through its own ManagedRuntime. Beside the log, evidence/ (Evidence: attached
│                        evidence under `<task id>/round-<n>/`, chat tool images at the top, all served under
│                        /api/evidence by http/routes/files, immutable and in byte ranges; EvidenceStore is its edge)
│                        and attachments/ (Attachments: the files you attach to a request or message,
│                        `<UUIDv7>/<file name>`, the upload read by a schema in upload.ts, uploaded by POST
│                        /api/attachments and served under it the same way; AttachmentStore is its edge)
├── runtime/             edge.ts (edgeRuntime: the process's ManagedRuntime of JsonLogger, Shell, JsonFile, GitLayer, GitHubLayer, ReposLayer, WorkspacesLayer, ChecksLayer, TerminalsLayer, ExtensionsLayer, SecretFiles, AccountsLayer and VersionsLayer that code not yet
│                        moved to Effect calls the foundation through), engine/ (EngineCore in service.ts: boot from
│                        the snapshot and the events after it, dispatch serialised on a Semaphore → receipt → decide →
│                        commit → adopt the decided state → listeners with the state before and what changed, and the
│                        same update on the `updates` Stream; snapshots once quiet, the Home guide beside the log
│                        (writeBriefing), the pump fiber, one fiber per running effect in a FiberMap, interrupted when
│                        a decision cancels it or the engine stops; the shapes in schema.ts, receipt identities in
│                        receipts.ts), engine.ts (the Engine class edge: the same methods as before over EngineCore's
│                        own ManagedRuntime on the EventLog's services; a promise handler runs in Effect.tryPromise,
│                        so an interrupt aborts its signal, and settle waits for it to return),
│                        effects/ (one service per area, each handler an Effect.fn failing with EffectFailed or
│                        ShippingFailed: setup/ TaskSetup (triage, setup check, worktree), checks/ CheckRuns,
│                        shipping/ Shipping (the push's steps, conflicts, hook rejections as HookRejected),
│                        merging/ Merging (merge, stacks, bundles, close), cleanup/ Cleanup, pull-requests/
│                        PullRequestSync (the watch fiber, a sync soon after a push, one sync per task at a time on
│                        a semaphore per task, pure reads in news.ts), edits/ EditCommits, reports/ EffectReports
│                        (retries and failures for good), runner/ EffectHandlers (routes each kind), world/
│                        EffectWorld (the engine, config and unmoved pieces they stand on, and bridge: a promise
│                        API given the fiber's AbortSignal, waited for on interrupt); the shapes in schema.ts),
│                        effects.ts (the EffectRunner class edge over them: apply settles quietly once its signal
│                        aborts, stop interrupts the watch and the background syncs), failures/ (EffectFailed and ShippingFailed,
│                        the push's step, in schema.ts with the EFFECT_RETRY schedule; resolveEffectFailure and
│                        resolveShippingFailure in classify.ts; retry.ts steps the schedule), StateClock (clock.ts, the
│                        edge every timer that fires from state extends, over clock/: makeStateClock in service.ts
│                        keeps one timer fiber in a FiberHandle, ClockTickFailed in schema.ts), MonitorClock (monitors.ts) and WatchdogClock (watchdogs.ts: a watchdog's
│                        next check)
├── agents/              RunSupervisor (supervisor.ts: the edge over supervisor/'s RunSupervisor service, the same
│   │                    methods as before, through one ManagedRuntime of it; supervisor/: service.ts (the
│   │                    RunSupervisor service: its layer builds RunWorld and RunHost and every step), the run
│   │                    loop as Effect.fn steps: run.ts (executeRun: a run's turn, its fiber registered on its
│   │                    ActiveRun), drive.ts (attempts until one ends the turn), session.ts (one attempt's session,
│   │                    its stop and the turn's context), attempts.ts (model, account lease, run.attempt),
│   │                    meter.ts, overload.ts (the wait between overloaded attempts on the named OVERLOAD_RETRY
│   │                    schedule), workspace.ts (where each run works: the worktree, the repository, or
│   │                    data/scratch/<task> for a task with no repository, resolveScratchPath in config/paths.ts,
│   │                    removed by the scratch.remove effect once the task settles; isolated checkouts),
│   │                    stop.ts (quiesce, the stopMs bound, marking a run interrupted), control.ts (each run a
│   │                    fiber its run scope settles or interrupts; cancel, steer, held runs in a Ref, shutdown
│   │                    and restart recovery),
│   │                    compact.ts; world/ (RunWorld: the engine, config and services a step reads) and host/
│   │                    (RunHost: the live runs, scopes, fibers, the control Ref and parts), their shapes and
│   │                    tagged errors in schema.ts; scopes.ts:
│   │                    makeTaskScopes: a scope per task, a run's scope under its task's or, for a delegation, under
│   │                    the scope of the run that delegated it, and an attempt's scope holding its session under
│   │                    its run's; a run's scope outlives its attempt while a delegation under it runs, `run.cancel`
│   │                    closes it (its delegations with it, and its fiber once stopMs has passed) and shutdown
│   │                    closes every task's; TaskScopes in
│   │                    index.ts is its edge), the
│   │                    live state of a run (active/: run.ts, its shape in schema.ts), resume or
│   │                    hand over per turn, the house rules only to a session without them and the round's
│   │                    whole brief to an agent session that may not hold the round (turns/plan.ts), the
│   │                    tool calls (tool-calls/: ToolCallFailed, each call an Effect in service.ts), questions and their waiters (questions.ts; questions/: each
│   │                    reply a Deferred, ReplyWaiters its edge), idle release (idle.ts, the edge over idle/:
│   │                    makeIdleRelease, one timer fiber per waiting run in a FiberMap), delegated reports in and
│   │                    out of a turn (deliveries/service.ts, delegations/delivery.ts), the account seam: leases and rejections
│   │                    (accounts.ts), idle compaction (compaction.ts, the edge over compaction/: makeIdleCompaction,
│   │                    the wait and the running compaction as fibers per task, the window in window.ts; stopping
│   │                    one aborts it and waits for it), quiet runs (silence.ts, the edge over
│   │                    silence/: makeSilenceWatch, the check a fiber on its interval), hand-over checks and evidence
│   │                    (handover.ts), RunClock (clock.ts, the edge over clock/:
│   │                    makeRunClock, a countdown fiber paused by interruption; ClockTimers become an Effect
│   │                    Clock), the commands no agent may run (policy.ts: also the
│   │                    human-only `shinsa` commands, read from the surface, and whole test suites), what `read_task` reads (reading/task.ts),
│   │                    the other open work in a task's repository and the files two tasks both change
│   │                    (repository-work/service.ts: `list_repository_work` and task.record_overlaps before a hand-over),
│   │                    the task's own service runs and the services it adds and removes (services.ts: `list_services`,
│   │                    `run_service`, `add_service`, `remove_service`),
│   │                    the MCP servers and skills each session last ran with, its pin (extension-sets.ts)
│   ├── manage/          The surface as every task agent's tools (docs/engine.md → Agents manage Shinsa): tools.ts
│   │                    (one tool per spec but the human-only ones and those with an `agentTool`, such as
│   │                    `tasks create`, whose agent files a task with `create_task`), client.ts (reads through the EngineApi calls, commands through
│   │                    the server's router on your behalf with byTask, so a message is classified; adding a
│   │                    repository or folder to a project runs in process through the project changes);
│   │                    ManageAccess ({ baseUrl, projects, route }) is what serve.ts hands the supervisor as `manage`
│   ├── providers/       types.ts (AgentProvider, capabilities, AgentSession), registry/ (Providers: the registry as
│   │                    a service, resolve failing with NoAgentProvider; index.ts's ProviderRegistry is its edge),
│   │                    session/ (acquireAgentSession: a session as a scoped resource, closing its scope cancels
│   │                    it and waits for it to end), instructions.ts (what every session is told about Shinsa
│   │                    and its skills), versions.ts (reading and comparing a program's version)
│   │   └── claude/      The Claude Agent SDK provider: the session (session/: makeClaudeSession in service.ts, a
│   │                    scoped resource reading the SDK's query() as a Stream, prompts through an Effect Queue,
│   │                    the folded-turn, context, exit-grace and interrupt timers as fibers, its release
│   │                    interrupting the query and killing the process tree; the SDK options in options.ts, prompt
│   │                    ids and steering in prompts.ts, its shapes, timings and tagged errors in schema.ts;
│   │                    session.ts's startClaudeSession is its edge), result
│   │                    classification (classify.ts), the user's `claude` (executable.ts), the SDK runtime (sdk.ts),
│   │                    session files (artifacts.ts), the PreToolUse guard (guard.ts), the recorder (recorder.ts: the
│   │                    chat mapping in map.ts, notices), usage and the cache lifetime (usage.ts, context.ts),
│   │                    session import (import.ts), one-shot and structured completion (complete.ts), the model
│   │                    catalog (models.ts), the MCP servers
│   │                    and skills a run loads (extensions.ts), the route to the API per compaction setting: eunoe
│   │                    or direct, and the fallback notice (route.ts)
│   │   └── codex/       The `codex app-server` provider: the JSON-RPC client (client/: makeCodexClient, the
│   │                    process a scoped resource, its stdout and stderr read as streams, each request a Deferred
│   │                    failing with CodexRequestError, the process group killed when its scope closes; client.ts
│   │                    is its edge), the session (session.ts:
│   │                    turns, steering, the agents Codex starts, compaction), the chat mapping (map.ts), failure
│   │                    classes (classify.ts), the HTTP MCP endpoint (mcp.ts), the price table and what a turn costs
│   │                    (pricing.ts, meter.ts), usage windows read like CodexBar and fast mode credits (usage.ts),
│   │                    one-shot calls (complete.ts), models, sign-in, executable, MCP servers and skills
│   │                    (extensions.ts)
│   ├── tools/           The `shinsa` MCP server (index.ts: an MCP `Server` each provider exposes its own way) and the
│   │                    tool schemas (specs.ts, schema.ts): hand-over and process tools (process/handler.ts), the hand-overs
│   │                    of each task shape: answer, report_diagnosis, submit_report, report_outcome, reshape_task
│   │                    (shapes/handler.ts), delegation and couriers (orchestration/handler.ts), the one Effect step every call runs through (call.ts), schedules (schedules.ts). The plan
│   │                    parameters in `propose_plan` (verification as checks, impact, evidence, approval), the
│   │                    `check_changes` of `complete_phase` and `complete_fix`, the `checks` of `complete_fix`, a
│   │                    linked check on `attach_evidence` (`check`) and the steps `reshape_task` offers are generated
│   │                    from core's VERIFICATION_RULES, PROTOCOL_LIMITS, PLAN_EVIDENCE_KINDS and STEP_SCHEMA, never
│   │                    hand-written
│   ├── transcripts/     Per-run JSONL transcripts, live listeners with each entry's position, tailing a file another
│   │                    writer appends to, reading only the bytes appended since; the entries of followed and
│   │                    recently read runs stay in memory
│   └── quick/           One-shot calls (triage, the briefing) on the classifier and writer models:
│                        structured output with a fallback across the registry's providers, the default one
│                        first (index.ts, createQuickCalls), the typed decision questions (decide.ts: choice and
│                        choices) triage and the briefing answer
├── accounts/            Claude accounts and usage limits: schema.ts (every shape read from outside, decoded
│                        leniently: accounts.json's accounts, `claude auth status`, the stored login, claude-swap's
│                        list, Claude's usage answer, the usage caches and the spent marks; UsageReadFailed,
│                        SharedEntryUnlinked; every interval and timeout a named Duration with its _MS), answers.ts (the
│                        pure decoders: parseAuthStatus, parseStoredLogin, parseCswapList), registry/
│                        (AccountRegistry: accounts.json, usage-limits.json, provider-usage.json and account-marks.json
│                        on JsonFile), folders/ (AccountFolders: an account's CLAUDE_CONFIG_DIR made, seeded, linked to
│                        the shared entries, written and removed, its .credentials.json read), usage/ (UsageApi: Claude's
│                        usage over HttpClient; answer.ts the windows, fast mode and Retry-After), layers.ts
│                        (AccountsLayer, in runtime/edge.ts). The edges keep their exports: store.ts (AccountStore),
│                        paths.ts (folders, the Claude config dir and resolveAccountEnv, the environment every command
│                        for an account runs with), login.ts (`claude auth login` on TerminalPty), status.ts,
│                        credentials.ts (the keychain entry per folder, read only), usage.ts (requestUsage) and
│                        limits.ts (UsageLimits), rotation.ts (leases, the spent marks and the one retry budget; the
│                        picker itself is core's `pickAccount`), renewal.ts (a login Claude could not refresh: read
│                        again, the Sign in gate's text, noticing it works again), imports.ts and cswap.ts (imports),
│                        patch.ts (an account's settings from the API), resume.ts (the usage-wait clock), index.ts (the Accounts service: sign-ins, snapshot, notices, the weekly
│                        reading a run is charged against); its routes are http/routes/accounts
├── eunoe/               Eunoe's core (`@chroxify/eunoe`) served inside the engine for its Claude sessions: server.ts
│                        (EunoeServer: the forwarder on a loopback port of its own, started on first use; the request
│                        log in data/eunoe; compaction notices and the stuck signal per session), forwarder.ts (the
│                        server acquired in a scope stop() closes; ForwarderUnavailable), threads.ts (thread state in
│                        data/eunoe/threads on JsonFile, decoded by StoredThread), schema.ts
├── schedules/           Schedules: the clock (clock.ts), the agent tools (tools.ts), the webhook receiver
│                        (webhook.ts), signature checks (verify.ts), the prompt template and redaction (template.ts:
│                        a JSON body decoded by WebhookBodyText), the writer's wording of a suggested watch (suggest.ts,
│                        its answer decoded by WatchAnswer in answer.ts), the Schedules service (index.ts; its routes
│                        are http/routes/secrets and webhooks), schema.ts (the shapes, WebhookOutcome, the
│                        limits and RATE_WINDOW)
├── remote/              Remote access (docs/engine.md → Remote access): store.ts (remote.json: the machine's key, the
│                        credentials, the enrolled devices, who has access; the only place the keys live),
│                        client/ (RemoteClient in service.ts: every call to app.shinsa.dev derived from core's
│                        RemoteApi through HttpApiClient (pairing, machine, machineTeams, slackRelay), the
│                        Redacted machine token through the MachineSession client middleware, each call under
│                        Effect.timeout; every refusal its typed failure from core's remote/errors, a 401 on a
│                        machine call Revoked, and a status the API does not declare, a timeout or no answer
│                        RemoteUnreachable in schema.ts with `retryable`; index.ts is the edge, RemoteControl,
│                        with selectRemoteFailureTag and isRemoteRetryable for callers not moved yet),
│                        pairing/ (Pairings: the claim code, then a forked poll every PairPollInterval, 2 s, until
│                        GitHub sign-in claims the instance, it expires or you cancel), cloudflared/ (Cloudflared:
│                        the pinned release downloaded, checked by SHA-256 and unpacked under data/bin, each step
│                        under a timeout; asset.ts picks the platform's build), connector/ (TunnelConnector:
│                        cloudflared as a scoped process with the token in its environment, up once it prints
│                        CONNECTED_PATTERN, stopped and failed as TunnelConnectFailed after ConnectTimeout, 30 s;
│                        installed.ts and refused.ts the two layers), health/ (TunnelHealth: one ping of the
│                        tunnel's /health), tunnel/ (TunnelSupervisor: connect, then pings on PING_SCHEDULE with a
│                        heartbeat every fourth, a restart after three failed pings or an exit on
│                        RESTART_SCHEDULE (every second for a minute, then 2, 4, 10 and 30 s), Revoked ending it for
│                        good; index.ts the Tunnel edge), access/ (AccessScope: the remote-access scope every
│                        sealed channel and team feed socket is leased from, ended when access goes off, the
│                        machine is revoked or removed, closing them all in parallel; RemoteAccessScope is its
│                        edge), gate/ (TunnelGate in service.ts: the one gate for everything through the tunnel,
│                        the route table, the principal and the refusals in schema.ts; Ingress, EngineGate and
│                        the server's socket upgrades ask it and decide nothing else about the tunnel),
│                        egress/ (EgressGate in service.ts: the one gate for what leaves, every share and team
│                        view and the team list this machine signs encoded through the allowlist schemas in
│                        schema.ts, a view that breaks one refused, never sent; a preview's answer without the
│                        headers that describe the machine, PREVIEW_DROPPED_HEADERS),
│                        channel.ts (RemoteChannel: the handshake, sealed frames, the app socket and HTTP
│                        inside, a lease on the access scope), placement.ts (POST /api/placement: the
│                        classifier reads every machine's policies with a new task's request and names its machine),
│                        shares.ts (Shares: the share.link effect, which makes a link's id and key; the live
│                        view of a shared task, its evidence files by hash and its pull request's diff and changed
│                        files whole; every open link, pushed on each state change and ended when sharing stops or
│                        remote access goes off, and a link whose time ran out refused),
│                        share-clock.ts (ShareClock: share.expire when a share's time runs out),
│                        share-describe.ts (the writer quick call that describes a shared task for the
│                        share.describe effect),
│                        share-channel.ts (ShareChannel: the tunnel's /share channel, the hello checked against
│                        the link's key, sealed frames out, nothing read after the hello; a host authorizes the
│                        hello, so team views run on it too; a lease on the access scope), teams.ts (Teams: making, joining, leaving and
│                        answering requests through app.shinsa.dev with the machine token, the team keys in
│                        remote.json, and the tunnel's /team channel, checked against membership, the key and the
│                        team's projects, ended the moment access ends), team-feeds.ts (TeamFeeds: a list channel
│                        to every other machine of each team whose key this machine holds, each socket a lease on
│                        the access scope, GET /api/teams/tasks,
│                        the teams socket message and the /api/teams/view relay of one task), team-snapshots.ts
│                        (TeamSnapshots: each teammate machine's last list), team-views.ts (TeamViews and
│                        TeamViewRecorder: each of their tasks' last full page, replayed while the machine is
│                        offline), handoffs.ts (Handoffs: the handoff.link and handoff.revoke effects and the claim
│                        recorded as handoff.claim), index.ts (Remote: wires them, pairing, pausing, removing,
│                        enrolling, a hand-off's link, claim and removal, the stable webhook URL); its routes
│                        are http/routes/remote, teams, placement and tunnel
├── slack/               The Slack bot's machine side (docs/engine.md → Slack): index.ts (Slack: the mention
│                        app.shinsa.dev forwards over the tunnel, checked against the connect key and sent as
│                        slack.mention, and a question's choice clicked in Slack as slack.answer
│                        (handleTunnel); slack.evaluate: ⏳ on the mention, the classifier asked, "Not a task" once
│                        per thread or slack.start_task; the
│                        slack.post and slack.status effects, the status message edited at most every 5 s and only
│                        when it changes, the thread's status and the mention's one reaction moved with it; GET
│                        /api/slack and POST /api/slack/disconnect); posts, reactions, the thread's status, links and
│                        unlink go through RemoteClient's slackRelay group with the machine token, retried only
│                        on SlackFailed or a retryable RemoteUnreachable (the relay down, busy or unreachable)
├── secrets/             secrets.json: webhook tokens and signing secrets, one-use secret refs, MCP sign-ins. schema.ts
│                        (each entry's schema, SECRET_REF_TTL), files/ (SecretFiles: read and written on JsonFile, a
│                        file without a salt kept aside), store.ts the edge (SecretStore)
├── extensions/          MCP servers, plugins and skills (docs/engine.md → MCP servers, plugins and skills): schema.ts
│                        (every shape read from outside: Claude Code's and Codex's settings, plugin manifests, skill
│                        front matter, extensions.json, extension-usage.json, transcript lines, stored OAuth
│                        credentials, each decoded leniently; McpServerFailed; MCP_CHECK_TIMEOUT and the other
│                        timeouts), discovery/ (ExtensionDiscovery: what Claude Code, Codex, plugins and repositories
│                        set up, servers.ts and skills.ts its pure steps), store/ (ExtensionFiles: extensions.json and
│                        the usage cache through JsonFile), health/ (McpClients: open, a scoped MCP client closed with
│                        its scope; request, any MCP call under its timeout as McpServerFailed; check, a server's
│                        health), usage/ (ExtensionUsage: when agents last used each server and skill, from Claude
│                        Code sessions and Shinsa's transcripts read incrementally; names.ts), tools.ts (tool lists,
│                        their tokens and what counts as unauthorized), credentials.ts (stored sign-ins decoded),
│                        layers.ts (ExtensionsLayer, in runtime/edge.ts). The edges keep their exports: discover.ts,
│                        definitions.ts, skills.ts, plugins.ts, store.ts, health.ts, usage.ts; one row per server
│                        however many places define it (catalog.ts), checking and redacting what you send
│                        (input.ts), sign-in (oauth.ts, and sign-in.ts: the callback page), what a run loads and
│                        leaves out and what it is told about it (session.ts), loading what the context optimizer
│                        left out mid-run, by any name (loader.ts), the Extensions service (index.ts; its routes are
│                        http/routes/extensions and sign-in)
├── versions/            The agent programs' versions and their updates (docs/engine.md → Versions and updates):
│                        registry/ (NpmRegistry: the latest from the npm registry over HttpClient, decoded by
│                        NpmLatest, NpmRegistryFailed), registry.ts its edge (requestLatestVersion), each program's own
│                        updater, found from where its binary lives (updaters.ts), the Versions service: snapshot, the 3-hour cache, updates (index.ts),
│                        schema.ts (the shapes, PROGRAMS, LATEST_TTL, UPDATE_TIMEOUT), program.ts (isProgramId),
│                        layers.ts (VersionsLayer, in runtime/edge.ts)
├── files/               service.ts (JsonFile: read(path, schema), a missing file Option.none and broken text or a
│                        breaking value the typed JsonFileUnreadable; keepAside, the `<name>.unreadable-<time>` copy;
│                        write, atomic through `<name>.writing-<pid>` and mode 600), schema.ts, index.ts (the edge:
│                        writeJsonFile, keepJsonFileAside; config/file.ts re-exports writeJsonFile), manifest.ts (the
│                        one reader of a checkout's package.json and deno.json, through the lenient PackageManifest
│                        schema: a field that breaks its shape is dropped, the rest kept)
├── git/                 service.ts (Git: attempt answers a CommandResult, run fails with GitFailed and retries a held
│                        index.lock on LOCK_RETRY, read answers a command's raw bytes with its byte or line cap, a
│                        5 s timeout, each chunk as it comes and the request's abort, literal pathspecs), schema.ts
│                        (GitFailed, RefName and RefNameInvalid, GitRead, LOCK_RETRY), ref-name.ts (decodeRefName),
│                        layers.ts (GitLayer: the services below on Git), and one folder per service with its
│                        schema.ts: checkout/ (Checkout: commits, a merge's MERGE_HEAD, stashes, worktrees made,
│                        refreshed and removed, a free branch name, the start point, delegations' detached
│                        checkouts, installing dependencies; MergeUnresolved, CommitInvalid; paths.ts), remote/
│                        (Remote: pushes and PushError typed as hook, network, non_fast_forward or other by
│                        classifyPushFailure in output.ts, hasPrePushHook with core.hooksPath and husky's stubs
│                        followed, the output's tail; updateOntoBase: fetch the base, merge it in when the branch
│                        lacks it, or list the conflicts and abort the merge; checkBundleMerge: a bundle merged into
│                        the default branch with git merge-tree, no working tree, and the lowest branch behind its
│                        base on a conflict; a repository's root, origin and default branch), history/ (History: a
│                        task's head, base and commits, also once its worktree is gone, CodeUnavailable; the files its
│                        branch committed since its base plus what its checkout has not; diffs commit to commit and
│                        the working copy against a base on a scratch index acquired and released in a scope, the
│                        file list from `--raw --numstat`, the patches of the small files only or of the files named,
│                        DiffFailed), tree/ (CodeFiles: the Code tab's paths, folders, files at a commit or in the
│                        working copy, `git grep` with case folded into the pattern and its matches streamed, each
│                        failure CodeReadFailed with its code; entries.ts the pure parsers), leftovers/
│                        (LeftoverProcesses: the processes still working in a folder, stopped with a grace period
│                        polled on STOP_POLL_SCHEDULE). conventional.ts (COMMIT_TYPES, BRANCH_PATTERN,
│                        resolveCommitType, serializeConventionalSubject) and refs.ts (assertRefName, slugify) are
│                        pure. The other files are the edges, the same exports as before for the folders not moved
│                        yet: index.ts, run.ts (runGitOrThrow), read.ts (readGit), commit.ts, worktree.ts,
│                        isolation.ts, push.ts, update.ts, bundle.ts, repo.ts, task-refs.ts, changed-files.ts,
│                        diff.ts, files.ts and processes.ts, each failure the error it threw before (a DomainError
│                        for the Code tab's reads). blobs.ts (CatFile, CatFilePool: one long-lived
│                        `git cat-file --batch-command` per repository) and objects.ts (ObjectCache, the 64 MB cache
│                        of what a commit addresses) stay as they were: only http/routes/code holds them
├── workspaces/          Where agents work (docs/engine.md → Where agents work): one Workspace of effects per mode
│                        (schema.ts: prepare, commit, push, remove, writeEdit, syncBase: the merge of the base
│                        before a push; TaskCheckoutMissing, CheckoutDirty, CheckoutOffBranch),
│                        worktrees-mode/ (WorktreeWorkspaces: make(worktreesDir) and the commit both modes share),
│                        main-checkout-mode/ (MainCheckoutWorkspace: the workspace and the setup check's
│                        describeProblem); the edges: edge.ts (EdgeWorkspace, the WorkspaceStrategy of promises),
│                        worktrees.ts, main-checkout.ts, index.ts (Workspaces.resolve, describeWorkspaceProblem)
├── github/              `gh`, the one way the engine reaches GitHub: process/ (GitHubProcess: gh with GITHUB_TIMEOUT,
│                        and layerTest, which plays gh in a test), service.ts (GitHubCli: run fails with
│                        GitHubFailed, json decodes the answer with a schema or fails with GitHubAnswerInvalid),
│                        slug.ts (resolveRepoSlug); pulls/ (PullRequests: read, the view with the merge commit, then
│                        one GraphQL read for checks, comments, threads, the reader and the merge queue; create with
│                        its body, retarget, merge only the approved head with `--match-head-commit`, the
│                        repository's numeric id, a pull request's diff and a file at a commit for a shared task's
│                        Code tab, a user attachment upload, rewriting the description's block; every answer's
│                        schema in schema.ts; serialize.ts maps them onto core's PullRequest); description/
│                        (PullRequestDescriber.make: the writer that uploads the evidence GitHub cannot reach,
│                        reads the notes and builds the body with core's serializePullRequestMarkdown; link.ts the
│                        review link); ci/ (RepoCiReader: whether a repository has CI for a base, from workflows,
│                        the base commit's checks and required checks, and makeCache); layers.ts (GitHubLayer);
│                        index.ts, ci.ts and description.ts are the edges (readPullRequest…, RepoCiCache,
│                        PullRequestDescriptions)
├── checks/              The checks a `checks.run` effect names (the agent's and the repository's baseline; nothing is
│                        guessed from package.json), all at once with no machine-wide limit: each through `sh -c` in the
│                        task's checkout at low priority (`nice -n 10` where it exists) with CHECK_ENV, stopped after
│                        CHECK_TIMEOUT_MS (15 minutes); a command named twice runs once. runner/ (CheckRunner:
│                        command, run, confirm, runAll). A failure re-runs its failing test files alone once
│                        (reruns.ts; all pass: `passed_alone`), then runs on the task's base commit in a kept detached
│                        checkout, cached per base commit and command (base/: BaseCheckoutPools.make(dir), any failure
│                        logged and answered as no comparison), comparing the failures themselves (failures.ts:
│                        listCheckFailures reads failing tests by file and name, or tsc, Biome, ESLint, Prettier and
│                        path:line diagnostics by file, code and message, never the line; resolveFailureDiff,
│                        describeFailureDiff): none new is `fails_on_base`, not blocking; new ones block, named first;
│                        output it cannot read, or a failing file or a path in the command missing on the base, is
│                        never compared); caches/ (SharedCaches: the turbo cache per repository); output.ts (the
│                        output's tail and the failing files); evidence.ts writes each check's output as one piece of
│                        Shinsa's `check` evidence with its id (serializeCheckOutput); install.ts the lockfile's
│                        install command; schema.ts the shapes and limits; layers.ts (ChecksLayer, with
│                        test-coverage's TaskCoverage); index.ts, base.ts and caches.ts are the edges (runChecks,
│                        BaseCheckouts…) (docs/engine.md → Checks)
├── test-coverage/       Changed-line coverage, once before review, from the tests among the task's checks: detect.ts
│                        (resolveCoverageRun: a test check's command run again with its runner's coverage report in a
│                        temporary folder; resolveCoverageDetection for Settings), service.ts (TaskCoverage.measure:
│                        run each like a check in a temporary folder released with its scope, merge the reports, diff
│                        against the task's base, and core's measureCoverage; CoverageReportUnreadable), schema.ts,
│                        index.ts the edge (measureTaskCoverage; listCoverageDetections for GET /api/repos/coverage)
│                        (docs/engine.md → Test coverage of the change)
├── resources/           How busy this machine is (docs/engine.md → Remote access, How busy each machine is): index.ts
│                        (ResourceMonitor: samples every 5 s while a socket listens, df and du every 10 minutes, the
│                        memory reader per platform), poller.ts (the sampling fiber on Schedule.spaced, interrupted
│                        when the last socket closes), sample.ts (the ps table, CPU from deltas of CPU time, vm_stat,
│                        /proc/meminfo, df, du, each task's use), ledger.ts (ProcessLedger: each task's agent, check
│                        and service processes), schema.ts (the shapes and each interval as a Duration)
├── repos/               Finds repositories in the chosen folders, registers one on first use in its project, or
│                        names a new project after its GitHub owner, and fills in a missing remote from origin
│                        (syncRepoRemote, upsertRepo) (index.ts); folders/ (RepoFolders: scanning the home folder
│                        for the folders that hold repositories, the repositories in the chosen folders, a
│                        repository's origin from .git/config without running git), setup/ (RepoSetup: setup
│                        verification before a task's first agent), login/ (GitHubLogins: the GitHub login through
│                        GitHubCli, kept once gh answers it), roots.ts (chosen folders, SHINSA_ROOTS, or discovery
│                        until onboarding is done); edge.ts the functions the rest of the engine calls
├── onboarding/          Status, folder suggestions, saving the setup (index.ts, roots.ts: the folders macOS keeps
│                        private as PrivateFoldersError, and opening Full Disk Access), the prerequisite checks
│                        (prerequisites.ts: git, gh, claude, bun when a repository uses it, Homebrew when a fix
│                        needs it, and codex and its sign-in as optional, each with the command that fixes it;
│                        install.ts: that command run in a terminal of your own), the setup steps: the fixed list, what each shows and saves
│                        (steps.ts), the suggested projects and making them (projects.ts), the run of setup, going
│                        back (flow.ts), its saved state (drafts.ts: onboarding.json on JsonFile, decoded by
│                        SetupDraft in schema.ts, a file it cannot read or did not write starting setup again), the
│                        accounts it lists (accounts.ts); schema.ts also holds the revision of the suggested projects,
│                        the prerequisite shapes and PREREQUISITE_TIMEOUT
├── projects/            changes.ts: listLocalRepoViews (repositories in the chosen folders and every project's
│                        folders, registered or not) and createProjectChanges, which http/routes/projects and
│                        the management client share; folders.ts
│                        (resolving a folder you add)
├── triage/              Title, repository (or none), size, branch and dependencies for a new task, and the parts the human left
│                        to Shinsa (Auto): its shape, priority and dependencies, each with a reason. A task in a
│                        project chooses among that project's repositories, each named with its path, plus any outside
│                        it the request names (resolveCandidatePool); repositories are listed by name, never by recent
│                        use; resolveRepoProject files a repository triage registers. message.ts:
│                        the message classifier (nothing to do, feedback or a follow-up, a new round with its kind of
│                        work, or another task, as a typed decision read against each round's outcome, asked one of
│                        three ways: nothing in progress, a round in progress, or a round finished and waiting for
│                        your review or merge, where anything about that round is feedback) and
│                        routeUserCommand, which the socket and POST /api/commands send every command through: your
│                        message is accepted into the task's inbox at once (message.receive) and inbox.ts
│                        (MessageInbox) classifies and routes it after, one task at a time and in order:
│                        everything waiting in a task's inbox is classified together against the task as it is
│                        then and routed as one (message.route with messageIds; not classified at a gate that
│                        takes words, needsMessageKind), a classifier that does not
│                        answer within CLASSIFY_TIMEOUT (30 s, schema.ts; classify.ts runs the call with
│                        Effect.timeoutOrElse, ClassifierFailed) routes it unclassified, and a route that breaks is dropped with a
│                        reason, so no message waits for ever; the receipt is taken over the
│                        command as sent; createCommandRouter, the same route for an agent's management commands,
│                        which classifies before it dispatches; a new round or a kept suggestion that names no kind
│                        of task is shaped first (resolveRoundShape); resolveRoundRepository finds the repository a
│                        task with none needs once its work needs one (the setup check calls it)
├── briefing/            The Home guide, written beside the log through Engine.writeBriefing; debounce.ts waits
│                        BRIEFING_DEBOUNCE (schema.ts) on a fiber that each new request interrupts and stop() cancels
├── terminals/           Your terminals (docs/engine.md → Terminals): pty/ (TerminalPty: your login shell in Bun's PTY as
│                        a scoped resource, hung up and killed after HANG_UP_GRACE; the program in front of a shell
│                        through Shell; a free port on PORT_RETRY, PortUnavailable), pty.ts its edge (the shell, its
│                        environment, spawnTerminalProcess, readForegroundProgram, pickFreePort), mirror.ts (the
│                        headless xterm.js copy of the screen, the answers to a program's questions), session.ts
│                        (TerminalSession: viewers, batching, back-pressure, exit, typing a command at the prompt),
│                        xterm-types.d.ts (the add-ons' `@xterm/xterm` types mapped to `@xterm/headless` in tsconfig,
│                        so the DOM types never reach the engine), store/ (TerminalFiles: data/terminals/, the
│                        terminals, their screens and services.json on JsonFile, each entry decoded by StoredTerminal
│                        or StoredService), store.ts its edge (TerminalStore, parseStoredTerminal, parseStoredService),
│                        detect.ts (the services found in a project's folders: workspace scripts, Deno, bin/dev and
│                        Procfile lines, each Compose service, Cargo, Go, Django, make), refine.ts (ServiceRefiner: the
│                        quick call that names them, adds a port flag and a preview URL, cached per project; its answer
│                        decoded in answer.ts), input.ts (what http/routes/terminals and services read from a body),
│                        places.ts (where a terminal opens and a service runs: resolveTerminalStart,
│                        resolveServicePlace, resolveServiceRunIn, the suggestions a project does not have yet),
│                        sockets.ts (the /ws/terminals/<id> socket, createTerminalSockets), index.ts (Terminals: the list, create, rename,
│                        reorder, restart, run, close, stop, and the services: add, update, remove, start, stop,
│                        restart, a run per task, closing a task's runs, resume after a restart), schema.ts,
│                        layers.ts (TerminalsLayer)
└── http/                Core's EngineApi served (docs/engine.md → The HTTP surface): server.ts (Bun.serve
                         listens and hands every request, and every request inside a remote channel, to the one
                         web handler; the sockets: the page's `/ws`, `/ws/terminals/<id>`, the remote, share,
                         team and preview channels; a taken port is PortInUse naming config.json's `port`),
                         app.ts (makeEngineHandler: HttpRouter.toWebHandler over ApiRoutes, the plain routes
                         and Ingress, a scoped resource), ingress/ (Ingress: Host, Origin and inspect mode for this
                         machine, and TunnelGate for the tunnel and the channel, on every request), gate/
                         (EngineGateLive, EngineApi's EngineGate: TunnelGate's endpoint check, content type, the
                         body caps and every failure as
                         `{ error: { code, message } }`), guard.ts (the checks both use), routes/<group>/
                         (handler.ts, one HttpApiBuilder.group per EngineApi group, and its schema.ts: tasks,
                         code, commands, server, files, state, onboarding, accounts, secrets, extensions,
                         versions, remote, teams, placement, slack, projects, terminals, services; the plain
                         routes webhooks, sign-in and tunnel), services/ (HttpServices: what handlers call),
                         schema.ts (RequestSource, HttpContext, PortInUse), failures.ts (a service's thrown
                         DomainError as RequestFailed with its code), commands.ts (dispatchUserCommand through
                         parseUserCommand), features.ts (ENGINE_FEATURE_ROUTES from EngineApi's annotations),
                         task-lookup.ts, task-views.ts, files.ts (byte ranges and attachment headers),
                         socket.ts (the page socket hub), static.ts, paths.ts (resolveInside,
                         resolveWritableInside, assertRepoPath)
```

`test/` has one folder per source folder and a test file per module with behaviour of its own; a few modules are
covered through the module that drives them (for example `agents/policy.ts` through the guard, `runtime/clock.ts`
through the clocks built on it, `http/socket.ts` through `test/http/server.test.ts`); every EngineApi group is
tested through the real gates in `test/http/routes/`, whose harness builds the web handler over fakes.
`test/e2e/` runs the whole server against scripted agents; `test/e2e/soak.test.ts` kills a real `shinsa` process at
random points of a task's life; `test/http/fuzz.test.ts` throws malformed requests and socket messages at it.
`test/live/smoke.ts` (`bun run test:live`) uses real Claude agents and costs tokens, so it is never part of
`bun test`. `docs/engine.md` → Testing says what each suite covers.

## Rules

- **The foundation is Effect; the rest calls it through an edge** (`docs/engine.md` → The Effect runtime). Config,
  the log, the shell, the store, the data folder lock and `startShinsa` are services with layers, written as the
  `effect` skill says: a folder per module, its shapes, tagged errors and limits in `schema.ts`, one service in
  `service.ts`. The services the next moves build on:

  | Service | Layer | What it gives |
  |---|---|---|
  | `EngineConfig` (`config/service.ts`) | `EngineConfig.layer(env, bundle)` | `ServerConfig`, read once; a bad setting dies with `SettingInvalid`'s message |
  | `JsonLogger` (`log/service.ts`) | itself | the JSON line logger for `Effect.logInfo` / `logWarning` / `logError` with `Effect.annotateLogs` |
  | `Shell` (`shell/service.ts`) | `Shell.layer`, needs `BunServices.layer` | `run(request)` → `CommandResult` or `CommandNotFound`; `stopTree(pid)` |
  | `Events`, `Outbox`, `Receipts`, `Briefings`, `Snapshots`, `LogMigrator`, `CommandLog` (`store/`) | `StoreLayer(path)` | the event log's tables on one `SqlClient`, every row decoded |
  | `Evidence`, `Attachments` (`store/`) | `Evidence.layer(dir)`, `Attachments.layer(dir)` | the files beside the log |
  | `ServeLock` (`instance/lock/service.ts`) | `ServeLock.acquire(dataDir, owner)` in a scope, or `ServeLock.layer` | `data/serve.lock`, tried at most three times while a stopped holder's file is taken over (`TAKEOVER_SCHEDULE`), and given back when its scope closes; `ServerRunning`, `LockContended` |
  | `JsonFile` (`files/service.ts`) | `JsonFile.layer` | the JSON files Shinsa keeps: `read(path, schema)` → `Option` or `JsonFileUnreadable`, `keepAside`, an atomic `write`; `JsonFileWriteFailed` |
  | `Git` (`git/service.ts`) | `Git.layer`, needs `Shell` and `BunServices.layer` | `attempt`, `run` (`GitFailed`, `LOCK_RETRY` on a held index.lock), `read` (raw bytes, caps, timeout, abort) |
  | `Checkout`, `Remote`, `History`, `CodeFiles`, `LeftoverProcesses` (`git/`) | `GitLayer` (`git/layers.ts`), needs `Shell` and `BunServices.layer` | worktrees and commits; pushes (`PushError`), the base and bundles; refs, changed files and diffs; the Code tab's reads (`CodeReadFailed`); processes left in a worktree |
  | `GitHubProcess`, `GitHubCli`, `PullRequests`, `RepoCiReader`, `PullRequestDescriber` (`github/`) | `GitHubLayer` (`github/layers.ts`), needs `Shell`; a test gives `GitHubProcess.layerTest(answer)` instead | gh with its timeout, gh's answers decoded (`GitHubFailed`, `GitHubAnswerInvalid`), pull requests (`MergeMethodInvalid`, `NoGitHubRemote`), CI, the description |
  | `FeedbackIssues` (`feedback/issues/service.ts`) | `FeedbackIssues.layer`, needs `GitHubLayer` | opening a feedback issue and reading your issues' states through `GitHubCli` (`FeedbackAnswerInvalid` for an answer without a link or a list) |
  | `RepoFolders`, `RepoSetup`, `GitHubLogins` (`repos/`) | `ReposLayer` (`repos/layers.ts`), needs `GitLayer` and `GitHubLayer` | finding repositories and their origin, the setup check, the GitHub login |
  | `WorktreeWorkspaces`, `MainCheckoutWorkspace` (`workspaces/`) | `WorkspacesLayer` (`workspaces/layers.ts`), needs `GitLayer` | the two places agents work (`TaskCheckoutMissing`, `CheckoutDirty`, `CheckoutOffBranch`) |
  | `CheckRunner`, `BaseCheckoutPools`, `SharedCaches` (`checks/`), `TaskCoverage` (`test-coverage/`) | `ChecksLayer` (`checks/layers.ts`), needs `GitLayer` | checks, their re-runs and base comparison, the turbo cache, changed-line coverage (`CoverageReportUnreadable`) |
  | `ExtensionDiscovery`, `ExtensionFiles`, `McpClients`, `ExtensionUsage` (`extensions/`) | `ExtensionsLayer` (`extensions/layers.ts`), needs `JsonFile` | what Claude Code, Codex, plugins and repositories set up, decoded; extensions.json and the usage cache; scoped MCP clients and timed calls (`McpServerFailed`); when each server and skill was last used |
  | `AccountRegistry`, `AccountFolders`, `UsageApi` (`accounts/`) | `AccountsLayer` (`accounts/layers.ts`), needs `JsonFile` | the accounts' JSON files decoded, each account's Claude folder, Claude's usage over `HttpClient` (`UsageReadFailed`) |
  | `NpmRegistry` (`versions/registry/service.ts`) | `VersionsLayer` (`versions/layers.ts`) | the latest version of a package, decoded (`NpmRegistryFailed`) |
  | `SecretFiles` (`secrets/files/service.ts`) | `SecretFiles.layer`, needs `JsonFile` | secrets.json decoded, a file without a salt kept aside |
  | `TerminalFiles`, `TerminalPty` (`terminals/`) | `TerminalsLayer` (`terminals/layers.ts`), needs `JsonFile` and `Shell` | data/terminals/ decoded by schemas; the PTY as a scoped resource, the foreground program, a free port (`PortUnavailable`) |
  | `HttpServices` (`http/services/service.ts`) | `makeEngineHandler(services)` (`http/app.ts`), scoped | what every `EngineApi` handler calls; the handler is `HttpRouter.toWebHandler` over the groups, `Ingress` and `EngineGateLive` |
  | `EngineClient` (`cli/client/service.ts`) | `EngineClient.layer({ base, wake, fetch })` | `HttpApiClient` over core's `EngineApi`, waking the engine once; `createEngineCalls` the same calls as promises |
  | `Serve` (`serve/service.ts`) | `Serve.layer(config, options, stop)`, scoped | one engine; its finalizers are the shutdown order; fails with the lock's `ServerRunning` or `LockContended`, which `startShinsa` turns into its `DomainError` |

  Code not moved yet keeps its old calls, which are now edges: `log.*`, `resolveConfig`, `runCommand`, the kill
  helpers, `writeJsonFile`, the functions of `git/`, `github/`, `repos/`, `checks/` and `test-coverage/`, the
  terminals' store and PTY, the extensions' discovery, health and usage, the accounts' and secrets' stores, the npm
  registry, Eunoe's forwarder and threads, the resource poller, the setup draft, triage's classifier timeout, the
  briefing's debounce and `Workspaces` run through `edgeRuntime` (`runtime/edge.ts`, `runSync` for logs and config,
  `runPromise` for processes); `Extensions`, `Versions`, `ResourceMonitor`, `EunoeServer`, `Accounts` and
  `Terminals` stay the objects their callers hold;
  `EventLog`, `EvidenceStore` and `AttachmentStore` each own a `ManagedRuntime` over their layer and `runSync` it;
  `acquireDataDirLock` builds `ServeLock` in a scope of its own. Each edge throws the errors and messages it threw
  before. A module that moves to Effect yields the service instead and stops calling its edge; once nothing calls an
  edge it is removed. Never add a new caller of an edge from Effect code, and never a second implementation of a
  service: a test replaces what the service stands on (SQLite in memory, a temp folder), not the service.
- **Effects report back as commands.** An effect never writes state; it dispatches `run.end`, `pull_request.record`,
  `effect.fail` and so on. One that gives up becomes a failure gate when its kind has one, never a silent log line
  (`docs/engine.md` → Guarantees).
- **A failure that is not the outside world's is not thrown.** A deterministic failure (a pre-push hook rejection, a
  conflict while updating onto the base) is reported as a command and the effect settles, so the outbox never
  retries it; one that is never worth retrying fails with an `EffectFailed` with `retryable: false`; and every retry of a
  push is reported to its task (`reportRetry`). No push skips the repository's hooks (`docs/engine.md` → Pushing the
  branch).
- **Every command the server sends gets a fixed id from its cause** (`Engine.dispatch(command, { id })`), unique for
  distinct causes and identical for a repeat, naming everything the decision depends on; the list is
  `docs/engine.md` → Command receipts → Deterministic server ids.
- **Timers that fire from state extend `StateClock`** (`runtime/clock.ts`; `MonitorClock`, `ScheduleClock`,
  `UsageResumeClock`). The subclass lists what is due (`listEntries`); the base keeps one timer fiber for the
  earliest (`runtime/clock/service.ts`), re-armed on every state change and kept when the earliest due time stays
  the same, fires each due entry once at a time, and skips an entry core refused with a
  `DomainError`, or answered with no events (`refuse`), until it leaves `listEntries`, so a refused or no-op command
  is never sent again and again.
- **Effects can be cancelled.** A running effect's fiber is interrupted when a decision cancels it or the server
  stops, so it takes no step after the cancel (a merge, a push, opening a pull request). A handler calls code not yet
  moved to Effect through `EffectWorld.bridge`, which passes the commands it runs (checks, the push, `gh`) an
  `AbortSignal` the interrupt aborts; a pair of steps that must happen together (a commit and its record) is
  `Effect.uninterruptible`.
- **Effects that touch the outside world must be safe to run twice** (a worktree is reused, an open pull request is
  reused, a merge reads GitHub first): replay-safe effects run again after a crash (`docs/engine.md` → Recovery).
- **Rounds share the task's worktree and push where their round says** (`docs/engine.md` → Rounds): a later round's
  worktree is never reset to the default branch (only its uncommitted scratch edits are dropped), a push goes to the
  task's branch, which a stacked round has changed to its own, a pull request opens on the round's base
  (`resolveRoundBase`, the task below's branch for a task in a bundle), and a merge merges the stack below the task's
  pull request top down (`listStackedPullRequests`), reading each first; a bundle's root merges the tasks above it
  from the top down, then itself (`pull_request.merge`'s `bundle`), after `checkBundleMerge` (`git/bundle.ts`) has
  merged the whole bundle into the default branch in git, which the watch also runs on the root and records
  (`bundle.record_check`, `docs/engine.md` → Bundles).
- **The pull request watch reads, core decides**: the server dispatches a read only when `evaluatePullRequestWatch`
  (core) says it matters, and syncs of one task queue behind each other (`docs/engine.md` → The pull request watch).
- **The HTTP surface is for this machine only.** Every route is declared once in core's `EngineApi` and passes
  `Ingress` and the `EngineGate` middleware (`http/ingress/`, `http/gate/`; what they check, and the routes that
  skip part of it, are `docs/engine.md` → Who can change Shinsa); never answer a request outside them. `parseUserCommand` (core) is the single
  gate for commands from outside: it accepts only `UserCommand` types and checks each field by field; never add an
  allowlist of your own. A socket message needs a string `id` or `runId`; request bodies are capped at 8 MB (an
  attachment upload at the base64 of 25 MB, `ATTACHMENT_REQUEST_LIMIT_BYTES`), by `Content-Length` and again by the bytes the gate reads, a route's cap its `bodyLimit` annotation; files are read through `resolveInside` (real paths, so a symlink cannot leave the
  worktree) and evidence by plain name only.
- **Human-only decisions have no agent path**: a `humanOnly` spec is left out of the agents' tools
  (`listAgentSpecs`) and its `shinsa` command is refused in an agent's shell (`agents/policy.ts`), and so are
  `shinsa settings set` naming one of core's `HUMAN_ONLY_SETTINGS` and `shinsa repos update` changing the
  repository's check commands, workspace or coverage;
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
- **No browser an agent starts opens a window, and its screenshots are Retina sharp.** Every stdio MCP server a run
  or a health check starts, and the `claude` and `codex` processes themselves, get `resolveBrowserEnv`
  (`extensions/definitions.ts`): `PLAYWRIGHT_MCP_HEADLESS=true`, which `@playwright/mcp` reads (without it the server
  is headed on a Mac), and `PLAYWRIGHT_MCP_DEVICE=Desktop Chrome HiDPI`, a device scale factor of 2, so a screenshot
  taken with `scale: "device"` has two pixels per CSS pixel. The device is left out when the server already chooses
  one or attaches to a browser (a device, mobile, CDP or extension option in its environment or arguments).
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
- **Where a run works follows its role** (`resolveWorkspace` in `agents/supervisor/workspace.ts`): the answerer, a watchdog check
  and a read of a data source (purposes `watch` and `intake`) in the repository itself, the researcher in the task's worktree when it has one and otherwise the repository, every other role in the
  task's worktree. Edits a read-only run leaves (the agent's while it plans included) are set aside, never in the
  repository itself: that is the human's own checkout. Setup verification asks for a default branch only when the
  pipeline needs a worktree, and never for check commands (`runtime/effects/setup/service.ts`); a worktree reused
  before any phase report is reset, which is how an investigation's scratch edits are dropped before its fix is
  planned.
- **One agent at a time in a worktree.** `RunSupervisor` registers a run before it waits, and a run waits only for the
  runs of its task that registered before it (60 s, then they are cancelled, and a run still not settled `stopMs`, 15 s,
  later is dropped with a warning). Checks and pushes wait for all of them. No wait on a session is unbounded: a
  Claude session kills its `claude` and every process it started `EXIT_GRACE` (10 s) after its turn ends the prompt
  queue, and its `cancel()` gives `interrupt()` `INTERRUPT_TIMEOUT` (5 s) (`agents/providers/claude/session/schema.ts`,
  `process.ts`, `killProcessTree` in `shell/`).
- **A run is a fiber in its run scope.** The `RunSupervisor` service (`agents/supervisor/service.ts`) forks the run's
  turn and records the fiber on its `ActiveRun`; the run's scope, opened with that fiber, gives it `stopMs` to finish
  when someone else closes the scope and then interrupts it; a run that executes again under a scope it kept for its
  delegations swaps in its new fiber. `run.cancel` closes the run's scope, which cancels its
  session and every delegation below it, then the fiber; shutdown marks every live run interrupted, waits
  at most `stopMs` and closes every task's scope. A new step of the run loop is an `Effect.fn` in `agents/supervisor/`
  over `RunWorld` and `RunHost`, never a method on the class edge, and held runs and the shutdown flag live in
  `RunHost`'s control `Ref`.
- **Workspaces go through their strategy.** Making, committing in, pushing and removing a task's checkout goes through
  `Workspaces.resolve(task)` (`workspaces/`), never through `git/` directly, and every place shares the one
  `Workspaces` the supervisor owns (`runs.workspaces`).
- **The two-hour clock stops while a question is open**, counted per question, so parallel `ask` calls cannot
  double-count the pause or leave a stray timer.
- **Shutdown order.** `startShinsa` runs one `ManagedRuntime` over the `Serve` layer (`serve.ts`), and `stop()`
  disposes it: each start step in `serve/service.ts` adds its release as a finalizer, so closing the scope runs them
  in reverse of the start, which is this order (`docs/engine.md` → The Effect runtime). A start that fails disposes the
  runtime too, so the lock, the port and the log are given back; a second `stop()` waits for the first. The work's
  own stop (`stopWork` in `serve/wiring.ts`) interrupts every live run first (`RunSupervisor.interruptForShutdown`, which waits at
  most `stopMs` for the sessions and marks a run dispatched while stopping instead of starting it), then stops
  the pull request syncs, the clocks and every running effect, and waits for them and for every running effect
  handler (`Engine.settle`) before it closes
  the log, so no `claude`, check or `gh` outlives the server (`docs/engine.md` → The agent loop → Restart
  continuation). Eunoe's forwarder stops after the effects, once no `claude` can still talk to it. Once HTTP has
  stopped, `disposeRuntime` (`serve/wiring.ts`) releases the `EffectRunner`'s and then the `Engine`'s own
  `ManagedRuntime`, before the log closes, so no fiber of theirs outlives the engine. Your terminals' shells
  are hung up before the clocks stop, and their screens saved. Anything new that starts a process or a timer is
  stopped there too.
- **Hand-overs are validated here** (`agents/handover.ts`, `assertProtocol`): a plan, report or findings list that
  breaks the protocol is returned to the agent as a tool error listing every problem, and nothing reaches the event
  log. Evidence is checked by core's `validateEvidence` (`storeEvidence`): exactly one of a path (absolute or relative
  to the worktree, at most 200 MB), an http or https URL, or text; a test or check takes only a check id and is
  dispatched as `agent.attach_check`, with nothing stored.
- **Code reads are pinned and confined** (`http/routes/code`, `docs/engine.md` → The Code tab's reads): only the task's
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
  has a command-line path fails until it does), and anything the web can do that is not a command gets an
  endpoint in core's `EngineApi`, its handler in `http/routes/<group>` and a spec that calls it through `calls`. The agents' management tools and `docs/cli.md` (`bun run
  docs:cli`, checked by a test) follow from the specs; never hand-write one.
- **Providers.** The supervisor never names a provider: it talks to one only through `AgentProvider`
  (`agents/providers/types.ts`) and branches on its `capabilities`, never on its id. A new provider is a folder under
  `agents/providers/` and one entry in the registry; the supervisor, tools, transcripts, handover and the web do not
  change. Account rotation and usage-limit resume hang off the supervisor's rejection seam (`onRejection`), which
  owns the only retry budget, not off the provider (`docs/engine.md` → Providers, The agent loop).
- **Machine config versus events**: a value replaying the log must reproduce is a `settings.change` event, one that
  only describes this machine is `config.json` (`docs/engine.md` → Configuration and data).
- Never edit the data directory while the server runs.
- **One server per data directory.** `startShinsa` takes `data/serve.lock` as the scoped `ServeLock` layer before
  anything opens the log, and the scope gives it back after the log is closed, in `stop()` or at once when the server
  cannot start. Code that starts a
  second engine on a data directory in one process (a test that simulates a restart) stops the first through
  `stop()`, or builds the pieces itself as `test/e2e/harness.ts` does.
- **Spawned programs inherit the server's environment**, which `shinsa engine` fills in from the login shell before
  anything starts; never read the shell profile again elsewhere, and pass a command's own variables through
  `runCommand`'s `env`.

## Testing

- **Tests need no network and no real agents.** `test/helpers/preload.ts` gives every test a clean git identity, the
  fake `gh`, `open` and `launchctl` on `PATH`, `SHINSA_QUICK=off`, a scratch `CLAUDE_CONFIG_DIR` and `SHELL` set to
  the fake login shell (`test/helpers/bin/login-shell`: `FAKE_LOGIN_SHELL_EXPORT` adds variables and a `PATH` entry,
  `FAKE_LOGIN_SHELL_HANG`, `FAKE_LOGIN_SHELL_SILENT` and `FAKE_LOGIN_SHELL_LOG` hang, fail or record the call,
  `FAKE_LOGIN_SHELL_EXEC_INTERACTIVE` prints nothing for `-lic`, as a `.zshrc` that execs fish does; a fake fish
  in `test/helpers/fish`, off the `PATH`, that `FAKE_FISH_SILENT` fails and `FAKE_FISH_LOG` records);
  `test/helpers/bin` also holds fake `claude`, `codex` and `cswap`, so no test runs the real ones,
  `test/helpers/anthropic.ts` is the Anthropic API Eunoe's forwarder talks to in tests, and nothing reaches the real launchd. `test/helpers/mcp` has an MCP server over HTTP (`http.ts`) and over stdio (`stdio-server.ts`). The Claude adapter takes a `ClaudeRuntime` (`runQuery`,
  `resolveExecutable`; `createFakeRuntime` in `test/helpers/query.ts`). Inject fakes through the optional last
  parameters (`startSession`, `providers`, `triage`, `resolveLogin`, `ask`, `runQuery`, `launch`, `discover`,
  `runPrerequisite`, `accounts`, `accountOptions`).
- **A test leaves no process running.** Every fake `gh` and `codex` and the MCP stdio fake registers itself
  with the preload, and a test that ends with one still running fails (the stray is killed): stop and await the work that runs it (`await runner.stop()`,
  `engine.settle()`). The fake `gh` gives up on a state folder that is gone and breaks a lock its killed holder left
  behind.
- **A test leaves no folder behind.** The preload points `TMPDIR` at a folder of the run's own, removed when the run
  ends, and removes every `createTempDir` folder after each test (`test/helpers/temp.ts`). A hook lives in the
  preload or a test file: Bun never runs an `afterEach` that a helper module registers. Leftover folders slow every
  test that starts a fake: Bun reads each folder above its working directory when it starts, so a `TMPDIR` holding
  a hundred thousand of them adds a second to each fake `gh` or `codex`.
- **A test starts as few processes as it can.** Under load each one costs about a second, so a test that runs one
  scenario after another through the fake `codex` passes a runtime or runner that answers in process where the
  scenario is about Shinsa's reading (`readCodexLogin`'s runner, a `resolveExecutable` that says what it found), and
  gives each scenario that needs the fake its own test (`test.each`).
- **The fake `gh` and the test share one lock.** Each fake `gh` holds `<state>.lock` from the moment it reads its state
  file until it writes it back, and `FakeGitHub` (`test/e2e/harness.ts`) takes the same lock for `update` and
  `configure`, so a test's change made while a `gh` runs is never written over. `FAKE_GH_HOLD_MS` keeps a `gh`
  holding it for that long, for a test that needs the overlap (`test/helpers/gh.test.ts`).
- The fake `gh` answers `pr view` with a `mergeCommit`: the one a test puts on the pull request, or the head's sha
  once it merges one, so a test can follow a task past the merge (the operation gate shows that commit).
- **Tests wait on conditions, never on time.** Use `awaitEffect(log, key)` from `test/helpers` (keys come from
  `log.listEffectStatuses()`, or are fixed: `run.execute:<runId>`, `run.cancel:<runId>`), a deferred the fake
  resolves, `until(condition)` for another process or the file system, or `captureLogs()` (`test/helpers/logs.ts`,
  the JSON lines the logger wrote, `fieldsOf(message)`) for a failure that is only logged: `spyOn(log, …)` sees only
  calls through the edge, never an `Effect.log*`. A `Bun.sleep` that decides whether a line runs makes the coverage floor fail on a busy machine.
- **Wait for what the test reads next, never for a stage a task passes through.** A task can go through `building`
  and `checking` in a few milliseconds, and a polled `untilStage` on a loaded machine sees only the stage after them:
  wait for an agent session count (`world.agents.of('plan').length === 2`), a gate, or a stage the task rests in.
  `until` and `World.until` time their deadline with `performance.now()`, because `setSystemTime` freezes
  `Date.now()`; a wait of your own does the same.
- **A test file that starts the whole server** (`test/e2e/`), or drives a pull request through many fake `gh` calls
  (`test/runtime/effects.test.ts`, which gives those waits 25 s), sets `setDefaultTimeout(30_000)`: alone it takes a
  second, but `bun run test` runs every workspace at once and Bun's own 5 s limit then fails it at random.
- **Scripted agents are keyed by what a run does**: `FakeAgents.queue` and `of` take the round agent's purpose
  (`plan`, `build`, `fix`, `operate`, read from the live run through `agents.state`, or from the prompt and the
  session's last step when no state is wired, as in the soak child) or any other role (`reviewer`, a delegated
  `planner` or `builder`); the fake `codex` picks its script the same way, `plan` by the read-only sandbox.
- `SHINSA_SETTLE_DELAY_MS` sets how long the watch waits before it reads a pull request Shinsa just pushed to or
  opened (15 s); tests set it low.
- `SHINSA_PUSH_RETRY_MS` sets how long a push waits before it tries an unreachable remote again (30 s,
  `config.pushRetryMs`); the test config sets it to 10 ms.
- `SHINSA_OVERLOAD_RETRY_MS` sets the first wait before an overloaded turn is tried again (15 s, doubled for each of
  the three retries, `config.overloadRetryMs`); the test config sets it to 10 ms.
- **Effect services are tested through `runTest`** (`test/harness.ts`): it provides `JsonLogger`, `Shell` on
  `BunServices` and `StoreLayer(':memory:')`, so a service test runs the real service on SQLite in memory and real
  processes in a `createTempDir` folder (`test/config/service.test.ts`, `test/shell/service.test.ts`,
  `test/store/service.test.ts`, `test/instance/lock-service.test.ts`). A scoped layer a test builds is closed by the
  test (`Effect.scoped`), so no lock, process or file outlives it.
- `bun run test` fails below 100% line and function coverage (`bunfig.toml`).
