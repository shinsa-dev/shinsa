import { describeInline, type Style } from './style.ts';

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches the escape codes the styles write
const STYLE_CODE = /\u001b\[[0-9;]*m/g;

const WORD = /(?:`[^`]*`|[^\s`])+|`/g;

export function stripStyles(text: string) {
  return text.replace(STYLE_CODE, '');
}

export function measureWidth(text: string) {
  return [...stripStyles(text)].length;
}

export function padText(text: string, width: number) {
  return `${text}${' '.repeat(Math.max(0, width - measureWidth(text)))}`;
}

export function truncateText(text: string, width: number, ellipsis = '…') {
  const characters = [...text];
  if (characters.length <= width) return text;
  if (width <= ellipsis.length) return characters.slice(0, width).join('');
  return `${characters
    .slice(0, width - ellipsis.length)
    .join('')
    .trimEnd()}${ellipsis}`;
}

export function wrapText(style: Style, text: string, width: number | null) {
  const words = (text.match(WORD) ?? []).map((word) => describeInline(style, word));
  if (width === null) return [words.join(' ')];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && measureWidth(line) + 1 + measureWidth(word) > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines;
}

export function shortenHome(path: string, home: string | undefined) {
  if (!home || home === '/') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const SENTENCE_BREAK = /(?<=[.?!])\s+(?=\S)/;

export function splitHint(message: string) {
  const sentences = message.split(SENTENCE_BREAK);
  const at = sentences.findIndex((sentence, index) => index > 0 && sentence.includes('`'));
  if (at === -1) return { message, hint: null };
  return { message: sentences.slice(0, at).join(' '), hint: sentences.slice(at).join(' ') };
}
