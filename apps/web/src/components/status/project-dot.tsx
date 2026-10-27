import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import type { ProjectLabelView } from '@/lib/projects.ts';

export function ProjectDot({
  color,
  label,
  className,
}: {
  color: string;
  label?: string;
  className?: string;
}) {
  const dot = (
    <span
      aria-hidden
      data-project-dot={color}
      className={cn('size-2 shrink-0 rounded-full', className)}
      style={{ background: color === 'gray' ? 'var(--fg-2)' : `var(--${color}-4, var(--fg-2))` }}
    />
  );
  if (!label) return dot;
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          {label} <TooltipLabel>project</TooltipLabel>
        </span>
      }
    >
      {dot}
    </Hint>
  );
}

export function ProjectDotIcon({ color }: { color: string }) {
  return (
    <span className='grid size-3.5 shrink-0 place-items-center'>
      <ProjectDot color={color} />
    </span>
  );
}

export function ProjectOption({ color, name }: { color: string; name: string }) {
  return (
    <>
      <ProjectDotIcon color={color} />
      <span className='truncate'>{name}</span>
    </>
  );
}

export function ProjectLabel({ label, className }: { label: ProjectLabelView; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <ProjectDotIcon color={label.color} />
      <Truncate>
        {label.name}
        {label.repo && <span className='text-fg-2'> · {label.repo}</span>}
      </Truncate>
    </span>
  );
}
