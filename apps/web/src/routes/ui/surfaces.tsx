import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shinsa/ui/components/card';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Kbd, KbdGroup } from '@shinsa/ui/components/kbd';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { ScrollFade } from '@shinsa/ui/components/scroll-fade';
import { Separator } from '@shinsa/ui/components/separator';
import { SizeAnimator } from '@shinsa/ui/components/size-animator';
import { Spinner } from '@shinsa/ui/components/spinner';
import { useState } from 'react';
import { Section, Specimen } from './section.tsx';

export const SURFACE_SECTIONS = [
  { id: 'card', label: 'Card' },
  { id: 'kbd', label: 'Kbd & Separator' },
  { id: 'loading', label: 'Spinner' },
  { id: 'empty-state', label: 'Empty state' },
  { id: 'scroll', label: 'Scrolling' },
  { id: 'motion', label: 'Size animator' },
];

const SCROLL_ROWS = Array.from({ length: 16 }, (_, i) => ({
  id: `row-${i + 1}`,
  label: `Task #${i + 1}`,
}));

const FADE_ROWS = Array.from({ length: 16 }, (_, i) => ({
  id: `fade-${i + 1}`,
  label: `Plain container #${i + 1}`,
}));

export function SurfaceSpecimens() {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <Section
        id='card'
        title='Card'
        description='Header / content / footer, with an optional action slot.'
        className='items-stretch'
      >
        <Card className='max-w-sm'>
          <CardHeader>
            <CardTitle>Project name</CardTitle>
            <CardDescription>Shown on the project switcher and in the briefing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input defaultValue='Superwall' />
          </CardContent>
          <CardFooter>
            <span className='text-fg-2 text-sm'>Max. 100 characters</span>
            <Button size='xs'>Save</Button>
          </CardFooter>
        </Card>
        <Card className='max-w-sm'>
          <CardHeader divider>
            <CardTitle>Recently merged</CardTitle>
          </CardHeader>
          <ul className='flex flex-col py-1'>
            {(
              [
                ['Drop the access gate', 'docs #339', '14 min'],
                ['Bump the agent SDK', 'kanna #91', '2 h'],
                ['Fix tab group scroll', 'kanna #88', 'Yesterday'],
              ] as const
            ).map(([title, pr, when]) => (
              <li key={title} className='flex items-center gap-2.5 px-4 py-2'>
                <Icon name='IconMerged' className='size-4 shrink-0 text-purple-4' />
                <span className='min-w-0 flex-1 truncate text-fg-4 text-sm'>{title}</span>
                <span className='shrink-0 text-fg-2 text-xs tabular-nums'>
                  {pr} · {when}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className='max-w-xs'>
          <CardHeader>
            <CardTitle>Checks</CardTitle>
            <CardDescription>3 passing, 1 failing.</CardDescription>
            <CardAction>
              <Badge variant='red' size='sm'>
                1 failing
              </Badge>
            </CardAction>
          </CardHeader>
        </Card>
        <Card className='max-w-52 cursor-pointer transition-shadow hover:shadow-md'>
          <CardHeader>
            <div className='mb-2 flex size-6 items-center justify-center rounded-md bg-bg-2 shadow-1'>
              <Icon name='IconMerged' className='size-3.5 text-fg-3' />
            </div>
            <CardTitle>Merged</CardTitle>
            <CardDescription>6 this week</CardDescription>
          </CardHeader>
        </Card>
      </Section>
      <Section id='kbd' title='Kbd & Separator'>
        <Specimen label='kbd'>
          <Kbd>N</Kbd>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Specimen>
        <Specimen label='separator'>
          <div className='flex w-48 flex-col gap-2'>
            <span className='text-fg-3 text-sm'>Above</span>
            <Separator />
            <span className='text-fg-3 text-sm'>Below</span>
          </div>
          <div className='flex h-10 items-center gap-3'>
            <span className='text-fg-3 text-sm'>Left</span>
            <Separator orientation='vertical' />
            <span className='text-fg-3 text-sm'>Right</span>
          </div>
        </Specimen>
      </Section>
      <Section
        id='loading'
        title='Spinner'
        description='A spinner means the app is working. A page never spins: its title, description, filters and static buttons paint on the first frame, and only what is actually loading waits.'
        className='flex-col items-stretch'
      >
        <Specimen label='spinner'>
          <Spinner />
          <Spinner className='size-5 text-fg-2' />
          <Button disabled>
            <Spinner className='size-4' />
            Saving…
          </Button>
        </Specimen>
      </Section>
      <Section
        id='empty-state'
        title='Empty state'
        description='One treatment for every blank slate: a glyph in a soft tile, a title, one line saying what the place is, and at most one action. Never hand-roll another.'
        className='flex-col items-stretch'
      >
        <Specimen label='nothing here yet'>
          <div className='flex min-h-56 w-full max-w-md flex-col rounded-2xl bg-bg-2/40'>
            <EmptyState
              icon='IconInboxEmpty'
              title='Nothing needs you'
              description='Agents are working. You see a task again when it needs a decision.'
            />
          </div>
        </Specimen>
        <Specimen label='with an action'>
          <div className='flex min-h-56 w-full max-w-md flex-col rounded-2xl bg-bg-2/40'>
            <EmptyState
              icon='IconExclamationCircle'
              title='Unable to read the changes'
              description='The worktree for this task is gone.'
            >
              <Button variant='outline' size='sm'>
                Try again
              </Button>
            </EmptyState>
          </div>
        </Specimen>
        <Specimen label='title only'>
          <div className='flex min-h-56 w-full max-w-md flex-col rounded-2xl bg-bg-2/40'>
            <EmptyState icon='IconInboxEmpty' title='Select a task' />
          </div>
        </Specimen>
        <Specimen label='size sm · inside a card section'>
          <div className='w-80'>
            <Card>
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
              </CardHeader>
              <EmptyState
                size='sm'
                icon='IconImages1'
                title='No evidence yet'
                description='Screenshots, recordings and test runs the agent attaches appear here.'
              />
            </Card>
          </div>
        </Specimen>
      </Section>
      <Section
        id='scroll'
        title='Scrolling'
        description='ScrollArea adds a custom auto-hiding scrollbar; ScrollFade is the same edge masking for a plain container. Both fade only on the side with more content.'
        className='items-start'
      >
        <div className='flex flex-col gap-2'>
          <span className='text-fg-2 text-xs'>ScrollArea</span>
          <ScrollArea className='h-40 w-64 rounded-xl bg-bg-2 p-3'>
            <div className='flex flex-col gap-2'>
              {SCROLL_ROWS.map((row) => (
                <div key={row.id} className='text-fg-3 text-sm'>
                  {row.label}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div className='flex flex-col gap-2'>
          <span className='text-fg-2 text-xs'>ScrollFade</span>
          <ScrollFade className='h-40 w-64 rounded-xl bg-bg-2 p-3'>
            <div className='flex flex-col gap-2'>
              {FADE_ROWS.map((row) => (
                <div key={row.id} className='text-fg-3 text-sm'>
                  {row.label}
                </div>
              ))}
            </div>
          </ScrollFade>
        </div>
      </Section>
      <Section
        id='motion'
        title='Size animator'
        description='Transitions height changes instead of snapping. Use around popup content that grows or filters.'
        className='flex-col items-start'
      >
        <Button variant='outline' onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
        <SizeAnimator className='w-72 rounded-xl bg-bg-2'>
          <div className='flex flex-col gap-2 p-3'>
            <span className='text-fg-3 text-sm'>Always visible</span>
            {expanded && (
              <>
                <span className='text-fg-3 text-sm'>Revealed row one</span>
                <span className='text-fg-3 text-sm'>Revealed row two</span>
                <span className='text-fg-3 text-sm'>Revealed row three</span>
              </>
            )}
          </div>
        </SizeAnimator>
      </Section>
    </>
  );
}
