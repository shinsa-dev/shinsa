import type { FindingVerdictKind, ReviewFinding, Task } from '@shinsa/core';
import { Choice } from '@/components/controls/choice.tsx';
import { FindingText } from '@/components/text/finding-text.tsx';
import { resolveVerdict, VERDICT_ITEMS, type VerdictDraft } from '@/lib/overview/verdicts.ts';

export function FindingVerdicts({
  findings,
  draft,
  onChange,
  task = null,
}: {
  findings: ReviewFinding[];
  task?: Task | null;
  draft: VerdictDraft;
  onChange: (index: number, verdict: FindingVerdictKind) => void;
}) {
  return (
    <ul className='flex flex-col divide-y divide-border'>
      {findings.map((finding, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: findings are positional; a verdict names its index
          key={index}
          className='flex items-start gap-3 py-2 first:pt-0 last:pb-0'
        >
          <FindingText finding={finding} task={task} />
          <Choice
            label='Verdict'
            items={VERDICT_ITEMS}
            value={resolveVerdict(draft, index)}
            onValueChange={(verdict) => onChange(index, verdict)}
            className='shrink-0'
          />
        </li>
      ))}
    </ul>
  );
}
