export function quoteTitle(title: string) {
  return `“${title}”`;
}

export function describeTaskName(task: { handle?: string | null; title: string }) {
  return task.handle ? `${task.handle} ${quoteTitle(task.title)}` : quoteTitle(task.title);
}

export function describeCount(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeList(words: readonly string[], conjunction: 'and' | 'or' = 'and') {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words.at(-1)}`;
}

export function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function lowerFirst(text: string) {
  const [first = ''] = text.split(/\s/, 1);
  if (/[A-Z]/.test(first.slice(1))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
