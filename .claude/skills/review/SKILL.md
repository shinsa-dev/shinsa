---
name: review
description: How to run a cleanup or review pass over a change in Polis — scoping the diff, delegating breadth, proving every finding, and the traps that make a pass look green when it is not. Use before merging anything large, when asked to review or clean up code, or when a check fails in a way you cannot reproduce.
---

# Running a review pass

Load `conventions` first. This skill is the method; that one is the standard you judge against. For page content also load `polis-dashboard`.

A finding you cannot reproduce is a guess. A fix you have not watched fail without it is a hope. Everything below exists to keep those two out of the report.

## 1. Scope the diff before reading a line

```sh
git status --short          # column 1 = staged, column 2 = worktree
git diff HEAD --stat
git status --short | awk '{print $NF}' | cut -d/ -f1-2 | sort | uniq -c | sort -rn
```

**Read the porcelain columns carefully.** `M ` is staged, ` M` is worktree only, `??` is untracked. A staged test importing untracked source is a real problem; a worktree-only file is not.

**Other agents work in this tree.** Separate what is yours from someone else's work in progress and say which is which. Check file mtimes and `git log -1 -- <file>` when ownership is unclear.

## 2. Delegate breadth, keep judgement

Fan out subagents for independent slices (the API domain, the routes, the dashboard loaders, `packages/core`), each told to load `conventions` and report `file:line`, one sentence of defect, one sentence of fix. Keep the synthesis and the architecture questions for yourself, and **verify every headline finding personally**. A subagent's "confirmed bug" is a hypothesis until you reproduce it.

## 3. Never let git guess which stash

`git stash push -- <pathspec>` creates nothing when the pathspec matches only untracked files, and the `git stash pop` that follows pops an unrelated stash into your tree. For a clean baseline use `git show HEAD:path > /tmp/before.ts` or `git worktree add /tmp/baseline HEAD`. Only pop by explicit ref, after reading `git stash list`.

## 4. Prove findings, and prove fixes

Reproduce the defect, fix it, then **revert the fix and watch the test fail**. If it passes either way it is not covering the bug.

```sh
cp apps/api/src/api/members/index.ts /tmp/keep.ts
# revert the fix
cd apps/api && bunx vitest run test/api/members/index.test.ts
cp /tmp/keep.ts apps/api/src/api/members/index.ts
```

For a permission claim, call the route with a real session of the role in question (`bun member:create --role manager`, redeem the link, sign in with `curl` against `/auth/sign-in/email`, send the `set-auth-token` back as a bearer). For a number, compare against `metric_daily` directly with `wrangler d1 execute … --local --persist-to ../../.wrangler/state`.

## 5. The checks, in order of what they catch

| Command | Catches |
|---|---|
| `bun lint` | Biome, the Grit plugins, the comments ban, the verb catalog |
| `bun check-types` | every workspace; one broken package hides the rest, so run the ones you touched directly |
| `cd apps/api && bunx tsc -p test --noEmit` | the API test tree |
| `bun run test` | every vitest suite, including the rollup's golden test |
| `bunx knip` | dead exports, files, dependencies. Run it after exporting anything |
| `bunx sherif -i @types/node` | dependency drift |
| `cd apps/web && bun run build` | the Worker bundle and the route graph |
| `bun dev` + a browser | SSR, hydration, and the pages actually rendering |

## 6. Traps that make a pass look green

- **A test that asserts the old behaviour encodes the bug.** Read it before editing; if it pinned the defect, rewrite it to the corrected contract and say so.
- **A green `check-types` with a broken app.** SSR can 200 while hydration dies; open the page with the console visible.
- **Vite's mid-session re-optimize.** A dep discovered late reloads the page and loads React twice; the symptom is "Invalid hook call" or a Playwright "execution context was destroyed". Delete `apps/web/node_modules/.vite`, restart, and add the dep to `optimizeDeps.include`.
- **`wrangler types` must be re-run** after touching `wrangler.jsonc`, or `Env` is stale and the error points somewhere innocent.
- **The eden contract type-checks against the API's `types.ts`.** An `@/` import added to one of those files breaks the dashboard's `check-types`, not the API's.
- **Local D1 lives at the repo root** (`.wrangler/state`). A second copy under an app directory is stale and makes scripts and the API disagree.

## 7. Judge findings, do not obey them

Bots and reviewers are input. For each one decide: valid, stale, or a nitpick, and say which. A suggested patch can trade one bug for another; implement the better fix and explain the departure.

## 8. Close the loop

Every settled pattern goes back into `CLAUDE.md` or the relevant skill in the same change, so the next session starts where this one ended. Update the docs a behaviour change makes wrong, in that same change.

## Reporting

Lead with the verdict. Then confirmed bugs, most severe first, each with what breaks and why. Then the structural finding, if there is one. Then what you verified green, with real numbers. Name what you could not verify and why. If you broke something and fixed it, say so at the top.
