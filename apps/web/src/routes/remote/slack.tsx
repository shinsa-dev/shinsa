import { REMOTE_PATHS } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { resolveSlackLinkedResult, SLACK_POINTS } from '@/lib/slack.ts';
import { RemoteBenefits, RemoteHero } from './shell.tsx';

export function SlackLinkedPage({ search }: { search: string }) {
  const result = resolveSlackLinkedResult(search);
  if (result.kind === 'failed')
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCircleX' tone='red' title='Slack is not connected'>
          {result.message}
        </RemoteHero>
        <RemoteBenefits points={SLACK_POINTS} />
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
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconCheckCircle2' tone='blue' title={`Slack is connected to ${result.team}`}>
        Your mentions of @Shinsa in {result.team} now reach your machine. To add another workspace, connect
        again from Settings.
      </RemoteHero>
      <RemoteBenefits points={SLACK_POINTS} />
      <Button className='w-full' nativeButton={false} render={<a href={REMOTE_PATHS.app} />}>
        Open Shinsa
      </Button>
    </section>
  );
}
