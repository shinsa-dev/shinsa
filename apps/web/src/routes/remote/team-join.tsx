import { REMOTE_PATHS, resolveTeamJoinUrl, type TeamJoinFragment } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { UserTag } from '@/components/people/user-tag.tsx';
import { SettingsCard } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { ProjectsSelect } from '@/components/teams/projects-select.tsx';
import { describeFailure } from '@/lib/connection/commands.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { MACHINE_ICON, type RemotePoint } from '@/lib/remote/mode.ts';
import {
  describeMachineName,
  describeMachineNames,
  listAddDeviceSteps,
  PAIR_STEPS,
} from '@/lib/remote/setup-steps.ts';
import type { UserProfile } from '@/lib/remote/users.ts';
import {
  countJoinPicks,
  describeJoinPicks,
  type JoinMachine,
  type JoinMachines,
  type JoinPicks,
  type JoinSetup,
  joinFromMachines,
  type OpenJoinMachines,
} from '@/lib/teams/join-machines.ts';
import {
  clearTeamJoinFragment,
  requestTeamJoin,
  type TeamJoinResult,
  type TeamKeyStore,
} from '@/lib/teams/join.ts';
import { RemoteBenefits, RemoteCheckAgain, RemoteHero, RemoteSteps } from './shell.tsx';

const TEAM_POINTS: RemotePoint[] = [
  {
    icon: 'IconEyeOpen',
    title: 'Your teammates’ work, live',
    detail: 'Every task in the projects they share: its plan, progress, review, evidence and code.',
  },
  {
    icon: 'IconHandshake',
    title: 'Pick up their work here',
    detail:
      'Answer gates, take a task over and open its running services, as the team’s owner allows. Nothing else on their machines.',
  },
];

const PICK_POINT: RemotePoint = {
  icon: 'IconFolder1',
  title: 'You choose what you share',
  detail: 'Teammates see the projects you pick below. Your other tasks stay private.',
};

const NO_MACHINE_POINT: RemotePoint = {
  icon: MACHINE_ICON,
  title: 'No machine of your own needed',
  detail: 'You reach the team through the machines its people share with it. You share no projects yourself.',
};

const NO_SHARE_HINT =
  'Your teammates see nothing of yours until you share a project. You can do this later in Settings → Teams.';

const WITHOUT_MACHINE_HINT =
  'Only if you do not run Shinsa on any machine. You share nothing with the team and see its work through the machines its people share with it.';

const NO_MACHINE_HINT =
  'You have no machine paired, so you share no projects. You reach the team through the machines shared with it.';

type TeamPreview = { name: string; owner: UserProfile } | { failure: string } | null;

