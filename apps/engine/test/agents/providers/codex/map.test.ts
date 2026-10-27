import { describe, expect, test } from 'bun:test';
import type { ChatEvent } from '@shinsa/core';
import {
  type CodexItem,
  createCodexRecorder,
  mapCodexItemCalls,
  mapCodexItemResults,
  mapPlanSteps,
  parseDiffHunks,
  unwrapShellCommand,
} from '../../../../src/agents/providers/codex/map.ts';

function item(type: string, fields: Record<string, unknown> = {}): CodexItem {
  return { type, id: `${type}-1`, ...fields };
}

describe('codex items as chat tools', () => {
  test('a command shows what the agent ran, without the shell wrapper', () => {
    expect(unwrapShellCommand("/bin/zsh -lc 'bun test'")).toBe('bun test');
    expect(unwrapShellCommand('bash -c "ls -la"')).toBe('ls -la');
    expect(unwrapShellCommand('git status')).toBe('git status');
    expect(mapCodexItemCalls(item('commandExecution', { command: "sh -lc 'echo hi'" }))).toEqual([
      {
        callId: 'commandExecution-1',
        tool: { kind: 'command', action: 'run', command: 'echo hi', description: null },
      },
    ]);
  });

  test('a file change becomes a write, an edit per hunk or a removal, one call per file', () => {
    const diff = [
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '+new',
      '\\ No newline',
      '@@ -9 +9 @@',
      '-a',
      '+b',
    ].join('\n');
    expect(parseDiffHunks(diff)).toEqual([
      { before: 'keep\nold', after: 'keep\nnew' },
      { before: 'a', after: 'b' },
    ]);
    const calls = mapCodexItemCalls(
      item('fileChange', {
        changes: [
          { path: 'new.ts', kind: { type: 'add' }, diff: '+one\n+two' },
          { path: 'raw.ts', kind: { type: 'add' }, diff: 'plain content' },
          { path: 'gone.ts', kind: { type: 'delete' }, diff: '-bye' },
          { path: 'empty.ts', kind: { type: 'delete' }, diff: 'whole file' },
          { path: 'old.ts', kind: { type: 'update', move_path: 'moved.ts' }, diff },
          'not a change',
        ],
      })
    );
    expect(calls.map((call) => call.callId)).toEqual([
      'fileChange-1:0',
      'fileChange-1:1',
      'fileChange-1:2',
      'fileChange-1:3',
      'fileChange-1:4',
    ]);
    expect(calls.map((call) => call.tool)).toEqual([
      { kind: 'write', path: 'new.ts', content: 'one\ntwo' },
      { kind: 'write', path: 'raw.ts', content: 'plain content' },
      { kind: 'edit', path: 'gone.ts', hunks: [{ before: 'bye', after: '' }] },
      { kind: 'edit', path: 'empty.ts', hunks: [{ before: 'whole file', after: '' }] },
      {
        kind: 'edit',
        path: 'moved.ts',
        hunks: [
          { before: 'keep\nold', after: 'keep\nnew' },
          { before: 'a', after: 'b' },
        ],
      },
    ]);
    expect(
      mapCodexItemCalls(item('fileChange', { changes: [{ path: 'a', kind: {}, diff: '' }] }))[0]?.callId
    ).toBe('fileChange-1');
  });

  test('MCP tools, searches, subagents, images and other tools', () => {
    expect(
      mapCodexItemCalls(item('mcpToolCall', { server: 'shinsa', tool: 'note', arguments: { text: 'x' } }))[0]
        ?.tool
    ).toEqual({
      kind: 'shinsa',
      name: 'note',
      args: { text: 'x' },
    });
    expect(
      mapCodexItemCalls(
        item('mcpToolCall', { server: 'playwright', tool: 'browser_navigate', arguments: { url: 'u' } })
      )[0]?.tool
    ).toMatchObject({
      kind: 'browser',
      action: 'navigate',
    });
    expect(
      mapCodexItemCalls(
        item('webSearch', { query: '', action: { type: 'search', queries: [1, 'second'] } })
      )[0]?.tool
    ).toEqual({
      kind: 'fetch',
      url: null,
      query: 'second',
      prompt: null,
    });
    expect(mapCodexItemCalls(item('webSearch', { action: { query: 'from action' } }))[0]?.tool).toMatchObject(
      { query: 'from action' }
    );
    expect(mapCodexItemCalls(item('webSearch', {}))[0]?.tool).toMatchObject({ query: null });
    expect(
      mapCodexItemCalls(item('collabAgentToolCall', { tool: 'spawnAgent', prompt: 'x'.repeat(100) }))[0]?.tool
    ).toMatchObject({
      kind: 'task',
      description: `${'x'.repeat(79)}…`,
      agent: null,
    });
    expect(
      mapCodexItemCalls(item('collabAgentToolCall', { tool: 'spawnAgent', prompt: '' }))[0]?.tool
    ).toMatchObject({
      description: 'Agent',
      prompt: null,
    });
    expect(
      mapCodexItemCalls(item('collabAgentToolCall', { tool: 'wait', receiverThreadIds: ['t'] }))[0]?.tool
    ).toEqual({
      kind: 'other',
      name: 'wait',
      args: { prompt: '', receiverThreadIds: ['t'] },
    });
    expect(
      mapCodexItemCalls(item('dynamicToolCall', { tool: 'x', arguments: 'not an object' }))[0]?.tool
    ).toEqual({
      kind: 'other',
      name: 'x',
      args: {},
    });
    expect(mapCodexItemCalls(item('reasoning'))).toEqual([]);
    expect(mapCodexItemCalls(item('fileChange'))).toEqual([]);
  });
});

