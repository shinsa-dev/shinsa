import type { Gate, Schedule, ShinsaState, Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskLink } from '@/components/links/task.tsx';
import { QuestionCard } from '@/components/overview/now-card.tsx';
import { SecretCard } from '@/components/overview/secret-card.tsx';
import { SignInCard } from '@/components/overview/sign-in-card.tsx';
import { createScheduleActions, ScheduleMenu } from '@/components/settings/schedules.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  type AutomationRead,
  describeAutomationFacts,
  describeReadsEmpty,
  listAutomationFiled,
  listAutomationGates,
  listAutomationReads,
} from '@/lib/automations.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';

const ROW = 'flex flex-col gap-1 border-border border-t px-3 py-2.5 first:border-t-0';

function ReadRow({ state, read }: { state: ShinsaState; read: AutomationRead }) {
  return (
    <li className={ROW}>
      <div className='flex items-center justify-between gap-3 text-xs'>
        <span className={cn('shrink-0', TONE_TEXT[read.tone])}>{read.label}</span>
        <span className='shrink-0 text-fg-2'>
          <TimeAgo at={read.at} />
        </span>
      </div>
      {read.summary && <p className='selectable text-pretty text-fg-3 text-xs'>{read.summary}</p>}
      {read.filed.length > 0 && (
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs'>
          {read.filed.map((task) => (
            <TaskLink key={task.id} state={state} task={task} />
          ))}
        </div>
      )}
    </li>
  );
}

function WatchGate({ state, home, gate }: { state: ShinsaState; home: Task; gate: Gate }) {
  switch (gate.type) {
    case 'sign_in':
      return <SignInCard state={state} task={home} gate={gate} />;
    case 'secret':
      return <SecretCard state={state} task={home} gate={gate} />;
    default:
      return <QuestionCard state={state} task={home} gate={gate} />;
  }
}

function AutomationBody({ state, schedule }: { state: ShinsaState; schedule: Schedule }) {
  const reads = listAutomationReads(state, schedule);
  const filed = listAutomationFiled(state, schedule);
  const gates = listAutomationGates(state, schedule);
  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col gap-6 pb-6')}>
      <div className='flex items-start gap-3'>
        <PageHeading
          title={schedule.name}
          description={describeAutomationFacts(state, schedule)}
          className='flex-1'
        />
        <ScheduleMenu schedule={schedule} actions={createScheduleActions(state)} showOpen={false} />
      </div>
      {gates.map(({ home, gate }) => (
        <WatchGate key={gate.id} state={state} home={home} gate={gate} />
      ))}
      <section className='flex flex-col gap-1'>
        <SectionLabel count={filed.length} className='px-1'>
          Tasks it filed
        </SectionLabel>
        <div className={CARD}>
          {filed.length === 0 ? (
            <p className='px-3 py-2.5 text-fg-2 text-xs'>Nothing filed yet.</p>
          ) : (
            <ul>
              {filed.map((task) => (
                <li key={task.id} className={cn(ROW, 'text-xs')}>
                  <TaskLink state={state} task={task} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className='flex flex-col gap-1'>
        <SectionLabel count={reads.length} className='px-1'>
          Reads
        </SectionLabel>
        <div className={CARD}>
          {reads.length === 0 ? (
            <p className='px-3 py-2.5 text-fg-2 text-xs'>{describeReadsEmpty(schedule)}</p>
          ) : (
            <ul>
              {reads.map((read) => (
                <ReadRow key={read.key} state={state} read={read} />
              ))}
            </ul>
          )}
        </div>
      </section>
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
