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
        <Parameter title='Extra checks' headingClassName={headingClassName}>
          <ul className='flex flex-col gap-1'>
            {view.checks.map((check) => (
              <li key={check} className={cn(CHIP, 'break-all font-mono text-2xs')}>
                {check}
              </li>
            ))}
          </ul>
        </Parameter>
      )}
      {view.approval && <p className='text-2xs text-fg-2'>The planner asked for your approval.</p>}
    </div>
  );
}
