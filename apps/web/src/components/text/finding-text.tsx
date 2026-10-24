import type { ReviewFinding } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { CHIP } from '@/components/layout/surface/card.ts';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { describeFindingPlace, type FindingPlace, SEVERITY_LABEL } from '@/lib/review/findings.ts';

export function FindingText({
  severity,
  place,
  message,
}: {
  severity: ReviewFinding['severity'];
  place: FindingPlace;
  message: string;
}) {
  const where = describeFindingPlace(place);
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-px text-xs'>
      <span className='flex min-w-0 items-center gap-1.5 text-2xs'>
        <span className={severity === 'blocking' ? 'text-red-text' : 'text-fg-2'}>
          {SEVERITY_LABEL[severity]}
        </span>
        {where && <Truncate className={cn(CHIP, 'font-mono')}>{where}</Truncate>}
      </span>
      <InlineMarkdown text={message} className='text-fg-4' />
    </div>
  );
}
