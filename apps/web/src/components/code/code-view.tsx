import type { Attention, DiffFile } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { TokenText } from '@/components/text/code-fence.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { type CodeRow, resolveCodeRows, resolveRowAnchor, resolveSegments } from '@/lib/code/diff.ts';
import { type Token, useTokens } from '@/lib/code/highlight.ts';
import { joinRemovedText, MORE_ROWS, mapRowTokens, resolveFocusWindow } from '@/lib/code/rows.ts';
import { useFileContent } from '@/lib/connection/files.ts';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import type { LineComment } from '@/lib/review/draft.ts';
import type { CodeMarker } from '@/lib/review/targets.ts';
import { ATTENTION } from '@/lib/tasks/status.ts';

export interface CodeFocus {
  start: number;
  end: number;
  attention: Attention;
}

const PINNED = 'sticky left-0 w-(--code-width,100%)';

const FILE_CONTEXT = 3;

const TONE_BAR: Record<Tone, string> = {
  neutral: 'before:bg-fg-2',
  blue: 'before:bg-primary-4',
  amber: 'before:bg-amber-4',
  orange: 'before:bg-orange-4',
  green: 'before:bg-green-4',
  red: 'before:bg-red-4',
  purple: 'before:bg-purple-4',
};

const MARKER_SURFACE: Record<CodeMarker['tone'], string> = {
  red: 'bg-red-a1',
  amber: 'bg-amber-a1',
};

function CommentComposer({ onSave, onCancel }: { onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = React.useState('');
  return (
    <div className={cn(PINNED, 'border-border border-y bg-background py-2 pr-3 pl-18 font-sans text-xs')}>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: opened by a click on the line
        autoFocus
        value={text}
        aria-label='Comment'
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (!isSubmitKey(event) || !text.trim()) return;
          event.preventDefault();
          onSave(text.trim());
        }}
        placeholder='What should change here? It goes to the agent with your review.'
        className='corner-superellipse/1.125 field-sizing-content min-h-14 w-full max-w-2xl resize-none rounded-control bg-bg-2 px-2.5 py-1.5 text-fg-4 text-xs outline-none placeholder:text-fg-2'
      />
      <div className='mt-1.5 flex max-w-2xl items-center justify-end gap-1.5'>
        <Button variant='secondary' size='xs' onClick={onCancel}>
          Cancel
        </Button>
        <Button size='xs' disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          Add comment
        </Button>
      </div>
    </div>
  );
}

function CommentNote({ comment, onRemove }: { comment: LineComment; onRemove: () => void }) {
  return (
    <div className={cn(PINNED, 'flex items-start gap-2 bg-primary-a1 py-1.5 pr-3 pl-18 font-sans text-xs')}>
      <Icon name='IconBubbleText' className='mt-px size-3.5 shrink-0 text-primary-text' />
      <span className='min-w-0 flex-1 whitespace-pre-wrap text-fg-4'>{comment.text}</span>
      <button
        type='button'
        className='cursor-pointer text-2xs text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function MarkerNote({ marker }: { marker: CodeMarker }) {
  return (
    <div
      className={cn(
        PINNED,
        'flex items-start gap-2 py-1.5 pr-3 pl-18 font-sans text-xs',
        MARKER_SURFACE[marker.tone]
      )}
    >
      <span className='shrink-0 font-medium text-fg-4'>{marker.label}</span>
      <span className='min-w-0 flex-1 whitespace-normal text-fg-3'>{marker.text}</span>
    </div>
  );
}

function Row({
  row,
  tokens,
  focus,
  dimmed,
  commentable,
  onStartComment,
}: {
  row: CodeRow;
  tokens: Token[] | undefined;
  focus: CodeFocus | null;
  dimmed: boolean;
  commentable: boolean;
  onStartComment: (line: number) => void;
}) {
  const inFocus =
    focus !== null && row.newLine !== null && row.newLine >= focus.start && row.newLine <= focus.end;
  const line = row.newLine;
  return (
    <div
      data-line={line ?? undefined}
      className={cn(
        'group/row relative flex min-w-fit before:absolute before:inset-y-0 before:left-0 before:w-0.5',
        row.kind === 'add' && 'bg-green-a1 before:bg-green-4',
        row.kind === 'remove' && 'bg-red-a1 before:bg-red-4',
        inFocus && cn('bg-primary-a2', TONE_BAR[ATTENTION[focus.attention].tone]),
        dimmed &&
          !inFocus &&
          'opacity-50 transition-opacity duration-150 hover:opacity-100 active:opacity-100'
      )}
    >
      <span
        className={cn(
          'flex w-14 shrink-0 select-none items-center justify-end gap-1 pr-2 text-right text-fg-2 tabular-nums',
          row.kind === 'remove' && 'text-red-text'
        )}
      >
        {commentable && line !== null && (
          <Hint label={`Comment on line ${line}`}>
            <button
              type='button'
              aria-label={`Comment on line ${line}`}
              onClick={() => onStartComment(line)}
              className='grid size-4 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity group-hover/row:opacity-100'
            >
              <Icon name='IconPlusSmall' className='size-3' />
            </button>
          </Hint>
        )}
        {line ?? row.oldLine}
      </span>
      <span className='w-4 shrink-0 select-none text-center text-fg-2'>
        {row.kind === 'add' && '+'}
        {row.kind === 'remove' && '−'}
      </span>
      <span className='whitespace-pre pr-6'>
        {tokens?.length === 0 ? ' ' : <TokenText text={row.text} tokens={tokens} />}
      </span>
    </div>
  );
}

function GapButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        PINNED,
        'flex h-6 cursor-pointer items-center bg-bg-a1 pl-18 font-sans text-2xs text-fg-2 transition-colors duration-150 hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4'
      )}
    >
      {label}
    </button>
  );
}

