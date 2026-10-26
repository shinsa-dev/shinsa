import type { OnboardingOption } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD } from '@/components/layout/surface/card.ts';
import { isHighlightKey, resolveNextHighlight } from '@/lib/onboarding.ts';

export const OPTION_ROW = 'flex min-h-12 w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-start';

function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-full border',
        selected ? 'border-primary-4 bg-primary-4 text-primary-foreground' : 'border-icon-1 bg-background'
      )}
    >
      {selected && <span className='size-1.5 rounded-full bg-primary-foreground' />}
    </span>
  );
}

function OptionText({ option }: { option: OnboardingOption }) {
  return (
    <span className='flex min-w-0 flex-1 flex-col gap-px'>
      <span className='flex min-w-0 items-center gap-2'>
        <span className='truncate font-medium text-fg-4 text-sm'>{option.label}</span>
        {option.recommended && <Badge size='sm'>Recommended</Badge>}
      </span>
      {option.detail && <span className='text-pretty text-fg-2 text-xs'>{option.detail}</span>}
    </span>
  );
}

export function OptionList({
  options,
  values,
  multiple,
  label,
  busyValue,
  disabled,
  autoFocus,
  onPick,
}: {
  options: OnboardingOption[];
  values: string[];
  multiple: boolean;
  label: string;
  busyValue: string | null;
  disabled: boolean;
  autoFocus: boolean;
  onPick: (value: string) => void;
}) {
  const chosen = options.findIndex((option) => values.includes(option.value));
  const [highlighted, setHighlighted] = React.useState<number | null>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (autoFocus) list.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (isHighlightKey(event.key)) {
      event.preventDefault();
      setHighlighted(resolveNextHighlight(highlighted ?? chosen, event.key, options.length));
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const option = options[highlighted ?? -1];
    if (!option || disabled) return;
    event.preventDefault();
    onPick(option.value);
  }

  return (
    <div
      ref={list}
      role='listbox'
      tabIndex={0}
      aria-label={label}
      aria-multiselectable={multiple || undefined}
      aria-activedescendant={highlighted === null ? undefined : `${id}-${highlighted}`}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHighlighted(null)}
      className={cn(CARD, 'flex flex-col overflow-hidden outline-none')}
    >
      {options.map((option, index) => {
        const selected = values.includes(option.value);
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox takes the keys for its options
          <div
            key={option.value}
            id={`${id}-${index}`}
            role='option'
            aria-selected={selected}
            tabIndex={-1}
            data-highlighted={index === highlighted || undefined}
            onPointerMove={() => setHighlighted(index)}
            onClick={() => {
              if (!disabled) onPick(option.value);
            }}
            className={cn(
              OPTION_ROW,
              'border-border not-first:border-t data-highlighted:bg-bg-a1',
              disabled && 'cursor-default'
            )}
          >
            {multiple ? (
              <Checkbox
                size='md'
                checked={selected}
                tabIndex={-1}
                aria-hidden
                className='pointer-events-none'
              />
            ) : (
              <RadioMark selected={selected} />
            )}
            <OptionText option={option} />
            {busyValue === option.value ? (
              <Spinner size='sm' className='text-fg-2' />
            ) : (
              !multiple && (
                <Icon
                  name='IconArrowRight'
                  size='sm'
                  className={cn('text-fg-2', index === highlighted ? 'opacity-100' : 'opacity-0')}
                />
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
