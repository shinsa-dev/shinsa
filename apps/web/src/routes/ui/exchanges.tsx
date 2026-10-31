import type { Task } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import { ChecklistMark } from '@shinsa/ui/components/checklist';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CheckStateIcon, ChecksBlock } from '@/components/checks/checks-list.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { DisclosureChevron, DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { FileLink } from '@/components/links/file.tsx';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { notPersisted, useDisclosure } from '@/lib/preferences/disclosure.ts';
import type { ChecksView } from '@/lib/tasks/checks.ts';
import {
  createExchangesScene,
  type ExchangesScene,
  type PointOutcome,
  type SampleExchange,
} from './sample-exchanges.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const REVIEW_TITLE = 'Built and checked. Your turn to review the changes.';

const POINT_OUTCOME: Record<
  Exclude<PointOutcome, 'done'>,
  { icon: IconName; label: string; className: string }
> = {
  answered: { icon: 'IconBubbleText', label: 'Answered', className: 'text-primary-text' },
  not_changed: { icon: 'IconCircleMinus', label: 'Not changed', className: 'text-fg-2' },
};

function Wide({ children }: { children: React.ReactNode }) {
  return <div className='flex w-full max-w-3xl flex-col gap-2'>{children}</div>;
}

function useSampleFold(name: string, open = false) {
  return useDisclosure(notPersisted(`a /ui sample: ${name}`), open);
}

function FoldedChecks({ task, view, summary }: { task: Task; view: ChecksView; summary: string }) {
  const disclosure = useSampleFold('checks');
  return (
    <div className='flex flex-col gap-2'>
      <DisclosureHeader disclosure={disclosure} label='the checks' className='gap-1.5 text-xs'>
        <CheckStateIcon state='passed' />
        <span className='text-fg-3 group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
          {summary}
        </span>
        <span className='text-2xs text-fg-2'>· agent review found nothing</span>
        <DisclosureChevron className='text-fg-3' />
      </DisclosureHeader>
      {disclosure.open && <ChecksBlock taskId={task.id} view={view} />}
    </div>
  );
}

function ReviewShell({
  scene,
  exchange,
  children,
}: {
  scene: ExchangesScene;
  exchange: SampleExchange;
  children: React.ReactNode;
}) {
  return (
    <NowFrame
      eyebrow={<Eyebrow state={scene.state} task={scene.task} extra={<TimeAgo at={exchange.repliedAt} />} />}
      title={REVIEW_TITLE}
      action={
        <>
          <Button variant='outline' size='sm' onClick={() => void acknowledgeSample()}>
            Review
          </Button>
          <Button size='sm' onClick={() => void acknowledgeSample()}>
            Approve changes
          </Button>
        </>
      }
    >
      {children}
      <FoldedChecks task={scene.task} view={scene.checks} summary={exchange.checks} />
    </NowFrame>
  );
}

function ClampedRequest({ text, lines = 'line-clamp-3' }: { text: string; lines?: string }) {
  const disclosure = useSampleFold('request');
  if (text.length < 240) return <p className='selectable text-fg-3 text-xs'>{text}</p>;
  return (
    <div className='flex flex-col gap-1'>
      <p className={cn('selectable text-fg-3 text-xs', !disclosure.open && lines)}>{text}</p>
      <button
        type='button'
        onClick={disclosure.toggle}
        className='cursor-pointer self-start text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
      >
        {disclosure.open ? 'Show less' : 'Show all'}
      </button>
    </div>
  );
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return <span className='font-medium text-fg-4 text-xs leading-5'>{children}</span>;
}

function NextSteps({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className='flex flex-col gap-1'>
      <SectionCaption>What to do now</SectionCaption>
      <Markdown text={text} className='text-fg-3 text-xs' />
    </div>
  );
}

function QuotedVariant({ scene, exchange }: { scene: ExchangesScene; exchange: SampleExchange }) {
  return (
    <ReviewShell scene={scene} exchange={exchange}>
      <div className={cn(INSET, 'flex flex-col gap-px bg-bg-a1 px-3 py-2.5')}>
        <span className='flex items-center gap-1.5 text-2xs text-fg-2'>
          You asked · <TimeAgo at={exchange.at} />
        </span>
        <ClampedRequest text={exchange.request} />
      </div>
      <Markdown text={`${exchange.headline}\n\n${exchange.reply}`} className='text-fg-4 text-xs' />
      <NextSteps text={exchange.next} />
    </ReviewShell>
  );
}

