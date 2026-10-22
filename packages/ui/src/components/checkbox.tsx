import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      className={cn(
        'peer relative flex size-4.5 shrink-0 items-center justify-center rounded-md bg-bg-3 text-primary-foreground transition-[background-color,box-shadow,opacity,scale] duration-150 ease-out',
        'not-data-disabled:cursor-pointer after:absolute after:-inset-x-3 after:-inset-y-2',
        'outline-none',
        'not-data-disabled:active:scale-95 not-data-disabled:data-[pressed]:scale-95 data-checked:bg-primary-4',
        // A wrapping <label> forwards clicks but not :active, so press it too.
        'not-data-disabled:[label:active_&]:scale-95',
        'group-has-disabled/field:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'aria-invalid:not-data-checked:ring-1 aria-invalid:not-data-checked:ring-red-4',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot='checkbox-indicator'
        className='grid place-content-center text-current transition-none [&>svg]:size-3.5'
      >
        <Icon name='IconCheckmark1' className='size-3.5 rotate-[4deg] opacity-100' />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
