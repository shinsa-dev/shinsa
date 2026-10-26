import { Logo } from '@shinsa/ui/components/logo';
import type * as React from 'react';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-dvh flex-col overflow-hidden bg-background text-fg-3'>
      <header
        data-window-drag
        className='flex h-11 shrink-0 select-none items-center gap-2 px-3.5 desktop:ps-20 sm:px-5'
      >
        <span className='flex desktop:hidden items-center gap-1.5 font-medium text-fg-4 text-sm'>
          <span className='grid size-5 shrink-0 place-items-center'>
            <Logo className='size-3.25' />
          </span>
          Shinsa
        </span>
        <ConnectionStatus />
        <span className='flex-1' />
        <UpdateButton />
      </header>
      <main className='flex min-h-0 flex-1 flex-col'>{children}</main>
    </div>
  );
}
