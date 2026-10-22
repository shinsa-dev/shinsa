import { describe, expect, test } from 'bun:test';
import {
  PROTOCOL_LIMITS,
  type Validation,
  validateFindings,
  validateFixHandOver,
  validatePhaseHandOver,
  validateSpecDocument,
  validateWorkReport,
} from '../../src/index.ts';

function errorsOf<T>(result: Validation<T>) {
  return result.ok ? [] : result.errors;
}

function readValue<T>(result: Validation<T>) {
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.value;
}

const SPOT = {
  file: 'src/a.ts',
  start: 3,
  end: 5,
  attention: 'critical' as const,
  why: 'The judgement call.',
};

describe('validatePhaseHandOver', () => {
  test('keeps a valid hand-over, trimmed, with an end line defaulting to the start', () => {
    const value = readValue(
      validatePhaseHandOver({
        summary: '  Split the parser.  ',
        spots: [{ ...SPOT, end: undefined }],
        decisions: [{ decision: 'Kept the cache', reason: 'It is hot.', file: '', line: null }],
      })
    );
    expect(value).toEqual({
      summary: 'Split the parser.',
      spots: [{ ...SPOT, end: 3 }],
      decisions: [{ decision: 'Kept the cache', reason: 'It is hot.', file: null, line: null }],
    });
  });

  test('spots and decisions are optional', () => {
    expect(readValue(validatePhaseHandOver({ summary: 'Done.' }))).toEqual({
      summary: 'Done.',
      spots: [],
      decisions: [],
    });
  });

  test('names every field that breaks the protocol', () => {
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: ' ',
          spots: [
            { file: 'a.ts', start: 0, attention: 'loud', why: 'x' },
            { file: 'a.ts', start: 9, end: 2, attention: 'high', why: 'x' },
            'not a spot',
          ],
          decisions: { decision: 'x' },
        })
      )
    ).toEqual([
      'summary is required.',
      'spots[0].start must be a line number (1 or more).',
      'spots[0].attention must be one of critical, high, normal.',
      'spots[1].end comes before spots[1].start.',
      'spots[2] must be an object.',
      'spots[2].start must be a line number (1 or more).',
      'spots[2].file is required.',
      'spots[2].attention must be one of critical, high, normal.',
      'spots[2].why is required.',
      'decisions must be a list.',
    ]);
  });

  test('caps lists and lengths at the published limits', () => {
    const errors = errorsOf(
      validatePhaseHandOver({
        summary: 'x'.repeat(PROTOCOL_LIMITS.phaseSummary + 1),
        spots: Array.from({ length: PROTOCOL_LIMITS.spots + 1 }, () => SPOT),
      })
    );
    expect(errors).toEqual([
      `summary is ${PROTOCOL_LIMITS.phaseSummary + 1} characters; the limit is ${PROTOCOL_LIMITS.phaseSummary}.`,
      `spots has ${PROTOCOL_LIMITS.spots + 1} items; the limit is ${PROTOCOL_LIMITS.spots}.`,
    ]);
  });
});

describe('validateFixHandOver', () => {
  test('needs a summary', () => {
    expect(readValue(validateFixHandOver({ summary: 'Fixed CI.' }))).toEqual({ summary: 'Fixed CI.' });
    expect(errorsOf(validateFixHandOver({}))).toEqual(['summary is required.']);
  });
});

