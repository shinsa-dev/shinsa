import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  type CommandSection,
  isChosen,
  toggleCommandMenu,
  useCommandMenuOpen,
  useRegisterCommands,
  useRegisteredSections,
  writeCommandMenuOpen,
} from '@/lib/command/registry.ts';

afterEach(() => {
  act(() => writeCommandMenuOpen(false));
});

function section(id: string, run: () => void, label = 'Do it'): CommandSection {
  return { id, heading: id, rank: 0, commands: [{ kind: 'run', id: `${id}.run`, label, run }] };
}

function firstRun(sections: CommandSection[]) {
  const command = sections[0]?.commands[0];
  if (command?.kind !== 'run') throw new Error('Expected a run command.');
  return command.run;
}

describe('useRegisterCommands', () => {
  it('lists sections while their owner is mounted and drops them on unmount', () => {
    const reader = renderHook(() => useRegisteredSections());
    expect(reader.result.current).toEqual([]);
    const owner = renderHook(() => useRegisterCommands([section('page', () => {})]));
    expect(reader.result.current.map((entry) => entry.id)).toEqual(['page']);
    owner.unmount();
    expect(reader.result.current).toEqual([]);
  });

  it('combines the sections of every mounted owner', () => {
    const reader = renderHook(() => useRegisteredSections());
    renderHook(() => useRegisterCommands([section('first', () => {})]));
    const second = renderHook(() => useRegisterCommands([section('second', () => {})]));
    expect(reader.result.current.map((entry) => entry.id)).toEqual(['first', 'second']);
    second.unmount();
    expect(reader.result.current.map((entry) => entry.id)).toEqual(['first']);
  });

  it('hands the menu the latest closure on its next render without re-rendering it', () => {
    let renders = 0;
    const reader = renderHook(() => {
      renders += 1;
      return useRegisteredSections();
    });
    const before = mock(() => {});
    const after = mock(() => {});
    const owner = renderHook(({ run }) => useRegisterCommands([section('page', run)]), {
      initialProps: { run: before },
    });
    const rendered = renders;
    owner.rerender({ run: after });
    expect(renders).toBe(rendered);
    reader.rerender();
    firstRun(reader.result.current)();
    expect(after).toHaveBeenCalledTimes(1);
    expect(before).not.toHaveBeenCalled();
  });

  it('re-renders the menu when the sections change', () => {
    const reader = renderHook(() => useRegisteredSections());
    const owner = renderHook(({ label }) => useRegisterCommands([section('page', () => {}, label)]), {
      initialProps: { label: 'Approve the plan' },
    });
    owner.rerender({ label: 'Merge #42' });
    expect(reader.result.current[0]?.commands[0]?.label).toBe('Merge #42');
  });
});

describe('isChosen', () => {
  it('checks one value or any of several', () => {
    expect(isChosen({ value: 'dark' }, 'dark')).toBe(true);
    expect(isChosen({ value: 'dark' }, 'light')).toBe(false);
    expect(isChosen({ value: ['a', 'b'] }, 'b')).toBe(true);
    expect(isChosen({ value: ['a', 'b'] }, 'c')).toBe(false);
    expect(isChosen({ value: null }, 'a')).toBe(false);
  });
});

describe('command menu open state', () => {
  it('opens, closes and toggles for every reader', () => {
    const { result } = renderHook(() => useCommandMenuOpen());
    expect(result.current).toBe(false);
    act(() => toggleCommandMenu());
    expect(result.current).toBe(true);
    act(() => writeCommandMenuOpen(false));
    expect(result.current).toBe(false);
  });

  it('does not notify when the state does not change', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useCommandMenuOpen();
    });
    const rendered = renders;
    act(() => writeCommandMenuOpen(false));
    expect(renders).toBe(rendered);
  });

  it('stops notifying a reader after it unmounts', () => {
    const { unmount } = renderHook(() => useCommandMenuOpen());
    unmount();
    act(() => toggleCommandMenu());
    expect(renderHook(() => useCommandMenuOpen()).result.current).toBe(true);
  });
});
