import { PROTOCOL_LIMITS, type Repo } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatCount } from '@/lib/format/count.ts';

export type BaselineMode = 'none' | 'commands';

export interface BaselineItem {
  value: BaselineMode;
  label: string;
  hint: string;
  icon: MenuItemIcon;
}

export const BASELINE_TITLE = 'Always run before review';

export const BASELINE_DIALOG = {
  title: BASELINE_TITLE,
  description:
    'Shinsa runs these commands in the task’s worktree once the last phase is built, beside the checks the agent chose, before the agent review. Leave it empty and nothing extra runs.',
  label: 'Commands',
  hint: 'One per line. Keep them quick: CI runs the whole suite on the pull request.',
  placeholder: 'bun run check-types',
  action: 'Save',
} as const;

export function resolveBaselineMode(repo: Pick<Repo, 'checkCommands'>): BaselineMode {
  return repo.checkCommands.length > 0 ? 'commands' : 'none';
}

export function listBaselineItems(repo: Pick<Repo, 'checkCommands'>): BaselineItem[] {
  const count = repo.checkCommands.length;
  return [
    {
      value: 'none',
      label: 'Nothing before review',
      hint: 'Only the checks the agent chose for the task run.',
      icon: 'IconCircleMinus',
    },
    {
      value: 'commands',
      label:
        count > 0 ? `${formatCount(count, 'command', 'commands')} before review` : 'Commands before review…',
      hint: 'Your commands run before every review, beside the agent’s checks.',
      icon: 'IconConsole',
    },
  ];
}

export function parseBaselineCommands(text: string) {
  return [...new Set(text.split('\n').map((line) => line.trim()))].filter(Boolean);
}

export function validateBaselineCommands(commands: readonly string[]) {
  const long = commands.find((command) => command.length > PROTOCOL_LIMITS.checkCommand);
  if (long) return `“${long.slice(0, 40)}…” is longer than ${PROTOCOL_LIMITS.checkCommand} characters.`;
  if (commands.length > PROTOCOL_LIMITS.checks) return `Keep it to ${PROTOCOL_LIMITS.checks} commands.`;
  return null;
}

export function describeBaselineChange(repo: Pick<Repo, 'name'>, commands: readonly string[]) {
  if (commands.length === 0) return `No review commands in ${repo.name}.`;
  return `${formatCount(commands.length, 'review command', 'review commands')} in ${repo.name}.`;
}

export function changeBaseline(repo: Repo, commands: readonly string[]) {
  if (JSON.stringify(repo.checkCommands) === JSON.stringify(commands)) return Promise.resolve(true);
  return sendCommandWithToast(
    { type: 'repo.update', repoId: repo.id, patch: { checkCommands: [...commands] } },
    describeBaselineChange(repo, commands)
  );
}
