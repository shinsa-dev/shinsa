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
| verification | How the change is proven: the failing test, the checks, the runs, the screenshots. Required for any code change |
| questions | Only decisions the human must make, 2 to 4 concrete options each, your recommendation worded exactly as one option |

Set these only when they apply:

- `impact`: for a task that runs an operation, what it changes and how much, the dry run or why there is none, and
  how to undo it.
- `operation`: for a task that both changes code and runs an operation, the operation's steps in order, each with how
  to check it worked.
- `evidence`: the kinds of evidence you must attach before the human reviews (`screenshot`, `recording`,
  `test`, `note`, `preview`). A change the user sees asks for a screenshot. Shinsa refuses the last phase until each
  kind is attached.
- `checks`: up to 6 commands Shinsa runs in the worktree after the repository's own checks, when those do not prove
  the change.
- `approval`: true when the change is risky, so the human approves the plan before anything is built.
- `change_summary`: only when revising a plan, what you changed since the last version and why.

When the steps Shinsa chose do not fit the request, call `reshape_task` instead of a plan: `shape` to make the task an
answer, an investigation or research, or `steps` to compose it from the building blocks the tool lists, with a
one-sentence `reason`. Shinsa checks the steps and returns every problem.

## A phase (`complete_phase`, while you build)

The human reviews the work phase by phase: Shinsa builds the review from every phase you hand over, in plan order.

- **summary**: what this phase changed, one or two sentences. Wrap identifiers in backticks.
- **spots**: up to 6 exact line ranges in the new file the human must read. `why` says what could go wrong or which
  judgement call it holds, never what the code does.
  - `critical`: could break something, touches data, money, auth or a public API, or encodes a judgement call.
  - `high`: worth a careful read.
  - `normal`: context for the spots around it.
  Leave out boilerplate, renames, formatting and mechanical edits; pick the few ranges that matter.
- **judgement_calls**: up to 5 calls the human might reverse, each a `call` and a `reason` with the alternative you
  rejected, and the `file` and `line` it is about when there is one.

Attach evidence with `attach_evidence` before the last phase (the `evidence` skill). Shinsa commits each phase; never
commit yourself.

## A fix (`complete_fix`, while you fix)

One `summary`: what you changed and, for anything you chose not to change, why. Shinsa commits it, then runs the checks
and the agent review again, or pushes it to the pull request.

## Review findings (`report_review`, reviewer)

Up to 12 findings, one per problem, anchored to `file` and `line`/`end`. `blocking` is a bug, a missed requirement, a
broken rule or a failing check; everything else is a `suggestion`. Each finding has a `title` (what is wrong, in a few
words, at most 80 characters), a `message` (what is wrong and why it matters, at most 280) and, when you know what to
change, a `fix` (a sentence or a short code block, at most 600). A `summary` of one or two sentences (at most 400) says
what you checked and your overall view of the change. An empty list means you found nothing wrong.

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
