import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect } from 'effect';

export interface GuardedCommand {
  command: string;
  refusal: string | null;
}

interface Policy {
  resolveForbiddenReason: (command: string, defaultBranch: string) => string | null;
}

const COMMANDS = [
  'bun run test src/onboarding',
  'git diff --stat',
  'git commit -am "split onboarding"',
  'git push origin HEAD',
  'gh pr merge 821 --squash',
  'git checkout main',
  'git reset --hard HEAD~3',
  'shinsa settings set approvePlans false',
  'shinsa tasks list --json',
];

export const listGuardedCommands = Effect.gen(function* () {
  const policyUrl = pathToFileURL(resolve(process.cwd(), '../engine/src/agents/policy.ts')).href;
  const policy = yield* Effect.promise((): Promise<Policy> => import(policyUrl));
  return COMMANDS.map((command): GuardedCommand => ({
    command,
    refusal: policy.resolveForbiddenReason(command, 'main'),
  }));
});
