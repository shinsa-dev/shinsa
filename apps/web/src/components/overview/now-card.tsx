import {
  type Gate,
  listActiveRuns,
  listWaitsOn,
  resolvePhaseChange,
  resolveTaskProgress,
  type ShinsaState,
  type Task,
  traceStalledLeaf,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { MessageLink } from '@/components/chat/message-link.tsx';
import { RoleMark } from '@/components/chat/role-mark.tsx';
import { ChecksBlock, FoldedChecks } from '@/components/checks/checks-list.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { PrLink } from '@/components/links/pull-request.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { AnswerBox } from '@/components/overview/answer-box.tsx';
import { FindingVerdicts } from '@/components/overview/finding-verdicts.tsx';
import { LiveFeed } from '@/components/overview/live-feed.tsx';
import { PostMergeCard } from '@/components/overview/merge-steps-card.tsx';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { OperationCard } from '@/components/overview/operation-card.tsx';
import { PlanParameterList } from '@/components/overview/plan-parameters.tsx';
import { PlanChangeSummary, PlanFeedback, PlanPhaseTitle } from '@/components/overview/plan-revision.tsx';
import { ProgressTrack, TaskTrack } from '@/components/overview/progress-track.tsx';
import { QuestionChoices } from '@/components/overview/question-choices.tsx';
import { ReplyReport, WorkingRequest } from '@/components/overview/reply-report.tsx';
import { ReviewActions } from '@/components/overview/review-actions.tsx';
import { SecretCard } from '@/components/overview/secret-card.tsx';
import { SetupCard } from '@/components/overview/setup-card.tsx';
import { SignInCard } from '@/components/overview/sign-in-card.tsx';
import { SilenceNote } from '@/components/overview/silence-note.tsx';
import { UsageWaitCard } from '@/components/overview/usage-wait-card.tsx';
import { WaitCard } from '@/components/overview/wait-card.tsx';
import { MergeStepsBlock } from '@/components/review/merge-steps.tsx';
import { useReadOnly } from '@/components/task/read-only.tsx';
import { InsetNote } from '@/components/text/inset-note.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { formatSince } from '@/lib/format/time.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { selectShownReply, selectWorkingRequest } from '@/lib/overview/exchanges.ts';
import {
  describeAgentReviewFact,
  describeFollowUpNote,
  isTaskWatchable,
  type NowTarget,
  RESULT_TITLE,
  RETRY_NOTE,
  resolveNowKind,
  resolveNowTitle,
} from '@/lib/overview/now.ts';
import { describePlanEyebrow, resolvePlanVersion } from '@/lib/overview/plan-version.ts';
import { describeAnswerPlaceholder } from '@/lib/overview/question.ts';
import { describeEscalationBody, describeReviewTitle } from '@/lib/overview/verdicts.ts';
import { STALLED_REASON } from '@/lib/overview/wait.ts';
import { listMergeWaits } from '@/lib/review/merge-steps.ts';
import { describePlanCard } from '@/lib/tasks/backlog.ts';
import { resolveChecksView } from '@/lib/tasks/checks.ts';
import {
  type GateReplier,
  type GateReply,
  replyToGate,
  resolvePlanReply,
  resolveRetryLabel,
  resolveRetryReply,
} from '@/lib/tasks/gates.ts';
import { describeMergeable, describePullRequestChecks } from '@/lib/tasks/pull-request.ts';
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
  const document = task.plan?.document;
  if (!document) return null;
  const version = resolvePlanVersion(task);
  return (
    <div className='flex flex-col gap-3'>
      <PlanChangeSummary summary={version?.summary ?? null} />
      <Markdown text={document.goal} className='text-fg-3 text-xs' />
      <ol className='flex flex-col gap-2.5'>
        {document.phases.map((phase, index) => (
          <li key={phase.title} className='flex gap-2.5'>
            <StepNumber index={index} />
            <div className='flex min-w-0 flex-col gap-px'>
              <PlanPhaseTitle
                title={phase.title}
                change={resolvePhaseChange(version?.changes, phase.title)}
              />
              <Markdown text={phase.detail} className='text-fg-3 text-xs' />
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
  const readOnly = useReadOnly();
  const { busy, run } = useBusy<'answer'>();
  const asked = gate.runId ? state.runs[gate.runId] : undefined;
  const answer = (response: string) => run('answer', () => onReply('answer', response));
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={asked ? 'The agent asked' : undefined} />}
      title={gate.title}
    >
      {gate.body && <Markdown text={gate.body} className='text-fg-3 text-xs' />}
      {!readOnly && (
        <>
          <QuestionChoices gate={gate} busy={busy !== null} onPick={(choice) => void answer(choice)} />
          <AnswerBox
            label='Your answer'
            placeholder={describeAnswerPlaceholder(gate)}
            submitLabel='Send answer'
            busy={busy === 'answer'}
            onSubmit={answer}
          />
        </>
      )}
    </NowFrame>
  );
}

export function PausedCard({
  state,
  task,
  gate,
  onOpen,
  onReply = (key) => replyToGate(gate, key),
  cancelLabel = 'Cancel task',
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onOpen: (target: NowTarget, runId?: string) => void;
  onReply?: GateReplier;
  cancelLabel?: string;
}) {
  const readOnly = useReadOnly();
  const { busy, run: act } = useBusy<GateReply>();
  const reply = (key: GateReply) => void act(key, () => onReply(key));
  const run = gate.runId && !readOnly ? state.runs[gate.runId] : undefined;
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        <Button
          size='sm'
          loading={busy === resolveRetryReply(gate)}
          onClick={() => reply(resolveRetryReply(gate))}
        >
          {resolveRetryLabel(state, gate)}
        </Button>
      }
      footer={
        <FooterNote note={RETRY_NOTE}>
          <QuietLink busy={busy !== null} onClick={() => reply('cancel')}>
            {cancelLabel}
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
  const copy = describePlanCard(task);
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={describePlanEyebrow(task)} />}
      title={copy.title}
      action={
        <Button
          size='sm'
          loading={busy === approve}
          onClick={() => void run(approve, () => onReply(approve, null, { planVersion: task.plan?.version }))}
        >
          {copy.approve}
        </Button>
      }
      footer={
        <FooterNote note={copy.note}>
          <QuietLink busy={busy !== null} onClick={() => onOpen('agent')}>
            Open the chat
          </QuietLink>
        </FooterNote>
      }
    >
      <PlanFeedback text={resolvePlanVersion(task)?.feedback ?? null} />
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
      {task.result && <Markdown text={task.result.body} className='text-fg-4 text-xs' />}
      {change.why && <Markdown text={change.why} className='text-fg-3 text-xs' />}
      {change.request && <InsetNote label={change.requestLabel} text={change.request} />}
    </NowFrame>
  );
}

