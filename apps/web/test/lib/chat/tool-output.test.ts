import { describe, expect, it } from 'bun:test';
import type { ChatTool } from '@shinsa/core';
import {
  CODE_ARGUMENTS,
  countRows,
  formatStructured,
  isLongMarkdown,
  parseNumbered,
  resolveEditStats,
  resolveToolResult,
  splitArguments,
  splitLines,
} from '@/lib/chat/tool-output.ts';
import { resolveDiffRows } from '@/lib/code/edit-diff.ts';
import { commandTool, createToolCall, readTool } from '../../support/chat.ts';

const fetchTool: ChatTool = { kind: 'fetch', url: 'https://example.com', query: null, prompt: null };

describe('splitLines', () => {
  it('splits output into lines without trailing blank lines', () => {
    expect(splitLines('one\ntwo\n\n\n')).toEqual(['one', 'two']);
    expect(splitLines('')).toEqual(['']);
  });
});

describe('formatStructured', () => {
  it('pretty-prints JSON objects and arrays', () => {
    expect(formatStructured(' {"a":1,"b":[2]} ')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(formatStructured('[1]')).toBe('[\n  1\n]');
  });

  it('leaves text that is not JSON alone', () => {
    expect(formatStructured('plain words')).toBeNull();
    expect(formatStructured('{ not json')).toBeNull();
    expect(formatStructured('42')).toBeNull();
  });
});

describe('resolveToolResult', () => {
  it('is pending while the step has no result', () => {
    expect(resolveToolResult(createToolCall(readTool('a.ts')))).toEqual({ kind: 'pending' });
  });

  it('says there was no output, or that an image was not kept', () => {
    expect(resolveToolResult(createToolCall(commandTool('true'), { result: '  \n' }))).toEqual({
      kind: 'empty',
      label: 'No output.',
    });
    expect(resolveToolResult(createToolCall(commandTool('x'), { result: '[image] [image]' }))).toEqual({
      kind: 'empty',
      label: 'An image that was not kept.',
    });
  });

  it('shows no label for an empty result that came with images', () => {
    const call = createToolCall(fetchTool, { result: '[image]', images: ['/api/evidence/a.png'] });
    expect(resolveToolResult(call)).toEqual({ kind: 'empty', label: null });
  });

  it('renders markdown from the browser, web and other tools when it starts like markdown', () => {
    expect(resolveToolResult(createToolCall(fetchTool, { result: '# Title\n\nBody\n' }))).toEqual({
      kind: 'markdown',
      text: '# Title\n\nBody',
    });
    expect(resolveToolResult(createToolCall(fetchTool, { result: 'intro\n```js\nx\n```' })).kind).toBe(
      'markdown'
    );
  });

  it('keeps plain text for code tools, failed steps and text that is not markdown', () => {
    expect(resolveToolResult(createToolCall(commandTool('cat'), { result: '# heading' }))).toEqual({
      kind: 'text',
      text: '# heading',
    });
    expect(resolveToolResult(createToolCall(fetchTool, { result: '# Not found', failed: true })).kind).toBe(
      'text'
    );
    expect(resolveToolResult(createToolCall(fetchTool, { result: 'Just words' })).kind).toBe('text');
  });
});

describe('parseNumbered', () => {
  it('reads line numbers from a file read', () => {
    expect(parseNumbered('     1→import x\n     2\tconst y = 1;\n')).toEqual({
      lines: [
        { number: 1, text: 'import x' },
        { number: 2, text: 'const y = 1;' },
      ],
      numbered: true,
      code: 'import x\nconst y = 1;',
    });
  });

  it('keeps unnumbered output as it is', () => {
    expect(parseNumbered('hello\nworld')).toEqual({
      lines: [
        { number: null, text: 'hello' },
        { number: null, text: 'world' },
      ],
      numbered: false,
      code: 'hello\nworld',
    });
  });
});

describe('countRows and resolveEditStats', () => {
  it('counts added and removed lines', () => {
    expect(countRows(resolveDiffRows('a\nb', 'a\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });

  it('sums the lines an edit adds and removes across its hunks', () => {
    const edit: ChatTool = {
      kind: 'edit',
      path: 'a.ts',
      hunks: [
        { before: 'a', after: 'b' },
        { before: '', after: 'c\nd' },
      ],
    };
    expect(resolveEditStats(edit)).toEqual({ added: 3, removed: 1 });
  });

  it('has no stats for other tools or an edit without hunks', () => {
    expect(resolveEditStats(readTool('a.ts'))).toBeNull();
    expect(resolveEditStats({ kind: 'edit', path: 'a.ts', hunks: [] })).toBeNull();
  });
});

describe('splitArguments', () => {
  it('shows short values inline and code, long or multi-line values as blocks', () => {
    const long = 'x'.repeat(161);
    const { inline, blocks } = splitArguments({
      url: 'https://example.com',
      count: 3,
      force: false,
      code: 'return 1',
      note: 'line one\nline two',
      long,
      edge: 'y'.repeat(160),
      options: { a: 1 },
      empty: '',
      missing: null,
    });
    expect(inline).toEqual([
      ['url', 'https://example.com'],
      ['count', 3],
      ['force', false],
      ['edge', 'y'.repeat(160)],
    ]);
    expect(blocks).toEqual([
      ['code', 'return 1'],
      ['note', 'line one\nline two'],
      ['long', long],
      ['options', { a: 1 }],
    ]);
  });

  it('treats every code argument name as a block', () => {
    const { blocks } = splitArguments(Object.fromEntries([...CODE_ARGUMENTS].map((name) => [name, 'x'])));
    expect(blocks.map(([name]) => name)).toEqual(['code', 'function', 'script', 'js']);
  });
});

describe('isLongMarkdown', () => {
  it('folds markdown longer than 900 characters or 14 lines', () => {
    expect(isLongMarkdown('x'.repeat(900))).toBe(false);
    expect(isLongMarkdown('x'.repeat(901))).toBe(true);
    expect(isLongMarkdown(Array.from({ length: 14 }, () => 'line').join('\n'))).toBe(false);
    expect(isLongMarkdown(Array.from({ length: 15 }, () => 'line').join('\n'))).toBe(true);
  });
});
