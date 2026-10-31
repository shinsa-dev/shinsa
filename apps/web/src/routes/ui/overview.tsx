import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { DelegationsPanel } from '@/components/overview/delegations-panel.tsx';
import { FindingVerdicts } from '@/components/overview/finding-verdicts.tsx';
import {
  ChangeCard,
  PausedCard,
  PlanCard,
  QuestionCard,
  ResultCard,
} from '@/components/overview/now-card.tsx';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { OperationCard } from '@/components/overview/operation-card.tsx';
import { TaskTrack } from '@/components/overview/progress-track.tsx';
import { ResultPanel } from '@/components/overview/result-panel.tsx';
import { SecretCard } from '@/components/overview/secret-card.tsx';
import { SetupCard } from '@/components/overview/setup-card.tsx';
import { SignInCard } from '@/components/overview/sign-in-card.tsx';
import { SilenceNote } from '@/components/overview/silence-note.tsx';
import { SuggestionsPanel } from '@/components/overview/suggestions-panel.tsx';
import { UsageWaitCard } from '@/components/overview/usage-wait-card.tsx';
import { WaitCard } from '@/components/overview/wait-card.tsx';
import { TaskFacts } from '@/components/task/facts.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { resolveNowTitle } from '@/lib/overview/now.ts';
import {
  describeEscalationBody,
  describeReviewTitle,
  resolveVerdictAction,
  resolveVerdictDraft,
} from '@/lib/overview/verdicts.ts';
import { MergeStepSpecimens } from './merge-steps.tsx';
import { createOverviewScene } from './sample-overview.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

function Card({ children }: { children: React.ReactNode }) {
  return <div className='flex w-full max-w-xl flex-col gap-2'>{children}</div>;
}

function EscalatedReview({ state, task, gate }: { state: ShinsaState; task: Task; gate: Gate }) {
  const draft = useReviewDraft();
  const action = resolveVerdictAction(task.findings, resolveVerdictDraft(task.findings, draft.verdicts));
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} />}
      title={describeReviewTitle(gate)}
      action={
        <>
          <Button variant='outline' size='sm' onClick={() => void acknowledgeSample()}>
            Review
          </Button>
          <Button size='sm' onClick={() => void acknowledgeSample()}>
            {action.label}
          </Button>
        </>
      }
    >
      {gate.escalation && <p className='text-fg-3 text-xs'>{describeEscalationBody(gate.escalation)}</p>}
      <FindingVerdicts task={task} findings={task.findings} />
    </NowFrame>
  );
}

