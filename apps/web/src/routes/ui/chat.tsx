import { serializeAttachments } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ChatLine, DetailRail, ExpandRow, FoldLine } from '@/components/chat/chat-line.tsx';
import { ContextGauge } from '@/components/chat/context-meter.tsx';
import { DelegationReportRow, DelegationSpawnCard } from '@/components/chat/delegation-card.tsx';
import { HandoverCard } from '@/components/chat/handover-card.tsx';
import { MessageQueue } from '@/components/chat/message-queue.tsx';
import { NoticeLine } from '@/components/chat/notice-line.tsx';
import { RoundDivider } from '@/components/chat/round-divider.tsx';
import { ToolGroup, ToolRow } from '@/components/chat/tool-group.tsx';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { CHAT_COLUMN, CHAT_INSET } from '@/components/layout/surface/card.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { RoundsPanel } from '@/components/overview/rounds-panel.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { Composer } from '@/components/task/composer.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { resolveContextMeter } from '@/lib/chat/context.ts';
import { type DelegationView, selectDelegation } from '@/lib/chat/delegations.ts';
import type { QuietNoticeKind, TimelineItemOf } from '@/lib/chat/timeline.ts';
import {
  createDisclosureId,
  DisclosureScope,
  useDisclosure,
  useDisclosureScope,
} from '@/lib/preferences/disclosure.ts';
import { createSampleChatCalls, createSampleRevisionCall } from './sample-chat.ts';
import { createSampleDelegations } from './sample-delegations.ts';
import { createOverviewScene } from './sample-overview.ts';
import {
  acknowledgeSample,
  createSampleQueueTask,
  createSampleRoundsTask,
  createSampleRun,
  createSampleState,
} from './samples.ts';
import { Specimen } from './section.tsx';

const CONTEXT_TOKENS = [48_000, 156_000, 188_000];

function createNoticeItems(now: number): TimelineItemOf<QuietNoticeKind>[] {
  return [
    {
      kind: 'account',
      key: 'account',
      at: now,
      email: 'christo@example.com',
      previous: null,
      reason: 'usage_limit',
    },
    {
      kind: 'retrying',
      key: 'retrying',
      at: now,
      provider: 'claude',
      detail: 'Claude’s API is overloaded (529).',
      attempt: 1,
      attempts: 3,
      retryAt: now + 15_000,
    },
    { kind: 'compaction', key: 'compaction', at: now, trigger: 'auto', by: 'claude' },
    { kind: 'compaction', key: 'eunoe-cut', at: now, trigger: 'auto', by: 'eunoe' },
    { kind: 'compaction', key: 'eunoe-fold', at: now, trigger: 'fold', by: 'eunoe' },
    { kind: 'proxy', key: 'proxy', at: now, detail: 'Eunoe did not answer within 15 s.' },
    { kind: 'fast_mode', key: 'fast-mode', at: now, status: 'unavailable', reason: 'model_not_allowed' },
    {
      kind: 'extensions',
      key: 'extensions',
      at: now,
      servers: [
        { name: 'linear', tokens: 4_200 },
        { name: 'sentry', tokens: null },
        { name: 'figma', tokens: 2_300 },
      ],
      skills: Array.from({ length: 14 }, (_, index) => ({
        name: `skill-${index + 1}`,
        tokens: 300 + index * 120,
      })),
      plugins: [{ name: 'stripe', tokens: 2_100 }],
    },
    { kind: 'extensions', key: 'extensions-none', at: now, servers: [], skills: [], plugins: [] },
    {
      kind: 'handoff',
      key: 'restore',
      at: now,
      reason: 'session_restore',
      fromProvider: 'Claude',
      toProvider: 'Claude',
      totalEntries: 214,
      includedEntries: 180,
    },
    {
      kind: 'handoff',
      key: 'switch',
      at: now,
      reason: 'provider_switch',
      fromProvider: 'Claude',
      toProvider: 'Codex',
      totalEntries: 96,
      includedEntries: 96,
    },
  ];
}

function createDelegationViews(now: number) {
  const { task, runs } = createSampleDelegations(now);
  const state = createSampleState({ tasks: [task], runs });
  return runs.flatMap((run) => {
    const view = selectDelegation(state, run.id);
    return view ? [view] : [];
  });
}

