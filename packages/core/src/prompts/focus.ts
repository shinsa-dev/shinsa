import { Option } from 'effect';
import type { Run } from '../domain/index.ts';
import { splitHouseRules } from './rules.ts';

export type FixFocus = 'checks' | 'review' | 'changes' | 'pull_request' | 'conflicts' | 'push_hook';

const FIX_OPENINGS: readonly (readonly [string, FixFocus])[] = [
  ['The checks failed', 'checks'],
  ['The agent review found', 'review'],
  ['The human looked at the work', 'changes'],
  ['Pull request #', 'pull_request'],
  ['The pull request conflicts with', 'conflicts'],
  ['The branch was being updated onto', 'conflicts'],
  ["The repository's pre-push hook", 'push_hook'],
];

export function resolveFixFocus(
  run: Pick<Run, 'purpose' | 'prompt' | 'rolePrompt'>
): Option.Option<FixFocus> {
  if (run.purpose !== 'fix') return Option.none();
  const prompt = run.rolePrompt ?? run.prompt ?? '';
  const instruction = Option.match(splitHouseRules(prompt), {
    onNone: () => prompt,
    onSome: (split) => split.instruction,
  });
  return Option.fromNullishOr(FIX_OPENINGS.find(([opening]) => instruction.startsWith(opening))?.[1]);
}
