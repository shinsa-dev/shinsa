import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CodeBlock } from '@/components/text/code-block.tsx';
import { TokenText } from '@/components/text/code-fence.tsx';
import { splitLines } from '@/lib/chat/tool-output.ts';
import { type CodeCorner, resolveCodeCorner } from '@/lib/code/block.ts';
import { type Token, useLanguageTokens } from '@/lib/code/highlight.ts';
import { formatCount } from '@/lib/format/count.ts';

export interface CodeLine {
  text: string;
  tokens?: Token[];
  number?: number | null;
}

const VISIBLE_LINES = 14;

const SHOW_MORE =
  'flex h-7 w-full cursor-pointer items-center justify-center gap-1 border-border border-t text-2xs text-fg-2 hover:bg-bg-a1 hover:text-fg-4 active:bg-bg-a1 active:text-fg-4';

export function ShowMoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type='button' onClick={onClick} className={SHOW_MORE}>
      {label}
      <Icon size='sm' name='IconChevronDownSmall' />
    </button>
  );
}

export function CodeLines({
  lines,
  language = null,
  gutter = null,
  wrap = false,
  tone = 'default',
}: {
  lines: CodeLine[];
  language?: string | null;
  gutter?: 'numbers' | null;
  wrap?: boolean;
  tone?: 'default' | 'failed';
}) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded || lines.length <= VISIBLE_LINES + 2 ? lines : lines.slice(0, VISIBLE_LINES);
  const source = React.useMemo(
    () => (language ? shown.map((line) => line.text).join('\n') : null),
    [language, shown]
  );
  const tokens = useLanguageTokens(source, language);
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
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <div key={index} className='flex'>
              {gutter === 'numbers' && (
                <span className='w-11 shrink-0 select-none pr-3 text-right text-fg-1 tabular-nums'>
                  {line.number ?? ''}
                </span>
              )}
              <span
                className={cn(
                  'min-h-[1lh] min-w-0 flex-1 pr-3',
                  gutter === null && 'pl-3',
                  wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                )}
              >
                <TokenText text={line.text} tokens={line.tokens ?? tokens?.[index]} />
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
  corner,
  children,
}: {
  label?: React.ReactNode;
  copy?: string | null;
  corner?: CodeCorner;
  children: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {label && <span className='flex min-w-0 items-center gap-2 text-2xs text-fg-2'>{label}</span>}
      <CodeBlock copy={copy || null} corner={corner}>
        {children}
      </CodeBlock>
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
  const lines = React.useMemo(() => splitLines(code).map((text) => ({ text })), [code]);
  return (
    <DetailBlock label={label} copy={code} corner={resolveCodeCorner(code)}>
      <CodeLines lines={lines} language={language} wrap={wrap} tone={tone} />
    </DetailBlock>
  );
}
