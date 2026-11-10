import { Schema } from 'effect';

export const Usd = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('Usd'));
export type Usd = typeof Usd.Type;

export const Percent = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('Percent'));
export type Percent = typeof Percent.Type;

export const AMOUNT_UNCHECKED = { disableChecks: true } as const;
