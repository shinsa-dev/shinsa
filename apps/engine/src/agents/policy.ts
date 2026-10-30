import { HUMAN_ONLY_SETTINGS, isWholeSuiteCommand } from '@shinsa/core';
import { HUMAN_ONLY_ENGINE_COMMANDS } from '../cli/engine.ts';
import { SURFACE } from '../surface/index.ts';

interface ForbiddenCommand {
  pattern: RegExp;
  reason: string;
}

const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;

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
      pattern: new RegExp(String.raw`\bshinsa\s+(?:${HUMAN_ONLY_ENGINE_COMMANDS.join('|')})(?![\w-])`),
      reason:
        'Only the human stops or restarts Shinsa’s engine: it is what runs you. Tell them why it needs a restart.',
    },
    {
      pattern: new RegExp(
        String.raw`\bshinsa\s+settings\s+set\b[^;&|\n]*?(?<![\w-])(?:${HUMAN_ONLY_SETTINGS.join('|')})(?![\w-])`
      ),
      reason:
        'Only the human changes this setting: plan approval, the merge method, budgets and usage limits, resuming, account switching, fast mode and delegations at once. Tell them what you would change and why.',
    },
    {
      pattern:
        /\bshinsa\s+repos\s+update\b[^;&|\n]*?\s--(?:no-)?(?:checks|workspace|coverage(?:-command|-report|-format)?)(?![\w-])/,
      reason:
        'Only the human changes a repository’s check commands, chooses where agents work or sets how test coverage is measured. Tell them what you would change and why.',
    },
    {
      pattern: /\/(?:api|ws)\/(?:terminals|services)(?![\w-])/,
      reason:
        'Only the human types into their terminals and runs their services. Put the command in a ```bash run block in your question to them, and they can run it in a terminal with one press.',
    },
    {
      pattern: /\bdata\/remote\.json\b/,
      reason:
        'remote.json holds the keys for reaching this machine from anywhere. Agents never read or change it; remote access is the human’s, in Settings.',
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
  ];
}

const WHOLE_SUITE_REASON =
  'This runs the whole suite, which is slow and slows every other agent on this machine. Run the test files or folders you changed (`bun test src/parser`), or your task’s checks; Shinsa runs the checks itself after you hand over, and CI runs the whole suite on the pull request.';

export function resolveForbiddenReason(command: string, defaultBranch: string) {
  const rule = listForbiddenCommands(defaultBranch).find((forbidden) => forbidden.pattern.test(command));
  if (rule) return rule.reason;
  return isWholeSuiteCommand(command) ? WHOLE_SUITE_REASON : null;
}
