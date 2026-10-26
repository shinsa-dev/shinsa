import { HUMAN_ONLY_SETTINGS } from '@shinsa/core';
import { SURFACE } from '../surface/index.ts';

interface ForbiddenCommand {
  pattern: RegExp;
  reason: string;
}

const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;

const BUT = String.raw`(?:^|[;&|(\n]|\$\()\s*(?:\w+=\S*\s+)*but(?:\s+(?:-C\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HUMAN_ONLY_COMMANDS = SURFACE.filter((spec) => spec.humanOnly).map((spec) =>
  spec.path.map(escapeRegExp).join(String.raw`\s+`)
);

function listForbiddenCommands(defaultBranch: string): ForbiddenCommand[] {
  return [
    {
      pattern: new RegExp(String.raw`\bshinsa\s+(?:${HUMAN_ONLY_COMMANDS.join('|')})(?![\w-])`),
      reason:
        'Only the human runs this command: it decides at a gate, gives a secret, signs in, changes accounts, MCP servers, skills or plugins, opens a task in the browser or sends a raw command. Tell them what you need; it waits for them in Shinsa.',
    },
    {
      pattern: new RegExp(
        String.raw`\bshinsa\s+settings\s+set\b[^;&|\n]*?(?<![\w-])(?:${HUMAN_ONLY_SETTINGS.join('|')})(?![\w-])`
      ),
      reason:
        'Only the human changes this setting: plan approval, the merge method, budgets and usage limits, resuming, account switching, fast mode and delegations at once. Tell them what you would change and why.',
    },
    {
      pattern: /\bshinsa\s+repos\s+update\b[^;&|\n]*?\s--(?:no-)?(?:checks|waive-checks|workspace)(?![\w-])/,
      reason:
        'Only the human changes a repository’s check commands, works without checks or chooses where agents work. Tell them what you would change and why.',
    },
    {
      pattern: /\bgh\s+pr\s+(merge|create)\b/,
      reason: 'Shinsa opens and merges pull requests; the human approves merges.',
    },
    {
      pattern: new RegExp(`${GIT}(commit|push|rebase|reset\\s+--hard)\\b`),
      reason: 'Shinsa commits and pushes when you hand over. Do not rewrite history.',
    },
    {
      pattern: new RegExp(`${GIT}pull\\b(?![^;&|\\n]*--no-rebase)`),
      reason:
        'Never rebase: bring the base branch in with `git fetch origin <branch>` and `git merge origin/<branch>`, or `git pull --no-rebase`.',
    },
    {
      pattern: new RegExp(
        `${GIT}(checkout|switch)\\s+(-[a-zA-Z]\\s+)?${escapeRegExp(defaultBranch)}(?![\\w./-])`
      ),
      reason: 'Stay on the task branch.',
    },
    {
      pattern: new RegExp(
        `${BUT}(?!(?:status|diff|show|help|resolve\\s+(?:conflicts|apply|status))(?![\\w-])|-)`
      ),
      reason:
        'In a GitButler workspace Shinsa commits, pushes and moves branches, and only the human updates it. Read it with `but status`, `but diff` and `but show`, and resolve a conflicted commit in place with `but resolve conflicts` and `but resolve apply`.',
    },
  ];
}

export function resolveForbiddenReason(command: string, defaultBranch: string) {
  return listForbiddenCommands(defaultBranch).find((rule) => rule.pattern.test(command))?.reason ?? null;
}
