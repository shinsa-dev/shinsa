import { describe, expect, test } from 'bun:test';
import {
  findInquiryStep,
  findWorkStep,
  hasStep,
  isComposedByAgent,
  isInquiryDone,
  isSamePipeline,
  type PipelineStep,
  resolveInquiryStep,
  resolveOperationTiming,
  resolvePresetOf,
  resolveProposalUpgrade,
  resolveShapeOf,
  resolveShapeState,
  resolveTaskPipeline,
  resolveTaskShape,
  resolveWorkStep,
  SHAPE_PIPELINES,
  TASK_SHAPES,
  validateComposition,
  validatePipeline,
} from '../../src/index.ts';

const CHANGE = SHAPE_PIPELINES.change;

describe('task shapes', () => {
  test('every preset is a valid pipeline and reads back as its own shape', () => {
    for (const shape of TASK_SHAPES) {
      expect(validatePipeline(SHAPE_PIPELINES[shape])).toEqual([]);
      expect(resolveShapeOf(SHAPE_PIPELINES[shape])).toBe(shape);
    }
  });

  test('a code change cannot skip your review, the pull request or the merge', () => {
    for (const skipped of ['your_review', 'pull_request', 'merge'] as const) {
      expect(validatePipeline(CHANGE.filter((step) => step !== skipped))).toContain(
        'A code change goes through your review, a pull request and the merge.'
      );
    }
  });

  test('the safety rules alone accept a change without checks or an agent review, the verification rules do not', () => {
    const bare: PipelineStep[] = ['plan', 'build', 'your_review', 'pull_request', 'merge'];
    expect(validatePipeline(CHANGE.filter((step) => step !== 'checks'))).toEqual([]);
    expect(validatePipeline(bare)).toEqual([]);
    expect(validateComposition(FRESH, bare)).toEqual([
      "A code change is checked: put `checks` after `build`. Shinsa runs the repository's checks on every change; the plan's `checks` add to them.",
      'A code change gets an independent agent review: put `agent_review` after `checks`.',
    ]);
  });

  test('a merge needs a pull request, and a pull request needs your review first', () => {
    expect(validatePipeline(['plan', 'build', 'checks', 'agent_review', 'merge'])).toContain(
      'A merge needs a pull request first.'
    );
    expect(validatePipeline(['plan', 'build', 'checks', 'agent_review', 'pull_request'])).toContain(
      'A pull request opens only after your review.'
    );
  });

  test('steps keep the fixed order, never repeat and need something that does the work', () => {
    expect(validatePipeline([])).toEqual(['A task needs at least one step.']);
    expect(validatePipeline(['build', 'plan'])).toContain('The steps are out of order.');
    expect(validatePipeline(['answer', 'answer'])).toContain('A step appears twice.');
    expect(validatePipeline(['plan'])).toContain('A plan needs something to carry it out.');
    expect(validatePipeline(['plan'])).toContain('A task needs a step that does the work.');
  });

  test('changing code or running an operation needs a plan first', () => {
    expect(validatePipeline(['operate'])).toContain(
      'Changing code or running an operation needs a plan first.'
    );
    expect(resolveOperationTiming(['operate'])).toBe('alone');
  });

  test('a task can change code and run an operation, right after the plan or last, after the merge', () => {
    const before: PipelineStep[] = ['plan', 'operate', ...CHANGE.slice(1)];
    const after: PipelineStep[] = [...CHANGE, 'operate'];
    expect(validatePipeline(before)).toEqual([]);
    expect(validatePipeline(after)).toEqual([]);
    expect(validatePipeline(['investigate', 'your_ok', ...after])).toEqual([]);
    expect(resolveOperationTiming(before)).toBe('before_build');
    expect(resolveOperationTiming(after)).toBe('post_merge');
    expect(resolveOperationTiming(SHAPE_PIPELINES.operation)).toBe('alone');
    expect(resolveOperationTiming(CHANGE)).toBeNull();
    expect(resolveWorkStep(before)).toBe('operate');
    expect(resolveWorkStep(after)).toBe('build');
    expect(resolveShapeOf(after)).toBe('change');
  });

  test('an operation never runs in the middle of a change', () => {
    const placed = 'An operation runs right after the plan, or after the merge, before your steps after it.';
    expect(validatePipeline(['plan', 'build', 'operate', ...REVIEW_TAIL])).toContain(placed);
    expect(
      validatePipeline([
        'plan',
        'build',
        'checks',
        'agent_review',
        'your_review',
        'operate',
        'pull_request',
        'merge',
      ])
    ).toContain(placed);
    expect(validatePipeline(['plan', 'build', ...REVIEW_TAIL.slice(0, -1), 'operate', 'merge'])).toContain(
      placed
    );
    expect(validatePipeline(['operate', 'plan', 'build', ...REVIEW_TAIL])).toContain(placed);
  });

  test('reviews and pull requests need a code change, and only one inquiry step is allowed', () => {
    expect(validatePipeline(['answer', 'pull_request'])).toContain(
      'Checks, reviews, pull requests and merges need a code change.'
    );
    expect(validatePipeline(['answer', 'investigate'])).toContain(
      'A task answers, researches or investigates, not more than one of them.'
    );
  });

  test('a proposal grows an inquiry into the inquiry, your OK and a whole change', () => {
    expect(resolveProposalUpgrade(SHAPE_PIPELINES.investigate)).toEqual([
      'investigate',
      'your_ok',
      ...CHANGE,
    ]);
    expect(validatePipeline(resolveProposalUpgrade(SHAPE_PIPELINES.answer))).toEqual([]);
    expect(resolveProposalUpgrade(['research', 'your_ok', 'plan', 'operate'])).toEqual([
      'research',
      'your_ok',
      ...CHANGE,
    ]);
    expect(() => resolveProposalUpgrade(CHANGE)).toThrow('no step that answers');
    expect(resolveInquiryStep(CHANGE)).toBeNull();
    expect(resolveInquiryStep(SHAPE_PIPELINES.fix)).toBe('investigate');
  });

  test('a task without chosen steps reads as a change, and an Ask task as an answer', () => {
    expect(resolveTaskPipeline({ mode: 'ask' })).toEqual(['answer']);
    expect(resolveTaskShape({})).toBe('change');
    expect(resolveTaskShape({ pipeline: [] })).toBe('change');
    expect(resolveTaskShape({ pipeline: ['research'] })).toBe('research');
    expect(hasStep({ mode: 'build' }, 'pull_request')).toBe(true);
    expect(hasStep({ mode: 'ask' }, 'pull_request')).toBe(false);
  });
});