function DelegatedConversation({ view }: { view: DelegationView }) {
  return (
    <div className='px-3 py-2'>
      <Markdown text={view.result ?? `Working on “${view.title}”.`} className='prose-chat' />
    </div>
  );
}

function RoundSpecimens({ now }: { now: number }) {
  const [task] = React.useState(() => createSampleRoundsTask(now));
  const [state] = React.useState(() => createSampleState({ tasks: [task] }));
  return (
    <>
      <Specimen label='RoundDivider · where each round starts in the chat: earlier rounds on their pull request, the current round, a round waiting to start'>
        <div className='flex w-full max-w-xl flex-col'>
          {(task.rounds ?? []).map((round, index) => (
            <RoundDivider key={round.number} round={round} first={index === 0} />
          ))}
        </div>
      </Specimen>
      <Specimen label='RoundsPanel · the Overview’s earlier rounds, folded and readable, and the rounds waiting to start'>
        <div className='w-full max-w-xl'>
          <RoundsPanel
            state={state}
            task={task}
            onOpen={() => acknowledgeSample()}
            onShippingChange={acknowledgeSample}
          />
        </div>
      </Specimen>
    </>
  );
}

function QueueSpecimens({ now }: { now: number }) {
  const [one] = React.useState(() => createSampleQueueTask(now, 1));
  const [several] = React.useState(() => createSampleQueueTask(now, 3));
  return (
    <>
      <Specimen label='MessageQueue · one queued message, docked above the composer'>
        <div className='w-full max-w-xl'>
          <Composer
            placeholder='Tell the agent something.'
            submitLabel='Send message'
            onSubmit={acknowledgeSample}
            dock={<MessageQueue task={one} onUpdate={acknowledgeSample} onRemove={acknowledgeSample} />}
          />
        </div>
      </Specimen>
      <Specimen label='MessageQueue · several queued messages, each one editable and removable until it sends'>
        <div className='w-full max-w-xl'>
          <MessageQueue task={several} onUpdate={acknowledgeSample} onRemove={acknowledgeSample} />
        </div>
      </Specimen>
    </>
  );
}

function IconColumnGuide() {
  return (
    <span aria-hidden className='pointer-events-none absolute inset-y-0 start-0 flex ps-(--chat-inset)'>
      <span className='flex w-5 justify-center'>
        <span className='w-px bg-primary-a3' />
      </span>
    </span>
  );
}

function IconColumnSpecimen({ view }: { view: DelegationView | undefined }) {
  const [calls] = React.useState(createSampleChatCalls);
  const [now] = React.useState(Date.now);
  const [run] = React.useState(() =>
    createSampleRun(now, {
      id: 'answerer',
      taskId: 'sample',
      role: 'answerer',
      endedAt: now,
      outcome: 'completed',
    })
  );
  return (
    <Specimen label='One icon column · chat lines, the hand-over and delegation cards between them, and an Overview panel: every icon sits in a 20px slot on the card’s 12px inset (13px into the chat column: the border and the inset), every title 8px after its icon. The line marks the column'>
      <div className={cn(CHAT_COLUMN, 'relative flex w-full max-w-xl flex-col gap-4')}>
        <IconColumnGuide />
        <ChatLine
          className={CHAT_INSET}
          icon='IconBubbleText'
          label='Answerer'
          meta='Answered your question'
        />
        <div className={CHAT_INSET}>
          <FoldLine open={false} onToggle={() => undefined} label='Worked for 12s' meta='1 step' />
        </div>
        <HandoverCard call={calls.ask} run={run} live={false} />
        {view && (
          <DelegationSpawnCard
            view={view}
            conversation={(opened) => <DelegatedConversation view={opened} />}
            onStop={acknowledgeSample}
          />
        )}
        <Panel
          persistId={createDisclosureId('ui', 'chat', 'panel', 'activity')}
          title='Activity'
          icon='IconClock'
        >
          <div className='flex items-center gap-3 text-fg-3 text-xs'>
            <StatusTile icon='IconBubbleText' tone='blue' />
            Answered the question
          </div>
          <div className='flex items-center gap-3 text-fg-3 text-xs'>
            <StatusTile icon='IconArrowRight' tone='neutral' />
            Answering the question
          </div>
        </Panel>
      </div>
    </Specimen>
  );
}

