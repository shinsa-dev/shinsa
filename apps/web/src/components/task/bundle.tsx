import type { ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { InAppLink } from '@/components/links/link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoHeader, InfoPopover, InfoSection } from '@/components/overlays/info-popover.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { FACT, FACT_INTERACTIVE } from '@/components/task/fact.ts';
import { PullRequestBadge } from '@/components/tasks/pull-request-badge.tsx';
import { DepthMark, resolveDepthIndent } from '@/components/tasks/row.tsx';
import {
  BUNDLE_ICON,
  BUNDLE_MEMBER,
  type BundleRow,
  describeBundleCount,
  describeBundleNote,
  describeBundleParentHandles,
  describeBundleParents,
  describeBundleProgress,
  listBundleRows,
} from '@/lib/tasks/bundles.ts';
import { resolveTaskMenuIcon } from '@/lib/tasks/status.ts';
import { resolveTaskPath } from '@/router.ts';

function BundleMember({ state, row }: { state: ShinsaState; row: BundleRow }) {
  const status = BUNDLE_MEMBER[row.state];
  const icon = resolveTaskMenuIcon(state, row.task);
  return (
    <li className='flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs'>
      <span className={cn('flex min-w-0 flex-1 items-center gap-1.5', resolveDepthIndent(row.depth))}>
        {row.depth > 0 && <Icon size='sm' name='IconArrowCornerDownRight' className='shrink-0 text-fg-2' />}
        <DepthMark depth={row.depth} />
        <Icon size='sm' name={icon.name} className={cn('shrink-0', icon.className)} />
        {row.task.handle && <span className='shrink-0 text-fg-2 tabular-nums'>{row.task.handle}</span>}
        <InAppLink
          path={resolveTaskPath(row.task)}
          className='min-w-0 font-medium text-fg-4 no-underline outline-none hover:underline active:underline'
        >
          <Truncate>{row.task.title}</Truncate>
        </InAppLink>
        {row.current && <span className='shrink-0 text-fg-2'>This task</span>}
        {row.parents.length > 0 && (
          <Hint label={describeBundleParents(row.parents)}>
            <span className='min-w-12 shrink-[4] truncate text-fg-2'>
              {describeBundleParentHandles(row.parents)}
            </span>
          </Hint>
        )}
      </span>
      <ToneLabel label={status.label} tone={status.tone} />
      <span className='flex min-w-14 shrink-0 justify-end'>
        <PullRequestBadge task={row.task} />
      </span>
    </li>
  );
}

export function BundleFact({ state, task }: { state: ShinsaState; task: Task }) {
  const rows = listBundleRows(state, task);
  if (rows.length === 0) return null;
  return (
    <InfoPopover
      render={<button type='button' className={cn(FACT, FACT_INTERACTIVE)} />}
      trigger={
        <>
          <Icon size='sm' name={BUNDLE_ICON} />
          Bundle
          <span className='tabular-nums'>{describeBundleCount(rows)}</span>
        </>
      }
      className='w-140 max-w-[calc(100vw-2rem)]'
    >
      <InfoHeader
        title={`Bundle · ${describeBundleProgress(rows)}`}
        description={describeBundleNote(state, rows)}
      />
      <InfoSection>
        <ul aria-label='Tasks in the bundle' className='flex flex-col'>
          {rows.map((row) => (
            <BundleMember key={row.task.id} state={state} row={row} />
          ))}
        </ul>
      </InfoSection>
    </InfoPopover>
  );
}

export function BundleMark({ state, task }: { state: ShinsaState; task: Task }) {
  const rows = listBundleRows(state, task);
  if (rows.length === 0) return null;
  return (
    <Hint label={`Bundle · ${describeBundleProgress(rows)}`}>
      <span className='inline-flex shrink-0 items-center gap-1 text-2xs text-fg-2 tabular-nums'>
        <Icon size='sm' name={BUNDLE_ICON} />
        {describeBundleCount(rows)}
      </span>
    </Hint>
  );
}
