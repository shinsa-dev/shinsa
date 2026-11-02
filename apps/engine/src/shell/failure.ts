import { redactSecrets } from '../log/redact.ts';
import type { CommandResult } from './schema.ts';

export function describeFailure(command: readonly string[], result: CommandResult) {
  const reason = result.timedOut
    ? 'it ran too long and was stopped'
    : result.stderr || result.stdout || `exit ${result.code}`;
  return redactSecrets(`${command.slice(0, 3).join(' ')} failed: ${reason}`);
}
