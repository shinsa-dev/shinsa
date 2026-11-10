import type {
  BundleConflict,
  CheckEvidence,
  ConfigProblem,
  DeliveringStep,
  EvidenceKind,
  EvidencePart,
  EvidenceStage,
  EvidenceTheme,
  EvidenceUpload,
  MessageKind,
  PipelineStep,
  PullRequest,
  Repo,
  RepoStart,
  RunAccount,
  RunFailure,
  RunHandoff,
  RunOutcome,
  RunUsage,
  TaskPriority,
  PresetShape,
  TaskShape,
  TaskSize,
  TeammateOriginal,
  UnreachedTeammate,
  WeeklyReading,
  ProposalRecommendation,
  SuggestedAction,
} from '../domain/index.ts';
import type {
  PullRequestCloseFailure,
  PullRequestRemark,
  RepoCi,
  ShippingStep,
  ShippingStepKind,
} from '../domain/pull-requests.ts';
import type {
  AgentReply,
  CheckChangeHandOver,
  CodeSpot,
  JudgementCall,
  LinkedEvidenceKind,
  PlanDocument,
  ReportCheck,
  ReportWalkthrough,
  ReportWalkthroughRevision,
  ReviewFinding,
  SuggestedTask,
} from '../report/types.ts';
import type { Coverage } from '../test-coverage/types.ts';
import type { DelegationAgentCommand, DelegationSystemCommand } from './delegations.ts';
import type { FeedbackAgentCommand, FeedbackSystemCommand } from './feedback.ts';
import type { HandoffSystemCommand } from './handoffs.ts';
import type { InitiativeAgentCommand, InitiativeSystemCommand } from './initiatives.ts';
import type { MemoryAgentCommand } from './memory.ts';
import { isUserCommandType } from './parse.ts';
import type { ScheduleAgentCommand, ScheduleSystemCommand } from './schedules.ts';
import type { UserCommand } from './schema.ts';
import type { ShareSystemCommand } from './shares.ts';
import type { SlackSystemCommand } from './slack.ts';
import type { WatchdogSystemCommand } from './watchdogs.ts';

export interface ChangeProposalInput {
  request: string;
  why: string;
}

export interface MessageRoute {
  kind?: MessageKind;
  title?: string;
  why?: string;
  shape?: PresetShape;
}

export type InquiryShape = Extract<TaskShape, 'answer' | 'investigate' | 'research'>;

export interface TriageReasons {
  shape?: string;
  priority?: string;
  start?: string;
  stack?: string;
  duplicate?: string;
}

type AgentCommand =
  | {
      type: 'agent.propose_plan';
      runId: string;
      document: PlanDocument;
      reply?: AgentReply | null;
      actions?: SuggestedAction[];
    }
  | {
      type: 'agent.complete_phase';
      runId: string;
      summary: string;
      spots: CodeSpot[];
      judgementCalls: JudgementCall[];
      reply?: AgentReply | null;
      actions?: SuggestedAction[];
      walkthrough?: ReportWalkthrough | null;
      checkChanges?: CheckChangeHandOver[];
      treeHash?: string | null;
      files?: string[];
    }
  | {
      type: 'agent.complete_fix';
      runId: string;
      summary: string;
      reply?: AgentReply | null;
      actions?: SuggestedAction[];
      walkthrough?: ReportWalkthroughRevision | null;
      checks?: string[];
      checkChanges?: CheckChangeHandOver[];
      evidenceKept?: string[];
      treeHash?: string | null;
      files?: string[];
    }
  | {
      type: 'agent.report_review';
      runId: string;
      summary: string | null;
      findings: ReviewFinding[];
      disagreements?: { call: number; reason: string }[];
    }
  | {
      type: 'agent.ask';
      runId: string;
      gateId: string;
      question: string;
      context: string | null;
      choices?: string[];
      recommendation?: string | null;
    }
  | {
      type: 'agent.attach_evidence';
      runId: string;
      kind: Exclude<EvidenceKind, LinkedEvidenceKind>;
      title: string;
      uri: string;
      detail?: string | null;
      width?: number | null;
      theme?: EvidenceTheme | null;
      stage?: EvidenceStage | null;
      key?: string | null;
      replaces?: string[];
    }
  | {
      type: 'agent.attach_comparison';
      runId: string;
      title: string;
      parts: EvidencePart[];
      detail?: string | null;
      width?: number | null;
      theme?: EvidenceTheme | null;
      key?: string | null;
      replaces?: string[];
    }
  | {
      type: 'agent.attach_check';
      runId: string;
      kind: LinkedEvidenceKind;
      checkId: string;
      detail?: string | null;
      replaces?: string[];
    }
  | { type: 'agent.remove_evidence'; runId: string; items: string[]; reason: string }
  | { type: 'agent.note'; runId: string; note: string }
  | {
      type: 'agent.wait_for';
      runId: string;
      checkInMinutes: number;
      notes: string;
      timeoutMinutes: number | null;
      maxAttempts: number | null;
    }
  | { type: 'agent.suggest_tasks'; runId: string; suggestions: SuggestedTask[] }
  | {
      type: 'agent.deliver';
      runId: string;
      step: DeliveringStep;
      body: string;
      reply?: AgentReply | null;
      proposal?: ChangeProposalInput | null;
      recommend?: ProposalRecommendation | null;
      actions?: SuggestedAction[];
    }
  | ({ type: 'agent.reshape'; runId: string; reason: string } & (
      | { shape: InquiryShape }
      | { steps: PipelineStep[] }
    ))
  | { type: 'agent.request_secret'; runId: string; gateId: string; label: string; reason: string }
  | { type: 'agent.request_browser_sign_in'; runId: string; gateId: string; url: string; reason: string }
  | DelegationAgentCommand
  | ScheduleAgentCommand
  | MemoryAgentCommand
  | InitiativeAgentCommand
  | FeedbackAgentCommand;

