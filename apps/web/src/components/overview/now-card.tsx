import {
  type Gate,
  listActiveRuns,
  listWaitsOn,
  resolveGateType,
  resolveTaskProgress,
  type ShinsaState,
  type Task,
  traceStalledLeaf,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { MessageLink } from '@/components/chat/message-link.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { AnswerBox } from '@/components/overview/answer-box.tsx';
import { FindingVerdicts } from '@/components/overview/finding-verdicts.tsx';
import { LiveFeed } from '@/components/overview/live-feed.tsx';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { OperationCard } from '@/components/overview/operation-card.tsx';
import { PlanParameterList } from '@/components/overview/plan-parameters.tsx';
import { PlanRevision } from '@/components/overview/plan-revision.tsx';
import { ProgressTrack } from '@/components/overview/progress-track.tsx';
import { QuestionChoices } from '@/components/overview/question-choices.tsx';
import { SecretCard } from '@/components/overview/secret-card.tsx';
import { SetupCard } from '@/components/overview/setup-card.tsx';
import { SignInCard } from '@/components/overview/sign-in-card.tsx';
import { SilenceNote } from '@/components/overview/silence-note.tsx';
import { UsageWaitCard } from '@/components/overview/usage-wait-card.tsx';
import { WaitCard } from '@/components/overview/wait-card.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { ROLE_LABEL } from '@/lib/chat/run-role.ts';
import { formatSince } from '@/lib/format/time.ts';
import {
  describeReviewFacts,
  isTaskWatchable,
  type NowTarget,
  RETRY_NOTE,
  resolveNowTitle,
} from '@/lib/overview/now.ts';
import { describePlanEyebrow } from '@/lib/overview/plan-version.ts';
import { describeAnswerPlaceholder } from '@/lib/overview/question.ts';
import {
  createVerdictDraft,
  describeApproveHint,
  describeEscalationBody,
  describeReviewTitle,
  listVerdicts,
  resolveVerdictAction,
} from '@/lib/overview/verdicts.ts';
import { STALLED_REASON } from '@/lib/overview/wait.ts';
import { describeSpent } from '@/lib/tasks/cost.ts';
import {
  type GateReplier,
  type GateReply,
  replyToGate,
  resolvePlanReply,
  resolveRetryLabel,
} from '@/lib/tasks/gates.ts';
import { describeChangeGate, resolvePlannedOperation } from '@/lib/tasks/shapes.ts';

function PlannedOperation({ task }: { task: Task }) {
  const operation = resolvePlannedOperation(task);
  if (!operation) return null;
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='font-medium text-fg-4 text-xs leading-5'>{operation.heading}</span>
      <ol className='flex flex-col gap-1.5'>
        {operation.steps.map((step, index) => (
          <li key={step} className='flex gap-2.5'>
            <StepNumber index={index} />
            <Markdown text={step} className='text-fg-3 text-xs' />
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanList({ task }: { task: Task }) {
  const document = task.spec?.document;
  if (!document) return null;
  return (
    <div className='flex flex-col gap-3'>
      <Markdown text={document.goal} className='text-fg-3 text-xs' />
      <ol className='flex flex-col gap-2.5'>
        {document.plan.map((step, index) => (
          <li key={step.title} className='flex gap-2.5'>
            <StepNumber index={index} />
            <div className='flex min-w-0 flex-col gap-px'>
              <InlineMarkdown text={step.title} className='font-medium text-fg-4 text-xs leading-5' />
              <Markdown text={step.detail} className='text-fg-3 text-xs' />
            </div>
          </li>
        ))}
      </ol>
      <PlannedOperation task={task} />
      <PlanParameterList document={document} />
    </div>
  );
}

export function QuestionCard({
  state,
  task,
  gate,
  onReply = (key, response) => replyToGate(gate, key, response),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onReply?: GateReplier;
}) {
  const { busy, run } = useBusy<'answer'>();
  const asked = gate.runId ? state.runs[gate.runId] : undefined;
  const answer = (response: string) => void run('answer', () => onReply('answer', response));
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={asked ? 'The agent asked' : undefined} />}
      title={gate.title}
    >
      {gate.body && <Markdown text={gate.body} className='text-fg-3 text-xs' />}
      <QuestionChoices gate={gate} busy={busy !== null} onPick={answer} />
      <AnswerBox
        label='Your answer'
        placeholder={describeAnswerPlaceholder(gate)}
        submitLabel='Send answer'
        busy={busy === 'answer'}
        onSubmit={answer}
      />
    </NowFrame>
  );
}

export function PausedCard({
  state,
  task,
  gate,
  onOpen,
  onReply = (key) => replyToGate(gate, key),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onOpen: (target: NowTarget, runId?: string) => void;
  onReply?: GateReplier;
}) {
  const { busy, run: act } = useBusy<GateReply>();
  const reply = (key: GateReply) => void act(key, () => onReply(key));
  const run = gate.runId ? state.runs[gate.runId] : undefined;
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        <Button size='sm' loading={busy === 'retry'} onClick={() => reply('retry')}>
          {resolveRetryLabel(state, gate)}
        </Button>
      }
      footer={
        <FooterNote note={RETRY_NOTE}>
          <QuietLink busy={busy !== null} onClick={() => reply('cancel')}>
            Cancel task
          </QuietLink>
        </FooterNote>
      }
    >
      {run ? (
        <MessageLink run={run} fallback={gate.body} onOpen={(runId) => onOpen('agent', runId)} />
      ) : (
        gate.body && <Markdown text={gate.body} className='text-fg-3 text-xs' />
      )}
    </NowFrame>
  );
}

export function PlanCard({
  state,
  task,
  gate,
  onOpen,
  onReply = (key, response, extras) => replyToGate(gate, key, response, extras),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onOpen: (target: NowTarget) => void;
  onReply?: GateReplier;
}) {
  const { busy, run } = useBusy<GateReply>();
  const approve = resolvePlanReply(task);
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={describePlanEyebrow(task)} />}
      title='The planner wants your go-ahead on this plan'
      action={
        <Button
          size='sm'
          loading={busy === approve}
          onClick={() => void run(approve, () => onReply(approve, null, { planVersion: task.spec?.version }))}
        >
          Approve plan
        </Button>
      }
      footer={
        <FooterNote note='Want something different? Say it in the chat and the planner revises it.'>
          <QuietLink busy={busy !== null} onClick={() => onOpen('agent')}>
            Open the chat
          </QuietLink>
        </FooterNote>
      }
    >
      <PlanRevision task={task} />
      <PlanList task={task} />
    </NowFrame>
  );
}

