import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { renderMenuIcon } from '@shinsa/ui/components/menu-icon';
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
import { ProjectOption } from '@/components/status/project-dot.tsx';

interface SelectFieldItem<Value extends string> {
  value: Value;
  label: string;
  icon?: MenuItemIcon;
  dot?: string;
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

function SelectFieldValue<Value extends string>({
  item,
  value,
}: {
  item: SelectFieldItem<Value> | undefined;
  value: unknown;
}) {
  if (!item) return <span className='truncate'>{String(value ?? '')}</span>;
  if (item.dot) return <ProjectOption color={item.dot} name={item.label} />;
  return (
    <>
      {renderMenuIcon(item.icon, 'inline-start')}
      <span className='truncate'>{item.label}</span>
    </>
  );
}

function SelectFieldItems<Value extends string>({ items }: { items: readonly SelectFieldItem<Value>[] }) {
  return items.map((item) => {
    const hint = item.disabled ?? item.hint;
    return (
      <SelectItem key={item.value} value={item.value} icon={item.icon} disabled={item.disabled !== undefined}>
        {item.dot ? <ProjectOption color={item.dot} name={item.label} /> : item.label}
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
        <SelectValue>
          {(current: unknown) => (
            <SelectFieldValue item={items.find((item) => item.value === current)} value={current} />
          )}
        </SelectValue>
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
