import { splitMessageAttachments, type Task } from '@shinsa/core';

export function describeSharePrompt(task: Task) {
  return [`Title: ${task.title}`, `Request:\n${splitMessageAttachments(task.request).text}`].join('\n');
}
