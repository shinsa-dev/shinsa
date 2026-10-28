import { cn } from '@shinsa/ui/lib/utils';
import type { SVGProps } from 'react';
import { DEFAULT_ICON_RADIUS, ICON_PATHS, type IconName, type IconRadius } from './paths';

/**
 * The three icon sizes (globals.css → `--icon-size-*`). Without one, an icon
 * takes `--icon-size`: what its primitive sets (a Button, Badge, menu row, tab),
 * else `sm`.
 */
export type IconSize = 'sm' | 'md' | 'lg';

export const ICON_SIZE_CLASS: Record<IconSize, string> = {
  sm: 'size-(--icon-size-sm)',
  md: 'size-(--icon-size-md)',
  lg: 'size-(--icon-size-lg)',
};

export const ICON_SIZE_CONTEXT: Record<IconSize, string> = {
  sm: '[--icon-size:var(--icon-size-sm)]',
  md: '[--icon-size:var(--icon-size-md)]',
  lg: '[--icon-size:var(--icon-size-lg)]',
};

// `name` and `radius` both exist on SVGProps with looser types — ours win.
type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'radius'> & {
  name: IconName;
  size?: IconSize;
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
 *
 * Colour: an icon draws in `--icon-color`, the solid icon ink its text's
 * colour utility sets (`icon-N` beside `fg-N`, the tone itself beside a tone);
 * see globals.css. Never an opacity.
 *
 * Chevrons and crosses always draw in the `sm` box: the generator scales them
 * to one ink size (7.7px), so they match wherever they sit.
 */
export function Icon({ name, size, radius, ariaLabel, className, children: _children, ...props }: IconProps) {
  const ariaHidden = ariaLabel === undefined ? true : undefined;
  const variants = ICON_PATHS[name];
  const chevron = name.startsWith('IconChevron');
  const glyph = chevron || name.startsWith('IconCross');
  const implicitRadius: IconRadius = chevron ? '0' : DEFAULT_ICON_RADIUS;
  const resolved = radius ?? implicitRadius;
  const inner = variants[resolved] ?? variants[DEFAULT_ICON_RADIUS] ?? '';
  return (
    <svg
      data-slot='icon'
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(
        'shrink-0',
        glyph ? ICON_SIZE_CLASS.sm : size ? ICON_SIZE_CLASS[size] : 'size-(--icon-size)',
        className
      )}
      {...props}
      // Paths are generated at build time from the icon package — never user input.
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

export { ICON_NAMES } from './paths';
export type { IconName, IconRadius };
