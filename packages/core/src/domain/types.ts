import type { PlanChange } from '../report/plan-changes.ts';
import type {
  CarriedMergeStep,
  CodeSpot,
  JudgementCall,
  PlanDocument,
  ReportCheck,
  ReportWalkthrough,
  ReviewDisagreement,
  ReviewFinding,
  TaskCheck,
  WorkReport,
} from '../report/types.ts';
import type { Coverage, CoverageSetting } from '../test-coverage/types.ts';
import type { RunAccount, UsageWait, WeeklyReading } from './accounts.ts';
import type { DeliveryCohort, RunDelegation, RunWait, TaskCreator, TaskSplit } from './delegations.ts';
import type { CiRun, MergeQueueEntry, PullRequestWatch, PushHookFailure } from './pull-requests.ts';
import type { Round } from './rounds.ts';
import type { GateSecret, SourceReport } from './schedules.ts';
import type { ChangeProposal, ShapeChange, TaskAuto, TaskResult, TriageDecisions } from './shapes.ts';
import type { PipelineStep } from './steps.ts';
import type { Watchdog, WatchSource } from './watchdogs.ts';
import type { WorkspaceMode } from './workspaces.ts';

export type TaskStage =
  | 'triage'
  | 'waiting_on_tasks'
  | 'planning'
  | 'awaiting_plan'
  | 'building'
  | 'checking'
  | 'reviewing'
  | 'fixing'
  | 'awaiting_review'
  | 'shipping'
  | 'awaiting_merge'
  | 'answering'
  | 'investigating'
  | 'researching'
  | 'operating'
  | 'watching'
  | 'awaiting_proposal'
  | 'awaiting_operation'
  | 'merged'
  | 'done'
  | 'cancelled';

export type TaskSize = 'small' | 'large';

export type TaskMode = 'build' | 'ask';

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export type RunRole =
  | 'agent'
  | 'planner'
  | 'builder'
  | 'reviewer'
  | 'answerer'
  | 'investigator'
  | 'researcher';

export type RunPurpose = 'plan' | 'build' | 'fix' | 'operate' | 'watch' | 'intake';

export type AgentRole = 'classifier' | 'agent' | 'reviewer' | 'answerer' | 'writer';

export type FixReason = 'checks' | 'review' | 'you' | 'pull_request' | 'conflict' | 'update' | 'hook';

export type RunStatus = 'queued' | 'running' | 'waiting';

export type RunOutcome = 'completed' | 'failed' | 'cancelled';

export type RunFailureClass =
  | 'usage_limit'
  | 'auth'
  | 'context_window_full'
  | 'overloaded'
  | 'provider_error'
  | 'transport_error'
  | 'aborted'
  | 'budget_exhausted'
  | 'malformed_tool_use'
  | 'image_error'
  | 'model_error'
  | 'setup_failed'
  | 'session_lost';

export interface RunFailure {
  class: RunFailureClass;
  message: string;
  code: string | null;
  retryable: boolean | null;
  resetAt: number | null;
  account?: RunAccount | null;
  login?: ProviderSignIn | null;
}

export interface ProviderSignIn {
  provider: string;
  email: string | null;
}

export type RunHandoffReason = 'provider_switch' | 'session_restore' | 'fork';

export interface RunHandoff {
  reason: RunHandoffReason;
  fromProvider: string;
  totalEntries: number;
  includedEntries: number;
  approxTokens: number;
}

export interface RunMeter {
  attemptId: string;
  window: string;
  from: number;
  to: number;
  usage: RunUsage;
  readings: WeeklyReading[];
}

export interface RunAttempt {
  attemptId: string;
  provider: string;
  model: string | null;
  resumed: boolean;
  handoff: RunHandoff | null;
  startedAt: number;
  account?: RunAccount | null;
  cwd?: string;
}

export type RunContinuationReason = 'shutdown' | 'crash';

export type GateStatus = 'open' | 'answered' | 'withdrawn';

export type GateDecision = 'approve' | 'revise' | 'reject' | 'reply';

export type GateType =
  | 'plan'
  | 'review'
  | 'merge'
  | 'question'
  | 'secret'
  | 'proposal'
  | 'operation'
  | 'failure'
  | 'configuration'
  | 'sign_in'
  | 'post_merge';

export type GateCause = 'budget' | 'monitor' | 'push_hook';

export type EditsApproval = 'review' | 'merge';

export type FindingVerdictKind = 'fix' | 'dismiss';

export interface FindingVerdict {
  index: number;
  verdict: FindingVerdictKind;
  note: string | null;
}

export type CommentSide = 'old' | 'new';

export interface ReviewComment {
  path: string;
  side: CommentSide;
  line: number;
  endLine: number | null;
  text: string;
}

export type ReviewEscalationReason = 'rounds' | 'stalled' | 'exhausted';

export interface FixFingerprint {
  reason: FixReason;
  signature: string | null;
  treeHash: string | null;
}

export interface ReviewEscalation {
  reason: ReviewEscalationReason;
  rounds: number;
  at: number;
}

