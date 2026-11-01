import { REMOTE_PATHS, resolveTeamJoinUrl, type TeamJoinFragment } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { describeFailure } from '@/lib/connection/commands.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { RemotePoint } from '@/lib/remote/mode.ts';
import {
  clearTeamJoinFragment,
  requestTeamJoin,
  type TeamJoinResult,
  type TeamKeyStore,
} from '@/lib/teams/join.ts';
import { RemoteBenefits, RemoteHero, RemoteSteps } from './shell.tsx';

const TEAM_POINTS: RemotePoint[] = [
  {
    icon: 'IconEyeOpen',
    title: 'Your teammates’ work, live',
    detail: 'Every task in the projects they share: its plan, progress, review, evidence and code.',
  },
  {
    icon: 'IconEyeSlash',
    title: 'Read-only, and never the chat',
    detail: 'You cannot change their tasks, and their chats and messages to agents stay on their machines.',
  },
  {
    icon: 'IconFolder1',
    title: 'You choose what you share',
    detail: 'Your own tasks stay private until you pick projects to share in Shinsa on your machine.',
  },
];

const SHARE_STEPS = [
  'Open Shinsa on your machine, then Settings → General → Teams.',
  'Choose Join a team and paste this link.',
  'Pick the projects your teammates should see.',
];

type JoinState =
  | { kind: 'ready' }
  | { kind: 'requesting' }
  | { kind: 'done'; result: TeamJoinResult }
  | { kind: 'failed'; message: string };

function LinkRow({ url }: { url: string }) {
  return (
    <div className='flex w-full min-w-0 items-center gap-1.5'>
      <Truncate className='min-w-0 flex-1 font-mono text-2xs text-fg-2'>{url}</Truncate>
      <CopyButton text={url} />
    </div>
  );
}

function JoinedPage({ result, url }: { result: TeamJoinResult; url: string }) {
  const member = result.status === 'member';
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero
        icon='IconUserAdd'
        tone='green'
        title={member ? `You are in ${result.name}` : 'Request sent'}
      >
        {member
          ? 'This browser shows the team’s tasks next to your own.'
          : `${result.owner} accepts or declines your request to join ${result.name}. You can close this page.`}
      </RemoteHero>
      <RemoteSteps title='To share your own work with the team' steps={SHARE_STEPS} />
      <LinkRow url={url} />
      <Button className='w-full' nativeButton={false} render={<a href={REMOTE_PATHS.app} />}>
        Open Shinsa
      </Button>
    </section>
  );
}

export function TeamJoinPage({
  link,
  dashboard,
  teamKeys,
  request = requestTeamJoin,
}: {
  link: TeamJoinFragment | null;
  dashboard: Pick<DashboardClient, 'joinTeam'>;
  teamKeys: Pick<TeamKeyStore, 'selectTeamKey' | 'writeTeamKey'>;
  request?: typeof requestTeamJoin;
}) {
  const [state, setState] = React.useState<JoinState>({ kind: 'ready' });
  if (!link)
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCircleX' tone='red' title='This link cannot add you to a team'>
          It is incomplete. Ask the team’s owner to copy its link again from Settings → Teams.
        </RemoteHero>
        <Button
          className='w-full'
          variant='secondary'
          nativeButton={false}
          render={<a href={REMOTE_PATHS.app} />}
        >
          Open Shinsa
        </Button>
      </section>
    );
  const url = resolveTeamJoinUrl(link, location.origin);
  if (state.kind === 'done') return <JoinedPage result={state.result} url={url} />;

  function join(fragment: TeamJoinFragment) {
    setState({ kind: 'requesting' });
    request(fragment, { dashboard, teamKeys }).then(
      (result) => {
        clearTeamJoinFragment(sessionStorage);
        setState({ kind: 'done', result });
      },
      (error: unknown) => setState({ kind: 'failed', message: describeFailure(error) })
    );
  }

  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconUserAdd' title='Join a team'>
        Ask to join with your GitHub account. Once the team’s owner accepts, you see your teammates’ tasks
        next to your own.
      </RemoteHero>
      <RemoteBenefits points={TEAM_POINTS} />
      {state.kind === 'failed' && (
        <p role='alert' className='w-full text-destructive text-xs'>
          {state.message}
        </p>
      )}
      <Button className='w-full' loading={state.kind === 'requesting'} onClick={() => join(link)}>
        Ask to join
      </Button>
    </section>
  );
}
