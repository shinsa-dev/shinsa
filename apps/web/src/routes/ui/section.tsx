import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className='flex scroll-mt-8 flex-col gap-4'>
      <div className='flex flex-col'>
        <h2 className='font-medium text-fg-4 text-lg'>{title}</h2>
        {description && <p className='max-w-xl text-fg-2 text-sm'>{description}</p>}
      </div>
      <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </section>
  );
}

export function Specimen({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className='flex w-full flex-col items-start gap-2'>
      <span className='text-2xs text-fg-2'>{label}</span>
      <div className={cn('flex w-full flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  );
}
