import { type CommandSection, RANK } from '@/lib/command/registry.ts';
import { REVIEW_KEY, type ReviewStep } from '@/lib/review/keys.ts';

export function listReviewCommands(input: {
  taskId: string;
  count: number;
  step: (step: ReviewStep) => void;
}): CommandSection {
  const id = `task.${input.taskId}.review`;
  const disabled = input.count === 0 ? { disabled: 'This review marks no points' } : {};
  return {
    id,
    heading: 'Review',
    rank: RANK.context,
    commands: [
      {
        kind: 'run',
        id: `${id}.next`,
        label: 'Next point',
        icon: 'IconChevronDownMedium',
        trailing: REVIEW_KEY.next,
        keywords: ['next', 'point', 'spot', 'finding', 'decision', 'down'],
        ...disabled,
        run: () => input.step(1),
      },
      {
        kind: 'run',
        id: `${id}.previous`,
        label: 'Previous point',
        icon: 'IconChevronTopMedium',
        trailing: REVIEW_KEY.previous,
        keywords: ['previous', 'point', 'spot', 'finding', 'decision', 'up'],
        ...disabled,
        run: () => input.step(-1),
      },
    ],
  };
}
