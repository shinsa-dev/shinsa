import {
  type AccountSwitchReason,
  type ChatAttachment,
  type ChatCompactionTrigger,
  type ChatCompactor,
  type ChatDelegationEvent,
  type ChatEntry,
  type ChatEntryOf,
  type ChatFastModeStatus,
  type ChatNotice,
  type ChatTool,
  isHandOverTool,
  isSubagentEvent,
  type LoadedExtensions,
  type Run,
  type ShinsaToolName,
  splitMessageAttachments,
  type Task,
} from '@shinsa/core';
import { describeTool, isHandover, type ToolDescription } from '@/lib/chat/tool-describe.ts';

type MessageStatus = 'delivering' | 'noted' | 'undelivered';

export interface HumanMessage {
  at: number;
  text: string;
  status?: MessageStatus;
  reason?: string;
}

export interface ToolCall {
  key: string;
  callId: string;
  tool: ChatTool;
  description: ToolDescription;
  result: string | null;
  images: string[];
  failed: boolean;
  recovery: 'retried' | 'retrying' | null;
}

export type TimelineItem =
  | { kind: 'instructions'; key: string; at: number; text: string; first: boolean }
  | ({ kind: 'human'; key: string; at: number; text: string; attachments: ChatAttachment[] } & Pick<
      HumanMessage,
      'status' | 'reason'
    >)
  | { kind: 'agent'; key: string; at: number; text: string; phase: 'interim' | 'final' }
  | { kind: 'tools'; key: string; at: number; calls: ToolCall[] }
  | { kind: 'handover'; key: string; at: number; call: ToolCall }
  | { kind: 'error'; key: string; at: number; text: string; count: number }
  | {
      kind: 'retrying';
      key: string;
      at: number;
      provider: string;
      detail: string;
      attempt: number;
      attempts: number;
      retryAt: number;
    }
  | {
      kind: 'account';
      key: string;
      at: number;
      email: string | null;
      previous: string | null;
      reason: AccountSwitchReason;
    }
  | { kind: 'compaction'; key: string; at: number; trigger: ChatCompactionTrigger; by: ChatCompactor }
  | { kind: 'proxy'; key: string; at: number; detail: string | null }
  | { kind: 'fast_mode'; key: string; at: number; status: ChatFastModeStatus; reason: string | null }
  | ({ kind: 'extensions'; key: string; at: number } & LoadedExtensions)
  | ({ kind: 'handoff'; key: string; at: number } & Omit<HandoffNotice, 'kind'>)
  | { kind: 'delegation'; key: string; at: number; event: ChatDelegationEvent; runIds: string[] };

type HandoffNotice = Extract<ChatNotice, { kind: 'handoff' }>;

export type QuietNoticeKind =
  | 'account'
  | 'retrying'
  | 'compaction'
  | 'handoff'
  | 'proxy'
  | 'fast_mode'
  | 'extensions';

type NoticeKind = QuietNoticeKind | 'delegation';

export type WorkItem = TimelineItemOf<'instructions' | 'agent' | 'tools'>;

export type TimelineItemOf<K extends TimelineItem['kind']> = Extract<TimelineItem, { kind: K }>;

export interface RunTurn {
  key: string;
  human: TimelineItemOf<'human'> | null;
  notices: TimelineItemOf<NoticeKind>[];
  work: WorkItem[];
  outcomes: TimelineItemOf<'handover'>[];
  reply: TimelineItemOf<'agent'> | null;
  errors: TimelineItemOf<'error'>[];
  steps: number;
  startedAt: number;
  endedAt: number;
  live: boolean;
}

function listMessagesOf(task: Task, kinds: readonly string[]): HumanMessage[] {
  return task.activity
    .filter((entry) => entry.actor === 'you' && kinds.includes(entry.kind))
    .flatMap((entry) => {
      if (!entry.detail) return [];
      return [{ at: entry.at, text: entry.detail, ...(entry.noted ? { status: 'noted' as const } : {}) }];
    });
}

