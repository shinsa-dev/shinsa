interface CodexPrice {
  input: number;
  cachedInput: number | null;
  cacheWrite: number | null;
  output: number;
  longContextOutput: number | null;
}

export interface CodexTokens {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

interface CodexPricing {
  longContext: boolean;
  fast: boolean;
}

export const LONG_CONTEXT_INPUT_TOKENS = 272_000;

const PER_MILLION = 1_000_000;

function flat(input: number, cachedInput: number | null, output: number, cacheWrite: number | null = null) {
  return { input, cachedInput, cacheWrite, output, longContextOutput: null };
}

function tiered(
  input: number,
  cachedInput: number | null,
  cacheWrite: number | null,
  output: number,
  longContextOutput: number
) {
  return { input, cachedInput, cacheWrite, output, longContextOutput };
}

export const CODEX_PRICES: Readonly<Record<string, CodexPrice>> = {
  'gpt-5': flat(1.25, 0.125, 10),
  'gpt-5-codex': flat(1.25, 0.125, 10),
  'gpt-5-mini': flat(0.25, 0.025, 2),
  'gpt-5-nano': flat(0.05, 0.005, 0.4),
  'gpt-5-pro': flat(15, null, 120),
  'gpt-5.1': flat(1.25, 0.125, 10),
  'gpt-5.1-codex': flat(1.25, 0.125, 10),
  'gpt-5.1-codex-max': flat(1.25, 0.125, 10),
  'gpt-5.1-codex-mini': flat(0.25, 0.025, 2),
  'gpt-5.2': flat(1.75, 0.175, 14),
  'gpt-5.2-codex': flat(1.75, 0.175, 14),
  'gpt-5.2-pro': flat(21, null, 168),
  'gpt-5.3-codex': flat(1.75, 0.175, 14),
  'gpt-5.4': tiered(2.5, 0.25, null, 15, 22.5),
  'gpt-5.4-mini': flat(0.75, 0.075, 4.5),
  'gpt-5.4-nano': flat(0.2, 0.02, 1.25),
  'gpt-5.4-pro': tiered(30, null, null, 180, 270),
  'gpt-5.5': tiered(5, 0.5, null, 30, 45),
  'gpt-5.5-pro': tiered(30, null, null, 180, 270),
  'gpt-5.5-cyber': flat(12.5, 1.25, 75),
  'gpt-5.6-sol': tiered(4, 0.4, 5, 20, 30),
  'gpt-5.6-terra': tiered(2, 0.2, 2.5, 12, 18),
  'gpt-5.6-luna': tiered(0.2, 0.02, 0.25, 1.2, 1.8),
  'gpt-5.6-cyber': flat(12.5, 1.25, 75, 15.625),
  'gpt-6-astra': tiered(10, 1, 12.5, 50, 75),
  'gpt-6-sol': tiered(2, 0.2, 2.5, 10, 15),
  'gpt-6.1-sol': tiered(2, 0.1, 2.5, 10, 15),
  'gpt-6-luna': tiered(0.1, 0.01, 0.125, 0.5, 0.75),
};

const CODEX_ALIASES: Readonly<Record<string, string>> = {
  'gpt-5.6': 'gpt-5.6-sol',
  'gpt-reserve': 'gpt-5.6-luna',
  'gpt-daybreak-blue-latest': 'gpt-5.6-sol',
  'gpt-daybreak-red-latest': 'gpt-5.6-cyber',
};

const FAST_MULTIPLIERS: Readonly<Record<string, number>> = {
  'gpt-5.4': 2,
  'gpt-5.4-mini': 2,
  'gpt-5.5': 2.5,
  'gpt-5.6-sol': 2,
  'gpt-5.6-terra': 2,
  'gpt-5.6-luna': 2,
  'gpt-6-astra': 2,
};

const FAST_LONG_CONTEXT = new Set(['gpt-6-astra']);

export function resolveCodexPriceModel(model: string) {
  const bare = model
    .trim()
    .replace(/^openai\//, '')
    .replace(/\[.*\]$/, '');
  const aliased = CODEX_ALIASES[bare] ?? bare;
  if (CODEX_PRICES[aliased]) return aliased;
  const undated = aliased.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  return CODEX_PRICES[undated] ? undated : null;
}

function resolveRates(price: CodexPrice, longContext: boolean) {
  const tier = longContext && price.longContextOutput !== null ? 2 : 1;
  const input = price.input * tier;
  return {
    input,
    cachedInput: price.cachedInput === null ? input : price.cachedInput * tier,
    cacheWrite: price.cacheWrite === null ? input : price.cacheWrite * tier,
    output: tier === 2 ? (price.longContextOutput as number) : price.output,
  };
}

export function resolveCodexCost(model: string | null, tokens: CodexTokens, pricing: CodexPricing) {
  const key = model ? resolveCodexPriceModel(model) : null;
  const price = key ? CODEX_PRICES[key] : undefined;
  if (!key || !price) return null;
  let multiplier = 1;
  if (pricing.fast) {
    const fast = FAST_MULTIPLIERS[key];
    if (fast === undefined || (pricing.longContext && !FAST_LONG_CONTEXT.has(key))) return null;
    multiplier = fast;
  }
  const rates = resolveRates(price, pricing.longContext);
  const dollars =
    tokens.inputTokens * rates.input +
    tokens.cacheReadTokens * rates.cachedInput +
    tokens.cacheWriteTokens * rates.cacheWrite +
    tokens.outputTokens * rates.output;
  return (dollars * multiplier) / PER_MILLION;
}

const MINUTE_MS = 60_000;

const SHORT_CACHE_MS = 5 * MINUTE_MS;

const LONG_CACHE_MS = 30 * MINUTE_MS;

export function resolveCacheLifetimeMs(model: string | null) {
  const version = model ? /^gpt-(\d+)(?:\.(\d+))?/.exec(resolveCodexPriceModel(model) ?? model.trim()) : null;
  if (!version) return SHORT_CACHE_MS;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 6) ? LONG_CACHE_MS : SHORT_CACHE_MS;
}
