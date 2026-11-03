import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import {
  type CommandOf,
  type DomainError,
  type Repo,
  type Run,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { Effect } from 'effect';
import type { Engine } from '../../runtime/engine.ts';
import type { ScheduleToolCall } from '../../schedules/index.ts';
import type { EvidenceFolder } from '../../store/evidence/index.ts';
import type { EvidenceStore } from '../../store/index.ts';
import type { Workspaces } from '../../workspaces/index.ts';
import type { storeEvidence } from '../handover.ts';
import { type ManageAccess } from '../manage/index.ts';
import type { ProviderRegistry } from '../providers/index.ts';
import type { Questions } from '../questions.ts';
import type { QuestionsHandle } from '../questions/schema.ts';
import type { RepositoryWorkHandle } from '../repository-work/schema.ts';
import { type ServiceRunner, type TaskServiceRunner } from '../services.ts';
import type { ToolCallFailed } from '../tools/schema.ts';
import type { Transcripts } from '../transcripts/index.ts';

export interface ScheduleToolHandler {
  handleTool: (
    name: string,
    input: Record<string, unknown>,
    call: ScheduleToolCall
  ) => Promise<string> | null;
}

export interface ToolCallsOptions {
  engine: Engine;
  evidence: EvidenceStore;
  transcripts: Transcripts;
  providers: ProviderRegistry;
  questions: Questions;
  schedules: ScheduleToolHandler | null;
  minuteMs: number;
  manage: ManageAccess | null;
  workspaces: Workspaces;
  services: TaskServiceRunner | null;
  listServerNames: (run: Run) => Promise<string[]>;
}

export interface ToolCall {
  runId: string;
  attemptId: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  requestId?: RequestId;
}

export type CommitHandOver =
  | Omit<CommandOf<'agent.complete_phase'>, 'treeHash' | 'files'>
  | Omit<CommandOf<'agent.complete_fix'>, 'treeHash' | 'files'>;

export type HandOverTool = 'propose_plan' | 'complete_phase' | 'complete_fix' | 'report_review';

type EvidenceCommand = ReturnType<typeof storeEvidence>;

type ToolCallFailure = ToolCallFailed | DomainError;

export type EffectCallDispatch = (
  command: ShinsaCommand,
  id?: string
) => Effect.Effect<ShinsaEvent[], ToolCallFailure>;

interface ToolCallCommit {
  readonly treeHash: string | null;
  readonly files: string[];
  readonly undo: Effect.Effect<void, ToolCallFailure>;
}

interface ManagedCall {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly runId: string;
  readonly attemptId: string;
  readonly requestId: RequestId | undefined;
  readonly taskId: string;
}

interface OtherToolHelpers {
  readonly dispatch: EffectCallDispatch;
  readonly worktreePath: Effect.Effect<string, ToolCallFailure>;
}

export interface ToolCallsDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (
    command: ShinsaCommand,
    options: { id: string } | undefined
  ) => Effect.Effect<ShinsaEvent[], ToolCallFailure>;
  readonly questions: QuestionsHandle;
  readonly work: RepositoryWorkHandle;
  readonly services: ServiceRunner | null;
  readonly commit: (
    repo: Repo,
    task: Task,
    message: string
  ) => Effect.Effect<ToolCallCommit, ToolCallFailure>;
  readonly listServerNames: (run: Run) => Effect.Effect<string[], ToolCallFailure>;
  readonly storeEvidence: (
    input: Record<string, unknown>,
    worktreePath: string | null,
    folder: EvidenceFolder
  ) => Effect.Effect<EvidenceCommand, ToolCallFailure>;
  readonly readTask: (taskId: string) => Effect.Effect<string>;
  readonly manage: ((call: ManagedCall) => Effect.Effect<string, ToolCallFailure>) | null;
  readonly handleOther: (
    name: string,
    call: ToolCall,
    helpers: OtherToolHelpers
  ) => Effect.Effect<string | null, ToolCallFailure>;
}

export interface ToolCallsHandle {
  readonly handle: (name: string, call: ToolCall) => Effect.Effect<string, ToolCallFailure>;
}
