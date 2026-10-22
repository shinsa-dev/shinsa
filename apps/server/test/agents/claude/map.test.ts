import { describe, expect, test } from 'bun:test';
import { mapClaudePrompt, mapClaudeResult, mapClaudeTool } from '../../../src/agents/claude/map.ts';

describe('the Claude adapter maps every tool to a kind', () => {
  test('files', () => {
    expect(mapClaudeTool('Read', { file_path: '/r/a.ts', offset: 10, limit: 5 })).toEqual({
      kind: 'read',
      path: '/r/a.ts',
      range: { start: 10, end: 14 },
    });
    expect(mapClaudeTool('Read', { file_path: '/r/a.ts' })).toEqual({
      kind: 'read',
      path: '/r/a.ts',
      range: null,
    });
    expect(mapClaudeTool('Write', { file_path: 'b.ts', content: 'x' })).toEqual({
      kind: 'write',
      path: 'b.ts',
      content: 'x',
    });
    expect(mapClaudeTool('Edit', { file_path: 'c.ts', old_string: 'a', new_string: 'b' })).toEqual({
      kind: 'edit',
      path: 'c.ts',
      hunks: [{ before: 'a', after: 'b' }],
    });
    expect(
      mapClaudeTool('MultiEdit', {
        file_path: 'c.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      })
    ).toEqual({
      kind: 'edit',
      path: 'c.ts',
      hunks: [
        { before: 'a', after: 'b' },
        { before: 'c', after: 'd' },
      ],
    });
    expect(mapClaudeTool('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 'print(1)' })).toEqual({
      kind: 'edit',
      path: 'n.ipynb',
      hunks: [{ before: '', after: 'print(1)' }],
    });
  });

  test('commands, searches and the web', () => {
    expect(mapClaudeTool('Bash', { command: 'bun test', description: 'Run the tests' })).toEqual({
      kind: 'command',
      action: 'run',
      command: 'bun test',
      description: 'Run the tests',
    });
    expect(mapClaudeTool('Grep', { pattern: 'retry', path: 'src' })).toEqual({
      kind: 'search',
      mode: 'content',
      query: 'retry',
      path: 'src',
    });
    expect(mapClaudeTool('Glob', { pattern: '**/*.ts' })).toEqual({
      kind: 'search',
      mode: 'files',
      query: '**/*.ts',
      path: null,
    });
    expect(mapClaudeTool('WebFetch', { url: 'https://x.dev', prompt: 'read it' })).toEqual({
      kind: 'fetch',
      url: 'https://x.dev',
      query: null,
      prompt: 'read it',
    });
    expect(mapClaudeTool('WebSearch', { query: 'bun watch' })).toEqual({
      kind: 'fetch',
      url: null,
      query: 'bun watch',
      prompt: null,
    });
  });

  test('subagents, to-dos and MCP servers', () => {
    expect(
      mapClaudeTool('Task', { description: 'Find callers', prompt: 'Look', subagent_type: 'Explore' })
    ).toEqual({ kind: 'task', description: 'Find callers', prompt: 'Look', agent: 'Explore' });
    expect(
      mapClaudeTool('TodoWrite', {
        todos: [
          { content: 'Write it', status: 'completed', activeForm: 'Writing it' },
          { content: 'Test it', status: 'odd', activeForm: 'Testing it' },
        ],
      })
    ).toEqual({
      kind: 'todo',
      todos: [
        { text: 'Write it', status: 'completed' },
        { text: 'Test it', status: 'pending' },
      ],
    });
    expect(mapClaudeTool('mcp__plugin_playwright_playwright__browser_click', { element: 'Save' })).toEqual({
      kind: 'browser',
      action: 'click',
      name: 'click',
      target: 'Save',
      code: null,
      args: { element: 'Save' },
    });
    expect(mapClaudeTool('mcp__playwright__browser_resize', { width: 900, height: 700 })).toMatchObject({
      kind: 'browser',
      action: 'resize',
      target: '900 × 700',
    });
    expect(mapClaudeTool('mcp__claude_ai_Notion__notion-search', { query: 'x' })).toEqual({
      kind: 'mcp',
      server: 'Notion',
      name: 'notion-search',
      args: { query: 'x' },
    });
    expect(mapClaudeTool('mcp__shinsa__complete_phase', { summary: 'Done.' })).toEqual({
      kind: 'shinsa',
      name: 'complete_phase',
      args: { summary: 'Done.' },
    });
    expect(mapClaudeTool('ExitPlanMode', { plan: 'x' })).toEqual({
      kind: 'other',
      name: 'ExitPlanMode',
      args: { plan: 'x' },
    });
  });

  test('no provider name survives in a mapped kind', () => {
    const names = [
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'Bash',
      'Grep',
      'Glob',
      'WebFetch',
      'WebSearch',
      'Task',
    ];
    for (const name of names) expect(JSON.stringify(mapClaudeTool(name, {}))).not.toContain(name);
  });
});

describe('results and prompts', () => {
  test('a tool_use_error becomes an error result without the tags', () => {
    expect(
      mapClaudeResult({ tool_use_id: 't1', content: '<tool_use_error>File not found</tool_use_error>' })
    ).toEqual({ type: 'tool_result', callId: 't1', status: 'error', output: 'File not found', images: [] });
  });

  test('images are stored and system reminders dropped', () => {
    const result = mapClaudeResult(
      {
        tool_use_id: 't2',
        content: [
          { type: 'text', text: 'ok<system-reminder>ignore</system-reminder>' },
          { type: 'image', source: { type: 'base64', data: 'AAAA', media_type: 'image/png' } },
        ],
      },
      () => '/api/evidence/shot.png'
    );
    expect(result).toEqual({
      type: 'tool_result',
      callId: 't2',
      status: 'ok',
      output: 'ok',
      images: ['/api/evidence/shot.png'],
    });
  });

  test('attachments come out of the prompt text', () => {
    expect(
      mapClaudePrompt(
        'Look at this<kanna-attachments><attachment kind="image" mime_type="image/png" path="/api/x.png" display_name="x.png" size_bytes="2048"/></kanna-attachments>',
        'you'
      )
    ).toEqual({
      type: 'user',
      from: 'you',
      text: 'Look at this',
      attachments: [{ kind: 'image', name: 'x.png', url: '/api/x.png', mimeType: 'image/png', size: 2048 }],
    });
    expect(mapClaudePrompt('<command-name>/clear</command-name>', 'you')).toBeNull();
  });
});

describe('the rest of the tool kinds', () => {
  test('background shells, listings and searches', () => {
    expect(mapClaudeTool('BashOutput', { bash_id: 'b1' })).toEqual({
      kind: 'command',
      action: 'output',
      command: 'b1',
      description: null,
    });
    expect(mapClaudeTool('KillBash', {})).toEqual({
      kind: 'command',
      action: 'stop',
      command: '',
      description: null,
    });
    expect(mapClaudeTool('KillShell', { shell_id: 's1' })).toMatchObject({ action: 'stop', command: 's1' });
    expect(mapClaudeTool('Grep', {})).toEqual({ kind: 'search', mode: 'content', query: '', path: null });
    expect(mapClaudeTool('Glob', {})).toEqual({ kind: 'search', mode: 'files', query: '', path: null });
    expect(mapClaudeTool('LS', { path: '/x' })).toEqual({
      kind: 'search',
      mode: 'list',
      query: '',
      path: '/x',
    });
    expect(mapClaudeTool('mcp__playwright__browser_click', {})).toMatchObject({
      kind: 'browser',
      target: null,
    });
  });

  test('a result part that is neither text nor a stored image is named', () => {
    expect(
      mapClaudeResult({
        tool_use_id: 't',
        content: [{ type: 'image', source: { type: 'url' } }, { type: 'document' }],
      })
    ).toMatchObject({
      output: '[image]\n[document]',
      images: [],
    });
    expect(mapClaudeResult({ content: { odd: true } })).toMatchObject({ callId: '', output: '' });
    expect(
      mapClaudeResult(
        { tool_use_id: 't', content: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }] },
        () => null
      )
    ).toMatchObject({ output: '[image]', images: [] });
  });
});

test('attachment attributes are decoded', () => {
  const prompt = mapClaudePrompt(
    '<attachments><attachment path="/a&amp;b &lt;c&gt; &#39;d&#39; &quot;e&quot; &copy;.png" kind="image" /></attachments>',
    'you'
  );
  expect(prompt).toMatchObject({ attachments: [{ url: '/a&b <c> \'d\' "e" &copy;.png' }] });
});
