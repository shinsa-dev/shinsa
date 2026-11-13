import type { CSSProperties } from 'react';

const RING_MASK = 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))';

function resolveRingStyle(value: number, ready: boolean): CSSProperties {
  const fill = ready ? 'var(--color-primary)' : 'color-mix(in oklab, var(--color-primary) 60%, transparent)';
  return {
    background: `conic-gradient(${fill} ${value}%, var(--color-bg-a2) 0)`,
    mask: RING_MASK,
  };
}

export function ScoreGauge({ value, label, ready }: { value: number; label: string; ready: boolean }) {
  return (
    <span className='relative grid size-10 shrink-0 place-items-center'>
      <meter min={0} max={100} value={value} aria-label={label} className='sr-only' />
      <span aria-hidden className='absolute inset-0 rounded-full' style={resolveRingStyle(value, ready)} />
      <span aria-hidden className='text-xs font-medium text-fg-4 tabular-nums'>
        {value}
      </span>
    </span>
  );
}
