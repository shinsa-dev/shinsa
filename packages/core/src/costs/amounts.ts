import { AMOUNT_UNCHECKED, Percent, Usd } from './schema.ts';

export function createUsd(value: number): Usd {
  return Usd.make(value, AMOUNT_UNCHECKED);
}

export function createPercent(value: number): Percent {
  return Percent.make(value, AMOUNT_UNCHECKED);
}
