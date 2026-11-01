import { existsSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { log } from '../log/index.ts';
import { listDescendants, runCommand } from '../shell/index.ts';

const STOP_GRACE_MS = 3_000;
const STOP_POLL_MS = 50;
const LIST_TIMEOUT_MS = 10_000;

const ORPHAN_PARENT = 1;

export interface StopOptions {
  spare?: number[];
  graceMs?: number;
  owner?: number;
}

function isInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}${sep}`);
}

export function listWorkingFolderPids(output: string, root: string) {
  const found = new Set<number>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid && isInside(line.slice(1), root)) found.add(pid);
  }
  return [...found];
}

export async function listProcessesIn(path: string) {
  if (!existsSync(path) || !Bun.which('lsof')) return [];
  const root = realpathSync(path);
  const listed = await runCommand(['lsof', '-w', '-d', 'cwd', '-Fpn'], sep, { timeoutMs: LIST_TIMEOUT_MS });
  return listWorkingFolderPids(listed.stdout, root);
}

export function listParents(table: string) {
  const parents = new Map<number, number>();
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid !== undefined && !Number.isNaN(ppid)) parents.set(pid, ppid);
  }
  return parents;
}

export function resolveStopTargets(found: number[], table: string, owner: number, spare: number[]) {
  const parents = listParents(table);
  const owned = new Set(listDescendants(table, owner));
  const spared = new Set([owner, ...spare, ...spare.flatMap((root) => listDescendants(table, root))]);
  return found.filter((pid) => !spared.has(pid) && (owned.has(pid) || parents.get(pid) === ORPHAN_PARENT));
}

function signalProcess(pid: number, name: NodeJS.Signals | 0) {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pids: number[], graceMs: number) {
  const deadline = Date.now() + graceMs;
  let alive = pids.filter((pid) => signalProcess(pid, 0));
  while (alive.length > 0 && Date.now() < deadline) {
    await Bun.sleep(STOP_POLL_MS);
    alive = alive.filter((pid) => signalProcess(pid, 0));
  }
  return alive;
}

export async function stopProcessesIn(path: string, options: StopOptions = {}) {
  const found = await listProcessesIn(path);
  if (found.length === 0) return [];
  const table = await runCommand(['ps', '-A', '-o', 'pid=,ppid='], sep, { timeoutMs: LIST_TIMEOUT_MS });
  if (!table.ok) return [];
  const targets = resolveStopTargets(found, table.stdout, options.owner ?? process.pid, options.spare ?? []);
  if (targets.length === 0) return [];
  for (const pid of targets) signalProcess(pid, 'SIGTERM');
  const stubborn = await waitForExit(targets, options.graceMs ?? STOP_GRACE_MS);
  for (const pid of stubborn) signalProcess(pid, 'SIGKILL');
  log.info('[Git] Stopped processes left in a worktree', {
    path,
    count: targets.length,
    killed: stubborn.length,
  });
  return targets;
}