export type ConfigProblemKind = 'repository' | 'no_repository' | 'default_branch' | 'workspace';

export interface ConfigProblem {
  kind: ConfigProblemKind;
  detail: string;
}

export type EvidenceKind = 'screenshot' | 'recording' | 'test' | 'check' | 'note' | 'preview';

export type EvidenceTheme = 'light' | 'dark';

export type EvidenceStage = 'before' | 'after';

export type EvidenceItemKind = 'comparison' | EvidenceKind;

export type EvidencePartKind = Extract<EvidenceKind, 'screenshot' | 'recording'>;

export type CiState = 'passing' | 'failing' | 'pending' | 'none';

export interface Repo {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  remote: string | null;
  projectId: string | null;
  checkCommands: string[];
  workspace?: WorkspaceMode;
  coverage?: CoverageSetting;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  key: string;
  description: string;
  folders: string[];
  watchSources?: WatchSource[];
}

export interface Focus {
  projectId: string | null;
  until: number | null;
}

export interface PullRequestChanges {
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PullRequest {
  number: number;
  url: string;
  base?: string;
  state: 'open' | 'merged' | 'closed';
  checks: CiState;
  unresolvedComments: number;
  mergeable: boolean | null;
  headSha?: string | null;
  updatedAt: number;
  checkRuns?: CiRun[];
  unresolvedThreads?: string[];
  mergeQueue?: MergeQueueEntry | null;
  queueRemoval?: string | null;
  mergeCommit?: string | null;
  changes?: PullRequestChanges | null;
}

export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PhaseProgress {
  status: PhaseStatus;
  at: number;
}

export interface PhaseReport {
  index: number;
  runId?: string | null;
  summary: string;
  spots: CodeSpot[];
  judgementCalls: JudgementCall[];
  walkthrough?: ReportWalkthrough | null;
  files?: string[];
  at: number;
}

export interface Plan {
  version: number;
  body: string;
  document: PlanDocument | null;
  proposedAt: number;
  changeSummary?: string | null;
  changes?: PlanChange[];
  feedback?: string | null;
  approvedAt?: number | null;
}

export type PlanRevision = Omit<Plan, 'approvedAt'>;

export type MonitorStatus = 'armed' | 'fired' | 'exhausted';

export interface Monitor {
  id: string;
  runId: string;
  role: RunRole;
  phaseIndex: number | null;
  notes: string;
  armedAt: number;
  nextCheckAt: number;
  timeoutAt: number;
  attempts: number;
  maxAttempts: number;
  status: MonitorStatus;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export interface RunSilence {
  since: number | null;
  snoozedUntil: number | null;
  dismissed: boolean;
}

export type SuggestionStatus = 'open' | 'accepted' | 'dismissed';

export interface TaskSuggestion {
  id: string;
  runId: string | null;
  title: string;
  request: string;
  why: string;
  waitsOnThis: boolean;
  status: SuggestionStatus;
  createdTaskId: string | null;
  suggestedAt: number;
  splitOff?: boolean;
  keptRound?: number | null;
}

export type ActivityActor = 'you' | 'agent' | 'shinsa';

export type ActivityKind =
  | 'asked'
  | 'set_up'
  | 'stage'
  | 'plan'
  | 'decision'
  | 'work'
  | 'review'
  | 'check'
  | 'fix'
  | 'pull_request'
  | 'evidence'
  | 'message'
  | 'note'
  | 'failure'
  | 'question'
  | 'monitor'
  | 'suggestion'
  | 'answer'
  | 'account'
  | 'delegation'
  | 'shape'
  | 'round'
  | 'fork'
  | 'watchdog';

export interface Activity {
  at: number;
  actor: ActivityActor;
  kind: ActivityKind;
  text: string;
  detail: string | null;
  evidenceId: string | null;
  runId?: string | null;
  gateType?: GateType;
  onBehalf?: boolean;
  byTask?: string | null;
  comments?: ReviewComment[];
  round?: number;
  noted?: boolean;
  undelivered?: UndeliveredMessage;
  suggestionId?: string;
}

export interface UntoldMessage {
  at: number;
  text: string;
  sender: 'agent' | 'schedule';
}

export interface UndeliveredMessage {
  text: string;
  reason: string;
}

export interface TaskOverlap {
  taskId: string;
  paths: string[];
  untold: string[];
}

export interface Task {
  id: string;
  handle?: string | null;
  projectId?: string | null;
  request: string;
  title: string;
  repoId: string | null;
  size: TaskSize | null;
  planFirst: boolean;
  stage: TaskStage;
  stageReason: string;
  cancelledFrom?: TaskStage | null;
  priority: TaskPriority;
  branch: string | null;
  worktreePath: string | null;
  workspace?: WorkspaceMode;
  returnBranch?: string;
  plan: Plan | null;
  phases: PhaseProgress[];
  planAnswers: string | null;
  summary: string | null;
  report: WorkReport | null;
  reviewSummary: string | null;
  findings: ReviewFinding[];
  fixRounds: number;
  fixFor: FixReason | null;
  fixSignature: string | null;
  stalledFixes: number;
  pushedSha?: string | null;
  pushedAt?: number | null;
  pushedFrom?: string | null;
  pushPending?: boolean;
  recoveries: number;
  phaseReports: PhaseReport[];
  checks?: TaskCheck[];
  runningChecks?: string[];
  checkResults: ReportCheck[] | null;
  coverage?: Coverage | null;
  pullRequest: PullRequest | null;
  pullRequestWatch?: PullRequestWatch | null;
  pullRequestReadFailures?: number;
  waitsOn: string[];
  note: string | null;
  origin: string | null;
  createdAt: number;
  updatedAt: number;
  stageChangedAt: number;
  activity: Activity[];
  mode?: TaskMode;
  planHistory?: PlanRevision[];
  dismissedFindings?: ReviewFinding[];
  reviewDisagreements?: ReviewDisagreement[];
  monitor?: Monitor | null;
  treeHash?: string | null;
  fixFingerprints?: FixFingerprint[];
  recoveryFingerprint?: string | null;
  suggestions?: TaskSuggestion[];
  budgetAcknowledgedUsd?: number;
  usageAcknowledgedPercent?: number;
  configProblems?: ConfigProblem[];
  account?: RunAccount | null;
  usageWait?: UsageWait | null;
  parentTaskId?: string | null;
  createdBy?: TaskCreator | null;
  forkOf?: string | null;
  splits?: TaskSplit[];
  scheduleId?: string | null;
  sourceReport?: SourceReport | null;
  watchHome?: boolean;
  pipeline?: PipelineStep[];
  auto: TaskAuto;
  triageDecisions?: TriageDecisions | null;
  result?: TaskResult | null;
  proposal?: ChangeProposal | null;
  shapeChanges?: ShapeChange[];
  proposedBranch?: string | null;
  rounds?: Round[];
  closedAt?: number | null;
  inbox?: InboxMessage[];
  editedPaths?: string[];
  untoldEdits?: string[];
  untoldMessages?: UntoldMessage[];
  overlaps?: TaskOverlap[];
  approvedEdits?: EditsApproval | null;
  pushHookFailure?: PushHookFailure | null;
  mergeStepsDone?: string[];
  carriedMergeSteps?: CarriedMergeStep[];
  watchdogs?: Watchdog[];
  backlog?: TaskBacklog | null;
}

export interface TaskBacklog {
  at: number;
}

export type BacklogCause = 'you' | 'started' | 'inquiry';

export interface InboxMessage {
  id: string;
  text: string;
  at: number;
}

export interface Run {
  id: string;
  taskId: string;
  role: RunRole;
  purpose?: RunPurpose;
  status?: RunStatus;
  phaseIndex?: number | null;
  prompt?: string;
  rolePrompt?: string;
  resume?: boolean;
  provider: string;
  model: string | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: RunOutcome | null;
  summary: string | null;
  attemptId?: string | null;
  attempts?: RunAttempt[];
  failure?: RunFailure | null;
  sessionProvider?: string | null;
  sessionLost?: boolean;
  resumePending?: boolean;
  continuations?: number[];
  monitorId?: string | null;
  continues?: string;
  feedback?: string | null;
  usage?: RunUsage | null;
  meters?: RunMeter[];
  silence?: RunSilence | null;
  usageWaitId?: string | null;
  account?: RunAccount | null;
  delegation?: RunDelegation | null;
  cohort?: DeliveryCohort | null;
  waitingOn?: RunWait | null;
  compactions?: string[];
  cacheExpiresAt?: number;
  fork?: RunFork | null;
  round?: number;
}

export interface RunFork {
  taskId: string;
  runId: string;
  sessionId: string;
}

export interface Gate {
  id: string;
  taskId: string;
  type: GateType;
  status: GateStatus;
  title: string;
  body: string;
  runId: string | null;
  openedAt: number;
  answeredAt: number | null;
  decision: GateDecision | null;
  response: string | null;
  planVersion?: number;
  choices?: string[];
  recommendation?: string | null;
  cause?: GateCause;
  escalation?: ReviewEscalation;
  verdicts?: FindingVerdict[];
  supersededBy?: string | null;
  provider?: string;
  account?: RunAccount | null;
  secret?: GateSecret | null;
  commit?: string | null;
  notes?: string | null;
  round?: number;
}

export interface Evidence {
  id: string;
  taskId: string;
  runId: string | null;
  kind: EvidenceKind;
  title: string;
  uri: string;
  attachedAt: number;
  round?: number;
  detail?: string;
  width?: number;
  theme?: EvidenceTheme;
  stage?: EvidenceStage;
  itemId?: string;
  label?: string;
  checkId?: string;
  key?: string;
  fixFor?: FixReason;
  replacedBy?: string;
  removedAt?: number;
  removedReason?: string;
  uploadUrl?: string;
}

export interface EvidenceUpload {
  evidenceId: string;
  url: string;
}

export interface EvidencePart {
  kind: EvidencePartKind;
  uri: string;
  stage?: EvidenceStage | null;
  label?: string | null;
}

export interface CheckEvidence {
  checkId: string;
  title: string;
  uri: string;
}
