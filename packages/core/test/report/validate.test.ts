import { describe, expect, test } from 'bun:test';
import {
  PROTOCOL_LIMITS,
  type Validation,
  validateDelivery,
  validateFindings,
  validateFixHandOver,
  validatePhaseHandOver,
  validatePlanHandOver,
  validateQuestion,
  validateReshape,
  validateSuggestions,
  validateWait,
} from '../../src/index.ts';

function errorsOf<T>(result: Validation<T>) {
  return result.ok ? [] : result.errors;
}

function validatePlanDocument(input: Record<string, unknown>) {
  const result = validatePlanHandOver(input);
  return result.ok ? { ok: true as const, value: result.value.document } : result;
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
        judgement_calls: [{ call: 'Kept the cache', reason: 'It is hot.', file: '', line: null }],
      })
    );
    expect(value).toEqual({
      summary: 'Split the parser.',
      spots: [{ ...SPOT, end: 3 }],
      judgementCalls: [{ call: 'Kept the cache', reason: 'It is hot.', file: null, line: null }],
    });
  });

  test('spots and judgement calls are optional', () => {
    expect(readValue(validatePhaseHandOver({ summary: 'Done.' }))).toEqual({
      summary: 'Done.',
      spots: [],
      judgementCalls: [],
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
          judgement_calls: { call: 'x' },
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
      'judgement_calls must be a list.',
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

describe('validatePlanHandOver reads the plan document', () => {
  const PHASES = [
    { title: 'Find it', detail: 'Trace the overflow.' },
    { title: 'Fix it', detail: 'Clamp and verify.' },
  ];

  test('reads the snake_case lists and keeps questions with their options', () => {
    const value = readValue(
      validatePlanDocument({
        goal: 'Stop the tabs scrolling.',
        phases: PHASES,
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

  test('an operation is optional, and when given it is a list of steps', () => {
    const base = { goal: 'x', approach: 'y', phases: PHASES };
    expect(readValue(validatePlanDocument(base))).not.toHaveProperty('operation');
    expect(
      readValue(validatePlanDocument({ ...base, operation: ['Run the backfill.', 'Count the rows.'] }))
    ).toMatchObject({ operation: ['Run the backfill.', 'Count the rows.'] });
    expect(errorsOf(validatePlanDocument({ ...base, operation: 'run it' }))).toEqual([
      'operation must be a list.',
    ]);
  });

  test('a plan needs at least two phases', () => {
    const errors = errorsOf(
      validatePlanDocument({ goal: 'x', approach: 'y', phases: [{ title: 'Only', detail: 'One.' }] })
    );
    expect(errors).toEqual(['phases: at least 2 phases.']);
  });

  test('every nested field is checked', () => {
    const errors = errorsOf(
      validatePlanDocument({
        goal: 'x',
        approach: 'y',
        phases: [...PHASES, { title: '', detail: 'z' }],
        files: [{ path: 'a.ts' }],
        questions: [{ question: 'Q?', options: [''] }],
        behaviour: 'all of it',
      })
    );
    expect(errors).toEqual([
      'files[0].change is required.',
      'questions[0].options[0] is required.',
      'phases[2].title is required.',
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

describe('validatePlanHandOver', () => {
  test('keeps the plan and an optional change summary', () => {
    const plan = {
      goal: 'Ship it.',
      phases: [
        { title: 'One', detail: 'First.' },
        { title: 'Two', detail: 'Second.' },
      ],
      behaviour: [],
      approach: 'Plainly.',
      files: [],
      out_of_scope: [],
      verification: [],
      questions: [],
    };
    const first = validatePlanHandOver(plan);
    expect(first.ok && first.value.changeSummary).toBeNull();
    const revised = validatePlanHandOver({ ...plan, change_summary: ' Added a phase. ' });
    expect(revised.ok && revised.value.changeSummary).toBe('Added a phase.');
    expect(validatePlanHandOver({ ...plan, change_summary: 'x'.repeat(241) })).toEqual({
      ok: false,
      errors: ['change_summary is 241 characters; the limit is 240.'],
    });
    const broken = validatePlanHandOver({ ...plan, goal: '', change_summary: 'x'.repeat(241) });
    expect(broken.ok ? [] : broken.errors).toEqual([
      'goal is required.',
      'change_summary is 241 characters; the limit is 240.',
    ]);
  });
});

describe('the plan parameters', () => {
  const plan = {
    goal: 'Ship it.',
    phases: [
      { title: 'One', detail: 'First.' },
      { title: 'Two', detail: 'Second.' },
    ],
    approach: 'Plainly.',
    verification: ['A test.'],
  };

  test('keeps the impact, the evidence, the extra checks and the approval the planner asks for', () => {
    const result = validatePlanHandOver({
      ...plan,
      impact: ' Touches 40 rows. ',
      evidence: ['screenshot', 'test'],
      checks: ['bun test tabs'],
      approval: true,
    });
    expect(result.ok && result.value.document).toMatchObject({
      impact: 'Touches 40 rows.',
      evidence: ['screenshot', 'test'],
      checks: ['bun test tabs'],
      approval: true,
    });
    const bare = validatePlanHandOver({ ...plan, approval: false });
    expect(bare.ok && Object.keys(bare.value.document)).not.toContain('approval');
  });

  test('refuses an unknown or repeated kind of evidence, a long command and an approval that is not a flag', () => {
    const result = validatePlanHandOver({
      ...plan,
      evidence: ['screenshot', 'screenshot', 'check'],
      checks: ['x'.repeat(201)],
      approval: 'yes',
      impact: 'x'.repeat(1_001),
    });
    expect(result.ok ? [] : result.errors).toEqual([
      'impact is 1001 characters; the limit is 1000.',
      'evidence[2] must be one of screenshot, recording, test, note, preview.',
      'evidence names a kind twice.',
      'checks[0] is 201 characters; the limit is 200.',
      'approval must be true or false.',
    ]);
  });
});

describe('validateQuestion', () => {
  test('keeps a question with up to four choices and a recommended one', () => {
    expect(
      validateQuestion({
        question: 'Which?',
        context: 'Two options.',
        choices: ['A', 'B'],
        recommendation: 'A',
      })
    ).toEqual({
      ok: true,
      value: { question: 'Which?', context: 'Two options.', choices: ['A', 'B'], recommendation: 'A' },
    });
    expect(validateQuestion({ question: 'Which?' })).toEqual({
      ok: true,
      value: { question: 'Which?', context: null, choices: [], recommendation: null },
    });
  });

  test('refuses one choice, repeated choices and a recommendation that is not a choice', () => {
    expect(validateQuestion({ question: 'Which?', choices: ['A'] })).toEqual({
      ok: false,
      errors: ['choices needs at least 2 options, or none.'],
    });
    expect(validateQuestion({ question: 'Which?', choices: ['A', 'A'], recommendation: 'C' })).toEqual({
      ok: false,
      errors: [
        'choices must differ from each other.',
        'recommendation must be one of the choices, worded the same.',
      ],
    });
  });
});

describe('validateWait', () => {
  test('keeps the check time, notes and optional bounds', () => {
    expect(validateWait({ check_in_minutes: 15, notes: 'Deploy done?' })).toEqual({
      ok: true,
      value: { checkInMinutes: 15, notes: 'Deploy done?', timeoutMinutes: null, maxAttempts: null },
    });
    expect(
      validateWait({ check_in_minutes: 15, notes: 'x', timeout_minutes: 60, max_attempts: 3 })
    ).toMatchObject({
      ok: true,
      value: { timeoutMinutes: 60, maxAttempts: 3 },
    });
  });

  test('names every bound it breaks', () => {
    expect(
      validateWait({ check_in_minutes: 0, notes: '', timeout_minutes: 99_999, max_attempts: 1.5 })
    ).toEqual({
      ok: false,
      errors: [
        'check_in_minutes must be a whole number from 1 to 1440.',
        'notes is required.',
        'timeout_minutes must be a whole number from 1 to 10080.',
        'max_attempts must be a whole number from 1 to 100.',
      ],
    });
  });
});

describe('validateSuggestions', () => {
  test('reads each task, with after_this defaulting to false', () => {
    expect(
      validateSuggestions({
        tasks: [
          { title: 'Cache it', request: 'Cache the session.', why: 'It is slow.' },
          { title: 'Retry', request: 'Retry the export.', why: 'It fails.', after_this: true },
        ],
      })
    ).toEqual({
      ok: true,
      value: [
        { title: 'Cache it', request: 'Cache the session.', why: 'It is slow.', waitsOnThis: false },
        { title: 'Retry', request: 'Retry the export.', why: 'It fails.', waitsOnThis: true },
      ],
    });
  });

  test('needs one to five tasks with every field', () => {
    expect(validateSuggestions({ tasks: [] })).toEqual({
      ok: false,
      errors: ['tasks needs at least 1 item.'],
    });
    expect(
      validateSuggestions({ tasks: [{ title: 'x', request: '', why: 'y', after_this: 'yes' }] })
    ).toEqual({
      ok: false,
      errors: ['tasks[0].request is required.', 'tasks[0].after_this must be true or false.'],
    });
  });
});

describe('the shape hand-overs', () => {
  test('an answer is delivered with its field and limit, and can carry a proposed change', () => {
    expect(validateDelivery('answer', { answer: ' It retries. ' })).toEqual({
      ok: true,
      value: { body: 'It retries.', proposal: null },
    });
    expect(validateDelivery('answer', { answer: 'x'.repeat(8_001) })).toEqual({
      ok: false,
      errors: ['answer is 8001 characters; the limit is 8000.'],
    });
    expect(
      validateDelivery('answer', {
        answer: 'Yes.',
        propose_change: { request: ' Stream it. ', why: 'Memory.' },
      })
    ).toEqual({
      ok: true,
      value: { body: 'Yes.', proposal: { request: 'Stream it.', why: 'Memory.' } },
    });
    expect(
      validateDelivery('answer', { answer: 'Yes.', propose_change: { request: '', why: 'x'.repeat(241) } })
    ).toEqual({
      ok: false,
      errors: [
        'propose_change.request is required.',
        'propose_change.why is 241 characters; the limit is 240.',
      ],
    });
  });

  test('a diagnosis, a report and an outcome each have their field and limit; an outcome proposes nothing', () => {
    expect(validateDelivery('investigate', { diagnosis: 'The cache.', propose_change: null })).toEqual({
      ok: true,
      value: { body: 'The cache.', proposal: null },
    });
    expect(validateDelivery('research', { report: 'x'.repeat(40_001) })).toEqual({
      ok: false,
      errors: ['report is 40001 characters; the limit is 40000.'],
    });
    expect(
      validateDelivery('operate', { outcome: 'Ran it.', propose_change: { request: 'More.', why: 'Why.' } })
    ).toEqual({ ok: true, value: { body: 'Ran it.', proposal: null } });
  });

  test('a reshape names one of the inquiry shapes and why', () => {
    expect(validateReshape({ shape: 'research', reason: 'A comparison.' })).toEqual({
      ok: true,
      value: { shape: 'research', reason: 'A comparison.' },
    });
    expect(validateReshape({ shape: 'change', reason: '' })).toEqual({
      ok: false,
      errors: ['shape must be one of answer, investigate, research.', 'reason is required.'],
    });
  });

  test('a composition lists known steps and why, and never comes with a shape too', () => {
    expect(
      validateReshape({ steps: ['investigate', 'your_ok', 'plan', 'operate'], reason: 'Find it first.' })
    ).toEqual({
      ok: true,
      value: { steps: ['investigate', 'your_ok', 'plan', 'operate'], reason: 'Find it first.' },
    });
    expect(validateReshape({ steps: ['investigate', 'deploy'], shape: 'answer', reason: 'x' })).toEqual({
      ok: false,
      errors: [
        'Give either shape or steps, not both.',
        'steps[1] must be one of answer, research, investigate, your_ok, plan, operate, build, checks, agent_review, your_review, pull_request, merge.',
      ],
    });
    expect(validateReshape({ steps: [], reason: 'x' })).toEqual({
      ok: false,
      errors: ['steps needs at least 1 item.'],
    });
  });
});
