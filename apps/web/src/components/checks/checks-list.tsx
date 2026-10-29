import type { Evidence } from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { OutputToggle } from '@/components/evidence/evidence-text.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoSection } from '@/components/overlays/info-popover.tsx';
import { CHECK_TEXT } from '@/components/status/check-mark.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { useEvidenceText } from '@/hooks/use-evidence-text.ts';
import { resolveTaskDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import {
  CHECK_STATE_LABEL,
  type CheckRow,
  type CheckStage,
  type CheckStageStatus,
  type CheckState,
  type ChecksView,
} from '@/lib/tasks/checks.ts';

const STATE_GLYPH: Record<Exclude<CheckState, 'running'>, { icon: IconName; className: string }> = {
  passed: { icon: 'IconCheckCircle2Filled', className: 'text-primary-4' },
  passed_alone: { icon: 'IconCheckCircle2Filled', className: 'text-primary-4' },
  failed: { icon: 'IconCircleXFilled', className: 'text-red-4' },
  fails_on_base: { icon: 'IconCircleXFilled', className: 'text-fg-2' },
  not_run: { icon: 'IconCircleDotted', className: 'text-fg-2' },
  skipped: { icon: 'IconCircleDotted', className: 'text-fg-2' },
  cancelled: { icon: 'IconCircleMinus', className: 'text-fg-2' },
  neutral: { icon: 'IconCircleMinus', className: 'text-fg-2' },
  action_required: { icon: 'IconExclamationCircleFilled', className: 'text-amber-4' },
};

const STATE_TEXT: Record<CheckState, string> = {
  passed: CHECK_TEXT,
  passed_alone: CHECK_TEXT,
  failed: 'text-red-text',
  fails_on_base: 'text-fg-2',
  running: 'text-primary-text',
  not_run: 'text-fg-2',
  skipped: 'text-fg-2',
  cancelled: 'text-fg-2',
  neutral: 'text-fg-2',
  action_required: 'text-amber-text',
};

const STATUS_TEXT: Record<CheckStageStatus, string> = {
  running: 'text-primary-text',
  failed: 'text-red-text',
  passed: CHECK_TEXT,
  partial: 'text-fg-2',
  idle: 'text-fg-2',
};

export function CheckStateIcon({ state }: { state: CheckState }) {
  const label = CHECK_STATE_LABEL[state];
  if (state === 'running') return <Spinner size='sm' aria-label={label} className='text-primary-4' />;
  const glyph = STATE_GLYPH[state];
  return <Icon name={glyph.icon} aria-label={label} size='sm' className={glyph.className} />;
}

function CheckGlyph({ state, className }: { state: CheckState; className?: string }) {
  return (
    <Hint label={<span className={STATE_TEXT[state]}>{CHECK_STATE_LABEL[state]}</span>}>
      <span className={cn('inline-grid h-4 shrink-0 place-items-center', className)}>
        <CheckStateIcon state={state} />
      </span>
    </Hint>
  );
}

function RowLabel({ row }: { row: CheckRow }) {
  if (!row.url) return <span className='wrap-anywhere text-fg-4 text-xs'>{row.label}</span>;
  return (
    <a
      href={row.url}
      target='_blank'
      rel='noreferrer'
      className='wrap-anywhere text-fg-4 text-xs underline-offset-2 hover:underline active:underline'
    >
      {row.label}
    </a>
  );
}

function CheckOutput({ evidence }: { evidence: Evidence }) {
  const text = useEvidenceText(evidence.uri);
  if (text === null) return <LoadingLine label='Reading the output' className='h-7 text-2xs' />;
  return <CodeFence code={text.trimEnd()} language={null} capped />;
}

function RowFacts({ row }: { row: CheckRow }) {
  return (
    <>
      {row.command && (
        <Truncate data-facts='' className='selectable min-w-0 font-mono text-2xs text-fg-3'>
          {row.command}
        </Truncate>
      )}
      {row.note && (
        <span data-facts='' className='text-2xs text-fg-3'>
          {row.note}
        </span>
      )}
      {row.detail && (
        <span
          data-facts=''
          className={cn(
            'selectable wrap-anywhere text-2xs',
            row.state === 'failed' ? 'text-red-text' : 'text-fg-3'
          )}
        >
          {row.detail}
        </span>
      )}
    </>
  );
}

export function CheckRowItem({
  taskId,
  row,
  children,
}: {
  taskId: string;
  row: CheckRow;
  children?: React.ReactNode;
}) {
  const { open, toggle } = useDisclosure(resolveTaskDisclosureId(taskId, 'checks', row.key, 'output'), false);
  return (
    <li className='flex min-w-0 flex-col gap-1.5 px-3 py-2'>
      <div className='group/check flex min-w-0 items-center gap-2 has-[[data-facts]]:items-start'>
        <CheckGlyph state={row.state} className='group-has-[[data-facts]]/check:mt-px' />
        <div className='flex min-w-0 flex-1 flex-col gap-px'>
          <span className='flex min-w-0 flex-wrap items-baseline gap-x-1.5'>
            <RowLabel row={row} />
            <span className='text-2xs text-fg-2'>{row.meta}</span>
          </span>
          <RowFacts row={row} />
          {children}
        </div>
        <span className='flex shrink-0 items-center gap-1'>
          {row.output && <OutputToggle open={open} onToggle={toggle} />}
          <span className={cn('text-2xs', STATE_TEXT[row.state])}>{CHECK_STATE_LABEL[row.state]}</span>
        </span>
      </div>
      {open && row.output && <CheckOutput evidence={row.output} />}
    </li>
  );
}

function StageHeader({ stage }: { stage: CheckStage }) {
  return (
    <h3 className='flex h-6 min-w-0 items-center gap-1.5 text-2xs'>
      <span className='font-medium text-fg-2'>{stage.title}</span>
      <span className={cn('tabular-nums', STATUS_TEXT[stage.status])}>{stage.summary}</span>
    </h3>
  );
}

export function ChecksBlock({
  taskId,
  view,
  className,
}: {
  taskId: string;
  view: ChecksView;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {view.stages.map((stage) => (
        <section key={stage.key} className='flex min-w-0 flex-col gap-1'>
          <StageHeader stage={stage} />
          {stage.rows.length > 0 && (
            <ul className={cn(INSET, 'flex min-w-0 flex-col divide-y divide-border')}>
              {stage.rows.map((row) => (
                <CheckRowItem key={row.key} taskId={taskId} row={row} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function PopoverRow({ row }: { row: CheckRow }) {
  return (
    <li className='flex min-w-0 items-start gap-2'>
      <CheckGlyph state={row.state} />
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className='text-fg-4 text-xs leading-4'>{row.label}</Truncate>
        <RowFacts row={row} />
      </span>
    </li>
  );
}

export function ChecksSections({ view }: { view: ChecksView }) {
  return view.stages.map((stage) => (
    <InfoSection
      key={stage.key}
      title={
        <>
          {stage.title}
          <span className={cn('font-normal tabular-nums', STATUS_TEXT[stage.status])}>{stage.summary}</span>
        </>
      }
    >
      {stage.rows.length > 0 && (
        <ul className='flex flex-col gap-1.5 px-3 pb-1.5'>
          {stage.rows.map((row) => (
            <PopoverRow key={row.key} row={row} />
          ))}
        </ul>
      )}
    </InfoSection>
  ));
}
