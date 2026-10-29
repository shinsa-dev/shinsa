import type * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';

export function OnboardingSection({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-4'>
        <PageHeading title={title} description={description} />
        {children}
      </div>
      <div className='flex items-center justify-between gap-3'>{footer}</div>
    </section>
  );
}
