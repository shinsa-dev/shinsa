import { DomainError, type Repo, resolveRoundBase, type Task } from '@shinsa/core';
import { assertRefName } from '../git/index.ts';
import { resolveFreeBranch } from '../git/worktree.ts';
import { describeError, log } from '../log/index.ts';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';
import {
  BUT_MISSING,
  isGitButlerReady,
  isStackedWithOthers,
  listAppliedBranches,
  listConflictedBranches,
  readButStatus,
  readButVersion,
  runBut,
} from './but.ts';
import {
  adoptPath,
  claimChanges,
  endBaseline,
  forgetTask,
  LedgerStore,
  listOwnedPaths,
  readDirtyState,
  recordCommitted,
  selectOtherOwner,
  startBaseline,
  type WorkspaceLedger,
} from './ledger.ts';
import { WorkspaceLock } from './lock.ts';
import {
  type CanStackOn,
  ConflictedBranchError,
  requireCheckout,
  type WorkspaceCommit,
  type WorkspaceStrategy,
} from './types.ts';

const UPDATE_HOLDER = 'workspace-update';

function describeConflicts(paths: string[]) {
  return `These files had uncommitted changes that are not this task’s, so Shinsa will not commit them to its branch: ${paths.join(', ')}. Undo your edits to them, or ask the human what to do.`;
}

export function describeNotWorkspace(repo: Repo, version: string) {
  return `${repo.path} is not a GitButler workspace, which \`but\` ${version} needs. Update \`but\` (0.23 and newer work in any repository) or run \`but setup\` in it, or choose another place for agents to work in Settings → Projects.`;
}

