import { ICON_NAMES, Icon, type IconSize } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { Section, Specimen } from './section.tsx';

export const TOKEN_SECTIONS = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'font-weights', label: 'Font weights' },
  { id: 'shadows', label: 'Shadows' },
  { id: 'icons', label: 'Icons' },
];

const SURFACES = [
  { name: 'bg-1', cls: 'bg-bg-1' },
  { name: 'bg-2', cls: 'bg-bg-2' },
  { name: 'bg-3', cls: 'bg-bg-3' },
  { name: 'bg-4', cls: 'bg-bg-4' },
];

const FOREGROUNDS = [
  { name: 'fg-1', cls: 'bg-fg-1' },
  { name: 'fg-2', cls: 'bg-fg-2' },
  { name: 'fg-3', cls: 'bg-fg-3' },
  { name: 'fg-4', cls: 'bg-fg-4' },
];

const ICON_INKS = [
  { name: 'icon-1', cls: 'bg-icon-1' },
  { name: 'icon-2', cls: 'bg-icon-2' },
  { name: 'icon-3', cls: 'bg-icon-3' },
  { name: 'icon-4', cls: 'bg-icon-4' },
];

const ICON_PAIRS = ['text-fg-1', 'text-fg-2', 'text-fg-3', 'text-fg-4', 'text-red-text', 'text-primary-text'];

const ICON_SIZES: { size: IconSize; text: string; label: string }[] = [
  { size: 'sm', text: 'text-xs', label: 'sm · 14 · 12–13px text, 22/24 controls' },
  { size: 'md', text: 'text-sm', label: 'md · 16 · 14px+ text, 26/30 controls' },
  { size: 'lg', text: 'text-base', label: 'lg · 20 · empty states, full-page waits' },
];

const ALPHAS = [
  { name: 'bg-a1', cls: 'bg-bg-a1' },
  { name: 'bg-a2', cls: 'bg-bg-a2' },
  { name: 'bg-a3', cls: 'bg-bg-a3' },
  { name: 'bg-a4', cls: 'bg-bg-a4' },
  { name: 'fg-a1', cls: 'bg-fg-a1' },
  { name: 'fg-a2', cls: 'bg-fg-a2' },
  { name: 'fg-a3', cls: 'bg-fg-a3' },
  { name: 'fg-a4', cls: 'bg-fg-a4' },
];

const RAMPS = [
  {
    name: 'primary, an alias of sky',
    steps: ['bg-primary-1', 'bg-primary-2', 'bg-primary-3', 'bg-primary-4'],
    chip: null,
  },
  {
    name: 'purple',
    steps: ['bg-purple-1', 'bg-purple-2', 'bg-purple-3', 'bg-purple-4'],
    chip: 'bg-purple-1 text-purple-text',
  },
  { name: 'sky', steps: ['bg-sky-1', 'bg-sky-2', 'bg-sky-3', 'bg-sky-4'], chip: 'bg-sky-1 text-sky-text' },
  {
    name: 'blue',
    steps: ['bg-blue-1', 'bg-blue-2', 'bg-blue-3', 'bg-blue-4'],
    chip: 'bg-blue-1 text-blue-text',
  },
  {
    name: 'green',
    steps: ['bg-green-1', 'bg-green-2', 'bg-green-3', 'bg-green-4'],
    chip: 'bg-green-1 text-green-text',
  },
  {
    name: 'amber',
    steps: ['bg-amber-1', 'bg-amber-2', 'bg-amber-3', 'bg-amber-4'],
    chip: 'bg-amber-1 text-amber-text',
  },
  {
    name: 'orange',
    steps: ['bg-orange-1', 'bg-orange-2', 'bg-orange-3', 'bg-orange-4'],
    chip: 'bg-orange-1 text-orange-text',
  },
  { name: 'red', steps: ['bg-red-1', 'bg-red-2', 'bg-red-3', 'bg-red-4'], chip: 'bg-red-1 text-red-text' },
  {
    name: 'pink',
    steps: ['bg-pink-1', 'bg-pink-2', 'bg-pink-3', 'bg-pink-4'],
    chip: 'bg-pink-1 text-pink-text',
  },
  {
    name: 'yellow',
    steps: ['bg-yellow-1', 'bg-yellow-2', 'bg-yellow-3', 'bg-yellow-4'],
    chip: 'bg-yellow-1 text-yellow-text',
  },
];

