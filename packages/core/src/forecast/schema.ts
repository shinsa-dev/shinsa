import { Schema } from 'effect';

const Time = Schema.Number;

export const ForecastAccount = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  left: Schema.Number,
  resetsAt: Schema.NullOr(Time),
});

export type ForecastAccount = typeof ForecastAccount.Type;

export const ForecastOutage = Schema.Struct({
  from: Time,
  to: Time,
});

export type ForecastOutage = typeof ForecastOutage.Type;

export const ForecastSegment = Schema.Struct({
  accountId: Schema.String,
  from: Time,
  to: Time,
  left: Schema.Number,
  emptyAt: Schema.NullOr(Time),
});

export type ForecastSegment = typeof ForecastSegment.Type;

export const ForecastReset = Schema.Struct({
  accountId: Schema.String,
  at: Time,
  leftBefore: Schema.Number,
});

export type ForecastReset = typeof ForecastReset.Type;

export const ForecastTimeline = Schema.Struct({
  pace: Schema.Number,
  segments: Schema.Array(ForecastSegment),
  outages: Schema.Array(ForecastOutage),
});

export type ForecastTimeline = typeof ForecastTimeline.Type;

export const UsageForecast = Schema.Struct({
  from: Time,
  to: Time,
  accounts: Schema.Array(ForecastAccount),
  resets: Schema.Array(ForecastReset),
  safePace: Schema.Number,
  tightest: Schema.NullOr(ForecastReset),
  currentPace: Schema.NullOr(Schema.Number),
  runsOutAt: Schema.NullOr(Time),
});

export type UsageForecast = typeof UsageForecast.Type;
