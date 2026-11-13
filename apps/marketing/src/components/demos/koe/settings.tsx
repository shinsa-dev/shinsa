import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Kbd, KbdGroup } from '@shinsa/ui/components/kbd';
import { Switch } from '@shinsa/ui/components/switch';
import * as React from 'react';
import { DemoRoot } from '../frame.tsx';

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className='flex flex-col gap-2'>
      <div className='flex flex-col px-1'>
        <h3 className='text-sm font-medium text-fg-4'>{title}</h3>
        {description && <p className='text-xs text-fg-2'>{description}</p>}
      </div>
      <div className='flex flex-col divide-y divide-bg-3 rounded-xl border border-bg-3 bg-background px-3'>
        {children}
      </div>
    </section>
  );
}

function Row({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className='flex min-h-11 items-center gap-4 py-2'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='text-sm text-fg-4'>{title}</span>
        {detail && <span className='text-xs text-fg-2'>{detail}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, initial }: { label: string; initial: boolean }) {
  const [checked, setChecked] = React.useState(initial);
  return <Switch aria-label={label} checked={checked} onCheckedChange={setChecked} />;
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

export function KoeSettingsDemo() {
  return (
    <DemoRoot>
      <div className='corner-superellipse/1.125 flex h-full flex-col overflow-hidden rounded-2xl bg-sidebar ring-1 ring-bg-4/70 dark:ring-bg-3'>
        <div className='flex h-9 shrink-0 items-center gap-1.5 px-3'>
          <span className='size-2.5 rounded-full bg-red-4' />
          <span className='size-2.5 rounded-full bg-yellow-4' />
          <span className='size-2.5 rounded-full bg-green-4' />
        </div>
        <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-hidden mask-b-from-90% px-6 pb-6'>
          <div className='flex items-center gap-3'>
            <img src='/koe/koe.svg' alt='' width='44' height='44' className='size-11' />
            <div className='flex flex-col'>
              <span className='text-lg font-medium text-fg-4'>Koe</span>
              <span className='text-sm text-fg-2'>Talk, point and paste. Everything stays on this Mac.</span>
            </div>
          </div>
          <Group title='Dictation' description='Click a shortcut, then press the keys you want.'>
            <Row title='Start or finish dictation'>
              <Keys keys={['fn']} />
            </Row>
            <Row
              title='Comment with ⇧⌘-click'
              detail='Say the comment after the click. Off, the click goes to the app, such as a new tab.'
            >
              <Toggle label='Comment with ⇧⌘-click' initial />
            </Row>
          </Group>
          <Group
            title='Transcription'
            description='Models run on this Mac. Downloads come from Hugging Face; what you say never leaves it.'
          >
            <Row title='Model' detail='25 European languages · On this Mac'>
              <Button variant='outline' size='sm' tabIndex={-1}>
                Parakeet v3
                <Icon name='IconChevronDownMedium' />
              </Button>
            </Row>
          </Group>
          <Group title='While you dictate' description='These shortcuts only work during a session.'>
            <Row title='Take a screenshot'>
              <Keys keys={['⌥', '⇧', 'S']} />
            </Row>
            <Row title='Comment on something'>
              <Keys keys={['⌥', '⇧', 'C']} />
            </Row>
            <Row title='Record a clip'>
              <Keys keys={['⌥', '⇧', 'R']} />
            </Row>
            <Row
              title='Pause audio while you dictate'
              detail='Music and videos pause as you start and play again when you finish.'
            >
              <Toggle label='Pause audio while you dictate' initial />
            </Row>
          </Group>
          <Group title='When you finish'>
            <Row
              title='Copy attachments with the text'
              detail='Screenshots, clips and files paste in after your words.'
            >
              <Toggle label='Copy attachments with the text' initial />
            </Row>
            <Row
              title='Paste everything with one ⌘V'
              detail='Your words go in, then Koe pastes the attachments.'
            >
              <Toggle label='Paste everything with one ⌘V' initial />
            </Row>
            <Row title='Paste for you' detail='Presses ⌘V in the app you’re in.'>
              <Toggle label='Paste for you' initial={false} />
            </Row>
          </Group>
        </div>
      </div>
    </DemoRoot>
  );
}
