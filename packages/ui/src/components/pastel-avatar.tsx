import { type PastelVariant, resolvePastelPair, resolvePastelStop } from '@shinsa/ui/lib/avatar';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

/**
 * A generated picture for things that have no picture of their own: a pastel
 * gradient between two accent ramps picked deterministically from the seed
 * (`lib/avatar.ts`), with a soft highlight in the top corner so it reads as a
 * rounded object rather than a flat swatch. `tile` (workspaces) is a diagonal
 * blend of two hues on a superellipse; `orb` (people) is a lit sphere in a
 * single hue, always fully round. Pure CSS from the design tokens, so it
 * follows the theme. The highlight is plain white in both themes. Decorative
 * unless it gets an `aria-label`, which makes it an image with that name.
 */
function PastelAvatar({
  seed,
  variant = 'tile',
  size = 24,
  className,
  style,
  ...props
}: React.ComponentProps<'span'> & { seed: string; variant?: PastelVariant; size?: number }) {
  const [from, to] = resolvePastelPair(seed, variant);
  const labelled = props['aria-label'] !== undefined;
  return (
    <span
      data-slot='pastel-avatar'
      data-variant={variant}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden ring-1 ring-fg-a1/30',
        variant === 'orb'
          ? "rounded-full before:absolute before:inset-0 before:bg-radial-[at_32%_28%] before:from-white/60 before:to-55% before:to-transparent before:content-['']"
          : "before:absolute before:inset-0 before:bg-radial-[at_28%_22%] before:from-white/70 before:to-65% before:to-transparent before:content-['']",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundImage:
          variant === 'orb'
            ? `radial-gradient(circle at 70% 75%, ${resolvePastelStop(to, 3)}, ${resolvePastelStop(from, 3)} 85%)`
            : `linear-gradient(135deg, ${resolvePastelStop(from, 2)}, ${resolvePastelStop(to, 3)})`,
        ...style,
      }}
      {...props}
    />
  );
}

export { PastelAvatar };
