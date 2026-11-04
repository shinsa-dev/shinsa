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
      <div className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 sm:gap-y-px'>
        <span className='col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 self-center text-2xs sm:self-start'>
          <span className={cn('shrink-0 font-medium', TONE_TEXT[tone])}>{label}</span>
          {place}
        </span>
        <Markdown
          text={body}
          className={cn('col-span-2 row-start-2 selectable text-fg-4', action && 'sm:col-span-1')}
        />
        {action && (
          <span className='col-start-2 row-start-1 flex shrink-0 items-center gap-1.5 sm:row-span-2'>
            {action}
          </span>
        )}
      </div>
      {children}
      {fix && <SuggestedFix text={fix} />}
    </div>
  );
}
