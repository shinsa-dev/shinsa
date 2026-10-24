export interface Suggestion {
  line: number;
  endLine: number;
  text: string;
}

function splitLines(text: string) {
  return text.split('\n');
}

export function resolveSuggestion(original: string, edited: string): Suggestion | null {
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
  return {
    line: prefix + 1,
    endLine: before.length - suffix,
    text: after.slice(prefix, after.length - suffix).join('\n'),
  };
}

export function listSuggestionLines(original: string, suggestion: Suggestion) {
  return {
    removed: splitLines(original).slice(suggestion.line - 1, suggestion.endLine),
    added: suggestion.text === '' && suggestion.endLine >= suggestion.line ? [] : splitLines(suggestion.text),
  };
}

export function describeSuggestionLines(suggestion: Suggestion) {
  if (suggestion.endLine < suggestion.line) return `before line ${suggestion.line}`;
  if (suggestion.endLine === suggestion.line) return `line ${suggestion.line}`;
  return `lines ${suggestion.line}–${suggestion.endLine}`;
}
