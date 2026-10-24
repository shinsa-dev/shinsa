import { cn } from '@shinsa/ui/lib/utils';
import { TONE_FILL, type Tone } from '@/lib/format/tone.ts';

export function Pulse({ tone = 'blue', className }: { tone?: Tone; className?: string }) {
  return (
    <span aria-hidden className={cn('relative flex size-1.5 shrink-0', className)}>
      <span
        className={cn(
          'absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none',
          TONE_FILL[tone]
        )}
      />
      <span className={cn('relative size-full rounded-full', TONE_FILL[tone])} />
    </span>
  );
}
