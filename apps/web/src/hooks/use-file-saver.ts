import * as React from 'react';
import { FileSaver, rememberSaved, type SaverState, selectSaved } from '@/lib/code/edits.ts';
import { requestFileWrite } from '@/lib/connection/code.ts';

interface Buffer {
  readText: () => string;
  replaceText: (text: string) => void;
}

const IDLE: SaverState = { saving: false, notice: null, refusal: null };

export function useFileSaver(input: {
  taskId: string;
  path: string | null;
  text: string | null;
  buffer: React.RefObject<Buffer | null>;
}) {
  const { taskId, path, text, buffer } = input;
  const [state, setState] = React.useState<SaverState>(IDLE);
  const read = React.useRef<{ text: string; start: string; latest: string; saver: FileSaver } | null>(null);
  if (read.current === null && text !== null && path !== null) {
    const start = selectSaved(taskId, path, text) ?? text;
    const from = text;
    read.current = {
      text,
      start,
      latest: start,
      saver: new FileSaver(start, {
        save: (content, base) => requestFileWrite(taskId, { path, content, base }),
        read: () => buffer.current?.readText() ?? read.current?.latest ?? start,
        apply: (next) => {
          if (read.current) read.current.latest = next;
          buffer.current?.replaceText(next);
        },
        onSaved: (saved) => rememberSaved(taskId, path, read.current?.text ?? from, saved),
        onState: setState,
      }),
    };
  }
  const current = read.current;

  React.useEffect(() => {
    if (!current || text === null || current.text === text) return;
    const previous = current.text;
    current.text = text;
    current.saver.reload(previous, text);
  }, [current, text]);

  React.useEffect(
    () => () => {
      if (!current) return;
      void current.saver.flush().finally(() => current.saver.dispose());
    },
    [current]
  );

  return {
    start: current?.start ?? text,
    state,
    edit: () => {
      if (!current) return;
      current.latest = buffer.current?.readText() ?? current.latest;
      current.saver.edit();
    },
  };
}
