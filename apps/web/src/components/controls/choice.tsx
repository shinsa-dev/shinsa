import { Tabs, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import { Hint } from '@/components/overlays/hint.tsx';

interface ChoiceItem<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

export function Choice<V extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: ChoiceItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  label: string;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as V)} className={className}>
      <TabsList aria-label={label}>
        {items.map((item) => {
          const trigger = (
            <TabsTrigger key={item.value} value={item.value}>
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
