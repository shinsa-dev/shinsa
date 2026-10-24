import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Pulse } from '@/components/status/pulse.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { STAGE_LABEL } from '@/lib/format/labels.ts';
import {
  resolveGateGlyph,
  resolveGateStatus,
  resolveTaskGlyph,
  resolveTaskStatus,
  resolveWorkingGlyph,
} from '@/lib/tasks/status.ts';

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
      <StatusTile {...resolveWorkingGlyph(task)} label={STAGE_LABEL[task.stage]} detail='Agent working' />
      <Pulse className='pointer-events-none absolute -top-px -right-px ring-(--glyph-ring) ring-2' />
    </span>
  );
}
