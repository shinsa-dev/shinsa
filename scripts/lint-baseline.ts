import { Schema } from 'effect';
import { BASELINE_RULES, type BaselineRule } from './lint-effect.ts';

export const BASELINE_FILE = 'scripts/lint-baseline.json';

const Counts = Schema.Record(Schema.String, Schema.Int);

export const Baseline = Schema.Struct({
  throw: Counts,
  'try-catch': Counts,
  'null-return': Counts,
  'json-parse': Counts,
  timer: Counts,
});
export type Baseline = typeof Baseline.Type;

export const BaselineText = Schema.fromJsonString(Baseline);

type Found = {
  readonly file: string;
  readonly line: number;
  readonly rule: BaselineRule;
  readonly message: string;
};

type Problem = { readonly file: string; readonly line: number; readonly message: string };

export function countViolations(found: readonly Found[]): Baseline {
  const counts: Record<BaselineRule, Record<string, number>> = {
    throw: {},
    'try-catch': {},
    'null-return': {},
    'json-parse': {},
    timer: {},
  };
  for (const { rule, file } of found) counts[rule][file] = (counts[rule][file] ?? 0) + 1;
  return counts;
}

function listFiles(...records: Record<string, number>[]) {
  return [...new Set(records.flatMap((record) => Object.keys(record)))].sort();
}

export function listBaselineProblems(found: readonly Found[], baseline: Baseline): Problem[] {
  const counts = countViolations(found);
  const problems: Problem[] = [];
  for (const rule of BASELINE_RULES) {
    for (const file of listFiles(counts[rule], baseline[rule])) {
      const now = counts[rule][file] ?? 0;
      const allowed = baseline[rule][file] ?? 0;
      if (now > allowed) {
        const note = ` (${BASELINE_FILE} allows ${allowed} ${rule} in this file, found ${now})`;
        for (const violation of found)
          if (violation.rule === rule && violation.file === file)
            problems.push({ file, line: violation.line, message: `${violation.message}${note}` });
      }
      if (now < allowed)
        problems.push({
          file,
          line: 1,
          message: `This file has ${now} ${rule} where ${BASELINE_FILE} allows ${allowed}. Lower the entry to ${now} so it stays fixed, or run bun scripts/lint-conventions.ts --write-baseline`,
        });
    }
  }
  return problems;
}

export function listBaselineRises(current: Baseline, base: Baseline, baseRef: string): Problem[] {
  const problems: Problem[] = [];
  for (const rule of BASELINE_RULES) {
    for (const file of Object.keys(current[rule]).sort()) {
      const now = current[rule][file] ?? 0;
      const before = base[rule][file] ?? 0;
      if (now <= before) continue;
      problems.push({
        file: BASELINE_FILE,
        line: 1,
        message: `The ${rule} entry for ${file} is ${now}, higher than ${before} on ${baseRef}. The baseline only shrinks: fix the new ${rule} instead (the effect skill → Lint)`,
      });
    }
  }
  return problems;
}

export function serializeBaseline(baseline: Baseline) {
  const sorted = Object.fromEntries(
    BASELINE_RULES.map((rule) => [
      rule,
      Object.fromEntries(
        Object.entries(baseline[rule])
          .filter(([, count]) => count > 0)
          .sort(([a], [b]) => a.localeCompare(b))
      ),
    ])
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
