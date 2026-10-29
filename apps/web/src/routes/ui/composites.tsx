import { PROJECT_COLORS, TASK_PRIORITIES } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { DropdownMenu } from '@shinsa/ui/components/dropdown-menu';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { ChoiceButton, ChoiceButtons } from '@/components/controls/choice-buttons.tsx';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { NewTaskFields } from '@/components/home/new-task-form.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { CARD, COMPOSER_FOOTER, INSET } from '@/components/layout/surface/card.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { RepoChip, RepoIcon } from '@/components/links/repo.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { InfoHeader, InfoPopover, InfoRow, InfoSection } from '@/components/overlays/info-popover.tsx';
import { CheckMark, CheckOutcomeIcon, SelectedMark } from '@/components/status/check-mark.tsx';
import { EngineCard } from '@/components/status/engine-banner.tsx';
import { HealthCard } from '@/components/status/health-banner.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { ProjectDot } from '@/components/status/project-dot.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { UpdateButtonView } from '@/components/status/update-button.tsx';
import { CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { CodeDiff } from '@/components/text/code-diff.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { InsetNote, SuggestedFix } from '@/components/text/inset-note.tsx';
import { Duration, TimeAgo } from '@/components/text/time-ago.tsx';
import type { DiffSource } from '@/lib/code/diff-view.ts';
import { resolveEngineView } from '@/lib/connection/engine.ts';
import { resolveHealthBanner } from '@/lib/connection/health.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_EDGE, TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { AUTO_CHOICES, type NewTaskChoices } from '@/lib/new-task.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { MERGE_ITEMS } from '@/lib/settings.ts';
import { ROADMAP_GROUPS } from '@/lib/tasks/roadmap.ts';
import { acknowledgeSample, createSampleState, createSampleTask, HOUR } from './samples.ts';
import { Specimen } from './section.tsx';

const DIFF_SAMPLES: DiffSource[] = [
  {
    kind: 'files',
    path: 'src/session.ts',
    before: 'export function openSession(chat: Chat) {\n  return connect(chat.id);\n}',
    after:
      'export function openSession(chat: Chat, server: McpServer) {\n  return connect(chat.id, server.url);\n}',
  },
  {
    kind: 'files',
    path: 'src/limits.ts',
    before: null,
    after: 'export const MAX_SESSIONS = 4;\nexport const IDLE_MS = 60_000;',
  },
  {
    kind: 'patch',
    path: 'src/mcp/session.ts',
    previousPath: 'src/session.ts',
    hunks:
      '@@ -1,2 +1,2 @@\n-import { connect } from "./net";\n+import { connect } from "../net";\n export { connect };',
    binary: false,
  },
  { kind: 'patch', path: 'docs/session.png', previousPath: null, hunks: '', binary: true },
];

const TONES: Tone[] = ['neutral', 'blue', 'amber', 'orange', 'green', 'red', 'purple'];

const SAMPLE_CODE = `export function resolveQueueStep(order: string[], taskId: string) {
  const index = order.indexOf(taskId);
  return { previousId: order[index - 1] ?? null, nextId: order[index + 1] ?? null };
}`;

function ConfirmSpecimen() {
  const dialog = useDialogState<'remove'>();
  return (
    <>
      <Button variant='outline' size='sm' onClick={() => dialog.show('remove')}>
        Remove account
      </Button>
      <ConfirmDialog
        control={dialog.control}
        title='Remove agents@superwall.com?'
        body='Shinsa signs this account out. Runs on it move to the next account.'
        action='Remove account'
        onConfirm={() => void acknowledgeSample()}
      />
    </>
  );
}

function RepoMarkSpecimen() {
  const [state] = React.useState(() => ({
    ...createSampleState({ tasks: [] }),
    projects: {
      sw: { id: 'sw', name: 'Superwall', color: 'purple', key: 'SW', description: '', folders: [] },
    },
    repos: Object.fromEntries(
      [
        {
          id: 'web',
          name: 'paywall-next',
          projectId: 'sw',
          remote: 'git@github.com:superwall/paywall-next.git',
        },
        { id: 'docs', name: 'superwall-docs', projectId: 'sw', remote: null },
        { id: 'scratch', name: 'scratch', projectId: null, remote: null },
      ].map((repo) => [
        repo.id,
        { ...repo, path: `~/Developer/${repo.name}`, defaultBranch: 'main', checkCommands: [] },
      ])
    ),
  }));
  return (
    <span className='flex flex-col gap-1.5 text-fg-2 text-xs'>
      {Object.values(state.repos).map((repo) => (
        <span key={repo.id} className='flex items-center gap-3'>
          <span className='flex items-center gap-1.5'>
            <RepoIcon state={state} repo={repo} icon='IconFolder1' />
            {repo.name}
          </span>
          <RepoChip state={state} repo={repo} />
        </span>
      ))}
    </span>
  );
}

function ComposerSpecimen() {
  const [state] = React.useState(() =>
    createSampleState({
      tasks: [createSampleTask(Date.now(), { id: 'login', title: 'Fix the login redirect' })],
    })
  );
  const [chosen, setChosen] = React.useState<NewTaskChoices>(AUTO_CHOICES);
  return (
    <div className={cn(CARD, 'w-full max-w-xl')}>
      <div className={cn(COMPOSER_FOOTER, 'flex-wrap')}>
        <NewTaskFields
          state={state}
          chosen={chosen}
          onChoose={(part) => setChosen((current) => ({ ...current, ...part }))}
        />
      </div>
    </div>
  );
}

function ChoiceSpecimens() {
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <>
      <Specimen label='ChoiceButtons · an agent’s question: none starts picked; several answers: pressed while picked'>
        <ChoiceButtons>
          {['Squash', 'Rebase', 'Merge commit'].map((label) => (
            <ChoiceButton key={label} option={{ label }} onClick={() => void acknowledgeSample()} />
          ))}
        </ChoiceButtons>
        <ChoiceButtons>
          {['~/Developer', '~/oss'].map((label) => (
            <ChoiceButton
              key={label}
              option={{ label, detail: '12 repositories' }}
              pressed={picked === label}
              onClick={() => setPicked(picked === label ? null : label)}
            />
          ))}
        </ChoiceButtons>
      </Specimen>
      <Specimen label='ConfirmDialog · every remove asks first'>
        <ConfirmSpecimen />
      </Specimen>
      <Specimen label='Home composer · Project, When to start and Priority'>
        <ComposerSpecimen />
      </Specimen>
    </>
  );
}

