import { diff } from '@codemirror/merge';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CommentSide } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { FindBar } from '@/components/code/editor/find-bar.tsx';
import { NO_ANNOTATIONS, setAnnotations } from '@/lib/code/editor/annotations.ts';
import { selectEditorCommand } from '@/lib/code/editor/commands.ts';
import { requestLanguage } from '@/lib/code/editor/language.ts';
import { EditorSession, fromDisk } from '@/lib/code/editor/session.ts';
import { gotoLine, resolveEditable } from '@/lib/code/editor/setup.ts';
import type { SpotHintRegistry } from '@/lib/code/editor/spot-hints.ts';
import { revealLine } from '@/lib/code/editor/unified.ts';
import { CODE_MARKS, measureCode } from '@/lib/code/marks.ts';
import type { CodeNote, CodeSpotMark } from '@/lib/code/notes.ts';
import type { PairSource } from '@/lib/code/pane.ts';

export interface EditorHandle {
  openFind: () => void;
  openGotoLine: () => void;
  run: (id: string) => void;
  readText: () => string;
  replaceText: (text: string) => void;
}

export interface EditorReveal {
  key: string;
  line: number;
  side: CommentSide;
}

export interface EditorSessionHolder {
  current: { destroy: () => void; prefetchPair: (source: PairSource) => void } | null;
}

export interface CodeEditorProps {
  path: string;
  docKey?: string;
  content: string;
  original: string | null;
  split: boolean;
  editable: boolean;
  notes: CodeNote[];
  spots: CodeSpotMark[];
  keep: number[];
  reveal: EditorReveal | null;
  onComment: ((side: CommentSide, line: number, endLine: number | null) => void) | null;
  onEdit: () => void;
  onSave: () => void;
  renderNote: (note: CodeNote) => React.ReactNode;
  handle: React.Ref<EditorHandle>;
  session?: EditorSessionHolder;
}

function replaceDoc(view: EditorView, text: string) {
  const current = view.state.doc.toString();
  if (current === text) return;
  const changes = diff(current, text).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: text.slice(change.fromB, change.toB),
  }));
  view.dispatch({ changes, annotations: [fromDisk.of(true), Transaction.addToHistory.of(false)] });
}

function splitAnnotations(
  notes: CodeNote[],
  spots: CodeSpotMark[],
  keep: number[],
  focus: FocusLines | null,
  split: boolean
) {
  const anchors = (side: CommentSide) =>
    notes.filter((note) => note.side === side).map((note) => ({ key: note.key, line: note.line }));
  const b = { notes: anchors('new'), oldNotes: split ? [] : anchors('old'), spots, keep, focus };
  const a = { ...NO_ANNOTATIONS, notes: anchors('old') };
  return { a, b };
}

function revealIn(view: EditorView, line: number) {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
  view.dispatch({
    effects: [revealLine.of(target.number), EditorView.scrollIntoView(target.from, { y: 'center' })],
    selection: { anchor: target.from },
  });
}

function SpotHints({ registry }: { registry: SpotHintRegistry }) {
  const hints = React.useSyncExternalStore(registry.subscribe, registry.read);
  return hints.map((hint) => (
    <React.Fragment key={hint.id}>
      {createPortal(
        <Hint side='right' followCursor label={<span className='whitespace-pre-line'>{hint.label}</span>}>
          <span className='block size-full' />
        </Hint>,
        hint.element
      )}
    </React.Fragment>
  ));
}

function useSession(holder: EditorSessionHolder | undefined) {
  const own = React.useRef<EditorSession | null>(null);
  const target = (holder ?? own) as { current: EditorSession | null };
  target.current ??= new EditorSession({ language: requestLanguage });
  React.useEffect(() => {
    if (holder) return;
    return () => {
      own.current?.destroy();
      own.current = null;
    };
  }, [holder]);
  return target.current;
}

