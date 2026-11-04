import type { MergeStepTiming, MergeStepView, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { ChecklistBlock, type ChecklistProps, ItemChecklist } from '@/components/controls/checklist.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { useReadOnly } from '@/components/task/read-only.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { DisclosurePersistId } from '@/lib/preferences/disclosure.ts';
import {
  isMergeWait,
  listTimedSteps,
  MERGE_STEP_ICON,
  MERGE_STEP_KIND,
  MERGE_STEP_TITLE,
  MERGE_WAIT_KIND,
  type MergeWaitView,
  type PreMergeItem,
  resolveTickBlock,
  resolveWaitBlock,
} from '@/lib/review/merge-steps.ts';

type StepTicker = (step: MergeStepView, done: boolean) => unknown;

interface MergeStepsProps {
  task: Task;
  when: MergeStepTiming;
  round?: number | null;
  waits?: MergeWaitView[];
  onTick?: StepTicker;
}

function StepKind({ item }: { item: PreMergeItem }) {
  const kind = isMergeWait(item) ? MERGE_WAIT_KIND[item.kind] : MERGE_STEP_KIND[item.kind];
  return (
    <>
      <Icon size='sm' name={kind.icon} aria-hidden className='shrink-0 text-fg-2' />
      {kind.label}
    </>
  );
}

function resolveChecklist(
  {
    task,
    when,
    round = null,
    waits = [],
    onTick = (step, done) =>
      sendCommandWithToast({ type: 'merge_step.tick', taskId: task.id, key: step.key, done }),
  }: MergeStepsProps,
  readOnly: boolean
): ChecklistProps<PreMergeItem> {
  return {
    items: [...listTimedSteps(task, when, round), ...(when === 'pre_merge' ? waits : [])],
    ...(readOnly
      ? {}
      : {
          onTick: (item: PreMergeItem, done: boolean) => (isMergeWait(item) ? undefined : onTick(item, done)),
        }),
    describeBlock: (item) => (isMergeWait(item) ? resolveWaitBlock(item) : resolveTickBlock(task, item)),
    meta: (item) => <StepKind item={item} />,
  };
}

export function MergeStepsBlock(props: MergeStepsProps) {
  const readOnly = useReadOnly();
  return <ChecklistBlock title={MERGE_STEP_TITLE[props.when]} {...resolveChecklist(props, readOnly)} />;
}

export function MergeStepsPanel({
  persistId,
  note = null,
  ...props
}: MergeStepsProps & { persistId: DisclosurePersistId; note?: string | null }) {
  const readOnly = useReadOnly();
  const checklist = resolveChecklist(props, readOnly);
  return (
    <Panel
      persistId={persistId}
      title={MERGE_STEP_TITLE[props.when]}
      icon={MERGE_STEP_ICON[props.when]}
      count={checklist.items.length}
    >
      {note && <p className='text-xs text-fg-3'>{note}</p>}
      <ItemChecklist {...checklist} />
    </Panel>
  );
}
