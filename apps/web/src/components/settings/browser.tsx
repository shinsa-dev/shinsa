import type { Project, ShinsaState } from '@shinsa/core';
import type { BrowserProjectAnswer } from '@shinsa/core/engine-api/schema';
import { Button } from '@shinsa/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@shinsa/ui/components/dropdown-menu';
import { toast } from '@shinsa/ui/components/sonner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import {
  BROWSER_DESCRIPTION,
  BROWSER_SECTION,
  describeSignedInSites,
  describeSignOut,
  SIGN_IN_WINDOW_NOTE,
  SIGN_OUT_TITLE,
} from '@/lib/browser.ts';
import { BROWSER_ACTIONS, type BrowserActions } from '@/lib/connection/browser.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { listProjects } from '@/lib/projects.ts';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { BrowserCopyDialog } from './browser-copy-dialog.tsx';
import { SETTING_LABEL, SETTING_ROW, SETTING_ROW_WRAPS, SettingsEmpty, SettingsGroup } from './group.tsx';

type BrowserBusy = 'window' | 'done' | 'signOut' | null;

function useBrowserProject(projectId: string, actions: BrowserActions) {
  const [answer, setAnswer] = React.useState<BrowserProjectAnswer | null>(null);
  const refresh = React.useCallback(
    () =>
      actions.readProject(projectId).then(setAnswer, (error: unknown) => {
        toast.error(describeFailure(error));
      }),
    [actions, projectId]
  );
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  return { answer, replaceAnswer: setAnswer, refresh };
}

function SignOutMenu({ onSignOut }: { onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <OptionsTrigger label='Browser options' />
      <DropdownMenuContent align='end' className='min-w-44'>
        <DropdownMenuItem icon='IconTrashCan' variant='destructive' onClick={onSignOut}>
          Sign out of everything…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BrowserProjectRow({ project, actions }: { project: Project; actions: BrowserActions }) {
  const { answer, replaceAnswer, refresh } = useBrowserProject(project.id, actions);
  const [busy, setBusy] = React.useState<BrowserBusy>(null);
  const copy = useDialogState<'copy'>();
  const signOut = useDialogState<'signOut'>();
  const windowOpen = answer?.mode === 'window';

  async function act(
    kind: Exclude<BrowserBusy, null>,
    request: () => Promise<BrowserProjectAnswer>,
    done: string
  ) {
    setBusy(kind);
    try {
      replaceAnswer(await request());
      toast.success(done);
    } catch (error) {
      toast.error(describeFailure(error));
    }
    setBusy(null);
  }

  return (
    <div className='flex flex-col'>
      <div className={cn(SETTING_ROW, SETTING_ROW_WRAPS, 'gap-2')}>
        <span className={cn(SETTING_LABEL, 'flex items-center gap-2')}>
          <ProjectDotIcon color={project.color} />
          <span className='flex min-w-0 flex-1 flex-col'>
            <Truncate className='text-xs text-fg-4'>{project.name}</Truncate>
            <Truncate className='text-2xs text-fg-2'>
              {answer ? describeSignedInSites(answer.sites) : 'Reading its sites…'}
            </Truncate>
          </span>
        </span>
        <span className='flex shrink-0 items-center gap-1.5'>
          {windowOpen ? (
            <Button
              size='sm'
              loading={busy === 'done'}
              onClick={() =>
                void act('done', () => actions.closeWindow(project.id), 'Done. Agents use the browser again.')
              }
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant='secondary' size='sm' onClick={() => copy.show('copy')}>
                Copy sign-ins
              </Button>
              <Button
                variant='secondary'
                size='sm'
                loading={busy === 'window'}
                onClick={() =>
                  void act('window', () => actions.openWindow(project.id, null), 'Opened the sign-in window.')
                }
              >
                Open sign-in window
              </Button>
            </>
          )}
          <SignOutMenu onSignOut={() => signOut.show('signOut')} />
        </span>
      </div>
      {windowOpen && (
        <p className={cn(SETTING_ROW, 'min-h-0 pb-2 text-2xs text-fg-2')}>{SIGN_IN_WINDOW_NOTE}</p>
      )}
      {copy.value && (
        <BrowserCopyDialog
          control={copy.control}
          projectId={project.id}
          actions={actions}
          onCopied={() => void refresh()}
        />
      )}
      <ConfirmDialog
        control={signOut.control}
        title={SIGN_OUT_TITLE}
        body={describeSignOut(project.name)}
        action='Sign out'
        onConfirm={() =>
          void act('signOut', () => actions.signOut(project.id), `Signed ${project.name}’s browser out.`)
        }
      />
    </div>
  );
}

export function BrowserSettings({
  state,
  actions = BROWSER_ACTIONS,
}: {
  state: ShinsaState;
  actions?: BrowserActions;
}) {
  const supported = useEngineFeature('browser');
  if (!supported || isRemoteBuild()) return null;
  const projects = listProjects(state);
  return (
    <SettingsGroup
      title={BROWSER_SECTION}
      description={BROWSER_DESCRIPTION}
      className='divide-y divide-border'
    >
      {projects.length === 0 && (
        <SettingsEmpty>Create a project first. Each project gets its own browser.</SettingsEmpty>
      )}
      {projects.map((project) => (
        <BrowserProjectRow key={project.id} project={project} actions={actions} />
      ))}
    </SettingsGroup>
  );
}
