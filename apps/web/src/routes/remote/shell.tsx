import type { RemoteSession } from '@shinsa/core';
import { REMOTE_PATHS } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Logo } from '@shinsa/ui/components/logo';
import type * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { type DashboardClient, resolveSignInUrl } from '@/lib/remote/dashboard.ts';

export function RemoteShell({
  session,
  dashboard,
  children,
}: {
  session: RemoteSession | null;
  dashboard: Pick<DashboardClient, 'signOut'>;
  children: React.ReactNode;
}) {
  const user = session?.user ?? null;
  return (
    <div className='flex min-h-dvh flex-col bg-background text-fg-3'>
      <header className='flex h-11 shrink-0 items-center gap-2 px-3.5 sm:px-5'>
        <a href={REMOTE_PATHS.app} className='flex items-center gap-1.5 font-medium text-fg-4 text-sm'>
          <span className='grid size-5 shrink-0 place-items-center'>
            <Logo className='size-3.25' />
          </span>
          Shinsa
        </a>
        <span className='flex-1' />
        {user && (
          <>
            <span className='truncate text-fg-2 text-xs'>{user.login}</span>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => {
                void dashboard.signOut().then(() => location.assign(REMOTE_PATHS.app));
              }}
            >
              Sign out
            </Button>
          </>
        )}
      </header>
      <main className='mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pt-10 pb-16'>{children}</main>
    </div>
  );
}

export function RemoteLoading({ label }: { label: string }) {
  return (
    <div className='grid flex-1 place-items-center'>
      <LoadingSpinner label={label} />
    </div>
  );
}

export function SignInPrompt({ returnPath, error }: { returnPath: string; error: string | null }) {
  return (
    <section className='flex flex-col gap-4'>
      <PageHeading
        title='Sign in to reach your Mac'
        description='Use the GitHub account you paired your Mac with. Each browser also has to be added on the Mac once before it can open anything.'
      />
      {error && (
        <p role='alert' className='text-destructive text-xs'>
          Signing in did not work ({error}). Try again.
        </p>
      )}
      <div className='flex'>
        <Button nativeButton={false} render={<a href={resolveSignInUrl(returnPath)} />}>
          Sign in with GitHub
        </Button>
      </div>
    </section>
  );
}
