import type {
  CodeSpot,
  ReportCheck,
  ReportDecision,
  ReviewFinding,
  SpecDocument,
  WorkReport,
} from '../report/types.ts';

export type TaskStage =
  | 'triage'
  | 'queued'
  | 'planning'
  | 'awaiting_spec'
  | 'building'
  | 'checking'
  | 'reviewing'
  | 'fixing'
  | 'awaiting_review'
  | 'shipping'
  | 'awaiting_merge'
  | 'merged'
  | 'done'
  | 'cancelled';

export type TaskSize = 'small' | 'large';

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export type RunRole = 'triage' | 'planner' | 'builder' | 'reviewer' | 'fixer' | 'shipper';

export type AgentRole = 'classifier' | 'planner' | 'builder' | 'reviewer' | 'fixer' | 'writer';

export type FixReason = 'checks' | 'review' | 'you' | 'pull_request';

export type RunStatus = 'queued' | 'running';

export type RunOutcome = 'completed' | 'failed' | 'cancelled';

export type GateKind = 'spec' | 'review' | 'merge' | 'question';

export type GateStatus = 'open' | 'answered' | 'withdrawn';

export type GateDecision = 'approve' | 'revise' | 'reject' | 'answer';

export type GatePurpose = 'decision' | 'agent_question' | 'failure';

export type EvidenceKind = 'screenshot' | 'recording' | 'test' | 'check' | 'note' | 'preview';

export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

export interface Repo {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  remote: string | null;
  areaId: string | null;
  checkCommands: string[];
  previewCommand: string | null;
}

export interface Area {
  id: string;
  name: string;
  color: string;
}

export interface Focus {
  areaId: string | null;
  until: number | null;
}

export interface PullRequest {
  number: number;
  url: string;
  base?: string;
  state: 'open' | 'merged' | 'closed';
  checks: ChecksState;
  unresolvedComments: number;
  mergeable: boolean | null;
  headSha?: string | null;
  updatedAt: number;
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
  decisions: ReportDecision[];
  at: number;
}

export interface Spec {
  version: number;
  body: string;
  document: SpecDocument | null;
  proposedAt: number;
}

export type ActivityActor = 'you' | 'agent' | 'shinsa';

export type ActivityKind =
  | 'asked'
  | 'set_up'
  | 'stage'
  | 'spec'
  | 'decision'
  | 'work'
  | 'review'
  | 'fix'
  | 'pull_request'
  | 'evidence'
  | 'message'
  | 'note'
  | 'failure'
  | 'question';

export interface Activity {
  at: number;
  actor: ActivityActor;
  kind: ActivityKind;
  text: string;
  detail: string | null;
  evidenceId: string | null;
  runId?: string | null;
}

export interface Task {
  id: string;
  intent: string;
  title: string;
  repoId: string | null;
  size: TaskSize | null;
  specFirst: boolean;
  stage: TaskStage;
  stageReason: string;
  priority: TaskPriority;
  branch: string | null;
  worktreePath: string | null;
  spec: Spec | null;
  phases: PhaseProgress[];
  specAnswers: string | null;
  summary: string | null;
  report: WorkReport | null;
  findings: ReviewFinding[];
  fixRounds: number;
  fixFor: FixReason | null;
  fixSignature: string | null;
  stalledFixes: number;
  fixHistory?: string[];
  pushedSha?: string | null;
  pushPending?: boolean;
  recoveries: number;
  phaseReports: PhaseReport[];
  checkResults: ReportCheck[] | null;
  pullRequest: PullRequest | null;
  baseTaskId: string | null;
  blockedBy: string[];
  note: string | null;
  origin: string | null;
  createdAt: number;
  updatedAt: number;
  stageChangedAt: number;
  activity: Activity[];
}

export interface Run {
  id: string;
  taskId: string;
  role: RunRole;
  status?: RunStatus;
  phaseIndex?: number | null;
  prompt?: string;
  resume?: boolean;
  provider: string;
  model: string | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: RunOutcome | null;
  summary: string | null;
}

export interface Gate {
  id: string;
  taskId: string;
  kind: GateKind;
  purpose: GatePurpose;
  status: GateStatus;
  title: string;
  body: string;
  runId: string | null;
  openedAt: number;
  answeredAt: number | null;
  decision: GateDecision | null;
  response: string | null;
}

export interface Evidence {
  id: string;
  taskId: string;
  runId: string | null;
  kind: EvidenceKind;
  title: string;
  uri: string;
  attachedAt: number;
}
