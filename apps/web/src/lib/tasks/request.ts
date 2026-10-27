import { splitMessageAttachments, type Task } from '@shinsa/core';

const LONG_REQUEST = 160;

function normalise(text: string) {
  return text.toLowerCase().replace(/\W+/g, '');
}

export function describeRequest(task: Task) {
  const { text } = splitMessageAttachments(task.request);
  if (!text || normalise(text) === normalise(task.title)) return null;
  return { text, long: text.length > LONG_REQUEST || text.includes('\n') };
}
