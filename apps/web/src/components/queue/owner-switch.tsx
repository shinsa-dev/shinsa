import { ChoiceButton, ChoiceButtons } from '@/components/controls/choice-buttons.tsx';
import { useEveryoneQueue, writeEveryoneQueue } from '@/lib/preferences/queue.ts';
import { QUEUE_OWNER_CHOICES } from '@/lib/tasks/owner.ts';

export function QueueOwnerSwitch({ className }: { className?: string }) {
  const everyone = useEveryoneQueue();
  return (
    <div className={className}>
      <ChoiceButtons>
        {QUEUE_OWNER_CHOICES.map((choice) => (
          <ChoiceButton
            key={choice.label}
            option={choice}
            pressed={choice.everyone === everyone}
            onClick={() => writeEveryoneQueue(choice.everyone)}
          />
        ))}
      </ChoiceButtons>
    </div>
  );
}
