import type { Task } from '@shinsa/core';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import { InAppLink } from '@/components/links/link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useTaskDiff } from '@/lib/connection/files.ts';
import { formatLineRange } from '@/lib/format/count.ts';
import { resolveTaskPath } from '@/router.ts';

const FILE_CODE = 'rounded-sm bg-bg-a2 px-1 font-mono text-fg-4';

function ChangedFileLink({
  task,
  path,
  line,
  end,
  label,
}: {
  task: Task;
  path: string;
  line: number | null;
  end: number | null;
  label: string;
}) {
  const loaded = useTaskDiff(task.id, task.updatedAt);
  const changed = loaded.status === 'ready' && loaded.value.files.some((file) => file.path === path);
  if (!changed) return <code className={FILE_CODE}>{label}</code>;
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          <TooltipLabel>Open in changes</TooltipLabel> {path}
          {line !== null && <TooltipLabel> · {formatLineRange(line, end ?? line)}</TooltipLabel>}
        </span>
      }
    >
      <InAppLink
        path={resolveTaskPath(task, { tab: 'code', view: 'changes', file: path })}
        className='group/link cursor-pointer no-underline outline-none'
      >
        <code
          className={cn(
            FILE_CODE,
            'underline decoration-transparent underline-offset-3 transition-colors duration-150 group-hover/link:decoration-fg-a3 group-active/link:decoration-fg-a3'
          )}
        >
          {label}
        </code>
      </InAppLink>
    </Hint>
  );
}

export function FileLink({
  task,
  path,
  line = null,
  end = null,
  label,
}: {
  task: Task | null;
  path: string;
  line?: number | null;
  end?: number | null;
  label?: string;
}) {
  const text = label?.trim() || path;
  if (!task?.branch) return <code className={FILE_CODE}>{text}</code>;
  return <ChangedFileLink task={task} path={path} line={line} end={end} label={text} />;
}
