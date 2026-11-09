import type { Project, ShinsaState } from '@shinsa/core';
import type { BrowserProjectAnswer } from '@shinsa/core/engine-api/schema';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { toast } from '@shinsa/ui/components/sonner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import {
  BROWSER_DESCRIPTION,
  BROWSER_SECTION,
  describeSignOut,
  describeSiteCookies,
  listSignedInSites,
  NO_SIGNED_IN_SITES,
  READING_SITES,
  SIGN_IN_WINDOW_NOTE,
  SIGN_OUT_TITLE,
} from '@/lib/browser.ts';
import { BROWSER_ACTIONS, type BrowserActions } from '@/lib/connection/browser.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { describeProjectKey, listProjects } from '@/lib/projects.ts';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { BrowserCopyDialog } from './browser-copy-dialog.tsx';
import { PathRow, SETTING_ROW, SettingsBlock, SettingsEmpty, SettingsGroup } from './group.tsx';

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

function BrowserMenu({
  narrow,
  onSignOut,
}: {
  narrow: { onCopy: () => void; onOpenWindow: () => void } | null;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <OptionsTrigger label='Browser options' />
      <DropdownMenuContent align='end' className='min-w-44'>
        {narrow && (
          <>
            <DropdownMenuItem className='sm:hidden' onClick={narrow.onCopy}>
              Copy sign-ins…
            </DropdownMenuItem>
            <DropdownMenuItem className='sm:hidden' onClick={narrow.onOpenWindow}>
              Open sign-in window
            </DropdownMenuItem>
            <DropdownMenuSeparator className='sm:hidden' />
          </>
        )}
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

  const sites = answer ? listSignedInSites(answer.sites) : [];
  const showCopy = () => copy.show('copy');
  const openWindow = () =>
    void act('window', () => actions.openWindow(project.id, null), 'Opened the sign-in window.');
  return (
    <SettingsBlock
      header={
        <>
          <ProjectDotIcon color={project.color} />
          <Truncate className='min-w-0 text-xs font-medium text-fg-4'>{project.name}</Truncate>
          <Hint label={describeProjectKey(project.key)}>
            <Badge size='sm' className='font-mono'>
              {project.key}
            </Badge>
          </Hint>
          <span className='flex-1' />
          {windowOpen ? (
            <Button
              size='xs'
              loading={busy === 'done'}
              onClick={() =>
                void act('done', () => actions.closeWindow(project.id), 'Done. Agents use the browser again.')
              }
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant='secondary' size='xs' className='max-sm:hidden' onClick={showCopy}>
                Copy sign-ins
              </Button>
              <Button
                variant='secondary'
                size='xs'
                className='max-sm:hidden'
                loading={busy === 'window'}
                onClick={openWindow}
              >
                Open sign-in window
              </Button>
            </>
          )}
          <BrowserMenu
            narrow={windowOpen ? null : { onCopy: showCopy, onOpenWindow: openWindow }}
            onSignOut={() => signOut.show('signOut')}
          />
        </>
      }
    >
      {windowOpen && <p className={cn(SETTING_ROW, 'text-2xs text-fg-2')}>{SIGN_IN_WINDOW_NOTE}</p>}
      {!answer && <SettingsEmpty>{READING_SITES}</SettingsEmpty>}
      {answer && sites.length === 0 && <SettingsEmpty>{NO_SIGNED_IN_SITES}</SettingsEmpty>}
      {sites.map((site) => (
        <PathRow
          key={site.site}
          icon='IconGlobe'
          iconLabel='Signed in'
          title={site.site}
          path={describeSiteCookies(site)}
        />
      ))}
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
    </SettingsBlock>
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
    <SettingsGroup title={BROWSER_SECTION} description={BROWSER_DESCRIPTION} className='gap-1.5'>
      {projects.length === 0 && (
        <SettingsEmpty>Create a project first. Each project gets its own browser.</SettingsEmpty>
      )}
      {projects.map((project) => (
        <BrowserProjectRow key={project.id} project={project} actions={actions} />
      ))}
    </SettingsGroup>
  );
}
