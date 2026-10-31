import * as React from 'react';
import { NowCard } from '@/components/overview/now-card.tsx';
import { RequestsPanel } from '@/components/overview/reply-report.tsx';
import { selectShownReply } from '@/lib/overview/exchanges.ts';
import { createExchangesScene } from './sample-exchanges.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

function Wide({ children }: { children: React.ReactNode }) {
  return <div className='flex w-full max-w-3xl flex-col gap-5'>{children}</div>;
}

export function ExchangeSpecimens() {
  const [now] = React.useState(Date.now);
  const [scene] = React.useState(() => createExchangesScene(now));
  const shown = selectShownReply(scene.review, scene.gate);
  return (
    <>
      <Specimen label='ReplyReport · the review card after your request: each point you raised, done, answered or not changed, with why, then what to do now; what you sent folded above it as a quote'>
        <Wide>
          <NowCard state={scene.state} task={scene.review} gate={scene.gate} onOpen={acknowledgeSample} />
          <RequestsPanel task={scene.review} shownId={shown?.id ?? null} />
        </Wide>
      </Specimen>
      <Specimen label='WorkingRequest · the work card while the agent works on what you sent'>
        <Wide>
          <NowCard state={scene.state} task={scene.working} gate={undefined} onOpen={acknowledgeSample} />
        </Wide>
      </Specimen>
      <Specimen label='RequestsPanel · every request and plan change in the task, newest first, each folded to its headline'>
        <Wide>
          <RequestsPanel task={scene.review} shownId={null} />
        </Wide>
      </Specimen>
    </>
  );
}