function listUndelivered(task: Task): HumanMessage[] {
  return task.activity.flatMap((entry) => {
    if (!entry.undelivered) return [];
    const { text, reason } = entry.undelivered;
    return [{ at: entry.at, text, status: 'undelivered' as const, reason }];
  });
}

const SENT_WINDOW_MS = 5_000;

function listUnsent(sending: HumanMessage[], landed: HumanMessage[]) {
  const unclaimed = [...landed];
  return sending.filter((sent) => {
    const index = unclaimed.findIndex(
      (message) => message.text.trim() === sent.text.trim() && message.at >= sent.at - SENT_WINDOW_MS
    );
    if (index === -1) return true;
    unclaimed.splice(index, 1);
    return false;
  });
}

export function listHumanMessages(task: Task, sending: HumanMessage[] = []): HumanMessage[] {
  const routing = (task.inbox ?? []).map(({ at, text }) => ({ at, text, status: 'delivering' as const }));
  const landed = [...listMessagesOf(task, ['asked', 'message']), ...listUndelivered(task), ...routing];
  const unsent = listUnsent(sending, landed).map(({ at, text }) => ({
    at,
    text,
    status: 'delivering' as const,
  }));
  return [...landed, ...unsent].sort((left, right) => left.at - right.at);
}

function isWaiting(message: HumanMessage) {
  return message.status === 'delivering';
}

export function listFollowUpMessages(task: Task, sending: HumanMessage[] = []): HumanMessage[] {
  const asked = new Set(listMessagesOf(task, ['asked']).map((message) => message.at));
  return listHumanMessages(task, sending).filter((message) => isWaiting(message) || !asked.has(message.at));
}

function isUnanswered(message: HumanMessage) {
  return message.status === 'noted' || message.status === 'undelivered';
}

function selectMessageOwner(runs: Run[], message: HumanMessage) {
  const latest = runs.filter((run) => run.startedAt <= message.at).at(-1);
  if (!latest || latest.endedAt === null || latest.endedAt >= message.at || isUnanswered(message))
    return latest;
  return runs.find((run) => run.startedAt > message.at) ?? latest;
}

export function resolveRunMessages(runs: Run[], messages: HumanMessage[]) {
  const preamble: HumanMessage[] = [];
  const byRun = new Map<string, HumanMessage[]>(runs.map((run) => [run.id, []]));
  for (const message of messages) {
    const owner = selectMessageOwner(runs, message);
    if (owner) byRun.get(owner.id)?.push(message);
    else preamble.push(message);
  }
  return { preamble, byRun };
}

function mergeByTime(entries: ChatEntry[], messages: HumanMessage[]) {
  const stream: ({ type: 'entry'; entry: ChatEntry } | { type: 'human'; message: HumanMessage })[] = [];
  let next = 0;
  for (const entry of entries) {
    while (next < messages.length && (messages[next]?.at ?? 0) <= entry.at) {
      const message = messages[next];
      if (message) stream.push({ type: 'human', message });
      next += 1;
    }
    stream.push({ type: 'entry', entry });
  }
  for (const message of messages.slice(next)) stream.push({ type: 'human', message });
  return stream;
}

function createToolCall(entry: ChatEntryOf<'tool_call'>): ToolCall {
  return {
    key: entry.id,
    callId: entry.callId,
    tool: entry.tool,
    description: describeTool(entry.tool),
    result: null,
    images: [],
    failed: false,
    recovery: null,
  };
}

function resolveEchoKey(text: string) {
  return splitMessageAttachments(text).text;
}

function attachEcho(items: TimelineItem[], entry: ChatEntryOf<'user'>) {
  if (entry.attachments.length === 0) return;
  const key = resolveEchoKey(entry.text);
  const message = items
    .filter(
      (item): item is TimelineItemOf<'human'> => item.kind === 'human' && resolveEchoKey(item.text) === key
    )
    .at(-1);
  if (!message || message.attachments.length > 0) return;
  if (splitMessageAttachments(message.text).attachments.length > 0) return;
  message.attachments = entry.attachments;
}

