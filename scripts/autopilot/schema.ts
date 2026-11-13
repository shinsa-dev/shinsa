import { Schema } from 'effect';
import type { AutopilotBenchmark } from '../../packages/core/src/index.ts';

export class BenchmarkFailed extends Schema.TaggedError<BenchmarkFailed, { readonly brand: unique symbol }>()(
  'BenchmarkFailed',
  { message: Schema.String }
) {}

export interface BenchmarkReplay {
  source: string;
  events: number;
  unreadable: number;
  benchmark: AutopilotBenchmark;
}
