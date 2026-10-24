import type { Briefing } from '../briefing/types.ts';
import type { TaskCreator } from '../domain/delegations.ts';
import type {
  ConfigProblem,
  DeliveringStep,
  Evidence,
  FindingVerdict,
  FixReason,
  Focus,
  Gate,
  GateDecision,
  MessageKind,
  Monitor,
  PhaseReport,
  PhaseStatus,
  PipelineStep,
  Project,
  PullRequest,
  Repo,
  ReviewEscalation,
  Round,
  RoundShipping,
  Run,
  RunAccount,
  RunContinuationReason,
  RunFailure,
  RunHandoff,
  RunOutcome,
  RunUsage,
  Settings,
  ShapeActor,
  TaskAuto,
  TaskMode,
  TaskPriority,
  TaskShape,
  TaskSize,
  TaskStage,
  TaskSuggestion,
  TriageDecisions,
  UsageWait,
} from '../domain/index.ts';
import type { PullRequestWatch, PullRequestWatchChange } from '../domain/pull-requests.ts';
import type { ReportCheck, ReviewFinding, PlanDocument, WorkReport } from '../report/types.ts';
import type { DelegationEventBody } from './delegations.ts';
import type { ScheduleEventBody } from './schedules.ts';

export interface LegacyArea {
  id: string;
  name: string;
  color: string;
}

export type StoredRepo = Omit<Repo, 'projectId'> & {
  projectId?: string | null;
  areaId?: string | null;
  previewCommand?: string | null;
};

type QueuedRound = Pick<Round, 'number' | 'title' | 'request' | 'why' | 'shipping' | 'pipeline'>;

export type StoredFocus = Omit<Focus, 'projectId'> & { projectId?: string | null; areaId?: string | null };

