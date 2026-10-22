import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's stock scales, so it can't tell that
 * `rounded-popup` replaces `rounded-control` or `shadow-control` replaces
 * `shadow-md`, and keeps both: whichever comes later in the stylesheet wins,
 * not the caller's override. The theme's own tokens (globals.css) are listed
 * here so they merge like the stock ones.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'control-sm', 'item', 'popup', 'segment'],
      shadow: [
        '1',
        '2',
        '3',
        '4',
        'control',
        'control-destructive',
        'control-elevated',
        'control-elevated-hover',
        'control-knob',
        'control-dot',
      ],
      leading: ['tighter'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
