import { cn } from '@shinsa/ui/lib/utils';
import type { SVGProps } from 'react';
import { DEFAULT_ICON_RADIUS, ICON_PATHS, type IconName, type IconRadius } from './paths';

// `name` and `radius` both exist on SVGProps with looser types — ours win.
type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'radius'> & {
  name: IconName;
  size?: string | number;
  radius?: IconRadius;
  ariaLabel?: string;
};

/**
 * Central Icons — the only icon set in the system.
 *
 * Paths are pre-rendered into `paths.ts` by `scripts/generate-icons.ts`, which
 * scans the repo for `name='Icon…'` usages, so the bundle only ever carries
 * icons we actually reference. Add a new icon by using its name, then run
 * `bun run --cwd packages/ui generate:icons`.
 */
export function Icon({
  name,
  size = 24,
  radius,
  ariaLabel,
  className,
  children: _children,
  ...props
}: IconProps) {
  const ariaHidden = ariaLabel === undefined ? true : undefined;
  const variants = ICON_PATHS[name];
  const implicitRadius: IconRadius = name.startsWith('IconChevron') ? '0' : DEFAULT_ICON_RADIUS;
  const resolved = radius ?? implicitRadius;
  const inner = variants[resolved] ?? variants[DEFAULT_ICON_RADIUS] ?? '';
  return (
    <svg
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      // An icon sits a step under its text: `--icon-alpha` (85%, a menu row's 90%,
      // globals.css). A caller's own opacity (a reveal, a swap) wins.
      className={cn('opacity-(--icon-alpha)', className)}
      {...props}
      // Paths are generated at build time from the icon package — never user input.
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

export { ICON_NAMES } from './paths';
export type { IconName, IconRadius };
