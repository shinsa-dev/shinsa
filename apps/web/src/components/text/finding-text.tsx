import type { ReviewFinding, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { CHIP } from '@/components/layout/surface/card.ts';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { describeFindingPlace, type FindingPlace, SEVERITY_LABEL } from '@/lib/review/findings.ts';

export function FindingText({
  severity,
  place,
  message,
  task = null,
}: {
  severity: ReviewFinding['severity'];
  place: FindingPlace;
  message: string;
  task?: Task | null;
}) {
  const where = describeFindingPlace(place);
  const snippet =
    task?.repoId && place.file && place.line !== null ? { task, path: place.file, line: place.line } : null;
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-px text-xs'>
      <span className='flex min-w-0 items-center gap-1.5 text-2xs'>
        <span className={severity === 'blocking' ? 'text-red-text' : 'text-fg-2'}>
          {SEVERITY_LABEL[severity]}
        </span>
        {where && !snippet && <Truncate className={cn(CHIP, 'font-mono')}>{where}</Truncate>}
      </span>
      <InlineMarkdown text={message} className='text-fg-4' />
      {snippet && (
        <div className='mt-1.5'>
          <ChangeSnippet
            task={snippet.task}
            path={snippet.path}
            start={snippet.line}
            end={place.end ?? snippet.line}
            startsOpen={severity === 'blocking'}
          />
        </div>
      )}
    </div>
  );
}
