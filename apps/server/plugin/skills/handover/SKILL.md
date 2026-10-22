---
name: handover
description: The Shinsa hand-over protocol for specs, work reports and review findings. Use before propose_spec, submit_work or report_review.
---

# Handing work over

Every hand-over has the same shape, every time, so the human can read it without reading. The tools enforce the
fields and limits and reject anything else; this page is how to fill them well.

## Spec (`propose_spec`)

| Field | Fill it with |
|---|---|
| goal | The outcome for the user, one or two sentences |
| behaviour | One observable behaviour per item, as true after the change |
| approach | Modules and data, not code; the decisions you made and why |
| files | Each file that changes and what changes in it |
| out_of_scope | What this deliberately does not do |
| verification | How the builder proves it: the failing test, the screenshots, the recording |
| questions | Only decisions the human must make, 2 to 4 concrete options each, your recommendation worded exactly as one option |

## Work report (`submit_work`)

The report *is* the review screen. The human reads phases on the left and the code you point at on the right.

- **headline**: what the change does, one sentence.
- **phases**: the change as 1 to 6 steps in the order a reader should understand it (data first, then logic, then UI,
  then tests is a good default). Never file order.
- **spots**: per phase, the exact line ranges in the new file the human must read. `why` says what could go wrong or
  what was decided, never what the code does.
  - `critical`: could break something, touches data, money, auth or a public API, or encodes a judgement call.
  - `high`: worth a careful read.
  - `normal`: context for the spots around it.
  Leave out boilerplate, renames, formatting and mechanical edits. Five well-chosen spots beat twenty.
- **checks**: every command you ran and its outcome. Failing checks stay in; say why in `detail`.
- **decisions**: judgement calls the human might reverse, each with the alternative you rejected.

## Review findings (`report_review`)

One finding per problem, anchored to `file` and `line`/`end`. `blocking` is a bug, a missed requirement, a broken rule
or a failing check; everything else is a `suggestion`. Say what is wrong and what to do.

## Commit message

Conventional commit subject, one line: `type(scope): summary`. No body, no trailers, no attribution.

## Copy

Sentence case, plain words, no em dashes, no exclamation marks, no filler, no markdown inside fields.
