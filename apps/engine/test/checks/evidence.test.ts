import { describe, expect, test } from 'bun:test';
import { type CheckNote, PROTOCOL_LIMITS, type ReportCheck } from '@shinsa/core';
import { serializeCheckOutput } from '../../src/checks/evidence.ts';
import type { CheckRun } from '../../src/checks/index.ts';

function runOf(check: Partial<ReportCheck>, output = ''): CheckRun {
  return {
    check: {
      id: 'c1',
      label: 'Unit tests',
      command: 'bun test test/a',
      outcome: 'pass',
      detail: null,
      ...check,
    },
    output,
    timedOut: false,
    failedFiles: [],
    failures: [],
  };
}

describe('the output of one check run', () => {
  test('a pass shows the command, the outcome and the end of the output', () => {
    expect(serializeCheckOutput(runOf({}, ' 4 pass\n 0 fail '))).toBe(
      '$ bun test test/a\nPassed.\n4 pass\n 0 fail'
    );
    expect(serializeCheckOutput(runOf({}))).toBe('$ bun test test/a\nPassed.\nNo output.');
  });

  test('a failure shows its detail, and each note says what Shinsa found', () => {
    expect(serializeCheckOutput(runOf({ outcome: 'fail', detail: 'expected 2' }, 'noise'))).toBe(
      '$ bun test test/a\nFailed.\nexpected 2'
    );
    expect(serializeCheckOutput(runOf({ outcome: 'fail', detail: null }, 'noise'))).toBe(
      '$ bun test test/a\nFailed.\nnoise'
    );
    const notes: [CheckNote, ReportCheck['outcome'], string][] = [
      ['passed_alone', 'pass', 'Passed when the failing test files were re-run alone.'],
      ['fails_on_base', 'fail', 'Failed, and fails on the base commit too.'],
    ];
    for (const [note, outcome, line] of notes) {
      expect(serializeCheckOutput(runOf({ note, outcome, detail: 'why' }, 'out')).split('\n')[1]).toBe(line);
    }
  });

  test('very long output keeps its end within the evidence limit', () => {
    const text = serializeCheckOutput(runOf({ outcome: 'fail', detail: `${'x'.repeat(50_000)}END` }));
    expect(text.length).toBeLessThanOrEqual(PROTOCOL_LIMITS.evidenceText);
    expect(text.startsWith('…\n')).toBe(true);
    expect(text.endsWith('END')).toBe(true);
  });
});
