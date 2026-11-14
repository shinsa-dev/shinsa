import { resolveFocusTeam, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import { Option } from 'effect';
import * as React from 'react';
import { PAGE_BOTTOM, PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskFilterChips, TaskFilterMenu } from '@/components/tasks/filter-menu.tsx';
import { TaskGroupList } from '@/components/tasks/group.tsx';
import { TASK_LIST_COLUMNS, TEAM_TASK_LIST_COLUMNS } from '@/components/tasks/row.tsx';
import { TeamFeedRefusals, useTeamTasks } from '@/components/teams/tasks.tsx';
import { useScrolledDown } from '@/hooks/use-scrolled-down.ts';
import { useTaskOwnership } from '@/hooks/use-task-ownership.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { applySearch, listTaskListSections } from '@/lib/command/tasks.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import {
  filterTaskRows,
  isFiltering,
  listTaskFilterFields,
  listTaskRows,
  resolveTaskFilters,
} from '@/lib/tasks/filters.ts';
import { describeTaskCounts, listTaskGroupSections } from '@/lib/tasks/groups.ts';
import { useSearchString } from '@/router.ts';

export function TasksPage({ state }: { state: ShinsaState }) {
  const ownership = useTaskOwnership();
  const scroller = React.useRef<HTMLDivElement>(null);
  const { scrolled, scrollToTop } = useScrolledDown(scroller);
  const filters = resolveTaskFilters(useSearchString(), ownership.shared);
  const team = useTeamTasks();
  const rows = React.useMemo(
    () => listTaskRows(state, team.entries, team.teams, Date.now(), ownership),
    [state, team.entries, team.teams, ownership]
  );
  const fields = listTaskFilterFields(
    rows,
    team.teams,
    filters,
    Option.getOrNull(resolveFocusTeam(state, Date.now()))
  );
  const sections = listTaskGroupSections(state, filterTaskRows(rows, filters), filters.status);
  const owners = ownership.shared || rows.some((row) => row.team);
  const columns = owners ? TEAM_TASK_LIST_COLUMNS : TASK_LIST_COLUMNS;
  const filtered = isFiltering(filters);
  const statusKey = filters.status.join(',');
  const empty = sections.every((section) => section.entries.length === 0);
  useRegisterCommands(listTaskListSections(filters, fields));

  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, PAGE_BOTTOM, 'flex min-h-0 flex-1 flex-col gap-6')}>
      <div className='flex items-end gap-3'>
        <PageHeading
          title='All tasks'
          description={
            <p className={cn(PAGE_DESCRIPTION, 'flex items-center gap-1')}>
              {describeTaskCounts(rows.map((row) => row.task))}
              <TeamFeedRefusals state={state} />
            </p>
          }
          className='flex-1'
        />
        <div className='flex items-center gap-1.5'>
          <Input
            type='search'
            value={filters.search}
            onChange={(event) => applySearch(event.target.value)}
            placeholder='Search tasks'
            aria-label='Search tasks'
            className='w-52 max-md:w-32'
          />
          <TaskFilterMenu fields={fields} filters={filters} />
        </div>
      </div>
      <div className='flex min-h-0 flex-col gap-2'>
        <TaskFilterChips fields={fields} filters={filters} />
        <div className={cn(CARD, 'relative flex min-h-0 flex-col overflow-hidden')}>
          <div
            className={cn(
              'grid h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-2xs font-medium text-fg-2',
              columns
            )}
          >
            <span>Task</span>
            <span className='max-md:hidden'>Repository</span>
            {owners && <span className='max-md:hidden'>Owner</span>}
            <span className='max-md:hidden'>Status</span>
            <span className='max-md:hidden'>Pull request</span>
            <span className='text-right'>Updated</span>
          </div>
          <div ref={scroller} className='-mb-px min-h-0 overflow-y-auto'>
            {empty ? (
              <EmptyState
                icon={filtered ? 'IconMagnifyingGlass' : 'IconListBullets'}
                title={filtered ? 'Nothing matches' : 'No tasks yet'}
                description={
                  filtered
                    ? 'Try another word from the title, branch or repository, or clear the filters.'
                    : 'Describe the work on Home. Shinsa finds the repository and starts the agents.'
                }
              />
            ) : (
              <TaskGroupList
                sections={sections.map(({ group, entries }) => ({
                  key: `${group.key}-${statusKey || 'all'}`,
                  persistId: createDisclosureId(
                    'tasks',
                    'group',
                    group.key,
                    ...(statusKey ? ['status', statusKey] : [])
                  ),
                  group,
                  entries,
                  defaultOpen: group.defaultOpen || filters.status.length > 0,
                }))}
                state={state}
                columns={columns}
              />
            )}
          </div>
          {scrolled && (
            <div className='pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center'>
              <Button
                variant='outline'
                size='sm'
                icon='IconArrowUp'
                className='pointer-events-auto'
                onClick={scrollToTop}
              >
                Back to top
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
