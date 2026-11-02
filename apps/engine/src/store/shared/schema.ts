import { Schema } from 'effect';
import { camelToSnake, snakeToCamel } from 'effect/String';

export const SQL_NAMES = { transformQueryNames: camelToSnake, transformResultNames: snakeToCamel };

export const StoredJson = Schema.fromJsonString(Schema.Unknown);

export const StoredRecord = Schema.Record(Schema.String, Schema.Unknown);

export interface StoredPayloadMessages {
  readonly notJson: string;
  readonly mismatched: string;
}
