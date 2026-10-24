import { describe, expect, it } from 'bun:test';
import {
  describeFindingPlace,
  describeReportedFindings,
  readReportedFindings,
  SEVERITY_LABEL,
} from '@/lib/review/findings.ts';

describe('a finding’s place', () => {
  it('names the file and its line or line range, and nothing without a file', () => {
    expect(describeFindingPlace({ file: 'src/a.ts', line: 12, end: 20 })).toBe('src/a.ts:12-20');
    expect(describeFindingPlace({ file: 'src/a.ts', line: 12, end: 12 })).toBe('src/a.ts:12');
    expect(describeFindingPlace({ file: 'src/a.ts', line: 12 })).toBe('src/a.ts:12');
    expect(describeFindingPlace({ file: 'src/a.ts', line: null })).toBe('src/a.ts');
    expect(describeFindingPlace({ file: null, line: 3 })).toBeNull();
    expect(SEVERITY_LABEL.blocking).toBe('Blocking');
  });
});

describe('the findings a reviewer reported', () => {
  it('reads each finding from the tool call, a suggestion unless it says blocking', () => {
    expect(
      readReportedFindings({
        findings: [
          { severity: 'blocking', file: 'src/a.ts', line: 3, end: 5, message: 'Guard it.' },
          { severity: 'nit' },
        ],
      })
    ).toEqual([
      { severity: 'blocking', file: 'src/a.ts', line: 3, end: 5, message: 'Guard it.' },
      { severity: 'suggestion', file: null, line: null, end: null, message: '' },
    ]);
  });

  it('counts the findings and how many block', () => {
    const blocking = { severity: 'blocking' as const, file: null, line: null, message: 'A' };
    const suggestion = { severity: 'suggestion' as const, file: null, line: null, message: 'B' };
    expect(describeReportedFindings([])).toEqual({ title: 'Reported no findings', meta: null });
    expect(describeReportedFindings([blocking, suggestion])).toEqual({
      title: 'Reported 2 findings',
      meta: '1 blocking',
    });
    expect(describeReportedFindings([suggestion])).toEqual({
      title: 'Reported 1 finding',
      meta: 'Suggestions only',
    });
  });
});
