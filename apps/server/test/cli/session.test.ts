import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { describeSession, readSession } from '../../src/cli/session.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

function line(value: unknown) {
  return JSON.stringify(value);
}

describe('readSession', () => {
  test('keeps the human requests and the last reply, skipping internals, sidechains and junk', () => {
    const dir = createTempDir();
    writeFiles(dir, {
      's.jsonl': [
        'not json',
        '',
        line({ type: 'user', isMeta: true, cwd: '/meta', message: { role: 'user', content: 'meta' } }),
        line({ type: 'user', cwd: '/code/app', message: { role: 'user', content: 'First ask' } }),
        line({ type: 'user', message: { role: 'user', content: '<system-reminder>x</system-reminder>' } }),
        line({ type: 'user', isSidechain: true, message: { role: 'user', content: 'sub' } }),
        line({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Working.' }, { type: 'tool_use' }] },
        }),
        line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Second ask' }] } }),
        line({ type: 'user', message: { role: 'user', content: { odd: true } } }),
        line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }),
      ].join('\n'),
    });
    expect(readSession(join(dir, 's.jsonl'), dir)).toEqual({
      path: join(dir, 's.jsonl'),
      cwd: '/code/app',
      firstRequest: 'First ask',
      laterRequests: ['Second ask'],
      lastReply: 'Done.',
    });
  });

  test('finds a session by id, and refuses a missing session, an id with a path or one without requests', () => {
    const projects = createTempDir();
    writeFiles(projects, {
      'proj/abc.jsonl': line({ type: 'user', message: { role: 'user', content: 'Hi' } }),
      'proj/empty.jsonl': line({ type: 'assistant', message: { content: 'x' } }),
    });
    expect(readSession('abc', projects).firstRequest).toBe('Hi');
    expect(() => readSession('missing', projects)).toThrow('No Claude Code session at missing.');
    expect(() => readSession('../proj/abc', projects)).toThrow('No Claude Code session');
    expect(() => readSession('abc', join(projects, 'none'))).toThrow('No Claude Code session');
    expect(() => readSession('empty', projects)).toThrow('has no user messages to import.');
  });
});

describe('describeSession', () => {
  test('quotes the first ask, the last six later ones and the ending, each clipped', () => {
    const text = describeSession({
      path: '/s.jsonl',
      cwd: null,
      firstRequest: 'x'.repeat(5000),
      laterRequests: ['1', '2', '3', '4', '5', '6', '7'],
      lastReply: 'Ended here.',
    });
    expect(text).toContain(`${'x'.repeat(4000)}…`);
    expect(text).toContain('Later requests, oldest first:\n- 2\n- 3\n- 4\n- 5\n- 6\n- 7');
    expect(text).toContain('Where the session ended:\nEnded here.');
    expect(text.endsWith('Full transcript: /s.jsonl')).toBe(true);
    const short = describeSession({
      path: '/s',
      cwd: null,
      firstRequest: 'Hi',
      laterRequests: [],
      lastReply: null,
    });
    expect(short).not.toContain('Later requests');
    expect(short).not.toContain('Where the session ended');
  });
});
