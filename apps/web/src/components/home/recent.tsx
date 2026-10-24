import type { Activity, ShinsaState, Task } from '@shinsa/core';
import { ListRow } from '@/components/layout/list-row.tsx';
import { WideSection } from '@/components/queue/queue.tsx';
import { TaskGlyph } from '@/components/status/glyphs.tsx';
import { TaskMeta } from '@/components/status/text.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TaskHandlePrefix } from '@/components/task/handle.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { resolveHomeSectionFlag, resolvePreview } from '@/lib/home.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

export function RecentlyFinished({ state, finished }: { state: ShinsaState; finished: Task[] }) {
  return (
    <WideSection
      title='Recently finished'
      count={finished.length}
      empty='Nothing finished this week.'
      flag={resolveHomeSectionFlag('finished')}
    >
      {finished.map((task) => (
        <ListRow
          key={task.id}
          leading={<TaskGlyph state={state} task={task} />}
          title={task.title}
          meta={
            <>
              <TaskHandlePrefix task={task} />
              <TaskMeta state={state} task={task} />
            </>
          }
          trailing={<TimeAgo at={task.stageChangedAt} compact detail='Finished' />}
          onClick={() => navigate(resolveTaskPath(task))}
        />
      ))}
    </WideSection>
  );
}

export function RecentConversations({ conversations }: { conversations: { task: Task; entry: Activity }[] }) {
  return (
    <WideSection
      title='Recent conversations'
      count={conversations.length}
      empty='No agent has written yet.'
      flag={resolveHomeSectionFlag('conversations')}
    >
      {conversations.map(({ task, entry }) => (
        <ListRow
          key={task.id}
          leading={<StatusTile icon='IconBubbleText' tone='neutral' />}
          title={task.title}
          meta={
            <>
              <TaskHandlePrefix task={task} />
              <InlineMarkdown text={resolvePreview(entry)} />
            </>
          }
          trailing={<TimeAgo at={entry.at} compact detail='Last message' />}
          onClick={() => navigate(resolveTaskPath(task, { tab: 'chat', run: entry.runId }))}
        />
      ))}
    </WideSection>
  );
}
