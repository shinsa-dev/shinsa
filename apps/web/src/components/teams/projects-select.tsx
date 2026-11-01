import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shinsa/ui/components/select';
import { cn } from '@shinsa/ui/lib/utils';
import { ProjectDot, ProjectOption } from '@/components/status/project-dot.tsx';
import { type ProjectChoice, resolveProjectPick } from '@/lib/teams/settings.ts';

function PickedProjects({
  projects,
  chosen,
}: {
  projects: readonly ProjectChoice[];
  chosen: readonly string[];
}) {
  const pick = resolveProjectPick(projects, chosen);
  return (
    <>
      {pick.dots.length > 0 && (
        <span className='flex shrink-0 items-center -space-x-0.5'>
          {pick.dots.map((project) => (
            <ProjectDot key={project.id} color={project.color} className='ring-2 ring-bg-2' />
          ))}
        </span>
      )}
      <span className={cn('truncate', pick.dots.length === 0 && 'text-fg-2')}>{pick.label}</span>
    </>
  );
}

export function ProjectsSelect({
  label,
  projects,
  chosen,
  disabled = false,
  variant = 'ghost',
  className,
  onChange,
}: {
  label: string;
  projects: readonly ProjectChoice[];
  chosen: readonly string[];
  disabled?: boolean;
  variant?: 'ghost' | 'default';
  className?: string;
  onChange: (projectIds: string[]) => void;
}) {
  return (
    <Select<string, true>
      multiple
      value={[...chosen]}
      disabled={disabled || projects.length === 0}
      onValueChange={(value) => onChange(value as string[])}
    >
      <SelectTrigger
        aria-label={label}
        size='sm'
        variant={variant}
        className={cn('min-w-0 max-w-64', className)}
      >
        <SelectValue>{() => <PickedProjects projects={projects} chosen={chosen} />}</SelectValue>
      </SelectTrigger>
      <SelectContent align='end' alignItemWithTrigger={false}>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <ProjectOption color={project.color} name={project.name} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
