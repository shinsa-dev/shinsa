export function stripInlineMarkdown(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`|\*\*/g, '')
    .trim();
}

export function stripMarkdown(text: string) {
  return text
    .split('\n')
    .map((line) => stripInlineMarkdown(line.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+)/, '')))
    .join('\n');
}
