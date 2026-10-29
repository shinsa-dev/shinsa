import { describe, expect, it } from 'bun:test';
import type { ChatBrowserAction, ChatTool } from '@shinsa/core';
import {
  describeTool,
  humanize,
  isHandover,
  readList,
  readString,
  readStrings,
  resolveGroupKey,
  resolveGroupPhrase,
  resolveRunningLabel,
  resolveShortPath,
} from '@/lib/chat/tool-describe.ts';

function browser(
  action: ChatBrowserAction,
  target: string | null = null,
  name = `browser_${action}`
): ChatTool {
  return { kind: 'browser', action, name, target, code: null, args: {} };
}

function line(tool: ChatTool) {
  const { verb, target, scope } = describeTool(tool);
  return [verb, target, scope].filter(Boolean).join(' ');
}

describe('isHandover', () => {
  it('treats the plan, phase, fix, review and question tools as hand-overs', () => {
    for (const name of ['propose_plan', 'complete_phase', 'complete_fix', 'report_review', 'ask'] as const) {
      expect(isHandover({ kind: 'shinsa', name, args: {} })).toBe(true);
    }
  });

  it('treats the diagnosis, the report, the outcome and a change of kind as hand-overs', () => {
    for (const name of ['report_diagnosis', 'submit_report', 'report_outcome', 'reshape_task'] as const) {
      expect(isHandover({ kind: 'shinsa', name, args: {} })).toBe(true);
    }
  });

  it('shows suggested tasks and a proposed rule as cards of their own', () => {
    for (const name of ['suggest_tasks', 'remember'] as const) {
      expect(isHandover({ kind: 'shinsa', name, args: {} })).toBe(true);
    }
  });

  it('keeps evidence, task lookups, notes and other tools in the work', () => {
    for (const name of ['attach_evidence', 'find_tasks', 'note'] as const) {
      expect(isHandover({ kind: 'shinsa', name, args: {} })).toBe(false);
    }
    expect(isHandover({ kind: 'other', name: 'ask', args: {} })).toBe(false);
  });
});

describe('resolveGroupKey', () => {
  it('groups Shinsa tools by name and every other tool by kind', () => {
    expect(resolveGroupKey({ kind: 'shinsa', name: 'note', args: {} })).toBe('note');
    expect(resolveGroupKey({ kind: 'read', path: 'a', range: null })).toBe('read');
  });

  it("groups an agent's Shinsa surface tools apart from other connected tools", () => {
    expect(resolveGroupKey({ kind: 'mcp', server: 'shinsa', name: 'tasks_done', args: {} })).toBe('surface');
    expect(resolveGroupKey({ kind: 'mcp', server: 'linear', name: 'list_issues', args: {} })).toBe('mcp');
    expect(
      resolveRunningLabel(describeTool({ kind: 'mcp', server: 'shinsa', name: 'tasks_done', args: {} }))
    ).toBe('Tasks done · Shinsa');
    expect(resolveGroupPhrase(['surface', 'surface', 'mcp'])).toBe(
      'Used 2 Shinsa tools and used 1 connected tool'
    );
  });
});

describe('readString and readList', () => {
  it('reads a non-blank string argument', () => {
    expect(readString({ title: 'Login' }, 'title')).toBe('Login');
    expect(readString({ title: '   ' }, 'title')).toBeNull();
    expect(readString({ title: 4 }, 'title')).toBeNull();
    expect(readString(null, 'title')).toBeNull();
  });

  it('reads only the objects of a list argument', () => {
    expect(readList({ plan: [{ title: 'One' }, null, 'two', 3, { title: 'Four' }] }, 'plan')).toEqual([
      { title: 'One' },
      { title: 'Four' },
    ]);
    expect(readList({ plan: 'not a list' }, 'plan')).toEqual([]);
    expect(readList(null, 'plan')).toEqual([]);
  });
});

describe('readStrings', () => {
  it('reads the non-blank strings of a list argument', () => {
    expect(readStrings({ choices: ['Blue', ' ', 3, 'Green'] }, 'choices')).toEqual(['Blue', 'Green']);
    expect(readStrings({ choices: 'Blue' }, 'choices')).toEqual([]);
    expect(readStrings(null, 'choices')).toEqual([]);
  });
});

