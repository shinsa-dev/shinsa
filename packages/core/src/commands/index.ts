import type { Briefing } from '../briefing/types.ts';
import type {
  Area,
  EvidenceKind,
  GateDecision,
  PullRequest,
  Repo,
  RunOutcome,
  Settings,
  TaskPriority,
  TaskSize,
} from '../model/index.ts';
import type { CodeSpot, ReportCheck, ReportDecision, ReviewFinding, SpecDocument } from '../report/types.ts';

export type UserCommand =
  | { type: 'repo.register'; repo: Omit<Repo, 'id' | 'areaId'>; areaName: string | null }
  | { type: 'repo.update'; repoId: string; patch: Partial<Omit<Repo, 'id' | 'path'>> }
  | { type: 'repo.remove'; repoId: string }
  | { type: 'area.write'; area: Omit<Area, 'id'> & { id?: string } }
  | { type: 'area.remove'; areaId: string }
  | { type: 'focus.change'; areaId: string | null; until: number | null }
  | { type: 'settings.change'; patch: Partial<Settings> }
  | {
      type: 'task.create';
      intent: string;
      repoId: string | null;
      priority?: TaskPriority;
      specFirst?: boolean;
      origin?: string | null;
      blockedBy?: string[];
    }
  | { type: 'task.prioritize'; taskId: string; priority: TaskPriority }
  | { type: 'task.block'; taskId: string; blockedBy: string[] }
  | { type: 'task.cancel'; taskId: string }
  | { type: 'task.complete'; taskId: string }
  | { type: 'task.retry'; taskId: string }
  | { type: 'task.message'; taskId: string; text: string }
  | { type: 'gate.answer'; gateId: string; decision: GateDecision; response: string | null };

export type AgentCommand =
  | { type: 'agent.propose_plan'; runId: string; document: SpecDocument }
  | {
      type: 'agent.complete_phase';
      runId: string;
      summary: string;
      spots: CodeSpot[];
      decisions: ReportDecision[];
    }
  | { type: 'agent.complete_fix'; runId: string; summary: string }
  | { type: 'agent.report_review'; runId: string; findings: ReviewFinding[] }
  | { type: 'agent.ask'; runId: string; gateId: string; question: string; context: string | null }
  | { type: 'agent.attach_evidence'; runId: string; kind: EvidenceKind; title: string; uri: string }
  | { type: 'agent.note'; runId: string; note: string };

export type SystemCommand =
  | {
      type: 'task.triage';
      taskId: string;
      title: string;
      repoId: string;
      size: TaskSize;
      branch: string;
      dependsOn: string[];
    }
  | { type: 'worktree.ready'; taskId: string; path: string; branch: string }
  | { type: 'worktree.gone'; taskId: string }
  | { type: 'run.link'; runId: string; sessionId: string }
  | { type: 'run.end'; runId: string; outcome: RunOutcome; summary: string | null }
  | { type: 'pull_request.record'; taskId: string; pullRequest: PullRequest }
  | { type: 'checks.record'; taskId: string; results: ReportCheck[] }
  | { type: 'effect.fail'; taskId: string; title: string; detail: string }
  | { type: 'briefing.write'; areaId: string | null; text: string; briefing?: Briefing }
  | { type: 'message.deliver'; taskId: string; text: string }
  | { type: 'runs.dispatch' }
  | { type: 'pull_request.pushed'; taskId: string; sha: string };

export type ShinsaCommand = UserCommand | AgentCommand | SystemCommand;

export type CommandOf<T extends ShinsaCommand['type']> = Extract<ShinsaCommand, { type: T }>;