const SHADOWS = ['shadow-1', 'shadow-2', 'shadow-3', 'shadow-4'];

export function TokenSpecimens() {
  return (
    <>
      <Section
        id='colors'
        title='Colors'
        description='Neutral surfaces and foregrounds carry the whole UI; accent ramps carry meaning. Alpha variants layer on unknown or colored backgrounds.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='surfaces · bg-1 → bg-4'>
          {SURFACES.map((t) => (
            <div key={t.name} className='flex flex-col items-center gap-1.5'>
              <div className={cn('corner-superellipse/1.125 size-12 rounded-xl shadow-1', t.cls)} />
              <span className='text-fg-2 text-xs'>{t.name}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label='foregrounds · fg-1 → fg-4'>
          {FOREGROUNDS.map((t) => (
            <div key={t.name} className='flex flex-col items-center gap-1.5'>
              <div className={cn('corner-superellipse/1.125 size-12 rounded-xl', t.cls)} />
              <span className='text-fg-2 text-xs'>{t.name}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label='icon inks · icon-1 → icon-4, a step under fg-1 → fg-4'>
          {ICON_INKS.map((t) => (
            <div key={t.name} className='flex flex-col items-center gap-1.5'>
              <div className={cn('corner-superellipse/1.125 size-12 rounded-xl', t.cls)} />
              <span className='text-fg-2 text-xs'>{t.name}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label='alpha · translucent, so the surface underneath shows through'>
          {ALPHAS.map((t) => (
            <div key={t.name} className='flex flex-col items-center gap-1.5'>
              <div className='corner-superellipse/1.125 flex size-12 overflow-hidden rounded-xl'>
                <div className='flex-1 bg-bg-1' />
                <div className='flex-1 bg-bg-4' />
                <div className='flex-1 bg-purple-4' />
                <div className={cn('-ml-12 w-12', t.cls)} />
              </div>
              <span className='text-fg-2 text-xs'>{t.name}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label='ramps · 1 (tint) → 4 (solid), plus the -text step shown doing its one job'>
          <div className='flex flex-col gap-2'>
            {RAMPS.map((ramp) => (
              <div key={ramp.name} className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                {ramp.steps.map((step) => (
                  <div key={step} className={cn('corner-superellipse/1.125 size-9 rounded-lg', step)} />
                ))}
                {ramp.chip ? (
                  <span
                    className={cn(
                      'ml-1 inline-flex h-6 shrink-0 items-center rounded-full px-2.5 font-medium text-sm',
                      ramp.chip
                    )}
                  >
                    Aa text
                  </span>
                ) : null}
                <span className='text-fg-2 text-xs'>{ramp.name}</span>
              </div>
            ))}
          </div>
        </Specimen>
      </Section>
      <Section
        id='typography'
        title='Typography'
        description='ABC Areal, with ABC Areal Mono for code. Medium (450) carries headings and labels; the fg ramp does the rest of the hierarchy. Weights are listed in the next section.'
        className='flex-col items-start gap-2'
      >
        <p className='font-medium text-2xl text-fg-4 tracking-tight'>Page title, 2xl · fg-4</p>
        <p className='font-medium text-fg-4 text-xl leading-tighter'>Dialog title, xl · fg-4</p>
        <p className='font-medium text-fg-4'>Section heading, base · fg-4</p>
        <p className='text-fg-3'>Body text, base · fg-3 (the inherited default)</p>
        <p className='text-fg-2 text-sm'>Secondary label, sm · fg-2</p>
        <p className='text-fg-2 text-xs'>Caption, xs · fg-2</p>
        <p className='text-fg-1 text-xs'>Decorative only, never text, xs · fg-1</p>
        <p className='font-mono text-fg-3 text-xs'>feat/embedded-chat-v2 · mono, xs · fg-3</p>
        <div className='mt-3 flex flex-col gap-1'>
          <span className='text-fg-2 text-xs'>weight without a shift · regular, faux-medium, medium</span>
          <div className='flex items-center gap-4 text-fg-4 text-sm'>
            <span>Changes</span>
            <span className='faux-medium'>Changes</span>
            <span className='font-medium'>Changes</span>
          </div>
        </div>
      </Section>
      <Section
        id='font-weights'
        title='Font weights'
        description='Four weights on the variable Areal axis. Regular is the body; medium (450) is headings, buttons, labels and badges; semibold (550) is inline emphasis; bold (600) is the ceiling and rare. A label that turns medium when it becomes active uses faux-medium, a hairline stroke, so its width never changes.'
        className='flex-col items-start gap-3'
      >
        {(
          [
            ['font-normal', 'Regular', '400'],
            ['font-medium', 'Medium', '450'],
            ['font-semibold', 'Semibold', '550'],
            ['font-bold', 'Bold', '600'],
          ] as const
        ).map(([weight, name, value]) => (
          <div key={weight} className='flex items-baseline gap-4'>
            <span className='w-28 text-fg-2 text-xs'>
              {name} · {value}
            </span>
            <span className={cn('text-base text-fg-4', weight)}>Approve and merge the embedded chat</span>
          </div>
        ))}
        <div className='flex items-baseline gap-4'>
          <span className='w-28 text-fg-2 text-xs'>Faux-medium</span>
          <span className='faux-medium text-base text-fg-4'>Approve and merge the embedded chat</span>
        </div>
      </Section>
      <Section
        id='shadows'
        title='Shadows'
        description='Every shadow ends in a hairline ring, which is what replaces borders. In dark mode the ring flips inside and uses bg-3, the same color as every divider.'
      >
        {SHADOWS.map((s) => (
          <div
            key={s}
            className={cn(
              'corner-superellipse/1.125 flex h-20 w-28 items-center justify-center rounded-2xl bg-background text-fg-2 text-xs dark:bg-bg-2',
              s
            )}
          >
            {s}
          </div>
        ))}
      </Section>
      <Section
        id='icons'
        title='Icons'
        description='Central Icons only. Paths are generated from the icon names referenced across the codebase, so every icon currently in the bundle is shown here.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='sizes · the only three'>
          {ICON_SIZES.map((entry) => (
            <span key={entry.size} className={cn('flex items-center gap-1.5 text-fg-3', entry.text)}>
              <Icon name='IconBell' size={entry.size} />
              {entry.label}
            </span>
          ))}
        </Specimen>
        <Specimen label='ink · each text colour draws its icon a step quieter; a tone keeps its tone'>
          {ICON_PAIRS.map((pair) => (
            <span key={pair} className={cn('flex items-center gap-1.5 text-xs', pair)}>
              <Icon name='IconBell' />
              {pair.replace('text-', '')}
            </span>
          ))}
        </Specimen>
        <Specimen label='corner radius · 0 → 3'>
          <Icon name='IconArchive' radius='0' size='lg' className='text-fg-3' />
          <Icon name='IconArchive' radius='1' size='lg' className='text-fg-3' />
          <Icon name='IconArchive' radius='2' size='lg' className='text-fg-3' />
          <Icon name='IconArchive' radius='3' size='lg' className='text-fg-3' />
        </Specimen>
        <Specimen label={`bundled · ${ICON_NAMES.length} icons`}>
          <div className='grid w-full grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3'>
            {ICON_NAMES.map((name) => (
              <div key={name} className='flex flex-col items-center gap-1.5'>
                <Icon name={name} size='lg' className='text-fg-3' />
                <span className='w-full truncate text-center text-fg-2 text-xs'>
                  {name.replace('Icon', '')}
                </span>
              </div>
            ))}
          </div>
        </Specimen>
      </Section>
    </>
  );
}
