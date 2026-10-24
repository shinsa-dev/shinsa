import type { OnboardingPrompt } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { ChoiceButton, ChoiceButtons } from '@/components/controls/choice-buttons.tsx';

function SingleChoices({
  prompt,
  onPick,
}: {
  prompt: OnboardingPrompt;
  onPick: (values: string[], label: string) => void;
}) {
  return (
    <ChoiceButtons>
      {prompt.choices.map((choice) => (
        <ChoiceButton
          key={choice.value}
          option={choice}
          onClick={() => onPick([choice.value], choice.label)}
        />
      ))}
    </ChoiceButtons>
  );
}

function MultipleChoices({
  prompt,
  onPick,
}: {
  prompt: OnboardingPrompt;
  onPick: (values: string[], label: string) => void;
}) {
  const [picked, setPicked] = React.useState(
    () => new Set(prompt.choices.filter((choice) => choice.chosen).map((choice) => choice.value))
  );
  const chosen = prompt.choices.filter((choice) => picked.has(choice.value));

  function toggle(value: string) {
    const next = new Set(picked);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setPicked(next);
  }

  return (
    <div className='flex flex-col items-start gap-2.5'>
      <ChoiceButtons>
        {prompt.choices.map((choice) => (
          <ChoiceButton
            key={choice.value}
            option={choice}
            pressed={picked.has(choice.value)}
            onClick={() => toggle(choice.value)}
          />
        ))}
      </ChoiceButtons>
      <Button
        size='sm'
        disabled={chosen.length === 0}
        onClick={() =>
          onPick(
            chosen.map((choice) => choice.value),
            chosen.map((choice) => choice.label).join(', ')
          )
        }
      >
        {prompt.submitLabel}
      </Button>
    </div>
  );
}

export function OnboardingChoices({
  prompt,
  onPick,
}: {
  prompt: OnboardingPrompt;
  onPick: (values: string[], label: string) => void;
}) {
  if (prompt.multiple) return <MultipleChoices prompt={prompt} onPick={onPick} />;
  return <SingleChoices prompt={prompt} onPick={onPick} />;
}
