import { describe, expect, it } from 'bun:test';
import {
  describeFindingPlace,
  describeReportedFindings,
  listSeverityCounts,
  readReportedFindings,
  SEVERITY_ATTENTION,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  SEVERITY_VERDICT,
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

  it('ranks each level with what it means for you: its tone, the verdict it starts with and its attention', () => {
    expect(SEVERITY_LABEL).toEqual({ blocking: 'Blocking', should_fix: 'Should fix', optional: 'Optional' });
    expect(SEVERITY_TONE).toEqual({ blocking: 'red', should_fix: 'amber', optional: 'neutral' });
    expect(SEVERITY_VERDICT).toEqual({ blocking: 'fix', should_fix: 'fix', optional: 'dismiss' });
    expect(SEVERITY_ATTENTION).toEqual({ blocking: 'critical', should_fix: 'high', optional: 'normal' });
  });

  it('counts the findings of each level, most severe first, leaving out the empty ones', () => {
    const at = (severity: 'blocking' | 'should_fix' | 'optional') => ({ severity });
    expect(listSeverityCounts([])).toEqual([]);
    expect(listSeverityCounts([at('optional'), at('blocking'), at('optional'), at('should_fix')])).toEqual([
      '1 blocking',
      '1 should fix',
      '2 optional',
    ]);
    expect(listSeverityCounts([at('should_fix')])).toEqual(['1 should fix']);
  });
});

describe('the findings a reviewer reported', () => {
  it('reads each finding from the tool call, optional unless it names a level', () => {
    expect(
      readReportedFindings({
        findings: [
          {
            severity: 'blocking',
            file: 'src/a.ts',
            line: 3,
            end: 5,
            message: 'Guard it.',
            title: 'No guard',
            fix: 'Add `if`.',
          },
          { severity: 'should_fix' },
          { severity: 'nit' },
        ],
      })
    ).toEqual([
      {
        severity: 'blocking',
        file: 'src/a.ts',
        line: 3,
        end: 5,
        message: 'Guard it.',
        title: 'No guard',
        fix: 'Add `if`.',
      },
      { severity: 'should_fix', file: null, line: null, end: null, message: '' },
      { severity: 'optional', file: null, line: null, end: null, message: '' },
    ]);
  });

  it('counts the findings and how many there are of each level', () => {
    const blocking = { severity: 'blocking' as const, file: null, line: null, message: 'A' };
    const optional = { severity: 'optional' as const, file: null, line: null, message: 'B' };
    expect(describeReportedFindings([])).toEqual({ title: 'Reported no findings', meta: null });
    expect(describeReportedFindings([blocking, optional])).toEqual({
      title: 'Reported 2 findings',
      meta: '1 blocking, 1 optional',
    });
    expect(describeReportedFindings([optional])).toEqual({
      title: 'Reported 1 finding',
      meta: '1 optional',
    });
  });
});
