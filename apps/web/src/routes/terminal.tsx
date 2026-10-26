import type { Project, ShinsaState, TerminalInfo, TerminalPlace, TerminalsSnapshot } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { EndedBar } from '@/components/terminal/ended-bar.tsx';
import { NewTerminalButton } from '@/components/terminal/place-menu.tsx';
import { TerminalTabs } from '@/components/terminal/tab-bar.tsx';
import { TerminalFindBar, TerminalPane, useTerminalView } from '@/components/terminal/terminal-pane.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { isMacPlatform } from '@/lib/code/keys.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { listTerminalPageCommands } from '@/lib/command/terminal.ts';
import { requestWithToast } from '@/lib/connection/commands.ts';
import {
  closeTerminal,
  renameTerminal,
  reorderTerminals,
  requestTerminalCreate,
  restartTerminal,
  useTerminals,
} from '@/lib/connection/terminals.ts';
import { useColorScheme } from '@/lib/preferences/theme.ts';
import { listProjects } from '@/lib/projects.ts';
import { describeFindKey } from '@/lib/terminal/keys.ts';
import {
  describeTerminalClose,
  groupTerminalPlaces,
  listProjectTerminals,
  rememberTerminalPath,
  resolveActiveTerminal,
  resolveDefaultPlace,
  resolveTerminalAfterClose,
  resolveTerminalPath,
  resolveTerminalProject,
} from '@/lib/terminal/tabs.ts';
import {
  resolveTerminalView,
  selectTerminalView,
  syncTerminalViews,
  type TerminalView,
} from '@/lib/terminal/view.ts';
import { replaceRoute, useSearchParam, useSearchString } from '@/router.ts';

function useKeptViews(snapshot: TerminalsSnapshot, active: TerminalInfo | null, mac: boolean) {
  const scheme = useColorScheme();
  const [shown, setShown] = React.useState<string[]>([]);
  const ids = snapshot.terminals.map((terminal) => terminal.id);
  const signature = ids.join(' ');
  React.useEffect(() => {
    syncTerminalViews(new Set(signature.split(' ')));
    setShown((current) => current.filter((id) => signature.split(' ').includes(id)));
  }, [signature]);
  const activeId = active?.id ?? null;
  React.useEffect(() => {
    if (activeId) setShown((current) => (current.includes(activeId) ? current : [...current, activeId]));
  }, [activeId]);
  const views = shown.flatMap((id) => {
    if (!ids.includes(id)) return [];
    return [resolveTerminalView({ id, appearance: snapshot.appearance, scheme, mac })];
  });
  React.useEffect(() => {
    for (const view of views) view.updateLook(snapshot.appearance, scheme);
  });
  return views;
}

function ConnectionNote({ view }: { view: TerminalView }) {
  const { connection } = useTerminalView(view);
  if (connection === 'open' || connection === 'gone') return null;
  return (
    <div className='pointer-events-none absolute end-3 top-2'>
      <LoadingSpinner label={connection === 'closed' ? 'Reconnecting' : 'Connecting'} />
    </div>
  );
}

function TerminalBody({
  views,
  active,
  onRestart,
  onClose,
}: {
  views: TerminalView[];
  active: TerminalInfo;
  onRestart: () => void;
  onClose: () => void;
}) {
  const view = views.find((each) => each.id === active.id) ?? null;
  const { findOpen, background } = useTerminalView(view);
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {view && findOpen && <TerminalFindBar key={view.id} view={view} />}
      <div style={{ background: background ?? undefined }} className='relative min-h-0 flex-1'>
        <div className='absolute inset-y-2 start-3 end-0'>
          {views.map((each) => (
            <TerminalPane key={each.id} view={each} shown={each.id === active.id} />
          ))}
        </div>
        {view && <ConnectionNote view={view} />}
      </div>
      <EndedBar terminal={active} onRestart={onRestart} onClose={onClose} />
    </div>
  );
}

function ProjectPicker({ state, project }: { state: ShinsaState; project: Project }) {
  const projects = listProjects(state);
  if (projects.length < 2) return <span className='shrink-0 text-fg-4 text-xs'>{project.name}</span>;
  return (
    <SelectField
      label='Project'
      size='sm'
      variant='ghost'
      align='start'
      value={project.id}
      items={projects.map((each) => ({ value: each.id, label: each.name }))}
      onValueChange={(id) => replaceRoute(resolveTerminalPath(state.projects[id]?.key ?? id))}
      className='w-auto shrink-0'
    />
  );
}

