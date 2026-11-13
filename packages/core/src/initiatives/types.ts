import type { Initiative, InitiativePhase, InitiativeTeamMember, Task } from '../domain/index.ts';
import type { QueuedGate } from '../queue/types.ts';

export interface InitiativeNextTask {
  task: Task;
  waitsOn: Task[];
}

export interface InitiativePhaseGroup {
  phase: InitiativePhase | null;
  tasks: InitiativeNextTask[];
}

export interface InitiativePhaseProgress {
  phase: InitiativePhase | null;
  total: number;
  shipped: number;
  dropped: number;
}

export interface InitiativeDroppedTask {
  task: Task;
  reason: string;
}

export type InitiativeDecisionKind = 'plan' | 'call';

export interface InitiativeDecision {
  taskId: string;
  kind: InitiativeDecisionKind;
  title: string;
  text: string;
  at: number;
}

export type InitiativeTeammateSection = 'owner' | 'now' | 'next' | 'shipped' | 'dropped';

export interface InitiativeTeammateTask {
  member: InitiativeTeamMember;
  phase: InitiativePhase | null;
  section: InitiativeTeammateSection;
}

export interface InitiativeSheet {
  initiative: Initiative;
  needsYou: QueuedGate[];
  now: Task[];
  next: InitiativePhaseGroup[];
  shipped: Task[];
  dropped: InitiativeDroppedTask[];
  decisions: InitiativeDecision[];
  progress: InitiativePhaseProgress[];
  teammates: InitiativeTeammateTask[];
}
