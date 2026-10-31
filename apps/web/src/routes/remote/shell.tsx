import type { RemoteSession } from '@shinsa/core';
import { REMOTE_PATHS } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Logo } from '@shinsa/ui/components/logo';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { SettingsCard } from '@/components/settings/group.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { TONE_SURFACE, type Tone } from '@/lib/format/tone.ts';
import { type DashboardClient, describeSignInError, resolveSignInUrl } from '@/lib/remote/dashboard.ts';
import { MACHINE_ICON, type RemotePoint } from '@/lib/remote/mode.ts';

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
          <Button
            variant='secondary'
            size='sm'
            onClick={() => {
              void dashboard.signOut().then(() => location.assign(REMOTE_PATHS.app));
            }}
          >
            Sign out
          </Button>
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

const SIGN_IN_POINTS: RemotePoint[] = [
  {
    icon: MACHINE_ICON,
    title: 'Every machine in one place',
    detail: 'Each machine you turn remote access on for shows up here, with all its tasks.',
  },
  {
    icon: 'IconShieldCheck',
    title: 'Encrypted end to end',
    detail: 'Only your machine and the devices you add on it can read your work.',
  },
  {
    icon: 'IconKey1',
    title: 'Added once per device',
    detail: 'The first time, your machine gives this device its own key.',
  },
];

export function RemoteBenefits({ points = SIGN_IN_POINTS }: { points?: RemotePoint[] }) {
  return (
    <SettingsCard className='w-full'>
      {points.map((point) => (
        <div key={point.title} className='flex gap-3 px-2.5 py-2'>
          <Icon name={point.icon} size='sm' className='mt-px shrink-0 text-fg-2' />
          <div className='flex min-w-0 flex-col gap-px'>
            <span className='text-fg-4 text-xs'>{point.title}</span>
            <span className='text-pretty text-2xs text-fg-2'>{point.detail}</span>
          </div>
        </div>
      ))}
    </SettingsCard>
  );
}

export function RemoteSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <SettingsCard className='w-full'>
      <span className='px-2.5 pt-2 pb-1 text-2xs text-fg-2'>{title}</span>
      {steps.map((step, index) => (
        <div key={step} className='flex items-start gap-3 px-2.5 py-1.5'>
          <StepNumber index={index} />
          <span className='text-pretty pt-px text-fg-4 text-xs'>{step}</span>
        </div>
      ))}
    </SettingsCard>
  );
}

export function RemoteCheckAgain({ label = 'Check again' }: { label?: string }) {
  return (
    <Button className='w-full' onClick={() => location.reload()}>
      {label}
    </Button>
  );
}

export function SignInPrompt({ returnPath, error }: { returnPath: string; error: string | null }) {
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconGithub' title='Sign in to Shinsa'>
        Reach the Shinsa on your machine from any browser. Use the GitHub account you paired your machine
        with.
      </RemoteHero>
      <RemoteBenefits />
      {error && (
        <p role='alert' className='w-full text-pretty text-destructive text-xs'>
          {describeSignInError(error)}
        </p>
      )}
      <div className='flex w-full flex-col items-center gap-2'>
        <Button className='w-full' nativeButton={false} render={<a href={resolveSignInUrl(returnPath)} />}>
          <Icon name='IconGithub' />
          Sign in with GitHub
        </Button>
        <p className='text-center text-2xs text-fg-2'>
          No machine yet? Open Shinsa on your machine, then Settings, Remote access, and turn it on.
        </p>
      </div>
    </section>
  );
}

export function RemoteHero({
  icon,
  tone = 'neutral',
  title,
  children,
}: {
  icon: IconName;
  tone?: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col items-center gap-3 text-center'>
      <span
        className={cn(
          'corner-superellipse/1.125 grid size-10 place-items-center rounded-control',
          TONE_SURFACE[tone]
        )}
      >
        <Icon name={icon} size='lg' />
      </span>
      <div className='flex flex-col gap-1'>
        <h1 className='text-balance font-medium text-fg-4 text-lg'>{title}</h1>
        <p className='text-pretty text-fg-2 text-xs'>{children}</p>
      </div>
    </div>
  );
}