async function hasLocalBranch(repo: Repo, branch: string) {
  const result = await runCommand(
    ['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    repo.path
  );
  return result.ok;
}

function resolveBranchTree(repo: Repo, branch: string) {
  return runCommandOrThrow(['git', 'rev-parse', `refs/heads/${branch}^{tree}`], repo.path);
}

function readStackHint(error: unknown, branch: string) {
  const hint = describeError(error).match(/but move (\S+) --above (\S+)/);
  return hint?.[1] === branch ? (hint[2] ?? null) : null;
}

async function listChangeIds(repo: Repo, paths: string[]) {
  const status = await readButStatus(repo.path);
  const ids = new Map(status.uncommittedChanges.map((change) => [change.filePath, change.cliId]));
  return paths.map((path) => {
    const id = ids.get(path);
    if (!id) throw new Error(`GitButler does not list ${path} as an uncommitted change.`);
    return id;
  });
}

export class GitButlerStrategy implements WorkspaceStrategy {
  readonly mode = 'gitbutler';
  readonly #ledgers: LedgerStore;
  readonly #lease: WorkspaceLock;
  readonly #operations = new WorkspaceLock();
  #operation = 0;

  constructor(dataDir: string, lease = new WorkspaceLock()) {
    this.#ledgers = new LedgerStore(dataDir);
    this.#lease = lease;
  }

  async prepare(repo: Repo, task: Task, signal?: AbortSignal) {
    const version = await readButVersion(signal);
    if (version === null) throw new Error(BUT_MISSING);
    if (!isGitButlerReady(repo.path, version)) throw new Error(describeNotWorkspace(repo, version));
    if (!task.branch) throw new Error('The task has no branch yet.');
    const requested = assertRefName(task.branch);
    return this.#serially(repo, async () => {
      const applied = listAppliedBranches(await readButStatus(repo.path, signal));
      if (task.worktreePath === repo.path && task.phaseReports.length === 0)
        await this.#discardOwned(repo, task);
      if (task.worktreePath === repo.path && applied.includes(requested)) {
        return { path: repo.path, branch: requested };
      }
      if (task.worktreePath === repo.path && (await hasLocalBranch(repo, requested))) {
        await runBut(['apply', requested, '--json'], repo.path, { signal });
        return { path: repo.path, branch: requested };
      }
      const branch = await resolveFreeBranch(repo, requested, signal);
      const base = resolveRoundBase(task);
      const above = base && applied.includes(base) ? ['--above', assertRefName(base)] : [];
      await runBut(['branch', 'new', branch, ...above, '--json'], repo.path, { signal });
      return { path: repo.path, branch };
    });
  }

  async claim(repo: Repo, task: Task, signal?: AbortSignal) {
    const release = await this.#lease.acquire(repo.id, task.id, signal);
    try {
      await this.#updateLedger(repo, async (ledger) =>
        startBaseline(ledger, task.id, await readDirtyState(repo.path))
      );
    } catch (error) {
      release();
      throw error;
    }
    return async () => {
      try {
        await this.#updateLedger(repo, async (ledger) => {
          const claimed = claimChanges(ledger, task.id, await readDirtyState(repo.path));
          if (claimed.conflicts.length > 0) {
            log.warn('[Workspaces] An agent changed files with uncommitted work that is not its task’s', {
              taskId: task.id,
              paths: claimed.conflicts,
            });
          }
          return endBaseline(claimed.ledger, task.id);
        });
      } finally {
        release();
      }
    };
  }

  commit(repo: Repo, task: Task, message: string, canStackOn?: CanStackOn): Promise<WorkspaceCommit> {
    const { branch } = requireCheckout(task);
    return this.#serially(repo, async () => {
      const dirty = await readDirtyState(repo.path);
      const claimed = claimChanges(this.#ledgers.read(repo.id), task.id, dirty);
      if (claimed.conflicts.length > 0) throw new Error(describeConflicts(claimed.conflicts));
      const paths = listOwnedPaths(claimed.ledger, task.id, dirty);
      if (paths.length === 0) {
        this.#ledgers.write(repo.id, claimed.ledger);
        return { treeHash: await resolveBranchTree(repo, branch), files: [], undo: () => Promise.resolve() };
      }
      const { commitId, stackedOn } = await this.#commitOrStack(repo, branch, message, paths, canStackOn);
      const after = await readDirtyState(repo.path);
      this.#ledgers.write(repo.id, recordCommitted(claimed.ledger, task.id, paths, after));
      return {
        treeHash: await resolveBranchTree(repo, branch),
        files: paths,
        undo: () => this.#uncommit(repo, task, commitId, paths, dirty),
        ...(stackedOn ? { stackedOn } : {}),
      };
    });
  }

  async push(repo: Repo, task: Task, signal?: AbortSignal) {
    const branch = assertRefName(requireCheckout(task).branch);
    await this.#serially(repo, async () => {
      const status = await readButStatus(repo.path, signal);
      if (listConflictedBranches(status).includes(branch)) throw new ConflictedBranchError(branch);
      await runBut(['push', branch], repo.path, { signal, timeoutMs: null });
    });
    return runCommandOrThrow(['git', 'rev-parse', `refs/heads/${branch}`], repo.path);
  }

  async update(repo: Repo, signal?: AbortSignal) {
    const release = await this.#lease.acquire(repo.id, UPDATE_HOLDER, signal);
    try {
      await this.#serially(repo, () => runBut(['pull', '--json'], repo.path, { signal }));
    } finally {
      release();
    }
  }

  listConflicted(repo: Repo) {
    return this.#serially(repo, async () => listConflictedBranches(await readButStatus(repo.path)));
  }

  remove(repo: Repo, task: Task) {
    return this.#serially(repo, async () => {
      await this.#discardOwned(repo, task);
      const branch = task.branch;
      if (!branch || task.pullRequest?.state === 'merged') return;
      const status = await readButStatus(repo.path);
      if (!listAppliedBranches(status).includes(branch)) return;
      if (isStackedWithOthers(status, branch)) await this.#unstack(repo, task.id, branch);
      await runBut(['unapply', assertRefName(branch), '--json'], repo.path);
    });
  }

  async #unstack(repo: Repo, taskId: string, branch: string) {
    await runBut(['move', assertRefName(branch), '--unstack', '--json'], repo.path);
    const conflicted = listConflictedBranches(await readButStatus(repo.path)).filter(
      (name) => name !== branch
    );
    if (conflicted.length === 0) return;
    log.warn(
      '[Workspaces] Taking a task’s branch out of its stack left conflicted commits on other branches',
      {
        taskId,
        branch,
        conflicted,
      }
    );
  }

  writeEdit(repo: Repo, task: Task, path: string, write: () => boolean) {
    return this.#serially(repo, async () => {
      const ledger = this.#ledgers.read(repo.id);
      if (selectOtherOwner(ledger, task.id, path)) {
        throw new DomainError(
          'file_taken',
          `Another task has uncommitted changes in ${path}, so your edit would mix with them. Edit it once that task has committed them.`
        );
      }
      if (!write()) return;
      this.#ledgers.write(repo.id, adoptPath(ledger, task.id, path, await readDirtyState(repo.path)));
    });
  }

  async #discardOwned(repo: Repo, task: Task) {
    const dirty = await readDirtyState(repo.path);
    const { ledger, untouched } = forgetTask(this.#ledgers.read(repo.id), task.id, dirty);
    if (untouched.length > 0) {
      await runBut(['discard', ...(await listChangeIds(repo, untouched)), '--json'], repo.path);
    }
    this.#ledgers.write(repo.id, ledger);
  }

  async #commitChanges(repo: Repo, branch: string, message: string, paths: string[]) {
    const ids = await listChangeIds(repo, paths);
    const output = await runBut(['commit', '-b', branch, '-m', message, '--json', ...ids], repo.path);
    return (JSON.parse(output) as { commitId: string }).commitId;
  }

  async #commitOrStack(
    repo: Repo,
    branch: string,
    message: string,
    paths: string[],
    canStackOn: CanStackOn | undefined
  ) {
    let refusal: unknown;
    try {
      return { commitId: await this.#commitChanges(repo, branch, message, paths), stackedOn: null };
    } catch (error) {
      refusal = error;
    }
    const below = readStackHint(refusal, branch);
    try {
      if (!(below && canStackOn?.(below))) throw refusal;
      await runBut(['move', branch, '--above', assertRefName(below), '--json'], repo.path);
      log.info('[Workspaces] Stacked a task’s branch on the branch whose lines it changes', {
        branch,
        below,
      });
      return { commitId: await this.#commitChanges(repo, branch, message, paths), stackedOn: below };
    } catch (error) {
      throw new Error(
        `GitButler did not commit the changes to ${branch}: ${describeError(error)} When another task’s branch changed the same lines, leave those files alone or ask the human.`
      );
    }
  }

  async #uncommit(repo: Repo, task: Task, commitId: string, paths: string[], dirty: Record<string, string>) {
    await this.#serially(repo, async () => {
      await runBut(['uncommit', commitId, '--json'], repo.path);
      const ledger = this.#ledgers.read(repo.id);
      const owners = { ...ledger.owners };
      for (const path of paths) owners[path] = { taskId: task.id, hash: dirty[path] ?? '' };
      this.#ledgers.write(repo.id, { ...ledger, owners });
    });
  }

  async #updateLedger(repo: Repo, update: (ledger: WorkspaceLedger) => Promise<WorkspaceLedger>) {
    await this.#serially(repo, async () => {
      this.#ledgers.write(repo.id, await update(this.#ledgers.read(repo.id)));
    });
  }

  async #serially<T>(repo: Repo, operation: () => Promise<T>) {
    this.#operation += 1;
    const release = await this.#operations.acquire(repo.id, `operation-${this.#operation}`);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
