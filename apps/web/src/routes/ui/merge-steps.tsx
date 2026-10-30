import type { MergeStepView, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { PostMergeCard } from '@/components/overview/merge-steps-card.tsx';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { MergeStepsBlock, MergeStepsPanel } from '@/components/review/merge-steps.tsx';
import { TestingPanel } from '@/components/review/testing.tsx';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeMergeBlock, type MergeWaitView } from '@/lib/review/merge-steps.ts';
import { SAMPLE_EVIDENCE_CHECKS } from './sample-evidence.ts';
import { createMergeStepTasks, FULL_COVERAGE, PARTIAL_COVERAGE, TESTING } from './sample-merge-steps.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

function useTicks(initial: Task) {
  const [task, setTask] = React.useState(initial);
  const tick = (step: MergeStepView, done: boolean) => {
    setTask((current) => {
      const others = (current.mergeStepsDone ?? []).filter((key) => key !== step.key);
      return { ...current, mergeStepsDone: done ? [...others, step.key] : others };
    });
    return Promise.resolve(true);
  };
  return { task, tick };
}

function MergeGate({ state, initial }: { state: ShinsaState; initial: Task }) {
  const { task, tick } = useTicks(initial);
  const blocked = describeMergeBlock(task);
  const merge = (
    <Button size='sm' icon='IconMerged' disabled={blocked !== null} onClick={() => void acknowledgeSample()}>
      Merge #{task.pullRequest?.number}
    </Button>
  );
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} />}
      title='The pull request is ready to merge'
      action={
        <>
          <Button variant='outline' size='sm' onClick={() => void acknowledgeSample()}>
            Review
          </Button>
          {blocked ? (
            <Hint label={blocked}>
              <span className='flex w-fit'>{merge}</span>
            </Hint>
          ) : (
            merge
          )}
        </>
      }
    >
      <p className='text-fg-3 text-xs'>All 6 checks passed on GitHub and nothing is unresolved.</p>
      <MergeStepsBlock task={task} when='pre_merge' onTick={tick} />
    </NowFrame>
  );
}

function PostMerge({ state, initial }: { state: ShinsaState; initial: Task }) {
  const { task, tick } = useTicks(initial);
  return <PostMergeCard state={state} task={task} onTick={tick} />;
}

const SAMPLE_WAITS: MergeWaitView[] = [
  {
    key: 'wait:docs',
    taskId: 'sample-docs',
    title: 'Merges after [Document the agent login](shinsa://task/sample-docs) finishes',
    detail: null,
    command: null,
    done: false,
  },
  {
    key: 'wait:skills',
    taskId: 'sample-skills',
    title: 'Merges after [Teach the skill to log in](shinsa://task/sample-skills) finishes',
    detail: null,
    command: null,
    done: true,
  },
];

function ReviewPanels({ initial }: { initial: Task }) {
  const { task, tick } = useTicks(initial);
  return (
    <>
      <MergeStepsPanel
        persistId={createDisclosureId('ui', 'merge-steps', 'panel', 'pre_merge')}
        task={task}
        when='pre_merge'
        waits={SAMPLE_WAITS}
        onTick={tick}
      />
      <MergeStepsPanel
        persistId={createDisclosureId('ui', 'merge-steps', 'panel', 'post_merge')}
        task={task}
        when='post_merge'
        onTick={tick}
      />
    </>
  );
}

export function MergeStepSpecimens({ state }: { state: ShinsaState }) {
  const [tasks] = React.useState(() => createMergeStepTasks(Date.now()));
  const scene = {
    ...state,
    tasks: { ...state.tasks, [tasks.gate.id]: tasks.gate, [tasks.merged.id]: tasks.merged },
  };
  return (
    <>
      <Specimen label='Merge gate · Pre-merge as a checklist; Merge waits, its tooltip saying why, until each is ticked'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          <MergeGate state={scene} initial={tasks.gate} />
        </div>
      </Specimen>
      <Specimen label='PostMergeCard · a merged task with a step left; a step with a command runs in a terminal'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          <PostMerge state={scene} initial={tasks.merged} />
        </div>
      </Specimen>
      <Specimen label='TestingPanel · the Review tab’s How to test: what the tests cover, the Checks list, the changed-line coverage and its files behind a toggle, then the steps to try yourself, each with its target (a command to copy or run, a link to open, a screen, a file in Code) and what you should see'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          <TestingPanel
            persistId={createDisclosureId('ui', 'testing', 'guided')}
            task={tasks.gate}
            testing={TESTING}
            checks={SAMPLE_EVIDENCE_CHECKS}
            coverage={PARTIAL_COVERAGE}
          />
        </div>
      </Specimen>
      <Specimen label='TestingPanel · no guide from the agent, every changed line covered: the checks and the coverage alone'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          <TestingPanel
            persistId={createDisclosureId('ui', 'testing', 'checks-only')}
            task={tasks.gate}
            testing={null}
            checks={SAMPLE_EVIDENCE_CHECKS}
            coverage={FULL_COVERAGE}
          />
        </div>
      </Specimen>
      <Specimen label='MergeStepsPanel · the Review tab’s Pre-merge and Post-merge, in How it’s built; a task the merge waits on is a linked row that ticks itself once it finishes'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          <ReviewPanels initial={tasks.gate} />
        </div>
      </Specimen>
    </>
  );
}
