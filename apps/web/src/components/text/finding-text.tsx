import type { ReviewFinding, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CHIP } from '@/components/layout/surface/card.ts';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { SuggestedFix } from '@/components/text/inset-note.tsx';
import { NoteHead } from '@/components/text/note-head.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { hashDisclosurePart, resolveTaskDisclosureId } from '@/lib/preferences/disclosure.ts';
import {
  describeFindingPlace,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  SEVERITY_VERDICT,
} from '@/lib/review/findings.ts';

export function FindingText({
  finding,
  task = null,
  action = null,
}: {
  finding: ReviewFinding;
  task?: Task | null;
  action?: React.ReactNode;
}) {
  const { severity } = finding;
  const where = describeFindingPlace(finding);
  const snippet =
    task?.repoId && finding.file && finding.line !== null
      ? { task, path: finding.file, line: finding.line }
      : null;
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-px text-xs'>
      <NoteHead
        label={
          <>
            <span className={TONE_TEXT[SEVERITY_TONE[severity]]}>{SEVERITY_LABEL[severity]}</span>
            {where && !snippet && <Truncate className={cn(CHIP, 'font-mono')}>{where}</Truncate>}
          </>
        }
        title={finding.title}
        body={finding.message}
        action={action}
      />
      {snippet && (
        <div className='mt-1.5'>
          <ChangeSnippet
            persistId={resolveTaskDisclosureId(
              snippet.task.id,
              'finding',
              hashDisclosurePart([snippet.path, snippet.line, finding.message].join('\n')),
              'snippet'
            )}
            task={snippet.task}
            path={snippet.path}
            start={snippet.line}
            end={finding.end ?? snippet.line}
            startsOpen={SEVERITY_VERDICT[severity] === 'fix'}
          />
        </div>
      )}
      {finding.fix && (
        <div className='mt-1.5'>
          <SuggestedFix text={finding.fix} />
        </div>
      )}
    </div>
  );
}
