import { REMOTE_PATHS, resolveTeamJoinUrl, type TeamJoinFragment } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { SettingsCard } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { ProjectsSelect } from '@/components/teams/projects-select.tsx';
import { describeFailure } from '@/lib/connection/commands.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { RemotePoint } from '@/lib/remote/mode.ts';
import { describeUserName } from '@/lib/remote/users.ts';
import {
  clearTeamJoinFragment,
  requestTeamJoin,
  type TeamJoinResult,
  type TeamKeyStore,
} from '@/lib/teams/join.ts';
import {
  countJoinPicks,
  describeJoinPicks,
  type JoinMachine,
  type JoinPicks,
  type OpenJoinMachines,
  shareJoinPicks,
} from '@/lib/teams/join-machines.ts';
import { TEAM_PROJECTS_REQUIRED } from '@/lib/teams/settings.ts';
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
];

const PRIVATE_POINT: RemotePoint = {
  icon: 'IconFolder1',
  title: 'You choose what you share',
  detail: 'Your own tasks stay private until you pick projects to share in Shinsa on your machine.',
};

const PICK_POINT: RemotePoint = {
  icon: 'IconFolder1',
  title: 'You choose what you share',
  detail: 'Teammates see the projects you pick below. Your other tasks stay private.',
};

const SHARE_STEPS = [
  'Once you are in, open Shinsa on your machine, then Settings → General → Teams.',
  'Paste this link into the team’s card.',
  'Pick the projects your teammates should see.',
];

type TeamPreview = { name: string; owner: string } | { failure: string } | null;

function useTeamPreview(link: TeamJoinFragment | null, dashboard: Pick<DashboardClient, 'previewTeam'>) {
  const [preview, setPreview] = React.useState<TeamPreview>(null);
  const invite = link?.invite ?? null;
  React.useEffect(() => {
    if (!invite) return;
    let live = true;
    dashboard.previewTeam(invite).then(
      (answer) => {
        if (live) setPreview({ name: answer.name, owner: describeUserName(answer.owner) });
      },
      (error: unknown) => {
        if (live) setPreview({ failure: describeFailure(error) });
      }
    );
    return () => {
      live = false;
    };
  }, [dashboard, invite]);
  return preview;
}

type JoinState =
  | { kind: 'ready' }
  | { kind: 'requesting' }
  | { kind: 'done'; result: TeamJoinResult; shared: string | null }
  | { kind: 'failed'; message: string };

type MachinesLoad = { status: 'loading' } | { status: 'ready'; machines: JoinMachine[] };

function useJoinMachines(open: OpenJoinMachines | null): MachinesLoad {
  const [load, setLoad] = React.useState<MachinesLoad>(
    open ? { status: 'loading' } : { status: 'ready', machines: [] }
  );
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    let close = () => {};
    open().then(
      (opened) => {
        close = opened.close;
        if (live) setLoad({ status: 'ready', machines: opened.machines });
        else opened.close();
      },
      () => {
        if (live) setLoad({ status: 'ready', machines: [] });
      }
    );
    return () => {
      live = false;
      close();
    };
  }, [open]);
  return load;
}

function ProjectPicks({
  machines,
  picks,
  onChange,
}: {
  machines: JoinMachine[];
  picks: JoinPicks;
  onChange: (picks: JoinPicks) => void;
}) {
  const single = machines.length === 1;
  return (
    <SettingsCard className='w-full'>
      {machines.map((machine) => (
        <div key={machine.id} className='flex items-center justify-between gap-3 px-2.5 py-1.5'>
          <span className='min-w-0 truncate text-fg-4 text-xs'>
            {single ? 'Projects to share' : `Projects to share from ${machine.name}`}
          </span>
          <ProjectsSelect
            label={single ? 'Projects to share' : `Projects to share from ${machine.name}`}
            projects={machine.projects}
            chosen={picks[machine.id] ?? []}
            variant='default'
            onChange={(projectIds) => onChange({ ...picks, [machine.id]: projectIds })}
          />
        </div>
      ))}
    </SettingsCard>
  );
}

