import { briefingKey, reconcileBriefing, type ShinsaState } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { HomeGuide } from '@/components/home/guide.tsx';
import { NewTaskForm } from '@/components/home/new-task-form.tsx';
import { RecentConversations, RecentlyFinished } from '@/components/home/recent.tsx';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_TITLE } from '@/components/layout/page/heading.tsx';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskQueue, WideSections } from '@/components/queue/queue.tsx';
import { useOwnQueue } from '@/hooks/use-own-queue.ts';
import { listHomeSections } from '@/lib/command/home.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { resolveGreeting, resolveHomeSections } from '@/lib/home.ts';
import { listQueueSections } from '@/lib/queue.ts';

export function HomePage({ state }: { state: ShinsaState }) {
  const now = Date.now();
  const queue = useOwnQueue(state, now);
  const briefing = reconcileBriefing(state.briefings[briefingKey(queue.focus)], queue, now);
  const { first, finished, conversations, last } = resolveHomeSections(
    state,
    listQueueSections(state, queue),
    now
  );
  useRegisterCommands(listHomeSections(state));

  return (
    <PageScroll>
      <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col gap-6 pb-12')}>
        <div className='flex flex-col gap-3'>
          <h1 className={PAGE_TITLE}>{resolveGreeting(now)}</h1>
          <HomeGuide state={state} queue={queue} briefing={briefing} />
        </div>

        <div className={CARD}>
          <NewTaskForm />
        </div>

        <WideSections>
          <TaskQueue state={state} variant='wide' sections={first} />
          <RecentlyFinished state={state} finished={finished} />
          <RecentConversations conversations={conversations} />
          <TaskQueue state={state} variant='wide' sections={last} />
        </WideSections>
      </div>
    </PageScroll>
  );
}
