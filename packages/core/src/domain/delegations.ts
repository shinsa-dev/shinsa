import type { Run, RunRole } from './types.ts';

export type DelegationMode = 'async' | 'wait';

export type DelegationWake = 'always' | 'settled_only';

export type DelegationIsolation = 'shared' | 'worktree';

export type DelegateRole = Extract<RunRole, 'planner' | 'builder' | 'reviewer' | 'fixer'>;

export type DelegationDelivery = 'none' | 'delivered' | 'acknowledged';

export type DelegationStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface DelegationQuestion {
  id: string;
  question: string;
  context: string | null;
  choices: string[];
  recommendation: string | null;
  askedAt: number;
  delivered: boolean;
  answer: string | null;
  answeredAt: number | null;
}

export interface RunDelegation {
  parentRunId: string;
  depth: number;
  requestKey: string;
  title: string;
  brief: string;
  mode: DelegationMode;
  wake: DelegationWake;
  isolation: DelegationIsolation;
  baseCommit: string | null;
  delivery: DelegationDelivery;
  question: DelegationQuestion | null;
  requestedAt: number;
}

export type DeliveryVia = 'steer' | 'wake';

export interface DeliveryClaim {
  generation: number;
  items: string[];
  via: DeliveryVia;
}

export interface QueuedMessage {
  id: string;
  text: string;
}

export interface DeliveryCohort {
  nextGeneration: number;
  claim: DeliveryClaim | null;
  deferred: boolean;
  messages: QueuedMessage[];
}

export interface RunWait {
  delegations: string[];
  since: number;
  reason: string;
}

export type TaskCreatorKind = 'courier' | 'split';

export interface TaskCreator {
  kind: TaskCreatorKind;
  taskId: string;
  runId: string;
  requestKey: string;
}

export interface TaskSplit {
  planVersion: number;
  runId: string;
  taskIds: string[];
  at: number;
}

export const DELEGATION_LIMITS = {
  depth: 3,
  live: 8,
  brief: 20_000,
  title: 80,
  requestKey: 200,
  answer: 4_000,
  result: 50_000,
  inlineResults: 16_000,
  waitMinutes: 10,
  maxWaitMinutes: 60,
  splitTasks: 8,
  name: 200,
} as const;

export const DELEGATE_ROLES: readonly DelegateRole[] = ['planner', 'builder', 'reviewer', 'fixer'];

const READ_ONLY_ROLES: ReadonlySet<RunRole> = new Set<RunRole>([
  'planner',
  'reviewer',
  'answerer',
  'researcher',
]);

export function isDelegatedRun(run: Run): run is Run & { delegation: RunDelegation } {
  return run.delegation !== undefined && run.delegation !== null;
}

export function isReadOnlyRole(role: RunRole) {
  return READ_ONLY_ROLES.has(role);
}

export function resolveDelegationStatus(run: Run & { delegation: RunDelegation }): DelegationStatus {
  if (run.endedAt !== null) return run.outcome ?? 'failed';
  if (run.delegation.question && run.delegation.question.answer === null) return 'waiting';
  if (run.status === 'waiting') return 'waiting';
  return run.status === 'queued' ? 'queued' : 'running';
}
