import { Icon } from '@shinsa/ui/components/icon';
import { Tabs, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import { Hint } from '@/components/overlays/hint.tsx';
import { CHECK_TEXT } from '@/components/status/check-mark.tsx';

interface ChoiceItem<V extends string> {
  value: V;
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
}

export function Choice<V extends string>({
  items,
  value,
  onValueChange,
  label,
  onItemIntent,
  className,
}: {
  items: ChoiceItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  label: string;
  onItemIntent?: (value: V) => void;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as V)} className={className}>
      <TabsList aria-label={label}>
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
