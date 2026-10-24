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
  const kilobytes = Math.round(size / 1024);
  if (kilobytes < 1024) return `${kilobytes} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function endSentence(text: string) {
  return /[.?!…]["”’')\]]*$/.test(text) ? text : `${text}.`;
}

export function flattenWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}
