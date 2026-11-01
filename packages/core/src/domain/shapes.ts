import { DomainError } from './errors.ts';
import { isComposableStep, listComposedSteps, type PipelineStep, validatePipeline } from './steps.ts';
import type { Task } from './types.ts';
import { validateVerification } from './verification.ts';

export type TaskShape = 'answer' | 'investigate' | 'research' | 'change' | 'fix' | 'operation';

export type InquiryStep = Extract<PipelineStep, 'answer' | 'research' | 'investigate'>;

export type DeliveringStep = Extract<PipelineStep, 'answer' | 'research' | 'investigate' | 'operate'>;

export type WorkStep = Extract<PipelineStep, 'build' | 'operate'>;

export type ShapeActor = 'you' | 'agent' | 'shinsa';

export interface ShapeChange {
  from: PipelineStep[];
  to: PipelineStep[];
  by: ShapeActor;
  reason: string;
  at: number;
}

export interface TaskResult {
  step: DeliveringStep;
  body: string;
  runId: string | null;
  at: number;
}

export type ChangeProposalStatus = 'open' | 'accepted' | 'declined';

export interface ChangeProposal {
  request: string;
  why: string;
  status: ChangeProposalStatus;
  runId: string | null;
  at: number;
}

export interface TaskAuto {
  shape: boolean;
  start: boolean;
  priority: boolean;
}

export interface AutoChoice<T> {
  value: T;
  why: string;
}

export interface TriageDecisions {
  shape: AutoChoice<TaskShape> | null;
  start: AutoChoice<string[]> | null;
  priority: AutoChoice<Task['priority']> | null;
  duplicate?: TriageDuplicateCheck | null;
}

export interface UnreachedTeammate {
  teamId: string;
  machineId: string;
  name: string;
  owner: string | null;
}

export interface TriageDuplicateCheck {
  unreached: UnreachedTeammate[];
}

export const TASK_SHAPES: readonly TaskShape[] = [
  'answer',
  'investigate',
  'research',
  'change',
  'fix',
  'operation',
];

const INQUIRY_STEPS: readonly InquiryStep[] = ['answer', 'research', 'investigate'];

const REPOSITORY_FREE_STEPS: ReadonlySet<PipelineStep> = new Set<PipelineStep>(['answer', 'research']);

const CHANGE_TAIL: readonly PipelineStep[] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

export type OperationTiming = 'alone' | 'before_build' | 'post_merge';

export const SHAPE_PIPELINES: Record<TaskShape, readonly PipelineStep[]> = {
  answer: ['answer'],
  investigate: ['investigate'],
  research: ['research'],
  change: CHANGE_TAIL,
  fix: ['investigate', ...CHANGE_TAIL],
  operation: ['plan', 'operate'],
};

export const SHAPE_LIMITS = {
  answer: 8_000,
  diagnosis: 12_000,
  report: 40_000,
  outcome: 8_000,
  request: 2_000,
  why: 240,
  reason: 240,
} as const;

export function resolveOperationTiming(steps: readonly PipelineStep[]): OperationTiming | null {
  const index = steps.indexOf('operate');
  if (index === -1) return null;
  if (!steps.includes('build')) return 'alone';
  return steps.indexOf('build') > index ? 'before_build' : 'post_merge';
}

const INQUIRY_NOUN: Record<InquiryStep, string> = {
  answer: 'An answer',
  research: 'Research',
  investigate: 'An investigation',
};

export function isInquiryDone(task: Pick<Task, 'result'>, step: InquiryStep) {
  return task.result?.step === step;
}

export function isFollowUpOnWork(task: Pick<Task, 'stage' | 'plan'>) {
  return task.stage === 'answering' && task.plan !== null;
}