function InReplyTo({ exchange }: { exchange: SampleExchange }) {
  const disclosure = useSampleFold('in reply to');
  return (
    <div className='flex flex-col gap-1.5'>
      <DisclosureHeader disclosure={disclosure} label='your message' className='gap-1.5 text-2xs text-fg-2'>
        <Icon size='sm' name='IconArrowCornerDownRight' />
        <span className='shrink-0'>In reply to</span>
        <Truncate className='min-w-0 flex-1 text-fg-3 group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
          {exchange.request}
        </Truncate>
        <DisclosureChevron />
      </DisclosureHeader>
      {disclosure.open && (
        <p className='selectable border-border border-s-2 ps-3 text-fg-3 text-xs'>{exchange.request}</p>
      )}
    </div>
  );
}

function ReplyFirstVariant({ scene, exchange }: { scene: ExchangesScene; exchange: SampleExchange }) {
  return (
    <ReviewShell scene={scene} exchange={exchange}>
      <InReplyTo exchange={exchange} />
      <InlineMarkdown text={exchange.headline} className='selectable text-fg-4 text-sm' />
      <Markdown text={exchange.reply} className='text-fg-3 text-xs' />
      <NextSteps text={exchange.next} />
    </ReviewShell>
  );
}

function PointGlyph({ outcome }: { outcome: PointOutcome }) {
  if (outcome === 'done') return <ChecklistMark done label='Done' />;
  const glyph = POINT_OUTCOME[outcome];
  return <Icon size='sm' name={glyph.icon} aria-label={glyph.label} className={glyph.className} />;
}

function PointList({ exchange }: { exchange: SampleExchange }) {
  return (
    <ul className='flex flex-col gap-2'>
      {exchange.points.map((point) => (
        <li key={point.ask} className='flex gap-2.5'>
          <span className='flex h-5 shrink-0 items-center'>
            <PointGlyph outcome={point.outcome} />
          </span>
          <div className='flex min-w-0 flex-col gap-px'>
            <span className='flex flex-wrap items-baseline gap-x-2'>
              <span className='font-medium text-fg-4 text-xs leading-5'>{point.ask}</span>
              {point.outcome !== 'done' && (
                <span className={cn('text-2xs', POINT_OUTCOME[point.outcome].className)}>
                  {POINT_OUTCOME[point.outcome].label}
                </span>
              )}
            </span>
            <InlineMarkdown text={point.note} className='selectable text-fg-3 text-xs' />
          </div>
        </li>
      ))}
    </ul>
  );
}

function FullReply({ exchange }: { exchange: SampleExchange }) {
  const disclosure = useSampleFold('full reply');
  return (
    <div className='flex flex-col gap-1.5'>
      <DisclosureHeader disclosure={disclosure} label='the full reply' className='gap-1.5 text-2xs text-fg-2'>
        <span className='group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
          The full reply and your message
        </span>
        <DisclosureChevron />
      </DisclosureHeader>
      {disclosure.open && (
        <div className='flex flex-col gap-2'>
          <p className='selectable border-border border-s-2 ps-3 text-fg-3 text-xs'>{exchange.request}</p>
          <Markdown text={exchange.reply} className='text-fg-3 text-xs' />
        </div>
      )}
    </div>
  );
}

function ConfirmationsVariant({ scene, exchange }: { scene: ExchangesScene; exchange: SampleExchange }) {
  return (
    <ReviewShell scene={scene} exchange={exchange}>
      <div className='flex flex-col gap-2'>
        <SectionCaption>Your request, point by point</SectionCaption>
        <PointList exchange={exchange} />
      </div>
      <NextSteps text={exchange.next} />
      <FullReply exchange={exchange} />
    </ReviewShell>
  );
}

