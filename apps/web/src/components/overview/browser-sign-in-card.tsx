import { type Gate, isLocalSignInUrl, resolveTaskProject, type ShinsaState, type Task } from '@shinsa/core';
import type { SourceBrowserAnswer } from '@shinsa/core/engine-api/schema';
import { Button } from '@shinsa/ui/components/button';
import { toast } from '@shinsa/ui/components/sonner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { Option } from 'effect';
import * as React from 'react';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { BrowserCopyDialog } from '@/components/settings/browser-copy-dialog.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  BROWSER_REMOTE_NOTE,
  describeCopyDone,
  describeCopyFrom,
  describeNotInSource,
  isCopyRefused,
  LOCAL_SIGN_IN_HINT,
  resolveDefaultSource,
  selectMatchingSite,
  SIGN_IN_WINDOW_NOTE,
} from '@/lib/browser.ts';
import { BROWSER_ACTIONS, type BrowserActions } from '@/lib/connection/browser.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { type GateReplier, replyToGate } from '@/lib/tasks/gates.ts';

type CardBusy = 'copy' | 'window' | 'done' | 'skip' | null;

const SKIP_NOTE = 'The agent carries on once you answer.';

function useDefaultSource(actions: BrowserActions, enabled: boolean) {
  const [source, setSource] = React.useState<SourceBrowserAnswer | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let current = true;
    actions.listSources().then(
      (sources) => {
        if (current) setSource(resolveDefaultSource(sources));
      },
      () => {
        if (current) setSource(null);
      }
    );
    return () => {
      current = false;
    };
  }, [actions, enabled]);
  return source;
}

function RemoteSignIn({
  state,
  task,
  gate,
  onReply,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onReply: GateReplier;
}) {
  const [busy, setBusy] = React.useState<CardBusy>(null);
  const reply = async (kind: 'done' | 'skip') => {
    setBusy(kind);
    await onReply(kind === 'done' ? 'signedIn' : 'skipSignIn');
    setBusy(null);
  };
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        <Button size='sm' loading={busy === 'done'} onClick={() => void reply('done')}>
          I signed in
        </Button>
      }
      footer={
        <FooterNote note={BROWSER_REMOTE_NOTE}>
          <QuietLink busy={busy !== null} onClick={() => void reply('skip')}>
            Skip
          </QuietLink>
        </FooterNote>
      }
    >
      {gate.body && <Markdown text={gate.body} className='text-xs text-fg-3' />}
    </NowFrame>
  );
}

export function BrowserSignInCard({
  state,
  task,
  gate,
  actions = BROWSER_ACTIONS,
  onReply = (key) => replyToGate(gate, key),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  actions?: BrowserActions;
  onReply?: GateReplier;
}) {
  const supported = useEngineFeature('browser');
  const projectId = Option.getOrNull(resolveTaskProject(state, task));
  const local = supported && !isRemoteBuild() && projectId !== null;
  const source = useDefaultSource(actions, local);
  const [busy, setBusy] = React.useState<CardBusy>(null);
  const [windowOpen, setWindowOpen] = React.useState(false);
  const choose = useDialogState<'choose'>();
  const site = gate.browserSignIn?.site ?? '';
  const url = gate.browserSignIn?.url ?? null;

  if (!local || !projectId) return <RemoteSignIn state={state} task={task} gate={gate} onReply={onReply} />;
  const project = projectId;
  const copyable = source !== null && !isCopyRefused(site);
  const windowFirst = url !== null && isLocalSignInUrl(url);

  async function act(kind: Exclude<CardBusy, null>, work: () => Promise<boolean>) {
    setBusy(kind);
    try {
      await work();
    } catch (error) {
      toast.error(describeFailure(error));
    }
    setBusy(null);
  }

  const copy = () =>
    act('copy', async () => {
      if (!source) return false;
      const match = selectMatchingSite(site, await actions.listSourceSites(source.id));
      if (!match) {
        toast.error(describeNotInSource(site, source));
        return false;
      }
      toast.success(describeCopyDone(await actions.copy(project, source.id, [match.site])));
      return onReply('signedIn');
    });

  const openWindow = () =>
    act('window', async () => {
      const answer = await actions.openWindow(project, url);
      setWindowOpen(answer.mode === 'window');
      return true;
    });

  const done = () =>
    act('done', async () => {
      await actions.closeWindow(project);
      setWindowOpen(false);
      return onReply('signedIn');
    });

  const skip = () => act('skip', () => onReply('skipSignIn'));

  const windowButton = (
    <Button
      variant={copyable && !windowFirst ? 'secondary' : 'primary'}
      size='sm'
      loading={busy === 'window'}
      onClick={() => void openWindow()}
    >
      Open sign-in window
    </Button>
  );

  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        windowOpen ? (
          <Button size='sm' loading={busy === 'done'} onClick={() => void done()}>
            Done
          </Button>
        ) : (
          <>
            {windowFirst && windowButton}
            {copyable && (
              <Button
                variant={windowFirst ? 'secondary' : 'primary'}
                size='sm'
                loading={busy === 'copy'}
                onClick={() => void copy()}
              >
                {describeCopyFrom(source)}
              </Button>
            )}
            {!windowFirst && windowButton}
          </>
        )
      }
      footer={
        <FooterNote note={windowOpen ? SIGN_IN_WINDOW_NOTE : SKIP_NOTE}>
          {source && !windowOpen && (
            <QuietLink busy={busy !== null} onClick={() => choose.show('choose')}>
              Choose sites…
            </QuietLink>
          )}
          <QuietLink busy={busy !== null} onClick={() => void skip()}>
            Skip
          </QuietLink>
        </FooterNote>
      }
    >
      {gate.body && <Markdown text={gate.body} className='text-xs text-fg-3' />}
      {url && <Truncate className='text-2xs text-fg-2'>{url}</Truncate>}
      {windowFirst && !windowOpen && <p className='text-2xs text-fg-2'>{LOCAL_SIGN_IN_HINT}</p>}
      {choose.value && (
        <BrowserCopyDialog
          control={choose.control}
          projectId={project}
          actions={actions}
          onCopied={() => void onReply('signedIn')}
        />
      )}
    </NowFrame>
  );
}
