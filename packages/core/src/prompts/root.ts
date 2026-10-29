import { isTaskComplete, type Run, type RunPurpose, type Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveBriefedMemory, resolveMemoryContext } from './memory.ts';
import { resolveProjectContext } from './project.ts';
import { describeRound, resolveAgentPrompt } from './roles.ts';
import { splitHouseRules } from './rules.ts';

export function listTaskBases(state: ShinsaState, task: Task) {
  return task.waitsOn
    .map((id) => state.tasks[id])
    .filter((dependency): dependency is Task => dependency !== undefined && isTaskComplete(dependency));
}

export function needsRoundBrief(run: Pick<Run, 'role' | 'purpose'>) {
  return run.role === 'agent' && run.purpose !== undefined && run.purpose !== 'plan';
}

function resolveBrief(state: ShinsaState, task: Task, purpose: RunPurpose, phaseIndex: number | null) {
  const repo = task.repoId ? (state.repos[task.repoId] ?? null) : null;
  const before = purpose === 'build' && phaseIndex !== null ? phaseIndex : Number.POSITIVE_INFINITY;
  return describeRound(task, repo, listTaskBases(state, task), before);
}

export function resolveRoundBrief(
  state: ShinsaState,
  task: Task,
  run: Pick<Run, 'purpose' | 'phaseIndex'>,
  prompt: string
) {
  const instruction = splitHouseRules(prompt)?.instruction ?? prompt;
  const brief = resolveBrief(state, task, run.purpose ?? 'build', run.phaseIndex ?? null);
  return resolveAgentPrompt([brief, '', instruction].join('\n'));
}

export function resolveRunBrief(state: ShinsaState, run: Run) {
  const prompt = run.prompt ?? '';
  const task = state.tasks[run.taskId];
  if (!task || run.resume !== true) return prompt;
  if (!needsRoundBrief(run)) return `${prompt}${resolveBriefedMemory(state, task, run.role)}`;
  return `${resolveRoundBrief(state, task, run, prompt)}${resolveProjectContext(state, task)}${resolveMemoryContext(state, task)}`;
}
