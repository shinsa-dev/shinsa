import type { ReviewFinding, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CHIP } from '@/components/layout/surface/card.ts';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { FindingNote } from '@/components/text/finding-note.tsx';
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
    <FindingNote
      label={SEVERITY_LABEL[severity]}
      tone={SEVERITY_TONE[severity]}
      place={where && !snippet && <Truncate className={cn(CHIP, 'font-mono')}>{where}</Truncate>}
      body={finding.message}
      fix={finding.fix}
      action={action}
    >
      {snippet && (
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
      )}
    </FindingNote>
  );
}