const REVIEW_TAIL: PipelineStep[] = ['checks', 'agent_review', 'your_review', 'pull_request', 'merge'];
const FRESH = { pipeline: [...CHANGE] };

describe('finding the inquiry and the work of a pipeline', () => {
  test('finds the step that is there and refuses a pipeline without one', () => {
    expect(findInquiryStep(SHAPE_PIPELINES.investigate)).toBe('investigate');
    expect(findWorkStep(SHAPE_PIPELINES.operation)).toBe('operate');
    expect(() => findInquiryStep(SHAPE_PIPELINES.change)).toThrow('This task has no step that answers');
    expect(() => findWorkStep(SHAPE_PIPELINES.answer)).toThrow(
      'This task has no step that builds or operates.'
    );
  });
});

describe('composed steps', () => {
  test('the agent can compose steps no preset has, from the same building blocks', () => {
    const compositions: PipelineStep[][] = [
      ['investigate', 'your_ok', 'plan', 'operate'],
      ['research', 'your_ok', 'plan', 'build', ...REVIEW_TAIL],
      ['answer', 'your_ok', 'plan', 'operate'],
      ['investigate', 'your_ok', 'plan', 'build', ...REVIEW_TAIL],
    ];
    for (const steps of compositions) {
      expect(validateComposition(FRESH, steps), steps.join(',')).toEqual([]);
      expect(resolvePresetOf(steps)).toBeNull();
    }
    expect(resolveShapeOf(compositions[0] ?? [])).toBe('operation');
    expect(resolveShapeOf(compositions[1] ?? [])).toBe('change');
    expect(resolveWorkStep(compositions[0] ?? [])).toBe('operate');
    expect(resolveWorkStep(compositions[1] ?? [])).toBe('build');
    expect(resolveWorkStep(SHAPE_PIPELINES.research)).toBeNull();
  });

  test('a pull request without review, or a merge without a pull request, is refused', () => {
    expect(validateComposition(FRESH, ['plan', 'build', 'checks', 'pull_request', 'merge'])).toEqual([
      'A code change goes through your review, a pull request and the merge.',
      'A pull request opens only after your review.',
      'A code change gets an independent agent review: put `agent_review` after `checks`.',
    ]);
    expect(
      validateComposition(FRESH, ['plan', 'build', 'checks', 'agent_review', 'your_review', 'merge'])
    ).toEqual([
      'A code change goes through your review, a pull request and the merge.',
      'A merge needs a pull request first.',
    ]);
  });

  test('an investigation that leads to a change and then an operation still needs your OK', () => {
    expect(validateComposition(FRESH, ['investigate', 'plan', 'build', ...REVIEW_TAIL, 'operate'])).toEqual([
      "An investigation turns into a change or an operation only with the human's OK: put `your_ok` between `investigate` and `plan`.",
    ]);
  });

  test('an inquiry that leads to a plan needs your OK, unless it already ran', () => {
    expect(validateComposition(FRESH, ['research', 'plan', 'build', ...REVIEW_TAIL])).toEqual([
      "Research turns into a change or an operation only with the human's OK: put `your_ok` between `research` and `plan`.",
    ]);
    const investigated = {
      pipeline: [...SHAPE_PIPELINES.fix],
      result: { step: 'investigate' as const, body: 'Found it.', runId: null, at: 1 },
    };
    expect(validateComposition(investigated, ['investigate', 'plan', 'operate'])).toEqual([]);
    expect(validateComposition(investigated, ['plan', 'operate'])).toEqual([
      'An investigation already ran, so `investigate` stays in the steps.',
    ]);
    expect(
      validateComposition(
        { result: { step: 'answer', body: 'Yes.', runId: null, at: 1 }, pipeline: ['answer'] },
        ['research']
      )
    ).toEqual(['An answer already ran, so `answer` stays in the steps.']);
  });

  test('your OK sits between an inquiry and a plan', () => {
    expect(validatePipeline(['your_ok', 'plan', 'operate'])).toEqual([
      'Your OK follows an answer, research or an investigation.',
    ]);
    expect(validatePipeline(['investigate', 'your_ok'])).toEqual([
      'Your OK decides whether the work goes on, so a plan follows it.',
    ]);
    expect(validatePipeline(['investigate', 'plan', 'your_ok', 'operate'])).toContain(
      'The steps are out of order.'
    );
  });

  test('pipelines compare step by step, and a task knows when an agent set its steps', () => {
    expect(isSamePipeline(CHANGE, [...CHANGE])).toBe(true);
    expect(isSamePipeline(CHANGE, SHAPE_PIPELINES.fix)).toBe(false);
    expect(resolvePresetOf(SHAPE_PIPELINES.fix)).toBe('fix');
    expect(isComposedByAgent({})).toBe(false);
    expect(
      isComposedByAgent({
        shapeChanges: [{ from: [...CHANGE], to: ['answer'], by: 'agent', reason: '', at: 0 }],
      })
    ).toBe(true);
    expect(isInquiryDone({ result: { step: 'answer', body: 'Yes.', runId: null, at: 1 } }, 'answer')).toBe(
      true
    );
    expect(isInquiryDone({ result: null }, 'research')).toBe(false);
  });
});

