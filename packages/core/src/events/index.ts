import type { Briefing } from '../briefing/types.ts';
import type {
  Area,
  Evidence,
  FixReason,
  Focus,
  Gate,
  GateDecision,
  PhaseReport,
  PhaseStatus,
  PullRequest,
  Repo,
  Run,
  RunOutcome,
  Settings,
  TaskPriority,
  TaskSize,
  TaskStage,
} from '../model/index.ts';
import type { ReportCheck, ReviewFinding, SpecDocument, WorkReport } from '../report/types.ts';

type EventBody =
  | { type: 'repo.registered'; repo: Repo }
  | { type: 'repo.updated'; repo: Repo }
  | { type: 'repo.removed'; repoId: string }
  | { type: 'area.written'; area: Area }
  | { type: 'area.removed'; areaId: string }
  | { type: 'focus.changed'; focus: Focus }
  | { type: 'settings.changed'; settings: Settings }
  | {
      type: 'task.created';
      taskId: string;
      intent: string;
      repoId: string | null;
      priority: TaskPriority;
      specFirst?: boolean;
      origin?: string | null;
    }
  | {
      type: 'task.triaged';
      taskId: string;
      title: string;
      repoId: string;
      size: TaskSize;
      branch: string;
      baseTaskId?: string | null;
    }
  | { type: 'task.staged'; taskId: string; stage: TaskStage; reason: string }
  | { type: 'task.prioritized'; taskId: string; priority: TaskPriority }
  | { type: 'task.blocked'; taskId: string; blockedBy: string[]; by?: 'you' | 'shinsa' }
  | { type: 'task.noted'; taskId: string; note: string; runId?: string | null }
  | { type: 'task.messaged'; taskId: string; text: string }
  | { type: 'task.recovered'; taskId: string; recoveries: number }
  | { type: 'worktree.created'; taskId: string; path: string; branch: string }
  | { type: 'worktree.removed'; taskId: string }
  | { type: 'spec.proposed'; taskId: string; body: string; document?: SpecDocument | null }
  | { type: 'spec.answered'; taskId: string; answers: string }
  | { type: 'phase.updated'; taskId: string; index: number; status: PhaseStatus }
  | { type: 'phase.completed'; taskId: string; report: PhaseReport }
  | { type: 'work.submitted'; taskId: string; summary: string; report?: WorkReport | null }
  | { type: 'review.reported'; taskId: string; findings: ReviewFinding[]; runId?: string | null }
  | {
      type: 'fix.started';
      taskId: string;
      round: number;
      reason?: FixReason;
      signature?: string | null;
      stalled?: number;
    }
  | { type: 'checks.recorded'; taskId: string; results: ReportCheck[] }
  | { type: 'gate.opened'; gate: Gate }
  | { type: 'gate.answered'; gateId: string; decision: GateDecision; response: string | null }
  | { type: 'gate.withdrawn'; gateId: string }
  | { type: 'run.started'; run: Run }
  | { type: 'run.dispatched'; runId: string }
  | { type: 'run.linked'; runId: string; sessionId: string }
  | { type: 'run.ended'; runId: string; outcome: RunOutcome; summary: string | null }
  | { type: 'evidence.attached'; evidence: Evidence }
  | { type: 'pull_request.opened'; taskId: string; pullRequest: PullRequest }
  | { type: 'pull_request.updated'; taskId: string; pullRequest: PullRequest }
  | { type: 'pull_request.push_requested'; taskId: string }
  | { type: 'pull_request.pushed'; taskId: string; sha: string }
  | { type: 'briefing.written'; areaId: string | null; text: string; briefing?: Briefing };

export type ShinsaEvent = EventBody & { seq: number; at: number };

export type ShinsaEventInput = EventBody;

export type ShinsaEventType = ShinsaEvent['type'];

export type EventOf<T extends ShinsaEventType> = Extract<ShinsaEvent, { type: T }>;
