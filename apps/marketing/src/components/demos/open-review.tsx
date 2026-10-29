import type { ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { buttonVariants } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { NowFrame } from '@/components/overview/now-frame.tsx';
import { TaskSharedFacts } from '@/components/task/facts.tsx';
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

function OpenActions({ link }: { link: string | null }) {
  return (
    <div className='flex shrink-0 flex-wrap items-center gap-2'>
      <a href={site.downloadUrl} className={buttonVariants({ variant: link ? 'outline' : 'primary' })}>
        {openTask.secondary}
      </a>
      {link && (
        <a href={link} data-icon='inline-start' className={buttonVariants({ variant: 'primary' })}>
          <Icon name='IconArrowUpRight' />
          {openTask.primary}
        </a>
      )}
    </div>
  );
}

function OpenHeader({ scene }: { scene: OpenScene }) {
  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex shrink-0 flex-col gap-2.5 pb-1')}>
      <div className='flex flex-wrap items-start gap-x-4 gap-y-2'>
        <PageHeading title={scene.task.title} className='min-w-60 flex-1 py-0.5' />
        <OpenActions link={scene.link} />
      </div>
      <TaskSharedFacts state={scene.state} task={scene.task} className='min-w-0' />
    </div>
  );
}

function OpenSummary({ scene }: { scene: OpenScene }) {
  const { payload } = scene;
  return (
    <NowFrame
      eyebrow={<span className='text-primary'>{describePullRequestEyebrow(payload.task.pullRequest)}</span>}
      title={payload.task.summary ?? payload.report.headline}
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
        <OpenHeader scene={scene} />
        <ReviewTab state={scene.state} task={scene.task} summary={<OpenSummary scene={scene} />} />
      </div>
    </DemoRoot>
  );
}
