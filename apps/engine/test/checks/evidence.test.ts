import { describe, expect, test } from 'bun:test';
import { PROTOCOL_LIMITS } from '@shinsa/core';
import { serializeCheckEvidence } from '../../src/checks/evidence.ts';
import type { CheckRun } from '../../src/checks/index.ts';

function passed(name: string, output: string): CheckRun {
  return { check: { name, outcome: 'pass', detail: null }, output };
}

function failed(name: string, detail: string | null, output = ''): CheckRun {
  return { check: { name, outcome: 'fail', detail }, output };
}

const TESTS = `bun test v1.3.0

src/a.test.ts:
✓ a > works [4.12ms]

 1 pass
 0 fail
Ran 1 test across 1 file. [182.00ms]`;

describe('the evidence of a checks run', () => {
  test('lists every command with its outcome and output, the failures counted in the title', () => {
    const piece = serializeCheckEvidence(
      [passed('bun run lint', ''), failed('bun run test', 'expected 2, received 3', 'noise')],
      []
    );
    expect(piece).toEqual({
      title: 'Checks run by Shinsa: 1 of 2 failed',
      detail: "Shinsa ran these in the task's worktree after the agent's work.",
      text: '$ bun run lint\nPassed.\nNo output.\n\n$ bun run test\nFailed.\nexpected 2, received 3',
    });
    expect(serializeCheckEvidence([failed('false', null)], [])?.text).toBe('$ false\nFailed.');
  });

  test('says how many passed', () => {
    expect(serializeCheckEvidence([passed('true', '')], [])?.title).toBe('Checks run by Shinsa: 1 passed');
    expect(serializeCheckEvidence([passed('a', ''), passed('b', '')], [])?.title).toBe(
      'Checks run by Shinsa: all 2 passed'
    );
  });

  test('leaves out a command whose output an agent already attached, timings aside', () => {
    const attached = `$ bun test\n${TESTS.replace('[4.12ms]', '[3.80ms]').replace('[182.00ms]', '[201.00ms]')}`;
    const piece = serializeCheckEvidence(
      [passed('bun run test', TESTS), passed('bun run lint', 'ok')],
      [attached]
    );
    expect(piece?.title).toBe('Checks run by Shinsa: 1 passed');
    expect(piece?.text).toBe('$ bun run lint\nPassed.\nok');
    expect(piece?.detail).toBe(
      "Shinsa ran these in the task's worktree after the agent's work. Left out bun run test: an agent attached the same output."
    );
    expect(serializeCheckEvidence([passed('bun run test', TESTS)], [attached])).toBeNull();
    expect(serializeCheckEvidence([passed('bun run test', `${TESTS}\nextra`)], [attached])).not.toBeNull();
  });

  test('attaches nothing without a command, and keeps a long run within the evidence limit', () => {
    expect(serializeCheckEvidence([], [])).toBeNull();
    const runs = Array.from({ length: 12 }, (_, index) => failed(`check ${index}`, 'x'.repeat(4000)));
    const text = serializeCheckEvidence(runs, [])?.text ?? '';
    expect(text.length).toBe(PROTOCOL_LIMITS.evidenceText);
    expect(text.startsWith('…\n')).toBe(true);
    expect(text.endsWith('x')).toBe(true);
  });
});
