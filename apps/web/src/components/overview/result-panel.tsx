import type { Task } from '@shinsa/core';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { RESULT_PANEL } from '@/lib/tasks/shapes.ts';

export function ResultPanel({ task }: { task: Task }) {
  if (!task.result) return null;
  const panel = RESULT_PANEL[task.result.step];
  return (
    <Panel title={panel.title} icon={panel.icon}>
      <Markdown text={task.result.body} className='text-fg-4' />
    </Panel>
  );
}
