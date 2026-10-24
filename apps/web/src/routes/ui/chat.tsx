import * as React from 'react';
import { ContextGauge } from '@/components/chat/context-meter.tsx';
import { DelegationReportRow, DelegationSpawnCard } from '@/components/chat/delegation-card.tsx';
import { NoticeLine } from '@/components/chat/notice-line.tsx';
import { RoundHeader } from '@/components/chat/round-header.tsx';
import { RoundsPanel } from '@/components/overview/rounds-panel.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { resolveContextMeter } from '@/lib/chat/context.ts';
import { type DelegationView, selectDelegation } from '@/lib/chat/delegations.ts';
import type { QuietNoticeKind, TimelineItemOf } from '@/lib/chat/timeline.ts';
import { createSampleDelegations } from './sample-delegations.ts';
import { acknowledgeSample, createSampleRoundsTask, createSampleState } from './samples.ts';
import { Specimen } from './section.tsx';

const CONTEXT_TOKENS = [48_000, 156_000, 188_000];

function createNoticeItems(now: number): TimelineItemOf<QuietNoticeKind>[] {
  return [
    { kind: 'account', key: 'account', at: now, email: 'christo@example.com', reason: 'usage_limit' },
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
  const [open, setOpen] = React.useState<Record<number, boolean>>({ 3: true, 4: true });
  return (
    <>
      <Specimen label='RoundHeader · a chat section per round: earlier rounds on their pull request, the current round with its progress, a round waiting with how it ships'>
        <div className='flex w-full max-w-xl flex-col'>
          {(task.rounds ?? []).map((round) => (
            <RoundHeader
              key={round.number}
              task={task}
              round={round}
              open={open[round.number] === true}
              onToggle={() => setOpen((current) => ({ ...current, [round.number]: !current[round.number] }))}
              onShippingChange={acknowledgeSample}
              className='border-border border-b'
            />
          ))}
        </div>
      </Specimen>
      <Specimen label='RoundsPanel · the Overview’s earlier rounds, folded and readable, and the rounds waiting to start'>
        <div className='w-full max-w-xl'>
          <RoundsPanel task={task} onShippingChange={acknowledgeSample} />
        </div>
      </Specimen>
    </>
  );
}

export function ChatSpecimens() {
  const [now] = React.useState(Date.now);
  const [views] = React.useState(() => createDelegationViews(now));
  const [notices] = React.useState(() => createNoticeItems(now));
  const ended = views.filter((view) => !view.live);
  return (
    <>
      <RoundSpecimens now={now} />
      <Specimen label='Delegation spawn cards · working, waiting for its delegated tasks, asked a question, finished, failed, stopped'>
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
      <Specimen label='NoticeLine · account switched, compaction, fast mode, what a run loaded, session restored, provider switch (hover for why)'>
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
