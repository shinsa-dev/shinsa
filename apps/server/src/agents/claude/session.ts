import {
  type McpSdkServerConfigWithInstance,
  query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent, RunOutcome, RunRole } from '@shinsa/core';
import { describeError } from '../../log/index.ts';
import type { ToolHandler } from '../tools/index.ts';
import { AsyncQueue } from './async-queue.ts';
import { guardCommand } from './guard.ts';
import type { ImageStore } from './map.ts';
import { createClaudeRecorder } from './recorder.ts';
import { type QueryFn, resolveClaudeProcess } from './sdk.ts';

export interface ClaudeSessionInput {
  role: RunRole;
  cwd: string;
  prompt: string;
  model: string | null;
  resume: string | null;
  defaultBranch: string;
  tools: McpSdkServerConfigWithInstance;
  handleTool: ToolHandler;
  pluginDir: string;
  onSession: (sessionId: string) => void;
  onEntry: (event: ChatEvent) => void;
  storeImage?: ImageStore;
}

export interface ClaudeSessionResult {
  outcome: RunOutcome;
  summary: string | null;
}

export interface ClaudeSession {
  done: Promise<ClaudeSessionResult>;
  steer: (text: string) => boolean;
  cancel: () => Promise<void>;
}

const FOLDED_TURN_MS = 60_000;

const READ_ONLY_ROLES = new Set<RunRole>(['planner', 'reviewer']);

const SUMMARY_LIMIT = 2000;

const SYSTEM_APPEND = [
  '# Shinsa',
  'You are an agent inside Shinsa, a harness where agents do the work and the human only approves at gates.',
  'You run unattended in a git worktree made for this task. Nobody watches your turn; finish the job or ask with the `ask` tool.',
  'Hand work over only through the Shinsa tools (`propose_plan`, `complete_phase`, `complete_fix`, `report_review`). Text in your final message is not read as a hand-over.',
  'Shinsa owns commits, pushes, pull requests and merges. Do not commit, push, open or merge pull requests yourself.',
].join('\n');

function createUserMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' };
}

export function startClaudeSession(
  input: ClaudeSessionInput,
  runQuery: QueryFn = query,
  foldedTurnMs = FOLDED_TURN_MS
): ClaudeSession {
  const prompts = new AsyncQueue<SDKUserMessage>();
  let expected = 1;
  let received = 0;
  let cancelled = false;
  let closed = false;
  let folded: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    closed = true;
    if (folded) clearTimeout(folded);
    prompts.close();
  };
  prompts.push(createUserMessage(input.prompt));
  input.onEntry({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
  const recorder = createClaudeRecorder(input.onEntry, input.storeImage);

  const session = runQuery({
    prompt: prompts,
    options: {
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(input.resume ? { resume: input.resume } : {}),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers: { shinsa: input.tools },
      disallowedTools: READ_ONLY_ROLES.has(input.role) ? ['Edit', 'Write', 'NotebookEdit'] : [],
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
      plugins: [{ type: 'local', path: input.pluginDir }],
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [guardCommand(input.defaultBranch)] }] },
      ...resolveClaudeProcess(),
    },
  });

  const done = (async (): Promise<ClaudeSessionResult> => {
    let summary: string | null = null;
    let failed = false;
    try {
      for await (const message of session) {
        if (message.type === 'system' && message.subtype === 'init') input.onSession(message.session_id);
        recorder.record(message);
        if (folded) {
          clearTimeout(folded);
          folded = null;
        }
        if (message.type !== 'result') continue;
        received += 1;
        if (message.subtype === 'success') {
          summary = message.result.slice(0, SUMMARY_LIMIT);
          failed = message.is_error;
        } else {
          summary = message.errors.join('\n') || message.subtype;
          failed = true;
        }
        if (received >= expected) close();
        else folded = setTimeout(close, foldedTurnMs);
      }
    } catch (error) {
      recorder.flush('interim');
      if (cancelled) return { outcome: 'cancelled', summary: null };
      const text = describeError(error);
      input.onEntry({ type: 'error', text });
      return { outcome: 'failed', summary: text };
    }
    recorder.flush('interim');
    if (cancelled) return { outcome: 'cancelled', summary };
    return { outcome: failed ? 'failed' : 'completed', summary };
  })();

  return {
    done,
    steer: (text) => {
      if (closed || cancelled) return false;
      expected += 1;
      input.onEntry({ type: 'user', from: 'you', text, attachments: [] });
      prompts.push(createUserMessage(text));
      return true;
    },
    cancel: async () => {
      cancelled = true;
      close();
      try {
        await session.interrupt();
      } catch {
        session.close();
      }
    },
  };
}
