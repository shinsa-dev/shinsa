import type { ReviewPayload } from '@shinsa/core';
import { buttonVariants } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { TaskSharedFacts } from '@/components/task/facts.tsx';
import { ReviewTab } from '@/routes/task/review.tsx';
import { openTask } from '../../lib/content.ts';
import type { InviteHeader } from '../../lib/open.ts';
import { type OpenPage, type OpenScene, readOpenPage } from '../../lib/open-page.ts';
import { site } from '../../lib/site.ts';
import { DemoRoot } from './frame.tsx';

function OpenActions({ link }: { link: string | null }) {
  if (!link) {
    return (
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        <a href={site.downloadUrl} className={buttonVariants({ variant: 'primary' })}>
          {openTask.secondary}
        </a>
      </div>
    );
  }
  return (
    <div className='flex shrink-0 flex-wrap items-center gap-2'>
      <a href={site.downloadUrl} className={buttonVariants({ variant: 'outline' })}>
        {openTask.secondary}
      </a>
      <a href={link} data-icon='inline-start' className={buttonVariants({ variant: 'primary' })}>
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

function InvitePage({ header }: { header: InviteHeader }) {
  return (
    <>
      <OpenHeader
        title={header.title}
        description={header.description && <p className={PAGE_DESCRIPTION}>{header.description}</p>}
        link={header.link}
        facts={header.handle && <p className='text-fg-2 text-xs'>{header.handle}</p>}
      />
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

export function OpenLoading() {
  return (
    <div className='flex min-h-0 flex-1 items-center justify-center text-fg-2'>
      <Spinner size='lg' />
    </div>
  );
}

export function OpenReview() {
  const [page, setPage] = React.useState<OpenPage | null>(null);
  React.useEffect(() => {
    void readOpenPage(window.location.search, window.location.hash, Date.now()).then(setPage);
  }, []);
  if (!page) return <OpenLoading />;
  if ('scene' in page) return <ReviewPage scene={page.scene} />;
  return <InvitePage header={page.header} />;
}
