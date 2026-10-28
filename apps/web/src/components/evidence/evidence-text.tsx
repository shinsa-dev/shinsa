import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ReviewMark, UpdatedMark } from '@/components/evidence/evidence-figure.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { useEvidenceText } from '@/hooks/use-evidence-text.ts';
import type { EvidenceView } from '@/lib/evidence/layout.ts';
import { describeRunToggle, type EvidenceRun, isRunEvidence, listEvidenceRuns } from '@/lib/evidence/runs.ts';
import { resolveTaskDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';

const OUTCOME_TEXT = { pass: 'Passed', fail: 'Failed' } as const;

function RunRow({ run }: { run: EvidenceRun }) {
  return (
    <li className='flex min-h-8 min-w-0 items-center gap-2 px-3 py-1.5'>
      {run.outcome ? (
        <CheckOutcomeIcon outcome={run.outcome} />
      ) : (
        <Icon size='sm' name='IconConsole' className='shrink-0 text-fg-2' />
      )}
      <Truncate className='min-w-0 flex-1 font-mono text-2xs text-fg-4'>{run.command}</Truncate>
      {run.outcome && (
        <span
          className={cn(
            'shrink-0 text-2xs tabular-nums',
            run.outcome === 'fail' ? 'text-red-text' : 'text-fg-2'
          )}
        >
          {run.counts ?? OUTCOME_TEXT[run.outcome]}
        </span>
      )}
    </li>
  );
}

function RunList({ runs }: { runs: EvidenceRun[] }) {
  return (
    <ul className={cn(INSET, 'flex flex-col divide-y divide-border')}>
      {runs.map((run, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a command can run twice, so a run is its place
        <RunRow key={index} run={run} />
      ))}
    </ul>
  );
}

export function OutputToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant='secondary'
      size='xs'
      className='ms-auto'
      aria-expanded={open}
      onClick={onToggle}
      icon={{
        name: 'IconChevronDownSmall',
        position: 'inline-end',
        className: cn('transition-disclosure', open && 'rotate-180'),
      }}
    >
      {describeRunToggle(open)}
    </Button>
  );
}

function NoteBody({ text }: { text: string }) {
  return (
    <div className={cn(INSET, 'min-w-0 px-3.5 py-2.5')}>
      <Markdown text={text} className='text-fg-4 text-xs' />
    </div>
  );
}

export function EvidenceText({ view }: { view: EvidenceView }) {
  const { evidence } = view;
  const text = useEvidenceText(evidence.uri);
  const note = evidence.kind === 'note';
  const { open, toggle } = useDisclosure(
    resolveTaskDisclosureId(evidence.taskId, 'evidence', evidence.id, 'output'),
    false
  );
  const runs = React.useMemo(
    () => (text !== null && isRunEvidence(evidence.kind) ? listEvidenceRuns(text) : []),
    [text, evidence.kind]
  );
  const ran = runs.length > 0;
  return (
    <figure className='flex min-w-0 flex-col gap-1.5'>
      <figcaption className='flex min-w-0 flex-col gap-px'>
        <span className='flex min-h-5.5 min-w-0 items-center gap-1.5'>
          <Icon size='sm' name={note ? 'IconNote1' : 'IconConsole'} className='shrink-0 text-fg-2' />
          <span className='wrap-anywhere min-w-0 font-medium text-fg-4 text-xs'>{evidence.title}</span>
          {view.fromReview && <ReviewMark />}
          {view.updated && <UpdatedMark text={view.updated} />}
          {ran && <OutputToggle open={open} onToggle={toggle} />}
        </span>
        {evidence.detail && <span className='text-2xs text-fg-3'>{evidence.detail}</span>}
      </figcaption>
      {text === null && <LoadingLine label='Reading the evidence' className='h-9 px-3.5 text-2xs' />}
      {ran && <RunList runs={runs} />}
      {text !== null && note && <NoteBody text={text} />}
      {text !== null && !note && (!ran || open) && <CodeFence code={text.trimEnd()} language={null} capped />}
    </figure>
  );
}
