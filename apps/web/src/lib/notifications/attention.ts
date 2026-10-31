import {
  isAgentQuestion,
  isDecisionGate,
  isPausingGate,
  listOpenGates,
  type QueuedGate,
  resolveQueue,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { flattenWhitespace } from '@/lib/format/count.ts';
import { describeOperationIntro } from '@/lib/overview/operation.ts';
import { resolveGateNow } from '@/lib/tasks/now.ts';

type PageStatus = 'working' | 'waiting' | 'failed' | 'idle';

export interface PageAttention {
  status: PageStatus;
  badge: number;
}

export interface DecisionNotice {
  gateId: string;
  taskId: string;
  title: string;
  body: string;
}

const APP_NAME = 'Shinsa';

const BODY_MAX = 180;

export function resolvePageAttention(state: ShinsaState, now: number): PageAttention {
  const queue = resolveQueue(state, now);
  const badge = queue.ready.length;
  if (queue.ready.some((entry) => isPausingGate(entry.gate))) return { status: 'failed', badge };
  if (badge > 0) return { status: 'waiting', badge };
  return { status: queue.working.length > 0 ? 'working' : 'idle', badge };
}

export function resolveWindowTitle(badge: number, subject: string | null = null) {
  const name = subject ? `${subject} · ${APP_NAME}` : APP_NAME;
  return badge > 0 ? `[${badge}] ${name}` : name;
}

export function resolveTaskSubject(task: Pick<Task, 'handle' | 'title'> | null) {
  if (!task) return null;
  return task.handle ? `${task.handle} ${task.title}` : task.title;
}

function resolveBody(text: string) {
  const flat = flattenWhitespace(text);
  if (flat.length <= BODY_MAX) return flat;
  return `${flat.slice(0, BODY_MAX - 1).trimEnd()}…`;
}

function describeBody({ gate, task, reason }: QueuedGate) {
  if (gate.secret) return `Asks for the ${gate.secret.label}.`;
  if (isAgentQuestion(gate)) return gate.title;
  if (isDecisionGate(gate)) return `${reason}. ${resolveGateNow(task, gate)}`;
  if (gate.type === 'operation') return `${reason}. ${describeOperationIntro(gate)}`;
  if (gate.type === 'result' && task.result) return task.result.body.replace(/[*`#>]/g, '');
  return gate.body?.trim() ? `${reason}. ${gate.body}` : reason;
}

export function describeDecision(entry: QueuedGate): DecisionNotice {
  return {
    gateId: entry.gate.id,
    taskId: entry.task.id,
    title: entry.task.title,
    body: resolveBody(describeBody(entry)),
  };
}

export function listOpenGateIds(state: ShinsaState) {
  return new Set(listOpenGates(state).map((gate) => gate.id));
}

export function listNewDecisions(previous: ReadonlySet<string> | null, state: ShinsaState, now: number) {
  if (previous === null) return [];
  return resolveQueue(state, now)
    .ready.filter((entry) => !previous.has(entry.gate.id))
    .map(describeDecision);
}