function LineSpecimens({ now, notices }: { now: number; notices: TimelineItemOf<QuietNoticeKind>[] }) {
  const [calls] = React.useState(createSampleChatCalls);
  const [revised] = React.useState(() => {
    const task = createOverviewScene(now).tasks.plan;
    return { task, call: createSampleRevisionCall(task) };
  });
  const [run] = React.useState(() =>
    createSampleRun(now, {
      id: 'agent',
      taskId: 'sample',
      purpose: 'plan',
      endedAt: now,
      outcome: 'completed',
    })
  );
  const { open, toggle } = useDisclosure(createDisclosureId('ui', 'chat', 'lines', 'worked'), true);
  const briefId = useDisclosureScope('lines', 'brief');
  const groupId = useDisclosureScope('lines', 'group');
  const loaded = notices.find((item) => item.kind === 'extensions');
  return (
    <>
      <Specimen label='Chat lines · one anatomy for every one-line row in a run: the role header, a notice, the worked-for fold, the brief, tool rows, a hand-over Shinsa handed back and the agent retried'>
        <div className='flex w-full max-w-xl flex-col gap-4'>
          <ChatLine icon='IconAgent' label='Agent' meta='Planned 4 phases · christo@example.com' />
          {loaded && <NoticeLine item={loaded} />}
          <div className='flex min-w-0 flex-col'>
            <FoldLine open={open} onToggle={toggle} label='Worked for 58s' meta='8 steps' />
            {open && (
              <DetailRail className='pb-0'>
                <div className='flex min-w-0 flex-col gap-4'>
                  <ExpandRow persistId={briefId} icon='IconFileText' label='Brief from Shinsa'>
                    <Markdown text='List the projects Shinsa knows.' className='prose-chat' />
                  </ExpandRow>
                  <ToolGroup persistId={groupId} calls={calls.work} live={false} />
                  <ToolRow call={calls.retried} live={false} />
                </div>
              </DetailRail>
            )}
          </div>
        </div>
      </Specimen>
      <Specimen label='Hand-over cards · one header: a question you answered, the steps set, and a hand-over that failed for good (the only red)'>
        <div className='flex w-full max-w-xl flex-col gap-4'>
          <HandoverCard call={calls.ask} run={run} live={false} />
          <HandoverCard call={calls.reshape} run={run} live={false} />
          <HandoverCard call={calls.failed} run={run} live={false} />
        </div>
      </Specimen>
      <Specimen label='Hand-over cards · a revised plan: what changed above the goal, its new and reworked phases tagged, the same as the plan gate'>
        <div className='flex w-full max-w-xl flex-col gap-4'>
          <HandoverCard call={revised.call} run={run} live={false} task={revised.task} />
        </div>
      </Specimen>
    </>
  );
}

export function ChatSpecimens() {
  return (
    <DisclosureScope value={createDisclosureId('ui', 'chat')}>
      <ChatSpecimenList />
    </DisclosureScope>
  );
}

