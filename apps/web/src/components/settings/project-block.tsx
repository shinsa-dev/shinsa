import type { Project, Repo, ShinsaState } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SuggestedSourceWatchRow } from '@/components/automations/suggested-watch.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import type { CoverageDetectionMap } from '@/lib/connection/coverage.ts';
import {
  describeProjectKey,
  describeProjectRemoval,
  FOLDER_HINT,
  listProjectRepoRows,
  NO_PLACES,
  type ProjectActions,
  resolveFolderName,
  validateFolderPath,
} from '@/lib/projects.ts';
import { describeWatchSource, removeWatchSource, WATCH_SOURCE_HINT } from '@/lib/tasks/watchdogs.ts';
import { selectSourceSuggestion } from '@/lib/watch-suggestions.ts';
import { BaselineSelect } from './baseline-select.tsx';
import { CoverageSelect } from './coverage-select.tsx';
import { PathRow, SETTING_ROW, SettingsBlock, SettingsEmpty } from './group.tsx';
import { ProjectDialog } from './project-dialog.tsx';
import { AddMenu, type ProjectDialogValue, ProjectMenu } from './project-menu.tsx';
import { WorkspaceSelect } from './workspace-select.tsx';

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Hint label={label}>
      <Button variant='secondary' size='icon-sm' icon='IconCrossSmall' aria-label={label} onClick={onClick} />
    </Hint>
  );
}

function RepoRow({ repo, action }: { repo: Repo; action?: React.ReactNode }) {
  return (
    <PathRow
      icon={repo.remote ? 'IconGithub' : 'IconFolder1'}
      iconLabel={repo.remote ? 'GitHub repository' : 'Local repository'}
      title={repo.name}
      path={repo.path}
      action={action}
    />
  );
}

