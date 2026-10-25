import type { LanguageSupport } from '@codemirror/language';
import { diff, MergeView } from '@codemirror/merge';
import { Annotation, Compartment, EditorState, type Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CommentSide } from '@shinsa/core';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import { FindBar } from '@/components/code/editor/find-bar.tsx';
import { COLLAPSE } from '@/lib/code/collapse.ts';
import {
  annotationsField,
  type EditorAnnotations,
  NO_ANNOTATIONS,
  resolveSelectedLines,
  setAnnotations,
} from '@/lib/code/editor/annotations.ts';
import { followHorizontalScroll, skipCollapsedLines } from '@/lib/code/editor/collapsed.ts';
import { selectEditorCommand } from '@/lib/code/editor/commands.ts';
import { FindHost } from '@/lib/code/editor/find.ts';
import { requestLanguage } from '@/lib/code/editor/language.ts';
import { createEditorExtensions, gotoLine, resolveEditable } from '@/lib/code/editor/setup.ts';
import { SlotRegistry } from '@/lib/code/editor/slots.ts';
import { codeHighlight } from '@/lib/code/editor/theme.ts';
import { DIFF_CONFIG, MAX_PARSED_ORIGINAL, revealLine, unifiedDiff } from '@/lib/code/editor/unified.ts';
import type { CodeNote, CodeSpotMark } from '@/lib/code/notes.ts';
import { resolveCommentRange } from '@/lib/code/notes.ts';

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

export interface CodeEditorProps {
  path: string;
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
}

interface Views {
  a: EditorView | null;
  b: EditorView;
  destroy: () => void;
}

const SPLIT_THEME = EditorView.theme({
  '&': { height: 'auto' },
  '.cm-scroller': { overflowX: 'auto', overflowY: 'hidden' },
});

const fromDisk = Annotation.define<boolean>();

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

function splitAnnotations(notes: CodeNote[], spots: CodeSpotMark[], keep: number[], split: boolean) {
  const anchors = (side: CommentSide) =>
    notes.filter((note) => note.side === side).map((note) => ({ key: note.key, line: note.line }));
  const b: EditorAnnotations = { notes: anchors('new'), oldNotes: split ? [] : anchors('old'), spots, keep };
  const a: EditorAnnotations = { ...NO_ANNOTATIONS, notes: anchors('old') };
  return { a, b };
}

