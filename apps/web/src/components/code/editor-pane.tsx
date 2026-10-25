import { type FileContent, type Task, type TaskRefs, WORKING_REF } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import type {
  EditorHandle,
  EditorReveal,
  EditorSessionHolder,
} from '@/components/code/editor/code-editor.tsx';
import { CodeNoteView } from '@/components/code/notes.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { useFileSaver } from '@/hooks/use-file-saver.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { isEditedPath, resolveEditState } from '@/lib/code/edits.ts';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import type { CodeLocation } from '@/lib/code/location.ts';
import { type CodeNote, type Composer, listFileNotes, listSpotMarks } from '@/lib/code/notes.ts';
import {
  holdPaneContent,
  listKeptLines,
  type PaneContent,
  resolvePaneContent,
  resolvePaneKey,
  resolveTextGuard,
} from '@/lib/code/pane.ts';
import { type FileSource, hasOneSide } from '@/lib/code/source.ts';
import { resolveRawUrl, useFileContent } from '@/lib/connection/code.ts';
import { formatBytes } from '@/lib/format/count.ts';
import type { ReviewTarget } from '@/lib/review/targets.ts';

type EditorModule = typeof import('@/components/code/editor/code-editor.tsx');

let loadedEditor: EditorModule | null = null;

export async function requestCodeEditor() {
  loadedEditor = await import('@/components/code/editor/code-editor.tsx');
  return loadedEditor;
}

function CodeEditor(props: React.ComponentProps<EditorModule['default']>) {
  const [module, setModule] = React.useState<EditorModule | 'failed' | null>(loadedEditor);
  React.useEffect(() => {
    if (module) return;
    requestCodeEditor().then(setModule, () => setModule('failed'));
  }, [module]);
  if (module === 'failed')
    return <p className='p-3 text-fg-2 text-xs'>The editor did not load. Reload the page to try again.</p>;
  if (!module) return <Waiting path={props.path} />;
  return <module.default {...props} />;
}

function Waiting({ path }: { path: string }) {
  return <CodeLoading label={`Opening ${path}…`} />;
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
  const [loaded, setLoaded] = React.useState(false);
  return (
    <figure className='flex min-w-0 flex-1 flex-col items-center gap-2 p-4'>
      <figcaption className='text-2xs text-fg-2'>{label}</figcaption>
      <img
        src={resolveRawUrl(task.id, gitRef, path)}
        alt={path}
        onLoad={() => setLoaded(true)}
        style={{ visibility: loaded ? 'visible' : 'hidden' }}
        className='max-h-[60vh] max-w-full rounded-lg border border-border bg-[length:16px_16px] bg-[repeating-conic-gradient(var(--bg-2)_0_25%,transparent_0_50%)] object-contain'
      />
    </figure>
  );
}

function describeAbsence(content: FileContent, path: string) {
  if (content.tooLarge) return `${path} is ${formatBytes(content.size)}, too large to show as text.`;
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
  source: FileSource;
  head: FileContent | null;
}) {
  const images = [
    source.basePath && source.change?.binary && refs.base
      ? { ref: refs.base, path: source.basePath, label: 'Before' }
      : null,
    head?.image && source.headPath
      ? { ref: gitRef, path: source.headPath, label: source.change ? 'After' : head.path }
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
      description={head ? describeAbsence(head, source.file.path) : `${source.file.path} was deleted.`}
    />
  );
}

function LayoutToggle({ split, onToggle }: { split: boolean; onToggle: () => void }) {
  const label = split ? 'Show unified' : 'Show side by side';
  return (
    <Hint label={label}>
      <Button
        variant='secondary'
        size='icon-sm'
        icon={split ? 'IconLayoutTopBottom' : 'IconLayoutColumn'}
        aria-label={label}
        onClick={onToggle}
        className='max-md:hidden'
      />
    </Hint>
  );
}

function PaneToolbar({
  source,
  split,
  showLayout,
  saving,
  toolbar,
  onSplit,
}: {
  source: FileSource;
  split: boolean;
  showLayout: boolean;
  saving: boolean;
  toolbar: React.ReactNode;
  onSplit: () => void;
}) {
  const path = source.file.path;
  return (
    <Toolbar className='gap-1.5'>
      {toolbar}
      <Icon name={resolveFileIcon(path)} size='sm' />
      <FilePath path={path} className='min-w-0' />
      {source.change?.previousPath && (
        <Truncate className='text-2xs text-fg-2 max-lg:hidden'>
          renamed from {source.change.previousPath}
        </Truncate>
      )}
      {source.change && !source.change.binary && (
        <DiffStats added={source.change.additions} removed={source.change.deletions} />
      )}
      <span className='flex-1' />
      {saving && <span className='shrink-0 text-2xs text-fg-2'>Saving…</span>}
      {showLayout && <LayoutToggle split={split} onToggle={onSplit} />}
    </Toolbar>
  );
}

