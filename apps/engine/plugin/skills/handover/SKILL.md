---
name: handover
description: How to fill Shinsa's hand-over tools well (propose_plan, complete_phase, complete_fix, report_review, answer, report_diagnosis, submit_report, report_outcome, reshape_task). Use before you call any of them.
---

# Handing work over

You hand work over only through Shinsa's tools, never in your final message. Each tool has fixed fields with hard
limits, published in its schema; Shinsa rejects a hand-over that breaks one and lists every problem, so fix them and
call the tool again. The human sees a hand-over in the chat as soon as you make it, so stop after it: never
announce, repeat or summarise it, and never say your turn is over. This page is how to fill the fields well.

## Commands in your text

A field that takes Markdown can hold a fenced block. Mark a command the human should run themselves with `run`
after its language, and Shinsa gives the block a Run in terminal button; anything else is an example and can only be
copied. The structured commands (a `command` target in `testing`, a step's `command`) are always runnable, so never
fence them.

````md
Start the preview and open it in Safari:

```bash run
bun run --cwd apps/dashboard dev
```

A retry resumes from the saved offset, for example:

```bash
bun run export --app app_9f2c --from-offset 150000
```
````

## The plan (`propose_plan`, while you plan)

| Field | Fill it with |
|---|---|
| goal | The outcome for the user, one or two sentences |
| phases | The work as 2 to 8 phases in the order you will build them, each a `title` of a few words and a one-sentence `detail`. You build each phase yourself after the plan is in, and Shinsa commits each on its own |
| behaviour | One observable behaviour per item, as true after the change |
| approach | How it will be built and the choices you made on the way: modules and data, not code |
| files | Each file that changes and what changes in it |
| out_of_scope | What this deliberately does not do |
| verification | The checks that prove the change, each a `label`, the exact `command` and the `phases` it covers (see below). Required for any code change, empty for anything else |
| questions | Only decisions the human must make, 2 to 4 concrete options each, your recommendation worded exactly as one option |

Set these only when they apply:

- `impact`: for a task that runs an operation, what it changes and how much, the dry run or why there is none, and
  how to undo it.
- `operation`: for a task that both changes code and runs an operation, the operation's steps in order, each with how
  to check it worked.
- `evidence`: the kinds of evidence you must attach before the human reviews (`screenshot`, `recording`,
  `test`, `note`, `preview`). A change the user sees asks for a screenshot. Shinsa refuses the last phase until each
  kind is attached.
- `approval`: true when the change is risky, so the human approves the plan before anything is built.
- `change_summary`: only when revising a plan, what you changed since the last version and why.

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
  path that matches no test file is a broken check, and Shinsa sends it back for you to fix. A scoped run that passes
  every test but misses the package's coverage floor passes; the floor is CI's, on the whole suite.
- `phases` are the phase numbers (1-based) after which the check runs; a test you write in phase 2 is a check from
  phase 2 on.
- The repository's own commands, when it has any, run once before review on their own; never list them.
- At most 12 checks, a label of 60 characters and a command of 200.

When the steps Shinsa chose do not fit the request, call `reshape_task` instead of a plan: `shape` to make the task an
answer, an investigation or research, or `steps` to compose it from the building blocks the tool lists, with a
one-sentence `reason`. Shinsa checks the steps and returns every problem.

## A phase (`complete_phase`, while you build)

The human reviews the work as a technical walkthrough Shinsa builds from every phase you hand over, in plan order.
You built it and you know why it is the way it is, so you write the explanation; a separate reviewer then checks it
and says where it disagrees. Mark every point the reader needs: on a large change, forty points is fine.

- **summary**: what this phase changed, one or two sentences. Wrap identifiers in backticks.
- **spots**: up to 8 exact line ranges in the new file the human must read. `why` says what could go wrong or which
  judgement call it holds, never what the code does.
  - `critical`: could break something, touches data, money, auth or a public API, or encodes a judgement call.
  - `high`: worth a careful read.
  - `normal`: context for the spots around it.
  For the key pieces of code, the ones that carry the new logic, add a `title` (what it is, a few words) and an
  `explain` (how it works, in plain words a reader new to the code follows). Keep each range small: the few lines that
  carry the idea, not the whole function. Leave out boilerplate, renames, formatting and mechanical edits.
- **judgement_calls**: up to 5 choices the human might make differently, each a `title` (a few words naming the
  decision, "Poll instead of webhooks", the heading of its card), a `call`, a `reason`, the
  `alternatives` you rejected (`option` and why you `rejected` it), and the `file`, `line` and `end` it is about when
  there is one. The judgement calls matter more than the code: name every one a reader would ask about.
- **walkthrough**, on the last phase, for the whole change:
  - `approach`: how the task was achieved, the idea and the structure, in a few short paragraphs.
  - `flow`: how it works behind the scenes, step by step through the new code.
  - **Draw it.** Whenever the change has structure or a flow worth drawing (pieces that call each other, the path a
    request or data takes, states and what moves between them, a tree of files), put a text diagram in `flow` (or in
    `approach` for the structure), in a fenced code block. Reviewers read the diagram first. Use a tree for structure
    and boxes and arrows for flow, at most 72 columns wide, aligned for a monospace font, a few words beside each step:

    ```
    complete_phase { spots }        the Agent's hand-over
            │
            ▼
    assembleReport ──► WorkReport   one report, plan order
            │
            ▼
    Review tab ──► Code tab         a spot opens its lines
    ```

    Skip it only when the change is one small edit with nothing to draw.
  - `risks`: the risks and edge cases, each a `title` (a few words naming the risk, "Offsets shift during an
    export"), the `risk` itself and its `file`, `line` and `end` when it has them.
  - `testing`: how to test it, in two parts (see below).
  - `steps`: what the human must do around the merge that needs a person or production access (see below). Leave it
    out when there is nothing.

### How to test it (`walkthrough.testing`)

Two parts, so the human can tell what is proven from what they should try:

- `automated`: one or two lines on what the tests cover: which test files, and what they prove
  ("`src/paywalls/duplicate.test.ts` covers both paywall kinds and the empty name").
- `manual`: a guide the human follows step by step, up to 10 steps. Each step has an `action` (what to do, as an
  instruction), a `target` when it happens in one place, and `expect` (what they should see when it works, concrete
  enough to tell pass from fail; "it works" is not a result).

| target `kind` | `value` | The human gets |
|---|---|---|
| `url` | An http or https address: the preview deployment, or the local URL | A link that opens in the browser |
| `file` | A path from the repository root, with `:line` or `:start-end` (`src/a.ts:12-20`) | The file in the Code tab |
| `command` | The exact shell command (`bun dev`) | Copy and Run in terminal |
| `screen` | The name of a screen in the app (`Settings → Billing`) | The name, as text |

- Start from where to go: the preview deployment URL, or the command that starts the app and then its local URL.
- One concrete step each: what to open, click or type. Then the edge cases worth trying (an empty field, a narrow
  window, a slow network, a second tab).
- Link a file in an action with the reference syntax, `[duplicate.ts](shinsa://file/src/paywalls/duplicate.ts#L12-L20)`.
- Leave `manual` empty only when there is nothing a person can try (a refactor the tests prove); say so in `automated`.
- Cover every piece of new logic with tests, and make those tests checks. Unless the repository turned it off,
  Shinsa runs the tests among your checks once more with coverage before review and shows the reviewer and the human
  which of your changed lines no test runs.

```json
{
  "automated": ["`src/paywalls/duplicate.test.ts` covers both kinds and the empty name."],
  "manual": [
    { "action": "Start the app", "target": { "kind": "command", "value": "bun dev" }, "expect": "It prints http://localhost:5173." },
    { "action": "Open the paywall list", "target": { "kind": "url", "value": "http://localhost:5173/paywalls" }, "expect": "Code and visual paywalls are listed." },
    { "action": "Click Duplicate on a code paywall", "expect": "A copy named “Copy of …” opens with the same code." },
    { "action": "Clear the name and save", "expect": "Save is refused with “Give it a name”." }
  ]
}
```

### Steps around the merge (`walkthrough.steps`)

First do everything you can inside the repository yourself: the code, the tests, the docs, `.env.example`, the
migration file, the config default. List only what is left for a person with production access, each as a concrete
step the human can follow without asking you anything:

| Field | Fill it with |
|---|---|
| when | `pre_merge` when the merged code needs it in place (a variable it reads, a secret, a setting); `post_merge` when it needs the merged code (running its migration, a deploy, a backfill, turning on its flag) |
| kind | `env`, `secret`, `migration`, `deploy`, `config` (a setting, a feature flag, a third-party dashboard) or `other` |
| title | The step as an instruction that names the thing: "Set `STRIPE_WEBHOOK_SECRET` on the API in production" |
| detail | Where and how: the service, the environment, the dashboard, where a value comes from, what happens without it |
| command | The exact shell command when the step is one; the human can run it in a terminal from the task |

- Name every variable and secret the change reads that production does not have yet, and where to set it.
- Never write a secret's value into a step; say where the human finds it.
- Give the exact command (`bun run db:migrate`, `railway redeploy --service worker`), never "run the migrations".
- No step for what you can do yourself, and none for things that happen anyway (CI, the merge itself).

Your steps become steps of the task: Shinsa adds Pre-merge and Post-merge to its pipeline from them, so
never put `pre_merge` or `post_merge` in `reshape_task`. The merge waits until the human ticks every pre-merge
step; a post-merge step opens only once the pull request merged, and keeps the task open, unticked, until they do it,
across later rounds too. You can read the
steps and their ticks in `read_task`; only the human ticks them, and you leave a task with unticked post-merge steps
open. A fix that sends the list again keeps a tick only on a step it sends unchanged: changing a step's title,
detail, kind or command asks the human to do it again, so change one only when what they must do changed.

### Changing the checks (`check_changes`)

Keep the checks current as you build: when a phase adds a file, a test or a package the checks do not cover, add a
check for it in that phase's `complete_phase`. Each change is an `action` with a one-sentence `reason` the human reads
in the task's activity:

```json
[
  { "action": "add", "label": "Export tests", "command": "bun test src/export", "reason": "Phase 2 added the export module and its tests." },
  { "action": "change", "id": "c2", "command": "bun run --cwd apps/web check-types", "reason": "The types moved into the web package." },
  { "action": "remove", "id": "c3", "reason": "The file it tested was deleted in this phase." }
]
```

- `add` needs a `label` and a `command`, and covers this phase onward unless you give `phases`.
- `change` and `remove` name the check by its `id` (`c1`, `c2`… as `read_task` lists them); a `change` sends only
  what changes.
- The repository's own checks (`r1`…) are the human's; you cannot change them.
- Shinsa runs this phase's checks and the ones you just added or changed after the hand-over. A failure your change
  caused comes back to you as a fix; one that passes when its test files run alone, or that already fails on the base
  branch, does not.

Attach evidence with `attach_evidence` before the last phase (the `evidence` skill): for a test or a check, link the
check by its id instead of pasting output. Shinsa commits each phase; never commit yourself.

## A fix (`complete_fix`, while you fix)

A `summary`: what you changed and, for anything you chose not to change, why. Shinsa commits it, then runs again
the failing checks and the checks of every phase whose files the fix changed, then the agent review, or pushes it to
the pull request (CI then runs on it).

- `checks`: the ids of other checks to run again, when the fix touches what they cover and no phase's files show it
  (a repository check, or a file no phase changed).
- `check_changes`: as on a phase, when the fix needs a new check, or a check whose command was wrong or too wide
  (with the reason). Never widen a check to the whole suite to make it pass.

When the fix changes how the change works (the approach, the flow, a risk, how to test it or the steps around the
merge), also send `walkthrough` with only the parts that changed. Each part you send replaces that part of the
walkthrough whole, so send the full new `risks`, `testing` (both `automated` and `manual`) or `steps`, not just the
new item. A step keeps its tick while its
timing and title stay the same. Leave `walkthrough` out when the fix changes none of them.

## Review findings (`report_review`, reviewer)

Up to 12 findings, one per problem, anchored to `file` and `line`/`end`. `blocking` is a bug, a missed requirement, a
broken rule or a check the change makes fail (not one already failing on main); everything else is a `suggestion`. Each finding has a `title` (what is wrong, in a few
words, at most 80 characters), a `message` (what is wrong and why it matters, at most 280) and, when you know what to
change, a `fix` (a sentence or a short code block, at most 600). A `summary` of one or two sentences (at most 400) says
what you checked and your overall view of the change. An empty list means you found nothing wrong.

Your brief numbers the agent's judgement calls. For each one you would have made differently, add a `disagreements`
entry: its `call` number and a `reason` (why, and what you would do instead, at most 280). The human reads it next
to the agent's call. Leave out the calls you agree with.

## Inquiries and operations

- **`answer`** (answerer): the answer in markdown, leading with the answer itself, then the evidence as shinsa://
  links to files and lines.
- **`report_diagnosis`** (investigator): the `diagnosis`: the cause, or what you ruled out, then the evidence. Your
  edits in the worktree are thrown away; only the diagnosis is kept.
- **`submit_report`** (researcher): the conclusion or recommendation first, then the options and the evidence.
- **`report_outcome`** (the agent, after it runs the operation): what ran, what changed, and anything left to do or undo.

`answer`, `report_diagnosis` and `submit_report` take `propose_change` (`request`, `why`) only when what you found
calls for a code change; the human decides whether the task becomes that change.

## Copy

Sentence case, plain words, no em dashes, no exclamation marks, no filler, no markdown inside short fields.
