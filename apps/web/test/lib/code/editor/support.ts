import { afterEach } from 'bun:test';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { FindHost } from '@/lib/code/editor/find.ts';
import { createEditorExtensions } from '@/lib/code/editor/setup.ts';

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

export function createView(
  doc: string,
  extensions: Extension[],
  onLine: (line: number) => boolean = () => true,
  find = new FindHost()
) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...createEditorExtensions({
          language: null,
          editable: new Compartment(),
          onLine,
          findPanel: find.createPanel,
        }),
        ...extensions,
      ],
    }),
    parent,
  });
  views.push(view);
  return view;
}
