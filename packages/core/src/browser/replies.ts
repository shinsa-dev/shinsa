import type { Gate } from '../domain/index.ts';
import { resolveSupersededReply } from '../prompts/index.ts';

type AnsweredGate = Pick<Gate, 'status' | 'decision' | 'supersededBy' | 'browserSignIn'>;

const WITHDRAWN_REPLY = 'The sign-in request was withdrawn. Carry on without signing in, or ask again later.';

function resolveSite(gate: Pick<Gate, 'browserSignIn'>) {
  return gate.browserSignIn?.site ?? 'the site';
}

export function resolveBrowserSignInReply(gate: AnsweredGate | undefined) {
  if (!gate) return WITHDRAWN_REPLY;
  const site = resolveSite(gate);
  if (gate.status === 'answered' && gate.decision === 'reject')
    return `The human skipped signing in to ${site}. Carry on without it, and say in your hand-over what you could not check.`;
  if (gate.status === 'answered')
    return `The human signed your project’s shared browser in to ${site}. Open the page again and carry on. It stays signed in for later tasks of this project too.`;
  if (gate.supersededBy) return resolveSupersededReply(gate.supersededBy);
  return WITHDRAWN_REPLY;
}

export function resolveBrowserSignInResumePrompt(gate: AnsweredGate) {
  return [
    `You asked the human to sign your project’s shared browser in to ${resolveSite(gate)}.`,
    '',
    resolveBrowserSignInReply(gate),
  ].join('\n');
}