export default function CodeEditor(props: CodeEditorProps) {
  const { path, original, split, editable, notes, spots, keep, focus, reveal, handle } = props;
  const diffing = original !== null;
  const docKey = props.docKey ?? `${path}\0${diffing ? 'diff' : 'file'}`;
  const session = useSession(props.session);
  session.latest = props;
  const parent = React.useRef<HTMLDivElement>(null);
  const chevron = React.useRef<HTMLSpanElement>(null);
  const latest = React.useRef(props);
  latest.current = props;
  const slots = React.useSyncExternalStore(session.registry.subscribe, session.registry.read);
  const find = React.useSyncExternalStore(session.findHost.subscribe, session.findHost.read);
  const annotationsKey = JSON.stringify(splitAnnotations(notes, spots, keep, focus, split && diffing));
  const noteKeys = notes.map((note) => note.key).join('\0');
  const latestAnnotations = React.useRef(annotationsKey);
  latestAnnotations.current = annotationsKey;

  React.useLayoutEffect(() => {
    const host = parent.current;
    session.chevronMarkup = chevron.current?.innerHTML ?? '';
    if (!host) return;
    session.show(host, {
      key: docKey,
      path,
      content: latest.current.content,
      original,
      split: split && original !== null,
      annotations: JSON.parse(latestAnnotations.current) as ReturnType<typeof splitAnnotations>,
    });
    measureCode(CODE_MARKS.shown, path);
  }, [session, docKey, path, original, split]);

  React.useLayoutEffect(() => {
    const host = parent.current;
    return () => {
      if (host) session.hide(host);
    };
  }, [session]);

  React.useLayoutEffect(() => {
    const views = session.views;
    if (!views || session.current !== docKey) return;
    const value = JSON.parse(annotationsKey) as ReturnType<typeof splitAnnotations>;
    views.b.dispatch({ effects: setAnnotations.of(value.b) });
    views.a?.dispatch({ effects: setAnnotations.of(value.a) });
  }, [session, annotationsKey, docKey, original, split]);

  React.useLayoutEffect(() => {
    if (session.current !== docKey) return;
    session.views?.b.dispatch({ effects: session.editable.reconfigure(resolveEditable(editable)) });
  }, [session, editable, docKey, original, split]);

  React.useLayoutEffect(() => {
    const views = session.views;
    if (!views || !reveal || session.current !== docKey) return;
    revealIn(reveal.side === 'old' && views.a ? views.a : views.b, reveal.line);
  }, [session, reveal?.key, docKey, original, split]);

  React.useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined' || slots.size === 0) return;
    const observer = new ResizeObserver(() => {
      session.views?.b.requestMeasure();
      session.views?.a?.requestMeasure();
    });
    for (const slot of slots.values()) observer.observe(slot);
    return () => observer.disconnect();
  }, [session, slots]);

  React.useImperativeHandle(
    handle,
    () => ({
      openFind: () => {
        const view = session.selectView(docKey);
        if (view) session.findHost.open(view, false);
      },
      openGotoLine: () => {
        const view = session.selectView(docKey);
        if (view) gotoLine(view);
      },
      run: (id) => {
        const views = session.views;
        const command = selectEditorCommand(id);
        if (!views || !command || session.current !== docKey) return;
        const view = views.a?.hasFocus ? views.a : views.b;
        view.focus();
        command.run(view, { save: () => session.latest.onSave(), openFind: session.findHost.open });
      },
      readText: () => session.readText(docKey) ?? latest.current.content,
      replaceText: (next) => {
        const view = session.selectView(docKey);
        if (view) replaceDoc(view, next);
      },
    }),
    [session, docKey]
  );

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <span ref={chevron} hidden>
        <Icon name='IconChevronRightSmall' />
      </span>
      <div ref={parent} className='@container flex min-h-0 flex-1 flex-col' />
      {find.panel &&
        createPortal(
          <FindBar
            view={find.panel.view}
            replace={find.replace}
            canReplace={editable}
            onReplace={session.findHost.showReplace}
          />,
          find.panel.dom
        )}
      <SpotHints registry={session.spotHints} />
      {notes.map((note) => (
        <React.Fragment key={note.key}>
          {createPortal(props.renderNote(note), session.registry.upsert(note.key))}
        </React.Fragment>
      ))}
    </div>
  );
}

export { requestLanguage };
