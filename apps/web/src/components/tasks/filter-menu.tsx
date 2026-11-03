import { FilterBar, FilterChip, FilterClear, FilterMenu } from '@shinsa/ui/components/filter-bar';
import { Hint } from '@/components/overlays/hint.tsx';
import { applyFilterValues, clearTaskFilters, toggleTaskFilter } from '@/lib/command/tasks.ts';
import type { TaskFilterField, TaskFilterKey, TaskFilters } from '@/lib/tasks/filters.ts';

interface TaskFilterProps {
  fields: readonly TaskFilterField[];
  filters: TaskFilters;
}

export function TaskFilterMenu({ fields, filters }: TaskFilterProps) {
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

export function TaskFilterChips({ fields, filters }: TaskFilterProps) {
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
