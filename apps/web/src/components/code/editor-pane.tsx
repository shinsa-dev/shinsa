import type { FileContent, Task, TaskRefs } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import type { IconName } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { EditorHandle, EditorReveal } from '@/components/code/editor/code-editor.tsx';
import { CodeNoteView } from '@/components/code/notes.tsx';
import { Choice } from '@/components/controls/choice.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import type { CodeLocation } from '@/lib/code/location.ts';
import { type CodeNote, type Composer, listFileNotes, listSpotMarks } from '@/lib/code/notes.ts';
import { listKeptLines, resolvePaneContent } from '@/lib/code/pane.ts';
import { resolveSuggestion } from '@/lib/code/suggestion.ts';
import type { TabSource } from '@/lib/code/tabs.ts';
import { resolveRawUrl, useFileContent } from '@/lib/connection/code.ts';
import { openWorktree } from '@/lib/connection/worktree.ts';
import { formatBytes } from '@/lib/format/count.ts';
import type { ReviewTarget } from '@/lib/review/targets.ts';

const CodeEditor = React.lazy(() => import('@/components/code/editor/code-editor.tsx'));

const LAYOUTS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Side by side' },
] as const;

function Waiting({ path }: { path: string }) {
  return (
    <div className='flex items-center gap-2 p-3 text-fg-2 text-xs'>
      <Spinner size='sm' /> Opening {path}
    </div>
  );
}

function ImageView({
  task,
  gitRef,
  path,
  label,
}: {
  task: Task;
  gitRef: string;
  path: string;
  label: string;
}) {
  return (
    <figure className='flex min-w-0 flex-1 flex-col items-center gap-2 p-4'>
      <figcaption className='text-2xs text-fg-2'>{label}</figcaption>
      <img
        src={resolveRawUrl(task.id, gitRef, path)}
        alt={path}
        className='max-h-[60vh] max-w-full rounded-lg border border-border bg-[length:16px_16px] bg-[repeating-conic-gradient(var(--bg-2)_0_25%,transparent_0_50%)] object-contain'
      />
    </figure>
  );
}

function describeAbsence(content: FileContent, path: string) {
  if (content.tooLarge) return `${path} is ${formatBytes(content.size)}, too large to show here.`;
  if (content.binary) return `${path} is a binary file, so there is no text to show.`;
  return `There is no ${path} at this point in the history.`;
}

function NoText({
  task,
  refs,
  gitRef,
  source,
  head,
}: {
  task: Task;
  refs: TaskRefs;
  gitRef: string;
  source: TabSource;
  head: FileContent | null;
}) {
  const images = [
    source.basePath && source.file?.binary && refs.base
      ? { ref: refs.base, path: source.basePath, label: 'Before' }
      : null,
    head?.image && source.headPath
      ? { ref: gitRef, path: source.headPath, label: source.file ? 'After' : head.path }
      : null,
  ].filter((image) => image !== null);
  if (images.length > 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-wrap justify-center overflow-auto'>
        {images.map((image) => (
          <ImageView key={image.label} task={task} gitRef={image.ref} path={image.path} label={image.label} />
        ))}
      </div>
    );
  }
  return (
    <EmptyState
      size='sm'
      icon='IconFileText'
      title='Nothing to show as text'
      description={head ? describeAbsence(head, source.tab.path) : `${source.tab.path} was deleted.`}
    />
  );
}

function ToolbarAction({ label, icon, onClick }: { label: string; icon: IconName; onClick: () => void }) {
  return (
    <>
      <Button variant='secondary' size='sm' icon={icon} onClick={onClick} className='max-xl:hidden'>
        {label}
      </Button>
      <Hint label={label}>
        <Button
          variant='secondary'
          size='icon-sm'
          icon={icon}
          aria-label={label}
          onClick={onClick}
          className='xl:hidden'
        />
      </Hint>
    </>
  );
}

function PaneToolbar({
  task,
  refs,
  source,
  line,
  split,
  showLayout,
  canSuggest,
  editing,
  changed,
  toolbar,
  onSplit,
  onEdit,
  onDiscard,
  onSuggest,
}: {
  task: Task;
  refs: TaskRefs;
  source: TabSource;
  line: number | null;
  split: boolean;
  showLayout: boolean;
  canSuggest: boolean;
  editing: boolean;
  changed: boolean;
  toolbar: React.ReactNode;
  onSplit: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  onSuggest: () => void;
}) {
  const path = source.tab.path;
  return (
    <Toolbar className='gap-1.5'>
      {toolbar}
      <FilePath path={path} className='min-w-0' />
      {source.file?.previousPath && (
        <Truncate className='text-2xs text-fg-2 max-lg:hidden'>
          renamed from {source.file.previousPath}
        </Truncate>
      )}
      {source.file && !source.file.binary && (
        <DiffStats added={source.file.additions} removed={source.file.deletions} />
      )}
      <span className='flex-1' />
      {showLayout && (
        <>
          <Choice
            label='Diff layout'
            items={[...LAYOUTS]}
            value={split ? 'split' : 'unified'}
            onValueChange={(value) => {
              if ((value === 'split') !== split) onSplit();
            }}
            className='max-xl:hidden'
          />
          <Hint label={split ? 'Show unified' : 'Show side by side'}>
            <Button
              variant='secondary'
              size='icon-sm'
              icon='IconColumnWideHalf'
              aria-label='Show side by side'
              aria-pressed={split}
              onClick={onSplit}
              className={cn('max-md:hidden xl:hidden', split && 'bg-bg-a3 text-fg-4')}
            />
          </Hint>
        </>
      )}
      {canSuggest && !editing && (
        <ToolbarAction label='Suggest a change' icon='IconPencil' onClick={onEdit} />
      )}
      {editing && (
        <>
          <Button variant='secondary' size='sm' onClick={onDiscard}>
            Discard
          </Button>
          <Button size='sm' disabled={!changed} onClick={onSuggest}>
            Add the suggestion
          </Button>
        </>
      )}
      {task.worktreePath && refs.working && !editing && (
        <ToolbarAction
          label='Open in editor'
          icon='IconCode'
          onClick={() => void openWorktree(task.id, 'editor', source.headPath ?? path, line ?? undefined)}
        />
      )}
    </Toolbar>
  );
}