describe('resolveShortPath', () => {
  it('shows a worktree path from the repository root', () => {
    expect(resolveShortPath('/Users/me/.shinsa/worktrees/task-1/src/app.ts')).toBe('src/app.ts');
  });

  it('keeps the last three parts of a long absolute path', () => {
    expect(resolveShortPath('/Users/me/Developer/shinsa/src/app.ts')).toBe('…/shinsa/src/app.ts');
  });

  it('leaves short and relative paths alone', () => {
    expect(resolveShortPath('/etc/hosts')).toBe('/etc/hosts');
    expect(resolveShortPath('src/lib/deep/nested/file.ts')).toBe('src/lib/deep/nested/file.ts');
  });
});

describe('humanize', () => {
  it('turns tool names into a sentence-case phrase', () => {
    expect(humanize('browser_take_screenshot')).toBe('Browser take screenshot');
    expect(humanize('listPullRequests')).toBe('List pull requests');
    expect(humanize('create-issue v2')).toBe('Create issue v2');
  });
});

describe('describeTool', () => {
  it('describes file reads, writes and edits as code with a short path', () => {
    expect(describeTool({ kind: 'read', path: '/a/worktrees/t/src/a.ts', range: null })).toEqual({
      icon: 'IconFileText',
      verb: 'Read',
      target: 'src/a.ts',
      code: true,
      scope: null,
    });
    expect(line({ kind: 'write', path: 'b.ts', content: '' })).toBe('Wrote b.ts');
    expect(line({ kind: 'edit', path: 'c.ts', hunks: [] })).toBe('Edited c.ts');
  });

  it('describes a command by its description, its first line, or what was done to it', () => {
    expect(
      describeTool({
        kind: 'command',
        action: 'run',
        command: 'bun test',
        description: 'Run the tests\nall of them',
      })
    ).toMatchObject({
      verb: 'Run the tests',
      target: null,
      code: false,
    });
    expect(
      describeTool({ kind: 'command', action: 'run', command: '\n  bun test\nbun lint', description: null })
    ).toMatchObject({
      verb: 'Ran',
      target: 'bun test',
      code: true,
    });
    expect(line({ kind: 'command', action: 'output', command: 'x', description: null })).toBe(
      'Checked a command'
    );
    expect(line({ kind: 'command', action: 'stop', command: 'x', description: 'Stop it' })).toBe(
      'Stopped a command'
    );
  });

  it('describes searches with the folder they ran in', () => {
    expect(describeTool({ kind: 'search', mode: 'content', query: 'TODO', path: 'src' })).toMatchObject({
      verb: 'Searched for',
      target: 'TODO',
      scope: 'in src',
    });
    expect(describeTool({ kind: 'search', mode: 'files', query: '*.ts', path: null })).toMatchObject({
      verb: 'Listed files matching',
      target: '*.ts',
      scope: null,
    });
    expect(describeTool({ kind: 'search', mode: 'list', query: '', path: 'src/lib' })).toMatchObject({
      verb: 'Listed',
      target: 'src/lib',
    });
    expect(describeTool({ kind: 'search', mode: 'list', query: '', path: null }).target).toBeNull();
  });

  it('describes a web lookup by its address or its query', () => {
    expect(line({ kind: 'fetch', url: 'https://example.com', query: null, prompt: null })).toBe(
      'Opened https://example.com'
    );
    expect(line({ kind: 'fetch', url: null, query: 'bun coverage', prompt: null })).toBe(
      'Searched the web for bun coverage'
    );
  });

  it('describes browser steps by action, naming unknown ones after the tool', () => {
    expect(line(browser('navigate', 'http://localhost:5181\nmore'))).toBe('Opened http://localhost:5181');
    expect(line(browser('screenshot'))).toBe('Took a screenshot');
    expect(describeTool(browser('press', 'Enter'))).toMatchObject({
      verb: 'Pressed',
      target: 'Enter',
      code: true,
    });
    expect(describeTool(browser('click', 'Save')).code).toBe(false);
    expect(describeTool(browser('other', null, 'browser_install'))).toMatchObject({
      icon: 'IconWindowCursor',
      verb: 'Browser install',
      target: null,
    });
  });

  it('describes subagents, to-do lists and connected tools', () => {
    expect(line({ kind: 'task', description: 'Find the bug', prompt: null, agent: null })).toBe(
      'Ran a subagent: Find the bug'
    );
    expect(describeTool({ kind: 'task', description: '', prompt: null, agent: null }).target).toBeNull();
    expect(line({ kind: 'todo', todos: [] })).toBe('Updated the to-do list');
    expect(
      describeTool({
        kind: 'mcp',
        server: 'linear_server',
        name: 'getIssue',
        args: { id: 'ENG-1', title: '\nFix login\nmore' },
      })
    ).toMatchObject({
      icon: 'IconPlugin1',
      verb: 'Get issue',
      target: 'Fix login',
      scope: 'Linear server',
    });
    expect(describeTool({ kind: 'mcp', server: 'x', name: 'ping', args: { count: 3 } }).target).toBeNull();
  });

  it('describes every Shinsa tool', () => {
    const shinsa = (name: Extract<ChatTool, { kind: 'shinsa' }>['name'], args = {}) =>
      line({ kind: 'shinsa', name, args });
    expect(shinsa('propose_plan')).toBe('Proposed the plan');
    expect(shinsa('complete_phase')).toBe('Handed over the phase');
    expect(shinsa('complete_fix')).toBe('Handed over the fix');
    expect(shinsa('report_review')).toBe('Reported the review');
    expect(shinsa('ask', { question: 'Which one?' })).toBe('Asked you: Which one?');
    expect(shinsa('attach_evidence', { title: 'Login page' })).toBe('Attached evidence: Login page');
    expect(shinsa('attach_evidence', { kind: 'test', check: 'c2' })).toBe('Linked the check as evidence: c2');
    expect(shinsa('remove_evidence', { items: ['login'], reason: 'The page changed' })).toBe(
      'Removed evidence: The page changed'
    );
    expect(shinsa('find_tasks', { query: 'login' })).toBe('Looked up tasks: login');
    expect(shinsa('find_tasks')).toBe('Looked up tasks');
    expect(shinsa('read_task', { task_id: 't1' })).toBe('Read a task');
    expect(shinsa('list_repository_work')).toBe('Listed the other work in the repository');
    expect(shinsa('list_services')).toBe('Listed the task’s services');
    expect(shinsa('run_service', { service: 'api', action: 'start' })).toBe('Started a service: api');
    expect(shinsa('run_service', { service: 'api', action: 'stop' })).toBe('Stopped a service: api');
    expect(shinsa('run_service', { service: 'api', action: 'restart' })).toBe('Restarted a service: api');
    expect(shinsa('run_service', { service: 'api' })).toBe('Ran a service: api');
    expect(shinsa('note', { note: 'Remember' })).toBe('Left a note: Remember');
    expect(shinsa('wait_for', { notes: 'The deploy' })).toBe('Scheduled a check-in: The deploy');
    expect(shinsa('suggest_tasks', { tasks: [{ title: 'a' }, { title: 'b' }] })).toBe('Suggested 2 tasks');
    expect(shinsa('suggest_tasks', { tasks: [{ title: 'a' }] })).toBe('Suggested 1 task');
    expect(shinsa('remember', { text: 'Keep plans short.' })).toBe(
      'Proposed a rule to remember: Keep plans short.'
    );
    expect(shinsa('answer', { answer: 'Here.' })).toBe('Handed over the answer');
    expect(shinsa('report_diagnosis', { diagnosis: 'It leaks.' })).toBe('Reported the diagnosis');
    expect(shinsa('submit_report', { report: 'Report.' })).toBe('Wrote the report');
    expect(shinsa('report_outcome', { outcome: 'Done.' })).toBe('Reported the outcome');
    expect(shinsa('reshape_task', { shape: 'answer', reason: 'Only a question.' })).toBe(
      'Changed the kind of task'
    );
    expect(
      shinsa('reshape_task', {
        steps: ['investigate', 'your_ok', 'plan', 'operate'],
        reason: 'Find it first.',
      })
    ).toBe('Set the steps: investigate, your OK, plan, run the operation');
  });

  it('describes the delegation tools by what they handed to whom', () => {
    const shinsa = (name: Extract<ChatTool, { kind: 'shinsa' }>['name'], args = {}) =>
      line({ kind: 'shinsa', name, args });
    expect(shinsa('delegate_task', { title: 'Survey the tests', brief: 'Long brief' })).toBe(
      'Delegated: Survey the tests'
    );
    expect(shinsa('delegate_task', { brief: 'Read a.ts\nThen report' })).toBe('Delegated: Read a.ts');
    expect(shinsa('delegate_task')).toBe('Delegated:');
    expect(shinsa('delegation_status', { delegation_id: 'r' })).toBe('Checked a delegation');
    expect(shinsa('delegation_cancel', { delegation_id: 'r' })).toBe('Stopped a delegation');
    expect(shinsa('delegation_answer', { answer: 'Use b.ts' })).toBe('Answered a delegated agent: Use b.ts');
    expect(shinsa('create_task', { request: 'Bump the SDK\nIn the admin app' })).toBe(
      'Created a task: Bump the SDK'
    );
    expect(shinsa('create_task')).toBe('Created a task:');
    expect(shinsa('split_task', { tasks: [{}, {}] })).toBe('Split the plan into 2 tasks');
  });

  it('describes the schedule and secret tools by what they set up', () => {
    const shinsa = (name: Extract<ChatTool, { kind: 'shinsa' }>['name'], args = {}) =>
      line({ kind: 'shinsa', name, args });
    expect(shinsa('set_schedule', { name: 'Nightly sync' })).toBe('Set a schedule: Nightly sync');
    expect(shinsa('set_schedule', { message: 'Sync the docs\nThen report' })).toBe(
      'Set a schedule: Sync the docs'
    );
    expect(shinsa('list_schedules')).toBe('Listed the schedules');
    expect(shinsa('delete_schedule', { schedule_id: 's' })).toBe('Deleted a schedule');
    expect(shinsa('request_secret', { label: 'GitHub webhook secret' })).toBe(
      'Asked you for a secret: GitHub webhook secret'
    );
  });

  it('describes any other tool by name and its main argument', () => {
    expect(line({ kind: 'other', name: 'NotebookRead', args: { path: 'a.ipynb' } })).toBe(
      'Used NotebookRead a.ipynb'
    );
    expect(line({ kind: 'other', name: 'Mystery', args: {} })).toBe('Used Mystery');
  });
});

