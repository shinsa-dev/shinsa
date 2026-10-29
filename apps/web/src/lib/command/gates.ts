import {
  type FindingVerdictKind,
  type Gate,
  isDecisionGate,
  listOpenGates,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { describeSignInCheck, resolveSignInProvider } from '@/lib/accounts/sign-in.ts';
import { type Command, type MenuPage, RANK } from '@/lib/command/registry.ts';
import { refreshUsage, startSignIn } from '@/lib/connection/accounts.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { OPERATION_SKIP } from '@/lib/overview/operation.ts';
import {
  describeApproveHint,
  isVerdictActionBlocked,
  resolveVerdictAction,
  resolveVerdictAnswer,
  resolveVerdictDraft,
  type VerdictAction,
} from '@/lib/overview/verdicts.ts';
import { type LineComment, serializeComments } from '@/lib/review/draft.ts';
import { describeMergeBlock, listTimedSteps, MERGE_STEP_TITLE } from '@/lib/review/merge-steps.ts';
import { declineSecret, resolveSecretLabel } from '@/lib/secrets.ts';
import {
  type AnswerExtras,
  replyToGate,
  resolveApprovalReply,
  resolvePlanReply,
  resolveRetryLabel,
  resolveRetryReply,
} from '@/lib/tasks/gates.ts';
import { describeChangeGate } from '@/lib/tasks/shapes.ts';
import { resolveGateGlyph } from '@/lib/tasks/status.ts';
import { hasReview, type TaskTab } from '@/lib/tasks/tabs.ts';
import { resolveTaskPath } from '@/router.ts';

export interface GateContext {
  comments: LineComment[];
  clearComments: () => void;
  verdicts: Readonly<Record<number, FindingVerdictKind>>;
  tab: TaskTab | null;
}

export function compose(
  crumb: string,
  placeholder: string,
  submit: string,
  send: (text: string) => Promise<unknown>
): MenuPage {
  return { kind: 'compose', crumb, placeholder, submit, send };
}

function resolveGateId(gate: Gate) {
  return `task.${gate.taskId}.gate.${gate.id}`;
}

function listAnswerCommands(gate: Gate): Command[] {
  return (gate.choices ?? []).map((choice) => ({
    kind: 'run',
    id: `${resolveGateId(gate)}.choice.${choice}`,
    label: `Answer “${choice}”`,
    ...(choice === gate.recommendation ? { hint: 'Recommended' } : {}),
    icon: 'IconBubbleQuestion',
    keywords: ['reply', 'question', 'choose', 'pick', choice],
    run: () => void replyToGate(gate, 'answer', choice),
  }));
}

function listSetupCommands(gate: Gate): Command[] {
  return [
    {
      kind: 'run',
      id: `${resolveGateId(gate)}.recheck`,
      label: 'Verify the setup again',
      hint: gate.title,
      icon: resolveGateGlyph(gate).icon,
      keywords: ['configuration', 'setup', 'retry', 'verify'],
      run: () => void replyToGate(gate, 'recheck'),
    },
  ];
}

function resolveSignInCommand(gate: Gate): Command {
  const id = resolveGateId(gate);
  const provider = resolveSignInProvider(gate);
  if (provider) {
    return {
      kind: 'run',
      id: `${id}.sign-in`,
      label: describeSignInCheck(provider),
      hint: gate.title,
      icon: resolveGateGlyph(gate).icon,
      keywords: ['sign in', 'login', 'account', provider],
      run: () => void refreshUsage(),
    };
  }
  return {
    kind: 'run',
    id: `${id}.sign-in`,
    label: ACCOUNT_LABEL.signIn,
    hint: gate.title,
    icon: resolveGateGlyph(gate).icon,
    keywords: ['sign in', 'login', 'account', 'claude'],
    run: () => void startSignIn(gate.account?.id ?? null),
  };
}

function listSignInCommands(gate: Gate): Command[] {
  const id = resolveGateId(gate);
  return [
    resolveSignInCommand(gate),
    {
      kind: 'run',
      id: `${id}.retry`,
      label: ACCOUNT_LABEL.retryAnyway,
      icon: 'IconArrowRotateClockwise',
      keywords: ['retry', 'again', 'sign in', 'account'],
      run: () => void replyToGate(gate, 'retry'),
    },
  ];
}

function listSecretCommands(task: Task, gate: Gate): Command[] {
  const id = resolveGateId(gate);
  return [
    {
      kind: 'go',
      id: `${id}.secret`,
      label: `Give the ${resolveSecretLabel(gate)}`,
      hint: gate.title,
      icon: 'IconShieldCheck',
      keywords: ['secret', 'token', 'key', 'password', 'paste'],
      to: resolveTaskPath(task),
    },
    {
      kind: 'run',
      id: `${id}.secret.decline`,
      label: 'Don’t give the secret',
      icon: 'IconCircleX',
      keywords: ['decline', 'refuse', 'secret'],
      run: () => void declineSecret(gate.id),
    },
  ];
}

function listQuestionCommands(gate: Gate): Command[] {
  return [
    ...listAnswerCommands(gate),
    {
      kind: 'page',
      id: `${resolveGateId(gate)}.answer`,
      label: 'Answer the question',
      hint: gate.title,
      icon: resolveGateGlyph(gate).icon,
      keywords: ['reply', 'question', 'agent'],
      page: compose('Answer', 'Your answer goes straight to the agent.', 'Send answer', (text) =>
        replyToGate(gate, 'answer', text)
      ),
    },
  ];
}

function listFailureCommands(state: ShinsaState, gate: Gate): Command[] {
  const id = resolveGateId(gate);
  return [
    {
      kind: 'run',
      id: `${id}.retry`,
      label: resolveRetryLabel(state, gate),
      hint: gate.title,
      icon: 'IconArrowRotateClockwise',
      keywords: ['retry', 'resume', 'again', 'restart', 'paused'],
      run: () => void replyToGate(gate, resolveRetryReply(gate)),
    },
    {
      kind: 'page',
      id: `${id}.guide`,
      label: 'Retry with guidance',
      icon: 'IconBubbleText',
      keywords: ['resume', 'reply', 'tell', 'paused'],
      page: compose('Retry with guidance', 'Tell the agent what to do differently.', 'Retry', (text) =>
        replyToGate(gate, 'guide', text)
      ),
    },
  ];
}

function listPlanCommands(task: Task, gate: Gate): Command[] {
  const id = resolveGateId(gate);
  return [
    {
      kind: 'run',
      id: `${id}.approve`,
      label: 'Approve the plan',
      icon: 'IconCheckmark1',
      keywords: ['spec', 'go ahead', 'build', 'accept'],
      run: () => void replyToGate(gate, resolvePlanReply(task), null, { planVersion: task.plan?.version }),
    },
    {
      kind: 'page',
      id: `${id}.revise`,
      label: 'Revise the plan',
      icon: 'IconPencil',
      keywords: ['spec', 'change', 'replan', 'feedback'],
      page: compose(
        'Revise the plan',
        'Say what the plan should do differently.',
        'Send to the agent',
        (text) => replyToGate(gate, 'revisePlan', text)
      ),
    },
  ];
}

function createReviseCommand(gate: Gate, context: GateContext): Command {
  const count = context.comments.length;
  return {
    kind: 'page',
    id: `${resolveGateId(gate)}.revise`,
    label:
      count > 0 ? `Request changes with ${count} ${count === 1 ? 'comment' : 'comments'}` : 'Request changes',
    icon: 'IconPencil',
    keywords: ['revise', 'feedback', 'fix', 'change', 'send back'],
    page: compose(
      'Request changes',
      'Say what should change. The agent fixes it.',
      'Send the changes',
      async (text) => {
        const extras = count > 0 ? { comments: serializeComments(context.comments) } : {};
        const sent = await replyToGate(gate, 'requestChanges', text, extras);
        if (sent) context.clearComments();
        return sent;
      }
    ),
  };
}

async function sendVerdicts(
  task: Task,
  gate: Gate,
  action: VerdictAction,
  extras: AnswerExtras,
  context: GateContext
) {
  const sent = await replyToGate(gate, resolveApprovalReply(task, gate, action.reply), null, extras);
  if (sent && extras.comments) context.clearComments();
}

function resolveDecision(task: Task, gate: Gate, context: GateContext) {
  const commented = context.comments.length > 0;
  if (task.findings.length === 0) {
    return {
      label: 'Approve the changes',
      hint: 'Opens the pull request',
      ...(commented ? { disabled: 'Send or clear your comments first' } : {}),
      run: () => void replyToGate(gate, resolveApprovalReply(task, gate, 'approveChanges')),
    };
  }
  const draft = resolveVerdictDraft(task.findings, context.verdicts);
  const action = resolveVerdictAction(task.findings, draft);
  const extras = resolveVerdictAnswer(task.findings, draft, context.comments);
  const hint = describeApproveHint(commented, action);
  return {
    label: action.label,
    hint,
    ...(isVerdictActionBlocked(commented, action) ? { disabled: hint } : {}),
    run: () => void sendVerdicts(task, gate, action, extras, context),
  };
}

function createDecideCommand(task: Task, gate: Gate, context: GateContext): Command {
  return {
    kind: 'run',
    id: `${resolveGateId(gate)}.approve`,
    icon: 'IconCheckmark1',
    keywords: ['review', 'accept', 'ship', 'pull request', 'lgtm', 'findings', 'fix'],
    ...resolveDecision(task, gate, context),
  };
}

function listReviewCommands(task: Task, gate: Gate, context: GateContext): Command[] {
  const id = resolveGateId(gate);
  const commands: Command[] = [createDecideCommand(task, gate, context)];
  if (context.tab !== 'review' && hasReview(task)) {
    commands.push({
      kind: 'go',
      id: `${id}.review`,
      label: 'Review the changes',
      icon: 'IconEyeOpen',
      keywords: ['code', 'diff', 'read', 'report'],
      to: resolveTaskPath(task, { tab: 'review' }),
    });
  }
  commands.push(createReviseCommand(gate, context));
  return commands;
}

function resolveMergeBlock(task: Task) {
  const blocked = describeMergeBlock(task);
  return blocked ? { disabled: blocked } : {};
}

function listMergeCommands(task: Task, gate: Gate, context: GateContext): Command[] {
  return [
    {
      kind: 'run',
      id: `${resolveGateId(gate)}.merge`,
      label: task.pullRequest ? `Merge #${task.pullRequest.number}` : 'Merge the pull request',
      icon: 'IconMerged',
      keywords: ['merge', 'ship', 'land', 'approve', 'pull request'],
      run: () => void replyToGate(gate, resolveApprovalReply(task, gate, 'merge')),
      ...resolveMergeBlock(task),
    },
    createReviseCommand(gate, context),
  ];
}

function listPostMergeCommands(task: Task, gate: Gate): Command[] {
  return listTimedSteps(task, 'post_merge')
    .filter((step) => step.due && !step.done)
    .map((step) => ({
      kind: 'run',
      id: `${resolveGateId(gate)}.tick.${step.key}`,
      label: `Tick “${step.title}”`,
      hint: MERGE_STEP_TITLE.post_merge,
      icon: 'IconChecklist',
      keywords: ['done', 'step', 'after', 'merge', 'check'],
      run: () =>
        void sendCommandWithToast({ type: 'merge_step.tick', taskId: task.id, key: step.key, done: true }),
    }));
}

function listChangeCommands(task: Task, gate: Gate): Command[] {
  const id = resolveGateId(gate);
  const change = describeChangeGate(task, gate);
  return [
    {
      kind: 'run',
      id: `${id}.make-change`,
      label: change.goOn.label,
      hint: gate.title,
      icon: resolveGateGlyph(gate).icon,
      keywords: ['approve', 'change', 'fix', 'build', 'operation', 'proposal'],
      run: () => void replyToGate(gate, change.goOn.reply),
    },
    {
      kind: 'run',
      id: `${id}.keep`,
      label: change.keep,
      icon: 'IconCheckCircle2',
      keywords: ['decline', 'reject', 'keep', 'done', 'proposal'],
      run: () => void replyToGate(gate, 'keepAsIs'),
    },
  ];
}

function listOperationCommands(gate: Gate): Command[] {
  const id = resolveGateId(gate);
  return [
    {
      kind: 'run',
      id: `${id}.run-operation`,
      label: 'Run the operation',
      hint: gate.title,
      icon: resolveGateGlyph(gate).icon,
      keywords: ['approve', 'confirm', 'operation', 'run', 'merged'],
      run: () => void replyToGate(gate, 'runOperation'),
    },
    {
      kind: 'page',
      id: `${id}.skip-operation`,
      label: 'Finish without it',
      icon: 'IconCheckCircle2',
      destructive: true,
      keywords: ['skip', 'decline', 'reject', 'done', 'operation', 'finish'],
      page: {
        kind: 'list',
        crumb: 'Finish without it',
        placeholder: 'Finish without running the operation?',
        sections: [
          {
            id: 'confirm',
            heading: OPERATION_SKIP.body,
            rank: RANK.context,
            commands: [
              {
                kind: 'run',
                id: `${id}.skip-operation.confirm`,
                label: OPERATION_SKIP.action,
                icon: 'IconCheckCircle2',
                destructive: true,
                run: () => void replyToGate(gate, 'skipOperation'),
              },
              {
                kind: 'run',
                id: `${id}.skip-operation.keep`,
                label: 'Keep it',
                icon: 'IconArrowLeft',
                run: () => {},
              },
            ],
          },
        ],
      },
    },
  ];
}

function listGateCommands(state: ShinsaState, task: Task, gate: Gate, context: GateContext): Command[] {
  switch (gate.type) {
    case 'configuration':
      return listSetupCommands(gate);
    case 'sign_in':
      return listSignInCommands(gate);
    case 'secret':
      return listSecretCommands(task, gate);
    case 'failure':
      return listFailureCommands(state, gate);
    case 'proposal':
      return listChangeCommands(task, gate);
    case 'operation':
      return listOperationCommands(gate);
    case 'question':
      return listQuestionCommands(gate);
    case 'plan':
      return listPlanCommands(task, gate);
    case 'review':
      return listReviewCommands(task, gate, context);
    case 'merge':
      return listMergeCommands(task, gate, context);
    case 'post_merge':
      return listPostMergeCommands(task, gate);
  }
}

export function listOpenGateCommands(state: ShinsaState, task: Task, context: GateContext) {
  return listOpenGates(state, task.id)
    .sort((a, b) => Number(isDecisionGate(a)) - Number(isDecisionGate(b)))
    .flatMap((gate) => listGateCommands(state, task, gate, context));
}
