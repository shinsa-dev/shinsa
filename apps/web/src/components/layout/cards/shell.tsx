import type { ShinsaState } from '@shinsa/core';
import type * as React from 'react';
import { CardsTopBar } from './top-bar.tsx';

export function CardsShell({ state, children }: { state: ShinsaState; children: React.ReactNode }) {
  return (
    <div className='flex h-dvh flex-col overflow-hidden bg-background text-fg-3'>
      <CardsTopBar state={state} />
      <main className='flex min-h-0 flex-1 flex-col'>{children}</main>
    </div>
  );
}
