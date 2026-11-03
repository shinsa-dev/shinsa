import type { ShinsaState } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskFilterChips, TaskFilterMenu } from '@/components/tasks/filter-menu.tsx';
import { TaskGroupSection } from '@/components/tasks/group.tsx';
import { TASK_LIST_COLUMNS, TEAM_TASK_LIST_COLUMNS } from '@/components/tasks/row.tsx';
import { useTeamTasks } from '@/components/teams/tasks.tsx';
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
  const filters = resolveTaskFilters(useSearchString());
  const team = useTeamTasks();
  const rows = React.useMemo(
    () => listTaskRows(state, team.entries, team.teams),
    [state, team.entries, team.teams]
  );
  const fields = listTaskFilterFields(rows, team.teams, filters);
  const sections = listTaskGroupSections(state, filterTaskRows(rows, filters), filters.status);
  const owners = rows.some((row) => row.team);
  const columns = owners ? TEAM_TASK_LIST_COLUMNS : TASK_LIST_COLUMNS;
  const filtered = isFiltering(filters);
  const statusKey = filters.status.join(',');
  const empty = sections.every((section) => section.entries.length === 0);
  useRegisterCommands(listTaskListSections(filters, fields));

  return (
    <div
      className={cn(PAGE_COLUMN, PAGE_TOP, 'flex min-h-0 flex-1 flex-col gap-6 pb-6', owners && 'max-w-4xl')}
    >
      <div className='flex items-end gap-3'>
        <PageHeading title='All tasks' description={describeTaskCounts(state)} className='flex-1' />
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
      <TaskFilterChips fields={fields} filters={filters} />
      <div className={cn(CARD, 'flex min-h-0 flex-col overflow-hidden')}>
        <div
          className={cn(
            'grid h-7 shrink-0 items-center gap-4 border-b border-border px-3 text-2xs font-medium text-fg-2',
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
        <div className='-mb-px min-h-0 overflow-y-auto'>
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
            sections.map(({ group, entries }) => (
              <TaskGroupSection
                key={`${group.key}-${statusKey || 'all'}`}
                persistId={createDisclosureId(
                  'tasks',
                  'group',
                  group.key,
                  ...(statusKey ? ['status', statusKey] : [])
                )}
                group={group}
                entries={entries}
                state={state}
                defaultOpen={group.defaultOpen || filters.status.length > 0}
                columns={columns}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
