---
name: handover
description: How to fill Shinsa's hand-over tools well (propose_plan, complete_phase, complete_fix, report_review, answer, report_diagnosis, submit_report, report_outcome, reshape_task). Use before you call any of them.
---

# Handing work over

Each tool's schema already names its fields, their limits and what goes in them. This page is only what the schemas
cannot say: how to fill the fields well.

## The plan (`propose_plan`)

- Phases are steps you build yourself, in order, each committed on its own: a clear end, not a role or a file.
- `verification` names the proof before the work: the test that fails without the change, the checks, the runs, the
  screenshots. A change the user sees asks for `screenshot` in `evidence`.
- Decide what you can from the code and say so in `approach`. `questions` are only for what the human must decide.
- When the steps do not fit the request, call `reshape_task` instead of planning.

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

- **testing.manual** starts from where to go (the preview URL, or the command that starts the app and its local URL),
  then one concrete step each, then the edge cases worth trying (an empty field, a narrow window, a second tab). An
  `expect` is concrete enough to tell pass from fail; "it works" is not a result. Link a file in an action as
  `[duplicate.ts](shinsa://file/src/paywalls/duplicate.ts#L12-L20)`. Leave `manual` empty only when
  nothing can be tried by hand, and say so in `automated`.
- **steps** are only what needs a person with production access. Do everything in the repository yourself first (code,
  tests, docs, `.env.example`, the migration file). Name every variable and secret production does not have yet, give
  the exact command, never a secret's value. Only the human ticks a step; changing a step's title, detail, kind or
  command asks them to do it again, so change one only when what they must do changed. Never put `pre_merge` or
  `post_merge` in `reshape_task`.

Attach evidence with `attach_evidence` before the last phase (the `evidence` skill).

## A fix (`complete_fix`)

Send `walkthrough` only when the fix changes the approach, the flow, a risk, the testing or the steps. Each part you
send replaces that part whole, so send the full new list, not just the new item.

## Review findings (`report_review`)

`blocking` is a bug, a missed requirement, a broken rule or a failing check; everything else is a `suggestion`. One
finding per problem, each one you reproduced (the `review` skill).

## Inquiries

`answer`, `report_diagnosis` and `submit_report` take `propose_change` only when what you found calls for a code
change; the human decides whether the task becomes it.

## Copy

Sentence case, plain words, no em dashes, no exclamation marks, no filler, no markdown inside short fields. In a
Markdown field, a command the human runs themselves goes in a ```bash run block; commands in structured fields (a
`command` target, a step's `command`) are always runnable, so never fence them.
