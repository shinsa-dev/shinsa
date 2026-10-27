import type {
  CheckEvidence,
  ConfigProblem,
  DeliveringStep,
  EvidenceKind,
  EvidencePart,
  EvidenceStage,
  EvidenceTheme,
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
} from '../domain/index.ts';
import type { PullRequestRemark } from '../domain/pull-requests.ts';
import type {
  CodeSpot,
  JudgementCall,
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
import type { MemoryAgentCommand, MemoryUserCommand } from './memory.ts';
import { isUserCommandType } from './parse.ts';
import type { ScheduleAgentCommand, ScheduleSystemCommand, ScheduleUserCommand } from './schedules.ts';

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
}

export type UserCommand =
  | { type: 'repo.update'; repoId: string; patch: Partial<Omit<Repo, 'id' | 'path'>> }
  | { type: 'repo.remove'; repoId: string }
  | { type: 'project.write'; project: ProjectInput }
  | { type: 'project.remove'; projectId: string }
  | { type: 'focus.change'; projectId: string | null; until: number | null }
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
      mode?: TaskMode;
      account?: RunAccount | null;
    }
  | { type: 'task.prioritize'; taskId: string; priority: TaskPriority }
  | { type: 'task.wait_on'; taskId: string; waitsOn: string[] }
  | { type: 'task.cancel'; taskId: string }
  | { type: 'task.complete'; taskId: string }
  | { type: 'task.retry'; taskId: string; account?: RunAccount }
  | ({ type: 'task.message'; taskId: string; text: string } & MessageRoute)
  | { type: 'round.ship'; taskId: string; number: number; shipping: RoundShipping }
  | { type: 'round.update'; taskId: string; number: number; request: string }
  | { type: 'round.remove'; taskId: string; number: number }
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
  | { type: 'suggestion.accept'; taskId: string; suggestionId: string; waitsOnThis: boolean }
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
  | MemoryUserCommand;

type AgentCommand =
  | { type: 'agent.propose_plan'; runId: string; document: PlanDocument; changeSummary?: string | null }
  | {
      type: 'agent.complete_phase';
      runId: string;
      summary: string;
      spots: CodeSpot[];
      judgementCalls: JudgementCall[];
      walkthrough?: ReportWalkthrough | null;
      treeHash?: string | null;
    }
  | {
      type: 'agent.complete_fix';
      runId: string;
      summary: string;
      walkthrough?: ReportWalkthroughRevision | null;
      treeHash?: string | null;
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
      kind: EvidenceKind;
      title: string;
      uri: string;
      detail?: string | null;
      width?: number | null;
      theme?: EvidenceTheme | null;
      stage?: EvidenceStage | null;
    }
  | {
      type: 'agent.attach_comparison';
      runId: string;
      title: string;
      parts: EvidencePart[];
      detail?: string | null;
      width?: number | null;
      theme?: EvidenceTheme | null;
    }
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
      proposal?: ChangeProposalInput | null;
    }
  | ({ type: 'agent.reshape'; runId: string; reason: string } & (
      | { shape: InquiryShape }
      | { steps: PipelineStep[] }
    ))
  | { type: 'agent.request_secret'; runId: string; gateId: string; label: string; reason: string }
  | DelegationAgentCommand
  | ScheduleAgentCommand
  | MemoryAgentCommand;

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
      reasons?: TriageReasons;
    }
  | { type: 'worktree.ready'; taskId: string; path: string; branch: string; returnBranch?: string }
  | { type: 'worktree.gone'; taskId: string }
  | { type: 'task.stack'; taskId: string; branch: string }
  | { type: 'task.record_conflict'; taskId: string; branch: string }
  | { type: 'task.record_edit'; taskId: string; path: string; changed: boolean }
  | { type: 'task.commit_edits'; taskId: string; treeHash: string | null }
  | {
      type: 'task.record_overlaps';
      taskId: string;
      overlaps: { taskId: string; paths: string[] }[];
      from: string;
    }
  | { type: 'task.record_workspace_update'; taskId: string; guidance: string | null }
  | { type: 'run.link'; runId: string; sessionId: string; attemptId?: string | null; provider: string }
  | {
      type: 'run.end';
      runId: string;
      outcome: RunOutcome;
      summary: string | null;
      attemptId?: string | null;
      failure?: RunFailure | null;
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
    }
  | { type: 'pull_request.read_failed'; taskId: string; detail: string }
  | {
      type: 'checks.record';
      taskId: string;
      results: ReportCheck[];
      evidence?: CheckEvidence;
      coverage?: Coverage;
    }
  | { type: 'effect.fail'; taskId: string; title: string; detail: string }
  | { type: 'message.deliver'; taskId: string; text: string }
  | { type: 'message.receive'; taskId: string; text: string }
  | ({ type: 'message.route'; taskId: string; messageIds: string[] } & MessageRoute)
  | { type: 'message.drop'; taskId: string; messageIds: string[]; reason: string }
  | { type: 'runs.dispatch' }
  | { type: 'monitor.fire'; taskId: string; monitorId: string; attempt: number }
  | { type: 'run.meter'; runId: string; usage: RunUsage; sessionId?: string | null; weeklyPercent?: number }
  | { type: 'run.silence'; runId: string; since: number | null }
  | { type: 'config.record'; taskId: string; problems: ConfigProblem[]; repoId?: string }
  | { type: 'pull_request.record_push'; taskId: string; sha: string }
  | { type: 'usage_wait.resume'; taskId: string; waitId: string }
  | { type: 'account.signed_in'; account: RunAccount }
  | { type: 'provider.record_sign_in'; provider: string }
  | { type: 'account.removed'; accountId: string }
  | DelegationSystemCommand
  | ScheduleSystemCommand;

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
export type { ScheduleTargetInput } from './schedules.ts';