type SystemCommand =
  | {
      type: 'repo.register';
      repo: Omit<Repo, 'id' | 'projectId'>;
      projectName: string | null;
      projectId?: string | null;
    }
  | {
      type: 'task.triage';
      taskId: string;
      title: string;
      repoId: string | null;
      size: TaskSize;
      branch: string;
      waitsOn: string[];
      stacksOn?: string[];
      shape?: TaskShape;
      priority?: TaskPriority;
      duplicateOf?: string;
      duplicateOfTeammate?: TeammateOriginal;
      unreached?: UnreachedTeammate[];
      reasons?: TriageReasons;
    }
  | { type: 'worktree.ready'; taskId: string; path: string; branch: string; returnBranch?: string }
  | { type: 'worktree.gone'; taskId: string }
  | { type: 'task.record_edit'; taskId: string; path: string; changed: boolean }
  | { type: 'task.commit_edits'; taskId: string; treeHash: string | null }
  | {
      type: 'task.record_overlaps';
      taskId: string;
      overlaps: { taskId: string; paths: string[] }[];
      from: string;
    }
  | { type: 'run.link'; runId: string; sessionId: string; attemptId?: string | null; provider: string }
  | {
      type: 'run.end';
      runId: string;
      outcome: RunOutcome;
      summary: string | null;
      attemptId?: string | null;
      failure?: RunFailure | null;
      cacheExpiresAt?: number | null;
    }
  | {
      type: 'run.attempt';
      runId: string;
      attemptId: string;
      provider: string;
      model: string | null;
      resumed: boolean;
      handoff: RunHandoff | null;
      account?: RunAccount | null;
      cwd?: string | null;
    }
  | { type: 'run.interrupt'; runId: string; attemptId?: string | null }
  | { type: 'run.continue'; runId: string }
  | { type: 'run.record_lost_session'; runId: string; sessionId: string }
  | { type: 'run.compact'; runId: string; sessionId: string }
  | {
      type: 'pull_request.record';
      taskId: string;
      pullRequest: PullRequest;
      remarks?: PullRequestRemark[] | null;
      viewer?: string | null;
      ci?: RepoCi;
    }
  | { type: 'pull_request.read_failed'; taskId: string; detail: string }
  | {
      type: 'checks.record';
      taskId: string;
      results: ReportCheck[];
      outputs?: CheckEvidence[];
      coverage?: Coverage;
    }
  | { type: 'effect.fail'; taskId: string; title: string; detail: string }
  | { type: 'message.deliver'; taskId: string; text: string }
  | { type: 'message.receive'; taskId: string; text: string }
  | ({ type: 'message.route'; taskId: string; messageIds: string[] } & MessageRoute)
  | { type: 'message.drop'; taskId: string; messageIds: string[]; reason: string }
  | { type: 'runs.dispatch' }
  | { type: 'monitor.fire'; taskId: string; monitorId: string; attempt: number }
  | {
      type: 'run.meter';
      runId: string;
      usage: RunUsage;
      sessionId?: string | null;
      readings?: WeeklyReading[];
    }
  | { type: 'run.silence'; runId: string; since: number | null }
  | {
      type: 'config.record';
      taskId: string;
      problems: ConfigProblem[];
      repoId?: string;
      started?: RepoStart;
    }
  | { type: 'pull_request.record_push'; taskId: string; sha: string }
  | { type: 'pull_request.record_step'; taskId: string; step: ShippingStep }
  | {
      type: 'pull_request.record_retry';
      taskId: string;
      step: ShippingStepKind;
      attempt: number;
      attempts: number;
      retryAt: number;
      detail: string;
    }
  | { type: 'pull_request.record_update_conflict'; taskId: string; base: string; files: string[] }
  | { type: 'bundle.record_check'; taskId: string; conflict: BundleConflict | null }
  | { type: 'pull_request.record_hook_failure'; taskId: string; output: string; failures: string[] | null }
  | {
      type: 'pull_request.record_closed';
      taskId: string;
      closed: number[];
      failed: PullRequestCloseFailure[];
    }
  | { type: 'evidence.record_uploads'; taskId: string; uploads: EvidenceUpload[] }
  | { type: 'usage_wait.resume'; taskId: string; waitId: string }
  | { type: 'account.signed_in'; account: RunAccount }
  | { type: 'provider.record_sign_in'; provider: string }
  | { type: 'account.removed'; accountId: string }
  | { type: 'account.plan_recorded'; accountId: string; provider: string; plan: string | null }
  | { type: 'usage.pace_recorded'; provider: string; pace: number | null }
  | { type: 'onboarding.welcome'; body: string }
  | DelegationSystemCommand
  | ScheduleSystemCommand
  | SlackSystemCommand
  | WatchdogSystemCommand
  | FeedbackSystemCommand
  | ShareSystemCommand
  | InitiativeSystemCommand
  | HandoffSystemCommand;

type ScopedAgentCommand = AgentCommand & { attemptId?: string | null };

export type ShinsaCommand = UserCommand | ScopedAgentCommand | SystemCommand;

export function isAgentCommand(command: ShinsaCommand): command is ScopedAgentCommand {
  return command.type.startsWith('agent.');
}

export function isUserCommand(command: ShinsaCommand): command is UserCommand {
  return isUserCommandType(command.type);
}

export type CommandOf<T extends ShinsaCommand['type']> = Extract<ShinsaCommand, { type: T }>;

export { parseUserCommand } from './parse.ts';
export { ProjectInput, USER_COMMAND_TYPES, UserCommand } from './schema.ts';
export type { ReportFiling, ScheduleTargetInput } from './schedules.ts';
