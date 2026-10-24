import { Input as InputPrimitive } from '@base-ui/react/input';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

function Input({
  className,
  type,
  loading,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
  loading?: boolean;
  size?: 'sm' | 'default';
}) {
  const input = (
    <InputPrimitive
      type={type}
      data-slot='input'
      className={cn(
        'corner-superellipse/1.125 w-full min-w-0 bg-bg-2 font-medium text-fg-4 backdrop-blur-md',
        size === 'sm' ? 'h-6 rounded-control-sm px-2 text-xs' : 'h-6.5 rounded-control px-2.5 text-xs',
        'transition-[color,background-color,outline-color,box-shadow] duration-150',
        'outline-none placeholder:text-fg-2',
        'file:inline-flex file:h-5.5 file:border-0 file:bg-transparent file:font-medium file:text-fg-4 file:text-xs',
        'disabled:cursor-not-allowed disabled:text-fg-1 disabled:opacity-50',
        // A read-only field shows a hairline instead of the fill, so it reads
        // as a value to copy rather than a field to type into.
        'read-only:cursor-default read-only:border read-only:border-bg-4 read-only:text-fg-2',
        'aria-invalid:ring-1 aria-invalid:ring-red-4',
        loading === undefined ? className : 'pr-9'
      )}
      {...props}
    />
  );

  if (loading === undefined) return input;

  return (
    <span data-slot='input-frame' className={cn('relative inline-flex w-full', className)}>
      {input}
      <Spinner
        aria-hidden={!loading}
        className={cn(
          'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-2 transition-opacity duration-150',
          !loading && 'opacity-0'
        )}
      />
    </span>
  );
}

export { Input };
