import type { ChatEditHunk, ChatEvent, ChatNotice, ChatTodo, ChatTool, ChatToolArgs } from '@shinsa/core';
import { mapClaudeTool, mapToolResult } from '../claude/map.ts';
import type { ImageStore } from '../types.ts';
import { readText } from './client.ts';

export type CodexItem = { type: string; id: string } & Record<string, unknown>;

export interface CodexPlanStep {
  step?: unknown;
  status?: unknown;
}

interface MappedCall {
  callId: string;
  tool: ChatTool;
}

const MAX_TEXT = 12_000;

const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/;

const TODO_STATUS: Record<string, ChatTodo['status']> = {
  completed: 'completed',
  inProgress: 'in_progress',
  in_progress: 'in_progress',
};

function clip(text: string, limit = MAX_TEXT) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function readArgs(value: unknown): ChatToolArgs {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ChatToolArgs) : {};
}

function readRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

export function unwrapShellCommand(command: string) {
  return SHELL_WRAPPER.exec(command.trim())?.[2] ?? command;
}

export function parseDiffHunks(diff: string): ChatEditHunk[] {
  const hunks: ChatEditHunk[] = [];
  let before: string[] = [];
  let after: string[] = [];
  const close = () => {
    if (before.length > 0 || after.length > 0) {
      hunks.push({ before: clip(before.join('\n')), after: clip(after.join('\n')) });
    }
    before = [];
    after = [];
  };
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('@@')) close();
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\'))
      continue;
    if (line.startsWith('+')) after.push(line.slice(1));
    else if (line.startsWith('-')) before.push(line.slice(1));
    else if (line.startsWith(' ')) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    }
  }
  close();
  return hunks;
}

function readChangeKind(change: Record<string, unknown>) {
  const kind = readArgs(change.kind);
  const movedTo = typeof kind.move_path === 'string' ? kind.move_path : null;
  return { type: readText(kind, 'type'), movedTo };
}

function mapChange(change: Record<string, unknown>): ChatTool {
  const path = readText(change, 'path');
  const diff = readText(change, 'diff');
  const kind = readChangeKind(change);
  const hunks = parseDiffHunks(diff);
  if (kind.type === 'add') {
    const content = hunks.length > 0 ? hunks.map((hunk) => hunk.after).join('\n') : diff;
    return { kind: 'write', path, content: clip(content) };
  }
  if (kind.type === 'delete') {
    const before = hunks.length > 0 ? hunks.map((hunk) => hunk.before).join('\n') : diff;
    return { kind: 'edit', path, hunks: [{ before: clip(before), after: '' }] };
  }
  return { kind: 'edit', path: kind.movedTo ?? path, hunks };
}

function resolveChangeId(item: CodexItem, index: number, count: number) {
  return count === 1 ? item.id : `${item.id}:${index}`;
}

