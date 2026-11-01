import type { ShinsaState, Task } from '@shinsa/core';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { PullRequestBadge } from '@/components/tasks/pull-request-badge.tsx';
import { resolveOverviewPanelId } from '@/lib/preferences/disclosure.ts';
import {
  BUNDLE_ICON,
  BUNDLE_MEMBER,
  type BundleRow,
  describeBundleNote,
  describeBundleProgress,
  listBundleRows,
} from '@/lib/tasks/bundles.ts';

function BundleMember({ state, row, index }: { state: ShinsaState; row: BundleRow; index: number }) {
  const status = BUNDLE_MEMBER[row.state];
  return (
    <li className='flex min-w-0 items-center gap-2 py-2 text-xs first:pt-0 last:pb-0'>
      <StepNumber index={index} />
      <span className='flex min-w-0 flex-1 items-center gap-1.5'>
        <TaskLink state={state} task={row.task} />
        {row.current && <span className='shrink-0 text-fg-2'>This task</span>}
      </span>
      <ToneLabel label={status.label} tone={status.tone} />
      <span className='flex min-w-16 shrink-0 justify-end'>
        <PullRequestBadge task={row.task} />
      </span>
    </li>
  );
}

export function BundlePanel({ state, task }: { state: ShinsaState; task: Task }) {
  const rows = listBundleRows(state, task);
  if (rows.length === 0) return null;
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'bundle')}
      title='Bundle'
      icon={BUNDLE_ICON}
      meta={<span className='font-normal text-fg-2 text-xs'>{describeBundleProgress(rows)}</span>}
    >
      <ol aria-label='Tasks in the bundle' className='flex flex-col divide-y divide-border'>
        {rows.map((row, index) => (
          <BundleMember key={row.task.id} state={state} row={row} index={index} />
        ))}
      </ol>
      <p className='text-fg-2 text-xs'>{describeBundleNote(state, rows)}</p>
    </Panel>
  );
}
