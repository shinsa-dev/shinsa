import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_TITLE } from '@/components/layout/page/heading.tsx';
import { CARD, CARD_FOOTER } from '@/components/layout/surface/card.ts';
import { TaskTrack } from '@/components/overview/progress-track.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import {
  resolveStatusCard,
  STATUS_EYEBROW,
  STATUS_LATEST_TITLE,
  STATUS_NO_UPDATE,
  STATUS_REQUEST_TITLE,
  STATUS_ROUNDS_TITLE,
  type StatusRound,
} from '@/lib/share/status.ts';
import type { SharedView } from '@/lib/share/view.ts';

function StatusSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='flex flex-col gap-1.5 border-border border-t px-4 py-3'>
      <h2 className='text-2xs text-fg-2'>{title}</h2>
      {children}
    </section>
  );
}

function StatusRoundRow({ round }: { round: StatusRound }) {
  return (
    <li className='flex min-w-0 flex-col gap-1 py-1.5'>
      <div className='flex min-w-0 items-center gap-2 text-xs'>
        <span className='shrink-0 text-fg-4'>Round {round.number}</span>
        <ToneLabel label={round.status.label} tone={round.status.tone} />
        <span className='ms-auto shrink-0 text-2xs text-fg-2'>{round.time}</span>
      </div>
      <p className='selectable line-clamp-2 text-fg-3 text-xs'>{round.request}</p>
    </li>
  );
}

export function StatusCardPage({ view }: { view: SharedView }) {
  const card = resolveStatusCard(view.task, useNow());
  return (
    <main className={cn(PAGE_COLUMN, PAGE_TOP, 'flex max-w-xl flex-col gap-3 pb-10')}>
      <p className='flex items-center gap-1.5 text-2xs text-fg-2'>
        <Icon size='sm' name='IconGauge' />
        <span>{STATUS_EYEBROW}</span>
        <span>·</span>
        <TimeAgo at={view.updatedAt} />
      </p>
      <article className={cn(CARD, 'flex flex-col overflow-hidden')}>
        <header className='flex flex-col gap-1.5 px-4 py-3'>
          <ToneLabel label={card.stage.label} tone={card.stage.tone} />
          <h1 className={cn(PAGE_TITLE, 'selectable')}>{card.title}</h1>
        </header>
        <StatusSection title={STATUS_LATEST_TITLE}>
          {card.latest ? (
            <Markdown text={card.latest} className='text-xs' />
          ) : (
            <p className='text-fg-2 text-xs'>{STATUS_NO_UPDATE}</p>
          )}
        </StatusSection>
        {card.request && (
          <StatusSection title={STATUS_REQUEST_TITLE}>
            <Markdown text={card.request} className='text-xs' />
          </StatusSection>
        )}
        {card.rounds.length > 0 && (
          <StatusSection title={STATUS_ROUNDS_TITLE}>
            <ol className='flex flex-col divide-y divide-border'>
              {card.rounds.map((round) => (
                <StatusRoundRow key={round.number} round={round} />
              ))}
            </ol>
          </StatusSection>
        )}
        <div className={CARD_FOOTER}>
          <TaskTrack task={view.task} />
        </div>
      </article>
    </main>
  );
}
