import { replaceAll, replaceNext } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import { SearchField } from '@/components/code/search-field.tsx';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { countMatches, describeMatchCount, readFindQuery, updateFindQuery } from '@/lib/code/editor/find.ts';
import { closeSearchPanel, findNext, findPrevious } from '@/lib/code/editor/setup.ts';

function close(view: EditorView) {
  closeSearchPanel(view);
  view.focus();
}

function ReplaceRow({ view }: { view: EditorView }) {
  const query = readFindQuery(view.state);
  return (
    <div className='flex items-center gap-1.5'>
      <span className='size-5.5 shrink-0' />
      <Input
        value={query.replace}
        placeholder='Replace with'
        aria-label='Replace with'
        main-field='true'
        className='max-w-80 flex-initial basis-80'
        onChange={(event) => updateFindQuery(view, query.text, { ...query, replace: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) replaceAll(view);
            else replaceNext(view);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            close(view);
          }
        }}
      />
      <Button variant='secondary' size='xs' onClick={() => replaceNext(view)}>
        Replace
      </Button>
      <Button variant='secondary' size='xs' onClick={() => replaceAll(view)}>
        Replace all
      </Button>
    </div>
  );
}

export function FindBar({
  view,
  replace,
  canReplace,
  onReplace,
}: {
  view: EditorView;
  replace: boolean;
  canReplace: boolean;
  onReplace: (replace: boolean) => void;
}) {
  const query = readFindQuery(view.state);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const count = describeMatchCount(countMatches(view.state), query.text);
  const replacing = replace && canReplace;
  return (
    <div className='flex flex-col gap-1 px-2 py-1.5 font-sans'>
      <div className='flex items-center gap-1.5'>
        {canReplace && (
          <HintButton
            size='icon-xs'
            label={replacing ? 'Hide replace' : 'Show replace'}
            icon={replacing ? 'IconChevronDownSmall' : 'IconChevronRightSmall'}
            onClick={() => onReplace(!replacing)}
          />
        )}
        <SearchField
          value={query.text}
          options={query}
          placeholder='Find in this file'
          inputRef={input}
          onValueChange={(text) => updateFindQuery(view, text, query)}
          onOptionsChange={(options) => updateFindQuery(view, query.text, options)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) findPrevious(view);
              else findNext(view);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              close(view);
            }
          }}
          className='max-w-80 flex-initial basis-80'
        />
        <span className='flex shrink-0 items-center'>
          <HintButton
            size='icon-xs'
            label='Previous match'
            icon='IconChevronTopMedium'
            onClick={() => findPrevious(view)}
          />
          <HintButton
            size='icon-xs'
            label='Next match'
            icon='IconChevronDownMedium'
            onClick={() => findNext(view)}
          />
        </span>
        <span aria-live='polite' className='shrink-0 truncate text-2xs text-fg-2 tabular-nums'>
          {count}
        </span>
        <span className='flex-1' />
        <HintButton label='Close' icon='IconCrossSmall' size='icon-sm' onClick={() => close(view)} />
      </div>
      {replacing && <ReplaceRow view={view} />}
    </div>
  );
}
