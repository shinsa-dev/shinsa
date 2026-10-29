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
import { readReviewFragment, resolveTaskInvite, type TaskInvite } from '../../lib/open.ts';
import { createOpenState } from '../../lib/open-scene.ts';
import { site } from '../../lib/site.ts';
import { DemoRoot } from './frame.tsx';

interface OpenScene {
  state: ShinsaState;
  task: Task;
  payload: ReviewPayload;
  link: string | null;
}

type OpenView = { kind: 'review'; scene: OpenScene } | { kind: 'invite'; invite: TaskInvite | null };

function OpenActions({ link }: { link: string | null }) {
  return (
    <div className='flex shrink-0 flex-wrap items-center gap-2'>
      <a href={site.downloadUrl} className={buttonVariants({ variant: link ? 'outline' : 'primary' })}>
        {openTask.secondary}
      </a>
      {link && (
        <a
          href={link}
          data-open-link
          data-icon='inline-start'
          className={buttonVariants({ variant: 'primary' })}
          suppressHydrationWarning
        >
          <Icon name='IconArrowUpRight' />
          {openTask.primary}
        </a>
      )}
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

function InviteHeader({ invite }: { invite: TaskInvite | null }) {
  if (!invite) {
    return (
      <OpenHeader title={openTask.missingTitle} description={openTask.missing} link={null} facts={null} />
    );
  }
  return (
    <OpenHeader
      title={invite.title ?? openTask.untitled}
      description={openTask.unreviewed}
      link={invite.link}
      facts={invite.handle && <p className='text-fg-2 text-xs'>{invite.handle}</p>}
    />
  );
}

function PendingHeader() {
  return (
    <OpenHeader
      title={<span data-open-title suppressHydrationWarning />}
      description={<p data-open-description className={PAGE_DESCRIPTION} suppressHydrationWarning />}
      link='shinsa://'
      facts={<p data-open-handle className='text-fg-2 text-xs' suppressHydrationWarning />}
    />
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

export function OpenReview() {
  const [view, setView] = React.useState<OpenView | null>(null);
  React.useEffect(() => {
    const invite = resolveTaskInvite(window.location.search);
    void readReviewFragment(window.location.hash).then((payload) => {
      if (!payload) {
        setView({ kind: 'invite', invite });
        return;
      }
      setView({
        kind: 'review',
        scene: { ...createOpenState(payload, Date.now()), payload, link: invite?.link ?? null },
      });
    });
  }, []);
  if (!view) return <PendingHeader />;
  if (view.kind === 'invite') return <InviteHeader invite={view.invite} />;
  return <ReviewPage scene={view.scene} />;
}