function useTeamPreview(link: TeamJoinFragment | null, dashboard: Pick<DashboardClient, 'previewTeam'>) {
  const [preview, setPreview] = React.useState<TeamPreview>(null);
  const invite = link?.invite ?? null;
  React.useEffect(() => {
    if (!invite) return;
    let live = true;
    dashboard.previewTeam(invite).then(
      (answer) => {
        if (live) setPreview({ name: answer.name, owner: answer.owner });
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
  | { kind: 'done'; result: TeamJoinResult; note: string }
  | { kind: 'failed'; message: string };

type MachinesLoad =
  | { status: 'loading' }
  | { status: 'ready'; machines: JoinMachine[]; setup: JoinSetup | null }
  | { status: 'failed'; message: string };

function useJoinMachines(open: OpenJoinMachines): MachinesLoad {
  const [load, setLoad] = React.useState<MachinesLoad>({ status: 'loading' });
  React.useEffect(() => {
    let live = true;
    let close = () => {};
    open().then(
      (opened: JoinMachines) => {
        close = opened.close;
        if (live)
          setLoad({
            status: 'ready',
            machines: opened.machines,
            setup: opened.setup,
          });
        else opened.close();
      },
      (error: unknown) => {
        if (live) setLoad({ status: 'failed', message: describeFailure(error) });
      }
    );
    return () => {
      live = false;
      close();
    };
  }, [open]);
  return load;
}

function describeSetup(setup: JoinSetup, team: string) {
  switch (setup.kind) {
    case 'pair':
      return {
        icon: MACHINE_ICON,
        title: 'Turn on remote access first',
        detail: `Teammates reach your work through your machines. If Shinsa runs on your Mac, turn on remote access there, then check again to join ${team} and share your projects.`,
        steps: { title: 'Pair a machine', items: PAIR_STEPS },
      };
    case 'add':
      return {
        icon: 'IconKey1' as const,
        title: 'Add this device to your machine',
        detail: `${describeMachineNames(setup.machines)} ${setup.machines.length === 1 ? 'is' : 'are'} paired, but this browser has no key for ${setup.machines.length === 1 ? 'it' : 'them'} yet. Add it, then check again to join ${team}.`,
        steps: { title: 'Add this device', items: listAddDeviceSteps(setup.machines) },
      };
    case 'waiting':
      return {
        icon: 'IconKey1' as const,
        title: 'Waiting for your machine',
        detail: `This browser asked to reach ${describeMachineNames(setup.machines)}. Accept the request in Settings > Remote access on the machine, then check again to join ${team}.`,
        steps: null,
      };
    case 'offline':
      return {
        icon: 'IconCloudOff' as const,
        title: 'Open Shinsa on your machine',
        detail: `${describeMachineNames(setup.machines)} ${setup.machines.length === 1 ? 'is' : 'are'} offline. Open Shinsa there so this page can give ${setup.machines.length === 1 ? 'it' : 'them'} the team’s key, then check again.`,
        steps: null,
      };
  }
}

function SetupPage({
  setup,
  team,
  onWithoutMachine,
}: {
  setup: JoinSetup;
  team: string;
  onWithoutMachine: () => void;
}) {
  const described = describeSetup(setup, team);
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon={described.icon} title={described.title}>
        {described.detail}
      </RemoteHero>
      {described.steps && <RemoteSteps title={described.steps.title} steps={described.steps.items} />}
      <RemoteCheckAgain />
      {setup.kind === 'pair' && (
        <div className='flex w-full flex-col gap-2'>
          <Button className='w-full' variant='secondary' onClick={onWithoutMachine}>
            Join without a machine
          </Button>
          <p className='w-full text-center text-xs text-pretty text-fg-2'>{WITHOUT_MACHINE_HINT}</p>
        </div>
      )}
    </section>
  );
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
          <span className='min-w-0 truncate text-xs text-fg-4'>
            {single ? 'Projects to share' : `Projects to share from ${describeMachineName(machine.name)}`}
          </span>
          <ProjectsSelect
            label={
              single ? 'Projects to share' : `Projects to share from ${describeMachineName(machine.name)}`
            }
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

function ReadingMachines() {
  return (
    <SettingsCard className='w-full'>
      <div className='flex items-center px-2.5 py-1.5'>
        <LoadingLine label='Reading your machines' className='h-6 text-xs' />
      </div>
    </SettingsCard>
  );
}

function JoinedPage({ result, note }: { result: TeamJoinResult; note: string }) {
  const member = result.status === 'member';
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero
        icon='IconUserAdd'
        tone='green'
        title={member ? `You are in ${result.name}` : 'Request sent'}
      >
        {member ? (
          'This browser shows the team’s tasks next to your own.'
        ) : (
          <>
            <UserTag user={result.owner} /> accepts or declines your request to join {result.name}. You can
            close this page.
          </>
        )}
      </RemoteHero>
      <p className='w-full text-center text-xs text-pretty text-fg-2'>{note}</p>
      <Button className='w-full' nativeButton={false} render={<a href={REMOTE_PATHS.app} />}>
        Open Shinsa
      </Button>
    </section>
  );
}

function JoinHero({
  team,
  machineless,
}: {
  team: { name: string; owner: UserProfile } | null;
  machineless: boolean;
}) {
  const where = machineless ? 'here' : 'next to your own';
  return (
    <RemoteHero icon='IconUserAdd' title={team ? `Join ${team.name}` : 'Join a team'}>
      {team ? (
        <>
          <UserTag user={team.owner} /> owns this team. Ask to join with your GitHub account. Once they
          accept, you see your teammates’ tasks {where}.
        </>
      ) : (
        `Ask to join with your GitHub account. Once the team’s owner accepts, you see your teammates’ tasks ${where}.`
      )}
    </RemoteHero>
  );
}

export function TeamJoinPage({
  link,
  dashboard,
  teamKeys,
  openMachines,
  request = requestTeamJoin,
}: {
  link: TeamJoinFragment | null;
  dashboard: Pick<DashboardClient, 'joinTeam' | 'previewTeam'>;
  teamKeys: Pick<TeamKeyStore, 'selectTeamKey' | 'writeTeamKey'>;
  openMachines: OpenJoinMachines;
  request?: typeof requestTeamJoin;
}) {
  const [state, setState] = React.useState<JoinState>({ kind: 'ready' });
  const [picks, setPicks] = React.useState<JoinPicks>({});
  const [withoutMachine, setWithoutMachine] = React.useState(false);
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
  if (state.kind === 'done') return <JoinedPage result={state.result} note={state.note} />;
  const named = preview && 'name' in preview ? preview : null;
  const machineless = load.status === 'ready' && load.setup?.kind === 'pair';
  if (load.status === 'ready' && load.setup && !(machineless && withoutMachine))
    return (
      <SetupPage
        setup={load.setup}
        team={named?.name ?? 'the team'}
        onWithoutMachine={() => setWithoutMachine(true)}
      />
    );
  const reached = load.status === 'ready' ? load.machines : [];
  const sharing = reached.filter((machine) => machine.projects.length > 0);
  const noShareHint = machineless ? NO_MACHINE_HINT : NO_SHARE_HINT;

  async function join(fragment: TeamJoinFragment, joinUrl: string) {
    setState({ kind: 'requesting' });
    try {
      const result = await request(fragment, { dashboard, teamKeys });
      await joinFromMachines(reached, picks, joinUrl);
      clearTeamJoinFragment(sessionStorage);
      setState({ kind: 'done', result, note: describeJoinPicks(sharing, picks) ?? noShareHint });
    } catch (error) {
      setState({ kind: 'failed', message: describeFailure(error) });
    }
  }

  const failure =
    state.kind === 'failed'
      ? state.message
      : load.status === 'failed'
        ? load.message
        : preview && 'failure' in preview
          ? preview.failure
          : null;
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <JoinHero team={named} machineless={machineless} />
      <RemoteBenefits points={[...TEAM_POINTS, machineless ? NO_MACHINE_POINT : PICK_POINT]} />
      {load.status === 'loading' && <ReadingMachines />}
      {sharing.length > 0 && <ProjectPicks machines={sharing} picks={picks} onChange={setPicks} />}
      {load.status === 'ready' && !machineless && countJoinPicks(picks) === 0 && (
        <p className='w-full text-xs text-pretty text-fg-2'>{NO_SHARE_HINT}</p>
      )}
      {failure && (
        <p role='alert' className='w-full text-xs text-destructive'>
          {failure}
        </p>
      )}
      {load.status === 'failed' ? (
        <RemoteCheckAgain />
      ) : (
        <Button
          className='w-full'
          disabled={load.status === 'loading'}
          loading={state.kind === 'requesting'}
          onClick={() => void join(link, resolveTeamJoinUrl(link, location.origin))}
        >
          Ask to join
        </Button>
      )}
    </section>
  );
}