function ProjectTerminals({
  state,
  project,
  snapshot,
}: {
  state: ShinsaState;
  project: Project;
  snapshot: TerminalsSnapshot;
}) {
  const mac = React.useMemo(() => isMacPlatform(navigator.platform), []);
  const terminals = listProjectTerminals(snapshot, project.id);
  const active = resolveActiveTerminal(terminals, useSearchParam('terminal'));
  const views = useKeptViews(snapshot, active, mac);
  const activeView = views.find((view) => view.id === active?.id) ?? null;
  const groups = groupTerminalPlaces(state, project.id);
  const fallback = resolveDefaultPlace(state, project.id, snapshot.home);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const closing = useDialogState<TerminalInfo>();

  const select = (terminal: TerminalInfo) => {
    replaceRoute(resolveTerminalPath(project.key, terminal.id));
    selectTerminalView(terminal.id)?.focus();
  };
  const open = (place: TerminalPlace) =>
    void requestWithToast(async () => select(await requestTerminalCreate(project.id, place)));
  const close = (terminal: TerminalInfo) => {
    const next = resolveTerminalAfterClose(terminals, terminal.id);
    void closeTerminal(terminal.id).then((closed) => {
      if (closed && terminal.id === active?.id) replaceRoute(resolveTerminalPath(project.key, next?.id));
    });
  };
  const askToClose = (terminal: TerminalInfo) => {
    if (terminal.status === 'running') closing.show(terminal);
    else close(terminal);
  };
  const rename = (terminal: TerminalInfo, name: string | null) => {
    setRenaming(null);
    return renameTerminal(terminal.id, name);
  };
  const restart = (terminal: TerminalInfo) => {
    void restartTerminal(terminal.id);
    selectTerminalView(terminal.id)?.focus();
  };

  useRegisterCommands(
    listTerminalPageCommands({
      terminals,
      active,
      groups,
      fallback,
      mac,
      actions: { open, select, find: () => activeView?.openFind(), restart, rename, close: askToClose },
    })
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <Toolbar className='gap-1.5 ps-2'>
        <ProjectPicker state={state} project={project} />
        <TerminalTabs
          terminals={terminals}
          activeId={active?.id ?? null}
          renamingId={renaming}
          onSelect={select}
          onClose={askToClose}
          onRenameStart={(terminal) => setRenaming(terminal.id)}
          onRename={rename}
          onReorder={(ids) => void reorderTerminals(project.id, ids)}
        />
        <NewTerminalButton groups={groups} fallback={fallback} onOpen={open} />
        {activeView && (
          <Hint label='Find in the scrollback' shortcut={describeFindKey(mac)}>
            <Button
              variant='secondary'
              size='icon-sm'
              icon='IconMagnifyingGlass'
              aria-label='Find in the scrollback'
              onClick={() => activeView.openFind()}
            />
          </Hint>
        )}
      </Toolbar>
      {active ? (
        <TerminalBody
          views={views}
          active={active}
          onRestart={() => restart(active)}
          onClose={() => close(active)}
        />
      ) : (
        <EmptyState
          icon='IconConsole'
          title={`No terminals in ${project.name}`}
          description='A terminal runs your own shell in one of the project’s folders, and keeps running when you close Shinsa.'
        >
          <NewTerminalButton groups={groups} fallback={fallback} label='Open a terminal' wide onOpen={open} />
        </EmptyState>
      )}
      {closing.value && (
        <ConfirmDialog
          control={closing.control}
          title='Close this terminal?'
          body={describeTerminalClose(closing.value)}
          action='Close terminal'
          onConfirm={() => {
            if (closing.value) close(closing.value);
          }}
        />
      )}
    </div>
  );
}

export function TerminalPage({ state }: { state: ShinsaState }) {
  const snapshot = useTerminals();
  const search = useSearchString();
  React.useEffect(() => rememberTerminalPath(`/terminal${search}`), [search]);
  const project = resolveTerminalProject(state, useSearchParam('project'), useNow());
  if (!snapshot)
    return (
      <div className='grid flex-1 place-items-center'>
        <LoadingSpinner label='Reading your terminals' />
      </div>
    );
  if (!project)
    return (
      <EmptyState
        icon='IconConsole'
        title='No projects yet'
        description='Terminals open in a project’s folders. Add a project in Settings first.'
      />
    );
  return <ProjectTerminals state={state} project={project} snapshot={snapshot} />;
}
