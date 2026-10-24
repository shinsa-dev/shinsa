import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

function EmptyState({
  icon,
  title,
  description,
  size = 'default',
  className,
  children,
}: {
  icon: IconName;
  title: string;
  description?: string;
  size?: 'default' | 'sm';
  className?: string;
  children?: React.ReactNode;
}) {
  const small = size === 'sm';
  return (
    <div
      data-slot='empty-state'
      data-size={size}
      className={cn(
        'flex flex-1 flex-col items-center justify-center text-center',
        small ? 'gap-2 p-6' : 'gap-2.5 p-8',
        className
      )}
    >
      <div data-slot='empty-state-media' className={cn('relative', small ? 'mb-0.5' : 'mb-1')}>
        <span
          aria-hidden
          className='absolute bottom-px left-0 size-full origin-bottom-left -translate-x-1.5 -rotate-12 scale-88 rounded-lg bg-bg-2 shadow-[inset_0_0_0_1px_var(--bg-3)]'
        />
        <span
          aria-hidden
          className='absolute right-0 bottom-px size-full origin-bottom-right translate-x-1.5 rotate-12 scale-88 rounded-lg bg-bg-2 shadow-[inset_0_0_0_1px_var(--bg-3)]'
        />
        <span
          className={cn(
            'relative flex items-center justify-center rounded-lg bg-bg-2 text-fg-3 shadow-[inset_0_0_0_1px_var(--bg-4)]',
            small ? 'size-8' : 'size-9'
          )}
        >
          <Icon name={icon} size={small ? 'md' : 'lg'} />
        </span>
      </div>
      <div className='flex flex-col gap-px'>
        <h2
          className={cn('text-balance font-medium text-fg-4 leading-tighter', small ? 'text-xs' : 'text-sm')}
        >
          {title}
        </h2>
        {description && <p className={cn('max-w-md text-pretty text-fg-2', 'text-xs')}>{description}</p>}
      </div>
      {children}
    </div>
  );
}

export { EmptyState };
