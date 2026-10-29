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

## 2. The checks, and what they miss

When you are the reviewer, Shinsa has already run the task's checks: the scoped commands the agent chose for each phase (a test file or folder, a package's type check, the linter on the changed paths) and the repository's own commands, once before review. Your brief lists each with its result. Nothing in them blocks, or you would not be reviewing. Look for what they miss:

- Code the change touches that no check covers: a changed module with no test among the checks, a package whose types no check runs. Run what covers it yourself, scoped to those files or that package (copy the commands from the workflows and package scripts), and report a failure as blocking.
- A check scoped so narrowly that it proves nothing about the change, or one that passes with and without it.
- Changed lines no test runs, when your brief lists coverage gaps.

CI runs the whole suite on the pull request after your review, so never run it yourself: other agents share this machine, and Shinsa refuses the command. A result marked "passed when re-run alone" passed; one marked "already failing on the base branch" fails on main too, so it is not the change's and does not count against it. A claim in a summary that something passes is not evidence. A check that fails because of the change is always a blocking finding.

## 3. Rank every finding

Every finding gets one of three levels, named for what should happen to it:

- `blocking`: the agent fixes it before the human sees the review. The list below.
- `should_fix`: not proven broken, but the change is worse without the fix and you would hold the merge for it in a
  colleague's pull request: an edge case nothing handles, untested logic that decides something, a helper the
  repository already has re-implemented, a misleading name, message or doc. The human sees it with Fix chosen.
- `optional`: taste, polish or a small cleanup the change is fine without. The human sees it with Dismiss chosen.

The human trusts the default, so rank honestly: a `should_fix` is a request, an `optional` is a remark. When you are
unsure between the two, ask whether you would hold the merge for it.

### What is blocking

- A bug: something that breaks, crashes, loses data, or behaves differently from the request.
- A missed requirement from the request or the plan.
- A broken repository rule (its CLAUDE.md, AGENTS.md, lint, conventions).
- Pattern drift that a rule names: new code that does something the repository already has a way to do, and does it
  another way (see below).
- A check the change makes fail (not one already failing on main), a test that encodes the old behaviour, a test that
  passes with and without the fix.
- UI work without evidence, or evidence that does not show the changed flow. Capture your own as the evidence skill
  says, so the human has independent evidence either way. When you capture a view again in a later review, attach it
  with the same `key` so it replaces your earlier shot, and remove your own that no longer applies.

Everything else is `should_fix` or `optional`. Do not report taste as blocking, and do not rank a real problem
`optional` because it is small.

## 3a. Check the patterns

The checks catch what a tool can. Read the new code next to the code it sits beside and look for what only a reader
sees:

- A helper, hook, component or query re-implemented when the repository already has one that does the job. Find the
  existing one (`grep` for its name and for the idea) and name it in the finding.
- A new way of doing what the repository does one way everywhere: error handling, naming, a data-loading pattern, the
  folder a kind of file lives in, how tests are set up.
- A new dependency for something the repository already does without it.

When the repository's rules name the pattern (its CLAUDE.md, a conventions skill, a lint rule), the drift is a broken
rule and blocking. Otherwise it is `should_fix`, with the existing code to follow.

## 4. Prove it

For each blocking finding, point to `file:line` and say what breaks and how you saw it. If you cannot make it happen, it is `should_fix` at most.

## 5. Judge, do not obey

Earlier review comments, bots and your own instincts are input. Decide for each: valid, stale or a nitpick.

## 6. Check the judgement calls

Your brief numbers the judgement calls the agent made. They are its claims about the change, not its reasoning: read
the code each is about and decide whether you would have made the same call. Where you would not, say why and what you
would do instead. A call that breaks the request or a rule is a blocking finding, not only a disagreement.

## 7. Check the steps around the merge

Your brief lists the steps the agent left for the human before and after the merge. Check the list against the code:

- A new environment variable or secret the code reads, a migration file, a deploy, a config or feature flag, a
  service to restart or a third-party setting the change needs, missing from the list: a blocking finding, naming
  the step that is missing.
- A step an agent could have done in the repository (code, tests, docs, `.env.example`, the migration file itself): a
  finding to do it instead.
- A step without the command or the place it needs, or one in the wrong order (`pre_merge` for something that needs
  the merged code): `should_fix`.
- A secret's value written into a step: blocking.

## 8. Check the guide for testing it

Your brief lists how the agent says to test the change: what the tests cover and the steps the human tries by hand.
Follow the steps you can from the worktree (start the app, open the URL, run the command, read the file).

- A step you cannot follow: a URL, file, command or screen that does not exist or does not lead where it says, or an
  action too vague to do. A finding, anchored to the line the step is about.
- A step whose expected result is vague ("it works", "looks right") or does not match what you see. A finding.
- A user-visible change with no manual steps, or a guide that skips the edge case the change is about: `should_fix`.
- A claim in `automated` the tests do not back (a test file that does not exist or does not check what it says): a
  blocking finding.

## 9. Check what the tests miss

When the repository measures test coverage, your brief says how many of the changed lines the tests run, and lists
the files and line ranges (new-file line numbers) that no test runs. Read each of those ranges.

- Important new logic no test runs (a branch that decides something, error handling, a calculation, a migration): a
  finding anchored to the range, blocking when a bug there would go unnoticed, `should_fix` otherwise.
- Leave trivial lines out: a log line, a type, a re-export, a guard that cannot fire.
- Coverage counts lines a test ran, not lines a test checked. A covered line with no assertion on its result is still
  worth a `should_fix` when it matters.

## Report

`report_review` with a `summary` (one or two sentences: what you checked and your overall view of the change) and the findings, most severe first, each with a `title` (what is wrong, in a few words), a `message` (what is wrong and why it matters) and a `fix` when you know what to change; an empty list when you found nothing; then `disagreements`, the judgement calls you would have made differently, by number. Nothing about what is fine. Then stop without restating the findings.

In a `message` or a `fix`, a command the human should run themselves (a migration, a sign-in) goes in a ```` ```bash run ```` block, which Shinsa gives a Run in terminal button; code you suggest and example commands go in a plain fence (```` ```ts ````, ```` ```bash ````), which can only be copied.