describe('resolveRunningLabel', () => {
  it('turns the verb into what the agent is doing now, with its scope', () => {
    expect(
      resolveRunningLabel(
        describeTool({ kind: 'command', action: 'run', command: 'bun test', description: null })
      )
    ).toBe('Running bun test');
    expect(
      resolveRunningLabel(describeTool({ kind: 'search', mode: 'content', query: 'TODO', path: 'src' }))
    ).toBe('Searching for TODO · in src');
  });

  it('speaks in the present tense for every step with a fixed verb', () => {
    const tools: ChatTool[] = [
      { kind: 'read', path: 'a.ts', range: null },
      { kind: 'write', path: 'a.ts', content: '' },
      { kind: 'edit', path: 'a.ts', hunks: [] },
      { kind: 'command', action: 'run', command: 'ls', description: null },
      { kind: 'command', action: 'output', command: 'ls', description: null },
      { kind: 'command', action: 'stop', command: 'ls', description: null },
      { kind: 'search', mode: 'content', query: 'x', path: null },
      { kind: 'search', mode: 'files', query: 'x', path: null },
      { kind: 'search', mode: 'list', query: '', path: 'src' },
      { kind: 'fetch', url: 'https://a.b', query: null, prompt: null },
      { kind: 'fetch', url: null, query: 'x', prompt: null },
      ...(
        [
          'navigate',
          'back',
          'click',
          'hover',
          'drag',
          'select',
          'type',
          'fill',
          'press',
          'screenshot',
          'snapshot',
          'find',
          'resize',
          'evaluate',
          'wait',
          'console',
          'network',
          'tabs',
          'close',
        ] as const
      ).map((action) => browser(action, 'x')),
      { kind: 'task', description: 'x', prompt: null, agent: null },
      { kind: 'todo', todos: [] },
      ...(
        [
          'propose_plan',
          'complete_phase',
          'complete_fix',
          'report_review',
          'ask',
          'attach_evidence',
          'find_tasks',
          'read_task',
          'list_repository_work',
          'note',
          'delegate_task',
          'delegation_status',
          'delegation_cancel',
          'delegation_answer',
          'create_task',
          'split_task',
          'set_schedule',
          'list_schedules',
          'delete_schedule',
          'request_secret',
        ] as const
      ).map((name): ChatTool => ({ kind: 'shinsa', name, args: {} })),
      { kind: 'shinsa', name: 'find_tasks', args: { query: 'x' } },
    ];
    const past = tools.filter((tool) => {
      const description = describeTool(tool);
      return resolveRunningLabel(description).split(' ')[0] === description.verb.split(' ')[0];
    });
    expect(past.map((tool) => describeTool(tool).verb)).toEqual([]);
  });

  it('leaves a verb it does not know as it is', () => {
    expect(
      resolveRunningLabel({
        icon: 'IconToolbox',
        verb: 'Used Mystery',
        target: 'x',
        code: false,
        scope: null,
      })
    ).toBe('Used Mystery x');
  });
});

