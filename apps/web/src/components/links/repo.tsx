import type { Project, Repo, ShinsaState } from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import type * as React from 'react';
import { GlyphLabel, INLINE_MARK, InAppLink, SMART_LINK } from '@/components/links/link.tsx';
import {
  InfoAction,
  InfoHeader,
  InfoPopover,
  InfoRow,
  InfoSection,
} from '@/components/overlays/info-popover.tsx';
import { ProjectDot } from '@/components/status/project-dot.tsx';
import { resolveProjectInk, resolveRepoIcon, selectProject } from '@/lib/projects.ts';
import { navigate } from '@/router.ts';

export function RepoDetails({ state, repo }: { state: ShinsaState; repo: Repo }) {
  const project = selectProject(state, repo.projectId);
  return (
    <>
      <InfoHeader title={repo.name} description={<span className='font-mono break-all'>{repo.path}</span>} />
      <InfoSection>
        {project && (
          <InfoRow
            icon='IconLayersTwo'
            label='Project'
            value={
              <span className='flex items-center gap-1.5'>
                <ProjectDot color={project.color} className='size-1.5' />
                {project.name}
              </span>
            }
          />
        )}
        <InfoRow icon='IconBranch' label='Default branch' value={repo.defaultBranch} />
      </InfoSection>
    </>
  );
}

export function RepoGlyph({
  repo,
  project,
  icon = resolveRepoIcon(repo),
  className,
}: {
  repo: Repo;
  project: Project | null;
  icon?: IconName;
  className?: string;
}) {
  return (
    <Icon
      size='sm'
      name={icon}
      data-project-ink={project?.color}
      className={className}
      style={
        project ? ({ '--icon-color': resolveProjectInk(project.color) } as React.CSSProperties) : undefined
      }
    />
  );
}

export function RepoIcon({
  state,
  repo,
  icon,
  className,
}: {
  state: ShinsaState;
  repo: Repo;
  icon?: IconName;
  className?: string;
}) {
  return (
    <RepoGlyph repo={repo} project={selectProject(state, repo.projectId)} icon={icon} className={className} />
  );
}

export function RepoChip({ state, repo }: { state: ShinsaState; repo: Repo }) {
  const path = `/tasks?q=${encodeURIComponent(repo.name)}`;
  return (
    <InfoPopover
      className='w-64'
      render={<InAppLink path={path} className={SMART_LINK} />}
      trigger={
        <GlyphLabel glyph={<RepoIcon state={state} repo={repo} className={INLINE_MARK} />} text={repo.name} />
      }
    >
      <RepoDetails state={state} repo={repo} />
      <InfoAction label='Show its tasks' onClick={() => navigate(path)} />
    </InfoPopover>
  );
}
