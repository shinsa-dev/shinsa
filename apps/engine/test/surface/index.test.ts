import { describe, expect, test } from 'bun:test';
import { parseUserCommand, USER_COMMAND_TYPES } from '@shinsa/core';
import { resolveCommandKey } from '../../src/surface/client.ts';
import {
  describeGroup,
  describeSurface,
  describeUsage,
  listAgentSpecs,
  listGroup,
  listUncoveredCommands,
  resolveToolName,
  SURFACE,
  type SurfaceSpec,
  selectSpec,
  serializeReference,
} from '../../src/surface/index.ts';
import { PLAIN_DISPLAY, PLAIN_STYLE } from '../../src/terminal/index.ts';
import { BASE, createFakeClient, findSpec, runSpec } from './fixtures.ts';

describe('the surface covers every command', () => {
  test('every user command has a CLI path', () => {
    expect(listUncoveredCommands()).toEqual([]);
  });

  test('a command no spec sends is reported as uncovered', () => {
    const covered = listUncoveredCommands();
    const others = SURFACE.filter((spec) => spec.command !== 'task.cancel');
    expect(listUncoveredCommands(others).filter((type) => !covered.includes(type))).toEqual(['task.cancel']);
    expect(listUncoveredCommands([])).toEqual(USER_COMMAND_TYPES);
  });

  test('no two specs share a path, and every write that sends a command names a known type', () => {
    const paths = SURFACE.map((spec) => spec.path.join(' '));
    expect(new Set(paths).size).toBe(paths.length);
    for (const spec of SURFACE) {
      if (spec.command) expect(USER_COMMAND_TYPES).toContain(spec.command);
    }
  });

  test('the generic `shinsa command <type>` accepts every user command type', async () => {
    const spec = findSpec(['command']);
    const choices = spec.fields.find((field) => field.name === 'type')?.choices ?? [];
    expect([...choices].sort()).toEqual([...USER_COMMAND_TYPES].sort());
    for (const type of USER_COMMAND_TYPES) {
      const fake = createFakeClient();
      await runSpec(fake, ['command', type, '--fields', '{"taskId":"task-1"}']);
      expect(fake.sent).toEqual([{ taskId: 'task-1', type } as never]);
    }
  });
});

describe('shinsa command', () => {
  test('sends the type over the given fields and links the task it touched', async () => {
    const fake = createFakeClient({}, 'task-1');
    const result = await runSpec(fake, [
      'command',
      'task.cancel',
      '--fields',
      '{"taskId":"task-1","type":"x"}',
    ]);
    expect(fake.sent).toEqual([{ taskId: 'task-1', type: 'task.cancel' }]);
    expect(result.text).toBe(`Done.\n${BASE}/tasks/task-1`);
    const plain = createFakeClient();
    expect((await runSpec(plain, ['command', 'focus.change'])).text).toBe('Done.');
    expect(plain.sent).toEqual([{ type: 'focus.change' } as never]);
  });

  test('what it sends is still checked by the server’s command parser', () => {
    expect(() => parseUserCommand({ type: 'task.cancel' })).toThrow();
  });
});

describe('finding a spec', () => {
  test('the longest path that matches wins, and the words after it are its arguments', () => {
    expect(selectSpec(['tasks', 'show', 'abc', '--json'])).toMatchObject({
      spec: { path: ['tasks', 'show'] },
      rest: ['abc', '--json'],
    });
    expect(selectSpec(['usage'])).toMatchObject({ spec: { path: ['usage'] }, rest: [] });
    expect(selectSpec(['tasks', 'launch'])).toBeNull();
    expect(selectSpec([])).toBeNull();
    const short: SurfaceSpec = { ...findSpec(['usage']), path: ['tasks'] };
    expect(selectSpec(['tasks', 'list'], [short, findSpec(['tasks', 'list'])])?.spec.path).toEqual([
      'tasks',
      'list',
    ]);
  });

  test('a group lists the specs under its first word', () => {
    expect(listGroup('plans').map((spec) => spec.path[1])).toEqual(['approve', 'revise', 'reject']);
    expect(listGroup('nothing')).toEqual([]);
  });

  test('tool names join the path with underscores, and task agents never see the human-only specs or tasks create', () => {
    expect(resolveToolName(findSpec(['tasks', 'check-in-now']))).toBe('tasks_check_in_now');
    expect(resolveToolName(findSpec(['usage']))).toBe('usage');
    const names = listAgentSpecs().map((spec) => spec.path.join(' '));
    expect(names).toContain('tasks wait-on');
    for (const hidden of [
      'tasks create',
      'questions answer',
      'tasks open',
      'gates secret',
      'gates answer',
      'plans approve',
      'reviews approve',
      'reviews verdicts',
      'merges approve',
      'operations run',
      'operations finish',
      'accounts sign-in',
      'accounts import',
      'accounts remove',
      'schedules webhook-secret',
      'command',
    ]) {
      expect(names).not.toContain(hidden);
    }
    expect(listAgentSpecs().length).toBe(SURFACE.filter((spec) => !spec.humanOnly).length - 1);
    expect(findSpec(['tasks', 'create'])).toMatchObject({ agentTool: 'create_task' });
  });
});

