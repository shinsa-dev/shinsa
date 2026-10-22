export function formatCount(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatSteps(count: number) {
  return formatCount(count, 'step', 'steps');
}

export function formatLines(count: number) {
  return formatCount(count, 'line', 'lines');
}

export function formatLineRange(start: number, end: number) {
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function lowerFirst(text: string) {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

export function endSentence(text: string) {
  return /[.?!…]$/.test(text) ? text : `${text}.`;
}

export function flattenWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}