type EventBody =
  | { type: 'repo.registered'; repo: StoredRepo }
  | { type: 'repo.updated'; repo: StoredRepo }
  | { type: 'repo.removed'; repoId: string }
  | { type: 'area.written'; area: LegacyArea }
  | { type: 'area.removed'; areaId: string }
  | { type: 'project.written'; project: Project }
  | { type: 'project.removed'; projectId: string }
  | { type: 'focus.changed'; focus: StoredFocus }
  | { type: 'settings.changed'; settings: Settings }
  | {
      type: 'task.created';
      taskId: string;
      request: string;
      repoId: string | null;
      projectId?: string | null;
      handle?: string;
      priority: TaskPriority;
      planFirst?: boolean;
      origin?: string | null;
      mode?: TaskMode;
      shape?: TaskShape;
      auto?: TaskAuto;
      account?: RunAccount | null;
      parentTaskId?: string | null;
      createdBy?: TaskCreator | null;
      scheduleId?: string | null;
    }
  | DelegationEventBody
  | ScheduleEventBody
  | {
      type: 'task.triaged';
      taskId: string;
      title: string;
      repoId: string;
      projectId?: string | null;
      handle?: string;
      size: TaskSize;
      branch: string;
      baseTaskId?: string | null;
      pipeline?: PipelineStep[];
      decisions?: TriageDecisions;
    }
  | { type: 'task.reshaped'; taskId: string; pipeline: PipelineStep[]; by: ShapeActor; reason: string }
  | { type: 'task.delivered'; taskId: string; step: DeliveringStep; body: string; runId: string | null }
  | { type: 'task.change_proposed'; taskId: string; request: string; why: string; runId: string | null }
  | { type: 'task.change_declined'; taskId: string }
  | { type: 'task.change_approved'; taskId: string }
  | { type: 'task.staged'; taskId: string; stage: TaskStage; reason: string; by?: 'you' }
  | { type: 'task.prioritized'; taskId: string; priority: TaskPriority; by?: 'you' }
  | { type: 'task.waits_on_changed'; taskId: string; waitsOn: string[]; by?: 'you' | 'shinsa' }
  | { type: 'task.noted'; taskId: string; note: string; runId?: string | null }
  | {
      type: 'task.messaged';
      taskId: string;
      text: string;
      scheduleId?: string | null;
      kind?: MessageKind;
      round?: number;
    }
  | { type: 'round.queued'; taskId: string; round: QueuedRound }
  | {
      type: 'round.started';
      taskId: string;
      number: number;
      branch: string | null;
      base: string | null;
      onto: number | null;
    }
  | { type: 'round.pull_request_merged'; taskId: string; pullRequest: number; branch: string }
  | {
      type: 'round.shipping_changed';
      taskId: string;
      number: number;
      shipping: RoundShipping;
      branch?: string | null;
      base?: string | null;
      onto?: number | null;
    }
  | { type: 'task.recovered'; taskId: string; recoveries: number; fingerprint?: string }
  | { type: 'worktree.created'; taskId: string; path: string; branch: string }
  | { type: 'worktree.removed'; taskId: string }
  | {
      type: 'plan.proposed';
      taskId: string;
      body: string;
      document?: PlanDocument | null;
      changeSummary?: string | null;
      feedback?: string | null;
    }
  | { type: 'plan.answered'; taskId: string; answers: string }
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
      treeHash?: string | null;
    }
  | { type: 'checks.recorded'; taskId: string; results: ReportCheck[] }
  | { type: 'gate.opened'; gate: Gate }
  | {
      type: 'gate.answered';
      gateId: string;
      decision: GateDecision;
      response: string | null;
      verdicts?: FindingVerdict[];
    }
  | { type: 'gate.withdrawn'; gateId: string }
  | { type: 'gate.noted'; gateId: string; notes: string }
  | { type: 'run.started'; run: Run }
  | { type: 'run.dispatched'; runId: string }
  | { type: 'run.linked'; runId: string; sessionId: string; provider?: string }
  | {
      type: 'run.ended';
      runId: string;
      outcome: RunOutcome;
      summary: string | null;
      failure?: RunFailure | null;
    }
  | {
      type: 'run.attempted';
      runId: string;
      attemptId: string;
      provider: string;
      model: string | null;
      resumed: boolean;
      handoff: RunHandoff | null;
      account?: RunAccount | null;
    }
  | { type: 'run.interrupted'; runId: string }
  | { type: 'run.continued'; runId: string; reason: RunContinuationReason }
  | { type: 'run.session_lost'; runId: string; sessionId: string }
  | { type: 'run.compacted'; runId: string; sessionId: string }
  | { type: 'evidence.attached'; evidence: Evidence }
  | { type: 'pull_request.opened'; taskId: string; pullRequest: PullRequest }
  | { type: 'pull_request.updated'; taskId: string; pullRequest: PullRequest }
  | { type: 'pull_request.push_requested'; taskId: string }
  | { type: 'pull_request.pushed'; taskId: string; sha: string }
  | { type: 'pull_request.head_moved'; taskId: string; sha: string }
  | { type: 'pull_request.read_failed'; taskId: string; failures: number; detail: string }
  | { type: 'pull_request.read_failures_cleared'; taskId: string }
  | {
      type: 'pull_request.watched';
      taskId: string;
      watch: PullRequestWatch;
      changes: PullRequestWatchChange[];
    }
  | {
      type: 'briefing.written';
      projectId?: string | null;
      areaId?: string | null;
      text: string;
      briefing?: Briefing;
    }
  | { type: 'task.answered'; taskId: string; answer: string; runId: string }
  | { type: 'plan.approved'; taskId: string; version: number }
  | { type: 'review.escalated'; taskId: string; escalation: ReviewEscalation }
  | { type: 'gate.superseded'; gateId: string; text: string }
  | { type: 'monitor.armed'; taskId: string; monitor: Monitor }
  | { type: 'monitor.fired'; taskId: string; monitorId: string; attempt: number }
  | { type: 'monitor.ended'; taskId: string; monitorId: string; status: 'exhausted' | 'cleared' }
  | {
      type: 'run.metered';
      runId: string;
      usage: RunUsage;
      sessionId?: string;
      sessionUsage?: RunUsage;
      weeklyPercent?: number;
    }
  | { type: 'run.silenced'; runId: string; since: number | null }
  | { type: 'run.silence_snoozed'; runId: string; until: number }
  | { type: 'run.silence_dismissed'; runId: string }
  | { type: 'work.committed'; taskId: string; treeHash: string }
  | { type: 'task.suggested'; taskId: string; suggestion: TaskSuggestion }
  | {
      type: 'suggestion.settled';
      taskId: string;
      suggestionId: string;
      status: 'accepted' | 'dismissed';
      createdTaskId: string | null;
      keptRound?: number;
    }
  | { type: 'config.verified'; taskId: string; problems: ConfigProblem[] }
  | { type: 'budget.acknowledged'; taskId: string; spentUsd?: number; spentPercent?: number }
  | { type: 'task.account_bound'; taskId: string; account: RunAccount | null; by?: 'you' | 'shinsa' }
  | {
      type: 'on_behalf.acted';
      command: string;
      taskId: string | null;
      summary: string;
      byTaskId?: string | null;
    }
  | { type: 'usage_wait.armed'; taskId: string; wait: UsageWait }
  | {
      type: 'usage_wait.ended';
      taskId: string;
      waitId: string;
      status: 'resumed' | 'reset' | 'cleared';
    };

export type ShinsaEvent = EventBody & { seq: number; at: number; onBehalf?: true; byTask?: string };

export type ShinsaEventInput = EventBody & { onBehalf?: true; byTask?: string };

type ShinsaEventType = ShinsaEvent['type'];

export type EventOf<T extends ShinsaEventType> = Extract<ShinsaEvent, { type: T }>;
