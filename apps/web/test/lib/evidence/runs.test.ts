import { describe, expect, it } from 'bun:test';
import { describeRunToggle, isRunEvidence, listEvidenceRuns } from '@/lib/evidence/runs.ts';

describe('the runs in test and check evidence', () => {
  it('reads a test run: its first line is the command, the counts its outcome', () => {
    const text = `bun test src/ui/tab-group.test.tsx
bun test v1.3.0

src/ui/tab-group.test.tsx:
✓ TabGroup > scrolls the active tab to the centre [4.12ms]

 2 pass
 0 fail
 6 expect() calls
Ran 2 tests across 1 file. [182.00ms]`;
    expect(listEvidenceRuns(text)).toEqual([
      { command: 'bun test src/ui/tab-group.test.tsx', outcome: 'pass', counts: '2 pass, 0 fail' },
    ]);
  });

  it('reads every command of a check run, its verdict first and its counts when the output has them', () => {
    const text = `$ bun run lint
Passed.
Checked 214 files in 412ms. No fixes applied.

$ bun run test
Passed.
 48 pass
 0 fail

$ bun run check-types
Failed.
src/a.ts(3,1): error TS2304`;
    expect(listEvidenceRuns(text)).toEqual([
      { command: 'bun run lint', outcome: 'pass', counts: null },
      { command: 'bun run test', outcome: 'pass', counts: '48 pass, 0 fail' },
      { command: 'bun run check-types', outcome: 'fail', counts: null },
    ]);
  });

  it('fails a run whose counts have a failure, reads summary counts, and leaves an unknown outcome unknown', () => {
    const text = `npx vitest
Tests  1 failed | 4 passed (5)

$ bun test
 3 pass
 1 fail

$ ./build.sh
Done.`;
    expect(listEvidenceRuns(text)).toEqual([
      { command: 'npx vitest', outcome: 'fail', counts: '4 pass, 1 fail' },
      { command: 'bun test', outcome: 'fail', counts: '3 pass, 1 fail' },
      { command: './build.sh', outcome: null, counts: null },
    ]);
    expect(listEvidenceRuns('\n\n')).toEqual([]);
  });

  it('knows which kinds are runs and names the output toggle', () => {
    expect(isRunEvidence('test')).toBe(true);
    expect(isRunEvidence('check')).toBe(true);
    expect(isRunEvidence('note')).toBe(false);
    expect(describeRunToggle(false)).toBe('Show the output');
    expect(describeRunToggle(true)).toBe('Hide the output');
  });
});
