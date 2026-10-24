import { briefingKey, reconcileBriefing, resolveQueue, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import type { IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { HomeGuide } from '@/components/home/guide.tsx';
import { NewTaskForm } from '@/components/home/new-task-form.tsx';
import { RecentConversations, RecentlyFinished } from '@/components/home/recent.tsx';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_TITLE } from '@/components/layout/page/heading.tsx';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { TaskQueue, WideSections } from '@/components/queue/queue.tsx';
import { listHomeSections } from '@/lib/command/home.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { resolveGreeting, resolveHomeQueue } from '@/lib/home.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { listQueueSections } from '@/lib/queue.ts';
import { navigate } from '@/router.ts';

function HomeLink({ label, icon, path }: { label: string; icon: IconName; path: string }) {
  return (
    <Hint label={label}>
      <Button
        size='icon-sm'
        variant='secondary'
        icon={icon}
        aria-label={label}
        onClick={() => navigate(path)}
      />
    </Hint>
  );
}

export function HomePage({ state }: { state: ShinsaState }) {
  const now = Date.now();
  const queue = resolveQueue(state, now);
  const layout = useLayoutPreference();
  const briefing = reconcileBriefing(state.briefings[briefingKey(queue.focusProjectId)], queue, now);
  const briefed = new Set([briefing.now, ...briefing.next].flatMap((item) => (item ? [item.taskId] : [])));
  const { first, last } = resolveHomeQueue(listQueueSections(state, queue, briefed));
  useRegisterCommands(listHomeSections(state));

  return (
    <PageScroll>
      <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col gap-6 pb-12')}>
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-1'>
            <h1 className={cn(PAGE_TITLE, 'flex-1')}>{resolveGreeting(now)}</h1>
            {layout === 'cards' && (
              <>
                <HomeLink label='All tasks' icon='IconListBullets' path='/tasks' />
                <HomeLink label='Settings' icon='IconSettingsGear1' path='/settings' />
              </>
            )}
          </div>
          <HomeGuide state={state} queue={queue} briefing={briefing} />
        </div>

        <div className={CARD}>
          <NewTaskForm />
        </div>

        <WideSections>
          <TaskQueue state={state} variant='wide' sections={first} />
          <RecentlyFinished state={state} now={now} />
          <RecentConversations state={state} now={now} />
          <TaskQueue state={state} variant='wide' sections={last} />
        </WideSections>
      </div>
    </PageScroll>
  );
}
