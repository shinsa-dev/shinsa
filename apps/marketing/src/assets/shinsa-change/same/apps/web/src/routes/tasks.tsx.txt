import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { RoadmapSection } from '@/components/roadmap/group.tsx';
import { ROADMAP_COLUMNS } from '@/components/roadmap/row.tsx';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { applySearch, listTaskListSections } from '@/lib/command/tasks.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describeRoadmapCounts, listRoadmapSections, selectRoadmapGroup } from '@/lib/tasks/roadmap.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';

export function TasksPage({ state }: { state: ShinsaState }) {
  const search = useSearchParam('q') ?? '';
  const status = selectRoadmapGroup(useSearchParam('status'));
  const sections = listRoadmapSections(state, search, status?.key ?? null);
  const filtered = search.trim() !== '' || status !== null;
  const empty = sections.every((section) => section.entries.length === 0);
  useRegisterCommands(listTaskListSections(search, status?.key ?? null));

  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex min-h-0 flex-1 flex-col gap-6 pb-6')}>
      <div className='flex items-end gap-3'>
        <PageHeading title='All tasks' description={describeRoadmapCounts(state)} className='flex-1' />
        {status && (
          <Hint label='Clear the filter'>
            <Button
              variant='secondary'
              size='sm'
              icon={{ name: 'IconCrossSmall', position: 'inline-end' }}
              onClick={() => updateSearchParams({ status: null })}
            >
              <Icon name={status.icon} className={TONE_TEXT[status.tone]} />
              {status.title}
            </Button>
          </Hint>
        )}
        <Input
          type='search'
          value={search}
          onChange={(event) => applySearch(event.target.value)}
          placeholder='Search tasks'
          aria-label='Search tasks'
          className='w-52 max-md:w-32'
        />
      </div>
      <div className={cn(CARD, 'flex min-h-0 flex-col overflow-hidden')}>
        <div
          className={cn(
            'grid h-7 shrink-0 items-center gap-4 border-border border-b px-3 font-medium text-2xs text-fg-2',
            ROADMAP_COLUMNS
          )}
        >
          <span>Task</span>
          <span className='max-md:hidden'>Repository</span>
          <span className='max-md:hidden'>Status</span>
          <span className='max-md:hidden'>Pull request</span>
          <span className='text-right'>Updated</span>
        </div>
        <div className='-mb-px min-h-0 overflow-y-auto'>
          {empty ? (
            <EmptyState
              icon={filtered ? 'IconMagnifyingGlass' : 'IconListBullets'}
              title={filtered ? 'Nothing matches' : 'No tasks yet'}
              description={
                filtered
                  ? 'Try another word from the title, branch or repository, or clear the filter.'
                  : 'Describe the work on Home. Shinsa finds the repository and starts the agents.'
              }
            />
          ) : (
            sections.map(({ group, entries }) => (
              <RoadmapSection
                key={`${group.key}-${status?.key ?? 'all'}`}
                group={group}
                entries={entries}
                state={state}
                defaultOpen={group.defaultOpen || status !== null}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
