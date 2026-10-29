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
import { OPEN_SHELL, type PendingHeader, readReviewFragment, resolvePendingHeader } from '../../lib/open.ts';
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
      <a
        href={site.downloadUrl}
        data-open-task-only
        hidden={!link}
        className={buttonVariants({ variant: 'outline' })}
      >
        {openTask.secondary}
      </a>
      <a
        href={site.downloadUrl}
        data-open-missing-only
        hidden={Boolean(link)}
        className={buttonVariants({ variant: 'primary' })}
      >
        {openTask.secondary}
      </a>
      <a
        href={link ?? 'shinsa://'}
        data-open-link
        data-open-task-only
        hidden={!link}
        data-icon='inline-start'
        className={buttonVariants({ variant: 'primary' })}
      >
        <Icon name='IconArrowUpRight' />
        {openTask.primary}
      </a>
    </div>
  );
}

function OpenHeader({
  title,
  description,
  link,
  facts,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  link: string | null;
  facts: React.ReactNode;
}) {
  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex shrink-0 flex-col gap-2.5 pb-1')}>
      <div className='flex flex-wrap items-start gap-x-4 gap-y-2'>
        <PageHeading title={title} description={description} className='min-w-60 flex-1 py-0.5' />
        <OpenActions link={link} />
      </div>
      {facts}
    </div>
  );
}

function ReviewDescription({ payload }: { payload: ReviewPayload }) {
  return (
    <div className='flex flex-col gap-1'>
      <p className={PAGE_DESCRIPTION}>{payload.task.summary ?? payload.report.headline}</p>
      <p className='text-2xs text-fg-2'>{openTask.source}</p>
    </div>
  );
}

function InviteHeader({ header }: { header: PendingHeader }) {
  return (
    <OpenHeader
      title={<span data-open-title>{header.title}</span>}
      description={
        <p data-open-description className={PAGE_DESCRIPTION}>
          {header.description}
        </p>
      }
      link={header.link}
      facts={
        <p data-open-handle className='text-fg-2 text-xs'>
          {header.handle}
        </p>
      }
    />
  );
}

function InvitePage({ header }: { header: PendingHeader }) {
  return (
    <>
      <InviteHeader header={header} />
      {header.link && (
        <div className={cn(PAGE_COLUMN, 'pt-6')}>
          <p className={PAGE_DESCRIPTION}>{openTask.unreviewed}</p>
        </div>
      )}
    </>
  );
}

function ReviewPage({ scene }: { scene: OpenScene }) {
  return (
    <DemoRoot>
      <div className='flex min-h-0 flex-1 flex-col'>
        <OpenHeader
          title={scene.task.title}
          description={<ReviewDescription payload={scene.payload} />}
          link={scene.link}
          facts={<TaskSharedFacts state={scene.state} task={scene.task} className='min-w-0' />}
        />
        <ReviewTab state={scene.state} task={scene.task} summary={false} />
      </div>
    </DemoRoot>
  );
}

function resolveFirstHeader() {
  if (import.meta.env.SSR) return OPEN_SHELL;
  return resolvePendingHeader(window.location.search);
}

export function OpenReview() {
  const [header] = React.useState(resolveFirstHeader);
  const [scene, setScene] = React.useState<OpenScene | null>(null);
  const [read, setRead] = React.useState(false);
  React.useEffect(() => {
    void readReviewFragment(window.location.hash).then((payload) => {
      if (payload) setScene({ ...createOpenState(payload, Date.now()), payload, link: header.link });
      setRead(true);
    });
  }, [header.link]);
  if (scene) return <ReviewPage scene={scene} />;
  if (read) return <InvitePage header={header} />;
  return <InviteHeader header={header} />;
}
