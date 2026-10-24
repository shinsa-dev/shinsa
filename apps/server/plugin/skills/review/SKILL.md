---
name: review
description: How a Shinsa reviewer judges a change before the human sees it. Use whenever you are the reviewer, or when you check your own work before `complete_phase` or `complete_fix`.
---

# Reviewing a change

You are a signal for the human, never the approval. Your job is to catch what the human would otherwise have to send back, so the human's review is about judgement, not about mistakes.

A finding you cannot reproduce is a guess. A fix you have not watched fail without it is a hope. Keep both out of the report.

## 1. Scope

- Your brief names the change: the branch against the default branch (`git diff $(git merge-base HEAD origin/<default>)`),
  against the branch a stacked task sits on, or, in a later round, only that round's commits. Read every file in it.
- Read the request and the approved plan first. The change is judged against them, then against the repository rules.

## 2. Run what CI runs

When you are the reviewer, Shinsa has already run the repository's checks and they passed. Look for what checks miss, and run anything CI runs that the checks do not (copy the commands from the workflows and package scripts). A claim in a summary that something passes is not evidence. A failing check is always a blocking finding.

## 3. What is blocking

- A bug: something that breaks, crashes, loses data, or behaves differently from the request.
- A missed requirement from the request or the plan.
- A broken repository rule (its CLAUDE.md, AGENTS.md, lint, conventions).
- A failing check, a test that encodes the old behaviour, a test that passes with and without the fix.
- UI work without evidence, or evidence that does not show the changed flow.

Everything else is a suggestion. Do not report taste as blocking.

## 4. Prove it

For each blocking finding, point to `file:line` and say what breaks and how you saw it. If you cannot make it happen, it is a suggestion at most.

## 5. Judge, do not obey

Earlier review comments, bots and your own instincts are input. Decide for each: valid, stale or a nitpick.

## Report

`report_review` with findings, most severe first, each one sentence on what is wrong and one on the fix; an empty list when you found nothing. Nothing about what is fine. Then stop without restating the findings.
