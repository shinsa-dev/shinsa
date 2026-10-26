import type { OnboardingOption } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Card } from '@shinsa/ui/components/card';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import { HighlightList } from '@shinsa/ui/components/highlight-list';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import {
  LIST_ROW,
  LIST_ROW_LINE,
  LIST_ROW_LINES,
  LIST_ROW_META,
  LIST_ROW_TITLE,
} from '@/components/layout/list-row.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { SelectedMark } from '@/components/status/check-mark.tsx';
import { isHighlightKey, resolveNextHighlight } from '@/lib/onboarding.ts';

function OptionText({ option }: { option: OnboardingOption }) {
  return (
    <span className='flex min-w-0 flex-1 flex-col gap-px'>
      <span className='flex min-w-0 items-center gap-1.5'>
        <span className={cn(LIST_ROW_TITLE, 'truncate')}>{option.label}</span>
        {option.recommended && <Badge size='sm'>Recommended</Badge>}
      </span>
      {option.detail && <span className={cn(LIST_ROW_META, 'text-pretty')}>{option.detail}</span>}
    </span>
  );
}

function OptionEnd({ busy, selected }: { busy: boolean; selected: boolean }) {
  if (busy) {
    return (
      <span className={cn(ICON_SLOT, 'self-center text-fg-2')}>
        <Spinner size='sm' />
      </span>
    );
  }
  if (!selected) return null;
  return (
    <span className={cn(ICON_SLOT, 'self-center')}>
      <SelectedMark />
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
  children,
}: {
  options: OnboardingOption[];
  values: string[];
  multiple: boolean;
  label: string;
  busyValue: string | null;
  disabled: boolean;
  autoFocus: boolean;
  onPick: (value: string) => void;
  children?: React.ReactNode;
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
    <Card className='gap-0 p-0'>
      {options.length > 0 && (
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
          className='outline-none'
        >
          <HighlightList className='flex flex-col gap-px'>
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
                    LIST_ROW,
                    option.detail ? LIST_ROW_LINES : LIST_ROW_LINE,
                    multiple ? 'px-1.5' : 'ps-2.5 pe-1.5',
                    disabled && 'cursor-default'
                  )}
                >
                  {multiple && (
                    <span className={ICON_SLOT}>
                      <Checkbox
                        size='sm'
                        checked={selected}
                        tabIndex={-1}
                        aria-hidden
                        className='pointer-events-none'
                      />
                    </span>
                  )}
                  <OptionText option={option} />
                  <OptionEnd busy={busyValue === option.value} selected={selected && !multiple} />
                </div>
              );
            })}
          </HighlightList>
        </div>
      )}
      {children}
    </Card>
  );
}
