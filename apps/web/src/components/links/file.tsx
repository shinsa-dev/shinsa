import type { Task } from '@shinsa/core';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import { InAppLink } from '@/components/links/link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { formatLineRange } from '@/lib/format/count.ts';
import { hasChanges } from '@/lib/tasks/tabs.ts';
import { resolveTaskPath } from '@/router.ts';

const FILE_CODE = 'rounded-sm bg-bg-a2 px-1 font-mono text-fg-4';

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
  if (!task?.repoId) return <code className={FILE_CODE}>{text}</code>;
  const changed = hasChanges(task);
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          <TooltipLabel>Open in Code</TooltipLabel> {path}
          {line !== null && <TooltipLabel> · {formatLineRange(line, end ?? line)}</TooltipLabel>}
        </span>
      }
    >
      <InAppLink
        path={resolveTaskPath(task, {
          tab: 'code',
          mode: changed ? 'changes' : 'files',
          file: path,
          diff: changed,
          line,
          end,
        })}
        className='group/link cursor-pointer no-underline outline-none'
      >
        <code
          className={cn(
            FILE_CODE,
            'underline decoration-transparent underline-offset-3 transition-colors duration-150 group-hover/link:decoration-fg-a3 group-active/link:decoration-fg-a3'
          )}
        >
          {text}
        </code>
      </InAppLink>
    </Hint>
  );
}
