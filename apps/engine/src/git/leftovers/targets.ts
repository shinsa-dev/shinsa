import { isInside } from '../../files/paths.ts';
import { listDescendants } from '../../shell/processes.ts';
import { ORPHAN_PARENT } from './schema.ts';

export function listWorkingFolderPids(output: string, root: string) {
  const found = new Set<number>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid && isInside(root, line.slice(1))) found.add(pid);
  }
  return [...found];
}

function listParents(table: string) {
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
