import type { InitiativeSheet, ShinsaState, TeamFeedInitiative } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { LeadReport } from '@/components/initiatives/lead.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskGroupList } from '@/components/tasks/group.tsx';
import { FILED_COLUMNS, TEAM_TASK_LIST_COLUMNS } from '@/components/tasks/row.tsx';
import { useTeamTasks } from '@/components/teams/tasks.tsx';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import {
  hasTeamRows,
  type InitiativeTaskSection,
  listInitiativeTaskSections,
  listTeamInitiativeTaskSections,
} from '@/lib/initiatives/view.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

const EMPTY_TASKS = 'No tasks yet. Tasks the lead files join on their own, or add one from its menu.';

function ColumnHeader({ team }: { team: boolean }) {
  return (
    <div
      className={cn(
        'grid h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-2xs font-medium text-fg-2',
        team ? TEAM_TASK_LIST_COLUMNS : FILED_COLUMNS
      )}
    >
      <span>Task</span>
      {team && <span className='max-md:hidden'>Repository</span>}
      {team && <span className='max-md:hidden'>Owner</span>}
      <span className='max-md:hidden'>Status</span>
      <span className='max-md:hidden'>Pull request</span>
      <span className='text-right'>Updated</span>
    </div>
  );
}

function InitiativeTasks({
  state,
  initiativeId,
  sections,
}: {
  state: ShinsaState;
  initiativeId: string;
  sections: InitiativeTaskSection[];
}) {
  const team = hasTeamRows(sections);
  const columns = team ? TEAM_TASK_LIST_COLUMNS : FILED_COLUMNS;
  return (
    <section aria-label='Tasks' className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <ColumnHeader team={team} />
      {sections.length === 0 ? (
        <p className='px-3 py-2.5 text-xs text-fg-2'>{EMPTY_TASKS}</p>
      ) : (
        <TaskGroupList
          className='-mb-px flex flex-col'
          sections={sections.map((section) => ({
            key: section.key,
            persistId: createDisclosureId('initiative', initiativeId, 'group', section.key),
            group: section.group,
            entries: section.entries,
            defaultOpen: section.group.defaultOpen,
          }))}
          state={state}
          columns={columns}
        />
      )}
    </section>
  );
}

export function InitiativeOverview({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  const { entries } = useTeamTasks();
  const sections = listInitiativeTaskSections(state, sheet, entries);
  return (
    <>
      <LeadReport initiative={sheet.initiative} />
      <InitiativeTasks state={state} initiativeId={sheet.initiative.id} sections={sections} />
    </>
  );
}

export function TeamInitiativeOverview({ initiative }: { initiative: TeamFeedInitiative }) {
  const state = useShinsaState();
  const { entries } = useTeamTasks();
  return (
    <>
      <LeadReport initiative={initiative} />
      {state && (
        <InitiativeTasks
          state={state}
          initiativeId={initiative.id}
          sections={listTeamInitiativeTaskSections(state, initiative, entries)}
        />
      )}
    </>
  );
}
