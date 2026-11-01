import { resolveShimmerDuration } from '@shinsa/ui/lib/shimmer';
import { cn } from '@shinsa/ui/lib/utils';
import type { ComponentProps, CSSProperties } from 'react';

export type ShimmeringTextProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The text to render with the shimmering effect. */
  text: string;
  /**
   * Seconds the band takes to cross a short line; a long line is crossed at
   * a steady pace per character instead.
   * @defaultValue 1
   */
  duration?: number;
  /**
   * Hold the text still.
   * @defaultValue false
   */
  paused?: boolean;
};

/**
 * A line of text with a band of brighter colour sweeping across it, for work
 * in progress. The text renders once; a copy of it in the brighter colour
 * shows through a band that crosses the line (`shimmer-window` and
 * `shimmer-copy` in globals.css). The band crosses the positioned box the
 * line sits in, so a line cut off by its own box ends its sweep at the
 * ellipsis, and a parent that truncates can make itself that box with
 * `relative` while the text takes `static`. The sweep is clipped to that box,
 * so it never adds to a parent's scroll width and a `Truncate` around it still
 * sees only the text.
 */
export function ShimmeringText({
  text,
  duration = 1,
  paused = false,
  className,
  style,
  ...props
}: ShimmeringTextProps) {
  const timing = {
    '--shimmer-duration': `${resolveShimmerDuration(text.length, duration)}s`,
  } as CSSProperties;

  return (
    <span
      data-slot='shimmering-text'
      data-paused={paused || undefined}
      className={cn(
        'relative inline-block select-none whitespace-nowrap',
        '[--color:var(--muted-foreground)] [--shimmering-color:var(--foreground)]',
        '[color:var(--color)]',
        className
      )}
      style={{ ...timing, ...style }}
      {...props}
    >
      {text}
      {!paused && (
        <span aria-hidden className='pointer-events-none absolute inset-0 overflow-clip motion-reduce:hidden'>
          <span className='shimmer-window block size-full overflow-hidden'>
            <span className='shimmer-copy block truncate [color:var(--shimmering-color)]'>{text}</span>
          </span>
        </span>
      )}
    </span>
  );
}
