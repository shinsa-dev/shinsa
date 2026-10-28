import type { PhaseChange } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';
import { InlineMarkdown } from '@/components/text/markdown.tsx';

const PHASE_CHANGE_LABELS: Record<PhaseChange, string> = { added: 'New', changed: 'Changed' };

export function PlanFeedback({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className={cn(INSET, 'flex flex-col gap-px bg-bg-a1 px-3 py-2.5 text-xs')}>
      <span className='text-2xs text-fg-2'>You asked</span>
      <InlineMarkdown text={text} className='selectable text-fg-3' />
    </div>
  );
}

export function PlanChangeSummary({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return (
    <div className='flex flex-col gap-px text-xs'>
      <span className='text-2xs text-fg-2'>What changed</span>
      <InlineMarkdown text={summary} className='selectable text-fg-4' />
    </div>
  );
}

export function PlanPhaseTitle({ title, change }: { title: string; change: PhaseChange | null }) {
  return (
    <div className='flex min-w-0 items-start gap-1.5'>
      <InlineMarkdown text={title} className='font-medium text-fg-4 text-xs leading-5' />
      {change && (
        <Badge size='sm' className='mt-px'>
          {PHASE_CHANGE_LABELS[change]}
        </Badge>
      )}
    </div>
  );
}