export function CompositeSpecimens() {
  const [tab, setTab] = React.useState<'overview' | 'code' | 'chat'>('overview');
  const [merge, setMerge] = React.useState(MERGE_ITEMS[0]?.value ?? 'squash');
  const [now] = React.useState(Date.now);
  const [health] = React.useState(() =>
    resolveHealthBanner(
      {
        ok: false,
        seq: 412,
        problems: [
          { seq: 41, type: 'task.staged', kind: 'unreadable', error: 'Unexpected end of JSON input' },
          { seq: 208, type: 'gate.answered', kind: 'unappliable', error: 'Gate g-12 is not open.' },
        ],
      },
      null
    )
  );
  return (
    <>
      <Specimen label='PageHeading · SectionLabel'>
        <div className='flex w-full max-w-md flex-col gap-6'>
          <PageHeading title='All tasks' description='19 open · 2 done' />
          <SectionLabel
            count={3}
            action={
              <Button size='sm' variant='secondary'>
                New project
              </Button>
            }
          >
            Projects
          </SectionLabel>
        </div>
      </Specimen>
      <Specimen label='Status tiles, one per roadmap group'>
        {ROADMAP_GROUPS.map((group) => (
          <StatusTile key={group.key} icon={group.icon} tone={group.tone} label={group.title} />
        ))}
      </Specimen>
      <Specimen label='Tones · Pulse'>
        {TONES.map((tone) => (
          <span key={tone} className={cn('flex items-center gap-1.5 text-xs', TONE_TEXT[tone])}>
            <Pulse tone={tone} />
            {tone}
          </span>
        ))}
      </Specimen>
      <Specimen label='Check marks · CheckOutcomeIcon'>
        <CheckMark label='Done' />
        <SelectedMark />
        <CheckOutcomeIcon outcome='pass' />
        <CheckOutcomeIcon outcome='fail' />
        <CheckOutcomeIcon outcome='skipped' />
      </Specimen>
      <Specimen label='Priority · project dots'>
        {TASK_PRIORITIES.map((priority) => (
          <span key={priority} className='flex items-center gap-1.5 text-fg-3 text-xs'>
            <PriorityIcon priority={priority} />
            {PRIORITY_LABEL[priority]}
          </span>
        ))}
        {PROJECT_COLORS.map((color) => (
          <ProjectDot key={color} color={color} label={color} />
        ))}
      </Specimen>
      <Specimen label='RepoIcon · RepoChip'>
        <RepoMarkSpecimen />
      </Specimen>
      <Specimen label='TimeAgo · Duration · DiffStats · FilePath'>
        <span className='text-fg-3 text-xs'>
          <TimeAgo at={now - 2 * HOUR} />
        </span>
        <span className='text-fg-3 text-xs'>
          <TimeAgo at={now - 2 * HOUR} compact detail='Waiting on you' />
        </span>
        <span className='text-fg-3 text-xs'>
          Worked for <Duration from={now - 3 * 60_000} to={now} />
        </span>
        <DiffStats added={12} removed={3} />
        <span className='w-56'>
          <FilePath path='apps/web/src/components/queue/queue.tsx' />
        </span>
      </Specimen>
      <Specimen label='Choice · SelectField · CopyButton · OptionsTrigger'>
        <Choice
          label='Task view'
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'code', label: 'Code' },
            { value: 'chat', label: 'Chat' },
          ]}
          value={tab}
          onValueChange={setTab}
        />
        <SelectField label='Merge with' items={MERGE_ITEMS} value={merge} onValueChange={setMerge} />
        <CopyButton text='feat/embedded-chat-mcp' />
        <DropdownMenu>
          <OptionsTrigger label='Task actions' />
        </DropdownMenu>
      </Specimen>
      <Specimen label='InfoPopover (hover)'>
        <InfoPopover
          className='w-64'
          render={<button type='button' className='cursor-pointer text-fg-3 text-xs underline' />}
          trigger='Pull request #4531'
        >
          <InfoHeader title='Pull request #4531' description='Open into main' />
          <InfoSection>
            <InfoRow icon='IconCheckCircle2Filled' label='CI checks' />
            <InfoRow icon='IconBubbleText' label='Unresolved comments' value='None' />
          </InfoSection>
        </InfoPopover>
      </Specimen>
      <Specimen label='ListRow in a card · Toolbar' className='items-start'>
        <div className={cn(CARD, 'w-80 p-1')}>
          <HoverHighlight className='flex flex-col gap-px'>
            <ListRow
              leading={<StatusTile icon='IconEyeOpen' tone='amber' label='Changes to review' />}
              title='Run the embedded chat on MCP v2'
              meta='Changes to review · The embedded chat now runs on MCP v2'
              trailing={<TimeAgo at={now - 26 * HOUR} compact />}
              onClick={() => undefined}
            />
            <ListRow
              leading={<StatusTile icon='IconHammer' tone='blue' label='Building' />}
              title='Stream MCP tool results'
              meta='Building · Make the change'
              onClick={() => undefined}
            />
          </HoverHighlight>
        </div>
        <div className={cn(CARD, 'w-80 overflow-hidden')}>
          <Toolbar>
            <FilePath path='src/chat/mcp-session.ts' />
            <span className='flex-1' />
            <Button variant='secondary' size='sm' icon='IconCode'>
              Open
            </Button>
          </Toolbar>
          <p className='p-3 text-fg-2 text-xs'>The code view sits under the toolbar.</p>
        </div>
      </Specimen>
      <Specimen label='Panel · StepNumber · CodeFence'>
        <div className='w-full max-w-xl'>
          <Panel
            persistId={createDisclosureId('ui', 'composites', 'panel')}
            title='What changed'
            icon='IconCodeLines'
            action={
              <Button variant='link' size='sm'>
                Open the review
              </Button>
            }
          >
            <div className='flex gap-2.5'>
              <StepNumber index={0} />
              <div className='flex min-w-0 flex-1 flex-col gap-2'>
                <span className='font-medium text-fg-4 text-xs'>Open an MCP session per chat</span>
                <CodeFence code={SAMPLE_CODE} language='ts' />
              </div>
            </div>
          </Panel>
        </div>
      </Specimen>
      <Specimen label='CodeBlock · its corner: Copy, and Run in terminal on a shell block marked run (```bash run) where a task can run it (the folder in its tooltip); one line centred at the right edge, several lines at the top right; Copy alone where nothing can run it; hover, focus or touch shows it'>
        <div className='w-full max-w-xl'>
          <CodeFence code='SESSION_IDLE_HOURS=0.0167 bun run dev' language='sh' runnable />
          <CodeFence code={'$ bun install\n$ bun run db:migrate\n$ bun run dev'} language='bash' runnable />
          <CommandRunnerProvider runner={null}>
            <CodeFence code='gh auth login' language='sh' runnable />
          </CommandRunnerProvider>
        </div>
      </Specimen>
      <Specimen label='CodeBlock · an example: a plain ```bash block, one that only opens on a $ prompt, or code, is copy-only; highlighted the same, copied without its prompts'>
        <div className='w-full max-w-xl'>
          <CodeFence code='bun test --watch apps/web/test/lib/code' language='bash' />
          <CodeFence code={'$ bun install\n$ bun run db:migrate\n$ bun run dev'} language={null} />
          <CodeFence code={SAMPLE_CODE} language='ts' />
        </div>
      </Specimen>
      <Specimen label='InsetNote · each tone on its own edge: a toned fill takes its tone’s border, never the grey hairline · SuggestedFix'>
        <div className='grid w-full max-w-xl gap-2'>
          {(Object.keys(TONE_EDGE) as Tone[]).map((tone) => (
            <InsetNote
              key={tone}
              tone={tone}
              icon='IconEyeSparkle'
              label={tone === 'neutral' ? 'A note' : `A ${tone} note`}
              text='The agent review disagrees: the retry should back off, not loop.'
            />
          ))}
          <SuggestedFix text='Wait 2 seconds before the next attempt and give up after five.' />
        </div>
      </Specimen>
      <Specimen label='CodeDiff · an edit, a new file, a renamed file and a binary file, each in the card it sits in'>
        <div className='grid w-full max-w-xl gap-2'>
          {DIFF_SAMPLES.map((source) => (
            <div key={source.path} className={cn(INSET, 'overflow-hidden bg-bg-a1')}>
              <CodeDiff source={source} numbered={source.kind === 'patch'} />
            </div>
          ))}
        </div>
      </Specimen>
      <ChoiceSpecimens />
      {health && (
        <Specimen label='HealthCard · the health banner, two damaged log entries; hover Details'>
          <div className='w-full max-w-xl'>
            <HealthCard banner={health} onDismiss={() => void acknowledgeSample()} />
          </div>
        </Specimen>
      )}
      <Specimen label='EngineCard · the app is newer than the engine, older than it, or waits for agents'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          {ENGINE_SAMPLES.map(({ key, view }) =>
            view.banner ? (
              <EngineCard key={key} banner={view.banner} onAction={() => void acknowledgeSample()} />
            ) : null
          )}
        </div>
      </Specimen>
      <Specimen label='UpdateButton · in the header once an update is downloaded; hover it'>
        <UpdateButtonView version='0.6.0' onClick={() => void acknowledgeSample()} />
      </Specimen>
    </>
  );
}

const ENGINE_APP = { version: '0.6.0', protocol: 2 };

const ENGINE_SAMPLES = [
  {
    key: 'waiting',
    health: {
      version: '0.5.2',
      protocol: 2,
      busy: true,
      working: 2,
      restart: 'idle' as const,
      restartBy: new Date(2026, 9, 29, 14, 32).getTime(),
    },
  },
  { key: 'choose', health: { version: '0.5.2', protocol: 1, busy: true, restart: null } },
  { key: 'update', health: { version: '0.7.0', protocol: 3, busy: false, restart: null } },
].map(({ key, health }) => ({
  key,
  view: resolveEngineView(ENGINE_APP, { ok: true, seq: 1, problems: [], ...health }, null),
}));