describe('codex items as chat results', () => {
  test('commands fail on a nonzero exit, a decline, or a failed status', () => {
    const results = [
      mapCodexItemResults(item('commandExecution', { aggregatedOutput: 'ok\n', exitCode: 0 })),
      mapCodexItemResults(item('commandExecution', { aggregatedOutput: 'boom', exitCode: 2 })),
      mapCodexItemResults(item('commandExecution', { status: 'declined' })),
      mapCodexItemResults(item('commandExecution', { status: 'failed', exitCode: null })),
    ].flat();
    expect(
      results.map((result) => (result.type === 'tool_result' ? [result.status, result.output] : null))
    ).toEqual([
      ['ok', 'ok'],
      ['error', 'boom'],
      ['error', 'Shinsa declined this command.'],
      ['error', ''],
    ]);
  });

  test('MCP results keep their text and images, and an error is the error', () => {
    const stored: string[] = [];
    const storeImage = (data: string, mediaType: string) => {
      stored.push(`${mediaType}:${data}`);
      return data === 'skip' ? null : `/api/evidence/${data}`;
    };
    const [ok] = mapCodexItemResults(
      item('mcpToolCall', {
        status: 'completed',
        result: {
          content: [
            { type: 'text', text: 'line' },
            { type: 'image', data: 'abc', mimeType: 'image/jpeg' },
            { type: 'image', data: 'skip' },
          ],
        },
      }),
      storeImage
    );
    expect(ok).toMatchObject({ status: 'ok', output: 'line', images: ['/api/evidence/abc'] });
    expect(stored).toEqual(['image/jpeg:abc', 'image/png:skip']);
    const [failed] = mapCodexItemResults(
      item('mcpToolCall', { status: 'failed', error: { message: 'nope' } })
    );
    expect(failed).toMatchObject({ status: 'error', output: 'nope' });
    const [noImages] = mapCodexItemResults(
      item('mcpToolCall', { result: { content: [{ type: 'image', data: 'x' }] } })
    );
    expect(noImages).toMatchObject({ output: '', images: [] });
  });

  test('every other item has a result, and items without a call have none', () => {
    const results = [
      ...mapCodexItemResults(item('fileChange', { status: 'declined', changes: [{}, {}] })),
      ...mapCodexItemResults(
        item('dynamicToolCall', { success: false, contentItems: [{ text: 'a' }, { imageUrl: 'u' }, {}] })
      ),
      ...mapCodexItemResults(item('webSearch')),
      ...mapCodexItemResults(item('imageView')),
      ...mapCodexItemResults(item('collabAgentToolCall', { status: 'completed' })),
      ...mapCodexItemResults(item('agentMessage')),
    ];
    expect(
      results.map((result) =>
        result.type === 'tool_result' ? `${result.callId}:${result.status}:${result.output}` : ''
      )
    ).toEqual([
      'fileChange-1:0:error:',
      'fileChange-1:1:error:',
      'dynamicToolCall-1:error:a\nu',
      'webSearch-1:ok:',
      'imageView-1:ok:',
      'collabAgentToolCall-1:ok:completed',
    ]);
  });

  test('plan steps become to-dos', () => {
    expect(
      mapPlanSteps([
        { step: ' Read ', status: 'in_progress' },
        { step: 'Ship', status: 'weird' },
        { step: 3 },
      ])
    ).toEqual([
      { text: 'Read', status: 'in_progress' },
      { text: 'Ship', status: 'pending' },
    ]);
  });
});

