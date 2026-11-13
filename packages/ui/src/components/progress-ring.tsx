import { cn } from '@shinsa/ui/lib/utils';

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type ProgressRingProps = {
  /** 0 to 100; drawn clamped, announced as given. */
  value: number;
  /** What the value measures, for assistive tech. */
  label: string;
  /** Fills in the full accent; otherwise in the accent at 60%. */
  done?: boolean;
  className?: string;
};

/**
 * A small round gauge: a 2px track in `bg-a2` with the accent arc over it,
 * round at both ends, starting at the top, and the value in its centre at 10px. Sized
 * 22px, 4px under a default button or select; the caller passes a size class to change it.
 */
function ProgressRing({ value, label, done = false, className }: ProgressRingProps) {
  const shown = Math.max(0, Math.min(100, value));
  return (
    <span
      data-slot='progress-ring'
      className={cn('relative grid size-5.5 shrink-0 place-items-center', className)}
    >
      <meter min={0} max={100} value={value} aria-label={label} className='sr-only' />
      <svg aria-hidden viewBox='0 0 22 22' className='absolute inset-0 size-full -rotate-90'>
        <circle cx='11' cy='11' r={RADIUS} fill='none' strokeWidth='2' className='stroke-bg-a2' />
        {shown > 0 && (
          <circle
            cx='11'
            cy='11'
            r={RADIUS}
            fill='none'
            strokeWidth='2'
            strokeLinecap='round'
            strokeDasharray={`${(shown / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            className={cn(
              'transition-[stroke-dasharray] duration-500 ease-out',
              done ? 'stroke-primary' : 'stroke-primary/60'
            )}
          />
        )}
      </svg>
      <span aria-hidden className='text-[10px] leading-none font-medium text-fg-3 tabular-nums'>
        {value}
      </span>
    </span>
  );
}

export { ProgressRing };
