import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { renderMenuIcon } from '@shinsa/ui/components/menu-icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { Hint } from '@/components/overlays/hint.tsx';
import { applyFilterValues, clearTaskFilters, toggleTaskFilter } from '@/lib/command/tasks.ts';
import {
  countActiveFilters,
  describeFilterChoice,
  type TaskFilterField,
  type TaskFilters,
} from '@/lib/tasks/filters.ts';

export function TaskFilterMenu({
  fields,
  filters,
}: {
  fields: readonly TaskFilterField[];
  filters: TaskFilters;
}) {
  const active = countActiveFilters(filters);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='sm' icon='IconFilter1' disabled={fields.length === 0}>
            Filter
            {active > 0 && <span className='text-fg-2 tabular-nums'>{active}</span>}
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='min-w-44'>
        {fields.map((field) => (
          <DropdownMenuSub key={field.key}>
            <DropdownMenuSubTrigger>
              <Icon name={field.icon} />
              {field.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='max-h-80 max-w-72 overflow-y-auto'>
              {field.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={filters[field.key].includes(option.value)}
                  onCheckedChange={() => toggleTaskFilter(filters, field.key, option.value)}
                >
                  {renderMenuIcon(option.icon, 'inline-start')}
                  <Truncate>{option.label}</Truncate>
                  <span className='ms-auto ps-3 text-fg-2 tabular-nums'>{option.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {active > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon='IconCrossMedium' onClick={clearTaskFilters}>
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskFilterChips({
  fields,
  filters,
}: {
  fields: readonly TaskFilterField[];
  filters: TaskFilters;
}) {
  const chosen = fields.filter((field) => filters[field.key].length > 0);
  if (chosen.length === 0) return null;
  return (
    <div className='-mt-3 flex flex-wrap items-center gap-1.5'>
      {chosen.map((field) => (
        <Hint key={field.key} label={`Remove the ${field.label.toLowerCase()} filter`}>
          <Button
            variant='outline'
            size='xs'
            icon={{ name: 'IconCrossSmall', position: 'inline-end' }}
            onClick={() => applyFilterValues(field.key, [])}
            className='max-w-72'
          >
            <span className='text-fg-2'>{field.label}</span>
            <Truncate>{describeFilterChoice(field, filters[field.key])}</Truncate>
          </Button>
        </Hint>
      ))}
      {chosen.length > 1 && (
        <Button variant='secondary' size='xs' onClick={clearTaskFilters}>
          Clear all
        </Button>
      )}
    </div>
  );
}
