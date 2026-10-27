import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { runCommandOrThrow } from '../shell/index.ts';

export type DirtyState = Record<string, string>;

interface ChangeOwner {
  taskId: string;
  hash: string;
}

export interface WorkspaceLedger {
  owners: Record<string, ChangeOwner>;
  baselines: Record<string, DirtyState>;
}

export interface ClaimResult {
  ledger: WorkspaceLedger;
  conflicts: string[];
}

const MISSING = 'missing';

function hashPath(root: string, path: string) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return MISSING;
  const stat = lstatSync(absolute);
  const hasher = new Bun.CryptoHasher('sha1');
  if (stat.isSymbolicLink()) return hasher.update(`link:${readlinkSync(absolute)}`).digest('hex');
  if (!stat.isFile()) return hasher.update(`mode:${stat.mode}`).digest('hex');
  return hasher.update(readFileSync(absolute)).digest('hex');
}

const PATH_FIELD: Record<string, number> = { '1': 8, u: 10, '?': 1 };

function readStatusPath(entry: string) {
  const skip = PATH_FIELD[entry[0] ?? ''];
  if (skip === undefined) return null;
  let at = 0;
  for (let field = 0; field < skip; field += 1) at = entry.indexOf(' ', at) + 1;
  return entry.slice(at) || null;
}

export async function readDirtyState(root: string, signal?: AbortSignal): Promise<DirtyState> {
  const status = await runCommandOrThrow(
    ['git', 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--no-renames'],
    root,
    { signal }
  );
  const dirty: DirtyState = {};
  for (const entry of status.split('\0')) {
    const path = readStatusPath(entry);
    if (path) dirty[path] = hashPath(root, path);
  }
  return dirty;
}

export function createLedger(): WorkspaceLedger {
  return { owners: {}, baselines: {} };
}

function isOwnedByOther(ledger: WorkspaceLedger, path: string, taskId: string) {
  const owner = ledger.owners[path];
  return owner !== undefined && owner.taskId !== taskId;
}

export function startBaseline(ledger: WorkspaceLedger, taskId: string, dirty: DirtyState): WorkspaceLedger {
  if (ledger.baselines[taskId]) return ledger;
  return { ...ledger, baselines: { ...ledger.baselines, [taskId]: dirty } };
}

export function claimChanges(ledger: WorkspaceLedger, taskId: string, dirty: DirtyState): ClaimResult {
  const baseline = ledger.baselines[taskId];
  if (!baseline) return { ledger, conflicts: [] };
  const owners = { ...ledger.owners };
  const conflicts: string[] = [];
  for (const path of new Set([...Object.keys(baseline), ...Object.keys(dirty)])) {
    const before = baseline[path] ?? null;
    const now = dirty[path] ?? null;
    if (before === now) continue;
    const ownedHere = owners[path]?.taskId === taskId;
    if (isOwnedByOther(ledger, path, taskId) || (before !== null && !ownedHere)) {
      conflicts.push(path);
      continue;
    }
    if (now === null) delete owners[path];
    else owners[path] = { taskId, hash: now };
  }
  return {
    ledger: { owners, baselines: { ...ledger.baselines, [taskId]: dirty } },
    conflicts: conflicts.sort(),
  };
}

export function listOwnedPaths(ledger: WorkspaceLedger, taskId: string, dirty: DirtyState) {
  return Object.entries(ledger.owners)
    .filter(([path, owner]) => owner.taskId === taskId && dirty[path] !== undefined)
    .map(([path]) => path)
    .sort();
}

export function adoptPath(
  ledger: WorkspaceLedger,
  taskId: string,
  path: string,
  dirty: DirtyState
): WorkspaceLedger {
  const owners = { ...ledger.owners };
  const hash = dirty[path];
  if (hash === undefined) delete owners[path];
  else owners[path] = { taskId, hash };
  return { ...ledger, owners };
}

export function selectOtherOwner(ledger: WorkspaceLedger, taskId: string, path: string) {
  const owner = ledger.owners[path];
  return owner && owner.taskId !== taskId ? owner.taskId : null;
}

export function recordCommitted(
  ledger: WorkspaceLedger,
  taskId: string,
  paths: string[],
  dirty: DirtyState
): WorkspaceLedger {
  const owners = { ...ledger.owners };
  for (const path of paths) delete owners[path];
  const baselines = ledger.baselines[taskId] ? { ...ledger.baselines, [taskId]: dirty } : ledger.baselines;
  return { owners, baselines };
}

export function endBaseline(ledger: WorkspaceLedger, taskId: string): WorkspaceLedger {
  const { [taskId]: _ended, ...baselines } = ledger.baselines;
  return { ...ledger, baselines };
}

export function forgetTask(ledger: WorkspaceLedger, taskId: string, dirty: DirtyState) {
  const kept: Record<string, ChangeOwner> = {};
  const untouched: string[] = [];
  for (const [path, owner] of Object.entries(ledger.owners)) {
    if (owner.taskId !== taskId) kept[path] = owner;
    else if (dirty[path] === owner.hash) untouched.push(path);
  }
  return { ledger: endBaseline({ ...ledger, owners: kept }, taskId), untouched: untouched.sort() };
}

export class LedgerStore {
  readonly #dir: string;

  constructor(dataDir: string) {
    this.#dir = join(dataDir, 'workspaces');
  }

  read(repoId: string): WorkspaceLedger {
    const file = this.#resolveFile(repoId);
    if (!existsSync(file)) return createLedger();
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<WorkspaceLedger>;
    return { owners: parsed.owners ?? {}, baselines: parsed.baselines ?? {} };
  }

  write(repoId: string, ledger: WorkspaceLedger) {
    mkdirSync(this.#dir, { recursive: true });
    const file = this.#resolveFile(repoId);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  }

  #resolveFile(repoId: string) {
    return join(this.#dir, `${repoId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }
}
