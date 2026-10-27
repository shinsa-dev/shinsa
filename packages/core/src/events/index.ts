import type { TaskCreator } from '../domain/delegations.ts';
import type {
  ConfigProblem,
  DeliveringStep,
  EditsApproval,
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
  ReviewComment,
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
  WorkspaceMode,
} from '../domain/index.ts';
import type { PullRequestWatch, PullRequestWatchChange } from '../domain/pull-requests.ts';
import type {
  PlanDocument,
  ReportCheck,
  ReportWalkthroughRevision,
  ReviewDisagreement,
  ReviewFinding,
  WorkReport,
} from '../report/types.ts';
import type { Coverage } from '../test-coverage/types.ts';
import type { DelegationEventBody } from './delegations.ts';
import type { ScheduleEventBody } from './schedules.ts';

type QueuedRound = Pick<Round, 'number' | 'title' | 'request' | 'why' | 'shipping' | 'pipeline'>;

type EventBody =
  | { type: 'repo.registered'; repo: Repo }
  | { type: 'repo.updated'; repo: Repo }
  | { type: 'repo.removed'; repoId: string }
  | { type: 'project.written'; project: Project }
  | { type: 'project.removed'; projectId: string }
  | { type: 'focus.changed'; focus: Focus }
  | { type: 'settings.changed'; settings: Settings }
  | {
      type: 'task.created';
      taskId: string;
      request: string;
      repoId: string | null;
      projectId?: string | null;
      handle?: string;
      priority: TaskPriority;
      planFirst: boolean;
      origin: string | null;
      mode?: TaskMode;
      shape?: TaskShape;
      auto: TaskAuto;
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
      repoId: string | null;
      projectId?: string | null;
      handle?: string;
      size: TaskSize;
      branch: string;
      pipeline?: PipelineStep[];
      decisions: TriageDecisions;
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
  | { type: 'task.message_received'; taskId: string; messageId: string; text: string }
  | { type: 'task.message_routed'; taskId: string; messageId: string }
  | { type: 'task.message_dropped'; taskId: string; messageId: string; reason: string }
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
  | { type: 'worktree.requested'; taskId: string; workspace: WorkspaceMode }
  | {
      type: 'worktree.created';
      taskId: string;
      path: string;
      branch: string;
      workspace: WorkspaceMode;
      returnBranch?: string;
    }
  | { type: 'worktree.removed'; taskId: string }
  | { type: 'task.stacked'; taskId: string; onTaskId: string; branch: string }
  | { type: 'task.edited'; taskId: string; path: string; changed: boolean }
  | { type: 'task.edits_told'; taskId: string }
  | { type: 'task.overlapped'; taskId: string; otherTaskId: string; paths: string[] }
  | { type: 'task.overlaps_told'; taskId: string }
  | { type: 'task.edits_committed'; taskId: string }
  | { type: 'task.edits_approved'; taskId: string; gate: EditsApproval | null }
  | { type: 'task.conflict_held'; taskId: string; branch: string | null }
  | { type: 'task.unstacked'; taskId: string; fromTaskId: string }
  | {
      type: 'plan.proposed';
      taskId: string;
      body: string;
      document: PlanDocument | null;
      changeSummary?: string | null;
      feedback?: string | null;
    }
  | { type: 'plan.answered'; taskId: string; answers: string }
  | { type: 'phase.updated'; taskId: string; index: number; status: PhaseStatus }
  | { type: 'phase.completed'; taskId: string; report: PhaseReport }
  | { type: 'walkthrough.revised'; taskId: string; walkthrough: ReportWalkthroughRevision; runId: string }
  | { type: 'merge_step.ticked'; taskId: string; key: string; title: string; done: boolean }
  | { type: 'work.submitted'; taskId: string; summary: string; report: WorkReport | null }
  | {
      type: 'review.reported';
      taskId: string;
      summary: string | null;
      findings: ReviewFinding[];
      disagreements?: ReviewDisagreement[];
      runId?: string | null;
    }
  | {
      type: 'fix.started';
      taskId: string;
      round: number;
      reason?: FixReason;
      signature?: string | null;
      stalled?: number;
      treeHash?: string | null;
    }
  | { type: 'checks.recorded'; taskId: string; results: ReportCheck[]; coverage?: Coverage }
  | { type: 'gate.opened'; gate: Gate }
  | {
      type: 'gate.answered';
      gateId: string;
      decision: GateDecision;
      response: string | null;
      verdicts?: FindingVerdict[];
      comments?: ReviewComment[];
    }
  | { type: 'gate.withdrawn'; gateId: string }
  | { type: 'gate.noted'; gateId: string; notes: string | null }
  | { type: 'run.started'; run: Run }
  | { type: 'run.dispatched'; runId: string }
  | { type: 'run.linked'; runId: string; sessionId: string; provider: string }
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
      cwd?: string | null;
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
  | { type: 'task.repo_bound'; taskId: string; repoId: string; projectId?: string | null }
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
