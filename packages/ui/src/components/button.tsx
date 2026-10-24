import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { type MenuItemIcon, menuIconPosition, renderMenuIcon } from '@shinsa/ui/components/menu-icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  [
    'group/button relative isolate flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium',
    'corner-superellipse/1.125 transition-[color,opacity,scale] duration-150 ease-out',
    // Fill + shadow live on ::before so pressing deflates only the background —
    // the label, icons and layout stay fixed. The press is a fixed inset
    // (tokens in globals.css), so a full-width button presses exactly like a
    // short one.
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:content-['']",
    'before:transition-[background-color,box-shadow,inset] before:duration-150 before:ease-out',
    'not-disabled:active:before:inset-x-(--press-inset-x) not-disabled:active:before:inset-y-(--press-inset-y)',
    'not-disabled:data-[pressed]:before:inset-x-(--press-inset-x) not-disabled:data-[pressed]:before:inset-y-(--press-inset-y)',
    'outline-none',
    'disabled:cursor-not-allowed disabled:opacity-45 data-loading:pointer-events-none',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    // Chevrons are tiny glyphs in a roomy viewbox: pull them in (2px gap, 5px
    // edge padding) and draw them at 16px so they sit optically like the text.
    "data-chevron:data-[icon=inline-end]:pr-[5px] data-chevron:data-[icon=inline-start]:pl-[5px] data-chevron:gap-0.5 data-chevron:[&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'text-primary-foreground before:bg-primary',
          'before:shadow-control',
          'not-disabled:hover:before:bg-primary/80 not-disabled:active:before:bg-primary/80',
        ].join(' '),
        secondary:
          'icon-solid text-fg-2 not-disabled:hover:text-fg-4 not-disabled:hover:before:bg-bg-a2/70 not-disabled:active:text-fg-4 not-disabled:active:before:bg-bg-a2/70',
        outline: [
          'text-fg-4 before:bg-background dark:before:bg-bg-3',
          'before:shadow-control-elevated not-disabled:hover:before:shadow-control-elevated-hover not-disabled:active:before:shadow-control-elevated-hover',
          'not-disabled:active:before:bg-bg-1 not-disabled:data-[pressed]:before:bg-bg-1 dark:not-disabled:data-[pressed]:before:bg-bg-4 dark:not-disabled:active:before:bg-bg-4',
        ].join(' '),
        destructive: [
          'text-white before:bg-red-4',
          'before:shadow-control-destructive',
          'not-disabled:hover:before:bg-red-4/90 not-disabled:active:before:bg-red-4/90',
        ].join(' '),
        // No background to scale, so the content itself takes the press.
        link: [
          'text-primary-text before:hidden not-disabled:hover:opacity-80 not-disabled:active:opacity-80',
          'px-0! [backface-visibility:hidden] [will-change:scale] not-disabled:active:scale-[0.975] not-disabled:data-[pressed]:scale-[0.975]',
        ].join(' '),
      },
      // An icon on either side trims that side's padding by 2px so the glyph
      // sits optically level with the text edge.
      size: {
        xs: "h-5.5 gap-1 rounded-control-sm px-2 text-xs data-[icon=inline-end]:pr-1.5 data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-6 gap-1 rounded-control-sm px-2 text-xs data-[icon=inline-end]:pr-1.5 data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        default:
          "h-6.5 gap-1.5 rounded-control px-2.5 text-xs data-[icon=inline-end]:pr-2 data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-7.5 gap-1.5 rounded-control px-3 text-sm data-[icon=inline-end]:pr-2.5 data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4",
        'icon-xs': "icon-solid size-5.5 rounded-control-sm px-0 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': "icon-solid size-6 rounded-control-sm px-0 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "icon-solid size-6.5 rounded-control px-0 [&_svg:not([class*='size-'])]:size-4",
        'icon-lg': "icon-solid size-7.5 rounded-control px-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'primary',
  size = 'default',
  icon,
  loading = false,
  disabled,
  onClick,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    icon?: MenuItemIcon;
    /** Busy: keeps its colours and width, swaps the icon for a spinner and ignores presses and keys. */
    loading?: boolean;
  }) {
  const iconOnly = children === undefined || children === null || children === false;
  const position = menuIconPosition(icon) ?? (loading ? 'inline-start' : undefined);
  const iconName = typeof icon === 'string' ? icon : icon?.name;
  const spinner = <Spinner className={SPINNER_SIZE[size ?? 'default']} />;
  return (
    <ButtonPrimitive
      data-slot='button'
      data-icon={iconOnly ? undefined : position}
      data-chevron={!iconOnly && !loading && iconName?.startsWith('IconChevron') ? '' : undefined}
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && position === 'inline-start' ? spinner : renderMenuIcon(icon, 'inline-start')}
      {children}
      {loading && position === 'inline-end' ? spinner : renderMenuIcon(icon, 'inline-end')}
    </ButtonPrimitive>
  );
}

const SPINNER_SIZE: Record<NonNullable<VariantProps<typeof buttonVariants>['size']>, string> = {
  xs: 'size-3',
  sm: 'size-3',
  default: 'size-3.5',
  lg: 'size-4',
  'icon-xs': 'size-3',
  'icon-sm': 'size-3',
  icon: 'size-3.5',
  'icon-lg': 'size-4',
};

export { Button, buttonVariants };
