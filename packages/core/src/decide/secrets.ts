import type { CommandOf } from '../commands/index.ts';
import { DomainError, type GateDecision, SCHEDULE_LIMITS, SECRET_REF_PATTERN } from '../domain/index.ts';
import type { Decider } from './decider.ts';
import { findCurrentRun } from './runs.ts';

export function requestSecret(decider: Decider, command: CommandOf<'agent.request_secret'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'request_secret');
  const existing = decider.state.gates[command.gateId];
  if (existing?.runId === run.id) return;
  if (existing) throw new DomainError('gate_exists', `Gate ${command.gateId} already exists.`);
  const label = command.label.trim().slice(0, SCHEDULE_LIMITS.secretLabel);
  const reason = command.reason.trim().slice(0, SCHEDULE_LIMITS.secretReason);
  if (!label || !reason) throw new DomainError('secret_invalid', 'Name the secret and say what it is for.');
  decider.openGate(task.id, 'secret', reason, '', {
    id: command.gateId,
    runId: run.id,
    details: { secret: { label } },
  });
}

export function assertSecretAnswer(decision: GateDecision, response: string | null) {
  if (decision === 'reject') return;
  if (decision === 'reply' && response !== null && SECRET_REF_PATTERN.test(response)) return;
  throw new DomainError(
    'secret_answer_invalid',
    'Paste the secret into the secret field. It goes straight to Shinsa’s secret store and never into the chat.'
  );
}
