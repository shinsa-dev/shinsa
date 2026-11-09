import { BROWSER_SIGN_IN_LIMITS, resolveSignInSite } from '../browser/index.ts';
import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/index.ts';
import { resolveTaskProject } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { findCurrentRun } from './runs.ts';

export function requestBrowserSignIn(decider: Decider, command: CommandOf<'agent.request_browser_sign_in'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'request_browser_sign_in');
  const existing = decider.state.gates[command.gateId];
  if (existing?.runId === run.id) return;
  if (existing)
    throw new DomainError({ code: 'gate_exists', message: `Gate ${command.gateId} already exists.` });
  if (!resolveTaskProject(decider.state, task))
    throw new DomainError({
      code: 'browser_no_project',
      message:
        'This task belongs to no project, so it has no shared browser to sign in. Carry on without signing in, or ask the human with `ask`.',
    });
  const url = command.url.trim();
  const site = url.length <= BROWSER_SIGN_IN_LIMITS.url ? resolveSignInSite(url) : null;
  const reason = command.reason.trim().slice(0, BROWSER_SIGN_IN_LIMITS.reason);
  if (!site || !reason)
    throw new DomainError({
      code: 'browser_sign_in_invalid',
      message: 'Give the full http or https address of the sign-in page, and say why you need to sign in.',
    });
  decider.openGate(task.id, 'browser_sign_in', `Sign in to ${site}`, reason, {
    id: command.gateId,
    runId: run.id,
    details: { browserSignIn: { url, site } },
  });
}
