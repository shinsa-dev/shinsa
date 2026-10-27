import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ReviewNote } from '@/components/review/note.tsx';
import type { CodeNote } from '@/lib/code/notes.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import { notPersisted, resolveTaskDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeCommentLines, type LineComment } from '@/lib/review/draft.ts';
import { toCommentItem } from '@/lib/review/report.ts';

const NOTE_WIDTH = 'max-w-[min(36rem,calc(100cqw-6rem))]';

const NOTE = `flex ${NOTE_WIDTH} flex-col gap-1.5 rounded-lg px-3 py-2 font-sans text-xs`;

function CommentNote({ comment, onRemove }: { comment: LineComment; onRemove: (() => void) | null }) {
  return (
    <ReviewNote
      persistId={
        task
          ? resolveTaskDisclosureId(task.id, 'code', 'comment', comment.id)
          : notPersisted('a comment shown without its task')
      }
      item={toCommentItem(comment)}
      compact
      className={NOTE_WIDTH}
      action={
        onRemove && (
          <button
            type='button'
            className='cursor-pointer text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
            onClick={onRemove}
          >
            Remove
          </button>
        )
      }
    />
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
  if (note.kind === 'finding') return <ReviewNote item={note.item} compact className={NOTE_WIDTH} />;
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
