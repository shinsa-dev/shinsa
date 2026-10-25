import { type CommandSection, RANK } from '@/lib/command/registry.ts';
import { REVIEW_KEY, type ReviewStep } from '@/lib/review/keys.ts';

export function listReviewCommands(input: {
  taskId: string;
  count: number;
  step: (step: ReviewStep) => void;
}): CommandSection {
  const id = `task.${input.taskId}.review`;
  const disabled = input.count === 0 ? { disabled: 'Nothing in this review needs your attention' } : {};
  return {
    id,
    heading: 'Review',
    rank: RANK.context,
    commands: [
      {
        kind: 'run',
        id: `${id}.next`,
        label: 'Next place to check',
        icon: 'IconChevronDownMedium',
        trailing: REVIEW_KEY.next,
        keywords: ['next', 'spot', 'finding', 'attention', 'down'],
        ...disabled,
        run: () => input.step(1),
      },
      {
        kind: 'run',
        id: `${id}.previous`,
        label: 'Previous place to check',
        icon: 'IconChevronTopMedium',
        trailing: REVIEW_KEY.previous,
        keywords: ['previous', 'spot', 'finding', 'attention', 'up'],
        ...disabled,
        run: () => input.step(-1),
      },
    ],
  };
}