describe('whether a task’s steps are settled', () => {
  const AUTO = { shape: true, start: true, priority: true };

  test('triage has not chosen the steps while an auto task has no pipeline in triage', () => {
    expect(resolveShapeState({ stage: 'triage', auto: AUTO, plan: null })).toBe('triage');
    expect(resolveShapeState({ stage: 'triage', auto: AUTO, pipeline: [], plan: null })).toBe('triage');
  });

  test('the agent may still change the steps of an auto task that plans first, until it plans or composes', () => {
    const planning = { stage: 'planning' as const, auto: AUTO, pipeline: [...CHANGE], plan: null };
    expect(resolveShapeState(planning)).toBe('agent');
    expect(resolveShapeState({ ...planning, stage: 'waiting_on_tasks' })).toBe('agent');
    expect(
      resolveShapeState({
        ...planning,
        shapeChanges: [{ from: [...CHANGE], to: [...CHANGE], by: 'agent', reason: '', at: 0 }],
      })
    ).toBe('settled');
  });

  test('a task whose kind was chosen, an inquiry, or a task past planning has settled steps', () => {
    expect(resolveShapeState({ stage: 'triage', auto: { ...AUTO, shape: false }, plan: null })).toBe(
      'settled'
    );
    expect(resolveShapeState({ stage: 'triage', auto: AUTO, pipeline: ['answer'], plan: null })).toBe(
      'settled'
    );
    expect(resolveShapeState({ stage: 'building', auto: AUTO, pipeline: [...CHANGE], plan: null })).toBe(
      'settled'
    );
  });

  test('the agent never composes your steps around the merge; Shinsa adds them from the work report', () => {
    expect(validateComposition(FRESH, [...CHANGE.slice(0, -1), 'pre_merge', 'merge', 'post_merge'])).toEqual([
      'Shinsa adds `pre_merge` and `post_merge` from the steps around the merge in your work report; leave them out.',
    ]);
    expect(resolvePresetOf([...CHANGE, 'post_merge'])).toBe('change');
  });
});
