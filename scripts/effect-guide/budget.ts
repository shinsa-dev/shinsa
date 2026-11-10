import { Match, Option, Result, Schema } from 'effect';

export const Usd = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('Usd'));
export type Usd = typeof Usd.Type;

export const Percent = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })).pipe(
  Schema.brand('Percent')
);
export type Percent = typeof Percent.Type;

export const Spend = Schema.Struct({ spent: Usd, budget: Usd });
export type Spend = typeof Spend.Type;

export class SpendInvalid extends Schema.TaggedError<SpendInvalid, { readonly brand: unique symbol }>()(
  'SpendInvalid',
  { message: Schema.String }
) {}

export class BudgetExceeded extends Schema.TaggedError<BudgetExceeded, { readonly brand: unique symbol }>()(
  'BudgetExceeded',
  { overBy: Usd }
) {}

export type BudgetState =
  | { readonly _tag: 'Unlimited' }
  | { readonly _tag: 'Within'; readonly share: Percent }
  | { readonly _tag: 'Over'; readonly share: Percent };

const decodeSpendText = Schema.decodeUnknownResult(Schema.fromJsonString(Spend));

export function resolveSpend(text: string): Result.Result<Spend, SpendInvalid> {
  return Result.mapError(decodeSpendText(text), (error) => new SpendInvalid({ message: error.message }));
}

export function selectBudgetShare(spend: Spend): Option.Option<Percent> {
  if (spend.budget === 0) return Option.none();
  return Option.some(Percent.make(Math.min(100, (spend.spent / spend.budget) * 100)));
}

export function resolveBudgetState(spend: Spend): BudgetState {
  return Option.match(selectBudgetShare(spend), {
    onNone: (): BudgetState => ({ _tag: 'Unlimited' }),
    onSome: (share): BudgetState =>
      spend.spent > spend.budget ? { _tag: 'Over', share } : { _tag: 'Within', share },
  });
}

export const resolveBudgetLabel = Match.type<BudgetState>().pipe(
  Match.tagsExhaustive({
    Unlimited: () => 'No budget',
    Within: ({ share }) => `${Math.round(share)}% of the budget used`,
    Over: () => 'Over budget',
  })
);

export function applyCharge(spend: Spend, cost: Usd): Result.Result<Spend, BudgetExceeded> {
  const spent = Usd.make(spend.spent + cost);
  if (spend.budget > 0 && spent > spend.budget) {
    return Result.fail(new BudgetExceeded({ overBy: Usd.make(spent - spend.budget) }));
  }
  return Result.succeed({ ...spend, spent });
}
