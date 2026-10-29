import type { Gate, Schedule, ShinsaState, Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { ActivityEntry } from '@/components/overview/activity-row.tsx';
import { PausedCard, QuestionCard } from '@/components/overview/now-card.tsx';
import { SecretCard } from '@/components/overview/secret-card.tsx';
import { SignInCard } from '@/components/overview/sign-in-card.tsx';
import { FILED_COLUMNS, RoadmapRow } from '@/components/roadmap/row.tsx';
import { createScheduleActions, ScheduleMenu } from '@/components/settings/schedules.tsx';
import { FACT } from '@/components/task/fact.ts';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  type AutomationFact,
  type AutomationRead,
  describeAutomationTasks,
  describeReadsEmpty,
  listAutomationFacts,
  listAutomationGates,
  listAutomationReads,
  listAutomationTasks,
} from '@/lib/automations.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeNextRun } from '@/lib/schedules.ts';
import { resolveRoadmapGroup } from '@/lib/tasks/roadmap.ts';

function FactLabel({ fact }: { fact: AutomationFact }) {
  if (fact.at === null) return fact.label;
  const at = fact.at;
  if (fact.key === 'next') return <TimeAgo at={at} text={(now) => describeNextRun(at, now)} />;
  return (
    <>
      {fact.label} <TimeAgo at={at} />
    </>
  );
}

function FactItem({ fact }: { fact: AutomationFact }) {
  const item = (
    <span className={cn(FACT, 'max-w-72', fact.tone !== 'neutral' && TONE_TEXT[fact.tone])}>
      <Icon
        size='sm'
        name={fact.icon}
        style={fact.ink ? ({ '--icon-color': fact.ink } as React.CSSProperties) : undefined}
      />
      <span className='truncate'>
        <FactLabel fact={fact} />
      </span>
    </span>
  );
  return fact.hint ? <Hint label={fact.hint}>{item}</Hint> : item;
}

function WatchGate({ state, home, gate }: { state: ShinsaState; home: Task; gate: Gate }) {
  switch (gate.type) {
    case 'sign_in':
      return <SignInCard state={state} task={home} gate={gate} />;
    case 'secret':
      return <SecretCard state={state} task={home} gate={gate} />;
    case 'failure':
      return (
        <PausedCard state={state} task={home} gate={gate} onOpen={() => {}} cancelLabel='Stop this watch' />
      );
    default:
      return <QuestionCard state={state} task={home} gate={gate} />;
  }
}

function TasksPanel({ state, schedule }: { state: ShinsaState; schedule: Schedule }) {
  const tasks = listAutomationTasks(state, schedule);
  const copy = describeAutomationTasks(schedule);
  return (
    <Panel
      persistId={createDisclosureId('automation', schedule.id, 'tasks')}
      title={copy.title}
      icon='IconListBullets'
      count={tasks.length}
      flush
    >
      {tasks.length === 0 ? (
        <p className='px-3 py-2.5 text-fg-2 text-xs'>{copy.empty}</p>
      ) : (
        <div className='-mb-px'>
          <div
            className={cn(
              'grid h-7 items-center gap-4 border-border border-b px-3 font-medium text-2xs text-fg-2',
              FILED_COLUMNS
            )}
          >
            <span>Task</span>
            <span className='max-md:hidden'>Status</span>
            <span className='max-md:hidden'>Pull request</span>
            <span className='text-right'>Updated</span>
          </div>
          {tasks.map((task) => (
            <RoadmapRow
              key={task.id}
              state={state}
              task={task}
              group={resolveRoadmapGroup(state, task)}
              depth={0}
              columns={FILED_COLUMNS}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function ReadRow({ state, read }: { state: ShinsaState; read: AutomationRead }) {
  return (
    <ActivityEntry
      glyph={{ icon: read.icon, tone: read.tone }}
      text={read.title}
      actor={read.actor}
      at={read.at}
      detail={read.detail}
    >
      {read.filed.length > 0 && (
        <div className='flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-xs'>
          {read.filed.map((task) => (
            <TaskLink key={task.id} state={state} task={task} />
          ))}
        </div>
      )}
    </ActivityEntry>
  );
}

function ActivityPanel({ state, schedule }: { state: ShinsaState; schedule: Schedule }) {
  const reads = listAutomationReads(state, schedule);
  return (
    <Panel
      persistId={createDisclosureId('automation', schedule.id, 'activity')}
      title='Activity'
      icon='IconClock'
    >
      {reads.length === 0 ? (
        <p className='text-fg-2 text-xs'>{describeReadsEmpty(schedule)}</p>
      ) : (
        <ol className='flex flex-col'>
          {reads.map((read) => (
            <ReadRow key={read.key} state={state} read={read} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function AutomationBody({ state, schedule }: { state: ShinsaState; schedule: Schedule }) {
  const gates = listAutomationGates(state, schedule);
  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col gap-4 pb-6')}>
      <div className='flex flex-col gap-2.5'>
        <PageHeading
          title={schedule.name}
          description={
            <p className={cn(PAGE_DESCRIPTION, 'selectable whitespace-pre-line')}>{schedule.text}</p>
          }
          className='py-0.5'
        />
        <div className='flex items-start gap-2'>
          <div className='-ms-1.5 flex min-w-0 flex-1 flex-wrap items-center gap-1'>
            {listAutomationFacts(state, schedule).map((fact) => (
              <FactItem key={fact.key} fact={fact} />
            ))}
          </div>
          <div className='flex h-6 shrink-0 items-center'>
            <ScheduleMenu schedule={schedule} actions={createScheduleActions(state)} showOpen={false} />
          </div>
        </div>
      </div>
      {gates.map(({ home, gate }) => (
        <WatchGate key={gate.id} state={state} home={home} gate={gate} />
      ))}
      <TasksPanel state={state} schedule={schedule} />
      <ActivityPanel state={state} schedule={schedule} />
    </div>
  );
}

export function AutomationPage({ state, scheduleId }: { state: ShinsaState; scheduleId: string }) {
  const schedule = state.schedules[scheduleId];
  if (!schedule) {
    return (
      <EmptyState icon='IconInboxEmpty' title='No such automation' description='It may have been deleted.' />
    );
  }
  return <AutomationBody state={state} schedule={schedule} />;
}
