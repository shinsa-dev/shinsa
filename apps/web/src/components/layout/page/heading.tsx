import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

export const PAGE_TITLE = 'text-balance font-medium text-base text-fg-4 leading-tight';

export const PAGE_DESCRIPTION = 'max-w-2xl text-pretty text-fg-2 text-xs';

export function PageHeading({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-px', className)}>
      <h1 className={PAGE_TITLE}>{title}</h1>
      {description &&
        (typeof description === 'string' ? <p className={PAGE_DESCRIPTION}>{description}</p> : description)}
    </div>
  );
}
