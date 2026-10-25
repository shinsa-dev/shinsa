import type { Run } from '../domain/index.ts';
import { splitHouseRules } from './rules.ts';

export type FixFocus = 'checks' | 'review' | 'changes' | 'pull_request' | 'conflicts';

const FIX_OPENINGS: readonly (readonly [string, FixFocus])[] = [
  ['The checks failed', 'checks'],
  ['The agent review found', 'review'],
  ['The human looked at the work', 'changes'],
  ['Pull request #', 'pull_request'],
  ['GitButler left', 'conflicts'],
  ['Your pull request conflicted', 'conflicts'],
];

export function resolveFixFocus(run: Pick<Run, 'purpose' | 'prompt' | 'rolePrompt'>): FixFocus | null {
  if (run.purpose !== 'fix') return null;
  const prompt = run.rolePrompt ?? run.prompt ?? '';
  const instruction = splitHouseRules(prompt)?.instruction ?? prompt;
  return FIX_OPENINGS.find(([opening]) => instruction.startsWith(opening))?.[1] ?? null;
}
