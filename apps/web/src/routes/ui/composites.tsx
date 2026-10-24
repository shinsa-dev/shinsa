import { type OnboardingCheck, PROJECT_COLORS, TASK_PRIORITIES } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { DropdownMenu } from '@shinsa/ui/components/dropdown-menu';
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
import { CARD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { OnboardingChecks } from '@/components/onboarding/checks.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { InfoHeader, InfoPopover, InfoRow, InfoSection } from '@/components/overlays/info-popover.tsx';
import { CheckMark, CheckOutcomeIcon, SelectedMark } from '@/components/status/check-mark.tsx';
import { HealthCard } from '@/components/status/health-banner.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { ProjectDot } from '@/components/status/project-dot.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { Duration, TimeAgo } from '@/components/text/time-ago.tsx';
import { resolveHealthBanner } from '@/lib/connection/health.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { AUTO_CHOICES, type NewTaskChoices } from '@/lib/new-task.ts';
import { MERGE_ITEMS } from '@/lib/settings.ts';
import { ROADMAP_GROUPS } from '@/lib/tasks/roadmap.ts';
import { acknowledgeSample, createSampleState, createSampleTask, HOUR } from './samples.ts';
import { Specimen } from './section.tsx';

const TONES: Tone[] = ['neutral', 'blue', 'amber', 'orange', 'green', 'red', 'purple'];

const SAMPLE_CODE = `export function resolveQueueStep(order: string[], taskId: string) {
  const index = order.indexOf(taskId);
  return { previousId: order[index - 1] ?? null, nextId: order[index + 1] ?? null };
}`;

const SAMPLE_CHECKS: OnboardingCheck[] = [
  { id: 'git', label: 'git', ok: true, detail: 'git 2.47.0', fix: null },
  {
    id: 'gh',
    label: 'GitHub CLI',
    ok: false,
    detail: 'gh is not signed in.',
    fix: 'Run `gh auth login`, then check again.',
  },
  { id: 'codex', label: 'Codex', ok: false, detail: 'Not installed.', fix: null, optional: true },
];

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

function SetupSpecimens() {
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <>
      <Specimen label='ChoiceButtons · one answer: none starts picked; several answers: pressed while picked'>
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
      <Specimen label='OnboardingChecks · passed, failed with its fix, optional and missing'>
        <div className='w-full max-w-xl'>
          <OnboardingChecks checks={SAMPLE_CHECKS} />
        </div>
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
            <PriorityIcon priority={priority} className='size-3.5' />
            {PRIORITY_LABEL[priority]}
          </span>
        ))}
        {PROJECT_COLORS.map((color) => (
          <ProjectDot key={color} color={color} label={color} />
        ))}
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
            title='What changed'
            icon='IconCodeLines'
            action={
              <Button variant='link' size='sm'>
                Review the code
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
      <SetupSpecimens />
      {health && (
        <Specimen label='HealthCard · the health banner, two damaged log entries; hover Details'>
          <div className='w-full max-w-xl'>
            <HealthCard banner={health} onDismiss={() => void acknowledgeSample()} />
          </div>
        </Specimen>
      )}
    </>
  );
}
