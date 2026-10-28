import {
  type Coverage,
  type CoverageFile,
  type ManualTestStep,
  type ReportTesting,
  selectMeasuredCoverage,
  type Task,
} from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { ChecksBlock } from '@/components/checks/checks-list.tsx';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { FileLink } from '@/components/links/file.tsx';
import { GlyphLabel, InlineMark, SMART_LINK } from '@/components/links/link.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import {
  describeCoverageSummary,
  describeFileCoverage,
  describeFilesToggle,
  describeRangeLabel,
  isFileCovered,
} from '@/lib/coverage.ts';
import { type DisclosurePersistId, extendDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import { REVIEW_PROSE_ICON, REVIEW_PROSE_TITLE } from '@/lib/review/report.ts';
import { resolveTestTarget } from '@/lib/review/testing.ts';
import type { ChecksView } from '@/lib/tasks/checks.ts';

const PART_LABEL = 'text-2xs text-fg-2';

const PROSE = 'text-fg-4 text-xs';

function TestTarget({ task, step }: { task: Task; step: ManualTestStep }) {
  const view = resolveTestTarget(step.target);
  if (!view) return null;
  switch (view.kind) {
    case 'link':
      return (
        <span className='text-xs'>
          <a data-smart href={view.href} target='_blank' rel='noreferrer' className={SMART_LINK}>
            <GlyphLabel glyph={<InlineMark icon='IconGlobe' />} text={view.href} />
          </a>
        </span>
      );
    case 'file':
      return (
        <span className='text-xs'>
          <FileLink task={task} path={view.path} line={view.line} end={view.end} />
        </span>
      );
    case 'command':
      return (
        <div>
          <CodeFence code={view.command} language='sh' runnable />
        </div>
      );
    case 'text':
      return (
        <span className='flex min-w-0 items-center gap-1.5 text-fg-3 text-xs'>
          <Icon size='sm' name={view.icon} className='shrink-0' />
          {view.text}
        </span>
      );
  }
}

function ManualStep({ task, step, index }: { task: Task; step: ManualTestStep; index: number }) {
  return (
    <li className='flex gap-2.5'>
      <StepNumber index={index} />
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <Markdown text={step.action} className={PROSE} />
        <TestTarget task={task} step={step} />
        <div className='flex flex-col gap-px'>
          <span className={PART_LABEL}>You should see</span>
          <Markdown text={step.expect} className={PROSE} />
        </div>
      </div>
    </li>
  );
}

function CoverageFileRow({ task, file }: { task: Task; file: CoverageFile }) {
  return (
    <li className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs'>
      <FileLink task={task} path={file.path} />
      <span className='text-fg-2 tabular-nums'>{describeFileCoverage(file)}</span>
      {!isFileCovered(file) && (
        <span className='flex flex-wrap items-baseline gap-1.5 text-fg-2'>
          <span>Not covered:</span>
          {file.uncovered.map(([start, end]) => (
            <FileLink
              key={start}
              task={task}
              path={file.path}
              line={start}
              end={end}
              label={describeRangeLabel([start, end])}
            />
          ))}
        </span>
      )}
    </li>
  );
}

function CoverageLines({
  persistId,
  task,
  coverage,
}: {
  persistId: DisclosurePersistId;
  task: Task;
  coverage: Coverage | null | undefined;
}) {
  const disclosure = useDisclosure(persistId, false);
  const { open } = disclosure;
  const measured = selectMeasuredCoverage(coverage);
  if (!measured) return null;
  return (
    <div className='flex flex-col gap-1.5'>
      <p className='text-fg-2 text-xs'>{describeCoverageSummary(measured)}.</p>
      {measured.files.length > 0 && (
        <DisclosureHeader
          disclosure={disclosure}
          strip='line'
          chevron='glyph'
          className='w-fit gap-1 text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
        >
          {describeFilesToggle(measured, open)}
        </DisclosureHeader>
      )}
      {open && (
        <ul className='flex flex-col gap-1.5 pl-4.5'>
          {measured.files.map((file) => (
            <CoverageFileRow key={file.path} task={task} file={file} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TestingPanel({
  persistId,
  task,
  testing,
  checks,
  coverage = null,
}: {
  persistId: DisclosurePersistId;
  task: Task;
  testing: ReportTesting | null;
  checks: ChecksView | null;
  coverage?: Coverage | null;
}) {
  const automated = testing?.automated ?? [];
  const manual = testing?.manual ?? [];
  const measured = selectMeasuredCoverage(coverage) !== null;
  return (
    <Panel persistId={persistId} title={REVIEW_PROSE_TITLE.testing} icon={REVIEW_PROSE_ICON.testing}>
      {(automated.length > 0 || checks || measured) && (
        <div className='flex flex-col gap-1.5'>
          <span className={PART_LABEL}>Covered by tests</span>
          {automated.map((line) => (
            <Markdown key={line} text={line} className={PROSE} />
          ))}
          {checks && <ChecksBlock taskId={task.id} view={checks} />}
          <CoverageLines
            persistId={extendDisclosureId(persistId, 'coverage')}
            task={task}
            coverage={coverage}
          />
        </div>
      )}
      {manual.length > 0 && (
        <div className='flex flex-col gap-2'>
          <span className={PART_LABEL}>Try it yourself</span>
          <ol className='flex flex-col gap-3'>
            {manual.map((step, index) => (
              <ManualStep
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
                key={index}
                task={task}
                step={step}
                index={index}
              />
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}