export function OverviewSpecimens() {
  const [now] = React.useState(Date.now);
  const [{ state, tasks, gates, runs, usageWaits, monitor, results }] = React.useState(() =>
    createOverviewScene(now)
  );
  const ignore = () => undefined;
  return (
    <>
      <Specimen label='SetupCard · setup incomplete, only checks missing'>
        <Card>
          <SetupCard state={state} task={tasks.setup} gate={gates.setup} onReply={acknowledgeSample} />
        </Card>
      </Specimen>
      <Specimen label='SignInCard · sign in needed'>
        <Card>
          <SignInCard
            state={state}
            task={tasks.signIn}
            gate={gates.signIn}
            onReply={acknowledgeSample}
            onSignIn={() => void acknowledgeSample()}
          />
        </Card>
      </Specimen>
      <Specimen label='SignInCard · a provider with a sign-in of its own (Codex): check the sign-in again, never sign in from Shinsa'>
        <Card>
          <SignInCard
            state={state}
            task={tasks.signIn}
            gate={{
              ...gates.signIn,
              title: 'Paused: christo@openai.example needs signing in',
              body: 'Codex signed this account out, so the agent stopped. Signing in starts the step again.',
              provider: 'codex',
              account: null,
            }}
            onReply={acknowledgeSample}
            onCheck={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='UsageWaitCard · resumes automatically · waits for you'>
        <Card>
          {usageWaits.map(({ task, wait }) => (
            <UsageWaitCard
              key={task.id}
              state={state}
              task={task}
              wait={wait}
              onResume={acknowledgeSample}
              onToggle={acknowledgeSample}
            />
          ))}
        </Card>
      </Specimen>
      <Specimen label='WaitCard · waiting to check in again'>
        <Card>
          <WaitCard state={state} task={tasks.monitor} monitor={monitor} onCheck={acknowledgeSample} />
        </Card>
      </Specimen>
      <Specimen label='SecretCard · the agent asked for a secret'>
        <Card>
          <SecretCard
            state={state}
            task={tasks.secret}
            gate={gates.secret}
            onSave={acknowledgeSample}
            onDecline={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='TaskFacts · the cost as its icon and value, the details in its popover, the one place a task’s cost shows, in the task’s unit: its share of the weekly limit on a subscription, past its limit · dollars on an API key'>
        <Card>
          <TaskFacts state={state} task={tasks.budget} />
          <TaskFacts state={state} task={tasks.keyed} />
        </Card>
      </Specimen>
      <Specimen label='PausedCard · a failure · a usage limit · a wait that ran out of checks'>
        <Card>
          {(['failure', 'budget', 'ranOut'] as const).map((key) => (
            <PausedCard
              key={key}
              state={state}
              task={tasks[key]}
              gate={gates[key]}
              onOpen={ignore}
              onReply={acknowledgeSample}
            />
          ))}
        </Card>
      </Specimen>
      <Specimen label='NowCard · the agent resolving conflicts with main on a pull request that conflicts'>
        <Card>
          <NowFrame
            eyebrow={<Eyebrow state={state} task={tasks.conflict} />}
            title={resolveNowTitle(tasks.conflict, [], null, runs.conflict)}
            footer={<TaskTrack task={tasks.conflict} />}
          />
        </Card>
      </Specimen>
      <Specimen label='NowCard · a task cancelled at the merge: the steps it finished stay done, the merge shows Cancelled'>
        <Card>
          <NowFrame
            eyebrow={<Eyebrow state={state} task={tasks.closed} />}
            title={resolveNowTitle(tasks.closed, [], null, undefined)}
            footer={<TaskTrack task={tasks.closed} />}
          />
        </Card>
      </Specimen>
      <Specimen label='SilenceNote · no output for 5 minutes · orange from 15'>
        <Card>
          <SilenceNote
            state={state}
            run={runs.quietShort}
            onSnooze={acknowledgeSample}
            onDismiss={acknowledgeSample}
          />
          <SilenceNote
            state={state}
            run={runs.quietLong}
            onSnooze={acknowledgeSample}
            onDismiss={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='QuestionCard · question choices, the recommended one marked'>
        <Card>
          <QuestionCard
            state={state}
            task={tasks.question}
            gate={gates.question}
            onReply={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='QuestionCard · a command the agent asks you to run, with Run in terminal'>
        <Card>
          <QuestionCard
            state={state}
            task={tasks.question}
            gate={gates.command}
            onReply={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='FindingVerdicts · an escalated review; the primary action follows the verdicts'>
        <Card>
          <ReviewDraftProvider enabled draftKey='ui-escalated-review'>
            <EscalatedReview state={state} task={tasks.review} gate={gates.review} />
          </ReviewDraftProvider>
        </Card>
      </Specimen>
      <Specimen label='PlanCard · a revised plan: what you asked on its own inset, what changed above the goal, its new and reworked phases tagged'>
        <Card>
          <PlanCard
            state={state}
            task={tasks.plan}
            gate={gates.plan}
            onOpen={ignore}
            onReply={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='PlanCard · evidence, extra checks, impact and the operation after the merge; the agent asked for your approval'>
        <Card>
          <PlanCard
            state={state}
            task={tasks.planned}
            gate={gates.planned}
            onOpen={ignore}
            onReply={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='OperationCard · the change merged; confirm the operation on the merged commit'>
        <Card>
          <OperationCard
            state={state}
            task={tasks.operation}
            gate={gates.operation}
            onReply={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <Specimen label='ChangeCard · an investigation proposes a fix, with its diagnosis inside the card'>
        <Card>
          <ChangeCard state={state} task={tasks.change} gate={gates.change} onReply={acknowledgeSample} />
        </Card>
      </Specimen>
      <Specimen label='ChangeCard · your OK in steps the agent composed, before an operation'>
        <Card>
          <ChangeCard state={state} task={tasks.composed} gate={gates.composed} onReply={acknowledgeSample} />
        </Card>
      </Specimen>
      <Specimen label='ResultCard · a finished answer, report, diagnosis or outcome, shown in the now card'>
        <Card>
          {results.map((task) => (
            <ResultCard key={task.id} state={state} task={task} onOpen={acknowledgeSample} />
          ))}
        </Card>
      </Specimen>
      <Specimen label='ResultPanel · a diagnosis kept under the work it led to'>
        <Card>
          <ResultPanel task={tasks.change} />
        </Card>
      </Specimen>
      <Specimen label='TaskTrack · while triage or the agent works out the steps'>
        <Card>
          <TaskTrack task={tasks.shaping} />
        </Card>
      </Specimen>
      <Specimen label='SuggestionsPanel · suggested tasks with When to start'>
        <Card>
          <SuggestionsPanel
            task={tasks.suggested}
            onAccept={acknowledgeSample}
            onDismiss={acknowledgeSample}
          />
        </Card>
      </Specimen>
      <MergeStepSpecimens state={state} />
      <Specimen label='DelegationsPanel · delegations, nested under the task that started them'>
        <Card>
          <DelegationsPanel
            state={state}
            task={tasks.delegating}
            onOpen={ignore}
            onStop={acknowledgeSample}
          />
        </Card>
      </Specimen>
    </>
  );
}
