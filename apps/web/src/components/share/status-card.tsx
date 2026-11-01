import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_TITLE } from '@/components/layout/page/heading.tsx';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { CARD, CARD_FOOTER } from '@/components/layout/surface/card.ts';
import { TaskTrack } from '@/components/overview/progress-track.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  resolveStatusCard,
  STATUS_EYEBROW,
  STATUS_LATEST_TITLE,
  STATUS_NO_UPDATE,
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

export function StatusCardPage({ view }: { view: SharedView }) {
  const card = resolveStatusCard(view.task);
  return (
    <PageScroll>
      <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex max-w-xl flex-col gap-3 pb-10')}>
        <p className='flex items-center gap-1.5 text-2xs text-fg-2'>
          <Icon size='sm' name='IconProgress75' />
          <span>{STATUS_EYEBROW}</span>
          <span>·</span>
          <TimeAgo at={view.updatedAt} />
        </p>
        <article className={cn(CARD, 'flex flex-col overflow-hidden')}>
          <header className='flex flex-col gap-1.5 px-4 py-3'>
            <ToneLabel label={card.stage.label} tone={card.stage.tone} />
            <h1 className={cn(PAGE_TITLE, 'selectable')}>{card.title}</h1>
            {card.description && <p className='selectable text-fg-3 text-xs'>{card.description}</p>}
          </header>
          <StatusSection title={STATUS_LATEST_TITLE}>
            {card.latest ? (
              <Markdown text={card.latest} className='text-xs' />
            ) : (
              <p className='text-fg-2 text-xs'>{STATUS_NO_UPDATE}</p>
            )}
          </StatusSection>
          <div className={CARD_FOOTER}>
            <TaskTrack task={view.task} />
          </div>
        </article>
      </div>
    </PageScroll>
  );
}
