import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        'corner-superellipse/1.125 field-sizing-content min-h-16 w-full rounded-lg bg-input px-2.5 py-1.5 text-fg-4 text-xs backdrop-blur-md',
        'outline-none placeholder:text-fg-2',
        'disabled:cursor-not-allowed disabled:text-fg-1 disabled:opacity-50',
        'aria-invalid:ring-1 aria-invalid:ring-red-4',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
