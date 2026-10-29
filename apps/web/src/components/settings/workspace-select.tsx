import { type Repo, resolveRepoWorkspace, type WorkspaceMode } from '@shinsa/core';
import { SelectField } from '@/components/controls/select-field.tsx';
import { listWorkspaceItems, WORKSPACE_TITLE } from '@/lib/workspaces.ts';

export function WorkspaceSelect({
  repo,
  onChange,
}: {
  repo: Repo;
  onChange: (repo: Repo, mode: WorkspaceMode) => Promise<boolean>;
}) {
  return (
    <SelectField
      label={`${WORKSPACE_TITLE} in ${repo.name}`}
      size='sm'
      variant='ghost'
      items={listWorkspaceItems()}
      value={resolveRepoWorkspace(repo)}
      onValueChange={(mode) => void onChange(repo, mode)}
    />
  );
}