function resolveNoticeItems(entry: ChatEntryOf<'notice'>): TimelineItem[] {
  const { notice } = entry;
  if (notice.kind === 'account_switched') {
    return [
      {
        kind: 'account',
        key: entry.id,
        at: entry.at,
        email: notice.email,
        previous: notice.previous,
        reason: notice.reason,
      },
    ];
  }
  if (notice.kind === 'retrying') {
    const { provider, detail, attempt, attempts, retryAt } = notice;
    return [{ kind: 'retrying', key: entry.id, at: entry.at, provider, detail, attempt, attempts, retryAt }];
  }
  if (notice.kind === 'compaction') {
    return [
      { kind: 'compaction', key: entry.id, at: entry.at, trigger: notice.trigger, by: notice.by ?? 'claude' },
    ];
  }
  if (notice.kind === 'proxy') return [{ kind: 'proxy', key: entry.id, at: entry.at, detail: notice.detail }];
  if (notice.kind === 'fast_mode') {
    return [{ kind: 'fast_mode', key: entry.id, at: entry.at, status: notice.status, reason: notice.reason }];
  }
  if (notice.kind === 'handoff') {
    return [
      {
        kind: 'handoff',
        key: entry.id,
        at: entry.at,
        reason: notice.reason,
        fromProvider: notice.fromProvider,
        toProvider: notice.toProvider,
        totalEntries: notice.totalEntries,
        includedEntries: notice.includedEntries,
      },
    ];
  }
  if (notice.kind === 'delegation') {
    return [{ kind: 'delegation', key: entry.id, at: entry.at, event: notice.event, runIds: notice.runIds }];
  }
  if (notice.kind === 'extensions') {
    const { servers, skills, plugins } = notice;
    return [{ kind: 'extensions', key: entry.id, at: entry.at, servers, skills, plugins }];
  }
  return [];
}

interface TimelineBuilder {
  items: TimelineItem[];
  calls: ToolCall[];
  echoes: Set<string>;
  seenBrief: boolean;
  group: TimelineItemOf<'tools'> | null;
}

function applyToolCall(builder: TimelineBuilder, entry: ChatEntryOf<'tool_call'>) {
  const call = createToolCall(entry);
  builder.calls.push(call);
  if (isHandover(call.tool)) {
    builder.group = null;
    builder.items.push({ kind: 'handover', key: entry.id, at: entry.at, call });
    return;
  }
  if (builder.group) {
    builder.group.calls.push(call);
    return;
  }
  builder.group = { kind: 'tools', key: entry.id, at: entry.at, calls: [call] };
  builder.items.push(builder.group);
}

function applyToolResult(builder: TimelineBuilder, entry: ChatEntryOf<'tool_result'>) {
  const { calls } = builder;
  const call =
    calls.find((candidate) => candidate.callId === entry.callId && candidate.result === null) ??
    calls.find((candidate) => candidate.callId === entry.callId) ??
    calls.find((candidate) => candidate.result === null);
  if (!call) return;
  Object.assign(call, { result: entry.output, images: entry.images, failed: entry.status === 'error' });
}

function applyUserEntry(builder: TimelineBuilder, entry: ChatEntryOf<'user'>) {
  builder.group = null;
  if (entry.from === 'shinsa') {
    builder.items.push({
      kind: 'instructions',
      key: entry.id,
      at: entry.at,
      text: entry.text,
      first: !builder.seenBrief,
    });
    builder.seenBrief = true;
    return;
  }
  if (builder.echoes.has(resolveEchoKey(entry.text))) {
    attachEcho(builder.items, entry);
    return;
  }
  builder.items.push({
    kind: 'human',
    key: entry.id,
    at: entry.at,
    text: entry.text,
    attachments: entry.attachments,
  });
}