function ProjectFolderForm({
  project,
  actions,
  onDone,
}: {
  project: Project;
  actions: ProjectActions;
  onDone: () => void;
}) {
  const [path, setPath] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function add() {
    const problem = validateFolderPath(path);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    const refusal = await actions.addFolder(project, path);
    setBusy(false);
    setError(refusal);
    if (!refusal) onDone();
  }

  return (
    <form
      className={cn(SETTING_ROW, 'items-start gap-1.5')}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Field data-invalid={error ? true : undefined} className='min-w-0 flex-1'>
        <Input
          size='sm'
          autoFocus
          value={path}
          placeholder='The folder’s full path'
          aria-label={`Add a folder to ${project.name}`}
          aria-invalid={error ? true : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onDone();
          }}
          onChange={(event) => {
            setPath(event.target.value);
            setError(null);
          }}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <Button type='submit' variant='secondary' size='sm' disabled={!path.trim()} loading={busy}>
        Add folder
      </Button>
      <Button type='button' variant='secondary' size='sm' onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

interface ProjectProps {
  state: ShinsaState;
  project: Project;
  actions: ProjectActions;
}

function RepoSettings({
  repo,
  actions,
  detected,
}: {
  repo: Repo;
  actions: ProjectActions;
  detected: CoverageDetectionMap | null;
}) {
  return (
    <>
      <BaselineSelect repo={repo} onChange={actions.changeBaseline} />
      <CoverageSelect repo={repo} detected={detected} onChange={actions.changeCoverage} />
      <WorkspaceSelect repo={repo} onChange={actions.changeWorkspace} />
    </>
  );
}

export function LooseRepoRow({
  repo,
  actions,
  detected,
}: {
  repo: Repo;
  actions: ProjectActions;
  detected: CoverageDetectionMap | null;
}) {
  return <RepoRow repo={repo} action={<RepoSettings repo={repo} actions={actions} detected={detected} />} />;
}

function ProjectDialogs({
  state,
  project,
  repoCount,
  actions,
  dialog,
}: ProjectProps & {
  repoCount: number;
  dialog: ReturnType<typeof useDialogState<ProjectDialogValue>>;
}) {
  const removal = describeProjectRemoval(project, repoCount);
  if (dialog.value === 'remove') {
    return (
      <ConfirmDialog
        control={dialog.control}
        title={removal.title}
        body={removal.body}
        action='Remove project'
        onConfirm={() => void actions.remove(project, removal.done)}
      />
    );
  }
  if (!dialog.value) return null;
  return (
    <ProjectDialog
      control={dialog.control}
      state={state}
      mode={dialog.value}
      project={project}
      onSave={actions.save}
    />
  );
}

function ProjectHeader({
  state,
  project,
  actions,
  repoCount,
  onAddFolder,
}: ProjectProps & { repoCount: number; onAddFolder: () => void }) {
  const dialog = useDialogState<ProjectDialogValue>();
  return (
    <>
      <ProjectDotIcon color={project.color} />
      <Truncate className='min-w-0 font-medium text-fg-4 text-xs'>{project.name}</Truncate>
      <Hint label={describeProjectKey(project.key)}>
        <Badge size='sm' className='font-mono'>
          {project.key}
        </Badge>
      </Hint>
      <span className='flex-1' />
      <AddMenu state={state} project={project} actions={actions} onAddFolder={onAddFolder} />
      <ProjectMenu project={project} actions={actions} onShow={dialog.show} />
      <ProjectDialogs
        state={state}
        project={project}
        repoCount={repoCount}
        actions={actions}
        dialog={dialog}
      />
    </>
  );
}

function ProjectFolderRow({ project, folder, actions }: Omit<ProjectProps, 'state'> & { folder: string }) {
  const name = resolveFolderName(folder);
  return (
    <PathRow
      icon='IconFolders'
      iconLabel={FOLDER_HINT}
      title={name}
      path={folder}
      action={
        <RemoveButton
          label={`Remove the ${name} folder`}
          onClick={() => void actions.removeFolder(project, folder)}
        />
      }
    />
  );
}

export function ProjectBlock({
  state,
  project,
  actions,
  detected,
}: ProjectProps & { detected: CoverageDetectionMap | null }) {
  const repos = listProjectRepoRows(state, project.id);
  const [adding, setAdding] = React.useState(false);
  const empty = repos.length === 0 && project.folders.length === 0 && !adding;
  return (
    <SettingsBlock
      header={
        <ProjectHeader
          state={state}
          project={project}
          actions={actions}
          repoCount={repos.length}
          onAddFolder={() => setAdding(true)}
        />
      }
    >
      {empty && <SettingsEmpty>{NO_PLACES}</SettingsEmpty>}
      {repos.map((repo) => (
        <RepoRow
          key={repo.id}
          repo={repo}
          action={
            <>
              <RepoSettings repo={repo} actions={actions} detected={detected} />
              <RemoveButton
                label={`Remove ${repo.name} from the project`}
                onClick={() => void actions.removeRepo(repo)}
              />
            </>
          }
        />
      ))}
      {project.folders.map((folder) => (
        <ProjectFolderRow key={folder} project={project} folder={folder} actions={actions} />
      ))}
      {adding && <ProjectFolderForm project={project} actions={actions} onDone={() => setAdding(false)} />}
      {(project.watchSources ?? []).map((source) => {
        const suggestion = selectSourceSuggestion(state, project.id, source.server);
        return (
          <React.Fragment key={source.server}>
            <PathRow
              icon='IconRadar'
              iconLabel={WATCH_SOURCE_HINT}
              title={source.server}
              path={describeWatchSource(state, source)}
              action={
                <RemoveButton
                  label={`Remove ${source.server} from the project`}
                  onClick={() => void removeWatchSource(project.id, source.server)}
                />
              }
            />
            {suggestion && <SuggestedSourceWatchRow suggestion={suggestion} />}
          </React.Fragment>
        );
      })}
    </SettingsBlock>
  );
}
