import * as React from 'react';

const ReadOnlyContext = React.createContext(false);

const ReadOnlyNoteContext = React.createContext<React.ReactNode>(null);

const ReadOnlyOwnerContext = React.createContext<string | null>(null);

export function ReadOnlyProvider({
  note = null,
  owner = null,
  children,
}: {
  note?: React.ReactNode;
  owner?: string | null;
  children: React.ReactNode;
}) {
  return (
    <ReadOnlyContext value>
      <ReadOnlyNoteContext value={note}>
        <ReadOnlyOwnerContext value={owner}>{children}</ReadOnlyOwnerContext>
      </ReadOnlyNoteContext>
    </ReadOnlyContext>
  );
}

export function useReadOnly() {
  return React.use(ReadOnlyContext);
}

export function useReadOnlyNote() {
  return React.use(ReadOnlyNoteContext);
}

export function useReadOnlyOwner() {
  return React.use(ReadOnlyOwnerContext);
}
