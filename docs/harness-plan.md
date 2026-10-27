# Harness plan: the best of Kanna, T3 Code and Paperclip

Shinsa's harness takes what is already proven elsewhere instead of reinventing it. The agent loop
and its reliability come from **T3 Code** and **Kanna** (the user's fork, `local` branch); process
and structure come from **Paperclip**. Code is adapted to Shinsa's architecture, never pasted, but
every behaviour, guard and edge case listed here must exist, with tests, at the same or better
reliability. Each item names its source so the origin stays traceable; this file is the only place
that keeps those references. What each feature does now is `docs/engine.md`; how far each is built is
the status at the end.

References: Kanna at `~/Developer/Projects/kanna/src/server`, T3 at `/tmp/refs/t3code`
(`apps/engine/src/orchestration-v2`, `packages/provider-core`), Paperclip at `/tmp/refs/paperclip`,
claude-swap 0.26 at `~/.local/share/uv/tools/claude-swap/lib/*/site-packages/claude_swap`.

## WS1 Agent loop (T3 + Kanna)

1. **Turn result classification** (T3 `ClaudeAdapterV2.ts:2967-3229`; Paperclip `detectClaudeLoginRequired`,
   `parse.ts:13-20`). Every failure class from `terminal_reason`, `api_error_status` and the error text, an abort
   reported as success counted as interrupted, and a stream with no terminal result failing the run.
2. **Resume fallback** (Kanna `session-artifacts.ts`, `prepareSessionRestore`, `handoff.ts`; T3
   `ProviderTurnStartService.ts:675-760`, `CLAUDE_CONFIG_DIR` at `:820`; Paperclip `isClaudeUnknownSessionError`).
   Check the session file before resuming; a missing or dead session starts fresh with a budgeted handoff that
   refuses rather than truncates; a dead session id is never resumed.
3. **Restart continuation** (Kanna `resume-turns.ts`, `interruptForShutdown`; T3 `RestartContinuation.ts`).
   Shutdown marks live runs; one resume per shutdown, question waits skipped, 3 continuations in 5 minutes,
   Kanna's carry-on prompt; a crash goes through bounded recovery, never resumed forever.
4. **Steering** (Kanna `takeAnsweredClaudePrompts`, the steer prefix; T3 `Orchestrator.ts:5021-5130`). Prompt ids
   matched by echo, never counted; too late to steer becomes the next turn.
5. **Executable discovery** (Kanna `claude-executable.ts`). The user's `claude`, a minimum version from the SDK,
   a `CLAUDE_EXECUTABLE` override, a cached `--version`.
6. **Transcript normaliser** (Kanna `agent.ts:640-855`). Subagent output tagged, compaction, interrupted results,
   context-window usage, the account, rate-limit events.
7. **Quick calls** (Kanna `quick-response.ts`; Paperclip's decision models). Structured output with a 20 s
   timeout and a provider fallback chain; typed choice questions for triage.
8. **Run attempts and conditional writes** (T3 `EventSink.writeIfRunCurrent`). An attempt id per execution; a late
   write from an earlier attempt is ignored.
9. **Providers** (T3's capability matrix, Kanna `HarnessTurn`, `prepareProviderHandoff`). Capability flags drive
   policy, never the provider's name; the provider is recorded per turn and a switch hands the context over.
10. **Codex** (Kanna `codex-app-server.ts`: JSON-RPC over NDJSON at `:303-306` and `:1280-1330`, `initialize` and
   `initialized` at `:972-983`, `thread/start`/`thread/resume`/`thread/fork` with the recoverable resume falling
   back to start at `:986-1046` and `isRecoverableResumeError` at `:311-317`, `turn/start` with `collaborationMode`
   and `developer_instructions` at `:1106-1125`, `turn/interrupt` at `:1150`, `failContext` on close and `SIGKILL` at
   `:1249-1317`, `error` with `willRetry` at `:1895-1919` (`handleErrorNotification` `:1905`), `turn/completed`, `thread/tokenUsage/updated` and
   `thread/compacted` at `:1522-1541`; `kanna-mcp.ts` for the localhost MCP endpoint: bearer token, refused
   Origin, progress heartbeat; `provider-auth.ts:457-503` for the `codex` version and `codex login status`; T3
   `CodexAdapterV2.ts:237-330` for the capability values and `:1131` plus `:4530-4620` for the failure
   classification, `usageLimitExceeded` included). A second provider behind the same interface: sessions with resume,
   steering, cancel, Shinsa's tools over HTTP MCP, read-only roles in the read-only sandbox, failure classes, usage
   metering, context and compaction notices, a minimum version, structured quick calls, models and sign-in.
11. **Provider parity** (CodexBar, https://github.com/steipete/CodexBar, MIT: `docs/codex-oauth.md` and
   `Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift` for reading Codex's usage from
   `auth.json` and `wham/usage`, `chatgpt_base_url`, the windows, the extra limits and `credits`, and
   `ClaudeOAuthUsageFetcher.swift`'s `extra_usage` for Claude's usage credits; Kanna `codex-app-server.ts:1505-1561`
   for following the threads of the agents Codex spawns). Everything Shinsa does on Claude also works on Codex: a
   price table and a cost for every run, the same Compaction setting and idle compaction, the agents Codex starts in
   the step's turn, usage windows feeding waits, auto-resume and the usage limit per task, one "Agent usage" for
   every provider, a Sign in gate, and fast mode only on usage credits the account has (`docs/engine.md` → Cost,
   Providers, Compaction and fast mode, Accounts and usage limits).

## WS2 Accounts and limits (own implementation, modelled on claude-swap + Kanna + T3)

Shinsa manages Claude accounts itself instead of shelling out to claude-swap, so accounts can be bound to work and
resumed automatically. Sources: claude-swap (how it stores logins: `oauth.py:43-59` single-use refresh tokens,
`session.py:232-243` the keychain entry, `session.py:825-892` seeding `cswap run`, `transfer.py:164-313` export;
reading usage: `oauth.py:364-374`, `macos_keychain.py:115-131`, `usage_store.py:524-814`; picking:
`oauth.py:505-561`), Kanna's archived implementation (tag `archive/claude-accounts`: `claude-accounts.ts:9-25`
per-account `CLAUDE_CONFIG_DIR`, `:30-38`, `:45-54`, `:206-231` shared entries; `provider-auth.ts:1149-1211` the
login PTY), Kanna's reactive retry (`claude-swap.ts`, `agent.ts:305-313`, `:3101-3195`
`retryClaudeTurnOnFreshLogin`) and `usage-limits.ts:351-372`.

1. **Accounts.** Each account its own `CLAUDE_CONFIG_DIR`, added with a guided login, listed with email, plan and
   usage; different runs on different accounts at once.
2. **Binding.** A task (or a run) bound to an account; the account recorded per turn ("Account switched" rows).
3. **Picking and rotating.** The most headroom (model windows such as Fable counted); on a rejection, one try per
   account, at most 3, other runs kept off the spent account, the same turn retried.
4. **Usage-limit auto-resume** (T3 `UsageLimitRecoveryWorker.ts:11-72`, the loop guard at `:28-33`). Arm on
   `resetAt`, resume under a deterministic id, guard expired windows; settings for auto-resume, snooze, thresholds.
5. **Usage limits** (Kanna `usage-limits.ts`). Per-account windows, pushed events merged, a 60 s cache, a failed
   read never erases data; shown in the UI and Settings.
6. **Login needed** (Paperclip `detectClaudeLoginRequired`, `run-liveness.ts:326-328`; Kanna `provider-auth.ts`).
   An expired login opens a Sign in gate for that account instead of failing the run.

## WS3 Process and structure (Paperclip `doc/execution-semantics.md`)

1. **Plan approval bound to a version**, revisions kept with a change summary.
2. **Review rounds escalate to you** instead of failing.
3. **Liveness with typed waits and leaf tracing.**
4. **Monitors**: a `wait_for` tool (`check_in_minutes`, `notes`, `timeout_minutes`, `max_attempts`) that ends the
   run and checks again later; sleeping in a shell is not liveness.
5. **Cost and tokens** per run, rolled up per task, phase and role; an optional soft cap.
6. **Silent-run signal** (5 and 15 minutes), informational, with snooze and dismiss.
7. **Recovery fingerprints**: budgets keyed to durable state, so prose never resets them.
8. **Structured questions** and **per-finding verdicts**; a newer message makes an older question historical.
9. **Ask mode**: a task that only answers.
10. **Suggested tasks** (`suggest_tasks`).
11. **Setup verification before dispatch**: repository, default branch and checks verified before any agent.

## WS4 Engine hardening (T3)

1. **Command receipts** (T3 `Orchestrator.ts` `dispatchWithReceiptEffect`, `EventSink.ts`, `CommandReceiptStore.ts`):
   every command has an id, a repeat is answered, a reused id refused, rejections recorded, server ids
   deterministic.
2. **Outbox** (T3 `EffectOutbox.ts`, `EffectWorker.ts`): replay-safe effects requeued on boot, process-bound ones
   cancelled, cancellable effects, a side lane, `awaitSettled`.
3. **PR watch** (T3 `pullRequestWatch.ts`, `PullRequestWatchReactor.ts`): per-check diff, required-gate growth,
   the comment watermark, `unknown` never clears a conflict, a 10-wake limit, 8 read failures stop the watch.
4. **Merge queues**: a queued PR is waiting, not failed.

## WS5 Onboarding

A chat-based setup with a fixed list of questions; a model reads the free answers into settings (folders, default
model, merge method, accounts) and the prerequisites are checked. No hard-coded roots anywhere.

## WS6 Orchestration and delegation (T3 orchestration v2 + Kanna sub-chats + Paperclip)

Sources: T3 `mcp/toolkits/orchestrator/tools.ts:68` `delegate_task`, `Orchestrator.ts:6895`
`dispatchDelegatedTaskRequest`, `:10587`/`:10886` `finalizeAppOwnedSubagent*`, `:10543` delivery cohorts, `:12045`
`recoverDelegatedTask`, `DelegatedTaskQuestionReactor.ts`, `DispatchModeLimit.ts`,
`provider-core/.../orchestrationInstructions.ts:8`; Kanna `orchestrator.ts:99` `MAX_CHAT_DEPTH`, `:101`
`MAX_LIVE_CHATS`, `:1131` adoption, `:1943` `maybeReport`; Paperclip `doc/execution-semantics.md:349` blockers,
`:365` couriers, `:379` exact-once decomposition.

1. `delegate_task` (async or wait), `delegation_status`, `delegation_cancel`; a child starts from its brief alone; deterministic
   ids; each review round a fresh delegation.
2. Results pushed into the parent's turn (steered, else queued), cohorts with generations, priority delivery; a wait
   that times out switches to waking the parent.
3. Child questions route to the parent; a child is never broader than its parent; worktree isolation from the
   parent's commit.
4. Kanna's limits (depth 3, 8 live), batching, adoption, cancel cascades; Paperclip's couriers and blocker.
5. Restart recovery for delegations.

## WS7 Triggers, idle sessions and notifications (Kanna + T3)

1. **Schedules** (Kanna `schedules.ts` `computeNextRun`, `ScheduleRunner.tick`, `orchestrator.ts:1371`
   `setSchedule`, `:1546` `runDueSchedules`/`fireSchedule`; T3 `ScheduledTaskService.ts`: an edit keeps
   `next_run_at` `:1082`, re-read before firing `:754`, the escape-hatch terminal record `:691`, stuck-row recovery
   `:984`, which needs no counterpart because a fire is one command; `Schedule.ts`). Once, interval and daily with
   weekdays in the schedule's time zone; a missed run fires once; skipped while the last one is live; 20 runs kept.
2. **Webhooks** (T3 `webhookRoute.ts`, `webhookVerification.ts`, `webhookDedupe.ts`, `webhookTemplate.ts`,
   `ScheduledTaskService.ts:1700-2000`). A token URL, an optional HMAC signature with the secret outside the event
   log, replay-key dedupe, a rate limit, a body cap, untrusted framing.
3. **Secrets** (T3 `secrets/SecretRequests.ts`). `request_secret` through a password field; only a one-use ref
   reaches the log, the transcript and the model.
4. **Idle release** (T3 `ProviderSessionManager.ts:56` 30 minutes and the 4-hour pin, `:1110` `releaseIfStillIdle`,
   `:1158` `scheduleIdleReleaseInternal`, `:1204` `touchActivity`). A session waiting on you is released and your
   answer resumes it.
5. **Idle compaction** (T3 `orchestration-v2/IdleCompaction.ts`, `IdleCompactionService.ts`). A finished
   session near its context limit compacted just before its prompt cache expires (off by default, and only with
   Claude Code's compaction).
6. **Notifications** (Kanna `chatSounds.ts`, `chatBrowserNotifications.ts`, `chatNotifications.ts`, `App.tsx:463`
   and `:515`). Web Audio sounds, browser notifications, the "[n] Shinsa" title and Floaty meta tags.

## Status (2026-10-23, after the finishing round)

Every item is built. Paths are under `packages/core/src` (core), `apps/engine/src` (engine) and `apps/web/src` (web).
The last column says where the build differs from the plan on purpose, in one line each.

### WS1 Agent loop

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| 1 Classification | Built | server `agents/providers/claude/classify.ts` (`resolveClaudeVerdict`), `session.ts` | |
| 2 Resume fallback | Built | server `providers/claude/artifacts.ts`, `agents/turns.ts` (`resolveTurnPlan`), `supervisor.ts` (one restore per execution, on any attempt, after a rotation too); core `prompts/handoff.ts` (`resolveHandoff`), `decide/runs.ts` (`recordSessionLost`) | |
| 3 Restart continuation | Built | server `supervisor.ts` (`interruptForShutdown`, `recover`); core `decide/runs.ts` (`continueRun`), `prompts/session.ts` | A crash is continued once as the step's nudge, on the recovery budget; a second crash without progress opens the failure gate (`crash_loop`) |
| 4 Steering | Built | server `providers/claude/session.ts` (`PromptLedger`), `supervisor.ts` | A message in the stop window is delivered as the next run, which waits for the stopping one (up to 60 s) |
| 5 Executable discovery | Built | server `providers/claude/executable.ts` | `CLAUDE_EXECUTABLE` is trusted without a version check, since a wrapper may not answer `--version` |
| 6 Transcript normaliser | Built | server `providers/claude/recorder.ts`, `session.ts`; web `lib/chat/timeline.ts`, `notices.ts`, `context.ts` (handoff and compaction rows, the context meter) | |
| 7 Quick calls | Built | server `agents/quick/index.ts` (`createQuickCalls`: every registered provider, the default first), `quick/decide.ts` (typed `choice` and `choices` questions, used by triage's size and dependencies, the briefing's picks), `triage/`, `briefing/`, `onboarding/` | |
| 8 Attempts | Built | core `decide/runs.ts` (`isStaleAttempt`); server `supervisor.ts` | |
| 9 Providers | Built | server `agents/providers/types.ts` (`ProviderCapabilities`: every flag has a reader), `providers/index.ts` (`ProviderRegistry`), `agents/turns.ts` (handoff on a switch); core `agent-models/index.ts` (`resolveAgentProvider`, a provider per role) | A switch takes effect at the run's next execution, never inside a live turn |
| 10 Codex | Built | server `agents/providers/codex/` (`client.ts` the JSON-RPC client, `session.ts`, `classify.ts`, `map.ts`, `mcp.ts` the HTTP MCP endpoint, `complete.ts`, `models.ts`, `login.ts`, `executable.ts`), `providers/instructions.ts`, `providers/versions.ts`; web `components/settings/agents.tsx` (provider and model per role), `settings/providers.tsx` (the Codex section); test `helpers/bin/codex` (a scripted fake app server), `e2e/codex.test.ts` | A resume Codex refuses is `session_lost` and restored through Shinsa's handoff, not Kanna's silent `thread/start`; writing roles run `untrusted` so the command policy can decline, where Kanna runs `never`; `thread/fork` is not used (Shinsa never forks a run); one Codex login, no rotation |
| 11 Provider parity | Built | server `codex/pricing.ts` and `meter.ts` (cost), `codex/usage.ts` (usage like CodexBar, fast mode credits), `codex/session.ts` and `map.ts` (the agents Codex starts, compaction), `accounts/index.ts` (provider usage, waits, Sign in gate, `readFastMode`), `accounts/usage.ts` (`resolveClaudeFastMode`), `agents/supervisor.ts` and `quick/index.ts` (fast mode only with credits); core `accounts/fast-mode.ts`, `domain/settings.ts` (`hasNativeCompaction`); web `components/accounts/usage-menu.tsx` (Agent usage), `settings/providers.tsx`, `settings/agents.tsx` (Unavailable: needs usage credits), `overview/sign-in-card.tsx` | Shinsa never refreshes Codex's token (CodexBar defers to the CLI too) and falls back to the app server's `account/rateLimits/read` where CodexBar would run the CLI in a PTY; one Codex login, no rotation |

### WS2 Accounts and limits

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| 1 Accounts | Built | engine `accounts/store.ts`, `login.ts`, `paths.ts` (`resolveAccountEnv`), `index.ts` | Your own Claude Code login stays in `~/.claude` (`configDir: null`), so its single-use refresh token never forks |
| 2 Binding | Built | core `decide/accounts.ts` (`bindAccount`), `decide/tasks.ts` (`task.retry` with `account`), `decide/decider.ts` (`bindNextRun`, `run.account`), `state/runs.ts`; engine `agents/accounts.ts`, `accounts/rotation.ts`; web `components/accounts/account-items.tsx` (`RunAccount`: the run label's account and Run this step again on), `lib/command/accounts.ts` | |
| 3 Picking and rotating | Built | core `accounts/pick.ts` (`pickAccount`), `accounts/usage.ts`; engine `accounts/rotation.ts` (spent marks in `data/account-marks.json`), `agents/supervisor.ts` (other live runs on a spent account move at their next turn) | The budget is 3 accounts per execution instead of 3 per 2 minutes, since an execution is the unit that retries |
| 4 Auto-resume | Built | core `decide/accounts.ts` (`waitForUsageReset`, `resumeUsageWait`); engine `accounts/resume.ts` (`UsageResumeClock`) | |
| 5 Usage limits | Built | engine `accounts/usage.ts` (one id per window: `weekly:<model>` from every source), `limits.ts`; web `components/accounts/`, `components/settings/usage.tsx` | |
| 6 Login needed | Built | engine `providers/claude/classify.ts` (login detection); core `decide/accounts.ts` (`requestSignIn`, `recordSignedIn`) | Without a leased account an auth failure is an ordinary failure gate: there is no account to sign in to |

### WS3 Process and structure

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| 1 Plan versions | Built | core `decide/agents.ts` (`proposePlan`), `decide/gates.ts`, `state/project.ts`, `report/plan-changes.ts` | |
| 2 Review escalation | Built | core `decide/fixes.ts` (`reactToFindings`, escalation), `state/reviews.ts` | |
| 3 Liveness | Built | core `decide/liveness.ts`, `queue/stalls.ts` (`traceStalledLeaf`) | |
| 4 Monitors | Built | core `decide/monitors.ts` (a wait out of check-ins or time opens the failure gate, `cause: monitor`); engine `runtime/monitors.ts` (`MonitorClock`), `agents/tools/process.ts` | A fire resumes the waiting run's session instead of a fresh one, so the agent keeps what it knew |
| 5 Cost | Built | core `costs/index.ts`, `decide/costs.ts` (`holdForBudget`); engine `supervisor.ts` (`run.meter`); web task facts | Two per-task caps, a share of the weekly usage window (`taskUsageLimit`) and dollars (`taskBudgetUsd`), both off by default and checked when a step starts: a run is never stopped mid-turn |
| 6 Silent runs | Built | engine `agents/silence.ts`; core `decide/silence.ts`, `queue/silence.ts`; web `components/overview/silence-note.tsx` | |
| 7 Fingerprints | Built | core `decide/fingerprints.ts` | |
| 8 Questions and verdicts | Built | core `decide/gates.ts`, `decide/messages.ts` (`gate.superseded`); engine `agents/questions.ts`; web `components/overview/question-choices.tsx`, `finding-verdicts.tsx` | |
| 9 Ask mode | Built | core `decide/shapes.ts` (`recordDelivery` with step `answer`, the answer shape); engine `supervisor.ts` (runs in the repository) | |
| 10 Suggested tasks | Built | core `decide/suggestions.ts`; web `components/overview/suggestions-panel.tsx` (When to start, the agent's pick first), `lib/tasks/suggestions.ts`, `lib/command/process.ts` | |
| 11 Setup verification | Built | core `decide/config.ts`; engine `repos/setup.ts` | |

### WS4 Engine hardening

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| 1 Receipts | Built | server `runtime/engine.ts`, `store/event-log.ts`; every server sender names its command after its cause (`docs/engine.md` → Command receipts) | Receipts are kept 7 days; a pull request read has no fixed id, since every read is new information |
| 2 Outbox | Built | core `effects/index.ts` (`EFFECT_RECOVERY`, lanes); server `store/event-log.ts` (`reconcileAfterRestart`), `runtime/engine.ts` | No `awaitSettled`: nothing in the server waits for one effect (shutdown waits for all, `Engine.settle`), so it is a test helper (`awaitEffect`); the side lane holds only the pull request watch, since every other per-task effect must keep its order and the briefing is not per task |
| 3 PR watch | Built | core `decide/watch.ts` (`evaluatePullRequestWatch`), `decide/pull-requests.ts` (read failures counted in the log, `PULL_REQUEST_READ_FAILURE_LIMIT`); server `runtime/effects.ts` | |
| 4 Merge queues | Built | core `decide/pull-requests.ts`; server `runtime/effects.ts` (the merge reads first) | |

### WS5 Onboarding

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| Setup steps | Built | engine `onboarding/steps.ts`, `flow.ts`, `prerequisites.ts`, `repos/discover.ts`; web `routes/onboarding.tsx`, `components/onboarding/` | One step at a time, any earlier one open to change; Claude logins imported without asking; every other route locked until setup is complete |

### WS6 Orchestration and delegation

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| 1 Tools and ids | Built | engine `agents/tools/orchestration.ts`; core `decide/delegations.ts` (`requestDelegation`), `prompts/orchestration.ts` | A fresh delegation per review round is an instruction, not enforced: a round is the agent's judgement |
| 2 Delivery | Built | core `decide/delegations.ts` (`planDelivery`, cohorts); engine `agents/deliveries.ts`, `agents/delegations.ts` | Priority means delegated reports go ahead of your queued messages in one wake; there is no priority field |
| 3 Questions, ceiling, isolation | Built | core `decide/delegations.ts` (`routeQuestion`, the ceiling); engine `git/isolation.ts` | |
| 4 Limits, batching, adoption, cascades, couriers | Built | core `decide/delegations.ts`, `decide/couriers.ts`, `decide/decider.ts` | |
| 5 Restart recovery | Built | core `decide/delegations.ts` (`recoverDeliveries`); engine `supervisor.ts` (`recover`) | |

### WS7 Triggers, idle sessions and notifications

| Item | Status | Where it lives | Built differently, on purpose |
| --- | --- | --- | --- |
| 1 Schedules | Built | core `schedules/`, `decide/schedules.ts`; engine `schedules/clock.ts`, `schedules/tools.ts`; web `components/settings/schedules.tsx`, `lib/schedules.ts` | |
| 2 Webhooks | Built | engine `schedules/webhook.ts`, `verify.ts`, `template.ts`, `secrets/store.ts` | |
| 3 Secrets | Built | core `decide/secrets.ts`; engine `secrets/store.ts`, `schedules/routes.ts`; web `components/overview/secret-card.tsx`, `lib/secrets.ts` | |
| 4 Idle release | Built | engine `agents/idle.ts`, `agents/questions.ts` | |
| 5 Idle compaction | Built | engine `agents/compaction.ts`, `providers/claude/context.ts`; core `decide/compaction.ts` | It also skips split sub-tasks |
| 6 Notifications | Built | web `lib/notifications/`, `hooks/use-attention.ts`, `components/settings/notifications.tsx` | |

No new effect kinds came with WS7: the clocks and the webhook receiver dispatch commands under deterministic ids,
so command receipts make them idempotent. The web also reads `GET /api/health` and shows a banner when the server
skipped a damaged event at boot (`components/status/health-banner.tsx`).
