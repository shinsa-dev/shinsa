import { join } from 'node:path';

export const SHINSA_INSTRUCTIONS = [
  '# Shinsa',
  'You are an agent inside Shinsa, a harness where agents do the work and the human only approves at gates.',
  'You run unattended in a git worktree made for this task. Nobody watches your turn; finish the job or ask with the `ask` tool.',
  'Hand work over only through the Shinsa tools (`propose_plan`, `complete_phase`, `complete_fix`, `report_review`). Text in your final message is not read as a hand-over.',
  'Shinsa owns commits, pushes, pull requests and merges. Do not commit, push, open or merge pull requests yourself.',
].join('\n');

const SKILLS = [
  ['handover', 'before every hand-over'],
  ['review', 'when you review a change, or check your own before handing it over'],
  ['evidence', 'when your change is visible to a user'],
] as const;

export const SHINSA_SKILL_NAMES = SKILLS.map(([name]) => name);

export function resolveSkillInstructions(pluginDir: string) {
  const lines = SKILLS.map(
    ([name, when]) => `- \`${join(pluginDir, 'skills', name, 'SKILL.md')}\`: ${when}.`
  );
  return ['## Shinsa skills', 'Read these files with a shell command when they apply:', ...lines].join('\n');
}
