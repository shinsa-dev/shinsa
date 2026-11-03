import { FilterBar, FilterChip, FilterClear, FilterMenu } from '@shinsa/ui/components/filter-bar';
import { Hint } from '@/components/overlays/hint.tsx';
import { UserAvatar } from '@/components/people/user-tag.tsx';
import { applyFilterValues, clearTaskFilters, toggleTaskFilter } from '@/lib/command/tasks.ts';
import { useRemoteSnapshot } from '@/lib/connection/socket.ts';
import {
  type TaskFilterField,
  type TaskFilterKey,
  type TaskFilters,
  YOUR_TASKS_OWNER,
} from '@/lib/tasks/filters.ts';

interface TaskFilterProps {
  fields: readonly TaskFilterField[];
  filters: TaskFilters;
}

function useOwnerAvatars(fields: readonly TaskFilterField[]) {
  const you = useRemoteSnapshot()?.access?.owner;
  return fields.map((field) => {
    if (field.key !== 'owner') return field;
    return {
      ...field,
      options: field.options.map((option) => {
        const user = option.value === YOUR_TASKS_OWNER ? you : option.user;
        return user ? { ...option, media: <UserAvatar user={user} size='menu' /> } : option;
      }),
    };
  });
}

export function TaskFilterMenu({ fields: plain, filters }: TaskFilterProps) {
  const fields = useOwnerAvatars(plain);
  return (
    <FilterMenu
      fields={fields}
      selected={filters}
      onToggle={(key: TaskFilterKey, value) => toggleTaskFilter(filters, key, value)}
      onClear={clearTaskFilters}
      wrapTrigger={(trigger) => <Hint label='Filter'>{trigger}</Hint>}
    />
  );
}

export function TaskFilterChips({ fields: plain, filters }: TaskFilterProps) {
  const fields = useOwnerAvatars(plain);
  const chosen = fields.filter((field) => filters[field.key].length > 0);
  if (chosen.length === 0) return null;
  const unused = fields.filter((field) => filters[field.key].length === 0);
  return (
    <FilterBar>
      {chosen.map((field) => (
        <FilterChip
          key={field.key}
          field={field}
          values={filters[field.key]}
          onToggle={(key: TaskFilterKey, value) => toggleTaskFilter(filters, key, value)}
          onRemove={() => applyFilterValues(field.key, [])}
        />
      ))}
      {unused.length > 0 && (
        <FilterMenu
          variant='add'
          fields={unused}
          selected={filters}
          onToggle={(key: TaskFilterKey, value) => toggleTaskFilter(filters, key, value)}
        />
      )}
      {chosen.length > 1 && <FilterClear onClick={clearTaskFilters} />}
    </FilterBar>
  );
}
