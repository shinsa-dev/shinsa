import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CHIP } from '@/components/layout/surface/card.ts';
import { Markdown } from '@/components/text/markdown.tsx';
import { type PlanParameters, resolvePlanParameters } from '@/lib/overview/plan-parameters.ts';

function Parameter({
  title,
  headingClassName,
  children,
}: {
  title: string;
  headingClassName: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-1'>
      <span className={headingClassName}>{title}</span>
      {children}
    </div>
  );
}

export function PlanParameterList({
  document,
  headingClassName = 'font-medium text-fg-4 text-xs leading-5',
}: {
  document: PlanParameters;
  headingClassName?: string;
}) {
  const view = resolvePlanParameters(document);
  if (!view) return null;
  return (
    <div className='flex flex-col gap-3'>
      {view.impact && (
        <Parameter title='Impact' headingClassName={headingClassName}>
          <Markdown text={view.impact} className='text-fg-3 text-xs' />
        </Parameter>
      )}
      {view.evidence.length > 0 && (
        <Parameter title='Evidence' headingClassName={headingClassName}>
          <span className='text-fg-3 text-xs'>{view.evidence.join(' · ')}</span>
        </Parameter>
      )}
      {view.checks.length > 0 && (
        <Parameter title='Checks' headingClassName={headingClassName}>
          <ul className='flex flex-col gap-2'>
            {view.checks.map((check) => (
              <li key={check.command} className='flex min-w-0 flex-col gap-1'>
                <span className='flex min-w-0 flex-wrap items-baseline gap-x-1.5'>
                  <span className='text-fg-3 text-xs'>{check.label}</span>
                  {check.phases && <span className='text-2xs text-fg-2'>{check.phases}</span>}
                </span>
                <span className={cn(CHIP, 'selectable break-all font-mono text-2xs')}>{check.command}</span>
              </li>
            ))}
          </ul>
        </Parameter>
      )}
      {view.approval && <p className='text-2xs text-fg-2'>The agent asked for your approval.</p>}
    </div>
  );
}
