---
name: copy
description: Write and review every string Shinsa shows a person or hands an agent — page and card copy, buttons, toasts, empty states, stage reasons, activity entries, the Home guide, DomainError messages and agent prompts. Use whenever such a string changes.
---

# Copy

Every string in Shinsa is read by someone deciding what to do next: you at a gate, or an agent in the middle of a step. The bar is Stripe's dashboard: plain, specific, complete, exactly as long as the job needs. Adapted from Buzzkit's `copy` skill; casing, proper nouns and actions in the web app follow `docs/design.md` → Copy, which wins on anything visual.

## The one rule

**Each string has one job. Do that job in a full sentence, then stop.**

A stage reason says what is happening to the task now. A gate says what is being decided. A toast says what just happened. An error says what went wrong and what to do. None of them sell, reassure, explain the architecture, or give a verdict on work Shinsa has not checked.

## What went wrong before (do not repeat)

| Rejected | Why | Written right |
| --- | --- | --- |
| "Approve it, ask for changes or reject it." for an agent's question | The answer options of another gate | "Answer the question." |
| "opening the pull request" while pushing to an open one | Says the wrong thing is happening | "pushing the changes" |
| "Building started" logged for every phase | Activity repeats a stage that did not change | Log a stage when the stage changes; the phase has its own "Finished: …" line |
| "All 1 checks passed" | A count that does not fit its noun | "The check passed" |
| "The same problems came back after 3 fix rounds" after two | An off-by-one the reader can count | "after 2 fix rounds" |
| "Needs the spec approved before work starts" | The UI calls it a plan | "Needs the plan approved before building starts" |
| "gitHub is down" from lower-casing a sentence start | Lower-casing broke a proper noun | Lower-case only an ordinary first word (`lowerFirst`) |

## Vocabulary

- A **task** is one piece of work you asked for. Not job, ticket or issue.
- A **gate** is the code's word; on screen it is the decision itself: "Review", "Merge", "Plan to approve", "Question", "Paused". **Needs you** is the list of them.
- **Plan** everywhere: on screen, in `shinsa status`, in prompts and in code (`Plan`, `planFirst`). "spec" means only a command-surface spec in `apps/engine/src/surface`.
- **Kind of task** on screen; shape is the code's word (`TaskShape`). No "shape" in any UI string.
- **Request** for what you asked for, never intent.
- **Suggested task** for what an agent suggests ("Suggested tasks", "Add the suggested task “‹title›”"). A **follow-up** is only a message to a finished answer, investigation or report.
- **Delegation** for work a step hands to another agent ("waiting for 2 delegations", "Delegations"). Never "delegated task".
- **Diagnosis** for what an investigation hands over; **findings** are only the reviewer's.
- **Judgement calls** for the choices the agent made in a phase; a **decision** is only your answer at a gate.
- **Check-in** for a waiting agent's next look ("Check in now", "Check-in 2 of 10", "Waiting to check in again"); **verify** the setup ("Verify again"); **CI** for the pull request's checks. Checks are the repository's.
- **Pull request** in prose; "PR #42" only where space is tight (a chip, a status line).
- **Agent** for whatever is working, and the name of a round's own agent, which plans, builds, fixes and runs the operation in one conversation; the other roles (reviewer, answerer, investigator, researcher, and planner or builder for a delegated agent) only where the role matters ("The reviewer paused").
- **Waiting on another task** for the tasks a task waits on ("Waits on"), "waiting for “Title” to finish" in a stage reason. Titles are quoted with curly quotes.
- **You** for the human in product copy and activity; **the human** in agent prompts.
- Never playful labels, never "magic", never exclamation marks. The two layout names (`LAYOUT_NAMES`: Desk and Shelf) are names chosen on purpose, each with a plain hint line.

## Per kind of string

**Button**: the verb and the object: "Retry", "Cancel task", "Request changes", "Merge the pull request". Not "Submit", not "OK".
**Toast**: the outcome, past tense or present continuous, plus one line of consequence when it is not obvious: "Answered. The agent carries on." / "Approved. Opening the pull request."
**Stage reason** (`task.stageReason`): lower case, a few words, what is happening now: "waiting for CI", "fixing the pull request", "merging". The web capitalises it.
**Activity entry**: a short past-tense sentence, sentence case, no full stop: "Opened pull request #42", "Agent review found 2 issues, 1 blocking".
**DomainError message**: what is wrong and, when it is not obvious, what to do: "“Base” was cancelled, so there is nothing to wait for." "This task is finished. Start a new one." The code (`task_settled`) is for programs; the message is for people and agents.
**Failure gate**: the title says what stopped ("Out of automatic fix rounds"), the body says why and what Retry will do.
**The Home guide** (`packages/core/src/briefing`): one plain sentence per item, a reason a person would say out loud; never a position ("item three"), an id, or a claim the gate does not support (a review is not "ready to merge").
**Agent prompts** (`packages/core/src/prompts`): imperative, one instruction per sentence, the tool to call named in backticks, limits stated as numbers. Keep each fix prompt's first words stable: the web reads them to label the run ("The checks failed", "The agent review found", "The human looked at the work", "Pull request #"). Agents speak as themselves, in the first person, and the hand-over is their reply: no prompt or tool text may have an agent say "Shinsa knows…" about itself or invite a line after the hand-over (`VOICE_RULE` in `prompts/rules.ts`). Name Shinsa to the human only where they act in it.

## Style

- Sentence case everywhere. No em dashes in UI strings; use a colon or a second sentence. Briefing text from the model has dashes replaced for you.
- Numbers agree with their nouns ("1 task is", "2 tasks are").
- Name things by what the reader calls them, not by the field they live in ("Retry", not "approve the failure gate").
- When you change a string that a test, a prefix match or a saved value depends on, change them together and say so.
