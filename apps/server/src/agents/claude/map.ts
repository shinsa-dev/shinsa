import {
  type ChatAttachment,
  type ChatBrowserAction,
  type ChatEditHunk,
  type ChatEvent,
  type ChatTodo,
  type ChatTodoStatus,
  type ChatTool,
  type ChatToolArgs,
  isShinsaToolName,
} from '@shinsa/core';

export type ImageStore = (data: string, mediaType: string) => string | null;

const MAX_TEXT = 12_000;

const MAX_OUTPUT = 4_000;

const NOISE_TAGS = [
  'system-reminder',
  'system-message',
  'recalled-context',
  'tool-evidence',
  'context-compacted',
  'command-name',
  'command-message',
  'command-args',
  'command-stdout',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'task-notification',
  'user-prompt-submit-hook',
];

const NOISE_BLOCK = new RegExp(`<(${NOISE_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'g');

const NOISE_SINGLE = new RegExp(`<(?:${NOISE_TAGS.join('|')})\\b[^>]*\\/>`, 'g');

const INTERNAL_PROMPT =
  /^(<(command-|local-command|system-reminder|task-notification)|\[Request interrupted)/;

const ATTACHMENT_BLOCK = /<(kanna-attachments|attachments)\b[^>]*>([\s\S]*?)<\/\1>/g;

const ATTACHMENT_TAG = /<attachment\b([^>]*?)\/?>/g;

const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;

const TOOL_ERROR = /<\/?tool_use_error>/g;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
};

const BROWSER_ACTIONS: Record<string, { action: ChatBrowserAction; keys: string[]; code?: string }> = {
  browser_navigate: { action: 'navigate', keys: ['url'] },
  browser_navigate_back: { action: 'back', keys: [] },
  browser_click: { action: 'click', keys: ['element', 'target'] },
  browser_hover: { action: 'hover', keys: ['element', 'target'] },
  browser_drag: { action: 'drag', keys: ['startElement'] },
  browser_drop: { action: 'drag', keys: ['element'] },
  browser_select_option: { action: 'select', keys: ['element'] },
  browser_type: { action: 'type', keys: ['element', 'target'] },
  browser_fill_form: { action: 'fill', keys: [] },
  browser_press_key: { action: 'press', keys: ['key'] },
  browser_take_screenshot: { action: 'screenshot', keys: ['element'] },
  browser_snapshot: { action: 'snapshot', keys: [] },
  browser_find: { action: 'find', keys: ['text', 'regex'] },
  browser_resize: { action: 'resize', keys: [] },
  browser_evaluate: { action: 'evaluate', keys: [], code: 'function' },
  browser_run_code_unsafe: { action: 'evaluate', keys: [], code: 'code' },
  browser_wait_for: { action: 'wait', keys: ['text', 'textGone'] },
  browser_console_messages: { action: 'console', keys: [] },
  browser_network_requests: { action: 'network', keys: ['filter'] },
  browser_network_request: { action: 'network', keys: [] },
  browser_tabs: { action: 'tabs', keys: ['action'] },
  browser_close: { action: 'close', keys: [] },
};

const PRIMARY_ARG: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  LS: 'path',
  WebFetch: 'url',
  WebSearch: 'query',
  Task: 'description',
  Agent: 'description',
};

const TODO_STATUSES = new Set<ChatTodoStatus>(['pending', 'in_progress', 'completed']);

function clip(text: string, limit = MAX_TEXT) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function readArgs(input: unknown): ChatToolArgs {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as ChatToolArgs) : {};
}

function readString(args: ChatToolArgs, key: string) {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(args: ChatToolArgs, key: string) {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readFirst(args: ChatToolArgs, keys: string[]) {
  for (const key of keys) {
    const value = readString(args, key);
    if (value) return value;
  }
  return null;
}

function readRecords(args: ChatToolArgs, key: string) {
  const value = args[key];
  return Array.isArray(value)
    ? value.filter((item): item is ChatToolArgs => Boolean(item) && typeof item === 'object')
    : [];
}

function readHunk(edit: ChatToolArgs): ChatEditHunk[] {
  const before = typeof edit.old_string === 'string' ? edit.old_string : null;
  const after = typeof edit.new_string === 'string' ? edit.new_string : null;
  if (before === null && after === null) return [];
  return [{ before: clip(before ?? ''), after: clip(after ?? '') }];
}

function readRange(args: ChatToolArgs) {
  const offset = readNumber(args, 'offset');
  const limit = readNumber(args, 'limit');
  if (offset === null && limit === null) return null;
  const start = Math.max(1, offset ?? 1);
  return { start, end: limit === null ? null : start + limit - 1 };
}

function readTodos(args: ChatToolArgs): ChatTodo[] {
  return readRecords(args, 'todos').map((todo) => {
    const status = readString(todo, 'status') as ChatTodoStatus | null;
    return {
      text: readString(todo, 'content') ?? readString(todo, 'activeForm') ?? '',
      status: status && TODO_STATUSES.has(status) ? status : 'pending',
    };
  });
}

function resolveServerLabel(server: string) {
  return server.split('_').filter(Boolean).at(-1) ?? server;
}

function mapBrowserTool(name: string, args: ChatToolArgs): ChatTool {
  const known = BROWSER_ACTIONS[name];
  const width = readNumber(args, 'width');
  const height = readNumber(args, 'height');
  const target =
    name === 'browser_resize' && width !== null && height !== null
      ? `${width} × ${height}`
      : readFirst(args, known?.keys ?? []);
  return {
    kind: 'browser',
    action: known?.action ?? 'other',
    name: name.replace(/^browser_/, ''),
    target: target ? clip(target, 400) : null,
    code: known?.code ? readString(args, known.code) : null,
    args,
  };
}

function mapMcpTool(name: string, args: ChatToolArgs): ChatTool {
  const [, server = '', ...rest] = name.split('__');
  const tool = rest.join('__') || server;
  if (resolveServerLabel(server) === 'shinsa' && isShinsaToolName(tool))
    return { kind: 'shinsa', name: tool, args };
  if (tool.startsWith('browser_')) return mapBrowserTool(tool, args);
  return { kind: 'mcp', server: resolveServerLabel(server), name: tool, args };
}

export function mapClaudeTool(name: string, input: unknown): ChatTool {
  const args = readArgs(input);
  const path =
    readString(args, 'file_path') ?? readString(args, 'notebook_path') ?? readString(args, 'path') ?? '';
  switch (name) {
    case 'Read':
      return { kind: 'read', path, range: readRange(args) };
    case 'Write':
      return { kind: 'write', path, content: clip(readString(args, 'content') ?? '') };
    case 'Edit':
      return { kind: 'edit', path, hunks: readHunk(args) };
    case 'MultiEdit':
      return { kind: 'edit', path, hunks: readRecords(args, 'edits').flatMap(readHunk) };
    case 'NotebookEdit':
      return {
        kind: 'edit',
        path,
        hunks: [{ before: '', after: clip(readString(args, 'new_source') ?? '') }],
      };
    case 'Bash':
      return {
        kind: 'command',
        action: 'run',
        command: clip(readString(args, 'command') ?? ''),
        description: readString(args, 'description'),
      };
    case 'BashOutput':
      return {
        kind: 'command',
        action: 'output',
        command: readString(args, 'bash_id') ?? '',
        description: null,
      };
    case 'KillShell':
    case 'KillBash':
      return {
        kind: 'command',
        action: 'stop',
        command: readString(args, 'shell_id') ?? '',
        description: null,
      };
    case 'Grep':
      return {
        kind: 'search',
        mode: 'content',
        query: readString(args, 'pattern') ?? '',
        path: readString(args, 'path'),
      };
    case 'Glob':
      return {
        kind: 'search',
        mode: 'files',
        query: readString(args, 'pattern') ?? '',
        path: readString(args, 'path'),
      };
    case 'LS':
      return { kind: 'search', mode: 'list', query: '', path: readString(args, 'path') };
    case 'WebFetch':
      return { kind: 'fetch', url: readString(args, 'url'), query: null, prompt: readString(args, 'prompt') };
    case 'WebSearch':
      return { kind: 'fetch', url: null, query: readString(args, 'query'), prompt: null };
    case 'Task':
    case 'Agent': {
      const prompt = readString(args, 'prompt');
      return {
        kind: 'task',
        description: readString(args, 'description') ?? '',
        prompt: prompt ? clip(prompt) : null,
        agent: readString(args, 'subagent_type'),
      };
    }
    case 'TodoWrite':
      return { kind: 'todo', todos: readTodos(args) };
    default:
      if (name.startsWith('mcp__')) return mapMcpTool(name, args);
      return { kind: 'other', name, args };
  }
}

export function mapLegacyClaudeTool(name: string, input: string | null, summary: string): ChatTool {
  try {
    return mapClaudeTool(name, JSON.parse(input ?? ''));
  } catch {
    const key = PRIMARY_ARG[name];
    return mapClaudeTool(name, key ? { [key]: summary } : {});
  }
}

interface ResultPart {
  type?: string;
  text?: string;
  source?: { type?: string; data?: string; media_type?: string };
}

function readResultContent(content: unknown, storeImage: ImageStore | undefined) {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: '', images: [] };
  const texts: string[] = [];
  const images: string[] = [];
  for (const part of content as ResultPart[]) {
    if (part.type === 'text') {
      texts.push(part.text ?? '');
      continue;
    }
    const source = part.source;
    const stored =
      part.type === 'image' && source?.type === 'base64' && source.data && storeImage
        ? storeImage(source.data, source.media_type ?? 'image/png')
        : null;
    if (stored) images.push(stored);
    else texts.push(`[${part.type}]`);
  }
  return { text: texts.join('\n'), images };
}

function stripNoise(text: string) {
  return text.replace(NOISE_BLOCK, '').replace(NOISE_SINGLE, '');
}

export function mapToolResult(callId: string, text: string, flagged: boolean, images: string[]): ChatEvent {
  const tagged = TOOL_ERROR.test(text);
  TOOL_ERROR.lastIndex = 0;
  const output = stripNoise(text).replace(TOOL_ERROR, '');
  return {
    type: 'tool_result',
    callId,
    status: tagged || flagged ? 'error' : 'ok',
    output: clip(tagged ? output.trim() : output.trimEnd(), MAX_OUTPUT),
    images,
  };
}

export function mapClaudeResult(
  block: { content?: unknown; tool_use_id?: string; is_error?: boolean },
  storeImage?: ImageStore
): ChatEvent {
  const result = readResultContent(block.content, storeImage);
  return mapToolResult(block.tool_use_id ?? '', result.text, block.is_error === true, result.images);
}

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|quot|lt|gt|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function readAttachment(source: string): ChatAttachment | null {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    if (match[1] && match[2] !== undefined) attributes.set(match[1], decodeEntities(match[2]));
  }
  const url = attributes.get('path') ?? attributes.get('url') ?? attributes.get('project_path');
  if (!url) return null;
  const mimeType = attributes.get('mime_type') ?? attributes.get('mime') ?? null;
  const size = Number(attributes.get('size_bytes') ?? attributes.get('size'));
  return {
    kind: attributes.get('kind') === 'image' || mimeType?.startsWith('image/') ? 'image' : 'file',
    name: attributes.get('display_name') ?? attributes.get('name') ?? url.split('/').at(-1) ?? url,
    url,
    mimeType,
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}

export function mapClaudePrompt(text: string, from: 'you' | 'shinsa'): ChatEvent | null {
  if (INTERNAL_PROMPT.test(text.trim())) return null;
  const attachments: ChatAttachment[] = [];
  const withoutAttachments = text.replace(ATTACHMENT_BLOCK, (_block, _tag, inner: string) => {
    for (const match of inner.matchAll(ATTACHMENT_TAG)) {
      const attachment = readAttachment(match[1] ?? '');
      if (attachment) attachments.push(attachment);
    }
    return '';
  });
  const body = stripNoise(withoutAttachments)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body && attachments.length === 0) return null;
  return { type: 'user', from, text: body, attachments };
}
