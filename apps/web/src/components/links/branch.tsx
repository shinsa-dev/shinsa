import type { ShinsaState, Task } from '@shinsa/core';
import { GlyphLabel, InAppLink, InlineMark, SMART_LINK } from '@/components/links/link.tsx';
import { InfoHeader, InfoPopover } from '@/components/overlays/info-popover.tsx';
import { resolveBranchBase } from '@/lib/tasks/branch.ts';
import { resolveTaskPath } from '@/router.ts';

export function BranchDetails({ state, task }: { state: ShinsaState; task: Task }) {
  if (!task.branch) return null;
  const from = resolveBranchBase(state, task);
  return (
    <InfoHeader
      title={<span className='break-all font-mono'>{task.branch}</span>}
      description={from ? `Branched from ${from}` : undefined}
    />
  );
}

export function BranchChip({ state, task, name }: { state: ShinsaState; task: Task | null; name: string }) {
  const content = <GlyphLabel glyph={<InlineMark icon='IconBranch' />} text={name} className='font-mono' />;
  if (!task) return <span className='font-medium text-fg-4'>{content}</span>;
  return (
    <InfoPopover
      className='max-w-72'
      render={<InAppLink path={resolveTaskPath(task)} className={SMART_LINK} />}
      trigger={content}
    >
      <BranchDetails state={state} task={task} />
      <p className='border-border border-t px-3 py-2 text-2xs text-fg-2'>The branch of {task.title}.</p>
    </InfoPopover>
  );
}
