export function pluralise(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function quote(title: string) {
  return `“${title}”`;
}

export function listTitles(titles: string[]) {
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
}

export function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function lowerFirst(text: string) {
  const [first = ''] = text.split(/\s/, 1);
  if (/[A-Z]/.test(first.slice(1))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function describeUnblocks(count: number) {
  return `unblocks ${count} other ${count === 1 ? 'task' : 'tasks'}`;
}
