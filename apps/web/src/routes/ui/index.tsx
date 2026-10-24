import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { useAnimatedIndicator } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { readThemePreference, type ThemePreference, writeThemePreference } from '@/lib/preferences/theme.ts';
import { AccountSpecimens } from './accounts.tsx';
import { ChatSpecimens } from './chat.tsx';
import { CompositeSpecimens } from './composites.tsx';
import { INPUT_SECTIONS, InputSpecimens } from './inputs.tsx';
import { OVERLAY_SECTIONS, OverlaySpecimens } from './overlays.tsx';
import { OverviewSpecimens } from './overview.tsx';
import { Section } from './section.tsx';
import { SettingsSpecimens } from './settings.tsx';
import { SURFACE_SECTIONS, SurfaceSpecimens } from './surfaces.tsx';
import { TOKEN_SECTIONS, TokenSpecimens } from './tokens.tsx';

const SECTIONS = [
  ...TOKEN_SECTIONS,
  ...INPUT_SECTIONS,
  ...OVERLAY_SECTIONS,
  ...SURFACE_SECTIONS,
  { id: 'shinsa', label: 'Shinsa composites' },
  { id: 'shinsa-accounts', label: 'Accounts' },
  { id: 'shinsa-overview', label: 'Overview cards' },
  { id: 'shinsa-chat', label: 'Chat' },
  { id: 'shinsa-settings', label: 'Settings rows' },
];

function SectionNav() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(SECTIONS[0]?.id ?? '');
  const rootRef = useRef<HTMLElement>(null);
  const indicatorRef = useAnimatedIndicator(rootRef);

  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const current = SECTIONS.find((s) => visible.has(s.id));
        if (current) setActiveId(current.id);
      },
      { rootMargin: '0px 0px -55% 0px' }
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={rootRef}
      aria-label='Sections'
      className='sticky top-8 isolate hidden h-fit w-44 shrink-0 flex-col gap-0.5 lg:flex'
      onPointerLeave={() => setHovered(null)}
    >
      <div
        ref={indicatorRef}
        aria-hidden
        className='pointer-events-none absolute top-0 left-0 -z-10 rounded-lg bg-bg-a2 opacity-0'
        style={{ willChange: 'transform, opacity', contain: 'layout paint', transformOrigin: 'center' }}
      />
      {SECTIONS.map((s) => {
        const active = activeId === s.id;
        const highlighted = hovered ? hovered === s.id : active;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={active ? 'true' : undefined}
            data-highlighted={highlighted ? '' : undefined}
            onPointerEnter={() => setHovered(s.id)}
            className={cn(
              'rounded-lg px-2 py-1 font-medium text-sm transition-colors duration-200 data-indicator-here:text-fg-4',
              active ? 'text-fg-4' : 'text-fg-2'
            )}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='outline' size='icon' aria-label='Toggle theme' />}>
        <Icon name='IconSun' className='size-4 dark:hidden' />
        <Icon name='IconMoon' className='hidden size-4 dark:block' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-32'>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              setTheme(value as ThemePreference);
              writeThemePreference(value as ThemePreference);
            }}
          >
            <DropdownMenuRadioItem value='light'>Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='dark'>Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='system'>System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UiPage() {
  return (
    <div className='mx-auto flex w-full max-w-6xl gap-10 px-5 pt-10 pb-24'>
      <a
        href='#content'
        className='corner-superellipse/1.125 sr-only z-50 rounded-xl bg-primary px-3 py-2 font-medium text-primary-foreground text-sm focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4'
      >
        Skip to content
      </a>
      <SectionNav />

      <main id='content' className='flex min-w-0 flex-1 flex-col gap-12'>
        <header className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <span className='flex h-6 w-fit items-center rounded-full bg-bg-a1 px-2 font-medium text-fg-2 text-sm'>
              @shinsa/ui
            </span>
            <h1 className='font-medium text-2xl text-fg-4 tracking-tight'>Design system</h1>
            <p className='max-w-lg text-fg-2 text-sm'>
              Every token, component and state. This page is the visual counterpart to{' '}
              <span className='text-fg-3 text-xs'>docs/design.md</span>. If something is in the library, it is
              on this page.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <TokenSpecimens />
        <InputSpecimens />
        <OverlaySpecimens />
        <SurfaceSpecimens />
        <Section
          id='shinsa'
          title='Shinsa composites'
          description='The app’s own pieces from apps/web/src/components, built on the kit above. Each has one owner; a hand-built copy is a bug.'
          className='flex-col items-start gap-8'
        >
          <CompositeSpecimens />
        </Section>
        <Section
          id='shinsa-accounts'
          title='Shinsa composites · accounts'
          description='Usage bars and figures, the usage menu, account status, the percent and sign-in dialogs, and the Run on account choices, from apps/web/src/components/accounts.'
          className='flex-col items-start gap-8'
        >
          <AccountSpecimens />
        </Section>
        <Section
          id='shinsa-overview'
          title='Shinsa composites · overview cards'
          description='The now card for each process state, on NowFrame, and the panels under it, from apps/web/src/components/overview. Sample data; every action only shows a toast.'
          className='flex-col items-start gap-8'
        >
          <OverviewSpecimens />
        </Section>
        <Section
          id='shinsa-chat'
          title='Shinsa composites · chat'
          description='Delegated work, the quiet notice rows and the context meter, from apps/web/src/components/chat.'
          className='flex-col items-start gap-8'
        >
          <ChatSpecimens />
        </Section>
        <Section
          id='shinsa-settings'
          title='Shinsa composites · settings rows'
          description='The Accounts section (Claude accounts with their usage, and Codex) in each state, schedule and notification rows, from apps/web/src/components/settings.'
          className='flex-col items-start gap-8'
        >
          <SettingsSpecimens />
        </Section>
      </main>
    </div>
  );
}
