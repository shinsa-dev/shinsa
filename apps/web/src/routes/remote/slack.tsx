import { REMOTE_PATHS } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { resolveSlackLinkedResult, SLACK_NEXT_STEPS } from '@/lib/slack.ts';
import { RemoteHero, RemoteSteps } from './shell.tsx';

export function SlackLinkedPage({ search }: { search: string }) {
  const result = resolveSlackLinkedResult(search);
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      {result.kind === 'linked' ? (
        <>
          <RemoteHero icon='IconCheckCircle2' tone='blue' title={`Slack is connected to ${result.team}`}>
            Mentions of @Shinsa from your Slack account now reach your machine. You can close this tab.
          </RemoteHero>
          <RemoteSteps title='What happens next' steps={SLACK_NEXT_STEPS} />
        </>
      ) : (
        <RemoteHero icon='IconCircleX' tone='red' title='Slack is not connected'>
          {result.message}
        </RemoteHero>
      )}
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
}
