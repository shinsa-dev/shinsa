import type * as React from 'react';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';

export function NoteHead({
  label,
  title,
  body,
  action = null,
}: {
  label: React.ReactNode;
  title: string | null | undefined;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 flex-col gap-px text-xs'>
      <div className='flex min-w-0 items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-px'>
          <span className='flex min-w-0 items-center gap-1.5 text-2xs'>{label}</span>
          {title && <InlineMarkdown text={title} className='font-medium text-fg-4 leading-5' />}
        </div>
        {action && <span className='flex shrink-0 items-center gap-1.5'>{action}</span>}
      </div>
      <Markdown text={body} className={title ? 'text-fg-3' : 'text-fg-4'} />
    </div>
  );
}
