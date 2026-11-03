import { describeCount } from '@shinsa/core';

export function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function formatPercent(rate: number | null) {
  return rate === null ? 'None' : `${Math.round(rate * 100)}%`;
}

export function formatSteps(count: number) {
  return describeCount(count, 'step', 'steps');
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
