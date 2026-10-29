import type { ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { buttonVariants } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { TaskSharedFacts } from '@/components/task/facts.tsx';
import { ReviewTab } from '@/routes/task/review.tsx';
import { openTask } from '../../lib/content.ts';
import { readReviewFragment, resolveTaskInvite } from '../../lib/open.ts';
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
        <PageHeading
          title={scene.task.title}
          description={<OpenDescription scene={scene} />}
          className='min-w-60 flex-1 py-0.5'
        />
        <OpenActions link={scene.link} />
      </div>
      <TaskSharedFacts state={scene.state} task={scene.task} className='min-w-0' />
    </div>
  );
}

function OpenDescription({ scene }: { scene: OpenScene }) {
  const { payload } = scene;
  return (
    <div className='flex flex-col gap-1'>
      <p className={cn(PAGE_DESCRIPTION, 'line-clamp-2')}>
        {payload.task.summary ?? payload.report.headline}
      </p>
      <p className='text-2xs text-fg-2'>{openTask.source}</p>
    </div>
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
        <ReviewTab state={scene.state} task={scene.task} summary={false} />
      </div>
    </DemoRoot>
  );
}
