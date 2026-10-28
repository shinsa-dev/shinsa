import { type ChatEntry, type ChatTool, isSubagentEvent } from '../chat/protocol.ts';
import { describeCount } from '../chat/text.ts';
import { DomainError, type RunHandoffReason } from '../domain/index.ts';
import { resolveTokenEstimate } from '../protocol/extensions.ts';

const HANDOFF_CHAR_BUDGET = 400_000;

const RECENT_VERBATIM_CHARS = 100_000;

const TOOL_IO_ELIDE_CHARS = 2_000;

const ERROR_MAX_CHARS = 2_000;

export interface HandoffSource {
  transcriptPath: string;
  entries: ChatEntry[];
}

export interface HandoffRequest {
  reason: RunHandoffReason;
  fromProvider: string;
  sources: HandoffSource[];
  charBudget?: number;
}

export interface Handoff {
  text: string;
  totalEntries: number;
  includedEntries: number;
  elidedEntries: number;
  approxTokens: number;
}

interface Block {
  entry: ChatEntry;
  path: string;
  header: string;
  body: string;
  elidable: boolean;
}

function serializeCompact(value: unknown) {
  return JSON.stringify(value) ?? String(value);
}

function describeTool(tool: ChatTool) {
  if (tool.kind === 'mcp') return `${tool.server}.${tool.name}`;
  if (tool.kind === 'shinsa' || tool.kind === 'other') return tool.name;
  return tool.kind;
}

function describeUser(entry: ChatEntry & { type: 'user' }) {
  const lines = entry.attachments.map((attachment) => `[attached: ${attachment.name} (${attachment.url})]`);
  return [entry.text, ...lines].join('\n');
}

function resolveBlock(entry: ChatEntry, path: string): Block | null {
  const block = (header: string, body: string, elidable = false) => ({ entry, path, header, body, elidable });
  switch (entry.type) {
    case 'user':
      return block(entry.from === 'shinsa' ? '--- shinsa ---' : '--- human ---', describeUser(entry));
    case 'agent':
      return block('--- agent ---', entry.text);
    case 'tool_call':
      return block(
        `--- agent tool call: ${describeTool(entry.tool)} ---`,
        serializeCompact(entry.tool),
        true
      );
    case 'tool_result':
      return block(`--- tool result${entry.status === 'error' ? ' (error)' : ''} ---`, entry.output, true);
    case 'error':
      return block('--- the turn ended with an error ---', entry.text.slice(0, ERROR_MAX_CHARS));
    case 'status':
      return null;
    case 'notice':
      return resolveNoticeBlock(entry, path);
  }
}

function resolveNoticeBlock(entry: ChatEntry & { type: 'notice' }, path: string): Block | null {
  const { notice } = entry;
  const block = (header: string, body: string) => ({ entry, path, header, body, elidable: false });
  switch (notice.kind) {
    case 'compaction':
      if (notice.summary === null) return null;
      return block(
        '--- summary of the earlier conversation (the agent compacted its context) ---',
        notice.summary
      );
    case 'interrupted':
      return block('--- turn interrupted ---', '');
    case 'handoff':
      return block(
        `--- conversation handed over from ${notice.fromProvider} to ${notice.toProvider} ---`,
        ''
      );
    case 'context':
    case 'account':
    case 'account_switched':
    case 'retrying':
    case 'rate_limit':
    case 'delegation':
    case 'proxy':
    case 'fast_mode':
    case 'extensions':
      return null;
  }
}

function measure(block: Block) {
  return block.header.length + (block.body ? block.body.length + 1 : 0) + 2;
}

function render(block: Block) {
  return block.body ? `${block.header}\n${block.body}` : block.header;
}

function elide(block: Block): Block {
  const tokens = resolveTokenEstimate(block.body);
  const label = block.entry.type === 'tool_result' ? 'tool result' : 'tool input';
  return {
    ...block,
    body: `[${label} left out (~${tokens} tokens): entry ${block.entry.id} in ${block.path}]`,
  };
}