describe('the codex recorder', () => {
  test('holds agent text until the next event, calls each tool once, and compacts once a turn', () => {
    const events: ChatEvent[] = [];
    const recorder = createCodexRecorder((event) => events.push(event));
    const command = item('commandExecution', { command: 'ls', exitCode: 0, aggregatedOutput: '' });
    recorder.completed(item('agentMessage', { text: 'Looking.' }));
    recorder.started(command);
    recorder.completed(command);
    recorder.completed(item('webSearch', { id: 'search', query: 'q' }));
    recorder.compacted();
    recorder.completed(item('contextCompaction'));
    recorder.completed(item('agentMessage', { text: 'Done.' }));
    recorder.endTurn();
    recorder.compacted();
    recorder.plan('turn', [{ step: 'Next', status: 'pending' }]);
    recorder.plan('turn', []);
    expect(
      events.map((event) =>
        event.type === 'notice'
          ? `notice:${event.notice.kind}`
          : event.type === 'agent'
            ? `${event.phase}:${event.text}`
            : event.type
      )
    ).toEqual([
      'interim:Looking.',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'notice:compaction',
      'final:Done.',
      'notice:compaction',
      'tool_call',
      'tool_result',
    ]);
    expect(recorder.lastText()).toBe('Done.');
  });

  test('an agent call that starts no thread is an ordinary call, and a subagent’s compaction is its own', () => {
    const events: ChatEvent[] = [];
    const recorder = createCodexRecorder((event) => events.push(event));
    recorder.completed(item('collabAgentToolCall', { id: 'none', tool: 'spawnAgent', status: 'completed' }));
    recorder.completed(
      item('collabAgentToolCall', {
        id: 'wait',
        tool: 'wait',
        status: 'completed',
        receiverThreadIds: ['t1'],
      })
    );
    recorder.completed(
      item('collabAgentToolCall', {
        id: 'failed',
        tool: 'spawnAgent',
        status: 'failed',
        receiverThreadIds: ['t2'],
      })
    );
    recorder.completed(
      item('collabAgentToolCall', {
        id: 'spawn',
        tool: 'spawnAgent',
        status: 'completed',
        receiverThreadIds: ['t3', ''],
      })
    );
    recorder.completed(item('contextCompaction'), 't3');
    recorder.endAgentTurn('t3', false);
    recorder.endAgentTurn('t3', true);
    recorder.closeAgents();
    expect(recorder.isAgent('t1')).toBe(false);
    expect(recorder.isAgent('t2')).toBe(false);
    expect(recorder.agentModel('t3')).toBeNull();
    expect(
      events.map((event) => (event.type === 'tool_result' ? `${event.callId}:${event.status}` : event.type))
    ).toEqual([
      'tool_call',
      'none:ok',
      'tool_call',
      'wait:ok',
      'tool_call',
      'failed:error',
      'tool_call',
      'spawn:ok',
    ]);
  });
});
