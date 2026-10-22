import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';

import { cn } from '@shinsa/ui/lib/utils';

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive data-slot='radio-group' className={cn('grid w-full gap-2', className)} {...props} />
  );
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot='radio-group-item'
      className={cn(
        'group/radio-group-item peer relative flex aspect-square size-4.5 shrink-0 rounded-full bg-bg-3 transition-[background-color,box-shadow,opacity,scale] duration-150 ease-out',
        'not-data-disabled:cursor-pointer after:absolute after:-inset-x-3 after:-inset-y-2',
        'outline-none',
        'not-data-disabled:active:scale-95 not-data-disabled:data-[pressed]:scale-95 data-checked:bg-primary-4',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'aria-invalid:not-data-checked:ring-1 aria-invalid:not-data-checked:ring-red-4',
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot='radio-group-indicator'
        className='flex size-full items-center justify-center'
      >
        <span className='size-2 rounded-full bg-primary-foreground shadow-control-dot' />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