export function ChangeCard({
  state,
  task,
  gate,
  onReply = (key) => replyToGate(gate, key),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onReply?: GateReplier;
}) {
  const { busy, run } = useBusy<'makeChange' | 'planOperation' | 'keepAsIs'>();
  const change = describeChangeGate(task, gate);
  const goOn = change.goOn;
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={change.eyebrow} />}
      title={gate.title}
      action={
        <Button
          size='sm'
          loading={busy === goOn.reply}
          onClick={() => void run(goOn.reply, () => onReply(goOn.reply))}
        >
          {goOn.label}
        </Button>
      }
      footer={
        <FooterNote note={goOn.note}>
          <QuietLink busy={busy !== null} onClick={() => void run('keepAsIs', () => onReply('keepAsIs'))}>
            {change.keep}
          </QuietLink>
        </FooterNote>
      }
    >
      {change.why && <Markdown text={change.why} className='text-fg-3 text-xs' />}
      {change.request && (
        <div className='corner-superellipse/1.125 flex flex-col gap-px rounded-lg bg-bg-a1 px-3 py-2.5'>
          <span className='text-2xs text-fg-2'>{change.requestLabel}</span>
          <Markdown text={change.request} className='text-fg-4 text-xs' />
        </div>
      )}
    </NowFrame>
  );
}

