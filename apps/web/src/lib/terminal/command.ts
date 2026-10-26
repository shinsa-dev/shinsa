import { TERMINAL_LIMITS } from '@shinsa/core';

const SHELL_LANGUAGES = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'shell',
  'console',
  'shell-session',
  'terminal',
]);

const PROMPT = /^\s*[$%>]\s?/;

export function isShellFence(language: string | null) {
  return language !== null && SHELL_LANGUAGES.has(language.toLowerCase());
}

export function resolveFenceCommand(code: string, language: string | null) {
  if (!isShellFence(language)) return null;
  const lines = code.split('\n');
  const prompted = lines.filter((line) => PROMPT.test(line));
  const commands = (prompted.length > 0 ? prompted.map((line) => line.replace(PROMPT, '')) : lines)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !line.trim().startsWith('#'));
  const command = commands.join('\n');
  if (!command || command.length > TERMINAL_LIMITS.command) return null;
  return command;
}
