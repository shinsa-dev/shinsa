---
name: handover
description: How to fill Shinsa's hand-over tools well (propose_plan, complete_phase, complete_fix, report_review, answer, report_diagnosis, submit_report, report_outcome, reshape_task). Use before you call any of them.
---

# Handing work over

Each tool's schema already names its fields, their limits and what goes in them. This page is only what the schemas
cannot say: how to fill the fields well.

## The plan (`propose_plan`)

- Phases are steps you build yourself, in order, each committed on its own: a clear end, not a role or a file.
- `verification` is the list of checks that prove the change (below). A change the user sees asks for `screenshot`
  in `evidence`.
- Decide what you can from the code and say so in `approach`. `questions` are only for what the human must decide.
- When the steps do not fit the request, call `reshape_task` instead of planning.

### The checks (`verification`)

A check is one command Shinsa runs for you after the phases it covers: a fact for the reviewer and the human, never
your claim. Choose them like evidence, for what this change touches, and scope each one:

```json
[
  { "label": "Transcript tests", "command": "bun test --cwd apps/engine test/agents/transcripts", "phases": [1, 2] },
  { "label": "Web types", "command": "bun run --cwd apps/web check-types", "phases": [2] },
  { "label": "Lint the changed files", "command": "bunx biome check apps/web/src/lib/chat", "phases": [2] }
]
```

- One test file or folder, one package's type check, the linter on the paths you change. Never the whole suite
  (`bun test`, `npm test`, `vitest`, `pytest`, `go test ./...`, `bun run check` and the like): Shinsa refuses it, and
  CI runs the whole suite on the pull request.
- Run each command once yourself before you plan it, from the repository root, where Shinsa runs it. Where each
  package has its own test config (a monorepo), point the runner at the package (`bun test --cwd apps/engine …`): a
  path that matches no test file is a broken check. A scoped run that misses the package's coverage floor passes;
  the floor is CI's.
- Cover every piece of new logic with tests, and make those tests checks: Shinsa measures changed-line coverage
  from them before review.
- The repository's own commands, when it has any, run once before review on their own; never list them.

## A phase (`complete_phase`)

The human reviews the change as a walkthrough assembled from your phases, in plan order, and a reviewer adds where it
disagrees. You built it and know why it is the way it is, so you write the explanation.

- **spots**: the few lines that carry the idea, not the whole function. `why` says what could go wrong or which
  judgement call it holds, never what the code does. Leave out boilerplate, renames, formatting and mechanical edits.
- **judgement_calls** matter more than the code: name every one a reader would ask about, with the alternatives you
  rejected. Title each as the decision ("Poll instead of webhooks"), never "Decision 1"; title a risk the same way
  ("Offsets shift during an export").
- **walkthrough** (last phase): whenever the change has structure or a flow, draw it in `flow` (or `approach` for
  structure) as a text diagram in a fenced block, at most 72 columns, a few words beside each step. Reviewers read it
  first. Skip it only for one small edit.

  ```
  complete_phase { spots }        the Agent's hand-over
          │
          ▼
  assembleReport ──► WorkReport   one report, plan order
          │
          ▼
  Review tab ──► Code tab         a spot opens its lines
  ```

- **testing.manual** starts from where to go (the preview URL, the local preview you attached, or the command that starts the app and its local URL),
  then one concrete step each, then the edge cases worth trying (an empty field, a narrow window, a second tab). An
  `expect` is concrete enough to tell pass from fail; "it works" is not a result. Link a file in an action as
  `[duplicate.ts](shinsa://file/src/paywalls/duplicate.ts#L12-L20)`. Leave `manual` empty only when
  nothing can be tried by hand, and say so in `automated`.
- **steps** are only what needs a person with production access. Do everything in the repository yourself first (code,
  tests, docs, `.env.example`, the migration file). Name every variable and secret production does not have yet, give
  the exact command, never a secret's value. Only the human ticks a step; changing a step's title, detail, kind or
  command asks them to do it again, so change one only when what they must do changed. Never put `pre_merge` or
  `post_merge` in `reshape_task`.
- **watchdogs** watch the change after it merges, through data the tests never see (traces, logs, errors, analytics,
  support messages); add one where the change sends something the world reads or writes, never for a refactor. Read
  how the repository ships first: when the merge is not the release, set `starts: production` with a
  `production_check`. Pick a `source` from the data sources the last phase's prompt lists; ask with `source_request`
  (the data, the code that sends it, servers to connect) only when none holds it. The schedule fields are optional
  and the settings fill the rest. An issue a check finds becomes a task forked from this one.

- **check_changes**: keep the checks current as you build. When a phase adds a file, a test or a package the checks
  do not cover, add a check for it in that phase's hand-over, with a one-sentence `reason` the human reads. The
  repository's own checks (`r1`…) are the human's. A failure your change caused comes back to you as a fix; one that
  passes when its test files run alone, or already fails on the base branch, does not.

Attach evidence with `attach_evidence` before the last phase (the `evidence` skill): for a test or a check, link the
check by its id instead of pasting output.

## A fix (`complete_fix`)

Shinsa runs again the failing checks and the checks of every phase whose files the fix changed. Name other checks the
fix touches in `checks`, and fix a check whose command was wrong or too wide with `check_changes`; never widen one to
the whole suite to make it pass. While you fix, run only the test files or folders the fix touches.

Evidence must show the work as it is after the fix: attach what the fix changed again with the same `key` (it
replaces the old item), remove what no longer applies with `remove_evidence`, and name in `evidence_kept` each earlier
item the fix touched that still holds.

Send `walkthrough` only when the fix changes the approach, the flow, a risk, the testing, the steps or the watchdogs. Each part you
send replaces that part whole, so send the full new list, not just the new item.

## Review findings (`report_review`)

`blocking` is a bug, a missed requirement, a broken rule or a check the change makes fail (not one already failing
on main); the agent fixes it before the human reviews. `should_fix` is not proven broken but worth holding the merge
for; the human sees it with Fix chosen. `optional` is taste or polish; the human sees it with Dismiss chosen. One
finding per problem, each one you reproduced (the `review` skill).

## Inquiries

`answer`, `report_diagnosis` and `submit_report` take `propose_change` only when what you found calls for a code
change; the human decides whether the task becomes it.

## Copy

Sentence case, plain words, no em dashes, no exclamation marks, no filler, no markdown inside short fields. In a
Markdown field, a command the human runs themselves goes in a ```bash run block; commands in structured fields (a
`command` target, a step's `command`) are always runnable, so never fence them.
