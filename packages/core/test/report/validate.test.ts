import { describe, expect, test } from 'bun:test';
import {
  PROTOCOL_LIMITS,
  type Validation,
  validateDelivery,
  validateEvidence,
  validateFixHandOver,
  validatePhaseHandOver,
  validatePlanHandOver,
  validateQuestion,
  validateReshape,
  validateReview,
  validateSuggestions,
  validateWait,
  validateWatchReport,
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
        judgement_calls: [
          { title: ' Keep the cache ', call: 'Kept the cache', reason: 'It is hot.', file: '', line: null },
        ],
      })
    );
    expect(value).toEqual({
      summary: 'Split the parser.',
      spots: [{ ...SPOT, end: 3 }],
      judgementCalls: [
        { title: 'Keep the cache', call: 'Kept the cache', reason: 'It is hot.', file: null, line: null },
      ],
      walkthrough: null,
    });
  });

  test('spots and judgement calls are optional', () => {
    expect(readValue(validatePhaseHandOver({ summary: 'Done.' }))).toEqual({
      summary: 'Done.',
      spots: [],
      judgementCalls: [],
      walkthrough: null,
    });
  });

  test('keeps the explained spots, the alternatives of a call and the walkthrough', () => {
    const value = readValue(
      validatePhaseHandOver({
        summary: 'Done.',
        spots: [{ ...SPOT, title: ' The cache key ', explain: 'Keys by path and commit.' }],
        judgement_calls: [
          {
            title: 'Cache by commit',
            call: 'Cache by commit',
            reason: 'A commit never changes.',
            file: 'src/a.ts',
            line: 4,
            end: 9,
            alternatives: [{ option: 'Cache by path', rejected: 'A path changes under an agent.' }],
          },
        ],
        walkthrough: {
          approach: 'Read once, keep it.',
          flow: 'read → cache → render',
          risks: [
            { title: 'Memory growth', risk: 'Memory grows.', file: 'src/a.ts', line: 2 },
            { title: 'No eviction', risk: 'Nothing evicts.' },
          ],
          testing: ['Open the same file twice.'],
        },
      })
    );
    expect(value).toEqual({
      summary: 'Done.',
      spots: [{ ...SPOT, title: 'The cache key', explain: 'Keys by path and commit.' }],
      judgementCalls: [
        {
          title: 'Cache by commit',
          call: 'Cache by commit',
          reason: 'A commit never changes.',
          file: 'src/a.ts',
          line: 4,
          end: 9,
          alternatives: [{ option: 'Cache by path', rejected: 'A path changes under an agent.' }],
        },
      ],
      walkthrough: {
        approach: 'Read once, keep it.',
        flow: 'read → cache → render',
        risks: [
          { title: 'Memory growth', risk: 'Memory grows.', file: 'src/a.ts', line: 2, end: null },
          { title: 'No eviction', risk: 'Nothing evicts.', file: null, line: null, end: null },
        ],
        testing: { automated: ['Open the same file twice.'], manual: [] },
      },
    });
  });

  test('a judgement call and a risk need a short title', () => {
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: 'Done.',
          judgement_calls: [{ call: 'Kept the cache', reason: 'It is hot.' }],
          walkthrough: {
            approach: 'Read once.',
            flow: 'read → render',
            risks: [{ title: 'x'.repeat(PROTOCOL_LIMITS.riskTitle + 1), risk: 'Memory grows.' }],
          },
        })
      )
    ).toEqual([
      'judgement_calls[0].title is required.',
      `walkthrough.risks[0].title is ${PROTOCOL_LIMITS.riskTitle + 1} characters; the limit is ${PROTOCOL_LIMITS.riskTitle}.`,
    ]);
  });

  test('names every broken field of the walkthrough and the alternatives', () => {
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: 'Done.',
          judgement_calls: [
            {
              title: 'x'.repeat(PROTOCOL_LIMITS.callTitle + 1),
              call: 'x',
              reason: 'y',
              line: 9,
              end: 2,
              alternatives: [{ option: '', rejected: 'z' }],
            },
          ],
          walkthrough: {
            approach: '',
            flow: 'x'.repeat(PROTOCOL_LIMITS.flow + 1),
            risks: [{ risk: 'r', line: 5, end: 1 }],
            testing: { automated: [''], manual: [{ action: 'Open it.' }] },
          },
        })
      )
    ).toEqual([
      'judgement_calls[0].end comes before judgement_calls[0].line.',
      'judgement_calls[0].alternatives[0].option is required.',
      `judgement_calls[0].title is ${PROTOCOL_LIMITS.callTitle + 1} characters; the limit is ${PROTOCOL_LIMITS.callTitle}.`,
      'walkthrough.approach is required.',
      `walkthrough.flow is ${PROTOCOL_LIMITS.flow + 1} characters; the limit is ${PROTOCOL_LIMITS.flow}.`,
      'walkthrough.risks[0].end comes before walkthrough.risks[0].line.',
      'walkthrough.risks[0].title is required.',
      'walkthrough.testing.automated[0] is required.',
      'walkthrough.testing.manual[0].expect is required.',
    ]);
    expect(errorsOf(validatePhaseHandOver({ summary: 'Done.', walkthrough: 'all of it' }))).toEqual([
      'walkthrough must be an object.',
      'walkthrough.approach is required.',
      'walkthrough.flow is required.',
    ]);
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

