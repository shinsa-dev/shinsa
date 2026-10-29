import { type ProjectSuggestion, resolveDisplayPath } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import { Input } from '@shinsa/ui/components/input';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { LIST_ROW, LIST_ROW_LINE, LIST_ROW_META, LIST_ROW_TITLE } from '@/components/layout/list-row.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { ROW_INSET, SettingsCard } from '@/components/settings/group.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { describeProjectSummary, type ProjectDraft, resolveToggledRepo } from '@/lib/onboarding-projects.ts';
import { notPersisted, useDisclosure } from '@/lib/preferences/disclosure.ts';

function RepoRow({
  repo,
  kept,
  disabled,
  userHome,
  onToggle,
}: {
  repo: ProjectSuggestion['repos'][number];
  kept: boolean;
  disabled: boolean;
  userHome: string;
  onToggle: () => void;
}) {
  return (
    <li>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox inside takes the keys */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the whole row toggles its checkbox */}
      <div
        onClick={() => {
          if (!disabled) onToggle();
        }}
        className={cn(LIST_ROW, LIST_ROW_LINE, 'px-1.5', disabled && 'cursor-default')}
      >
        <span className={ICON_SLOT}>
          <Checkbox
            size='sm'
            variant='outline'
            checked={kept}
            disabled={disabled}
            aria-label={`Keep ${repo.name}`}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={onToggle}
          />
        </span>
        <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
          <Truncate className={cn(LIST_ROW_TITLE, 'min-w-0 shrink-0')}>{repo.name}</Truncate>
          <Truncate className={cn(LIST_ROW_META, 'min-w-0')}>
            {resolveDisplayPath(repo.path, userHome)}
          </Truncate>
        </span>
      </div>
    </li>
  );
}

function ProjectRow({
  project,
  draft,
  disabled,
  userHome,
  onChange,
}: {
  project: ProjectSuggestion;
  draft: ProjectDraft;
  disabled: boolean;
  userHome: string;
  onChange: (patch: Partial<ProjectDraft>) => void;
}) {
  const disclosure = useDisclosure(notPersisted('a suggestion that lives only while setup runs'), false);
  const off = disabled || !draft.included;
  return (
    <li className={cn(ROW_INSET, 'flex flex-col gap-1 py-2')}>
      <div className='flex items-center gap-2'>
        <Checkbox
          size='sm'
          checked={draft.included}
          disabled={disabled}
          aria-label={`Create ${draft.name.trim() || 'this project'}`}
          onCheckedChange={(included) => onChange({ included })}
        />
        <ProjectDotIcon color={project.color} />
        <Input
          size='sm'
          value={draft.name}
          disabled={off}
          aria-label='Project name'
          spellCheck={false}
          autoComplete='off'
          className='w-56 min-w-0 shrink'
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <span className='flex-1' />
        <Button
          variant='bare'
          size='xs'
          icon={{
            name: disclosure.open ? 'IconChevronTopMedium' : 'IconChevronDownMedium',
            position: 'inline-end',
          }}
          aria-expanded={disclosure.open}
          onClick={disclosure.toggle}
        >
          {disclosure.open ? 'Hide' : 'Repositories'}
        </Button>
      </div>
      <Truncate className='ps-11 text-2xs text-fg-2'>
        {describeProjectSummary(project, draft, userHome, !disclosure.open)}
      </Truncate>
      {disclosure.open && (
        <ul className='flex flex-col gap-px ps-4'>
          {project.repos.map((repo) => (
            <RepoRow
              key={repo.path}
              repo={repo}
              kept={!draft.excluded.includes(repo.path)}
              disabled={off}
              userHome={userHome}
              onToggle={() => onChange(resolveToggledRepo(draft, repo.path))}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OnboardingProjects({
  projects,
  drafts,
  disabled,
  userHome,
  onChange,
}: {
  projects: ProjectSuggestion[];
  drafts: ProjectDraft[];
  disabled: boolean;
  userHome: string;
  onChange: (id: string, patch: Partial<ProjectDraft>) => void;
}) {
  if (projects.length === 0) return null;
  return (
    <SettingsCard>
      <ul className='flex flex-col divide-y divide-border'>
        {projects.map((project) => {
          const draft = drafts.find((entry) => entry.id === project.id);
          if (!draft) return null;
          return (
            <ProjectRow
              key={project.id}
              project={project}
              draft={draft}
              disabled={disabled}
              userHome={userHome}
              onChange={(patch) => onChange(project.id, patch)}
            />
          );
        })}
      </ul>
    </SettingsCard>
  );
}
