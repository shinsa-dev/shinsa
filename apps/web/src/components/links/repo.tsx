import type { Repo, ShinsaState } from '@shinsa/core';
import { GlyphLabel, InAppLink, InlineMark, SMART_LINK } from '@/components/links/link.tsx';
import {
  InfoAction,
  InfoHeader,
  InfoPopover,
  InfoRow,
  InfoSection,
} from '@/components/overlays/info-popover.tsx';
import { ProjectDot } from '@/components/status/project-dot.tsx';
import { selectProject } from '@/lib/projects.ts';
import { navigate } from '@/router.ts';

export function RepoDetails({ state, repo }: { state: ShinsaState; repo: Repo }) {
  const project = selectProject(state, repo.projectId);
  return (
    <>
      <InfoHeader title={repo.name} description={<span className='break-all font-mono'>{repo.path}</span>} />
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

export function RepoChip({ state, repo }: { state: ShinsaState; repo: Repo }) {
  const path = `/tasks?q=${encodeURIComponent(repo.name)}`;
  return (
    <InfoPopover
      className='w-64'
      render={<InAppLink path={path} className={SMART_LINK} />}
      trigger={
        <GlyphLabel
          glyph={<InlineMark icon={repo.remote ? 'IconGithub' : 'IconFolder1'} />}
          text={repo.name}
        />
      }
    >
      <RepoDetails state={state} repo={repo} />
      <InfoAction label='Show its tasks' onClick={() => navigate(path)} />
    </InfoPopover>
  );
}
