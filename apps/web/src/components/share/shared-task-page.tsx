import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARDS_FRAME, PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { ReadOnlyProvider } from '@/components/task/read-only.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useTaskView } from '@/hooks/use-task-view.ts';
import { enterReadOnly } from '@/lib/connection/read-only.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { describeSharedBy, listSharedTabs } from '@/lib/share/page.ts';
import type { SharedView } from '@/lib/share/view.ts';
import { resolveTaskTab } from '@/lib/tasks/tabs.ts';
import { useSearchParam } from '@/router.ts';
import { TaskFrame } from '@/routes/task/index.tsx';

export function SharedTaskPage({
  view,
  note,
  viewer,
}: {
  view: SharedView;
  note: string;
  viewer: string | null;
}) {
  const { state, task, shared } = view;
  const taskView = useTaskView(state, task.id);
  const layout = useLayoutPreference();
  React.useEffect(() => enterReadOnly(), []);
  const tabs = listSharedTabs(task, shared);
  const page = {
    ...taskView,
    tabs,
    tab: resolveTaskTab(useSearchParam('tab'), tabs),
    codeModes: taskView.codeModes.filter((mode) => mode === 'changes'),
    reviewing: false,
  };
  return (
    <ReadOnlyProvider>
      <ReviewDraftProvider enabled={false} draftKey={`shared:${task.id}`}>
        <div className='flex min-h-0 flex-1 flex-col'>
          <div className={cn('shrink-0', layout === 'cards' && CARDS_FRAME)}>
            <p className={cn(PAGE_COLUMN, 'flex items-center gap-1.5 pt-3 text-2xs text-fg-2')}>
              <Icon size='sm' name='IconEyeOpen' />
              <span>{note}</span>
              <span>·</span>
              <span className='truncate'>{describeSharedBy(shared, viewer)}</span>
              <span>·</span>
              <TimeAgo at={view.updatedAt} />
            </p>
          </div>
          <TaskFrame state={state} task={task} view={page} />
        </div>
      </ReviewDraftProvider>
    </ReadOnlyProvider>
  );
}
