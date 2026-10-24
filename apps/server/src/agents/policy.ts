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
      pattern: /\bgh\s+pr\s+(merge|create)\b/,
      reason: 'Shinsa opens and merges pull requests; the human approves merges.',
    },
    {
      pattern: new RegExp(`${GIT}(commit|push|rebase|reset\\s+--hard)\\b`),
      reason: 'Shinsa commits and pushes when you hand over. Do not rewrite history.',
    },
    {
      pattern: new RegExp(
        `${GIT}(checkout|switch)\\s+(-[a-zA-Z]\\s+)?${escapeRegExp(defaultBranch)}(?![\\w./-])`
      ),
      reason: 'Stay on the task branch.',
    },
  ];
}

export function resolveForbiddenReason(command: string, defaultBranch: string) {
  return listForbiddenCommands(defaultBranch).find((rule) => rule.pattern.test(command))?.reason ?? null;
}