function applyEntry(builder: TimelineBuilder, entry: ChatEntry) {
  switch (entry.type) {
    case 'tool_call':
      applyToolCall(builder, entry);
      return;
    case 'tool_result':
      applyToolResult(builder, entry);
      return;
    case 'status':
      return;
    case 'notice':
      builder.items.push(...resolveNoticeItems(entry));
      return;
    case 'user':
      applyUserEntry(builder, entry);
      return;
    case 'agent':
      builder.group = null;
      builder.items.push({
        kind: 'agent',
        key: entry.id,
        at: entry.at,
        text: entry.text,
        phase: entry.phase,
      });
      return;
    case 'error':
      builder.group = null;
      builder.items.push({ kind: 'error', key: entry.id, at: entry.at, text: entry.text, count: 1 });
      return;
  }
}

export function resolveTimeline(entries: ChatEntry[], messages: HumanMessage[]): TimelineItem[] {
  const builder: TimelineBuilder = {
    items: [],
    calls: [],
    echoes: new Set(messages.map((message) => resolveEchoKey(message.text))),
    seenBrief: false,
    group: null,
  };
  for (const [index, part] of mergeByTime(entries, messages).entries()) {
    if (part.type === 'human') {
      builder.group = null;
      const { at, text, status, reason } = part.message;
      builder.items.push({
        kind: 'human',
        key: `human-${at}-${index}`,
        at,
        text,
        attachments: [],
        ...(status ? { status } : {}),
        ...(reason ? { reason } : {}),
      });
    } else if (!isSubagentEvent(part.entry)) {
      applyEntry(builder, part.entry);
    }
  }
  return builder.items;
}

function countSteps(items: TimelineItem[]) {
  return items.reduce(
    (total, item) => total + (item.kind === 'tools' ? item.calls.length : item.kind === 'handover' ? 1 : 0),
    0
  );
}

function isWork(item: TimelineItem): item is WorkItem {
  return item.kind === 'instructions' || item.kind === 'agent' || item.kind === 'tools';
}

function isNotice(item: TimelineItem): item is TimelineItemOf<NoticeKind> {
  return (
    item.kind === 'account' ||
    item.kind === 'retrying' ||
    item.kind === 'compaction' ||
    item.kind === 'proxy' ||
    item.kind === 'fast_mode' ||
    item.kind === 'extensions' ||
    item.kind === 'handoff' ||
    item.kind === 'delegation'
  );
}

interface TurnGroup {
  human: RunTurn['human'];
  body: TimelineItem[];
}

interface TurnClose {
  key: string;
  live: boolean;
  failed: boolean;
  startedAt: number;
  endedAt: number;
}

function isTurnHandOver(item: TimelineItem): item is TimelineItemOf<'handover'> {
  return item.kind === 'handover' && item.call.tool.kind === 'shinsa' && isHandOverTool(item.call.tool.name);
}

function isFullReplyHandOver(item: TimelineItemOf<'handover'>) {
  const name = selectToolName(item.call);
  return (
    name === 'answer' || name === 'report_diagnosis' || name === 'submit_report' || name === 'report_outcome'
  );
}

function selectReply(body: TimelineItem[], quiet: boolean) {
  const last = body.filter(isTurnHandOver).at(-1);
  if (last && isFullReplyHandOver(last)) return null;
  const agents = body
    .slice(last ? body.indexOf(last) + 1 : 0)
    .filter((item): item is TimelineItemOf<'agent'> => item.kind === 'agent');
  return agents.filter((item) => item.phase === 'final').at(-1) ?? (quiet ? null : (agents.at(-1) ?? null));
}

function isRejectedHandover(item: TimelineItem): item is TimelineItemOf<'handover'> {
  return item.kind === 'handover' && item.call.failed && !isQuestion(item.call);
}

function isQuestion(call: ToolCall) {
  return call.tool.kind === 'shinsa' && call.tool.name === 'ask';
}

