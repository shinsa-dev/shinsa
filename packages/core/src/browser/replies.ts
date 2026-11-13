import type { Gate } from '../domain/index.ts';
import { resolveSupersededReply } from '../prompts/index.ts';
import type { SignInCheck, SignInCheckFailure } from './schema.ts';
import { isSameOrigin } from './site.ts';

type AnsweredGate = Pick<Gate, 'status' | 'decision' | 'supersededBy' | 'browserSignIn'>;

const WITHDRAWN_REPLY = 'The sign-in request was withdrawn. Carry on without signing in, or ask again later.';

const CHECK_FAILURE: Record<SignInCheckFailure, string> = {
  not_installed: 'Google Chrome is not installed',
  launch_failed: 'the shared browser did not start',
  signing_in: 'the sign-in window was still open',
  profile_in_use: 'another program was using the shared browser profile',
  timeout: 'the page did not load in time',
  failed: 'the shared browser did not answer',
};

function resolveSite(gate: Pick<Gate, 'browserSignIn'>) {
  return gate.browserSignIn?.site ?? 'the site';
}

function resolveSignedInReply(gate: AnsweredGate, check: SignInCheck) {
  const site = resolveSite(gate);
  const requested = gate.browserSignIn?.url ?? '';
  if (check.kind === 'unchecked')
    return `The human says they signed your project’s shared browser in to ${site}, but I could not check it: ${CHECK_FAILURE[check.reason]}. Open the page again; if it still asks you to sign in, ask again with \`request_browser_sign_in\`.`;
  if (isSameOrigin(requested, check.url))
    return `The human signed your project’s shared browser in to ${site}: ${requested} now opens ${check.url}. Open the page again and carry on. It stays signed in for later tasks of this project too.`;
  return `The shared browser is still not signed in to ${site}: ${requested} sends it to ${check.url}. Copying a sign-in carries cookies only, and a session an app keeps in its page storage (a local dev server's, for one) belongs to that exact address, port included. Ask again with \`request_browser_sign_in\` at that exact address and ask the human to use Open sign-in window, or carry on without it and say in your hand-over what you could not check.`;
}

export function resolveBrowserSignInReply(gate: AnsweredGate | undefined, check: SignInCheck) {
  if (!gate) return WITHDRAWN_REPLY;
  if (gate.status === 'answered' && gate.decision === 'reject')
    return `The human skipped signing in to ${resolveSite(gate)}. Carry on without it, and say in your hand-over what you could not check.`;
  if (gate.status === 'answered') return resolveSignedInReply(gate, check);
  if (gate.supersededBy) return resolveSupersededReply(gate.supersededBy);
  return WITHDRAWN_REPLY;
}

export function resolveBrowserSignInResumePrompt(gate: AnsweredGate, check: SignInCheck) {
  return [
    `You asked the human to sign your project’s shared browser in to ${resolveSite(gate)}.`,
    '',
    resolveBrowserSignInReply(gate, check),
  ].join('\n');
}
