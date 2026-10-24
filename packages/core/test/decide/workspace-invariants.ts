import { expect } from 'bun:test';
import {
  isSettingUpWorkspace,
  type ShinsaCommand,
  type ShinsaState,
  WORKSPACE_MODES,
} from '../../src/index.ts';

type Random = () => number;

const WORKSPACE_ODDS = 0.08;

function holdsCheckout(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (task?.workspace !== 'main_checkout') return false;
  return task.worktreePath !== null || isSettingUpWorkspace(task);
}

export function assertWorkspaceInvariants(state: ShinsaState) {
  const holders = new Map<string, string>();
  for (const task of Object.values(state.tasks)) {
    const context = `${task.id} at ${task.stage} (${task.stageReason})`;
    if (task.worktreePath !== null)
      expect(task.workspace, `${context}: a checkout without a mode`).toBeTruthy();
    if (task.repoId === null || !holdsCheckout(state, task.id)) continue;
    const other = holders.get(task.repoId);
    if (other) throw new Error(`${context}: holds the checkout of ${task.repoId}, and so does ${other}`);
    holders.set(task.repoId, task.id);
  }
}

export function selectWorkspaceCommand(state: ShinsaState, random: Random): ShinsaCommand | null {
  if (random() >= WORKSPACE_ODDS) return null;
  const repoId = Object.keys(state.repos)[0];
  if (!repoId) return null;
  const workspace = WORKSPACE_MODES[Math.floor(random() * WORKSPACE_MODES.length)] ?? 'worktrees';
  return { type: 'repo.update', repoId, patch: { workspace } };
}

export function listWorkspaceMarks(state: ShinsaState) {
  return Object.values(state.tasks).map((task) => {
    if (task.stage === 'waiting_on_tasks' && task.stageReason.endsWith('with the checkout')) {
      return 'waited for the checkout';
    }
    if (task.workspace === 'main_checkout' && task.worktreePath !== null) return 'worked in the checkout';
    if (task.workspace === 'gitbutler' && task.worktreePath !== null) return 'worked on a GitButler branch';
    return null;
  });
}