describe('help text', () => {
  test('a spec’s usage shows its arguments in order, optional ones in brackets, and each one explained', () => {
    const usage = describeUsage(findSpec(['tasks', 'create'])).split('\n');
    expect(usage.slice(0, 4)).toEqual([
      'Create a task. Shinsa classifies it, plans it and builds it.',
      '',
      'Usage',
      '  shinsa tasks create <request...> [--repo <text>] [--project <text>] [--priority <urgent|high|normal|low>] [--plan-first] [--ask] [--after <list>] [--fork-from <text>] [--account <text>] [--json]',
    ]);
    expect(usage[5]).toBe('Arguments');
    expect(usage[6]).toBe(
      `  ${'<request>'.padEnd(14)}What should be done. The first line becomes the title.`
    );
    expect(usage[7]).toBe(
      `  ${'--repo'.padEnd(14)}The repository (name or id). Triage picks one when left out.`
    );
    const narrow = describeUsage(findSpec(['tasks', 'create']), { style: PLAIN_STYLE, width: 60 }).split(
      '\n'
    );
    expect(narrow.slice(3, 6)).toEqual([
      '  shinsa tasks create <request...> [--repo <text>]',
      '                      [--project <text>]',
      '                      [--priority <urgent|high|normal|low>]',
    ]);
    expect(narrow.every((line) => line.length <= 60)).toBe(true);
  });

  test('required flags and optional positionals are marked, and a spec without arguments has no list', () => {
    expect(describeUsage(findSpec(['projects', 'add-repo']))).toContain(
      'shinsa projects add-repo <project> <path> [--json]'
    );
    expect(describeUsage(findSpec(['settings', 'get']))).toContain('shinsa settings get [<key>] [--json]');
    expect(describeUsage(findSpec(['usage']))).toBe(
      'Show how much of each usage limit every account has used, and when it resets.\n\nUsage\n  shinsa usage [--json]'
    );
    const bare: SurfaceSpec = {
      ...findSpec(['usage']),
      fields: [{ name: 'in', kind: 'choice', description: 'Where.' }],
    };
    expect(describeUsage(bare)).toContain('shinsa usage [--in <>] [--json]');
  });

  test('a group lists its commands with their summaries and how to learn more', () => {
    expect(describeGroup('focus').split('\n')).toEqual([
      'Show only one project’s work, for a while or until you clear it.',
      '',
      'Usage',
      '  shinsa focus <command> [arguments] [--json]',
      '',
      'Commands',
      '  show   Show the project you are focused on.',
      '  set    Focus on one project: Shinsa shows only its work.',
      '  clear  Stop focusing on one project.',
      '',
      'Add --help to any of them for its arguments, --json for machine-readable output.',
    ]);
    const unlisted: SurfaceSpec = { ...findSpec(['usage']), path: ['later', 'now'] };
    expect(describeGroup('later', [unlisted]).split('\n')[0]).toBe('shinsa later');
  });

  test('the surface lists one line per spec, aligned to the width it is given', () => {
    const lines = describeSurface(PLAIN_DISPLAY);
    expect(lines.filter((line) => line.startsWith('  shinsa '))).toHaveLength(SURFACE.length);
    expect(lines[0]).toBe(`  ${'shinsa tasks list'.padEnd(32)}List tasks, most recently changed first.`);
    expect(describeSurface(PLAIN_DISPLAY, 18)[0]).toBe(
      `  ${'shinsa tasks list'.padEnd(20)}List tasks, most recently changed first.`
    );
  });
});

describe('command keys', () => {
  test('the first command of an invocation uses the key, later ones add their count', () => {
    expect(resolveCommandKey('cli:1', 0)).toBe('cli:1');
    expect(resolveCommandKey('cli:1', 1)).toBe('cli:1:1');
    expect(resolveCommandKey('cli:1', 2)).toBe('cli:1:2');
  });
});

describe('the reference', () => {
  test('names the agents’ tool of each spec, or says it is yours alone', () => {
    const reference = serializeReference();
    expect(reference).toContain("Every task agent's tool: `tasks_list` (reads).");
    expect(reference).toContain(
      'Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.'
    );
    expect(reference).toContain('#### shinsa accounts sign-in\n\nSign in to a Claude account');
    expect(reference).toMatch(
      /#### shinsa accounts sign-in\n[\s\S]*?Yours alone: no agent has a tool for it/
    );
  });
});
