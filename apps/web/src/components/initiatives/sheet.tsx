import type { InitiativeSheet, ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { ActivityEntry } from '@/components/overview/activity-row.tsx';
import { CheckMark } from '@/components/status/check-mark.tsx';
import { FILED_COLUMNS, TaskListRow } from '@/components/tasks/row.tsx';
import {
  DECISION_KIND,
  describePhaseProgress,
  type InitiativeSection,
  isPhaseDone,
  listInitiativeSections,
  NO_PHASE,
} from '@/lib/initiatives/view.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

function ColumnHeader() {
  return (
    <div
      className={cn(
        'grid h-7 items-center gap-4 border-b border-border px-3 text-2xs font-medium text-fg-2',
        FILED_COLUMNS
      )}
    >
      <span>Task</span>
      <span className='max-md:hidden'>Status</span>
      <span className='max-md:hidden'>Pull request</span>
      <span className='text-right'>Updated</span>
    </div>
  );
}

function TaskRows({ state, tasks }: { state: ShinsaState; tasks: readonly Task[] }) {
  return (
    <div className='-mb-px'>
      <ColumnHeader />
      {tasks.map((task) => (
        <TaskListRow key={task.id} state={state} task={task} depth={0} columns={FILED_COLUMNS} />
      ))}
    </div>
  );
}

function PhaseHeading({ name }: { name: string }) {
  return (
    <div className='flex h-7 items-center gap-2 border-b border-border bg-bg-a1 px-3 text-2xs font-medium text-fg-3'>
      <Icon size='sm' name='IconLayersThree' className='text-fg-2' />
      {name}
    </div>
  );
}

function NextRows({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  const phased = sheet.next.some((group) => group.phase !== null);
  return (
    <div className='-mb-px'>
      <ColumnHeader />
      {sheet.next.map((group) => (
        <div key={group.phase?.id ?? 'none'}>
          {phased && <PhaseHeading name={group.phase?.name ?? NO_PHASE} />}
          {group.tasks.map(({ task }) => (
            <TaskListRow key={task.id} state={state} task={task} depth={0} columns={FILED_COLUMNS} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DroppedRows({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  return (
    <ul className='flex flex-col'>
      {sheet.dropped.map(({ task, reason }) => (
        <li
          key={task.id}
          className='flex items-baseline gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0'
        >
          <span className='min-w-0 shrink-0'>
            <TaskLink state={state} task={task} />
          </span>
          <span className='min-w-0 truncate text-fg-2'>{reason}</span>
        </li>
      ))}
    </ul>
  );
}

function DecisionRows({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  return (
    <ol className='flex flex-col'>
      {sheet.decisions.map((decision) => {
        const kind = DECISION_KIND[decision.kind];
        const task = state.tasks[decision.taskId];
        return (
          <ActivityEntry
            key={`${decision.taskId}:${decision.kind}:${decision.at}:${decision.title}`}
            glyph={kind.glyph}
            text={`${kind.label}: ${decision.title}`}
            actor={task ? <TaskLink state={state} task={task} /> : null}
            at={decision.at}
            detail={[decision.text]}
          />
        );
      })}
    </ol>
  );
}

function SectionBody({
  state,
  sheet,
  section,
}: {
  state: ShinsaState;
  sheet: InitiativeSheet;
  section: InitiativeSection;
}) {
  switch (section.key) {
    case 'needsYou':
      return <TaskRows state={state} tasks={sheet.needsYou.map((entry) => entry.task)} />;
    case 'now':
      return <TaskRows state={state} tasks={sheet.now} />;
    case 'next':
      return <NextRows state={state} sheet={sheet} />;
    case 'shipped':
      return <TaskRows state={state} tasks={sheet.shipped} />;
    case 'dropped':
      return <DroppedRows state={state} sheet={sheet} />;
    case 'decisions':
      return (
        <div className='p-3'>
          <DecisionRows state={state} sheet={sheet} />
        </div>
      );
  }
}

export function InitiativeSections({ state, sheet }: { state: ShinsaState; sheet: InitiativeSheet }) {
  return listInitiativeSections(sheet).map((section) => (
    <Panel
      key={section.key}
      persistId={createDisclosureId('initiative', sheet.initiative.id, section.key)}
      title={section.title}
      icon={section.icon}
      count={section.count}
      defaultOpen={section.key !== 'shipped' && section.key !== 'dropped'}
      flush
    >
      {section.count === 0 ? (
        <p className='px-3 py-2.5 text-xs text-fg-2'>{section.empty}</p>
      ) : (
        <SectionBody state={state} sheet={sheet} section={section} />
      )}
    </Panel>
  ));
}

export function PhaseTrack({ sheet }: { sheet: InitiativeSheet }): React.ReactNode {
  if (sheet.progress.length === 0) return null;
  return (
    <ol aria-label='Phases' className='grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2'>
      {sheet.progress.map((progress, index) => {
        const { name, detail } = describePhaseProgress(progress);
        const done = isPhaseDone(progress);
        return (
          <li
            key={progress.phase?.id ?? 'none'}
            className='flex min-w-0 flex-col rounded-control border border-border px-2.5 py-2'
          >
            <span className='flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-4'>
              {done ? (
                <CheckMark label='Every task in this phase finished' />
              ) : (
                <span className='w-4 text-center text-2xs text-fg-2 tabular-nums'>
                  {progress.phase ? index + 1 : '·'}
                </span>
              )}
              <span className='truncate'>{name}</span>
            </span>
            <span className='ps-5.5 text-2xs text-fg-2 tabular-nums'>{detail}</span>
          </li>
        );
      })}
    </ol>
  );
}
