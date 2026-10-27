import { listCodeModes } from '@/lib/tasks/tabs.ts';
import { CodeTab } from '@/routes/task/code.tsx';
import { primeReview } from '../../lib/review-prime.ts';
import { createReviewTask } from '../../lib/review-scene.ts';
import { createHomeScene } from '../../lib/scene.ts';
import { DemoRoot, Window } from './frame.tsx';

const task = createReviewTask(Date.now());
const state = createHomeScene(Date.now());

await primeReview(task);

export function CodeDemo() {
  return (
    <DemoRoot>
      <Window state={state} route={{ name: 'task', reference: 'NW-155' }}>
        <div className='flex h-full min-h-0 flex-col'>
          <CodeTab task={task} modes={listCodeModes(task)} />
        </div>
      </Window>
    </DemoRoot>
  );
}
