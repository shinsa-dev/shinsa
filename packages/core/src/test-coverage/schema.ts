import { Schema, SchemaTransformation } from 'effect';
import { Choice, FIELD_MESSAGES, Id, NullByDefault, resolveChoiceMessage } from '../domain/fields.ts';
import { COVERAGE_FORMATS, COVERAGE_LIMITS, COVERAGE_MODES, type CoverageFormat } from './types.ts';

export const FORMAT_BY_EXTENSION: [RegExp, CoverageFormat][] = [
  [/(^|[/\\])lcov[^/\\]*$|\.(info|lcov)$/i, 'lcov'],
  [/\.xml$/i, 'cobertura'],
  [/\.(out|coverprofile)$/i, 'go'],
];

const COVERAGE_KEYS = {
  custom: { name: 'Custom coverage', keys: ['mode', 'command', 'report', 'format'] },
  other: { name: 'Coverage set to auto or off', keys: ['mode'] },
} as const;

const CustomCoverage = Schema.Struct({
  mode: Schema.Literal('custom'),
  command: Id(COVERAGE_LIMITS.command)
    .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim()))
    .check(Schema.isNonEmpty({ message: FIELD_MESSAGES.empty })),
  report: Id(COVERAGE_LIMITS.report)
    .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim()))
    .check(
      Schema.makeFilter(
        (report: string) =>
          report.length > 0 &&
          !report.startsWith('/') &&
          !/^[A-Za-z]:/.test(report) &&
          !report.replace(/\\/g, '/').split('/').includes('..') &&
          !report.includes('\0'),
        {
          message: 'report must be a path inside the repository, such as coverage/lcov.info.',
        }
      )
    ),
  format: NullByDefault(Choice(COVERAGE_FORMATS), resolveChoiceMessage(COVERAGE_FORMATS)),
}).check(
  Schema.makeFilter((setting) =>
    (setting.format ?? FORMAT_BY_EXTENSION.some(([pattern]) => pattern.test(setting.report.trim())))
      ? undefined
      : `Shinsa cannot tell the format of ${setting.report} from its name. Give format: lcov, cobertura or go.`
  )
);

export const CoverageSetting = Schema.StructWithRest(Schema.Struct({ mode: Choice(COVERAGE_MODES) }), [
  Schema.Record(Schema.String, Schema.Unknown),
])
  .annotate({ message: FIELD_MESSAGES.object })
  .check(
    Schema.makeFilter((record) => {
      const { name, keys } = record.mode === 'custom' ? COVERAGE_KEYS.custom : COVERAGE_KEYS.other;
      const unknown = Object.keys(record).find((key) => !keys.some((known) => known === key));
      return unknown === undefined ? undefined : `${name} cannot change ${unknown}.`;
    })
  )
  .pipe(
    Schema.decodeTo(
      Schema.Union([
        Schema.Struct({ mode: Schema.Literal('auto') }),
        Schema.Struct({ mode: Schema.Literal('off') }),
        CustomCoverage,
      ]),
      SchemaTransformation.passthrough({ strict: false })
    )
  )
  .annotateKey({ messageMissingKey: FIELD_MESSAGES.object });

export type CoverageSetting = typeof CoverageSetting.Type;

export const DEFAULT_COVERAGE: CoverageSetting = { mode: 'auto' };
