import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { readTeamSnapshot, type TeamSnapshot, type TeamTask } from '@shinsa/core';
import { readJsonFile, writeJsonFile } from '../files/index.ts';
import { describeError, log } from '../log/index.ts';
import { TeamSnapshotsFile } from './schema.ts';

export const TEAM_SNAPSHOTS_FILE = 'team-snapshots.json';

export interface HeldTeamList {
  teamId: string;
  instanceId: string;
  keyDigest: string;
  tasks: TeamTask[];
  updatedAt: number;
  snapshot: TeamSnapshot | null;
}

export function resolveKeyDigest(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

export function readTeamSnapshotsFile(path: string): HeldTeamList[] {
  const { value, problem } = readJsonFile(path, TeamSnapshotsFile);
  if (problem !== null) {
    log.warn('[Teams] Could not read the kept team snapshots', { path, error: problem });
    return [];
  }
  return (value?.lists ?? []).map(({ tasks, snapshot, ...list }) => ({
    ...list,
    tasks: tasks as TeamTask[],
    snapshot: readTeamSnapshot(snapshot),
  }));
}

function resolveListKey(teamId: string, instanceId: string) {
  return `${teamId} ${instanceId}`;
}

export class TeamSnapshots {
  readonly path: string;
  readonly #lists = new Map<string, HeldTeamList>();

  constructor(path: string) {
    this.path = path;
    for (const held of readTeamSnapshotsFile(path))
      this.#lists.set(resolveListKey(held.teamId, held.instanceId), held);
  }

  list() {
    return [...this.#lists.values()];
  }

  select(teamId: string, instanceId: string) {
    return this.#lists.get(resolveListKey(teamId, instanceId)) ?? null;
  }

  write(held: HeldTeamList) {
    this.#lists.set(resolveListKey(held.teamId, held.instanceId), held);
    this.#save();
  }

  remove(teamId: string, instanceId: string) {
    if (!this.#lists.delete(resolveListKey(teamId, instanceId))) return;
    this.#save();
  }

  #save() {
    try {
      if (this.#lists.size === 0) {
        rmSync(this.path, { force: true });
        return;
      }
      writeJsonFile(this.path, { version: 1, lists: this.list() });
    } catch (error) {
      log.warn('[Teams] Could not keep the team snapshots', { path: this.path, error: describeError(error) });
    }
  }
}
