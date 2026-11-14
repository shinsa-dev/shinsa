import { type FileContent, type Task, type TaskRefs, WORKING_REF } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import type {
  EditorHandle,
  EditorReveal,
  EditorSessionHolder,
} from '@/components/code/editor/code-editor.tsx';
import { MarkdownPreview } from '@/components/code/markdown-preview.tsx';
import { CodeNoteView } from '@/components/code/notes.tsx';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { useDelay } from '@/hooks/use-delay.ts';
import { useFileSaver } from '@/hooks/use-file-saver.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { isEditedPath, resolveEditState, type SaveStatus } from '@/lib/code/edits.ts';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import type { CodeLocation } from '@/lib/code/location.ts';
import {
  type CodeNote,
  type Composer,
  listFileNotes,
  listSpotMarks,
  resolveEditComposer,
} from '@/lib/code/notes.ts';
import {
  FOCUS_FLASH_MS,
  holdPaneContent,
  listKeptLines,
  type PaneContent,
  resolveFocusLines,
  resolvePaneContent,
  resolvePaneKey,
  resolveTextGuard,
} from '@/lib/code/pane.ts';
import { type FileSource, hasOneSide } from '@/lib/code/source.ts';
import { resolveRawUrl, useFileContent } from '@/lib/connection/code.ts';
import { useMediaUrl } from '@/lib/connection/socket.ts';
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
    return <p className='p-3 text-xs text-fg-2'>The editor did not load. Reload the page to try again.</p>;
  if (!module) return <Waiting path={props.path} />;
  return <module.default {...props} />;
}

function useFlash(key: string | null) {
  const [flashed, setFlashed] = React.useState<string | null>(key);
  React.useEffect(() => {
    if (key) setFlashed(key);
  }, [key]);
  useDelay(() => setFlashed(null), key ? FOCUS_FLASH_MS : null, [key]);
  return key !== null && flashed === key;
}

function useLinkFocus(path: string, location: CodeLocation) {
  const reveal: EditorReveal | null = location.line
    ? {
        key: `${path}:${location.line}:${location.end ?? ''}:${location.spot ?? ''}`,
        line: location.line,
        side: 'new',
      }
    : null;
  const flash = useFlash(reveal?.key ?? null);
  return { reveal, focus: resolveFocusLines(location.line, location.end, flash) };
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
  const src = useMediaUrl(resolveRawUrl(task.id, gitRef, path));
  return (
    <figure className='flex min-w-0 flex-1 flex-col items-center gap-2 p-4'>
      <figcaption className='text-2xs text-fg-2'>{label}</figcaption>
      <img
        src={src}
        alt={path}
        onLoad={() => setLoaded(true)}
        style={{ visibility: loaded ? 'visible' : 'hidden' }}
        className={cn(
          INSET,
          'max-h-[60vh] max-w-full bg-[repeating-conic-gradient(var(--bg-2)_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain'
        )}
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
    <HintButton
      label={label}
      size='icon-sm'
      icon={split ? 'IconLayoutTopBottom' : 'IconLayoutColumn'}
      onClick={onToggle}
      className='max-md:hidden'
    />
  );
}

function PreviewToggle({ preview, onToggle }: { preview: boolean; onToggle: () => void }) {
  return (
    <HintButton
      label={preview ? 'Show source' : 'Show preview'}
      size='icon-sm'
      icon={preview ? 'IconCode' : 'IconEyeOpen'}
      onClick={onToggle}
    />
  );
}

function PaneToolbar({
  source,
  split,
  showLayout,
  status,
  preview,
  toolbar,
  onSplit,
  onPreview,
  onShowInFiles,
}: {
  source: FileSource;
  split: boolean;
  showLayout: boolean;
  status: SaveStatus;
  preview: boolean | null;
  toolbar: React.ReactNode;
  onSplit: (() => void) | null;
  onPreview: () => void;
  onShowInFiles: (() => void) | null;
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
      <SaveStatusLabel status={status} />
      {showLayout && onSplit && <LayoutToggle split={split} onToggle={onSplit} />}
      {preview !== null && <PreviewToggle preview={preview} onToggle={onPreview} />}
      <CopyButton text={path} label='Copy path' size='icon-sm' />
      {onShowInFiles && (
        <HintButton label='Show in Files' size='icon-sm' icon='IconFolderOpen' onClick={onShowInFiles} />
      )}
    </Toolbar>
  );
}

const SAVE_STATUS_LABEL: Record<SaveStatus, string | null> = {
  clean: null,
  edited: 'Edited',
  saving: 'Saving…',
  saved: 'Saved',
};

