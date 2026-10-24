import type { SuggestedChange } from '@shinsa/core';

export interface ResolvedSuggestion {
  line: number;
  endLine: number | null;
  suggestion: SuggestedChange;
}

function splitLines(text: string) {
  return text.split('\n');
}

export function resolveSuggestion(original: string, edited: string): ResolvedSuggestion | null {
  if (original === edited) return null;
  const before = splitLines(original);
  const after = splitLines(edited);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.at(-1 - suffix) === after.at(-1 - suffix)
  )
    suffix += 1;
  if (prefix + suffix === before.length || prefix + suffix === after.length) {
    if (prefix > 0) prefix -= 1;
    else suffix -= 1;
  }
  const endLine = before.length - suffix;
  return {
    line: prefix + 1,
    endLine: endLine > prefix + 1 ? endLine : null,
    suggestion: {
      original: before.slice(prefix, endLine).join('\n'),
      replacement: after.slice(prefix, after.length - suffix).join('\n'),
    },
  };
}
