import type { ChatTool } from '@shinsa/core';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { type DiffRow, resolveDiffRows } from '@/lib/code/edit-diff.ts';

export const CODE_ARGUMENTS: ReadonlySet<string> = new Set(['code', 'function', 'script', 'js']);

const MARKDOWN_KINDS: ReadonlySet<ChatTool['kind']> = new Set(['browser', 'other', 'fetch', 'mcp']);

const MARKDOWN_START = /^(#{1,4} |```)/m;

const IMAGE_PLACEHOLDER = /^(\[image\]\s*)+$/;

const NUMBERED_LINE = /^\s*(\d+)(?:→|\t)(.*)$/;

const MAX_INLINE_ARGUMENT = 160;

const LONG_MARKDOWN_CHARACTERS = 900;

const LONG_MARKDOWN_LINES = 14;

type ToolResultView =
  | { kind: 'pending' }
  | { kind: 'empty'; label: string | null }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string };

export function splitLines(text: string) {
  return text.replace(/\n+$/, '').split('\n');
}

export function formatStructured(text: string) {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

export function resolveToolResult(call: ToolCall): ToolResultView {
  if (call.result === null) return { kind: 'pending' };
  const text = call.result.trim();
  const placeholder = IMAGE_PLACEHOLDER.test(text);
  if (!text || placeholder) {
    if (call.images.length > 0) return { kind: 'empty', label: null };
    return { kind: 'empty', label: placeholder ? 'An image that was not kept.' : 'No output.' };
  }
  if (!call.failed && MARKDOWN_KINDS.has(call.tool.kind) && MARKDOWN_START.test(text))
    return { kind: 'markdown', text };
  return { kind: 'text', text };
}

export function parseNumbered(text: string) {
  const lines = splitLines(text).map((line) => {
    const match = NUMBERED_LINE.exec(line);
    return match ? { number: Number(match[1]), text: match[2] ?? '' } : { number: null, text: line };
  });
  return {
    lines,
    numbered: lines.some((line) => line.number !== null),
    code: lines.map((line) => line.text).join('\n'),
  };
}

export function countRows(rows: DiffRow[]) {
  return {
    added: rows.filter((row) => row.kind === 'add').length,
    removed: rows.filter((row) => row.kind === 'remove').length,
  };
}

export function resolveEditStats(tool: ChatTool) {
  if (tool.kind !== 'edit' || tool.hunks.length === 0) return null;
  return tool.hunks
    .map((hunk) => countRows(resolveDiffRows(hunk.before, hunk.after)))
    .reduce((total, next) => ({ added: total.added + next.added, removed: total.removed + next.removed }));
}

function isInlineArgument(name: string, value: unknown) {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  return (
    typeof value === 'string' &&
    !value.includes('\n') &&
    !CODE_ARGUMENTS.has(name) &&
    value.length <= MAX_INLINE_ARGUMENT
  );
}

export function splitArguments(args: Record<string, unknown>) {
  const entries = Object.entries(args).filter(([, value]) => value !== null && value !== '');
  return {
    inline: entries.filter(([name, value]) => isInlineArgument(name, value)),
    blocks: entries.filter(([name, value]) => !isInlineArgument(name, value)),
  };
}

export function isLongMarkdown(text: string) {
  return text.length > LONG_MARKDOWN_CHARACTERS || text.split('\n').length > LONG_MARKDOWN_LINES;
}
