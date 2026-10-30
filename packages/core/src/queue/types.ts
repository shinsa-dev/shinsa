import type { Gate, GateType, Task, TaskStage } from '../domain/index.ts';

export interface QueuedGate {
  gate: Gate;
  task: Task;
  projectId: string | null;
  unblocks: number;
  reason: string;
}

export interface Queue {
  focusProjectId: string | null;
  ready: QueuedGate[];
  upNow: QueuedGate[];
  later: QueuedGate[];
  working: Task[];
  waiting: Task[];
  backlog: Task[];
}

export interface QueueStep {
  position: number | null;
  total: number;
  previousId: string | null;
  nextId: string | null;
}

export interface QueueSummaryEntry {
  taskId: string;
  handle: string | null;
  title: string;
  label: string;
  kind: GateType | TaskStage;
  url: string;
}

export interface QueueSummary {
  briefing: string | null;
  decisions: QueueSummaryEntry[];
  working: QueueSummaryEntry[];
}
