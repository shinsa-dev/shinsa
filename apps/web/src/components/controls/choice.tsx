import { Icon } from '@shinsa/ui/components/icon';
import { Tabs, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { CHECK_TEXT } from '@/components/status/check-mark.tsx';

interface ChoiceItem<V extends string> {
  value: V;
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
}

export function revealActiveItem(strip: HTMLElement) {
  const active = strip.querySelector('[data-active]');
  if (!active) return;
  const bounds = strip.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
  else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
}

export function Choice<V extends string>({
  items,
  value,
  onValueChange,
  label,
  onItemIntent,
  scrolls = false,
  className,
}: {
  items: ChoiceItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  label: string;
  onItemIntent?: (value: V) => void;
  scrolls?: boolean;
  className?: string;
}) {
  const list = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (scrolls && list.current) revealActiveItem(list.current);
  }, [scrolls, value]);
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      className={cn(scrolls && 'max-w-full', className)}
    >
      <TabsList
        ref={list}
        aria-label={label}
        className={cn(scrolls && 'max-w-full justify-start overflow-x-auto overscroll-x-contain')}
      >
        {items.map((item) => {
          const trigger = (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              onPointerEnter={onItemIntent && (() => onItemIntent(item.value))}
              onFocus={onItemIntent && (() => onItemIntent(item.value))}
            >
              {item.checked && <Icon name='IconCheckmark1Small' aria-hidden className={CHECK_TEXT} />}
              {item.label}
            </TabsTrigger>
          );
          if (!item.hint) return trigger;
          return (
            <Hint key={item.value} label={item.hint}>
              {trigger}
            </Hint>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
