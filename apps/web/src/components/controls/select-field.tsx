import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@shinsa/ui/components/select';
import { cn } from '@shinsa/ui/lib/utils';

interface SelectFieldItem<Value extends string> {
  value: Value;
  label: string;
  icon?: MenuItemIcon;
  hint?: string;
  disabled?: string;
  group?: string;
}

function listItemGroups<Value extends string>(items: readonly SelectFieldItem<Value>[]) {
  const groups: { label: string | undefined; items: SelectFieldItem<Value>[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

function SelectFieldItems<Value extends string>({ items }: { items: readonly SelectFieldItem<Value>[] }) {
  return items.map((item) => {
    const hint = item.disabled ?? item.hint;
    return (
      <SelectItem key={item.value} value={item.value} icon={item.icon} disabled={item.disabled !== undefined}>
        {item.label}
        {hint && <span className='font-normal text-fg-2'>{hint}</span>}
      </SelectItem>
    );
  });
}

export function SelectField<Value extends string>({
  label,
  items,
  value,
  onValueChange,
  size,
  variant,
  align = 'end',
  className,
}: {
  label: string;
  items: readonly SelectFieldItem<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  size?: 'sm' | 'default';
  variant?: 'default' | 'ghost';
  align?: 'start' | 'end';
  className?: string;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as Value);
      }}
    >
      <SelectTrigger aria-label={label} size={size} variant={variant} className={cn('w-fit', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align} alignItemWithTrigger={false}>
        {listItemGroups(items).map((group) =>
          group.label ? (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              <SelectFieldItems items={group.items} />
            </SelectGroup>
          ) : (
            <SelectFieldItems key={group.items[0]?.value} items={group.items} />
          )
        )}
      </SelectContent>
    </Select>
  );
}
