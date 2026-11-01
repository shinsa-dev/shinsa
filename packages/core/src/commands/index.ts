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
  FindingVerdict,
  GateDecision,
  MessageKind,
  PipelineStep,
  Project,
  PullRequest,
  Repo,
  ReviewComment,
  RoundShipping,
  RunAccount,
  RunFailure,
  RunHandoff,
  RunOutcome,
  RunUsage,
  Settings,
  TaskMode,
  TaskPriority,
  TaskShape,
  TaskSize,
  TeammateOriginal,
  UnreachedTeammate,
  WeeklyReading,
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
import type {
  DelegationAgentCommand,
  DelegationSystemCommand,
  DelegationUserCommand,
} from './delegations.ts';
import type { FeedbackAgentCommand, FeedbackSystemCommand, FeedbackUserCommand } from './feedback.ts';
import type { MemoryAgentCommand, MemoryUserCommand } from './memory.ts';
import { isUserCommandType } from './parse.ts';
import type { ScheduleAgentCommand, ScheduleSystemCommand, ScheduleUserCommand } from './schedules.ts';
import type { ShareSystemCommand, ShareUserCommand } from './shares.ts';
import type { SlackSystemCommand } from './slack.ts';
import type { TeamUserCommand } from './teams.ts';
import type { WatchdogSystemCommand, WatchdogUserCommand } from './watchdogs.ts';

export interface ChangeProposalInput {
  request: string;
  why: string;
}

export type ProjectInput = Pick<Project, 'name' | 'color'> &
  Partial<Pick<Project, 'id' | 'key' | 'description' | 'folders'>>;

export interface MessageRoute {
  kind?: MessageKind;
  title?: string;
  why?: string;
  shape?: TaskShape;
}

export type InquiryShape = Extract<TaskShape, 'answer' | 'investigate' | 'research'>;

export interface TriageReasons {
  shape?: string;
  priority?: string;
  start?: string;
  duplicate?: string;
}

export type UserCommand =
  | { type: 'repo.update'; repoId: string; patch: Partial<Omit<Repo, 'id' | 'path'>> }
  | { type: 'repo.remove'; repoId: string }
  | { type: 'project.write'; project: ProjectInput }
  | { type: 'project.remove'; projectId: string }
  | { type: 'focus.change'; projectId: string | null; teamId?: string | null; until: number | null }
  | { type: 'settings.change'; patch: Partial<Settings> }
  | {
      type: 'task.create';
      request: string;
      repoId: string | null;
      projectId?: string | null;
      priority?: TaskPriority;
      planFirst?: boolean;
      origin?: string | null;
      waitsOn?: string[];
      stacksOn?: string;
      mode?: TaskMode;
      account?: RunAccount | null;
      forkOf?: string;
      backlog?: boolean;
    }
  | { type: 'task.prioritize'; taskId: string; priority: TaskPriority }
  | { type: 'task.wait_on'; taskId: string; waitsOn: string[] }
  | { type: 'task.stack_on'; taskId: string; stacksOn: string | null }
  | { type: 'task.move_to_backlog'; taskId: string }
  | { type: 'task.remove_from_backlog'; taskId: string }
  | { type: 'task.snooze'; taskId: string }
  | { type: 'task.unsnooze'; taskId: string }
  | { type: 'task.cancel'; taskId: string }
  | { type: 'task.mark_duplicate'; taskId: string; duplicateOf: string }
  | { type: 'task.clear_duplicate'; taskId: string }
  | { type: 'task.complete'; taskId: string }
  | { type: 'task.retry'; taskId: string; account?: RunAccount }
  | ({ type: 'task.message'; taskId: string; text: string } & MessageRoute)
  | { type: 'round.ship'; taskId: string; number: number; shipping: RoundShipping }
  | { type: 'round.update'; taskId: string; number: number; request: string }
  | { type: 'round.remove'; taskId: string; number: number }
  | { type: 'round.send'; taskId: string; number: number }
  | {
      type: 'gate.answer';
      gateId: string;
      decision: GateDecision;
      response: string | null;
      planVersion?: number;
      verdicts?: FindingVerdict[];
      comments?: ReviewComment[];
    }
  | { type: 'merge_step.tick'; taskId: string; key: string; done: boolean }
  | {
      type: 'suggestion.accept';
      taskId: string;
      suggestionId: string;
      waitsOnThis: boolean;
      backlog?: boolean;
    }
  | { type: 'suggestion.dismiss'; taskId: string; suggestionId: string }
  | { type: 'suggestion.keep'; taskId: string; suggestionId: string; shape?: TaskShape }
  | { type: 'monitor.check_in_now'; taskId: string }
  | { type: 'run.snooze_silence'; runId: string; until: number }
  | { type: 'run.dismiss_silence'; runId: string }
  | { type: 'task.bind_account'; taskId: string; account: RunAccount | null }
  | { type: 'usage_wait.change'; taskId: string; autoResume: boolean }
  | { type: 'usage_wait.resume_now'; taskId: string }
  | DelegationUserCommand
  | ScheduleUserCommand
  | WatchdogUserCommand
  | MemoryUserCommand
  | FeedbackUserCommand
  | ShareUserCommand
  | TeamUserCommand;

type AgentCommand =
  | {
      type: 'agent.propose_plan';
      runId: string;
      document: PlanDocument;
      reply?: AgentReply | null;
    }
  | {
      type: 'agent.complete_phase';
      runId: string;
      summary: string;
      spots: CodeSpot[];
      judgementCalls: JudgementCall[];
      reply?: AgentReply | null;
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
    }
  | ({ type: 'agent.reshape'; runId: string; reason: string } & (
      | { shape: InquiryShape }
      | { steps: PipelineStep[] }
    ))
  | { type: 'agent.request_secret'; runId: string; gateId: string; label: string; reason: string }
  | DelegationAgentCommand
  | ScheduleAgentCommand
  | MemoryAgentCommand
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
  | { type: 'config.record'; taskId: string; problems: ConfigProblem[]; repoId?: string }
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
  | { type: 'onboarding.welcome'; body: string }
  | DelegationSystemCommand
  | ScheduleSystemCommand
  | SlackSystemCommand
  | WatchdogSystemCommand
  | FeedbackSystemCommand
  | ShareSystemCommand;

type ScopedAgentCommand = AgentCommand & { attemptId?: string | null };

export type ShinsaCommand = UserCommand | ScopedAgentCommand | SystemCommand;

export function isAgentCommand(command: ShinsaCommand): command is ScopedAgentCommand {
  return command.type.startsWith('agent.');
}

export function isUserCommand(command: ShinsaCommand): command is UserCommand {
  return isUserCommandType(command.type);
}

export type CommandOf<T extends ShinsaCommand['type']> = Extract<ShinsaCommand, { type: T }>;

export { parseUserCommand, USER_COMMAND_TYPES } from './parse.ts';
export type { ReportFiling, ScheduleTargetInput } from './schedules.ts';