function selectToolName(call: ToolCall) {
  return call.tool.kind === 'shinsa' ? call.tool.name : null;
}

function resolveRecovery(items: TimelineItem[], index: number, running: boolean): ToolCall['recovery'] {
  const item = items[index];
  if (!item || !isRejectedHandover(item)) return null;
  const name = selectToolName(item.call);
  const retried = items
    .slice(index + 1)
    .some((later) => later.kind === 'handover' && selectToolName(later.call) === name);
  if (retried) return 'retried';
  return running && items.slice(index + 1).every((later) => later.kind !== 'handover') ? 'retrying' : null;
}

function foldRejectedHandovers(items: TimelineItem[], running: boolean): TimelineItem[] {
  return items.map((item, index) => {
    const recovery = resolveRecovery(items, index, running);
    if (recovery === null || item.kind !== 'handover') return item;
    return { kind: 'tools', key: item.key, at: item.at, calls: [{ ...item.call, recovery }] };
  });
}

function collapseErrors(errors: TimelineItemOf<'error'>[]) {
  const collapsed: TimelineItemOf<'error'>[] = [];
  for (const error of errors) {
    const same = collapsed.find((kept) => kept.text.trim() === error.text.trim());
    if (same) same.count += error.count;
    else collapsed.push({ ...error });
  }
  return collapsed;
}

function closeTurn(
  { human, body }: TurnGroup,
  { key, live, failed, startedAt, endedAt }: TurnClose,
  now: number
): RunTurn {
  const errors = collapseErrors(
    body.filter((item): item is TimelineItemOf<'error'> => item.kind === 'error')
  );
  const reply = selectReply(body, live || failed || errors.length > 0);
  return {
    key,
    human,
    notices: body.filter(isNotice),
    work: body.filter((item): item is WorkItem => item !== reply && isWork(item)),
    outcomes: body.filter((item): item is TimelineItemOf<'handover'> => item.kind === 'handover'),
    reply,
    errors,
    steps: countSteps(body),
    startedAt: human?.at ?? body[0]?.at ?? startedAt,
    endedAt: live ? now : Math.max(endedAt, body.at(-1)?.at ?? endedAt),
    live,
  };
}

export function resolveTurns(items: TimelineItem[], run: Run, now = Date.now()): RunTurn[] {
  const groups: TurnGroup[] = [{ human: null, body: [] }];
  const running = run.endedAt === null;
  for (const item of foldRejectedHandovers(items, running)) {
    if (item.kind === 'human') groups.push({ human: item, body: [] });
    else groups.at(-1)?.body.push(item);
  }
  return groups
    .filter((group, index) => group.human !== null || group.body.length > 0 || (index === 0 && running))
    .map((group, index, all) => {
      const last = index === all.length - 1;
      const next = all[index + 1];
      return closeTurn(
        group,
        {
          key: group.human?.key ?? `turn-${index}`,
          live: last && running,
          failed: last && run.outcome !== null && run.outcome !== 'completed',
          startedAt: run.startedAt,
          endedAt: last ? (run.endedAt ?? now) : (next?.human?.at ?? run.startedAt),
        },
        now
      );
    });
}

export function resolveLastHandover(entries: ChatEntry[], name: ShinsaToolName) {
  const entry = entries
    .filter((candidate): candidate is ChatEntryOf<'tool_call'> => candidate.type === 'tool_call')
    .filter((candidate) => candidate.tool.kind === 'shinsa' && candidate.tool.name === name)
    .at(-1);
  return entry?.tool.kind === 'shinsa' ? entry.tool.args : null;
}

export function resolveLastAgentText(entries: ChatEntry[]) {
  const texts = entries.filter(
    (entry): entry is ChatEntryOf<'agent'> | ChatEntryOf<'error'> =>
      entry.type === 'agent' || entry.type === 'error'
  );
  const settled = texts.filter((entry) => entry.type === 'error' || entry.phase === 'final').at(-1);
  return (settled ?? texts.at(-1))?.text ?? null;
}
