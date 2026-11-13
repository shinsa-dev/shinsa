import type {
  AgentReply,
  ChatEvent,
  ChatTool,
  CiRun,
  FixReason,
  Gate,
  GateType,
  PipelineStep,
  PlanCheck,
  PlanDocument,
  PullRequestChanges,
  Repo,
  ReportCheck,
  ReviewDisagreement,
  ReviewFinding,
  ReviewRatings,
  RunPurpose,
  RunRole,
  ShinsaEventInput,
  SourceReport,
  TaskAuto,
  TaskCreator,
  TaskPriority,
  TaskShape,
  TaskSize,
  TaskStage,
  TriageDecisions,
  WorkReport,
} from '../../packages/core/src/index.ts';
import { listRepoChecks } from '../../packages/core/src/index.ts';
import { MINUTE } from '../kit/time.ts';

export const NOW = Date.now();

export const CHOSEN_BY_YOU: TaskAuto = { shape: false, start: false, priority: false, project: false };

export const NO_TRIAGE_DECISIONS: TriageDecisions = { shape: null, start: null, priority: null };

export type Push = (at: number, event: ShinsaEventInput) => void;

export type TimedSeedEvent = { at: number; event: ShinsaEventInput };

export interface SeedClock {
  at: number;
  step: (minutes: number) => number;
}

export function createSeedClock(start: number): SeedClock {
  const clock: SeedClock = {
    at: start,
    step: (minutes) => {
      clock.at += minutes * MINUTE;
      return clock.at;
    },
  };
  return clock;
}

export interface SeedRun {
  role: RunRole;
  purpose?: RunPurpose;
  fix?: FixReason;
  minutes: number;
  afterMinutes?: number;
  summary: string;
  reply?: string;
  failed?: boolean;
  handover?: ChatTool;
}

export function resolveAgentSession(taskId: string) {
  return `session-${taskId}-agent`;
}

export interface SeedTask {
  id: string;
  request: string;
  title: string;
  repo: Repo;
  size: TaskSize;
  stage: TaskStage;
  reason: string;
  priority?: TaskPriority;
  branch: string;
  ageHours: number;
  planFirst?: boolean;
  waitsOn?: string[];
  forkOf?: string;
  createdBy?: TaskCreator;
  sourceReport?: SourceReport;
  watchHome?: boolean;
  worktreePath?: string;
  plan?: PlanDocument;
  verification?: PlanCheck[];
  addedChecks?: SeedAddedCheck[];
  report?: SeedReport;
  checkResults?: Record<string, SeedCheckResult>;
  summary?: string;
  reviewSummary?: string;
  findings?: ReviewFinding[];
  reviewRatings?: ReviewRatings;
  reviewDisagreements?: ReviewDisagreement[];
  runs?: SeedRun[];
  gate?: { type: GateType; title: string; body: string; details?: Partial<Gate> };
  pullRequest?: {
    number: number;
    checks: 'passing' | 'failing' | 'pending';
    comments?: number;
    mergeCommit?: string;
    ciRuns?: CiRun[];
    changes?: PullRequestChanges;
  };
  merged?: boolean;
  note?: string;
  shape?: TaskShape;
  auto?: TaskAuto;
  decisions?: TriageDecisions;
  composed?: { pipeline: PipelineStep[]; why: string };
  ticked?: string[];
  extra?: ShinsaEventInput[];
  timed?: TimedSeedEvent[];
  provider?: 'codex';
  revision?: { afterRun: number; response: string };
  review?: { minutes: number; autopilot?: string };
  script?: (push: Push, clock: SeedClock) => void;
}

export type SeedReport = Omit<WorkReport, 'checks'>;

interface SeedAddedCheck extends PlanCheck {
  phase: number;
  run: number;
  reason: string;
}

export type SeedCheckResult = Partial<Pick<ReportCheck, 'outcome' | 'detail' | 'note'>>;

export interface SeedExchange {
  text: string;
  comments?: number;
  reply: AgentReply;
}

export function listSeedIterations(
  taskId: string,
  runId: string,
  exchanges: SeedExchange[]
): ShinsaEventInput[] {
  return exchanges.flatMap((exchange, index) => {
    const iterationId = `${taskId}-iteration-${index + 1}`;
    return [
      {
        type: 'iteration.requested',
        taskId,
        iterationId,
        round: 1,
        text: exchange.text,
        comments: exchange.comments ?? 0,
      },
      { type: 'iteration.answered', taskId, iterationId, runId, reply: exchange.reply },
    ];
  });
}

export function createPlanCheck(label: string, command: string, phases: number[] = [1]): PlanCheck {
  return { label, command, phases };
}

export function listSeedCheckResults(
  verification: readonly PlanCheck[],
  repo: Pick<Repo, 'checkCommands'> | null,
  results: Record<string, SeedCheckResult> = {}
): ReportCheck[] {
  const checks = [
    ...verification.map((check, index) => ({
      id: `c${index + 1}`,
      label: check.label,
      command: check.command,
    })),
    ...listRepoChecks(repo),
  ];
  return checks.map(({ id, label, command }) => ({
    id,
    label,
    command,
    outcome: 'pass',
    detail: null,
    ...results[id],
  }));
}

export type TimedChatEvent = { at: number; event: ChatEvent };

export function callTool(callId: string, tool: ChatTool): ChatEvent {
  return { type: 'tool_call', callId, tool };
}

export function resolveToolOutput(callId: string, output: string): ChatEvent {
  return { type: 'tool_result', callId, status: 'ok', output, images: [] };
}

export function say(text: string, phase: 'interim' | 'final' = 'interim'): ChatEvent {
  return { type: 'agent', phase, text };
}

export function spreadEvents(events: ChatEvent[], from: number, to: number): TimedChatEvent[] {
  const span = Math.max(events.length, to - from);
  return events.map((event, index) => ({
    at: from + Math.round((span * index) / Math.max(1, events.length - 1)),
    event,
  }));
}

export interface SeedTranscript {
  runId: string;
  timed: TimedChatEvent[];
}
