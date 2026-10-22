---
name: review
description: How to run a cleanup or review pass over a change in Shinsa — scoping the diff, delegating breadth, proving every finding, and the traps that make a pass look green when it is not. Use before merging anything large, when asked to review or clean up code, or when a check fails in a way you cannot reproduce.
---

# Running a review pass

Load `conventions` first. This skill is the method; that one is the standard you judge against. For UI also load `design`, for strings `copy`. Adapted from Buzzkit's `review`.

A finding you cannot reproduce is a guess. A fix you have not watched fail without it is a hope. Everything below exists to keep those two out of the report.

## 1. Scope the diff before reading a line

```sh
git status --short          # column 1 = staged, column 2 = worktree
git diff HEAD --stat
git status --short | awk '{print $NF}' | cut -d/ -f1-2 | sort | uniq -c | sort -rn
```

**Read the porcelain columns carefully.** `M ` is staged, ` M` is worktree only, `??` is untracked. Confusing them produces confident, wrong findings: a staged test importing untracked source is a real problem; a worktree-only file is not.

**Other agents work in this tree.** Separate what is yours to review from someone else's work in progress and say which is which in the report. Check file mtimes and `git log -1 -- <file>` when ownership is unclear, and never revert a file you did not write.

## 2. Delegate breadth, keep judgement

Fan out subagents for independent slices (`packages/core/src/decide`, the rest of core, `apps/server`, `apps/web`), one per coherent slice, each told to load `conventions` and report `file:line` with a one-sentence defect and a one-sentence fix. Keep for yourself the synthesis, the architecture questions and **verifying every headline finding personally**. A subagent's "confirmed bug" is a hypothesis until you reproduce it.

## 3. Never let git guess which stash

`git stash push -- <pathspec>` creates nothing when the pathspec matches only untracked files, and the `git stash pop` that follows pops an unrelated stash into your tree. For a clean baseline copy the files aside (`cp -r packages/core /tmp/core-baseline`) or use `git worktree add /tmp/baseline HEAD`. Only pop by explicit ref, after reading `git stash list`.

## 4. Prove findings, and prove fixes

Reproduce the defect, fix it, then **revert the fix and watch the test fail**. If it passes either way it is not covering the bug.

```sh
cp packages/core/src/decide/pull-requests.ts /tmp/keep.ts
# revert the fix
(cd packages/core && bun test test/decide/pull-requests.test.ts -t "while the merge runs")
cp /tmp/keep.ts packages/core/src/decide/pull-requests.ts
```

For a whole batch, run the new tests against the old source: copy `test/` into the baseline copy from step 3 and run it there; every test that fails is a bug the change fixed. For an engine invariant, inject the bug and check that `test/decide/invariants.test.ts` names the seed and step that break; if it stays green, the generator never reaches the state, so bias it until it does.

## 5. Run what CI runs, not something like it

Copy the command out of `.github/workflows/*.yml`. Approximations hide failures. CI runs `bunx biome ci .` (not `check`), `bun lint:conventions`, `sherif`, `knip`, `bun check-types` and `bun run test`.

| Command | Catches |
|---|---|
| `bun lint` | Biome, the Grit plugins, the comments ban, the verb catalog, the class checks |
| `bun check-types` | every workspace and `scripts/`; one broken package hides the rest, so also run `tsc --noEmit` in the ones you touched |
| `bun run test` | every suite with its coverage floor (`bunfig.toml` in `packages/core` and `apps/server`) |
| `bunx knip` | dead exports, files and dependencies — **run it after exporting anything** |
| `bun deps` | dependency version drift |
| `bun dev` + a browser | the web app actually rendering the state |

## 6. Traps that make a pass look green

- **A test that asserts the old behaviour encodes the bug.** When a fix breaks a test, read it before editing. If it pinned the defect, rewrite it to the corrected contract and say so in the report.
- **A test that passes either way.** "Retry gives the agent another go" asserted only the stage after retry, which was right even while the retry immediately failed again. Assert the outcome the user cares about.
- **Turbo's cache.** `bun run test` at the root replays cached results for unchanged packages. When in doubt run `bun test` inside the package, or `turbo run test --force`.
- **Coverage counts arrow functions.** An uncovered function on a covered line is usually a callback that never runs (a `withdrawGates` predicate when no gate can be open). Ask whether the branch is dead before writing a test to touch it; dead code is deleted, not covered.
- **Coverage only sees loaded files.** A source file no test imports does not appear in the report at all. Check the file list, not just the total.
- **A green type check with a broken app.** Open the page with the console visible.
- **A green core with a broken server.** A core change can be type-correct and still break the server's flow (an effect the server never answers). Run `apps/server`'s e2e suite (`bun test test/e2e` there) after any change to `decide`.

## 7. Judge findings, do not obey them

Bots and reviewers are input, not instructions. For each one decide: valid, stale, or a nitpick, and say which. A suggested patch can trade one bug for another; implement the better fix and explain the departure. Fix a nitpick when the fix is free and buys something real, and name the real reason.

## 8. Ownership questions get a written rule

When the same value is defined in several places, decide once and record it in `CLAUDE.md`. In this repo: **a decision lives in `packages/core` exactly when replaying the event log must reproduce it**; anything that talks to the outside world lives in `apps/server`; the web owns nothing.

## 9. Close the loop

Every settled pattern goes back into `CLAUDE.md` or the relevant skill in the same change, so the next session starts where this one ended. Update the docs a behaviour change makes wrong (`docs/engine.md`, `docs/spec.md`, a package's `CLAUDE.md`), in that same change.

## Reporting

Lead with the verdict. Then confirmed bugs, most severe first, each with what breaks and why. Then the structural finding, if there is one — usually the reason several bugs share a hiding place. Then what you verified green, with real numbers. Name what you could not verify and why. If you broke something and fixed it, say so at the top.
