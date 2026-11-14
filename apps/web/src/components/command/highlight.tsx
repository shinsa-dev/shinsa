import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { listMatchRanges } from '@/lib/command/search/score.ts';

function listParts(text: string, query: string) {
  const parts: { key: number; text: string; hit: boolean }[] = [];
  let at = 0;
  for (const range of listMatchRanges(text, query)) {
    if (range.start > at) parts.push({ key: at, text: text.slice(at, range.start), hit: false });
    parts.push({ key: range.start, text: text.slice(range.start, range.end), hit: true });
    at = range.end;
  }
  if (at < text.length) parts.push({ key: at, text: text.slice(at), hit: false });
  return parts;
}

export function MatchedLabel({ text, query }: { text: string; query: string }) {
  if (query === '') return <Truncate className='min-w-0'>{text}</Truncate>;
  return (
    <Truncate className='min-w-0' tooltip={text}>
      {listParts(text, query).map((part) =>
        part.hit ? (
          <mark
            key={part.key}
            className='bg-transparent font-semibold text-fg-4 in-data-[variant=destructive]:text-red-4'
          >
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={part.key}>{part.text}</React.Fragment>
        )
      )}
    </Truncate>
  );
}