describe('the steps around the merge', () => {
  const WALKTHROUGH = { approach: 'Read once.', flow: 'read → render' };

  const ENV = {
    when: 'pre_merge' as const,
    kind: 'env' as const,
    title: ' Set STRIPE_WEBHOOK_SECRET ',
    detail: 'In the production environment of the API.',
  };

  const MIGRATION = {
    when: 'post_merge' as const,
    kind: 'migration' as const,
    title: 'Run the migration',
    detail: 'Adds the invoices table.',
    command: 'bun run db:migrate',
  };

  test('a phase hand-over keeps its steps, with no command as null, and leaves out an empty list', () => {
    expect(
      readValue(
        validatePhaseHandOver({ summary: 'Done.', walkthrough: { ...WALKTHROUGH, steps: [ENV, MIGRATION] } })
      ).walkthrough?.steps
    ).toEqual([{ ...ENV, title: 'Set STRIPE_WEBHOOK_SECRET', command: null }, { ...MIGRATION }]);
    expect(
      readValue(validatePhaseHandOver({ summary: 'Done.', walkthrough: { ...WALKTHROUGH, steps: [] } }))
        .walkthrough
    ).toEqual({ ...WALKTHROUGH, risks: [], testing: { automated: [], manual: [] } });
  });

  test('a fix replaces the steps whole, an empty list included, and may send only them', () => {
    expect(
      readValue(validateFixHandOver({ summary: 'Fixed.', walkthrough: { steps: [MIGRATION] } })).walkthrough
    ).toEqual({ steps: [MIGRATION] });
    expect(
      readValue(validateFixHandOver({ summary: 'Fixed.', walkthrough: { steps: [] } })).walkthrough
    ).toEqual({ steps: [] });
  });

  test('names every broken field of a step, a repeated title and the limits', () => {
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: 'Done.',
          walkthrough: {
            ...WALKTHROUGH,
            steps: [
              {
                when: 'later',
                kind: 'chore',
                title: '',
                detail: 'x'.repeat(PROTOCOL_LIMITS.mergeStepDetail + 1),
              },
              { ...ENV, command: 'x'.repeat(PROTOCOL_LIMITS.mergeStepCommand + 1) },
              ENV,
              { ...ENV, when: 'post_merge' as const },
            ],
          },
        })
      )
    ).toEqual([
      'walkthrough.steps[0].when must be one of pre_merge, post_merge.',
      'walkthrough.steps[0].kind must be one of env, secret, migration, deploy, config, other.',
      'walkthrough.steps[0].title is required.',
      `walkthrough.steps[0].detail is ${PROTOCOL_LIMITS.mergeStepDetail + 1} characters; the limit is ${PROTOCOL_LIMITS.mergeStepDetail}.`,
      `walkthrough.steps[1].command is ${PROTOCOL_LIMITS.mergeStepCommand + 1} characters; the limit is ${PROTOCOL_LIMITS.mergeStepCommand}.`,
      'walkthrough.steps[2].title repeats walkthrough.steps[1]; give each step its own title.',
    ]);
    expect(
      errorsOf(
        validateFixHandOver({
          summary: 'Fixed.',
          walkthrough: {
            steps: Array.from({ length: PROTOCOL_LIMITS.mergeSteps + 1 }, (_, index) => ({
              ...ENV,
              title: `Step ${index}`,
            })),
          },
        })
      )
    ).toEqual([
      `walkthrough.steps has ${PROTOCOL_LIMITS.mergeSteps + 1} items; the limit is ${PROTOCOL_LIMITS.mergeSteps}.`,
    ]);
  });
});

