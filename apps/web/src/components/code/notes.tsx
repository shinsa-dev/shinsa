import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { CodeNote } from '@/lib/code/notes.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import { describeCommentLines, type LineComment } from '@/lib/review/draft.ts';

const NOTE =
  'flex max-w-[min(36rem,calc(100cqw-6rem))] flex-col gap-1.5 rounded-lg px-3 py-2 font-sans text-xs';

const FINDING_SURFACE = { red: 'bg-red-a1', amber: 'bg-amber-a1' } as const;

function CommentNote({ comment, onRemove }: { comment: LineComment; onRemove: (() => void) | null }) {
  return (
    <div className={cn(NOTE, 'bg-primary-a1')}>
      <div className='flex items-center gap-2'>
        <Icon size='sm' name='IconBubbleText' className='text-primary-text' />
        <span className='min-w-0 flex-1 truncate text-2xs text-fg-2'>
          Your comment · {describeCommentLines(comment)}
        </span>
        {onRemove && (
          <button
            type='button'
            className='cursor-pointer text-2xs text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <p className='whitespace-pre-wrap break-words text-fg-4'>{comment.text}</p>
    </div>
  );
}

function CommentComposer({
  label,
  onSave,
  onCancel,
}: {
  label: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = React.useState('');
  return (
    <div className={cn(NOTE, 'border border-border bg-background')}>
      <span className='text-2xs text-fg-2'>{label}</span>
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
        className='corner-superellipse/1.125 field-sizing-content min-h-14 w-full resize-none rounded-control bg-bg-2 px-2.5 py-1.5 text-fg-4 text-xs outline-none placeholder:text-fg-2'
      />
      <div className='flex items-center gap-1.5'>
        <Button size='xs' disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          Add comment
        </Button>
        <Button variant='secondary' size='xs' onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CodeNoteView({
  note,
  onRemove,
  onSave,
  onCancel,
}: {
  note: CodeNote;
  onRemove: ((id: string) => void) | null;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  if (note.kind === 'finding') {
    return (
      <div className={cn(NOTE, FINDING_SURFACE[note.tone])}>
        <span className='font-medium text-fg-4'>{note.label}</span>
        <p className='whitespace-pre-wrap text-fg-3'>{note.text}</p>
      </div>
    );
  }
  if (note.kind === 'comment') {
    return (
      <CommentNote comment={note.comment} onRemove={onRemove ? () => onRemove(note.comment.id) : null} />
    );
  }
  return (
    <CommentComposer
      label={`Comment · ${describeCommentLines({ side: note.side, line: note.start, endLine: note.endLine })}`}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}
