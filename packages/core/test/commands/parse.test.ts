import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  DomainError,
  parseUserCommand,
  SETTINGS_KEYS,
  USER_COMMAND_TYPES,
} from '../../src/index.ts';

describe('parseUserCommand', () => {
  test('accepts every user command and keeps only the fields it knows', () => {
    const accepted: [unknown, unknown][] = [
      [
        {
          type: 'repo.update',
          repoId: 'r1',
          patch: {
            name: 'app',
            defaultBranch: 'trunk',
            remote: null,
            projectId: 'p1',
            checkCommands: ['bun lint'],
          },
        },
        {
          type: 'repo.update',
          repoId: 'r1',
          patch: {
            name: 'app',
            defaultBranch: 'trunk',
            remote: null,
            projectId: 'p1',
            checkCommands: ['bun lint'],
          },
        },
      ],
      [
        { type: 'repo.remove', repoId: 'r1' },
        { type: 'repo.remove', repoId: 'r1' },
      ],
      [
        { type: 'project.write', project: { name: 'Acme', color: 'blue' } },
        { type: 'project.write', project: { name: 'Acme', color: 'blue' } },
      ],
      [
        {
          type: 'project.write',
          project: {
            id: 'p1',
            name: 'Acme',
            color: 'blue',
            key: 'AC',
            description: 'The Acme apps.',
            folders: ['/code/acme'],
          },
        },
        {
          type: 'project.write',
          project: {
            id: 'p1',
            name: 'Acme',
            color: 'blue',
            key: 'AC',
            description: 'The Acme apps.',
            folders: ['/code/acme'],
          },
        },
      ],
      [
        { type: 'project.remove', projectId: 'p1' },
        { type: 'project.remove', projectId: 'p1' },
      ],
      [
        { type: 'focus.change', projectId: 'p1', until: 5 },
        { type: 'focus.change', projectId: 'p1', until: 5 },
      ],
      [{ type: 'focus.change' }, { type: 'focus.change', projectId: null, until: null }],
      [
        { type: 'task.create', request: 'Fix it', projectId: 'p1' },
        { type: 'task.create', request: 'Fix it', repoId: null, projectId: 'p1' },
      ],
      [
        { type: 'task.create', request: 'Fix it', projectId: null },
        { type: 'task.create', request: 'Fix it', repoId: null, projectId: null },
      ],
      [
        {
          type: 'settings.change',
          patch: {
            defaultProvider: 'claude',
            defaultModel: null,
            maxFixRounds: null,
            mergeMethod: 'rebase',
            attentionLimit: 2,
            approvePlans: true,
            agentModels: { agent: 'sonnet' },
            agentProviders: { agent: 'codex' },
          },
        },
        {
          type: 'settings.change',
          patch: {
            defaultProvider: 'claude',
            defaultModel: null,
            maxFixRounds: null,
            mergeMethod: 'rebase',
            attentionLimit: 2,
            approvePlans: true,
            agentModels: { agent: 'sonnet' },
            agentProviders: { agent: 'codex' },
          },
        },
      ],
      [
        { type: 'settings.change', patch: { maxFixRounds: 3 } },
        { type: 'settings.change', patch: { maxFixRounds: 3 } },
      ],
      [
        { type: 'task.create', request: 'Fix it' },
        { type: 'task.create', request: 'Fix it', repoId: null },
      ],
      [
        {
          type: 'task.create',
          request: 'Fix it',
          repoId: 'r1',
          priority: 'urgent',
          planFirst: true,
          origin: '/code/app',
          waitsOn: ['t1'],
        },
        {
          type: 'task.create',
          request: 'Fix it',
          repoId: 'r1',
          priority: 'urgent',
          planFirst: true,
          origin: '/code/app',
          waitsOn: ['t1'],
        },
      ],
      [
        { type: 'task.prioritize', taskId: 't1', priority: 'low' },
        { type: 'task.prioritize', taskId: 't1', priority: 'low' },
      ],
      [
        { type: 'task.wait_on', taskId: 't1', waitsOn: [] },
        { type: 'task.wait_on', taskId: 't1', waitsOn: [] },
      ],
      [
        { type: 'task.cancel', taskId: 't1' },
        { type: 'task.cancel', taskId: 't1' },
      ],
      [
        { type: 'task.complete', taskId: 't1' },
        { type: 'task.complete', taskId: 't1' },
      ],
      [
        { type: 'task.retry', taskId: 't1' },
        { type: 'task.retry', taskId: 't1' },
      ],
      [
        { type: 'task.retry', taskId: 't1', account: { id: 'acc-1', email: 'a@b.com' } },
        { type: 'task.retry', taskId: 't1', account: { id: 'acc-1', email: 'a@b.com' } },
      ],
      [
        { type: 'task.message', taskId: 't1', text: 'Use tabs' },
        { type: 'task.message', taskId: 't1', text: 'Use tabs' },
      ],
      [
        {
          type: 'task.message',
          taskId: 't1',
          text: 'Add search',
          kind: 'new_round',
          title: 'Search',
          why: 'New work.',
          shape: 'change',
        },
        {
          type: 'task.message',
          taskId: 't1',
          text: 'Add search',
          kind: 'new_round',
          title: 'Search',
          why: 'New work.',
          shape: 'change',
        },
      ],
      [
        { type: 'round.ship', taskId: 't1', number: 2, shipping: 'stacked' },
        { type: 'round.ship', taskId: 't1', number: 2, shipping: 'stacked' },
      ],
      [
        { type: 'round.update', taskId: 't1', number: 2, request: 'Add search' },
        { type: 'round.update', taskId: 't1', number: 2, request: 'Add search' },
      ],
      [
        { type: 'round.remove', taskId: 't1', number: 2 },
        { type: 'round.remove', taskId: 't1', number: 2 },
      ],
      [
        { type: 'round.send', taskId: 't1', number: 2 },
        { type: 'round.send', taskId: 't1', number: 2 },
      ],
      [
        { type: 'merge_step.tick', taskId: 't1', key: 'pre_merge:Set API_KEY', done: true },
        { type: 'merge_step.tick', taskId: 't1', key: 'pre_merge:Set API_KEY', done: true },
      ],
      [
        { type: 'suggestion.keep', taskId: 't1', suggestionId: 's1' },
        { type: 'suggestion.keep', taskId: 't1', suggestionId: 's1' },
      ],
      [
        { type: 'suggestion.keep', taskId: 't1', suggestionId: 's1', shape: 'research' },
        { type: 'suggestion.keep', taskId: 't1', suggestionId: 's1', shape: 'research' },
      ],
      [
        { type: 'gate.answer', gateId: 'g1', decision: 'approve' },
        { type: 'gate.answer', gateId: 'g1', decision: 'approve', response: null },
      ],
    ];
    for (const [input, output] of accepted) expect(parseUserCommand(input)).toEqual(output as never);
  });

  test('refuses a malformed command with a message saying what is wrong', () => {
    const refused: [unknown, string][] = [
      [null, 'A command must be an object.'],
      [[], 'A command must be an object.'],
      [{ type: 'run.end' }, 'Unknown command.'],
      [{ type: 'task.create', request: 4 }, 'request must be text.'],
      [{ type: 'merge_step.tick', taskId: 't1', key: 'x', done: 'yes' }, 'done must be true or false.'],
      [
        { type: 'merge_step.tick', taskId: 't1', key: 'x'.repeat(121), done: true },
        'key is longer than 120 characters.',
      ],
      [{ type: 'task.create', request: 'x'.repeat(200_001) }, 'request is longer than 200000 characters.'],
      [
        { type: 'task.create', request: 'x', priority: 'now' },
        'priority must be one of urgent, high, normal, low.',
      ],
      [{ type: 'task.create', request: 'x', planFirst: 'yes' }, 'planFirst must be true or false.'],
      [{ type: 'task.create', request: 'x', origin: 3 }, 'origin must be text.'],
      [{ type: 'task.create', request: 'x', waitsOn: 't1' }, 'waitsOn must be a list.'],
      [
        { type: 'task.create', request: 'x', waitsOn: Array(501).fill('t') },
        'waitsOn has more than 500 entries.',
      ],
      [{ type: 'task.create', request: 'x', waitsOn: [''] }, 'waitsOn must not be empty.'],
      [{ type: 'task.cancel' }, 'taskId must be text.'],
      [{ type: 'repo.update', repoId: 'r1', patch: [] }, 'patch must be an object.'],
      [
        { type: 'repo.update', repoId: 'r1', patch: { path: '/x' } },
        'A repository update cannot change path.',
      ],
      [{ type: 'repo.update', repoId: 'r1', patch: { checkCommands: [1] } }, 'checkCommands must be text.'],
      [{ type: 'repo.update', repoId: 'r1', patch: { coverage: 'off' } }, 'coverage must be an object.'],
      [
        { type: 'repo.update', repoId: 'r1', patch: { coverage: { mode: 'sometimes' } } },
        'mode must be one of auto, custom, off.',
      ],
      [
        { type: 'repo.update', repoId: 'r1', patch: { coverage: { mode: 'off', command: 'x' } } },
        'Coverage set to auto or off cannot change command.',
      ],
      [
        {
          type: 'repo.update',
          repoId: 'r1',
          patch: { coverage: { mode: 'custom', command: ' ', report: 'a.info' } },
        },
        'command must not be empty.',
      ],
      ...['/abs/lcov.info', 'C:/lcov.info', '../lcov.info', 'a/../../lcov.info', ' ', 'a\0.info'].map(
        (report): [unknown, string] => [
          {
            type: 'repo.update',
            repoId: 'r1',
            patch: { coverage: { mode: 'custom', command: 'x', report } },
          },
          'report must be a path inside the repository, such as coverage/lcov.info.',
        ]
      ),
      [
        {
          type: 'repo.update',
          repoId: 'r1',
          patch: { coverage: { mode: 'custom', command: 'x', report: 'cov/data', format: null } },
        },
        'Shinsa cannot tell the format of cov/data from its name. Give format: lcov, cobertura or go.',
      ],
      [
        {
          type: 'repo.update',
          repoId: 'r1',
          patch: { coverage: { mode: 'custom', command: 'x', report: 'a.info', format: 'json', extra: 1 } },
        },
        'Custom coverage cannot change extra.',
      ],
      [{ type: 'repo.register', repo: {}, projectName: null }, 'Unknown command.'],
      [{ type: 'area.write', area: { name: 'Acme', color: 'blue' } }, 'Unknown command.'],
      [{ type: 'project.write', project: { name: 'Acme', color: 3 } }, 'color must be text.'],
      [
        { type: 'project.write', project: { name: 'Acme', color: 'blue', owner: 'me' } },
        'A project cannot change owner.',
      ],
      [
        { type: 'project.write', project: { name: 'Acme', color: 'blue', folders: '/code' } },
        'folders must be a list.',
      ],
      [{ type: 'focus.change', projectId: null, until: 'soon' }, 'until must be a time.'],
      [{ type: 'task.create', request: 'x', projectId: 4 }, 'projectId must be text.'],
      [{ type: 'settings.change', patch: { tasks: {} } }, 'Settings cannot change tasks.'],
      [
        { type: 'settings.change', patch: { worktreesDirectory: '~/wt' } },
        'Settings cannot change worktreesDirectory.',
      ],
      [
        { type: 'settings.change', patch: { mergeMethod: 'yolo' } },
        'mergeMethod must be one of squash, merge, rebase.',
      ],
      [{ type: 'settings.change', patch: { attentionLimit: 1.5 } }, 'attentionLimit must be a whole number.'],
      [
        { type: 'settings.change', patch: { agentModels: { boss: 'opus' } } },
        'agentModels has no role boss.',
      ],
      [
        { type: 'settings.change', patch: { agentProviders: { boss: 'codex' } } },
        'agentProviders has no role boss.',
      ],
      [
        { type: 'gate.answer', gateId: 'g1', decision: 'maybe' },
        'decision must be one of approve, revise, reject, reply.',
      ],
    ];
    for (const [input, message] of refused) {
      expect(() => parseUserCommand(input)).toThrow(message);
    }
    expect(() => parseUserCommand({ type: 'task.cancel' })).toThrow(DomainError);
  });

  test('never carries prototype keys into the command', () => {
    const parsed = parseUserCommand(JSON.parse('{"type":"task.cancel","taskId":"t1","__proto__":{"x":1}}'));
    expect(Object.keys(parsed)).toEqual(['type', 'taskId']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('parseUserCommand for the process commands', () => {
  test('a new task takes no shape: only triage and the agent shape a task', () => {
    expect(
      parseUserCommand({ type: 'task.create', request: 'Why?', repoId: null, shape: 'investigate' })
    ).toEqual({ type: 'task.create', request: 'Why?', repoId: null });
  });

  test('reads plan versions, verdicts, modes, suggestions, monitors, silence and the cost limit', () => {
    expect(
      parseUserCommand({
        type: 'gate.answer',
        gateId: 'g',
        decision: 'revise',
        response: null,
        planVersion: 2,
        verdicts: [
          { index: 0, verdict: 'dismiss', note: 'Intended.' },
          { index: 1, verdict: 'fix' },
        ],
      })
    ).toEqual({
      type: 'gate.answer',
      gateId: 'g',
      decision: 'revise',
      response: null,
      planVersion: 2,
      verdicts: [
        { index: 0, verdict: 'dismiss', note: 'Intended.' },
        { index: 1, verdict: 'fix', note: null },
      ],
    });
    expect(parseUserCommand({ type: 'task.create', request: 'How?', repoId: null, mode: 'ask' })).toEqual({
      type: 'task.create',
      request: 'How?',
      repoId: null,
      mode: 'ask',
    });
    expect(() => parseUserCommand({ type: 'task.reshape', taskId: 't', shape: 'fix' })).toThrow(DomainError);
    expect(
      parseUserCommand({ type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: true })
    ).toEqual({ type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: true });
    expect(parseUserCommand({ type: 'suggestion.dismiss', taskId: 't', suggestionId: 's' })).toEqual({
      type: 'suggestion.dismiss',
      taskId: 't',
      suggestionId: 's',
    });
    expect(parseUserCommand({ type: 'monitor.check_in_now', taskId: 't' })).toEqual({
      type: 'monitor.check_in_now',
      taskId: 't',
    });
    expect(parseUserCommand({ type: 'run.snooze_silence', runId: 'r', until: 5 })).toEqual({
      type: 'run.snooze_silence',
      runId: 'r',
      until: 5,
    });
    expect(parseUserCommand({ type: 'run.dismiss_silence', runId: 'r' })).toEqual({
      type: 'run.dismiss_silence',
      runId: 'r',
    });
    expect(parseUserCommand({ type: 'settings.change', patch: { taskBudgetUsd: 25 } })).toEqual({
      type: 'settings.change',
      patch: { taskBudgetUsd: 25 },
    });
    expect(parseUserCommand({ type: 'settings.change', patch: { taskBudgetUsd: null } })).toEqual({
      type: 'settings.change',
      patch: { taskBudgetUsd: null },
    });
    expect(parseUserCommand({ type: 'repo.update', repoId: 'r', patch: { workspace: 'worktrees' } })).toEqual(
      {
        type: 'repo.update',
        repoId: 'r',
        patch: { workspace: 'worktrees' },
      }
    );
    expect(
      parseUserCommand({
        type: 'repo.update',
        repoId: 'r',
        patch: {
          coverage: { mode: 'custom', command: ' make cover ', report: 'out/cover.data', format: 'go' },
        },
      })
    ).toEqual({
      type: 'repo.update',
      repoId: 'r',
      patch: { coverage: { mode: 'custom', command: 'make cover', report: 'out/cover.data', format: 'go' } },
    });
    expect(
      parseUserCommand({
        type: 'repo.update',
        repoId: 'r',
        patch: { coverage: { mode: 'custom', command: 'npm run cover', report: 'coverage/lcov.info' } },
      })
    ).toMatchObject({ patch: { coverage: { format: null } } });
    expect(
      parseUserCommand({ type: 'repo.update', repoId: 'r', patch: { coverage: { mode: 'auto' } } })
    ).toEqual({ type: 'repo.update', repoId: 'r', patch: { coverage: { mode: 'auto' } } });
    expect(
      parseUserCommand({ type: 'settings.change', patch: { agentModels: { answerer: 'sonnet' } } })
    ).toEqual({ type: 'settings.change', patch: { agentModels: { answerer: 'sonnet' } } });
  });

  test('reads fast mode per role as true or false for a known role, and refuses anything else', () => {
    expect(
      parseUserCommand({
        type: 'settings.change',
        patch: { fastMode: false, agentFastModes: { agent: true, classifier: false } },
      })
    ).toEqual({
      type: 'settings.change',
      patch: { fastMode: false, agentFastModes: { agent: true, classifier: false } },
    });
    const refused: [unknown, string][] = [
      [
        { type: 'settings.change', patch: { agentFastModes: { boss: true } } },
        'agentFastModes has no role boss.',
      ],
      [
        { type: 'settings.change', patch: { agentFastModes: { agent: 'yes' } } },
        'agent must be true or false.',
      ],
      [{ type: 'settings.change', patch: { agentFastModes: true } }, 'agentFastModes must be an object.'],
      [{ type: 'settings.change', patch: { agentFastModes: null } }, 'agentFastModes must be an object.'],
    ];
    for (const [input, message] of refused) {
      expect(() => parseUserCommand(input)).toThrow(message);
    }
  });

  test('refuses malformed process commands', () => {
    const refused: [unknown, string][] = [
      [
        { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null, planVersion: 0 },
        'planVersion must be a whole number of 1 or more.',
      ],
      [
        { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null, verdicts: 'x' },
        'verdicts must be a list.',
      ],
      [
        {
          type: 'gate.answer',
          gateId: 'g',
          decision: 'approve',
          response: null,
          verdicts: Array.from({ length: 51 }, () => ({ index: 0, verdict: 'fix' })),
        },
        'verdicts has more than 50 entries.',
      ],
      [
        {
          type: 'gate.answer',
          gateId: 'g',
          decision: 'approve',
          response: null,
          verdicts: [{ index: -1, verdict: 'fix' }],
        },
        'index must be a whole number of 0 or more.',
      ],
      [
        {
          type: 'gate.answer',
          gateId: 'g',
          decision: 'approve',
          response: null,
          verdicts: [{ index: 0, verdict: 'maybe' }],
        },
        'verdict must be one of fix, dismiss.',
      ],
      [
        {
          type: 'gate.answer',
          gateId: 'g',
          decision: 'approve',
          response: null,
          verdicts: [{ index: 0, verdict: 'fix', why: 1 }],
        },
        'A verdict cannot change why.',
      ],
      [{ type: 'task.create', request: 'x', repoId: null, mode: 'chat' }, 'mode must be one of build, ask.'],
      [{ type: 'suggestion.accept', taskId: 't', suggestionId: 's' }, 'waitsOnThis must be true or false.'],
      [{ type: 'run.snooze_silence', runId: 'r' }, 'until must be a time.'],
      [{ type: 'settings.change', patch: { taskBudgetUsd: '5' } }, 'taskBudgetUsd must be a number.'],
    ];
    for (const [body, message] of refused) {
      expect(() => parseUserCommand(body)).toThrow(new DomainError('command_invalid', message));
    }
  });
});

describe('parseUserCommand for line comments', () => {
  const answer = { type: 'gate.answer', gateId: 'g', decision: 'revise', response: null } as const;

  test('reads each comment with its side, lines and words', () => {
    expect(
      parseUserCommand({
        ...answer,
        comments: [
          { path: 'src/a.ts', side: 'new', line: 3, endLine: 4, text: 'Name it.' },
          { path: 'src/b.ts', side: 'old', line: 9, text: 'Keep it.' },
        ],
      })
    ).toEqual({
      ...answer,
      comments: [
        { path: 'src/a.ts', side: 'new', line: 3, endLine: 4, text: 'Name it.' },
        { path: 'src/b.ts', side: 'old', line: 9, endLine: null, text: 'Keep it.' },
      ],
    });
  });

  test('refuses a malformed comment with a message saying what is wrong', () => {
    const comment = { path: 'a.ts', side: 'new', line: 1, text: 'x' };
    const refused: [unknown, string][] = [
      [{ ...answer, comments: 'x' }, 'comments must be a list.'],
      [
        { ...answer, comments: Array.from({ length: 101 }, () => comment) },
        'comments has more than 100 entries.',
      ],
      [{ ...answer, comments: [{ ...comment, side: 'left' }] }, 'side must be one of old, new.'],
      [{ ...answer, comments: [{ ...comment, line: 0 }] }, 'line must be a whole number of 1 or more.'],
      [{ ...answer, comments: [{ ...comment, path: '' }] }, 'path must not be empty.'],
      [
        { ...answer, comments: [{ ...comment, path: 'a'.repeat(1_025) }] },
        'path is longer than 1024 characters.',
      ],
      [{ ...answer, comments: [{ ...comment, author: 'me' }] }, 'A comment cannot change author.'],
      [{ ...answer, comments: [{ ...comment, suggestion: 'x' }] }, 'A comment cannot change suggestion.'],
    ];
    for (const [input, message] of refused) {
      expect(() => parseUserCommand(input)).toThrow(message);
    }
  });
});

describe('parseUserCommand for accounts and usage limits', () => {
  test('reads account bindings, usage waits, the account of a new task and the limit settings', () => {
    expect(
      parseUserCommand({
        type: 'task.bind_account',
        taskId: 't1',
        account: { id: 'acc-1', email: 'a@b.com' },
        extra: true,
      })
    ).toEqual({ type: 'task.bind_account', taskId: 't1', account: { id: 'acc-1', email: 'a@b.com' } });
    expect(parseUserCommand({ type: 'task.bind_account', taskId: 't1', account: null })).toEqual({
      type: 'task.bind_account',
      taskId: 't1',
      account: null,
    });
    expect(parseUserCommand({ type: 'task.bind_account', taskId: 't1', account: { id: 'acc-1' } })).toEqual({
      type: 'task.bind_account',
      taskId: 't1',
      account: { id: 'acc-1', email: null },
    });
    expect(parseUserCommand({ type: 'usage_wait.change', taskId: 't1', autoResume: false })).toEqual({
      type: 'usage_wait.change',
      taskId: 't1',
      autoResume: false,
    });
    expect(parseUserCommand({ type: 'usage_wait.resume_now', taskId: 't1' })).toEqual({
      type: 'usage_wait.resume_now',
      taskId: 't1',
    });
    expect(
      parseUserCommand({ type: 'task.create', request: 'x', repoId: null, account: { id: 'a', email: null } })
    ).toEqual({ type: 'task.create', request: 'x', repoId: null, account: { id: 'a', email: null } });
    expect(
      parseUserCommand({
        type: 'settings.change',
        patch: { autoResume: false, snoozeLimited: true, accountSwitchAt: 95 },
      })
    ).toEqual({
      type: 'settings.change',
      patch: { autoResume: false, snoozeLimited: true, accountSwitchAt: 95 },
    });
  });

  test('refuses a malformed account, wait or limit with a message saying what is wrong', () => {
    const refused: [unknown, string][] = [
      [{ type: 'task.bind_account', taskId: 't1' }, 'account must be an object.'],
      [{ type: 'task.bind_account', taskId: 't1', account: 'acc-1' }, 'account must be an object.'],
      [{ type: 'task.bind_account', taskId: 't1', account: { id: '' } }, 'id must not be empty.'],
      [{ type: 'task.retry', taskId: 't1', account: null }, 'account must name an account.'],
      [{ type: 'task.retry', taskId: 't1', account: 'acc-1' }, 'account must be an object.'],
      [
        { type: 'task.bind_account', taskId: 't1', account: { id: 'a', plan: 'max' } },
        'An account cannot change plan.',
      ],
      [{ type: 'usage_wait.change', taskId: 't1', autoResume: 'yes' }, 'autoResume must be true or false.'],
      [{ type: 'usage_wait.resume_now' }, 'taskId must be text.'],
      [
        { type: 'settings.change', patch: { accountSwitchAt: 90.5 } },
        'accountSwitchAt must be a whole number.',
      ],
      [{ type: 'settings.change', patch: { snoozeLimited: 1 } }, 'snoozeLimited must be true or false.'],
    ];
    for (const [body, message] of refused) expect(() => parseUserCommand(body)).toThrow(message);
  });
});

describe('stopping a delegated task from the task page', () => {
  test('takes the delegated run’s id and nothing else', () => {
    expect(parseUserCommand({ type: 'delegation.cancel', runId: 'r1', extra: true })).toEqual({
      type: 'delegation.cancel',
      runId: 'r1',
    });
    expect(() => parseUserCommand({ type: 'delegation.cancel', runId: '' })).toThrow(
      'runId must not be empty.'
    );
  });
});

describe('schedules and idle compaction from Settings', () => {
  test('pausing, resuming and removing a schedule take its id and nothing else', () => {
    expect(parseUserCommand({ type: 'schedule.enable', scheduleId: 's1', enabled: false, extra: 1 })).toEqual(
      {
        type: 'schedule.enable',
        scheduleId: 's1',
        enabled: false,
      }
    );
    expect(parseUserCommand({ type: 'schedule.remove', scheduleId: 's1' })).toEqual({
      type: 'schedule.remove',
      scheduleId: 's1',
    });
    expect(() => parseUserCommand({ type: 'schedule.enable', scheduleId: 's1', enabled: 'no' })).toThrow(
      'enabled must be true or false.'
    );
    expect(() => parseUserCommand({ type: 'schedule.remove', scheduleId: '' })).toThrow(
      'scheduleId must not be empty.'
    );
  });

  test('takes the idle compaction switch and its lead time', () => {
    expect(
      parseUserCommand({
        type: 'settings.change',
        patch: { idleCompaction: false, compactionLeadMinutes: 3 },
      })
    ).toEqual({ type: 'settings.change', patch: { idleCompaction: false, compactionLeadMinutes: 3 } });
    expect(() =>
      parseUserCommand({ type: 'settings.change', patch: { compactionLeadMinutes: '3' } })
    ).toThrow('compactionLeadMinutes must be a whole number.');
  });

  test('takes the compaction choice and the fast mode switch, and refuses anything else', () => {
    expect(
      parseUserCommand({ type: 'settings.change', patch: { compaction: 'eunoe_default', fastMode: false } })
    ).toEqual({ type: 'settings.change', patch: { compaction: 'eunoe_default', fastMode: false } });
    expect(() => parseUserCommand({ type: 'settings.change', patch: { compaction: 'summary' } })).toThrow(
      'compaction must be one of eunoe_compact, eunoe_default, claude, off.'
    );
    expect(() => parseUserCommand({ type: 'settings.change', patch: { fastMode: 'on' } })).toThrow(
      'fastMode must be true or false.'
    );
  });
});

describe('writing a schedule from Settings', () => {
  const base = { type: 'schedule.write', timeZone: 'Europe/Berlin' };

  function parsed(fields: Record<string, unknown>) {
    return parseUserCommand({ ...base, ...fields }) as CommandOf<'schedule.write'>;
  }

  test('reads every field and leaves the ones not given empty', () => {
    expect(parsed({ extra: 1 })).toEqual({
      type: 'schedule.write',
      scheduleId: null,
      name: null,
      text: null,
      trigger: null,
      target: null,
      enabled: null,
      maxRuns: null,
      timeZone: 'Europe/Berlin',
    });
    expect(
      parsed({
        scheduleId: 's1',
        name: 'Nightly',
        text: 'Check the build.',
        trigger: null,
        target: null,
        enabled: false,
        maxRuns: 3,
      })
    ).toMatchObject({
      scheduleId: 's1',
      name: 'Nightly',
      text: 'Check the build.',
      enabled: false,
      maxRuns: 3,
    });
    expect(parsed({ enabled: null, maxRuns: null })).toMatchObject({ enabled: null, maxRuns: null });
  });

  test('reads each kind of trigger', () => {
    expect(parsed({ trigger: { kind: 'once', at: 5_000 } }).trigger).toEqual({ kind: 'once', at: 5_000 });
    expect(parsed({ trigger: { kind: 'interval', everyMinutes: 30 } }).trigger).toEqual({
      kind: 'interval',
      everyMinutes: 30,
    });
    expect(parsed({ trigger: { kind: 'daily', time: '09:00', weekdays: [1, 5] } }).trigger).toEqual({
      kind: 'daily',
      time: '09:00',
      weekdays: [1, 5],
    });
    expect(parsed({ trigger: { kind: 'webhook' } }).trigger).toEqual({
      kind: 'webhook',
      signature: null,
      replayKey: null,
    });
    expect(
      parsed({
        trigger: {
          kind: 'webhook',
          signature: { header: 'x-hub-signature-256', encoding: 'base64', prefix: 'sha256=' },
          replayKey: '{{headers.x-github-delivery}}',
        },
      }).trigger
    ).toEqual({
      kind: 'webhook',
      signature: { header: 'x-hub-signature-256', encoding: 'base64', prefix: 'sha256=' },
      replayKey: '{{headers.x-github-delivery}}',
    });
  });

  test('a signature without an encoding or prefix is hex with no prefix', () => {
    expect(parsed({ trigger: { kind: 'webhook', signature: { header: 'x-sig' } } }).trigger).toEqual({
      kind: 'webhook',
      signature: { header: 'x-sig', encoding: 'hex', prefix: '' },
      replayKey: null,
    });
    expect(
      parsed({ trigger: { kind: 'webhook', signature: { header: 'x-sig', prefix: null } } }).trigger
    ).toMatchObject({ signature: { prefix: '' } });
  });

  test('reads each kind of target, and a new task is a normal build without a repository by default', () => {
    expect(parsed({ target: { kind: 'task', taskId: 't1', priority: 'high' } }).target).toEqual({
      kind: 'task',
      taskId: 't1',
    });
    expect(parsed({ target: { kind: 'new_task' } }).target).toEqual({
      kind: 'new_task',
      repoId: null,
      priority: 'normal',
      mode: 'build',
    });
    expect(
      parsed({ target: { kind: 'new_task', repoId: 'r1', priority: 'urgent', mode: 'ask' } }).target
    ).toEqual({ kind: 'new_task', repoId: 'r1', priority: 'urgent', mode: 'ask' });
  });

  test.each<[string, Record<string, unknown>, string]>([
    ['no time zone', { timeZone: undefined }, 'timeZone must be text.'],
    ['a trigger that is not an object', { trigger: 'daily' }, 'trigger must be an object.'],
    [
      'an unknown trigger kind',
      { trigger: { kind: 'cron' } },
      'kind must be one of once, interval, daily, webhook.',
    ],
    ['a one-off without a time', { trigger: { kind: 'once' } }, 'at must be a time.'],
    [
      'a one-off at a time that is not a number',
      { trigger: { kind: 'once', at: 'soon' } },
      'at must be a time.',
    ],
    [
      'an interval of zero',
      { trigger: { kind: 'interval', everyMinutes: 0 } },
      'everyMinutes must be a whole number of 1 or more.',
    ],
    [
      'a daily time that is empty',
      { trigger: { kind: 'daily', time: '', weekdays: [] } },
      'time must not be empty.',
    ],
    [
      'weekdays that are not a list',
      { trigger: { kind: 'daily', time: '09:00', weekdays: 1 } },
      'weekdays must be a list of up to 7 days.',
    ],
    [
      'more than seven weekdays',
      { trigger: { kind: 'daily', time: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6, 0] } },
      'weekdays must be a list of up to 7 days.',
    ],
    [
      'a weekday in fractions',
      { trigger: { kind: 'daily', time: '09:00', weekdays: [1.5] } },
      'day must be a whole number.',
    ],
    [
      'a signature that is not an object',
      { trigger: { kind: 'webhook', signature: 'x' } },
      'signature must be an object.',
    ],
    [
      'a signature with other fields',
      { trigger: { kind: 'webhook', signature: { header: 'x', secret: 's' } } },
      'A signature cannot change secret.',
    ],
    [
      'an unknown signature encoding',
      { trigger: { kind: 'webhook', signature: { header: 'x', encoding: 'utf8' } } },
      'encoding must be one of hex, base64.',
    ],
    [
      'a replay key that is not text',
      { trigger: { kind: 'webhook', replayKey: 3 } },
      'replayKey must be text.',
    ],
    ['a target that is not an object', { target: [] }, 'target must be an object.'],
    ['an unknown target kind', { target: { kind: 'repo' } }, 'kind must be one of new_task, task.'],
    ['a task target without a task', { target: { kind: 'task' } }, 'taskId must be text.'],
    [
      'a new task of an unknown priority',
      { target: { kind: 'new_task', priority: 'asap' } },
      'priority must be one of',
    ],
    [
      'a new task of an unknown mode',
      { target: { kind: 'new_task', mode: 'plan' } },
      'mode must be one of build, ask.',
    ],
    ['an enabled flag that is not true or false', { enabled: 'yes' }, 'enabled must be true or false.'],
    ['a run limit of zero', { maxRuns: 0 }, 'maxRuns must be a whole number of 1 or more.'],
    ['a name past the limit', { name: 'x'.repeat(201) }, 'name is longer than 200 characters.'],
  ])('refuses %s', (_name, fields, message) => {
    expect(() => parsed(fields)).toThrow(message);
  });
});

describe('memory commands', () => {
  test('reads a rule to write, with or without its id and project', () => {
    expect(parseUserCommand({ type: 'memory.write', text: 'Keep plans short.' })).toEqual({
      type: 'memory.write',
      memoryId: null,
      projectId: null,
      text: 'Keep plans short.',
    });
    expect(
      parseUserCommand({ type: 'memory.write', memoryId: 'm1', projectId: 'p1', text: 'Use bun.' })
    ).toEqual({ type: 'memory.write', memoryId: 'm1', projectId: 'p1', text: 'Use bun.' });
  });

  test('reads keeping and removing a rule by its id', () => {
    expect(parseUserCommand({ type: 'memory.accept', memoryId: 'm1' })).toEqual({
      type: 'memory.accept',
      memoryId: 'm1',
    });
    expect(parseUserCommand({ type: 'memory.remove', memoryId: 'm1' })).toEqual({
      type: 'memory.remove',
      memoryId: 'm1',
    });
    expect(() => parseUserCommand({ type: 'memory.write', text: 3 })).toThrow('text must be text.');
  });
});

describe('the command and settings catalog', () => {
  test('names every user command the parser reads', () => {
    expect(USER_COMMAND_TYPES).toContain('schedule.write');
    expect(USER_COMMAND_TYPES).toContain('task.create');
    for (const type of USER_COMMAND_TYPES) {
      try {
        parseUserCommand({ type });
      } catch (error) {
        expect(error instanceof DomainError && error.code).toBe('command_invalid');
      }
    }
    expect(() => parseUserCommand({ type: 'task.triage' })).toThrow('Unknown command.');
  });

  test('names every setting a change may carry', () => {
    expect(SETTINGS_KEYS).toContain('maxFixRounds');
    for (const key of SETTINGS_KEYS) {
      expect(() => parseUserCommand({ type: 'settings.change', patch: { [key]: Symbol.iterator } })).toThrow(
        DomainError
      );
    }
    expect(() => parseUserCommand({ type: 'settings.change', patch: { worktreesDir: '/tmp' } })).toThrow(
      'Settings cannot change worktreesDir.'
    );
  });
});
