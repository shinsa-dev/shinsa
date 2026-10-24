import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { Label } from '@shinsa/ui/components/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@shinsa/ui/components/select';
import { Switch } from '@shinsa/ui/components/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import { Textarea } from '@shinsa/ui/components/textarea';
import { Truncate } from '@shinsa/ui/components/truncate';
import { Section, Specimen } from './section.tsx';

export const INPUT_SECTIONS = [
  { id: 'button', label: 'Button' },
  { id: 'truncate', label: 'Truncate' },
  { id: 'badge', label: 'Badge' },
  { id: 'selection', label: 'Selection' },
  { id: 'input', label: 'Input & Textarea' },
  { id: 'field', label: 'Field' },
  { id: 'select', label: 'Select' },
  { id: 'controls', label: 'Switch' },
  { id: 'tabs', label: 'Tabs' },
];

const BADGE_VARIANTS = [
  'default',
  'purple',
  'sky',
  'blue',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'solid',
] as const;

const STAGE_ITEMS = [
  { label: 'Needs you', value: 'gate', icon: 'IconInboxEmpty' },
  { label: 'Agents working', value: 'working', icon: 'IconAgents' },
  { label: 'Merged', value: 'merged', icon: 'IconCheckCircle2' },
] as const;

const AGENT_ITEMS = [
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Cursor', value: 'cursor' },
];

