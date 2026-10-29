import type { ShinsaState } from '@shinsa/core';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { UsageMenu } from '@/components/accounts/usage-menu.tsx';
import { CommandMenuButton } from '@/components/command/menu.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { NavItem } from '@/components/layout/nav-item.tsx';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { ServicesMenu } from '@/components/services/menu.tsx';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { requestNewTaskOnHome } from '@/lib/command/menu.ts';
import { resolveResetKey } from '@/lib/errors.ts';
import { navigate, useRoute, useRouteTaskId } from '@/router.ts';

export function Rail({ state, onNavigate = () => {} }: { state: ShinsaState; onNavigate?: () => void }) {
  const route = useRoute();
  const activeTaskId = useRouteTaskId(state);
  const resetKey = resolveResetKey({ route, search: '' });

  function go(path: string) {
    navigate(path);
    onNavigate();
  }

  return (
    <nav className='flex h-full w-full select-none flex-col bg-sidebar'>
      <div data-window-drag className='flex h-11 shrink-0 items-center gap-2 desktop:ps-20 ps-3.5 pe-2'>
        <HomeLink onNavigate={onNavigate} />
        <ErrorBoundary size='icon' resetKey={resetKey}>
          <ConnectionStatus />
        </ErrorBoundary>
        <span className='flex-1' />
        <ErrorBoundary size='icon' resetKey={resetKey}>
          <UpdateButton />
        </ErrorBoundary>
        {route.name !== 'onboarding' && (
          <ErrorBoundary size='icon' resetKey={resetKey}>
            <UsageMenu state={state} />
          </ErrorBoundary>
        )}
        <CommandMenuButton />
      </div>
      <div className='flex flex-col px-2 pb-2'>
        <HoverHighlight className='flex flex-col gap-px'>
          <NavItem
            label='New task'
            icon='IconPlusMedium'
            activeIcon='IconPlusMediumFilled'
            active={route.name === 'home'}
            onClick={() => {
              requestNewTaskOnHome();
              onNavigate();
            }}
          />
          <NavItem
            label='Tasks'
            icon='IconListBullets'
            activeIcon='IconListBulletsFilled'
            active={route.name === 'tasks'}
            onClick={() => go('/tasks')}
          />
          {route.name !== 'onboarding' && (
            <ErrorBoundary size='inline' resetKey={resetKey}>
              <ServicesMenu state={state} variant='rail' onNavigate={onNavigate} />
            </ErrorBoundary>
          )}
          <NavItem
            label='Settings'
            icon='IconSettingsGear4'
            activeIcon='IconSettingsGear4Filled'
            active={route.name === 'settings'}
            onClick={() => go('/settings')}
          />
        </HoverHighlight>
      </div>
      {route.name !== 'onboarding' && (
        <div className='flex flex-col border-border border-t px-2 py-2'>
          <ErrorBoundary size='inline' resetKey={resetKey}>
            <FocusMenu state={state} />
          </ErrorBoundary>
        </div>
      )}
      <div className='flex min-h-0 flex-1 flex-col overflow-y-auto border-border border-t'>
        <ErrorBoundary size='inline' resetKey={resetKey} className='p-2'>
          <TaskQueue state={state} variant='compact' activeTaskId={activeTaskId} onNavigate={onNavigate} />
        </ErrorBoundary>
      </div>
    </nav>
  );
}
