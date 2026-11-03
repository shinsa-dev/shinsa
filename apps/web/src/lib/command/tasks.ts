import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import {
  describeFilterChoice,
  isFiltering,
  resolveClearedFilters,
  serializeFilterValues,
  type TaskFilterField,
  type TaskFilterKey,
  type TaskFilters,
  toggleFilterValue,
} from '@/lib/tasks/filters.ts';
import { updateSearchParams } from '@/router.ts';

const ANY = 'any';

export function applySearch(text: string) {
  updateSearchParams({ q: text || null }, { replace: true });
}

export function applyFilterValues(key: TaskFilterKey, values: readonly string[]) {
  updateSearchParams({ [key]: serializeFilterValues(values) });
}

export function toggleTaskFilter(filters: TaskFilters, key: TaskFilterKey, value: string) {
  applyFilterValues(key, toggleFilterValue(filters[key], value));
}

export function clearTaskFilters() {
  updateSearchParams(resolveClearedFilters());
}

function resolveFilterCommand(field: TaskFilterField, filters: TaskFilters): Command {
  const picked = filters[field.key];
  const noun = field.label.toLowerCase();
  return {
    kind: 'choice',
    id: `tasks.filter.${field.key}`,
    label: `Filter by ${noun}`,
    hint: describeFilterChoice(field, picked),
    icon: field.icon,
    keywords: ['filter', 'show only', noun],
    heading: field.label,
    value: picked.length > 0 ? [...picked] : [ANY],
    options: [
      { value: ANY, label: `Any ${noun}`, icon: 'IconListBullets', keywords: ['all', 'clear'] },
      ...field.options.map(({ value, label, icon }) => ({ value, label, ...(icon ? { icon } : {}) })),
    ],
    pick: (value) => {
      if (value === ANY) applyFilterValues(field.key, []);
      else toggleTaskFilter(filters, field.key, value);
    },
  };
}

export function listTaskListSections(
  filters: TaskFilters,
  fields: readonly TaskFilterField[]
): CommandSection[] {
  const commands: Command[] = [
    ...fields.map((field) => resolveFilterCommand(field, filters)),
    {
      kind: 'search',
      id: 'tasks.search',
      label: 'Search all tasks',
      icon: 'IconMagnifyingGlass',
      search: applySearch,
    },
  ];
  if (isFiltering(filters)) {
    commands.unshift({
      kind: 'run',
      id: 'tasks.clear',
      label: 'Clear filters',
      icon: 'IconCrossMedium',
      keywords: ['reset', 'remove', 'any', 'all'],
      run: clearTaskFilters,
    });
  }
  return [{ id: 'tasks.filters', heading: 'Filters', rank: RANK.context, commands }];
}
