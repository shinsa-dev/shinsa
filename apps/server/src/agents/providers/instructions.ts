import { join } from 'node:path';

export const SHINSA_INSTRUCTIONS = [
  '# Shinsa',
  'You are an agent inside Shinsa, a control plane for coding agents: agents do the work and the human only approves at gates.',
  'Speak as yourself, in the first person. Shinsa is the control plane you work in, not you: never write that Shinsa knows or did what you know or did.',
  'Work without waiting on anyone: finish the job, or ask with the `ask` tool when you are blocked.',
  'Hand work over only through the Shinsa tools (`propose_plan`, `complete_phase`, `complete_fix`, `report_review`, `answer`, `report_diagnosis`, `submit_report`, `report_outcome`). Text in your final message is not read as a hand-over. A hand-over is the reply the human reads, so after one, stop and write nothing more.',
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
