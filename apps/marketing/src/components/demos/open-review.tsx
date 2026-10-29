import type { ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { buttonVariants } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { NowFrame } from '@/components/overview/now-frame.tsx';
import { ReviewTab } from '@/routes/task/review.tsx';
import { openTask } from '../../lib/content.ts';
import { describePullRequestEyebrow, readReviewFragment, resolveTaskInvite } from '../../lib/open.ts';
import { createOpenState } from '../../lib/open-scene.ts';
import { site } from '../../lib/site.ts';
import { DemoRoot } from './frame.tsx';

interface OpenScene {
  state: ShinsaState;
  task: Task;
  payload: ReviewPayload;
  link: string | null;
}

function OpenSummary({ scene }: { scene: OpenScene }) {
  const { payload, link } = scene;
  return (
    <NowFrame
      eyebrow={describePullRequestEyebrow(payload.task.pullRequest, payload.task.handle)}
      title={payload.task.title}
      action={
        <>
          {link && (
            <a href={link} data-icon='inline-start' className={buttonVariants({ variant: 'primary' })}>
              <Icon name='IconArrowUpRight' />
              {openTask.primary}
            </a>
          )}
          <a href={site.downloadUrl} className={buttonVariants({ variant: link ? 'secondary' : 'primary' })}>
            {openTask.secondary}
          </a>
        </>
      }
    >
      <p className='text-fg-3 text-xs'>{openTask.source}</p>
    </NowFrame>
  );
}

export function OpenReview() {
  const [scene, setScene] = React.useState<OpenScene | null>(null);
  React.useEffect(() => {
    void readReviewFragment(window.location.hash).then((payload) => {
      if (!payload) return;
      document.documentElement.dataset.review = '';
      const link = resolveTaskInvite(window.location.search)?.link ?? null;
      setScene({ ...createOpenState(payload, Date.now()), payload, link });
    });
  }, []);
  if (!scene) return null;
  return (
    <DemoRoot>
      <div className='flex min-h-0 flex-1 flex-col'>
        <ReviewTab state={scene.state} task={scene.task} summary={<OpenSummary scene={scene} />} />
      </div>
    </DemoRoot>
  );
}