function ReviewCard({
  state,
  task,
  gate,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onOpen: (target: NowTarget) => void;
}) {
  const { busy, run } = useBusy<'merge' | 'decide'>();
  const draft = useReviewDraft();
  const merge = gate.kind === 'merge';
  const commented = draft.comments.length > 0;
  const findings = merge ? [] : task.findings;
  const [verdicts, setVerdicts] = React.useState(() => createVerdictDraft(findings));
  const action = resolveVerdictAction(findings, verdicts);
  const judged = findings.length > 0 ? { verdicts: listVerdicts(findings, verdicts) } : {};
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={describeReviewTitle(gate)}
      action={
        <>
          <Button variant='outline' size='sm' onClick={() => onOpen('review')}>
            Review
          </Button>
          {merge && (
            <Button
              size='sm'
              icon='IconMerged'
              loading={busy === 'merge'}
              onClick={() => void run('merge', () => replyToGate(gate, 'merge'))}
            >
              {task.pullRequest ? `Merge #${task.pullRequest.number}` : 'Merge'}
            </Button>
          )}
          {!merge && (
            <Hint label={describeApproveHint(commented, action)}>
              <span className='flex'>
                <Button
                  size='sm'
                  loading={busy === 'decide'}
                  disabled={commented}
                  onClick={() => void run('decide', () => replyToGate(gate, action.reply, null, judged))}
                >
                  {action.label}
                </Button>
              </span>
            </Hint>
          )}
        </>
      }
      footer={<ProgressTrack progress={resolveTaskProgress(task)} />}
    >
      <p className='text-fg-3 text-xs'>
        {gate.escalation
          ? describeEscalationBody(gate.escalation)
          : describeReviewFacts(task, merge, describeSpent(state, task))}
      </p>
      {findings.length > 0 && (
        <FindingVerdicts
          findings={findings}
          draft={verdicts}
          onChange={(index, verdict) => setVerdicts((current) => ({ ...current, [index]: verdict }))}
        />
      )}
    </NowFrame>
  );
}

function WorkCard({
  state,
  task,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  onOpen: (target: NowTarget, runId?: string) => void;
}) {
  const progress = resolveTaskProgress(task);
  const [run] = listActiveRuns(state, task.id);
  const current = progress.current;
  const leaf = traceStalledLeaf(state, task);
  return (
    <NowFrame
      eyebrow={
        <Eyebrow
          state={state}
          task={task}
          extra={
            run && (
              <span className='text-fg-2'>
                {ROLE_LABEL[run.role]} ·{' '}
                <TimeAgo at={run.startedAt} text={(now) => formatSince('started', run.startedAt, now)} />
              </span>
            )
          }
        />
      }
      title={resolveNowTitle(task, listWaitsOn(state, task), current, run)}
      action={
        run &&
        isTaskWatchable(state, task) && (
          <Button variant='outline' size='sm' onClick={() => onOpen('agent', run.id)}>
            Watch
          </Button>
        )
      }
      footer={<ProgressTrack progress={progress} />}
    >
      {leaf && (
        <p className='flex flex-wrap items-center gap-1 text-fg-3 text-xs'>
          Held up because <TaskLink state={state} task={leaf.task} /> {STALLED_REASON[leaf.reason]}.
        </p>
      )}
      {current?.planned && current.detail && <Markdown text={current.detail} className='text-fg-3 text-xs' />}
      {run && <SilenceNote state={state} run={run} />}
      {run && <LiveFeed runId={run.id} />}
    </NowFrame>
  );
}

function GateCard({
  state,
  task,
  gate,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onOpen: (target: NowTarget, runId?: string) => void;
}) {
  switch (resolveGateType(gate)) {
    case 'configuration':
      return <SetupCard state={state} task={task} gate={gate} />;
    case 'sign_in':
      return <SignInCard state={state} task={task} gate={gate} />;
    case 'secret':
      return <SecretCard state={state} task={task} gate={gate} />;
    case 'question':
      return <QuestionCard state={state} task={task} gate={gate} />;
    case 'change':
      return <ChangeCard state={state} task={task} gate={gate} />;
    case 'operation':
      return <OperationCard state={state} task={task} gate={gate} />;
    case 'failure':
      return <PausedCard state={state} task={task} gate={gate} onOpen={onOpen} />;
    case 'plan':
      return <PlanCard state={state} task={task} gate={gate} onOpen={onOpen} />;
    case 'review':
    case 'merge':
      return <ReviewCard state={state} task={task} gate={gate} onOpen={onOpen} />;
  }
}

export function NowCard({
  state,
  task,
  gate,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate | undefined;
  onOpen: (target: NowTarget, runId?: string) => void;
}) {
  if (gate) return <GateCard state={state} task={task} gate={gate} onOpen={onOpen} />;
  if (isUsageWaitArmed(task) && listActiveRuns(state, task.id).length === 0) {
    return <UsageWaitCard state={state} task={task} wait={task.usageWait} />;
  }
  if (task.monitor?.status === 'armed' && listActiveRuns(state, task.id).length === 0) {
    return <WaitCard state={state} task={task} monitor={task.monitor} />;
  }
  return <WorkCard state={state} task={task} onOpen={onOpen} />;
}
