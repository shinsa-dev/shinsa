import { Button } from '@shinsa/ui/components/button';
import type { IconName } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { SearchField } from '@/components/code/search-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { SearchOptions } from '@/lib/code/search.ts';
import { describeFindResults } from '@/lib/terminal/tabs.ts';
import type { TerminalView } from '@/lib/terminal/view.ts';

const NO_OPTIONS: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

export function useTerminalView(view: TerminalView | null) {
  const subscribe = React.useCallback(
    (listener: () => void) => view?.subscribe(listener) ?? (() => undefined),
    [view]
  );
  const connection = React.useSyncExternalStore(subscribe, () => view?.connection ?? 'connecting');
  const findOpen = React.useSyncExternalStore(subscribe, () => view?.findOpen ?? false);
  const results = React.useSyncExternalStore(subscribe, () => view?.results ?? null);
  const background = React.useSyncExternalStore(subscribe, () => view?.background ?? null);
  return { connection, findOpen, results, background };
}

export function TerminalPane({ view, shown }: { view: TerminalView; shown: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = host.current;
    if (!(shown && element)) return;
    view.mount(element);
    view.focus();
    return () => view.unmount();
  }, [view, shown]);
  return <div ref={host} hidden={!shown} className='absolute inset-0' />;
}

function FindButton({
  label,
  icon,
  size = 'icon-xs',
  onClick,
}: {
  label: string;
  icon: IconName;
  size?: 'icon-xs' | 'icon-sm';
  onClick: () => void;
}) {
  return (
    <Hint label={label}>
      <Button variant='secondary' size={size} icon={icon} aria-label={label} onClick={onClick} />
    </Hint>
  );
}

export function TerminalFindBar({ view }: { view: TerminalView }) {
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState(NO_OPTIONS);
  const { results } = useTerminalView(view);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const search = (text: string, next: SearchOptions, previous = false) => view.find(text, next, previous);
  return (
    <div className='flex items-center gap-1.5 border-border border-b px-2 py-1.5'>
      <SearchField
        value={query}
        options={options}
        placeholder='Find in the scrollback'
        inputRef={input}
        onValueChange={(text) => {
          setQuery(text);
          search(text, options);
        }}
        onOptionsChange={(next) => {
          setOptions(next);
          search(query, next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            search(query, options, event.shiftKey);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            view.closeFind();
          }
        }}
        className='max-w-80 flex-initial basis-80'
      />
      <span className='flex shrink-0 items-center'>
        <FindButton
          label='Previous match'
          icon='IconChevronTopMedium'
          onClick={() => search(query, options, true)}
        />
        <FindButton label='Next match' icon='IconChevronDownMedium' onClick={() => search(query, options)} />
      </span>
      <span aria-live='polite' className='shrink-0 truncate text-2xs text-fg-2 tabular-nums'>
        {describeFindResults(results, query)}
      </span>
      <span className='flex-1' />
      <FindButton label='Close' icon='IconCrossSmall' size='icon-sm' onClick={() => view.closeFind()} />
    </div>
  );
}
