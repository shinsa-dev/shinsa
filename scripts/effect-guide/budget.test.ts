import { describe, expect, test } from 'bun:test';
import { Option, Result } from 'effect';
import {
  Percent,
  type Spend,
  Usd,
  applyCharge,
  resolveBudgetLabel,
  resolveBudgetState,
  resolveSpend,
  selectBudgetShare,
} from './budget.ts';

const spend = (spent: number, budget: number): Spend => ({
  spent: Usd.make(spent),
  budget: Usd.make(budget),
});

describe('pure code stays plain: Option, Result, Match and brands, never an effect', () => {
  test('text from outside decodes to a branded shape or a tagged error as a Result', () => {
    expect(resolveSpend('{"spent":3,"budget":10}')).toEqual(Result.succeed(spend(3, 10)));
    const notJson = resolveSpend('{');
    const negative = resolveSpend('{"spent":-1,"budget":10}');
    expect(Result.isFailure(notJson) && notJson.failure._tag).toBe('SpendInvalid');
    expect(Result.isFailure(negative) && negative.failure.message).toContain('spent');
  });

  test('a share that may not exist is an Option, never null', () => {
    expect(selectBudgetShare(spend(5, 0))).toEqual(Option.none());
    expect(selectBudgetShare(spend(5, 10))).toEqual(Option.some(Percent.make(50)));
    expect(selectBudgetShare(spend(30, 10))).toEqual(Option.some(Percent.make(100)));
  });

  test('every state of the union is matched exhaustively', () => {
    expect(resolveBudgetLabel(resolveBudgetState(spend(5, 0)))).toBe('No budget');
    expect(resolveBudgetLabel(resolveBudgetState(spend(5, 10)))).toBe('50% of the budget used');
    expect(resolveBudgetLabel(resolveBudgetState(spend(30, 10)))).toBe('Over budget');
  });

  test('a charge returns both sides as a Result the caller must handle', () => {
    expect(applyCharge(spend(5, 10), Usd.make(2))).toEqual(Result.succeed(spend(7, 10)));
    expect(applyCharge(spend(5, 0), Usd.make(20))).toEqual(Result.succeed(spend(25, 0)));
    const over = applyCharge(spend(5, 10), Usd.make(8));
    expect(Result.isFailure(over) && over.failure.overBy).toBe(Usd.make(3));
  });

  test('a brand refuses a value outside its check', () => {
    expect(() => Percent.make(140)).toThrow();
    expect(() => Usd.make(-1)).toThrow();
  });
});
