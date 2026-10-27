import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { FindHost } from '@/lib/code/editor/find.ts';
import { createEditorExtensions } from '@/lib/code/editor/setup.ts';
import { addTeardown } from '../../../support/teardown.ts';

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
  addTeardown(() => {
    view.destroy();
    parent.remove();
  });
  return view;
}
