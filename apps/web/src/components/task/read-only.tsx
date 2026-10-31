import * as React from 'react';

const ReadOnlyContext = React.createContext(false);

export function ReadOnlyProvider({ children }: { children: React.ReactNode }) {
  return <ReadOnlyContext value>{children}</ReadOnlyContext>;
}

export function useReadOnly() {
  return React.use(ReadOnlyContext);
}