export function EditorPane({
  task,
  refs,
  gitRef,
  source,
  location,
  targets,
  split,
  onSplit,
  handle,
  toolbar,
}: {
  task: Task;
  refs: TaskRefs;
  gitRef: string;
  source: TabSource;
  location: CodeLocation;
  targets: ReviewTarget[];
  split: boolean;
  onSplit: () => void;
  handle: React.RefObject<EditorHandle | null>;
  toolbar: React.ReactNode;
}) {
  const draft = useReviewDraft();
  const path = source.tab.path;
  const head = useFileContent(task, gitRef, source.headPath);
  const base = useFileContent(task, refs.base, source.basePath);
  const [composer, setComposer] = React.useState<Composer | null>(null);
  const [editing, setEditing] = React.useState<{ changed: boolean } | null>(null);
  const diffing = source.file !== null;
  const content = resolvePaneContent({
    headPath: source.headPath,
    basePath: source.basePath,
    diffing,
    head,
    base,
  });
  const headText = content.kind === 'text' ? content.content : null;
  const pinned = gitRef === refs.head;
  const notes = listFileNotes({
    path,
    ref: gitRef,
    findings: pinned ? task.findings : [],
    comments: draft.comments,
    composer,
  });
  const spots = pinned ? listSpotMarks(targets, path, location.spot) : [];
  const reveal: EditorReveal | null = location.line
    ? { key: `${path}:${location.line}:${location.spot ?? ''}`, line: location.line, side: 'new' }
    : null;

  function renderNote(note: CodeNote) {
    return (
      <CodeNoteView
        note={note}
        original={headText}
        onRemove={draft.enabled ? draft.removeComment : null}
        onCancel={() => setComposer(null)}
        onSave={(text) => {
          if (note.kind !== 'composer') return;
          draft.addComment({
            path,
            side: note.side,
            line: note.start,
            endLine: note.endLine,
            ref: gitRef,
            text,
          });
          setComposer(null);
        }}
      />
    );
  }

  function suggest() {
    const original = headText ?? '';
    const suggestion = resolveSuggestion(original, handle.current?.readText() ?? original);
    if (suggestion) {
      draft.addComment({
        path,
        line: suggestion.line,
        endLine: suggestion.endLine > suggestion.line ? suggestion.endLine : null,
        ref: gitRef,
        text: '',
        suggestion,
      });
    }
    handle.current?.resetText();
    setEditing(null);
  }

  return (
    <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <PaneToolbar
        task={task}
        refs={refs}
        source={source}
        line={location.line}
        split={split}
        showLayout={diffing && content.kind === 'text'}
        canSuggest={draft.enabled && pinned && content.kind === 'text' && source.headPath !== null}
        editing={editing !== null}
        changed={editing?.changed ?? false}
        toolbar={toolbar}
        onSplit={onSplit}
        onEdit={() => setEditing({ changed: false })}
        onDiscard={() => {
          handle.current?.resetText();
          setEditing(null);
        }}
        onSuggest={suggest}
      />
      {content.kind === 'waiting' && <Waiting path={path} />}
      {content.kind === 'failed' && <p className='p-3 text-fg-2 text-xs'>{content.message}</p>}
      {content.kind === 'absent' && (
        <NoText task={task} refs={refs} gitRef={gitRef} source={source} head={content.head} />
      )}
      {content.kind === 'text' && (
        <React.Suspense fallback={<Waiting path={path} />}>
          <CodeEditor
            path={path}
            content={content.content}
            original={content.original}
            split={diffing && split && editing === null}
            editable={editing !== null}
            notes={notes}
            spots={spots}
            keep={listKeptLines(notes, spots, location.line, location.end)}
            reveal={reveal}
            onComment={
              draft.enabled && editing === null
                ? (side, line, endLine) => setComposer({ side, line, endLine })
                : null
            }
            onEdit={(changed) => setEditing((current) => (current ? { changed } : current))}
            renderNote={renderNote}
            handle={handle}
          />
        </React.Suspense>
      )}
    </section>
  );
}
