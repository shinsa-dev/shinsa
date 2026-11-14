import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { writeTerminalFilter } from '@/lib/preferences/terminal.ts';
import { resolveFilterLabel, TERMINAL_FILTERS, type TerminalFilter } from '@/lib/terminal/tabs.ts';

export function TerminalFilterMenu({
  filter,
  counts,
}: {
  filter: TerminalFilter;
  counts: Record<TerminalFilter, number>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='secondary'
            size='sm'
            className='ms-auto shrink-0'
            aria-label={`Show: ${resolveFilterLabel(filter)}`}
            icon={{ name: 'IconChevronDownMedium', position: 'inline-end' }}
          >
            {resolveFilterLabel(filter)}
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='min-w-52'>
        <DropdownMenuRadioGroup
          value={filter}
          onValueChange={(value) => writeTerminalFilter(value as TerminalFilter)}
        >
          {TERMINAL_FILTERS.map((entry) => (
            <DropdownMenuRadioItem key={entry.value} value={entry.value} closeOnClick>
              <Icon name={entry.icon} />
              <span>{entry.label}</span>
              <span className='text-fg-2 tabular-nums'>{counts[entry.value]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
