import type { InitiativeSheet, ShinsaState } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { LeadReport } from '@/components/initiatives/lead.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskGroupSection } from '@/components/tasks/group.tsx';
import { FILED_COLUMNS } from '@/components/tasks/row.tsx';
import { listInitiativeTaskSections } from '@/lib/initiatives/view.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

function InitiativeTasks({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  const sections = listInitiativeTaskSections(state, sheet);
  return (
    <section aria-label='Tasks' className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <div
        className={cn(
          'grid h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-2xs font-medium text-fg-2',
          FILED_COLUMNS
        )}
      >
        <span>Task</span>
        <span className='max-md:hidden'>Status</span>
        <span className='max-md:hidden'>Pull request</span>
        <span className='text-right'>Updated</span>
      </div>
      {sections.length === 0 ? (
        <p className='px-3 py-2.5 text-xs text-fg-2'>
          No tasks yet. Tasks the lead files join on their own, or add one from its menu.
        </p>
      ) : (
        <div className='-mb-px flex flex-col'>
          {sections.map((section) => (
            <TaskGroupSection
              key={section.key}
              persistId={createDisclosureId('initiative', sheet.initiative.id, 'group', section.key)}
              group={section.group}
              entries={section.entries}
              state={state}
              defaultOpen={section.group.defaultOpen}
              columns={FILED_COLUMNS}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function InitiativeOverview({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  return (
    <>
      <LeadReport state={state} initiative={sheet.initiative} />
      <InitiativeTasks state={state} sheet={sheet} />
    </>
  );
}