export function validateComposition(
  task: Pick<Task, 'pipeline' | 'mode' | 'result'>,
  steps: readonly PipelineStep[]
): string[] {
  const errors = [...validatePipeline(steps), ...validateVerification(steps)];
  const handOver = steps.filter((step) => !isComposableStep(step));
  if (handOver.length > 0) {
    errors.push(
      `Shinsa adds ${handOver.map((step) => `\`${step}\``).join(' and ')} from the steps around the merge in your work report; leave them out.`
    );
  }
  const ran = resolveInquiryStep(resolveTaskPipeline(task));
  if (ran && isInquiryDone(task, ran) && !steps.includes(ran)) {
    errors.push(`${INQUIRY_NOUN[ran]} already ran, so \`${ran}\` stays in the steps.`);
  }
  const inquiry = resolveInquiryStep(steps);
  if (inquiry && steps.includes('plan') && !steps.includes('your_ok') && !isInquiryDone(task, inquiry)) {
    errors.push(
      `${INQUIRY_NOUN[inquiry]} turns into a change or an operation only with the human's OK: put \`your_ok\` between \`${inquiry}\` and \`plan\`.`
    );
  }
  return errors;
}

export function isComposedByAgent(task: Pick<Task, 'shapeChanges'>) {
  return (task.shapeChanges ?? []).some((change) => change.by === 'agent');
}

export type ShapeState = 'triage' | 'agent' | 'settled';

const SHAPING_STAGES: ReadonlySet<Task['stage']> = new Set<Task['stage']>([
  'triage',
  'waiting_on_tasks',
  'planning',
]);

export function resolveShapeState(
  task: Pick<Task, 'stage' | 'auto' | 'pipeline' | 'plan' | 'shapeChanges'>
): ShapeState {
  if (!task.auto.shape || !SHAPING_STAGES.has(task.stage)) return 'settled';
  if (!task.pipeline || task.pipeline.length === 0) return 'triage';
  if (task.plan !== null || isComposedByAgent(task) || task.pipeline[0] !== 'plan') return 'settled';
  return 'agent';
}

export function isSamePipeline(a: readonly PipelineStep[], b: readonly PipelineStep[]) {
  return a.length === b.length && a.every((step, index) => b[index] === step);
}

export function resolvePresetOf(steps: readonly PipelineStep[]): TaskShape | null {
  const composed = listComposedSteps(steps);
  return TASK_SHAPES.find((shape) => isSamePipeline(SHAPE_PIPELINES[shape], composed)) ?? null;
}

export function resolveWorkStep(steps: readonly PipelineStep[]): WorkStep | null {
  return steps.find((step): step is WorkStep => step === 'build' || step === 'operate') ?? null;
}

export function findWorkStep(steps: readonly PipelineStep[]): WorkStep {
  const step = resolveWorkStep(steps);
  if (!step) throw new DomainError('no_work_step', 'This task has no step that builds or operates.');
  return step;
}

export function resolveShapeOf(steps: readonly PipelineStep[]): TaskShape {
  if (steps.includes('build')) return steps.includes('investigate') ? 'fix' : 'change';
  if (steps.includes('operate')) return 'operation';
  if (steps.includes('investigate')) return 'investigate';
  if (steps.includes('research')) return 'research';
  return 'answer';
}

export function resolveTaskPipeline(task: Pick<Task, 'pipeline' | 'mode'>): readonly PipelineStep[] {
  if (task.pipeline && task.pipeline.length > 0) return task.pipeline;
  return task.mode === 'ask' ? SHAPE_PIPELINES.answer : SHAPE_PIPELINES.change;
}

export function resolveTaskShape(task: Pick<Task, 'pipeline' | 'mode'>) {
  return resolveShapeOf(resolveTaskPipeline(task));
}

export function hasStep(task: Pick<Task, 'pipeline' | 'mode'>, step: PipelineStep) {
  return resolveTaskPipeline(task).includes(step);
}

export function needsRepository(steps: readonly PipelineStep[]) {
  return steps.some((step) => !REPOSITORY_FREE_STEPS.has(step));
}

export function resolveInquiryStep(steps: readonly PipelineStep[]): InquiryStep | null {
  return INQUIRY_STEPS.find((step) => steps.includes(step)) ?? null;
}

export function findInquiryStep(steps: readonly PipelineStep[]): InquiryStep {
  const step = resolveInquiryStep(steps);
  if (!step)
    throw new DomainError(
      'no_inquiry_step',
      'This task has no step that answers, researches or investigates.'
    );
  return step;
}

export function resolveProposalUpgrade(steps: readonly PipelineStep[]): PipelineStep[] {
  return [findInquiryStep(steps), 'your_ok', ...CHANGE_TAIL];
}
