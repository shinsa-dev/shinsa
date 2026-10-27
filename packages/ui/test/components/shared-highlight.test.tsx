import { describe, expect, it } from 'bun:test';
import { act, render, screen } from '@testing-library/react';
import { Command, CommandItem, CommandList } from '../../src/components/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../src/components/dropdown-menu';
import { HighlightList, HoverHighlight } from '../../src/components/highlight-list';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../src/components/select';
import { INDICATOR_TRANSITION } from '../../src/hooks/use-animated-indicator';
import { flush } from '../support/layout';

const OWN_HIGHLIGHT =
  /(?:^|\s)(?:[\w-[\]=]+:)*(?:hover|active|focus|data-highlighted|data-indicator-here|data-\[highlighted\]|data-\[selected=true\]|data-selected|aria-selected):bg-/;

function expectSharedHighlight(items: HTMLElement[]) {
  const indicators = document.querySelectorAll<HTMLElement>('[data-slot="highlight-indicator"]');
  expect(indicators.length).toBeGreaterThan(0);
  for (const indicator of indicators) {
    expect(indicator.dataset.motion).toBe('move');
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);
    expect(indicator.style.willChange).toBe('transform, opacity');
  }
  for (const item of items) expect(item.className).not.toMatch(OWN_HIGHLIGHT);
}

describe('the shared highlight', () => {
  it('slides on transform alone, on the movement clock', () => {
    expect(INDICATOR_TRANSITION).toBe(
      'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out'
    );
    expect(INDICATOR_TRANSITION).not.toMatch(/\b(?:width|height|top|left|background)/);
  });

  it('draws every dropdown, context and sub menu row', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem variant='destructive'>Delete</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Roadmap</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    await act(() => flush());
    expectSharedHighlight(screen.getAllByRole('menuitem'));
  });

  it('draws every select option', async () => {
    render(
      <Select items={[{ value: 'low', label: 'Low' }]} defaultValue='low' open>
        <SelectTrigger aria-label='Priority'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='low'>Low</SelectItem>
        </SelectContent>
      </Select>
    );
    await act(() => flush());
    expectSharedHighlight(screen.getAllByRole('option'));
  });

  it('draws the command menu, ⌘K and Go to file alike', async () => {
    render(
      <Command>
        <CommandList>
          <CommandItem>Open settings</CommandItem>
          <CommandItem variant='destructive'>Cancel the task</CommandItem>
        </CommandList>
      </Command>
    );
    await act(() => flush());
    expectSharedHighlight(screen.getAllByRole('option'));
  });

  it('draws plain lists the same way', () => {
    render(
      <>
        <HighlightList>
          <div data-highlighted=''>Option</div>
        </HighlightList>
        <HoverHighlight>
          <button type='button' data-highlight-item data-active='true'>
            Home
          </button>
        </HoverHighlight>
      </>
    );
    expectSharedHighlight(screen.getAllByText(/Option|Home/));
  });
});
