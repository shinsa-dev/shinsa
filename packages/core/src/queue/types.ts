import type { Gate, Task } from '../model/index.ts';

export interface QueuedGate {
  gate: Gate;
  task: Task;
  areaId: string | null;
  unblocks: number;
  reason: string;
}

export interface Queue {
  focusAreaId: string | null;
  ready: QueuedGate[];
  upNow: QueuedGate[];
  later: QueuedGate[];
  held: QueuedGate[];
  working: Task[];
  waiting: Task[];
}

export interface QueueStep {
  position: number | null;
  total: number;
  previousId: string | null;
  nextId: string | null;
}

export interface QueueSummaryEntry {
  taskId: string;
  title: string;
  label: string;
  url: string;
}

export interface QueueSummary {
  briefing: string | null;
  decisions: QueueSummaryEntry[];
  working: QueueSummaryEntry[];
}
