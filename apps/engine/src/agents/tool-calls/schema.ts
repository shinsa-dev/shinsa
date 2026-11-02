import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { type CommandOf, type Run, type ShinsaCommand, type ShinsaEvent } from '@shinsa/core';
import type { Engine } from '../../runtime/engine.ts';
import type { ScheduleToolCall } from '../../schedules/index.ts';
import type { EvidenceStore } from '../../store/index.ts';
import type { Workspaces } from '../../workspaces/index.ts';
import { type ManageAccess } from '../manage/index.ts';
import type { ProviderRegistry } from '../providers/index.ts';
import type { Questions } from '../questions.ts';
import { type TaskServiceRunner } from '../services.ts';
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

export type CallDispatch = (command: ShinsaCommand, id?: string) => Promise<ShinsaEvent[]>;

export type CommitHandOver =
  | Omit<CommandOf<'agent.complete_phase'>, 'treeHash' | 'files'>
  | Omit<CommandOf<'agent.complete_fix'>, 'treeHash' | 'files'>;

export type HandOverTool = 'propose_plan' | 'complete_phase' | 'complete_fix' | 'report_review';
