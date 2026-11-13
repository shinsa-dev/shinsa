import { Option } from 'effect';
import { type NightShift, resolveNightShift } from '../costs/away.ts';
import type { RunPurpose, RunRole, Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';

const NIGHT_SHIFT_TOLD: Record<NightShift, string> = {
  unattended:
    '\n\nAuto pace is on and has no room to build this task now, so it will probably build later, while the human is away. Ask every question the build needs now, while you plan: once building starts, nobody may be there to answer.',
  night:
    '\n\nThe human is usually away at this hour, and Auto pace is building this task while they are. Do not stop to ask: decide what you can from the plan and the code, record each choice in your hand-over (as a judgement call for a phase, in the summary for a fix), and use `ask` only for what you must not decide alone, such as a destructive step or a secret.',
};

export function resolveNightShiftTold(
  state: ShinsaState,
  task: Task,
  role: RunRole,
  purpose: RunPurpose | null,
  now: number
) {
  return Option.match(resolveNightShift(state, task, role, purpose, now), {
    onNone: () => '',
    onSome: (shift) => NIGHT_SHIFT_TOLD[shift],
  });
}