describe('resolveGroupPhrase', () => {
  it('names a watchdog check the agent reported', () => {
    expect(resolveGroupPhrase(['report_watch'])).toBe('Reported the watchdog check');
  });

  it('counts each kind of step in the order it first appeared', () => {
    expect(resolveGroupPhrase(['command', 'read', 'command', 'read', 'command'])).toBe(
      'Ran 3 commands and read 2 files'
    );
    expect(resolveGroupPhrase(['edit', 'write', 'search'])).toBe(
      'Edited 1 file, wrote 1 file and searched once'
    );
  });

  it('has a phrase for every kind of step, singular and plural', () => {
    const phrase = (key: Parameters<typeof resolveGroupPhrase>[0][number], count: number) =>
      resolveGroupPhrase(Array.from({ length: count }, () => key));
    expect([phrase('search', 2), phrase('fetch', 1), phrase('browser', 1), phrase('browser', 4)]).toEqual([
      'Searched 2 times',
      'Looked up 1 page',
      'Used the browser once',
      'Took 4 steps in the browser',
    ]);
    expect([phrase('task', 2), phrase('todo', 3), phrase('mcp', 2), phrase('other', 1)]).toEqual([
      'Ran 2 subagents',
      'Updated the to-do list',
      'Used 2 connected tools',
      'Used 1 tool',
    ]);
    expect([
      phrase('propose_plan', 1),
      phrase('complete_phase', 1),
      phrase('complete_fix', 1),
      phrase('report_review', 1),
      phrase('ask', 1),
    ]).toEqual([
      'Proposed the plan',
      'Handed over the phase',
      'Handed over the fix',
      'Reported the review',
      'Asked you a question',
    ]);
    expect([
      phrase('attach_evidence', 1),
      phrase('attach_evidence', 2),
      phrase('find_tasks', 1),
      phrase('find_tasks', 3),
    ]).toEqual([
      'Attached 1 piece of evidence',
      'Attached 2 pieces of evidence',
      'Looked up tasks once',
      'Looked up tasks 3 times',
    ]);
    expect([phrase('remove_evidence', 1), phrase('remove_evidence', 2)]).toEqual([
      'Removed evidence',
      'Removed evidence 2 times',
    ]);
    expect(phrase('note', 2)).toBe('Left 2 notes');
    expect([phrase('remember', 1), phrase('remember', 2)]).toEqual([
      'Proposed a rule to remember',
      'Proposed 2 rules to remember',
    ]);
    expect(phrase('read_task', 2)).toBe('Read 2 tasks');
    expect([phrase('list_repository_work', 1), phrase('list_repository_work', 2)]).toEqual([
      'Listed the other work in the repository',
      'Listed the other work in the repository 2 times',
    ]);
    expect([phrase('list_services', 1), phrase('list_services', 2), phrase('run_service', 2)]).toEqual([
      'Listed the task’s services',
      'Listed the task’s services 2 times',
      'Ran 2 services',
    ]);
    expect([phrase('wait_for', 1), phrase('suggest_tasks', 1), phrase('answer', 1)]).toEqual([
      'Scheduled a check-in',
      'Suggested tasks',
      'Handed over the answer',
    ]);
    expect([
      phrase('report_diagnosis', 1),
      phrase('submit_report', 1),
      phrase('report_outcome', 1),
      phrase('reshape_task', 1),
    ]).toEqual([
      'Reported the diagnosis',
      'Wrote the report',
      'Reported the outcome',
      'Changed the kind of task',
    ]);
    expect([
      phrase('delegate_task', 2),
      phrase('delegation_status', 1),
      phrase('delegation_status', 3),
      phrase('delegation_cancel', 1),
      phrase('delegation_answer', 1),
      phrase('delegation_answer', 2),
      phrase('create_task', 1),
      phrase('split_task', 1),
      phrase('set_schedule', 2),
      phrase('list_schedules', 1),
      phrase('delete_schedule', 1),
      phrase('request_secret', 1),
    ]).toEqual([
      'Started 2 delegations',
      'Checked a delegation',
      'Checked delegations 3 times',
      'Stopped 1 delegation',
      'Answered a delegated agent',
      'Answered delegated agents 2 times',
      'Created 1 task',
      'Split the plan',
      'Set 2 schedules',
      'Listed the schedules',
      'Deleted 1 schedule',
      'Asked you for a secret',
    ]);
  });

  it('is empty for no steps', () => {
    expect(resolveGroupPhrase([])).toBe('');
  });
});
