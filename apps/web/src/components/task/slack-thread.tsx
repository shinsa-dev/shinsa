import { resolveSlackThreadUrl, type Task } from '@shinsa/core';
import { HintButton } from '@/components/controls/hint-button.tsx';

export function TaskSlackThread({ task }: { task: Task }) {
  if (!task.slack) return null;
  return (
    <HintButton
      size='icon-sm'
      label='Open the Slack thread'
      icon='IconSlack'
      nativeButton={false}
      render={<a href={resolveSlackThreadUrl(task.slack)} target='_blank' rel='noreferrer' />}
    />
  );
}
