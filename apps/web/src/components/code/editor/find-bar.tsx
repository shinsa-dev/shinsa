import type { EditorView } from '@codemirror/view';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { SearchField } from '@/components/code/search-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { countMatches, describeMatchCount, readFindQuery, updateFindQuery } from '@/lib/code/editor/find.ts';
import { closeSearchPanel, findNext, findPrevious } from '@/lib/code/editor/setup.ts';

function FindButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: 'IconChevronTopMedium' | 'IconChevronDownMedium' | 'IconCrossSmall';
  onClick: () => void;
}) {
  return (
    <Hint label={label}>
      <Button variant='secondary' size='icon-xs' icon={icon} aria-label={label} onClick={onClick} />
    </Hint>
  );
}

export function FindBar({ view }: { view: EditorView }) {
  const query = readFindQuery(view.state);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const count = describeMatchCount(countMatches(view.state), query.text);
  return (
    <div className='flex items-center gap-1.5 px-2 py-1.5 font-sans'>
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
            closeSearchPanel(view);
            view.focus();
          }
        }}
        className='max-w-80'
      />
      <span aria-live='polite' className='min-w-16 text-2xs text-fg-2 tabular-nums'>
        {count}
      </span>
      <FindButton label='Previous match' icon='IconChevronTopMedium' onClick={() => findPrevious(view)} />
      <FindButton label='Next match' icon='IconChevronDownMedium' onClick={() => findNext(view)} />
      <span className='flex-1' />
      <FindButton
        label='Close'
        icon='IconCrossSmall'
        onClick={() => {
          closeSearchPanel(view);
          view.focus();
        }}
      />
    </div>
  );
}
