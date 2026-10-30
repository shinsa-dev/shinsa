import type { MergeStepTiming, MergeStepView, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { ChecklistBlock, type ChecklistProps, ItemChecklist } from '@/components/controls/checklist.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { DisclosurePersistId } from '@/lib/preferences/disclosure.ts';
import {
  isMergeWait,
  listTimedSteps,
  MERGE_STEP_ICON,
  MERGE_STEP_KIND,
  MERGE_STEP_TITLE,
  type MergeWaitView,
  type PreMergeItem,
  resolveTickBlock,
  resolveWaitBlock,
} from '@/lib/review/merge-steps.ts';

type StepTicker = (step: MergeStepView, done: boolean) => unknown;

interface MergeStepsProps {
  task: Task;
  when: MergeStepTiming;
  waits?: MergeWaitView[];
  onTick?: StepTicker;
}

function StepKind({ item }: { item: PreMergeItem }) {
  const kind = isMergeWait(item)
    ? { icon: 'IconHourglass' as const, label: 'Linked task' }
    : MERGE_STEP_KIND[item.kind];
  return (
    <>
      <Icon size='sm' name={kind.icon} aria-hidden className='shrink-0 text-fg-2' />
      {kind.label}
    </>
  );
}

function resolveChecklist({
  task,
  when,
  waits = [],
  onTick = (step, done) =>
    sendCommandWithToast({ type: 'merge_step.tick', taskId: task.id, key: step.key, done }),
}: MergeStepsProps): ChecklistProps<PreMergeItem> {
  return {
    items: [...listTimedSteps(task, when), ...(when === 'pre_merge' ? waits : [])],
    onTick: (item, done) => (isMergeWait(item) ? undefined : onTick(item, done)),
    describeBlock: (item) => (isMergeWait(item) ? resolveWaitBlock(item) : resolveTickBlock(task, item)),
    meta: (item) => <StepKind item={item} />,
  };
}

export function MergeStepsBlock(props: MergeStepsProps) {
  return <ChecklistBlock title={MERGE_STEP_TITLE[props.when]} {...resolveChecklist(props)} />;
}

export function MergeStepsPanel({
  persistId,
  ...props
}: MergeStepsProps & { persistId: DisclosurePersistId }) {
  const checklist = resolveChecklist(props);
  return (
    <Panel
      persistId={persistId}
      title={MERGE_STEP_TITLE[props.when]}
      icon={MERGE_STEP_ICON[props.when]}
      count={checklist.items.length}
    >
      <ItemChecklist {...checklist} />
    </Panel>
  );
}
