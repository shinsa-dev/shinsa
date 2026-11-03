import type { Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { INSET } from '@/components/layout/surface/card.ts';
import { NOTE_ACTION, RemoveNoteButton, ReviewNote } from '@/components/review/note.tsx';
import { FindingVerdictChoice } from '@/components/review/verdict-choice.tsx';
import type { CodeNote } from '@/lib/code/notes.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import { notPersisted, resolveTaskDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeCommentLines, describeCommentPlaceholder, type LineComment } from '@/lib/review/draft.ts';
import { toCommentItem } from '@/lib/review/report.ts';

const NOTE_WIDTH = 'max-w-[min(36rem,calc(100cqw-6rem))]';

const NOTE = `${INSET} flex ${NOTE_WIDTH} flex-col gap-1.5 px-3 py-2 font-sans text-xs`;

function CommentNote({
  task,
  comment,
  onEdit,
  onRemove,
}: {
  task: Task | null;
  comment: LineComment;
  onEdit: (() => void) | null;
  onRemove: (() => void) | null;
}) {
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
        (onEdit || onRemove) && (
          <span className='flex items-center gap-2.5'>
            {onEdit && (
              <button type='button' className={NOTE_ACTION} onClick={onEdit}>
                Edit
              </button>
            )}
            {onRemove && <RemoveNoteButton onRemove={onRemove} />}
          </span>
        )
      }
    />
  );
}

function CommentComposer({
  label,
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string | null;
  placeholder: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = React.useState(initial ?? '');
  return (
    <div className={cn(NOTE, 'bg-background')}>
      <span className='text-2xs text-fg-2'>{label}</span>
      <textarea
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by a click on the line
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
        placeholder={placeholder}
        className='corner-superellipse/1.125 field-sizing-content min-h-14 w-full resize-none rounded-control bg-bg-2 px-2.5 py-1.5 text-xs text-fg-4 outline-none placeholder:text-fg-2'
      />
      <div className='flex items-center gap-1.5'>
        <Button size='xs' disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          {initial === null ? 'Add comment' : 'Save comment'}
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
  task = null,
  reviewing = true,
  onEdit = null,
  onRemove,
  onSave,
  onCancel,
}: {
  note: CodeNote;
  task?: Task | null;
  reviewing?: boolean;
  onEdit?: ((comment: LineComment) => void) | null;
  onRemove: ((id: string) => void) | null;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  if (note.kind === 'finding') {
    return (
      <ReviewNote
        persistId={notPersisted('a finding card never folds')}
        item={note.item}
        compact
        className={NOTE_WIDTH}
        action={task && <FindingVerdictChoice task={task} finding={note.item.finding} />}
      />
    );
  }
  if (note.kind === 'comment') {
    return (
      <CommentNote
        task={task}
        comment={note.comment}
        onEdit={onEdit ? () => onEdit(note.comment) : null}
        onRemove={onRemove ? () => onRemove(note.comment.id) : null}
      />
    );
  }
  return (
    <CommentComposer
      label={`Comment · ${describeCommentLines({ side: note.side, line: note.start, endLine: note.endLine })}`}
      initial={note.editing?.text ?? null}
      placeholder={describeCommentPlaceholder(reviewing)}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}