function useCodeWidth(ready: boolean) {
  const container = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      element.style.setProperty('--code-width', `${element.clientWidth}px`)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);
  return container;
}

export function CodeView({
  taskId,
  file,
  revision,
  focus = null,
  markers,
  mode,
}: {
  taskId: string;
  file: DiffFile;
  revision: number;
  focus?: CodeFocus | null;
  markers: CodeMarker[];
  mode: 'focus' | 'file';
}) {
  const removed = file.status === 'removed';
  const loaded = useFileContent(taskId, removed ? null : file.path, revision);
  const content = loaded.status === 'ready' ? loaded.value : null;
  const ready = removed || loaded.status === 'ready' || loaded.status === 'error';
  const rows = React.useMemo(
    () => (ready ? resolveCodeRows(file.patch, content) : []),
    [file.patch, content, ready]
  );
  const removedText = React.useMemo(() => joinRemovedText(rows), [rows]);
  const currentTokens = useTokens(content, file.path);
  const removedTokens = useTokens(removedText || null, file.path);
  const tokens = React.useMemo(
    () => mapRowTokens(rows, currentTokens, removedTokens),
    [rows, currentTokens, removedTokens]
  );
  const draft = useReviewDraft();
  const [drafting, setDrafting] = React.useState<number | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<number>>(new Set());
  const [extra, setExtra] = React.useState({ above: 0, below: 0 });
  const container = useCodeWidth(ready);
  const focusStart = focus?.start ?? null;
  const focusEnd = focus?.end ?? null;
  const hasRows = rows.length > 0;

  React.useEffect(() => {
    setExtra({ above: 0, below: 0 });
    setDrafting(null);
  }, [focusStart, focusEnd, file.path]);

  React.useEffect(() => {
    if (focusStart === null || !hasRows) return;
    container.current?.querySelector(`[data-line="${focusStart}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusStart, focusEnd, file.path, hasRows]);

  if (!ready) {
    return (
      <div className='flex items-center gap-2 p-3 font-sans text-fg-2 text-xs'>
        <Spinner className='size-3.5' /> Reading {file.path}
      </div>
    );
  }

  const comments = draft.comments.filter((comment) => comment.path === file.path);

  function renderRow(index: number) {
    const row = rows[index];
    if (!row) return null;
    const anchor = resolveRowAnchor(row);
    const kept = row.kind !== 'remove';
    return (
      <React.Fragment key={`${index}-${row.oldLine}-${row.newLine}`}>
        <Row
          row={row}
          tokens={tokens[index]}
          focus={focus}
          dimmed={mode === 'focus' && focus !== null}
          commentable={draft.enabled}
          onStartComment={setDrafting}
        />
        {kept &&
          markers
            .filter((marker) => marker.line === anchor)
            .map((marker) => <MarkerNote key={marker.id} marker={marker} />)}
        {kept &&
          comments
            .filter((comment) => comment.line === anchor)
            .map((comment) => (
              <CommentNote
                key={comment.id}
                comment={comment}
                onRemove={() => draft.removeComment(comment.id)}
              />
            ))}
        {drafting !== null && drafting === row.newLine && (
          <CommentComposer
            onCancel={() => setDrafting(null)}
            onSave={(text) => {
              draft.addComment({ path: file.path, line: drafting, text });
              setDrafting(null);
            }}
          />
        )}
      </React.Fragment>
    );
  }

  function renderRange(start: number, end: number) {
    return Array.from({ length: end - start }, (_, offset) => renderRow(start + offset));
  }

  function renderBody() {
    if (rows.length === 0)
      return <p className='p-3 font-sans text-fg-2 text-xs'>No text changes in this file.</p>;
    if (mode === 'focus' && focus) {
      const { start, end } = resolveFocusWindow(rows, focus, extra);
      return (
        <>
          {start > 0 && (
            <GapButton
              label={`Show more above (${formatCount(start, 'line', 'lines')})`}
              onClick={() => setExtra({ ...extra, above: extra.above + MORE_ROWS })}
            />
          )}
          {renderRange(start, end)}
          {end < rows.length && (
            <GapButton
              label={`Show more below (${formatCount(rows.length - end, 'line', 'lines')})`}
              onClick={() => setExtra({ ...extra, below: extra.below + MORE_ROWS })}
            />
          )}
        </>
      );
    }
    return resolveSegments(rows, FILE_CONTEXT, expanded).map((segment) =>
      segment.kind === 'rows' ? (
        <React.Fragment key={`rows-${segment.start}`}>
          {renderRange(segment.start, segment.end)}
        </React.Fragment>
      ) : (
        <GapButton
          key={`gap-${segment.start}`}
          label={formatCount(segment.end - segment.start, 'unchanged line', 'unchanged lines')}
          onClick={() => setExpanded(new Set([...expanded, segment.start]))}
        />
      )
    );
  }

  return (
    <div ref={container} className='min-h-0 flex-1 overflow-auto font-mono text-2xs leading-[18px]'>
      <div className='min-w-fit py-1'>{renderBody()}</div>
    </div>
  );
}
