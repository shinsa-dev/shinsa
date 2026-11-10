import {
  type Briefing,
  type BriefingItem,
  findTask,
  lowerFirst,
  type Queue,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import type * as React from 'react';
import { GuideText } from '@/components/home/guide-text.tsx';
import { TaskLink, TaskPopoverRows } from '@/components/links/task.tsx';
import { InfoPopover } from '@/components/overlays/info-popover.tsx';
import { endSentence } from '@/lib/format/count.ts';
import {
  describeOvernightReviews,
  isWaitingToBuild,
  listWaitingBuilds,
  resolveRunningVerb,
  type WaitingBuild,
} from '@/lib/home.ts';

const NEXT_LEAD = ['Then', 'After that,', 'Finally,'];

const NAMED_RUNNING = 2;

function Lead({ state, item }: { state: ShinsaState; item: BriefingItem }) {
  const task = findTask(state, item.taskId);
  return (
    <p>
      Start with <TaskLink state={state} task={task} />:{' '}
      <GuideText text={endSentence(lowerFirst(item.why))} state={state} exclude={[task.id]} />
    </p>
  );
}

function UpNext({ state, items }: { state: ShinsaState; items: BriefingItem[] }) {
  return items.map((item, index) => {
    const task = findTask(state, item.taskId);
    return (
      <p key={task.id}>
        {NEXT_LEAD[index] ?? 'Then'} <TaskLink state={state} task={task} />:{' '}
        <GuideText text={endSentence(lowerFirst(item.why))} state={state} exclude={[task.id]} />
      </p>
    );
  });
}

function RunningMore({ state, tasks }: { state: ShinsaState; tasks: Task[] }) {
  return (
    <InfoPopover
      render={
        <button
          type='button'
          className='cursor-pointer whitespace-nowrap text-fg-3 underline decoration-fg-a3 decoration-dotted underline-offset-3 outline-none hover:text-fg-4 active:text-fg-4'
        />
      }
      trigger={`${tasks.length} more`}
      className='max-h-(--available-height) overflow-y-auto p-1'
    >
      <TaskPopoverRows state={state} tasks={tasks} />
    </InfoPopover>
  );
}

function Aside({ marker, children }: { marker?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className='flex gap-2 text-fg-2'>
      {marker && <span className='flex h-lh shrink-0 items-center'>{marker}</span>}
      <p className='min-w-0'>{children}</p>
    </div>
  );
}

function Running({ state, working }: { state: ShinsaState; working: Task[] }) {
  const named = working.slice(0, NAMED_RUNNING);
  const rest = working.slice(NAMED_RUNNING);
  return (
    <Aside>
      {working.length === 1 ? 'An agent is ' : 'Agents are '}
      {named.map((task, index) => (
        <span key={task.id}>
          {index > 0 && (index === named.length - 1 && rest.length === 0 ? ' and ' : ', ')}
          {resolveRunningVerb(task)} <TaskLink state={state} task={task} />
        </span>
      ))}
      {rest.length > 0 && (
        <>
          {' '}
          and <RunningMore state={state} tasks={rest} />
        </>
      )}
      .
    </Aside>
  );
}

function Note({ state, note }: { state: ShinsaState; note: string }) {
  return (
    <Aside marker={<Icon size='sm' name='IconInfoSimple' />}>
      <GuideText text={endSentence(note)} state={state} />
    </Aside>
  );
}

function Clear() {
  return (
    <p>
      <span className='font-medium text-fg-4'>Nothing needs you right now.</span> Describe the next thing
      below. Agents plan it, build it and check it, and it comes back here when it needs a decision.
    </p>
  );
}

function WaitingBuilds({ state, builds }: { state: ShinsaState; builds: WaitingBuild[] }) {
  const named = builds.slice(0, NAMED_RUNNING);
  const rest = builds.slice(NAMED_RUNNING).map((build) => build.task);
  return (
    <Aside marker={<Icon size='sm' name='IconMoon' />}>
      Waiting to build within today’s usage:{' '}
      {named.map((build, index) => (
        <span key={build.task.id}>
          {index > 0 && (index === named.length - 1 && rest.length === 0 ? ' and ' : ', ')}
          <TaskLink state={state} task={build.task} /> {build.when}
        </span>
      ))}
      {rest.length > 0 && (
        <>
          {' '}
          and <RunningMore state={state} tasks={rest} />
        </>
      )}
      .
    </Aside>
  );
}

export function HomeGuide({
  state,
  queue,
  briefing,
}: {
  state: ShinsaState;
  queue: Queue;
  briefing: Briefing;
}) {
  const now = Date.now();
  const waiting = listWaitingBuilds(state, queue.working, now);
  const working =
    waiting.length > 0 ? queue.working.filter((task) => !isWaitingToBuild(task)) : queue.working;
  const built = describeOvernightReviews(state, now);
  return (
    <section
      aria-label='What to do now'
      className='flex flex-col gap-1.5 text-sm leading-relaxed text-pretty text-fg-3'
    >
      {briefing.now ? <Lead state={state} item={briefing.now} /> : <Clear />}
      {briefing.now && <UpNext state={state} items={briefing.next} />}
      {working.length > 0 && <Running state={state} working={working} />}
      {waiting.length > 0 && <WaitingBuilds state={state} builds={waiting} />}
      {built && <Aside marker={<Icon size='sm' name='IconMoon' />}>{endSentence(built)}</Aside>}
      {briefing.note && <Note state={state} note={briefing.note} />}
    </section>
  );
}
