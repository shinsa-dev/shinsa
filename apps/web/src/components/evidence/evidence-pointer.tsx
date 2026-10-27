import type { ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { CARD, CARD_HEADER } from '@/components/layout/surface/card.ts';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { describeEvidenceSummary } from '@/lib/evidence/layout.ts';
import { listRoundEvidence } from '@/lib/evidence/media.ts';

export function EvidencePointer({
  state,
  task,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  onOpen: () => void;
}) {
  const evidence = listRoundEvidence(state.evidence, task);
  if (evidence.length === 0) return null;
  return (
    <section className={cn(CARD, 'overflow-hidden')}>
      <div className={cn(CARD_HEADER, 'font-normal')}>
        <IconSlot>
          <Icon size='sm' name='IconImages1' />
        </IconSlot>
        <span className='min-w-0 truncate text-fg-3'>{describeEvidenceSummary(evidence)} in the review</span>
        <span className='flex-1' />
        <Button variant='link' size='sm' onClick={onOpen}>
          See the evidence
        </Button>
      </div>
    </section>
  );
}
