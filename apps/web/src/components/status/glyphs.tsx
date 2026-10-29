import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Pulse } from '@/components/status/pulse.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import {
  resolveGateGlyph,
  resolveGateStatus,
  resolveStageLabel,
  resolveTaskGlyph,
  resolveTaskStatus,
  resolveWorkingGlyph,
} from '@/lib/tasks/status.ts';

const PULSE_CUTOUT = '[mask-image:radial-gradient(circle_at_18px_2px,transparent_5px,black_5.5px)]';

export function GateGlyph({ gate }: { gate: Gate }) {
  const glyph = resolveGateGlyph(gate);
  return <StatusTile {...glyph} label={resolveGateStatus(gate).label} />;
}

export function TaskGlyph({ state, task }: { state: ShinsaState; task: Task }) {
  return <StatusTile {...resolveTaskGlyph(state, task)} label={resolveTaskStatus(state, task).label} />;
}

export function WorkingGlyph({ task }: { task: Task }) {
  return (
    <span className='relative grid size-5 shrink-0 place-items-center'>
      <StatusTile
        {...resolveWorkingGlyph(task)}
        label={resolveStageLabel(task)}
        detail='Agent working'
        className={PULSE_CUTOUT}
      />
      <Pulse className='pointer-events-none absolute -top-px -right-px' />
    </span>
  );
}