describe('how to test the change', () => {
  const WALKTHROUGH = { approach: 'Read once.', flow: 'read → render' };

  function testingOf(testing: unknown) {
    return readValue(validatePhaseHandOver({ summary: 'Done.', walkthrough: { ...WALKTHROUGH, testing } }))
      .walkthrough?.testing;
  }

  test('keeps what the tests cover and the guided steps, each target as given and a missing one as null', () => {
    expect(
      testingOf({
        automated: [' duplicate.test.ts covers both kinds. '],
        manual: [
          {
            action: 'Start the app.',
            target: { kind: 'command', value: 'bun dev' },
            expect: 'It prints the local URL.',
          },
          {
            action: 'Open the paywalls.',
            target: { kind: 'url', value: 'http://localhost:5173/paywalls' },
            expect: 'The list loads.',
          },
          {
            action: 'Read the copy step.',
            target: { kind: 'file', value: 'src/paywalls/duplicate.ts:12-20' },
            expect: 'It copies the code.',
          },
          {
            action: 'Duplicate a paywall.',
            target: { kind: 'screen', value: 'Paywalls' },
            expect: 'A copy.',
          },
          { action: 'Try an empty name.', expect: 'It is refused.' },
        ],
      })
    ).toEqual({
      automated: ['duplicate.test.ts covers both kinds.'],
      manual: [
        {
          action: 'Start the app.',
          target: { kind: 'command', value: 'bun dev' },
          expect: 'It prints the local URL.',
        },
        {
          action: 'Open the paywalls.',
          target: { kind: 'url', value: 'http://localhost:5173/paywalls' },
          expect: 'The list loads.',
        },
        {
          action: 'Read the copy step.',
          target: { kind: 'file', value: 'src/paywalls/duplicate.ts:12-20' },
          expect: 'It copies the code.',
        },
        { action: 'Duplicate a paywall.', target: { kind: 'screen', value: 'Paywalls' }, expect: 'A copy.' },
        { action: 'Try an empty name.', target: null, expect: 'It is refused.' },
      ],
    });
  });

  test('reads a plain list as what the tests cover, and no testing as an empty guide', () => {
    expect(testingOf(['Open the same file twice.'])).toEqual({
      automated: ['Open the same file twice.'],
      manual: [],
    });
    expect(testingOf(undefined)).toEqual({ automated: [], manual: [] });
    expect(testingOf({})).toEqual({ automated: [], manual: [] });
  });

  test('a fix sends the guide in the same shape', () => {
    expect(
      readValue(
        validateFixHandOver({
          summary: 'Fixed.',
          walkthrough: { testing: { manual: [{ action: 'Reload.', expect: 'It stays.' }] } },
        })
      ).walkthrough
    ).toEqual({
      testing: { automated: [], manual: [{ action: 'Reload.', target: null, expect: 'It stays.' }] },
    });
  });

  test('names a target that is not a web address or a repository path, and every limit', () => {
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: 'Done.',
          walkthrough: {
            ...WALKTHROUGH,
            testing: {
              automated: Array.from({ length: PROTOCOL_LIMITS.testingAutomated + 1 }, () => 'Covered.'),
              manual: [
                { action: 'Open it.', target: { kind: 'url', value: 'javascript:alert(1)' }, expect: 'x' },
                { action: 'Read it.', target: { kind: 'file', value: '../secrets.ts' }, expect: 'x' },
                { action: 'Look.', target: { kind: 'page', value: '' }, expect: 'x' },
                {
                  action: 'Look.',
                  target: 'Settings',
                  expect: 'x'.repeat(PROTOCOL_LIMITS.testingExpect + 1),
                },
              ],
            },
          },
        })
      )
    ).toEqual([
      `walkthrough.testing.automated has ${PROTOCOL_LIMITS.testingAutomated + 1} items; the limit is ${PROTOCOL_LIMITS.testingAutomated}.`,
      'walkthrough.testing.manual[0].target.value must be an http or https URL.',
      'walkthrough.testing.manual[1].target.value must be a path relative to the repository root, with :line or :start-end when it points at lines.',
      'walkthrough.testing.manual[2].target.kind must be one of url, file, command, screen.',
      'walkthrough.testing.manual[2].target.value is required.',
      'walkthrough.testing.manual[3].target must be an object.',
      'walkthrough.testing.manual[3].target.kind must be one of url, file, command, screen.',
      'walkthrough.testing.manual[3].target.value is required.',
      `walkthrough.testing.manual[3].expect is ${PROTOCOL_LIMITS.testingExpect + 1} characters; the limit is ${PROTOCOL_LIMITS.testingExpect}.`,
    ]);
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: 'Done.',
          walkthrough: {
            ...WALKTHROUGH,
            testing: {
              manual: Array.from({ length: PROTOCOL_LIMITS.testingSteps + 1 }, () => ({
                action: 'Click.',
                expect: 'It works.',
              })),
            },
          },
        })
      )
    ).toEqual([
      `walkthrough.testing.manual has ${PROTOCOL_LIMITS.testingSteps + 1} items; the limit is ${PROTOCOL_LIMITS.testingSteps}.`,
    ]);
  });
});