function ReviewFacts({ state, task, merge }: { state: ShinsaState; task: Task; merge: boolean }) {
  const review = describeAgentReviewFact(task);
  const pullRequest = merge ? task.pullRequest : null;
  const mergeable = pullRequest ? describeMergeable(pullRequest) : null;
  const checks = pullRequest ? describePullRequestChecks(pullRequest) : null;
  const facts = [
    { key: 'review', node: review && <span>{review}</span> },
    { key: 'pull-request', node: pullRequest && <PrLink state={state} task={task} /> },
    {
      key: 'mergeable',
      node: mergeable && <span className={TONE_TEXT[mergeable.tone]}>{mergeable.label}</span>,
    },
    { key: 'checks', node: checks && <span className={TONE_TEXT[checks.tone]}>{checks.label}</span> },
  ].filter((fact) => fact.node);
  if (facts.length === 0) return null;
  return (
    <p className='flex flex-wrap items-center gap-x-1.5 gap-y-1 text-fg-3 text-xs'>
      {facts.map((fact, index) => (
        <React.Fragment key={fact.key}>
          {index > 0 && <FactDot />}
          {fact.node}
        </React.Fragment>
      ))}
    </p>
  );
}

function FactDot() {
  return <span className='text-fg-2'>·</span>;
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
  const merge = gate.type === 'merge';
  const findings = merge ? [] : task.findings;
  const checks = resolveChecksView(state, task);
  const reply = selectShownReply(task, gate);
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={describeReviewTitle(gate)}
      action={
        <>
          <Button variant='outline' size='sm' onClick={() => onOpen('review')}>
            Review
          </Button>
          <ReviewActions task={task} gate={gate} />
        </>
      }
      footer={<ProgressTrack progress={resolveTaskProgress(task)} />}
    >
      {reply && <ReplyReport task={task} iteration={reply} />}
      {gate.escalation ? (
        <p className='text-fg-3 text-xs'>{describeEscalationBody(gate.escalation)}</p>
      ) : (
        <ReviewFacts state={state} task={task} merge={merge} />
      )}
      {checks && <FoldedChecks taskId={task.id} view={checks} />}
      {findings.length > 0 && <FindingVerdicts task={task} findings={findings} />}
      {merge && <MergeStepsBlock task={task} when='pre_merge' waits={listMergeWaits(state, task)} />}
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
  const readOnly = useReadOnly();
  const progress = resolveTaskProgress(task);
  const [run] = listActiveRuns(state, task.id);
  const current = progress.current;
  const leaf = traceStalledLeaf(state, task);
  const checks = task.stage === 'checking' ? resolveChecksView(state, task) : null;
  const request = selectWorkingRequest(task);
  return (
    <NowFrame
      eyebrow={
        <Eyebrow
          state={state}
          task={task}
          extra={
            run && (
              <span className='flex items-center gap-1.5 text-fg-2'>
                <RoleMark role={run.role} className='text-fg-3' />
                <span>·</span>
                <TimeAgo at={run.startedAt} text={(now) => formatSince('Started', run.startedAt, now)} />
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
      footer={<TaskTrack task={task} />}
    >
      {leaf && (
        <p className='flex flex-wrap items-center gap-1 text-fg-3 text-xs'>
          Held up because <TaskLink state={state} task={leaf.task} /> {STALLED_REASON[leaf.reason]}.
        </p>
      )}
      {request && <WorkingRequest iteration={request} />}
      {current?.planned && current.detail && !checks && !request && (
        <Markdown text={current.detail} className='text-fg-3 text-xs' />
      )}
      {checks && <ChecksBlock taskId={task.id} view={checks} />}
      {run && <SilenceNote state={state} run={run} />}
      {run && !readOnly && <LiveFeed run={run} />}
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
  switch (gate.type) {
    case 'configuration':
      return <SetupCard state={state} task={task} gate={gate} />;
    case 'sign_in':
      return <SignInCard state={state} task={task} gate={gate} />;
    case 'secret':
      return <SecretCard state={state} task={task} gate={gate} />;
    case 'question':
      return <QuestionCard state={state} task={task} gate={gate} />;
    case 'proposal':
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
    case 'post_merge':
      return <PostMergeCard state={state} task={task} />;
    case 'result':
      return <ResultCard state={state} task={task} gate={gate} onOpen={onOpen} />;
  }
}

function CloseButton({ onReply }: { onReply: GateReplier }) {
  const { busy, run } = useBusy<'closeResult'>();
  return (
    <Button
      size='sm'
      loading={busy === 'closeResult'}
      onClick={() => void run('closeResult', () => onReply('closeResult'))}
    >
      Close
    </Button>
  );
}

export function ResultCard({
  state,
  task,
  gate,
  onOpen,
  onReply = (key) => (gate ? replyToGate(gate, key) : Promise.resolve(false)),
}: {
  state: ShinsaState;
  task: Task;
  gate?: Gate;
  onOpen: (target: NowTarget, runId?: string) => void;
  onReply?: GateReplier;
}) {
  const result = task.result;
  if (!result) return null;
  const run = result.runId ? state.runs[result.runId] : undefined;
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={result.at} />} />}
      title={RESULT_TITLE[result.step]}
      action={gate && <CloseButton onReply={onReply} />}
      footer={
        <FooterNote note={describeFollowUpNote(result.step, run?.role ?? null)}>
          <QuietLink onClick={() => onOpen('agent', result.runId ?? undefined)}>Open the chat</QuietLink>
        </FooterNote>
      }
    >
      <Markdown text={result.body} className='text-fg-4 text-xs' />
    </NowFrame>
  );
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
  switch (resolveNowKind(state, task, gate)) {
    case 'gate':
      return gate && <GateCard state={state} task={task} gate={gate} onOpen={onOpen} />;
    case 'usage_wait':
      return task.usageWait && <UsageWaitCard state={state} task={task} wait={task.usageWait} />;
    case 'wait':
      return task.monitor && <WaitCard state={state} task={task} monitor={task.monitor} />;
    case 'result':
      return <ResultCard state={state} task={task} onOpen={onOpen} />;
    case 'work':
      return <WorkCard state={state} task={task} onOpen={onOpen} />;
  }
}
