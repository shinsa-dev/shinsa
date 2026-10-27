import type { ReviewFinding, Task } from '@shinsa/core';
import { FindingVerdictChoice } from '@/components/review/verdict-choice.tsx';
import { FindingText } from '@/components/text/finding-text.tsx';

export function FindingVerdicts({ findings, task }: { findings: ReviewFinding[]; task: Task }) {
  return (
    <ul className='flex flex-col divide-y divide-border'>
      {findings.map((finding, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: findings are positional; a verdict names its index
          key={index}
          className='flex py-2 first:pt-0 last:pb-0'
        >
          <FindingText
            finding={finding}
            task={task}
            action={<FindingVerdictChoice task={task} finding={index} />}
          />
        </li>
      ))}
    </ul>
  );
}