describe('validateWorkReport', () => {
  test('a report over the limits is rejected with every reason', () => {
    expect(
      errorsOf(
        validateWorkReport({
          headline: 'x'.repeat(200),
          phases: [{ title: 'Phase', summary: 'Summary', spots: [] }],
        })
      )
    ).toEqual(['phases[0].spots needs at least 1 item.', 'headline is 200 characters; the limit is 100.']);
  });

  test('keeps phases, checks and decisions', () => {
    const value = readValue(
      validateWorkReport({
        headline: 'Clamp the tab width',
        phases: [{ title: 'Fix', summary: 'Clamped it.', spots: [SPOT] }],
        checks: [
          { name: 'lint', outcome: 'pass' },
          { name: 'test', outcome: 'fail', detail: '1 failed' },
        ],
        decisions: [{ decision: 'No new prop', reason: 'Not needed.', file: 'a.ts', line: 4 }],
      })
    );
    expect(value.checks).toEqual([
      { name: 'lint', outcome: 'pass', detail: null },
      { name: 'test', outcome: 'fail', detail: '1 failed' },
    ]);
    expect(value.decisions[0]).toMatchObject({ file: 'a.ts', line: 4 });
  });

  test('needs at least one phase and known check outcomes', () => {
    expect(
      errorsOf(validateWorkReport({ headline: 'x', checks: [{ name: 'lint', outcome: 'ok' }] }))
    ).toEqual(['phases must be a list.', 'checks[0].outcome must be one of pass, fail, skipped.']);
  });
});

describe('validateSpecDocument', () => {
  const PLAN = [
    { title: 'Find it', detail: 'Trace the overflow.' },
    { title: 'Fix it', detail: 'Clamp and verify.' },
  ];

  test('reads the snake_case lists and keeps questions with their options', () => {
    const value = readValue(
      validateSpecDocument({
        goal: 'Stop the tabs scrolling.',
        plan: PLAN,
        behaviour: ['Tabs stay put.'],
        approach: 'Clamp the width.',
        files: [{ path: 'src/tabs.tsx', change: 'Clamp' }],
        out_of_scope: ['Mobile'],
        verification: ['Open the page'],
        questions: [{ question: 'Which width?', options: ['200', '240'], recommendation: '240' }],
      })
    );
    expect(value).toMatchObject({
      outOfScope: ['Mobile'],
      verification: ['Open the page'],
      questions: [{ question: 'Which width?', options: ['200', '240'], recommendation: '240' }],
    });
  });

  test('a plan needs at least two phases', () => {
    const errors = errorsOf(
      validateSpecDocument({ goal: 'x', approach: 'y', plan: [{ title: 'Only', detail: 'One.' }] })
    );
    expect(errors).toEqual(['plan: at least 2 phases.']);
  });

  test('every nested field is checked', () => {
    const errors = errorsOf(
      validateSpecDocument({
        goal: 'x',
        approach: 'y',
        plan: [...PLAN, { title: '', detail: 'z' }],
        files: [{ path: 'a.ts' }],
        questions: [{ question: 'Q?', options: [''] }],
        behaviour: 'all of it',
      })
    );
    expect(errors).toEqual([
      'files[0].change is required.',
      'questions[0].options[0] is required.',
      'plan[2].title is required.',
      'behaviour must be a list.',
    ]);
  });
});

describe('validateFindings', () => {
  test('anchors each finding, defaulting the end line to the start', () => {
    expect(
      readValue(
        validateFindings({
          findings: [
            { severity: 'blocking', file: 'a.ts', line: 3, message: 'Off by one.' },
            { severity: 'suggestion', message: 'Rename it.' },
          ],
        })
      )
    ).toEqual([
      { severity: 'blocking', file: 'a.ts', line: 3, end: 3, message: 'Off by one.' },
      { severity: 'suggestion', file: null, line: null, end: null, message: 'Rename it.' },
    ]);
  });

  test('an empty review is fine, a broken finding is not', () => {
    expect(readValue(validateFindings({}))).toEqual([]);
    expect(
      errorsOf(
        validateFindings({ findings: [{ severity: 'nit', line: 9, end: 2, message: 'x'.repeat(300) }] })
      )
    ).toEqual([
      'findings[0].end comes before findings[0].line.',
      'findings[0].severity must be one of blocking, suggestion.',
      `findings[0].message is 300 characters; the limit is ${PROTOCOL_LIMITS.finding}.`,
    ]);
  });
});