describe('validateFixHandOver', () => {
  test('needs a summary', () => {
    expect(readValue(validateFixHandOver({ summary: 'Fixed CI.' }))).toEqual({
      summary: 'Fixed CI.',
      walkthrough: null,
    });
    expect(errorsOf(validateFixHandOver({}))).toEqual(['summary is required.']);
  });

  test('keeps only the parts of the walkthrough the fix sends', () => {
    expect(
      readValue(
        validateFixHandOver({
          summary: 'Clamped earlier.',
          walkthrough: {
            flow: ' clamp → layout ',
            risks: [{ title: 'Narrow windows', risk: 'Narrow windows.', file: 'a.ts', line: 3 }],
            testing: [],
            approach: null,
          },
        })
      ).walkthrough
    ).toEqual({
      flow: 'clamp → layout',
      risks: [{ title: 'Narrow windows', risk: 'Narrow windows.', file: 'a.ts', line: 3, end: null }],
      testing: { automated: [], manual: [] },
    });
    expect(
      readValue(validateFixHandOver({ summary: 'Fixed.', walkthrough: { approach: 'Measure first.' } }))
        .walkthrough
    ).toEqual({ approach: 'Measure first.' });
  });

  test('refuses an empty walkthrough and names every broken part', () => {
    expect(errorsOf(validateFixHandOver({ summary: 'Fixed.', walkthrough: {} }))).toEqual([
      'walkthrough needs at least one of approach, flow, risks, testing, steps or watchdogs. Leave it out when the fix changes none of them.',
    ]);
    expect(errorsOf(validateFixHandOver({ summary: 'Fixed.', walkthrough: 'flow' }))).toEqual([
      'walkthrough must be an object.',
    ]);
    expect(
      errorsOf(
        validateFixHandOver({
          summary: 'Fixed.',
          walkthrough: {
            approach: '',
            flow: 'x'.repeat(PROTOCOL_LIMITS.flow + 1),
            risks: [{ title: 'Edge', risk: 'Edge.', line: 4, end: 2 }],
            testing: 'Resize it.',
          },
        })
      )
    ).toEqual([
      'walkthrough.approach is required.',
      `walkthrough.flow is ${PROTOCOL_LIMITS.flow + 1} characters; the limit is ${PROTOCOL_LIMITS.flow}.`,
      'walkthrough.risks[0].end comes before walkthrough.risks[0].line.',
      'walkthrough.testing must be an object.',
    ]);
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

describe('validateReview', () => {
  test('anchors each finding, defaulting the end line to the start', () => {
    expect(
      readValue(
        validateReview({
          summary: ' Checked the retry path. ',
          findings: [
            {
              severity: 'blocking',
              file: 'a.ts',
              line: 3,
              title: 'Off by one',
              message: 'The loop skips the last item.',
              fix: 'Use `<=` in the loop.',
            },
            { severity: 'suggestion', message: 'Rename it.', title: '', fix: null },
          ],
        })
      )
    ).toEqual({
      summary: 'Checked the retry path.',
      findings: [
        {
          severity: 'blocking',
          file: 'a.ts',
          line: 3,
          end: 3,
          title: 'Off by one',
          message: 'The loop skips the last item.',
          fix: 'Use `<=` in the loop.',
        },
        { severity: 'suggestion', file: null, line: null, end: null, message: 'Rename it.' },
      ],
      disagreements: [],
    });
  });

  test('keeps the judgement calls the reviewer disagrees with, each once', () => {
    expect(
      readValue(validateReview({ findings: [], disagreements: [{ call: 2, reason: ' Too wide. ' }] }))
    ).toEqual({ summary: null, findings: [], disagreements: [{ call: 2, reason: 'Too wide.' }] });
    expect(
      errorsOf(
        validateReview({
          findings: [],
          disagreements: [
            { call: 0, reason: 'x' },
            { call: 2, reason: '' },
            { call: 2, reason: 'y' },
          ],
        })
      )
    ).toEqual([
      `disagreements[0].call must be a whole number from 1 to ${PROTOCOL_LIMITS.judgementCalls * PROTOCOL_LIMITS.planPhases}.`,
      'disagreements[1].reason is required.',
      'disagreements names a judgement call twice.',
    ]);
  });

  test('an empty review is fine, a broken finding is not', () => {
    expect(readValue(validateReview({}))).toEqual({ summary: null, findings: [], disagreements: [] });
    expect(
      errorsOf(
        validateReview({
          summary: 'x'.repeat(PROTOCOL_LIMITS.reviewSummary + 1),
          findings: [
            {
              severity: 'nit',
              line: 9,
              end: 2,
              title: 'x'.repeat(PROTOCOL_LIMITS.findingTitle + 1),
              message: 'x'.repeat(300),
              fix: 'x'.repeat(PROTOCOL_LIMITS.findingFix + 1),
            },
          ],
        })
      )
    ).toEqual([
      `summary is ${PROTOCOL_LIMITS.reviewSummary + 1} characters; the limit is ${PROTOCOL_LIMITS.reviewSummary}.`,
      'findings[0].end comes before findings[0].line.',
      `findings[0].title is ${PROTOCOL_LIMITS.findingTitle + 1} characters; the limit is ${PROTOCOL_LIMITS.findingTitle}.`,
      `findings[0].fix is ${PROTOCOL_LIMITS.findingFix + 1} characters; the limit is ${PROTOCOL_LIMITS.findingFix}.`,
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

  test('keeps the impact, the evidence, the extra checks and the approval the agent asks for', () => {
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

describe('validateEvidence', () => {
  test('reads a screenshot with what it shows, its width, theme and stage', () => {
    expect(
      readValue(
        validateEvidence({
          kind: 'screenshot',
          title: ' Settings ',
          detail: 'The labels read clearly.',
          width: 1280,
          theme: 'dark',
          stage: 'before',
          path: 'shots/settings.png',
        })
      )
    ).toEqual({
      kind: 'screenshot',
      title: 'Settings',
      detail: 'The labels read clearly.',
      width: 1280,
      theme: 'dark',
      stage: 'before',
      source: { path: 'shots/settings.png' },
    });
  });

  test('the optional fields may be left out, and a url or text is the source', () => {
    expect(readValue(validateEvidence({ kind: 'preview', title: 'Preview', url: 'https://a.dev' }))).toEqual({
      kind: 'preview',
      title: 'Preview',
      detail: null,
      width: null,
      theme: null,
      stage: null,
      source: { url: 'https://a.dev' },
    });
    expect(
      readValue(validateEvidence({ kind: 'test', title: 'Tests', text: '3 pass', theme: '', stage: null }))
    ).toMatchObject({ source: { text: '3 pass' } });
  });

  test('names every broken field, and wants exactly one source', () => {
    expect(
      errorsOf(
        validateEvidence({
          kind: 'virus',
          title: 'x'.repeat(PROTOCOL_LIMITS.evidenceTitle + 1),
          width: 0,
          theme: 'sepia',
          stage: 'during',
        })
      )
    ).toEqual([
      'kind must be one of screenshot, recording, test, check, note, preview, comparison.',
      `title is ${PROTOCOL_LIMITS.evidenceTitle + 1} characters; the limit is ${PROTOCOL_LIMITS.evidenceTitle}.`,
      `width must be a whole number from 1 to ${PROTOCOL_LIMITS.evidenceWidth}.`,
      'theme must be one of light, dark.',
      'stage must be one of before, after.',
      'Give exactly one of path, url or text.',
    ]);
    expect(
      errorsOf(validateEvidence({ kind: 'note', title: 'Both', url: 'https://a.dev', text: 'x' }))
    ).toEqual(['Give exactly one of path, url or text.']);
    expect(
      errorsOf(validateEvidence({ kind: 'screenshot', title: 'Shot', path: 'a.png', parts: [] }))
    ).toEqual(['parts is only for kind comparison.']);
  });

  test('reads a comparison: its parts, each named by its stage or label, and the facts they share', () => {
    expect(
      readValue(
        validateEvidence({
          kind: 'comparison',
          title: 'Settings',
          width: 1280,
          theme: 'light',
          parts: [
            { path: 'before.png', stage: 'before' },
            { path: 'empty.png', label: ' Empty list ' },
            { path: 'after.png', stage: 'after', label: null },
          ],
        })
      )
    ).toEqual({
      kind: 'comparison',
      title: 'Settings',
      detail: null,
      width: 1280,
      theme: 'light',
      parts: [
        { path: 'before.png', stage: 'before', label: null },
        { path: 'empty.png', stage: null, label: 'Empty list' },
        { path: 'after.png', stage: 'after', label: null },
      ],
    });
  });

  test('a comparison needs two to six named parts and no source of its own', () => {
    expect(
      errorsOf(
        validateEvidence({ kind: 'comparison', title: 'One', parts: [{ path: 'a.png', stage: 'after' }] })
      )
    ).toEqual(['parts needs at least 2 items.']);
    expect(
      errorsOf(
        validateEvidence({
          kind: 'comparison',
          title: 'Broken',
          path: 'a.png',
          stage: 'after',
          parts: [
            { path: 'a.png' },
            { path: 'b.png', stage: 'after' },
            { path: 'c.png', stage: 'after' },
            'd.png',
            { stage: 'before', label: 'x'.repeat(PROTOCOL_LIMITS.evidenceLabel + 1) },
            { path: 'f.png', label: 'F' },
            { path: 'g.png', label: 'G' },
          ],
        })
      )
    ).toEqual([
      `parts has 7 items; the limit is ${PROTOCOL_LIMITS.evidenceParts}.`,
      'parts[0] needs a stage or a label.',
      'parts[3] must be an object.',
      'parts[3].path is required.',
      'parts[3] needs a stage or a label.',
      'parts[4].path is required.',
      `parts[4].label is ${PROTOCOL_LIMITS.evidenceLabel + 1} characters; the limit is ${PROTOCOL_LIMITS.evidenceLabel}.`,
      'Each part needs its own stage or label; two parts are named the same.',
      'A comparison takes its files in parts: leave out path, url, text and stage.',
    ]);
  });
});

const WATCHED = { approach: 'Cache the price.', flow: 'checkout → cache' };

const LATENCY = {
  title: 'Checkout latency',
  check: 'p95 of POST /checkout stays under 400 ms.',
  source: { server: 'maple', data: 'API traces' },
  every_hours: 6,
  for_hours: 48,
};

const EVENTS = {
  title: 'Paywall events',
  check: 'paywall_open keeps arriving.',
  source_request: {
    data: 'Web analytics',
    evidence: 'src/analytics.ts sends to PostHog.',
    suggestions: ['PostHog’s MCP server'],
  },
  every_hours: 12,
  for_hours: 24,
};

describe('watchdogs in the walkthrough', () => {
  test('reads a watchdog with a source and one with a source request', () => {
    const walkthrough = readValue(
      validatePhaseHandOver({ summary: 'Done.', walkthrough: { ...WATCHED, watchdogs: [LATENCY, EVENTS] } })
    ).walkthrough;
    expect(walkthrough?.watchdogs).toEqual([
      {
        title: 'Checkout latency',
        check: 'p95 of POST /checkout stays under 400 ms.',
        source: { server: 'maple', data: 'API traces' },
        sourceRequest: null,
        everyHours: 6,
        forHours: 48,
      },
      {
        title: 'Paywall events',
        check: 'paywall_open keeps arriving.',
        source: null,
        sourceRequest: {
          data: 'Web analytics',
          evidence: 'src/analytics.ts sends to PostHog.',
          suggestions: ['PostHog’s MCP server'],
        },
        everyHours: 12,
        forHours: 24,
      },
    ]);
    expect(
      readValue(validatePhaseHandOver({ summary: 'Done.', walkthrough: { ...WATCHED, watchdogs: [] } }))
        .walkthrough?.watchdogs
    ).toBeUndefined();
    expect(
      readValue(validateFixHandOver({ summary: 'Fixed.', walkthrough: { watchdogs: [] } })).walkthrough
    ).toEqual({
      watchdogs: [],
    });
  });

  test('names a watchdog with both or neither source, no suggestions, a repeated title and a check past its window', () => {
    expect(
      errorsOf(
        validatePhaseHandOver({
          summary: 'Done.',
          walkthrough: {
            ...WATCHED,
            watchdogs: [
              { ...LATENCY, source_request: EVENTS.source_request },
              { ...LATENCY, title: 'No source', source: undefined },
              { ...EVENTS, source_request: { data: 'd', evidence: 'e' } },
              EVENTS,
              { ...LATENCY, title: 'Short', every_hours: 24, for_hours: 12 },
            ],
          },
        })
      )
    ).toEqual([
      'walkthrough.watchdogs[0] needs exactly one of source (a server that has the data) or source_request (what to connect).',
      'walkthrough.watchdogs[1] needs exactly one of source (a server that has the data) or source_request (what to connect).',
      'walkthrough.watchdogs[2].source_request.suggestions needs at least 1 server to connect, by name and where it comes from.',
      'walkthrough.watchdogs[3].title repeats walkthrough.watchdogs[2]; give each watchdog its own title.',
      'walkthrough.watchdogs[4] checks every 24 hours but watches for only 12; check at least once in the window.',
    ]);
  });
});

describe('validateWatchReport', () => {
  test('reads a healthy check and one with an issue', () => {
    expect(readValue(validateWatchReport({ healthy: true, summary: 'p95 210 ms.' }))).toEqual({
      healthy: true,
      summary: 'p95 210 ms.',
      issue: null,
    });
    expect(
      readValue(
        validateWatchReport({
          healthy: false,
          summary: 'Slow.',
          issue: { title: 'Slow in Safari', request: 'Fix it.' },
        })
      ).issue
    ).toEqual({ title: 'Slow in Safari', request: 'Fix it.' });
  });

  test('refuses a missing verdict, a healthy check with an issue and an issue without its fields', () => {
    expect(errorsOf(validateWatchReport({ summary: 'ok' }))).toEqual([
      'healthy is required: true when nothing is wrong.',
    ]);
    expect(
      errorsOf(validateWatchReport({ healthy: true, summary: 'ok', issue: { title: 't', request: 'r' } }))
    ).toEqual(['A healthy check has no issue. Leave issue out, or set healthy to false.']);
    expect(errorsOf(validateWatchReport({ healthy: false, summary: 'bad' }))).toEqual([
      'An unhealthy check needs issue: a title and the request for the task that fixes it.',
    ]);
    expect(errorsOf(validateWatchReport({ healthy: false, summary: 'bad', issue: { title: '' } }))).toEqual([
      'issue.title is required.',
      'issue.request is required.',
    ]);
  });
});
