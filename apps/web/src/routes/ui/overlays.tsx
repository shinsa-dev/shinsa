import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shinsa/ui/components/alert-dialog';
import { Button } from '@shinsa/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@shinsa/ui/components/command';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shinsa/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Kbd } from '@shinsa/ui/components/kbd';
import { Label } from '@shinsa/ui/components/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@shinsa/ui/components/popover';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shinsa/ui/components/sheet';
import { toast } from '@shinsa/ui/components/sonner';
import { Switch } from '@shinsa/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shinsa/ui/components/tooltip';
import { Section } from './section.tsx';

export const OVERLAY_SECTIONS = [
  { id: 'command', label: 'Command menu' },
  { id: 'dropdown', label: 'Dropdown menu' },
  { id: 'popover', label: 'Popover' },
  { id: 'tooltip', label: 'Tooltip' },
  { id: 'dialog', label: 'Dialog' },
  { id: 'alert-dialog', label: 'Alert dialog' },
  { id: 'sheet', label: 'Sheet' },
  { id: 'toast', label: 'Toast' },
];

const ACTIVITY_ROWS = Array.from({ length: 12 }, (_, i) => ({
  id: `activity-${i + 1}`,
  title: `Run ${i + 1}`,
}));

export function OverlaySpecimens() {
  return (
    <>
      <Section
        id='command'
        title='Command menu'
        description='cmdk under the menu grammar: one sliding highlight, quiet group headings, a hint after the label and the shortcut at the right edge. In the app it opens with ⌘K as a dialog; here it is inline.'
      >
        <Command className='corner-superellipse/1.125 w-full max-w-[520px] rounded-xl shadow-md'>
          <CommandInput placeholder='Search tasks, or describe new work…' end={<Kbd>esc</Kbd>} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading='On this page'>
              <CommandItem icon='IconPlusMedium'>Start a task</CommandItem>
            </CommandGroup>
            <CommandGroup heading='Go to'>
              <CommandItem icon='IconInboxEmpty'>
                Needs you
                <CommandShortcut keys={['G', 'N']} />
              </CommandItem>
              <CommandItem icon='IconAgentsFilled'>
                Embedded chat rework
                <CommandHint>Review</CommandHint>
                <CommandShortcut keys={['G', 'R']} />
              </CommandItem>
              <CommandItem icon='IconSettingsGear4Filled' disabled>
                Desktop app
                <CommandHint>Soon</CommandHint>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading='Help'>
              <CommandItem icon='IconBook'>
                Documentation
                <CommandHint>shinsa.dev</CommandHint>
                <Icon name='IconArrowUpRight' className='ml-auto size-4' />
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <CommandFooter>
            <span className='flex items-center gap-1'>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className='ml-0.5'>Move</span>
            </span>
            <span className='flex items-center gap-1'>
              <Kbd>↵</Kbd>
              <span className='ml-0.5'>Open</span>
            </span>
          </CommandFooter>
        </Command>
      </Section>
      <Section
        id='dropdown'
        title='Dropdown menu'
        description='One indicator slides between items; items never draw their own background. Supports icons, submenus, checkbox and radio items.'
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant='outline' />}>Options</DropdownMenuTrigger>
          <DropdownMenuContent className='w-56'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Task</DropdownMenuLabel>
              <DropdownMenuItem icon='IconArrowRotateClockwise'>Restart the current step</DropdownMenuItem>
              <DropdownMenuItem icon='IconCode'>
                Open in editor
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Urgent</DropdownMenuItem>
                  <DropdownMenuItem>Normal</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked>Show merged</DropdownMenuCheckboxItem>
              <DropdownMenuRadioGroup defaultValue='newest'>
                <DropdownMenuRadioItem value='newest'>Newest first</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='oldest'>Oldest first</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' icon='IconTrashCan'>
              Cancel task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>
      <Section id='popover' title='Popover' description='Small interactive panels on the menu surface.'>
        <Popover>
          <PopoverTrigger render={<Button variant='outline' />}>Agents</PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Agents</PopoverTitle>
              <PopoverDescription>Pause an agent without losing its tasks.</PopoverDescription>
            </PopoverHeader>
            <div className='flex items-center justify-between'>
              <Label htmlFor='ds-pop-1'>Claude</Label>
              <Switch id='ds-pop-1' defaultChecked />
            </div>
            <div className='flex items-center justify-between'>
              <Label htmlFor='ds-pop-2'>Codex</Label>
              <Switch id='ds-pop-2' />
            </div>
          </PopoverContent>
        </Popover>
      </Section>
      <Section id='tooltip' title='Tooltip' description='A compact dark pill. Supports a trailing shortcut.'>
        <Tooltip>
          <TooltipTrigger render={<Button variant='outline' />}>Top</TooltipTrigger>
          <TooltipContent>Approve the spec</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant='outline' />}>Right</TooltipTrigger>
          <TooltipContent side='right'>Copy the branch name</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant='outline' />}>With shortcut</TooltipTrigger>
          <TooltipContent>
            New task
            <Kbd>C</Kbd>
          </TooltipContent>
        </Tooltip>
      </Section>
      <Section
        id='dialog'
        title='Dialog'
        description='Centered, 420px, title over description. Tall content scrolls.'
      >
        <Dialog>
          <DialogTrigger render={<Button />}>New project</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a project</DialogTitle>
            </DialogHeader>
            <form className='flex w-full flex-col gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='ds-dialog-name'>Name</Label>
                <Input id='ds-dialog-name' placeholder='Side projects' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='ds-dialog-slug'>GitHub owner</Label>
                <Input id='ds-dialog-slug' placeholder='chroxify' />
              </div>
              <Button className='mt-2 w-full' type='submit'>
                Create project
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger render={<Button variant='outline' />}>With close button</DialogTrigger>
          <DialogContent showCloseButton>
            <DialogHeader>
              <DialogTitle>Keyboard shortcuts</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </Section>
      <Section
        id='alert-dialog'
        title='Alert dialog'
        description='Destructive confirms: title, description, and two actions that split the width.'
      >
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant='destructive' />}>Cancel task</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this task?</AlertDialogTitle>
              <AlertDialogDescription>
                The running agent stops and its worktree is removed. The branch and any pull request stay on
                GitHub.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant='destructive'>Cancel task</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>
      <Section
        id='sheet'
        title='Sheet'
        description='Side panels. Scrollable content goes in SheetBody so the header and footer stay pinned.'
      >
        {(['right', 'left', 'bottom'] as const).map((side) => (
          <Sheet key={side}>
            <SheetTrigger render={<Button variant='outline' />}>{side}</SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle>Agent runs</SheetTitle>
                <SheetDescription>Every run on this task, newest last.</SheetDescription>
              </SheetHeader>
              <SheetBody className='flex flex-col gap-3'>
                {ACTIVITY_ROWS.map((row) => (
                  <div key={row.id} className='flex flex-col'>
                    <span className='font-medium text-fg-4 text-sm'>{row.title}</span>
                    <span className='text-fg-2 text-xs'>Builder · finished in 4 min</span>
                  </div>
                ))}
              </SheetBody>
              <SheetFooter>
                <Button className='w-full'>Restart</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        ))}
      </Section>
      <Section
        id='toast'
        title='Toast'
        description='Firing the same toast twice pings the existing one (shake for errors, bump otherwise) instead of stacking duplicates.'
      >
        <Button variant='outline' onClick={() => toast.success('Approved. Opening the pull request.')}>
          Success
        </Button>
        <Button
          variant='outline'
          onClick={() =>
            toast.error('Unable to reach Shinsa', { description: 'Check that shinsa serve is running.' })
          }
        >
          Error
        </Button>
        <Button variant='outline' onClick={() => toast.warning('Checks failing on #4512')}>
          Warning
        </Button>
        <Button variant='outline' onClick={() => toast.info('2 tasks need you')}>
          Info
        </Button>
        <Button variant='outline' onClick={() => toast('Sent to the agent')}>
          Default
        </Button>
        <Button
          variant='outline'
          onClick={() =>
            toast('Task cancelled', {
              description: 'The agent stopped and the worktree is gone.',
              action: { label: 'Undo', onClick: () => toast.success('Restored') },
            })
          }
        >
          With action
        </Button>
        <Button
          variant='outline'
          onClick={() => {
            const id = toast.loading('Merging…');
            setTimeout(() => toast.success('Merged #4512', { id }), 1600);
          }}
        >
          Loading → success
        </Button>
      </Section>
    </>
  );
}
