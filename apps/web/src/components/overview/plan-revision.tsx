import type { PhaseChange } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { InlineMarkdown } from '@/components/text/markdown.tsx';

const PHASE_CHANGE_LABELS: Record<PhaseChange, string> = { added: 'New', changed: 'Changed' };

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