function LinkRow({ url }: { url: string }) {
  return (
    <div className='flex w-full min-w-0 items-center gap-1.5'>
      <Truncate className='min-w-0 flex-1 font-mono text-2xs text-fg-2'>{url}</Truncate>
      <CopyButton text={url} />
    </div>
  );
}

function JoinedPage({ result, url, shared }: { result: TeamJoinResult; url: string; shared: string | null }) {
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
      {shared ? (
        <p className='w-full text-pretty text-center text-fg-2 text-xs'>{shared}</p>
      ) : (
        <>
          <RemoteSteps title='To share your own work with the team' steps={SHARE_STEPS} />
          <LinkRow url={url} />
        </>
      )}
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
  openMachines = null,
  request = requestTeamJoin,
}: {
  link: TeamJoinFragment | null;
  dashboard: Pick<DashboardClient, 'joinTeam' | 'previewTeam'>;
  teamKeys: Pick<TeamKeyStore, 'selectTeamKey' | 'writeTeamKey'>;
  openMachines?: OpenJoinMachines | null;
  request?: typeof requestTeamJoin;
}) {
  const [state, setState] = React.useState<JoinState>({ kind: 'ready' });
  const [picks, setPicks] = React.useState<JoinPicks>({});
  const [pickError, setPickError] = React.useState<string | null>(null);
  const preview = useTeamPreview(link, dashboard);
  const load = useJoinMachines(openMachines);
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
  if (state.kind === 'done') return <JoinedPage result={state.result} url={url} shared={state.shared} />;
  const machines =
    load.status === 'ready' ? load.machines.filter((machine) => machine.projects.length > 0) : [];

  async function join(fragment: TeamJoinFragment, joinUrl: string) {
    if (machines.length > 0 && countJoinPicks(picks) === 0) {
      setPickError(TEAM_PROJECTS_REQUIRED);
      return;
    }
    setState({ kind: 'requesting' });
    try {
      const result = await request(fragment, { dashboard, teamKeys });
      await shareJoinPicks(machines, picks, joinUrl);
      clearTeamJoinFragment(sessionStorage);
      setState({ kind: 'done', result, shared: describeJoinPicks(machines, picks) });
    } catch (error) {
      setState({ kind: 'failed', message: describeFailure(error) });
    }
  }

  const named = preview && 'name' in preview ? preview : null;
  const failure =
    state.kind === 'failed' ? state.message : preview && 'failure' in preview ? preview.failure : null;
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconUserAdd' title={named ? `Join ${named.name}` : 'Join a team'}>
        {named
          ? `${named.owner} owns this team. Ask to join with your GitHub account. Once they accept, you see your teammates’ tasks next to your own.`
          : 'Ask to join with your GitHub account. Once the team’s owner accepts, you see your teammates’ tasks next to your own.'}
      </RemoteHero>
      <RemoteBenefits points={[...TEAM_POINTS, machines.length > 0 ? PICK_POINT : PRIVATE_POINT]} />
      {load.status === 'loading' && <LoadingLine label='Reading your projects' />}
      {machines.length > 0 && (
        <ProjectPicks
          machines={machines}
          picks={picks}
          onChange={(next) => {
            setPicks(next);
            setPickError(null);
          }}
        />
      )}
      {pickError && (
        <p role='alert' className='w-full text-destructive text-xs'>
          {pickError}
        </p>
      )}
      {failure && (
        <p role='alert' className='w-full text-destructive text-xs'>
          {failure}
        </p>
      )}
      <Button
        className='w-full'
        loading={state.kind === 'requesting'}
        disabled={load.status === 'loading'}
        onClick={() => void join(link, url)}
      >
        Ask to join
      </Button>
    </section>
  );
}
