import type { Task } from '@shinsa/core';

const LONG_INTENT = 160;

function normalise(text: string) {
  return text.toLowerCase().replace(/\W+/g, '');
}

export function describeIntent(task: Task) {
  const text = task.intent.trim();
  if (!text || normalise(text) === normalise(task.title)) return null;
  return { text, long: text.length > LONG_INTENT || text.includes('\n') };
}