const SAMPLE_SCREENSHOT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#f4f4f5"/><rect width="320" height="36" fill="#e4e4e7"/><rect x="16" y="12" width="80" height="12" rx="3" fill="#a1a1aa"/><rect x="16" y="28" width="120" height="16" rx="3" fill="#3b82f6"/><rect x="16" y="64" width="288" height="12" rx="3" fill="#d4d4d8"/><rect x="16" y="88" width="220" height="12" rx="3" fill="#d4d4d8"/><rect x="16" y="112" width="250" height="12" rx="3" fill="#d4d4d8"/></svg>'
)}`;

const DELIVERY_REPLAY_MS = 2_400;

function DeliveryReplay() {
  const [delivering, setDelivering] = React.useState(true);
  React.useEffect(() => {
    const timer = setInterval(() => setDelivering((current) => !current), DELIVERY_REPLAY_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <UserMessage
      persistId={createDisclosureId('ui', 'chat', 'message', 'replay')}
      text='Delivering, then delivered, again and again.'
      status={delivering ? 'delivering' : undefined}
    />
  );
}

function SampleMessages() {
  const sample = (name: string) => createDisclosureId('ui', 'chat', 'message', name);
  return (
    <div className='flex w-full max-w-xl flex-col gap-2'>
      <UserMessage persistId={sample('delivered')} text='Use the cheaper plan.' />
      <UserMessage
        persistId={sample('attachments')}
        text={serializeAttachments('The header overlaps the toolbar here, and the log is attached.', [
          {
            kind: 'image',
            name: 'settings.png',
            url: SAMPLE_SCREENSHOT,
            path: '/Users/you/Desktop/settings.png',
            mimeType: 'image/png',
            size: 48_213,
          },
          {
            kind: 'file',
            name: 'checks.txt',
            url: '/api/attachments/sample/checks.txt',
            path: '/Users/you/Desktop/checks.txt',
            mimeType: 'text/plain',
            size: 1_204,
          },
        ])}
      />
      <UserMessage
        persistId={sample('files')}
        text={serializeAttachments(
          '',
          [
            ['Payments spec.pdf', 'application/pdf', 1_830_000],
            ['Q3 revenue.xlsx', null, 284_000],
            ['Launch deck.key', null, 12_400_000],
            ['Brief.docx', null, 96_000],
            ['build-logs.zip', 'application/zip', 4_200_000],
            ['paywall.ts', 'text/plain', 3_400],
            ['walkthrough.mp4', 'video/mp4', 22_100_000],
            ['notes.txt', 'text/plain', 820],
          ].map(([name, mimeType, size]) => ({
            kind: 'file' as const,
            name: String(name),
            url: `/api/attachments/sample/${name}`,
            path: `/Users/you/Desktop/${name}`,
            mimeType: mimeType === null ? null : String(mimeType),
            size: Number(size),
          }))
        )}
      />
      <UserMessage
        persistId={sample('delivering')}
        text='Also add search to the settings page.'
        status='delivering'
      />
      <UserMessage
        persistId={sample('delivering-long')}
        text={
          'Keep the old endpoint for a release.\nLog a warning when a client still calls it, with the client name.'
        }
        status='delivering'
      />
      <DeliveryReplay />
      <UserMessage persistId={sample('noted')} text='Thanks!' status='noted' />
      <UserMessage
        persistId={sample('undelivered')}
        text='One more thing.'
        status='undelivered'
        reason='This task is finished. Start a new one.'
      />
    </div>
  );
}

function ChatSpecimenList() {
  const [now] = React.useState(Date.now);
  const [views] = React.useState(() => createDelegationViews(now));
  const [notices] = React.useState(() => createNoticeItems(now));
  const ended = views.filter((view) => !view.live);
  return (
    <>
      <IconColumnSpecimen view={views.find((view) => !view.live)} />
      <LineSpecimens now={now} notices={notices} />
      <RoundSpecimens now={now} />
      <Specimen label='Delegation spawn cards · working, waiting for its delegations, asked a question, finished, failed, stopped'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          {views.map((view) => (
            <DelegationSpawnCard
              key={view.run.id}
              view={view}
              conversation={(opened) => <DelegatedConversation view={opened} />}
              onStop={acknowledgeSample}
            />
          ))}
        </div>
      </Specimen>
      <Specimen label='Delegation report rows · reported back, failed, stopped (the chevron opens the result)'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          {ended.map((view) => (
            <DelegationReportRow key={view.run.id} view={view} />
          ))}
        </div>
      </Specimen>
      <Specimen label='UserMessage · delivered, with attachments, every kind of file, delivering at half opacity with the blue light going round (one line, several lines, then delivered on a loop), noted with no reply, not delivered'>
        <SampleMessages />
      </Specimen>
      <QueueSpecimens now={now} />
      <Specimen label='NoticeLine · account switched, compaction, fast mode, what a run loaded, session restored, provider switch (open a row for why)'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          {notices.map((item) => (
            <NoticeLine key={item.key} item={item} />
          ))}
        </div>
      </Specimen>
      <Specimen label='ContextGauge · the context meter in the composer footer, neutral, amber from 75%, red from 90%'>
        {CONTEXT_TOKENS.map((usedTokens) => {
          const meter = resolveContextMeter({
            kind: 'context',
            usedTokens,
            maxTokens: 200_000,
            totalProcessedTokens: null,
          });
          return meter && <ContextGauge key={usedTokens} meter={meter} />;
        })}
      </Specimen>
    </>
  );
}
