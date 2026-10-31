import * as React from 'react';

const ReadOnlyContext = React.createContext(false);

const ReadOnlyNoteContext = React.createContext<React.ReactNode>(null);

export function ReadOnlyProvider({
  note = null,
  children,
}: {
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ReadOnlyContext value>
      <ReadOnlyNoteContext value={note}>{children}</ReadOnlyNoteContext>
    </ReadOnlyContext>
  );
}

export function useReadOnly() {
  return React.use(ReadOnlyContext);
}

export function useReadOnlyNote() {
  return React.use(ReadOnlyNoteContext);
}
