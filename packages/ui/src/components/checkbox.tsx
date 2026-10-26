'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';

type CheckboxSize = 'sm' | 'md';

type CheckboxVariant = 'filled' | 'outline';

const SIZE_CLASS: Record<CheckboxSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
};

// Unchecked is an empty box behind a quiet `icon-1` edge (`fg-1` on hover), so it reads on the page,
// a card or a hovered row in both themes; checked fills with the accent and a
// white check. The hit area reaches past the box (`after:`) so a compact box in
// a dense row stays easy to hit. The check is centred over the whole box, border
// included: at 14px the box's inside is 12px, and a 14px glyph placed there
// would sit 1px right and low.
// `outline` has no fill at rest, only its edge, for a list of boxes inside a
// popover, where a filled box on every row reads heavier than the rows
// themselves; ticked it fills like `filled`.
const VARIANT_CLASS: Record<CheckboxVariant, string> = {
  filled: [
    'bg-background text-primary-foreground',
    'data-checked:border-primary-4 data-checked:bg-primary-4',
  ].join(' '),
  outline: [
    'bg-transparent text-primary-foreground',
    'data-checked:border-primary-4 data-checked:bg-primary-4',
  ].join(' '),
};

function Checkbox({
  size = 'md',
  variant = 'filled',
  className,
  ...props
}: CheckboxPrimitive.Root.Props & { size?: CheckboxSize; variant?: CheckboxVariant }) {
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      data-variant={variant}
      className={cn(
        'peer relative inline-grid shrink-0 place-items-center rounded-checkbox border border-icon-1 outline-none',
        'not-data-disabled:cursor-pointer after:absolute after:-inset-1.5',
        'not-data-disabled:not-data-checked:hover:border-fg-1 not-data-disabled:not-data-checked:active:border-fg-1',
        'not-data-disabled:active:scale-95 not-data-disabled:[label:active_&]:scale-95',
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot='checkbox-indicator'
        className='absolute -inset-px grid place-items-center'
      >
        <Icon name='IconCheckmark1Small' size='sm' />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
