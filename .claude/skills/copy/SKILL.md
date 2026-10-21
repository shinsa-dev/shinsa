---
name: copy
description: Write and review Polis dashboard copy — page titles and descriptions, tile labels, table headers, tooltips and definitions, empty states, buttons, errors and toasts. Use whenever a string a person reads changes.
---

# Copy

Every string in Polis is read by someone deciding what to do with a creator, a video or a budget. The bar is Stripe's dashboard: plain, specific, complete, exactly as long as the job needs. Adapted from buzzkit's `copy` skill.

## The one rule

**Each string has one job. Do that job in a full sentence, then stop.**

A page description says what the page answers. A tile label names the number. A definition (`lib/utils/definitions.ts`) says how the number is computed, in the reader's terms. An empty state says how the first row gets there. None of them sell, reassure, or give a verdict.

## No verdicts

Polis shows data; people decide. Never label a video or creator "profitable", "winning", "cut", "scale" or "bad". Show the number and a comparison badge instead: CPM against the team, last post age, IPM this week against the three before.

| Rejected | Why | Written right |
| --- | --- | --- |
| "Profitable" badge | A verdict | Creator ROAS `2.4×` |
| "Scale this creator" | Tells the manager what to do | IPM `3.1` next to the team's `1.8` |
| "Where new users came from" | Promises attribution precision the model does not claim | "Installs per 1K views" with its definition |

## Vocabulary

- **Per 1K views** is the frame: IPM (installs), PPM (proceeds), CPM (creator cost). PPM pairs with CPM, never with CPI.
- **Creator ROAS** is a rate (`2.4×`), not money.
- A **video** is one post, merged across its TikTok and Instagram mirrors. Say "video", not "post", in the UI.
- **Proceeds** are after the store cut and refunds; **gross sales** are before.
- **Members** have **roles** (Admin, Manager). There is no sign-up: "Accounts are created by an admin."

## Per kind of string

**Page title**: the noun, sentence case: "Videos", "Creators", "Funnel".
**Page description**: one sentence on what the page answers. "Who is posting, what their videos bring in, and who needs a nudge."
**Tile label**: the metric's name, matching its definition key.
**Definition**: how it is computed and what it excludes, one or two sentences. Every metric label needs one; a test fails without it.
**Button**: the verb and the object: "Add member", "Set password", "New link". Not "Submit", not "OK".
**Error**: what happened and what to do next. "This link has expired or was already used. Ask an admin for a new one." Not "Invalid token."
**Toast**: the outcome in past tense, plus one line of consequence when it is not obvious: "Rent paused" / "Past charges stay; nothing new is written."
**Empty state**: how the first row appears: "Videos appear after the next SideShift sync."

## Style

- Sentence case everywhere. No em dashes in UI strings; use a colon or a second sentence.
- Numbers carry their unit in the formatter, not in the label.
- Name people and things by what the reader calls them, not by the table they live in.
