import type { LanguageSupport } from '@codemirror/language';
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Spinner } from '@shinsa/ui/components/spinner';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { COLLAPSE } from '@/lib/code/collapse.ts';
import {
  annotationsField,
  type EditorAnnotations,
  NO_ANNOTATIONS,
  resolveSelectedLines,
  setAnnotations,
} from '@/lib/code/editor/annotations.ts';
import { requestLanguage } from '@/lib/code/editor/language.ts';
import {
  createEditorExtensions,
  gotoLine,
  openSearchPanel,
  resolveEditable,
} from '@/lib/code/editor/setup.ts';
import { SlotRegistry } from '@/lib/code/editor/slots.ts';
import { codeHighlight } from '@/lib/code/editor/theme.ts';
import { revealLine, unifiedDiff } from '@/lib/code/editor/unified.ts';
import type { CodeNote, CodeSpotMark } from '@/lib/code/notes.ts';
import { resolveCommentRange } from '@/lib/code/notes.ts';
import type { CommentSide } from '@/lib/review/draft.ts';

export interface EditorHandle {
  openFind: () => void;
  openGotoLine: () => void;
  readText: () => string;
  resetText: () => void;
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
  onEdit: (changed: boolean) => void;
  renderNote: (note: CodeNote) => React.ReactNode;
  handle: React.Ref<EditorHandle>;
}

interface Views {
  a: EditorView | null;
  b: EditorView;
  destroy: () => void;
}

const SPLIT_THEME = EditorView.theme({ '&': { height: 'auto' }, '.cm-scroller': { overflow: 'visible' } });

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
  const editableSlot = React.useMemo(() => new Compartment(), []);
  const latest = React.useRef(props);
  latest.current = props;
  const annotations = splitAnnotations(notes, spots, keep, split);
  const annotationsKey = JSON.stringify(annotations);
  const latestAnnotations = React.useRef(annotations);
  latestAnnotations.current = annotations;
  const ready = language !== null;
  const support = language?.support ?? null;
  const diffing = original !== null;

  React.useLayoutEffect(() => {
    const host = parent.current;
    if (!host || !ready) return;
    const comment = (side: CommentSide) => (line: number, view: EditorView) => {
      const onComment = latest.current.onComment;
      if (!onComment) return false;
      const range = resolveCommentRange(line, resolveSelectedLines(view));
      onComment(side, range.line, range.endLine);
      return true;
    };
    const onChange = EditorView.updateListener.of((update) => {
      if (update.docChanged) latest.current.onEdit(update.state.doc.toString() !== latest.current.content);
    });
    const base = (side: CommentSide, extra: Extension[]) =>
      createEditorExtensions({
        language: support,
        editable: side === 'new' ? editableSlot : new Compartment(),
        onLine: comment(side),
      }).concat(extra);
    const initial = latestAnnotations.current;
    if (diffing && split) {
      const merge = new MergeView({
        a: { doc: original, extensions: base('old', [SPLIT_THEME, annotationsField(registry, initial.a)]) },
        b: {
          doc: content,
          extensions: base('new', [SPLIT_THEME, annotationsField(registry, initial.b), onChange]),
        },
        parent: host,
        collapseUnchanged: { margin: COLLAPSE.margin, minSize: COLLAPSE.minSize },
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
            tree: support ? support.language.parser.parse(original) : null,
            highlighter: codeHighlight,
            registry,
            collapse: true,
            annotations: initial.b,
            onOldLine: (line) => latest.current.onComment?.('old', line, null),
          })
        );
      }
      const view = new EditorView({ state: EditorState.create({ doc: content, extensions }), parent: host });
      views.current = { a: null, b: view, destroy: () => view.destroy() };
    }
    return () => {
      views.current?.destroy();
      views.current = null;
    };
  }, [ready, support, content, original, split, diffing, registry, editableSlot]);

  React.useEffect(() => {
    const current = views.current;
    if (!current) return;
    const value = JSON.parse(annotationsKey) as ReturnType<typeof splitAnnotations>;
    current.b.dispatch({ effects: setAnnotations.of(value.b) });
    current.a?.dispatch({ effects: setAnnotations.of(value.a) });
  }, [annotationsKey, ready, content, original, split]);

  React.useEffect(() => {
    views.current?.b.dispatch({ effects: editableSlot.reconfigure(resolveEditable(editable)) });
  }, [editable, editableSlot, ready, content, original, split]);

  React.useEffect(() => {
    const current = views.current;
    if (!current || !reveal) return;
    revealIn(reveal.side === 'old' && current.a ? current.a : current.b, reveal.line);
  }, [reveal?.key, ready, content, original, split]);

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
  }, [slots]);

  React.useImperativeHandle(
    handle,
    () => ({
      openFind: () => {
        const view = views.current?.b;
        if (view) openSearchPanel(view);
      },
      openGotoLine: () => {
        const view = views.current?.b;
        if (view) gotoLine(view);
      },
      readText: () => views.current?.b.state.doc.toString() ?? content,
      resetText: () => {
        const view = views.current?.b;
        if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      },
    }),
    [content]
  );

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {!ready && (
        <div className='flex items-center gap-2 p-3 font-sans text-fg-2 text-xs'>
          <Spinner size='sm' /> Opening {path}
        </div>
      )}
      <div ref={parent} className='@container min-h-0 flex-1' />
      {notes.map((note) => {
        const slot = slots.get(note.key);
        return slot ? (
          <React.Fragment key={note.key}>{createPortal(props.renderNote(note), slot)}</React.Fragment>
        ) : null;
      })}
    </div>
  );
}
