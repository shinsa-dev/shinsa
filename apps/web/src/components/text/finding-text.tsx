import type { ReviewFinding, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { CHIP } from '@/components/layout/surface/card.ts';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { describeFindingPlace, SEVERITY_LABEL } from '@/lib/review/findings.ts';

export function FindingText({ finding, task = null }: { finding: ReviewFinding; task?: Task | null }) {
  const { severity } = finding;
  const where = describeFindingPlace(finding);
  const snippet =
    task?.repoId && finding.file && finding.line !== null
      ? { task, path: finding.file, line: finding.line }
      : null;
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-px text-xs'>
      <span className='flex min-w-0 items-center gap-1.5 text-2xs'>
        <span className={severity === 'blocking' ? 'text-red-text' : 'text-fg-2'}>
          {SEVERITY_LABEL[severity]}
        </span>
        {where && !snippet && <Truncate className={cn(CHIP, 'font-mono')}>{where}</Truncate>}
      </span>
      {finding.title && <InlineMarkdown text={finding.title} className='font-medium text-fg-4 leading-5' />}
      <Markdown text={finding.message} className={finding.title ? 'text-fg-3' : 'text-fg-4'} />
      {snippet && (
        <div className='mt-1.5'>
          <ChangeSnippet
            task={snippet.task}
            path={snippet.path}
            start={snippet.line}
            end={finding.end ?? snippet.line}
            startsOpen={severity === 'blocking'}
          />
        </div>
      )}
      {finding.fix && (
        <div className='corner-superellipse/1.125 mt-1.5 flex flex-col gap-1 rounded-lg bg-bg-a1 px-3 py-2'>
          <span className='flex items-center gap-1.5 text-2xs text-fg-2'>
            <Icon size='sm' name='IconBandage' />
            Suggested fix
          </span>
          <Markdown text={finding.fix} className='text-fg-4' />
        </div>
      )}
    </div>
  );
}