function resolveTitle(prompt: string) {
  const line = prompt.trim().split('\n')[0]?.trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function mapAgentCall(item: CodexItem): ChatTool {
  const tool = readText(item, 'tool');
  const prompt = readText(item, 'prompt');
  if (tool === 'spawnAgent') {
    return {
      kind: 'task',
      description: resolveTitle(prompt) || 'Agent',
      prompt: prompt ? clip(prompt) : null,
      agent: readText(item, 'model') || null,
    };
  }
  return { kind: 'other', name: tool, args: { prompt, receiverThreadIds: item.receiverThreadIds } };
}

function readSearchQuery(item: CodexItem) {
  const action = readArgs(item.action);
  const queries = Array.isArray(action.queries)
    ? action.queries.filter((query) => typeof query === 'string')
    : [];
  return readText(item, 'query') || readText(action, 'query') || queries[0] || null;
}

export function mapCodexItemCalls(item: CodexItem): MappedCall[] {
  switch (item.type) {
    case 'commandExecution':
      return [
        {
          callId: item.id,
          tool: {
            kind: 'command',
            action: 'run',
            command: clip(unwrapShellCommand(readText(item, 'command'))),
            description: null,
          },
        },
      ];
    case 'fileChange': {
      const changes = readRecords(item.changes);
      return changes.map((change, index) => ({
        callId: resolveChangeId(item, index, changes.length),
        tool: mapChange(change),
      }));
    }
    case 'mcpToolCall':
      return [
        {
          callId: item.id,
          tool: mapClaudeTool(`mcp__${readText(item, 'server')}__${readText(item, 'tool')}`, item.arguments),
        },
      ];
    case 'webSearch':
      return [
        { callId: item.id, tool: { kind: 'fetch', url: null, query: readSearchQuery(item), prompt: null } },
      ];
    case 'dynamicToolCall':
      return [
        {
          callId: item.id,
          tool: { kind: 'other', name: readText(item, 'tool'), args: readArgs(item.arguments) },
        },
      ];
    case 'collabAgentToolCall':
      return [{ callId: item.id, tool: mapAgentCall(item) }];
    case 'imageView':
      return [{ callId: item.id, tool: { kind: 'read', path: readText(item, 'path'), range: null } }];
    default:
      return [];
  }
}

function isFailed(item: CodexItem) {
  return item.status === 'failed' || item.status === 'declined';
}

function readMcpResult(item: CodexItem, storeImage: ImageStore | undefined) {
  const error = readArgs(item.error);
  if (typeof error.message === 'string') return { text: error.message, images: [] };
  const texts: string[] = [];
  const images: string[] = [];
  for (const part of readRecords(readArgs(item.result).content)) {
    if (part.type === 'text') texts.push(readText(part, 'text'));
    const stored =
      part.type === 'image' && storeImage
        ? storeImage(readText(part, 'data'), readText(part, 'mimeType') || 'image/png')
        : null;
    if (stored) images.push(stored);
  }
  return { text: texts.join('\n'), images };
}

function readDynamicOutput(item: CodexItem) {
  return readRecords(item.contentItems)
    .map((part) => readText(part, 'text') || readText(part, 'imageUrl'))
    .filter(Boolean)
    .join('\n');
}

function readCommandOutput(item: CodexItem) {
  if (item.status === 'declined') return 'Shinsa declined this command.';
  return readText(item, 'aggregatedOutput');
}

export function mapCodexItemResults(item: CodexItem, storeImage?: ImageStore): ChatEvent[] {
  switch (item.type) {
    case 'commandExecution': {
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : 0;
      return [mapToolResult(item.id, readCommandOutput(item), isFailed(item) || exitCode !== 0, [])];
    }
    case 'fileChange': {
      const changes = readRecords(item.changes);
      return changes.map((_, index) =>
        mapToolResult(resolveChangeId(item, index, changes.length), '', isFailed(item), [])
      );
    }
    case 'mcpToolCall': {
      const result = readMcpResult(item, storeImage);
      return [mapToolResult(item.id, result.text, item.status === 'failed', result.images)];
    }
    case 'dynamicToolCall':
      return [mapToolResult(item.id, readDynamicOutput(item), isFailed(item) || item.success === false, [])];
    case 'webSearch':
    case 'imageView':
      return [mapToolResult(item.id, '', false, [])];
    case 'collabAgentToolCall':
      return [mapToolResult(item.id, readText(item, 'status'), isFailed(item), [])];
    default:
      return [];
  }
}

export function mapPlanSteps(steps: CodexPlanStep[]): ChatTodo[] {
  return steps.flatMap((step) => {
    const text = typeof step.step === 'string' ? step.step.trim() : '';
    if (!text) return [];
    const status = typeof step.status === 'string' ? (TODO_STATUS[step.status] ?? 'pending') : 'pending';
    return [{ text, status }];
  });
}

interface AgentThread {
  callId: string;
  parent: string | null;
  model: string | null;
  last: string | null;
  open: boolean;
}

export type CodexCompactionTrigger = 'auto' | 'manual';

const AGENT_STOPPED = 'The agent stopped before it finished.';

const AGENT_CUT_OFF = 'The agent was still working when the step ended.';

function resolveAgentPathLabel(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? 'Agent';
}

function withParent(event: ChatEvent, parent: string | null): ChatEvent {
  if (parent === null || event.type !== 'tool_result') return event;
  return { ...event, parentCallId: parent };
}

export function createCodexRecorder(
  onEntry: (event: ChatEvent) => void,
  storeImage?: ImageStore,
  trigger: CodexCompactionTrigger = 'auto'
) {
  let pending: string | null = null;
  let last: string | null = null;
  let compacted = false;
  let plans = 0;
  const started = new Set<string>();
  const agents = new Map<string, AgentThread>();

  const flush = (phase: 'interim' | 'final') => {
    if (pending === null) return;
    onEntry({ type: 'agent', phase, text: pending });
    pending = null;
  };
  const notify = (notice: ChatNotice) => onEntry({ type: 'notice', notice });
  const parentOf = (threadId: string | null) =>
    threadId === null ? null : (agents.get(threadId)?.callId ?? null);
  const call = (mapped: MappedCall, parent: string | null) => {
    if (started.has(mapped.callId)) return;
    started.add(mapped.callId);
    if (parent === null) {
      flush('interim');
      onEntry({ type: 'tool_call', callId: mapped.callId, tool: mapped.tool });
      return;
    }
    onEntry({ type: 'tool_call', callId: mapped.callId, tool: mapped.tool, parentCallId: parent });
  };
  const compact = () => {
    if (compacted) return;
    compacted = true;
    notify({ kind: 'compaction', trigger, preTokens: null, summary: null });
  };
  const follow = (threadId: string, callId: string, parent: string | null, model: string | null) => {
    if (agents.has(threadId)) return;
    agents.set(threadId, { callId, parent, model, last: null, open: true });
  };
  const finishAgent = (threadId: string, failed: boolean, fallback = AGENT_STOPPED) => {
    const agent = agents.get(threadId);
    if (!agent?.open) return;
    agent.open = false;
    const text = agent.last ?? (failed ? fallback : '');
    onEntry(withParent(mapToolResult(agent.callId, text, failed, []), agent.parent));
  };
  const trackSpawn = (item: CodexItem, parent: string | null) => {
    const receivers = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((id): id is string => typeof id === 'string' && id !== '')
      : [];
    if (readText(item, 'tool') !== 'spawnAgent' || receivers.length === 0 || isFailed(item)) return false;
    for (const threadId of receivers) follow(threadId, item.id, parent, readText(item, 'model') || null);
    return true;
  };
  const trackActivity = (item: CodexItem, parent: string | null) => {
    const threadId = readText(item, 'agentThreadId');
    if (!threadId) return;
    const kind = readText(item, 'kind');
    if (kind === 'completed' || kind === 'interrupted') {
      finishAgent(threadId, kind === 'interrupted');
      return;
    }
    if (agents.has(threadId)) return;
    const callId = `agent:${threadId}`;
    const path = readText(item, 'agentPath');
    call(
      { callId, tool: { kind: 'task', description: resolveAgentPathLabel(path), prompt: null, agent: null } },
      parent
    );
    follow(threadId, callId, parent, null);
  };
  const say = (text: string, parent: string | null, threadId: string | null) => {
    if (!text.trim()) return;
    if (parent === null || threadId === null) {
      flush('interim');
      pending = text;
      last = text;
      return;
    }
    const agent = agents.get(threadId);
    if (agent) agent.last = text;
    onEntry({ type: 'agent', phase: 'interim', text, parentCallId: parent });
  };

  return {
    flush,
    notify,
    started: (item: CodexItem, threadId: string | null = null) => {
      const parent = parentOf(threadId);
      for (const mapped of mapCodexItemCalls(item)) call(mapped, parent);
    },
    completed: (item: CodexItem, threadId: string | null = null) => {
      const parent = parentOf(threadId);
      if (item.type === 'agentMessage') {
        say(readText(item, 'text'), parent, threadId);
        return;
      }
      if (item.type === 'contextCompaction') {
        if (parent === null) compact();
        return;
      }
      if (item.type === 'subAgentActivity') {
        trackActivity(item, parent);
        return;
      }
      for (const mapped of mapCodexItemCalls(item)) call(mapped, parent);
      if (item.type === 'collabAgentToolCall' && trackSpawn(item, parent)) return;
      for (const result of mapCodexItemResults(item, storeImage)) onEntry(withParent(result, parent));
    },
    plan: (turnId: string, steps: CodexPlanStep[]) => {
      const todos = mapPlanSteps(steps);
      if (todos.length === 0) return;
      plans += 1;
      const callId = `${turnId}:plan:${plans}`;
      call({ callId, tool: { kind: 'todo', todos } }, null);
      onEntry(mapToolResult(callId, '', false, []));
    },
    compacted: compact,
    isAgent: (threadId: string) => agents.has(threadId),
    agentModel: (threadId: string) => agents.get(threadId)?.model ?? null,
    endAgentTurn: (threadId: string, failed: boolean) => finishAgent(threadId, failed),
    closeAgents: () => {
      for (const threadId of agents.keys()) finishAgent(threadId, true, AGENT_CUT_OFF);
    },
    endTurn: () => {
      flush('final');
      compacted = false;
    },
    lastText: () => last,
  };
}