function SaveStatusLabel({ status }: { status: SaveStatus }) {
  const label = SAVE_STATUS_LABEL[status];
  return (
    <span role='status' className='shrink-0 text-2xs text-fg-2 empty:hidden'>
      {label}
    </span>
  );
}

function PaneNotice({ text, readOnly }: { text: string; readOnly: boolean }) {
  return (
    <p className='flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-2xs text-fg-2'>
      <Icon name={readOnly ? 'IconLock' : 'IconCircleInfo'} size='sm' />
      <Truncate>{text}</Truncate>
    </p>
  );
}

function usePanePreview(input: {
  preview: boolean | null;
  content: PaneContent;
  headPath: string | null;
  guard: string | null;
  start: string | null;
  buffer: React.RefObject<EditorHandle | null>;
}) {
  const latest = React.useRef<string | null>(null);
  if (input.preview !== null && input.buffer.current) latest.current = input.buffer.current.readText();
  const readable = input.content.kind === 'text' && input.headPath !== null && input.guard === null;
  if (!readable || input.content.kind !== 'text')
    return { shown: null, text: null, editing: input.guard === null };
  return {
    shown: input.preview,
    text: input.preview ? (latest.current ?? input.start ?? input.content.content) : null,
    editing: !input.preview,
  };
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
  preview,
  onPreview,
  onOpenPath,
  onShowInFiles,
}: {
  task: Task;
  refs: TaskRefs;
  gitRef: string;
  source: FileSource;
  location: CodeLocation;
  targets: ReviewTarget[];
  split: boolean;
  onSplit: (() => void) | null;
  handle: React.RefObject<EditorHandle | null>;
  session?: EditorSessionHolder;
  toolbar: React.ReactNode;
  preview: boolean | null;
  onPreview: () => void;
  onOpenPath: (path: string, line: number | null) => void;
  onShowInFiles: (() => void) | null;
}) {
  const draft = useReviewDraft();
  const path = source.file.path;
  const edit = resolveEditState({ task, refs, gitRef, headPath: source.headPath });
  const live = edit.editable && refs.working && isEditedPath(task, source.headPath);
  const pinnedRead = useFileContent(task, gitRef, source.headPath);
  const liveRead = useFileContent(task, live ? WORKING_REF : null, live ? source.headPath : null);
  const head = live ? liveRead : pinnedRead;
  const base = useFileContent(task, refs.base, source.basePath ?? source.baselinePath);
  const [composer, setComposer] = React.useState<Composer | null>(null);
  const diffing = source.change !== null;
  const oneSide = hasOneSide(source);
  const shown = React.useRef<PaneContent | null>(null);
  const content = holdPaneContent(
    shown.current,
    resolvePaneContent({
      headPath: source.headPath,
      basePath: source.basePath,
      baselinePath: source.baselinePath,
      diffing,
      head,
      base,
    })
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
  const { reveal, focus } = useLinkFocus(path, location);
  const markdown = usePanePreview({
    preview,
    content,
    headPath: source.headPath,
    guard,
    start: saver.start,
    buffer,
  });

  function renderNote(note: CodeNote) {
    return (
      <CodeNoteView
        note={note}
        task={task}
        reviewing={draft.reviewing}
        onEdit={draft.enabled ? (comment) => setComposer(resolveEditComposer(comment)) : null}
        onRemove={draft.enabled ? draft.removeComment : null}
        onCancel={() => setComposer(null)}
        onSave={(text) => {
          if (note.kind !== 'composer') return;
          if (note.editing) draft.updateComment(note.editing.id, text);
          else
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
        status={saver.state.status}
        preview={markdown.shown}
        toolbar={toolbar}
        onSplit={onSplit}
        onPreview={onPreview}
        onShowInFiles={onShowInFiles}
      />
      {content.kind === 'text' && markdown.editing && notice && (
        <PaneNotice text={notice} readOnly={!editable} />
      )}
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
      {content.kind === 'failed' && <p className='p-3 text-xs text-fg-2'>{content.message}</p>}
      {content.kind === 'absent' && (
        <NoText task={task} refs={refs} gitRef={gitRef} source={source} head={content.head} />
      )}
      {markdown.text !== null && (
        <MarkdownPreview task={task} gitRef={gitRef} path={path} text={markdown.text} onOpen={onOpenPath} />
      )}
      {content.kind === 'text' && markdown.editing && (
        <CodeEditor
          path={path}
          docKey={resolvePaneKey(gitRef, source.file)}
          {...(session ? { session } : {})}
          content={saver.start ?? content.content}
          original={content.original}
          baseline={content.baseline}
          split={diffing && split && !oneSide}
          editable={editable}
          notes={notes}
          spots={spots}
          keep={listKeptLines(notes, spots, location.line, location.end)}
          focus={focus}
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
