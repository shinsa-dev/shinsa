# Where agents work: worktrees, GitButler, the main checkout

The design is `docs/engine.md` → Where agents work. This file says what is built, what GitButler's CLI could and
could not do, and what is left.

## Why

You work in GitButler: one working directory with several branches applied at once, so you test everything together
and still ship separate pull requests. Shinsa gave every code task its own worktree on a fresh branch, so its work
never showed up in your checkout until it merged. Some people want neither: no GitButler, no worktrees, just the
agent working in their checkout.

## Done

- **Core.** `Repo.workspace` (`worktrees` by default, `gitbutler`, `main_checkout`; `WORKSPACE_MODES`), a human-only
  repository field. A task takes its repository's mode when it asks for its workspace (`worktree.requested`,
  `worktree.created` carries it) and keeps it. One task at a time holds a main checkout; the next waits on it in
  `waiting_on_tasks` before its setup is verified, the queue names the holder, and switching the mode releases the
  waiting tasks. A `workspace` setup problem opens the configuration gate. The property walk switches the mode at
  random and checks that no two tasks hold one checkout (`test/decide/workspace-invariants.ts`).
- **Server.** `apps/server/src/workspaces/`: one `WorkspaceStrategy` per mode (prepare, claim, commit, push,
  remove), used by the worktree, checks, push and removal effects and by the hand-over commit. The setup check
  verifies the mode (`but` installed, a GitButler workspace, a clean checkout that is not a GitButler workspace).
  `GET /api/repos/workspaces` says per repository whether GitButler can be chosen. The Code tab reads a GitButler
  task from its branch, with no working copy. `shinsa repos update --workspace`, refused in an agent's shell.
- **GitButler.** A branch per task with `but branch new` (stacked rounds `--above` the round below), applied with
  the others; one agent that can change files at a time per workspace (read-only roles never wait); the ledger
  in `data/workspaces/` records which uncommitted paths belong to which task, so `but commit -b` takes exactly the
  task's files by their change ids, your uncommitted work is never committed and an edit to it is refused with
  the paths named; `but push`; a cancelled task's branch is unapplied and its untouched edits discarded, a merged one
  left for `but pull`.
- **Main checkout.** A branch Shinsa makes from the fetched default branch, commits only while the checkout is on
  it, pushes the branch by name, and switches back to the branch the checkout was on when the task took it
  (`returnBranch` on `worktree.ready` and `worktree.created`, kept on the task) when the task is done and the checkout
  is clean; when that branch is gone (or the checkout was detached) it goes to the default branch and logs it.
- **Stacking on conflict.** When `but commit` refuses a change because another applied branch changed those lines,
  and its hint names an open task's branch in the same repository that does not wait on this task
  (`selectStackTarget`), Shinsa stacks the task's branch on it (`but move <branch> --above <other>`), commits again and
  sends `task.stack`: core records `stackedOn` and makes the task wait on the other one with the existing dependency
  (`task.waits_on_changed` by Shinsa), so its merge gate waits for the other task's merge. Its pull request targets
  the other branch while that task's pull request is open, else the default branch (`resolvePullRequestBase`, the
  watch retargets it). Tested against the real `but` (the move, the commit on the stacked branch, a refused stack) and
  through the supervisor's hand-over.
- **Web.** Settings → Projects: a select on every repository's row, GitButler disabled with the reason until it is
  set up; ⌘K "Where agents work in ‹repository›" on the Settings page.
- **Tests.** Core decide and invariants; every strategy against throwaway repositories, GitButler against the real
  `but` in a throwaway workspace with its own `HOME` (`test/helpers/bin/but`); the effects, the supervisor's claim,
  the route, the surface; the web settings, ⌘K and support reads.

## GitButler's CLI: what it could and could not do (0.22.3)

- **Could**: set up a workspace non-interactively (`but setup`), create branches (`but branch new`, `--above` for a
  stack), commit chosen files to a chosen branch (`but commit -b <branch> <ids>`, ids from `but status --json`),
  push one branch (`but push <branch>`), unapply and apply (`but unapply`, `but apply`), discard chosen changes
  (`but discard <ids>`), take a commit back (`but uncommit`), and report everything as JSON.
- **Could not: keep uncommitted changes assigned to a branch.** The CLI has no lasting assignment any more (`but
  rub` was retired, there is no `but stage`); the JSON shows `assignedChanges` per stack but nothing sets it. So
  Shinsa keeps the assignment in its own ledger and decides at commit time, which only works with one writer at a
  time.
- **Could not: tell which agent made an edit.** Two agents writing in one directory leave nothing that says whose
  edit is whose. GitButler's own agent integration asks each agent to commit "only changes that belong to that
  session", which Shinsa cannot check. Hence one writing agent at a time per workspace.
- **Refuses: a change to lines another applied branch changed** ("Cannot commit: 1 change could not be applied:
  a.txt, line 1 depends on ‹branch›"); its hint is to stack the branch on the other one (`but move <branch> --above
  <other>`, which moves the branch's commits with it and reports `stackBranch`). Shinsa follows that hint for another
  task's branch (Done, above). Unapplying the lower branch of a stack unapplies the whole stack.
- **Breaks on a plain `git commit`** on `gitbutler/workspace` ("GitButler mode exit required"): Shinsa never runs one
  there, and the shell policy already refuses `git commit` for agents.
- **`but worktree`** (linked worktrees inside GitButler) needs an experimental feature flag; not used.
- **`but pr new`** needs GitButler's own forge sign-in (`but config forge auth`); Shinsa opens pull requests with
  `gh` as in every mode.

## Not done

- **Parallel writers in one GitButler workspace.** Needs either a lasting per-branch assignment in the CLI (so each
  agent's edits are assigned as they happen) or a reliable record of every file each agent writes (tool calls do not
  cover shell commands and generated files). Until then a second writing agent waits; the wait has no notice in the
  chat yet, and it counts toward the run's two-hour limit and its quiet-agent timer.
- **Stacking on your own branch.** A conflict with a branch that is not an open task's (your own work, a merged
  task's branch still applied) is still refused: there is no task to wait on, and the pull request's base would be a
  branch Shinsa does not push.
- **Cancelling the task below a stack** unapplies its branch, and GitButler unapplies the branches stacked on it with
  it; Shinsa does not unstack the task above first (`but move --unstack`).
- **Removing the dependency** a stack added (the Waits on menu) leaves the branches stacked; nothing stops the task
  above from merging first, which would merge the commits below with it.
- **Edits you make during an agent's run** to a file that was clean are counted as the agent's. A per-file watch
  could tell them apart; not built.
- **Merged branches** are left applied until your next `but pull`; Shinsa does not pull, since that rebases your
  own branches too.
- **Isolated delegations** in GitButler check out the workspace commit (every applied branch), not the task's branch
  alone.
- **The shell policy** does not yet refuse `git checkout <branch>`, `git switch` or `git stash` in a GitButler or
  main checkout, where they would move your checkout; the policy has no per-task mode today.
