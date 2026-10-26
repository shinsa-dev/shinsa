import { ReviewTab } from '@/routes/task/review.tsx';
import { primeReview } from '../../lib/review-prime.ts';
import { createTintState, TINT_TITLE } from '../../lib/tint-scene.ts';
import { DemoRoot, Window } from './frame.tsx';
import { useLiveElements } from './live.ts';

const { state, task } = createTintState(Date.now());

await primeReview(task);

function listReviewParts(root: HTMLElement) {
  const evidence = [...root.querySelectorAll('section')].filter((section) =>
    section.textContent?.startsWith('Evidence')
  );
  return [...root.querySelectorAll('[aria-label="Every point"]'), ...evidence];
}

export function ReviewDemo() {
  const ref = useLiveElements<HTMLDivElement>(listReviewParts);
  return (
    <DemoRoot>
      <div ref={ref} className='demo-static demo-scroll h-full'>
        <Window title={`SW-214 · ${TINT_TITLE} · Review`}>
          <div className='flex h-full min-h-0 flex-col'>
            <ReviewTab state={state} task={task} />
          </div>
        </Window>
      </div>
    </DemoRoot>
  );
}