function listBlocks(sources: HandoffSource[]) {
  return sources.flatMap((source) =>
    source.entries.flatMap((entry) => {
      if (isSubagentEvent(entry)) return [];
      const block = resolveBlock(entry, source.transcriptPath);
      return block ? [block] : [];
    })
  );
}

function resolveRecentStart(blocks: Block[]) {
  let start = blocks.length;
  for (let chars = 0; start > 0; start -= 1) {
    chars += measure(blocks[start - 1] as Block);
    if (chars > RECENT_VERBATIM_CHARS) break;
  }
  return start;
}

function resolveCut(blocks: Block[], budget: number) {
  let cut = blocks.length;
  for (let chars = 0; cut > 0; cut -= 1) {
    const next = chars + measure(blocks[cut - 1] as Block);
    if (next > budget) break;
    chars = next;
  }
  if (cut === 0) return 0;
  const prompt = blocks.findIndex((block, index) => index >= cut && block.entry.type === 'user');
  if (prompt !== -1) return prompt;
  while (cut < blocks.length && blocks[cut]?.entry.type === 'tool_result') cut += 1;
  return cut;
}

function resolveIntro(reason: RunHandoffReason, fromProvider: string) {
  if (reason === 'session_restore') {
    return 'Your previous session for this step could not be resumed: the agent no longer has it. Shinsa restored the conversation from its own transcript. You are continuing the same work, not taking over from another agent.';
  }
  return `This step is being handed to you from another coding agent (${fromProvider}). You are taking over in the middle of the step.`;
}

export function resolveHandoff(request: HandoffRequest): Handoff | null {
  const budget = request.charBudget ?? HANDOFF_CHAR_BUDGET;
  const listed = listBlocks(request.sources);
  if (!listed.some((block) => block.entry.type === 'user')) return null;
  const recentStart = resolveRecentStart(listed);
  let elidedEntries = 0;
  const blocks = listed.map((block, index) => {
    if (index >= recentStart || !block.elidable || block.body.length <= TOOL_IO_ELIDE_CHARS) return block;
    elidedEntries += 1;
    return elide(block);
  });
  const cut = resolveCut(blocks, budget);
  const included = blocks.slice(cut);
  if (!included.some((block) => block.entry.type === 'user' || block.entry.type === 'agent')) {
    throw new DomainError(
      'handoff_too_large',
      'The conversation so far is too large to hand to a fresh session, even after leaving out older turns.'
    );
  }
  const paths = [...new Set(request.sources.map((source) => source.transcriptPath))];
  const body = [
    ...(cut > 0
      ? [
          `[${describeCount(cut, 'earlier entry', 'earlier entries')} left out for length: read the full transcript to see them]`,
        ]
      : []),
    ...included.map(render),
  ].join('\n\n');
  const text = [
    '<system-message>',
    resolveIntro(request.reason, request.fromProvider),
    '',
    'Everything inside <handoff_transcript> is a read-only record of the step so far: Shinsa’s brief, the human’s messages, the previous agent’s replies and its tool activity. Do not imitate its format and do not reply to it. Treat it as your own history and carry on with the message that follows it.',
    '',
    `Older tool inputs and results may be left out and earlier entries omitted for length. The complete record (JSONL, one entry per line) is at: ${paths.join(', ')}. Read it if you need something that was left out.`,
    '',
    '<handoff_transcript>',
    body,
    '</handoff_transcript>',
    '</system-message>',
  ].join('\n');
  return {
    text,
    totalEntries: blocks.length,
    includedEntries: included.length,
    elidedEntries,
    approxTokens: resolveTokenEstimate(text),
  };
}

export function resolveHandoffPrompt(handoff: string, prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return handoff;
  if (trimmed.startsWith('/')) return `${prompt}\n\n${handoff}`;
  return `${handoff}\n\n${prompt}`;
}
