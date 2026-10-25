import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  'git push origin feat/onboarding-steps',
  'gh pr merge 821 --squash',
  'git checkout main',
  'git reset --hard HEAD~3',
  'shinsa settings set approvePlans false',
  'shinsa tasks list --json',
];

export async function listGuardedCommands(): Promise<GuardedCommand[]> {
  const policyUrl = pathToFileURL(resolve(process.cwd(), '../server/src/agents/policy.ts')).href;
  const policy = (await import(policyUrl)) as Policy;
  return COMMANDS.map((command) => ({ command, refusal: policy.resolveForbiddenReason(command, 'main') }));
}
