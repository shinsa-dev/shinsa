import type { Task } from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Hint } from '@/components/overlays/hint.tsx';
import { useMachine } from '@/lib/connection/socket.ts';
import { isTaskShared, SHARED_MARK_LABEL } from '@/lib/share/dialog.ts';
import { describeHandoffMark, HANDOFF_ICON, isTaskHandedOff } from '@/lib/share/handoff.ts';

function Mark({ label, icon }: { label: string; icon: IconName }) {
  return (
    <Hint label={label}>
      <span
        role='img'
        aria-label={label}
        className='inline-flex shrink-0 -translate-y-[0.5px] text-primary-text'
      >
        <Icon size='sm' name={icon} />
      </span>
    </Hint>
  );
}

function HandoffMark({ task }: { task: Task }) {
  const machine = useMachine(task.id);
  return <Mark label={describeHandoffMark(task, machine?.handedBy ?? null)} icon={HANDOFF_ICON} />;
}

export function SharedMark({ task }: { task: Task }) {
  return (
    <>
      {isTaskShared(task) && <Mark label={SHARED_MARK_LABEL} icon='IconLiveFull' />}
      {isTaskHandedOff(task) && <HandoffMark task={task} />}
    </>
  );
}
