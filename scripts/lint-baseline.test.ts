import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import {
  BASELINE_FILE,
  type Baseline,
  BaselineText,
  countViolations,
  listBaselineProblems,
  listBaselineRises,
  serializeBaseline,
} from './lint-baseline.ts';
import type { BaselineRule } from './lint-effect.ts';

const empty: Baseline = { throw: {}, 'try-catch': {}, 'null-return': {}, 'json-parse': {}, timer: {} };

const found = (file: string, rule: BaselineRule, line: number) => ({ file, rule, line, message: rule });

describe('the baseline holds each file to its count', () => {
  test('violations are counted per rule and per file', () => {
    expect(
      countViolations([found('a.ts', 'throw', 1), found('a.ts', 'throw', 4), found('b.ts', 'timer', 2)])
    ).toEqual({ ...empty, throw: { 'a.ts': 2 }, timer: { 'b.ts': 1 } });
  });

  test('a file at its count passes', () => {
    const baseline = { ...empty, throw: { 'a.ts': 2 } };
    expect(listBaselineProblems([found('a.ts', 'throw', 1), found('a.ts', 'throw', 4)], baseline)).toEqual(
      []
    );
  });

  test('a file over its count reports every line of that rule, with the count it may have', () => {
    const baseline = { ...empty, throw: { 'a.ts': 1 } };
    const note = ` (${BASELINE_FILE} allows 1 throw in this file, found 2)`;
    expect(
      listBaselineProblems(
        [found('a.ts', 'throw', 1), found('a.ts', 'throw', 4), found('a.ts', 'timer', 9)],
        { ...baseline, timer: { 'a.ts': 1 } }
      )
    ).toEqual([
      { file: 'a.ts', line: 1, message: `throw${note}` },
      { file: 'a.ts', line: 4, message: `throw${note}` },
    ]);
  });

  test('a new file with a violation has no entry, so it fails', () => {
    expect(listBaselineProblems([found('new.ts', 'json-parse', 3)], empty)).toEqual([
      {
        file: 'new.ts',
        line: 3,
        message: `json-parse (${BASELINE_FILE} allows 0 json-parse in this file, found 1)`,
      },
    ]);
  });

  test('a file under its count fails until the entry is lowered', () => {
    expect(listBaselineProblems([found('a.ts', 'timer', 2)], { ...empty, timer: { 'a.ts': 3 } })).toEqual([
      {
        file: 'a.ts',
        line: 1,
        message: `This file has 1 timer where ${BASELINE_FILE} allows 3. Lower the entry to 1 so it stays fixed, or run bun scripts/lint-conventions.ts --write-baseline`,
      },
    ]);
    expect(listBaselineProblems([], { ...empty, 'null-return': { 'gone.ts': 1 } })).toHaveLength(1);
  });
});

describe('the baseline only shrinks against the base branch', () => {
  const base = { ...empty, throw: { 'a.ts': 2, 'b.ts': 1 } };

  test('an entry that stays or drops passes, and so does one the base never had at zero', () => {
    expect(listBaselineRises({ ...empty, throw: { 'a.ts': 2 } }, base, 'origin/main')).toEqual([]);
    expect(listBaselineRises({ ...empty, throw: { 'a.ts': 1, 'c.ts': 0 } }, base, 'origin/main')).toEqual([]);
  });

  test('a raised entry or a new one fails, naming the rule, the file and the base', () => {
    expect(
      listBaselineRises({ ...empty, throw: { 'a.ts': 3 }, timer: { 'c.ts': 1 } }, base, 'origin/main')
    ).toEqual([
      {
        file: BASELINE_FILE,
        line: 1,
        message:
          'The throw entry for a.ts is 3, higher than 2 on origin/main. The baseline only shrinks: fix the new throw instead (the effect skill → Lint)',
      },
      {
        file: BASELINE_FILE,
        line: 1,
        message:
          'The timer entry for c.ts is 1, higher than 0 on origin/main. The baseline only shrinks: fix the new timer instead (the effect skill → Lint)',
      },
    ]);
  });
});

describe('the baseline file', () => {
  test('is written with every rule, files sorted and zero counts dropped, and reads back the same', () => {
    const text = serializeBaseline({ ...empty, throw: { 'b.ts': 1, 'a.ts': 2, 'c.ts': 0 } });
    expect(text).toBe(
      `${JSON.stringify(
        { throw: { 'a.ts': 2, 'b.ts': 1 }, 'try-catch': {}, 'null-return': {}, 'json-parse': {}, timer: {} },
        null,
        2
      )}\n`
    );
    expect(Schema.decodeUnknownResult(BaselineText)(text)).toEqual(
      Result.succeed({ ...empty, throw: { 'a.ts': 2, 'b.ts': 1 } })
    );
  });

  test('a file without every rule, or with a count that is not a whole number, is refused', () => {
    expect(Result.isFailure(Schema.decodeUnknownResult(BaselineText)('{"throw":{}}'))).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(BaselineText)(
          serializeBaseline(empty).replace('"timer": {}', '"timer": {"a": 1.5}')
        )
      )
    ).toBe(true);
  });
});
