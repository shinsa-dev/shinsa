import { Schema } from 'effect';

const Time = Schema.Number;

export const ForecastAccount = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  left: Schema.Number,
  resetsAt: Schema.NullOr(Time),
});

export type ForecastAccount = typeof ForecastAccount.Type;

export const ForecastPoint = Schema.Struct({
  at: Time,
  left: Schema.Number,
});

export type ForecastPoint = typeof ForecastPoint.Type;

export const ForecastSegment = Schema.Struct({
  accountId: Schema.String,
  from: Time,
  to: Time,
  left: Schema.Number,
});

export type ForecastSegment = typeof ForecastSegment.Type;

export const ForecastReset = Schema.Struct({
  accountId: Schema.String,
  at: Time,
  leftBefore: Schema.Number,
});

export type ForecastReset = typeof ForecastReset.Type;

export const UsageForecast = Schema.Struct({
  from: Time,
  to: Time,
  accounts: Schema.Array(ForecastAccount),
  segments: Schema.Array(ForecastSegment),
  resets: Schema.Array(ForecastReset),
  points: Schema.Array(ForecastPoint),
  safePace: Schema.Number,
  tightest: Schema.NullOr(ForecastReset),
  currentPace: Schema.NullOr(Schema.Number),
  runsOutAt: Schema.NullOr(Time),
});

export type UsageForecast = typeof UsageForecast.Type;
