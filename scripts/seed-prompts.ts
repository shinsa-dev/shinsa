import type { ReportCheck, Run, ShinsaEvent, ShinsaState, Task } from '../packages/core/src/index.ts';
import { applyEvent, createState, splitHouseRules } from '../packages/core/src/index.ts';
import {
  resolveAgentPrompt,
  resolveChecksFixPrompt,
  resolveHumanFixPrompt,
  resolveOperationInstruction,
  resolvePhaseInstruction,
  resolvePlanningPrompt,
  resolvePullRequestFixPrompt,
  resolveReviewFixPrompt,
} from '../packages/core/src/prompts/index.ts';
import { listTaskBases } from '../packages/core/src/prompts/root.ts';
import type { TimedSeedEvent } from './seed-kit.ts';

const SEED_FAILED_CHECKS: ReportCheck[] = [
  { name: 'bun run test', outcome: 'fail', detail: '1 fail\n\nsrc/index.test.ts: expected 3 to be 2' },
];

interface PromptContext {
  state: ShinsaState;
  final: ShinsaState;
  responses: Map<string, string>;
}

function resolveFixInstruction(context: PromptContext, task: Task) {
  const final = context.final.tasks[task.id] ?? task;
  if (task.fixFor === 'review') return resolveReviewFixPrompt(final.findings);
  if (task.fixFor === 'you') return resolveHumanFixPrompt(context.responses.get(task.id) ?? null, []);
  if (task.fixFor === 'pull_request' && final.pullRequest) {
    return resolvePullRequestFixPrompt(final.pullRequest);
  }
  const failing = task.checkResults?.some((check) => check.outcome === 'fail');
  return resolveChecksFixPrompt(failing && task.checkResults ? task.checkResults : SEED_FAILED_CHECKS);
}

function resolveAgentRunPrompt(context: PromptContext, run: Run) {
  const { state } = context;
  const task = state.tasks[run.taskId];
  if (!task) throw new Error(`The seed starts run ${run.id} before its task.`);
  const repo = task.repoId ? (state.repos[task.repoId] ?? null) : null;
  if (run.purpose === 'plan') return resolvePlanningPrompt(task, repo, listTaskBases(state, task), null);
  if (run.purpose === 'build') {
    return resolveAgentPrompt(resolvePhaseInstruction(task, repo, run.phaseIndex ?? 0));
  }
  if (run.purpose === 'operate') return resolveAgentPrompt(resolveOperationInstruction(task, null));
  return resolveAgentPrompt(resolveFixInstruction(context, task));
}

function stampEvent(context: PromptContext, event: TimedSeedEvent['event']): TimedSeedEvent['event'] {
  if (event.type !== 'run.started' || event.run.role !== 'agent' || event.run.prompt) return event;
  return { ...event, run: { ...event.run, prompt: resolveAgentRunPrompt(context, event.run) } };
}

function recordResponse(context: PromptContext, event: TimedSeedEvent['event']) {
  if (event.type !== 'gate.answered' || !event.response) return;
  const taskId = context.state.gates[event.gateId]?.taskId;
  if (taskId) context.responses.set(taskId, event.response);
}

function sequence(timeline: TimedSeedEvent[]): ShinsaEvent[] {
  return timeline.map(({ at, event }, index) => ({ ...event, seq: index + 1, at }) as ShinsaEvent);
}

export function stampRunPrompts(timeline: TimedSeedEvent[]): TimedSeedEvent[] {
  const context: PromptContext = {
    state: createState(),
    final: sequence(timeline).reduce(applyEvent, createState()),
    responses: new Map(),
  };
  return timeline.map(({ at, event }, index) => {
    const stamped = stampEvent(context, event);
    recordResponse(context, stamped);
    context.state = applyEvent(context.state, { ...stamped, seq: index + 1, at } as ShinsaEvent);
    return { at, event: stamped };
  });
}

export function resolveRunOpening(run: Pick<Run, 'prompt' | 'resume'>) {
  if (!run.prompt) return null;
  if (!run.resume) return run.prompt;
  return splitHouseRules(run.prompt)?.instruction ?? run.prompt;
}

export function listRunOpenings(timeline: TimedSeedEvent[]) {
  const openings = new Map<string, string>();
  for (const { event } of timeline) {
    if (event.type !== 'run.started') continue;
    const opening = resolveRunOpening(event.run);
    if (opening) openings.set(event.run.id, opening);
  }
  return openings;
}
