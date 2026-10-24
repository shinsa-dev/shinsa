import type { Gate, ProviderLogin, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { describeProviderLogin } from '@/lib/accounts/providers.ts';
import { describeSignInCheck, resolveSignInProvider, selectSignInLogin } from '@/lib/accounts/sign-in.ts';
import { refreshUsage, startSignIn, useAccounts } from '@/lib/connection/accounts.ts';
import { RETRY_NOTE } from '@/lib/overview/now.ts';
import { TASK_ACTION } from '@/lib/tasks/actions.ts';
import { type GateReplier, type GateReply, replyToGate } from '@/lib/tasks/gates.ts';

function ProviderFix({ login }: { login: ProviderLogin }) {
  const view = describeProviderLogin(login);
  if (!view.fix) return null;
  return (
    <div className='corner-superellipse/1.125 flex items-center gap-1.5 rounded-lg bg-bg-a1 py-1 pr-1 pl-2'>
      <span className='min-w-0 flex-1 text-fg-3 text-xs'>
        <InlineMarkdown text={view.fix} />
      </span>
      {view.command && <CopyButton text={view.command} />}
    </div>
  );
}

function CheckAgainButton({ provider, onCheck }: { provider: string; onCheck: () => Promise<unknown> }) {
  const { busy, run } = useBusy<'check'>();
  const check = async () => {
    await onCheck();
    return true;
  };
  return (
    <Button size='sm' loading={busy === 'check'} onClick={() => void run('check', check)}>
      {describeSignInCheck(provider)}
    </Button>
  );
}

export function SignInCard({
  state,
  task,
  gate,
  onReply = (key) => replyToGate(gate, key),
  onSignIn = () => void startSignIn(gate.account?.id ?? null),
  onCheck = refreshUsage,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onReply?: GateReplier;
  onSignIn?: () => void;
  onCheck?: () => Promise<unknown>;
}) {
  const { busy, run } = useBusy<GateReply>();
  const reply = (key: GateReply) => void run(key, () => onReply(key));
  const snapshot = useAccounts();
  const provider = resolveSignInProvider(gate);
  const login = provider ? selectSignInLogin(snapshot, provider) : null;
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        provider ? (
          <CheckAgainButton provider={provider} onCheck={onCheck} />
        ) : (
          <Button size='sm' onClick={onSignIn}>
            {ACCOUNT_LABEL.signIn}
          </Button>
        )
      }
      footer={
        <FooterNote note={RETRY_NOTE}>
          <QuietLink busy={busy !== null} onClick={() => reply('retry')}>
            {ACCOUNT_LABEL.retryAnyway}
          </QuietLink>
          <QuietLink busy={busy !== null} onClick={() => reply('cancel')}>
            {TASK_ACTION.cancel.label}
          </QuietLink>
        </FooterNote>
      }
    >
      {gate.body && <Markdown text={gate.body} className='text-fg-3 text-xs' />}
      {login && <ProviderFix login={login} />}
    </NowFrame>
  );
}
