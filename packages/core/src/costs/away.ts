import { Option } from 'effect';
import { resolveAgentProvider } from '../agent-models/index.ts';
import { resolveAutoPace, type RunPurpose, type RunRole, type Task } from '../domain/index.ts';
import { isActiveAt, resolveActiveHours } from '../presence/hours.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveAdmissionRoom } from './admission.ts';

export type NightShift = 'unattended' | 'night';

function hasAdmissionQueue(state: ShinsaState, task: Task) {
  return Object.values(state.tasks).some((other) => {
    const wait = other.usageWait;
    return other.id !== task.id && wait?.pace?.scope === 'admission' && wait.status === 'armed';
  });
}

export function resolveNightShift(
  state: ShinsaState,
  task: Task,
  role: RunRole,
  purpose: RunPurpose | null,
  now: number
): Option.Option<NightShift> {
  if (role !== 'agent' || !resolveAutoPace(state.settings)) return Option.none();
  const away = !isActiveAt(resolveActiveHours(state, now), now);
  if (purpose === 'build' || purpose === 'fix') return away ? Option.some('night') : Option.none();
  if (purpose !== 'plan') return Option.none();
  if (away || hasAdmissionQueue(state, task)) return Option.some('unattended');
  const room = resolveAdmissionRoom(state, resolveAgentProvider(state.settings, 'agent'), now);
  return Option.exists(room, (left) => left <= 0) ? Option.some('unattended') : Option.none();
}
