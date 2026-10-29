import { ONBOARDING_REQUEST_LIMIT, type ProjectSuggestion } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { LIST_ROW_TITLE } from '@/components/layout/list-row.tsx';
import { ROW_INSET, SettingsCard } from '@/components/settings/group.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { describeFiledSummary } from '@/lib/onboarding-projects.ts';

export function OnboardingProjectsChat({
  busy,
  disabled,
  onSend,
}: {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = React.useState('');
  const trimmed = text.trim();
  return (
    <div className='flex flex-col gap-3'>
      <form
        className='flex items-center gap-1.5'
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || disabled) return;
          void onSend(trimmed).then((sent) => {
            if (sent) setText('');
          });
        }}
      >
        <Input
          value={text}
          maxLength={ONBOARDING_REQUEST_LIMIT}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder='Ask for a change, like “Give the iOS app its own project”'
          aria-label='Change the projects'
          autoComplete='off'
        />
        <Button type='submit' variant='secondary' loading={busy} disabled={!trimmed || disabled}>
          Ask
        </Button>
      </form>
    </div>
  );
}

export function OnboardingFiledProjects({
  projects,
  userHome,
}: {
  projects: ProjectSuggestion[];
  userHome: string;
}) {
  if (projects.length === 0) return null;
  return (
    <SettingsCard>
      <ul className='flex flex-col divide-y divide-border' aria-label='Projects already set up'>
        {projects.map((project) => (
          <li key={project.id} className={cn(ROW_INSET, 'flex flex-col gap-1 py-2')}>
            <span className='flex items-center gap-2'>
              <ProjectDotIcon color={project.color} />
              <Truncate className={cn(LIST_ROW_TITLE, 'min-w-0')}>{project.name}</Truncate>
            </span>
            <Truncate className='ps-6 text-2xs text-fg-2'>{describeFiledSummary(project, userHome)}</Truncate>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
