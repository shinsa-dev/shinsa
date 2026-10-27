import { isShellFence, resolveFenceCommand } from '@/lib/terminal/command.ts';

export type CodeCorner = 'centre' | 'top';

const PLAIN_LANGUAGES = new Set(['text', 'txt', 'plain', 'plaintext']);

const DOLLAR_PROMPT = /^(\s*)\$ /;

export function countCodeLines(text: string) {
  return text.replace(/\n+$/, '').split('\n').length;
}

export function resolveCodeCorner(text: string): CodeCorner {
  return countCodeLines(text) === 1 ? 'centre' : 'top';
}

function isPromptedPlainText(code: string, language: string | null) {
  if (language !== null && !PLAIN_LANGUAGES.has(language.toLowerCase())) return false;
  const first = code.split('\n').find((line) => line.trim());
  return first !== undefined && DOLLAR_PROMPT.test(first);
}

function isCommandBlock(code: string, language: string | null) {
  return isShellFence(language) || isPromptedPlainText(code, language);
}

export function isRunnableFence(meta: string | null | undefined) {
  return meta?.split(/\s+/).includes('run') ?? false;
}

export function resolveBlockCommand(code: string, language: string | null, runnable: boolean) {
  return runnable ? resolveFenceCommand(code, language) : null;
}

export function resolveBlockCopy(code: string, language: string | null) {
  if (!isCommandBlock(code, language)) return code;
  return code
    .split('\n')
    .map((line) => line.replace(DOLLAR_PROMPT, '$1'))
    .join('\n');
}