function PaneNotice({ text, readOnly }: { text: string; readOnly: boolean }) {
  return (
    <p className='flex shrink-0 items-center gap-1.5 border-border border-b px-3 py-1.5 text-2xs text-fg-2'>
      <Icon name={readOnly ? 'IconLock' : 'IconCircleInfo'} size='sm' />
      <Truncate>{text}</Truncate>
    </p>
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
  session,
  toolbar,
}: {
  task: Task;
  refs: TaskRefs;
  gitRef: string;
  source: FileSource;
  location: CodeLocation;
  targets: ReviewTarget[];
  split: boolean;
  onSplit: () => void;
  handle: React.RefObject<EditorHandle | null>;
  session?: EditorSessionHolder;
  toolbar: React.ReactNode;
}) {
  const draft = useReviewDraft();
  const path = source.file.path;
  const edit = resolveEditState({ task, refs, gitRef, headPath: source.headPath });
  const live = edit.editable && refs.working && isEditedPath(task, source.headPath);
  const pinnedRead = useFileContent(task, gitRef, source.headPath);
  const liveRead = useFileContent(task, live ? WORKING_REF : null, live ? source.headPath : null);
  const head = live ? liveRead : pinnedRead;
  const base = useFileContent(task, refs.base, source.basePath);
  const [composer, setComposer] = React.useState<Composer | null>(null);
  const diffing = source.change !== null;
  const oneSide = hasOneSide(source);
  const shown = React.useRef<PaneContent | null>(null);
  const content = holdPaneContent(
    shown.current,
    resolvePaneContent({ headPath: source.headPath, basePath: source.basePath, diffing, head, base })
  );
  shown.current = content;
  const [opened, setOpened] = React.useState(false);
  const guard =
    content.kind === 'text' && !opened ? resolveTextGuard(path, [content.content, content.original]) : null;
  const buffer = React.useRef<EditorHandle | null>(null);
  const handles = React.useCallback(
    (value: EditorHandle | null) => {
      buffer.current = value;
      handle.current = value;
    },
    [handle]
  );
  const saver = useFileSaver({
    taskId: task.id,
    path: edit.editable ? source.headPath : null,
    text: content.kind === 'text' ? content.content : null,
    buffer,
  });
  const editable = edit.editable && saver.state.refusal === null;
  const notice = saver.state.refusal ?? saver.state.notice ?? edit.reason;
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

  return (
    <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <PaneToolbar
        source={source}
        split={split}
        showLayout={diffing && !oneSide && content.kind === 'text'}
        saving={saver.state.saving}
        toolbar={toolbar}
        onSplit={onSplit}
      />
      {content.kind === 'text' && notice && !guard && <PaneNotice text={notice} readOnly={!editable} />}
      {guard && (
        <EmptyState
          size='sm'
          icon='IconFileText'
          title='Opening this file may slow the page'
          description={guard}
        >
          <Button variant='secondary' size='sm' onClick={() => setOpened(true)}>
            Open anyway
          </Button>
        </EmptyState>
      )}
      {content.kind === 'waiting' && <Waiting path={path} />}
      {content.kind === 'failed' && <p className='p-3 text-fg-2 text-xs'>{content.message}</p>}
      {content.kind === 'absent' && (
        <NoText task={task} refs={refs} gitRef={gitRef} source={source} head={content.head} />
      )}
      {content.kind === 'text' && !guard && (
        <CodeEditor
          path={path}
          docKey={resolvePaneKey(gitRef, source.file)}
          {...(session ? { session } : {})}
          content={saver.start ?? content.content}
          original={content.original}
          split={diffing && split && !oneSide}
          editable={editable}
          notes={notes}
          spots={spots}
          keep={listKeptLines(notes, spots, location.line, location.end)}
          reveal={reveal}
          onComment={draft.enabled ? (side, line, endLine) => setComposer({ side, line, endLine }) : null}
          onEdit={saver.edit}
          onSave={saver.save}
          renderNote={renderNote}
          handle={handles}
        />
      )}
    </section>
  );
}
