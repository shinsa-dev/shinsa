import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

export interface ChoiceOption {
  label: string;
  detail?: string | null;
}

export function ChoiceButton({
  option,
  pressed,
  disabled,
  onClick,
}: {
  option: ChoiceOption;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={pressed ? 'primary' : 'outline'}
      size='sm'
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {option.label}
      {option.detail && (
        <span className={cn('font-normal', pressed ? 'opacity-70' : 'text-fg-2')}>{option.detail}</span>
      )}
    </Button>
  );
}

export function ChoiceButtons({ children }: { children: React.ReactNode }) {
  return <div className='flex flex-wrap gap-1.5'>{children}</div>;
}