function useLanguage(path: string) {
  const [language, setLanguage] = React.useState<{ path: string; support: LanguageSupport | null } | null>(
    null
  );
  React.useEffect(() => {
    let alive = true;
    void requestLanguage(path).then((support) => {
      if (alive) setLanguage({ path, support });
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return language?.path === path ? language : null;
}

function revealIn(view: EditorView, line: number) {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
  view.dispatch({
    effects: [revealLine.of(target.number), EditorView.scrollIntoView(target.from, { y: 'center' })],
    selection: { anchor: target.from },
  });
}

export default function CodeEditor(props: CodeEditorProps) {
  const { path, content, original, split, editable, notes, spots, keep, reveal, handle } = props;
  const language = useLanguage(path);
  const parent = React.useRef<HTMLDivElement>(null);
  const views = React.useRef<Views | null>(null);
  const registry = React.useMemo(() => new SlotRegistry(), []);
  const slots = React.useSyncExternalStore(registry.subscribe, registry.read);
  const findHost = React.useMemo(() => new FindHost(), []);
  const find = React.useSyncExternalStore(findHost.subscribe, findHost.read);
  const editableSlot = React.useMemo(() => new Compartment(), []);
  const latest = React.useRef(props);
  latest.current = props;
  const text = React.useRef(content);
  const annotations = splitAnnotations(notes, spots, keep, split);
  const annotationsKey = JSON.stringify(annotations);
  const latestAnnotations = React.useRef(annotations);
  latestAnnotations.current = annotations;
  const ready = language !== null;
  const support = language?.support ?? null;
  const diffing = original !== null;

  const [built, setBuilt] = React.useState(0);
  const languageSlot = React.useMemo(() => new Compartment(), []);

  React.useLayoutEffect(() => {
    const host = parent.current;
    if (!host || !ready) return;
    host.style.visibility = 'hidden';
    const comment = (side: CommentSide) => (line: number, view: EditorView) => {
      const onComment = latest.current.onComment;
      if (!onComment) return false;
      const range = resolveCommentRange(line, resolveSelectedLines(view));
      onComment(side, range.line, range.endLine);
      return true;
    };
    const onChange = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      text.current = update.state.doc.toString();
      if (update.transactions.some((transaction) => !transaction.annotation(fromDisk)))
        latest.current.onEdit();
    });
    const base = (side: CommentSide, extra: Extension[]) =>
      createEditorExtensions({
        language: null,
        editable: side === 'new' ? editableSlot : new Compartment(),
        onLine: comment(side),
        findPanel: findHost.createPanel,
        actions: () => ({ save: () => latest.current.onSave(), openFind: findHost.open }),
      }).concat(languageSlot.of([]), skipCollapsedLines, followHorizontalScroll, extra);
    const build = () => {
      const initial = latestAnnotations.current;
      if (diffing && split) {
        const merge = new MergeView({
          a: { doc: original, extensions: base('old', [SPLIT_THEME, annotationsField(registry, initial.a)]) },
          b: {
            doc: text.current,
            extensions: base('new', [SPLIT_THEME, annotationsField(registry, initial.b), onChange]),
          },
          parent: host,
          collapseUnchanged: { margin: COLLAPSE.margin, minSize: COLLAPSE.minSize },
          diffConfig: DIFF_CONFIG,
          gutter: true,
        });
        merge.dom.style.height = '100%';
        merge.dom.style.overflow = 'auto';
        views.current = { a: merge.a, b: merge.b, destroy: () => merge.destroy() };
      } else {
        const extensions = [...base('new', [annotationsField(registry, initial.b), onChange])];
        if (diffing) {
          extensions.push(
            unifiedDiff({
              original,
              tree:
                support && original.length <= MAX_PARSED_ORIGINAL
                  ? support.language.parser.parse(original)
                  : null,
              highlighter: codeHighlight,
              registry,
              collapse: true,
              annotations: initial.b,
              onOldLine: (line) => latest.current.onComment?.('old', line, null),
            })
          );
        }
        const view = new EditorView({
          state: EditorState.create({ doc: text.current, extensions }),
          parent: host,
        });
        views.current = { a: null, b: view, destroy: () => view.destroy() };
      }
      setBuilt((count) => count + 1);
    };
    const colour = () => {
      const current = views.current;
      if (!current) return;
      for (const view of [current.a, current.b])
        view?.dispatch({ effects: languageSlot.reconfigure(support ?? []) });
      current.b.requestMeasure({
        read: () => null,
        write: () => {
          host.style.visibility = '';
        },
      });
    };
    let colouring: ReturnType<typeof setTimeout> | undefined;
    const building = setTimeout(() => {
      build();
      colouring = setTimeout(colour, 0);
    }, 0);
    return () => {
      clearTimeout(building);
      clearTimeout(colouring);
      views.current?.destroy();
      views.current = null;
    };
  }, [ready, support, original, split, diffing, registry, editableSlot, findHost, languageSlot]);

  React.useEffect(() => {
    const current = views.current;
    if (!current) return;
    const value = JSON.parse(annotationsKey) as ReturnType<typeof splitAnnotations>;
    current.b.dispatch({ effects: setAnnotations.of(value.b) });
    current.a?.dispatch({ effects: setAnnotations.of(value.a) });
  }, [annotationsKey, ready, original, split, built]);

  React.useEffect(() => {
    views.current?.b.dispatch({ effects: editableSlot.reconfigure(resolveEditable(editable)) });
  }, [editable, editableSlot, ready, original, split, built]);

  React.useEffect(() => {
    const current = views.current;
    if (!current || !reveal) return;
    revealIn(reveal.side === 'old' && current.a ? current.a : current.b, reveal.line);
  }, [reveal?.key, ready, original, split, built]);

  React.useLayoutEffect(() => {
    const measure = () => {
      views.current?.b.requestMeasure();
      views.current?.a?.requestMeasure();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const slot of slots.values()) observer.observe(slot);
    return () => observer.disconnect();
  }, [slots, built]);

  React.useImperativeHandle(
    handle,
    () => ({
      openFind: () => {
        const view = views.current?.b;
        if (view) findHost.open(view, false);
      },
      openGotoLine: () => {
        const view = views.current?.b;
        if (view) gotoLine(view);
      },
      run: (id) => {
        const current = views.current;
        const command = selectEditorCommand(id);
        if (!current || !command) return;
        const view = current.a?.hasFocus ? current.a : current.b;
        view.focus();
        command.run(view, { save: () => latest.current.onSave(), openFind: findHost.open });
      },
      readText: () => text.current,
      replaceText: (next) => {
        text.current = next;
        const view = views.current?.b;
        if (view) replaceDoc(view, next);
      },
    }),
    [findHost]
  );

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {!ready && (
        <div className='absolute inset-0 flex'>
          <CodeLoading label={`Opening ${path}…`} />
        </div>
      )}
      <div ref={parent} className='@container min-h-0 flex-1' />
      {find.panel &&
        createPortal(
          <FindBar
            view={find.panel.view}
            replace={find.replace}
            canReplace={editable}
            onReplace={findHost.showReplace}
          />,
          find.panel.dom
        )}
      {notes.map((note) => {
        const slot = slots.get(note.key);
        return slot ? (
          <React.Fragment key={note.key}>{createPortal(props.renderNote(note), slot)}</React.Fragment>
        ) : null;
      })}
    </div>
  );
}

export { requestLanguage };
