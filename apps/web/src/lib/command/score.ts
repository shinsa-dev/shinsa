export const FALLBACK_PREFIX = 'fallback:';

const FALLBACK_SCORE = 0.05;

const SECONDARY_WEIGHT = 0.7;

function scoreText(text: string, word: string): number {
  const lowered = text.toLowerCase();
  if (lowered === word) return 1;
  if (lowered.startsWith(word)) return 0.9;
  if (lowered.split(/[\s/._:#-]+/).some((part) => part.startsWith(word))) return 0.8;
  if (lowered.includes(word)) return 0.5;
  return 0;
}

export function scoreCommand(value: string, search: string, keywords: string[] = []): number {
  if (value.startsWith(FALLBACK_PREFIX)) return FALLBACK_SCORE;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const [label = value, ...rest] = keywords;
  let total = 0;
  for (const word of words) {
    const own = scoreText(label, word);
    const borrowed = rest.reduce(
      (top, keyword) => Math.max(top, scoreText(keyword, word) * SECONDARY_WEIGHT),
      0
    );
    const best = Math.max(own, borrowed);
    if (best === 0) return 0;
    total += best;
  }
  return total / words.length;
}
