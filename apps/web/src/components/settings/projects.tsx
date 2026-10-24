import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { listLooseRepos, listProjects, PROJECT_ACTIONS, type ProjectActions } from '@/lib/projects.ts';
import { SettingsBlock, SettingsEmpty, SettingsGroup } from './group.tsx';
import { ProjectBlock, RepoRow } from './project-block.tsx';
import { ProjectDialog } from './project-dialog.tsx';

function NewProjectButton({ state, actions }: { state: ShinsaState; actions: ProjectActions }) {
  const dialog = useDialogState<'create'>();
  return (
    <>
      <Button variant='secondary' size='sm' icon='IconPlusMedium' onClick={() => dialog.show('create')}>
        New project
      </Button>
      {dialog.value && (
        <ProjectDialog
          control={dialog.control}
          state={state}
          mode='create'
          project={null}
          onSave={actions.save}
        />
      )}
    </>
  );
}

export function ProjectSettings({
  state,
  actions = PROJECT_ACTIONS,
}: {
  state: ShinsaState;
  actions?: ProjectActions;
}) {
  const projects = listProjects(state);
  const loose = listLooseRepos(state);
  return (
    <SettingsGroup
      title='Projects'
      className='gap-1.5'
      action={<NewProjectButton state={state} actions={actions} />}
    >
      {projects.length === 0 && loose.length === 0 && (
        <SettingsEmpty>Create a project for the repositories you work on together.</SettingsEmpty>
      )}
      {projects.map((project) => (
        <ProjectBlock key={project.id} state={state} project={project} actions={actions} />
      ))}
      {loose.length > 0 && (
        <SettingsBlock
          header={
            <>
              <Icon size='sm' name='IconCircleDotted' className='text-fg-2' />
              <span className='font-medium text-fg-2 text-xs'>No project</span>
            </>
          }
        >
          {loose.map((repo) => (
            <RepoRow key={repo.id} repo={repo} />
          ))}
        </SettingsBlock>
      )}
    </SettingsGroup>
  );
}