export function InputSpecimens() {
  return (
    <>
      <Section
        id='button'
        title='Button'
        description='Pressing scales only the background; the label never moves. Disabled buttons are fully inert.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='variants'>
          <Button variant='primary'>Primary</Button>
          <Button variant='secondary'>Secondary</Button>
          <Button variant='outline'>Outline</Button>
          <Button variant='destructive'>Destructive</Button>
          <Button variant='link'>Link</Button>
        </Specimen>
        <Specimen label='sizes · xs · sm · default · lg'>
          <Button size='xs'>Extra small</Button>
          <Button size='sm'>Small</Button>
          <Button size='default'>Default</Button>
          <Button size='lg'>Large</Button>
        </Specimen>
        <Specimen label='icon-only · one per size'>
          <Button size='icon-xs' icon='IconPlusMedium' aria-label='Add' />
          <Button size='icon-sm' icon='IconBell' aria-label='Notify' />
          <Button size='icon' variant='outline' icon='IconFiles' aria-label='Copy' />
          <Button size='icon-lg' variant='outline' icon='IconSettingsGear1' aria-label='Settings' />
        </Specimen>
        <Specimen label='loading · the spinner takes the icon’s place, the label stays, the button disables itself'>
          <Button loading>Approve</Button>
          <Button loading icon='IconPlusMedium'>
            New task
          </Button>
          <Button
            loading
            variant='secondary'
            icon={{ name: 'IconChevronRightMedium', position: 'inline-end' }}
          >
            Next
          </Button>
        </Specimen>
        <Specimen label='icon prop · leading and trailing'>
          <Button icon='IconPlusMedium'>New task</Button>
          <Button variant='secondary' icon='IconMerged'>
            Merge #4512
          </Button>
        </Specimen>
        <Specimen label='outline · on its own, never beside a primary'>
          <Button variant='outline' icon={{ name: 'IconChevronDownMedium', position: 'inline-end' }}>
            Superwall
          </Button>
          <Button variant='outline' size='sm' icon='IconBranch'>
            Branch
          </Button>
        </Specimen>
        <Specimen label='disabled'>
          <Button disabled>Primary</Button>
          <Button variant='secondary' disabled>
            Secondary
          </Button>
          <Button variant='outline' disabled>
            Outline
          </Button>
          <Button variant='destructive' disabled>
            Destructive
          </Button>
        </Specimen>
      </Section>
      <Section
        id='truncate'
        title='Truncate'
        description='A single line that cuts off with an ellipsis and, only when it really is cut off, shows the whole text in a tooltip after 150ms, like every time stamp. Replaces a bare `truncate` span wherever the text comes from data. `middle` cuts in the centre instead, for ids whose tail carries as much meaning as their head.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='clipped · hover for the full text'>
          <div className='flex w-56 flex-col rounded-xl bg-bg-2 px-3 py-2'>
            <Truncate className='font-medium text-fg-4 text-sm'>
              Rework the embedded chat on top of MCP v2 and drop the old transport
            </Truncate>
            <Truncate className='text-fg-2 text-xs'>
              paywall-next · feat/embedded-chat-v2 · on top of MCP v2
            </Truncate>
          </div>
        </Specimen>
        <Specimen label='fits · no tooltip'>
          <div className='flex w-56 flex-col rounded-xl bg-bg-2 px-3 py-2'>
            <Truncate className='font-medium text-fg-4 text-sm'>Fix scroll</Truncate>
            <Truncate className='text-fg-2 text-xs'>kanna</Truncate>
          </div>
        </Specimen>
        <Specimen label='middle · both ends of an id stay readable'>
          <div className='flex w-56 flex-col rounded-xl bg-bg-2 px-3 py-2'>
            <Truncate middle className='text-fg-4 text-xs'>
              task_9RmZ0hVQb2xKcT4wLpN7s
            </Truncate>
            <Truncate middle className='text-fg-4 text-xs'>
              worktrees/paywall-next-embedded-chat
            </Truncate>
          </div>
        </Specimen>
        <Specimen label='middle · several ids sharing one line'>
          <div className='flex w-80 items-center gap-1.5 rounded-xl bg-bg-2 px-3 py-2'>
            <Truncate middle className='min-w-0 flex-1 basis-0 text-fg-4 text-xs'>
              task_9RmZ0hVQb2xKcT4wLpN7s
            </Truncate>
            <span className='shrink-0 text-fg-1'>·</span>
            <Truncate middle className='min-w-0 flex-1 basis-0 text-fg-4 text-xs'>
              task_e54621c03bbe4cd49dff9
            </Truncate>
          </div>
        </Specimen>
      </Section>
      <Section
        id='badge'
        title='Badge'
        description='Status chips: a -1 tint background with its -text step on top. The -4 step is a fill, not a text color; on its own tint it lands around 2:1.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='variants'>
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </Specimen>
        <Specimen label='sizes · sm (20px) · default (24px)'>
          <Badge size='sm' variant='green'>
            +12.4%
          </Badge>
          <Badge size='sm'>Small</Badge>
          <Badge size='default'>Default</Badge>
        </Specimen>
        <Specimen label='icon prop · trims 2px on the icon side'>
          <Badge variant='green' icon='IconCheckmark1'>
            Checks passing
          </Badge>
          <Badge variant='amber' icon='IconInboxEmpty'>
            Changes to review
          </Badge>
          <Badge size='sm' variant='sky' icon='IconAgents'>
            Building
          </Badge>
          <Badge variant='purple' icon={{ name: 'IconChevronRightMedium', position: 'inline-end' }}>
            Stacked
          </Badge>
        </Specimen>
      </Section>
      <Section
        id='selection'
        title='Selection'
        description='Text selection follows the surface: ::selection reads the inherited --selection variable, so every tinted surface re-colors it with its selection-* utility. Neutral surfaces use the bg-a4 tint. Select the text below to see each one.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='badges · selectable here so the hue shows'>
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v} className='cursor-text select-text'>
              Select me
            </Badge>
          ))}
        </Specimen>
        <Specimen label='surfaces'>
          <p className='rounded-xl bg-bg-2 px-3 py-2 text-fg-3 text-sm'>
            Neutral surface, neutral selection.
          </p>
          <p className='selection-amber rounded-xl bg-amber-a2 px-3 py-2 text-fg-3 text-sm'>
            Amber surface selects amber.
          </p>
          <p className='selection-inverse rounded-xl bg-fg-4 px-3 py-2 text-background text-sm'>
            Solid surface flips the selection to light.
          </p>
        </Specimen>
      </Section>
      <Section
        id='input'
        title='Input & Textarea'
        description='Recessed bg-2 fields at 26px, the same height and rounding as the default button.'
        className='flex-col items-start'
      >
        <div className='grid w-full max-w-2xl gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='ds-name'>Default</Label>
            <Input id='ds-name' placeholder='Project name' />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='ds-filled'>Filled</Label>
            <Input id='ds-filled' defaultValue='Superwall' />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='ds-disabled'>Disabled</Label>
            <Input id='ds-disabled' placeholder='Disabled' disabled />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='ds-invalid'>Invalid</Label>
            <Input id='ds-invalid' placeholder='Invalid' aria-invalid />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='ds-readonly'>Read-only</Label>
            <Input id='ds-readonly' readOnly defaultValue='~/.shinsa/worktrees/…' />
            <Input id='ds-loading' placeholder='Find a repository' defaultValue='paywall-next' loading />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='ds-message'>Textarea</Label>
            <Textarea id='ds-message' placeholder='Describe the work' />
          </div>
        </div>
      </Section>
      <Section
        id='field'
        title='Field'
        description='Composes a label, control, description and error into one accessible unit, the building block of every form.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='vertical: label, control, description'>
          <div className='grid w-full max-w-2xl gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='ds-f-name'>Project name</FieldLabel>
              <Input id='ds-f-name' placeholder='Superwall' />
            </Field>
            <Field>
              <FieldLabel htmlFor='ds-f-slug'>Branch prefix</FieldLabel>
              <Input id='ds-f-slug' placeholder='christo/' />
              <FieldDescription>Every branch an agent creates starts with this.</FieldDescription>
            </Field>
          </div>
        </Specimen>
        <Specimen label='invalid: data-invalid on the field, aria-invalid on the control'>
          <Field data-invalid='true' className='max-w-sm'>
            <FieldLabel htmlFor='ds-f-invalid'>Check command</FieldLabel>
            <Input
              id='ds-f-invalid'
              defaultValue='bun lnit'
              aria-invalid
              aria-describedby='ds-f-invalid-error'
            />
            <FieldError id='ds-f-invalid-error'>No script named lnit in package.json.</FieldError>
          </Field>
        </Specimen>
        <Specimen label='disabled'>
          <Field data-disabled='true' className='max-w-sm'>
            <FieldLabel htmlFor='ds-f-disabled'>Repository</FieldLabel>
            <Input id='ds-f-disabled' placeholder='paywall-next' disabled />
            <FieldDescription>Picked for you from the request; change it on the plan.</FieldDescription>
          </Field>
        </Specimen>
        <Specimen label='horizontal: content beside the control'>
          <Field orientation='horizontal' className='max-w-sm'>
            <FieldContent>
              <FieldLabel htmlFor='ds-f-digest'>Plan first for large work</FieldLabel>
              <FieldDescription>
                Large tasks wait for you to approve the plan before anything is built.
              </FieldDescription>
            </FieldContent>
            <Switch id='ds-f-digest' defaultChecked />
          </Field>
        </Specimen>
        <Specimen label='group: gap-5 stack with a labeled separator'>
          <FieldGroup className='max-w-sm'>
            <Field>
              <FieldLabel htmlFor='ds-f-email'>Repository path</FieldLabel>
              <Input id='ds-f-email' placeholder='~/Developer/Superwall/paywall-next' />
            </Field>
            <FieldSeparator>or</FieldSeparator>
            <Field>
              <FieldLabel htmlFor='ds-f-sso'>GitHub URL</FieldLabel>
              <Input id='ds-f-sso' placeholder='github.com/superwall/paywall-next' />
              <FieldDescription>Shinsa clones it into its own worktrees.</FieldDescription>
            </Field>
          </FieldGroup>
        </Specimen>
        <Specimen label='fieldset: legend over related fields'>
          <FieldSet className='max-w-sm'>
            <FieldLegend>Agents</FieldLegend>
            <FieldDescription>Choose which agents can run tasks in this project.</FieldDescription>
            <Field orientation='horizontal'>
              <FieldContent>
                <FieldLabel htmlFor='ds-f-push'>Claude</FieldLabel>
              </FieldContent>
              <Switch id='ds-f-push' defaultChecked />
            </Field>
            <Field orientation='horizontal'>
              <FieldContent>
                <FieldLabel htmlFor='ds-f-email2'>Codex</FieldLabel>
              </FieldContent>
              <Switch id='ds-f-email2' />
            </Field>
          </FieldSet>
        </Specimen>
      </Section>
      <Section
        id='select'
        title='Select'
        description='Field language of an input, press behavior of a button, and the menu’s sliding highlight. Opens on click so the press shows.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='one size, matches the default button'>
          <Select defaultValue='gate' items={[...STAGE_ITEMS, ...AGENT_ITEMS]}>
            <SelectTrigger className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Stage</SelectLabel>
                {STAGE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value} icon={item.icon}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Agent</SelectLabel>
                {AGENT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select items={AGENT_ITEMS}>
            <SelectTrigger className='w-36'>
              <SelectValue placeholder='Agent…' />
            </SelectTrigger>
            <SelectContent>
              {AGENT_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select disabled items={AGENT_ITEMS}>
            <SelectTrigger className='w-36'>
              <SelectValue placeholder='Disabled' />
            </SelectTrigger>
            <SelectContent>
              {AGENT_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label='ghost: no fill until hover or open'>
          <Select defaultValue='gate' items={STAGE_ITEMS}>
            <SelectTrigger variant='ghost'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value} icon={item.icon}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Specimen>
      </Section>
      <Section
        id='controls'
        title='Switch'
        description='Contentless controls scale fully on press; they have no label that could shift.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='switch'>
          <div className='flex items-center gap-2'>
            <Switch id='ds-s1' defaultChecked />
            <Label htmlFor='ds-s1'>Checked</Label>
          </div>
          <div className='flex items-center gap-2'>
            <Switch id='ds-s2' />
            <Label htmlFor='ds-s2'>Unchecked</Label>
          </div>
          <div className='flex items-center gap-2'>
            <Switch id='ds-s3' disabled defaultChecked />
            <Label htmlFor='ds-s3'>Disabled</Label>
          </div>
        </Specimen>
      </Section>
      <Section
        id='tabs'
        title='Tabs'
        description='The segmented pill slides between tabs; the ghost variant is bare text that presses like a link; the underline variant slides one line beneath the tabs.'
        className='flex-col items-start gap-6'
      >
        <Specimen label='segmented (default)'>
          <Tabs defaultValue='walkthrough'>
            <TabsList>
              <TabsTrigger value='walkthrough'>Walkthrough</TabsTrigger>
              <TabsTrigger value='attention'>By attention</TabsTrigger>
            </TabsList>
            <TabsContent value='walkthrough'>The change in the order to read it.</TabsContent>
            <TabsContent value='attention'>Every spot, riskiest first.</TabsContent>
          </Tabs>
        </Specimen>
        <Specimen label='ghost'>
          <Tabs defaultValue='open'>
            <TabsList variant='ghost'>
              <TabsTrigger value='open'>Open</TabsTrigger>
              <TabsTrigger value='done'>Done</TabsTrigger>
              <TabsTrigger value='all'>All</TabsTrigger>
            </TabsList>
          </Tabs>
        </Specimen>
        <Specimen label='underline · the task workspace views; one line slides under the selected tab, which reads medium through faux-medium so no tab shifts'>
          <Tabs defaultValue='review'>
            <TabsList variant='underline'>
              <TabsTrigger value='review'>Review</TabsTrigger>
              <TabsTrigger value='changes'>Changes</TabsTrigger>
              <TabsTrigger value='plan'>Plan</TabsTrigger>
              <TabsTrigger value='evidence'>Evidence</TabsTrigger>
              <TabsTrigger value='agents'>Agents</TabsTrigger>
            </TabsList>
          </Tabs>
        </Specimen>
      </Section>
    </>
  );
}
