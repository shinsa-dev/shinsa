'use client';

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
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { type MenuItemIcon, renderMenuIcon } from '@shinsa/ui/components/menu-icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

/**
 * A composable, multi-value filter system:
 *
 *   <FilterMenu fields selected onToggle onClear />   the entry point, an icon button
 *   <FilterBar>                                        the row of active filters
 *     <FilterChip field values onToggle onRemove />    one per filtered field, edited in place
 *     <FilterMenu variant='add' … />                    adds another field from the row
 *     <FilterClear onClick />                           clears every field
 *   </FilterBar>
 *
 * Fields and their options are plain data, so the page owns where the
 * selection lives (the URL, state) and the same fields can feed ⌘K.
 */

export type FilterOption = { value: string; label: string; icon?: MenuItemIcon; count?: number };

export type FilterField<K extends string = string> = {
  key: K;
  label: string;
  icon: IconName;
  options: readonly FilterOption[];
};

export type FilterSelection<K extends string = string> = Readonly<Record<K, readonly string[]>>;

type Toggle<K extends string> = (key: K, value: string) => void;

const MENU_LIST = 'max-h-80 max-w-72 overflow-y-auto';

function FilterOptionItems<K extends string>({
  field,
  values,
  onToggle,
}: {
  field: FilterField<K>;
  values: readonly string[];
  onToggle: Toggle<K>;
}) {
  return field.options.map((option) => (
    <DropdownMenuCheckboxItem
      key={option.value}
      checked={values.includes(option.value)}
      onCheckedChange={() => onToggle(field.key, option.value)}
    >
      {renderMenuIcon(option.icon, 'inline-start')}
      <Truncate>{option.label}</Truncate>
      {option.count !== undefined && (
        <span className='ms-auto ps-3 text-fg-2 tabular-nums'>{option.count}</span>
      )}
    </DropdownMenuCheckboxItem>
  ));
}

function countSelected<K extends string>(fields: readonly FilterField<K>[], selected: FilterSelection<K>) {
  return fields.filter((field) => (selected[field.key] ?? []).length > 0).length;
}

function FilterMenu<K extends string>({
  fields,
  selected,
  onToggle,
  onClear,
  variant = 'button',
  label = 'Filter',
  wrapTrigger = (trigger) => trigger,
  className,
}: {
  fields: readonly FilterField<K>[];
  selected: FilterSelection<K>;
  onToggle: Toggle<K>;
  onClear?: () => void;
  /** `button` is the icon button beside a search field; `add` is the small plus at the end of a FilterBar. */
  variant?: 'button' | 'add';
  label?: string;
  /** Wraps the trigger, for a tooltip that needs the trigger element itself. */
  wrapTrigger?: (trigger: React.ReactElement<Record<string, unknown>>) => React.ReactElement;
  className?: string;
}) {
  const active = countSelected(fields, selected);
  const trigger =
    variant === 'add' ? (
      <Button
        variant='secondary'
        size='icon-xs'
        icon='IconPlusSmall'
        aria-label='Add a filter'
        className={className}
      />
    ) : (
      <Button
        variant='secondary'
        size='icon'
        icon='IconFilter1'
        aria-label={active > 0 ? `${label}, ${active} on` : label}
        data-active={active > 0 ? '' : undefined}
        disabled={fields.length === 0}
        className={cn('before:bg-input data-active:text-fg-4', className)}
      />
    );
  return (
    <DropdownMenu>
      {wrapTrigger(<DropdownMenuTrigger render={trigger} />)}
      <DropdownMenuContent align={variant === 'add' ? 'start' : 'end'} className='min-w-44'>
        {fields.map((field) => {
          const values = selected[field.key] ?? [];
          return (
            <DropdownMenuSub key={field.key}>
              <DropdownMenuSubTrigger>
                <Icon name={field.icon} />
                {field.label}
                {values.length > 0 && (
                  <span className='ms-auto ps-3 text-fg-2 tabular-nums'>{values.length}</span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={MENU_LIST}>
                <FilterOptionItems field={field} values={values} onToggle={onToggle} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        {onClear && active > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon='IconCrossMedium' onClick={onClear}>
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterBar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot='filter-bar' className={cn('flex flex-wrap items-center gap-1.5', className)} {...props} />
  );
}

const CHIP_PART = 'flex items-center gap-1 px-1.5';

const CHIP_BUTTON = cn(CHIP_PART, 'cursor-pointer outline-none hover:bg-bg-a2 hover:text-fg-4');

function describeValues(field: FilterField, values: readonly string[]) {
  const labels = values.map(
    (value) => field.options.find((option) => option.value === value)?.label ?? value
  );
  const shown = labels.slice(0, 2).join(', ');
  return labels.length > 2 ? `${shown} +${labels.length - 2}` : shown;
}

function FilterChip<K extends string>({
  field,
  values,
  onToggle,
  onRemove,
  className,
}: {
  field: FilterField<K>;
  values: readonly string[];
  onToggle: Toggle<K>;
  onRemove: () => void;
  className?: string;
}) {
  const icons = values
    .map((value) => field.options.find((option) => option.value === value)?.icon)
    .filter((icon) => icon !== undefined)
    .slice(0, 3);
  return (
    <div
      data-slot='filter-chip'
      className={cn(
        'corner-superellipse/1.125 flex h-5.5 max-w-full items-stretch divide-x divide-background overflow-hidden rounded-control-sm bg-bg-a2/70 text-xs font-medium [--icon-size:var(--icon-size-sm)]',
        className
      )}
    >
      <span className={cn(CHIP_PART, 'pl-2 text-fg-2')}>
        <Icon name={field.icon} />
        {field.label}
        <span className='text-fg-1'>{values.length > 1 ? 'is any of' : 'is'}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type='button'
              aria-label={`Change the ${field.label.toLowerCase()} filter`}
              className={cn(CHIP_BUTTON, 'min-w-0 text-fg-4')}
            >
              {icons.length > 0 && (
                <span className='flex shrink-0 items-center -space-x-1'>
                  {icons.map((icon, index) => (
                    <span key={index} className='flex'>
                      {renderMenuIcon(icon, 'inline-start')}
                    </span>
                  ))}
                </span>
              )}
              <Truncate className='max-w-56'>{describeValues(field, values)}</Truncate>
            </button>
          }
        />
        <DropdownMenuContent align='start' className={MENU_LIST}>
          <FilterOptionItems field={field} values={values} onToggle={onToggle} />
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type='button'
        aria-label={`Remove the ${field.label.toLowerCase()} filter`}
        onClick={onRemove}
        className={cn(CHIP_BUTTON, 'px-1 text-fg-2')}
      >
        <Icon name='IconCrossSmall' />
      </button>
    </div>
  );
}

function FilterClear({
  children = 'Clear all',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button variant='bare' size='xs' {...props}>
      {children}
    </Button>
  );
}

export { FilterBar, FilterChip, FilterClear, FilterMenu };
