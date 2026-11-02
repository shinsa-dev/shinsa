import { type Effect, Schema } from 'effect';
import type { SqlClient, SqlError } from 'effect/sql';

export interface LogMigration {
  readonly name: string;
  readonly migrate: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>;
}

export const LOG_BASELINE = 15;

export const UserVersionRow = Schema.Struct({ userVersion: Schema.Int });

export const AnyEventRow = Schema.Struct({ seq: Schema.Int });

export class LogVersionError extends Schema.TaggedError<LogVersionError, { readonly brand: unique symbol }>()(
  'LogVersionError',
  { message: Schema.String, version: Schema.Int }
) {}
