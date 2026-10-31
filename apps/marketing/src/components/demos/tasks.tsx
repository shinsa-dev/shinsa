import * as React from 'react';
import { TasksPage } from '@/routes/tasks.tsx';
import { createHomeScene } from '../../lib/scene.ts';
import { DemoRoot, Window } from './frame.tsx';

export function TasksDemo() {
  const [state] = React.useState(() => createHomeScene(Date.now()));
  return (
    <DemoRoot>
      <Window state={state} route={{ name: 'tasks' }} inert>
        <TasksPage state={state} />
      </Window>
    </DemoRoot>
  );
}
