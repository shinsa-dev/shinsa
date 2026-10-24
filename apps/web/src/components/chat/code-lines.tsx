import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { TokenText } from '@/components/text/code-fence.tsx';
import { splitLines } from '@/lib/chat/tool-output.ts';
import type { DiffRow } from '@/lib/code/edit-diff.ts';
import { type Token, useLanguageTokens } from '@/lib/code/highlight.ts';
import { formatCount } from '@/lib/format/count.ts';

export interface CodeLine {
  text: string;
  tokens?: Token[];
  number?: number | null;
  kind?: DiffRow['kind'];
}

const VISIBLE_LINES = 14;

const DIFF_MARK: Record<DiffRow['kind'], string> = { add: '+', remove: '−', context: ' ' };

const SHOW_MORE =
  'flex h-7 w-full cursor-pointer items-center justify-center gap-1 border-border border-t text-2xs text-fg-2 transition-colors duration-150 hover:bg-bg-a1 hover:text-fg-4 active:bg-bg-a1 active:text-fg-4';

export function ShowMoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type='button' onClick={onClick} className={SHOW_MORE}>
      {label}
      <Icon name='IconChevronDownSmall' className='size-3.5' />
    </button>
  );
}

export function CodeLines({
  lines,
  gutter = null,
  wrap = false,
  tone = 'default',
}: {
  lines: CodeLine[];
  gutter?: 'numbers' | 'diff' | null;
  wrap?: boolean;
  tone?: 'default' | 'failed';
}) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded || lines.length <= VISIBLE_LINES + 2 ? lines : lines.slice(0, VISIBLE_LINES);
  return (
    <>
      <div className='overflow-x-auto'>
        <div
          className={cn(
            'min-w-fit py-2 font-mono text-2xs leading-relaxed',
            tone === 'failed' ? 'text-red-text' : 'text-fg-4'
          )}
        >
          {shown.map((line, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              key={index}
              className={cn(
                'flex',
                line.kind === 'add' && 'bg-green-a1',
                line.kind === 'remove' && 'bg-red-a1'
              )}
            >
              {gutter === 'numbers' && (
                <span className='w-11 shrink-0 select-none pr-3 text-right text-fg-1 tabular-nums'>
                  {line.number ?? ''}
                </span>
              )}
              {gutter === 'diff' && (
                <span
                  className={cn(
                    'w-7 shrink-0 select-none text-center',
                    line.kind === 'add' && 'text-green-text',
                    line.kind === 'remove' && 'text-red-text',
                    (line.kind ?? 'context') === 'context' && 'text-fg-1'
                  )}
                >
                  {DIFF_MARK[line.kind ?? 'context']}
                </span>
              )}
              <span
                className={cn(
                  'min-h-[1lh] min-w-0 flex-1 pr-3',
                  gutter === null && 'pl-3',
                  wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                )}
              >
                <TokenText text={line.text} tokens={line.tokens} />
              </span>
            </div>
          ))}
        </div>
      </div>
      {shown.length < lines.length && (
        <ShowMoreButton
          label={`Show ${formatCount(lines.length - shown.length, 'more line', 'more lines')}`}
          onClick={() => setExpanded(true)}
        />
      )}
    </>
  );
}

export function DetailBlock({
  label,
  copy,
  children,
}: {
  label?: React.ReactNode;
  copy?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {label && <span className='flex min-w-0 items-center gap-2 text-2xs text-fg-2'>{label}</span>}
      <div className='group/block corner-superellipse/1.125 relative min-w-0 overflow-hidden rounded-lg border border-border bg-bg-a1'>
        {children}
        {copy && (
          <CopyButton
            text={copy}
            className='absolute top-1 right-1 bg-card opacity-0 transition-opacity duration-150 group-hover/block:opacity-100'
          />
        )}
      </div>
    </div>
  );
}

export function HighlightedBlock({
  code,
  language,
  label,
  wrap = false,
  tone,
}: {
  code: string;
  language: string | null;
  label?: React.ReactNode;
  wrap?: boolean;
  tone?: 'default' | 'failed';
}) {
  const tokens = useLanguageTokens(code, language);
  const lines = splitLines(code).map((text, index) => ({ text, tokens: tokens?.[index] }));
  return (
    <DetailBlock label={label} copy={code}>
      <CodeLines lines={lines} wrap={wrap} tone={tone} />
    </DetailBlock>
  );
}
