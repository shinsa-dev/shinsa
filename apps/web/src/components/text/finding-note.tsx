import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { SuggestedFix } from '@/components/text/inset-note.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';

export function FindingNote({
  label,
  tone,
  place = null,
  body,
  fix,
  action = null,
  children = null,
}: {
  label: string;
  tone: Tone;
  place?: React.ReactNode;
  body: string;
  fix: string | null | undefined;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-2 text-xs'>
      <div className='flex min-w-0 items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-px'>
          <span className='flex min-w-0 items-center gap-1.5 text-2xs'>
            <span className={cn('shrink-0 font-medium', TONE_TEXT[tone])}>{label}</span>
            {place}
          </span>
          <Markdown text={body} className='selectable text-fg-4' />
        </div>
        {action && <span className='flex shrink-0 items-center gap-1.5'>{action}</span>}
      </div>
      {children}
      {fix && <SuggestedFix text={fix} />}
    </div>
  );
}
