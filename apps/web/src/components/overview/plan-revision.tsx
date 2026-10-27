import type { Task } from '@shinsa/core';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { resolvePlanVersion } from '@/lib/overview/plan-version.ts';

export function PlanRevision({ task }: { task: Task }) {
  const version = resolvePlanVersion(task);
  if (!version) return null;
  return (
    <div className='corner-superellipse/1.125 flex flex-col gap-2 rounded-lg bg-bg-a1 px-3 py-2.5 text-xs'>
      {version.feedback && (
        <div className='flex flex-col gap-px'>
          <span className='text-2xs text-fg-2'>You asked</span>
          <InlineMarkdown text={version.feedback} className='selectable text-fg-3' />
        </div>
      )}
      <div className='flex flex-col gap-px'>
        <span className='text-2xs text-fg-2'>What changed</span>
        {version.summary && <InlineMarkdown text={version.summary} className='selectable text-fg-4' />}
      </div>
      {version.changes.length > 0 && (
        <ul className='flex flex-col gap-px text-fg-3'>
          {version.changes.map((change) => (
            <li key={change} className='flex gap-1.5'>
              <span className='text-fg-2'>·</span>
              <InlineMarkdown text={change} className='selectable' />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
