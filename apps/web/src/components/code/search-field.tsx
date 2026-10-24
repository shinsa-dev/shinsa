import { Button } from '@shinsa/ui/components/button';
import type { IconName } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { SEARCH_OPTIONS, type SearchOption, type SearchOptions } from '@/lib/code/search.ts';

const PRESSED =
  'text-primary-text before:bg-primary-a2 not-disabled:hover:text-primary-text not-disabled:hover:before:bg-primary-a2 not-disabled:active:text-primary-text not-disabled:active:before:bg-primary-a2';

function SearchToggle({
  label,
  icon,
  pressed,
  onToggle,
}: {
  label: string;
  icon: IconName;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <Hint label={label}>
      <Button
        variant='secondary'
        size='icon-xs'
        icon={icon}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onToggle}
        className={cn(pressed && PRESSED)}
      />
    </Hint>
  );
}

export function SearchField({
  value,
  options,
  placeholder,
  inputRef,
  onValueChange,
  onOptionsChange,
  onKeyDown,
  className,
}: {
  value: string;
  options: SearchOptions;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onValueChange: (value: string) => void;
  onOptionsChange: (options: SearchOptions) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  return (
    <span className={cn('relative flex min-w-0 flex-1 items-center', className)}>
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        main-field='true'
        className='pe-20'
      />
      <span className='absolute inset-y-0 end-0.5 flex items-center'>
        {SEARCH_OPTIONS.map((option: SearchOption) => (
          <SearchToggle
            key={option.key}
            label={option.label}
            icon={option.icon}
            pressed={options[option.key]}
            onToggle={() => onOptionsChange({ ...options, [option.key]: !options[option.key] })}
          />
        ))}
      </span>
    </span>
  );
}