function ThreadEntry({ exchange, latest }: { exchange: SampleExchange; latest: boolean }) {
  const disclosure = useSampleFold(`thread ${exchange.key}`, latest);
  return (
    <li className='relative flex gap-3 pb-3 last:pb-0'>
      <span className='absolute start-2.25 top-6 bottom-0 in-[li:last-child]:hidden w-px bg-border' />
      <span className='z-1 grid size-5 shrink-0 place-items-center rounded-full bg-bg-a2 text-fg-3'>
        <Icon size='sm' name={exchange.step === 'plan' ? 'IconChecklist' : 'IconUser'} />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <DisclosureHeader disclosure={disclosure} label={exchange.label} className='gap-1.5 text-xs'>
          <span className='shrink-0 font-medium text-fg-4'>{exchange.label}</span>
          <span className='shrink-0 text-2xs text-fg-2'>
            <TimeAgo at={exchange.at} />
          </span>
          {!disclosure.open && (
            <Truncate className='min-w-0 flex-1 text-fg-3 group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
              {exchange.headline}
            </Truncate>
          )}
          <DisclosureChevron />
        </DisclosureHeader>
        {disclosure.open && (
          <div className='flex flex-col gap-2'>
            <p className={cn('selectable text-fg-3 text-xs', latest || 'line-clamp-2')}>
              <span className='text-fg-2'>You: </span>
              {exchange.request}
            </p>
            <div className={cn(INSET, 'flex flex-col gap-1.5 px-3 py-2.5')}>
              <span className='text-2xs text-fg-2'>
                Agent · <TimeAgo at={exchange.repliedAt} />
              </span>
              <InlineMarkdown text={exchange.headline} className='selectable font-medium text-fg-4 text-xs' />
              <Markdown text={exchange.reply} className='text-fg-3 text-xs' />
              {latest && <NextSteps text={exchange.next} />}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function ThreadVariant({ scene }: { scene: ExchangesScene }) {
  const ordered = [...scene.exchanges];
  const latest = ordered.at(-1) as SampleExchange;
  return (
    <ReviewShell scene={scene} exchange={latest}>
      <ol className='flex flex-col'>
        {ordered.map((exchange) => (
          <ThreadEntry key={exchange.key} exchange={exchange} latest={exchange === latest} />
        ))}
      </ol>
    </ReviewShell>
  );
}

function ChangedFiles({ task, exchange }: { task: Task; exchange: SampleExchange }) {
  const added = exchange.files.reduce((sum, file) => sum + file.added, 0);
  const removed = exchange.files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <div className={cn(INSET, 'flex flex-col divide-y divide-border')}>
      <div className='flex items-center gap-1.5 bg-bg-a1 px-3 py-2 text-2xs text-fg-2'>
        <span className='font-medium text-fg-4 text-xs'>Since your last review</span>
        <span>·</span>
        <span className='tabular-nums'>{exchange.files.length} files</span>
        <span className='text-green-text tabular-nums'>+{added}</span>
        <span className='text-red-text tabular-nums'>−{removed}</span>
      </div>
      {exchange.files.map((file) => (
        <div key={file.path} className='flex items-center gap-2 px-3 py-1.5 text-xs'>
          <span className='min-w-0 flex-1 truncate'>
            <FileLink task={task} path={file.path} />
          </span>
          <span className='text-2xs text-green-text tabular-nums'>+{file.added}</span>
          <span className='text-2xs text-red-text tabular-nums'>−{file.removed}</span>
        </div>
      ))}
    </div>
  );
}

function SinceLastReviewVariant({ scene, exchange }: { scene: ExchangesScene; exchange: SampleExchange }) {
  return (
    <ReviewShell scene={scene} exchange={exchange}>
      <InReplyTo exchange={exchange} />
      <InlineMarkdown text={exchange.headline} className='selectable text-fg-4 text-sm' />
      <ChangedFiles task={scene.task} exchange={exchange} />
      <Markdown text={exchange.reply} className='text-fg-3 text-xs' />
      <NextSteps text={exchange.next} />
    </ReviewShell>
  );
}

function VariantLabel({ letter, text }: { letter: string; text: string }) {
  return (
    <span className='flex items-center gap-1.5'>
      <Badge size='sm'>{letter}</Badge>
      {text}
    </span>
  );
}

export function ExchangeSpecimens() {
  const [now] = React.useState(Date.now);
  const [scene] = React.useState(() => createExchangesScene(now));
  const latest = scene.exchanges.at(-1) as SampleExchange;
  return (
    <>
      <Specimen label='A · quoted: your message on an inset, the reply below it, then what to do now'>
        <Wide>
          <VariantLabel letter='A' text='Quoted' />
          <QuotedVariant scene={scene} exchange={latest} />
        </Wide>
      </Specimen>
      <Specimen label='B · reply first: the reply leads, your message folds into one In reply to line'>
        <Wide>
          <VariantLabel letter='B' text='Reply first' />
          <ReplyFirstVariant scene={scene} exchange={latest} />
        </Wide>
      </Specimen>
      <Specimen label='C · confirmations: each point you raised, done, answered or not changed, with why; the full reply folded'>
        <Wide>
          <VariantLabel letter='C' text='Confirmations' />
          <ConfirmationsVariant scene={scene} exchange={latest} />
        </Wide>
      </Specimen>
      <Specimen label='D · thread: plan feedback, requests and replies as one timeline, the latest open'>
        <Wide>
          <VariantLabel letter='D' text='Thread' />
          <ThreadVariant scene={scene} />
        </Wide>
      </Specimen>
      <Specimen label='E · since your last review: the reply with the files it touched and their line counts'>
        <Wide>
          <VariantLabel letter='E' text='Since your last review' />
          <SinceLastReviewVariant scene={scene} exchange={latest} />
        </Wide>
      </Specimen>
    </>
  );
}
