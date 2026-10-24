import type { Gate } from '@shinsa/core';
import { ChoiceButton, ChoiceButtons } from '@/components/controls/choice-buttons.tsx';
import { listQuestionChoices } from '@/lib/overview/question.ts';

export function QuestionChoices({
  gate,
  busy,
  onPick,
}: {
  gate: Gate;
  busy: boolean;
  onPick: (choice: string) => void;
}) {
  const choices = listQuestionChoices(gate);
  if (choices.length === 0) return null;
  return (
    <ChoiceButtons>
      {choices.map((choice) => (
        <ChoiceButton
          key={choice.label}
          option={choice}
          disabled={busy}
          onClick={() => onPick(choice.label)}
        />
      ))}
    </ChoiceButtons>
  );
}
